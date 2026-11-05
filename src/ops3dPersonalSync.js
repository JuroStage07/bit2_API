// Personal en sitio (BIT2) → Supabase de AppOLO, para el Proceso 3D de SRO.
// Contrato: SRO/docs/integracion-appolo-proceso3d.md §1d.
//
// Cada OPS3D_PERSONAL_SYNC_MS (60 s por defecto) lee las marcas del DÍA EN CURSO
// (America/Costa_Rica) de dbo.GLogs, resuelve escala/coordinador/gerente con la
// config de Horas Extra en Firestore y hace upsert en ops3d_personal_dia solo de
// las filas que cambiaron. Si algo cambió, avisa al canal realtime ops3d:<bodega>
// (RPC ops3d_notify_personal). Siempre actualiza ops3d_personal_sync (ultima_sync,
// marcas_hasta) para que el snapshot sepa qué tan frescos están los datos.
//
// Solo lectura en BIT2 y Firestore. Si BIT2, Firestore o Supabase fallan, se
// registra el error y se reintenta en la siguiente vuelta, sin tumbar la API.
//
// Config (en .env.local, que no se versiona — .env es compartido):
//   OPS3D_SUPABASE_URL, OPS3D_SUPABASE_KEY (service role / secret del proyecto
//   azwuzsukvqjogcfqljhg). Sin ellas, la sincronización no arranca.
//   Opcional: OPS3D_PERSONAL_BODEGA (CR-OLO-CLIRO), OPS3D_PERSONAL_SYNC_MS (60000).

const { getSqlPool, sql } = require("./sql");
const { construirFilas, crearResolutor, hoyCR, huella, localCRaIso } = require("./personalLib");

const CONFIG_TTL_MS = 5 * 60 * 1000;
const LOTE = 200;

function siguienteDia(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Marcas del día (hora local CR, como texto) con los datos del empleado. Nunca el código (cédula). */
async function leerMarcas(pool, fecha) {
  const r = await pool
    .request()
    .input("desde", sql.VarChar(19), `${fecha}T00:00:00`)
    .input("hasta", sql.VarChar(19), `${siguienteDia(fecha)}T00:00:00`)
    .query(`
      SELECT
        e.id                                          AS idEmployee,
        LTRIM(RTRIM(e.name + ' ' + e.lastName))       AS fullName,
        jp.name                                       AS puesto,
        d.name                                        AS departamento,
        eg.name                                       AS nameGroup,
        CONVERT(varchar(19), g._datetime, 126)        AS ts,
        g.machineNo                                   AS machineNo
      FROM dbo.GLogs g
      INNER JOIN dbo.employees e
        ON CAST(e.IdDevice AS varchar(20)) = CAST(g.enrollNo AS varchar(20))
      LEFT JOIN dbo.jobPositions jp   ON jp.id = e.idJobPosition
      LEFT JOIN dbo.departaments d    ON d.id = e.idDepartament
      LEFT JOIN dbo.employeesGroups eg ON eg.id = e.idGroup
      WHERE g._datetime >= CAST(@desde AS datetime)
        AND g._datetime <  CAST(@hasta AS datetime)
        AND ISNULL(g.IsActive, 1) = 1
      ORDER BY e.id, g._datetime
    `);
  return r.recordset;
}

/** Horario del día por empleado (InOutStr de view_schedules). */
async function leerHorarios(pool, fecha) {
  const r = await pool
    .request()
    .input("desde", sql.VarChar(19), `${fecha}T00:00:00`)
    .input("hasta", sql.VarChar(19), `${siguienteDia(fecha)}T00:00:00`)
    .query(`
      SELECT ce.idEmployee, s.InOutStr
      FROM dbo.calendarEmployees ce
      INNER JOIN dbo.view_schedules s ON s.id = ce.idSchedule
      WHERE ce._date >= CAST(@desde AS datetime)
        AND ce._date <  CAST(@hasta AS datetime)
    `);
  return new Map(r.recordset.map((x) => [String(x.idEmployee), x.InOutStr]));
}

/** Empleados activos con su grupo (respaldo para el gerente de un coordinador). Sin código/cédula. */
async function leerEmpleadosActivos(pool) {
  const r = await pool.request().query(`
    SELECT LTRIM(RTRIM(e.name + ' ' + e.lastName)) AS nombre, eg.name AS nameGroup
    FROM dbo.employees e
    LEFT JOIN dbo.employeesGroups eg ON eg.id = e.idGroup
    WHERE e.IsActive = 1
  `);
  return r.recordset;
}

/** Momento en que entró a GLogs la última marca (última descarga del reloj con datos). */
async function leerMarcasHasta(pool) {
  const r = await pool.request().query(`SELECT TOP 1 CONVERT(varchar(19), dateCreation, 126) AS t FROM dbo.GLogs ORDER BY id DESC`);
  return localCRaIso(r.recordset[0]?.t);
}

/** Cliente mínimo de PostgREST con la llave de servicio (sin dependencias nuevas). */
function crearSupabase(url, key, fetchImpl = fetch) {
  const base = String(url).replace(/\/+$/, "");
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Las llaves legadas (JWT) van también en Authorization; las nuevas sb_secret_ solo en apikey.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  async function llamar(path, body, prefer) {
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Supabase ${path} → ${res.status} ${txt.slice(0, 300)}`);
    }
  }
  const upsert = (tabla, conflicto, filas) =>
    llamar(`/rest/v1/${tabla}?on_conflict=${conflicto}`, filas, "resolution=merge-duplicates,return=minimal");
  return {
    upsert,
    rpc: (fn, args) => llamar(`/rest/v1/rpc/${fn}`, args),
  };
}

/**
 * Una vuelta de sincronización. `estado` guarda entre vueltas la huella de lo ya
 * enviado (por fecha) y la config cacheada. Devuelve un resumen para el log.
 */
async function sincronizarUnaVez({ pool, db, supa, bodegaId, estado, now = new Date() }) {
  const fecha = hoyCR(now);
  if (estado.fecha !== fecha) {
    estado.fecha = fecha;
    estado.enviado = new Map();
  }

  if (!estado.resolver || now - estado.configAt > CONFIG_TTL_MS) {
    const [coordSnap, relSnap, empleados] = await Promise.all([
      db.doc("appConfig/overtimeCoordinatorEmails").get(),
      db.doc("overtimeConfig/managerRelations").get(),
      leerEmpleadosActivos(pool),
    ]);
    estado.resolver = crearResolutor(coordSnap.data()?.coordinators ?? [], relSnap.data()?.relations ?? [], empleados);
    estado.configAt = now.getTime();
  }

  const [marcas, horarios, marcasHasta] = await Promise.all([
    leerMarcas(pool, fecha),
    leerHorarios(pool, fecha),
    leerMarcasHasta(pool),
  ]);
  const filas = construirFilas({ fecha, bodegaId, marcas, horarios, resolver: estado.resolver });

  const cambiadas = filas.filter((f) => estado.enviado.get(f.id_employee) !== huella(f));
  const at = new Date().toISOString();
  for (let i = 0; i < cambiadas.length; i += LOTE) {
    await supa.upsert(
      "ops3d_personal_dia",
      "fecha,id_employee",
      cambiadas.slice(i, i + LOTE).map((f) => ({ ...f, updated_at: at }))
    );
  }
  // Solo después de escribir: si falla, la próxima vuelta lo reintenta.
  for (const f of cambiadas) estado.enviado.set(f.id_employee, huella(f));

  await supa.upsert("ops3d_personal_sync", "bodega_id", [
    { bodega_id: bodegaId, ultima_sync: at, marcas_hasta: marcasHasta, ultimo_error: null, error_at: null, updated_at: at },
  ]);

  if (cambiadas.length) {
    try {
      await supa.rpc("ops3d_notify_personal", { p_bodega: bodegaId, p_fecha: fecha });
    } catch (e) {
      // El aviso es un extra: los datos ya quedaron guardados.
      console.error("[ops3d-personal] aviso realtime:", e.message);
    }
  }
  return { fecha, personas: filas.length, cambiadas: cambiadas.length, marcasHasta };
}

/** Arranca el ciclo. Devuelve una función para detenerlo (o null si falta config). */
function iniciarSyncPersonal({ db, env = process.env } = {}) {
  const url = env.OPS3D_SUPABASE_URL;
  const key = env.OPS3D_SUPABASE_KEY;
  if (!url || !key) {
    console.log("[ops3d-personal] sin OPS3D_SUPABASE_URL / OPS3D_SUPABASE_KEY: sincronización apagada.");
    return null;
  }
  const bodegaId = env.OPS3D_PERSONAL_BODEGA || "CR-OLO-CLIRO";
  const cada = Math.max(15000, Number(env.OPS3D_PERSONAL_SYNC_MS) || 60000);
  const supa = crearSupabase(url, key);
  const estado = { fecha: null, enviado: new Map(), resolver: null, configAt: 0 };
  let timer = null;
  let detenido = false;
  let ultimoError = null;

  const vuelta = async () => {
    try {
      const pool = await getSqlPool();
      const r = await sincronizarUnaVez({ pool, db, supa, bodegaId, estado });
      if (ultimoError || r.cambiadas) {
        console.log(`[ops3d-personal] ${r.fecha}: ${r.personas} personas, ${r.cambiadas} cambios, marcas hasta ${r.marcasHasta}`);
      }
      ultimoError = null;
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 500);
      // No repetir el mismo error cada minuto en el log.
      if (msg !== ultimoError) console.error("[ops3d-personal] error:", msg);
      ultimoError = msg;
      try {
        const at = new Date().toISOString();
        await supa.upsert("ops3d_personal_sync", "bodega_id", [
          { bodega_id: bodegaId, ultimo_error: msg, error_at: at, updated_at: at },
        ]);
      } catch {
        // Supabase también caído: queda en el log local.
      }
    } finally {
      if (!detenido) timer = setTimeout(vuelta, cada);
    }
  };

  console.log(`[ops3d-personal] sincronizando ${bodegaId} cada ${cada / 1000} s.`);
  timer = setTimeout(vuelta, 2000);
  return () => {
    detenido = true;
    clearTimeout(timer);
  };
}

module.exports = { crearSupabase, iniciarSyncPersonal, leerHorarios, leerMarcas, leerMarcasHasta, sincronizarUnaVez };

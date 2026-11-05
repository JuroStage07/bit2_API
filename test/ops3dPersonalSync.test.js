// Pruebas del ciclo de sincronización con BIT2, Firestore y Supabase simulados.

const test = require("node:test");
const assert = require("node:assert/strict");
const { crearSupabase, sincronizarUnaVez } = require("../src/ops3dPersonalSync");

/** Pool falso: responde según el texto del query. */
function poolFalso(datos) {
  return {
    request() {
      const req = {
        input: () => req,
        query: async (q) => {
          if (q.includes("FROM dbo.calendarEmployees")) return { recordset: datos.horarios };
          if (q.includes("ORDER BY id DESC")) return { recordset: [{ t: datos.marcasHasta }] };
          if (q.includes("WHERE e.IsActive = 1")) return { recordset: datos.empleados ?? [] };
          return { recordset: datos.marcas };
        },
      };
      return req;
    },
  };
}

const dbFalso = {
  doc: (p) => ({
    get: async () => ({
      data: () =>
        p === "appConfig/overtimeCoordinatorEmails"
          ? { coordinators: [{ name: "YENDRY QUIEL VARGAS", role: "Coordinador" }, { name: "RICARDO PEREZ ARAYA", role: "Gerente" }] }
          : { relations: [{ coordinatorName: "YENDRY QUIEL VARGAS", managerName: "RICARDO PEREZ ARAYA" }] },
    }),
  }),
};

function supaFalso() {
  const s = { upserts: [], rpcs: [], fallarUpsert: false };
  s.upsert = async (tabla, conflicto, filas) => {
    if (s.fallarUpsert && tabla === "ops3d_personal_dia") throw new Error("Supabase caído");
    s.upserts.push({ tabla, conflicto, filas });
  };
  s.rpc = async (fn, args) => s.rpcs.push({ fn, args });
  return s;
}

const marca = (id, nombre, hora) => ({
  idEmployee: id,
  fullName: nombre,
  puesto: "ASISTENTE DE LOGISTICA",
  departamento: "CEDI",
  nameGroup: "YENDRY QUIEL VARGAS",
  ts: `2026-11-05T${hora}:00`,
  machineNo: 1,
});
const NOW = new Date("2026-11-05T16:00:00Z"); // 10:00 en CR

test("sync: primera vuelta envía todo, avisa y registra ultima_sync / marcas_hasta", async () => {
  const datos = {
    marcas: [marca(56, "STEVEN ALFREDO MARIN VALERIO", "05:47"), marca(141, "CARMEN CECILIA SOTO MONTERO", "06:55")],
    horarios: [{ idEmployee: 56, InOutStr: "05:00 -> 14:30" }],
    marcasHasta: "2026-11-05T09:58:00",
  };
  const supa = supaFalso();
  const estado = { fecha: null, enviado: new Map(), resolver: null, configAt: 0 };
  const r = await sincronizarUnaVez({ pool: poolFalso(datos), db: dbFalso, supa, bodegaId: "CR-OLO-CLIRO", estado, now: NOW });

  assert.equal(r.personas, 2);
  assert.equal(r.cambiadas, 2);
  const dia = supa.upserts.find((u) => u.tabla === "ops3d_personal_dia");
  assert.equal(dia.conflicto, "fecha,id_employee");
  assert.equal(dia.filas.length, 2);
  assert.equal(dia.filas[0].gerente, "RICARDO PEREZ ARAYA");
  const sync = supa.upserts.find((u) => u.tabla === "ops3d_personal_sync").filas[0];
  assert.equal(sync.marcas_hasta, "2026-11-05T09:58:00-06:00");
  assert.equal(sync.ultimo_error, null);
  assert.ok(sync.ultima_sync);
  assert.deepEqual(supa.rpcs, [{ fn: "ops3d_notify_personal", args: { p_bodega: "CR-OLO-CLIRO", p_fecha: "2026-11-05" } }]);
});

test("sync: sin cambios no reescribe filas ni avisa; con una marca nueva solo envía esa persona", async () => {
  const datos = {
    marcas: [marca(56, "STEVEN ALFREDO MARIN VALERIO", "05:47"), marca(141, "CARMEN CECILIA SOTO MONTERO", "06:55")],
    horarios: [],
    marcasHasta: "2026-11-05T09:58:00",
  };
  const estado = { fecha: null, enviado: new Map(), resolver: null, configAt: 0 };
  await sincronizarUnaVez({ pool: poolFalso(datos), db: dbFalso, supa: supaFalso(), bodegaId: "B", estado, now: NOW });

  const supa2 = supaFalso();
  const r2 = await sincronizarUnaVez({ pool: poolFalso(datos), db: dbFalso, supa: supa2, bodegaId: "B", estado, now: NOW });
  assert.equal(r2.cambiadas, 0);
  assert.equal(supa2.upserts.filter((u) => u.tabla === "ops3d_personal_dia").length, 0);
  assert.equal(supa2.upserts.filter((u) => u.tabla === "ops3d_personal_sync").length, 1, "ultima_sync se actualiza siempre");
  assert.equal(supa2.rpcs.length, 0);

  datos.marcas.push(marca(141, "CARMEN CECILIA SOTO MONTERO", "09:00"));
  const supa3 = supaFalso();
  const r3 = await sincronizarUnaVez({ pool: poolFalso(datos), db: dbFalso, supa: supa3, bodegaId: "B", estado, now: NOW });
  assert.equal(r3.cambiadas, 1);
  const filas = supa3.upserts.find((u) => u.tabla === "ops3d_personal_dia").filas;
  assert.equal(filas[0].id_employee, "141");
  assert.equal(filas[0].salida, "2026-11-05T09:00:00-06:00");
  assert.equal(supa3.rpcs.length, 1);
});

test("sync: si Supabase falla, lanza el error y la siguiente vuelta reintenta lo mismo", async () => {
  const datos = { marcas: [marca(56, "STEVEN ALFREDO MARIN VALERIO", "05:47")], horarios: [], marcasHasta: null };
  const estado = { fecha: null, enviado: new Map(), resolver: null, configAt: 0 };
  const caido = supaFalso();
  caido.fallarUpsert = true;
  await assert.rejects(
    sincronizarUnaVez({ pool: poolFalso(datos), db: dbFalso, supa: caido, bodegaId: "B", estado, now: NOW }),
    /Supabase caído/
  );
  assert.equal(caido.rpcs.length, 0);

  const ok = supaFalso();
  const r = await sincronizarUnaVez({ pool: poolFalso(datos), db: dbFalso, supa: ok, bodegaId: "B", estado, now: NOW });
  assert.equal(r.cambiadas, 1, "lo que falló se vuelve a enviar");
});

test("sync: al cambiar de día se reinicia lo enviado", async () => {
  const datos = { marcas: [marca(56, "STEVEN ALFREDO MARIN VALERIO", "05:47")], horarios: [], marcasHasta: null };
  const estado = { fecha: null, enviado: new Map(), resolver: null, configAt: 0 };
  await sincronizarUnaVez({ pool: poolFalso(datos), db: dbFalso, supa: supaFalso(), bodegaId: "B", estado, now: NOW });
  const r = await sincronizarUnaVez({
    pool: poolFalso({ ...datos, marcas: [] }),
    db: dbFalso,
    supa: supaFalso(),
    bodegaId: "B",
    estado,
    now: new Date("2026-11-06T12:00:00Z"),
  });
  assert.equal(r.fecha, "2026-11-06");
  assert.equal(estado.enviado.size, 0);
});

test("cliente Supabase: upsert con merge-duplicates y llave nueva solo en apikey", async () => {
  const llamadas = [];
  const fetchFalso = async (url, init) => {
    llamadas.push({ url, init });
    return { ok: true, text: async () => "" };
  };
  const s = crearSupabase("https://x.supabase.co/", "sb_secret_abc", fetchFalso);
  await s.upsert("ops3d_personal_dia", "fecha,id_employee", [{ a: 1 }]);
  assert.equal(llamadas[0].url, "https://x.supabase.co/rest/v1/ops3d_personal_dia?on_conflict=fecha,id_employee");
  assert.equal(llamadas[0].init.headers.Prefer, "resolution=merge-duplicates,return=minimal");
  assert.equal(llamadas[0].init.headers.apikey, "sb_secret_abc");
  assert.equal(llamadas[0].init.headers.Authorization, undefined);

  const s2 = crearSupabase("https://x.supabase.co", "eyJhbGci.x.y", async () => ({ ok: false, status: 401, text: async () => "no" }));
  await assert.rejects(s2.rpc("ops3d_notify_personal", {}), /401/);
});

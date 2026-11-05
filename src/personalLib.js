// Personal en sitio (BIT2) para el Proceso 3D de SRO — lógica pura, sin red.
// La usa src/ops3dPersonalSync.js y se prueba con `npm test` (node:test).
//
// Reglas acordadas (05/11/2026):
//   - Escala: gerente si el nombre coincide con una entrada "Gerente" de
//     appConfig/overtimeCoordinatorEmails; coordinador si coincide con una entrada
//     "Coordinador" o su puesto dice COORDINADOR (o COORINADOR, error de dedo en
//     BIT2); si no, colaborador. Los nombres se comparan por palabras, sin orden ni
//     tildes: todas las palabras del nombre de la config deben estar en el del
//     empleado ("GREGORIO POVEDA LOPEZ" ⊆ "GREGORIO GERARDO LOPEZ POVEDA").
//   - Marcas: se ignora la que llega a 2 min o menos de la anterior conservada.
//   - Horas: GLogs guarda hora local de Costa Rica sin zona; CR no tiene horario de
//     verano, así que se escribe con desfase fijo -06:00.
//   - Nunca se usa codeEmployee (es la cédula).

const CR_OFFSET = "-06:00";
const CR_OFFSET_MS = -6 * 3600 * 1000;
const DOBLE_MS = 2 * 60 * 1000;
const SIN_COORDINADOR = "Sin coordinador";
const SIN_GERENTE = "Sin gerente";
/** Grupos de BIT2 que no son un coordinador. */
const GRUPOS_SIN_COORDINADOR = new Set(["GRUPO GENERAL", "INACTIVO"]);
const PUESTO_COORDINADOR = /COORDINADOR|COORINADOR/;

/** Quita espacios repetidos y de los extremos. */
function limpiar(s) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t || null;
}

/** Palabras de un nombre en mayúsculas, sin tildes ni signos. */
function palabras(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Clave del nombre: mismas palabras en cualquier orden. */
function claveNombre(s) {
  return palabras(s).sort().join(" ");
}

/** ¿Todas las palabras de `corto` (2 o más) están en `largo`? */
function contenido(corto, largo) {
  const a = palabras(corto);
  if (a.length < 2) return false;
  const b = new Set(palabras(largo));
  return a.every((t) => b.has(t));
}

/** Fecha de hoy (YYYY-MM-DD) en Costa Rica. */
function hoyCR(now = new Date()) {
  return new Date(now.getTime() + CR_OFFSET_MS).toISOString().slice(0, 10);
}

/** "2026-11-05T06:57:00" (hora local CR de SQL) → "2026-11-05T06:57:00-06:00". */
function localCRaIso(local) {
  const s = String(local ?? "").slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return null;
  return s + CR_OFFSET;
}

/** "06:00 -> 16:30" o "05:00 <-> 23:30" → { entrada: "06:00", salida: "16:30" }. */
function parseHorario(inOutStr) {
  const m = String(inOutStr ?? "").match(/(\d{2}:\d{2})\D+(\d{2}:\d{2})/);
  return m ? { entrada: m[1], salida: m[2] } : { entrada: null, salida: null };
}

/** Ordena las marcas y quita las que llegan a ≤ 2 min de la anterior conservada. */
function sinDobles(marcas) {
  const orden = [...marcas].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const out = [];
  for (const m of orden) {
    const prev = out[out.length - 1];
    if (prev && Date.parse(m.ts) - Date.parse(prev.ts) <= DOBLE_MS) continue;
    out.push(m);
  }
  return out;
}

/**
 * Prepara la resolución de escala con la config que ya existe en Firestore:
 *   coordinators: appConfig/overtimeCoordinatorEmails.coordinators[] ({ name, role })
 *   relations:    overtimeConfig/managerRelations.relations[] ({ coordinatorName, managerName })
 *   empleados:    empleados activos de BIT2 ({ nombre, nameGroup }) — respaldo: si un
 *                 coordinador no está en managerRelations, su gerente es el grupo de
 *                 BIT2 en el que está él (los coordinadores están en el de su gerente).
 */
function crearResolutor(coordinators = [], relations = [], empleados = []) {
  const entradas = coordinators
    .map((c) => ({ nombre: limpiar(c?.name), rol: String(c?.role ?? "") }))
    .filter((c) => c.nombre && !GRUPOS_SIN_COORDINADOR.has(c.nombre.toUpperCase()));
  const porClave = new Map(entradas.map((e) => [claveNombre(e.nombre), e]));
  const gerenteDe = new Map(
    relations
      .filter((r) => r?.coordinatorName && r?.managerName)
      .map((r) => [claveNombre(r.coordinatorName), limpiar(r.managerName)])
  );
  const buscar = (nombre, rol) => entradas.find((e) => e.rol === rol && contenido(e.nombre, nombre)) ?? null;

  /** Coordinador o gerente que corresponde a un grupo de BIT2 (nameGroup). */
  const grupo = (nameGroup) => {
    const n = limpiar(nameGroup);
    if (!n || GRUPOS_SIN_COORDINADOR.has(n.toUpperCase())) return null;
    return porClave.get(claveNombre(n)) ?? { nombre: n, rol: "" };
  };

  /** Gerente de un coordinador: managerRelations, o el grupo de BIT2 del coordinador si es un gerente. */
  const gerenteDeCoordinador = (nombreCoord, nameGroupPropio) => {
    const rel = gerenteDe.get(claveNombre(nombreCoord));
    if (rel) return rel;
    const gruposPosibles = nameGroupPropio !== undefined
      ? [nameGroupPropio]
      : empleados.filter((e) => contenido(nombreCoord, e.nombre)).map((e) => e.nameGroup);
    for (const ng of gruposPosibles) {
      const g = grupo(ng);
      if (g?.rol === "Gerente") return g.nombre;
    }
    return null;
  };

  /**
   * { nombre, puesto, nameGroup } → { escala, coordinador, gerente }.
   * coordinador y gerente siempre son texto (para agrupar).
   */
  return function resolver({ nombre, puesto, nameGroup }) {
    const ger = buscar(nombre, "Gerente");
    if (ger) return { escala: "gerente", coordinador: SIN_COORDINADOR, gerente: ger.nombre };

    const g = grupo(nameGroup);
    const coord = buscar(nombre, "Coordinador");
    if (coord || PUESTO_COORDINADOR.test(String(puesto ?? "").toUpperCase())) {
      // Un coordinador está en el grupo de su gerente.
      const propio = coord?.nombre ?? limpiar(nombre);
      const gerente = gerenteDeCoordinador(propio, nameGroup ?? null) ?? SIN_GERENTE;
      return { escala: "coordinador", coordinador: propio, gerente };
    }

    if (g?.rol === "Gerente") return { escala: "colaborador", coordinador: SIN_COORDINADOR, gerente: g.nombre };
    const coordinador = g?.nombre ?? SIN_COORDINADOR;
    const gerente = (g && gerenteDeCoordinador(g.nombre)) ?? SIN_GERENTE;
    return { escala: "colaborador", coordinador, gerente };
  };
}

/**
 * Filas de ops3d_personal_dia a partir de las marcas del día.
 *   marcas:   [{ idEmployee, fullName, puesto, departamento, nameGroup, ts: "YYYY-MM-DDTHH:MM:SS", machineNo }]
 *             (ts en hora local CR, como viene de SQL)
 *   horarios: Map idEmployee → InOutStr del horario del día
 */
function construirFilas({ fecha, bodegaId, marcas, horarios = new Map(), resolver }) {
  const porEmpleado = new Map();
  for (const m of marcas) {
    const iso = localCRaIso(m.ts);
    if (!iso || m.idEmployee == null) continue;
    const id = String(m.idEmployee);
    if (!porEmpleado.has(id)) porEmpleado.set(id, { base: m, marcas: [] });
    porEmpleado.get(id).marcas.push({ ts: iso, machineNo: m.machineNo });
  }

  const filas = [];
  for (const [id, { base, marcas: crudas }] of porEmpleado) {
    const lista = sinDobles(crudas);
    const nombre = limpiar(base.fullName) ?? `Empleado ${id}`;
    const puesto = limpiar(base.puesto);
    const { escala, coordinador, gerente } = resolver({ nombre, puesto, nameGroup: base.nameGroup });
    const h = parseHorario(horarios.get(id) ?? horarios.get(Number(id)));
    const par = lista.length % 2 === 0;
    filas.push({
      fecha,
      id_employee: id,
      nombre,
      puesto,
      departamento: limpiar(base.departamento),
      escala,
      coordinador,
      gerente,
      entrada: lista[0]?.ts ?? null,
      // Con un número par de marcas la última es una salida (o una pausa: eso lo
      // decide ops-3d-snapshot con el horario y la hora actual).
      salida: par && lista.length ? lista[lista.length - 1].ts : null,
      marcas: lista.map((x) => x.ts),
      horario_entrada: h.entrada,
      horario_salida: h.salida,
      machine_no: lista.length ? lista[lista.length - 1].machineNo ?? null : null,
      bodega_id: bodegaId,
    });
  }
  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Huella de una fila para saber si cambió desde la última vuelta. */
function huella(fila) {
  return JSON.stringify(fila);
}

module.exports = {
  CR_OFFSET,
  SIN_COORDINADOR,
  SIN_GERENTE,
  claveNombre,
  construirFilas,
  contenido,
  crearResolutor,
  hoyCR,
  huella,
  localCRaIso,
  parseHorario,
  sinDobles,
};

// Pruebas de src/personalLib.js — `npm test` (node:test, sin red).
// Los casos de escala son reales: marcas de BIT2 del 05/11/2026 y la config de
// Horas Extra de Firestore de ese día (solo nombres, puestos y grupos; sin cédulas).

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SIN_COORDINADOR,
  SIN_GERENTE,
  construirFilas,
  crearResolutor,
  hoyCR,
  localCRaIso,
  parseHorario,
  sinDobles,
} = require("../src/personalLib");

const C = (name, role) => ({ name, role });
const COORDINATORS = [
  C("ALLAN SOTO VIQUEZ", "Coordinador"),
  C("ANTONIO CUEVILLA LONGAN", "Coordinador"),
  C("ARGUELLO UGALDE FELIPE", "Gerente"),
  C("ASAEL RODRIGUEZ MUÑOZ", "Coordinador"),
  C("CARLOS CRUZ GUTIERREZ", "Gerente"),
  C("DAVID MORALES AGUILAR", "Coordinador"),
  C("EDWIN JESUS CARDENAS SAENZ", "Coordinador"),
  C("GILBERT NUÑEZ PICHARDO", "Coordinador"),
  C("GREGORIO POVEDA LOPEZ", "Coordinador"),
  C("GUSTAVO MORALES SOLANO", "Coordinador"),
  C("INACTIVO", "Coordinador"),
  C("JANIS BONILLA PICADO", "Coordinador"),
  C("JORGE ARAYA SANCHO", "Coordinador"),
  C("JORGE CASTRO SOTO", "Gerente"),
  C("JUAN CARLOS ARCE MARTINEZ", "Coordinador"),
  C("JURGEN MATARRITA VILLEGAS", "Coordinador"),
  C("KEILYN ALFARO QUIROS", "Coordinador"),
  C("MAINOR ROJAS HIDALGO", "Coordinador"),
  C("MARY MONTANES YARZA", "Gerente"),
  C("NATALIA LOPEZ SALAZAR", "Coordinador"),
  C("ORLANDO HIDALGO ROJAS", "Coordinador"),
  C("RICARDO PEREZ ARAYA", "Gerente"),
  C("RUDY CUBERO ACOSTA", "Coordinador"),
  C("YENDRY QUIEL VARGAS", "Coordinador"),
  C("YONATHAN CAMPOS JIMENEZ", "Coordinador"),
];
const R = (coordinatorName, managerName) => ({ coordinatorName, managerName });
const RELATIONS = [
  R("ANTONIO CUEVILLA LONGAN", "CARLOS CRUZ GUTIERREZ"),
  R("ASAEL RODRIGUEZ MUÑOZ", "RICARDO PEREZ ARAYA"),
  R("DAVID MORALES AGUILAR", "ARGUELLO UGALDE FELIPE"),
  R("EDWIN JESUS CARDENAS SAENZ", "RICARDO PEREZ ARAYA"),
  R("GILBERT NUÑEZ PICHARDO", "ARGUELLO UGALDE FELIPE"),
  R("GREGORIO POVEDA LOPEZ", "ARGUELLO UGALDE FELIPE"),
  R("JANIS BONILLA PICADO", "RICARDO PEREZ ARAYA"),
  R("JUAN CARLOS ARCE MARTINEZ", "JORGE CASTRO SOTO"),
  R("JURGEN MATARRITA VILLEGAS", "RICARDO PEREZ ARAYA"),
  R("MAINOR ROJAS HIDALGO", "MARY MONTANES YARZA"),
  R("NATALIA LOPEZ SALAZAR", "RICARDO PEREZ ARAYA"),
  R("RUDY CUBERO ACOSTA", "MARY MONTANES YARZA"),
  R("YENDRY QUIEL VARGAS", "RICARDO PEREZ ARAYA"),
];
const resolver = crearResolutor(COORDINATORS, RELATIONS);

test("escala: los 6 coordinadores que marcaron el 05/11", () => {
  const casos = [
    ["GREGORIO GERARDO LOPEZ POVEDA", "COORDINADOR EN FORMACION", "ARGUELLO UGALDE FELIPE", "GREGORIO POVEDA LOPEZ", "ARGUELLO UGALDE FELIPE"],
    ["ABNER ASAEL RODRIGUEZ MUÑOZ", "COORDINADOR DE MATERIAL PESADO", "RICARDO PEREZ ARAYA", "ASAEL RODRIGUEZ MUÑOZ", "RICARDO PEREZ ARAYA"],
    ["EDWIN JESUS CARDENAS SAENZ", "COORDINADOR EN FORMACION", "RICARDO PEREZ ARAYA", "EDWIN JESUS CARDENAS SAENZ", "RICARDO PEREZ ARAYA"],
    ["JANIS MARIA BONILLA PICADO", "COORDINADOR EN FORMACION", "RICARDO PEREZ ARAYA", "JANIS BONILLA PICADO", "RICARDO PEREZ ARAYA"],
    ["JURGEN MATARRITA VILLEGAS", "COORDINADOR EN FORMACION", "RICARDO PEREZ ARAYA", "JURGEN MATARRITA VILLEGAS", "RICARDO PEREZ ARAYA"],
    ["NATALIA DEL CARMEN LOPEZ SALAZAR", "COORDINADOR EN FORMACION", "RICARDO PEREZ ARAYA", "NATALIA LOPEZ SALAZAR", "RICARDO PEREZ ARAYA"],
  ];
  for (const [nombre, puesto, nameGroup, coordinador, gerente] of casos) {
    assert.deepEqual(resolver({ nombre, puesto, nameGroup }), { escala: "coordinador", coordinador, gerente }, nombre);
  }
});

test("escala: colaboradores toman coordinador del grupo y gerente de managerRelations", () => {
  const casos = [
    ["JUSTIN RANZETH VEGA MONTERO", "ASISTENTE DE LOGISTICA", "EDWIN JESUS CARDENAS SAENZ ", "EDWIN JESUS CARDENAS SAENZ", "RICARDO PEREZ ARAYA"],
    ["CARLOS ANTONIO MOLINA GRANADOS", "MONTACARGUISTA", "GILBERT NUÑEZ PICHARDO", "GILBERT NUÑEZ PICHARDO", "ARGUELLO UGALDE FELIPE"],
    ["DANIEL LOPEZ MORA", "ASISTENTE DE LOGISTICA", "GREGORIO POVEDA LOPEZ", "GREGORIO POVEDA LOPEZ", "ARGUELLO UGALDE FELIPE"],
    ["ARLEN ISAAC SIEZAR GUTIERREZ", "ASESOR DE INVENTARIO", "JUAN CARLOS ARCE MARTINEZ", "JUAN CARLOS ARCE MARTINEZ", "JORGE CASTRO SOTO"],
    ["CESAR JUSTIN ARGUETA ROBLES", "ASESOR DE SEGURIDAD", "MAINOR ROJAS HIDALGO", "MAINOR ROJAS HIDALGO", "MARY MONTANES YARZA"],
    ["HENRY ZAMORA CESPEDES", "ASESOR DE MANTENIMIENTO", "RUDY CUBERO ACOSTA", "RUDY CUBERO ACOSTA", "MARY MONTANES YARZA"],
    ["STEVEN ALFREDO MARIN VALERIO", "ASISTENTE DE LOGISTICA", "YENDRY QUIEL VARGAS", "YENDRY QUIEL VARGAS", "RICARDO PEREZ ARAYA"],
  ];
  for (const [nombre, puesto, nameGroup, coordinador, gerente] of casos) {
    assert.deepEqual(resolver({ nombre, puesto, nameGroup }), { escala: "colaborador", coordinador, gerente }, nombre);
  }
});

test("escala: puesto con el error de dedo COORINADOR y coordinador sin relación", () => {
  // Yendry: puesto "COORINADOR DE ALISTO" y está en la config.
  assert.deepEqual(resolver({ nombre: "YENDRY QUIEL VARGAS", puesto: "COORINADOR DE ALISTO", nameGroup: "RICARDO PEREZ ARAYA" }), {
    escala: "coordinador",
    coordinador: "YENDRY QUIEL VARGAS",
    gerente: "RICARDO PEREZ ARAYA",
  });
  // Solo por puesto, sin entrada en la config: el gerente sale de su grupo.
  assert.deepEqual(resolver({ nombre: "PERSONA NUEVA PRUEBA", puesto: "COORINADOR DE ALISTO", nameGroup: "RICARDO PEREZ ARAYA" }), {
    escala: "coordinador",
    coordinador: "PERSONA NUEVA PRUEBA",
    gerente: "RICARDO PEREZ ARAYA",
  });
  // Yonathan está en la config pero no en managerRelations: gerente por su grupo.
  assert.equal(resolver({ nombre: "YONATHAN MAURICIO CAMPOS JIMENEZ", puesto: "COORDINADOR EN FORMACION", nameGroup: "RICARDO PEREZ ARAYA" }).gerente, "RICARDO PEREZ ARAYA");
});

test("escala: coordinador sin managerRelations → gerente por su grupo en BIT2 (caso Yonathan, 05/11)", () => {
  const empleados = [
    { nombre: "YONATHAN MAURICIO CAMPOS JIMENEZ", nameGroup: "RICARDO PEREZ ARAYA" },
    { nombre: "AXEL ANDRES VARELA SIBAJA", nameGroup: "YONATHAN CAMPOS JIMENEZ" },
  ];
  const r = crearResolutor(COORDINATORS, RELATIONS, empleados);
  assert.deepEqual(r({ nombre: "AXEL ANDRES VARELA SIBAJA", puesto: "ASISTENTE DE LOGISTICA", nameGroup: "YONATHAN CAMPOS JIMENEZ" }), {
    escala: "colaborador",
    coordinador: "YONATHAN CAMPOS JIMENEZ",
    gerente: "RICARDO PEREZ ARAYA",
  });
  // Sin la lista de empleados no hay de dónde sacarlo.
  assert.equal(resolver({ nombre: "AXEL ANDRES VARELA SIBAJA", puesto: "X", nameGroup: "YONATHAN CAMPOS JIMENEZ" }).gerente, SIN_GERENTE);
  // managerRelations manda sobre el grupo de BIT2.
  const r2 = crearResolutor(COORDINATORS, RELATIONS, [{ nombre: "GILBERT ENRIQUE NUÑEZ PICHARDO", nameGroup: "MARY MONTANES YARZA" }]);
  assert.equal(r2({ nombre: "X Y", puesto: "Z", nameGroup: "GILBERT NUÑEZ PICHARDO" }).gerente, "ARGUELLO UGALDE FELIPE");
});

test("escala: gerente y casos sin resolver siempre devuelven texto", () => {
  assert.deepEqual(resolver({ nombre: "RICARDO ANDRES PEREZ ARAYA", puesto: "GERENTE DE LOGISTICA DE SALIDA", nameGroup: "CARLOS CRUZ GUTIERREZ" }), {
    escala: "gerente",
    coordinador: SIN_COORDINADOR,
    gerente: "RICARDO PEREZ ARAYA",
  });
  assert.deepEqual(resolver({ nombre: "ALGUIEN SIN GRUPO", puesto: "APILADORISTA", nameGroup: null }), {
    escala: "colaborador",
    coordinador: SIN_COORDINADOR,
    gerente: SIN_GERENTE,
  });
  assert.deepEqual(resolver({ nombre: "ALGUIEN GENERAL", puesto: "APILADORISTA", nameGroup: "Grupo general" }), {
    escala: "colaborador",
    coordinador: SIN_COORDINADOR,
    gerente: SIN_GERENTE,
  });
  // Grupo que no está en la config: se usa el nombre del grupo, sin gerente.
  assert.deepEqual(resolver({ nombre: "OTRA PERSONA", puesto: "CONDUCTOR", nameGroup: "GRUPO NUEVO DE PRUEBA" }), {
    escala: "colaborador",
    coordinador: "GRUPO NUEVO DE PRUEBA",
    gerente: SIN_GERENTE,
  });
  // Colaborador directo de un gerente.
  assert.deepEqual(resolver({ nombre: "ASISTENTE DIRECTO", puesto: "ASISTENTE", nameGroup: "MARY MONTANES YARZA" }), {
    escala: "colaborador",
    coordinador: SIN_COORDINADOR,
    gerente: "MARY MONTANES YARZA",
  });
});

test("horas: CR sin zona → ISO -06:00 y día en curso en CR", () => {
  assert.equal(localCRaIso("2026-11-05T06:57:00"), "2026-11-05T06:57:00-06:00");
  assert.equal(localCRaIso("basura"), null);
  // 05:30 UTC del 6 = 23:30 del 5 en CR.
  assert.equal(hoyCR(new Date("2026-11-06T05:30:00Z")), "2026-11-05");
  assert.equal(hoyCR(new Date("2026-11-06T06:00:00Z")), "2026-11-06");
});

test("horario: InOutStr de view_schedules", () => {
  assert.deepEqual(parseHorario("06:00 -> 16:30"), { entrada: "06:00", salida: "16:30" });
  assert.deepEqual(parseHorario("05:00 <-> 23:30"), { entrada: "05:00", salida: "23:30" });
  assert.deepEqual(parseHorario(""), { entrada: null, salida: null });
});

test("marcas dobles: se ignora la que llega a ≤ 2 min de la anterior", () => {
  const m = (t) => ({ ts: `2026-11-05T${t}:00-06:00` });
  // Caso real (05/11): 04:56, 08:59, 09:00 → la de 09:00 es doble.
  assert.deepEqual(sinDobles([m("08:59"), m("04:56"), m("09:00")]).map((x) => x.ts.slice(11, 16)), ["04:56", "08:59"]);
  // Exactamente 2 min también es doble; 2:01 no.
  assert.equal(sinDobles([{ ts: "2026-11-05T07:00:00-06:00" }, { ts: "2026-11-05T07:02:00-06:00" }]).length, 1);
  assert.equal(sinDobles([{ ts: "2026-11-05T07:00:00-06:00" }, { ts: "2026-11-05T07:02:01-06:00" }]).length, 2);
});

test("filas: entrada, salida solo con marcas pares, horario y sin cédula", () => {
  const base = { puesto: "ASESOR DE INVENTARIO", departamento: "CEDI", nameGroup: "JUAN CARLOS ARCE MARTINEZ", machineNo: 1 };
  const marcas = [
    // impar → sigue en sitio: salida null
    { ...base, idEmployee: 197, fullName: "JUAN PABLO  ARREDONDO ARCE", ts: "2026-11-05T07:06:00" },
    { ...base, idEmployee: 197, fullName: "JUAN PABLO  ARREDONDO ARCE", ts: "2026-11-05T08:03:00" },
    { ...base, idEmployee: 197, fullName: "JUAN PABLO  ARREDONDO ARCE", ts: "2026-11-05T08:36:00" },
    // par → salida = última marca
    { ...base, idEmployee: 221, fullName: "DEREK BUSTOS RODRIGUEZ", ts: "2026-11-05T05:15:00" },
    { ...base, idEmployee: 221, fullName: "DEREK BUSTOS RODRIGUEZ", ts: "2026-11-05T07:42:00" },
  ];
  const horarios = new Map([["197", "07:00 -> 17:30"]]);
  const filas = construirFilas({ fecha: "2026-11-05", bodegaId: "CR-OLO-CLIRO", marcas, horarios, resolver });
  assert.equal(filas.length, 2);
  const [derek, juan] = filas;
  assert.equal(juan.nombre, "JUAN PABLO ARREDONDO ARCE");
  assert.equal(juan.entrada, "2026-11-05T07:06:00-06:00");
  assert.equal(juan.salida, null);
  assert.equal(juan.marcas.length, 3);
  assert.equal(juan.horario_entrada, "07:00");
  assert.equal(juan.horario_salida, "17:30");
  assert.equal(juan.coordinador, "JUAN CARLOS ARCE MARTINEZ");
  assert.equal(juan.gerente, "JORGE CASTRO SOTO");
  assert.equal(juan.machine_no, 1);
  assert.equal(derek.salida, "2026-11-05T07:42:00-06:00");
  assert.equal(derek.horario_entrada, null);
  for (const f of filas) {
    assert.ok(!("codeEmployee" in f) && !("cedula" in f), "nunca la cédula");
    assert.deepEqual(Object.keys(f).sort(), [
      "bodega_id", "coordinador", "departamento", "entrada", "escala", "fecha", "gerente", "horario_entrada",
      "horario_salida", "id_employee", "machine_no", "marcas", "nombre", "puesto", "salida",
    ]);
  }
});

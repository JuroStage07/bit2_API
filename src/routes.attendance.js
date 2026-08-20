const express = require("express");
const { requireAuth, requireRole } = require("./auth");
const { getSqlPool, sql } = require("./sql");

const router = express.Router();

router.use(requireAuth);

/** Devuelve la fecha local de hoy como YYYY-MM-DD. */
function todayStr() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Extrae expectedIn/expectedOut desde el string "HH:MM - HH:MM". */
function parseRange(scheduleRange) {
  let expectedIn = null;
  let expectedOut = null;
  if (scheduleRange) {
    const match = String(scheduleRange).match(/(\d{2}:\d{2}).*(\d{2}:\d{2})/);
    if (match) {
      expectedIn = match[1];
      expectedOut = match[2];
    }
  }
  return { expectedIn, expectedOut };
}

/** Normaliza una fila (venga de la vista o de GLogs) al shape del front. */
function toRecord(row) {
  const scheduleRange = row.scheduleRange || null;
  const { expectedIn, expectedOut } = parseRange(scheduleRange);

  const date = row._date ? new Date(row._date).toISOString().slice(0, 10) : null;
  const dayOfWeek = row._date ? new Date(row._date).getUTCDay() : null;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return {
    attendanceId: row.attendanceId != null ? row.attendanceId : `emp-${row.idEmployee}`,
    idEmployee: row.idEmployee,
    fullName: row.fullName ? String(row.fullName).trim() : null,
    codeEmployee: row.codeEmployee,
    date,
    startEnroll: row.startEnroll ? new Date(row.startEnroll).toISOString() : null,
    endEnroll: row.endEnroll ? new Date(row.endEnroll).toISOString() : null,
    idSchedule: row.idSchedule || null,
    codeSchedule: row.codeSchedule || null,
    scheduleName: row.scheduleName || null,
    scheduleRange,
    expectedIn,
    expectedOut,
    groupId: row.idGroup ? Number(row.idGroup) : null,
    coordinatorName: row.nameGroup || null,
    isWeekend,
  };
}

/**
 * Marcas del DÍA EN CURSO leídas de dbo.GLogs (fichadas crudas del reloj),
 * consolidando por empleado: entrada = MIN(_datetime), salida = MAX(_datetime).
 * Solo hay salida si hubo más de una fichada.
 */
async function getLiveMarks(pool, dateFilter) {
  const result = await pool
    .request()
    .input("dateStart", sql.VarChar(10), dateFilter)
    .query(`
      ;WITH punches AS (
        SELECT
          e.id                                   AS idEmployee,
          e.code                                 AS codeEmployee,
          LTRIM(RTRIM(e.name + ' ' + e.lastName)) AS fullName,
          e.idGroup                              AS idGroup,
          MIN(g._datetime)                       AS startEnroll,
          MAX(g._datetime)                       AS endEnroll,
          COUNT(*)                               AS punchCount
        FROM dbo.GLogs g
        INNER JOIN dbo.employees e
          ON CAST(e.IdDevice AS varchar(20)) = CAST(g.enrollNo AS varchar(20))
        WHERE CAST(g._datetime AS date) = CAST(@dateStart AS date)
        GROUP BY e.id, e.code, e.name, e.lastName, e.idGroup
      )
      SELECT
        p.idEmployee,
        p.codeEmployee,
        p.fullName,
        CAST(@dateStart AS date)                              AS _date,
        p.startEnroll,
        CASE WHEN p.punchCount > 1 THEN p.endEnroll END       AS endEnroll,
        p.idGroup,
        eg.name                                               AS nameGroup,
        ce.idSchedule                                         AS idSchedule,
        s.code                                                AS codeSchedule,
        s.name                                                AS scheduleName,
        s.InOutStr                                            AS scheduleRange
      FROM punches p
      LEFT JOIN dbo.employeesGroups eg ON eg.id = p.idGroup
      LEFT JOIN dbo.calendarEmployees ce
        ON ce.idEmployee = p.idEmployee
       AND CAST(ce._date AS date) = CAST(@dateStart AS date)
      LEFT JOIN dbo.view_schedules s ON s.id = ce.idSchedule
      ORDER BY p.fullName
    `);
  return result.recordset;
}

/**
 * Marcas de un día CONSOLIDADO desde dbo.view_calculatedAttendance.
 * Una fila por empleado (la entrada real = primera marca).
 */
async function getConsolidatedMarks(pool, dateFilter) {
  const result = await pool
    .request()
    .input("dateStart", sql.VarChar(10), dateFilter)
    .query(`
      SELECT
        sub.attendanceId,
        sub.idEmployee,
        sub.fullName,
        sub.codeEmployee,
        sub._date,
        sub.startEnroll,
        sub.endEnroll,
        sub.idSchedule,
        sub.codeSchedule,
        s.name AS scheduleName,
        s.InOutStr AS scheduleRange,
        sub.idGroup,
        sub.nameGroup
      FROM (
        SELECT
          a.id AS attendanceId,
          a.idEmployee,
          a.fullName,
          a.codeEmployee,
          a._date,
          a.startEnroll,
          a.endEnroll,
          a.idSchedule,
          a.codeSchedule,
          a.idGroup,
          a.nameGroup,
          ROW_NUMBER() OVER (PARTITION BY a.idEmployee ORDER BY a.startEnroll ASC) AS rn
        FROM dbo.view_calculatedAttendance a
        WHERE CAST(a._date AS date) = CAST(@dateStart AS date)
          AND a.startEnroll IS NOT NULL
      ) sub
      LEFT JOIN dbo.view_schedules s ON sub.idSchedule = s.id
      WHERE sub.rn = 1
      ORDER BY sub.fullName
    `);
  return result.recordset;
}

/** Busca el último día con marcas en la vista consolidada (para el fallback). */
async function getLastConsolidatedDate(pool) {
  const r = await pool.request().query(`
    SELECT TOP 1 CAST(_date AS DATE) AS lastDate
    FROM dbo.view_calculatedAttendance
    WHERE startEnroll IS NOT NULL
    ORDER BY _date DESC
  `);
  return r.recordset.length > 0
    ? r.recordset[0].lastDate.toISOString().slice(0, 10)
    : null;
}

/**
 * GET /attendance/marks?date=YYYY-MM-DD
 *
 * - Día en curso  -> lee de dbo.GLogs (fichadas crudas, casi en tiempo real).
 * - Día pasado    -> lee de dbo.view_calculatedAttendance (consolidado oficial).
 * - Si el día en curso aún no tiene fichadas, cae al último día consolidado.
 *
 * Respuesta: { ok, date, source, fallback, records }
 *   source: "live" (GLogs) | "consolidated" (vista).
 */
router.get(
  "/attendance/marks",
  requireRole("administrativo", "dev"),
  async (req, res) => {
    try {
      const pool = await getSqlPool();

      let dateFilter = req.query.date;
      const dateExplicit = !!(dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter));
      if (!dateExplicit) dateFilter = todayStr();

      const isToday = dateFilter === todayStr();

      // --- Día en curso: intentar GLogs (tiempo real) ---
      if (isToday) {
        const liveRows = await getLiveMarks(pool, dateFilter);
        if (liveRows.length > 0) {
          return res.json({
            ok: true,
            date: dateFilter,
            source: "live",
            fallback: false,
            records: liveRows.map(toRecord),
          });
        }
        // Sin fichadas hoy todavía -> caer al último día consolidado.
        const lastDate = await getLastConsolidatedDate(pool);
        if (lastDate) {
          const rows = await getConsolidatedMarks(pool, lastDate);
          return res.json({
            ok: true,
            date: lastDate,
            source: "consolidated",
            fallback: true,
            records: rows.map(toRecord),
          });
        }
        return res.json({ ok: true, date: dateFilter, source: "live", fallback: false, records: [] });
      }

      // --- Día pasado: vista consolidada (con fallback al último día con datos) ---
      let rows = await getConsolidatedMarks(pool, dateFilter);
      let fallback = false;
      if (rows.length === 0) {
        const lastDate = await getLastConsolidatedDate(pool);
        if (lastDate) {
          dateFilter = lastDate;
          fallback = true;
          rows = await getConsolidatedMarks(pool, dateFilter);
        }
      }

      return res.json({
        ok: true,
        date: dateFilter,
        source: "consolidated",
        fallback,
        records: rows.map(toRecord),
      });
    } catch (err) {
      console.error("GET /attendance/marks:", err);
      res.status(500).json({ ok: false, error: "No se pudieron cargar las marcas." });
    }
  }
);

module.exports = router;

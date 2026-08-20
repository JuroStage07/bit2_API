const express = require("express");
const { requireAuth, requireRole } = require("./auth");
const { getSqlPool } = require("./sql");
const {
  getOvertimeRecords,
  decideOvertimeRecord,
  getOvertimeCoordinators,
  saveCoordinatorEmails,
} = require("./overtimeService");

const router = express.Router();

// Todas las rutas requieren sesión válida (token de Firebase).
router.use(requireAuth);

// GET /overtime -> registros visibles según el role/coordinador del usuario.
router.get(
  "/overtime",
  requireRole("administrativo", "dev"),
  async (req, res) => {
    try {
      const data = await getOvertimeRecords({
        email: req.user.email,
        role: req.user.role,
      });
      res.json(data);
    } catch (err) {
      console.error("GET /overtime:", err);
      res.status(500).json({ ok: false, error: "No se pudieron cargar las horas extra." });
    }
  }
);

// POST /overtime/decide -> aprobar/rechazar.
router.post(
  "/overtime/decide",
  requireRole("administrativo", "dev"),
  async (req, res) => {
    try {
      const { attendanceId, status, note, record } = req.body || {};
      const data = await decideOvertimeRecord({
        attendanceId,
        status,
        note,
        record,
        user: req.user,
      });
      res.json(data);
    } catch (err) {
      console.error("POST /overtime/decide:", err);
      res
        .status(err.status || 500)
        .json({ ok: false, error: err.message || "No se pudo guardar la decisión." });
    }
  }
);

// GET /overtime/coordinators -> lista coordinadores + email (solo dev).
router.get(
  "/overtime/coordinators",
  requireRole("dev"),
  async (req, res) => {
    try {
      const data = await getOvertimeCoordinators();
      res.json(data);
    } catch (err) {
      console.error("GET /overtime/coordinators:", err);
      res.status(500).json({ ok: false, error: "No se pudieron cargar los coordinadores." });
    }
  }
);

// POST /overtime/coordinators -> guarda mapeo email (solo dev).
router.post(
  "/overtime/coordinators",
  requireRole("dev"),
  async (req, res) => {
    try {
      const { coordinators } = req.body || {};
      const data = await saveCoordinatorEmails({ coordinators, user: req.user });
      res.json(data);
    } catch (err) {
      console.error("POST /overtime/coordinators:", err);
      res
        .status(err.status || 500)
        .json({ ok: false, error: err.message || "No se pudo guardar la configuración." });
    }
  }
);

// GET /overtime/users-sync -> empleados distintos desde Bit2.
router.get(
  "/overtime/users-sync",
  requireRole("administrativo", "dev"),
  async (req, res) => {
    try {
      const pool = await getSqlPool();

      const result = await pool.request().query(`
        SELECT
          sub.idEmployee,
          sub.fullName,
          sub.idDevice,
          sub.nameDepartament,
          sub.nameJobPosition,
          sub.idGroup,
          sub.nameGroup,
          sub.codeGroup,
          sub.idSchedule,
          sub.codeSchedule,
          s.name AS scheduleName,
          s.InOutStr AS scheduleRange
        FROM (
          SELECT
            e.idEmployee,
            e.fullName,
            e.idDevice,
            e.nameDepartament,
            e.nameJobPosition,
            e.idGroup,
            e.nameGroup,
            e.codeGroup,
            e.idSchedule,
            e.codeSchedule,
            ROW_NUMBER() OVER (PARTITION BY e.idEmployee ORDER BY e._date DESC) AS rn
          FROM dbo.view_calculatedAttendance e
          WHERE e.idEmployee IS NOT NULL
            AND NULLIF(LTRIM(RTRIM(e.fullName)), '') IS NOT NULL
        ) sub
        LEFT JOIN dbo.view_schedules s ON sub.idSchedule = s.id
        WHERE sub.rn = 1
        ORDER BY sub.fullName
      `);

      res.json({ ok: true, employees: result.recordset });
    } catch (err) {
      console.error("GET /overtime/users-sync:", err);
      res.status(500).json({ ok: false, error: "No se pudieron cargar los empleados." });
    }
  }
);

module.exports = router;

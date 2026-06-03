const express = require("express");
const { requireAuth, requireRole } = require("./auth");
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

module.exports = router;

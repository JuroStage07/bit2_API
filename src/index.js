require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Inicializa firebase-admin al arrancar (falla rápido si falta la clave).
require("./firebaseAdmin");

const overtimeRoutes = require("./routes.overtime");

const app = express();

// CORS: lista blanca de orígenes (frontend en Firebase Hosting + dev local).
const allowedOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Permitir herramientas sin origin (curl, health checks).
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
  })
);

app.use(express.json({ limit: "1mb" }));

// Health check (sin auth) para el túnel / monitoreo.
app.get("/health", (req, res) => res.json({ ok: true, service: "bit2-api" }));

app.use("/", overtimeRoutes);

const PORT = Number(process.env.PORT || 8090);
app.listen(PORT, () => {
  console.log(`bit2-api escuchando en http://127.0.0.1:${PORT}`);
});

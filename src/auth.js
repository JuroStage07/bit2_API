const { firebaseAdmin, db } = require("./firebaseAdmin");

function safe(v) {
  return String(v ?? "").trim();
}

/**
 * Middleware: exige un ID token de Firebase válido en el header
 *   Authorization: Bearer <token>
 *
 * Adjunta a req.user: { uid, email, role }.
 * El role se lee del documento profiles/{uid} en Firestore.
 */
async function requireAuth(req, res, next) {
  try {
    const header = safe(req.headers.authorization);
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ ok: false, error: "Falta token de autenticación." });
    }

    const idToken = match[1];
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);

    let role = "";
    let email = safe(decoded.email).toLowerCase();
    const snap = await db.doc(`profiles/${decoded.uid}`).get();
    if (snap.exists) {
      const p = snap.data() || {};
      role = safe(p.role).toLowerCase();
      if (!email) email = safe(p.email).toLowerCase();
    }

    req.user = { uid: decoded.uid, email, role };
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(401).json({ ok: false, error: "Token inválido o expirado." });
  }
}

/**
 * Middleware factory: exige que el role del usuario esté en la lista permitida.
 * Usar después de requireAuth.
 */
function requireRole(...roles) {
  const allowed = roles.map((r) => String(r).toLowerCase());
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res
        .status(403)
        .json({ ok: false, error: "No tenés permiso para esta acción." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, safe };

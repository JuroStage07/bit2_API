const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

/**
 * Inicializa firebase-admin usando un service account key.
 * La ruta del JSON se toma de GOOGLE_APPLICATION_CREDENTIALS o, por defecto,
 * ./service-account.json en la raíz del proyecto.
 */
function initFirebase() {
  if (admin.apps.length) return admin;

  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, "..", "service-account.json");

  if (!fs.existsSync(credPath)) {
    throw new Error(
      `No se encontró el service account key en "${credPath}". ` +
        `Generá la clave en Firebase Console y colocala ahí, o seteá GOOGLE_APPLICATION_CREDENTIALS.`
    );
  }

  const serviceAccount = JSON.parse(fs.readFileSync(credPath, "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin;
}

const firebaseAdmin = initFirebase();
const db = firebaseAdmin.firestore();
const FieldValue = firebaseAdmin.firestore.FieldValue;

module.exports = { firebaseAdmin, db, FieldValue };

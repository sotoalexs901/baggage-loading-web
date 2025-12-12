const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

async function deleteCollection(path, batchSize = 400) {
  const colRef = db.collection(path);
  while (true) {
    const snap = await colRef.limit(batchSize).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

async function deleteStoragePrefix(prefix) {
  // Borra todos los archivos que empiecen con ese prefijo
  await bucket.deleteFiles({ prefix });
}

exports.deleteFlightCascade = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const flightId = String(data?.flightId || "").trim();
  if (!flightId) throw new functions.https.HttpsError("invalid-argument", "flightId is required.");

  // asumiendo que guardas role en custom claims O en users/{uid}
  // OPCIÓN A: custom claims (ideal)
  const tokenRole = normalizeRole(context.auth.token.role);

  // OPCIÓN B: leer users/{uid} si no usas claims
  let role = tokenRole;
  if (!role) {
    const u = await db.collection("users").doc(context.auth.uid).get();
    role = normalizeRole(u.data()?.role);
  }

  const canDelete = role === "station_manager" || role === "duty_manager";
  if (!canDelete) {
    throw new functions.https.HttpsError("permission-denied", "Only Station/Duty Manager can delete flights.");
  }

  // 1) borrar subcolecciones
  await deleteCollection(`flights/${flightId}/aircraftScans`);
  await deleteCollection(`flights/${flightId}/bagroomScans`);
  await deleteCollection(`flights/${flightId}/allowedBagTags`);
  await deleteCollection(`flights/${flightId}/reports`);

  // 2) borrar storage (reports + manifests)
  await deleteStoragePrefix(`flights/${flightId}/reports/`);
  await deleteStoragePrefix(`flights/${flightId}/manifests/`);

  // 3) borrar flight doc
  await db.collection("flights").doc(flightId).delete();

  // 4) opcional: limpiar índice global bagTags
  // Si tienes muchos, esto puede crecer; pero funciona por batches.
  const tagsQ = await db.collection("bagTags").where("flightId", "==", flightId).limit(400).get();
  while (!tagsQ.empty) {
    const batch = db.batch();
    tagsQ.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    const next = await db.collection("bagTags").where("flightId", "==", flightId).limit(400).get();
    if (next.empty) break;
  }

  return { ok: true };
});

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

/* =========================
   Helpers
========================= */

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

/**
 * Valida que el usuario sea Station Manager o Duty Manager
 * Soporta:
 *  - Custom Claims (context.auth.token.role)
 *  - users/{uid}.role (fallback)
 */
async function requireManager(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }

  let role = normalizeRole(context.auth.token?.role);

  if (!role) {
    const uSnap = await db.collection("users").doc(context.auth.uid).get();
    role = normalizeRole(uSnap.data()?.role);
  }

  if (role !== "station_manager" && role !== "duty_manager") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only Station Manager or Duty Manager allowed."
    );
  }

  return role;
}

/**
 * Borra una colección completa en batches
 */
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

/**
 * Borra archivos de Storage por prefijo
 */
async function deleteStoragePrefix(prefix) {
  try {
    await bucket.deleteFiles({ prefix });
  } catch (e) {
    // best-effort: no bloquea si no hay archivos
    console.warn(`Storage cleanup skipped for ${prefix}`);
  }
}

/* =========================
   DELETE FLIGHT (CASCADE)
========================= */

exports.deleteFlightCascade = functions.https.onCall(async (data, context) => {
  await requireManager(context);

  const flightId = String(data?.flightId || "").trim();
  if (!flightId) {
    throw new functions.https.HttpsError("invalid-argument", "flightId is required.");
  }

  const flightRef = db.collection("flights").doc(flightId);
  const flightSnap = await flightRef.get();

  if (!flightSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Flight not found.");
  }

  // 1) Delete subcollections
  await deleteCollection(`flights/${flightId}/aircraftScans`);
  await deleteCollection(`flights/${flightId}/bagroomScans`);
  await deleteCollection(`flights/${flightId}/allowedBagTags`);
  await deleteCollection(`flights/${flightId}/reports`);

  // 2) Delete Storage files
  await deleteStoragePrefix(`flights/${flightId}/reports/`);
  await deleteStoragePrefix(`flights/${flightId}/manifests/`);

  // 3) Delete global bagTags index
  while (true) {
    const snap = await db
      .collection("bagTags")
      .where("flightId", "==", flightId)
      .limit(400)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // 4) Delete flight document
  await flightRef.delete();

  return { ok: true };
});

/* =========================
   REOPEN FLIGHT
========================= */

exports.reopenFlight = functions.https.onCall(async (data, context) => {
  await requireManager(context);

  const flightId = String(data?.flightId || "").trim();
  if (!flightId) {
    throw new functions.https.HttpsError("invalid-argument", "flightId is required.");
  }

  const ref = db.collection("flights").doc(flightId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "Flight not found.");
  }

  const flight = snap.data() || {};
  const status = String(flight.status || "OPEN").toUpperCase();

  if (status !== "LOADED") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Only LOADED flights can be reopened."
    );
  }

  await ref.set(
    {
      status: "LOADING",
      aircraftLoadingCompleted: false,
      aircraftLoadingCompletedAt: null,
      aircraftLoadingCompletedBy: null,
      aircraftLoadedBags: null,

      reopenedAt: admin.firestore.FieldValue.serverTimestamp(),
      reopenedBy: {
        uid: context.auth.uid,
        name: context.auth.token.name || null,
        username: context.auth.token.username || null,
        role: context.auth.token.role || null,
      },
    },
    { merge: true }
  );

  return { ok: true };
});

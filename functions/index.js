// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ✅ IMPORTANT: Match App Hosting / frontend region
const region = functions.region("us-east4");

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

  // 1) claims
  let role = normalizeRole(context.auth.token?.role);

  // 2) fallback users/{uid}
  if (!role) {
    const uSnap = await db.collection("users").doc(context.auth.uid).get();
    role = normalizeRole(uSnap.data()?.role);
  }

  const can = role === "station_manager" || role === "duty_manager";
  if (!can) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only Station Manager or Duty Manager allowed."
    );
  }

  return role;
}

/**
 * Borra una colección completa en batches.
 * (Para subcolecciones con IDs = bagtag, funciona perfecto.)
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
 * Borra archivos de Storage por prefijo (best-effort)
 */
async function deleteStoragePrefix(prefix) {
  try {
    await bucket.deleteFiles({ prefix });
  } catch (e) {
    // No rompe si no hay archivos o si ya fueron borrados.
    console.warn(`[deleteStoragePrefix] skipped for "${prefix}":`, e?.message || e);
  }
}

/**
 * Borra el índice global bagTags para un flightId (en batches).
 */
async function deleteBagTagsIndexForFlight(flightId, batchSize = 400) {
  while (true) {
    const snap = await db
      .collection("bagTags")
      .where("flightId", "==", flightId)
      .limit(batchSize)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

/* =========================
   DELETE FLIGHT (CASCADE)
========================= */

exports.deleteFlightCascade = region.https.onCall(async (data, context) => {
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

  try {
    // 1) Delete subcollections
    await deleteCollection(`flights/${flightId}/aircraftScans`);
    await deleteCollection(`flights/${flightId}/bagroomScans`);
    await deleteCollection(`flights/${flightId}/allowedBagTags`);
    await deleteCollection(`flights/${flightId}/reports`);

    // 2) Delete Storage files (reports + manifests)
    await deleteStoragePrefix(`flights/${flightId}/reports/`);
    await deleteStoragePrefix(`flights/${flightId}/manifests/`);

    // 3) Delete global bagTags index
    await deleteBagTagsIndexForFlight(flightId);

    // 4) Delete flight document
    await flightRef.delete();

    return { ok: true };
  } catch (e) {
    console.error("[deleteFlightCascade] failed:", e);
    throw new functions.https.HttpsError(
      "internal",
      "Delete cascade failed. Check logs and permissions."
    );
  }
});

/* =========================
   REOPEN FLIGHT
========================= */

exports.reopenFlight = region.https.onCall(async (data, context) => {
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
  const status = String(flight.status || "OPEN").trim().toUpperCase();

  if (status !== "LOADED") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Only LOADED flights can be reopened."
    );
  }

  try {
    await ref.set(
      {
        // Reabrimos a LOADING (para permitir seguir escaneando en aircraft)
        status: "LOADING",

        // Unlock
        aircraftLoadingCompleted: false,
        aircraftLoadingCompletedAt: null,
        aircraftLoadingCompletedBy: null,
        aircraftLoadedBags: null,

        reopenedAt: admin.firestore.FieldValue.serverTimestamp(),
        reopenedBy: {
          uid: context.auth.uid,
          name: context.auth.token?.name || null,
          username: context.auth.token?.username || null,
          role: context.auth.token?.role || null,
        },
      },
      { merge: true }
    );

    return { ok: true };
  } catch (e) {
    console.error("[reopenFlight] failed:", e);
    throw new functions.https.HttpsError(
      "internal",
      "Reopen failed. Check logs and permissions."
    );
  }
});

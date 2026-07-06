// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Match frontend region
const region = functions.region("us-east4");

/* =========================
   Helpers
========================= */

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

async function requireManager(data) {
  const role = normalizeRole(data?.userRole);

  const can =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "duty_managers" ||
    role === "supervisor" ||
    role === "gate_controller";

  if (!can) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "You do not have permission to perform this action."
    );
  }

  return role;
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
  try {
    await bucket.deleteFiles({ prefix });
  } catch (e) {
    console.warn(`[deleteStoragePrefix] skipped for "${prefix}":`, e?.message || e);
  }
}

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
   DELETE FLIGHT CASCADE
========================= */

exports.deleteFlightCascade = region.https.onCall(async (data, context) => {
  await requireManager(data);

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
    await deleteCollection(`flights/${flightId}/aircraftScans`);
    await deleteCollection(`flights/${flightId}/bagroomScans`);
    await deleteCollection(`flights/${flightId}/allowedBagTags`);
    await deleteCollection(`flights/${flightId}/reports`);

    await deleteStoragePrefix(`flights/${flightId}/reports/`);
    await deleteStoragePrefix(`flights/${flightId}/manifests/`);

    await deleteBagTagsIndexForFlight(flightId);

    await flightRef.delete();

    return {
      ok: true,
      deletedFlightId: flightId,
    };
  } catch (e) {
    console.error("[deleteFlightCascade] failed:", e);

    throw new functions.https.HttpsError(
      "internal",
      e?.message || "Delete cascade failed."
    );
  }
});

/* =========================
   REOPEN FLIGHT
========================= */

exports.reopenFlight = region.https.onCall(async (data, context) => {
  await requireManager(data);

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
        status: "LOADING",

        aircraftLoadingCompleted: false,
        aircraftLoadingCompletedAt: null,
        aircraftLoadingCompletedBy: null,
        aircraftLoadedBags: null,

        reopenedAt: admin.firestore.FieldValue.serverTimestamp(),
        reopenedBy: {
          username: data?.username || null,
          role: data?.userRole || null,
        },
      },
      { merge: true }
    );

    return {
      ok: true,
      reopenedFlightId: flightId,
    };
  } catch (e) {
    console.error("[reopenFlight] failed:", e);

    throw new functions.https.HttpsError(
      "internal",
      e?.message || "Reopen failed."
    );
  }
});

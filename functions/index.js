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

async function requireStationManager(data) {
  const role = normalizeRole(data?.userRole);

  if (role !== "station_manager") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only Station Manager can delete a full month."
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
   DELETE MONTH (LOADED FLIGHTS)
========================= */

exports.deleteLoadedFlightsByMonth = region.https.onCall(async (data, context) => {
  await requireStationManager(data);

  const year = Number(data?.year);
  const month = Number(data?.month);

  if (!year || !month || month < 1 || month > 12) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "year and month are required."
    );
  }

  // month = 7  -> "2026-07"
  const monthPrefix =
    `${year}-${String(month).padStart(2, "0")}`;

  try {
    const flightsSnap = await db
      .collection("flights")
      .where("status", "==", "LOADED")
      .get();

    let deletedFlights = 0;

    for (const docSnap of flightsSnap.docs) {

      const flight = docSnap.data();

      const flightDate = String(flight.flightDate || "");

      // Solo vuelos del mes seleccionado
      if (!flightDate.startsWith(monthPrefix)) continue;

      const flightId = docSnap.id;

      console.log(`Deleting ${flight.flightNumber} (${flightId})`);

      await deleteCollection(`flights/${flightId}/aircraftScans`);
      await deleteCollection(`flights/${flightId}/bagroomScans`);
      await deleteCollection(`flights/${flightId}/allowedBagTags`);
      await deleteCollection(`flights/${flightId}/reports`);

      await deleteStoragePrefix(`flights/${flightId}/reports/`);
      await deleteStoragePrefix(`flights/${flightId}/manifests/`);

      await deleteBagTagsIndexForFlight(flightId);

      await docSnap.ref.delete();

      deletedFlights++;
    }

    return {
      ok: true,
      deletedFlights,
      month: monthPrefix,
    };

  } catch (e) {

    console.error("[deleteLoadedFlightsByMonth]", e);

    throw new functions.https.HttpsError(
      "internal",
      e.message || "Unable to delete flights."
    );
  }
});

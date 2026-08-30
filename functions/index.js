// functions/index.js

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const bucket = admin.storage().bucket();
const REGION = "us-east4";

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function buildActor(data) {
  return {
    username: data?.username || null,
    role: data?.userRole || null,
    fullName: data?.employeeFullName || null,
    operationalPosition: data?.operationalPosition || null,
    operationalPositionLabel: data?.operationalPositionLabel || null,
  };
}

function assertManager(data) {
  const role = normalizeRole(data?.userRole);
  const allowed = [
    "station_manager",
    "duty_manager",
    "duty_managers",
    "supervisor",
    "gate_controller",
  ];

  if (!allowed.includes(role)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Your role is not allowed to perform this action."
    );
  }
}

async function deleteCollection(collectionRef, batchSize = 400) {
  let deleted = 0;

  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();

    snapshot.docs.forEach((documentSnapshot) => {
      batch.delete(documentSnapshot.ref);
    });

    await batch.commit();
    deleted += snapshot.size;

    if (snapshot.size < batchSize) {
      break;
    }
  }

  return deleted;
}

async function deleteBagTagAndEvents(tagRef) {
  let deletedEvents = 0;

  try {
    deletedEvents = await deleteCollection(tagRef.collection("events"));
  } catch (error) {
    console.warn("Could not delete bag tag events", tagRef.id, error);
  }

  try {
    await tagRef.delete();
  } catch (error) {
    console.warn("Could not delete bag tag document", tagRef.id, error);
  }

  return deletedEvents;
}

async function deleteGlobalBagTagsForFlight(flightId) {
  const bagTagsRef = db.collection("bagTags");
  const fields = ["flightId", "currentFlightId", "lastFlightId"];
  const refs = new Map();

  for (const field of fields) {
    try {
      const snapshot = await bagTagsRef.where(field, "==", flightId).get();
      snapshot.docs.forEach((documentSnapshot) => {
        refs.set(documentSnapshot.ref.path, documentSnapshot.ref);
      });
    } catch (error) {
      console.warn(`Bag tag query failed for ${field}`, error);
    }
  }

  let deletedBagTags = 0;
  let deletedBagTagEvents = 0;

  for (const tagRef of refs.values()) {
    deletedBagTagEvents += await deleteBagTagAndEvents(tagRef);
    deletedBagTags += 1;
  }

  return {
    deletedBagTags,
    deletedBagTagEvents,
  };
}

async function deleteStorageFilesForFlight(flightId) {
  const prefixes = [
    `flights/${flightId}/`,
    `flightReports/${flightId}/`,
    `reports/${flightId}/`,
  ];

  let deletedStorageFiles = 0;

  for (const prefix of prefixes) {
    try {
      const [files] = await bucket.getFiles({ prefix });

      for (const file of files) {
        try {
          await file.delete({ ignoreNotFound: true });
          deletedStorageFiles += 1;
        } catch (error) {
          console.warn("Could not delete storage file", file.name, error);
        }
      }
    } catch (error) {
      console.warn("Could not list storage prefix", prefix, error);
    }
  }

  return deletedStorageFiles;
}

async function deleteFlightData(flightId) {
  const flightRef = db.collection("flights").doc(flightId);
  const flightSnapshot = await flightRef.get();

  if (!flightSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Flight was not found.");
  }

  const flightData = flightSnapshot.data() || {};
  const subcollections = [
    "counterScans",
    "bagroomScans",
    "aircraftScans",
    "gateBagScans",
    "manifest",
    "manifestTags",
    "reports",
  ];

  const deletedSubcollections = {};

  for (const name of subcollections) {
    deletedSubcollections[name] = await deleteCollection(
      flightRef.collection(name)
    );
  }

  const bagTagCleanup = await deleteGlobalBagTagsForFlight(flightId);
  const deletedStorageFiles = await deleteStorageFilesForFlight(flightId);

  await flightRef.delete();

  return {
    flightId,
    flightNumber: flightData.flightNumber || null,
    flightDate: flightData.flightDate || null,
    deletedSubcollections,
    deletedBagTags: bagTagCleanup.deletedBagTags,
    deletedBagTagEvents: bagTagCleanup.deletedBagTagEvents,
    deletedStorageFiles,
  };
}

exports.blcsFunctionHealth = functions
  .region(REGION)
  .https.onCall(async () => {
    return {
      ok: true,
      version: "BLCS-BACKEND-V3",
      region: REGION,
      message: "Backend is working.",
      timestamp: new Date().toISOString(),
    };
  });

exports.reopenFlight = functions
  .region(REGION)
  .https.onCall(async (data) => {
    assertManager(data);

    const flightId = String(data?.flightId || "").trim();

    if (!flightId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "flightId is required."
      );
    }

    const flightRef = db.collection("flights").doc(flightId);
    const flightSnapshot = await flightRef.get();

    if (!flightSnapshot.exists) {
      throw new functions.https.HttpsError("not-found", "Flight was not found.");
    }

    const flight = flightSnapshot.data() || {};
    const currentStatus = String(flight.status || "").trim().toUpperCase();

    if (currentStatus !== "LOADED") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Only LOADED flights can be reopened. Current status: ${currentStatus || "UNKNOWN"}.`
      );
    }

    const actor = buildActor(data);
    const batch = db.batch();

    batch.update(flightRef, {
      status: "LOADING",
      reopenedAt: admin.firestore.FieldValue.serverTimestamp(),
      reopenedBy: actor,
      loadingCompletedAt: admin.firestore.FieldValue.delete(),
      loadedAt: admin.firestore.FieldValue.delete(),
    });

    const reportRef = flightRef.collection("reports").doc();

    batch.set(reportRef, {
      type: "REOPEN_FLIGHT",
      reason: data?.reason || "Flight reopened from Flights page.",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: actor,
      previousStatus: currentStatus,
      newStatus: "LOADING",
    });

    await batch.commit();

    return {
      ok: true,
      flightId,
      flightNumber: flight.flightNumber || null,
      previousStatus: currentStatus,
      status: "LOADING",
    };
  });

exports.deleteFlightCascade = functions
  .region(REGION)
  .runWith({
    timeoutSeconds: 540,
    memory: "1GB",
  })
  .https.onCall(async (data) => {
    assertManager(data);

    const flightId = String(data?.flightId || "").trim();

    if (!flightId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "flightId is required."
      );
    }

    try {
      const result = await deleteFlightData(flightId);
      console.log("deleteFlightCascade success", result);

      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      console.error("deleteFlightCascade failed", error);

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError(
        "internal",
        error?.message || "Unable to delete flight."
      );
    }
  });

exports.deleteLoadedFlightsByMonth = functions
  .region(REGION)
  .runWith({
    timeoutSeconds: 540,
    memory: "1GB",
  })
  .https.onCall(async (data) => {
    const role = normalizeRole(data?.userRole);

    if (role !== "station_manager") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only Station Manager can delete a full month."
      );
    }

    const year = Number(data?.year);
    const month = Number(data?.month);

    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2200 ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A valid year and month are required."
      );
    }

    const monthText = `${year}-${String(month).padStart(2, "0")}`;
    const startDate = `${monthText}-01`;

    const nextMonthDate = new Date(year, month, 1);
    const nextYear = nextMonthDate.getFullYear();
    const nextMonth = String(nextMonthDate.getMonth() + 1).padStart(2, "0");
    const endExclusive = `${nextYear}-${nextMonth}-01`;

    try {
      const snapshot = await db
        .collection("flights")
        .where("flightDate", ">=", startDate)
        .where("flightDate", "<", endExclusive)
        .get();

      const loadedFlights = snapshot.docs.filter((documentSnapshot) => {
        const status = String(
          documentSnapshot.data()?.status || ""
        )
          .trim()
          .toUpperCase();

        return status === "LOADED";
      });

      const deleted = [];
      let deletedBagTags = 0;
      let deletedBagTagEvents = 0;
      let deletedStorageFiles = 0;

      for (const flightDoc of loadedFlights) {
        const result = await deleteFlightData(flightDoc.id);
        deleted.push(result);
        deletedBagTags += result.deletedBagTags || 0;
        deletedBagTagEvents += result.deletedBagTagEvents || 0;
        deletedStorageFiles += result.deletedStorageFiles || 0;
      }

      return {
        ok: true,
        month: monthText,
        deletedFlights: deleted.length,
        deletedBagTags,
        deletedBagTagEvents,
        deletedStorageFiles,
        flights: deleted.map((item) => ({
          flightId: item.flightId,
          flightNumber: item.flightNumber,
          flightDate: item.flightDate,
        })),
      };
    } catch (error) {
      console.error("deleteLoadedFlightsByMonth failed", error);

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError(
        "internal",
        error?.message ||
          "Unable to delete loaded flights for the selected month."
      );
    }
  });

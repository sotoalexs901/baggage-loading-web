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
  return String(role || "")
    .trim()
    .toLowerCase();
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
      "Only Station Manager can perform this action."
    );
  }

  return role;
}

function getMonthPrefix(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Deletes all documents from a collection.
 *
 * Before deleting each document, it also deletes any nested
 * subcollections under that document.
 */
async function deleteCollectionRecursive(
  collectionRef,
  batchSize = 200
) {
  while (true) {
    const snapshot = await collectionRef
      .limit(batchSize)
      .get();

    if (snapshot.empty) {
      break;
    }

    /*
     * Delete nested subcollections before deleting
     * the parent documents.
     */
    for (const documentSnapshot of snapshot.docs) {
      const subcollections =
        await documentSnapshot.ref.listCollections();

      for (const subcollection of subcollections) {
        await deleteCollectionRecursive(
          subcollection,
          batchSize
        );
      }
    }

    const batch = db.batch();

    snapshot.docs.forEach((documentSnapshot) => {
      batch.delete(documentSnapshot.ref);
    });

    await batch.commit();

    if (snapshot.size < batchSize) {
      break;
    }
  }
}

/**
 * Deletes a document and every subcollection located below it.
 *
 * This also works when the parent document was previously deleted
 * but orphaned subcollections remain.
 */
async function deleteDocumentTree(
  documentRef,
  batchSize = 200
) {
  const subcollections =
    await documentRef.listCollections();

  for (const subcollection of subcollections) {
    await deleteCollectionRecursive(
      subcollection,
      batchSize
    );
  }

  await documentRef.delete();
}

async function deleteStoragePrefix(prefix) {
  try {
    await bucket.deleteFiles({
      prefix,
    });
  } catch (error) {
    console.warn(
      `[deleteStoragePrefix] skipped for "${prefix}":`,
      error?.message || error
    );
  }
}

/**
 * Returns all bagTags connected to a flight.
 *
 * Supports both:
 * - flightId
 * - currentFlightId
 *
 * This is important because newer tracking records may use
 * currentFlightId while older ones only use flightId.
 */
async function getBagTagDocsForFlight(flightId) {
  const results = new Map();

  const byFlightId = await db
    .collection("bagTags")
    .where("flightId", "==", flightId)
    .get();

  byFlightId.docs.forEach((documentSnapshot) => {
    results.set(
      documentSnapshot.id,
      documentSnapshot
    );
  });

  try {
    const byCurrentFlightId = await db
      .collection("bagTags")
      .where("currentFlightId", "==", flightId)
      .get();

    byCurrentFlightId.docs.forEach((documentSnapshot) => {
      results.set(
        documentSnapshot.id,
        documentSnapshot
      );
    });
  } catch (error) {
    console.warn(
      `[getBagTagDocsForFlight] currentFlightId query skipped for ${flightId}:`,
      error?.message || error
    );
  }

  return [...results.values()];
}

/**
 * Deletes all global bagTags assigned to a flight.
 *
 * It also deletes:
 *
 * bagTags/{tag}/events/*
 *
 * Firestore does not delete subcollections automatically,
 * so recursive deletion is required.
 */
async function deleteBagTagsIndexForFlight(
  flightId
) {
  const bagTagDocs =
    await getBagTagDocsForFlight(
      flightId
    );

  let deletedBagTags = 0;

  for (const documentSnapshot of bagTagDocs) {
    await deleteDocumentTree(
      documentSnapshot.ref
    );

    deletedBagTags += 1;
  }

  return deletedBagTags;
}

/**
 * Returns all flight documents for one YYYY-MM month.
 *
 * No new Firestore index is required because the filtering
 * is done after reading the flights collection.
 */
async function getFlightsForMonth(
  year,
  month
) {
  const monthPrefix =
    getMonthPrefix(
      year,
      month
    );

  const flightsSnapshot = await db
    .collection("flights")
    .get();

  return flightsSnapshot.docs.filter(
    (documentSnapshot) => {
      const flight =
        documentSnapshot.data();

      const flightDate = String(
        flight?.flightDate || ""
      );

      return flightDate.startsWith(
        monthPrefix
      );
    }
  );
}

/**
 * Deletes the entire flight tree and related global records.
 *
 * This includes every current or future subcollection under:
 *
 * flights/{flightId}
 *
 * Diagnostic STEP logging is included so failures can be
 * identified from Cloud Functions logs and returned to the frontend.
 */
async function deleteEntireFlight(flightId) {
  const cleanFlightId = String(
    flightId || ""
  ).trim();

  if (!cleanFlightId) {
    throw new Error(
      "flightId is required."
    );
  }

  const flightRef = db
    .collection("flights")
    .doc(cleanFlightId);

  let flightSnapshot;
  let flightData = null;

  /*
   * STEP 0
   * Read the flight before deleting anything.
   */
  try {
    console.log(
      `[deleteEntireFlight] STEP 0 - reading flight ${cleanFlightId}`
    );

    flightSnapshot =
      await flightRef.get();

    flightData =
      flightSnapshot.exists
        ? flightSnapshot.data()
        : null;

    console.log(
      `[deleteEntireFlight] STEP 0 completed for ${cleanFlightId}`
    );
  } catch (error) {
    console.error(
      `[deleteEntireFlight] STEP 0 FAILED for ${cleanFlightId}:`,
      error
    );

    throw new Error(
      `STEP 0 - Unable to read flight ${cleanFlightId}: ${
        error?.message || error
      }`
    );
  }

  console.log(
    `[deleteEntireFlight] Starting deletion for flight ${cleanFlightId}`
  );

  let deletedBagTags = 0;

  /*
   * STEP 1
   * Delete global baggage tracking records.
   */
  try {
    console.log(
      `[deleteEntireFlight] STEP 1 - deleting bagTags for ${cleanFlightId}`
    );

    deletedBagTags =
      await deleteBagTagsIndexForFlight(
        cleanFlightId
      );

    console.log(
      `[deleteEntireFlight] STEP 1 completed for ${cleanFlightId}. Deleted bagTags: ${deletedBagTags}`
    );
  } catch (error) {
    console.error(
      `[deleteEntireFlight] STEP 1 FAILED for ${cleanFlightId}:`,
      error
    );

    throw new Error(
      `STEP 1 - Unable to delete bagTags for ${cleanFlightId}: ${
        error?.message || error
      }`
    );
  }

  /*
   * STEP 2
   * Delete every subcollection and the flight document.
   *
   * This automatically includes:
   *
   * - aircraftScans
   * - bagroomScans
   * - counterScans
   * - gateBagScans
   * - allowedBagTags
   * - reports
   * - offloadReports
   * - reopenReports
   * - any future subcollection
   */
  try {
    console.log(
      `[deleteEntireFlight] STEP 2 - deleting Firestore flight tree ${cleanFlightId}`
    );

    await deleteDocumentTree(
      flightRef
    );

    console.log(
      `[deleteEntireFlight] STEP 2 completed for ${cleanFlightId}`
    );
  } catch (error) {
    console.error(
      `[deleteEntireFlight] STEP 2 FAILED for ${cleanFlightId}:`,
      error
    );

    throw new Error(
      `STEP 2 - Unable to delete Firestore flight data for ${cleanFlightId}: ${
        error?.message || error
      }`
    );
  }

  /*
   * STEP 3
   * Delete uploaded files associated with the flight.
   *
   * Storage failures are logged but do not fail the whole
   * Firestore cleanup because deleteStoragePrefix already
   * treats Storage cleanup as best-effort.
   */
  try {
    console.log(
      `[deleteEntireFlight] STEP 3 - deleting Storage files for ${cleanFlightId}`
    );

    await deleteStoragePrefix(
      `flights/${cleanFlightId}/`
    );

    console.log(
      `[deleteEntireFlight] STEP 3 completed for ${cleanFlightId}`
    );
  } catch (error) {
    console.warn(
      `[deleteEntireFlight] STEP 3 Storage cleanup skipped for ${cleanFlightId}:`,
      error?.message || error
    );
  }

  console.log(
    `[deleteEntireFlight] Completed deletion for flight ${cleanFlightId}. Deleted bagTags: ${deletedBagTags}`
  );

  return {
    flightId:
      cleanFlightId,

    flightNumber:
      flightData?.flightNumber ||
      null,

    flightDate:
      flightData?.flightDate ||
      null,

    deletedBagTags,
  };
}

/* =========================
   DELETE SINGLE FLIGHT
========================= */

/**
 * Callable used by the frontend Delete Flight button.
 *
 * Expected frontend call:
 *
 * deleteFlightCascade({
 *   flightId,
 *   userRole: user.role
 * })
 */
exports.deleteFlightCascade =
  region.https.onCall(
    async (data, context) => {
      await requireManager(data);

      const flightId = String(
        data?.flightId || ""
      ).trim();

      if (!flightId) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "flightId is required."
        );
      }

      try {
        const result =
          await deleteEntireFlight(
            flightId
          );

        return {
          ok: true,
          ...result,
        };
      } catch (error) {
        console.error(
          "[deleteFlightCascade]",
          error
        );

        throw new functions.https.HttpsError(
          "internal",
          error?.message ||
            "Unable to delete flight.",
          {
            originalMessage:
              error?.message ||
              null,

            stack:
              error?.stack ||
              null,

            flightId:
              flightId,
          }
        );
      }
    }
  );

/* =========================
   PREVIEW MONTHLY CLEANUP
========================= */

/**
 * Station Manager only.
 *
 * Does NOT delete anything.
 * Returns a preview of the month that would be deleted.
 */
exports.previewMonthlyCleanup =
  region.https.onCall(
    async (data, context) => {
      await requireStationManager(
        data
      );

      const year =
        Number(data?.year);

      const month =
        Number(data?.month);

      if (
        !year ||
        !month ||
        month < 1 ||
        month > 12
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "year and month are required."
        );
      }

      const monthPrefix =
        getMonthPrefix(
          year,
          month
        );

      try {
        const flightDocs =
          await getFlightsForMonth(
            year,
            month
          );

        const statusCounts = {
          OPEN: 0,
          RECEIVING: 0,
          LOADING: 0,
          LOADED: 0,
          OTHER: 0,
        };

        const flights = [];

        let bagTagCount = 0;

        for (
          const documentSnapshot
          of flightDocs
        ) {
          const flight =
            documentSnapshot.data();

          const status =
            String(
              flight?.status ||
                "OPEN"
            )
              .trim()
              .toUpperCase();

          if (
            Object.prototype.hasOwnProperty.call(
              statusCounts,
              status
            )
          ) {
            statusCounts[
              status
            ] += 1;
          } else {
            statusCounts.OTHER += 1;
          }

          const bagTagDocs =
            await getBagTagDocsForFlight(
              documentSnapshot.id
            );

          bagTagCount +=
            bagTagDocs.length;

          flights.push({
            id:
              documentSnapshot.id,

            flightNumber:
              flight?.flightNumber ||
              null,

            flightDate:
              flight?.flightDate ||
              null,

            gate:
              flight?.gate ||
              null,

            status:
              status ||
              "OPEN",
          });
        }

        flights.sort(
          (a, b) => {
            const dateCompare =
              String(
                a.flightDate || ""
              ).localeCompare(
                String(
                  b.flightDate || ""
                )
              );

            if (
              dateCompare !== 0
            ) {
              return dateCompare;
            }

            return String(
              a.flightNumber || ""
            ).localeCompare(
              String(
                b.flightNumber || ""
              ),
              undefined,
              {
                numeric: true,
              }
            );
          }
        );

        return {
          ok: true,

          month:
            monthPrefix,

          flightCount:
            flightDocs.length,

          bagTagCount,

          statusCounts,

          flights,
        };
      } catch (error) {
        console.error(
          "[previewMonthlyCleanup]",
          error
        );

        throw new functions.https.HttpsError(
          "internal",
          error?.message ||
            "Unable to preview monthly cleanup.",
          {
            originalMessage:
              error?.message ||
              null,

            stack:
              error?.stack ||
              null,

            month:
              monthPrefix,
          }
        );
      }
    }
  );

/* =========================
   FULL MONTHLY CLEANUP
========================= */

/**
 * Station Manager only.
 *
 * Deletes ALL flights for the selected month,
 * regardless of status:
 *
 * OPEN
 * RECEIVING
 * LOADING
 * LOADED
 *
 * Also deletes:
 * - every flight subcollection
 * - global bagTags
 * - bagTags/{tag}/events/*
 * - Firebase Storage files under flights/{flightId}/
 */
exports.deleteFlightsByMonth =
  region.https.onCall(
    async (data, context) => {
      await requireStationManager(
        data
      );

      const year =
        Number(data?.year);

      const month =
        Number(data?.month);

      if (
        !year ||
        !month ||
        month < 1 ||
        month > 12
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "year and month are required."
        );
      }

      const monthPrefix =
        getMonthPrefix(
          year,
          month
        );

      const confirmation =
        String(
          data?.confirmation ||
            ""
        ).trim();

      if (
        confirmation !==
        `DELETE ${monthPrefix}`
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Confirmation must be exactly: DELETE ${monthPrefix}`
        );
      }

      try {
        console.log(
          `[deleteFlightsByMonth] Starting monthly cleanup for ${monthPrefix}. Requested by: ${data?.username || "unknown"}`
        );

        const flightDocs =
          await getFlightsForMonth(
            year,
            month
          );

        console.log(
          `[deleteFlightsByMonth] Found ${flightDocs.length} flight(s) for ${monthPrefix}`
        );

        let deletedFlights = 0;
        let deletedBagTags = 0;

        for (
          const documentSnapshot
          of flightDocs
        ) {
          const flight =
            documentSnapshot.data();

          console.log(
            `[deleteFlightsByMonth] Deleting flight ${flight?.flightNumber || documentSnapshot.id} (${documentSnapshot.id})`
          );

          const result =
            await deleteEntireFlight(
              documentSnapshot.id
            );

          deletedFlights += 1;

          deletedBagTags +=
            result.deletedBagTags ||
            0;
        }

        console.log(
          `[deleteFlightsByMonth] Completed ${monthPrefix}. ` +
            `Deleted flights: ${deletedFlights}. ` +
            `Deleted bagTags: ${deletedBagTags}. ` +
            `Requested by: ${data?.username || "unknown"}`
        );

        return {
          ok: true,

          month:
            monthPrefix,

          deletedFlights,

          deletedBagTags,
        };
      } catch (error) {
        console.error(
          "[deleteFlightsByMonth]",
          error
        );

        throw new functions.https.HttpsError(
          "internal",
          error?.message ||
            "Unable to delete monthly flight data.",
          {
            originalMessage:
              error?.message ||
              null,

            stack:
              error?.stack ||
              null,

            month:
              monthPrefix,

            requestedBy:
              data?.username ||
              null,
          }
        );
      }
    }
  );

/* =========================
   DELETE MONTH
   LOADED FLIGHTS ONLY
========================= */

/**
 * Existing cleanup option.
 *
 * Deletes only LOADED flights from the selected month.
 */
exports.deleteLoadedFlightsByMonth =
  region.https.onCall(
    async (data, context) => {
      await requireStationManager(
        data
      );

      const year =
        Number(data?.year);

      const month =
        Number(data?.month);

      if (
        !year ||
        !month ||
        month < 1 ||
        month > 12
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "year and month are required."
        );
      }

      const monthPrefix =
        getMonthPrefix(
          year,
          month
        );

      try {
        const flightDocs =
          await getFlightsForMonth(
            year,
            month
          );

        const loadedFlightDocs =
          flightDocs.filter(
            (
              documentSnapshot
            ) => {
              const status =
                String(
                  documentSnapshot
                    .data()
                    ?.status ||
                    ""
                )
                  .trim()
                  .toUpperCase();

              return (
                status ===
                "LOADED"
              );
            }
          );

        let deletedFlights = 0;
        let deletedBagTags = 0;

        for (
          const documentSnapshot
          of loadedFlightDocs
        ) {
          const result =
            await deleteEntireFlight(
              documentSnapshot.id
            );

          deletedFlights += 1;

          deletedBagTags +=
            result.deletedBagTags ||
            0;
        }

        return {
          ok: true,

          deletedFlights,

          deletedBagTags,

          month:
            monthPrefix,
        };
      } catch (error) {
        console.error(
          "[deleteLoadedFlightsByMonth]",
          error
        );

        throw new functions.https.HttpsError(
          "internal",
          error?.message ||
            "Unable to delete flights.",
          {
            originalMessage:
              error?.message ||
              null,

            stack:
              error?.stack ||
              null,

            month:
              monthPrefix,
          }
        );
      }
    }
  );

/* =========================
   CLEAN OLD ORPHANED BAG TAGS
========================= */

/**
 * One-time maintenance function.
 *
 * This removes old bagTags whose flight document
 * was already deleted before the new cascade function
 * was installed.
 *
 * Supports:
 * - flightId
 * - currentFlightId
 *
 * Station Manager only.
 */
exports.cleanupOrphanedBagTags =
  region.https.onCall(
    async (data, context) => {
      await requireStationManager(
        data
      );

      try {
        const bagTagsSnapshot =
          await db
            .collection("bagTags")
            .get();

        let checkedBagTags = 0;
        let deletedOrphans = 0;
        let skippedWithoutFlightId =
          0;

        for (
          const bagTagSnapshot
          of bagTagsSnapshot.docs
        ) {
          checkedBagTags += 1;

          const bagTag =
            bagTagSnapshot.data();

          const flightId =
            String(
              bagTag?.flightId ||
                bagTag
                  ?.currentFlightId ||
                ""
            ).trim();

          if (!flightId) {
            skippedWithoutFlightId +=
              1;

            continue;
          }

          const flightSnapshot =
            await db
              .collection(
                "flights"
              )
              .doc(
                flightId
              )
              .get();

          if (
            flightSnapshot.exists
          ) {
            continue;
          }

          console.log(
            `[cleanupOrphanedBagTags] Deleting orphan tag ${bagTagSnapshot.id}, missing flight ${flightId}`
          );

          await deleteDocumentTree(
            bagTagSnapshot.ref
          );

          deletedOrphans += 1;
        }

        return {
          ok: true,

          checkedBagTags,

          deletedOrphans,

          skippedWithoutFlightId,
        };
      } catch (error) {
        console.error(
          "[cleanupOrphanedBagTags]",
          error
        );

        throw new functions.https.HttpsError(
          "internal",
          error?.message ||
            "Unable to clean orphaned bag tags.",
          {
            originalMessage:
              error?.message ||
              null,

            stack:
              error?.stack ||
              null,
          }
        );
      }
    }
  );

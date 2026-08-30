// functions/index.js

const functions =
  require("firebase-functions/v1");

const admin =
  require("firebase-admin");

admin.initializeApp();

const db =
  admin.firestore();

/*
 * IMPORTANT:
 * Storage is resolved only when needed.
 * A Storage failure will never make Firestore cleanup fail.
 */
function getDefaultBucket() {
  try {
    return admin
      .storage()
      .bucket();
  } catch (error) {
    console.warn(
      "[getDefaultBucket] Storage bucket unavailable:",
      error?.message || error
    );

    return null;
  }
}

// Match frontend region
const region =
  functions.region(
    "us-east4"
  );

/* =========================
   BACKEND HEALTH CHECK
========================= */

/*
 * Diagnostic only.
 * This function does not read, modify, or delete data.
 *
 * MonthlyCleanupPage uses it to verify that the
 * currently deployed Cloud Functions backend is active.
 */
exports.blcsFunctionHealth =
  region.https.onCall(
    async (data, context) => {
      return {
        ok: true,

        version:
          "BLCS-CLEANUP-2026-08-30-V1",

        region:
          "us-east4",

        message:
          "Current BLCS Cloud Functions backend is active.",

        timestamp:
          new Date().toISOString(),

        received: {
          source:
            data?.source ||
            null,

          username:
            data?.username ||
            null,

          userRole:
            data?.userRole ||
            null,

          month:
            data?.month ||
            null,
        },
      };
    }
  );

/* =========================
   HELPERS
========================= */

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

async function requireManager(data) {
  const role =
    normalizeRole(
      data?.userRole
    );

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

async function requireStationManager(
  data
) {
  const role =
    normalizeRole(
      data?.userRole
    );

  if (
    role !==
    "station_manager"
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only Station Manager can perform this action."
    );
  }

  return role;
}

function getMonthPrefix(
  year,
  month
) {
  return `${year}-${String(
    month
  ).padStart(
    2,
    "0"
  )}`;
}

function safeErrorMessage(
  error
) {
  return (
    error?.message ||
    error?.details ||
    String(
      error ||
      "Unknown error"
    )
  );
}

/* =========================
   RECURSIVE FIRESTORE DELETE
========================= */

/**
 * Deletes every document in a collection.
 *
 * Before deleting each document, it recursively deletes
 * any nested subcollections.
 */
async function deleteCollectionRecursive(
  collectionRef,
  batchSize = 200
) {
  while (true) {
    const snapshot =
      await collectionRef
        .limit(
          batchSize
        )
        .get();

    if (
      snapshot.empty
    ) {
      break;
    }

    for (
      const documentSnapshot
      of snapshot.docs
    ) {
      const subcollections =
        await documentSnapshot
          .ref
          .listCollections();

      for (
        const subcollection
        of subcollections
      ) {
        await deleteCollectionRecursive(
          subcollection,
          batchSize
        );
      }
    }

    const batch =
      db.batch();

    snapshot.docs.forEach(
      (
        documentSnapshot
      ) => {
        batch.delete(
          documentSnapshot.ref
        );
      }
    );

    await batch.commit();

    if (
      snapshot.size <
      batchSize
    ) {
      break;
    }
  }
}

/**
 * Deletes one Firestore document and every subcollection
 * located underneath it.
 *
 * It also works if the parent document no longer exists
 * but orphaned subcollections remain.
 */
async function deleteDocumentTree(
  documentRef,
  batchSize = 200
) {
  const subcollections =
    await documentRef
      .listCollections();

  for (
    const subcollection
    of subcollections
  ) {
    await deleteCollectionRecursive(
      subcollection,
      batchSize
    );
  }

  await documentRef.delete();
}

/* =========================
   STORAGE
========================= */

/**
 * Best-effort Storage cleanup.
 *
 * IMPORTANT:
 * This function never throws.
 * Firestore cleanup remains successful even if
 * the Storage bucket is unavailable or a file cannot
 * be removed.
 */
async function deleteStoragePrefix(
  prefix
) {
  const bucket =
    getDefaultBucket();

  if (!bucket) {
    console.warn(
      `[deleteStoragePrefix] No Storage bucket available. Skipped "${prefix}".`
    );

    return {
      ok: false,
      skipped: true,
      message:
        "Storage bucket unavailable.",
    };
  }

  try {
    await bucket.deleteFiles({
      prefix,
    });

    return {
      ok: true,
      skipped: false,
      message: null,
    };
  } catch (error) {
    console.warn(
      `[deleteStoragePrefix] Storage cleanup failed for "${prefix}":`,
      error
    );

    return {
      ok: false,
      skipped: false,
      message:
        safeErrorMessage(
          error
        ),
    };
  }
}

/* =========================
   BAG TAG HELPERS
========================= */

/**
 * Returns all global bagTags connected to one flight.
 *
 * Supports:
 * - flightId
 * - currentFlightId
 *
 * Results are deduplicated by bag tag document ID.
 */
async function getBagTagDocsForFlight(
  flightId
) {
  const results =
    new Map();

  const byFlightId =
    await db
      .collection(
        "bagTags"
      )
      .where(
        "flightId",
        "==",
        flightId
      )
      .get();

  byFlightId.docs.forEach(
    (
      documentSnapshot
    ) => {
      results.set(
        documentSnapshot.id,
        documentSnapshot
      );
    }
  );

  try {
    const byCurrentFlightId =
      await db
        .collection(
          "bagTags"
        )
        .where(
          "currentFlightId",
          "==",
          flightId
        )
        .get();

    byCurrentFlightId.docs.forEach(
      (
        documentSnapshot
      ) => {
        results.set(
          documentSnapshot.id,
          documentSnapshot
        );
      }
    );
  } catch (error) {
    /*
     * Do not fail deletion just because older deployments
     * or records do not support currentFlightId.
     */
    console.warn(
      `[getBagTagDocsForFlight] currentFlightId query skipped for ${flightId}:`,
      safeErrorMessage(
        error
      )
    );
  }

  return [
    ...results.values(),
  ];
}

/**
 * Deletes all global bagTag records connected to one flight,
 * including:
 *
 * bagTags/{tag}/events/*
 */
async function deleteBagTagsIndexForFlight(
  flightId
) {
  const bagTagDocs =
    await getBagTagDocsForFlight(
      flightId
    );

  let deletedBagTags =
    0;

  for (
    const documentSnapshot
    of bagTagDocs
  ) {
    await deleteDocumentTree(
      documentSnapshot.ref
    );

    deletedBagTags += 1;
  }

  return deletedBagTags;
}

/* =========================
   FLIGHT LOOKUP
========================= */

/**
 * Returns every flight document whose flightDate begins
 * with the selected YYYY-MM.
 *
 * Filtering is performed in memory so no new Firestore
 * composite index is required.
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

  const flightsSnapshot =
    await db
      .collection(
        "flights"
      )
      .get();

  return flightsSnapshot
    .docs
    .filter(
      (
        documentSnapshot
      ) => {
        const flight =
          documentSnapshot.data();

        const flightDate =
          String(
            flight?.flightDate ||
            ""
          );

        return flightDate
          .startsWith(
            monthPrefix
          );
      }
    );
}

/* =========================
   DELETE ENTIRE FLIGHT
========================= */

/**
 * Deletes a complete flight and related baggage history.
 *
 * Firestore is considered the primary cleanup.
 * Storage is secondary and never makes the entire operation fail.
 *
 * Returns a structured result so Monthly Cleanup can continue
 * processing the remaining flights even if one flight fails.
 */
async function deleteEntireFlight(
  flightId
) {
  const cleanFlightId =
    String(
      flightId || ""
    ).trim();

  if (!cleanFlightId) {
    throw new Error(
      "flightId is required."
    );
  }

  const flightRef =
    db
      .collection(
        "flights"
      )
      .doc(
        cleanFlightId
      );

  let flightData =
    null;

  let deletedBagTags =
    0;

  /*
   * STEP 0
   * Read flight information.
   */
  try {
    console.log(
      `[deleteEntireFlight] STEP 0 - reading flight ${cleanFlightId}`
    );

    const flightSnapshot =
      await flightRef.get();

    flightData =
      flightSnapshot.exists
        ? flightSnapshot.data()
        : null;

    console.log(
      `[deleteEntireFlight] STEP 0 completed for ${cleanFlightId}`
    );
  } catch (error) {
    throw new Error(
      `STEP 0 - Unable to read flight ${cleanFlightId}: ${safeErrorMessage(
        error
      )}`
    );
  }

  /*
   * STEP 1
   * Delete global bagTags and their events.
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
      `STEP 1 - Unable to delete bagTags for ${cleanFlightId}: ${safeErrorMessage(
        error
      )}`
    );
  }

  /*
   * STEP 2
   * Delete every flight subcollection and finally
   * the flight document itself.
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
      `STEP 2 - Unable to delete Firestore flight data for ${cleanFlightId}: ${safeErrorMessage(
        error
      )}`
    );
  }

  /*
   * STEP 3
   * Best-effort Storage cleanup.
   *
   * Does not throw.
   */
  console.log(
    `[deleteEntireFlight] STEP 3 - deleting Storage files for ${cleanFlightId}`
  );

  const storageResult =
    await deleteStoragePrefix(
      `flights/${cleanFlightId}/`
    );

  console.log(
    `[deleteEntireFlight] STEP 3 completed for ${cleanFlightId}. Storage ok: ${storageResult.ok}`
  );

  console.log(
    `[deleteEntireFlight] Completed deletion for flight ${cleanFlightId}. Deleted bagTags: ${deletedBagTags}`
  );

  return {
    ok: true,

    flightId:
      cleanFlightId,

    flightNumber:
      flightData?.flightNumber ||
      null,

    flightDate:
      flightData?.flightDate ||
      null,

    deletedBagTags,

    storageCleanup: {
      ok:
        storageResult.ok,

      skipped:
        storageResult.skipped,

      message:
        storageResult.message,
    },
  };
}

/* =========================
   REOPEN FLIGHT
========================= */

/*
 * Used by FlightsPage.
 *
 * Reopens a completed flight for scanning.
 */
exports.reopenFlight =
  region.https.onCall(
    async (
      data,
      context
    ) => {
      await requireManager(
        data
      );

      const flightId =
        String(
          data?.flightId ||
          ""
        ).trim();

      if (!flightId) {
        throw new functions
          .https
          .HttpsError(
            "invalid-argument",
            "flightId is required."
          );
      }

      try {
        const flightRef =
          db
            .collection(
              "flights"
            )
            .doc(
              flightId
            );

        const flightSnapshot =
          await flightRef.get();

        if (
          !flightSnapshot.exists
        ) {
          throw new functions
            .https
            .HttpsError(
              "not-found",
              "Flight not found."
            );
        }

        const previousData =
          flightSnapshot.data();

        await flightRef.set(
          {
            status:
              "LOADING",

            aircraftLoadingCompleted:
              false,

            aircraftLoadingCompletedAt:
              null,

            aircraftLoadingCompletedBy:
              null,

            reopenedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),

            reopenedBy: {
              username:
                data?.username ||
                null,

              userRole:
                data?.userRole ||
                null,

              employeeFullName:
                data?.employeeFullName ||
                null,

              operationalPosition:
                data?.operationalPosition ||
                null,

              operationalPositionLabel:
                data?.operationalPositionLabel ||
                null,
            },

            statusUpdatedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),

            statusUpdatedBy: {
              username:
                data?.username ||
                null,

              role:
                data?.userRole ||
                null,

              fullName:
                data?.employeeFullName ||
                null,

              operationalPosition:
                data?.operationalPosition ||
                null,

              operationalPositionLabel:
                data?.operationalPositionLabel ||
                null,
            },
          },
          {
            merge: true,
          }
        );

        await flightRef
          .collection(
            "reports"
          )
          .add({
            type:
              "REOPEN_FLIGHT",

            reason:
              data?.reason ||
              "Reopened from Flights page.",

            createdAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),

            createdBy: {
              username:
                data?.username ||
                null,

              role:
                data?.userRole ||
                null,

              fullName:
                data?.employeeFullName ||
                null,

              operationalPosition:
                data?.operationalPosition ||
                null,

              operationalPositionLabel:
                data?.operationalPositionLabel ||
                null,
            },

            previousStatus:
              previousData?.status ||
              null,

            previousAircraftLoadingCompleted:
              Boolean(
                previousData
                  ?.aircraftLoadingCompleted
              ),
          });

        return {
          ok: true,

          flightId,

          status:
            "LOADING",
        };
      } catch (error) {
        console.error(
          "[reopenFlight]",
          error
        );

        if (
          error instanceof
          functions
            .https
            .HttpsError
        ) {
          throw error;
        }

        throw new functions
          .https
          .HttpsError(
            "internal",
            safeErrorMessage(
              error
            ),
            {
              flightId,

              originalMessage:
                safeErrorMessage(
                  error
                ),
            }
          );
      }
    }
  );

/* =========================
   DELETE SINGLE FLIGHT
========================= */

exports.deleteFlightCascade =
  region.https.onCall(
    async (
      data,
      context
    ) => {
      await requireManager(
        data
      );

      const flightId =
        String(
          data?.flightId ||
          ""
        ).trim();

      if (!flightId) {
        throw new functions
          .https
          .HttpsError(
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

        throw new functions
          .https
          .HttpsError(
            "internal",
            safeErrorMessage(
              error
            ),
            {
              originalMessage:
                safeErrorMessage(
                  error
                ),

              flightId,

              stack:
                error?.stack ||
                null,
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
 * Preview only.
 * Does NOT delete anything.
 */
exports.previewMonthlyCleanup =
  region.https.onCall(
    async (
      data,
      context
    ) => {
      await requireStationManager(
        data
      );

      const year =
        Number(
          data?.year
        );

      const month =
        Number(
          data?.month
        );

      if (
        !year ||
        !month ||
        month < 1 ||
        month > 12
      ) {
        throw new functions
          .https
          .HttpsError(
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

        const flights =
          [];

        let bagTagCount =
          0;

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
            Object.prototype
              .hasOwnProperty
              .call(
                statusCounts,
                status
              )
          ) {
            statusCounts[
              status
            ] += 1;
          } else {
            statusCounts
              .OTHER += 1;
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

            trackedBagTags:
              bagTagDocs.length,
          });
        }

        flights.sort(
          (
            a,
            b
          ) => {
            const dateCompare =
              String(
                a.flightDate ||
                ""
              ).localeCompare(
                String(
                  b.flightDate ||
                    ""
                )
              );

            if (
              dateCompare !==
              0
            ) {
              return dateCompare;
            }

            return String(
              a.flightNumber ||
                ""
            ).localeCompare(
              String(
                b.flightNumber ||
                  ""
              ),
              undefined,
              {
                numeric:
                  true,
              }
            );
          }
        );

        return {
          ok:
            true,

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

        throw new functions
          .https
          .HttpsError(
            "internal",
            safeErrorMessage(
              error
            ),
            {
              originalMessage:
                safeErrorMessage(
                  error
                ),

              month:
                monthPrefix,

              stack:
                error?.stack ||
                null,
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
 * regardless of flight status.
 *
 * IMPORTANT:
 * Each flight is processed independently.
 *
 * If one flight fails:
 * - the cleanup continues with the next flight
 * - successful deletions remain successful
 * - failed flights are returned to the frontend
 */
exports.deleteFlightsByMonth =
  region.https.onCall(
    async (
      data,
      context
    ) => {
      await requireStationManager(
        data
      );

      const year =
        Number(
          data?.year
        );

      const month =
        Number(
          data?.month
        );

      if (
        !year ||
        !month ||
        month < 1 ||
        month > 12
      ) {
        throw new functions
          .https
          .HttpsError(
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
        throw new functions
          .https
          .HttpsError(
            "failed-precondition",
            `Confirmation must be exactly: DELETE ${monthPrefix}`
          );
      }

      let flightDocs;

      try {
        console.log(
          `[deleteFlightsByMonth] Starting monthly cleanup for ${monthPrefix}. Requested by: ${data?.username || "unknown"}`
        );

        flightDocs =
          await getFlightsForMonth(
            year,
            month
          );
      } catch (error) {
        console.error(
          "[deleteFlightsByMonth] Unable to load flights:",
          error
        );

        throw new functions
          .https
          .HttpsError(
            "internal",
            `Unable to load flights for ${monthPrefix}: ${safeErrorMessage(
              error
            )}`,
            {
              originalMessage:
                safeErrorMessage(
                  error
                ),

              month:
                monthPrefix,

              stage:
                "LOAD_MONTH_FLIGHTS",
            }
          );
      }

      console.log(
        `[deleteFlightsByMonth] Found ${flightDocs.length} flight(s) for ${monthPrefix}`
      );

      let deletedFlights =
        0;

      let failedFlights =
        0;

      let deletedBagTags =
        0;

      const deleted =
        [];

      const failures =
        [];

      const storageWarnings =
        [];

      for (
        const documentSnapshot
        of flightDocs
      ) {
        const flight =
          documentSnapshot.data();

        const flightId =
          documentSnapshot.id;

        const flightNumber =
          flight?.flightNumber ||
          flightId;

        console.log(
          `[deleteFlightsByMonth] Processing ${flightNumber} (${flightId})`
        );

        try {
          const result =
            await deleteEntireFlight(
              flightId
            );

          deletedFlights +=
            1;

          deletedBagTags +=
            result.deletedBagTags ||
            0;

          deleted.push({
            flightId,

            flightNumber:
              result.flightNumber ||
              flightNumber,

            flightDate:
              result.flightDate ||
              flight?.flightDate ||
              null,

            deletedBagTags:
              result.deletedBagTags ||
              0,
          });

          if (
            result.storageCleanup &&
            !result.storageCleanup.ok
          ) {
            storageWarnings.push({
              flightId,

              flightNumber:
                result.flightNumber ||
                flightNumber,

              message:
                result
                  .storageCleanup
                  .message ||
                "Storage cleanup was skipped or failed.",
            });
          }

          console.log(
            `[deleteFlightsByMonth] SUCCESS ${flightNumber} (${flightId})`
          );
        } catch (error) {
          failedFlights +=
            1;

          const failureMessage =
            safeErrorMessage(
              error
            );

          failures.push({
            flightId,

            flightNumber,

            flightDate:
              flight?.flightDate ||
              null,

            message:
              failureMessage,
          });

          console.error(
            `[deleteFlightsByMonth] FAILED ${flightNumber} (${flightId}):`,
            error
          );
        }
      }

      console.log(
        `[deleteFlightsByMonth] Completed ${monthPrefix}. ` +
          `Deleted flights: ${deletedFlights}. ` +
          `Failed flights: ${failedFlights}. ` +
          `Deleted bagTags: ${deletedBagTags}. ` +
          `Requested by: ${data?.username || "unknown"}`
      );

      return {
        ok:
          failedFlights ===
          0,

        partialSuccess:
          deletedFlights >
            0 &&
          failedFlights >
            0,

        month:
          monthPrefix,

        requestedBy:
          data?.username ||
          null,

        totalFlights:
          flightDocs.length,

        deletedFlights,

        failedFlights,

        deletedBagTags,

        deleted,

        failures,

        storageWarnings,
      };
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
 *
 * Also uses per-flight error handling.
 */
exports.deleteLoadedFlightsByMonth =
  region.https.onCall(
    async (
      data,
      context
    ) => {
      await requireStationManager(
        data
      );

      const year =
        Number(
          data?.year
        );

      const month =
        Number(
          data?.month
        );

      if (
        !year ||
        !month ||
        month < 1 ||
        month > 12
      ) {
        throw new functions
          .https
          .HttpsError(
            "invalid-argument",
            "year and month are required."
          );
      }

      const monthPrefix =
        getMonthPrefix(
          year,
          month
        );

      let flightDocs;

      try {
        flightDocs =
          await getFlightsForMonth(
            year,
            month
          );
      } catch (error) {
        throw new functions
          .https
          .HttpsError(
            "internal",
            `Unable to load flights for ${monthPrefix}: ${safeErrorMessage(
              error
            )}`
          );
      }

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

      let deletedFlights =
        0;

      let failedFlights =
        0;

      let deletedBagTags =
        0;

      const failures =
        [];

      const storageWarnings =
        [];

      for (
        const documentSnapshot
        of loadedFlightDocs
      ) {
        const flight =
          documentSnapshot.data();

        try {
          const result =
            await deleteEntireFlight(
              documentSnapshot.id
            );

          deletedFlights +=
            1;

          deletedBagTags +=
            result.deletedBagTags ||
            0;

          if (
            result.storageCleanup &&
            !result.storageCleanup.ok
          ) {
            storageWarnings.push({
              flightId:
                documentSnapshot.id,

              flightNumber:
                result.flightNumber ||
                flight?.flightNumber ||
                documentSnapshot.id,

              message:
                result
                  .storageCleanup
                  .message ||
                "Storage cleanup was skipped or failed.",
            });
          }
        } catch (error) {
          failedFlights +=
            1;

          failures.push({
            flightId:
              documentSnapshot.id,

            flightNumber:
              flight?.flightNumber ||
              documentSnapshot.id,

            flightDate:
              flight?.flightDate ||
              null,

            message:
              safeErrorMessage(
                error
              ),
          });
        }
      }

      return {
        ok:
          failedFlights ===
          0,

        partialSuccess:
          deletedFlights >
            0 &&
          failedFlights >
            0,

        month:
          monthPrefix,

        totalFlights:
          loadedFlightDocs.length,

        deletedFlights,

        failedFlights,

        deletedBagTags,

        failures,

        storageWarnings,
      };
    }
  );

/* =========================
   CLEAN OLD ORPHANED BAG TAGS
========================= */

/**
 * One-time maintenance function.
 *
 * Removes global bagTags whose referenced flight
 * document no longer exists.
 *
 * Supports:
 * - flightId
 * - currentFlightId
 *
 * Station Manager only.
 */
exports.cleanupOrphanedBagTags =
  region.https.onCall(
    async (
      data,
      context
    ) => {
      await requireStationManager(
        data
      );

      try {
        const bagTagsSnapshot =
          await db
            .collection(
              "bagTags"
            )
            .get();

        let checkedBagTags =
          0;

        let deletedOrphans =
          0;

        let skippedWithoutFlightId =
          0;

        let failedOrphans =
          0;

        const failures =
          [];

        for (
          const bagTagSnapshot
          of bagTagsSnapshot.docs
        ) {
          checkedBagTags +=
            1;

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

          try {
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

            deletedOrphans +=
              1;
          } catch (error) {
            failedOrphans +=
              1;

            failures.push({
              tag:
                bagTagSnapshot.id,

              flightId,

              message:
                safeErrorMessage(
                  error
                ),
            });
          }
        }

        return {
          ok:
            failedOrphans ===
            0,

          partialSuccess:
            deletedOrphans >
              0 &&
            failedOrphans >
              0,

          checkedBagTags,

          deletedOrphans,

          failedOrphans,

          skippedWithoutFlightId,

          failures,
        };
      } catch (error) {
        console.error(
          "[cleanupOrphanedBagTags]",
          error
        );

        throw new functions
          .https
          .HttpsError(
            "internal",
            safeErrorMessage(
              error
            ),
            {
              originalMessage:
                safeErrorMessage(
                  error
                ),

              stack:
                error?.stack ||
                null,
            }
          );
      }
    }
  );

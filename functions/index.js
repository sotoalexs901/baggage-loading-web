// functions/index.js

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();

const REGION = "us-east4";

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
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

  return role;
}

function buildActor(data) {
  return {
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
  };
}

async function deleteCollectionDocs(collectionRef, batchSize = 400) {
  let deleted = 0;

  while (true) {
    const snap = await collectionRef
      .limit(batchSize)
      .get();

    if (snap.empty) {
      break;
    }

    const batch = db.batch();

    snap.docs.forEach((documentSnapshot) => {
      batch.delete(documentSnapshot.ref);
    });

    await batch.commit();

    deleted += snap.size;

    if (snap.size < batchSize) {
      break;
    }
  }

  return deleted;
}

async function deleteBagTagDocumentAndEvents(tagDocRef) {
  let deletedEvents = 0;

  try {
    deletedEvents =
      await deleteCollectionDocs(
        tagDocRef.collection("events")
      );
  } catch (error) {
    console.warn(
      "Unable to delete bag tag events:",
      tagDocRef.id,
      error
    );
  }

  try {
    await tagDocRef.delete();
  } catch (error) {
    console.warn(
      "Unable to delete bag tag document:",
      tagDocRef.id,
      error
    );
  }

  return deletedEvents;
}

async function deleteGlobalBagTagsForFlight(flightId) {
  const bagTagsRef =
    db.collection("bagTags");

  const candidateFields = [
    "flightId",
    "currentFlightId",
    "lastFlightId",
  ];

  const refs = new Map();

  for (const field of candidateFields) {
    try {
      const snap = await bagTagsRef
        .where(field, "==", flightId)
        .get();

      snap.docs.forEach((d) => {
        refs.set(d.ref.path, d.ref);
      });
    } catch (error) {
      console.warn(
        `Bag tag lookup failed for ${field}:`,
        error
      );
    }
  }

  let deletedBagTags = 0;
  let deletedBagTagEvents = 0;

  for (const tagRef of refs.values()) {
    deletedBagTagEvents +=
      await deleteBagTagDocumentAndEvents(
        tagRef
      );

    deletedBagTags += 1;
  }

  return {
    deletedBagTags,
    deletedBagTagEvents,
  };
}

async function deleteStorageForFlight(flightId) {
  let deletedFiles = 0;

  try {
    const bucket = storage.bucket();

    const prefixes = [
      `flights/${flightId}/`,
      `flightReports/${flightId}/`,
      `reports/${flightId}/`,
    ];

    for (const prefix of prefixes) {
      try {
        const [files] =
          await bucket.getFiles({
            prefix,
          });

        if (!files.length) {
          continue;
        }

        await Promise.all(
          files.map(async (file) => {
            try {
              await file.delete({
                ignoreNotFound: true,
              });

              deletedFiles += 1;
            } catch (error) {
              console.warn(
                "Storage delete failed:",
                file.name,
                error
              );
            }
          })
        );
      } catch (error) {
        console.warn(
          "Storage prefix lookup failed:",
          prefix,
          error
        );
      }
    }
  } catch (error) {
    console.warn(
      "Storage cleanup skipped:",
      error
    );
  }

  return deletedFiles;
}

async function deleteFlightData(flightId) {
  const flightRef =
    db.collection("flights").doc(flightId);

  const flightSnap =
    await flightRef.get();

  if (!flightSnap.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "Flight was not found."
    );
  }

  const flightData =
    flightSnap.data() || {};

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
    deletedSubcollections[name] =
      await deleteCollectionDocs(
        flightRef.collection(name)
      );
  }

  const bagTagCleanup =
    await deleteGlobalBagTagsForFlight(
      flightId
    );

  const deletedStorageFiles =
    await deleteStorageForFlight(
      flightId
    );

  await flightRef.delete();

  return {
    flightId,
    flightNumber:
      flightData.flightNumber ||
      null,

    flightDate:
      flightData.flightDate ||
      null,

    deletedSubcollections,
    deletedBagTags:
      bagTagCleanup.deletedBagTags,

    deletedBagTagEvents:
      bagTagCleanup.deletedBagTagEvents,

    deletedStorageFiles,
  };
}

/* =========================================================
   HEALTH CHECK
========================================================= */

exports.blcsFunctionHealth =
  functions
    .region(REGION)
    .https
    .onCall(async () => {
      return {
        ok: true,
        version:
          "BLCS-BACKEND-V3",

        region:
          REGION,

        message:
          "Backend is working.",

        timestamp:
          new Date().toISOString(),
      };
    });

/* =========================================================
   REOPEN FLIGHT
========================================================= */

exports.reopenFlight =
  functions
    .region(REGION)
    .https
    .onCall(
      async (data) => {
        assertManager(data);

        const flightId =
          String(
            data?.flightId ||
              ""
          ).trim();

        if (!flightId) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "flightId is required."
          );
        }

        const flightRef =
          db.collection(
            "flights"
          ).doc(
            flightId
          );

        const flightSnap =
          await flightRef.get();

        if (!flightSnap.exists) {
          throw new functions.https.HttpsError(
            "not-found",
            "Flight was not found."
          );
        }

        const flight =
          flightSnap.data() ||
          {};

        const currentStatus =
          String(
            flight.status ||
              ""
          )
            .trim()
            .toUpperCase();

        if (
          currentStatus !==
          "LOADED"
        ) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            `Only LOADED flights can be reopened. Current status: ${
              currentStatus ||
              "UNKNOWN"
            }.`
          );
        }

        const actor =
          buildActor(data);

        const reopenedAt =
          admin.firestore.FieldValue
            .serverTimestamp();

        const batch =
          db.batch();

        batch.update(
          flightRef,
          {
            status:
              "LOADING",

            reopenedAt,

            reopenedBy:
              actor,

            loadingCompletedAt:
              admin.firestore.FieldValue
                .delete(),

            loadedAt:
              admin.firestore.FieldValue
                .delete(),
          }
        );

        const reportRef =
          flightRef
            .collection(
              "reports"
            )
            .doc();

        batch.set(
          reportRef,
          {
            type:
              "REOPEN_FLIGHT",

            reason:
              data?.reason ||
              "Flight reopened from Flights page.",

            createdAt:
              admin.firestore.FieldValue
                .serverTimestamp(),

            createdBy:
              actor,

            previousStatus:
              currentStatus,

            newStatus:
              "LOADING",
          }
        );

        await batch.commit();

        return {
          ok: true,

          flightId,

          flightNumber:
            flight.flightNumber ||
            null,

          previousStatus:
            currentStatus,

          status:
            "LOADING",
        };
      }
    );

/* =========================================================
   DELETE ONE FLIGHT
========================================================= */

exports.deleteFlightCascade =
  functions
    .region(REGION)
    .runWith({
      timeoutSeconds: 540,
      memory: "1GB",
    })
    .https
    .onCall(
      async (data) => {
        assertManager(data);

        const flightId =
          String(
            data?.flightId ||
              ""
          ).trim();

        if (!flightId) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "flightId is required."
          );
        }

        try {
          const result =
            await deleteFlightData(
              flightId
            );

          console.log(
            "deleteFlightCascade success:",
            result
          );

          return {
            ok: true,
            ...result,
          };
        } catch (error) {
          console.error(
            "deleteFlightCascade failed:",
            error
          );

          if (
            error instanceof
            functions.https.HttpsError
          ) {
            throw error;
          }

          throw new functions.https.HttpsError(
            "internal",
            error?.message ||
              "Unable to delete flight."
          );
        }
      }
    );

/* =========================================================
   DELETE ALL LOADED FLIGHTS FOR A MONTH
========================================================= */

exports.deleteLoadedFlightsByMonth =
  functions
    .region(REGION)
    .runWith({
      timeoutSeconds: 540,
      memory: "1GB",
    })
    .https
    .onCall(
      async (data) => {
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
            "Only Station Manager can delete a full month."
          );
        }

        const year =
          Number(
            data?.year
          );

        const month =
          Number(
            data?.month
          );

        if (
          !Number.isInteger(
            year
          ) ||
          year < 2000 ||
          year > 2200 ||
          !Number.isInteger(
            month
          ) ||
          month < 1 ||
          month > 12
        ) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "A valid year and month are required."
          );
        }

        const monthText =
          `${year}-${String(
            month
          ).padStart(
            2,
            "0"
          )}`;

        const startDate =
          `${monthText}-01`;

        const nextMonthDate =
          new Date(
            year,
            month,
            1
          );

        const nextYear =
          nextMonthDate.getFullYear();

        const nextMonth =
          String(
            nextMonthDate.getMonth() +
              1
          ).padStart(
            2,
            "0"
          );

        const endExclusive =
          `${nextYear}-${nextMonth}-01`;

        try {
          const snap =
            await db
              .collection(
                "flights"
              )
              .where(
                "flightDate",
                ">=",
                startDate
              )
              .where(
                "flightDate",
                "<",
                endExclusive
              )
              .get();

          const loadedFlights =
            snap.docs.filter(
              (documentSnapshot) => {
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

          const deleted =
            [];

          let totalBagTags =
            0;

          let totalBagTagEvents =
            0;

          let totalStorageFiles =
            0;

          for (
            const flightDoc
            of loadedFlights
          ) {
            const result =
              await deleteFlightData(
                flightDoc.id
              );

            deleted.push(
              result
            );

            totalBagTags +=
              result.deletedBagTags ||
              0;

            totalBagTagEvents +=
              result.deletedBagTagEvents ||
              0;

            totalStorageFiles +=
              result.deletedStorageFiles ||
              0;
          }

          console.log(
            "deleteLoadedFlightsByMonth success:",
            {
              month:
                monthText,

              deletedFlights:
                deleted.length,
            }
          );

          return {
            ok:
              true,

            month:
              monthText,

            deletedFlights:
              deleted.length,

            deletedBagTags:
              totalBagTags,

            deletedBagTagEvents:
              totalBagTagEvents,

            deletedStorageFiles:
              totalStorageFiles,

            flights:
              deleted.map(
                (item) => ({
                  flightId:
                    item.flightId,

                  flightNumber:
                    item.flightNumber,

                  flightDate:
                    item.flightDate,
                })
              ),
          };
        } catch (error) {
          console.error(
            "deleteLoadedFlightsByMonth failed:",
            error
          );

          if (
            error instanceof
            functions.https.HttpsError
          ) {
            throw error;
          }

          throw new functions.https.HttpsError(
            "internal",
            error?.message ||
              "Unable to delete loaded flights for the selected month."
          );
        }
      }
   

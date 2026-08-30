// src/pages/CounterScanPage.jsx

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "../firebase";

import {
  logSystemIncident,
  logSystemSuccess,
  startSystemTimer,
} from "../utils/systemLogger.js";

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function cleanTag(tag) {
  return String(tag || "")
    .replace(/\D+/g, "");
}

function normalizeStatus(s) {
  const v = String(
    s || "OPEN"
  )
    .trim()
    .toUpperCase();

  return (
    v === "OPEN" ||
    v === "RECEIVING" ||
    v === "LOADING" ||
    v === "LOADED"
  )
    ? v
    : "OPEN";
}

function normalizeBagType(value) {
  const v = String(
    value || "CHECKED_BAG"
  )
    .trim()
    .toUpperCase();

  return (
    v === "CHECKED_BAG" ||
    v === "GATE_CHECK" ||
    v === "OVERSIZE"
  )
    ? v
    : "CHECKED_BAG";
}

function getBagTypeLabel(value) {
  const v =
    normalizeBagType(
      value
    );

  if (
    v === "GATE_CHECK"
  ) {
    return "Gate Check";
  }

  if (
    v === "OVERSIZE"
  ) {
    return "Oversize";
  }

  return "Checked Bag";
}

function getErrorCode(error) {
  return (
    error?.code ||
    error?.name ||
    null
  );
}

function getErrorMessage(
  error,
  fallback
) {
  return (
    error?.message ||
    fallback ||
    "Unknown error"
  );
}

const MIN_TAG = 10;
const AUTO_SUBMIT_MS = 90;
const MOBILE_BREAKPOINT = 760;

export default function CounterScanPage({
  flightId,
  user,
  operationalContext,
}) {
  const role =
    useMemo(
      () =>
        normalizeRole(
          user?.role
        ),
      [user]
    );

  const canDeleteScans =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "supervisor" ||
    role === "gate_controller" ||
    role === "agent";

  const operationalActor =
    useMemo(
      () => ({
        userId:
          user?.id ||
          null,

        username:
          user?.username ||
          null,

        fullName:
          operationalContext
            ?.employeeFullName ||
          user?.fullName ||
          user?.username ||
          null,

        role:
          user?.role ||
          null,

        systemRole:
          operationalContext
            ?.systemRole ||
          user?.role ||
          null,

        basePosition:
          operationalContext
            ?.basePosition ||
          user?.position ||
          null,

        operationalPosition:
          operationalContext
            ?.operationalPosition ||
          "COUNTER_SCAN",

        operationalPositionLabel:
          operationalContext
            ?.operationalPositionLabel ||
          "Counter Scan",

        loginAt:
          operationalContext
            ?.loginAt ||
          null,
      }),
      [
        user,
        operationalContext,
      ]
    );

  const inputRef =
    useRef(null);

  const timerRef =
    useRef(null);

  const savingRef =
    useRef(false);

  const [
    isMobile,
    setIsMobile,
  ] = useState(
    typeof window !==
      "undefined"
      ? window.innerWidth <
          MOBILE_BREAKPOINT
      : false
  );

  const [
    flight,
    setFlight,
  ] = useState(null);

  const [
    loadingFlight,
    setLoadingFlight,
  ] = useState(true);

  const [
    tagInput,
    setTagInput,
  ] = useState("");

  const [
    bagType,
    setBagType,
  ] = useState(
    localStorage.getItem(
      `counterBagType_${flightId}`
    ) ||
      "CHECKED_BAG"
  );

  const selectedBagType =
    normalizeBagType(
      bagType
    );

  const [
    msg,
    setMsg,
  ] = useState("");

  const [
    err,
    setErr,
  ] = useState("");

  const [
    rows,
    setRows,
  ] = useState([]);

  const [
    loadingRows,
    setLoadingRows,
  ] = useState(true);

  const [
    bagroomRows,
    setBagroomRows,
  ] = useState([]);

  const [
    loadingBagroomRows,
    setLoadingBagroomRows,
  ] = useState(true);

  const [
    deletingCounterTag,
    setDeletingCounterTag,
  ] = useState("");

  const [
    deletingBagroomTag,
    setDeletingBagroomTag,
  ] = useState("");

  /* =========================
     SYSTEM MONITOR HELPERS
  ========================= */

  const logCounterIncident =
    async ({
      action,
      status = "ERROR",
      severity = "MEDIUM",
      errorType = null,
      errorCode = null,
      message = null,
      tag = null,
      durationMs = null,
      metadata = {},
    }) => {
      await logSystemIncident({
        module:
          "COUNTER",

        action,

        status,

        severity,

        errorType,

        errorCode,

        message,

        user,

        operationalContext,

        flightId,

        flightNumber:
          flight
            ?.flightNumber ||
          null,

        bagTag:
          tag ||
          null,

        durationMs,

        currentView:
          "counter",

        metadata,
      });
    };

  /* =========================
     RESPONSIVE
  ========================= */

  useEffect(() => {
    const onResize =
      () => {
        setIsMobile(
          window.innerWidth <
            MOBILE_BREAKPOINT
        );
      };

    window.addEventListener(
      "resize",
      onResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        onResize
      );
    };
  }, []);

  /* =========================
     FLIGHT SUBSCRIPTION
  ========================= */

  useEffect(() => {
    if (!flightId) {
      setFlight(null);
      setLoadingFlight(
        false
      );

      return undefined;
    }

    setLoadingFlight(
      true
    );

    const ref =
      doc(
        db,
        "flights",
        flightId
      );

    const unsub =
      onSnapshot(
        ref,

        (
          snap
        ) => {
          if (
            !snap.exists()
          ) {
            setFlight(
              null
            );

            setLoadingFlight(
              false
            );

            logSystemIncident({
              module:
                "COUNTER",

              action:
                "LOAD_FLIGHT",

              status:
                "ERROR",

              severity:
                "HIGH",

              errorType:
                "FLIGHT_NOT_FOUND",

              message:
                "Selected flight document was not found.",

              user,

              operationalContext,

              flightId,

              currentView:
                "counter",
            });

            return;
          }

          setFlight({
            id:
              snap.id,

            ...snap.data(),
          });

          setLoadingFlight(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "Counter flight snapshot error:",
            error
          );

          setFlight(
            null
          );

          setLoadingFlight(
            false
          );

          logSystemIncident({
            module:
              "COUNTER",

            action:
              "LOAD_FLIGHT",

            status:
              "ERROR",

            severity:
              "HIGH",

            errorType:
              "FIRESTORE_SNAPSHOT",

            errorCode:
              getErrorCode(
                error
              ),

            message:
              getErrorMessage(
                error,
                "Unable to load flight."
              ),

            user,

            operationalContext,

            flightId,

            currentView:
              "counter",
          });
        }
      );

    return () =>
      unsub();
  }, [
    flightId,
    user,
    operationalContext,
  ]);

  /* =========================
     COUNTER SCANS
  ========================= */

  useEffect(() => {
    if (!flightId) {
      setRows([]);
      setLoadingRows(
        false
      );

      return undefined;
    }

    setLoadingRows(
      true
    );

    const ref =
      collection(
        db,
        "flights",
        flightId,
        "counterScans"
      );

    const unsub =
      onSnapshot(
        ref,

        (
          snap
        ) => {
          const list =
            snap.docs.map(
              (
                d
              ) => ({
                id:
                  d.id,

                ...d.data(),
              })
            );

          list.sort(
            (
              a,
              b
            ) => {
              const ta =
                a.createdAt
                  ?.seconds ||
                0;

              const tb =
                b.createdAt
                  ?.seconds ||
                0;

              return (
                tb -
                ta
              );
            }
          );

          setRows(
            list
          );

          setLoadingRows(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "Counter scans snapshot error:",
            error
          );

          setRows([]);

          setLoadingRows(
            false
          );

          logSystemIncident({
            module:
              "COUNTER",

            action:
              "LOAD_COUNTER_SCANS",

            status:
              "ERROR",

            severity:
              "HIGH",

            errorType:
              "FIRESTORE_SNAPSHOT",

            errorCode:
              getErrorCode(
                error
              ),

            message:
              getErrorMessage(
                error,
                "Unable to load Counter scans."
              ),

            user,

            operationalContext,

            flightId,

            currentView:
              "counter",
          });
        }
      );

    return () =>
      unsub();
  }, [
    flightId,
    user,
    operationalContext,
  ]);

  /* =========================
     BAGROOM MATCH SUBSCRIPTION
  ========================= */

  useEffect(() => {
    if (!flightId) {
      setBagroomRows(
        []
      );

      setLoadingBagroomRows(
        false
      );

      return undefined;
    }

    setLoadingBagroomRows(
      true
    );

    const ref =
      collection(
        db,
        "flights",
        flightId,
        "bagroomScans"
      );

    const unsub =
      onSnapshot(
        ref,

        (
          snap
        ) => {
          const list =
            snap.docs.map(
              (
                d
              ) => ({
                id:
                  d.id,

                ...d.data(),
              })
            );

          list.sort(
            (
              a,
              b
            ) => {
              const ta =
                a.createdAt
                  ?.seconds ||
                0;

              const tb =
                b.createdAt
                  ?.seconds ||
                0;

              return (
                tb -
                ta
              );
            }
          );

          setBagroomRows(
            list
          );

          setLoadingBagroomRows(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "Counter page Bagroom snapshot error:",
            error
          );

          setBagroomRows(
            []
          );

          setLoadingBagroomRows(
            false
          );

          logSystemIncident({
            module:
              "COUNTER",

            action:
              "LOAD_BAGROOM_MATCH",

            status:
              "ERROR",

            severity:
              "MEDIUM",

            errorType:
              "FIRESTORE_SNAPSHOT",

            errorCode:
              getErrorCode(
                error
              ),

            message:
              getErrorMessage(
                error,
                "Unable to load Bagroom matching data."
              ),

            user,

            operationalContext,

            flightId,

            currentView:
              "counter",
          });
        }
      );

    return () =>
      unsub();
  }, [
    flightId,
    user,
    operationalContext,
  ]);

  /* =========================
     FOCUS
  ========================= */

  useEffect(() => {
    inputRef.current
      ?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (
        timerRef.current
      ) {
        clearTimeout(
          timerRef.current
        );
      }
    };
  }, []);

  const isFlightLoaded =
    normalizeStatus(
      flight?.status
    ) ===
    "LOADED";

  /* =========================
     COUNTS
  ========================= */

  const bagroomTagSet =
    useMemo(() => {
      return new Set(
        bagroomRows
          .map(
            (
              row
            ) =>
              cleanTag(
                row.tag ||
                  row.id
              )
          )
          .filter(
            Boolean
          )
      );
    }, [
      bagroomRows,
    ]);

  const counterTagSet =
    useMemo(() => {
      return new Set(
        rows
          .map(
            (
              row
            ) =>
              cleanTag(
                row.tag ||
                  row.id
              )
          )
          .filter(
            Boolean
          )
      );
    }, [
      rows,
    ]);

  const counterReceivedCount =
    useMemo(() => {
      return rows.filter(
        (
          row
        ) => {
          const tag =
            cleanTag(
              row.tag ||
                row.id
            );

          return (
            tag &&
            bagroomTagSet.has(
              tag
            )
          );
        }
      ).length;
    }, [
      rows,
      bagroomTagSet,
    ]);

  const counterPendingCount =
    Math.max(
      0,
      rows.length -
        counterReceivedCount
    );

  const bagroomWithoutCounterCount =
    useMemo(() => {
      return bagroomRows.filter(
        (
          row
        ) => {
          const tag =
            cleanTag(
              row.tag ||
                row.id
            );

          return (
            tag &&
            !counterTagSet.has(
              tag
            )
          );
        }
      ).length;
    }, [
      bagroomRows,
      counterTagSet,
    ]);

  /* =========================
     VALIDATE OTHER FLIGHT
  ========================= */

  const validateOtherFlight =
    async (
      tag
    ) => {
      const tagRef =
        doc(
          db,
          "bagTags",
          tag
        );

      const snap =
        await getDoc(
          tagRef
        );

      if (
        !snap.exists()
      ) {
        return {
          ok:
            true,
        };
      }

      const existing =
        snap.data();

      const existingFlightId =
        existing
          ?.flightId ||
        existing
          ?.currentFlightId ||
        null;

      if (
        existingFlightId &&
        existingFlightId !==
          flightId
      ) {
        return {
          ok:
            false,

          message:
            `\u274C This bag tag belongs to another flight/date.\n\n` +
            `Current flight: ${
              flight
                ?.flightNumber ||
              flightId
            } (${
              flight
                ?.flightDate ||
              "-"
            })\n` +
            `Registered flight: ${
              existing
                .flightNumber ||
              existingFlightId
            } (${
              existing
                .flightDate ||
              "-"
            })\n\n` +
            `Do NOT accept this bag for this flight.`,

          existing,
        };
      }

      return {
        ok:
          true,
      };
    };

  /* =========================
     TRACKING EVENT
  ========================= */

  const saveTrackingEvent =
    async (
      tag
    ) => {
      const eventRef =
        doc(
          db,
          "bagTags",
          tag,
          "events",
          `counter_${Date.now()}`
        );

      await setDoc(
        eventRef,
        {
          type:
            "COUNTER_SCAN",

          location:
            "counter",

          message:
            `Bag tag created / scanned at counter \u00B7 ` +
            getBagTypeLabel(
              selectedBagType
            ),

          tag,

          bagType:
            selectedBagType,

          bagTypeLabel:
            getBagTypeLabel(
              selectedBagType
            ),

          flightId,

          flightNumber:
            flight
              ?.flightNumber ||
            null,

          flightDate:
            flight
              ?.flightDate ||
            null,

          gate:
            flight?.gate ||
            null,

          employeeFullName:
            operationalActor
              .fullName,

          operationalPosition:
            operationalActor
              .operationalPosition,

          operationalPositionLabel:
            operationalActor
              .operationalPositionLabel,

          createdAt:
            serverTimestamp(),

          createdBy:
            operationalActor,
        }
      );
    };

  /* =========================
     SAVE COUNTER SCAN
  ========================= */

  const saveCounterScan =
    async (
      tag
    ) => {
      const ref =
        doc(
          db,
          "flights",
          flightId,
          "counterScans",
          tag
        );

      const existing =
        await getDoc(
          ref
        );

      if (
        existing.exists()
      ) {
        const message =
          `Duplicate scan. Bag tag ${tag} was already scanned at Counter.`;

        setErr(
          message
        );

        setTagInput(
          ""
        );

        await logCounterIncident({
          action:
            "BAG_SCAN",

          status:
            "WARNING",

          severity:
            "LOW",

          errorType:
            "DUPLICATE_SCAN",

          message,

          tag,

          metadata: {
            bagType:
              selectedBagType,

            bagTypeLabel:
              getBagTypeLabel(
                selectedBagType
              ),
          },
        });

        return false;
      }

      await setDoc(
        ref,
        {
          tag,

          location:
            "counter",

          bagType:
            selectedBagType,

          bagTypeLabel:
            getBagTypeLabel(
              selectedBagType
            ),

          employeeFullName:
            operationalActor
              .fullName,

          operationalPosition:
            operationalActor
              .operationalPosition,

          operationalPositionLabel:
            operationalActor
              .operationalPositionLabel,

          createdAt:
            serverTimestamp(),

          scannedBy:
            operationalActor,
        }
      );

      await setDoc(
        doc(
          db,
          "bagTags",
          tag
        ),
        {
          tag,

          flightId,

          currentFlightId:
            flightId,

          flightNumber:
            flight
              ?.flightNumber ||
            null,

          currentFlightNumber:
            flight
              ?.flightNumber ||
            null,

          flightDate:
            flight
              ?.flightDate ||
            null,

          gate:
            flight?.gate ||
            null,

          bagType:
            selectedBagType,

          bagTypeLabel:
            getBagTypeLabel(
              selectedBagType
            ),

          employeeFullName:
            operationalActor
              .fullName,

          operationalPosition:
            operationalActor
              .operationalPosition,

          operationalPositionLabel:
            operationalActor
              .operationalPositionLabel,

          firstSeenAt:
            serverTimestamp(),

          lastSeenAt:
            serverTimestamp(),

          lastSeenLocation:
            "counter",

          lastSeenBy:
            operationalActor,
        },
        {
          merge:
            true,
        }
      );

      await saveTrackingEvent(
        tag
      );

      return true;
    };

  /* =========================
     DELETE COUNTER SCAN
  ========================= */

  const deleteCounterScan =
    async (
      row
    ) => {
      const tag =
        cleanTag(
          row?.tag ||
            row?.id
        );

      if (!tag) {
        return;
      }

      if (
        !canDeleteScans
      ) {
        const message =
          "You do not have permission to delete Counter scans.";

        setErr(
          message
        );

        await logCounterIncident({
          action:
            "DELETE_COUNTER_SCAN",

          status:
            "WARNING",

          severity:
            "MEDIUM",

          errorType:
            "NO_PERMISSION",

          message,

          tag,
        });

        return;
      }

      if (
        isFlightLoaded
      ) {
        const message =
          "This flight is already LOADED. Counter scans are locked.";

        setErr(
          message
        );

        await logCounterIncident({
          action:
            "DELETE_COUNTER_SCAN",

          status:
            "WARNING",

          severity:
            "LOW",

          errorType:
            "FLIGHT_LOCKED",

          message,

          tag,
        });

        return;
      }

      const confirmed =
        window.confirm(
          `Delete Counter scan?\n\nBag Tag: ${tag}\n\nThis action cannot be undone.`
        );

      if (
        !confirmed
      ) {
        return;
      }

      const timer =
        startSystemTimer();

      try {
        setDeletingCounterTag(
          tag
        );

        setErr("");
        setMsg("");

        await deleteDoc(
          doc(
            db,
            "flights",
            flightId,
            "counterScans",
            tag
          )
        );

        const bagroomSnap =
          await getDoc(
            doc(
              db,
              "flights",
              flightId,
              "bagroomScans",
              tag
            )
          );

        const aircraftSnap =
          await getDoc(
            doc(
              db,
              "flights",
              flightId,
              "aircraftScans",
              tag
            )
          );

        if (
          !bagroomSnap.exists() &&
          !aircraftSnap.exists()
        ) {
          await deleteDoc(
            doc(
              db,
              "bagTags",
              tag
            )
          );
        }

        setMsg(
          `Counter scan deleted \u2705 ${tag}`
        );

        await logSystemSuccess({
          module:
            "COUNTER",

          action:
            "DELETE_COUNTER_SCAN",

          durationMs:
            timer.elapsed(),
        });
      } catch (
        error
      ) {
        console.error(
          "Delete Counter scan error:",
          error
        );

        const message =
          "Could not delete Counter scan. Check Firestore rules/connection.";

        setErr(
          message
        );

        await logCounterIncident({
          action:
            "DELETE_COUNTER_SCAN",

          status:
            "ERROR",

          severity:
            "HIGH",

          errorType:
            "FIRESTORE_DELETE",

          errorCode:
            getErrorCode(
              error
            ),

          message:
            getErrorMessage(
              error,
              message
            ),

          tag,

          durationMs:
            timer.elapsed(),
        });
      } finally {
        setDeletingCounterTag(
          ""
        );
      }
    };

  /* =========================
     DELETE BAGROOM SCAN
  ========================= */

  const deleteBagroomScan =
    async (
      row
    ) => {
      const tag =
        cleanTag(
          row?.tag ||
            row?.id
        );

      if (!tag) {
        return;
      }

      if (
        !canDeleteScans
      ) {
        const message =
          "You do not have permission to delete Bagroom scans.";

        setErr(
          message
        );

        await logCounterIncident({
          action:
            "DELETE_BAGROOM_SCAN",

          status:
            "WARNING",

          severity:
            "MEDIUM",

          errorType:
            "NO_PERMISSION",

          message,

          tag,
        });

        return;
      }

      if (
        isFlightLoaded
      ) {
        const message =
          "This flight is already LOADED. Bagroom scans are locked.";

        setErr(
          message
        );

        await logCounterIncident({
          action:
            "DELETE_BAGROOM_SCAN",

          status:
            "WARNING",

          severity:
            "LOW",

          errorType:
            "FLIGHT_LOCKED",

          message,

          tag,
        });

        return;
      }

      const confirmed =
        window.confirm(
          `Delete Bagroom scan?\n\nBag Tag: ${tag}\n` +
            `Cart: ${
              row?.cartNumber ||
              "-"
            }\n\n` +
            `This action cannot be undone.`
        );

      if (
        !confirmed
      ) {
        return;
      }

      const timer =
        startSystemTimer();

      try {
        setDeletingBagroomTag(
          tag
        );

        setErr("");
        setMsg("");

        await deleteDoc(
          doc(
            db,
            "flights",
            flightId,
            "bagroomScans",
            tag
          )
        );

        const counterSnap =
          await getDoc(
            doc(
              db,
              "flights",
              flightId,
              "counterScans",
              tag
            )
          );

        const aircraftSnap =
          await getDoc(
            doc(
              db,
              "flights",
              flightId,
              "aircraftScans",
              tag
            )
          );

        if (
          !aircraftSnap.exists() &&
          counterSnap.exists()
        ) {
          const counterData =
            counterSnap.data();

          await setDoc(
            doc(
              db,
              "bagTags",
              tag
            ),
            {
              tag,

              flightId,

              currentFlightId:
                flightId,

              flightNumber:
                flight
                  ?.flightNumber ||
                null,

              currentFlightNumber:
                flight
                  ?.flightNumber ||
                null,

              flightDate:
                flight
                  ?.flightDate ||
                null,

              gate:
                flight?.gate ||
                null,

              bagType:
                counterData
                  ?.bagType ||
                "CHECKED_BAG",

              bagTypeLabel:
                counterData
                  ?.bagTypeLabel ||
                getBagTypeLabel(
                  counterData
                    ?.bagType
                ),

              lastSeenAt:
                counterData
                  ?.createdAt ||
                serverTimestamp(),

              lastSeenLocation:
                "counter",

              lastSeenCart:
                null,

              lastSeenBy:
                counterData
                  ?.scannedBy ||
                null,
            },
            {
              merge:
                true,
            }
          );
        }

        if (
          !aircraftSnap.exists() &&
          !counterSnap.exists()
        ) {
          await deleteDoc(
            doc(
              db,
              "bagTags",
              tag
            )
          );
        }

        setMsg(
          `Bagroom scan deleted \u2705 ${tag}`
        );

        await logSystemSuccess({
          module:
            "COUNTER",

          action:
            "DELETE_BAGROOM_SCAN",

          durationMs:
            timer.elapsed(),
        });
      } catch (
        error
      ) {
        console.error(
          "Delete Bagroom scan error:",
          error
        );

        const message =
          "Could not delete Bagroom scan. Check Firestore rules/connection.";

        setErr(
          message
        );

        await logCounterIncident({
          action:
            "DELETE_BAGROOM_SCAN",

          status:
            "ERROR",

          severity:
            "HIGH",

          errorType:
            "FIRESTORE_DELETE",

          errorCode:
            getErrorCode(
              error
            ),

          message:
            getErrorMessage(
              error,
              message
            ),

          tag,

          durationMs:
            timer.elapsed(),
        });
      } finally {
        setDeletingBagroomTag(
          ""
        );
      }
    };

  /* =========================
     SCAN SUBMIT
  ========================= */

  const handleScanSubmit =
    async (
      forcedValue
    ) => {
      if (
        savingRef.current
      ) {
        return;
      }

      setMsg("");
      setErr("");

      const timer =
        startSystemTimer();

      if (!flight) {
        const message =
          "Flight not loaded.";

        setErr(
          message
        );

        await logCounterIncident({
          action:
            "BAG_SCAN",

          status:
            "ERROR",

          severity:
            "HIGH",

          errorType:
            "FLIGHT_NOT_AVAILABLE",

          message,

          durationMs:
            timer.elapsed(),
        });

        return;
      }

      if (
        isFlightLoaded
      ) {
        const message =
          "This flight is already LOADED. Counter scan is locked.";

        setErr(
          message
        );

        setTagInput(
          ""
        );

        await logCounterIncident({
          action:
            "BAG_SCAN",

          status:
            "WARNING",

          severity:
            "LOW",

          errorType:
            "FLIGHT_LOCKED",

          message,

          durationMs:
            timer.elapsed(),
        });

        return;
      }

      const tag =
        cleanTag(
          forcedValue ??
            tagInput
        );

      if (!tag) {
        return;
      }

      if (
        tag.length !==
        MIN_TAG
      ) {
        const message =
          "Invalid bag tag. Bag tag must have exactly 10 digits.";

        setErr(
          message
        );

        await logCounterIncident({
          action:
            "BAG_SCAN",

          status:
            "WARNING",

          severity:
            "LOW",

          errorType:
            "INVALID_TAG",

          message,

          tag,

          durationMs:
            timer.elapsed(),

          metadata: {
            receivedLength:
              tag.length,

            requiredLength:
              MIN_TAG,
          },
        });

        return;
      }

      try {
        savingRef.current =
          true;

        const check =
          await validateOtherFlight(
            tag
          );

        if (
          !check.ok
        ) {
          setErr(
            check.message
          );

          setTagInput(
            ""
          );

          await logCounterIncident({
            action:
              "BAG_SCAN",

            status:
              "WARNING",

            severity:
              "HIGH",

            errorType:
              "WRONG_FLIGHT",

            message:
              check.message,

            tag,

            durationMs:
              timer.elapsed(),

            metadata: {
              registeredFlightId:
                check
                  ?.existing
                  ?.flightId ||
                check
                  ?.existing
                  ?.currentFlightId ||
                null,

              registeredFlightNumber:
                check
                  ?.existing
                  ?.flightNumber ||
                null,

              registeredFlightDate:
                check
                  ?.existing
                  ?.flightDate ||
                null,
            },
          });

          return;
        }

        const saved =
          await saveCounterScan(
            tag
          );

        if (!saved) {
          return;
        }

        const durationMs =
          timer.elapsed();

        setMsg(
          `Counter scan saved \u2705 ${tag} \u00B7 ${getBagTypeLabel(
            selectedBagType
          )}`
        );

        setTagInput(
          ""
        );

        await logSystemSuccess({
          module:
            "COUNTER",

          action:
            "BAG_SCAN",

          durationMs,
        });

        inputRef.current
          ?.focus();
      } catch (
        error
      ) {
        console.error(
          "Counter scan error:",
          error
        );

        const message =
          "Could not save Counter scan. Check Firestore rules/connection.";

        setErr(
          message
        );

        setTagInput(
          ""
        );

        await logCounterIncident({
          action:
            "BAG_SCAN",

          status:
            "ERROR",

          severity:
            "HIGH",

          errorType:
            "FIRESTORE_WRITE",

          errorCode:
            getErrorCode(
              error
            ),

          message:
            getErrorMessage(
              error,
              message
            ),

          tag,

          durationMs:
            timer.elapsed(),

          metadata: {
            bagType:
              selectedBagType,

            bagTypeLabel:
              getBagTypeLabel(
                selectedBagType
              ),
          },
        });
      } finally {
        savingRef.current =
          false;

        inputRef.current
          ?.focus();
      }
    };

  /* =========================
     AUTO SUBMIT
  ========================= */

  const scheduleAutoSubmit =
    (
      value
    ) => {
      if (
        timerRef.current
      ) {
        clearTimeout(
          timerRef.current
        );
      }

      const cleaned =
        cleanTag(
          value
        );

      timerRef.current =
        setTimeout(
          () => {
            if (
              cleaned.length ===
              MIN_TAG
            ) {
              handleScanSubmit(
                cleaned
              );
            }
          },
          AUTO_SUBMIT_MS
        );
    };

  const handleChange =
    (
      event
    ) => {
      const value =
        cleanTag(
          event.target
            .value
        ).slice(
          0,
          MIN_TAG
        );

      setTagInput(
        value
      );

      setErr("");

      if (
        !isFlightLoaded
      ) {
        scheduleAutoSubmit(
          value
        );
      }
    };

  const handleKeyDown =
    (
      event
    ) => {
      if (
        event.key ===
          "Enter" ||
        event.key ===
          "Tab"
      ) {
        event.preventDefault();

        if (
          timerRef.current
        ) {
          clearTimeout(
            timerRef.current
          );

          timerRef.current =
            null;
        }

        handleScanSubmit(
          event
            .currentTarget
            .value
        );
      }
    };

  /* =========================
     RENDER
  ========================= */

  return (
    <div
      style={{
        background:
          "white",

        border:
          "1px solid #e5e7eb",

        borderRadius:
          isMobile
            ? 14
            : 12,

        padding:
          isMobile
            ? 10
            : 16,
      }}
    >
      <div
        style={{
          display:
            "flex",

          flexDirection:
            isMobile
              ? "column"
              : "row",

          justifyContent:
            "space-between",

          gap:
            isMobile
              ? 8
              : 12,

          flexWrap:
            "wrap",
        }}
      >
        <div>
          <h2
            style={{
              margin:
                0,

              fontSize:
                isMobile
                  ? "1.3rem"
                  : "1.5rem",
            }}
          >
            Counter Scan
          </h2>

          <p
            style={{
              marginTop:
                5,

              marginBottom:
                0,

              color:
                "#6b7280",

              fontSize:
                isMobile
                  ? "0.82rem"
                  : "0.9rem",
            }}
          >
            Scan or enter bag tags created at the ticket counter.
          </p>

          <div
            style={{
              marginTop:
                7,

              display:
                "inline-flex",

              alignItems:
                "center",

              gap:
                5,

              padding:
                "5px 8px",

              borderRadius:
                999,

              background:
                "#eff6ff",

              border:
                "1px solid #bfdbfe",

              color:
                "#1d4ed8",

              fontWeight:
                900,

              fontSize:
                "0.72rem",
            }}
          >
            Working as:{" "}
            {
              operationalActor
                .operationalPositionLabel
            }
          </div>

          {isFlightLoaded && (
            <div
              style={{
                marginTop:
                  8,

                display:
                  "inline-flex",

                alignItems:
                  "center",

                padding:
                  "6px 9px",

                borderRadius:
                  999,

                background:
                  "#dcfce7",

                border:
                  "1px solid #86efac",

                color:
                  "#166534",

                fontWeight:
                  900,

                fontSize:
                  "0.78rem",
              }}
            >
              {"\u2705 Flight Loaded \u00B7 Counter locked"}
            </div>
          )}
        </div>

        <div
          style={{
            textAlign:
              isMobile
                ? "left"
                : "right",

            fontSize:
              "0.82rem",

            display:
              "flex",

            gap:
              10,

            flexWrap:
              "wrap",

            color:
              "#475569",
          }}
        >
          <span>
            Flight:{" "}
            <strong
              style={{
                color:
                  "#0f172a",
              }}
            >
              {loadingFlight
                ? "\u2026"
                : flight
                    ?.flightNumber ||
                  flightId}
            </strong>
          </span>

          <span>
            Date:{" "}
            <strong
              style={{
                color:
                  "#0f172a",
              }}
            >
              {loadingFlight
                ? "\u2026"
                : flight
                    ?.flightDate ||
                  "-"}
            </strong>
          </span>

          <span>
            Gate:{" "}
            <strong
              style={{
                color:
                  "#0f172a",
              }}
            >
              {loadingFlight
                ? "\u2026"
                : flight?.gate ||
                  "-"}
            </strong>
          </span>
        </div>
      </div>

      <hr
        style={{
          border:
            "none",

          borderTop:
            "1px solid #e5e7eb",

          margin:
            isMobile
              ? "10px 0"
              : "14px 0",
        }}
      />

      <div
        style={{
          display:
            "grid",

          gridTemplateColumns:
            isMobile
              ? "1fr"
              : "minmax(320px, 0.9fr) minmax(0, 1.4fr)",

          gap:
            isMobile
              ? 10
              : 12,

          alignItems:
            "start",
        }}
      >
        {/* =========================
            SCANNER
        ========================= */}

        <section
          style={{
            border:
              "1px solid #e5e7eb",

            borderRadius:
              12,

            padding:
              isMobile
                ? 10
                : 12,

            background:
              "#f9fafb",

            position:
              isMobile
                ? "sticky"
                : "static",

            top:
              isMobile
                ? 0
                : "auto",

            zIndex:
              isMobile
                ? 3
                : "auto",

            boxShadow:
              isMobile
                ? "0 8px 18px rgba(15,23,42,0.06)"
                : "none",
          }}
        >
          <div
            style={{
              display:
                "flex",

              justifyContent:
                "space-between",

              alignItems:
                "center",

              gap:
                8,

              marginBottom:
                10,
            }}
          >
            <h3
              style={{
                margin:
                  0,

                fontSize:
                  isMobile
                    ? "1rem"
                    : "1.08rem",
              }}
            >
              Scan Bag Tag
            </h3>

            <span
              style={{
                padding:
                  "4px 8px",

                borderRadius:
                  999,

                background:
                  "#eff6ff",

                color:
                  "#1d4ed8",

                border:
                  "1px solid #bfdbfe",

                fontWeight:
                  900,

                fontSize:
                  "0.72rem",
              }}
            >
              {getBagTypeLabel(
                selectedBagType
              )}
            </span>
          </div>

          <label
            style={{
              display:
                "block",

              fontSize:
                "0.78rem",

              color:
                "#374151",

              marginBottom:
                5,

              fontWeight:
                800,
            }}
          >
            Bag Type
          </label>

          <select
            value={
              selectedBagType
            }
            onChange={(
              event
            ) => {
              const next =
                normalizeBagType(
                  event
                    .target
                    .value
                );

              setBagType(
                next
              );

              localStorage.setItem(
                `counterBagType_${flightId}`,
                next
              );

              inputRef.current
                ?.focus();
            }}
            disabled={
              isFlightLoaded
            }
            style={{
              width:
                "100%",

              minHeight:
                isMobile
                  ? 52
                  : 46,

              padding:
                "10px 12px",

              borderRadius:
                12,

              border:
                "1px solid #cbd5e1",

              background:
                isFlightLoaded
                  ? "#f3f4f6"
                  : "white",

              fontWeight:
                900,

              fontSize:
                isMobile
                  ? "1rem"
                  : "0.9rem",

              marginBottom:
                10,
            }}
          >
            <option value="CHECKED_BAG">
              Checked Bag
            </option>

            <option value="GATE_CHECK">
              Gate Check
            </option>

            <option value="OVERSIZE">
              Oversize
            </option>
          </select>

          <label
            style={{
              display:
                "block",

              fontSize:
                "0.78rem",

              color:
                "#374151",

              marginBottom:
                5,

              fontWeight:
                800,
            }}
          >
            Bag Tag Number
          </label>

          <input
            ref={
              inputRef
            }

            value={
              tagInput
            }

            onChange={
              handleChange
            }

            onKeyDown={
              handleKeyDown
            }

            inputMode="numeric"

            pattern="[0-9]*"

            autoComplete="off"

            maxLength={
              MIN_TAG
            }

            disabled={
              isFlightLoaded
            }

            placeholder={
              isFlightLoaded
                ? "Flight loaded / locked"
                : "Scan bag tag\u2026"
            }

            style={{
              width:
                "100%",

              minHeight:
                isMobile
                  ? 58
                  : 48,

              padding:
                "10px 12px",

              borderRadius:
                12,

              border:
                tagInput.length ===
                MIN_TAG
                  ? "2px solid #16a34a"
                  : "2px solid #60a5fa",

              background:
                isFlightLoaded
                  ? "#f3f4f6"
                  : "white",

              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",

              fontSize:
                isMobile
                  ? "1.08rem"
                  : "0.95rem",

              boxSizing:
                "border-box",

              outline:
                "none",
            }}
          />

          <div
            style={{
              marginTop:
                5,

              textAlign:
                "right",

              color:
                tagInput.length ===
                MIN_TAG
                  ? "#16a34a"
                  : "#64748b",

              fontWeight:
                800,

              fontSize:
                "0.72rem",
            }}
          >
            {tagInput.length}/
            {MIN_TAG}
          </div>

          <button
            type="button"
            onClick={() =>
              handleScanSubmit()
            }
            disabled={
              isFlightLoaded
            }
            style={{
              width:
                "100%",

              minHeight:
                isMobile
                  ? 54
                  : 46,

              marginTop:
                9,

              padding:
                "10px 12px",

              borderRadius:
                12,

              border:
                "1px solid #2563eb",

              background:
                isFlightLoaded
                  ? "#93c5fd"
                  : "#2563eb",

              color:
                "white",

              fontWeight:
                900,

              fontSize:
                isMobile
                  ? "0.98rem"
                  : "0.9rem",

              cursor:
                isFlightLoaded
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            Add Counter Scan
          </button>

          <p
            style={{
              marginTop:
                8,

              marginBottom:
                0,

              color:
                "#6b7280",

              fontSize:
                "0.74rem",

              lineHeight:
                1.4,
            }}
          >
            Scanner saves automatically after reading the 10-digit bag tag.
          </p>

          {msg && (
            <div
              style={{
                marginTop:
                  8,

                padding:
                  "8px 10px",

                borderRadius:
                  10,

                background:
                  "#f0fdf4",

                border:
                  "1px solid #bbf7d0",

                color:
                  "#166534",

                fontWeight:
                  900,

                fontSize:
                  "0.8rem",
              }}
            >
              {msg}
            </div>
          )}

          {err && (
            <div
              style={{
                marginTop:
                  8,

                padding:
                  "8px 10px",

                borderRadius:
                  10,

                background:
                  "#fef2f2",

                border:
                  "1px solid #fecaca",

                color:
                  "#b91c1c",

                fontWeight:
                  900,

                fontSize:
                  "0.8rem",

                whiteSpace:
                  "pre-wrap",
              }}
            >
              {err}
            </div>
          )}
        </section>

        {/* =========================
            MATCHING
        ========================= */}

        <section
          style={{
            border:
              "1px solid #e5e7eb",

            borderRadius:
              12,

            padding:
              isMobile
                ? 10
                : 12,
          }}
        >
          <h3
            style={{
              marginTop:
                0,

              marginBottom:
                8,
            }}
          >
            {"Counter \u2192 Bagroom Match"}
          </h3>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",

              gap:
                7,

              marginTop:
                8,
            }}
          >
            <SummaryBox
              label="Counter"
              value={
                loadingRows
                  ? "\u2026"
                  : rows.length
              }
              background="#eff6ff"
              color="#1d4ed8"
              compact={
                isMobile
              }
            />

            <SummaryBox
              label="Received"
              value={
                loadingRows ||
                loadingBagroomRows
                  ? "\u2026"
                  : counterReceivedCount
              }
              background="#dcfce7"
              color="#166534"
              compact={
                isMobile
              }
            />

            <SummaryBox
              label="Pending"
              value={
                loadingRows ||
                loadingBagroomRows
                  ? "\u2026"
                  : counterPendingCount
              }
              background={
                counterPendingCount ===
                0
                  ? "#dcfce7"
                  : "#fee2e2"
              }
              color={
                counterPendingCount ===
                0
                  ? "#166534"
                  : "#991b1b"
              }
              compact={
                isMobile
              }
            />
          </div>

          <p
            style={{
              color:
                "#6b7280",

              fontSize:
                "0.75rem",

              marginTop:
                8,

              marginBottom:
                8,
            }}
          >
            {"Green = received in Bagroom \u00B7 Red = still pending"}
          </p>

          {loadingRows ||
          loadingBagroomRows ? (
            <p
              style={{
                color:
                  "#6b7280",
              }}
            >
              {"Loading Counter and Bagroom scans\u2026"}
            </p>
          ) : rows.length ===
            0 ? (
            <p
              style={{
                color:
                  "#6b7280",
              }}
            >
              No Counter scans yet.
            </p>
          ) : isMobile ? (
            <div
              style={{
                display:
                  "grid",

                gap:
                  8,

                maxHeight:
                  440,

                overflow:
                  "auto",
              }}
            >
              {rows.map(
                (
                  row
                ) => {
                  const tag =
                    cleanTag(
                      row.tag ||
                        row.id
                    );

                  const received =
                    bagroomTagSet.has(
                      tag
                    );

                  const busy =
                    deletingCounterTag ===
                    tag;

                  return (
                    <div
                      key={
                        row.id
                      }
                      style={{
                        border:
                          `1px solid ${
                            received
                              ? "#86efac"
                              : "#fca5a5"
                          }`,

                        borderLeft:
                          `6px solid ${
                            received
                              ? "#22c55e"
                              : "#ef4444"
                          }`,

                        borderRadius:
                          12,

                        padding:
                          10,

                        background:
                          received
                            ? "#f0fdf4"
                            : "#fef2f2",
                      }}
                    >
                      <div
                        style={{
                          display:
                            "flex",

                          justifyContent:
                            "space-between",

                          alignItems:
                            "start",

                          gap:
                            8,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",

                              fontSize:
                                "0.98rem",

                              fontWeight:
                                900,

                              color:
                                received
                                  ? "#166534"
                                  : "#991b1b",
                            }}
                          >
                            {tag}
                          </div>

                          <div
                            style={{
                              marginTop:
                                4,

                              color:
                                "#475569",

                              fontSize:
                                "0.76rem",
                            }}
                          >
                            {row.bagTypeLabel ||
                              getBagTypeLabel(
                                row.bagType
                              )}

                            {" \u00B7 "}

                            {row
                              .scannedBy
                              ?.fullName ||
                              row
                                .scannedBy
                                ?.username ||
                              "-"}

                            {row
                              .scannedBy
                              ?.operationalPositionLabel
                              ? ` - ${row.scannedBy.operationalPositionLabel}`
                              : ""}
                          </div>
                        </div>

                        <span
                          style={{
                            display:
                              "inline-flex",

                            padding:
                              "4px 8px",

                            borderRadius:
                              999,

                            background:
                              received
                                ? "#dcfce7"
                                : "#fee2e2",

                            color:
                              received
                                ? "#166534"
                                : "#991b1b",

                            border:
                              `1px solid ${
                                received
                                  ? "#86efac"
                                  : "#fca5a5"
                              }`,

                            fontSize:
                              "0.7rem",

                            fontWeight:
                              900,
                          }}
                        >
                          {received
                            ? "RECEIVED"
                            : "PENDING"}
                        </span>
                      </div>

                      {canDeleteScans && (
                        <button
                          type="button"
                          onClick={() =>
                            deleteCounterScan(
                              row
                            )
                          }
                          disabled={
                            busy ||
                            isFlightLoaded
                          }
                          style={{
                            width:
                              "100%",

                            minHeight:
                              40,

                            marginTop:
                              9,

                            borderRadius:
                              10,

                            border:
                              "1px solid #ef4444",

                            background:
                              busy ||
                              isFlightLoaded
                                ? "#fca5a5"
                                : "#ef4444",

                            color:
                              "white",

                            fontWeight:
                              900,

                            cursor:
                              busy ||
                              isFlightLoaded
                                ? "not-allowed"
                                : "pointer",
                          }}
                        >
                          {busy
                            ? "Deleting\u2026"
                            : "Delete Counter Scan"}
                        </button>
                      )}
                    </div>
                  );
                }
              )}
            </div>
          ) : (
            <div
              style={{
                maxHeight:
                  360,

                overflow:
                  "auto",

                marginTop:
                  8,
              }}
            >
              <table
                style={{
                  width:
                    "100%",

                  borderCollapse:
                    "collapse",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background:
                        "#f9fafb",
                    }}
                  >
                    <th style={th}>
                      Bag Tag
                    </th>

                    <th style={th}>
                      Type
                    </th>

                    <th style={th}>
                      Status
                    </th>

                    <th style={th}>
                      User
                    </th>

                    <th
                      style={{
                        ...th,
                        textAlign:
                          "right",
                      }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map(
                    (
                      row
                    ) => {
                      const tag =
                        cleanTag(
                          row.tag ||
                            row.id
                        );

                      const received =
                        bagroomTagSet.has(
                          tag
                        );

                      const busy =
                        deletingCounterTag ===
                        tag;

                      return (
                        <tr
                          key={
                            row.id
                          }
                          style={{
                            background:
                              received
                                ? "#f0fdf4"
                                : "#fef2f2",
                          }}
                        >
                          <td style={td}>
                            <strong
                              style={{
                                color:
                                  received
                                    ? "#166534"
                                    : "#991b1b",
                              }}
                            >
                              {tag}
                            </strong>
                          </td>

                          <td style={td}>
                            {row.bagTypeLabel ||
                              getBagTypeLabel(
                                row.bagType
                              )}
                          </td>

                          <td style={td}>
                            <span
                              style={{
                                display:
                                  "inline-flex",

                                padding:
                                  "4px 8px",

                                borderRadius:
                                  999,

                                background:
                                  received
                                    ? "#dcfce7"
                                    : "#fee2e2",

                                color:
                                  received
                                    ? "#166534"
                                    : "#991b1b",

                                border:
                                  `1px solid ${
                                    received
                                      ? "#86efac"
                                      : "#fca5a5"
                                  }`,

                                fontSize:
                                  "0.75rem",

                                fontWeight:
                                  900,
                              }}
                            >
                              {received
                                ? "RECEIVED"
                                : "PENDING"}
                            </span>
                          </td>

                          <td
                            style={{
                              ...td,
                              color:
                                "#6b7280",
                            }}
                          >
                            {row
                              .scannedBy
                              ?.fullName ||
                              row
                                .scannedBy
                                ?.username ||
                              "-"}

                            {row
                              .scannedBy
                              ?.operationalPositionLabel
                              ? ` - ${row.scannedBy.operationalPositionLabel}`
                              : ""}
                          </td>

                          <td
                            style={{
                              ...td,
                              textAlign:
                                "right",
                            }}
                          >
                            {canDeleteScans && (
                              <button
                                type="button"
                                onClick={() =>
                                  deleteCounterScan(
                                    row
                                  )
                                }
                                disabled={
                                  busy ||
                                  isFlightLoaded
                                }
                                style={deleteButtonStyle(
                                  busy ||
                                    isFlightLoaded
                                )}
                              >
                                {busy
                                  ? "Deleting\u2026"
                                  : "Delete"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}

          <hr
            style={{
              border:
                "none",

              borderTop:
                "1px solid #e5e7eb",

              margin:
                "14px 0",
            }}
          />

          <h3
            style={{
              margin:
                0,
            }}
          >
            Bagroom Received
          </h3>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "repeat(2, minmax(0, 1fr))",

              gap:
                7,

              marginTop:
                9,
            }}
          >
            <SummaryBox
              label="Bagroom Total"
              value={
                loadingBagroomRows
                  ? "\u2026"
                  : bagroomRows.length
              }
              background="#dcfce7"
              color="#166534"
              compact={
                isMobile
              }
            />

            <SummaryBox
              label="Without Counter"
              value={
                loadingRows ||
                loadingBagroomRows
                  ? "\u2026"
                  : bagroomWithoutCounterCount
              }
              background={
                bagroomWithoutCounterCount ===
                0
                  ? "#f9fafb"
                  : "#ffedd5"
              }
              color={
                bagroomWithoutCounterCount ===
                0
                  ? "#374151"
                  : "#9a3412"
              }
              compact={
                isMobile
              }
            />
          </div>

          <p
            style={{
              color:
                "#6b7280",

              fontSize:
                "0.75rem",

              marginTop:
                8,

              marginBottom:
                8,
            }}
          >
            Orange = received in Bagroom without a matching Counter scan.
          </p>

          {loadingBagroomRows ? (
            <p
              style={{
                color:
                  "#6b7280",
              }}
            >
              {"Loading Bagroom scans\u2026"}
            </p>
          ) : bagroomRows.length ===
            0 ? (
            <p
              style={{
                color:
                  "#6b7280",
              }}
            >
              No bags received yet.
            </p>
          ) : isMobile ? (
            <div
              style={{
                display:
                  "grid",

                gap:
                  8,

                maxHeight:
                  340,

                overflow:
                  "auto",
              }}
            >
              {bagroomRows.map(
                (
                  row
                ) => {
                  const tag =
                    cleanTag(
                      row.tag ||
                        row.id
                    );

                  const existsAtCounter =
                    counterTagSet.has(
                      tag
                    );

                  const busy =
                    deletingBagroomTag ===
                    tag;

                  return (
                    <div
                      key={
                        row.id
                      }
                      style={{
                        border:
                          `1px solid ${
                            existsAtCounter
                              ? "#86efac"
                              : "#fdba74"
                          }`,

                        borderLeft:
                          `6px solid ${
                            existsAtCounter
                              ? "#22c55e"
                              : "#f97316"
                          }`,

                        borderRadius:
                          12,

                        padding:
                          10,

                        background:
                          existsAtCounter
                            ? "#f0fdf4"
                            : "#fff7ed",
                      }}
                    >
                      <div
                        style={{
                          display:
                            "flex",

                          justifyContent:
                            "space-between",

                          alignItems:
                            "start",

                          gap:
                            8,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",

                              fontSize:
                                "0.96rem",

                              fontWeight:
                                900,

                              color:
                                "#0f172a",
                            }}
                          >
                            {tag}
                          </div>

                          <div
                            style={{
                              marginTop:
                                4,

                              color:
                                "#475569",

                              fontSize:
                                "0.75rem",
                            }}
                          >
                            Cart{" "}
                            {row.cartNumber ||
                              "-"}

                            {" \u00B7 "}

                            {row
                              .scannedBy
                              ?.fullName ||
                              row
                                .scannedBy
                                ?.username ||
                              "-"}

                            {row
                              .scannedBy
                              ?.operationalPositionLabel
                              ? ` - ${row.scannedBy.operationalPositionLabel}`
                              : ""}
                          </div>
                        </div>

                        <span
                          style={{
                            display:
                              "inline-flex",

                            padding:
                              "4px 8px",

                            borderRadius:
                              999,

                            background:
                              existsAtCounter
                                ? "#dcfce7"
                                : "#ffedd5",

                            color:
                              existsAtCounter
                                ? "#166534"
                                : "#9a3412",

                            border:
                              `1px solid ${
                                existsAtCounter
                                  ? "#86efac"
                                  : "#fdba74"
                              }`,

                            fontSize:
                              "0.68rem",

                            fontWeight:
                              900,
                          }}
                        >
                          {existsAtCounter
                            ? "MATCHED"
                            : "NO COUNTER"}
                        </span>
                      </div>

                      {canDeleteScans && (
                        <button
                          type="button"
                          onClick={() =>
                            deleteBagroomScan(
                              row
                            )
                          }
                          disabled={
                            busy ||
                            isFlightLoaded
                          }
                          style={{
                            width:
                              "100%",

                            minHeight:
                              40,

                            marginTop:
                              9,

                            borderRadius:
                              10,

                            border:
                              "1px solid #ef4444",

                            background:
                              busy ||
                              isFlightLoaded
                                ? "#fca5a5"
                                : "#ef4444",

                            color:
                              "white",

                            fontWeight:
                              900,

                            cursor:
                              busy ||
                              isFlightLoaded
                                ? "not-allowed"
                                : "pointer",
                          }}
                        >
                          {busy
                            ? "Deleting\u2026"
                            : "Delete Bagroom Scan"}
                        </button>
                      )}
                    </div>
                  );
                }
              )}
            </div>
          ) : (
            <div
              style={{
                maxHeight:
                  280,

                overflow:
                  "auto",

                marginTop:
                  8,
              }}
            >
              <table
                style={{
                  width:
                    "100%",

                  borderCollapse:
                    "collapse",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background:
                        "#f9fafb",
                    }}
                  >
                    <th style={th}>
                      Bag Tag
                    </th>

                    <th style={th}>
                      Cart
                    </th>

                    <th style={th}>
                      Match
                    </th>

                    <th style={th}>
                      User
                    </th>

                    <th
                      style={{
                        ...th,
                        textAlign:
                          "right",
                      }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {bagroomRows.map(
                    (
                      row
                    ) => {
                      const tag =
                        cleanTag(
                          row.tag ||
                            row.id
                        );

                      const existsAtCounter =
                        counterTagSet.has(
                          tag
                        );

                      const busy =
                        deletingBagroomTag ===
                        tag;

                      return (
                        <tr
                          key={
                            row.id
                          }
                          style={{
                            background:
                              existsAtCounter
                                ? "#f0fdf4"
                                : "#fff7ed",
                          }}
                        >
                          <td style={td}>
                            <strong>
                              {tag}
                            </strong>
                          </td>

                          <td style={td}>
                            {row.cartNumber ||
                              "-"}
                          </td>

                          <td style={td}>
                            <span
                              style={{
                                display:
                                  "inline-flex",

                                padding:
                                  "4px 8px",

                                borderRadius:
                                  999,

                                background:
                                  existsAtCounter
                                    ? "#dcfce7"
                                    : "#ffedd5",

                                color:
                                  existsAtCounter
                                    ? "#166534"
                                    : "#9a3412",

                                border:
                                  `1px solid ${
                                    existsAtCounter
                                      ? "#86efac"
                                      : "#fdba74"
                                  }`,

                                fontSize:
                                  "0.75rem",

                                fontWeight:
                                  900,
                              }}
                            >
                              {existsAtCounter
                                ? "MATCHED"
                                : "NO COUNTER"}
                            </span>
                          </td>

                          <td
                            style={{
                              ...td,
                              color:
                                "#6b7280",
                            }}
                          >
                            {row
                              .scannedBy
                              ?.fullName ||
                              row
                                .scannedBy
                                ?.username ||
                              "-"}

                            {row
                              .scannedBy
                              ?.operationalPositionLabel
                              ? ` - ${row.scannedBy.operationalPositionLabel}`
                              : ""}
                          </td>

                          <td
                            style={{
                              ...td,
                              textAlign:
                                "right",
                            }}
                          >
                            {canDeleteScans && (
                              <button
                                type="button"
                                onClick={() =>
                                  deleteBagroomScan(
                                    row
                                  )
                                }
                                disabled={
                                  busy ||
                                  isFlightLoaded
                                }
                                style={deleteButtonStyle(
                                  busy ||
                                    isFlightLoaded
                                )}
                              >
                                {busy
                                  ? "Deleting\u2026"
                                  : "Delete"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* =========================
   UI COMPONENTS
========================= */

function SummaryBox({
  label,
  value,
  background,
  color,
  compact = false,
}) {
  return (
    <div
      style={{
        padding:
          compact
            ? 7
            : 9,

        borderRadius:
          12,

        border:
          "1px solid #e5e7eb",

        background,

        color,

        textAlign:
          "center",
      }}
    >
      <div
        style={{
          fontSize:
            compact
              ? "0.66rem"
              : "0.72rem",

          fontWeight:
            800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize:
            compact
              ? "1.05rem"
              : "1.2rem",

          fontWeight:
            900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function deleteButtonStyle(
  disabled
) {
  return {
    padding:
      "5px 9px",

    borderRadius:
      999,

    border:
      "1px solid #ef4444",

    background:
      disabled
        ? "#fca5a5"
        : "#ef4444",

    color:
      "white",

    fontWeight:
      800,

    cursor:
      disabled
        ? "not-allowed"
        : "pointer",

    opacity:
      disabled
        ? 0.75
        : 1,
  };
}

const th = {
  textAlign:
    "left",

  padding:
    "10px 8px",

  borderBottom:
    "1px solid #e5e7eb",

  fontSize:
    "0.8rem",

  textTransform:
    "uppercase",

  letterSpacing:
    "0.04em",

  color:
    "#6b7280",

  whiteSpace:
    "nowrap",
};

const td = {
  padding:
    "10px 8px",

  borderBottom:
    "1px solid #f3f4f6",

  color:
    "#111827",

  verticalAlign:
    "middle",
};

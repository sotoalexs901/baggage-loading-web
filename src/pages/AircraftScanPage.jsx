// src/pages/AircraftScanPage.jsx

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import {
  getDownloadURL,
  ref as sRef,
  uploadBytes,
} from "firebase/storage";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { db, storage } from "../firebase";

import Modal from "../components/Modal.jsx";
import { useModal } from "../components/useModal.js";

import {
  logSystemIncident,
  logSystemSuccess,
  startSystemTimer,
} from "../utils/systemLogger.js";

const BAG_TAG_LENGTH = 10;
const AUTO_SUBMIT_IDLE_MS = 100;

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function onlyDigits(value) {
  return String(value || "").replace(
    /\D/g,
    ""
  );
}

function normalizeBagTag(value) {
  return onlyDigits(value).slice(
    0,
    BAG_TAG_LENGTH
  );
}

function isValidBagTag(value) {
  return (
    /^\d+$/.test(String(value || "")) &&
    String(value).length === BAG_TAG_LENGTH
  );
}

function cleanTagValue(value) {
  return normalizeBagTag(value);
}

function normalizeStatus(status) {
  const value = String(
    status || "OPEN"
  )
    .trim()
    .toUpperCase();

  return [
    "OPEN",
    "RECEIVING",
    "LOADING",
    "LOADED",
  ].includes(value)
    ? value
    : "OPEN";
}

function safeStr(value, fallback = "-") {
  const text = String(value ?? "").trim();

  return text || fallback;
}

function normalizeBagType(value) {
  const type = String(
    value || "CHECKED_BAG"
  )
    .trim()
    .toUpperCase();

  return [
    "CHECKED_BAG",
    "GATE_CHECK",
    "OVERSIZE",
  ].includes(type)
    ? type
    : "CHECKED_BAG";
}

function getBagTypeLabel(value) {
  const type =
    normalizeBagType(value);

  if (type === "GATE_CHECK") {
    return "Gate Check";
  }

  if (type === "OVERSIZE") {
    return "Oversize";
  }

  return "Checked Bag";
}

function normalizeReceivingLocation(
  value
) {
  const location = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, "_");

  if (
    [
      "GATE",
      "RAMP",
      "GATE_RAMP",
      "GATERAMP",
    ].includes(location)
  ) {
    return "GATE";
  }

  if (location === "OVERSIZE") {
    return "OVERSIZE";
  }

  if (
    [
      "BAGROOM",
      "BAG_ROOM",
      "BAGGAGE_ROOM",
    ].includes(location)
  ) {
    return "BAGROOM";
  }

  if (location === "COUNTER") {
    return "COUNTER";
  }

  if (location === "AIRCRAFT") {
    return "AIRCRAFT";
  }

  if (location === "OFFLOADED") {
    return "OFFLOADED";
  }

  return "UNKNOWN";
}

function getReceivingLocationLabel(
  value
) {
  const location =
    normalizeReceivingLocation(
      value
    );

  if (location === "BAGROOM") {
    return "Bagroom";
  }

  if (location === "OVERSIZE") {
    return "Oversize";
  }

  if (location === "GATE") {
    return "Gate / Ramp";
  }

  if (location === "COUNTER") {
    return "Counter";
  }

  if (location === "AIRCRAFT") {
    return "Aircraft";
  }

  if (location === "OFFLOADED") {
    return "Offloaded";
  }

  return "Unknown";
}

function getLocationIcon(value) {
  const location =
    normalizeReceivingLocation(
      value
    );

  if (location === "BAGROOM") {
    return "\uD83D\uDEC4";
  }

  if (location === "OVERSIZE") {
    return "\uD83D\uDCE6";
  }

  if (location === "GATE") {
    return "\uD83D\uDEAA";
  }

  if (location === "COUNTER") {
    return "\uD83C\uDFAB";
  }

  if (location === "AIRCRAFT") {
    return "\u2708\uFE0F";
  }

  if (location === "OFFLOADED") {
    return "\u2B07\uFE0F";
  }

  return "\u26A0\uFE0F";
}

function isValidReceivingLocation(
  value
) {
  return [
    "BAGROOM",
    "OVERSIZE",
    "GATE",
  ].includes(
    normalizeReceivingLocation(
      value
    )
  );
}

function getTimestampMilliseconds(
  value
) {
  if (!value) {
    return 0;
  }

  if (
    typeof value.toMillis ===
    "function"
  ) {
    return value.toMillis();
  }

  if (
    typeof value.seconds ===
    "number"
  ) {
    return value.seconds * 1000;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed =
    new Date(value).getTime();

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function formatTime(value) {
  const milliseconds =
    getTimestampMilliseconds(
      value
    );

  if (!milliseconds) {
    return "-";
  }

  return new Date(
    milliseconds
  ).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(value) {
  const milliseconds =
    getTimestampMilliseconds(
      value
    );

  if (!milliseconds) {
    return "-";
  }

  return new Date(
    milliseconds
  ).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function getPreviousLocationFromScan(
  scan
) {
  if (!scan) {
    return null;
  }

  const location =
    normalizeReceivingLocation(
      scan.receivingLocation ||
        scan.location ||
        scan.trackingLocation
    );

  return {
    location,

    locationLabel:
      scan.locationLabel ||
      getReceivingLocationLabel(
        location
      ),

    cartNumber:
      location === "BAGROOM"
        ? String(
            scan.cartNumber || ""
          ).trim() || null
        : null,

    scannedAt:
      scan.createdAt ||
      scan.scannedAt ||
      null,

    scannedBy:
      scan.scannedBy ||
      scan.createdBy ||
      null,

    source:
      "bagroomScans",
  };
}

function getPreviousLocationFromTag(
  data
) {
  if (!data) {
    return null;
  }

  const location =
    normalizeReceivingLocation(
      data.receivingLocation ||
        data.lastSeenLocation ||
        data.location
    );

  return {
    location,

    locationLabel:
      data.locationLabel ||
      getReceivingLocationLabel(
        location
      ),

    cartNumber:
      location === "BAGROOM"
        ? String(
            data.cartNumber || ""
          ).trim() || null
        : null,

    scannedAt:
      data.lastSeenAt ||
      data.updatedAt ||
      null,

    scannedBy:
      data.lastSeenBy ||
      data.updatedBy ||
      null,

    source:
      "bagTags",
  };
}

function getPreviousLocationDetails(
  previousLocation
) {
  if (!previousLocation) {
    return "No previous location";
  }

  const label =
    previousLocation.locationLabel ||
    getReceivingLocationLabel(
      previousLocation.location
    );

  if (
    normalizeReceivingLocation(
      previousLocation.location
    ) === "BAGROOM"
  ) {
    return previousLocation.cartNumber
      ? `${label} \u00B7 Cart ${previousLocation.cartNumber}`
      : `${label} \u00B7 No Cart`;
  }

  return label;
}

function useCompactScreen() {
  const [
    compact,
    setCompact,
  ] = useState(() => {
    if (
      typeof window === "undefined"
    ) {
      return false;
    }

    return window.innerWidth <= 760;
  });

  useEffect(() => {
    const update = () => {
      setCompact(
        window.innerWidth <= 760
      );
    };

    window.addEventListener(
      "resize",
      update
    );

    return () => {
      window.removeEventListener(
        "resize",
        update
      );
    };
  }, []);

  return compact;
}

export default function AircraftScanPage({
  flightId,
  user,
  operationalContext,
}) {
  const compactScreen =
    useCompactScreen();

  const role =
    useMemo(
      () =>
        normalizeRole(
          user?.role
        ),
      [user?.role]
    );

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
          "AIRCRAFT_RAMP",

        operationalPositionLabel:
          operationalContext
            ?.operationalPositionLabel ||
          "Aircraft / Ramp",

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

  const canCompleteLoading =
    role === "supervisor" ||
    role === "duty_manager" ||
    role === "station_manager";

  const canReopenOrOffload =
    role === "supervisor" ||
    role === "duty_manager" ||
    role === "station_manager";

  const [
    flight,
    setFlight,
  ] = useState(null);

  const [
    flightLoading,
    setFlightLoading,
  ] = useState(true);

  const [
    zone,
    setZone,
  ] = useState(1);

  const [
    scannerMode,
    setScannerMode,
  ] = useState(() => {
    return (
      localStorage.getItem(
        "aircraftScannerMode"
      ) !== "manual"
    );
  });

  const [
    tagInput,
    setTagInput,
  ] = useState("");

  const inputRef =
    useRef(null);

  const [
    msg,
    setMsg,
  ] = useState("");

  const [
    err,
    setErr,
  ] = useState("");

  const [
    scans,
    setScans,
  ] = useState([]);

  const [
    loadingScans,
    setLoadingScans,
  ] = useState(true);

  const [
    receivingScans,
    setReceivingScans,
  ] = useState([]);

  const [
    loadingReceivingScans,
    setLoadingReceivingScans,
  ] = useState(true);

  const [
    strictManifest,
    setStrictManifest,
  ] = useState(false);

  const [
    completing,
    setCompleting,
  ] = useState(false);

  const [
    completeMsg,
    setCompleteMsg,
  ] = useState("");

  const [
    exporting,
    setExporting,
  ] = useState(false);

  const [
    reopening,
    setReopening,
  ] = useState(false);

  const [
    offloadingTag,
    setOffloadingTag,
  ] = useState("");

  const [
    submittingTag,
    setSubmittingTag,
  ] = useState("");

  const [
    lastLoadedBag,
    setLastLoadedBag,
  ] = useState(null);

  const autoTimerRef =
    useRef(null);

  const isSubmittingRef =
    useRef(false);

  const lastSubmittedTagRef =
    useRef("");

  const lastSubmittedTimeRef =
    useRef(0);

  const {
    modal,
    show,
    close,
  } = useModal();

  /* =========================
     SYSTEM MONITOR
  ========================= */

  const logAircraftIncident =
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
          "AIRCRAFT",

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
          flight?.flightNumber ||
          null,

        bagTag:
          tag ||
          null,

        durationMs,

        currentView:
          "aircraft",

        metadata,
      });
    };

  const focusScanner = (
    delay = 100
  ) => {
    window.setTimeout(() => {
      if (
        inputRef.current &&
        !inputRef.current.disabled
      ) {
        inputRef.current.focus({
          preventScroll:
            true,
        });
      }
    }, delay);
  };

  const popup = (
    title,
    message,
    tone = "info"
  ) => {
    show({
      title,
      tone,

      content: (
        <div
          style={{
            whiteSpace:
              "pre-wrap",
          }}
        >
          {message}
        </div>
      ),

      confirmText:
        "OK",

      onConfirm:
        () => {
          close();
          focusScanner();
        },

      onCancel:
        () => {
          close();
          focusScanner();
        },
    });
  };

  const promptReason = ({
    title,
    message,
    confirmText,
    tone = "warning",
    onConfirm,
  }) => {
    let reasonValue =
      "";

    show({
      title,
      tone,
      showCancel:
        true,

      confirmText,

      cancelText:
        "Cancel",

      content: (
        <div>
          <div
            style={{
              whiteSpace:
                "pre-wrap",

              marginBottom:
                10,
            }}
          >
            {message}
          </div>

          <label
            style={{
              display:
                "block",

              fontSize:
                "0.85rem",

              color:
                "#374151",

              marginBottom:
                6,
            }}
          >
            Reason required
          </label>

          <textarea
            autoFocus
            rows={4}
            placeholder="Explain the reason..."
            onChange={(
              event
            ) => {
              reasonValue =
                event.target.value;
            }}
            style={{
              width:
                "100%",

              boxSizing:
                "border-box",

              padding:
                "10px 12px",

              borderRadius:
                12,

              border:
                "1px solid #d1d5db",

              resize:
                "vertical",
            }}
          />
        </div>
      ),

      onCancel:
        () => {
          close();
          focusScanner();
        },

      onConfirm:
        async () => {
          const reason =
            String(
              reasonValue ||
                ""
            ).trim();

          if (!reason) {
            popup(
              "Reason required",
              "Please enter a reason before continuing.",
              "warning"
            );

            return;
          }

          close();

          await onConfirm(
            reason
          );
        },
    });
  };

  /* =========================
     FLIGHT SUBSCRIPTION
  ========================= */

  useEffect(() => {
    if (!flightId) {
      setFlight(
        null
      );

      setFlightLoading(
        false
      );

      return undefined;
    }

    setFlightLoading(
      true
    );

    const flightRef =
      doc(
        db,
        "flights",
        flightId
      );

    const unsubscribe =
      onSnapshot(
        flightRef,

        (
          snapshot
        ) => {
          if (
            !snapshot.exists()
          ) {
            setFlight(
              null
            );

            setFlightLoading(
              false
            );

            logSystemIncident({
              module:
                "AIRCRAFT",

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
                "aircraft",
            });

            return;
          }

          const data = {
            id:
              snapshot.id,

            ...snapshot.data(),
          };

          setFlight(
            data
          );

          if (
            typeof data.strictManifest ===
            "boolean"
          ) {
            setStrictManifest(
              data.strictManifest
            );
          }

          setFlightLoading(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "AircraftScanPage flight snapshot error:",
            error
          );

          setFlight(
            null
          );

          setFlightLoading(
            false
          );

          logSystemIncident({
            module:
              "AIRCRAFT",

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
                "Unable to load Aircraft flight."
              ),

            user,

            operationalContext,

            flightId,

            currentView:
              "aircraft",
          });
        }
      );

    return () =>
      unsubscribe();
  }, [
    flightId,
    user?.id,
  ]);

  /* =========================
     AIRCRAFT SCANS
  ========================= */

  useEffect(() => {
    if (!flightId) {
      setScans([]);
      setLoadingScans(
        false
      );

      return undefined;
    }

    setLoadingScans(
      true
    );

    const aircraftScansRef =
      collection(
        db,
        "flights",
        flightId,
        "aircraftScans"
      );

    const unsubscribe =
      onSnapshot(
        aircraftScansRef,

        (
          snapshot
        ) => {
          const rows =
            snapshot.docs.map(
              (
                document
              ) => ({
                id:
                  document.id,

                ...document.data(),
              })
            );

          rows.sort(
            (
              a,
              b
            ) => {
              const timeA =
                getTimestampMilliseconds(
                  a.createdAt
                );

              const timeB =
                getTimestampMilliseconds(
                  b.createdAt
                );

              return (
                timeB -
                timeA
              );
            }
          );

          setScans(
            rows
          );

          setLoadingScans(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "AircraftScanPage scans snapshot error:",
            error
          );

          setScans([]);

          setLoadingScans(
            false
          );

          logSystemIncident({
            module:
              "AIRCRAFT",

            action:
              "LOAD_AIRCRAFT_SCANS",

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
                "Unable to load Aircraft scans."
              ),

            user,

            operationalContext,

            flightId,

            currentView:
              "aircraft",
          });
        }
      );

    return () =>
      unsubscribe();
  }, [
    flightId,
    user?.id,
  ]);

  /* =========================
     RECEIVING SCANS
  ========================= */

  useEffect(() => {
    if (!flightId) {
      setReceivingScans(
        []
      );

      setLoadingReceivingScans(
        false
      );

      return undefined;
    }

    setLoadingReceivingScans(
      true
    );

    const receivingRef =
      collection(
        db,
        "flights",
        flightId,
        "bagroomScans"
      );

    const unsubscribe =
      onSnapshot(
        receivingRef,

        (
          snapshot
        ) => {
          const rows =
            snapshot.docs.map(
              (
                document
              ) => ({
                id:
                  document.id,

                ...document.data(),
              })
            );

          rows.sort(
            (
              a,
              b
            ) => {
              const timeA =
                getTimestampMilliseconds(
                  a.createdAt ||
                    a.scannedAt
                );

              const timeB =
                getTimestampMilliseconds(
                  b.createdAt ||
                    b.scannedAt
                );

              return (
                timeB -
                timeA
              );
            }
          );

          setReceivingScans(
            rows
          );

          setLoadingReceivingScans(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "AircraftScanPage receiving scans error:",
            error
          );

          setReceivingScans(
            []
          );

          setLoadingReceivingScans(
            false
          );

          logSystemIncident({
            module:
              "AIRCRAFT",

            action:
              "LOAD_RECEIVING_SCANS",

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
                "Unable to load receiving scans."
              ),

            user,

            operationalContext,

            flightId,

            currentView:
              "aircraft",
          });
        }
      );

    return () =>
      unsubscribe();
  }, [
    flightId,
    user?.id,
  ]);

  useEffect(() => {
    focusScanner(
      250
    );
  }, []);

  useEffect(() => {
    focusScanner(
      150
    );
  }, [
    zone,
    scannerMode,
  ]);

  useEffect(() => {
    return () => {
      if (
        autoTimerRef.current
      ) {
        window.clearTimeout(
          autoTimerRef.current
        );
      }
    };
  }, []);

  const isLoadingCompleted =
    Boolean(
      flight
        ?.aircraftLoadingCompleted
    ) ||
    normalizeStatus(
      flight?.status
    ) === "LOADED";

  const bagroomTotal =
    receivingScans.length;

  const missingNow =
    typeof flight
      ?.checkedBagsTotal ===
    "number"
      ? Math.max(
          0,
          flight.checkedBagsTotal -
            scans.length
        )
      : null;

  const bagTypeCounts =
    useMemo(() => {
      const counts = {
        CHECKED_BAG:
          0,

        GATE_CHECK:
          0,

        OVERSIZE:
          0,
      };

      for (
        const scan of scans
      ) {
        const type =
          normalizeBagType(
            scan.bagType
          );

        counts[
          type
        ] += 1;
      }

      return counts;
    }, [
      scans,
    ]);

  const receivingScanByTag =
    useMemo(() => {
      const map =
        new Map();

      for (
        const scan of receivingScans
      ) {
        const tag =
          normalizeBagTag(
            scan.tag ||
              scan.bagTag ||
              scan.id
          );

        if (tag) {
          map.set(
            tag,
            scan
          );
        }
      }

      return map;
    }, [
      receivingScans,
    ]);

  const loadedTagSet =
    useMemo(() => {
      return new Set(
        scans
          .map(
            (
              scan
            ) =>
              normalizeBagTag(
                scan.tag ||
                  scan.id
              )
          )
          .filter(
            Boolean
          )
      );
    }, [
      scans,
    ]);

  const pendingReceivingScans =
    useMemo(() => {
      return receivingScans
        .filter(
          (
            scan
          ) => {
            const tag =
              normalizeBagTag(
                scan.tag ||
                  scan.bagTag ||
                  scan.id
              );

            return (
              tag &&
              !loadedTagSet.has(
                tag
              )
            );
          }
        )
        .sort(
          (
            a,
            b
          ) => {
            const timeA =
              getTimestampMilliseconds(
                a.createdAt ||
                  a.scannedAt
              );

            const timeB =
              getTimestampMilliseconds(
                b.createdAt ||
                  b.scannedAt
              );

            return (
              timeB -
              timeA
            );
          }
        );
    }, [
      receivingScans,
      loadedTagSet,
    ]);

  const lastFiveLoadedBags =
    useMemo(() => {
      return scans.slice(
        0,
        5
      );
    }, [
      scans,
    ]);

  /* =========================
     STATUS
  ========================= */

  const ensureStatusLoading =
    async () => {
      if (!flight) {
        return;
      }

      const current =
        normalizeStatus(
          flight.status
        );

      if (
        current ===
          "LOADED" ||
        current ===
          "LOADING"
      ) {
        return;
      }

      await setDoc(
        doc(
          db,
          "flights",
          flightId
        ),
        {
          status:
            "LOADING",

          statusUpdatedAt:
            serverTimestamp(),

          statusUpdatedBy:
            operationalActor,
        },
        {
          merge:
            true,
        }
      );
    };

  /* =========================
     VALIDATIONS
  ========================= */

  const validateAgainstOtherFlight =
    async (
      tag
    ) => {
      const tagRef =
        doc(
          db,
          "bagTags",
          tag
        );

      const snapshot =
        await getDoc(
          tagRef
        );

      if (
        !snapshot.exists()
      ) {
        return {
          ok:
            true,

          firstTime:
            true,

          tagData:
            null,
        };
      }

      const existing =
        snapshot.data();

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

          existing,

          message:
            `\u274C Bag tag belongs to a different flight/date.\n\n` +
            `Current: ${
              flight?.flightNumber ||
              flightId
            } (${
              flight?.flightDate ||
              "-"
            })\n` +
            `Registered: ${
              existing.flightNumber ||
              existing.currentFlightNumber ||
              existingFlightId
            } (${
              existing.flightDate ||
              "-"
            })\n\n` +
            `Do NOT load this bag on this aircraft.`,
        };
      }

      return {
        ok:
          true,

        firstTime:
          false,

        tagData:
          existing,
      };
    };

  const validateAgainstManifest =
    async (
      tag
    ) => {
      if (
        !strictManifest
      ) {
        return {
          ok:
            true,
        };
      }

      const allowRef =
        doc(
          db,
          "flights",
          flightId,
          "allowedBagTags",
          tag
        );

      const allowSnapshot =
        await getDoc(
          allowRef
        );

      if (
        !allowSnapshot.exists()
      ) {
        return {
          ok:
            false,

          message:
            `\u274C Bag tag NOT found in this flight manifest.\n\n` +
            `Flight: ${
              flight?.flightNumber ||
              flightId
            } (${
              flight?.flightDate ||
              "-"
            })\n` +
            `Tag: ${tag}\n\n` +
            `Check tag / passenger list. Do NOT load.`,
        };
      }

      return {
        ok:
          true,
      };
    };

  const getBagTypeInfo =
    async (
      tag
    ) => {
      const tagSnapshot =
        await getDoc(
          doc(
            db,
            "bagTags",
            tag
          )
        );

      if (
        tagSnapshot.exists()
      ) {
        const data =
          tagSnapshot.data();

        if (
          data.bagType
        ) {
          return {
            bagType:
              normalizeBagType(
                data.bagType
              ),

            bagTypeLabel:
              data.bagTypeLabel ||
              getBagTypeLabel(
                data.bagType
              ),
          };
        }
      }

      const counterSnapshot =
        await getDoc(
          doc(
            db,
            "flights",
            flightId,
            "counterScans",
            tag
          )
        );

      if (
        counterSnapshot.exists()
      ) {
        const data =
          counterSnapshot.data();

        return {
          bagType:
            normalizeBagType(
              data.bagType
            ),

          bagTypeLabel:
            data.bagTypeLabel ||
            getBagTypeLabel(
              data.bagType
            ),
        };
      }

      return {
        bagType:
          "CHECKED_BAG",

        bagTypeLabel:
          "Checked Bag",
      };
    };

  const getPreviousLocation =
    async (
      tag,
      tagData = null
    ) => {
      const localReceivingScan =
        receivingScanByTag.get(
          tag
        );

      if (
        localReceivingScan
      ) {
        const previous =
          getPreviousLocationFromScan(
            localReceivingScan
          );

        return {
          ...previous,

          validReceivingLocation:
            isValidReceivingLocation(
              previous
                ?.location
            ),

          found:
            true,
        };
      }

      let resolvedTagData =
        tagData;

      if (
        !resolvedTagData
      ) {
        const tagSnapshot =
          await getDoc(
            doc(
              db,
              "bagTags",
              tag
            )
          );

        if (
          tagSnapshot.exists()
        ) {
          resolvedTagData =
            tagSnapshot.data();
        }
      }

      if (
        resolvedTagData
      ) {
        const previous =
          getPreviousLocationFromTag(
            resolvedTagData
          );

        return {
          ...previous,

          validReceivingLocation:
            isValidReceivingLocation(
              previous
                ?.location
            ),

          found:
            true,
        };
      }

      const counterSnapshot =
        await getDoc(
          doc(
            db,
            "flights",
            flightId,
            "counterScans",
            tag
          )
        );

      if (
        counterSnapshot.exists()
      ) {
        const counterData =
          counterSnapshot.data();

        return {
          location:
            "COUNTER",

          locationLabel:
            "Counter",

          cartNumber:
            null,

          scannedAt:
            counterData.createdAt ||
            counterData.scannedAt ||
            null,

          scannedBy:
            counterData.scannedBy ||
            counterData.createdBy ||
            null,

          source:
            "counterScans",

          validReceivingLocation:
            false,

          found:
            true,
        };
      }

      return {
        location:
          "UNKNOWN",

        locationLabel:
          "No Recorded Location",

        cartNumber:
          null,

        scannedAt:
          null,

        scannedBy:
          null,

        source:
          null,

        validReceivingLocation:
          false,

        found:
          false,
      };
    };

  /* =========================
     TRACKING
  ========================= */

  const indexTagToThisFlight =
    async (
      tag,
      zoneNum,
      typeInfo,
      previousLocation
    ) => {
      const tagRef =
        doc(
          db,
          "bagTags",
          tag
        );

      await setDoc(
        tagRef,
        {
          tag,

          flightId,

          currentFlightId:
            flightId,

          flightNumber:
            flight?.flightNumber ||
            null,

          currentFlightNumber:
            flight?.flightNumber ||
            null,

          flightDate:
            flight?.flightDate ||
            null,

          gate:
            flight?.gate ||
            null,

          bagType:
            typeInfo
              ?.bagType ||
            "CHECKED_BAG",

          bagTypeLabel:
            typeInfo
              ?.bagTypeLabel ||
            "Checked Bag",

          previousLocation:
            previousLocation
              ?.location ||
            "UNKNOWN",

          previousLocationLabel:
            previousLocation
              ?.locationLabel ||
            "Unknown",

          previousCartNumber:
            previousLocation
              ?.cartNumber ||
            null,

          previousLocationAt:
            previousLocation
              ?.scannedAt ||
            null,

          previousLocationBy:
            previousLocation
              ?.scannedBy ||
            null,

          lastSeenAt:
            serverTimestamp(),

          lastSeenLocation:
            "aircraft",

          lastSeenZone:
            zoneNum ??
            null,

          lastSeenBy:
            operationalActor,

          firstSeenAt:
            serverTimestamp(),
        },
        {
          merge:
            true,
        }
      );
    };

  const saveTrackingEvent =
    async ({
      type,
      tag,
      zoneNum = null,
      reason = null,
      bagType = "CHECKED_BAG",
      bagTypeLabel = "Checked Bag",
      previousLocation = null,
    }) => {
      const eventRef =
        doc(
          db,
          "bagTags",
          tag,
          "events",
          `${String(
            type
          ).toLowerCase()}_${Date.now()}`
        );

      await setDoc(
        eventRef,
        {
          type,

          location:
            type ===
            "OFFLOAD_BAG"
              ? "offloaded"
              : "aircraft",

          message:
            type ===
            "AIRCRAFT_LOAD"
              ? `Bag loaded on aircraft \u00B7 ${bagTypeLabel}`
              : `Bag offloaded from aircraft \u00B7 ${bagTypeLabel}`,

          tag,

          zone:
            zoneNum,

          bagType,

          bagTypeLabel,

          reason,

          previousLocation:
            previousLocation
              ?.location ||
            null,

          previousLocationLabel:
            previousLocation
              ?.locationLabel ||
            null,

          previousCartNumber:
            previousLocation
              ?.cartNumber ||
            null,

          previousLocationAt:
            previousLocation
              ?.scannedAt ||
            null,

          previousLocationBy:
            previousLocation
              ?.scannedBy ||
            null,

          previousLocationValid:
            Boolean(
              previousLocation
                ?.validReceivingLocation
            ),

          flightId,

          flightNumber:
            flight?.flightNumber ||
            null,

          flightDate:
            flight?.flightDate ||
            null,

          gate:
            flight?.gate ||
            null,

          createdAt:
            serverTimestamp(),

          createdBy:
            operationalActor,
        }
      );
    };

  /* =========================
     SAVE AIRCRAFT SCAN
  ========================= */

  const saveAircraftScan =
    async (
      tag,
      zoneNum,
      previousLocation
    ) => {
      const scanRef =
        doc(
          db,
          "flights",
          flightId,
          "aircraftScans",
          tag
        );

      const existing =
        await getDoc(
          scanRef
        );

      const typeInfo =
        await getBagTypeInfo(
          tag
        );

      if (
        existing.exists()
      ) {
        const previousScan =
          existing.data();

        await setDoc(
          scanRef,
          {
            bagType:
              typeInfo.bagType,

            bagTypeLabel:
              typeInfo.bagTypeLabel,
          },
          {
            merge:
              true,
          }
        );

        const duplicateMessage =
          `Already scanned in Aircraft. Bag Tag: ${tag}. Zone: ${
            previousScan.zone ??
            "-"
          }.`;

        await logAircraftIncident({
          action:
            "BAG_SCAN",

          status:
            "WARNING",

          severity:
            "LOW",

          errorType:
            "DUPLICATE_SCAN",

          message:
            duplicateMessage,

          tag,

          metadata: {
            existingZone:
              previousScan.zone ??
              null,

            previousLocation:
              previousScan.previousLocation ||
              null,

            previousLocationLabel:
              previousScan.previousLocationLabel ||
              null,

            bagType:
              typeInfo.bagType,

            bagTypeLabel:
              typeInfo.bagTypeLabel,
          },
        });

        popup(
          "Duplicate scan",
          `\u26A0\uFE0F Already scanned in Aircraft.\n\n` +
            `Bag Tag: ${tag}\n` +
            `Zone: ${
              previousScan.zone ??
              "-"
            }\n` +
            `Previous Location: ${
              previousScan.previousLocationLabel ||
              getReceivingLocationLabel(
                previousScan.previousLocation
              )
            }\n` +
            `Type updated: ${typeInfo.bagTypeLabel}`,
          "warning"
        );

        return {
          ok:
            false,

          typeInfo,
        };
      }

      await setDoc(
        scanRef,
        {
          tag,

          zone:
            zoneNum,

          bagType:
            typeInfo.bagType,

          bagTypeLabel:
            typeInfo.bagTypeLabel,

          previousLocation:
            previousLocation
              ?.location ||
            "UNKNOWN",

          previousLocationLabel:
            previousLocation
              ?.locationLabel ||
            "Unknown",

          previousCartNumber:
            previousLocation
              ?.cartNumber ||
            null,

          previousLocationAt:
            previousLocation
              ?.scannedAt ||
            null,

          previousLocationBy:
            previousLocation
              ?.scannedBy ||
            null,

          previousLocationSource:
            previousLocation
              ?.source ||
            null,

          previousLocationValid:
            Boolean(
              previousLocation
                ?.validReceivingLocation
            ),

          previousLocationDetails:
            getPreviousLocationDetails(
              previousLocation
            ),

          employeeFullName:
            operationalActor.fullName,

          operationalPosition:
            operationalActor.operationalPosition,

          operationalPositionLabel:
            operationalActor.operationalPositionLabel,

          createdAt:
            serverTimestamp(),

          scannedBy:
            operationalActor,
        }
      );

      return {
        ok:
          true,

        typeInfo,
      };
    };

  /* =========================
     ACTION REPORT
  ========================= */

  const saveActionReport =
    async ({
      type,
      reason,
      tag = null,
      zoneNum = null,
      extra = {},
    }) => {
      await addDoc(
        collection(
          db,
          "flights",
          flightId,
          "reports"
        ),
        {
          type,

          reason,

          tag,

          zone:
            zoneNum,

          createdAt:
            serverTimestamp(),

          createdBy:
            operationalActor,

          flightSnapshot: {
            flightNumber:
              flight?.flightNumber ||
              null,

            flightDate:
              flight?.flightDate ||
              null,

            gate:
              flight?.gate ||
              null,

            aircraftType:
              flight?.aircraftType ||
              null,

            status:
              flight?.status ||
              null,
          },

          ...extra,
        }
      );
    };

  /* =========================
     REOPEN FLIGHT
  ========================= */

  const handleReopenFlight =
    async () => {
      if (
        !canReopenOrOffload
      ) {
        const message =
          "You don't have permission to reopen this flight.";

        await logAircraftIncident({
          action:
            "REOPEN_FLIGHT",

          status:
            "WARNING",

          severity:
            "MEDIUM",

          errorType:
            "NO_PERMISSION",

          message,
        });

        popup(
          "No permission",
          message,
          "warning"
        );

        return;
      }

      if (
        !isLoadingCompleted
      ) {
        popup(
          "Not completed",
          "This flight is already open for loading.",
          "info"
        );

        return;
      }

      promptReason({
        title:
          "Reopen Flight",

        tone:
          "warning",

        confirmText:
          "Reopen Flight",

        message:
          `You are about to reopen this flight for loading.\n\n` +
          `Flight: ${
            flight?.flightNumber ||
            flightId
          }\n` +
          `Date: ${
            flight?.flightDate ||
            "-"
          }\n\n` +
          `Please enter the reason.`,

        onConfirm:
          async (
            reason
          ) => {
            const timer =
              startSystemTimer();

            try {
              setReopening(
                true
              );

              setErr("");
              setMsg("");

              await saveActionReport({
                type:
                  "REOPEN_FLIGHT",

                reason,

                extra: {
                  previousStatus:
                    flight?.status ||
                    null,

                  previousAircraftLoadingCompleted:
                    Boolean(
                      flight
                        ?.aircraftLoadingCompleted
                    ),

                  previousAircraftLoadedBags:
                    flight
                      ?.aircraftLoadedBags ??
                    null,
                },
              });

              await setDoc(
                doc(
                  db,
                  "flights",
                  flightId
                ),
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
                    serverTimestamp(),

                  reopenedReason:
                    reason,

                  reopenedBy:
                    operationalActor,

                  statusUpdatedAt:
                    serverTimestamp(),

                  statusUpdatedBy:
                    operationalActor,
                },
                {
                  merge:
                    true,
                }
              );

              setMsg(
                "\u2705 Flight reopened. Reason saved in reports."
              );

              await logSystemSuccess({
                module:
                  "AIRCRAFT",

                action:
                  "REOPEN_FLIGHT",

                durationMs:
                  timer.elapsed(),
              });

              focusScanner();
            } catch (
              error
            ) {
              console.error(
                error
              );

              const message =
                "Could not reopen flight. Check Firestore rules/connection.";

              setErr(
                message
              );

              await logAircraftIncident({
                action:
                  "REOPEN_FLIGHT",

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

                durationMs:
                  timer.elapsed(),

                metadata: {
                  reason,
                },
              });
            } finally {
              setReopening(
                false
              );
            }
          },
      });
    };

  /* =========================
     OFFLOAD
  ========================= */

  const handleOffloadBag =
    async (
      scan
    ) => {
      if (
        !canReopenOrOffload
      ) {
        const message =
          "You don't have permission to offload bags.";

        await logAircraftIncident({
          action:
            "OFFLOAD_BAG",

          status:
            "WARNING",

          severity:
            "MEDIUM",

          errorType:
            "NO_PERMISSION",

          message,
        });

        popup(
          "No permission",
          message,
          "warning"
        );

        return;
      }

      const tag =
        normalizeBagTag(
          scan?.tag ||
            scan?.id
        );

      const zoneNum =
        scan?.zone ??
        null;

      const bagType =
        normalizeBagType(
          scan?.bagType
        );

      const bagTypeLabel =
        scan?.bagTypeLabel ||
        getBagTypeLabel(
          scan?.bagType
        );

      if (!tag) {
        return;
      }

      promptReason({
        title:
          "Offload Bag",

        tone:
          "danger",

        confirmText:
          "Offload Bag",

        message:
          `You are about to offload this bag from aircraft.\n\n` +
          `Bag Tag: ${tag}\n` +
          `Type: ${bagTypeLabel}\n` +
          `Zone: ${
            zoneNum ??
            "-"
          }\n\n` +
          `Please enter the reason.`,

        onConfirm:
          async (
            reason
          ) => {
            const timer =
              startSystemTimer();

            try {
              setOffloadingTag(
                tag
              );

              setErr("");
              setMsg("");

              await saveActionReport({
                type:
                  "OFFLOAD_BAG",

                reason,

                tag,

                zoneNum,

                extra: {
                  bagType,

                  bagTypeLabel,

                  previousScan:
                    scan ||
                    null,
                },
              });

              await deleteDoc(
                doc(
                  db,
                  "flights",
                  flightId,
                  "aircraftScans",
                  tag
                )
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
                    flight?.flightNumber ||
                    null,

                  currentFlightNumber:
                    flight?.flightNumber ||
                    null,

                  flightDate:
                    flight?.flightDate ||
                    null,

                  gate:
                    flight?.gate ||
                    null,

                  bagType,

                  bagTypeLabel,

                  lastSeenAt:
                    serverTimestamp(),

                  lastSeenLocation:
                    "offloaded",

                  lastSeenZone:
                    zoneNum,

                  lastSeenBy:
                    operationalActor,

                  offloadedAt:
                    serverTimestamp(),

                  offloadedReason:
                    reason,

                  offloadedBy:
                    operationalActor,
                },
                {
                  merge:
                    true,
                }
              );

              await saveTrackingEvent({
                type:
                  "OFFLOAD_BAG",

                tag,

                zoneNum,

                reason,

                bagType,

                bagTypeLabel,

                previousLocation: {
                  location:
                    scan.previousLocation ||
                    "UNKNOWN",

                  locationLabel:
                    scan.previousLocationLabel ||
                    "Unknown",

                  cartNumber:
                    scan.previousCartNumber ||
                    null,

                  scannedAt:
                    scan.previousLocationAt ||
                    null,

                  scannedBy:
                    scan.previousLocationBy ||
                    null,

                  validReceivingLocation:
                    Boolean(
                      scan.previousLocationValid
                    ),
                },
              });

              if (
                isLoadingCompleted
              ) {
                await setDoc(
                  doc(
                    db,
                    "flights",
                    flightId
                  ),
                  {
                    status:
                      "LOADING",

                    aircraftLoadingCompleted:
                      false,

                    aircraftLoadingCompletedAt:
                      null,

                    aircraftLoadingCompletedBy:
                      null,

                    statusUpdatedAt:
                      serverTimestamp(),

                    statusUpdatedBy:
                      operationalActor,
                  },
                  {
                    merge:
                      true,
                  }
                );
              }

              setMsg(
                `\u2705 Bag offloaded: ${tag} \u00B7 ${bagTypeLabel}. Reason saved in reports/tracking.`
              );

              await logSystemSuccess({
                module:
                  "AIRCRAFT",

                action:
                  "OFFLOAD_BAG",

                durationMs:
                  timer.elapsed(),
              });

              focusScanner();
            } catch (
              error
            ) {
              console.error(
                error
              );

              const message =
                "Could not offload bag. Check Firestore rules/connection.";

              setErr(
                message
              );

              await logAircraftIncident({
                action:
                  "OFFLOAD_BAG",

                status:
                  "ERROR",

                severity:
                  "HIGH",

                errorType:
                  "FIRESTORE_DELETE_WRITE",

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
                  zone:
                    zoneNum,

                  bagType,

                  bagTypeLabel,

                  reason,
                },
              });
            } finally {
              setOffloadingTag(
                ""
              );
            }
          },
      });
    };

  /* =========================
     BAG SCAN
  ========================= */

  const handleScanSubmit =
    async (
      forcedTag =
        tagInput
    ) => {
      if (
        isSubmittingRef.current
      ) {
        return;
      }

      setMsg("");
      setErr("");
      setCompleteMsg("");

      const timer =
        startSystemTimer();

      if (
        isLoadingCompleted
      ) {
        const message =
          "Loading is already completed for this flight. Reopen flight first.";

        await logAircraftIncident({
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

        popup(
          "Locked",
          "\u26A0\uFE0F Loading is already completed for this flight. Reopen flight first.",
          "warning"
        );

        setTagInput(
          ""
        );

        return;
      }

      const tag =
        normalizeBagTag(
          forcedTag
        );

      if (
        !isValidBagTag(
          tag
        )
      ) {
        if (tag) {
          const message =
            `Bag tag must contain exactly ${BAG_TAG_LENGTH} digits.`;

          setErr(
            message
          );

          await logAircraftIncident({
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
                BAG_TAG_LENGTH,
            },
          });
        }

        setTagInput(
          tag
        );

        focusScanner();

        return;
      }

      const now =
        Date.now();

      if (
        lastSubmittedTagRef.current ===
          tag &&
        now -
          lastSubmittedTimeRef.current <
          1200
      ) {
        setTagInput(
          ""
        );

        focusScanner();

        return;
      }

      const zoneNum =
        Number(
          zone
        );

      try {
        isSubmittingRef.current =
          true;

        lastSubmittedTagRef.current =
          tag;

        lastSubmittedTimeRef.current =
          now;

        setSubmittingTag(
          tag
        );

        if (
          autoTimerRef.current
        ) {
          window.clearTimeout(
            autoTimerRef.current
          );

          autoTimerRef.current =
            null;
        }

        if (!flight) {
          const message =
            "Flight not loaded yet. Try again.";

          setErr(
            message
          );

          await logAircraftIncident({
            action:
              "BAG_SCAN",

            status:
              "ERROR",

            severity:
              "HIGH",

            errorType:
              "FLIGHT_NOT_AVAILABLE",

            message,

            tag,

            durationMs:
              timer.elapsed(),
          });

          return;
        }

        const manifestResult =
          await validateAgainstManifest(
            tag
          );

        if (
          !manifestResult.ok
        ) {
          await logAircraftIncident({
            action:
              "BAG_SCAN",

            status:
              "WARNING",

            severity:
              "HIGH",

            errorType:
              "MANIFEST_NOT_FOUND",

            message:
              manifestResult.message,

            tag,

            durationMs:
              timer.elapsed(),

            metadata: {
              strictManifest:
                true,

              zone:
                zoneNum,
            },
          });

          popup(
            "Not in manifest",
            manifestResult.message,
            "danger"
          );

          setTagInput(
            ""
          );

          return;
        }

        const flightResult =
          await validateAgainstOtherFlight(
            tag
          );

        if (
          !flightResult.ok
        ) {
          await logAircraftIncident({
            action:
              "BAG_SCAN",

            status:
              "WARNING",

            severity:
              "HIGH",

            errorType:
              "WRONG_FLIGHT",

            message:
              flightResult.message,

            tag,

            durationMs:
              timer.elapsed(),

            metadata: {
              zone:
                zoneNum,

              registeredFlightId:
                flightResult
                  ?.existing
                  ?.flightId ||
                flightResult
                  ?.existing
                  ?.currentFlightId ||
                null,

              registeredFlightNumber:
                flightResult
                  ?.existing
                  ?.flightNumber ||
                null,

              registeredFlightDate:
                flightResult
                  ?.existing
                  ?.flightDate ||
                null,
            },
          });

          popup(
            "Wrong flight/date",
            flightResult.message,
            "danger"
          );

          setTagInput(
            ""
          );

          return;
        }

        const previousLocation =
          await getPreviousLocation(
            tag,
            flightResult.tagData
          );

        const result =
          await saveAircraftScan(
            tag,
            zoneNum,
            previousLocation
          );

        if (
          !result.ok
        ) {
          setTagInput(
            ""
          );

          return;
        }

        const typeInfo =
          result.typeInfo || {
            bagType:
              "CHECKED_BAG",

            bagTypeLabel:
              "Checked Bag",
          };

        await indexTagToThisFlight(
          tag,
          zoneNum,
          typeInfo,
          previousLocation
        );

        await saveTrackingEvent({
          type:
            "AIRCRAFT_LOAD",

          tag,

          zoneNum,

          bagType:
            typeInfo.bagType,

          bagTypeLabel:
            typeInfo.bagTypeLabel,

          previousLocation,
        });

        await ensureStatusLoading();

        const loadedBag = {
          tag,

          zone:
            zoneNum,

          bagType:
            typeInfo.bagType,

          bagTypeLabel:
            typeInfo.bagTypeLabel,

          previousLocation:
            previousLocation.location,

          previousLocationLabel:
            previousLocation.locationLabel,

          previousCartNumber:
            previousLocation.cartNumber,

          previousLocationAt:
            previousLocation.scannedAt,

          previousLocationBy:
            previousLocation.scannedBy,

          previousLocationValid:
            previousLocation.validReceivingLocation,
        };

        setLastLoadedBag(
          loadedBag
        );

        const previousDetails =
          getPreviousLocationDetails(
            previousLocation
          );

        const durationMs =
          timer.elapsed();

        if (
          previousLocation.validReceivingLocation
        ) {
          setMsg(
            `\u2705 ${tag} loaded \u00B7 ${typeInfo.bagTypeLabel} \u00B7 Zone ${zoneNum} \u00B7 From ${previousDetails}`
          );

          await logSystemSuccess({
            module:
              "AIRCRAFT",

            action:
              "BAG_SCAN",

            durationMs,
          });
        } else {
          const warningMessage =
            `${tag} loaded in Zone ${zoneNum}, but its last recorded location was ${previousDetails}. Please verify.`;

          setErr(
            `\u26A0\uFE0F ${warningMessage}`
          );

          await logAircraftIncident({
            action:
              "BAG_SCAN",

            status:
              "WARNING",

            severity:
              previousLocation.location ===
              "UNKNOWN"
                ? "HIGH"
                : "MEDIUM",

            errorType:
              "PREVIOUS_LOCATION_WARNING",

            message:
              warningMessage,

            tag,

            durationMs,

            metadata: {
              zone:
                zoneNum,

              bagType:
                typeInfo.bagType,

              bagTypeLabel:
                typeInfo.bagTypeLabel,

              previousLocation:
                previousLocation.location,

              previousLocationLabel:
                previousLocation.locationLabel,

              previousCartNumber:
                previousLocation.cartNumber,

              previousLocationSource:
                previousLocation.source,

              previousLocationFound:
                previousLocation.found,
            },
          });
        }

        setTagInput(
          ""
        );
      } catch (
        error
      ) {
        console.error(
          error
        );

        const message =
          "Scan failed. Check Firestore rules/connection.";

        setErr(
          message
        );

        setTagInput(
          ""
        );

        await logAircraftIncident({
          action:
            "BAG_SCAN",

          status:
            "ERROR",

          severity:
            "HIGH",

          errorType:
            "AIRCRAFT_SCAN_FAILURE",

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
            zone:
              zoneNum,

            scannerMode:
              scannerMode
                ? "scanner"
                : "manual",
          },
        });
      } finally {
        isSubmittingRef.current =
          false;

        setSubmittingTag(
          ""
        );

        focusScanner(
          120
        );
      }
    };

  /* =========================
     SCANNER
  ========================= */

  const scheduleAutoSubmit =
    (
      nextValue
    ) => {
      if (
        autoTimerRef.current
      ) {
        window.clearTimeout(
          autoTimerRef.current
        );
      }

      const cleaned =
        normalizeBagTag(
          nextValue
        );

      if (
        cleaned.length !==
        BAG_TAG_LENGTH
      ) {
        autoTimerRef.current =
          null;

        return;
      }

      autoTimerRef.current =
        window.setTimeout(
          () => {
            autoTimerRef.current =
              null;

            handleScanSubmit(
              cleaned
            );
          },
          AUTO_SUBMIT_IDLE_MS
        );
    };

  const handleChange =
    (
      event
    ) => {
      const cleaned =
        normalizeBagTag(
          event.target.value
        );

      setTagInput(
        cleaned
      );

      setMsg("");
      setErr("");

      if (
        scannerMode &&
        !isLoadingCompleted
      ) {
        scheduleAutoSubmit(
          cleaned
        );
      }
    };

  const handleKeyDown =
    (
      event
    ) => {
      if (
        event.key !==
          "Enter" &&
        event.key !==
          "Tab"
      ) {
        return;
      }

      event.preventDefault();

      if (
        autoTimerRef.current
      ) {
        window.clearTimeout(
          autoTimerRef.current
        );

        autoTimerRef.current =
          null;
      }

      handleScanSubmit(
        event.currentTarget.value
      );
    };

  const changeScannerMode =
    (
      enabled
    ) => {
      setScannerMode(
        enabled
      );

      localStorage.setItem(
        "aircraftScannerMode",
        enabled
          ? "scanner"
          : "manual"
      );

      setTagInput("");
      setErr("");
      setMsg("");

      focusScanner(
        150
      );
    };

  /* =========================
     PDF HELPERS
  ========================= */

  const computeZones =
    (
      rows
    ) => {
      const zones = {
        1:
          0,

        2:
          0,

        3:
          0,

        4:
          0,
      };

      for (
        const row of rows
      ) {
        const zoneNumber =
          Number(
            row.zone
          );

        if (
          zoneNumber >= 1 &&
          zoneNumber <= 4
        ) {
          zones[
            zoneNumber
          ] += 1;
        }
      }

      return zones;
    };

  const computeBagTypes =
    (
      rows
    ) => {
      const counts = {
        CHECKED_BAG:
          0,

        GATE_CHECK:
          0,

        OVERSIZE:
          0,
      };

      for (
        const row of rows
      ) {
        const type =
          normalizeBagType(
            row.bagType
          );

        counts[
          type
        ] += 1;
      }

      return counts;
    };

  const buildPdf = ({
    flightDoc,
    aircraftRows,
    receivingCount,
  }) => {
    const pdf =
      new jsPDF();

    const flightNumber =
      safeStr(
        flightDoc
          ?.flightNumber,
        flightId
      );

    const flightDate =
      safeStr(
        flightDoc
          ?.flightDate,
        "-"
      );

    const gate =
      safeStr(
        flightDoc?.gate,
        "-"
      );

    const aircraftType =
      safeStr(
        flightDoc
          ?.aircraftType,
        "-"
      );

    const status =
      safeStr(
        flightDoc
          ?.status,
        "OPEN"
      );

    const gateController =
      safeStr(
        flightDoc
          ?.gateControllerOnDuty,
        "-"
      );

    const supervisorOnDuty =
      safeStr(
        flightDoc
          ?.statusUpdatedBy
          ?.username,
        ""
      ) ||
      safeStr(
        flightDoc
          ?.gateTotalUpdatedBy
          ?.username,
        ""
      ) ||
      "-";

    const rampSupervisor =
      safeStr(
        operationalActor.fullName ||
        user?.username,
        "-"
      );

    const gateTotal =
      typeof flightDoc
        ?.checkedBagsTotal ===
      "number"
        ? flightDoc.checkedBagsTotal
        : null;

    const aircraftTotal =
      aircraftRows.length;

    const zones =
      computeZones(
        aircraftRows
      );

    const bagTypes =
      computeBagTypes(
        aircraftRows
      );

    const missing =
      gateTotal ===
      null
        ? "\u2014"
        : String(
            Math.max(
              0,
              gateTotal -
                aircraftTotal
            )
          );

    pdf.setFontSize(
      14
    );

    pdf.text(
      "Baggage Loading Control System (BLCS)",
      14,
      16
    );

    pdf.setFontSize(
      11
    );

    pdf.text(
      `Flight: ${flightNumber}`,
      14,
      26
    );

    pdf.text(
      `Date: ${flightDate}`,
      14,
      32
    );

    pdf.text(
      `Gate: ${gate}`,
      14,
      38
    );

    pdf.text(
      `Aircraft: ${aircraftType}`,
      14,
      44
    );

    pdf.text(
      `Status: ${status}`,
      14,
      50
    );

    pdf.text(
      `Supervisor on Duty: ${supervisorOnDuty}`,
      110,
      26
    );

    pdf.text(
      `Gate Controller on Duty: ${gateController}`,
      110,
      32
    );

    pdf.text(
      `Ramp Supervisor: ${rampSupervisor}`,
      110,
      38
    );

    autoTable(
      pdf,
      {
        startY:
          58,

        head: [
          [
            "Metric",
            "Value",
          ],
        ],

        body: [
          [
            "Gate checked total",

            gateTotal ===
            null
              ? "\u2014"
              : String(
                  gateTotal
                ),
          ],

          [
            "Receiving scanned",
            String(
              receivingCount
            ),
          ],

          [
            "Aircraft scanned",
            String(
              aircraftTotal
            ),
          ],

          [
            "Checked Bags loaded",
            String(
              bagTypes
                .CHECKED_BAG
            ),
          ],

          [
            "Gate Checks loaded",
            String(
              bagTypes
                .GATE_CHECK
            ),
          ],

          [
            "Oversize loaded",
            String(
              bagTypes
                .OVERSIZE
            ),
          ],

          [
            "Zone 1",
            String(
              zones[1]
            ),
          ],

          [
            "Zone 2",
            String(
              zones[2]
            ),
          ],

          [
            "Zone 3",
            String(
              zones[3]
            ),
          ],

          [
            "Zone 4",
            String(
              zones[4]
            ),
          ],

          [
            "Missing to load",
            missing,
          ],
        ],

        styles: {
          fontSize:
            10,
        },

        headStyles: {
          fillColor: [
            240,
            240,
            240,
          ],
        },
      }
    );

    const tags =
      aircraftRows
        .slice()
        .sort(
          (
            a,
            b
          ) =>
            String(
              a.tag ||
                a.id
            ).localeCompare(
              String(
                b.tag ||
                  b.id
              )
            )
        )
        .map(
          (
            row
          ) => {
            const previousLocation =
              row.previousLocationLabel ||
              getReceivingLocationLabel(
                row.previousLocation
              );

            const previousDetails =
              normalizeReceivingLocation(
                row.previousLocation
              ) ===
                "BAGROOM" &&
              row.previousCartNumber
                ? `${previousLocation} / Cart ${row.previousCartNumber}`
                : previousLocation;

            return [
              String(
                row.tag ||
                  row.id
              ),

              row.bagTypeLabel ||
                getBagTypeLabel(
                  row.bagType
                ),

              previousDetails,

              formatDateTime(
                row.previousLocationAt
              ),

              `Z${
                row.zone ??
                "-"
              }`,

              row.scannedBy
                ?.username ||
                row.scannedBy
                  ?.fullName ||
                "-",
            ];
          }
        );

    autoTable(
      pdf,
      {
        startY:
          pdf.lastAutoTable
            .finalY +
          8,

        head: [
          [
            "Bag Tag",
            "Type",
            "Previous Location",
            "Previous Time",
            "Zone",
            "Loaded By",
          ],
        ],

        body:
          tags,

        styles: {
          fontSize:
            8,
        },

        headStyles: {
          fillColor: [
            240,
            240,
            240,
          ],
        },

        columnStyles: {
          0: {
            cellWidth:
              28,
          },

          1: {
            cellWidth:
              25,
          },

          2: {
            cellWidth:
              38,
          },

          3: {
            cellWidth:
              34,
          },

          4: {
            cellWidth:
              14,
          },

          5: {
            cellWidth:
              30,
          },
        },
      }
    );

    pdf.setFontSize(
      9
    );

    pdf.text(
      `Generated: ${new Date().toLocaleString()}`,
      14,
      pdf.lastAutoTable
        .finalY +
        10
    );

    return pdf;
  };

  const uploadPdfToStorage =
    async (
      pdfDocument
    ) => {
      const flightNumber =
        safeStr(
          flight
            ?.flightNumber,
          flightId
        );

      const flightDate =
        safeStr(
          flight
            ?.flightDate,
          "unknown-date"
        );

      const timestamp =
        new Date()
          .toISOString()
          .replaceAll(
            ":",
            "-"
          )
          .slice(
            0,
            19
          );

      const fileName =
        `BLCS_${flightNumber}_${flightDate}_${timestamp}.pdf`;

      const storagePath =
        `flights/${flightId}/reports/${fileName}`;

      const storageReference =
        sRef(
          storage,
          storagePath
        );

      const blob =
        pdfDocument.output(
          "blob"
        );

      await uploadBytes(
        storageReference,
        blob,
        {
          contentType:
            "application/pdf",

          customMetadata: {
            flightId:
              String(
                flightId
              ),

            flightNumber:
              String(
                flightNumber
              ),

            flightDate:
              String(
                flightDate
              ),

            generatedBy:
              String(
                user?.username ||
                  ""
              ),
          },
        }
      );

      const downloadUrl =
        await getDownloadURL(
          storageReference
        );

      return {
        path:
          storagePath,

        url:
          downloadUrl,

        fileName,
      };
    };

  /* =========================
     EXPORT PDF
  ========================= */

  const exportReportPdf =
    async () => {
      const timer =
        startSystemTimer();

      if (!flight) {
        const message =
          "Flight not loaded yet.";

        await logAircraftIncident({
          action:
            "EXPORT_PDF",

          status:
            "ERROR",

          severity:
            "MEDIUM",

          errorType:
            "FLIGHT_NOT_AVAILABLE",

          message,

          durationMs:
            timer.elapsed(),
        });

        popup(
          "Error",
          message,
          "danger"
        );

        return;
      }

      try {
        setExporting(
          true
        );

        setErr("");
        setMsg("");
        setCompleteMsg("");

        const pdfDocument =
          buildPdf({
            flightDoc:
              flight,

            aircraftRows:
              scans,

            receivingCount:
              loadingReceivingScans
                ? 0
                : bagroomTotal,
          });

        const downloadName =
          `BLCS_${safeStr(
            flight.flightNumber,
            flightId
          )}_${safeStr(
            flight.flightDate,
            "date"
          )}.pdf`;

        pdfDocument.save(
          downloadName
        );

        const uploaded =
          await uploadPdfToStorage(
            pdfDocument
          );

        await setDoc(
          doc(
            db,
            "flights",
            flightId,
            "reports",
            uploaded.fileName
          ),
          {
            type:
              "PDF_REPORT",

            createdAt:
              serverTimestamp(),

            createdBy:
              operationalActor,

            fileName:
              uploaded.fileName,

            storagePath:
              uploaded.path,

            downloadUrl:
              uploaded.url,

            snapshot: {
              gateTotal:
                typeof flight
                  ?.checkedBagsTotal ===
                "number"
                  ? flight
                      .checkedBagsTotal
                  : null,

              receivingTotal:
                loadingReceivingScans
                  ? null
                  : bagroomTotal,

              aircraftTotal:
                scans.length,

              pendingReceivingTotal:
                pendingReceivingScans.length,

              bagTypes:
                bagTypeCounts,
            },
          },
          {
            merge:
              true,
          }
        );

        setMsg(
          "\u2705 PDF exported and saved to flight reports."
        );

        await logSystemSuccess({
          module:
            "AIRCRAFT",

          action:
            "EXPORT_PDF",

          durationMs:
            timer.elapsed(),
        });

        focusScanner();
      } catch (
        error
      ) {
        console.error(
          error
        );

        const message =
          "Failed to export PDF. Check Storage rules/connection.";

        setErr(
          message
        );

        await logAircraftIncident({
          action:
            "EXPORT_PDF",

          status:
            "ERROR",

          severity:
            "HIGH",

          errorType:
            "PDF_STORAGE_FAILURE",

          errorCode:
            getErrorCode(
              error
            ),

          message:
            getErrorMessage(
              error,
              message
            ),

          durationMs:
            timer.elapsed(),

          metadata: {
            aircraftTotal:
              scans.length,

            receivingTotal:
              bagroomTotal,
          },
        });
      } finally {
        setExporting(
          false
        );
      }
    };

  /* =========================
     LOADING COMPLETED
  ========================= */

  const handleLoadingCompleted =
    async () => {
      setCompleteMsg(
        ""
      );

      if (!flight) {
        popup(
          "Error",
          "Flight not loaded yet.",
          "danger"
        );

        return;
      }

      const checkedTotal =
        flight.checkedBagsTotal;

      if (
        typeof checkedTotal !==
        "number"
      ) {
        const message =
          "Gate checked bags total not entered.";

        await logAircraftIncident({
          action:
            "LOADING_COMPLETED",

          status:
            "WARNING",

          severity:
            "MEDIUM",

          errorType:
            "GATE_TOTAL_MISSING",

          message,

          metadata: {
            aircraftTotal:
              scans.length,
          },
        });

        popup(
          "Gate total missing",
          "\u26A0\uFE0F Gate checked bags total not entered.\n\nGate Controller must enter total checked bags before completing loading.",
          "warning"
        );

        return;
      }

      const aircraftTotal =
        scans.length;

      const missing =
        checkedTotal -
        aircraftTotal;

      if (
        missing >
        0
      ) {
        await logAircraftIncident({
          action:
            "LOADING_COMPLETED",

          status:
            "WARNING",

          severity:
            "HIGH",

          errorType:
            "MISSING_BAGS",

          message:
            `${missing} bag(s) are missing before loading can be completed.`,

          metadata: {
            checkedTotal,

            aircraftTotal,

            missing,

            pendingReceiving:
              pendingReceivingScans.length,
          },
        });

        popup(
          "Missing bags",
          `\u274C LOADING NOT COMPLETED\n\n` +
            `Checked bags: ${checkedTotal}\n` +
            `Loaded: ${aircraftTotal}\n` +
            `Missing: ${missing}\n\n` +
            `Receiving pending: ${pendingReceivingScans.length}`,
          "danger"
        );

        return;
      }

      if (
        pendingReceivingScans.length >
        0
      ) {
        await logAircraftIncident({
          action:
            "LOADING_COMPLETED",

          status:
            "WARNING",

          severity:
            "HIGH",

          errorType:
            "RECEIVING_PENDING",

          message:
            `${pendingReceivingScans.length} received bag(s) remain pending Aircraft loading.`,

          metadata: {
            pendingReceiving:
              pendingReceivingScans.length,

            checkedTotal,

            aircraftTotal,
          },
        });

        popup(
          "Bags still pending",
          `\u26A0\uFE0F There are ${pendingReceivingScans.length} bags received but not scanned on the aircraft.\n\n` +
            `Review the pending bag locations before completing loading.`,
          "warning"
        );

        return;
      }

      show({
        title:
          "All bags loaded",

        tone:
          "success",

        showCancel:
          true,

        confirmText:
          "Mark Completed",

        cancelText:
          "Not yet",

        content: (
          <div
            style={{
              whiteSpace:
                "pre-wrap",
            }}
          >
            {`\u2705 ALL BAGS LOADED\n\n` +
              `Checked bags: ${checkedTotal}\n` +
              `Loaded on aircraft: ${aircraftTotal}\n\n` +
              `Checked Bags: ${bagTypeCounts.CHECKED_BAG}\n` +
              `Gate Checks: ${bagTypeCounts.GATE_CHECK}\n` +
              `Oversize: ${bagTypeCounts.OVERSIZE}\n\n` +
              `Mark loading completed and generate report PDF?`}
          </div>
        ),

        onCancel:
          () => {
            close();
            focusScanner();
          },

        onConfirm:
          async () => {
            close();

            const timer =
              startSystemTimer();

            try {
              setCompleting(
                true
              );

              await setDoc(
                doc(
                  db,
                  "flights",
                  flightId
                ),
                {
                  aircraftLoadingCompleted:
                    true,

                  aircraftLoadingCompletedAt:
                    serverTimestamp(),

                  aircraftLoadedBags:
                    aircraftTotal,

                  aircraftLoadedBagTypes:
                    bagTypeCounts,

                  aircraftLoadingCompletedBy:
                    operationalActor,

                  rampSupervisorOnDuty:
                    operationalActor.fullName ||
                    user?.username ||
                    null,

                  status:
                    "LOADED",

                  statusUpdatedAt:
                    serverTimestamp(),

                  statusUpdatedBy:
                    operationalActor,
                },
                {
                  merge:
                    true,
                }
              );

              await saveActionReport({
                type:
                  "LOADING_COMPLETED",

                reason:
                  "Aircraft loading completed.",

                extra: {
                  aircraftLoadedBags:
                    aircraftTotal,

                  gateCheckedTotal:
                    checkedTotal,

                  aircraftLoadedBagTypes:
                    bagTypeCounts,

                  receivingTotal:
                    bagroomTotal,

                  pendingReceivingTotal:
                    pendingReceivingScans.length,
                },
              });

              await exportReportPdf();

              setCompleteMsg(
                "\u2705 Aircraft loading completed successfully. Report saved."
              );

              await logSystemSuccess({
                module:
                  "AIRCRAFT",

                action:
                  "LOADING_COMPLETED",

                durationMs:
                  timer.elapsed(),
              });
            } catch (
              error
            ) {
              console.error(
                error
              );

              await logAircraftIncident({
                action:
                  "LOADING_COMPLETED",

                status:
                  "ERROR",

                severity:
                  "CRITICAL",

                errorType:
                  "LOADING_COMPLETION_FAILURE",

                errorCode:
                  getErrorCode(
                    error
                  ),

                message:
                  getErrorMessage(
                    error,
                    "Failed to mark loading completed / export PDF."
                  ),

                durationMs:
                  timer.elapsed(),

                metadata: {
                  checkedTotal,

                  aircraftTotal,

                  receivingTotal:
                    bagroomTotal,
                },
              });

              popup(
                "Error",
                "Failed to mark loading completed / export PDF.",
                "danger"
              );
            } finally {
              setCompleting(
                false
              );
            }
          },
      });
    };

  const scannerDisabled =
    isLoadingCompleted ||
    submittingTag !==
      "";

  const scannerPlaceholder =
    isLoadingCompleted
      ? "LOADING COMPLETED"
      : scannerMode
        ? "SCAN 10 DIGITS"
        : "ENTER 10 DIGITS";

  const pageGridColumns =
    compactScreen
      ? "1fr"
      : "minmax(280px, 0.8fr) minmax(420px, 1.4fr)";

  const renderPreviousLocationCard =
    (
      scan
    ) => {
      const location =
        normalizeReceivingLocation(
          scan.previousLocation
        );

      const valid =
        Boolean(
          scan.previousLocationValid
        );

      const locationLabel =
        scan.previousLocationLabel ||
        getReceivingLocationLabel(
          location
        );

      const locationDetails =
        location ===
          "BAGROOM" &&
        scan.previousCartNumber
          ? `${locationLabel} \u00B7 Cart ${scan.previousCartNumber}`
          : locationLabel;

      const previousUser =
        scan.previousLocationBy
          ?.fullName ||
        scan.previousLocationBy
          ?.username ||
        "-";

      return (
        <div
          style={{
            marginTop:
              5,

            padding:
              8,

            borderRadius:
              9,

            background:
              valid
                ? "#eff6ff"
                : "#fef2f2",

            border:
              valid
                ? "1px solid #bfdbfe"
                : "1px solid #fecaca",
          }}
        >
          <div
            style={{
              display:
                "flex",

              justifyContent:
                "space-between",

              gap:
                8,

              alignItems:
                "center",
            }}
          >
            <strong
              style={{
                color:
                  valid
                    ? "#1d4ed8"
                    : "#991b1b",

                fontSize:
                  "0.78rem",
              }}
            >
              {getLocationIcon(
                location
              )}{" "}
              {locationDetails}
            </strong>

            <span
              style={{
                color:
                  "#6b7280",

                fontSize:
                  "0.72rem",
              }}
            >
              {formatTime(
                scan.previousLocationAt
              )}
            </span>
          </div>

          <div
            style={{
              marginTop:
                3,

              color:
                "#6b7280",

              fontSize:
                "0.72rem",
            }}
          >
            Previous scan by{" "}
            <strong>
              {
                previousUser
              }
            </strong>
          </div>

          {!valid && (
            <div
              style={{
                marginTop:
                  4,

                color:
                  "#991b1b",

                fontSize:
                  "0.72rem",

                fontWeight:
                  900,
              }}
            >
              {"\u26A0\uFE0F Bag did not have a valid Bagroom, Oversize, or Gate/Ramp location before loading."}
            </div>
          )}
        </div>
      );
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
          compactScreen
            ? 0
            : 12,

        padding:
          compactScreen
            ? 10
            : 16,

        minHeight:
          "100%",
      }}
      onClick={(
        event
      ) => {
        const clickedInteractiveElement =
          event.target.closest?.(
            "button,input,select,textarea,a"
          );

        if (
          scannerMode &&
          !modal.open &&
          !clickedInteractiveElement
        ) {
          focusScanner();
        }
      }}
    >
      <div
        style={{
          display:
            "flex",

          justifyContent:
            "space-between",

          alignItems:
            compactScreen
              ? "stretch"
              : "flex-end",

          flexDirection:
            compactScreen
              ? "column"
              : "row",

          gap:
            12,

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
                compactScreen
                  ? "1.25rem"
                  : "1.5rem",
            }}
          >
            Aircraft Scan
          </h2>

          <p
            style={{
              margin:
                "6px 0 0",

              color:
                "#6b7280",

              fontSize:
                "0.9rem",
            }}
          >
            Scan bags while loading by zone 1-4.
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
              operationalActor.operationalPositionLabel
            }
          </div>

          {isLoadingCompleted && (
            <p
              style={{
                margin:
                  "8px 0 0",

                color:
                  "#16a34a",

                fontWeight:
                  900,
              }}
            >
              {"\u2705 Loading Completed"}
            </p>
          )}
        </div>

        <div
          style={{
            textAlign:
              compactScreen
                ? "left"
                : "right",

            fontSize:
              "0.9rem",

            padding:
              compactScreen
                ? 10
                : 0,

            borderRadius:
              10,

            background:
              compactScreen
                ? "#f9fafb"
                : "transparent",
          }}
        >
          <div>
            Flight:{" "}
            <strong>
              {flightLoading
                ? "\u2026"
                : flight
                    ?.flightNumber ||
                  flightId}
            </strong>
          </div>

          <div
            style={{
              color:
                "#6b7280",

              marginTop:
                3,
            }}
          >
            Date:{" "}
            <strong>
              {flightLoading
                ? "\u2026"
                : flight
                    ?.flightDate ||
                  "-"}
            </strong>
          </div>

          <div
            style={{
              color:
                "#6b7280",

              marginTop:
                3,
            }}
          >
            Gate:{" "}
            <strong>
              {flightLoading
                ? "\u2026"
                : flight
                    ?.gate ||
                  "-"}
            </strong>
          </div>
        </div>
      </div>

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

      {canReopenOrOffload &&
        isLoadingCompleted && (
          <section
            style={{
              border:
                "1px solid #f59e0b",

              borderRadius:
                12,

              padding:
                12,

              background:
                "#fef3c7",

              marginBottom:
                14,
            }}
          >
            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                gap:
                  12,

                flexWrap:
                  "wrap",

                alignItems:
                  "center",
              }}
            >
              <div>
                <h3
                  style={{
                    margin:
                      0,

                    color:
                      "#92400e",
                  }}
                >
                  Flight Locked
                </h3>

                <p
                  style={{
                    margin:
                      "6px 0 0",

                    color:
                      "#92400e",

                    fontSize:
                      "0.9rem",
                  }}
                >
                  To scan again or offload bags after completion, reopen the flight with a reason.
                </p>
              </div>

              <button
                type="button"
                onClick={
                  handleReopenFlight
                }
                disabled={
                  reopening
                }
                style={{
                  padding:
                    "12px 14px",

                  borderRadius:
                    12,

                  border:
                    "1px solid #f59e0b",

                  background:
                    "#f59e0b",

                  color:
                    "white",

                  fontWeight:
                    900,

                  cursor:
                    reopening
                      ? "not-allowed"
                      : "pointer",

                  opacity:
                    reopening
                      ? 0.7
                      : 1,

                  minHeight:
                    46,

                  touchAction:
                    "manipulation",
                }}
              >
                {reopening
                  ? "Reopening\u2026"
                  : "Reopen Flight"}
              </button>
            </div>
          </section>
        )}

      <div
        style={{
          display:
            "grid",

          gridTemplateColumns:
            pageGridColumns,

          gap:
            12,

          alignItems:
            "start",
        }}
      >
        <div
          style={{
            display:
              "grid",

            gap:
              12,
          }}
        >
          <section
            style={{
              border:
                "1px solid #e5e7eb",

              borderRadius:
                12,

              padding:
                compactScreen
                  ? 10
                  : 12,

              background:
                "#f9fafb",

              position:
                compactScreen
                  ? "sticky"
                  : "static",

              top:
                compactScreen
                  ? 6
                  : "auto",

              zIndex:
                compactScreen
                  ? 4
                  : "auto",

              boxShadow:
                compactScreen
                  ? "0 10px 22px rgba(15,23,42,0.08)"
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
                  10,

                flexWrap:
                  "wrap",
              }}
            >
              <div>
                <h3
                  style={{
                    margin:
                      0,
                  }}
                >
                  Scan
                </h3>

                <p
                  style={{
                    margin:
                      "5px 0 0",

                    color:
                      "#6b7280",

                    fontSize:
                      "0.82rem",
                  }}
                >
                  Android scanner ready.
                </p>
              </div>

              <div
                style={{
                  display:
                    "flex",

                  gap:
                    6,

                  padding:
                    4,

                  borderRadius:
                    10,

                  background:
                    "#e5e7eb",
                }}
              >
                <ScannerModeButton
                  active={
                    scannerMode
                  }

                  label="Scanner"

                  onClick={() =>
                    changeScannerMode(
                      true
                    )
                  }
                />

                <ScannerModeButton
                  active={
                    !scannerMode
                  }

                  label="Manual"

                  onClick={() =>
                    changeScannerMode(
                      false
                    )
                  }
                />
              </div>
            </div>

            <div
              style={{
                marginTop:
                  12,
              }}
            >
              <label
                style={{
                  display:
                    "block",

                  fontSize:
                    "0.82rem",

                  color:
                    "#374151",

                  marginBottom:
                    6,

                  fontWeight:
                    800,
                }}
              >
                Loading Zone
              </label>

              <div
                style={{
                  display:
                    "grid",

                  gridTemplateColumns:
                    "repeat(4, minmax(0, 1fr))",

                  gap:
                    6,
                }}
              >
                {[
                  1,
                  2,
                  3,
                  4,
                ].map(
                  (
                    zoneNumber
                  ) => (
                    <ZoneButton
                      key={
                        zoneNumber
                      }

                      zoneNumber={
                        zoneNumber
                      }

                      active={
                        Number(
                          zone
                        ) ===
                        zoneNumber
                      }

                      disabled={
                        isLoadingCompleted
                      }

                      onClick={() => {
                        setZone(
                          zoneNumber
                        );

                        focusScanner();
                      }}
                    />
                  )
                )}
              </div>
            </div>

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(3, minmax(0, 1fr))",

                gap:
                  6,

                marginTop:
                  10,
              }}
            >
              <AircraftQuickStat
                label="Loaded"

                value={
                  loadingScans
                    ? "\u2026"
                    : scans.length
                }

                tone="blue"
              />

              <AircraftQuickStat
                label="Waiting"

                value={
                  loadingReceivingScans ||
                  loadingScans
                    ? "\u2026"
                    : pendingReceivingScans.length
                }

                tone={
                  pendingReceivingScans.length >
                  0
                    ? "warn"
                    : "good"
                }
              />

              <AircraftQuickStat
                label="Missing"

                value={
                  missingNow ===
                  null
                    ? "\u2014"
                    : missingNow
                }

                tone={
                  missingNow ===
                  0
                    ? "good"
                    : missingNow ===
                        null
                      ? "default"
                      : "bad"
                }
              />
            </div>

            <label
              style={{
                display:
                  "block",

                fontSize:
                  "0.82rem",

                color:
                  "#374151",

                marginTop:
                  14,

                marginBottom:
                  6,

                fontWeight:
                  800,
              }}
            >
              Bag Tag
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

              onBlur={() => {
                if (
                  scannerMode &&
                  !modal.open &&
                  !scannerDisabled
                ) {
                  focusScanner(
                    100
                  );
                }
              }}

              disabled={
                scannerDisabled
              }

              inputMode={
                scannerMode
                  ? "none"
                  : "numeric"
              }

              pattern="[0-9]*"

              autoComplete="off"

              autoCorrect="off"

              autoCapitalize="off"

              spellCheck={
                false
              }

              enterKeyHint="done"

              maxLength={
                BAG_TAG_LENGTH
              }

              placeholder={
                scannerPlaceholder
              }

              aria-label="Bag tag scanner input"

              style={{
                width:
                  "100%",

                boxSizing:
                  "border-box",

                minHeight:
                  compactScreen
                    ? 64
                    : 52,

                padding:
                  compactScreen
                    ? "15px 12px"
                    : "13px 12px",

                borderRadius:
                  12,

                border:
                  tagInput.length ===
                  BAG_TAG_LENGTH
                    ? "2px solid #16a34a"
                    : "2px solid #2563eb",

                background:
                  scannerDisabled
                    ? "#f3f4f6"
                    : "white",

                color:
                  "#111827",

                fontSize:
                  compactScreen
                    ? "1.25rem"
                    : "1.1rem",

                fontWeight:
                  900,

                letterSpacing:
                  "0.08em",

                textAlign:
                  "center",

                outline:
                  "none",
              }}
            />

            <div
              style={{
                marginTop:
                  7,

                display:
                  "flex",

                justifyContent:
                  "space-between",

                gap:
                  8,

                alignItems:
                  "center",

                color:
                  "#6b7280",

                fontSize:
                  "0.76rem",
              }}
            >
              <span>
                {scannerMode
                  ? "Auto-submit at 10 digits"
                  : "Enter exactly 10 digits"}
              </span>

              <strong
                style={{
                  color:
                    tagInput.length ===
                    BAG_TAG_LENGTH
                      ? "#16a34a"
                      : "#6b7280",
                }}
              >
                {tagInput.length}/
                {BAG_TAG_LENGTH}
              </strong>
            </div>

            <button
              type="button"

              onClick={() =>
                handleScanSubmit()
              }

              disabled={
                scannerDisabled ||
                !isValidBagTag(
                  tagInput
                )
              }

              style={{
                width:
                  "100%",

                marginTop:
                  10,

                padding:
                  "13px 12px",

                borderRadius:
                  12,

                border:
                  "1px solid #1d4ed8",

                background:
                  scannerDisabled ||
                  !isValidBagTag(
                    tagInput
                  )
                    ? "#93c5fd"
                    : "#2563eb",

                color:
                  "white",

                fontWeight:
                  900,

                fontSize:
                  "0.95rem",

                cursor:
                  scannerDisabled ||
                  !isValidBagTag(
                    tagInput
                  )
                    ? "not-allowed"
                    : "pointer",

                minHeight:
                  48,

                touchAction:
                  "manipulation",
              }}
            >
              {submittingTag
                ? `Loading ${submittingTag}\u2026`
                : "Add Aircraft Scan"}
            </button>

            <button
              type="button"

              onClick={() =>
                exportReportPdf()
              }

              disabled={
                exporting ||
                !flight ||
                loadingScans
              }

              style={{
                width:
                  "100%",

                marginTop:
                  9,

                padding:
                  "12px",

                borderRadius:
                  12,

                border:
                  "1px solid #111827",

                background:
                  "#111827",

                color:
                  "white",

                fontWeight:
                  900,

                cursor:
                  exporting ||
                  !flight ||
                  loadingScans
                    ? "not-allowed"
                    : "pointer",

                opacity:
                  exporting ||
                  !flight ||
                  loadingScans
                    ? 0.7
                    : 1,

                minHeight:
                  46,

                touchAction:
                  "manipulation",
              }}
            >
              {exporting
                ? "Exporting\u2026"
                : "Export PDF Report"}
            </button>

            {strictManifest && (
              <p
                style={{
                  marginTop:
                    10,

                  marginBottom:
                    0,

                  color:
                    "#b91c1c",

                  fontSize:
                    "0.82rem",

                  fontWeight:
                    900,
                }}
              >
                {"\u26A0\uFE0F Strict Manifest ON"}
              </p>
            )}

            {msg && (
              <Notice
                tone="success"
                text={
                  msg
                }
              />
            )}

            {err && (
              <Notice
                tone="danger"
                text={
                  err
                }
              />
            )}

            {completeMsg && (
              <Notice
                tone="success"
                text={
                  completeMsg
                }
              />
            )}
          </section>

          {lastLoadedBag && (
            <section
              style={{
                border:
                  lastLoadedBag.previousLocationValid
                    ? "2px solid #16a34a"
                    : "2px solid #dc2626",

                borderRadius:
                  12,

                padding:
                  12,

                background:
                  lastLoadedBag.previousLocationValid
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
                    "center",

                  gap:
                    10,
                }}
              >
                <div>
                  <div
                    style={{
                      color:
                        lastLoadedBag.previousLocationValid
                          ? "#166534"
                          : "#991b1b",

                      fontSize:
                        "0.72rem",

                      fontWeight:
                        900,

                      textTransform:
                        "uppercase",

                      letterSpacing:
                        "0.05em",
                    }}
                  >
                    Last Loaded Bag
                  </div>

                  <div
                    style={{
                      marginTop:
                        3,

                      fontSize:
                        "1.2rem",

                      fontWeight:
                        900,

                      fontFamily:
                        "ui-monospace, monospace",
                    }}
                  >
                    {
                      lastLoadedBag.tag
                    }
                  </div>
                </div>

                <div
                  style={{
                    padding:
                      "6px 10px",

                    borderRadius:
                      999,

                    background:
                      lastLoadedBag.previousLocationValid
                        ? "#dcfce7"
                        : "#fee2e2",

                    color:
                      lastLoadedBag.previousLocationValid
                        ? "#166534"
                        : "#991b1b",

                    fontWeight:
                      900,

                    fontSize:
                      "0.78rem",
                  }}
                >
                  Zone{" "}
                  {
                    lastLoadedBag.zone
                  }
                </div>
              </div>

              <div
                style={{
                  marginTop:
                    10,
                }}
              >
                {renderPreviousLocationCard(
                  lastLoadedBag
                )}
              </div>
            </section>
          )}
        </div>

        <div
          style={{
            display:
              "grid",

            gap:
              12,
          }}
        >
          <section
            style={{
              border:
                "1px solid #e5e7eb",

              borderRadius:
                12,

              padding:
                12,
            }}
          >
            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                alignItems:
                  compactScreen
                    ? "stretch"
                    : "flex-end",

                flexDirection:
                  compactScreen
                    ? "column"
                    : "row",

                gap:
                  12,
              }}
            >
              <div>
                <h3
                  style={{
                    margin:
                      0,
                  }}
                >
                  Aircraft Scans
                </h3>

                <p
                  style={{
                    margin:
                      "6px 0 0",

                    color:
                      "#6b7280",

                    fontSize:
                      "0.86rem",
                  }}
                >
                  Total loaded:{" "}
                  <strong>
                    {loadingScans
                      ? "\u2026"
                      : scans.length}
                  </strong>
                </p>

                <p
                  style={{
                    margin:
                      "5px 0 0",

                    color:
                      "#6b7280",

                    fontSize:
                      "0.86rem",
                  }}
                >
                  Receiving scanned:{" "}
                  <strong>
                    {loadingReceivingScans
                      ? "\u2026"
                      : bagroomTotal}
                  </strong>
                </p>

                {typeof flight
                  ?.checkedBagsTotal ===
                  "number" &&
                  !loadingScans && (
                    <p
                      style={{
                        margin:
                          "5px 0 0",

                        fontSize:
                          "0.86rem",
                      }}
                    >
                      Gate total:{" "}
                      <strong>
                        {
                          flight.checkedBagsTotal
                        }
                      </strong>

                      {" \u00B7 "}

                      Missing:{" "}

                      <strong
                        style={{
                          color:
                            missingNow ===
                            0
                              ? "#16a34a"
                              : "#b91c1c",
                        }}
                      >
                        {
                          missingNow
                        }
                      </strong>
                    </p>
                  )}

                <div
                  style={{
                    marginTop:
                      8,

                    display:
                      "flex",

                    gap:
                      6,

                    flexWrap:
                      "wrap",

                    fontSize:
                      "0.78rem",
                  }}
                >
                  <span
                    style={
                      miniPill
                    }
                  >
                    Checked:{" "}
                    {
                      bagTypeCounts.CHECKED_BAG
                    }
                  </span>

                  <span
                    style={
                      miniPill
                    }
                  >
                    Gate Check:{" "}
                    {
                      bagTypeCounts.GATE_CHECK
                    }
                  </span>

                  <span
                    style={
                      miniPill
                    }
                  >
                    Oversize:{" "}
                    {
                      bagTypeCounts.OVERSIZE
                    }
                  </span>
                </div>
              </div>

              {canCompleteLoading && (
                <button
                  type="button"

                  onClick={
                    handleLoadingCompleted
                  }

                  disabled={
                    completing ||
                    isLoadingCompleted
                  }

                  style={{
                    padding:
                      "12px 14px",

                    borderRadius:
                      12,

                    border:
                      "none",

                    background:
                      completing ||
                      isLoadingCompleted
                        ? "#86efac"
                        : "#16a34a",

                    color:
                      "white",

                    fontWeight:
                      900,

                    cursor:
                      completing ||
                      isLoadingCompleted
                        ? "not-allowed"
                        : "pointer",

                    minHeight:
                      46,

                    touchAction:
                      "manipulation",
                  }}
                >
                  {isLoadingCompleted
                    ? "Completed"
                    : completing
                      ? "Checking\u2026"
                      : "Loading Completed"}
                </button>
              )}
            </div>

            <div
              style={{
                marginTop:
                  12,

                maxHeight:
                  compactScreen
                    ? 440
                    : 520,

                overflow:
                  "auto",

                borderTop:
                  "1px solid #e5e7eb",
              }}
            >
              {loadingScans ? (
                <p
                  style={{
                    color:
                      "#6b7280",

                    paddingTop:
                      10,
                  }}
                >
                  {"Loading\u2026"}
                </p>
              ) : scans.length ===
                0 ? (
                <p
                  style={{
                    color:
                      "#6b7280",

                    paddingTop:
                      10,
                  }}
                >
                  No scans yet.
                </p>
              ) : compactScreen ? (
                <div
                  style={{
                    paddingTop:
                      8,

                    display:
                      "grid",

                    gap:
                      8,
                  }}
                >
                  {scans.map(
                    (
                      scan
                    ) => {
                      const tag =
                        normalizeBagTag(
                          scan.tag ||
                            scan.id
                        );

                      const busy =
                        offloadingTag ===
                        tag;

                      return (
                        <div
                          key={
                            scan.id
                          }
                          style={{
                            padding:
                              10,

                            borderRadius:
                              10,

                            border:
                              "1px solid #e5e7eb",

                            background:
                              "white",
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
                            }}
                          >
                            <div>
                              <strong
                                style={{
                                  fontFamily:
                                    "ui-monospace, monospace",

                                  fontSize:
                                    "1rem",
                                }}
                              >
                                {
                                  tag
                                }
                              </strong>

                              <div
                                style={{
                                  marginTop:
                                    3,

                                  color:
                                    "#6b7280",

                                  fontSize:
                                    "0.75rem",
                                }}
                              >
                                {scan.bagTypeLabel ||
                                  getBagTypeLabel(
                                    scan.bagType
                                  )}

                                {" \u00B7 Zone "}

                                {scan.zone ??
                                  "-"}

                                {" \u00B7 "}

                                {scan.scannedBy
                                  ?.fullName ||
                                  scan.scannedBy
                                    ?.username ||
                                  "-"}
                              </div>
                            </div>

                            {canReopenOrOffload && (
                              <button
                                type="button"

                                onClick={() =>
                                  handleOffloadBag(
                                    scan
                                  )
                                }

                                disabled={
                                  busy
                                }

                                style={{
                                  padding:
                                    "7px 10px",

                                  borderRadius:
                                    999,

                                  border:
                                    "1px solid #ef4444",

                                  background:
                                    "#ef4444",

                                  color:
                                    "white",

                                  fontWeight:
                                    900,

                                  cursor:
                                    busy
                                      ? "not-allowed"
                                      : "pointer",

                                  opacity:
                                    busy
                                      ? 0.7
                                      : 1,

                                  touchAction:
                                    "manipulation",
                                }}
                              >
                                {busy
                                  ? "\u2026"
                                  : "Offload"}
                              </button>
                            )}
                          </div>

                          {renderPreviousLocationCard(
                            scan
                          )}
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <table
                  style={{
                    width:
                      "100%",

                    borderCollapse:
                      "collapse",

                    fontSize:
                      "0.86rem",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background:
                          "#f9fafb",
                      }}
                    >
                      <th
                        style={
                          th
                        }
                      >
                        Tag
                      </th>

                      <th
                        style={
                          th
                        }
                      >
                        Type
                      </th>

                      <th
                        style={
                          th
                        }
                      >
                        Previous Location
                      </th>

                      <th
                        style={
                          th
                        }
                      >
                        Zone
                      </th>

                      <th
                        style={
                          th
                        }
                      >
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
                    {scans.map(
                      (
                        scan
                      ) => {
                        const tag =
                          normalizeBagTag(
                            scan.tag ||
                              scan.id
                          );

                        const busy =
                          offloadingTag ===
                          tag;

                        const location =
                          normalizeReceivingLocation(
                            scan.previousLocation
                          );

                        const locationLabel =
                          scan.previousLocationLabel ||
                          getReceivingLocationLabel(
                            location
                          );

                        const previousDetails =
                          location ===
                            "BAGROOM" &&
                          scan.previousCartNumber
                            ? `${locationLabel} \u00B7 Cart ${scan.previousCartNumber}`
                            : locationLabel;

                        return (
                          <tr
                            key={
                              scan.id
                            }
                            style={{
                              background:
                                scan.previousLocationValid
                                  ? "white"
                                  : "#fef2f2",
                            }}
                          >
                            <td
                              style={
                                td
                              }
                            >
                              <strong>
                                {
                                  tag
                                }
                              </strong>
                            </td>

                            <td
                              style={
                                td
                              }
                            >
                              {scan.bagTypeLabel ||
                                getBagTypeLabel(
                                  scan.bagType
                                )}
                            </td>

                            <td
                              style={
                                td
                              }
                            >
                              <div
                                style={{
                                  fontWeight:
                                    800,

                                  color:
                                    scan.previousLocationValid
                                      ? "#1d4ed8"
                                      : "#991b1b",
                                }}
                              >
                                {getLocationIcon(
                                  location
                                )}{" "}
                                {
                                  previousDetails
                                }
                              </div>

                              <div
                                style={{
                                  marginTop:
                                    2,

                                  color:
                                    "#6b7280",

                                  fontSize:
                                    "0.72rem",
                                }}
                              >
                                {formatTime(
                                  scan.previousLocationAt
                                )}

                                {" \u00B7 "}

                                {scan.previousLocationBy
                                  ?.fullName ||
                                  scan.previousLocationBy
                                    ?.username ||
                                  "-"}
                              </div>
                            </td>

                            <td
                              style={
                                td
                              }
                            >
                              {scan.zone ??
                                "-"}
                            </td>

                            <td
                              style={{
                                ...td,

                                color:
                                  "#6b7280",
                              }}
                            >
                              {scan.scannedBy
                                ?.fullName ||
                                scan.scannedBy
                                  ?.username ||
                                "-"}
                            </td>

                            <td
                              style={{
                                ...td,

                                textAlign:
                                  "right",
                              }}
                            >
                              {canReopenOrOffload && (
                                <button
                                  type="button"

                                  onClick={() =>
                                    handleOffloadBag(
                                      scan
                                    )
                                  }

                                  disabled={
                                    busy
                                  }

                                  style={{
                                    padding:
                                      "6px 10px",

                                    borderRadius:
                                      999,

                                    border:
                                      "1px solid #ef4444",

                                    background:
                                      "#ef4444",

                                    color:
                                      "white",

                                    fontWeight:
                                      800,

                                    cursor:
                                      busy
                                        ? "not-allowed"
                                        : "pointer",

                                    opacity:
                                      busy
                                        ? 0.7
                                        : 1,
                                  }}
                                >
                                  {busy
                                    ? "Offloading\u2026"
                                    : "Offload"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <p
              style={{
                marginTop:
                  10,

                marginBottom:
                  0,

                color:
                  "#6b7280",

                fontSize:
                  "0.76rem",
              }}
            >
              Scanner mode saves automatically after 10 digits. Enter and Tab are also supported.
            </p>
          </section>

          <section
            style={{
              border:
                "1px solid #e5e7eb",

              borderRadius:
                12,

              padding:
                12,

              background:
                "#f9fafb",
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
                  10,
              }}
            >
              <div>
                <h3
                  style={{
                    margin:
                      0,
                  }}
                >
                  Last 5 Loaded Bags
                </h3>

                <p
                  style={{
                    margin:
                      "5px 0 0",

                    color:
                      "#6b7280",

                    fontSize:
                      "0.78rem",
                  }}
                >
                  Previous location before aircraft loading.
                </p>
              </div>

              <span
                style={{
                  ...miniPill,

                  background:
                    "#dbeafe",

                  color:
                    "#1d4ed8",

                  border:
                    "1px solid #bfdbfe",
                }}
              >
                {
                  lastFiveLoadedBags.length
                }
              </span>
            </div>

            <div
              style={{
                marginTop:
                  10,

                display:
                  "grid",

                gap:
                  7,
              }}
            >
              {lastFiveLoadedBags.length ===
              0 ? (
                <div
                  style={{
                    color:
                      "#6b7280",

                    fontSize:
                      "0.82rem",
                  }}
                >
                  No loaded bags yet.
                </div>
              ) : (
                lastFiveLoadedBags.map(
                  (
                    scan
                  ) => {
                    const tag =
                      normalizeBagTag(
                        scan.tag ||
                          scan.id
                      );

                    const location =
                      normalizeReceivingLocation(
                        scan.previousLocation
                      );

                    const valid =
                      Boolean(
                        scan.previousLocationValid
                      );

                    return (
                      <div
                        key={
                          scan.id
                        }
                        style={{
                          padding:
                            9,

                          borderRadius:
                            10,

                          border:
                            valid
                              ? "1px solid #bfdbfe"
                              : "1px solid #fecaca",

                          background:
                            valid
                              ? "white"
                              : "#fef2f2",

                          display:
                            "flex",

                          justifyContent:
                            "space-between",

                          alignItems:
                            "center",

                          gap:
                            10,
                        }}
                      >
                        <div
                          style={{
                            minWidth:
                              0,
                          }}
                        >
                          <div
                            style={{
                              fontFamily:
                                "ui-monospace, monospace",

                              fontWeight:
                                900,
                            }}
                          >
                            {
                              tag
                            }
                          </div>

                          <div
                            style={{
                              marginTop:
                                3,

                              color:
                                valid
                                  ? "#1d4ed8"
                                  : "#991b1b",

                              fontSize:
                                "0.74rem",

                              fontWeight:
                                800,
                            }}
                          >
                            {getLocationIcon(
                              location
                            )}{" "}

                            {scan.previousLocationDetails ||
                              scan.previousLocationLabel ||
                              getReceivingLocationLabel(
                                location
                              )}
                          </div>
                        </div>

                        <div
                          style={{
                            textAlign:
                              "right",

                            whiteSpace:
                              "nowrap",
                          }}
                        >
                          <div
                            style={{
                              fontWeight:
                                900,

                              fontSize:
                                "0.78rem",
                            }}
                          >
                            Z
                            {scan.zone ??
                              "-"}
                          </div>

                          <div
                            style={{
                              marginTop:
                                2,

                              color:
                                "#6b7280",

                              fontSize:
                                "0.68rem",
                            }}
                          >
                            {formatTime(
                              scan.createdAt
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }
                )
              )}
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={
          modal.open
        }

        title={
          modal.title
        }

        tone={
          modal.tone
        }

        confirmText={
          modal.confirmText
        }

        cancelText={
          modal.cancelText
        }

        showCancel={
          modal.showCancel
        }

        onConfirm={() => {
          if (
            typeof modal.onConfirm ===
            "function"
          ) {
            modal.onConfirm();
          } else {
            close();
            focusScanner();
          }
        }}

        onCancel={() => {
          if (
            typeof modal.onCancel ===
            "function"
          ) {
            modal.onCancel();
          } else {
            close();
            focusScanner();
          }
        }}
      >
        {
          modal.content
        }
      </Modal>
    </div>
  );
}

/* =========================
   UI COMPONENTS
========================= */

function ScannerModeButton({
  active,
  label,
  onClick,
}) {
  return (
    <button
      type="button"

      onPointerDown={(
        event
      ) => {
        event.stopPropagation();
      }}

      onClick={(
        event
      ) => {
        event.preventDefault();
        event.stopPropagation();

        if (
          typeof onClick ===
          "function"
        ) {
          onClick();
        }
      }}

      style={{
        padding:
          "7px 10px",

        borderRadius:
          8,

        border:
          active
            ? "1px solid #2563eb"
            : "1px solid transparent",

        background:
          active
            ? "white"
            : "transparent",

        color:
          active
            ? "#1d4ed8"
            : "#6b7280",

        fontWeight:
          900,

        fontSize:
          "0.76rem",

        cursor:
          "pointer",

        touchAction:
          "manipulation",
      }}
    >
      {label}
    </button>
  );
}

function ZoneButton({
  zoneNumber,
  active,
  disabled,
  onClick,
}) {
  return (
    <button
      type="button"

      disabled={
        disabled
      }

      onPointerDown={(
        event
      ) => {
        event.stopPropagation();
      }}

      onClick={(
        event
      ) => {
        event.preventDefault();
        event.stopPropagation();

        if (
          typeof onClick ===
          "function"
        ) {
          onClick();
        }
      }}

      style={{
        minHeight:
          48,

        padding:
          "8px 4px",

        borderRadius:
          10,

        border:
          active
            ? "2px solid #2563eb"
            : "1px solid #d1d5db",

        background:
          active
            ? "#dbeafe"
            : disabled
              ? "#f3f4f6"
              : "white",

        color:
          active
            ? "#1d4ed8"
            : "#374151",

        fontWeight:
          900,

        cursor:
          disabled
            ? "not-allowed"
            : "pointer",

        opacity:
          disabled
            ? 0.7
            : 1,

        touchAction:
          "manipulation",

        WebkitTapHighlightColor:
          "transparent",
      }}
    >
      Z{zoneNumber}
    </button>
  );
}

function Notice({
  tone = "info",
  text,
}) {
  const styles = {
    success: {
      background:
        "#f0fdf4",

      border:
        "#86efac",

      color:
        "#166534",
    },

    danger: {
      background:
        "#fef2f2",

      border:
        "#fecaca",

      color:
        "#991b1b",
    },

    warning: {
      background:
        "#fffbeb",

      border:
        "#fde68a",

      color:
        "#92400e",
    },

    info: {
      background:
        "#eff6ff",

      border:
        "#bfdbfe",

      color:
        "#1d4ed8",
    },
  };

  const selected =
    styles[
      tone
    ] ||
    styles.info;

  return (
    <div
      style={{
        marginTop:
          10,

        padding:
          10,

        borderRadius:
          10,

        background:
          selected.background,

        border:
          `1px solid ${selected.border}`,

        color:
          selected.color,

        fontSize:
          "0.82rem",

        fontWeight:
          800,

        whiteSpace:
          "pre-wrap",
      }}
    >
      {text}
    </div>
  );
}

function AircraftQuickStat({
  label,
  value,
  tone = "default",
}) {
  const tones = {
    default: {
      background:
        "#f3f4f6",

      border:
        "#e5e7eb",

      color:
        "#374151",
    },

    blue: {
      background:
        "#eff6ff",

      border:
        "#bfdbfe",

      color:
        "#1d4ed8",
    },

    good: {
      background:
        "#dcfce7",

      border:
        "#86efac",

      color:
        "#166534",
    },

    warn: {
      background:
        "#ffedd5",

      border:
        "#fdba74",

      color:
        "#9a3412",
    },

    bad: {
      background:
        "#fee2e2",

      border:
        "#fca5a5",

      color:
        "#991b1b",
    },
  };

  const selected =
    tones[
      tone
    ] ||
    tones.default;

  return (
    <div
      style={{
        minWidth:
          0,

        padding:
          "8px 5px",

        borderRadius:
          10,

        background:
          selected.background,

        border:
          `1px solid ${selected.border}`,

        color:
          selected.color,

        textAlign:
          "center",
      }}
    >
      <div
        style={{
          fontSize:
            "0.67rem",

          fontWeight:
            900,

          textTransform:
            "uppercase",

          letterSpacing:
            "0.03em",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            2,

          fontSize:
            "1.2rem",

          fontWeight:
            900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const miniPill = {
  display:
    "inline-flex",

  alignItems:
    "center",

  padding:
    "4px 8px",

  borderRadius:
    999,

  background:
    "#f3f4f6",

  border:
    "1px solid #e5e7eb",

  color:
    "#374151",

  fontWeight:
    800,
};

const th = {
  textAlign:
    "left",

  padding:
    "10px 8px",

  borderBottom:
    "1px solid #e5e7eb",

  fontSize:
    "0.75rem",

  textTransform:
    "uppercase",

  letterSpacing:
    "0.04em",

  color:
    "#6b7280",

  whiteSpace:
    "nowrap",

  position:
    "sticky",

  top:
    0,

  background:
    "#f9fafb",

  zIndex:
    1,
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

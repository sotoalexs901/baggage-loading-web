// src/utils/systemLogger.js

import {
  addDoc,
  collection,
  doc,
  increment,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "../firebase";

export const BLCS_VERSION = "1.7";

const PRESENCE_INTERVAL_MS =
  2 * 60 * 1000;

const PRESENCE_ONLINE_WINDOW_MS =
  5 * 60 * 1000;

/* =========================
   BASIC HELPERS
========================= */

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeModule(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[\s/-]+/g, "_");
}

function normalizeStatus(value) {
  const status = cleanText(value).toUpperCase();

  if (
    [
      "SUCCESS",
      "WARNING",
      "ERROR",
      "INFO",
    ].includes(status)
  ) {
    return status;
  }

  return "INFO";
}

function normalizeSeverity(value) {
  const severity = cleanText(value).toUpperCase();

  if (
    [
      "LOW",
      "MEDIUM",
      "HIGH",
      "CRITICAL",
    ].includes(severity)
  ) {
    return severity;
  }

  return "LOW";
}

function getTodayKey() {
  const now = new Date();

  const year =
    now.getFullYear();

  const month =
    String(
      now.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      now.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getHourKey() {
  const hour =
    new Date().getHours();

  return String(hour).padStart(
    2,
    "0"
  );
}

function safeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function getPerformanceBucket(
  durationMs
) {
  const value =
    safeNumber(durationMs);

  if (value <= 0) {
    return "unknown";
  }

  if (value < 1000) {
    return "fast";
  }

  if (value < 2000) {
    return "normal";
  }

  if (value < 4000) {
    return "slow";
  }

  return "critical";
}

/* =========================
   SUGGESTED ACTION
========================= */

export function getSuggestedAction({
  errorType,
  code,
  message,
}) {
  const combined =
    `${errorType || ""} ${code || ""} ${message || ""}`
      .toLowerCase();

  if (
    combined.includes(
      "permission-denied"
    ) ||
    combined.includes(
      "permission denied"
    ) ||
    combined.includes(
      "missing or insufficient permissions"
    )
  ) {
    return {
      category:
        "PERMISSION",

      title:
        "Review Firestore Rules",

      recommendation:
        "The user reached a Firebase permission restriction. Review the Firestore rules for this module and role.",
    };
  }

  if (
    combined.includes(
      "network"
    ) ||
    combined.includes(
      "offline"
    ) ||
    combined.includes(
      "timeout"
    ) ||
    combined.includes(
      "unavailable"
    )
  ) {
    return {
      category:
        "CONNECTION",

      title:
        "Check Connection / Refresh",

      recommendation:
        "Check the device internet connection. If connectivity is stable, refresh BLCS and try again.",
    };
  }

  if (
    combined.includes(
      "functions/internal"
    ) ||
    combined.includes(
      "cloud function"
    ) ||
    combined.includes(
      "backend"
    )
  ) {
    return {
      category:
        "BACKEND",

      title:
        "Check Firebase Functions",

      recommendation:
        "The frontend reached a backend-related failure. Verify Firebase Functions deployment and logs.",
    };
  }

  if (
    combined.includes(
      "duplicate"
    ) ||
    combined.includes(
      "already scanned"
    )
  ) {
    return {
      category:
        "USER_PROCESS",

      title:
        "Verify Bag Tag",

      recommendation:
        "This appears to be a duplicate operational action. Verify the bag tag before scanning again.",
    };
  }

  if (
    combined.includes(
      "10 digit"
    ) ||
    combined.includes(
      "invalid tag"
    ) ||
    combined.includes(
      "bag tag must"
    )
  ) {
    return {
      category:
        "USER_PROCESS",

      title:
        "Verify Bag Tag",

      recommendation:
        "Confirm that the bag tag contains exactly 10 digits and rescan.",
    };
  }

  if (
    combined.includes(
      "wrong flight"
    ) ||
    combined.includes(
      "different flight"
    )
  ) {
    return {
      category:
        "OPERATIONAL",

      title:
        "Verify Flight Assignment",

      recommendation:
        "The bag appears associated with another flight. Verify the flight/date before continuing.",
    };
  }

  if (
    combined.includes(
      "previous location"
    ) ||
    combined.includes(
      "unknown location"
    )
  ) {
    return {
      category:
        "OPERATIONAL",

      title:
        "Verify Previous Scan",

      recommendation:
        "Review Counter, Bagroom, Oversize or Gate/Ramp history for this bag before aircraft loading.",
    };
  }

  return {
    category:
      "SYSTEM",

    title:
      "Review Incident",

    recommendation:
      "Review the incident details. If the page appears stale, refresh BLCS before making code or permission changes.",
  };
}

/* =========================
   DAILY METRICS
========================= */

export async function recordSystemMetric({
  module,
  action,
  status = "SUCCESS",
  durationMs = null,
}) {
  const normalizedModule =
    normalizeModule(module);

  const normalizedAction =
    normalizeModule(action);

  const normalizedStatus =
    normalizeStatus(status);

  if (!normalizedModule) {
    return;
  }

  const dateKey =
    getTodayKey();

  const metricId =
    `${dateKey}_${normalizedModule}`;

  const metricRef =
    doc(
      db,
      "systemMetricsDaily",
      metricId
    );

  const duration =
    safeNumber(durationMs);

  const bucket =
    getPerformanceBucket(
      duration
    );

  const updates = {
    date:
      dateKey,

    module:
      normalizedModule,

    lastActivityAt:
      serverTimestamp(),

    totalActions:
      increment(1),

    actions: {
      [normalizedAction || "GENERAL"]:
        increment(1),
    },

    statusCounts: {
      [normalizedStatus]:
        increment(1),
    },

    hourly: {
      [getHourKey()]:
        increment(1),
    },
  };

  if (duration > 0) {
    updates.performanceSamples =
      increment(1);

    updates.totalDurationMs =
      increment(duration);

    updates.performanceBuckets = {
      [bucket]:
        increment(1),
    };

    updates.lastDurationMs =
      duration;
  }

  await setDoc(
    metricRef,
    updates,
    {
      merge: true,
    }
  );
}

/* =========================
   INCIDENT LOGGER
========================= */

export async function logSystemIncident({
  module,
  action,
  status = "ERROR",
  severity = "MEDIUM",

  errorType = null,
  errorCode = null,
  message = null,

  user = null,
  operationalContext = null,

  flightId = null,
  flightNumber = null,
  bagTag = null,

  durationMs = null,

  currentView = null,

  metadata = {},
}) {
  const normalizedStatus =
    normalizeStatus(status);

  const suggestion =
    getSuggestedAction({
      errorType,
      code:
        errorCode,
      message,
    });

  try {
    await addDoc(
      collection(
        db,
        "systemIncidents"
      ),
      {
        module:
          normalizeModule(
            module
          ),

        action:
          normalizeModule(
            action
          ),

        status:
          normalizedStatus,

        severity:
          normalizeSeverity(
            severity
          ),

        errorType:
          cleanText(
            errorType
          ) || null,

        errorCode:
          cleanText(
            errorCode
          ) || null,

        message:
          cleanText(
            message
          ) || null,

        suggestedAction:
          suggestion,

        user: {
          userId:
            user?.id ||
            null,

          username:
            user?.username ||
            null,

          fullName:
            user?.fullName ||
            null,

          role:
            user?.role ||
            null,

          operationalPosition:
            operationalContext
              ?.operationalPosition ||
            null,

          operationalPositionLabel:
            operationalContext
              ?.operationalPositionLabel ||
            null,
        },

        flightId:
          flightId ||
          null,

        flightNumber:
          flightNumber ||
          null,

        bagTag:
          bagTag ||
          null,

        durationMs:
          durationMs ===
          null
            ? null
            : safeNumber(
                durationMs
              ),

        currentView:
          currentView ||
          null,

        appVersion:
          BLCS_VERSION,

        metadata:
          metadata &&
          typeof metadata ===
            "object"
            ? metadata
            : {},

        resolved:
          false,

        createdAt:
          serverTimestamp(),
      }
    );
  } catch (error) {
    /*
     * Monitoring must NEVER break
     * the operational application.
     */
    console.warn(
      "Unable to save system incident:",
      error
    );
  }

  try {
    await recordSystemMetric({
      module,
      action,
      status:
        normalizedStatus,

      durationMs,
    });
  } catch (error) {
    console.warn(
      "Unable to save system metric:",
      error
    );
  }
}

/* =========================
   SUCCESS LOGGER
========================= */

export async function logSystemSuccess({
  module,
  action,
  durationMs = null,
}) {
  try {
    await recordSystemMetric({
      module,
      action,
      status:
        "SUCCESS",
      durationMs,
    });
  } catch (error) {
    console.warn(
      "Unable to save success metric:",
      error
    );
  }
}

/* =========================
   OPERATION TIMER
========================= */

export function startSystemTimer() {
  const start =
    typeof performance !==
      "undefined"
      ? performance.now()
      : Date.now();

  return {
    elapsed() {
      const end =
        typeof performance !==
          "undefined"
          ? performance.now()
          : Date.now();

      return Math.round(
        end - start
      );
    },
  };
}

/* =========================
   USER PRESENCE
========================= */

export async function updateSystemPresence({
  user,
  operationalContext,
  currentView,
}) {
  if (!user?.id) {
    return;
  }

  try {
    await setDoc(
      doc(
        db,
        "systemPresence",
        user.id
      ),
      {
        userId:
          user.id,

        username:
          user?.username ||
          null,

        fullName:
          user?.fullName ||
          user?.username ||
          null,

        role:
          user?.role ||
          null,

        operationalPosition:
          operationalContext
            ?.operationalPosition ||
          null,

        operationalPositionLabel:
          operationalContext
            ?.operationalPositionLabel ||
          null,

        currentView:
          currentView ||
          "unknown",

        appVersion:
          BLCS_VERSION,

        userAgent:
          typeof navigator !==
            "undefined"
            ? navigator.userAgent
            : null,

        viewport:
          typeof window !==
            "undefined"
            ? {
                width:
                  window.innerWidth,

                height:
                  window.innerHeight,
              }
            : null,

        lastSeenAt:
          serverTimestamp(),
      },
      {
        merge: true,
      }
    );
  } catch (error) {
    console.warn(
      "Presence update failed:",
      error
    );
  }
}

export function createPresenceHeartbeat({
  user,
  operationalContext,
  getCurrentView,
}) {
  let timer = null;

  const sendPresence =
    async () => {
      await updateSystemPresence({
        user,

        operationalContext,

        currentView:
          typeof getCurrentView ===
            "function"
            ? getCurrentView()
            : null,
      });
    };

  sendPresence();

  timer =
    window.setInterval(
      sendPresence,
      PRESENCE_INTERVAL_MS
    );

  return () => {
    if (timer) {
      window.clearInterval(
        timer
      );
    }
  };
}

export function isPresenceOnline(
  timestamp
) {
  if (!timestamp) {
    return false;
  }

  try {
    const date =
      timestamp.toDate
        ? timestamp.toDate()
        : new Date(timestamp);

    return (
      Date.now() -
        date.getTime() <
      PRESENCE_ONLINE_WINDOW_MS
    );
  } catch {
    return false;
  }
}

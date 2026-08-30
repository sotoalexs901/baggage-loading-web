// src/pages/SystemMonitorPage.jsx

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import {
  db,
  functions,
} from "../firebase";

import {
  BLCS_VERSION,
  isPresenceOnline,
  logSystemIncident,
  logSystemSuccess,
  startSystemTimer,
} from "../utils/systemLogger.js";

const MODULES = [
  "DASHBOARD",
  "FLIGHTS",
  "COUNTER",
  "GATE",
  "BAGROOM",
  "AIRCRAFT",
  "TRACKING",
  "REPORTS",
  "BACKEND",
];

/* =========================
   HELPERS
========================= */

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeModule(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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

function timestampToDate(value) {
  if (!value) {
    return null;
  }

  try {
    if (
      typeof value.toDate ===
      "function"
    ) {
      return value.toDate();
    }

    if (
      typeof value.seconds ===
      "number"
    ) {
      return new Date(
        value.seconds * 1000
      );
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return null;
    }

    return date;
  } catch {
    return null;
  }
}

function formatTimestamp(value) {
  const date =
    timestampToDate(value);

  if (!date) {
    return "-";
  }

  return date.toLocaleString();
}

function isTodayTimestamp(value) {
  const date =
    timestampToDate(value);

  if (!date) {
    return false;
  }

  const now =
    new Date();

  return (
    date.getFullYear() ===
      now.getFullYear() &&
    date.getMonth() ===
      now.getMonth() &&
    date.getDate() ===
      now.getDate()
  );
}

function safeNumber(value) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : 0;
}

function getPerformanceLabel(milliseconds) {
  const value =
    safeNumber(
      milliseconds
    );

  if (value <= 0) {
    return {
      label:
        "No Data",

      tone:
        "neutral",
    };
  }

  if (value < 1000) {
    return {
      label:
        "Fast",

      tone:
        "good",
    };
  }

  if (value < 2000) {
    return {
      label:
        "Normal",

      tone:
        "blue",
    };
  }

  if (value < 4000) {
    return {
      label:
        "Slow",

      tone:
        "warning",
    };
  }

  return {
    label:
      "Critical",

    tone:
      "danger",
  };
}

function getModuleHealth(metric) {
  if (!metric) {
    return {
      status:
        "NO DATA",

      tone:
        "neutral",

      successRate:
        null,

      total:
        0,

      success:
        0,

      warning:
        0,

      error:
        0,

      averageMs:
        0,
    };
  }

  const total =
    safeNumber(
      metric.totalActions
    );

  const success =
    safeNumber(
      metric.statusCounts
        ?.SUCCESS
    );

  const warning =
    safeNumber(
      metric.statusCounts
        ?.WARNING
    );

  const error =
    safeNumber(
      metric.statusCounts
        ?.ERROR
    );

  const performanceSamples =
    safeNumber(
      metric.performanceSamples
    );

  const totalDurationMs =
    safeNumber(
      metric.totalDurationMs
    );

  const averageMs =
    performanceSamples > 0
      ? totalDurationMs /
        performanceSamples
      : 0;

  if (total <= 0) {
    return {
      status:
        "NO DATA",

      tone:
        "neutral",

      successRate:
        null,

      total,
      success,
      warning,
      error,
      averageMs,
    };
  }

  const successRate =
    (success / total) *
    100;

  if (
    error > 0 ||
    successRate < 80
  ) {
    return {
      status:
        "ATTENTION",

      tone:
        "danger",

      successRate,
      total,
      success,
      warning,
      error,
      averageMs,
    };
  }

  if (
    warning > 0 ||
    successRate < 95 ||
    averageMs >= 4000
  ) {
    return {
      status:
        "WARNING",

      tone:
        "warning",

      successRate,
      total,
      success,
      warning,
      error,
      averageMs,
    };
  }

  return {
    status:
      "HEALTHY",

    tone:
      "good",

    successRate,
    total,
    success,
    warning,
    error,
    averageMs,
  };
}

/* =========================
   PAGE
========================= */

export default function SystemMonitorPage({
  user,
}) {
  const role =
    normalizeRole(
      user?.role
    );

  const [
    metrics,
    setMetrics,
  ] = useState([]);

  const [
    incidents,
    setIncidents,
  ] = useState([]);

  const [
    presence,
    setPresence,
  ] = useState([]);

  const [
    selectedIncident,
    setSelectedIncident,
  ] = useState(null);

  const [
    loadingMetrics,
    setLoadingMetrics,
  ] = useState(true);

  const [
    loadingIncidents,
    setLoadingIncidents,
  ] = useState(true);

  const [
    loadingPresence,
    setLoadingPresence,
  ] = useState(true);

  const [
    resolvingIncident,
    setResolvingIncident,
  ] = useState(false);

  const [
    backendHealth,
    setBackendHealth,
  ] = useState({
    checking: false,
    ok: null,
    version: null,
    region: null,
    message: null,
    durationMs: null,
    checkedAt: null,
    error: null,
  });

  const today =
    useMemo(
      () =>
        getTodayKey(),
      []
    );

  /* =========================
     BACKEND HEALTH
  ========================= */

  useEffect(() => {
    if (
      role !==
      "station_manager"
    ) {
      return undefined;
    }

    let cancelled =
      false;

    const checkBackend =
      async () => {
        const timer =
          startSystemTimer();

        if (!cancelled) {
          setBackendHealth(
            (current) => ({
              ...current,
              checking:
                true,
              error:
                null,
            })
          );
        }

        try {
          const healthCheck =
            httpsCallable(
              functions,
              "blcsFunctionHealth"
            );

          const response =
            await healthCheck({});

          const result =
            response?.data ||
            {};

          const durationMs =
            timer.elapsed();

          if (!cancelled) {
            setBackendHealth({
              checking:
                false,
              ok:
                result?.ok ===
                true,
              version:
                result?.version ||
                null,
              region:
                result?.region ||
                null,
              message:
                result?.message ||
                null,
              durationMs,
              checkedAt:
                new Date(),
              error:
                null,
            });
          }

          void logSystemSuccess({
            module:
              "BACKEND",
            action:
              "HEALTH_CHECK",
            durationMs,
          });
        } catch (error) {
          const durationMs =
            timer.elapsed();

          const errorCode =
            error?.code ||
            null;

          const errorMessage =
            error?.message ||
            "Backend health check failed.";

          if (!cancelled) {
            setBackendHealth({
              checking:
                false,
              ok:
                false,
              version:
                null,
              region:
                null,
              message:
                null,
              durationMs,
              checkedAt:
                new Date(),
              error:
                errorMessage,
            });
          }

          void logSystemIncident({
            module:
              "BACKEND",
            action:
              "HEALTH_CHECK",
            status:
              "ERROR",
            severity:
              "HIGH",
            errorType:
              "BACKEND_HEALTH",
            errorCode,
            message:
              errorMessage,
            user,
            durationMs,
            currentView:
              "system-monitor",
            metadata: {
              function:
                "blcsFunctionHealth",
            },
          });
        }
      };

    void checkBackend();

    return () => {
      cancelled =
        true;
    };
  }, [
    role,
    user?.id,
  ]);

  /* =========================
     METRICS
  ========================= */

  useEffect(() => {
    setLoadingMetrics(
      true
    );

    const metricsQuery =
      query(
        collection(
          db,
          "systemMetricsDaily"
        ),

        where(
          "date",
          "==",
          today
        )
      );

    const unsubscribe =
      onSnapshot(
        metricsQuery,

        (snapshot) => {
          const rows =
            snapshot.docs.map(
              (document) => ({
                id:
                  document.id,

                ...document.data(),
              })
            );

          setMetrics(
            rows
          );

          setLoadingMetrics(
            false
          );
        },

        (error) => {
          console.error(
            "System metrics error:",
            error
          );

          setMetrics(
            []
          );

          setLoadingMetrics(
            false
          );
        }
      );

    return () =>
      unsubscribe();
  }, [
    today,
  ]);

  /* =========================
     INCIDENTS
  ========================= */

  useEffect(() => {
    setLoadingIncidents(
      true
    );

    const incidentsQuery =
      query(
        collection(
          db,
          "systemIncidents"
        ),

        orderBy(
          "createdAt",
          "desc"
        ),

        limit(100)
      );

    const unsubscribe =
      onSnapshot(
        incidentsQuery,

        (snapshot) => {
          const rows =
            snapshot.docs.map(
              (document) => ({
                id:
                  document.id,

                ...document.data(),
              })
            );

          setIncidents(
            rows
          );

          setLoadingIncidents(
            false
          );
        },

        (error) => {
          console.error(
            "System incidents error:",
            error
          );

          setIncidents(
            []
          );

          setLoadingIncidents(
            false
          );
        }
      );

    return () =>
      unsubscribe();
  }, []);

  /* =========================
     PRESENCE
  ========================= */

  useEffect(() => {
    setLoadingPresence(
      true
    );

    const unsubscribe =
      onSnapshot(
        collection(
          db,
          "systemPresence"
        ),

        (snapshot) => {
          const rows =
            snapshot.docs.map(
              (document) => ({
                id:
                  document.id,

                ...document.data(),
              })
            );

          setPresence(
            rows
          );

          setLoadingPresence(
            false
          );
        },

        (error) => {
          console.error(
            "Presence error:",
            error
          );

          setPresence(
            []
          );

          setLoadingPresence(
            false
          );
        }
      );

    return () =>
      unsubscribe();
  }, []);

  /* =========================
     METRICS BY MODULE
  ========================= */

  const metricsByModule =
    useMemo(() => {
      const map =
        new Map();

      metrics.forEach(
        (metric) => {
          const module =
            normalizeModule(
              metric.module
            );

          if (!module) {
            return;
          }

          map.set(
            module,
            metric
          );
        }
      );

      return map;
    }, [
      metrics,
    ]);

  /* =========================
     OVERALL
  ========================= */

  const overall =
    useMemo(() => {
      let total = 0;

      let success = 0;

      let warning = 0;

      let errors = 0;

      let duration = 0;

      let performanceSamples =
        0;

      metrics.forEach(
        (metric) => {
          total +=
            safeNumber(
              metric.totalActions
            );

          success +=
            safeNumber(
              metric.statusCounts
                ?.SUCCESS
            );

          warning +=
            safeNumber(
              metric.statusCounts
                ?.WARNING
            );

          errors +=
            safeNumber(
              metric.statusCounts
                ?.ERROR
            );

          duration +=
            safeNumber(
              metric.totalDurationMs
            );

          performanceSamples +=
            safeNumber(
              metric.performanceSamples
            );
        }
      );

      const successRate =
        total > 0
          ? (success /
              total) *
            100
          : null;

      const averageMs =
        performanceSamples > 0
          ? duration /
            performanceSamples
          : 0;

      return {
        total,
        success,
        warning,
        errors,
        successRate,
        averageMs,
        performanceSamples,
      };
    }, [
      metrics,
    ]);

  /* =========================
     INCIDENT SUMMARY
  ========================= */

  const todayIncidents =
    useMemo(() => {
      return incidents.filter(
        (incident) =>
          isTodayTimestamp(
            incident.createdAt
          )
      );
    }, [
      incidents,
    ]);

  const unresolvedIncidents =
    useMemo(() => {
      return incidents.filter(
        (incident) =>
          incident.resolved !==
          true
      );
    }, [
      incidents,
    ]);

  const unresolvedToday =
    useMemo(() => {
      return todayIncidents.filter(
        (incident) =>
          incident.resolved !==
          true
      );
    }, [
      todayIncidents,
    ]);

  const criticalToday =
    useMemo(() => {
      return todayIncidents.filter(
        (incident) => {
          const severity =
            String(
              incident.severity ||
                ""
            ).toUpperCase();

          return (
            severity ===
              "HIGH" ||
            severity ===
              "CRITICAL"
          );
        }
      );
    }, [
      todayIncidents,
    ]);

  /* =========================
     ACTIVE USERS
  ========================= */

  const activeUsers =
    useMemo(() => {
      return presence
        .filter(
          (item) =>
            isPresenceOnline(
              item.lastSeenAt
            )
        )
        .sort(
          (a, b) => {
            const timeA =
              timestampToDate(
                a.lastSeenAt
              )?.getTime() ||
              0;

            const timeB =
              timestampToDate(
                b.lastSeenAt
              )?.getTime() ||
              0;

            return (
              timeB -
              timeA
            );
          }
        );
    }, [
      presence,
    ]);

  const outdatedUsers =
    useMemo(() => {
      return activeUsers.filter(
        (item) =>
          String(
            item.appVersion ||
              ""
          ) !==
          String(
            BLCS_VERSION
          )
      );
    }, [
      activeUsers,
    ]);

  /* =========================
     MODULE COVERAGE
  ========================= */

  const modulesWithData =
    useMemo(() => {
      return MODULES.filter(
        (module) => {
          const metric =
            metricsByModule.get(
              module
            );

          return (
            safeNumber(
              metric?.totalActions
            ) > 0
          );
        }
      ).length;
    }, [
      metricsByModule,
    ]);

  const modulesWithoutData =
    MODULES.length -
    modulesWithData;

  /* =========================
     OVERALL DISPLAY
  ========================= */

  const performance =
    getPerformanceLabel(
      overall.averageMs
    );

  const overallHealth =
    useMemo(() => {
      if (
        overall.total ===
        0
      ) {
        return {
          label:
            "NO DATA",

          message:
            "No monitored activity has been recorded today.",

          color:
            "#cbd5e1",
        };
      }

      if (
        overall.errors > 0 ||
        criticalToday.length >
          0
      ) {
        return {
          label:
            `${overall.successRate.toFixed(
              1
            )}%`,

          message:
            `${overall.errors} error(s) and ${criticalToday.length} high/critical incident(s) detected today.`,

          color:
            "#fca5a5",
        };
      }

      if (
        overall.warning > 0
      ) {
        return {
          label:
            `${overall.successRate.toFixed(
              1
            )}%`,

          message:
            `${overall.warning} warning(s) detected today.`,

          color:
            "#fde68a",
        };
      }

      return {
        label:
          `${overall.successRate.toFixed(
            1
          )}%`,

        message:
          "System operating normally based on recorded activity.",

        color:
          "#86efac",
      };
    }, [
      overall,
      criticalToday.length,
    ]);

  /* =========================
     RESOLVE INCIDENT
  ========================= */

  const markResolved =
    async (incident) => {
      if (
        !incident?.id ||
        resolvingIncident
      ) {
        return;
      }

      try {
        setResolvingIncident(
          true
        );

        await updateDoc(
          doc(
            db,
            "systemIncidents",
            incident.id
          ),
          {
            resolved:
              true,

            resolvedAt:
              serverTimestamp(),

            resolvedBy: {
              userId:
                user?.id ||
                null,

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
            },
          }
        );

        setSelectedIncident(
          null
        );
      } catch (
        error
      ) {
        console.error(
          "Resolve incident error:",
          error
        );

        window.alert(
          "Unable to update incident."
        );
      } finally {
        setResolvingIncident(
          false
        );
      }
    };

  /* =========================
     SECURITY
  ========================= */

  if (
    role !==
    "station_manager"
  ) {
    return (
      <div
        style={{
          padding:
            16,

          background:
            "#fef2f2",

          border:
            "1px solid #fecaca",

          borderRadius:
            12,

          color:
            "#991b1b",

          fontWeight:
            900,
        }}
      >
        Station Manager access only.
      </div>
    );
  }

  /* =========================
     UI
  ========================= */

  return (
    <div
      style={{
        display:
          "grid",

        gap:
          14,
      }}
    >
      {/* HEADER */}

      <section
        style={{
          background:
            "white",

          border:
            "1px solid #e5e7eb",

          borderRadius:
            14,

          padding:
            16,
        }}
      >
        <div
          style={{
            color:
              "#2563eb",

            fontWeight:
              900,

            fontSize:
              "0.72rem",

            letterSpacing:
              "0.08em",
          }}
        >
          BLCS ADMINISTRATION
        </div>

        <h2
          style={{
            margin:
              "5px 0 0",
          }}
        >
          System Monitor
        </h2>

        <p
          style={{
            margin:
              "6px 0 0",

            color:
              "#64748b",
          }}
        >
          Real-time monitoring of BLCS activity,
          performance, users, modules and incidents.
        </p>

        <div
          style={{
            marginTop:
              9,

            display:
              "inline-flex",

            padding:
              "5px 9px",

            borderRadius:
              999,

            background:
              "#f8fafc",

            border:
              "1px solid #e2e8f0",

            color:
              "#475569",

            fontSize:
              "0.73rem",

            fontWeight:
              800,
          }}
        >
          BLCS Version {BLCS_VERSION} - {today}
        </div>

        <div
          style={{
            marginTop:
              10,

            padding:
              10,

            borderRadius:
              10,

            background:
              backendHealth.checking
                ? "#eff6ff"
                : backendHealth.ok ===
                    true
                  ? "#f0fdf4"
                  : backendHealth.ok ===
                      false
                    ? "#fef2f2"
                    : "#f8fafc",

            border:
              backendHealth.checking
                ? "1px solid #bfdbfe"
                : backendHealth.ok ===
                    true
                  ? "1px solid #bbf7d0"
                  : backendHealth.ok ===
                      false
                    ? "1px solid #fecaca"
                    : "1px solid #e2e8f0",

            color:
              backendHealth.ok ===
              false
                ? "#991b1b"
                : backendHealth.ok ===
                    true
                  ? "#166534"
                  : "#475569",

            fontSize:
              "0.78rem",
          }}
        >
          <strong>
            Backend:
          </strong>{" "}
          {backendHealth.checking
            ? "Checking..."
            : backendHealth.ok ===
                true
              ? `Online${backendHealth.version ? ` - ${backendHealth.version}` : ""}${backendHealth.durationMs ? ` - ${backendHealth.durationMs} ms` : ""}`
              : backendHealth.ok ===
                  false
                ? `Unavailable - ${backendHealth.error || "Health check failed"}`
                : "Not checked"}
        </div>
      </section>

      {/* OVERALL HEALTH */}

      <section
        style={{
          background:
            "#0f172a",

          borderRadius:
            16,

          padding:
            18,

          color:
            "white",
        }}
      >
        <div
          style={{
            display:
              "flex",

            justifyContent:
              "space-between",

            gap:
              14,

            flexWrap:
              "wrap",
          }}
        >
          <div>
            <div
              style={{
                color:
                  "#94a3b8",

                fontSize:
                  "0.72rem",

                fontWeight:
                  900,

                letterSpacing:
                  "0.06em",
              }}
            >
              OVERALL HEALTH
            </div>

            <div
              style={{
                marginTop:
                  4,

                fontSize:
                  "2rem",

                fontWeight:
                  900,

                color:
                  overallHealth.color,
              }}
            >
              {
                overallHealth.label
              }
            </div>

            <div
              style={{
                color:
                  "#cbd5e1",

                marginTop:
                  3,

                maxWidth:
                  520,
              }}
            >
              {
                overallHealth.message
              }
            </div>
          </div>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "repeat(3, minmax(90px, 1fr))",

              gap:
                8,
            }}
          >
            <TopStat
              label="Active Users"
              value={
                loadingPresence
                  ? "..."
                  : activeUsers.length
              }
            />

            <TopStat
              label="Response"
              value={
                overall.averageMs >
                0
                  ? `${(
                      overall.averageMs /
                      1000
                    ).toFixed(
                      2
                    )}s`
                  : "-"
              }
            />

            <TopStat
              label="Performance"
              value={
                performance.label
              }
            />
          </div>
        </div>

        <div
          style={{
            marginTop:
              14,

            display:
              "grid",

            gridTemplateColumns:
              "repeat(auto-fit, minmax(110px, 1fr))",

            gap:
              8,
          }}
        >
          <DarkInfoBox
            label="Actions"
            value={
              overall.total
            }
          />

          <DarkInfoBox
            label="Success"
            value={
              overall.success
            }
          />

          <DarkInfoBox
            label="Warnings"
            value={
              overall.warning
            }
          />

          <DarkInfoBox
            label="Errors"
            value={
              overall.errors
            }
          />

          <DarkInfoBox
            label="Unresolved"
            value={
              unresolvedToday.length
            }
          />
        </div>
      </section>

      {/* COVERAGE */}

      <section
        style={{
          background:
            "white",

          border:
            "1px solid #e5e7eb",

          borderRadius:
            14,

          padding:
            14,
        }}
      >
        <h3
          style={{
            margin:
              0,
          }}
        >
          Monitoring Coverage
        </h3>

        <p
          style={{
            margin:
              "5px 0 0",

            color:
              "#64748b",

            fontSize:
              "0.82rem",
          }}
        >
          A module with no recorded activity is shown as
          NO DATA instead of being considered healthy.
        </p>

        <div
          style={{
            marginTop:
              12,

            display:
              "grid",

            gridTemplateColumns:
              "repeat(auto-fit, minmax(150px, 1fr))",

            gap:
              8,
          }}
        >
          <InfoBox
            label="Modules"
            value={
              MODULES.length
            }
          />

          <InfoBox
            label="Reporting"
            value={
              modulesWithData
            }
          />

          <InfoBox
            label="No Data"
            value={
              modulesWithoutData
            }
          />

          <InfoBox
            label="Metrics Today"
            value={
              metrics.length
            }
          />
        </div>
      </section>

      {/* MODULE HEALTH */}

      <section
        style={{
          background:
            "white",

          border:
            "1px solid #e5e7eb",

          borderRadius:
            14,

          padding:
            14,
        }}
      >
        <h3
          style={{
            margin:
              0,
          }}
        >
          Module Health
        </h3>

        {loadingMetrics ? (
          <p
            style={{
              color:
                "#64748b",
            }}
          >
            Loading system metrics...
          </p>
        ) : (
          <div
            style={{
              marginTop:
                12,

              display:
                "grid",

              gridTemplateColumns:
                "repeat(auto-fit, minmax(200px, 1fr))",

              gap:
                10,
            }}
          >
            {MODULES.map(
              (module) => (
                <ModuleHealthCard
                  key={
                    module
                  }

                  title={
                    module
                  }

                  metric={
                    metricsByModule.get(
                      module
                    ) ||
                    null
                  }
                />
              )
            )}
          </div>
        )}
      </section>

      {/* USERS */}

      <section
        style={{
          background:
            "white",

          border:
            "1px solid #e5e7eb",

          borderRadius:
            14,

          padding:
            14,
        }}
      >
        <h3
          style={{
            margin:
              0,
          }}
        >
          Users & Capacity
        </h3>

        <div
          style={{
            marginTop:
              12,

            display:
              "grid",

            gridTemplateColumns:
              "repeat(auto-fit, minmax(150px, 1fr))",

            gap:
              8,
          }}
        >
          <InfoBox
            label="Active Now"
            value={
              loadingPresence
                ? "..."
                : activeUsers.length
            }
          />

          <InfoBox
            label="Registered Presence"
            value={
              loadingPresence
                ? "..."
                : presence.length
            }
          />

          <InfoBox
            label="Current Version"
            value={
              BLCS_VERSION
            }
          />

          <InfoBox
            label="Outdated Active"
            value={
              loadingPresence
                ? "..."
                : outdatedUsers.length
            }
          />
        </div>

        {loadingPresence ? (
          <p
            style={{
              color:
                "#64748b",

              marginTop:
                12,
            }}
          >
            Loading active users...
          </p>
        ) : activeUsers.length ===
          0 ? (
          <div
            style={{
              marginTop:
                12,

              padding:
                12,

              borderRadius:
                10,

              background:
                "#f8fafc",

              border:
                "1px solid #e2e8f0",

              color:
                "#64748b",
            }}
          >
            No active users detected during the current
            online window.
          </div>
        ) : (
          <div
            style={{
              marginTop:
                12,

              overflowX:
                "auto",
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
                <tr>
                  <th style={th}>
                    User
                  </th>

                  <th style={th}>
                    Page
                  </th>

                  <th style={th}>
                    Position
                  </th>

                  <th style={th}>
                    Role
                  </th>

                  <th style={th}>
                    Version
                  </th>

                  <th style={th}>
                    Last Seen
                  </th>
                </tr>
              </thead>

              <tbody>
                {activeUsers.map(
                  (item) => (
                    <tr
                      key={
                        item.id
                      }
                    >
                      <td style={td}>
                        <strong>
                          {item.fullName ||
                            item.username ||
                            "-"}
                        </strong>

                        {item.username && (
                          <div
                            style={{
                              marginTop:
                                2,

                              color:
                                "#94a3b8",

                              fontSize:
                                "0.7rem",
                            }}
                          >
                            @{item.username}
                          </div>
                        )}
                      </td>

                      <td style={td}>
                        {item.currentView ||
                          "-"}
                      </td>

                      <td style={td}>
                        {item.operationalPositionLabel ||
                          item.operationalPosition ||
                          "-"}
                      </td>

                      <td style={td}>
                        {item.role ||
                          "-"}
                      </td>

                      <td style={td}>
                        <span
                          style={{
                            color:
                              String(
                                item.appVersion ||
                                  ""
                              ) ===
                              String(
                                BLCS_VERSION
                              )
                                ? "#166534"
                                : "#991b1b",

                            fontWeight:
                              900,
                          }}
                        >
                          {item.appVersion ||
                            "-"}
                        </span>
                      </td>

                      <td style={td}>
                        {formatTimestamp(
                          item.lastSeenAt
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* INCIDENT SUMMARY */}

      <section
        style={{
          background:
            "white",

          border:
            "1px solid #e5e7eb",

          borderRadius:
            14,

          padding:
            14,
        }}
      >
        <h3
          style={{
            margin:
              0,
          }}
        >
          Incident Summary
        </h3>

        <div
          style={{
            marginTop:
              12,

            display:
              "grid",

            gridTemplateColumns:
              "repeat(auto-fit, minmax(150px, 1fr))",

            gap:
              8,
          }}
        >
          <InfoBox
            label="Today"
            value={
              loadingIncidents
                ? "..."
                : todayIncidents.length
            }
          />

          <InfoBox
            label="Unresolved Today"
            value={
              loadingIncidents
                ? "..."
                : unresolvedToday.length
            }
          />

          <InfoBox
            label="High / Critical"
            value={
              loadingIncidents
                ? "..."
                : criticalToday.length
            }
          />

          <InfoBox
            label="All Unresolved"
            value={
              loadingIncidents
                ? "..."
                : unresolvedIncidents.length
            }
          />
        </div>
      </section>

      {/* RECENT INCIDENTS */}

      <section
        style={{
          background:
            "white",

          border:
            "1px solid #e5e7eb",

          borderRadius:
            14,

          padding:
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
              10,

            alignItems:
              "center",

            flexWrap:
              "wrap",
          }}
        >
          <h3
            style={{
              margin:
                0,
            }}
          >
            Recent Incidents
          </h3>

          <span
            style={{
              color:
                "#64748b",

              fontSize:
                "0.75rem",

              fontWeight:
                800,
            }}
          >
            Last {incidents.length} records
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
          {loadingIncidents ? (
            <div
              style={{
                color:
                  "#64748b",

                padding:
                  10,
              }}
            >
              Loading incidents...
            </div>
          ) : incidents.length ===
            0 ? (
            <div
              style={{
                color:
                  "#64748b",

                padding:
                  10,
              }}
            >
              No incidents recorded.
            </div>
          ) : (
            incidents.map(
              (incident) => {
                const severity =
                  String(
                    incident.severity ||
                      "LOW"
                  ).toUpperCase();

                const status =
                  String(
                    incident.status ||
                      "INFO"
                  ).toUpperCase();

                return (
                  <button
                    key={
                      incident.id
                    }

                    type="button"

                    onClick={() =>
                      setSelectedIncident(
                        incident
                      )
                    }

                    style={{
                      textAlign:
                        "left",

                      padding:
                        10,

                      borderRadius:
                        10,

                      border:
                        incident.resolved
                          ? "1px solid #e5e7eb"
                          : status ===
                              "ERROR"
                            ? "1px solid #fca5a5"
                            : "1px solid #fde68a",

                      background:
                        incident.resolved
                          ? "#f8fafc"
                          : status ===
                              "ERROR"
                            ? "#fff7f7"
                            : "white",

                      cursor:
                        "pointer",

                      opacity:
                        incident.resolved
                          ? 0.75
                          : 1,
                    }}
                  >
                    <div
                      style={{
                        display:
                          "flex",

                        justifyContent:
                          "space-between",

                        gap:
                          10,

                        flexWrap:
                          "wrap",
                      }}
                    >
                      <strong>
                        {incident.module ||
                          "SYSTEM"}{" "}
                        ·{" "}
                        {incident.action ||
                          "EVENT"}
                      </strong>

                      <div
                        style={{
                          display:
                            "flex",

                          gap:
                            6,

                          alignItems:
                            "center",
                        }}
                      >
                        <IncidentBadge
                          value={
                            severity
                          }
                          type="severity"
                        />

                        <IncidentBadge
                          value={
                            status
                          }
                          type="status"
                        />

                        {incident.resolved && (
                          <span
                            style={{
                              color:
                                "#166534",

                              fontSize:
                                "0.7rem",

                              fontWeight:
                                900,
                            }}
                          >
                            RESOLVED
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop:
                          4,

                        color:
                          "#64748b",

                        fontSize:
                          "0.78rem",
                      }}
                    >
                      {incident.message ||
                        "-"}
                    </div>

                    <div
                      style={{
                        marginTop:
                          4,

                        color:
                          "#94a3b8",

                        fontSize:
                          "0.7rem",
                      }}
                    >
                      {formatTimestamp(
                        incident.createdAt
                      )}
                    </div>
                  </button>
                );
              }
            )
          )}
        </div>
      </section>

      {/* INCIDENT MODAL */}

      {selectedIncident && (
        <div
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setSelectedIncident(
                null
              );
            }
          }}
          style={{
            position:
              "fixed",

            inset:
              0,

            background:
              "rgba(15,23,42,0.65)",

            display:
              "flex",

            alignItems:
              "center",

            justifyContent:
              "center",

            zIndex:
              10000,

            padding:
              16,
          }}
        >
          <div
            style={{
              width:
                "100%",

              maxWidth:
                560,

              background:
                "white",

              borderRadius:
                16,

              padding:
                18,

              maxHeight:
                "88vh",

              overflow:
                "auto",

              boxShadow:
                "0 25px 50px rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                gap:
                  10,

                alignItems:
                  "center",
              }}
            >
              <h3
                style={{
                  margin:
                    0,
                }}
              >
                Incident Details
              </h3>

              <IncidentBadge
                value={
                  selectedIncident.status ||
                  "INFO"
                }
                type="status"
              />
            </div>

            <IncidentLine
              label="Module"
              value={
                selectedIncident.module
              }
            />

            <IncidentLine
              label="Action"
              value={
                selectedIncident.action
              }
            />

            <IncidentLine
              label="Status"
              value={
                selectedIncident.status
              }
            />

            <IncidentLine
              label="Severity"
              value={
                selectedIncident.severity
              }
            />

            <IncidentLine
              label="Error Type"
              value={
                selectedIncident.errorType
              }
            />

            <IncidentLine
              label="Error Code"
              value={
                selectedIncident.errorCode
              }
            />

            <IncidentLine
              label="User"
              value={
                selectedIncident.user
                  ?.fullName ||
                selectedIncident.user
                  ?.username
              }
            />

            <IncidentLine
              label="Position"
              value={
                selectedIncident.user
                  ?.operationalPositionLabel ||
                selectedIncident.user
                  ?.operationalPosition
              }
            />

            <IncidentLine
              label="Page"
              value={
                selectedIncident.currentView
              }
            />

            <IncidentLine
              label="Flight"
              value={
                selectedIncident.flightNumber ||
                selectedIncident.flightId
              }
            />

            <IncidentLine
              label="Bag Tag"
              value={
                selectedIncident.bagTag
              }
            />

            <IncidentLine
              label="Duration"
              value={
                selectedIncident.durationMs
                  ? `${selectedIncident.durationMs} ms`
                  : null
              }
            />

            <IncidentLine
              label="Created"
              value={
                formatTimestamp(
                  selectedIncident.createdAt
                )
              }
            />

            <IncidentLine
              label="Error / Message"
              value={
                selectedIncident.message
              }
            />

            {selectedIncident
              .suggestedAction && (
              <div
                style={{
                  marginTop:
                    14,

                  padding:
                    12,

                  borderRadius:
                    12,

                  background:
                    "#eff6ff",

                  border:
                    "1px solid #bfdbfe",

                  color:
                    "#1e40af",
                }}
              >
                <div
                  style={{
                    color:
                      "#1d4ed8",

                    fontSize:
                      "0.7rem",

                    fontWeight:
                      900,

                    letterSpacing:
                      "0.05em",
                  }}
                >
                  SUGGESTED ACTION
                </div>

                <strong
                  style={{
                    display:
                      "block",

                    marginTop:
                      4,
                  }}
                >
                  {
                    selectedIncident
                      .suggestedAction
                      ?.title
                  }
                </strong>

                <div
                  style={{
                    marginTop:
                      5,

                    lineHeight:
                      1.5,
                  }}
                >
                  {
                    selectedIncident
                      .suggestedAction
                      ?.recommendation
                  }
                </div>
              </div>
            )}

            {selectedIncident.resolved && (
              <div
                style={{
                  marginTop:
                    14,

                  padding:
                    10,

                  borderRadius:
                    10,

                  background:
                    "#f0fdf4",

                  border:
                    "1px solid #bbf7d0",

                  color:
                    "#166534",
                }}
              >
                <strong>
                  Resolved
                </strong>

                {selectedIncident
                  .resolvedAt && (
                  <div
                    style={{
                      marginTop:
                        3,

                      fontSize:
                        "0.78rem",
                    }}
                  >
                    {formatTimestamp(
                      selectedIncident
                        .resolvedAt
                    )}
                  </div>
                )}

                {selectedIncident
                  .resolvedBy && (
                  <div
                    style={{
                      marginTop:
                        3,

                      fontSize:
                        "0.78rem",
                    }}
                  >
                    By:{" "}
                    {selectedIncident
                      .resolvedBy
                      ?.fullName ||
                      selectedIncident
                        .resolvedBy
                        ?.username ||
                      "-"}
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                marginTop:
                  16,

                display:
                  "flex",

                gap:
                  8,

                justifyContent:
                  "flex-end",

                flexWrap:
                  "wrap",
              }}
            >
              {!selectedIncident.resolved && (
                <button
                  type="button"

                  onClick={() =>
                    markResolved(
                      selectedIncident
                    )
                  }

                  disabled={
                    resolvingIncident
                  }

                  style={{
                    padding:
                      "9px 12px",

                    borderRadius:
                      10,

                    border:
                      "1px solid #16a34a",

                    background:
                      resolvingIncident
                        ? "#86efac"
                        : "#16a34a",

                    color:
                      "white",

                    fontWeight:
                      900,

                    cursor:
                      resolvingIncident
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {resolvingIncident
                    ? "Saving..."
                    : "Mark Resolved"}
                </button>
              )}

              <button
                type="button"

                onClick={() =>
                  setSelectedIncident(
                    null
                  )
                }

                style={{
                  padding:
                    "9px 12px",

                  borderRadius:
                    10,

                  border:
                    "1px solid #d1d5db",

                  background:
                    "white",

                  color:
                    "#334155",

                  fontWeight:
                    800,

                  cursor:
                    "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   MODULE HEALTH CARD
========================= */

function ModuleHealthCard({
  title,
  metric,
}) {
  const health =
    getModuleHealth(
      metric
    );

  const performance =
    getPerformanceLabel(
      health.averageMs
    );

  const tones = {
    neutral: {
      background:
        "#f8fafc",

      border:
        "#cbd5e1",

      color:
        "#475569",
    },

    good: {
      background:
        "#f0fdf4",

      border:
        "#86efac",

      color:
        "#166534",
    },

    warning: {
      background:
        "#fffbeb",

      border:
        "#fde68a",

      color:
        "#92400e",
    },

    danger: {
      background:
        "#fef2f2",

      border:
        "#fca5a5",

      color:
        "#991b1b",
    },
  };

  const tone =
    tones[
      health.tone
    ] ||
    tones.neutral;

  return (
    <div
      style={{
        border:
          `1px solid ${tone.border}`,

        background:
          tone.background,

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

          gap:
            8,

          alignItems:
            "center",
        }}
      >
        <strong
          style={{
            color:
              "#0f172a",

            fontSize:
              "0.9rem",
          }}
        >
          {title}
        </strong>

        <span
          style={{
            padding:
              "4px 7px",

            borderRadius:
              999,

            background:
              "white",

            border:
              `1px solid ${tone.border}`,

            color:
              tone.color,

            fontSize:
              "0.65rem",

            fontWeight:
              900,
          }}
        >
          {health.status}
        </span>
      </div>

      <div
        style={{
          marginTop:
            10,

          fontSize:
            "1.45rem",

          fontWeight:
            900,

          color:
            tone.color,
        }}
      >
        {health.successRate ===
        null
          ? "—"
          : `${health.successRate.toFixed(
              1
            )}%`}
      </div>

      <div
        style={{
          color:
            "#64748b",

          fontSize:
            "0.7rem",

          fontWeight:
            800,
        }}
      >
        SUCCESS RATE
      </div>

      <div
        style={{
          marginTop:
            10,

          display:
            "grid",

          gridTemplateColumns:
            "repeat(3, minmax(0,1fr))",

          gap:
            5,
        }}
      >
        <MiniMetric
          label="OK"
          value={
            health.success
          }
        />

        <MiniMetric
          label="Warn"
          value={
            health.warning
          }
        />

        <MiniMetric
          label="Error"
          value={
            health.error
          }
        />
      </div>

      <div
        style={{
          marginTop:
            9,

          paddingTop:
            8,

          borderTop:
            "1px solid rgba(100,116,139,0.18)",

          display:
            "flex",

          justifyContent:
            "space-between",

          gap:
            8,

          color:
            "#64748b",

          fontSize:
            "0.7rem",
        }}
      >
        <span>
          Actions:{" "}
          <strong>
            {health.total}
          </strong>
        </span>

        <span>
          {health.averageMs >
          0
            ? `${(
                health.averageMs /
                1000
              ).toFixed(
                2
              )}s`
            : performance.label}
        </span>
      </div>

      {metric
        ?.lastActivityAt && (
        <div
          style={{
            marginTop:
              6,

            color:
              "#94a3b8",

            fontSize:
              "0.65rem",
          }}
        >
          Last activity:{" "}
          {formatTimestamp(
            metric.lastActivityAt
          )}
        </div>
      )}
    </div>
  );
}

/* =========================
   UI HELPERS
========================= */

function MiniMetric({
  label,
  value,
}) {
  return (
    <div
      style={{
        padding:
          6,

        borderRadius:
          8,

        background:
          "rgba(255,255,255,0.75)",

        textAlign:
          "center",
      }}
    >
      <div
        style={{
          fontWeight:
            900,

          fontSize:
            "0.9rem",
        }}
      >
        {value}
      </div>

      <div
        style={{
          marginTop:
            1,

          color:
            "#64748b",

          fontSize:
            "0.6rem",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function TopStat({
  label,
  value,
}) {
  return (
    <div
      style={{
        background:
          "#1e293b",

        borderRadius:
          10,

        padding:
          10,

        textAlign:
          "center",

        minWidth:
          90,
      }}
    >
      <div
        style={{
          fontSize:
            "1.15rem",

          fontWeight:
            900,
        }}
      >
        {value}
      </div>

      <div
        style={{
          marginTop:
            2,

          color:
            "#94a3b8",

          fontSize:
            "0.67rem",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function DarkInfoBox({
  label,
  value,
}) {
  return (
    <div
      style={{
        padding:
          9,

        borderRadius:
          10,

        background:
          "#1e293b",

        border:
          "1px solid #334155",
      }}
    >
      <div
        style={{
          color:
            "#94a3b8",

          fontSize:
            "0.65rem",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            2,

          color:
            "white",

          fontSize:
            "1.1rem",

          fontWeight:
            900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function InfoBox({
  label,
  value,
}) {
  return (
    <div
      style={{
        background:
          "#f8fafc",

        border:
          "1px solid #e2e8f0",

        borderRadius:
          12,

        padding:
          10,
      }}
    >
      <div
        style={{
          color:
            "#64748b",

          fontSize:
            "0.72rem",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            2,

          fontSize:
            "1.3rem",

          fontWeight:
            900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function IncidentBadge({
  value,
  type,
}) {
  const normalized =
    String(
      value ||
        "INFO"
    ).toUpperCase();

  let background =
    "#f1f5f9";

  let color =
    "#475569";

  let border =
    "#cbd5e1";

  if (
    normalized ===
      "ERROR" ||
    normalized ===
      "HIGH" ||
    normalized ===
      "CRITICAL"
  ) {
    background =
      "#fee2e2";

    color =
      "#991b1b";

    border =
      "#fca5a5";
  } else if (
    normalized ===
      "WARNING" ||
    normalized ===
      "MEDIUM"
  ) {
    background =
      "#fef3c7";

    color =
      "#92400e";

    border =
      "#fde68a";
  } else if (
    normalized ===
      "SUCCESS"
  ) {
    background =
      "#dcfce7";

    color =
      "#166534";

    border =
      "#86efac";
  }

  return (
    <span
      title={
        type ===
        "severity"
          ? "Severity"
          : "Status"
      }
      style={{
        padding:
          "3px 7px",

        borderRadius:
          999,

        background,

        border:
          `1px solid ${border}`,

        color,

        fontSize:
          "0.63rem",

        fontWeight:
          900,
      }}
    >
      {normalized}
    </span>
  );
}

function IncidentLine({
  label,
  value,
}) {
  if (
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
  ) {
    return null;
  }

  return (
    <div
      style={{
        marginTop:
          10,
      }}
    >
      <div
        style={{
          color:
            "#64748b",

          fontSize:
            "0.72rem",
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontWeight:
            800,

          overflowWrap:
            "anywhere",

          whiteSpace:
            "pre-wrap",
        }}
      >
        {String(
          value
        )}
      </div>
    </div>
  );
}

/* =========================
   TABLE
========================= */

const th = {
  textAlign:
    "left",

  padding:
    "8px",

  color:
    "#64748b",

  fontSize:
    "0.72rem",

  borderBottom:
    "1px solid #e5e7eb",

  whiteSpace:
    "nowrap",
};

const td = {
  padding:
    "8px",

  borderBottom:
    "1px solid #f1f5f9",

  fontSize:
    "0.8rem",

  verticalAlign:
    "middle",
};

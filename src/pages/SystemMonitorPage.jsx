// src/pages/SystemMonitorPage.jsx

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

import {
  db,
} from "../firebase";

import SystemHealthCard from "../components/SystemHealthCard.jsx";

import {
  BLCS_VERSION,
  isPresenceOnline,
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

function normalizeRole(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase();
}

function getTodayKey() {
  const now =
    new Date();

  const year =
    now.getFullYear();

  const month =
    String(
      now.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
}

function formatTimestamp(
  value
) {
  if (!value) {
    return "-";
  }

  try {
    const date =
      value.toDate
        ? value.toDate()
        : new Date(
            value
          );

    return date.toLocaleString();
  } catch {
    return "-";
  }
}

function getPerformanceLabel(
  milliseconds
) {
  const value =
    Number(
      milliseconds ||
        0
    );

  if (!value) {
    return {
      label:
        "No Data",
      color:
        "#64748b",
    };
  }

  if (value < 1000) {
    return {
      label:
        "Fast",
      color:
        "#166534",
    };
  }

  if (value < 2000) {
    return {
      label:
        "Normal",
      color:
        "#1d4ed8",
    };
  }

  if (value < 4000) {
    return {
      label:
        "Slow",
      color:
        "#92400e",
    };
  }

  return {
    label:
      "Critical",
    color:
      "#991b1b",
  };
}

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
    loading,
    setLoading,
  ] = useState(true);

  const today =
    useMemo(
      () =>
        getTodayKey(),
      []
    );

  /* =========================
     METRICS
  ========================= */

  useEffect(() => {
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

        (
          snapshot
        ) => {
          setMetrics(
            snapshot.docs.map(
              (
                document
              ) => ({
                id:
                  document.id,

                ...document.data(),
              })
            )
          );

          setLoading(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "System metrics error:",
            error
          );

          setLoading(
            false
          );
        }
      );

    return () =>
      unsubscribe();
  }, [today]);

  /* =========================
     INCIDENTS
  ========================= */

  useEffect(() => {
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

        (
          snapshot
        ) => {
          setIncidents(
            snapshot.docs.map(
              (
                document
              ) => ({
                id:
                  document.id,

                ...document.data(),
              })
            )
          );
        },

        (
          error
        ) => {
          console.error(
            "System incidents error:",
            error
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
    const unsubscribe =
      onSnapshot(
        collection(
          db,
          "systemPresence"
        ),

        (
          snapshot
        ) => {
          setPresence(
            snapshot.docs.map(
              (
                document
              ) => ({
                id:
                  document.id,

                ...document.data(),
              })
            )
          );
        },

        (
          error
        ) => {
          console.error(
            "Presence error:",
            error
          );
        }
      );

    return () =>
      unsubscribe();
  }, []);

  const metricsByModule =
    useMemo(() => {
      const map =
        new Map();

      metrics.forEach(
        (
          metric
        ) => {
          map.set(
            metric.module,
            metric
          );
        }
      );

      return map;
    }, [metrics]);

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
        (
          metric
        ) => {
          total +=
            Number(
              metric.totalActions ||
                0
            );

          success +=
            Number(
              metric
                .statusCounts
                ?.SUCCESS ||
                0
            );

          warning +=
            Number(
              metric
                .statusCounts
                ?.WARNING ||
                0
            );

          errors +=
            Number(
              metric
                .statusCounts
                ?.ERROR ||
                0
            );

          duration +=
            Number(
              metric.totalDurationMs ||
                0
            );

          performanceSamples +=
            Number(
              metric.performanceSamples ||
                0
            );
        }
      );

      const successRate =
        total
          ? (success /
              total) *
            100
          : 100;

      const averageMs =
        performanceSamples
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
      };
    }, [metrics]);

  const activeUsers =
    useMemo(() => {
      return presence.filter(
        (
          item
        ) =>
          isPresenceOnline(
            item.lastSeenAt
          )
      );
    }, [presence]);

  const outdatedUsers =
    useMemo(() => {
      return activeUsers.filter(
        (
          item
        ) =>
          String(
            item.appVersion ||
              ""
          ) !==
          BLCS_VERSION
      );
    }, [
      activeUsers,
    ]);

  const performance =
    getPerformanceLabel(
      overall.averageMs
    );

  const markResolved =
    async (
      incident
    ) => {
      try {
        await updateDoc(
          doc(
            db,
            "systemIncidents",
            incident.id
          ),
          {
            resolved:
              true,
          }
        );

        setSelectedIncident(
          null
        );
      } catch (
        error
      ) {
        console.error(
          error
        );

        window.alert(
          "Unable to update incident."
        );
      }
    };

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

  return (
    <div
      style={{
        display:
          "grid",

        gap:
          14,
      }}
    >
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
          Operational health, performance,
          activity and incident monitoring.
        </p>
      </section>

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
              }}
            >
              {overall.successRate.toFixed(
                1
              )}
              %
            </div>

            <div
              style={{
                color:
                  "#cbd5e1",

                marginTop:
                  3,
              }}
            >
              {overall.errors ===
              0
                ? "System operating normally"
                : `${overall.errors} error(s) detected today`}
            </div>
          </div>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "repeat(3, minmax(90px,1fr))",

              gap:
                8,
            }}
          >
            <TopStat
              label="Active Users"
              value={
                activeUsers.length
              }
            />

            <TopStat
              label="Response"
              value={
                overall.averageMs
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
      </section>

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

        {loading ? (
          <p>
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
                "repeat(auto-fit, minmax(190px, 1fr))",

              gap:
                10,
            }}
          >
            {MODULES.map(
              (
                module
              ) => (
                <SystemHealthCard
                  key={
                    module
                  }

                  title={
                    module
                  }

                  metrics={
                    metricsByModule.get(
                      module
                    ) ||
                    {}
                  }
                />
              )
            )}
          </div>
        )}
      </section>

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
              "repeat(auto-fit, minmax(150px,1fr))",

            gap:
              8,
          }}
        >
          <InfoBox
            label="Active Now"
            value={
              activeUsers.length
            }
          />

          <InfoBox
            label="Registered Presence"
            value={
              presence.length
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
              outdatedUsers.length
            }
          />
        </div>

        {activeUsers.length >
          0 && (
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
                    Version
                  </th>

                  <th style={th}>
                    Last Seen
                  </th>
                </tr>
              </thead>

              <tbody>
                {activeUsers.map(
                  (
                    item
                  ) => (
                    <tr
                      key={
                        item.id
                      }
                    >
                      <td style={td}>
                        <strong>
                          {item.fullName ||
                            item.username}
                        </strong>
                      </td>

                      <td style={td}>
                        {item.currentView ||
                          "-"}
                      </td>

                      <td style={td}>
                        {item.operationalPositionLabel ||
                          "-"}
                      </td>

                      <td style={td}>
                        <span
                          style={{
                            color:
                              item.appVersion ===
                              BLCS_VERSION
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
          Recent Incidents
        </h3>

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
          {incidents.length ===
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
              (
                incident
              ) => (
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
                      "1px solid #e5e7eb",

                    background:
                      incident.resolved
                        ? "#f8fafc"
                        : "white",

                    cursor:
                      "pointer",
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
                    }}
                  >
                    <strong>
                      {incident.module ||
                        "SYSTEM"}{" "}
                      ·{" "}
                      {incident.action ||
                        "EVENT"}
                    </strong>

                    <span
                      style={{
                        color:
                          incident.status ===
                          "ERROR"
                            ? "#b91c1c"
                            : "#92400e",

                        fontWeight:
                          900,
                      }}
                    >
                      {incident.status}
                    </span>
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
                      "-"}{" "}
                    ·{" "}
                    {formatTimestamp(
                      incident.createdAt
                    )}
                  </div>
                </button>
              )
            )
          )}
        </div>
      </section>

      {selectedIncident && (
        <div
          style={{
            position:
              "fixed",

            inset:
              0,

            background:
              "rgba(15,23,42,0.6)",

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
                520,

              background:
                "white",

              borderRadius:
                16,

              padding:
                18,

              maxHeight:
                "85vh",

              overflow:
                "auto",
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
              label="User"
              value={
                selectedIncident.user
                  ?.fullName ||
                selectedIncident.user
                  ?.username
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
              label="Error"
              value={
                selectedIncident.message
              }
            />

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

                color:
                  "#1e40af",
              }}
            >
              <strong>
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
                }}
              >
                {
                  selectedIncident
                    .suggestedAction
                    ?.recommendation
                }
              </div>
            </div>

            <div
              style={{
                marginTop:
                  15,

                display:
                  "flex",

                gap:
                  8,

                justifyContent:
                  "flex-end",
              }}
            >
              {!selectedIncident.resolved && (
                <button
                  onClick={() =>
                    markResolved(
                      selectedIncident
                    )
                  }
                >
                  Mark Resolved
                </button>
              )}

              <button
                onClick={() =>
                  setSelectedIncident(
                    null
                  )
                }
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

function IncidentLine({
  label,
  value,
}) {
  if (!value) {
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
        }}
      >
        {value}
      </div>
    </div>
  );
}

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
};

const td = {
  padding:
    "8px",

  borderBottom:
    "1px solid #f1f5f9",

  fontSize:
    "0.8rem",
};

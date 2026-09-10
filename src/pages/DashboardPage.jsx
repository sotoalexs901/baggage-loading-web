// src/pages/DashboardPage.jsx

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";

import {
  logSystemIncident,
  logSystemSuccess,
  startSystemTimer,
} from "../utils/systemLogger.js";

/* =========================
   HELPERS
========================= */

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function getTodayYYYYMMDD() {
  const d = new Date();

  const y =
    d.getFullYear();

  const m =
    String(
      d.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      d.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${y}-${m}-${day}`;
}

function normalizeStatus(s) {
  const v =
    String(
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
  const v =
    String(
      value ||
        "CHECKED_BAG"
    )
      .trim()
      .toUpperCase();

  return (
    v === "CHECKED_BAG" ||
    v === "GATE_CHECK" ||
    v === "OVERSIZE" ||
    v === "GATE_BAG"
  )
    ? v
    : "CHECKED_BAG";
}

function getProgressPercent(
  gateTotal,
  aircraftTotal
) {
  if (
    typeof gateTotal !==
      "number" ||
    gateTotal <= 0
  ) {
    return 0;
  }

  return Math.min(
    100,
    Math.round(
      (
        aircraftTotal /
        gateTotal
      ) *
        100
    )
  );
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

/* =========================
   STATUS
========================= */

const STATUS_COLORS = {
  OPEN: {
    bg:
      "#FEF3C7",

    text:
      "#92400E",

    border:
      "#F59E0B",
  },

  RECEIVING: {
    bg:
      "#DBEAFE",

    text:
      "#1E3A8A",

    border:
      "#60A5FA",
  },

  LOADING: {
    bg:
      "#FFEDD5",

    text:
      "#9A3412",

    border:
      "#FB923C",
  },

  LOADED: {
    bg:
      "#DCFCE7",

    text:
      "#166534",

    border:
      "#22C55E",
  },
};

function StatusPill({
  status,
}) {
  const st =
    normalizeStatus(
      status
    );

  const c =
    STATUS_COLORS[
      st
    ] ||
    STATUS_COLORS.OPEN;

  return (
    <span
      style={{
        display:
          "inline-flex",

        alignItems:
          "center",

        padding:
          "6px 12px",

        borderRadius:
          999,

        border:
          `1px solid ${c.border}`,

        background:
          c.bg,

        color:
          c.text,

        fontWeight:
          900,

        letterSpacing:
          "0.04em",

        fontSize:
          "0.75rem",
      }}
    >
      {st ===
      "RECEIVING"
        ? "RECEIVING BAGS"
        : st}
    </span>
  );
}

/* =========================
   UI COMPONENTS
========================= */

function SmallCard({
  label,
  value,
  tone = "default",
}) {
  const colors = {
    default: {
      bg:
        "#f9fafb",

      border:
        "#e5e7eb",

      text:
        "#111827",
    },

    good: {
      bg:
        "#dcfce7",

      border:
        "#22c55e",

      text:
        "#166534",
    },

    warn: {
      bg:
        "#fef3c7",

      border:
        "#f59e0b",

      text:
        "#92400e",
    },

    bad: {
      bg:
        "#fee2e2",

      border:
        "#ef4444",

      text:
        "#991b1b",
    },

    blue: {
      bg:
        "#dbeafe",

      border:
        "#60a5fa",

      text:
        "#1e3a8a",
    },
  };

  const c =
    colors[tone] ||
    colors.default;

  return (
    <div
      style={{
        border:
          `1px solid ${c.border}`,

        borderRadius:
          12,

        padding:
          10,

        background:
          c.bg,

        color:
          c.text,
      }}
    >
      <div
        style={{
          fontSize:
            "0.75rem",

          fontWeight:
            800,

          opacity:
            0.85,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize:
            "1.25rem",

          fontWeight:
            900,

          marginTop:
            2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ProgressBar({
  percent,
}) {
  return (
    <div
      style={{
        width:
          "100%",

        height:
          10,

        background:
          "#e5e7eb",

        borderRadius:
          999,

        overflow:
          "hidden",
      }}
    >
      <div
        style={{
          width:
            `${percent}%`,

          height:
            "100%",

          background:
            percent >= 100
              ? "#22c55e"
              : percent >= 75
                ? "#f59e0b"
                : "#2563eb",
        }}
      />
    </div>
  );
}

/* =========================
   DASHBOARD
========================= */

export default function DashboardPage({
  user,
  operationalContext,
  onOpenFlight,
  onOpenCarryOnFlight,
  gateControllerOnDuty,
}) {
  const role =
    useMemo(
      () =>
        normalizeRole(
          user?.role
        ),
      [
        user?.role,
      ]
    );

  const isGateController =
    role ===
    "gate_controller";

  const displayName =
    user?.fullName ||
    user?.name ||
    user?.displayName ||
    user?.username ||
    "Team Member";

  const roleLabel =
    String(
      user?.role ||
        "user"
    )
      .replaceAll(
        "_",
        " "
      )
      .replace(
        /\b\w/g,
        (
          letter
        ) =>
          letter.toUpperCase()
      );

  const today =
    useMemo(
      () =>
        getTodayYYYYMMDD(),
      []
    );

  const [
    selectedDate,
    setSelectedDate,
  ] = useState(
    today
  );

  const [
    flights,
    setFlights,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(
    true
  );

  const [
    flightStats,
    setFlightStats,
  ] = useState({});

  const [
    carryOnFlights,
    setCarryOnFlights,
  ] = useState([]);

  const [
    loadingCarryOnFlights,
    setLoadingCarryOnFlights,
  ] = useState(
    true
  );

  const dashboardLoadTimerRef =
    useRef(null);

  const dashboardLoadLoggedRef =
    useRef(false);

  /* =========================
     MONITOR HELPERS
  ========================= */

  const logDashboardIncident =
    async ({
      action,
      severity = "MEDIUM",
      errorType = null,
      errorCode = null,
      message = null,
      flightId = null,
      flightNumber = null,
      durationMs = null,
      metadata = {},
    }) => {
      await logSystemIncident({
        module:
          "DASHBOARD",

        action,

        status:
          "ERROR",

        severity,

        errorType,

        errorCode,

        message,

        user,

        operationalContext,

        flightId,

        flightNumber,

        durationMs,

        currentView:
          "dashboard",

        metadata,
      });
    };

  /* =========================
     INITIAL TIMER
  ========================= */

  useEffect(() => {
    dashboardLoadTimerRef.current =
      startSystemTimer();

    dashboardLoadLoggedRef.current =
      false;

    return undefined;
  }, [
    selectedDate,
  ]);

  /* =========================
     FLIGHTS SUBSCRIPTION
  ========================= */

  useEffect(() => {
    setLoading(
      true
    );

    const q =
      query(
        collection(
          db,
          "flights"
        ),

        where(
          "flightDate",
          "==",
          selectedDate
        ),

        orderBy(
          "createdAt",
          "desc"
        )
      );

    const unsub =
      onSnapshot(
        q,

        (
          snap
        ) => {
          const rows =
            snap.docs.map(
              (
                d
              ) => ({
                id:
                  d.id,

                ...d.data(),
              })
            );

          setFlights(
            rows
          );

          setLoading(
            false
          );

          if (
            !dashboardLoadLoggedRef.current
          ) {
            dashboardLoadLoggedRef.current =
              true;

            const durationMs =
              dashboardLoadTimerRef.current
                ? dashboardLoadTimerRef.current.elapsed()
                : null;

            logSystemSuccess({
              module:
                "DASHBOARD",

              action:
                "LOAD_FLIGHTS",

              durationMs,
            }).catch(
              (
                error
              ) => {
                console.warn(
                  "Dashboard success metric failed:",
                  error
                );
              }
            );
          }
        },

        (
          error
        ) => {
          console.error(
            "Dashboard flights error:",
            error
          );

          setFlights(
            []
          );

          setLoading(
            false
          );

          const durationMs =
            dashboardLoadTimerRef.current
              ? dashboardLoadTimerRef.current.elapsed()
              : null;

          logDashboardIncident({
            action:
              "LOAD_FLIGHTS",

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
                "Unable to load Dashboard flights."
              ),

            durationMs,

            metadata: {
              selectedDate,
            },
          });
        }
      );

    return () =>
      unsub();
  }, [
    selectedDate,
  ]);

  /* =========================
     CARRY-ON FLIGHTS SUBSCRIPTION

     IMPORTANT:
     This is isolated from the existing
     baggage flights collection.
  ========================= */

  useEffect(() => {
    setLoadingCarryOnFlights(
      true
    );

    const q =
      query(
        collection(
          db,
          "carryOnFlights"
        ),

        where(
          "flightDate",
          "==",
          selectedDate
        )
      );

    const unsub =
      onSnapshot(
        q,

        (
          snap
        ) => {
          const rows =
            snap.docs.map(
              (
                d
              ) => ({
                id:
                  d.id,

                ...d.data(),
              })
            );

          rows.sort(
            (
              a,
              b
            ) =>
              String(
                a.flightNumber ||
                ""
              ).localeCompare(
                String(
                  b.flightNumber ||
                  ""
                )
              )
          );

          setCarryOnFlights(
            rows
          );

          setLoadingCarryOnFlights(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "Dashboard Carry-On flights error:",
            error
          );

          setCarryOnFlights(
            []
          );

          setLoadingCarryOnFlights(
            false
          );

          logDashboardIncident({
            action:
              "LOAD_CARRY_ON_FLIGHTS",

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
                "Unable to load Carry-On flights."
              ),

            metadata: {
              selectedDate,
            },
          });
        }
      );

    return () =>
      unsub();
  }, [
    selectedDate,
  ]);

  const openCarryOnFlight =
    (
      flight
    ) => {
      const timer =
        startSystemTimer();

      try {
        if (
          typeof onOpenCarryOnFlight !==
          "function"
        ) {
          throw new Error(
            "Dashboard onOpenCarryOnFlight callback is not available."
          );
        }

        onOpenCarryOnFlight(
          flight.id
        );

        logSystemSuccess({
          module:
            "DASHBOARD",

          action:
            "OPEN_CARRY_ON",

          durationMs:
            timer.elapsed(),
        }).catch(
          (
            error
          ) => {
            console.warn(
              "Dashboard Carry-On open metric failed:",
              error
            );
          }
        );
      } catch (
        error
      ) {
        console.error(
          "Dashboard Carry-On open error:",
          error
        );

        logDashboardIncident({
          action:
            "OPEN_CARRY_ON",

          severity:
            "MEDIUM",

          errorType:
            "NAVIGATION",

          errorCode:
            getErrorCode(
              error
            ),

          message:
            getErrorMessage(
              error,
              "Unable to open Carry-On Gate Check Control."
            ),

          flightId:
            flight?.id ||
            null,

          flightNumber:
            flight?.flightNumber ||
            null,

          durationMs:
            timer.elapsed(),
        });
      }
    };

  /* =========================
     PER-FLIGHT STATS
  ========================= */

  useEffect(() => {
    if (
      flights.length ===
      0
    ) {
      setFlightStats(
        {}
      );

      return undefined;
    }

    const unsubList =
      [];

    for (
      const flight
      of flights
    ) {
      const flightId =
        flight.id;

      const counterRef =
        collection(
          db,
          "flights",
          flightId,
          "counterScans"
        );

      const bagroomRef =
        collection(
          db,
          "flights",
          flightId,
          "bagroomScans"
        );

      const aircraftRef =
        collection(
          db,
          "flights",
          flightId,
          "aircraftScans"
        );

      const updateStats =
        (
          type,
          rows
        ) => {
          setFlightStats(
            (
              previous
            ) => {
              const old =
                previous[
                  flightId
                ] || {
                  counter:
                    [],

                  bagroom:
                    [],

                  aircraft:
                    [],
                };

              return {
                ...previous,

                [flightId]: {
                  ...old,

                  [type]:
                    rows,
                },
              };
            }
          );
        };

      const unsubCounter =
        onSnapshot(
          counterRef,

          (
            snap
          ) => {
            const rows =
              snap.docs.map(
                (
                  d
                ) => ({
                  id:
                    d.id,

                  ...d.data(),
                })
              );

            updateStats(
              "counter",
              rows
            );
          },

          (
            error
          ) => {
            console.error(
              "Dashboard counter stats error:",
              error
            );

            updateStats(
              "counter",
              []
            );

            logDashboardIncident({
              action:
                "LOAD_COUNTER_STATS",

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
                  "Unable to load Counter statistics."
                ),

              flightId,

              flightNumber:
                flight
                  ?.flightNumber ||
                null,
            });
          }
        );

      const unsubBagroom =
        onSnapshot(
          bagroomRef,

          (
            snap
          ) => {
            const rows =
              snap.docs.map(
                (
                  d
                ) => ({
                  id:
                    d.id,

                  ...d.data(),
                })
              );

            updateStats(
              "bagroom",
              rows
            );
          },

          (
            error
          ) => {
            console.error(
              "Dashboard bagroom stats error:",
              error
            );

            updateStats(
              "bagroom",
              []
            );

            logDashboardIncident({
              action:
                "LOAD_BAGROOM_STATS",

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
                  "Unable to load Bagroom statistics."
                ),

              flightId,

              flightNumber:
                flight
                  ?.flightNumber ||
                null,
            });
          }
        );

      const unsubAircraft =
        onSnapshot(
          aircraftRef,

          (
            snap
          ) => {
            const rows =
              snap.docs.map(
                (
                  d
                ) => ({
                  id:
                    d.id,

                  ...d.data(),
                })
              );

            updateStats(
              "aircraft",
              rows
            );
          },

          (
            error
          ) => {
            console.error(
              "Dashboard aircraft stats error:",
              error
            );

            updateStats(
              "aircraft",
              []
            );

            logDashboardIncident({
              action:
                "LOAD_AIRCRAFT_STATS",

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
                  "Unable to load Aircraft statistics."
                ),

              flightId,

              flightNumber:
                flight
                  ?.flightNumber ||
                null,
            });
          }
        );

      unsubList.push(
        unsubCounter,
        unsubBagroom,
        unsubAircraft
      );
    }

    return () => {
      unsubList.forEach(
        (
          unsub
        ) => {
          try {
            unsub();
          } catch (
            error
          ) {
            console.warn(
              "Dashboard unsubscribe error:",
              error
            );
          }
        }
      );
    };
  }, [
    flights,
  ]);

  /* =========================
     OPEN MODULE
  ========================= */

  const handleOpenModule =
    (
      flight,
      targetView
    ) => {
      const timer =
        startSystemTimer();

      try {
        if (
          typeof onOpenFlight !==
          "function"
        ) {
          throw new Error(
            "Dashboard onOpenFlight callback is not available."
          );
        }

        onOpenFlight(
          flight.id,
          targetView,
          flight.flightNumber
        );

        logSystemSuccess({
          module:
            "DASHBOARD",

          action:
            `OPEN_${String(
              targetView
            ).toUpperCase()}`,

          durationMs:
            timer.elapsed(),
        }).catch(
          (
            error
          ) => {
            console.warn(
              "Dashboard open metric failed:",
              error
            );
          }
        );
      } catch (
        error
      ) {
        console.error(
          "Dashboard module open error:",
          error
        );

        logDashboardIncident({
          action:
            "OPEN_MODULE",

          severity:
            "HIGH",

          errorType:
            "NAVIGATION",

          errorCode:
            getErrorCode(
              error
            ),

          message:
            getErrorMessage(
              error,
              `Unable to open ${targetView}.`
            ),

          flightId:
            flight?.id ||
            null,

          flightNumber:
            flight
              ?.flightNumber ||
            null,

          durationMs:
            timer.elapsed(),

          metadata: {
            targetView,
          },
        });
      }
    };

  /* =========================
     FLIGHT STATS
  ========================= */

  const getStatsForFlight =
    (
      flight
    ) => {
      const stats =
        flightStats[
          flight.id
        ] || {
          counter:
            [],

          bagroom:
            [],

          aircraft:
            [],
        };

      const gateTotal =
        typeof flight
          .checkedBagsTotal ===
        "number"
          ? flight
              .checkedBagsTotal
          : null;

      const counterTotal =
        stats
          .counter
          .length;

      const bagroomTotal =
        stats
          .bagroom
          .length;

      const aircraftTotal =
        stats
          .aircraft
          .length;

      const missing =
        gateTotal ===
        null
          ? null
          : Math.max(
              0,
              gateTotal -
                aircraftTotal
            );

      const progress =
        getProgressPercent(
          gateTotal,
          aircraftTotal
        );

      const bagTypes = {
        CHECKED_BAG:
          0,

        GATE_CHECK:
          0,

        OVERSIZE:
          0,

        GATE_BAG:
          0,
      };

      for (
        const scan
        of stats.aircraft
      ) {
        const type =
          normalizeBagType(
            scan.bagType
          );

        bagTypes[
          type
        ] += 1;
      }

      const counterBagTypes = {
        CHECKED_BAG:
          0,

        GATE_CHECK:
          0,

        OVERSIZE:
          0,
      };

      for (
        const scan
        of stats.counter
      ) {
        const type =
          normalizeBagType(
            scan.bagType
          );

        if (
          type ===
          "GATE_BAG"
        ) {
          continue;
        }

        counterBagTypes[
          type
        ] += 1;
      }

      const missingBagTypes = {
        GATE_CHECK:
          Math.max(
            0,

            counterBagTypes
              .GATE_CHECK -
              bagTypes
                .GATE_CHECK
          ),

        OVERSIZE:
          Math.max(
            0,

            counterBagTypes
              .OVERSIZE -
              bagTypes
                .OVERSIZE
          ),
      };

      return {
        gateTotal,

        counterTotal,

        bagroomTotal,

        aircraftTotal,

        missing,

        progress,

        bagTypes,

        counterBagTypes,

        missingBagTypes,
      };
    };

  /* =========================
     DAILY SUMMARY
  ========================= */

  const summaryTotals =
    useMemo(
      () => {
        let gate =
          0;

        let bagroom =
          0;

        let aircraft =
          0;

        let missing =
          0;

        let loadedFlights =
          0;

        for (
          const flight
          of flights
        ) {
          const stats =
            getStatsForFlight(
              flight
            );

          if (
            typeof stats
              .gateTotal ===
            "number"
          ) {
            gate +=
              stats.gateTotal;
          }

          bagroom +=
            stats.bagroomTotal;

          aircraft +=
            stats.aircraftTotal;

          if (
            typeof stats
              .missing ===
            "number"
          ) {
            missing +=
              stats.missing;
          }

          if (
            normalizeStatus(
              flight.status
            ) === "LOADED"
          ) {
            loadedFlights +=
              1;
          }
        }

        return {
          gate,

          bagroom,

          aircraft,

          missing,

          loadedFlights,
        };
      },

      [
        flights,
        flightStats,
      ]
    );

  /* =========================
     RENDER
  ========================= */

  return (
    <div
      className="dash-root"
    >
      {/* =========================
          WELCOME
      ========================= */}

      <section
        className="dash-header-card"
        style={{
          display:
            "flex",

          justifyContent:
            "space-between",

          alignItems:
            "center",

          gap:
            20,

          flexWrap:
            "wrap",
        }}
      >
        <div
          style={{
            flex:
              "1 1 320px",
          }}
        >
          <p
            style={{
              margin:
                0,

              color:
                "#64748b",

              fontSize:
                "0.9rem",

              fontWeight:
                600,
            }}
          >
            Welcome back
          </p>

          <h2
            style={{
              margin:
                "5px 0 8px",

              fontSize:
                "1.9rem",

              lineHeight:
                1.1,

              color:
                "#0f172a",

              letterSpacing:
                "-0.035em",
            }}
          >
            {displayName}
          </h2>

          <div
            style={{
              display:
                "flex",

              alignItems:
                "center",

              gap:
                8,

              flexWrap:
                "wrap",
            }}
          >
            <span
              style={{
                display:
                  "inline-flex",

                alignItems:
                  "center",

                padding:
                  "5px 10px",

                borderRadius:
                  999,

                background:
                  "#eff6ff",

                color:
                  "#2563eb",

                fontSize:
                  "0.75rem",

                fontWeight:
                  900,
              }}
            >
              {roleLabel}
            </span>

            {user?.username && (
              <span
                style={{
                  color:
                    "#94a3b8",

                  fontSize:
                    "0.76rem",

                  fontWeight:
                    600,
                }}
              >
                @{user.username}
              </span>
            )}
          </div>

          {!isGateController &&
            gateControllerOnDuty && (
              <div
                style={{
                  display:
                    "inline-flex",

                  alignItems:
                    "center",

                  gap:
                    6,

                  marginTop:
                    10,

                  padding:
                    "6px 9px",

                  borderRadius:
                    9,

                  background:
                    "#f8fafc",

                  border:
                    "1px solid #e2e8f0",

                  color:
                    "#475569",

                  fontSize:
                    "0.78rem",
                }}
              >
                <span
                  style={{
                    color:
                      "#22c55e",
                  }}
                >
                  â
                </span>

                Gate Controller on duty:{" "}
                <strong>
                  {gateControllerOnDuty}
                </strong>
              </div>
            )}

          <p
            style={{
              margin:
                "12px 0 0",

              color:
                "#64748b",

              fontSize:
                "0.88rem",
            }}
          >
            Real-time flight overview for baggage operations.
          </p>
        </div>

        <div
          className="dash-summary-box"
          style={{
            minWidth:
              180,

            padding:
              "18px 22px",

            borderRadius:
              15,

            background:
              "linear-gradient(135deg, #1d4ed8, #3b82f6)",

            color:
              "white",

            boxShadow:
              "0 10px 25px rgba(37,99,235,0.18)",
          }}
        >
          <p
            style={{
              margin:
                0,

              fontSize:
                "0.8rem",

              color:
                "#dbeafe",

              textAlign:
                "right",
            }}
          >
            Flights
          </p>

          <p
            style={{
              margin:
                "3px 0",

              fontSize:
                "2rem",

              fontWeight:
                900,

              textAlign:
                "right",
            }}
          >
            {loading
              ? "â¦"
              : flights.length}
          </p>

          <p
            style={{
              margin:
                0,

              fontSize:
                "0.75rem",

              color:
                "#dbeafe",

              textAlign:
                "right",
            }}
          >
            for {selectedDate}
          </p>
        </div>
      </section>

      {/* =========================
          DAY SUMMARY
      ========================= */}

      <section
        style={{
          display:
            "grid",

          gridTemplateColumns:
            "repeat(auto-fit, minmax(160px, 1fr))",

          gap:
            12,

          marginBottom:
            16,
        }}
      >
        <SmallCard
          label="Gate Total"
          value={
            loading
              ? "â¦"
              : summaryTotals.gate
          }
          tone="blue"
        />

        <SmallCard
          label="Bagroom"
          value={
            loading
              ? "â¦"
              : summaryTotals.bagroom
          }
        />

        <SmallCard
          label="Aircraft"
          value={
            loading
              ? "â¦"
              : summaryTotals.aircraft
          }
        />

        <SmallCard
          label="Missing"
          value={
            loading
              ? "â¦"
              : summaryTotals.missing
          }
          tone={
            summaryTotals.missing ===
            0
              ? "good"
              : "bad"
          }
        />

        <SmallCard
          label="Loaded Flights"
          value={
            loading
              ? "â¦"
              : summaryTotals.loadedFlights
          }
          tone="good"
        />
      </section>

      {/* =========================
          REAL-TIME FLIGHTS
      ========================= */}

      <section
        className="dash-section"
      >
        <div
          className="dash-section-header"
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
              "end",
          }}
        >
          <div>
            <h3
              style={{
                marginBottom:
                  3,
              }}
            >
              Real-Time Flights
            </h3>

            <p
              style={{
                margin:
                  0,
              }}
            >
              Live baggage progress by flight.
            </p>
          </div>

          <div>
            <label
              style={{
                fontSize:
                  "0.85rem",

                color:
                  "#374151",

                fontWeight:
                  700,
              }}
            >
              Date
            </label>

            <div>
              <input
                type="date"

                value={
                  selectedDate
                }

                onChange={(
                  event
                ) => {
                  setSelectedDate(
                    event.target
                      .value
                  );
                }}

                style={{
                  padding:
                    "7px 10px",

                  borderRadius:
                    10,

                  border:
                    "1px solid #d1d5db",

                  background:
                    "#f8fafc",
                }}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <p
            style={{
              color:
                "#6b7280",

              padding:
                14,
            }}
          >
            Loading flights...
          </p>
        ) : flights.length ===
          0 ? (
          <p
            style={{
              color:
                "#6b7280",

              padding:
                14,
            }}
          >
            No flights found for{" "}
            {selectedDate}.
          </p>
        ) : (
          <div
            style={{
              display:
                "grid",

              gap:
                14,
            }}
          >
            {flights.map(
              (
                flight
              ) => {
                const stats =
                  getStatsForFlight(
                    flight
                  );

                const status =
                  normalizeStatus(
                    flight.status
                  );

                return (
                  <div
                    key={
                      flight.id
                    }
                    style={{
                      border:
                        "1px solid #e5e7eb",

                      borderRadius:
                        14,

                      padding:
                        14,

                      background:
                        "white",

                      boxShadow:
                        "0 2px 8px rgba(15,23,42,0.03)",
                    }}
                  >
                    {/* FLIGHT HEADER */}

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
                          "start",
                      }}
                    >
                      <div>
                        <h3
                          style={{
                            margin:
                              0,
                          }}
                        >
                          {flight
                            .flightNumber ||
                            "-"}

                          <span
                            style={{
                              color:
                                "#6b7280",

                              fontSize:
                                "0.9rem",
                            }}
                          >
                            {" "}
                            Â·{" "}
                            {flight.gate ||
                              "No Gate"}
                          </span>
                        </h3>

                        <p
                          style={{
                            margin:
                              "5px 0 0",

                            color:
                              "#6b7280",

                            fontSize:
                              "0.85rem",
                          }}
                        >
                          Date:{" "}
                          <strong>
                            {flight
                              .flightDate ||
                              "-"}
                          </strong>

                          {" Â· "}

                          Aircraft:{" "}
                          <strong>
                            {flight
                              .aircraftType ||
                              "-"}
                          </strong>
                        </p>

                        <p
                          style={{
                            margin:
                              "5px 0 0",

                            color:
                              "#6b7280",

                            fontSize:
                              "0.85rem",
                          }}
                        >
                          Gate Controller:{" "}
                          <strong>
                            {flight
                              .gateControllerOnDuty ||
                              gateControllerOnDuty ||
                              "-"}
                          </strong>

                          {" Â· "}

                          Ramp Supervisor:{" "}
                          <strong>
                            {flight
                              .rampSupervisorOnDuty ||
                              "-"}
                          </strong>
                        </p>
                      </div>

                      <StatusPill
                        status={
                          status
                        }
                      />
                    </div>

                    {/* LOADING PROGRESS */}

                    <div
                      style={{
                        marginTop:
                          12,
                      }}
                    >
                      <div
                        style={{
                          display:
                            "flex",

                          justifyContent:
                            "space-between",

                          fontSize:
                            "0.82rem",

                          color:
                            "#6b7280",

                          marginBottom:
                            5,
                        }}
                      >
                        <span>
                          Loading Progress
                        </span>

                        <strong>
                          {stats.progress}%
                        </strong>
                      </div>

                      <ProgressBar
                        percent={
                          stats.progress
                        }
                      />
                    </div>

                    {/* MAIN COUNTS */}

                    <div
                      style={{
                        display:
                          "grid",

                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(130px, 1fr))",

                        gap:
                          10,

                        marginTop:
                          12,
                      }}
                    >
                      <SmallCard
                        label="Gate Total"

                        value={
                          stats.gateTotal ===
                          null
                            ? "â"
                            : stats.gateTotal
                        }

                        tone="blue"
                      />

                      <SmallCard
                        label="Counter"

                        value={
                          stats.counterTotal
                        }
                      />

                      <SmallCard
                        label="Bagroom"

                        value={
                          stats.bagroomTotal
                        }
                      />

                      <SmallCard
                        label="Aircraft"

                        value={
                          stats.aircraftTotal
                        }
                      />

                      <SmallCard
                        label="Missing"

                        value={
                          stats.missing ===
                          null
                            ? "â"
                            : stats.missing
                        }

                        tone={
                          stats.missing ===
                          0
                            ? "good"
                            : stats.missing ===
                                null
                              ? "default"
                              : "bad"
                        }
                      />
                    </div>

                    {/* BAG TYPES */}

                    <div
                      style={{
                        display:
                          "grid",

                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(150px, 1fr))",

                        gap:
                          10,

                        marginTop:
                          10,
                      }}
                    >
                      <SmallCard
                        label="Checked Loaded"

                        value={
                          stats
                            .bagTypes
                            .CHECKED_BAG
                        }
                      />

                      <SmallCard
                        label="Gate Check Loaded"

                        value={
                          stats
                            .bagTypes
                            .GATE_CHECK
                        }

                        tone="warn"
                      />

                      <SmallCard
                        label="Oversize Loaded"

                        value={
                          stats
                            .bagTypes
                            .OVERSIZE
                        }

                        tone="warn"
                      />

                      <SmallCard
                        label="Gate Tagged Loaded"

                        value={
                          stats
                            .bagTypes
                            .GATE_BAG
                        }

                        tone="blue"
                      />

                      <SmallCard
                        label="Gate Check Missing"

                        value={
                          stats
                            .missingBagTypes
                            .GATE_CHECK
                        }

                        tone={
                          stats
                            .missingBagTypes
                            .GATE_CHECK ===
                          0
                            ? "good"
                            : "bad"
                        }
                      />

                      <SmallCard
                        label="Oversize Missing"

                        value={
                          stats
                            .missingBagTypes
                            .OVERSIZE
                        }

                        tone={
                          stats
                            .missingBagTypes
                            .OVERSIZE ===
                          0
                            ? "good"
                            : "bad"
                        }
                      />
                    </div>

                    {/* ACTIONS */}

                    <div
                      style={{
                        display:
                          "flex",

                        gap:
                          8,

                        flexWrap:
                          "wrap",

                        justifyContent:
                          "flex-end",

                        marginTop:
                          12,
                      }}
                    >
                      <button
                        type="button"

                        className="btn-secondary"

                        onClick={() =>
                          handleOpenModule(
                            flight,
                            "gate"
                          )
                        }
                      >
                        Gate
                      </button>

                      <button
                        type="button"

                        className="btn-secondary"

                        onClick={() =>
                          handleOpenModule(
                            flight,
                            "counter"
                          )
                        }
                      >
                        Counter
                      </button>

                      {!isGateController && (
                        <button
                          type="button"

                          className="btn-secondary"

                          onClick={() =>
                            handleOpenModule(
                              flight,
                              "bagroom"
                            )
                          }
                        >
                          Bagroom
                        </button>
                      )}

                      <button
                        type="button"

                        className="btn-primary"

                        onClick={() =>
                          handleOpenModule(
                            flight,
                            "aircraft"
                          )
                        }
                      >
                        Aircraft
                      </button>

                      <button
                        type="button"

                        className="btn-secondary"

                        onClick={() =>
                          handleOpenModule(
                            flight,
                            "reports"
                          )
                        }
                      >
                        Reports
                      </button>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        )}
      </section>

      {/* =========================
          CARRY-ON GATE CHECK CONTROL
          ISOLATED FROM BAGGAGE FLOW
      ========================= */}

      <section
        className="dash-section"
        style={{
          marginTop:
            18,

          border:
            "1px solid #ddd6fe",

          borderRadius:
            16,

          background:
            "white",

          padding:
            16,

          boxShadow:
            "0 8px 22px rgba(15,23,42,0.05)",
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
            <div
              style={{
                color:
                  "#7c3aed",

                fontSize:
                  "0.72rem",

                fontWeight:
                  900,

                letterSpacing:
                  "0.06em",
              }}
            >
              CARRY-ON GATE CHECK CONTROL
            </div>

            <h3
              style={{
                margin:
                  "5px 0 3px",

                color:
                  "#0f172a",
              }}
            >
              Carry-On Flights
            </h3>

            <p
              style={{
                margin:
                  0,

                color:
                  "#64748b",

                fontSize:
                  "0.84rem",
              }}
            >
              Live Carry-On setup and operational status for {selectedDate}.
            </p>
          </div>

          <div
            style={{
              minWidth:
                118,

              padding:
                "10px 14px",

              borderRadius:
                12,

              background:
                "#f5f3ff",

              border:
                "1px solid #c4b5fd",

              textAlign:
                "center",
            }}
          >
            <div
              style={{
                color:
                  "#6d28d9",

                fontSize:
                  "0.72rem",

                fontWeight:
                  800,
              }}
            >
              Flights
            </div>

            <div
              style={{
                marginTop:
                  2,

                color:
                  "#4c1d95",

                fontSize:
                  "1.5rem",

                fontWeight:
                  900,
              }}
            >
              {loadingCarryOnFlights
                ? "\u2026"
                : carryOnFlights.length}
            </div>
          </div>
        </div>

        {loadingCarryOnFlights ? (
          <p
            style={{
              color:
                "#64748b",

              padding:
                "12px 2px 0",
            }}
          >
            Loading Carry-On flights...
          </p>
        ) : carryOnFlights.length ===
          0 ? (
          <div
            style={{
              marginTop:
                12,

              padding:
                14,

              borderRadius:
                12,

              border:
                "1px dashed #cbd5e1",

              background:
                "#f8fafc",

              color:
                "#64748b",

              fontSize:
                "0.84rem",
            }}
          >
            No Carry-On flights found for {selectedDate}.
          </div>
        ) : (
          <div
            style={{
              display:
                "grid",

              gap:
                10,

              marginTop:
                14,
            }}
          >
            {carryOnFlights.map(
              (
                flight
              ) => {
                const status =
                  String(
                    flight?.status ||
                    "SETUP"
                  )
                    .trim()
                    .toUpperCase();

                const required =
                  Number(
                    flight
                      ?.requiredCarryOns ||
                    0
                  );

                const gateChecks =
                  Number(
                    flight
                      ?.gateCheckNumberCount ||
                    0
                  );

                const passengerCount =
                  Number(
                    flight
                      ?.passengerCount ||
                    0
                  );

                const availableSeats =
                  Number(
                    flight
                      ?.availableSeatCount ||
                    0
                  );

                const statusColors =
                  status ===
                  "READY"
                    ? {
                        bg:
                          "#dcfce7",

                        border:
                          "#86efac",

                        text:
                          "#166534",
                      }
                    : status ===
                        "COMPLETE"
                      ? {
                          bg:
                            "#dbeafe",

                          border:
                            "#93c5fd",

                          text:
                            "#1d4ed8",
                        }
                      : status ===
                          "IN_PROGRESS"
                        ? {
                            bg:
                              "#ffedd5",

                            border:
                              "#fdba74",

                            text:
                              "#9a3412",
                          }
                        : {
                            bg:
                              "#f5f3ff",

                            border:
                              "#c4b5fd",

                            text:
                              "#6d28d9",
                          };

                return (
                  <div
                    key={
                      flight.id
                    }
                    style={{
                      border:
                        "1px solid #e5e7eb",

                      borderRadius:
                        13,

                      padding:
                        13,

                      background:
                        "#ffffff",
                    }}
                  >
                    <div
                      style={{
                        display:
                          "flex",

                        justifyContent:
                          "space-between",

                        alignItems:
                          "flex-start",

                        gap:
                          12,

                        flexWrap:
                          "wrap",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display:
                              "flex",

                            alignItems:
                              "center",

                            gap:
                              8,

                            flexWrap:
                              "wrap",
                          }}
                        >
                          <strong
                            style={{
                              color:
                                "#0f172a",

                              fontSize:
                                "1rem",
                            }}
                          >
                            {flight.flightNumber ||
                              "-"}
                          </strong>

                          <span
                            style={{
                              padding:
                                "4px 8px",

                              borderRadius:
                                999,

                              background:
                                statusColors.bg,

                              border:
                                `1px solid ${statusColors.border}`,

                              color:
                                statusColors.text,

                              fontSize:
                                "0.68rem",

                              fontWeight:
                                900,
                            }}
                          >
                            {status.replace(
                              "_",
                              " "
                            )}
                          </span>
                        </div>

                        <div
                          style={{
                            marginTop:
                              5,

                            color:
                              "#64748b",

                            fontSize:
                              "0.8rem",
                          }}
                        >
                          {flight.origin ||
                            "-"}
                          {" \u2192 "}
                          {flight.destination ||
                            "-"}

                          {flight.gate
                            ? ` \u00B7 Gate ${flight.gate}`
                            : ""}

                          {flight.tailNumber
                            ? ` \u00B7 Tail ${flight.tailNumber}`
                            : ""}
                        </div>
                      </div>

                      <button
                        type="button"

                        onClick={() =>
                          openCarryOnFlight(
                            flight
                          )
                        }

                        style={{
                          padding:
                            "8px 11px",

                          borderRadius:
                            9,

                          border:
                            "1px solid #7c3aed",

                          background:
                            "#7c3aed",

                          color:
                            "white",

                          fontWeight:
                            900,

                          cursor:
                            "pointer",
                        }}
                      >
                        Open Carry-On
                      </button>
                    </div>

                    <div
                      style={{
                        display:
                          "grid",

                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(120px, 1fr))",

                        gap:
                          8,

                        marginTop:
                          11,
                      }}
                    >
                      <CarryOnMetric
                        label="Passengers"
                        value={
                          passengerCount
                        }
                      />

                      <CarryOnMetric
                        label="Available Seats"
                        value={
                          availableSeats
                        }
                      />

                      <CarryOnMetric
                        label="Required"
                        value={
                          required
                        }
                      />

                      <CarryOnMetric
                        label="Gate Checks"
                        value={
                          gateChecks
                        }
                      />
                    </div>

                    {required >
                      gateChecks && (
                      <div
                        style={{
                          marginTop:
                            9,

                          padding:
                            "7px 9px",

                          borderRadius:
                            9,

                          border:
                            "1px solid #fde68a",

                          background:
                            "#fffbeb",

                          color:
                            "#92400e",

                          fontSize:
                            "0.75rem",

                          fontWeight:
                            800,
                        }}
                      >
                        {required -
                          gateChecks} additional Gate Check number(s) needed to meet the current target.
                      </div>
                    )}
                  </div>
                );
              }
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CarryOnMetric({
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
          "#f8fafc",

        border:
          "1px solid #e2e8f0",
      }}
    >
      <div
        style={{
          color:
            "#64748b",

          fontSize:
            "0.68rem",

          fontWeight:
            700,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            2,

          color:
            "#0f172a",

          fontSize:
            "1.08rem",

          fontWeight:
            900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

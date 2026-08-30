// src/App.jsx

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "./firebase";

import LoginPage from "./pages/LoginPage.jsx";

import PrivacyNoticePage, {
  PRIVACY_NOTICE_VERSION,
} from "./pages/PrivacyNoticePage.jsx";

import PrivacyAcknowledgementsPage from "./pages/PrivacyAcknowledgementsPage.jsx";
import MonthlyCleanupPage from "./pages/MonthlyCleanupPage.jsx";
import SystemMonitorPage from "./pages/SystemMonitorPage.jsx";

import VersionUpdateNotice from "./components/VersionUpdateNotice.jsx";

import DashboardPage from "./pages/DashboardPage.jsx";
import FlightsPage from "./pages/FlightsPage.jsx";
import GateControllerPage from "./pages/GateControllerPage.jsx";
import BagroomScanPage from "./pages/BagroomScanPage.jsx";
import AircraftScanPage from "./pages/AircraftScanPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import AdminUsersPage from "./pages/AdminUsersPage.jsx";
import CounterScanPage from "./pages/CounterScanPage.jsx";
import BaggageTrackingPage from "./pages/BaggageTrackingPage.jsx";

import {
  createPresenceHeartbeat,
} from "./utils/systemLogger.js";

/* =========================
   HELPERS
========================= */

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function normalizeOperationalPosition(
  value
) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getOperationalPositionLabel(
  value
) {
  const normalized =
    normalizeOperationalPosition(
      value
    );

  const labels = {
    COUNTER_SCAN:
      "Counter Scan",

    GATE_CONTROLLER:
      "Gate Controller",

    BAGROOM_SCAN:
      "Bagroom Scan",

    AIRCRAFT_RAMP:
      "Aircraft / Ramp",

    SUPERVISOR:
      "Supervisor",
  };

  return (
    labels[normalized] ||
    normalized ||
    "-"
  );
}

function getSessionJson(
  key,
  fallback = null
) {
  try {
    const saved =
      sessionStorage.getItem(
        key
      );

    return saved
      ? JSON.parse(saved)
      : fallback;
  } catch {
    return fallback;
  }
}

/* =========================
   APP
========================= */

export default function App() {
  /* =========================
     STATE
  ========================= */

  const [
    user,
    setUser,
  ] = useState(() =>
    getSessionJson(
      "blcsUser",
      null
    )
  );

  const [
    operationalSession,
    setOperationalSession,
  ] = useState(() =>
    getSessionJson(
      "blcsOperationalSession",
      null
    )
  );

  const [
    gateControllerOnDuty,
    setGateControllerOnDuty,
  ] = useState(() => {
    return (
      sessionStorage.getItem(
        "gateControllerOnDuty"
      ) || null
    );
  });

  const [
    currentView,
    setCurrentView,
  ] = useState(() => {
    return (
      sessionStorage.getItem(
        "currentView"
      ) || "dashboard"
    );
  });

  const [
    selectedFlightId,
    setSelectedFlightId,
  ] = useState(() => {
    return (
      sessionStorage.getItem(
        "selectedFlightId"
      ) || null
    );
  });

  const [
    selectedFlightNumber,
    setSelectedFlightNumber,
  ] = useState(() => {
    return (
      sessionStorage.getItem(
        "selectedFlightNumber"
      ) || null
    );
  });

  const [
    refreshKey,
    setRefreshKey,
  ] = useState(0);

  const [
    privacyStatus,
    setPrivacyStatus,
  ] = useState(
    user
      ? "checking"
      : "accepted"
  );

  const [
    savingPrivacy,
    setSavingPrivacy,
  ] = useState(false);

  /* =========================
     USER / ROLE VALUES
  ========================= */

  const role =
    normalizeRole(
      user?.role
    );

  const displayName =
    user?.fullName ||
    user?.name ||
    user?.displayName ||
    user?.username ||
    "User";

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
        (letter) =>
          letter.toUpperCase()
      );

  const activeOperationalPosition =
    normalizeOperationalPosition(
      operationalSession
        ?.operationalPosition
    );

  const activeOperationalPositionLabel =
    operationalSession
      ?.operationalPositionLabel ||
    getOperationalPositionLabel(
      activeOperationalPosition
    );

  const isStationManager =
    role ===
    "station_manager";

  const canCreateFlights =
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor" ||
    role ===
      "gate_controller";

  const canEditGateTotals =
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor" ||
    role ===
      "gate_controller" ||
    activeOperationalPosition ===
      "GATE_CONTROLLER";

  /* =========================
     OPERATIONAL CONTEXT
  ========================= */

  const operationalContext =
    useMemo(
      () => ({
        operationalPosition:
          activeOperationalPosition ||
          null,

        operationalPositionLabel:
          activeOperationalPositionLabel ||
          null,

        employeeFullName:
          operationalSession
            ?.employeeFullName ||
          displayName,

        basePosition:
          operationalSession
            ?.basePosition ||
          user?.position ||
          null,

        systemRole:
          role ||
          null,

        loginAt:
          operationalSession
            ?.loginAt ||
          null,
      }),
      [
        activeOperationalPosition,
        activeOperationalPositionLabel,
        operationalSession
          ?.employeeFullName,
        operationalSession
          ?.basePosition,
        operationalSession
          ?.loginAt,
        displayName,
        user?.position,
        role,
      ]
    );

  /* =========================
     CHECK PRIVACY CONSENT
  ========================= */

  useEffect(() => {
    if (!user?.id) {
      setPrivacyStatus(
        "accepted"
      );

      return undefined;
    }

    let active =
      true;

    const checkPrivacy =
      async () => {
        setPrivacyStatus(
          "checking"
        );

        try {
          const userRef =
            doc(
              db,
              "users",
              user.id
            );

          const snap =
            await getDoc(
              userRef
            );

          if (!active) {
            return;
          }

          if (
            !snap.exists()
          ) {
            setPrivacyStatus(
              "required"
            );

            return;
          }

          const data =
            snap.data();

          const accepted =
            data
              ?.privacyConsent
              ?.accepted ===
            true;

          const version =
            String(
              data
                ?.privacyConsent
                ?.version ||
                ""
            );

          if (
            accepted &&
            version ===
              PRIVACY_NOTICE_VERSION
          ) {
            setPrivacyStatus(
              "accepted"
            );
          } else {
            setPrivacyStatus(
              "required"
            );
          }
        } catch (
          error
        ) {
          console.error(
            "Privacy consent check error:",
            error
          );

          if (active) {
            setPrivacyStatus(
              "required"
            );
          }
        }
      };

    checkPrivacy();

    return () => {
      active = false;
    };
  }, [
    user?.id,
  ]);

  /* =========================
     SYSTEM PRESENCE
  ========================= */

  useEffect(() => {
    if (
      !user?.id ||
      privacyStatus !==
        "accepted"
    ) {
      return undefined;
    }

    let stopHeartbeat =
      null;

    try {
      stopHeartbeat =
        createPresenceHeartbeat({
          user,

          operationalContext,

          getCurrentView:
            () => {
              return (
                sessionStorage.getItem(
                  "currentView"
                ) ||
                currentView ||
                "dashboard"
              );
            },
        });
    } catch (
      error
    ) {
      console.warn(
        "BLCS presence heartbeat could not start:",
        error
      );
    }

    return () => {
      try {
        if (
          typeof stopHeartbeat ===
          "function"
        ) {
          stopHeartbeat();
        }
      } catch (
        error
      ) {
        console.warn(
          "BLCS presence heartbeat cleanup error:",
          error
        );
      }
    };
  }, [
    user?.id,
    user?.username,
    user?.role,
    currentView,
    privacyStatus,
    operationalContext,
  ]);

  /* =========================
     LOGIN
  ========================= */

  const handleLogin = (
    userData,
    sessionMeta
  ) => {
    const operationalPosition =
      normalizeOperationalPosition(
        sessionMeta
          ?.operationalPosition
      );

    const operationalPositionLabel =
      sessionMeta
        ?.operationalPositionLabel ||
      getOperationalPositionLabel(
        operationalPosition
      );

    const nextOperationalSession = {
      operationalPosition:
        operationalPosition ||
        null,

      operationalPositionLabel:
        operationalPositionLabel ||
        null,

      employeeFullName:
        sessionMeta
          ?.employeeFullName ||
        userData?.fullName ||
        userData?.username ||
        null,

      basePosition:
        sessionMeta
          ?.basePosition ||
        userData?.position ||
        null,

      systemRole:
        sessionMeta
          ?.systemRole ||
        userData?.role ||
        null,

      loginAt:
        sessionMeta
          ?.loginAt ||
        new Date()
          .toISOString(),
    };

    const gc =
      operationalPosition ===
      "GATE_CONTROLLER"
        ? userData
            ?.username ||
          null
        : sessionMeta
            ?.gateControllerUsername ||
          null;

    setUser(
      userData
    );

    setOperationalSession(
      nextOperationalSession
    );

    setGateControllerOnDuty(
      gc
    );

    setCurrentView(
      "dashboard"
    );

    setSelectedFlightId(
      null
    );

    setSelectedFlightNumber(
      null
    );

    setPrivacyStatus(
      "checking"
    );

    sessionStorage.setItem(
      "blcsUser",
      JSON.stringify(
        userData
      )
    );

    sessionStorage.setItem(
      "blcsOperationalSession",
      JSON.stringify(
        nextOperationalSession
      )
    );

    if (gc) {
      sessionStorage.setItem(
        "gateControllerOnDuty",
        gc
      );
    } else {
      sessionStorage.removeItem(
        "gateControllerOnDuty"
      );
    }

    sessionStorage.setItem(
      "currentView",
      "dashboard"
    );

    sessionStorage.removeItem(
      "selectedFlightId"
    );

    sessionStorage.removeItem(
      "selectedFlightNumber"
    );
  };

  /* =========================
     ACCEPT PRIVACY
  ========================= */

  const handleAcceptPrivacy =
    async () => {
      if (!user?.id) {
        return;
      }

      try {
        setSavingPrivacy(
          true
        );

        const userRef =
          doc(
            db,
            "users",
            user.id
          );

        await setDoc(
          userRef,
          {
            privacyConsent: {
              accepted:
                true,

              version:
                PRIVACY_NOTICE_VERSION,

              acceptedAt:
                serverTimestamp(),

              acceptedBy: {
                userId:
                  user.id,

                username:
                  user
                    ?.username ||
                  null,

                role:
                  user
                    ?.role ||
                  null,

                operationalPosition:
                  operationalSession
                    ?.operationalPosition ||
                  null,

                operationalPositionLabel:
                  operationalSession
                    ?.operationalPositionLabel ||
                  null,
              },
            },
          },
          {
            merge:
              true,
          }
        );

        setPrivacyStatus(
          "accepted"
        );
      } catch (
        error
      ) {
        console.error(
          "Privacy acceptance error:",
          error
        );

        window.alert(
          "Unable to save your acceptance. Please check your connection and try again."
        );
      } finally {
        setSavingPrivacy(
          false
        );
      }
    };

  /* =========================
     LOGOUT
  ========================= */

  const handleLogout =
    () => {
      sessionStorage.clear();

      setUser(
        null
      );

      setOperationalSession(
        null
      );

      setGateControllerOnDuty(
        null
      );

      setSelectedFlightId(
        null
      );

      setSelectedFlightNumber(
        null
      );

      setCurrentView(
        "dashboard"
      );

      setRefreshKey(
        0
      );

      setPrivacyStatus(
        "accepted"
      );
    };

  /* =========================
     NAVIGATION
  ========================= */

  const goToView =
    (
      view
    ) => {
      setCurrentView(
        view
      );

      sessionStorage.setItem(
        "currentView",
        view
      );
    };

  /*
   * IMPORTANT:
   *
   * This is used by FlightsPage.
   *
   * Selecting/Open a flight will:
   * 1. Save flight ID
   * 2. Save flight number
   * 3. Open Gate Controller
   */
  const selectFlight =
    (
      flightId,
      flightNumber = null
    ) => {
      if (!flightId) {
        return;
      }

      setSelectedFlightId(
        flightId
      );

      setSelectedFlightNumber(
        flightNumber ||
          null
      );

      setCurrentView(
        "gate"
      );

      sessionStorage.setItem(
        "selectedFlightId",
        flightId
      );

      sessionStorage.setItem(
        "currentView",
        "gate"
      );

      if (
        flightNumber
      ) {
        sessionStorage.setItem(
          "selectedFlightNumber",
          flightNumber
        );
      } else {
        sessionStorage.removeItem(
          "selectedFlightNumber"
        );
      }
    };

  const handleSoftRefresh =
    () => {
      setRefreshKey(
        (
          previous
        ) =>
          previous +
          1
      );
    };

  /*
   * Dashboard can specify exactly which
   * operational module to open.
   */
  const handleOpenFlightFromDashboard =
    (
      flightId,
      targetView = "gate",
      flightNumber
    ) => {
      if (!flightId) {
        return;
      }

      const nextView =
        targetView ||
        "gate";

      setSelectedFlightId(
        flightId
      );

      setSelectedFlightNumber(
        flightNumber ||
          null
      );

      setCurrentView(
        nextView
      );

      sessionStorage.setItem(
        "selectedFlightId",
        flightId
      );

      sessionStorage.setItem(
        "currentView",
        nextView
      );

      if (
        flightNumber
      ) {
        sessionStorage.setItem(
          "selectedFlightNumber",
          flightNumber
        );
      } else {
        sessionStorage.removeItem(
          "selectedFlightNumber"
        );
      }
    };

  /* =========================
     PAGE ROUTER
  ========================= */

  const renderView =
    () => {
      if (
        currentView ===
        "dashboard"
      ) {
        return (
          <DashboardPage
            user={
              user
            }
            operationalContext={
              operationalContext
            }
            onOpenFlight={
              handleOpenFlightFromDashboard
            }
            gateControllerOnDuty={
              gateControllerOnDuty
            }
          />
        );
      }

      if (
        currentView ===
        "flights"
      ) {
        return (
          <FlightsPage
            user={
              user
            }
            operationalContext={
              operationalContext
            }
            canCreateFlights={
              canCreateFlights
            }

            /*
             * IMPORTANT FIX:
             *
             * FlightsPage now sends:
             * flightId + flightNumber
             */
            onFlightSelected={(
              flightId,
              flightNumber
            ) =>
              selectFlight(
                flightId,
                flightNumber
              )
            }
          />
        );
      }

      if (
        currentView ===
        "tracking"
      ) {
        return (
          <BaggageTrackingPage
            user={
              user
            }
            operationalContext={
              operationalContext
            }
          />
        );
      }

      if (
        currentView ===
        "adminUsers"
      ) {
        return (
          <AdminUsersPage
            user={
              user
            }
          />
        );
      }

      if (
        currentView ===
        "privacyAcknowledgements"
      ) {
        return (
          <PrivacyAcknowledgementsPage
            user={
              user
            }
          />
        );
      }

      if (
        currentView ===
        "monthlyCleanup"
      ) {
        return (
          <MonthlyCleanupPage
            user={
              user
            }
          />
        );
      }

      if (
        currentView ===
        "systemMonitor"
      ) {
        return (
          <SystemMonitorPage
            user={
              user
            }
          />
        );
      }

      /* =========================
         FLIGHT REQUIRED
      ========================= */

      if (
        !selectedFlightId
      ) {
        return (
          <div
            style={{
              padding:
                20,

              background:
                "white",

              borderRadius:
                14,

              border:
                "1px solid #e5e7eb",

              color:
                "#64748b",
            }}
          >
            Please select a flight first.
          </div>
        );
      }

      if (
        currentView ===
        "counter"
      ) {
        return (
          <CounterScanPage
            flightId={
              selectedFlightId
            }
            user={
              user
            }
            operationalContext={
              operationalContext
            }
          />
        );
      }

      if (
        currentView ===
        "gate"
      ) {
        return (
          <GateControllerPage
            flightId={
              selectedFlightId
            }
            user={
              user
            }
            operationalContext={
              operationalContext
            }
            gateControllerOnDuty={
              gateControllerOnDuty
            }
            canEdit={
              canEditGateTotals
            }
          />
        );
      }

      if (
        currentView ===
        "bagroom"
      ) {
        return (
          <BagroomScanPage
            flightId={
              selectedFlightId
            }
            user={
              user
            }
            operationalContext={
              operationalContext
            }
          />
        );
      }

      if (
        currentView ===
        "aircraft"
      ) {
        return (
          <AircraftScanPage
            flightId={
              selectedFlightId
            }
            user={
              user
            }
            operationalContext={
              operationalContext
            }
          />
        );
      }

      if (
        currentView ===
        "reports"
      ) {
        return (
          <ReportsPage
            flightId={
              selectedFlightId
            }
            user={
              user
            }
            operationalContext={
              operationalContext
            }
          />
        );
      }

      return (
        <div
          style={{
            padding:
              20,

            background:
              "white",

            border:
              "1px solid #e5e7eb",

            borderRadius:
              14,

            color:
              "#64748b",
          }}
        >
          Page not found.
        </div>
      );
    };

  /* =========================
     CONDITIONAL SCREENS

     ALL HOOKS MUST REMAIN
     ABOVE THIS POINT.
  ========================= */

  if (!user) {
    return (
      <LoginPage
        onLogin={
          handleLogin
        }
      />
    );
  }

  if (
    privacyStatus ===
    "checking"
  ) {
    return (
      <div
        style={{
          minHeight:
            "100dvh",

          display:
            "flex",

          alignItems:
            "center",

          justifyContent:
            "center",

          background:
            "#0f172a",

          color:
            "white",

          fontFamily:
            "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            textAlign:
              "center",
          }}
        >
          <div
            style={{
              fontSize:
                "1.2rem",

              fontWeight:
                900,
            }}
          >
            BLCS
          </div>

          <div
            style={{
              marginTop:
                7,

              color:
                "#cbd5e1",

              fontSize:
                "0.82rem",
            }}
          >
            Verifying system access...
          </div>
        </div>
      </div>
    );
  }

  if (
    privacyStatus ===
    "required"
  ) {
    return (
      <PrivacyNoticePage
        user={
          user
        }
        saving={
          savingPrivacy
        }
        onAccept={
          handleAcceptPrivacy
        }
        onLogout={
          handleLogout
        }
      />
    );
  }

  /* =========================
     MAIN APPLICATION
  ========================= */

  return (
    <div
      className="app-container"
      style={{
        maxWidth:
          1100,

        margin:
          "0 auto",

        padding:
          16,
      }}
    >
      <VersionUpdateNotice />

      <header
        className="app-header"
        style={{
          marginBottom:
            16,
        }}
      >
        <h1
          style={{
            marginBottom:
              12,
          }}
        >
          Baggage Loading Control System
        </h1>

        <div
          style={{
            display:
              "flex",

            justifyContent:
              "space-between",

            alignItems:
              "flex-start",

            gap:
              16,

            flexWrap:
              "wrap",
          }}
        >
          <nav
            className="nav-buttons"
            style={{
              display:
                "flex",

              gap:
                8,

              flexWrap:
                "wrap",

              flex:
                "1 1 620px",
            }}
          >
            <button
              onClick={() =>
                goToView(
                  "dashboard"
                )
              }
            >
              Dashboard
            </button>

            <button
              onClick={() =>
                goToView(
                  "flights"
                )
              }
            >
              Flights
            </button>

            <button
              onClick={() =>
                goToView(
                  "counter"
                )
              }
              disabled={
                !selectedFlightId
              }
            >
              Counter Scan
            </button>

            <button
              onClick={() =>
                goToView(
                  "gate"
                )
              }
              disabled={
                !selectedFlightId
              }
            >
              Gate Controller
            </button>

            <button
              onClick={() =>
                goToView(
                  "bagroom"
                )
              }
              disabled={
                !selectedFlightId
              }
            >
              Bagroom
            </button>

            <button
              onClick={() =>
                goToView(
                  "aircraft"
                )
              }
              disabled={
                !selectedFlightId
              }
            >
              Aircraft
            </button>

            <button
              onClick={() =>
                goToView(
                  "tracking"
                )
              }
            >
              Baggage Tracking
            </button>

            <button
              onClick={() =>
                goToView(
                  "reports"
                )
              }
              disabled={
                !selectedFlightId
              }
            >
              Reports
            </button>

            {isStationManager && (
              <>
                <button
                  onClick={() =>
                    goToView(
                      "adminUsers"
                    )
                  }
                >
                  Admin Users
                </button>

                <button
                  onClick={() =>
                    goToView(
                      "privacyAcknowledgements"
                    )
                  }
                >
                  Privacy Ack
                </button>

                <button
                  onClick={() =>
                    goToView(
                      "systemMonitor"
                    )
                  }
                  style={{
                    border:
                      "1px solid #bfdbfe",

                    background:
                      "#eff6ff",

                    color:
                      "#1d4ed8",

                    fontWeight:
                      800,
                  }}
                >
                  System Monitor
                </button>

                <button
                  onClick={() =>
                    goToView(
                      "monthlyCleanup"
                    )
                  }
                  style={{
                    border:
                      "1px solid #fecaca",

                    background:
                      "#fff7f7",

                    color:
                      "#b91c1c",

                    fontWeight:
                      800,
                  }}
                >
                  Monthly Cleanup
                </button>
              </>
            )}
          </nav>

          {/* =========================
              USER PROFILE
          ========================= */}

          <div
            style={{
              display:
                "flex",

              flexDirection:
                "column",

              alignItems:
                "flex-end",

              gap:
                8,

              minWidth:
                225,
            }}
          >
            <div
              style={{
                textAlign:
                  "right",

                lineHeight:
                  1.25,
              }}
            >
              <div
                style={{
                  fontSize:
                    "0.95rem",

                  color:
                    "#0f172a",

                  fontWeight:
                    900,
                }}
              >
                {displayName}
              </div>

              <div
                style={{
                  marginTop:
                    3,

                  fontSize:
                    "0.72rem",

                  color:
                    "#64748b",
                }}
              >
                @{user?.username} -{" "}
                {roleLabel}
              </div>

              {activeOperationalPosition && (
                <div
                  style={{
                    display:
                      "inline-flex",

                    marginTop:
                      6,

                    padding:
                      "5px 9px",

                    borderRadius:
                      999,

                    background:
                      "#eff6ff",

                    border:
                      "1px solid #bfdbfe",

                    color:
                      "#1d4ed8",

                    fontSize:
                      "0.72rem",

                    fontWeight:
                      900,
                  }}
                >
                  Working as:{" "}
                  {
                    activeOperationalPositionLabel
                  }
                </div>
              )}

              {gateControllerOnDuty &&
                activeOperationalPosition !==
                  "GATE_CONTROLLER" && (
                  <div
                    style={{
                      marginTop:
                        5,

                      fontSize:
                        "0.72rem",

                      color:
                        "#475569",
                    }}
                  >
                    Gate Controller:{" "}
                    <strong>
                      {
                        gateControllerOnDuty
                      }
                    </strong>
                  </div>
                )}
            </div>

            <div
              style={{
                display:
                  "flex",

                gap:
                  7,

                justifyContent:
                  "flex-end",

                flexWrap:
                  "wrap",
              }}
            >
              <button
                type="button"
                onClick={
                  handleSoftRefresh
                }
                title="Refresh current page"
                style={{
                  display:
                    "inline-flex",

                  alignItems:
                    "center",

                  justifyContent:
                    "center",

                  gap:
                    6,

                  minHeight:
                    37,

                  padding:
                    "7px 12px",

                  borderRadius:
                    10,

                  border:
                    "1px solid #cbd5e1",

                  background:
                    "white",

                  color:
                    "#334155",

                  fontWeight:
                    800,

                  fontSize:
                    "0.78rem",

                  cursor:
                    "pointer",

                  boxShadow:
                    "0 1px 3px rgba(15,23,42,0.06)",
                }}
              >
                Refresh
              </button>

              <button
                type="button"
                onClick={
                  handleLogout
                }
                title="Sign out"
                style={{
                  display:
                    "inline-flex",

                  alignItems:
                    "center",

                  justifyContent:
                    "center",

                  gap:
                    6,

                  minHeight:
                    37,

                  padding:
                    "7px 12px",

                  borderRadius:
                    10,

                  border:
                    "1px solid #fecaca",

                  background:
                    "#fff7f7",

                  color:
                    "#b91c1c",

                  fontWeight:
                    800,

                  fontSize:
                    "0.78rem",

                  cursor:
                    "pointer",
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* =========================
            SELECTED FLIGHT
        ========================= */}

        {selectedFlightId && (
          <div
            style={{
              marginTop:
                12,

              display:
                "inline-flex",

              alignItems:
                "center",

              gap:
                6,

              padding:
                "6px 10px",

              borderRadius:
                10,

              background:
                "#eff6ff",

              border:
                "1px solid #dbeafe",

              color:
                "#1e40af",

              fontSize:
                "0.82rem",
            }}
          >
            <strong>
              Flight selected:
            </strong>

            <span
              style={{
                fontWeight:
                  900,
              }}
            >
              {selectedFlightNumber ||
                selectedFlightId}
            </span>
          </div>
        )}
      </header>

      {/* =========================
          CURRENT PAGE
      ========================= */}

      <main
        key={
          refreshKey
        }
      >
        {renderView()}
      </main>
    </div>
  );
}

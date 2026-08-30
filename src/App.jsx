// src/App.jsx
import { useEffect, useState } from "react";

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

import DashboardPage from "./pages/DashboardPage.jsx";
import FlightsPage from "./pages/FlightsPage.jsx";
import GateControllerPage from "./pages/GateControllerPage.jsx";
import BagroomScanPage from "./pages/BagroomScanPage.jsx";
import AircraftScanPage from "./pages/AircraftScanPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import AdminUsersPage from "./pages/AdminUsersPage.jsx";
import CounterScanPage from "./pages/CounterScanPage.jsx";
import BaggageTrackingPage from "./pages/BaggageTrackingPage.jsx";

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function getSessionJson(key, fallback = null) {
  try {
    const saved = sessionStorage.getItem(key);

    return saved
      ? JSON.parse(saved)
      : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [user, setUser] = useState(() =>
    getSessionJson("blcsUser", null)
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

  const [refreshKey, setRefreshKey] =
    useState(0);

  const [
    privacyStatus,
    setPrivacyStatus,
  ] = useState(
    user ? "checking" : "accepted"
  );

  const [
    savingPrivacy,
    setSavingPrivacy,
  ] = useState(false);

  /* =========================
     CHECK PRIVACY CONSENT
  ========================= */

  useEffect(() => {
    if (!user?.id) {
      setPrivacyStatus("accepted");
      return;
    }

    let active = true;

    const checkPrivacy = async () => {
      setPrivacyStatus("checking");

      try {
        const userRef = doc(
          db,
          "users",
          user.id
        );

        const snap =
          await getDoc(userRef);

        if (!active) return;

        if (!snap.exists()) {
          setPrivacyStatus("required");
          return;
        }

        const data = snap.data();

        const accepted =
          data?.privacyConsent
            ?.accepted === true;

        const version = String(
          data?.privacyConsent
            ?.version || ""
        );

        if (
          accepted &&
          version ===
            PRIVACY_NOTICE_VERSION
        ) {
          setPrivacyStatus("accepted");
        } else {
          setPrivacyStatus("required");
        }
      } catch (error) {
        console.error(
          "Privacy consent check error:",
          error
        );

        if (active) {
          setPrivacyStatus("required");
        }
      }
    };

    checkPrivacy();

    return () => {
      active = false;
    };
  }, [user?.id]);

  /* =========================
     LOGIN
  ========================= */

  const handleLogin = (
    userData,
    sessionMeta
  ) => {
    const gc =
      sessionMeta
        ?.gateControllerUsername ||
      null;

    setUser(userData);
    setGateControllerOnDuty(gc);

    setCurrentView("dashboard");

    setSelectedFlightId(null);
    setSelectedFlightNumber(null);

    setPrivacyStatus("checking");

    sessionStorage.setItem(
      "blcsUser",
      JSON.stringify(userData)
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
      if (!user?.id) return;

      try {
        setSavingPrivacy(true);

        const userRef = doc(
          db,
          "users",
          user.id
        );

        await setDoc(
          userRef,
          {
            privacyConsent: {
              accepted: true,
              version:
                PRIVACY_NOTICE_VERSION,
              acceptedAt:
                serverTimestamp(),
              acceptedBy: {
                userId: user.id,
                username:
                  user.username || null,
                role:
                  user.role || null,
              },
            },
          },
          {
            merge: true,
          }
        );

        setPrivacyStatus("accepted");
      } catch (error) {
        console.error(
          "Privacy acceptance error:",
          error
        );

        window.alert(
          "Unable to save your acceptance. Please check your connection and try again."
        );
      } finally {
        setSavingPrivacy(false);
      }
    };

  /* =========================
     LOGOUT
  ========================= */

  const handleLogout = () => {
    sessionStorage.clear();

    setUser(null);

    setGateControllerOnDuty(null);

    setSelectedFlightId(null);

    setSelectedFlightNumber(null);

    setCurrentView("dashboard");

    setRefreshKey(0);

    setPrivacyStatus("accepted");
  };

  /* =========================
     LOGIN SCREEN
  ========================= */

  if (!user) {
    return (
      <LoginPage
        onLogin={handleLogin}
      />
    );
  }

  /* =========================
     PRIVACY CHECK
  ========================= */

  if (privacyStatus === "checking") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "white",
          fontFamily:
            "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: "1.2rem",
              fontWeight: 900,
            }}
          >
            BLCS
          </div>

          <div
            style={{
              marginTop: 7,
              color: "#cbd5e1",
              fontSize: "0.82rem",
            }}
          >
            Verifying system access...
          </div>
        </div>
      </div>
    );
  }

  if (privacyStatus === "required") {
    return (
      <PrivacyNoticePage
        user={user}
        saving={savingPrivacy}
        onAccept={
          handleAcceptPrivacy
        }
        onLogout={handleLogout}
      />
    );
  }

  /* =========================
     USER / PERMISSIONS
  ========================= */

  const role = normalizeRole(
    user.role
  );

  const displayName =
    user?.fullName ||
    user?.name ||
    user?.displayName ||
    user?.username ||
    "User";

  const roleLabel = String(
    user?.role || "user"
  )
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );

  const isStationManager =
    role === "station_manager";

  const canCreateFlights =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "supervisor" ||
    role === "gate_controller";

  const canEditGateTotals =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "supervisor" ||
    role === "gate_controller";

  /* =========================
     NAVIGATION
  ========================= */

  const goToView = (view) => {
    setCurrentView(view);

    sessionStorage.setItem(
      "currentView",
      view
    );
  };

  const selectFlight = (
    flightId
  ) => {
    setSelectedFlightId(flightId);

    sessionStorage.setItem(
      "selectedFlightId",
      flightId
    );
  };

  const handleSoftRefresh = () => {
    setRefreshKey(
      (prev) => prev + 1
    );
  };

  const handleOpenFlightFromDashboard =
    (
      flightId,
      targetView,
      flightNumber
    ) => {
      setSelectedFlightId(
        flightId
      );

      setSelectedFlightNumber(
        flightNumber || null
      );

      setCurrentView(targetView);

      sessionStorage.setItem(
        "selectedFlightId",
        flightId
      );

      sessionStorage.setItem(
        "currentView",
        targetView
      );

      if (flightNumber) {
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

  const renderView = () => {
    if (
      currentView === "dashboard"
    ) {
      return (
        <DashboardPage
          user={user}
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
      currentView === "flights"
    ) {
      return (
        <FlightsPage
          user={user}
          canCreateFlights={
            canCreateFlights
          }
          onFlightSelected={(
            flightId
          ) =>
            selectFlight(
              flightId
            )
          }
        />
      );
    }

    if (
      currentView === "tracking"
    ) {
      return (
        <BaggageTrackingPage
          user={user}
        />
      );
    }

    if (
      currentView === "adminUsers"
    ) {
      return (
        <AdminUsersPage
          user={user}
        />
      );
    }

    if (!selectedFlightId) {
      return (
        <div
          style={{
            padding: 20,
            background: "white",
            borderRadius: 14,
            border:
              "1px solid #e5e7eb",
            color: "#64748b",
          }}
        >
          Please select a flight first.
        </div>
      );
    }

    if (
      currentView === "counter"
    ) {
      return (
        <CounterScanPage
          flightId={
            selectedFlightId
          }
          user={user}
        />
      );
    }

    if (
      currentView === "gate"
    ) {
      return (
        <GateControllerPage
          flightId={
            selectedFlightId
          }
          user={user}
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
      currentView === "bagroom"
    ) {
      return (
        <BagroomScanPage
          flightId={
            selectedFlightId
          }
          user={user}
        />
      );
    }

    if (
      currentView === "aircraft"
    ) {
      return (
        <AircraftScanPage
          flightId={
            selectedFlightId
          }
          user={user}
        />
      );
    }

    if (
      currentView === "reports"
    ) {
      return (
        <ReportsPage
          flightId={
            selectedFlightId
          }
          user={user}
        />
      );
    }

    return null;
  };

  /* =========================
     APP
  ========================= */

  return (
    <div
      className="app-container"
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: 16,
      }}
    >
      <header
        className="app-header"
        style={{
          marginBottom: 16,
        }}
      >
        <h1
          style={{
            marginBottom: 12,
          }}
        >
          Baggage Loading Control System
        </h1>

        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <nav
            className="nav-buttons"
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              flex: "1 1 620px",
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
                goToView("flights")
              }
            >
              Flights
            </button>

            <button
              onClick={() =>
                goToView("counter")
              }
              disabled={
                !selectedFlightId
              }
            >
              Counter Scan
            </button>

            <button
              onClick={() =>
                goToView("gate")
              }
              disabled={
                !selectedFlightId
              }
            >
              Gate Controller
            </button>

            <button
              onClick={() =>
                goToView("bagroom")
              }
              disabled={
                !selectedFlightId
              }
            >
              Bagroom
            </button>

            <button
              onClick={() =>
                goToView("aircraft")
              }
              disabled={
                !selectedFlightId
              }
            >
              Aircraft
            </button>

            <button
              onClick={() =>
                goToView("tracking")
              }
            >
              Baggage Tracking
            </button>

            <button
              onClick={() =>
                goToView("reports")
              }
              disabled={
                !selectedFlightId
              }
            >
              Reports
            </button>

            {isStationManager && (
              <button
                onClick={() =>
                  goToView(
                    "adminUsers"
                  )
                }
              >
                Admin Users
              </button>
            )}
          </nav>

          {/* USER PROFILE */}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 8,
              minWidth: 205,
            }}
          >
            <div
              style={{
                textAlign: "right",
                lineHeight: 1.25,
              }}
            >
              <div
                style={{
                  fontSize: "0.95rem",
                  color: "#0f172a",
                  fontWeight: 900,
                }}
              >
                {displayName}
              </div>

              <div
                style={{
                  marginTop: 3,
                  fontSize: "0.72rem",
                  color: "#64748b",
                }}
              >
                @{user?.username} ·{" "}
                {roleLabel}
              </div>

              {gateControllerOnDuty &&
                role !==
                  "gate_controller" && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: "0.72rem",
                      color: "#475569",
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
                display: "flex",
                gap: 7,
                justifyContent:
                  "flex-end",
                flexWrap: "wrap",
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
                  alignItems: "center",
                  justifyContent:
                    "center",
                  gap: 6,
                  minHeight: 37,
                  padding: "7px 12px",
                  borderRadius: 10,
                  border:
                    "1px solid #cbd5e1",
                  background: "white",
                  color: "#334155",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  boxShadow:
                    "0 1px 3px rgba(15,23,42,0.06)",
                }}
              >
                <span
                  style={{
                    fontSize: "1rem",
                  }}
                >
                  ↻
                </span>

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
                  alignItems: "center",
                  justifyContent:
                    "center",
                  gap: 6,
                  minHeight: 37,
                  padding: "7px 12px",
                  borderRadius: 10,
                  border:
                    "1px solid #fecaca",
                  background: "#fff7f7",
                  color: "#b91c1c",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontSize: "0.95rem",
                  }}
                >
                  ↪
                </span>

                Logout
              </button>
            </div>
          </div>
        </div>

        {selectedFlightId && (
          <div
            style={{
              marginTop: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 10,
              background: "#eff6ff",
              border:
                "1px solid #dbeafe",
              color: "#1e40af",
              fontSize: "0.82rem",
            }}
          >
            <span>
              ✈
            </span>

            <strong>
              Flight selected:
            </strong>

            <span
              style={{
                fontWeight: 900,
              }}
            >
              {selectedFlightNumber ||
                selectedFlightId}
            </span>
          </div>
        )}
      </header>

      <main key={refreshKey}>
        {renderView()}
      </main>
    </div>
  );
}

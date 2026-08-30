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

function getSessionJson(
  key,
  fallback = null
) {
  try {
    const saved =
      sessionStorage.getItem(key);

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

  /*
   * Privacy state:
   *
   * checking  -> checking Firestore
   * required  -> user must accept
   * accepted  -> continue to BLCS
   */
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

        const version =
          String(
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

        /*
         * Safer behavior:
         * don't enter the operational
         * system until consent can be
         * verified.
         */
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
              fontWeight: 800,
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
     PERMISSIONS
  ========================= */

  const role = normalizeRole(
    user.role
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
        <p>
          Please select a flight
          first.
        </p>
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
        <h1>
          Baggage Loading Control
          System
        </h1>

        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <nav
            className="nav-buttons"
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
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

          <div
            style={{
              textAlign: "right",
            }}
          >
            <div
              style={{
                fontSize:
                  "0.85rem",
              }}
            >
              Logged in as{" "}
              <strong>
                {user.username}
              </strong>

              {user.role && (
                <> ({user.role})</>
              )}
            </div>

            {gateControllerOnDuty &&
              role !==
                "gate_controller" && (
                <div
                  style={{
                    fontSize:
                      "0.85rem",
                    marginTop: 2,
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

            <button
              onClick={
                handleSoftRefresh
              }
              style={{
                marginTop: 6,
                marginRight: 6,
              }}
            >
              Refresh
            </button>

            <button
              onClick={
                handleLogout
              }
              style={{
                marginTop: 6,
              }}
            >
              Logout
            </button>
          </div>
        </div>

        {selectedFlightId && (
          <p
            style={{
              marginTop: 8,
            }}
          >
            <strong>
              Flight selected:
            </strong>{" "}
            {selectedFlightNumber ||
              selectedFlightId}
          </p>
        )}
      </header>

      <main key={refreshKey}>
        {renderView()}
      </main>
    </div>
  );
}

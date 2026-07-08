// src/App.jsx
import { useState } from "react";
import LoginPage from "./pages/LoginPage.jsx";
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
  return String(role || "").trim().toLowerCase();
}

function getSessionJson(key, fallback = null) {
  try {
    const saved = sessionStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [user, setUser] = useState(() => getSessionJson("blcsUser", null));

  const [gateControllerOnDuty, setGateControllerOnDuty] = useState(() => {
    return sessionStorage.getItem("gateControllerOnDuty") || null;
  });

  const [currentView, setCurrentView] = useState(() => {
    return sessionStorage.getItem("currentView") || "dashboard";
  });

  const [selectedFlightId, setSelectedFlightId] = useState(() => {
    return sessionStorage.getItem("selectedFlightId") || null;
  });

  const [refreshKey, setRefreshKey] = useState(0);

  const handleLogin = (userData, sessionMeta) => {
    const gc = sessionMeta?.gateControllerUsername || null;

    setUser(userData);
    setGateControllerOnDuty(gc);
    setCurrentView("dashboard");

    sessionStorage.setItem("blcsUser", JSON.stringify(userData));

    if (gc) {
      sessionStorage.setItem("gateControllerOnDuty", gc);
    } else {
      sessionStorage.removeItem("gateControllerOnDuty");
    }

    sessionStorage.setItem("currentView", "dashboard");
  };

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const role = normalizeRole(user.role);
  const isStationManager = role === "station_manager";

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

  const goToView = (view) => {
    setCurrentView(view);
    sessionStorage.setItem("currentView", view);
  };

  const selectFlight = (flightId) => {
    setSelectedFlightId(flightId);
    sessionStorage.setItem("selectedFlightId", flightId);
  };

  const handleSoftRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleLogout = () => {
    sessionStorage.clear();

    setUser(null);
    setGateControllerOnDuty(null);
    setSelectedFlightId(null);
    setCurrentView("dashboard");
    setRefreshKey(0);
  };

  const handleOpenFlightFromDashboard = (flightId, targetView) => {
    setSelectedFlightId(flightId);
    setCurrentView(targetView);

    sessionStorage.setItem("selectedFlightId", flightId);
    sessionStorage.setItem("currentView", targetView);
  };

  const renderView = () => {
    if (currentView === "dashboard") {
      return (
        <DashboardPage
          user={user}
          onOpenFlight={handleOpenFlightFromDashboard}
          gateControllerOnDuty={gateControllerOnDuty}
        />
      );
    }

    if (currentView === "flights") {
      return (
        <FlightsPage
          user={user}
          canCreateFlights={canCreateFlights}
          onFlightSelected={(flightId) => selectFlight(flightId)}
        />
      );
    }

    if (currentView === "tracking") {
      return <BaggageTrackingPage user={user} />;
    }

    if (currentView === "adminUsers") {
      return <AdminUsersPage user={user} />;
    }

    if (!selectedFlightId) {
      return <p>Please select a flight first.</p>;
    }

    if (currentView === "counter") {
      return <CounterScanPage flightId={selectedFlightId} user={user} />;
    }

    if (currentView === "gate") {
      return (
        <GateControllerPage
          flightId={selectedFlightId}
          user={user}
          gateControllerOnDuty={gateControllerOnDuty}
          canEdit={canEditGateTotals}
        />
      );
    }

    if (currentView === "bagroom") {
      return <BagroomScanPage flightId={selectedFlightId} user={user} />;
    }

    if (currentView === "aircraft") {
      return <AircraftScanPage flightId={selectedFlightId} user={user} />;
    }

    if (currentView === "reports") {
      return <ReportsPage flightId={selectedFlightId} user={user} />;
    }

    return null;
  };

  return (
    <div className="app-container" style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <header className="app-header" style={{ marginBottom: 16 }}>
        <h1>Baggage Loading Control System</h1>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <nav className="nav-buttons" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => goToView("dashboard")}>Dashboard</button>

            <button onClick={() => goToView("flights")}>Flights</button>

            <button onClick={() => goToView("counter")} disabled={!selectedFlightId}>
              Counter Scan
            </button>

            <button onClick={() => goToView("gate")} disabled={!selectedFlightId}>
              Gate Controller
            </button>

            <button onClick={() => goToView("bagroom")} disabled={!selectedFlightId}>
              Bagroom
            </button>

            <button onClick={() => goToView("aircraft")} disabled={!selectedFlightId}>
              Aircraft
            </button>

            <button onClick={() => goToView("tracking")}>
              Baggage Tracking
            </button>

            <button onClick={() => goToView("reports")} disabled={!selectedFlightId}>
              Reports
            </button>

            {isStationManager && (
              <button onClick={() => goToView("adminUsers")}>Admin Users</button>
            )}
          </nav>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.85rem" }}>
              Logged in as <strong>{user.username}</strong>
              {user.role && <> ({user.role})</>}
            </div>

            {gateControllerOnDuty && role !== "gate_controller" && (
              <div style={{ fontSize: "0.85rem", marginTop: 2 }}>
                Gate Controller: <strong>{gateControllerOnDuty}</strong>
              </div>
            )}

            <button onClick={handleSoftRefresh} style={{ marginTop: 6, marginRight: 6 }}>
              Refresh
            </button>

            <button onClick={handleLogout} style={{ marginTop: 6 }}>
              Logout
            </button>
          </div>
        </div>

        {selectedFlightId && (
          <p style={{ marginTop: 8 }}>
            <strong>Flight selected:</strong> {selectedFlightId}
          </p>
        )}
      </header>

      <main key={refreshKey}>{renderView()}</main>
    </div>
  );
}

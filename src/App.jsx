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

export default function App() {
  const [user, setUser] = useState(null);
  const [gateControllerOnDuty, setGateControllerOnDuty] = useState(null);
  const [currentView, setCurrentView] = useState("dashboard");
  const [selectedFlightId, setSelectedFlightId] = useState(null);

  const handleLogin = (userData, sessionMeta) => {
    setUser(userData);
    setGateControllerOnDuty(sessionMeta?.gateControllerUsername || null);
    setCurrentView("dashboard");
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

  const handleLogout = () => {
    setUser(null);
    setGateControllerOnDuty(null);
    setSelectedFlightId(null);
    setCurrentView("dashboard");
  };

  const handleOpenFlightFromDashboard = (flightId, targetView) => {
    setSelectedFlightId(flightId);
    setCurrentView(targetView);
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
          onFlightSelected={(flightId) => setSelectedFlightId(flightId)}
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
            <button onClick={() => setCurrentView("dashboard")}>Dashboard</button>

            <button onClick={() => setCurrentView("flights")}>Flights</button>

            <button onClick={() => setCurrentView("counter")} disabled={!selectedFlightId}>
              Counter Scan
            </button>

            <button onClick={() => setCurrentView("gate")} disabled={!selectedFlightId}>
              Gate Controller
            </button>

            <button onClick={() => setCurrentView("bagroom")} disabled={!selectedFlightId}>
              Bagroom
            </button>

            <button onClick={() => setCurrentView("aircraft")} disabled={!selectedFlightId}>
              Aircraft
            </button>

            <button onClick={() => setCurrentView("tracking")}>
              Baggage Tracking
            </button>

            <button onClick={() => setCurrentView("reports")} disabled={!selectedFlightId}>
              Reports
            </button>

            {isStationManager && (
              <button onClick={() => setCurrentView("adminUsers")}>Admin Users</button>
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

      <main>{renderView()}</main>
    </div>
  );
}

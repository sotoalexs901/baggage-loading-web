// src/App.jsx
import { useState } from "react";
import LoginPage from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import FlightsPage from "./pages/FlightsPage.jsx";
import GateControllerPage from "./pages/GateControllerPage.jsx"; // 👈 renombrado
import BagroomScanPage from "./pages/BagroomScanPage.jsx";
import AircraftScanPage from "./pages/AircraftScanPage.jsx";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

export default function App() {
  const [user, setUser] = useState(null);

  // Gate Controller asignado para el turno (seleccionado por supervisor/manager al login)
  const [gateControllerOnDuty, setGateControllerOnDuty] = useState(null);

  const [currentView, setCurrentView] = useState("dashboard");
  const [selectedFlightId, setSelectedFlightId] = useState(null);

  // ✅ Nuevo: Login puede mandar user + meta del turno (gateControllerOnDuty)
  const handleLogin = (userData, sessionMeta) => {
    setUser(userData);
    setGateControllerOnDuty(sessionMeta?.gateControllerUsername || null);
    setCurrentView("dashboard");
  };

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const role = normalizeRole(user.role);
  const isGateController = role === "gate_controller";
  const canCreateFlights = role === "station_manager" || role === "duty_manager";
  const canEditGateTotals =
    role === "station_manager" || role === "duty_manager" || role === "supervisor";

  // Gate Controller: solo ver Gate Controller + Aircraft (y Dashboard)
  const canSeeDashboard = true;
  const canSeeFlights = !isGateController; // si quieres que gate_controller también pueda seleccionar vuelo, cámbialo a true
  const canSeeGate = true;
  const canSeeBagroom = !isGateController;
  const canSeeAircraft = true;

  const handleLogout = () => {
    setUser(null);
    setGateControllerOnDuty(null);
    setSelectedFlightId(null);
    setCurrentView("dashboard");
  };

  const handleOpenFlightFromDashboard = (flightId, targetView) => {
    setSelectedFlightId(flightId);

    // Por seguridad: si gate_controller intenta ir a flights/bagroom, lo bloqueamos
    if (isGateController && (targetView === "flights" || targetView === "bagroom")) {
      setCurrentView("gate");
      return;
    }

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
          canCreateFlights={canCreateFlights} // 👈 opcional si lo quieres usar dentro de FlightsPage
          onFlightSelected={(flightId) => {
            setSelectedFlightId(flightId);
            setCurrentView("gate"); // 👈 ahora va a Gate Controller
          }}
        />
      );
    }

    if (!selectedFlightId) {
      return <p>Please select a flight first.</p>;
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
            {canSeeDashboard && <button onClick={() => setCurrentView("dashboard")}>Dashboard</button>}
            {canSeeFlights && <button onClick={() => setCurrentView("flights")}>Flights</button>}

            {canSeeGate && (
              <button onClick={() => setCurrentView("gate")} disabled={!selectedFlightId}>
                Gate Controller
              </button>
            )}

            {canSeeBagroom && (
              <button onClick={() => setCurrentView("bagroom")} disabled={!selectedFlightId}>
                Bagroom
              </button>
            )}

            {canSeeAircraft && (
              <button onClick={() => setCurrentView("aircraft")} disabled={!selectedFlightId}>
                Aircraft
              </button>
            )}
          </nav>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.85rem" }}>
              Logged in as <strong>{user.username}</strong>
              {user.role && <> ({user.role})</>}
            </div>

            {gateControllerOnDuty && !isGateController && (
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

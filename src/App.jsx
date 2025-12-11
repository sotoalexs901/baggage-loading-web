
// src/App.jsx
import { useState } from "react";
import LoginPage from "./pages/LoginPage.jsx";
import FlightsPage from "./pages/FlightsPage.jsx";
import CounterPage from "./pages/CounterPage.jsx";
import BagroomScanPage from "./pages/BagroomScanPage.jsx";
import AircraftScanPage from "./pages/AircraftScanPage.jsx";

export default function App() {
  // Usuario que viene de Firestore (users collection)
  const [user, setUser] = useState(null);

  const [currentView, setCurrentView] = useState("flights");
  const [selectedFlightId, setSelectedFlightId] = useState(null);

  if (!user) {
    // Mientras no haya user, mostramos solo Login
    return <LoginPage onLogin={setUser} />;
  }

  const handleLogout = () => {
    setUser(null);
    setSelectedFlightId(null);
    setCurrentView("flights");
  };

  const renderView = () => {
    if (currentView === "flights") {
      return (
        <FlightsPage
          onFlightSelected={(flightId) => {
            setSelectedFlightId(flightId);
            setCurrentView("counter");
          }}
        />
      );
    }

    if (!selectedFlightId) {
      return <p>Please select a flight first.</p>;
    }

    if (currentView === "counter") {
      return <CounterPage flightId={selectedFlightId} user={user} />;
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
    <div className="app-container" style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
      <header className="app-header" style={{ marginBottom: 16 }}>
        <h1>Baggage Loading Control System</h1>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <nav className="nav-buttons" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setCurrentView("flights")}>Flights</button>
            <button onClick={() => setCurrentView("counter")} disabled={!selectedFlightId}>
              Counter
            </button>
            <button onClick={() => setCurrentView("bagroom")} disabled={!selectedFlightId}>
              Bagroom
            </button>
            <button onClick={() => setCurrentView("aircraft")} disabled={!selectedFlightId}>
              Aircraft
            </button>
          </nav>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.85rem" }}>
              Logged in as <strong>{user.username}</strong> (PIN {user.pin})
            </div>
            <button onClick={handleLogout} style={{ marginTop: 4 }}>
              Logout
            </button>
          </div>
        </div>

        {selectedFlightId && (
          <p>
            <strong>Flight selected:</strong> {selectedFlightId}
          </p>
        )}
      </header>

      <main>{renderView()}</main>
    </div>
  );
}

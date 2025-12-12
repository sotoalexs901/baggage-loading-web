// src/pages/DashboardPage.jsx
import React from "react";

export default function DashboardPage({ user, onOpenFlight }) {
  const flights = [
    {
      id: "FLIGHT_SY214_1",
      flightNumber: "SY214",
      route: "TPA → MSP",
      date: "2025-01-15",
      gate: "E68",
      aircraftType: "B737-800",
      status: "OPEN",
    },
    {
      id: "FLIGHT_SY300_1",
      flightNumber: "SY300",
      route: "TPA → LAS",
      date: "2025-01-15",
      gate: "E70",
      aircraftType: "B737-800",
      status: "OPEN",
    },
  ];

  return (
    <div className="dash-root">
      {/* Top: welcome + quick info */}
      <section className="dash-header-card">
        <div>
          <p className="dash-greeting">Welcome back,</p>
          <h2 className="dash-title">{user.username}</h2>
          {user.role && (
            <span className="dash-role-pill">
              {user.role.replace("_", " ")}
            </span>
          )}
          <p className="dash-subtitle">
            Select a flight to start working on Counter, Bagroom or Aircraft loading.
          </p>
        </div>

        <div className="dash-summary-box">
          <p className="dash-summary-label">Today&apos;s overview</p>
          <p className="dash-summary-number">{flights.length}</p>
          <p className="dash-summary-caption">active flights in TPA</p>
        </div>
      </section>

      {/* Middle: helper cards */}
      <section className="dash-grid">
        <div className="dash-card">
          <h3>Counter</h3>
          <p>
            Enter the total number of checked bags per flight. This becomes the
            reference for Bagroom and Aircraft.
          </p>
          <ul className="dash-list">
            <li>Set checked bag count</li>
            <li>View who entered the numbers</li>
            <li>See current flight status</li>
          </ul>
        </div>

        <div className="dash-card">
          <h3>Bagroom</h3>
          <p>
            Scan every bag received in Bagroom to make sure all checked bags
            reach the aircraft.
          </p>
          <ul className="dash-list">
            <li>Real-time bag count</li>
            <li>Match against Counter total</li>
            <li>Detect missing bags early</li>
          </ul>
        </div>

        <div className="dash-card">
          <h3>Aircraft</h3>
          <p>
            Scan bags as they are loaded in each aircraft zone to confirm final
            loading before departure.
          </p>
          <ul className="dash-list">
            <li>Track by zone (1–4)</li>
            <li>Compare vs Counter total</li>
            <li>“Loading completed” check</li>
          </ul>
        </div>
      </section>

      {/* Flights table */}
      <section className="dash-section">
        <div className="dash-section-header">
          <h3>Today&apos;s flights</h3>
          <p>Choose a flight and go directly to the area where you are working.</p>
        </div>

        <div className="dash-table-wrapper">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Flight</th>
                <th>Route</th>
                <th>Date</th>
                <th>Gate</th>
                <th>Aircraft</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <tr key={f.id}>
                  <td>{f.flightNumber}</td>
                  <td>{f.route}</td>
                  <td>{f.date}</td>
                  <td>{f.gate}</td>
                  <td>{f.aircraftType}</td>
                  <td>
                    <span className="dash-status-pill dash-status-open">
                      {f.status}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="dash-actions">
                      <button
                        className="btn-secondary"
                        onClick={() => onOpenFlight(f.id, "counter")}
                      >
                        Counter
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => onOpenFlight(f.id, "bagroom")}
                      >
                        Bagroom
                      </button>
                      <button
                        className="btn-primary"
                        onClick={() => onOpenFlight(f.id, "aircraft")}
                      >
                        Aircraft
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {flights.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", fontStyle: "italic" }}>
                    No flights loaded yet for today.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

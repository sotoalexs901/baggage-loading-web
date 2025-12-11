// src/pages/DashboardPage.jsx
import React from "react";

export default function DashboardPage({ user, onOpenFlight }) {
  // Más adelante esto vendrá de Firestore.
  const dummyFlights = [
    {
      id: "FLIGHT_SY214_1",
      flightNumber: "SY214",
      date: "2025-01-15",
      gate: "E68",
      aircraftType: "B737-800",
    },
    {
      id: "FLIGHT_SY300_1",
      flightNumber: "SY300",
      date: "2025-01-15",
      gate: "E70",
      aircraftType: "B737-800",
    },
  ];

  return (
    <div>
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 4 }}>Dashboard</h2>
        <p style={{ margin: 0 }}>
          Welcome, <strong>{user.username}</strong>{" "}
          {user.role && <span style={{ fontSize: "0.9rem" }}>({user.role})</span>}
        </p>
        <p style={{ marginTop: 4, fontSize: "0.9rem", color: "#4b5563" }}>
          Baggage Loading Control · TPA
        </p>
      </section>

      <section>
        <h3 style={{ marginBottom: 8 }}>Today's flights</h3>
        <p style={{ fontSize: "0.9rem", color: "#4b5563", marginBottom: 8 }}>
          Select a flight to start working in Counter, Bagroom or Aircraft.
        </p>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.9rem",
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 6 }}>
                Flight
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 6 }}>
                Date
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 6 }}>
                Gate
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 6 }}>
                Aircraft
              </th>
              <th style={{ borderBottom: "1px solid #e5e7eb", padding: 6 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {dummyFlights.map((f) => (
              <tr key={f.id}>
                <td style={{ padding: 6 }}>{f.flightNumber}</td>
                <td style={{ padding: 6 }}>{f.date}</td>
                <td style={{ padding: 6 }}>{f.gate}</td>
                <td style={{ padding: 6 }}>{f.aircraftType}</td>
                <td style={{ padding: 6 }}>
                  <button
                    style={{ marginRight: 4 }}
                    onClick={() => onOpenFlight(f.id, "counter")}
                  >
                    Counter
                  </button>
                  <button
                    style={{ marginRight: 4 }}
                    onClick={() => onOpenFlight(f.id, "bagroom")}
                  >
                    Bagroom
                  </button>
                  <button onClick={() => onOpenFlight(f.id, "aircraft")}>
                    Aircraft
                  </button>
                </td>
              </tr>
            ))}

            {dummyFlights.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 6, fontStyle: "italic" }}>
                  No flights loaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

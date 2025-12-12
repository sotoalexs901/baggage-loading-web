// src/pages/DashboardPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function getTodayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ✅ Status helpers (OPEN / RECEIVING / LOADING / LOADED)
const STATUS_COLORS = {
  OPEN: { bg: "#FEF3C7", text: "#92400E", border: "#F59E0B" },      // amarillo
  RECEIVING: { bg: "#DBEAFE", text: "#1E3A8A", border: "#60A5FA" }, // azul suave
  LOADING: { bg: "#FFEDD5", text: "#9A3412", border: "#FB923C" },   // naranja
  LOADED: { bg: "#DCFCE7", text: "#166534", border: "#22C55E" },    // verde
};

function normalizeStatus(s) {
  const v = String(s || "OPEN").trim().toUpperCase();
  return v === "OPEN" || v === "RECEIVING" || v === "LOADING" || v === "LOADED" ? v : "OPEN";
}

function StatusPill({ status }) {
  const st = normalizeStatus(status);
  const c = STATUS_COLORS[st] || STATUS_COLORS.OPEN;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 12px",
        borderRadius: 999,
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.text,
        fontWeight: 900,
        letterSpacing: "0.04em",
        fontSize: "0.75rem",
      }}
    >
      {st === "RECEIVING" ? "RECEIVING BAGS" : st}
    </span>
  );
}

export default function DashboardPage({ user, onOpenFlight, gateControllerOnDuty }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);
  const isGateController = role === "gate_controller";

  const today = useMemo(() => getTodayYYYYMMDD(), []);
  const [selectedDate, setSelectedDate] = useState(today);

  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(true);

  // Carga de vuelos reales por fecha
  useEffect(() => {
    setLoading(true);

    const q = query(
      collection(db, "flights"),
      where("flightDate", "==", selectedDate),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setFlights(rows);
        setLoading(false);
      },
      (err) => {
        console.error("Dashboard flights error:", err);
        setFlights([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [selectedDate]);

  return (
    <div className="dash-root">
      <section className="dash-header-card">
        <div>
          <p className="dash-greeting">Welcome back,</p>
          <h2 className="dash-title">{user?.username}</h2>

          {user?.role && (
            <span className="dash-role-pill">
              {String(user.role).replaceAll("_", " ")}
            </span>
          )}

          {!isGateController && gateControllerOnDuty && (
            <p className="dash-subtitle" style={{ marginTop: 8 }}>
              Gate Controller on duty: <strong>{gateControllerOnDuty}</strong>
            </p>
          )}

          <p className="dash-subtitle" style={{ marginTop: 8 }}>
            Select a flight to start working.
          </p>
        </div>

        <div className="dash-summary-box">
          <p className="dash-summary-label">Flights</p>
          <p className="dash-summary-number">{loading ? "…" : flights.length}</p>
          <p className="dash-summary-caption">for {selectedDate}</p>
        </div>
      </section>

      {/* Helper cards */}
      <section className="dash-grid">
        <div className="dash-card">
          <h3>Gate Controller</h3>
          <p>
            Enter or verify the total checked bags for the flight. This becomes the
            reference count for Bagroom and Aircraft loading.
          </p>
          <ul className="dash-list">
            <li>Checked bags total</li>
            <li>Who entered the number</li>
            <li>Operational reference</li>
          </ul>
        </div>

        {!isGateController && (
          <div className="dash-card">
            <h3>Bagroom</h3>
            <p>
              Scan every bag received in Bagroom to ensure all checked bags reach the aircraft.
            </p>
            <ul className="dash-list">
              <li>Real-time bag count</li>
              <li>Match vs Gate total</li>
              <li>Detect missing bags early</li>
            </ul>
          </div>
        )}

        <div className="dash-card">
          <h3>Aircraft</h3>
          <p>
            Scan bags as they are loaded by zone (1–4). System checks missing bags before “completed”.
          </p>
          <ul className="dash-list">
            <li>Track by zone (1–4)</li>
            <li>Compare vs Gate total</li>
            <li>Final loading verification</li>
          </ul>
        </div>
      </section>

      {/* Flights table */}
      <section className="dash-section">
        <div
          className="dash-section-header"
          style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
        >
          <div>
            <h3>Flights</h3>
            <p>Choose a flight and go directly to your work area.</p>
          </div>

          <div>
            <label style={{ fontSize: "0.85rem", color: "#374151" }}>Date</label>
            <div>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #d1d5db" }}
              />
            </div>
          </div>
        </div>

        <div className="dash-table-wrapper">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Flight</th>
                <th>Date</th>
                <th>Gate</th>
                <th>Aircraft</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 14, color: "#6b7280" }}>
                    Loading flights...
                  </td>
                </tr>
              ) : flights.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 14, fontStyle: "italic", color: "#6b7280" }}>
                    No flights found for {selectedDate}.
                  </td>
                </tr>
              ) : (
                flights.map((f) => (
                  <tr key={f.id}>
                    <td><strong>{f.flightNumber || "-"}</strong></td>
                    <td>{f.flightDate || "-"}</td>
                    <td>{f.gate || "-"}</td>
                    <td>{f.aircraftType || "-"}</td>
                    <td>
                      <StatusPill status={f.status} />
                    </td>

                    <td style={{ textAlign: "right" }}>
                      <div className="dash-actions">
                        <button className="btn-secondary" onClick={() => onOpenFlight(f.id, "gate")}>
                          Gate
                        </button>

                        {!isGateController && (
                          <button className="btn-secondary" onClick={() => onOpenFlight(f.id, "bagroom")}>
                            Bagroom
                          </button>
                        )}

                        <button className="btn-primary" onClick={() => onOpenFlight(f.id, "aircraft")}>
                          Aircraft
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

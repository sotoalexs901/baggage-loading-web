// src/pages/DashboardPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
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

function normalizeStatus(s) {
  const v = String(s || "OPEN").trim().toUpperCase();

  return v === "OPEN" || v === "RECEIVING" || v === "LOADING" || v === "LOADED"
    ? v
    : "OPEN";
}

function normalizeBagType(value) {
  const v = String(value || "CHECKED_BAG").trim().toUpperCase();

  return v === "CHECKED_BAG" || v === "GATE_CHECK" || v === "OVERSIZE"
    ? v
    : "CHECKED_BAG";
}

function getProgressPercent(gateTotal, aircraftTotal) {
  if (typeof gateTotal !== "number" || gateTotal <= 0) return 0;
  return Math.min(100, Math.round((aircraftTotal / gateTotal) * 100));
}

const STATUS_COLORS = {
  OPEN: { bg: "#FEF3C7", text: "#92400E", border: "#F59E0B" },
  RECEIVING: { bg: "#DBEAFE", text: "#1E3A8A", border: "#60A5FA" },
  LOADING: { bg: "#FFEDD5", text: "#9A3412", border: "#FB923C" },
  LOADED: { bg: "#DCFCE7", text: "#166534", border: "#22C55E" },
};

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

function SmallCard({ label, value, tone = "default" }) {
  const colors = {
    default: { bg: "#f9fafb", border: "#e5e7eb", text: "#111827" },
    good: { bg: "#dcfce7", border: "#22c55e", text: "#166534" },
    warn: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
    bad: { bg: "#fee2e2", border: "#ef4444", text: "#991b1b" },
    blue: { bg: "#dbeafe", border: "#60a5fa", text: "#1e3a8a" },
  };

  const c = colors[tone] || colors.default;

  return (
    <div
      style={{
        border: `1px solid ${c.border}`,
        borderRadius: 12,
        padding: 10,
        background: c.bg,
        color: c.text,
      }}
    >
      <div style={{ fontSize: "0.75rem", fontWeight: 800, opacity: 0.85 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.25rem", fontWeight: 900, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function ProgressBar({ percent }) {
  return (
    <div
      style={{
        width: "100%",
        height: 10,
        background: "#e5e7eb",
        borderRadius: 999,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${percent}%`,
          height: "100%",
          background: percent >= 100 ? "#22c55e" : percent >= 75 ? "#f59e0b" : "#2563eb",
        }}
      />
    </div>
  );
}

export default function DashboardPage({ user, onOpenFlight, gateControllerOnDuty }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);
  const isGateController = role === "gate_controller";

  const today = useMemo(() => getTodayYYYYMMDD(), []);
  const [selectedDate, setSelectedDate] = useState(today);

  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(true);

  const [flightStats, setFlightStats] = useState({});
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

  useEffect(() => {
    if (flights.length === 0) {
      setFlightStats({});
      return;
    }

    const unsubList = [];

    for (const flight of flights) {
      const flightId = flight.id;

      const counterRef = collection(db, "flights", flightId, "counterScans");
      const bagroomRef = collection(db, "flights", flightId, "bagroomScans");
      const aircraftRef = collection(db, "flights", flightId, "aircraftScans");

      const updateStats = (type, rows) => {
        setFlightStats((prev) => {
          const old = prev[flightId] || {
            counter: [],
            bagroom: [],
            aircraft: [],
          };

          return {
            ...prev,
            [flightId]: {
              ...old,
              [type]: rows,
            },
          };
        });
      };

      const unsubCounter = onSnapshot(
        counterRef,
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          updateStats("counter", rows);
        },
        (e) => {
          console.error("Dashboard counter stats error:", e);
          updateStats("counter", []);
        }
      );

      const unsubBagroom = onSnapshot(
        bagroomRef,
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          updateStats("bagroom", rows);
        },
        (e) => {
          console.error("Dashboard bagroom stats error:", e);
          updateStats("bagroom", []);
        }
      );

      const unsubAircraft = onSnapshot(
        aircraftRef,
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          updateStats("aircraft", rows);
        },
        (e) => {
          console.error("Dashboard aircraft stats error:", e);
          updateStats("aircraft", []);
        }
      );

      unsubList.push(unsubCounter, unsubBagroom, unsubAircraft);
    }

    return () => {
      unsubList.forEach((unsub) => unsub());
    };
  }, [flights]);

  const getStatsForFlight = (flight) => {
    const stats = flightStats[flight.id] || {
      counter: [],
      bagroom: [],
      aircraft: [],
    };

    const gateTotal =
      typeof flight.checkedBagsTotal === "number" ? flight.checkedBagsTotal : null;

    const counterTotal = stats.counter.length;
    const bagroomTotal = stats.bagroom.length;
    const aircraftTotal = stats.aircraft.length;

    const missing =
      gateTotal === null ? null : Math.max(0, gateTotal - aircraftTotal);

    const progress = getProgressPercent(gateTotal, aircraftTotal);

    const bagTypes = {
      CHECKED_BAG: 0,
      GATE_CHECK: 0,
      OVERSIZE: 0,
    };

    for (const scan of stats.aircraft) {
      const type = normalizeBagType(scan.bagType);
      bagTypes[type] += 1;
    }

    const counterBagTypes = {
      CHECKED_BAG: 0,
      GATE_CHECK: 0,
      OVERSIZE: 0,
    };

    for (const scan of stats.counter) {
      const type = normalizeBagType(scan.bagType);
      counterBagTypes[type] += 1;
    }

    const missingBagTypes = {
      GATE_CHECK: Math.max(0, counterBagTypes.GATE_CHECK - bagTypes.GATE_CHECK),
      OVERSIZE: Math.max(0, counterBagTypes.OVERSIZE - bagTypes.OVERSIZE),
    };

    return {
      gateTotal,
      counterTotal,
      bagroomTotal,
      aircraftTotal,
      missing,
      progress,
      bagTypes,
      counterBagTypes,
      missingBagTypes,
    };
  };

  const summaryTotals = useMemo(() => {
    let gate = 0;
    let bagroom = 0;
    let aircraft = 0;
    let missing = 0;
    let loadedFlights = 0;

    for (const f of flights) {
      const s = getStatsForFlight(f);

      if (typeof s.gateTotal === "number") gate += s.gateTotal;
      bagroom += s.bagroomTotal;
      aircraft += s.aircraftTotal;

      if (typeof s.missing === "number") missing += s.missing;
      if (normalizeStatus(f.status) === "LOADED") loadedFlights += 1;
    }

    return {
      gate,
      bagroom,
      aircraft,
      missing,
      loadedFlights,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flights, flightStats]);
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
            Real-time flight overview for baggage operations.
          </p>
        </div>

        <div className="dash-summary-box">
          <p className="dash-summary-label">Flights</p>
          <p className="dash-summary-number">{loading ? "…" : flights.length}</p>
          <p className="dash-summary-caption">for {selectedDate}</p>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <SmallCard label="Gate Total" value={loading ? "…" : summaryTotals.gate} tone="blue" />
        <SmallCard label="Bagroom" value={loading ? "…" : summaryTotals.bagroom} />
        <SmallCard label="Aircraft" value={loading ? "…" : summaryTotals.aircraft} />
        <SmallCard
          label="Missing"
          value={loading ? "…" : summaryTotals.missing}
          tone={summaryTotals.missing === 0 ? "good" : "bad"}
        />
        <SmallCard label="Loaded Flights" value={loading ? "…" : summaryTotals.loadedFlights} tone="good" />
      </section>

      <section className="dash-section">
        <div
          className="dash-section-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3>Real-Time Flights</h3>
            <p>Live baggage progress by flight.</p>
          </div>

          <div>
            <label style={{ fontSize: "0.85rem", color: "#374151" }}>Date</label>
            <div>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                }}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <p style={{ color: "#6b7280", padding: 14 }}>Loading flights...</p>
        ) : flights.length === 0 ? (
          <p style={{ color: "#6b7280", padding: 14 }}>
            No flights found for {selectedDate}.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {flights.map((f) => {
              const s = getStatsForFlight(f);
              const status = normalizeStatus(f.status);

              return (
                <div
                  key={f.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 14,
                    background: "white",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      alignItems: "start",
                    }}
                  >
                    <div>
                      <h3 style={{ margin: 0 }}>
                        {f.flightNumber || "-"}{" "}
                        <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                          · {f.gate || "No Gate"}
                        </span>
                      </h3>

                      <p style={{ margin: "5px 0 0", color: "#6b7280", fontSize: "0.85rem" }}>
                        Date: <strong>{f.flightDate || "-"}</strong> · Aircraft:{" "}
                        <strong>{f.aircraftType || "-"}</strong>
                      </p>

                      <p style={{ margin: "5px 0 0", color: "#6b7280", fontSize: "0.85rem" }}>
                        Gate Controller:{" "}
                        <strong>{f.gateControllerOnDuty || gateControllerOnDuty || "-"}</strong>
                        {" · "}
                        Ramp Supervisor: <strong>{f.rampSupervisorOnDuty || "-"}</strong>
                      </p>
                    </div>

                    <StatusPill status={status} />
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.82rem",
                        color: "#6b7280",
                        marginBottom: 5,
                      }}
                    >
                      <span>Loading Progress</span>
                      <strong>{s.progress}%</strong>
                    </div>

                    <ProgressBar percent={s.progress} />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
                    <SmallCard
                      label="Gate Total"
                      value={s.gateTotal === null ? "—" : s.gateTotal}
                      tone="blue"
                    />
                    <SmallCard label="Counter" value={s.counterTotal} />
                    <SmallCard label="Bagroom" value={s.bagroomTotal} />
                    <SmallCard label="Aircraft" value={s.aircraftTotal} />
                    <SmallCard
                      label="Missing"
                      value={s.missing === null ? "—" : s.missing}
                      tone={s.missing === 0 ? "good" : s.missing === null ? "default" : "bad"}
                    />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    <SmallCard label="Checked Loaded" value={s.bagTypes.CHECKED_BAG} />
                    <SmallCard label="Gate Check Loaded" value={s.bagTypes.GATE_CHECK} tone="warn" />
                    <SmallCard label="Oversize Loaded" value={s.bagTypes.OVERSIZE} tone="warn" />
                    <SmallCard
                      label="Gate Check Missing"
                      value={s.missingBagTypes.GATE_CHECK}
                      tone={s.missingBagTypes.GATE_CHECK === 0 ? "good" : "bad"}
                    />
                    <SmallCard
                      label="Oversize Missing"
                      value={s.missingBagTypes.OVERSIZE}
                      tone={s.missingBagTypes.OVERSIZE === 0 ? "good" : "bad"}
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                      marginTop: 12,
                    }}
                  >
                    <button className="btn-secondary" onClick={() => onOpenFlight(f.id, "gate")}>
                      Gate
                    </button>

                    <button className="btn-secondary" onClick={() => onOpenFlight(f.id, "counter")}>
                      Counter
                    </button>

                    {!isGateController && (
                      <button className="btn-secondary" onClick={() => onOpenFlight(f.id, "bagroom")}>
                        Bagroom
                      </button>
                    )}

                    <button className="btn-primary" onClick={() => onOpenFlight(f.id, "aircraft")}>
                      Aircraft
                    </button>

                    <button className="btn-secondary" onClick={() => onOpenFlight(f.id, "reports")}>
                      Reports
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

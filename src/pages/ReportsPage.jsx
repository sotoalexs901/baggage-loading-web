// src/pages/ReportsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

function getTodayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonthValue(dateText) {
  const d = String(dateText || getTodayYYYYMMDD());
  return d.slice(0, 7);
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function formatDateTime(ts) {
  if (!ts) return "-";

  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "-";
  }
}

export default function ReportsPage({ flightId, flight, user }) {
  const today = useMemo(() => getTodayYYYYMMDD(), []);
  const defaultFrom = useMemo(() => today.slice(0, 8) + "01", [today]);

  const resolvedFlightId = useMemo(() => {
    if (typeof flightId === "string") return flightId;
    if (flightId && typeof flightId === "object" && typeof flightId.id === "string") return flightId.id;
    if (flight && typeof flight === "object" && typeof flight.id === "string") return flight.id;
    return "";
  }, [flightId, flight]);

  const role = normalizeRole(user?.role);
  const canDeleteMonth = role === "station_manager";

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);

  const [loadedFlights, setLoadedFlights] = useState([]);
  const [loadingFlights, setLoadingFlights] = useState(true);

  const [selectedFlightId, setSelectedFlightId] = useState(resolvedFlightId);
  const [rows, setRows] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);

  const [deleteMonth, setDeleteMonth] = useState(getMonthValue(today));
  const [deletingMonth, setDeletingMonth] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");
  const [deleteErr, setDeleteErr] = useState("");

  useEffect(() => {
    setSelectedFlightId(resolvedFlightId);
  }, [resolvedFlightId]);
    useEffect(() => {
    setLoadingFlights(true);

    const qRef = query(
      collection(db, "flights"),
      where("status", "==", "LOADED"),
      orderBy("flightDate", "desc")
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((f) => {
            const fd = String(f.flightDate || "");
            if (!fd) return false;
            return fd >= dateFrom && fd <= dateTo;
          });

        setLoadedFlights(list);
        setLoadingFlights(false);
      },
      (err) => {
        console.error("Loaded flights error:", err);
        setLoadedFlights([]);
        setLoadingFlights(false);
      }
    );

    return () => unsub();
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!selectedFlightId) {
      setRows([]);
      setLoadingReports(false);
      return;
    }

    setLoadingReports(true);

    const qRef = query(
      collection(db, "flights", selectedFlightId, "reports"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRows(list);
        setLoadingReports(false);
      },
      (err) => {
        console.error("ReportsPage error:", err);
        setRows([]);
        setLoadingReports(false);
      }
    );

    return () => unsub();
  }, [selectedFlightId]);

  const selectedFlight = loadedFlights.find((f) => f.id === selectedFlightId);

  const handleDeleteMonth = async () => {
    setDeleteMsg("");
    setDeleteErr("");

    if (!canDeleteMonth) {
      setDeleteErr("Only Station Manager can delete a full month.");
      return;
    }

    const [yearText, monthText] = String(deleteMonth || "").split("-");
    const year = Number(yearText);
    const month = Number(monthText);

    if (!year || !month) {
      setDeleteErr("Please select a valid month.");
      return;
    }

    const ok = window.confirm(
      `DELETE ALL LOADED FLIGHTS FOR ${deleteMonth}?\n\n` +
        `This will delete loaded flights, scans, manifests, reports, PDFs, and bag tag indexes.\n\n` +
        `This cannot be undone.`
    );

    if (!ok) return;

    try {
      setDeletingMonth(true);

      const fn = httpsCallable(functions, "deleteLoadedFlightsByMonth");

      const res = await fn({
        year,
        month,
        username: user?.username || null,
        userRole: user?.role || null,
      });

      setDeleteMsg(
        `Deleted ${res.data?.deletedFlights || 0} loaded flight(s) for ${res.data?.month || deleteMonth}.`
      );

      if (selectedFlightId) {
        setSelectedFlightId("");
      }
    } catch (e) {
      console.error(e);
      setDeleteErr(e?.message || "Could not delete month.");
    } finally {
      setDeletingMonth(false);
    }
  };

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Flight Reports</h2>

      <p style={{ color: "#6b7280", marginTop: 6 }}>
        View loaded flights, reports, reopen/offload logs, and exported PDFs.
      </p>
            <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginTop: 14 }}>
        <h3 style={{ margin: 0 }}>Loaded Flights</h3>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <div>
            <label style={label}>From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={input} />
          </div>

          <div>
            <label style={label}>To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={input} />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          {loadingFlights ? (
            <p style={{ color: "#6b7280" }}>Loading loaded flights…</p>
          ) : loadedFlights.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No loaded flights found for this date range.</p>
          ) : (
            <select
              value={selectedFlightId}
              onChange={(e) => setSelectedFlightId(e.target.value)}
              style={{ ...input, width: "100%" }}
            >
              <option value="">Select loaded flight…</option>
              {loadedFlights.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.flightDate || "-"} · {f.flightNumber || f.id} · {f.gate || "-"}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      {canDeleteMonth && (
        <section style={{ border: "1px solid #fecaca", borderRadius: 12, padding: 12, marginTop: 14, background: "#fef2f2" }}>
          <h3 style={{ margin: 0, color: "#991b1b" }}>Delete Loaded Flights by Month</h3>

          <p style={{ color: "#991b1b", fontSize: "0.9rem" }}>
            Deletes all LOADED flights for the selected month, including scans, manifests, reports, PDFs, and bag tag indexes.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <div>
              <label style={label}>Month</label>
              <input
                type="month"
                value={deleteMonth}
                onChange={(e) => setDeleteMonth(e.target.value)}
                style={input}
              />
            </div>

            <button
              onClick={handleDeleteMonth}
              disabled={deletingMonth}
              style={{
                padding: "9px 12px",
                borderRadius: 12,
                border: "1px solid #dc2626",
                background: "#dc2626",
                color: "white",
                fontWeight: 900,
                cursor: deletingMonth ? "not-allowed" : "pointer",
                opacity: deletingMonth ? 0.7 : 1,
              }}
            >
              {deletingMonth ? "Deleting…" : "Delete Month"}
            </button>
          </div>

          {deleteMsg && <p style={{ color: "#16a34a", fontWeight: 800 }}>{deleteMsg}</p>}
          {deleteErr && <p style={{ color: "#b91c1c", fontWeight: 800 }}>{deleteErr}</p>}
        </section>
      )}

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginTop: 14 }}>
        <h3 style={{ margin: 0 }}>Reports</h3>

        {selectedFlight && (
          <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
            Selected: <strong>{selectedFlight.flightNumber}</strong> · {selectedFlight.flightDate}
          </p>
        )}

        {!selectedFlightId ? (
          <p style={{ color: "#6b7280", marginTop: 12 }}>Select a loaded flight first.</p>
        ) : loadingReports ? (
          <p style={{ color: "#6b7280", marginTop: 12 }}>Loading reports…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: "#6b7280", marginTop: 12 }}>No reports saved for this flight.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={th}>Type</th>
                <th style={th}>Details</th>
                <th style={th}>Created</th>
                <th style={th}>Created By</th>
                <th style={{ ...th, textAlign: "right" }}>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    <strong>{r.type || "PDF_REPORT"}</strong>
                  </td>

                  <td style={td}>
                    {r.type === "OFFLOAD_BAG" ? (
                      <>
                        <strong>Bag:</strong> {r.tag || "-"} · <strong>Zone:</strong> {r.zone || "-"}
                        <br />
                        <span style={{ color: "#6b7280" }}>{r.reason || "-"}</span>
                      </>
                    ) : r.type === "REOPEN_FLIGHT" ? (
                      <>
                        <strong>Flight reopened</strong>
                        <br />
                        <span style={{ color: "#6b7280" }}>{r.reason || "-"}</span>
                      </>
                    ) : r.type === "LOADING_COMPLETED" ? (
                      <>
                        <strong>Loading completed</strong>
                        <br />
                        <span style={{ color: "#6b7280" }}>{r.reason || "-"}</span>
                      </>
                    ) : (
                      <strong>{r.fileName || r.id}</strong>
                    )}
                  </td>

                  <td style={td}>{formatDateTime(r.createdAt)}</td>
                  <td style={td}>{r.createdBy?.username || "-"}</td>

                  <td style={{ ...td, textAlign: "right" }}>
                    {r.downloadUrl ? (
                      <a href={r.downloadUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 800 }}>
                        Open PDF
                      </a>
                    ) : (
                      <span style={{ color: "#6b7280" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const label = {
  display: "block",
  fontSize: "0.85rem",
  color: "#374151",
  marginBottom: 4,
};

const input = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
};

const th = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: "0.8rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#6b7280",
};

const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
};

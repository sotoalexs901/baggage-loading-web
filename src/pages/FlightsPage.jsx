/// src/pages/FlightsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  getDocs,
  limit,
} from "firebase/firestore";
import { db, functions } from "../firebase"; // ✅ usa functions con región correcta
import { httpsCallable } from "firebase/functions";

function getTodayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeRole(roleRaw) {
  return String(roleRaw || "").trim().toLowerCase();
}

function canCreateFlights(roleRaw) {
  const role = normalizeRole(roleRaw);
  return role === "station_manager" || role === "duty_manager" || role === "duty_managers";
}

function isManager(roleRaw) {
  const role = normalizeRole(roleRaw);
  return role === "station_manager" || role === "duty_manager";
}

function normalizeStatus(s) {
  const v = String(s || "OPEN").trim().toUpperCase();
  return v === "OPEN" || v === "RECEIVING" || v === "LOADING" || v === "LOADED" ? v : "OPEN";
}

const STATUS_COLORS = {
  OPEN: { bg: "#FEF3C7", text: "#92400E", border: "#F59E0B" },
  RECEIVING: { bg: "#FEF3C7", text: "#92400E", border: "#F59E0B" },
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
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.text,
        fontWeight: 900,
        fontSize: "0.75rem",
        letterSpacing: "0.04em",
      }}
    >
      {st}
    </span>
  );
}

export default function FlightsPage({ user, onFlightSelected }) {
  const today = useMemo(() => getTodayYYYYMMDD(), []);
  const [selectedDate, setSelectedDate] = useState(today);

  const [statusFilter, setStatusFilter] = useState("active"); // "active" | "completed" | "all"

  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    flightNumber: "",
    flightDate: today,
    gate: "",
    aircraftType: "",
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // ✅ manager actions UI
  const [actionMsg, setActionMsg] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [reopeningId, setReopeningId] = useState("");

  const allowCreate = canCreateFlights(user?.role);
  const allowManage = isManager(user?.role);

  useEffect(() => {
    setLoading(true);

    const qRef = query(
      collection(db, "flights"),
      where("flightDate", "==", selectedDate),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const filtered =
          statusFilter === "all"
            ? rows
            : statusFilter === "completed"
              ? rows.filter((r) => normalizeStatus(r.status) === "LOADED")
              : rows.filter((r) => normalizeStatus(r.status) !== "LOADED");

        setFlights(filtered);
        setLoading(false);
      },
      (err) => {
        console.error("Flights onSnapshot error:", err);
        setFlights([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [selectedDate, statusFilter]);

  const openCreate = () => {
    setFormError("");
    setForm({
      flightNumber: "",
      flightDate: selectedDate,
      gate: "",
      aircraftType: "",
    });
    setShowCreate(true);
  };

  const closeCreate = () => {
    setShowCreate(false);
    setFormError("");
  };

  const handleCreate = async () => {
    setFormError("");

    const flightNumber = form.flightNumber.trim().toUpperCase();
    const flightDate = form.flightDate.trim();
    const gate = form.gate.trim().toUpperCase();
    const aircraftType = form.aircraftType.trim().toUpperCase();

    if (!flightNumber || !flightDate) {
      setFormError("Flight number and date are required.");
      return;
    }

    try {
      setSaving(true);

      const dupQ = query(
        collection(db, "flights"),
        where("flightDate", "==", flightDate),
        where("flightNumber", "==", flightNumber),
        limit(1)
      );
      const dupSnap = await getDocs(dupQ);
      if (!dupSnap.empty) {
        setFormError("This flight already exists for that date.");
        setSaving(false);
        return;
      }

      const payload = {
        flightNumber,
        flightDate,
        gate: gate || null,
        aircraftType: aircraftType || null,
        status: "OPEN",
        createdAt: serverTimestamp(),
        createdBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
      };

      const docRef = await addDoc(collection(db, "flights"), payload);

      setShowCreate(false);
      setSaving(false);

      onFlightSelected?.({
        id: docRef.id,
        flightNumber,
        flightDate,
        gate: gate || null,
        aircraftType: aircraftType || null,
        status: "OPEN",
      });
    } catch (err) {
      console.error("Create flight error:", err);
      setFormError("Could not create flight. Check permissions/rules.");
      setSaving(false);
    }
  };

  const openFlight = (f) => {
    onFlightSelected?.({
      id: f.id,
      flightNumber: f.flightNumber || null,
      flightDate: f.flightDate || null,
      gate: f.gate || null,
      aircraftType: f.aircraftType || null,
      status: f.status || "OPEN",
    });
  };

  // ✅ Reopen (LOADED -> LOADING) via Cloud Function (REGION FIXED)
  const handleReopen = async (f) => {
    if (!allowManage) return;

    setActionMsg("");
    setActionErr("");

    const ok = window.confirm(
      `Reopen this flight?\n\n${f.flightNumber || f.id} (${f.flightDate || "-"})\n\nThis will unlock scanning again.`
    );
    if (!ok) return;

    try {
      setReopeningId(f.id);

      // ✅ IMPORTANT: use functions from ../firebase (region fixed)
      const fn = httpsCallable(functions, "reopenFlight");
      await fn({ flightId: f.id });

      setActionMsg(`✅ Flight reopened: ${f.flightNumber || f.id}`);
      setTimeout(() => setActionMsg(""), 2500);
    } catch (e) {
      console.error("reopenFlight failed:", e);
      setActionErr(e?.message || "Failed to reopen flight. Check permissions / Cloud Function deployment.");
    } finally {
      setReopeningId("");
    }
  };

  // ✅ Delete cascade via Cloud Function (REGION FIXED)
  const handleDelete = async (f) => {
    if (!allowManage) return;

    setActionMsg("");
    setActionErr("");

    const label = `${f.flightNumber || f.id} (${f.flightDate || "-"})`;
    const ok = window.confirm(
      `DELETE FLIGHT?\n\n${label}\n\nThis will remove:\n- aircraft scans\n- bagroom scans\n- manifest tags\n- reports\n- PDFs in Storage\n- global bagTags index\n\nThis cannot be undone.`
    );
    if (!ok) return;

    try {
      setDeletingId(f.id);

      // ✅ IMPORTANT: use functions from ../firebase (region fixed)
      const fn = httpsCallable(functions, "deleteFlightCascade");
      await fn({ flightId: f.id });

      setActionMsg(`✅ Flight deleted: ${label}`);
      setTimeout(() => setActionMsg(""), 2500);
    } catch (e) {
      console.error("deleteFlightCascade failed:", e);
      setActionErr(e?.message || "Failed to delete flight. Check permissions / Cloud Function deployment.");
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Flights</h2>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
            Select a date, filter, then choose a flight.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: "0.85rem", color: "#374151" }}>Date</label>
            <div>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: "0.85rem", color: "#374151" }}>Filter</label>
            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", height: 34 }}
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>

          {allowCreate ? (
            <button
              onClick={openCreate}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #111827",
                background: "#111827",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
                height: 38,
                marginTop: 18,
              }}
            >
              + Create Flight
            </button>
          ) : (
            <div style={{ marginTop: 18, color: "#6b7280", fontSize: "0.85rem" }}>
              Create Flight: managers only
            </div>
          )}
        </div>
      </div>

      {(actionMsg || actionErr) && (
        <div style={{ marginTop: 12 }}>
          {actionMsg && (
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "#DCFCE7", color: "#166534", fontWeight: 800 }}>
              {actionMsg}
            </div>
          )}
          {actionErr && (
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "#FEE2E2", color: "#991B1B", fontWeight: 800 }}>
              {actionErr}
            </div>
          )}
        </div>
      )}

      <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "14px 0" }} />

      {loading ? (
        <p style={{ color: "#6b7280" }}>Loading flights...</p>
      ) : flights.length === 0 ? (
        <p style={{ color: "#6b7280" }}>
          No flights found for {selectedDate} ({statusFilter}).
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92rem" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={th}>Flight</th>
                <th style={th}>Date</th>
                <th style={th}>Gate</th>
                <th style={th}>Aircraft</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => {
                const st = normalizeStatus(f.status);
                const isCompleted = st === "LOADED";
                const busyDelete = deletingId === f.id;
                const busyReopen = reopeningId === f.id;

                return (
                  <tr key={f.id}>
                    <td style={td}><strong>{f.flightNumber}</strong></td>
                    <td style={td}>{f.flightDate}</td>
                    <td style={td}>{f.gate || "-"}</td>
                    <td style={td}>{f.aircraftType || "-"}</td>
                    <td style={td}><StatusPill status={st} /></td>

                    <td style={{ ...td, textAlign: "right" }}>
                      <button
                        onClick={() => openFlight(f)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: "1px solid #d1d5db",
                          background: "white",
                          cursor: "pointer",
                          fontWeight: 800,
                          marginRight: 8,
                        }}
                      >
                        {isCompleted ? "View" : "Open"}
                      </button>

                      {allowManage && isCompleted && (
                        <button
                          onClick={() => handleReopen(f)}
                          disabled={busyReopen || busyDelete}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            border: "1px solid #16a34a",
                            background: "#16a34a",
                            color: "white",
                            cursor: busyReopen || busyDelete ? "not-allowed" : "pointer",
                            fontWeight: 900,
                            marginRight: 8,
                            opacity: busyReopen || busyDelete ? 0.7 : 1,
                          }}
                        >
                          {busyReopen ? "Reopening…" : "Reopen"}
                        </button>
                      )}

                      {allowManage && (
                        <button
                          onClick={() => handleDelete(f)}
                          disabled={busyDelete || busyReopen}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            border: "1px solid #ef4444",
                            background: "#ef4444",
                            color: "white",
                            cursor: busyDelete || busyReopen ? "not-allowed" : "pointer",
                            fontWeight: 900,
                            opacity: busyDelete || busyReopen ? 0.7 : 1,
                          }}
                        >
                          {busyDelete ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p style={{ marginTop: 10, color: "#6b7280", fontSize: "0.8rem" }}>
            Tip: Completed flights (LOADED) remain accessible for Gate/Aircraft/Reports. Managers can Reopen if needed.
          </p>
        </div>
      )}

      {showCreate && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}>Create Flight</h3>
              <button onClick={closeCreate} style={xBtn} aria-label="Close">✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div>
                <label style={label}>Flight Number</label>
                <input
                  value={form.flightNumber}
                  onChange={(e) => setForm((p) => ({ ...p, flightNumber: e.target.value }))}
                  placeholder="e.g. SY214"
                  style={input}
                />
              </div>

              <div>
                <label style={label}>Date</label>
                <input
                  type="date"
                  value={form.flightDate}
                  onChange={(e) => setForm((p) => ({ ...p, flightDate: e.target.value }))}
                  style={input}
                />
              </div>

              <div>
                <label style={label}>Gate</label>
                <input
                  value={form.gate}
                  onChange={(e) => setForm((p) => ({ ...p, gate: e.target.value }))}
                  placeholder="e.g. E68"
                  style={input}
                />
              </div>

              <div>
                <label style={label}>Aircraft Type</label>
                <input
                  value={form.aircraftType}
                  onChange={(e) => setForm((p) => ({ ...p, aircraftType: e.target.value }))}
                  placeholder="e.g. B737-800"
                  style={input}
                />
              </div>
            </div>

            {formError && (
              <p style={{ color: "#b91c1c", marginTop: 10, marginBottom: 0, fontSize: "0.9rem" }}>
                {formError}
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button onClick={closeCreate} style={btnGhost}>Cancel</button>
              <button onClick={handleCreate} disabled={saving} style={btnPrimary}>
                {saving ? "Creating..." : "Create Flight"}
              </button>
            </div>

            <p style={{ marginTop: 12, color: "#6b7280", fontSize: "0.8rem" }}>
              Created by: {user?.username} ({user?.role})
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

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

const overlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 999,
};

const modal = {
  width: "100%",
  maxWidth: 640,
  background: "white",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
};

const label = { display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: 4 };
const input = { width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid #d1d5db" };

const btnPrimary = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const btnGhost = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
};

const xBtn = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "white",
  width: 34,
  height: 34,
  cursor: "pointer",
};

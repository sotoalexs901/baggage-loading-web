// src/pages/GateControllerPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function toIntSafe(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

export default function GateControllerPage({ flightId, user, gateControllerOnDuty, canEdit }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);
  const isGateController = role === "gate_controller";

  // vuelo
  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] = useState(true);

  // gate totals
  const [checkedTotalInput, setCheckedTotalInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // aircraft scans summary
  const [aircraftTotal, setAircraftTotal] = useState(0);
  const [zones, setZones] = useState({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [aircraftLoading, setAircraftLoading] = useState(true);

  // Load flight doc
  useEffect(() => {
    if (!flightId) return;

    setFlightLoading(true);
    const ref = doc(db, "flights", flightId);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setFlight(null);
          setFlightLoading(false);
          return;
        }

        const data = { id: snap.id, ...snap.data() };
        setFlight(data);

        // cargar input con valor existente si existe
        if (typeof data.checkedBagsTotal === "number") {
          setCheckedTotalInput(String(data.checkedBagsTotal));
        } else if (data.checkedBagsTotal === null || data.checkedBagsTotal === undefined) {
          setCheckedTotalInput("");
        }

        setFlightLoading(false);
      },
      (err) => {
        console.error("GateControllerPage flight onSnapshot error:", err);
        setFlight(null);
        setFlightLoading(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  // Load aircraft scan summary (simple approach)
  // Assumes subcollection: flights/{flightId}/aircraftScans with fields: zone (1-4), tag, createdAt
  useEffect(() => {
    if (!flightId) return;

    const run = async () => {
      try {
        setAircraftLoading(true);
        const scansRef = collection(db, "flights", flightId, "aircraftScans");
        const snap = await getDocs(scansRef);

        let total = 0;
        const z = { 1: 0, 2: 0, 3: 0, 4: 0 };

        snap.forEach((d) => {
          const data = d.data();
          total += 1;
          const zone = Number(data.zone);
          if (zone >= 1 && zone <= 4) z[zone] += 1;
        });

        setAircraftTotal(total);
        setZones(z);
        setAircraftLoading(false);
      } catch (err) {
        console.error("GateControllerPage aircraft summary error:", err);
        setAircraftTotal(0);
        setZones({ 1: 0, 2: 0, 3: 0, 4: 0 });
        setAircraftLoading(false);
      }
    };

    run();
  }, [flightId]);

  const checkedBagsTotal = typeof flight?.checkedBagsTotal === "number" ? flight.checkedBagsTotal : null;
  const missing = checkedBagsTotal === null ? null : Math.max(0, checkedBagsTotal - aircraftTotal);

  const saveTotal = async () => {
    setSaveMsg("");

    const value = toIntSafe(checkedTotalInput);
    if (value === null) {
      setSaveMsg("Please enter a valid number.");
      return;
    }

    if (!canEdit) {
      setSaveMsg("You don't have permission to edit this field.");
      return;
    }

    try {
      setSaving(true);

      const ref = doc(db, "flights", flightId);

      // Si el doc existe, update. Si no, set.
      // Normalmente existe.
      const payload = {
        checkedBagsTotal: value,
        gateTotalUpdatedAt: serverTimestamp(),
        gateTotalUpdatedBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
        gateControllerOnDuty: gateControllerOnDuty || null,
      };

      // updateDoc falla si no existe, por eso usamos setDoc merge true
      await setDoc(ref, payload, { merge: true });

      setSaveMsg("Saved ✅");
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (err) {
      console.error("Save gate total error:", err);
      setSaveMsg("Could not save. Check Firestore rules.");
      setSaving(false);
    }
  };

  const title = isGateController ? "Gate Controller (Read Only)" : "Gate Controller";

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
            Verified counts for Ramp coordination.
          </p>
        </div>

        {!isGateController && gateControllerOnDuty && (
          <div style={{ textAlign: "right", fontSize: "0.9rem" }}>
            Gate Controller on duty: <strong>{gateControllerOnDuty}</strong>
          </div>
        )}
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "14px 0" }} />

      {/* Flight info */}
      {flightLoading ? (
        <p style={{ color: "#6b7280" }}>Loading flight...</p>
      ) : !flight ? (
        <p style={{ color: "#b91c1c" }}>Flight not found.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <InfoCard label="Flight" value={flight.flightNumber || flight.id} />
          <InfoCard label="Date" value={flight.flightDate || "-"} />
          <InfoCard label="Gate" value={flight.gate || "-"} />
          <InfoCard label="Aircraft" value={flight.aircraftType || "-"} />
        </div>
      )}

      {/* Gate Total */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          background: "#f9fafb",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Checked Bags Total</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
              Enter the total checked bags for this flight.
            </p>
          </div>

          <div style={{ minWidth: 260 }}>
            <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: 6 }}>
              Total
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                value={checkedTotalInput}
                onChange={(e) => setCheckedTotalInput(e.target.value)}
                placeholder="0"
                disabled={!canEdit}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #d1d5db",
                  background: canEdit ? "white" : "#f3f4f6",
                }}
              />
              <button
                onClick={saveTotal}
                disabled={!canEdit || saving}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #1d4ed8",
                  background: !canEdit ? "#93c5fd" : "#2563eb",
                  color: "white",
                  fontWeight: 700,
                  cursor: !canEdit ? "not-allowed" : "pointer",
                  minWidth: 90,
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>

            {saveMsg && (
              <p style={{ margin: "8px 0 0", fontSize: "0.85rem", color: saveMsg.includes("✅") ? "#16a34a" : "#b91c1c" }}>
                {saveMsg}
              </p>
            )}

            {!canEdit && (
              <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#6b7280" }}>
                Read-only access.
              </p>
            )}
          </div>
        </div>

        {/* who entered */}
        {flight?.gateTotalUpdatedBy?.username && (
          <p style={{ marginTop: 10, color: "#6b7280", fontSize: "0.85rem" }}>
            Last updated by <strong>{flight.gateTotalUpdatedBy.username}</strong>{" "}
            {flight.gateTotalUpdatedBy.role ? `(${flight.gateTotalUpdatedBy.role})` : ""}.
          </p>
        )}
      </section>

      {/* Aircraft loading summary */}
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Aircraft Loading</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
              Bags scanned in aircraft by zone.
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>Aircraft scanned</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{aircraftLoading ? "…" : aircraftTotal}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 12 }}>
          <InfoCard label="Zone 1" value={aircraftLoading ? "…" : zones[1]} />
          <InfoCard label="Zone 2" value={aircraftLoading ? "…" : zones[2]} />
          <InfoCard label="Zone 3" value={aircraftLoading ? "…" : zones[3]} />
          <InfoCard label="Zone 4" value={aircraftLoading ? "…" : zones[4]} />
        </div>

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ color: "#6b7280", fontSize: "0.9rem" }}>
            Gate checked total: <strong>{checkedBagsTotal === null ? "—" : checkedBagsTotal}</strong>
          </div>

          <div style={{ fontSize: "0.95rem" }}>
            {checkedBagsTotal === null ? (
              <span style={{ color: "#6b7280" }}>Enter Gate total to calculate missing bags.</span>
            ) : missing === 0 ? (
              <span style={{ color: "#16a34a", fontWeight: 700 }}>All bags accounted for ✅</span>
            ) : (
              <span style={{ color: "#b91c1c", fontWeight: 800 }}>
                Missing: {missing}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "white" }}>
      <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{value}</div>
    </div>
  );
}

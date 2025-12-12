// src/pages/BagroomScanPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function cleanTagValue(v) {
  return String(v || "").trim();
}

export default function BagroomScanPage({ flightId, user }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);
  const isGateController = role === "gate_controller";

  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] = useState(true);

  const [tagInput, setTagInput] = useState("");
  const inputRef = useRef(null);

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [scans, setScans] = useState([]);
  const [loadingScans, setLoadingScans] = useState(true);

  const [strictManifest, setStrictManifest] = useState(false);

  // Load flight
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

        if (typeof data.strictManifest === "boolean") {
          setStrictManifest(data.strictManifest);
        }

        setFlightLoading(false);
      },
      (e) => {
        console.error("Bagroom flight snapshot error:", e);
        setFlight(null);
        setFlightLoading(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  // Live bagroom scans
  useEffect(() => {
    if (!flightId) return;

    setLoadingScans(true);
    const ref = collection(db, "flights", flightId, "bagroomScans");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => {
          const ta = a.createdAt?.seconds || 0;
          const tb = b.createdAt?.seconds || 0;
          return tb - ta;
        });
        setScans(rows);
        setLoadingScans(false);
      },
      (e) => {
        console.error("Bagroom scans snapshot error:", e);
        setScans([]);
        setLoadingScans(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const popup = (text) => {
    alert(text);
  };

  // Manifest validation
  const validateAgainstManifest = async (tag) => {
    if (!strictManifest) return { ok: true };

    const allowRef = doc(db, "flights", flightId, "allowedBagTags", tag);
    const allowSnap = await getDoc(allowRef);

    if (!allowSnap.exists()) {
      return {
        ok: false,
        message:
          `❌ Bag tag NOT in flight manifest.\n\n` +
          `Flight: ${flight?.flightNumber || flightId}\n` +
          `Date: ${flight?.flightDate || "-"}`,
      };
    }

    return { ok: true };
  };

  // Cross-flight validation
  const validateAgainstOtherFlight = async (tag) => {
    const tagRef = doc(db, "bagTags", tag);
    const snap = await getDoc(tagRef);

    if (!snap.exists()) return { ok: true, firstTime: true };

    const existing = snap.data();
    if (existing.flightId && existing.flightId !== flightId) {
      return {
        ok: false,
        message:
          `❌ Bag tag belongs to another flight/date.\n\n` +
          `Current flight: ${flight?.flightNumber || flightId} (${flight?.flightDate || "-"})\n` +
          `Registered flight: ${existing.flightNumber || existing.flightId} (${existing.flightDate || "-"})`,
      };
    }

    return { ok: true, firstTime: false };
  };

  const indexTag = async (tag) => {
    const ref = doc(db, "bagTags", tag);
    await setDoc(
      ref,
      {
        tag,
        flightId,
        flightNumber: flight?.flightNumber || null,
        flightDate: flight?.flightDate || null,
        lastSeenAt: serverTimestamp(),
        lastSeenLocation: "bagroom",
        firstSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const saveBagroomScan = async (tag) => {
    const ref = doc(db, "flights", flightId, "bagroomScans", tag);
    const existing = await getDoc(ref);

    if (existing.exists()) {
      popup("⚠️ Bag already scanned in Bagroom.");
      return false;
    }

    await setDoc(ref, {
      tag,
      createdAt: serverTimestamp(),
      scannedBy: {
        userId: user?.id || null,
        username: user?.username || null,
        role: user?.role || null,
      },
    });

    return true;
  };

  const handleScanSubmit = async () => {
    setMsg("");
    setErr("");

    const tag = cleanTagValue(tagInput);
    if (!tag) return;

    try {
      if (!flight) {
        setErr("Flight not loaded.");
        return;
      }

      const m = await validateAgainstManifest(tag);
      if (!m.ok) {
        popup(m.message);
        setTagInput("");
        return;
      }

      const cross = await validateAgainstOtherFlight(tag);
      if (!cross.ok) {
        popup(cross.message);
        setTagInput("");
        return;
      }

      const ok = await saveBagroomScan(tag);
      if (!ok) {
        setTagInput("");
        return;
      }

      await indexTag(tag);

      setMsg(`Scanned ✅  ${tag}`);
      setTagInput("");

      if (inputRef.current) inputRef.current.focus();
    } catch (e) {
      console.error(e);
      setErr("Scan failed. Check connection.");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScanSubmit();
    }
  };

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Bagroom Scan</h2>
          <p style={{ marginTop: 6, color: "#6b7280", fontSize: "0.9rem" }}>
            Scan all bags received in Bagroom.
          </p>
        </div>

        <div style={{ textAlign: "right", fontSize: "0.9rem" }}>
          <div>
            Flight: <strong>{flightLoading ? "…" : (flight?.flightNumber || flightId)}</strong>
          </div>
          <div style={{ color: "#6b7280" }}>
            Date: <strong>{flightLoading ? "…" : (flight?.flightDate || "-")}</strong>
          </div>
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "14px 0" }} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {/* Scan box */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb" }}>
          <h3>Scan Bag</h3>

          <input
            ref={inputRef}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Scan bag tag…"
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
            }}
          />

          <button
            onClick={handleScanSubmit}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "10px",
              borderRadius: 12,
              border: "1px solid #1d4ed8",
              background: "#2563eb",
              color: "white",
              fontWeight: 800,
            }}
          >
            Add Scan
          </button>

          {strictManifest && (
            <p style={{ marginTop: 8, fontSize: "0.8rem", color: "#b91c1c" }}>
              ⚠️ Strict Manifest ON
            </p>
          )}

          {msg && <p style={{ marginTop: 8, color: "#16a34a" }}>{msg}</p>}
          {err && <p style={{ marginTop: 8, color: "#b91c1c" }}>{err}</p>}
        </div>

        {/* List */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
          <h3>Bagroom Scans</h3>
          <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
            Total scanned: <strong>{loadingScans ? "…" : scans.length}</strong>
          </p>

          <div style={{ maxHeight: 320, overflow: "auto", marginTop: 8 }}>
            {loadingScans ? (
              <p style={{ color: "#6b7280" }}>Loading…</p>
            ) : scans.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No scans yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={th}>Tag</th>
                    <th style={{ ...th, textAlign: "right" }}>User</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s) => (
                    <tr key={s.id}>
                      <td style={td}><strong>{s.tag}</strong></td>
                      <td style={{ ...td, textAlign: "right", color: "#6b7280" }}>
                        {s.scannedBy?.username || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const th = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: "0.8rem",
  textTransform: "uppercase",
  color: "#6b7280",
};

const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
};

// src/pages/CounterScanPage.jsx

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

function cleanTag(tag) {
  return String(tag || "").replace(/\D+/g, "");
}

function normalizeStatus(s) {
  const v = String(s || "OPEN").trim().toUpperCase();

  return v === "OPEN" ||
    v === "RECEIVING" ||
    v === "LOADING" ||
    v === "LOADED"
    ? v
    : "OPEN";
}

const MIN_TAG = 10;
const AUTO_SUBMIT_MS = 90;

export default function CounterScanPage({
  flightId,
  user,
}) {

  const role = useMemo(
    () => normalizeRole(user?.role),
    [user]
  );

  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const savingRef = useRef(false);

  const [flight,setFlight]=useState(null);
  const [loadingFlight,setLoadingFlight]=useState(true);

  const [tagInput,setTagInput]=useState("");

  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");

  const [rows,setRows]=useState([]);
  const [loadingRows,setLoadingRows]=useState(true);
    useEffect(() => {
    if (!flightId) return;

    setLoadingFlight(true);

    const ref = doc(db, "flights", flightId);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setFlight(null);
          setLoadingFlight(false);
          return;
        }

        setFlight({ id: snap.id, ...snap.data() });
        setLoadingFlight(false);
      },
      (e) => {
        console.error("Counter flight snapshot error:", e);
        setFlight(null);
        setLoadingFlight(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (!flightId) return;

    setLoadingRows(true);

    const ref = collection(db, "flights", flightId, "counterScans");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        list.sort((a, b) => {
          const ta = a.createdAt?.seconds || 0;
          const tb = b.createdAt?.seconds || 0;
          return tb - ta;
        });

        setRows(list);
        setLoadingRows(false);
      },
      (e) => {
        console.error("Counter scans snapshot error:", e);
        setRows([]);
        setLoadingRows(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const isFlightLoaded = normalizeStatus(flight?.status) === "LOADED";

  const validateOtherFlight = async (tag) => {
    const tagRef = doc(db, "bagTags", tag);
    const snap = await getDoc(tagRef);

    if (!snap.exists()) {
      return { ok: true };
    }

    const existing = snap.data();

    if (existing.flightId && existing.flightId !== flightId) {
      return {
        ok: false,
        message:
          `❌ This bag tag belongs to another flight/date.\n\n` +
          `Current flight: ${flight?.flightNumber || flightId} (${flight?.flightDate || "-"})\n` +
          `Registered flight: ${existing.flightNumber || existing.flightId} (${existing.flightDate || "-"})\n\n` +
          `Do NOT accept this bag for this flight.`,
      };
    }

    return { ok: true };
  };

  const saveTrackingEvent = async (tag) => {
    const eventRef = doc(
      db,
      "bagTags",
      tag,
      "events",
      `counter_${Date.now()}`
    );

    await setDoc(eventRef, {
      type: "COUNTER_SCAN",
      location: "counter",
      message: "Bag tag created / scanned at counter",
      tag,
      flightId,
      flightNumber: flight?.flightNumber || null,
      flightDate: flight?.flightDate || null,
      gate: flight?.gate || null,
      createdAt: serverTimestamp(),
      createdBy: {
        userId: user?.id || null,
        username: user?.username || null,
        role: user?.role || null,
      },
    });
  };
    const saveCounterScan = async (tag) => {
    const ref = doc(db, "flights", flightId, "counterScans", tag);
    const existing = await getDoc(ref);

    if (existing.exists()) {
      setErr(`Duplicate scan. Bag tag ${tag} was already scanned at Counter.`);
      setTagInput("");
      return false;
    }

    await setDoc(ref, {
      tag,
      location: "counter",
      createdAt: serverTimestamp(),
      scannedBy: {
        userId: user?.id || null,
        username: user?.username || null,
        role: user?.role || null,
      },
    });

    await setDoc(
      doc(db, "bagTags", tag),
      {
        tag,
        flightId,
        flightNumber: flight?.flightNumber || null,
        flightDate: flight?.flightDate || null,
        gate: flight?.gate || null,
        firstSeenAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        lastSeenLocation: "counter",
        lastSeenBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
      },
      { merge: true }
    );

    await saveTrackingEvent(tag);

    return true;
  };

  const handleScanSubmit = async (forcedValue) => {
    if (savingRef.current) return;

    setMsg("");
    setErr("");

    if (!flight) {
      setErr("Flight not loaded.");
      return;
    }

    if (isFlightLoaded) {
      setErr("This flight is already LOADED. Counter scan is locked.");
      setTagInput("");
      return;
    }

    const tag = cleanTag(forcedValue ?? tagInput);

    if (!tag) return;

    if (tag.length < MIN_TAG) {
      setErr("Invalid bag tag. Bag tag must have 10 digits.");
      return;
    }

    try {
      savingRef.current = true;

      const check = await validateOtherFlight(tag);

      if (!check.ok) {
        setErr(check.message);
        setTagInput("");
        return;
      }

      const saved = await saveCounterScan(tag);

      if (!saved) return;

      setMsg(`Counter scan saved ✅ ${tag}`);
      setTagInput("");

      if (inputRef.current) {
        inputRef.current.focus();
      }
    } catch (e) {
      console.error("Counter scan error:", e);
      setErr("Could not save counter scan. Check Firestore rules/connection.");
    } finally {
      savingRef.current = false;
    }
  };

  const scheduleAutoSubmit = (value) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const cleaned = cleanTag(value);

    timerRef.current = setTimeout(() => {
      if (cleaned.length >= MIN_TAG) {
        handleScanSubmit(cleaned);
      }
    }, AUTO_SUBMIT_MS);
  };

  const handleChange = (e) => {
    const value = e.target.value;
    setTagInput(value);

    if (!isFlightLoaded) {
      scheduleAutoSubmit(value);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      handleScanSubmit();
    }
  };
    return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Counter Scan</h2>

          <p style={{ marginTop: 6, color: "#6b7280", fontSize: "0.9rem" }}>
            Scan or enter bag tags created at the ticket counter.
          </p>

          {isFlightLoaded && (
            <p style={{ margin: "8px 0 0", color: "#16a34a", fontWeight: 900 }}>
              ✅ Flight Loaded / Counter scan locked
            </p>
          )}
        </div>

        <div style={{ textAlign: "right", fontSize: "0.9rem" }}>
          <div>
            Flight:{" "}
            <strong>
              {loadingFlight ? "…" : flight?.flightNumber || flightId}
            </strong>
          </div>

          <div style={{ color: "#6b7280" }}>
            Date:{" "}
            <strong>
              {loadingFlight ? "…" : flight?.flightDate || "-"}
            </strong>
          </div>

          <div style={{ color: "#6b7280" }}>
            Gate:{" "}
            <strong>
              {loadingFlight ? "…" : flight?.gate || "-"}
            </strong>
          </div>
        </div>
      </div>

      <hr
        style={{
          border: "none",
          borderTop: "1px solid #e5e7eb",
          margin: "14px 0",
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            background: "#f9fafb",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Scan Bag Tag</h3>

          <label
            style={{
              display: "block",
              fontSize: "0.85rem",
              color: "#374151",
              marginBottom: 6,
            }}
          >
            Bag Tag Number
          </label>

          <input
            ref={inputRef}
            value={tagInput}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isFlightLoaded}
            placeholder={isFlightLoaded ? "Flight loaded / locked" : "Scan bag tag…"}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: isFlightLoaded ? "#f3f4f6" : "white",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: "0.95rem",
            }}
          />

          <button
            onClick={() => handleScanSubmit()}
            disabled={isFlightLoaded}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #2563eb",
              background: isFlightLoaded ? "#93c5fd" : "#2563eb",
              color: "white",
              fontWeight: 900,
              cursor: isFlightLoaded ? "not-allowed" : "pointer",
            }}
          >
            Add Counter Scan
          </button>

          <p style={{ marginTop: 10, color: "#6b7280", fontSize: "0.8rem" }}>
            Tip: scanner saves automatically after reading the bag tag.
          </p>

          {msg && (
            <p style={{ marginTop: 8, color: "#16a34a", fontWeight: 800 }}>
              {msg}
            </p>
          )}

          {err && (
            <p
              style={{
                marginTop: 8,
                color: "#b91c1c",
                fontWeight: 800,
                whiteSpace: "pre-wrap",
              }}
            >
              {err}
            </p>
          )}
        </section>
                <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Counter Scans</h3>

          <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
            Total scanned at counter:{" "}
            <strong>{loadingRows ? "…" : rows.length}</strong>
          </p>

          <div style={{ maxHeight: 360, overflow: "auto", marginTop: 8 }}>
            {loadingRows ? (
              <p style={{ color: "#6b7280" }}>Loading…</p>
            ) : rows.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No counter scans yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={th}>Bag Tag</th>
                    <th style={{ ...th, textAlign: "right" }}>User</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>
                        <strong>{r.tag || r.id}</strong>
                      </td>

                      <td style={{ ...td, textAlign: "right", color: "#6b7280" }}>
                        {r.scannedBy?.username || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
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
  letterSpacing: "0.04em",
  color: "#6b7280",
};

const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
};

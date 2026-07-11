// src/pages/CounterScanPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
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

function normalizeBagType(value) {
  const v = String(value || "CHECKED_BAG").trim().toUpperCase();

  return v === "CHECKED_BAG" ||
    v === "GATE_CHECK" ||
    v === "OVERSIZE"
    ? v
    : "CHECKED_BAG";
}

function getBagTypeLabel(value) {
  const v = normalizeBagType(value);

  if (v === "GATE_CHECK") return "Gate Check";
  if (v === "OVERSIZE") return "Oversize";

  return "Checked Bag";
}

const MIN_TAG = 10;
const AUTO_SUBMIT_MS = 90;

export default function CounterScanPage({ flightId, user }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);

  const canDeleteScans =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "supervisor" ||
    role === "gate_controller" ||
    role === "agent";

  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const savingRef = useRef(false);

  const [flight, setFlight] = useState(null);
  const [loadingFlight, setLoadingFlight] = useState(true);

  const [tagInput, setTagInput] = useState("");

  const [bagType, setBagType] = useState(
    localStorage.getItem(`counterBagType_${flightId}`) || "CHECKED_BAG"
  );

  const selectedBagType = normalizeBagType(bagType);

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(true);

  const [bagroomRows, setBagroomRows] = useState([]);
  const [loadingBagroomRows, setLoadingBagroomRows] = useState(true);

  const [deletingCounterTag, setDeletingCounterTag] = useState("");
  const [deletingBagroomTag, setDeletingBagroomTag] = useState("");

  useEffect(() => {
    if (!flightId) {
      setFlight(null);
      setLoadingFlight(false);
      return;
    }

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

        setFlight({
          id: snap.id,
          ...snap.data(),
        });

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
    if (!flightId) {
      setRows([]);
      setLoadingRows(false);
      return;
    }

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
    if (!flightId) {
      setBagroomRows([]);
      setLoadingBagroomRows(false);
      return;
    }

    setLoadingBagroomRows(true);

    const ref = collection(db, "flights", flightId, "bagroomScans");

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

        setBagroomRows(list);
        setLoadingBagroomRows(false);
      },
      (e) => {
        console.error("Counter page Bagroom snapshot error:", e);
        setBagroomRows([]);
        setLoadingBagroomRows(false);
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
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const isFlightLoaded = normalizeStatus(flight?.status) === "LOADED";

  const bagroomTagSet = useMemo(() => {
    return new Set(
      bagroomRows
        .map((row) => cleanTag(row.tag || row.id))
        .filter(Boolean)
    );
  }, [bagroomRows]);

  const counterTagSet = useMemo(() => {
    return new Set(
      rows
        .map((row) => cleanTag(row.tag || row.id))
        .filter(Boolean)
    );
  }, [rows]);

  const counterReceivedCount = useMemo(() => {
    return rows.filter((row) => {
      const tag = cleanTag(row.tag || row.id);
      return tag && bagroomTagSet.has(tag);
    }).length;
  }, [rows, bagroomTagSet]);

  const counterPendingCount = Math.max(
    0,
    rows.length - counterReceivedCount
  );

  const bagroomWithoutCounterCount = useMemo(() => {
    return bagroomRows.filter((row) => {
      const tag = cleanTag(row.tag || row.id);
      return tag && !counterTagSet.has(tag);
    }).length;
  }, [bagroomRows, counterTagSet]);

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
          `Current flight: ${flight?.flightNumber || flightId} ` +
          `(${flight?.flightDate || "-"})\n` +
          `Registered flight: ${existing.flightNumber || existing.flightId} ` +
          `(${existing.flightDate || "-"})\n\n` +
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
      message:
        `Bag tag created / scanned at counter · ` +
        getBagTypeLabel(selectedBagType),
      tag,
      bagType: selectedBagType,
      bagTypeLabel: getBagTypeLabel(selectedBagType),
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
      setErr(
        `Duplicate scan. Bag tag ${tag} was already scanned at Counter.`
      );
      setTagInput("");
      return false;
    }

    await setDoc(ref, {
      tag,
      location: "counter",
      bagType: selectedBagType,
      bagTypeLabel: getBagTypeLabel(selectedBagType),
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
        bagType: selectedBagType,
        bagTypeLabel: getBagTypeLabel(selectedBagType),
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
    const deleteCounterScan = async (row) => {
    const tag = cleanTag(row?.tag || row?.id);

    if (!tag) return;

    if (!canDeleteScans) {
      setErr("You do not have permission to delete Counter scans.");
      return;
    }

    if (isFlightLoaded) {
      setErr("This flight is already LOADED. Counter scans are locked.");
      return;
    }

    const confirmed = window.confirm(
      `Delete Counter scan?\n\nBag Tag: ${tag}\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      setDeletingCounterTag(tag);
      setErr("");
      setMsg("");

      await deleteDoc(
        doc(db, "flights", flightId, "counterScans", tag)
      );

      const bagroomSnap = await getDoc(
        doc(db, "flights", flightId, "bagroomScans", tag)
      );

      const aircraftSnap = await getDoc(
        doc(db, "flights", flightId, "aircraftScans", tag)
      );

      // Only delete the global tag index if the bag did not
      // advance to Bagroom or Aircraft.
      if (!bagroomSnap.exists() && !aircraftSnap.exists()) {
        await deleteDoc(doc(db, "bagTags", tag));
      }

      setMsg(`Counter scan deleted ✅ ${tag}`);
    } catch (e) {
      console.error("Delete Counter scan error:", e);
      setErr("Could not delete Counter scan. Check Firestore rules/connection.");
    } finally {
      setDeletingCounterTag("");
    }
  };

  const deleteBagroomScan = async (row) => {
    const tag = cleanTag(row?.tag || row?.id);

    if (!tag) return;

    if (!canDeleteScans) {
      setErr("You do not have permission to delete Bagroom scans.");
      return;
    }

    if (isFlightLoaded) {
      setErr("This flight is already LOADED. Bagroom scans are locked.");
      return;
    }

    const confirmed = window.confirm(
      `Delete Bagroom scan?\n\nBag Tag: ${tag}\n` +
        `Cart: ${row?.cartNumber || "-"}\n\n` +
        `This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      setDeletingBagroomTag(tag);
      setErr("");
      setMsg("");

      await deleteDoc(
        doc(db, "flights", flightId, "bagroomScans", tag)
      );

      const counterSnap = await getDoc(
        doc(db, "flights", flightId, "counterScans", tag)
      );

      const aircraftSnap = await getDoc(
        doc(db, "flights", flightId, "aircraftScans", tag)
      );

      // If the bag is already on Aircraft, do not overwrite
      // the current tracking location.
      if (!aircraftSnap.exists() && counterSnap.exists()) {
        const counterData = counterSnap.data();

        await setDoc(
          doc(db, "bagTags", tag),
          {
            tag,
            flightId,
            flightNumber: flight?.flightNumber || null,
            flightDate: flight?.flightDate || null,
            gate: flight?.gate || null,
            bagType: counterData?.bagType || "CHECKED_BAG",
            bagTypeLabel:
              counterData?.bagTypeLabel ||
              getBagTypeLabel(counterData?.bagType),
            lastSeenAt: counterData?.createdAt || serverTimestamp(),
            lastSeenLocation: "counter",
            lastSeenCart: null,
            lastSeenBy: counterData?.scannedBy || null,
          },
          { merge: true }
        );
      }

      if (!aircraftSnap.exists() && !counterSnap.exists()) {
        await deleteDoc(doc(db, "bagTags", tag));
      }

      setMsg(`Bagroom scan deleted ✅ ${tag}`);
    } catch (e) {
      console.error("Delete Bagroom scan error:", e);
      setErr("Could not delete Bagroom scan. Check Firestore rules/connection.");
    } finally {
      setDeletingBagroomTag("");
    }
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

    if (tag.length !== MIN_TAG) {
      setErr("Invalid bag tag. Bag tag must have exactly 10 digits.");
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

      setMsg(
        `Counter scan saved ✅ ${tag} · ${getBagTypeLabel(selectedBagType)}`
      );

      setTagInput("");

      if (inputRef.current) {
        inputRef.current.focus();
      }
    } catch (e) {
      console.error("Counter scan error:", e);
      setErr(
        "Could not save Counter scan. Check Firestore rules/connection."
      );
    } finally {
      savingRef.current = false;
    }
  };

  const scheduleAutoSubmit = (value) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const cleaned = cleanTag(value);

    timerRef.current = setTimeout(() => {
      if (cleaned.length === MIN_TAG) {
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

          <p
            style={{
              marginTop: 6,
              color: "#6b7280",
              fontSize: "0.9rem",
            }}
          >
            Scan or enter bag tags created at the ticket counter.
          </p>

          {isFlightLoaded && (
            <p
              style={{
                margin: "8px 0 0",
                color: "#16a34a",
                fontWeight: 900,
              }}
            >
              ✅ Flight Loaded / Counter scan locked
            </p>
          )}
        </div>

        <div style={{ textAlign: "right", fontSize: "0.9rem" }}>
          <div>
            Flight:{" "}
            <strong>
              {loadingFlight
                ? "…"
                : flight?.flightNumber || flightId}
            </strong>
          </div>

          <div style={{ color: "#6b7280" }}>
            Date:{" "}
            <strong>
              {loadingFlight
                ? "…"
                : flight?.flightDate || "-"}
            </strong>
          </div>

          <div style={{ color: "#6b7280" }}>
            Gate:{" "}
            <strong>
              {loadingFlight
                ? "…"
                : flight?.gate || "-"}
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
          gridTemplateColumns:
            "repeat(auto-fit, minmax(280px, 1fr))",
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
            Bag Type
          </label>

          <select
            value={selectedBagType}
            onChange={(e) => {
              const next = normalizeBagType(e.target.value);

              setBagType(next);

              localStorage.setItem(
                `counterBagType_${flightId}`,
                next
              );

              if (inputRef.current) {
                inputRef.current.focus();
              }
            }}
            disabled={isFlightLoaded}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: isFlightLoaded
                ? "#f3f4f6"
                : "white",
              fontWeight: 800,
              marginBottom: 12,
            }}
          >
            <option value="CHECKED_BAG">Checked Bag</option>
            <option value="GATE_CHECK">Gate Check</option>
            <option value="OVERSIZE">Oversize</option>
          </select>

          <div
            style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 12,
              border: "1px solid #dbeafe",
              background: "#eff6ff",
              color: "#1d4ed8",
              fontWeight: 900,
            }}
          >
            Selected: {getBagTypeLabel(selectedBagType)}
          </div>
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
            placeholder={
              isFlightLoaded
                ? "Flight loaded / locked"
                : "Scan bag tag…"
            }
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: isFlightLoaded
                ? "#f3f4f6"
                : "white",
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
              background: isFlightLoaded
                ? "#93c5fd"
                : "#2563eb",
              color: "white",
              fontWeight: 900,
              cursor: isFlightLoaded
                ? "not-allowed"
                : "pointer",
            }}
          >
            Add Counter Scan
          </button>

          <p
            style={{
              marginTop: 10,
              color: "#6b7280",
              fontSize: "0.8rem",
            }}
          >
            Tip: scanner saves automatically after reading the bag tag.
          </p>

          {msg && (
            <p
              style={{
                marginTop: 8,
                color: "#16a34a",
                fontWeight: 800,
              }}
            >
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
          <h3 style={{ marginTop: 0 }}>
            Counter → Bagroom Match
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",
              gap: 8,
              marginTop: 10,
            }}
          >
            <SummaryBox
              label="Counter"
              value={loadingRows ? "…" : rows.length}
              background="#eff6ff"
              color="#1d4ed8"
            />

            <SummaryBox
              label="Received"
              value={
                loadingRows || loadingBagroomRows
                  ? "…"
                  : counterReceivedCount
              }
              background="#dcfce7"
              color="#166534"
            />

            <SummaryBox
              label="Pending"
              value={
                loadingRows || loadingBagroomRows
                  ? "…"
                  : counterPendingCount
              }
              background={
                counterPendingCount === 0
                  ? "#dcfce7"
                  : "#fee2e2"
              }
              color={
                counterPendingCount === 0
                  ? "#166534"
                  : "#991b1b"
              }
            />
          </div>

          <p
            style={{
              color: "#6b7280",
              fontSize: "0.82rem",
              marginTop: 10,
            }}
          >
            Green = received in Bagroom · Red = still pending
          </p>

          <div
            style={{
              maxHeight: 360,
              overflow: "auto",
              marginTop: 8,
            }}
          >
            {loadingRows || loadingBagroomRows ? (
              <p style={{ color: "#6b7280" }}>
                Loading Counter and Bagroom scans…
              </p>
            ) : rows.length === 0 ? (
              <p style={{ color: "#6b7280" }}>
                No Counter scans yet.
              </p>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={th}>Bag Tag</th>
                    <th style={th}>Type</th>
                    <th style={th}>Status</th>
                    <th style={th}>User</th>
                    <th
                      style={{
                        ...th,
                        textAlign: "right",
                      }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row) => {
                    const tag = cleanTag(
                      row.tag || row.id
                    );

                    const received =
                      bagroomTagSet.has(tag);

                    const busy =
                      deletingCounterTag === tag;

                    return (
                      <tr
                        key={row.id}
                        style={{
                          background: received
                            ? "#f0fdf4"
                            : "#fef2f2",
                        }}
                      >
                        <td style={td}>
                          <strong
                            style={{
                              color: received
                                ? "#166534"
                                : "#991b1b",
                            }}
                          >
                            {tag}
                          </strong>
                        </td>

                        <td style={td}>
                          {row.bagTypeLabel ||
                            getBagTypeLabel(
                              row.bagType
                            )}
                        </td>

                        <td style={td}>
                          <span
                            style={{
                              display: "inline-flex",
                              padding: "4px 8px",
                              borderRadius: 999,
                              background: received
                                ? "#dcfce7"
                                : "#fee2e2",
                              color: received
                                ? "#166534"
                                : "#991b1b",
                              border: `1px solid ${
                                received
                                  ? "#86efac"
                                  : "#fca5a5"
                              }`,
                              fontSize: "0.75rem",
                              fontWeight: 900,
                            }}
                          >
                            {received
                              ? "RECEIVED"
                              : "PENDING"}
                          </span>
                        </td>

                        <td
                          style={{
                            ...td,
                            color: "#6b7280",
                          }}
                        >
                          {row.scannedBy?.username ||
                            "-"}
                        </td>

                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                          }}
                        >
                          {canDeleteScans && (
                            <button
                              onClick={() =>
                                deleteCounterScan(row)
                              }
                              disabled={
                                busy || isFlightLoaded
                              }
                              style={{
                                padding: "5px 9px",
                                borderRadius: 999,
                                border:
                                  "1px solid #ef4444",
                                background:
                                  busy ||
                                  isFlightLoaded
                                    ? "#fca5a5"
                                    : "#ef4444",
                                color: "white",
                                fontWeight: 800,
                                cursor:
                                  busy ||
                                  isFlightLoaded
                                    ? "not-allowed"
                                    : "pointer",
                                opacity: busy ? 0.7 : 1,
                              }}
                            >
                              {busy
                                ? "Deleting…"
                                : "Delete"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <hr
            style={{
              border: "none",
              borderTop: "1px solid #e5e7eb",
              margin: "16px 0",
            }}
          />

          <h3 style={{ margin: 0 }}>
            Bagroom Received
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(2, minmax(0, 1fr))",
              gap: 8,
              marginTop: 10,
            }}
          >
            <SummaryBox
              label="Bagroom Total"
              value={
                loadingBagroomRows
                  ? "…"
                  : bagroomRows.length
              }
              background="#dcfce7"
              color="#166534"
            />

            <SummaryBox
              label="Without Counter"
              value={
                loadingRows || loadingBagroomRows
                  ? "…"
                  : bagroomWithoutCounterCount
              }
              background={
                bagroomWithoutCounterCount === 0
                  ? "#f9fafb"
                  : "#ffedd5"
              }
              color={
                bagroomWithoutCounterCount === 0
                  ? "#374151"
                  : "#9a3412"
              }
            />
          </div>

          <p
            style={{
              color: "#6b7280",
              fontSize: "0.82rem",
              marginTop: 10,
            }}
          >
            Orange rows were received in Bagroom without a matching Counter scan.
          </p>

          <div
            style={{
              maxHeight: 280,
              overflow: "auto",
              marginTop: 8,
            }}
          >
            {loadingBagroomRows ? (
              <p style={{ color: "#6b7280" }}>
                Loading Bagroom scans…
              </p>
            ) : bagroomRows.length === 0 ? (
              <p style={{ color: "#6b7280" }}>
                No bags received yet.
              </p>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={th}>Bag Tag</th>
                    <th style={th}>Cart</th>
                    <th style={th}>Match</th>
                    <th style={th}>User</th>
                    <th
                      style={{
                        ...th,
                        textAlign: "right",
                      }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {bagroomRows.map((row) => {
                    const tag = cleanTag(
                      row.tag || row.id
                    );

                    const existsAtCounter =
                      counterTagSet.has(tag);

                    const busy =
                      deletingBagroomTag === tag;

                    return (
                      <tr
                        key={row.id}
                        style={{
                          background:
                            existsAtCounter
                              ? "#f0fdf4"
                              : "#fff7ed",
                        }}
                      >
                        <td style={td}>
                          <strong>{tag}</strong>
                        </td>

                        <td style={td}>
                          {row.cartNumber || "-"}
                        </td>

                        <td style={td}>
                          <span
                            style={{
                              display: "inline-flex",
                              padding: "4px 8px",
                              borderRadius: 999,
                              background:
                                existsAtCounter
                                  ? "#dcfce7"
                                  : "#ffedd5",
                              color:
                                existsAtCounter
                                  ? "#166534"
                                  : "#9a3412",
                              border: `1px solid ${
                                existsAtCounter
                                  ? "#86efac"
                                  : "#fdba74"
                              }`,
                              fontSize: "0.75rem",
                              fontWeight: 900,
                            }}
                          >
                            {existsAtCounter
                              ? "MATCHED"
                              : "NO COUNTER"}
                          </span>
                        </td>

                        <td
                          style={{
                            ...td,
                            color: "#6b7280",
                          }}
                        >
                          {row.scannedBy?.username ||
                            "-"}
                        </td>

                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                          }}
                        >
                          {canDeleteScans && (
                            <button
                              onClick={() =>
                                deleteBagroomScan(row)
                              }
                              disabled={
                                busy || isFlightLoaded
                              }
                              style={{
                                padding: "5px 9px",
                                borderRadius: 999,
                                border:
                                  "1px solid #ef4444",
                                background:
                                  busy ||
                                  isFlightLoaded
                                    ? "#fca5a5"
                                    : "#ef4444",
                                color: "white",
                                fontWeight: 800,
                                cursor:
                                  busy ||
                                  isFlightLoaded
                                    ? "not-allowed"
                                    : "pointer",
                                opacity: busy ? 0.7 : 1,
                              }}
                            >
                              {busy
                                ? "Deleting…"
                                : "Delete"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
                  </section>
      </div>
    </div>
  );
}

function SummaryBox({ label, value, background, color }) {
  return (
    <div
      style={{
        padding: 9,
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        background,
        color,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "0.72rem",
          fontWeight: 800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: "1.2rem",
          fontWeight: 900,
        }}
      >
        {value}
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
  whiteSpace: "nowrap",
};

const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
  verticalAlign: "middle",
};

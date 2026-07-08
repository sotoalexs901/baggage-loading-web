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
import Modal from "../components/Modal.jsx";
import { useModal } from "../components/useModal.js";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function cleanTagValue(v) {
  return String(v || "").replace(/[\r\n]+/g, "").trim();
}

function normalizeCartNumber(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStatus(s) {
  const v = String(s || "OPEN").trim().toUpperCase();

  return v === "OPEN" || v === "RECEIVING" || v === "LOADING" || v === "LOADED"
    ? v
    : "OPEN";
}

const MIN_TAG_LEN = 6;
const AUTO_SUBMIT_IDLE_MS = 90;

export default function BagroomScanPage({ flightId, user }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);
  const isGateController = role === "gate_controller";

  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] = useState(true);

  const [cartNumber, setCartNumber] = useState(
    localStorage.getItem(`bagroomCart_${flightId}`) || ""
  );

  const selectedCart = normalizeCartNumber(cartNumber);

  const [tagInput, setTagInput] = useState("");
  const inputRef = useRef(null);

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [scans, setScans] = useState([]);
  const [loadingScans, setLoadingScans] = useState(true);

  const [strictManifest, setStrictManifest] = useState(false);

  const autoTimerRef = useRef(null);
  const isSubmittingRef = useRef(false);

  const { modal, show, close } = useModal();

  const popup = (title, message, tone = "info") => {
    show({
      title,
      tone,
      content: <div style={{ whiteSpace: "pre-wrap" }}>{message}</div>,
      confirmText: "OK",
      onConfirm: close,
      onCancel: close,
    });
  };

  const groupedByCart = useMemo(() => {
    const groups = {};

    for (const scan of scans) {
      const cart = normalizeCartNumber(scan.cartNumber) || "NO CART";

      if (!groups[cart]) {
        groups[cart] = [];
      }

      groups[cart].push(scan);
    }

    return groups;
  }, [scans]);

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

  useEffect(() => {
    if (!flightId) return;

    setLoadingScans(true);

    const ref = collection(db, "flights", flightId, "bagroomScans");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

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

  useEffect(() => {
    return () => {
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
      }
    };
  }, []);

  const isLoadingCompleted =
    Boolean(flight?.aircraftLoadingCompleted) ||
    normalizeStatus(flight?.status) === "LOADED";

  const ensureStatusReceiving = async () => {
    if (!flight) return;

    const current = normalizeStatus(flight.status);

    if (current === "LOADING" || current === "LOADED") return;
    if (current === "RECEIVING") return;

    await setDoc(
      doc(db, "flights", flightId),
      {
        status: "RECEIVING",
        statusUpdatedAt: serverTimestamp(),
        statusUpdatedBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
      },
      { merge: true }
    );
  };

  const saveCartToFlight = async () => {
    if (!selectedCart || !flightId) return;

    const existingCarts = Array.isArray(flight?.cartNumbers)
      ? flight.cartNumbers.map(normalizeCartNumber).filter(Boolean)
      : [];

    if (existingCarts.includes(selectedCart)) return;

    const nextCarts = [...existingCarts, selectedCart].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true })
    );

    await setDoc(
      doc(db, "flights", flightId),
      {
        cartNumbers: nextCarts,
        cartNumbersUpdatedAt: serverTimestamp(),
        cartNumbersUpdatedBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
      },
      { merge: true }
    );
  };

  const validateAgainstManifest = async () => {
    return { ok: true };
  };

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
          `Registered flight: ${existing.flightNumber || existing.flightId} (${existing.flightDate || "-"})\n\n` +
          `Do NOT accept this bag for this flight.`,
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
        lastSeenCart: selectedCart || null,
        lastSeenBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
        firstSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const saveTrackingEvent = async (tag) => {
    const eventRef = doc(
      db,
      "bagTags",
      tag,
      "events",
      `bagroom_${Date.now()}`
    );

    await setDoc(eventRef, {
      type: "BAGROOM_SCAN",
      location: "bagroom",
      message: "Bag received/scanned in Bagroom",
      tag,
      cartNumber: selectedCart || null,
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
    const saveBagroomScan = async (tag) => {
    const ref = doc(db, "flights", flightId, "bagroomScans", tag);
    const existing = await getDoc(ref);

    if (existing.exists()) {
      popup(
        "Duplicate scan",
        "⚠️ Bag already scanned in Bagroom.",
        "warning"
      );
      return false;
    }

    await setDoc(ref, {
      tag,
      cartNumber: selectedCart,
      createdAt: serverTimestamp(),
      scannedBy: {
        userId: user?.id || null,
        username: user?.username || null,
        role: user?.role || null,
      },
    });

    return true;
  };

  const handleScanSubmit = async (forcedTag) => {
    if (isSubmittingRef.current) return;

    setMsg("");
    setErr("");

    if (isLoadingCompleted) {
      popup(
        "Locked",
        "⚠️ Aircraft loading is already completed for this flight. Bagroom scanning is locked.",
        "warning"
      );
      setTagInput("");
      return;
    }

    if (!selectedCart) {
      popup(
        "Cart required",
        "Please enter or select a cart number before scanning bags.",
        "warning"
      );
      return;
    }

    const tag = cleanTagValue(forcedTag ?? tagInput);

    if (!tag) return;

    if (tag.length < MIN_TAG_LEN) return;

    try {
      isSubmittingRef.current = true;

      if (!flight) {
        setErr("Flight not loaded.");
        return;
      }

      const manifest = await validateAgainstManifest(tag);

      if (!manifest.ok) {
        popup("Not in Manifest", manifest.message, "danger");
        setTagInput("");
        return;
      }

      const cross = await validateAgainstOtherFlight(tag);

      if (!cross.ok) {
        popup("Wrong Flight", cross.message, "danger");
        setTagInput("");
        return;
      }

      await saveCartToFlight();

      const ok = await saveBagroomScan(tag);

      if (!ok) {
        setTagInput("");
        return;
      }

      await indexTag(tag);

      // ⭐ NUEVO TRACKING
      await saveTrackingEvent(tag);

      await ensureStatusReceiving();

      localStorage.setItem(
        `bagroomCart_${flightId}`,
        selectedCart
      );

      setMsg(`Scanned ✅ Cart ${selectedCart} · ${tag}`);
      setTagInput("");

      if (inputRef.current) {
        inputRef.current.focus();
      }
    } catch (e) {
      console.error(e);
      setErr("Scan failed. Check connection.");
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const scheduleAutoSubmit = (nextValue) => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
    }

    const cleaned = cleanTagValue(nextValue);

    if (
      /[\r\n]/.test(String(nextValue || "")) &&
      cleaned.length >= MIN_TAG_LEN
    ) {
      handleScanSubmit(cleaned);
      return;
    }

    autoTimerRef.current = setTimeout(() => {
      if (cleaned.length >= MIN_TAG_LEN) {
        handleScanSubmit(cleaned);
      }
    }, AUTO_SUBMIT_IDLE_MS);
  };

  const handleChange = (e) => {
    const value = e.target.value;

    setTagInput(value);

    if (!isLoadingCompleted) {
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
    
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Bagroom Scan</h2>
          <p style={{ marginTop: 6, color: "#6b7280", fontSize: "0.9rem" }}>
            Enter the cart number, then scan bags loaded into that cart.
          </p>

          {isLoadingCompleted && (
            <p style={{ margin: "8px 0 0", color: "#16a34a", fontWeight: 900 }}>
              ✅ Loading Completed (Locked)
            </p>
          )}
        </div>

        <div style={{ textAlign: "right", fontSize: "0.9rem" }}>
          <div>
            Flight: <strong>{flightLoading ? "…" : flight?.flightNumber || flightId}</strong>
          </div>
          <div style={{ color: "#6b7280" }}>
            Date: <strong>{flightLoading ? "…" : flight?.flightDate || "-"}</strong>
          </div>
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "14px 0" }} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb" }}>
          <h3 style={{ marginTop: 0 }}>Cart Number</h3>

          <input
            value={cartNumber}
            onChange={(e) => {
              const value = normalizeCartNumber(e.target.value);
              setCartNumber(value);
              localStorage.setItem(`bagroomCart_${flightId}`, value);
            }}
            disabled={isLoadingCompleted}
            placeholder="Enter cart number, e.g. 1, 2, 3, BULK"
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: isLoadingCompleted ? "#f3f4f6" : "white",
              fontWeight: 800,
            }}
          />

          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: selectedCart ? "#DCFCE7" : "#FEF3C7",
              color: selectedCart ? "#166534" : "#92400E",
              fontWeight: 900,
            }}
          >
            {selectedCart ? `Active Cart: ${selectedCart}` : "Cart number required before scanning."}
          </div>

          <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "14px 0" }} />

          <h3>Scan Bag</h3>

          <input
            ref={inputRef}
            value={tagInput}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isLoadingCompleted || !selectedCart}
            placeholder={
              isLoadingCompleted
                ? "Loading completed (locked)"
                : !selectedCart
                  ? "Enter cart number first"
                  : "Scan bag tag…"
            }
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: isLoadingCompleted || !selectedCart ? "#f3f4f6" : "white",
            }}
          />

          <button
            onClick={() => handleScanSubmit()}
            disabled={isLoadingCompleted || !selectedCart}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "10px",
              borderRadius: 12,
              border: "1px solid #1d4ed8",
              background: isLoadingCompleted || !selectedCart ? "#93c5fd" : "#2563eb",
              color: "white",
              fontWeight: 800,
              cursor: isLoadingCompleted || !selectedCart ? "not-allowed" : "pointer",
            }}
          >
            Add Scan
          </button>

          {strictManifest ? (
            <p style={{ marginTop: 8, fontSize: "0.8rem", color: "#b91c1c", fontWeight: 900 }}>
              ⚠️ Strict Manifest ON
            </p>
          ) : (
            <p style={{ marginTop: 8, fontSize: "0.8rem", color: "#6b7280" }}>
              Manifest not required yet. Bagroom can scan before manifest upload.
            </p>
          )}

          {msg && <p style={{ marginTop: 8, color: "#16a34a", fontWeight: 800 }}>{msg}</p>}
          {err && <p style={{ marginTop: 8, color: "#b91c1c", fontWeight: 800 }}>{err}</p>}
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Bagroom Scans</h3>

          <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
            Total scanned: <strong>{loadingScans ? "…" : scans.length}</strong>
          </p>

          {selectedCart && (
            <p style={{ color: "#374151", fontSize: "0.85rem" }}>
              Current cart: <strong>{selectedCart}</strong>
            </p>
          )}

          <div style={{ maxHeight: 420, overflow: "auto", marginTop: 8 }}>
            {loadingScans ? (
              <p style={{ color: "#6b7280" }}>Loading…</p>
            ) : scans.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No scans yet.</p>
            ) : (
              Object.keys(groupedByCart)
                .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
                .map((cart) => (
                  <div key={cart} style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        background: "#111827",
                        color: "white",
                        fontWeight: 900,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>Cart {cart}</span>
                      <span>{groupedByCart[cart].length} bags</span>
                    </div>

                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#f9fafb" }}>
                          <th style={th}>Tag</th>
                          <th style={th}>Cart</th>
                          <th style={{ ...th, textAlign: "right" }}>User</th>
                        </tr>
                      </thead>

                      <tbody>
                        {groupedByCart[cart].map((s) => (
                          <tr key={s.id}>
                            <td style={td}>
                              <strong>{s.tag}</strong>
                            </td>
                            <td style={td}>{s.cartNumber || "-"}</td>
                            <td style={{ ...td, textAlign: "right", color: "#6b7280" }}>
                              {s.scannedBy?.username || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
            )}
          </div>

          {!isGateController && (
            <p style={{ marginTop: 10, color: "#6b7280", fontSize: "0.8rem" }}>
              Tip: scans save automatically after the scanner finishes.
            </p>
          )}
        </div>
      </div>

      <Modal
        open={modal.open}
        title={modal.title}
        tone={modal.tone}
        confirmText={modal.confirmText}
        cancelText={modal.cancelText}
        showCancel={modal.showCancel}
        onConfirm={() => {
          if (typeof modal.onConfirm === "function") modal.onConfirm();
          else close();
        }}
        onCancel={() => {
          if (typeof modal.onCancel === "function") modal.onCancel();
          else close();
        }}
      >
        {modal.content}
      </Modal>
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
  color: "#111827",
};

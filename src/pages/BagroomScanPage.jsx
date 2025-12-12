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
  // quita saltos de linea que a veces manda el scanner
  return String(v || "").replace(/[\r\n]+/g, "").trim();
}

function normalizeStatus(s) {
  const v = String(s || "OPEN").trim().toUpperCase();
  return v === "OPEN" || v === "RECEIVING" || v === "LOADING" || v === "LOADED" ? v : "OPEN";
}

// ✅ Ajusta esto si tus tags son siempre 6–12 como en manifest
const MIN_TAG_LEN = 6;
const AUTO_SUBMIT_IDLE_MS = 90;

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

  // ✅ Auto-submit control
  const autoTimerRef = useRef(null);
  const isSubmittingRef = useRef(false);

  // Modal
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

  // limpiar timer al desmontar
  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, []);

  const isLoadingCompleted =
    Boolean(flight?.aircraftLoadingCompleted) || normalizeStatus(flight?.status) === "LOADED";

  /**
   * ✅ Auto status: first bagroom scan sets RECEIVING
   * Only if status is OPEN/RECEIVING (won’t override LOADING/LOADED)
   */
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
        firstSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const saveBagroomScan = async (tag) => {
    const ref = doc(db, "flights", flightId, "bagroomScans", tag);
    const existing = await getDoc(ref);

    if (existing.exists()) {
      popup("Duplicate scan", "⚠️ Bag already scanned in Bagroom.", "warning");
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

    const tag = cleanTagValue(forcedTag ?? tagInput);
    if (!tag) return;

    // ✅ minimo: evita dispararse con 1–2 chars si alguien teclea manual
    if (tag.length < MIN_TAG_LEN) return;

    try {
      isSubmittingRef.current = true;

      if (!flight) {
        setErr("Flight not loaded.");
        return;
      }

      const m = await validateAgainstManifest(tag);
      if (!m.ok) {
        popup("Not in manifest", m.message, "danger");
        setTagInput("");
        return;
      }

      const cross = await validateAgainstOtherFlight(tag);
      if (!cross.ok) {
        popup("Wrong flight/date", cross.message, "danger");
        setTagInput("");
        return;
      }

      const ok = await saveBagroomScan(tag);
      if (!ok) {
        setTagInput("");
        return;
      }

      await indexTag(tag);
      await ensureStatusReceiving();

      setMsg(`Scanned ✅  ${tag}`);
      setTagInput("");

      if (inputRef.current) inputRef.current.focus();
    } catch (e) {
      console.error(e);
      setErr("Scan failed. Check connection.");
    } finally {
      isSubmittingRef.current = false;
    }
  };

  // ✅ Auto-submit cuando el scanner termina (idle)
  const scheduleAutoSubmit = (nextValue) => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);

    const cleaned = cleanTagValue(nextValue);

    // Si el scanner manda \n o \r, normalmente ya terminó → submit inmediato
    if (/[\r\n]/.test(String(nextValue || "")) && cleaned.length >= MIN_TAG_LEN) {
      handleScanSubmit(cleaned);
      return;
    }

    autoTimerRef.current = setTimeout(() => {
      if (cleaned.length >= MIN_TAG_LEN) handleScanSubmit(cleaned);
    }, AUTO_SUBMIT_IDLE_MS);
  };

  const handleChange = (e) => {
    const v = e.target.value;
    setTagInput(v);
    if (!isLoadingCompleted) scheduleAutoSubmit(v);
  };

  // soporte para Enter / Tab si el scanner los manda
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
            Scan all bags received in Bagroom.
          </p>
          {isLoadingCompleted && (
            <p style={{ margin: "8px 0 0", color: "#16a34a", fontWeight: 900 }}>
              ✅ Loading Completed (Locked)
            </p>
          )}
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
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isLoadingCompleted}
            placeholder={isLoadingCompleted ? "Loading completed (locked)" : "Scan bag tag…"}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: isLoadingCompleted ? "#f3f4f6" : "white",
            }}
          />

          {/* ✅ Deja el botón por si alguien quiere hacerlo manual, pero ya no es necesario */}
          <button
            onClick={() => handleScanSubmit()}
            disabled={isLoadingCompleted}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "10px",
              borderRadius: 12,
              border: "1px solid #1d4ed8",
              background: isLoadingCompleted ? "#93c5fd" : "#2563eb",
              color: "white",
              fontWeight: 800,
              cursor: isLoadingCompleted ? "not-allowed" : "pointer",
            }}
          >
            Add Scan
          </button>

          {strictManifest && (
            <p style={{ marginTop: 8, fontSize: "0.8rem", color: "#b91c1c", fontWeight: 900 }}>
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

          {!isGateController && (
            <p style={{ marginTop: 10, color: "#6b7280", fontSize: "0.8rem" }}>
              Tip: ahora guarda automático al terminar el scan (no necesitas ENTER).
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

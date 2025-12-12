// src/pages/AircraftScanPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db, storage } from "../firebase";
import Modal from "../components/Modal.jsx";
import { useModal } from "../components/useModal.js";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ref as sRef, uploadBytes, getDownloadURL } from "firebase/storage";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function cleanTagValue(v) {
  // ✅ quita saltos de línea (scanners a veces mandan \n o \r)
  return String(v || "").replace(/[\r\n]+/g, "").trim();
}

function normalizeStatus(s) {
  const v = String(s || "OPEN").trim().toUpperCase();
  return v === "OPEN" || v === "RECEIVING" || v === "LOADING" || v === "LOADED" ? v : "OPEN";
}

function safeStr(v, fallback = "-") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

// ✅ Ajusta si tus bagtags son siempre de 6–12 dígitos
const MIN_TAG_LEN = 6;
const AUTO_SUBMIT_IDLE_MS = 90;

export default function AircraftScanPage({ flightId, user }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);
  const isGateController = role === "gate_controller";

  const canCompleteLoading =
    role === "supervisor" || role === "duty_manager" || role === "station_manager";

  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] = useState(true);

  // Zone selection
  const [zone, setZone] = useState(1);

  // Scan input
  const [tagInput, setTagInput] = useState("");
  const inputRef = useRef(null);

  // UI state
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Live list/count
  const [scans, setScans] = useState([]);
  const [loadingScans, setLoadingScans] = useState(true);

  // Bagroom total (only count)
  const [bagroomTotal, setBagroomTotal] = useState(0);
  const [loadingBagroomTotal, setLoadingBagroomTotal] = useState(true);

  // Strict manifest mode (read from flight.strictManifest)
  const [strictManifest, setStrictManifest] = useState(false);

  // Completion
  const [completing, setCompleting] = useState(false);
  const [completeMsg, setCompleteMsg] = useState("");

  // Export
  const [exporting, setExporting] = useState(false);

  // Modal
  const { modal, show, close } = useModal();

  // ✅ Auto-submit control
  const autoTimerRef = useRef(null);
  const isSubmittingRef = useRef(false);

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
        console.error("AircraftScanPage flight snapshot error:", e);
        setFlight(null);
        setFlightLoading(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  // Live aircraft scans
  useEffect(() => {
    if (!flightId) return;

    setLoadingScans(true);
    const ref = collection(db, "flights", flightId, "aircraftScans");

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
        console.error("AircraftScanPage scans snapshot error:", e);
        setScans([]);
        setLoadingScans(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  // Live bagroom total
  useEffect(() => {
    if (!flightId) return;

    setLoadingBagroomTotal(true);
    const ref = collection(db, "flights", flightId, "bagroomScans");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        setBagroomTotal(snap.size);
        setLoadingBagroomTotal(false);
      },
      (e) => {
        console.error("AircraftScanPage bagroom total error:", e);
        setBagroomTotal(0);
        setLoadingBagroomTotal(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // cleanup timer
  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, []);

  const isLoadingCompleted =
    Boolean(flight?.aircraftLoadingCompleted) || normalizeStatus(flight?.status) === "LOADED";

  /**
   * ✅ Auto status: first aircraft scan sets LOADING (unless already LOADED)
   */
  const ensureStatusLoading = async () => {
    if (!flight) return;
    const current = normalizeStatus(flight.status);
    if (current === "LOADED") return;
    if (current === "LOADING") return;

    await setDoc(
      doc(db, "flights", flightId),
      {
        status: "LOADING",
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

  /**
   * ✅ Cross-flight detection:
   * Global index: bagTags/{tag}
   */
  const validateAgainstOtherFlight = async (tag) => {
    const tagRef = doc(db, "bagTags", tag);
    const snap = await getDoc(tagRef);

    if (!snap.exists()) return { ok: true, firstTime: true };

    const existing = snap.data();
    if (existing.flightId && existing.flightId !== flightId) {
      const currentFlightNumber = flight?.flightNumber || flightId;
      const currentDate = flight?.flightDate || "(no date)";
      const otherFlightNumber = existing.flightNumber || existing.flightId;
      const otherDate = existing.flightDate || "(no date)";

      return {
        ok: false,
        message:
          `❌ Bag tag belongs to a different flight/date.\n\n` +
          `Current: ${currentFlightNumber} (${currentDate})\n` +
          `Registered: ${otherFlightNumber} (${otherDate})\n\n` +
          `Do NOT load this bag on this aircraft.`,
      };
    }

    return { ok: true, firstTime: false };
  };

  /**
   * ✅ Strict manifest validation:
   * Requires doc to exist: flights/{flightId}/allowedBagTags/{tag}
   */
  const validateAgainstManifest = async (tag) => {
    if (!strictManifest) return { ok: true };

    const allowRef = doc(db, "flights", flightId, "allowedBagTags", tag);
    const allowSnap = await getDoc(allowRef);

    if (!allowSnap.exists()) {
      const currentFlightNumber = flight?.flightNumber || flightId;
      const currentDate = flight?.flightDate || "(no date)";

      return {
        ok: false,
        message:
          `❌ Bag tag NOT found in this flight manifest.\n\n` +
          `Flight: ${currentFlightNumber} (${currentDate})\n` +
          `Tag: ${tag}\n\n` +
          `Check tag / passenger list. Do NOT load.`,
      };
    }

    return { ok: true };
  };

  const indexTagToThisFlight = async (tag, zoneNum) => {
    const tagRef = doc(db, "bagTags", tag);
    await setDoc(
      tagRef,
      {
        tag,
        flightId,
        flightNumber: flight?.flightNumber || null,
        flightDate: flight?.flightDate || null,
        lastSeenAt: serverTimestamp(),
        lastSeenLocation: "aircraft",
        lastSeenZone: zoneNum ?? null,
        firstSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const saveAircraftScan = async (tag, zoneNum) => {
    const scanRef = doc(db, "flights", flightId, "aircraftScans", tag);

    const existing = await getDoc(scanRef);
    if (existing.exists()) {
      const prev = existing.data();
      popup("Duplicate scan", `⚠️ Already scanned in Aircraft.\nZone: ${prev.zone ?? "-"}`, "warning");
      return false;
    }

    await setDoc(scanRef, {
      tag,
      zone: zoneNum,
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
    setCompleteMsg("");

    if (isLoadingCompleted) {
      popup("Locked", "⚠️ Loading is already completed for this flight. Scanning is locked.", "warning");
      setTagInput("");
      return;
    }

    const tag = cleanTagValue(forcedTag ?? tagInput);
    if (!tag) return;

    if (tag.length < MIN_TAG_LEN) return;

    const zoneNum = Number(zone);

    try {
      isSubmittingRef.current = true;

      if (!flight) {
        setErr("Flight not loaded yet. Try again.");
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

      const ok = await saveAircraftScan(tag, zoneNum);
      if (!ok) {
        setTagInput("");
        return;
      }

      await indexTagToThisFlight(tag, zoneNum);
      await ensureStatusLoading();

      setMsg(`Scanned ✅  Tag: ${tag}  (Zone ${zoneNum})`);
      setTagInput("");

      if (inputRef.current) inputRef.current.focus();
    } catch (e) {
      console.error(e);
      setErr("Scan failed. Check Firestore rules/connection.");
    } finally {
      isSubmittingRef.current = false;
    }
  };

  // ✅ Auto-submit cuando el scanner termina (idle)
  const scheduleAutoSubmit = (nextValue) => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);

    const cleaned = cleanTagValue(nextValue);

    // si el scanner manda newline, submit inmediato
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

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      handleScanSubmit();
    }
  };

  const missingNow =
    typeof flight?.checkedBagsTotal === "number"
      ? Math.max(0, flight.checkedBagsTotal - scans.length)
      : null;

  // ----- PDF helpers -----
  const computeZones = (rows) => {
    const z = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of rows) {
      const zn = Number(r.zone);
      if (zn >= 1 && zn <= 4) z[zn] += 1;
    }
    return z;
  };

  const buildPdf = ({ flightDoc, aircraftRows, bagroomCount }) => {
    const pdf = new jsPDF();

    const flightNumber = safeStr(flightDoc?.flightNumber, flightId);
    const flightDate = safeStr(flightDoc?.flightDate, "-");
    const gate = safeStr(flightDoc?.gate, "-");
    const aircraftType = safeStr(flightDoc?.aircraftType, "-");
    const status = safeStr(flightDoc?.status, "OPEN");

    const gateController = safeStr(flightDoc?.gateControllerOnDuty, "-");

    const supervisorOnDuty =
      safeStr(flightDoc?.statusUpdatedBy?.username, "") ||
      safeStr(flightDoc?.gateTotalUpdatedBy?.username, "") ||
      "-";

    const rampSupervisor = safeStr(user?.username, "-");

    const gateTotal =
      typeof flightDoc?.checkedBagsTotal === "number" ? flightDoc.checkedBagsTotal : null;

    const aircraftTotal = aircraftRows.length;
    const zones = computeZones(aircraftRows);

    const missing =
      gateTotal === null ? "—" : String(Math.max(0, gateTotal - aircraftTotal));

    pdf.setFontSize(14);
    pdf.text("Baggage Loading Control System (BLCS)", 14, 16);

    pdf.setFontSize(11);
    pdf.text(`Flight: ${flightNumber}`, 14, 26);
    pdf.text(`Date: ${flightDate}`, 14, 32);
    pdf.text(`Gate: ${gate}`, 14, 38);
    pdf.text(`Aircraft: ${aircraftType}`, 14, 44);
    pdf.text(`Status: ${status}`, 14, 50);

    pdf.text(`Supervisor on Duty: ${supervisorOnDuty}`, 110, 26);
    pdf.text(`Gate Controller on Duty: ${gateController}`, 110, 32);
    pdf.text(`Ramp Supervisor: ${rampSupervisor}`, 110, 38);

    autoTable(pdf, {
      startY: 58,
      head: [["Metric", "Value"]],
      body: [
        ["Gate checked total", gateTotal === null ? "—" : String(gateTotal)],
        ["Bagroom scanned", String(bagroomCount)],
        ["Aircraft scanned", String(aircraftTotal)],
        ["Zone 1", String(zones[1])],
        ["Zone 2", String(zones[2])],
        ["Zone 3", String(zones[3])],
        ["Zone 4", String(zones[4])],
        ["Missing to load (vs Gate total)", missing],
      ],
      styles: { fontSize: 10 },
      headStyles: { fillColor: [240, 240, 240] },
    });

    const tags = aircraftRows
      .slice()
      .sort((a, b) => String(a.tag).localeCompare(String(b.tag)))
      .map((r) => [String(r.tag), `Z${r.zone ?? "-"}`, r.scannedBy?.username || "-"]);

    autoTable(pdf, {
      startY: pdf.lastAutoTable.finalY + 8,
      head: [["Bag Tag", "Zone", "Scanned By"]],
      body: tags,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [240, 240, 240] },
    });

    pdf.setFontSize(9);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, 14, pdf.lastAutoTable.finalY + 10);

    return pdf;
  };

  const uploadPdfToStorage = async (pdfDoc) => {
    const flightNumber = safeStr(flight?.flightNumber, flightId);
    const flightDate = safeStr(flight?.flightDate, "unknown-date");
    const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);

    const fileName = `BLCS_${flightNumber}_${flightDate}_${stamp}.pdf`;
    const path = `flights/${flightId}/reports/${fileName}`;

    const r = sRef(storage, path);
    const blob = pdfDoc.output("blob");

    await uploadBytes(r, blob, {
      contentType: "application/pdf",
      customMetadata: {
        flightId: String(flightId),
        flightNumber: String(flightNumber),
        flightDate: String(flightDate),
        generatedBy: String(user?.username || ""),
      },
    });

    const url = await getDownloadURL(r);
    return { path, url, fileName };
  };

  const exportReportPdf = async ({ alsoMarkLoaded = false } = {}) => {
    if (!flight) {
      popup("Error", "Flight not loaded yet.", "danger");
      return;
    }

    try {
      setExporting(true);
      setErr("");
      setMsg("");
      setCompleteMsg("");

      const aircraftRows = scans;

      const pdfDoc = buildPdf({
        flightDoc: flight,
        aircraftRows,
        bagroomCount: loadingBagroomTotal ? 0 : bagroomTotal,
      });

      const downloadName = `BLCS_${safeStr(flight.flightNumber, flightId)}_${safeStr(
        flight.flightDate,
        "date"
      )}.pdf`;
      pdfDoc.save(downloadName);

      const uploaded = await uploadPdfToStorage(pdfDoc);

      await setDoc(
        doc(db, "flights", flightId, "reports", uploaded.fileName),
        {
          createdAt: serverTimestamp(),
          createdBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
          fileName: uploaded.fileName,
          storagePath: uploaded.path,
          downloadUrl: uploaded.url,
          snapshot: {
            gateTotal: typeof flight?.checkedBagsTotal === "number" ? flight.checkedBagsTotal : null,
            bagroomTotal: loadingBagroomTotal ? null : bagroomTotal,
            aircraftTotal: aircraftRows.length,
          },
        },
        { merge: true }
      );

      if (alsoMarkLoaded) {
        await setDoc(
          doc(db, "flights", flightId),
          {
            status: "LOADED",
            aircraftLoadingCompleted: true,
            aircraftLoadingCompletedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setMsg("✅ PDF exported and saved to flight reports.");
    } catch (e) {
      console.error(e);
      setErr("Failed to export PDF. Check Storage rules/connection.");
    } finally {
      setExporting(false);
    }
  };

  const handleLoadingCompleted = async () => {
    setCompleteMsg("");

    if (!flight) {
      popup("Error", "Flight not loaded yet.", "danger");
      return;
    }

    const checkedTotal = flight.checkedBagsTotal;

    if (typeof checkedTotal !== "number") {
      popup(
        "Gate total missing",
        "⚠️ Gate checked bags total not entered.\n\nGate Controller must enter total checked bags before completing loading.",
        "warning"
      );
      return;
    }

    const aircraftTotal = scans.length;
    const missing = checkedTotal - aircraftTotal;

    if (missing > 0) {
      popup(
        "Missing bags",
        `❌ LOADING NOT COMPLETED\n\nChecked bags (Gate): ${checkedTotal}\nLoaded on aircraft: ${aircraftTotal}\n\n⚠️ Missing ${missing} bag(s).\n\nContact Ramp / Bagroom before closing aircraft.`,
        "danger"
      );
      return;
    }

    show({
      title: "All bags loaded",
      tone: "success",
      showCancel: true,
      confirmText: "Mark Completed",
      cancelText: "Not yet",
      content: (
        <div style={{ whiteSpace: "pre-wrap" }}>
          {`✅ ALL BAGS LOADED\n\nChecked bags: ${checkedTotal}\nLoaded on aircraft: ${aircraftTotal}\n\nDo you want to mark loading as COMPLETED and generate the report PDF?`}
        </div>
      ),
      onCancel: close,
      onConfirm: async () => {
        close();
        try {
          setCompleting(true);

          await setDoc(
            doc(db, "flights", flightId),
            {
              aircraftLoadingCompleted: true,
              aircraftLoadingCompletedAt: serverTimestamp(),
              aircraftLoadedBags: aircraftTotal,
              aircraftLoadingCompletedBy: {
                userId: user?.id || null,
                username: user?.username || null,
                role: user?.role || null,
              },
              rampSupervisorOnDuty: user?.username || null,
              status: "LOADED",
              statusUpdatedAt: serverTimestamp(),
              statusUpdatedBy: {
                userId: user?.id || null,
                username: user?.username || null,
                role: user?.role || null,
              },
            },
            { merge: true }
          );

          await exportReportPdf();

          setCompleteMsg("✅ Aircraft loading completed successfully. Report saved.");
        } catch (e) {
          console.error(e);
          popup("Error", "Failed to mark loading completed / export PDF. Check connection/rules.", "danger");
        } finally {
          setCompleting(false);
        }
      },
    });
  };

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Aircraft Scan</h2>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
            Scan bags while loading by zone (1–4).
          </p>
          {isLoadingCompleted && (
            <p style={{ margin: "8px 0 0", color: "#16a34a", fontWeight: 900 }}>
              ✅ Loading Completed
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {/* Left */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb" }}>
          <h3 style={{ margin: 0 }}>Scan</h3>
          <p style={{ margin: "6px 0 10px", color: "#6b7280", fontSize: "0.9rem" }}>
            Select zone, then scan bag tag. (Auto-save — no Enter needed)
          </p>

          <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: 6 }}>
            Zone
          </label>
          <select
            value={zone}
            onChange={(e) => setZone(Number(e.target.value))}
            disabled={isLoadingCompleted}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #d1d5db" }}
          >
            <option value={1}>Zone 1</option>
            <option value={2}>Zone 2</option>
            <option value={3}>Zone 3</option>
            <option value={4}>Zone 4</option>
          </select>

          <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginTop: 12, marginBottom: 6 }}>
            Bag Tag
          </label>
          <input
            ref={inputRef}
            value={tagInput}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isLoadingCompleted}
            placeholder={isLoadingCompleted ? "Loading completed (locked)" : "Scan bag tag…"}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: isLoadingCompleted ? "#f3f4f6" : "white",
            }}
          />

          {/* Botón queda como fallback manual */}
          <button
            onClick={() => handleScanSubmit()}
            disabled={isLoadingCompleted}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "10px 12px",
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

          <button
            onClick={() => exportReportPdf()}
            disabled={exporting || !flight || loadingScans}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #111827",
              background: "#111827",
              color: "white",
              fontWeight: 900,
              cursor: (exporting || !flight || loadingScans) ? "not-allowed" : "pointer",
              opacity: (exporting || !flight || loadingScans) ? 0.7 : 1,
            }}
          >
            {exporting ? "Exporting…" : "Export PDF Report"}
          </button>

          {strictManifest && (
            <p style={{ marginTop: 10, color: "#b91c1c", fontSize: "0.85rem", fontWeight: 900 }}>
              ⚠️ Strict Manifest ON
            </p>
          )}

          {msg && <p style={{ marginTop: 10, color: "#16a34a", fontSize: "0.9rem" }}>{msg}</p>}
          {err && <p style={{ marginTop: 10, color: "#b91c1c", fontSize: "0.9rem" }}>{err}</p>}
          {completeMsg && <p style={{ marginTop: 10, color: "#16a34a", fontSize: "0.9rem", fontWeight: 800 }}>{completeMsg}</p>}
        </div>

        {/* Right */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>Aircraft scans</h3>
              <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
                Total scanned: <strong>{loadingScans ? "…" : scans.length}</strong>
              </p>

              <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
                Bagroom scanned: <strong>{loadingBagroomTotal ? "…" : bagroomTotal}</strong>
              </p>

              {typeof flight?.checkedBagsTotal === "number" && !loadingScans && (
                <p style={{ margin: "6px 0 0", fontSize: "0.9rem" }}>
                  Gate total: <strong>{flight.checkedBagsTotal}</strong> · Missing:{" "}
                  <strong style={{ color: missingNow === 0 ? "#16a34a" : "#b91c1c" }}>
                    {missingNow}
                  </strong>
                </p>
              )}
            </div>

            {canCompleteLoading && (
              <div style={{ textAlign: "right" }}>
                <button
                  onClick={handleLoadingCompleted}
                  disabled={completing || isLoadingCompleted}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "none",
                    background: (completing || isLoadingCompleted) ? "#86efac" : "#16a34a",
                    color: "white",
                    fontWeight: 900,
                    cursor: (completing || isLoadingCompleted) ? "not-allowed" : "pointer",
                  }}
                >
                  {isLoadingCompleted ? "Completed" : (completing ? "Checking…" : "Loading Completed")}
                </button>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, maxHeight: 340, overflow: "auto", borderTop: "1px solid #e5e7eb" }}>
            {loadingScans ? (
              <p style={{ color: "#6b7280", paddingTop: 10 }}>Loading…</p>
            ) : scans.length === 0 ? (
              <p style={{ color: "#6b7280", paddingTop: 10 }}>No scans yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={th}>Tag</th>
                    <th style={th}>Zone</th>
                    <th style={{ ...th, textAlign: "right" }}>User</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s) => (
                    <tr key={s.id}>
                      <td style={td}><strong>{s.tag}</strong></td>
                      <td style={td}>{s.zone ?? "-"}</td>
                      <td style={{ ...td, textAlign: "right", color: "#6b7280" }}>
                        {s.scannedBy?.username || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p style={{ marginTop: 10, color: "#6b7280", fontSize: "0.8rem" }}>
            Tip: ahora guarda automático al terminar el scan (ENTER opcional).
          </p>
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
  letterSpacing: "0.04em",
  color: "#6b7280",
};

const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
};

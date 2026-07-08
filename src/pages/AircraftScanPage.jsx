// src/pages/AircraftScanPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  deleteDoc,
  addDoc,
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
  return String(v || "").replace(/[\r\n]+/g, "").trim();
}

function normalizeStatus(s) {
  const v = String(s || "OPEN").trim().toUpperCase();

  return v === "OPEN" || v === "RECEIVING" || v === "LOADING" || v === "LOADED"
    ? v
    : "OPEN";
}

function safeStr(v, fallback = "-") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

const MIN_TAG_LEN = 6;
const AUTO_SUBMIT_IDLE_MS = 90;

export default function AircraftScanPage({ flightId, user }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);

  const canCompleteLoading =
    role === "supervisor" ||
    role === "duty_manager" ||
    role === "station_manager";

  const canReopenOrOffload =
    role === "supervisor" ||
    role === "duty_manager" ||
    role === "station_manager";

  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] = useState(true);

  const [zone, setZone] = useState(1);

  const [tagInput, setTagInput] = useState("");
  const inputRef = useRef(null);

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [scans, setScans] = useState([]);
  const [loadingScans, setLoadingScans] = useState(true);

  const [bagroomTotal, setBagroomTotal] = useState(0);
  const [loadingBagroomTotal, setLoadingBagroomTotal] = useState(true);

  const [strictManifest, setStrictManifest] = useState(false);

  const [completing, setCompleting] = useState(false);
  const [completeMsg, setCompleteMsg] = useState("");

  const [exporting, setExporting] = useState(false);

  const [reopening, setReopening] = useState(false);
  const [offloadingTag, setOffloadingTag] = useState("");

  const { modal, show, close } = useModal();

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

  const promptReason = ({
    title,
    message,
    confirmText,
    tone = "warning",
    onConfirm,
  }) => {
    let reasonValue = "";

    show({
      title,
      tone,
      showCancel: true,
      confirmText,
      cancelText: "Cancel",
      content: (
        <div>
          <div style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>
            {message}
          </div>

          <label
            style={{
              display: "block",
              fontSize: "0.85rem",
              color: "#374151",
              marginBottom: 6,
            }}
          >
            Reason required
          </label>

          <textarea
            autoFocus
            rows={4}
            placeholder="Explain the reason..."
            onChange={(e) => {
              reasonValue = e.target.value;
            }}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              resize: "vertical",
            }}
          />
        </div>
      ),
      onCancel: close,
      onConfirm: async () => {
        const reason = String(reasonValue || "").trim();

        if (!reason) {
          popup("Reason required", "Please enter a reason before continuing.", "warning");
          return;
        }

        close();
        await onConfirm(reason);
      },
    });
  };
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

  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, []);

  const isLoadingCompleted =
    Boolean(flight?.aircraftLoadingCompleted) ||
    normalizeStatus(flight?.status) === "LOADED";

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

  const saveTrackingEvent = async ({
    type,
    tag,
    zoneNum = null,
    reason = null,
  }) => {
    const eventRef = doc(
      db,
      "bagTags",
      tag,
      "events",
      `${String(type).toLowerCase()}_${Date.now()}`
    );

    await setDoc(eventRef, {
      type,
      location: type === "OFFLOAD_BAG" ? "offloaded" : "aircraft",
      message:
        type === "AIRCRAFT_LOAD"
          ? "Bag loaded on aircraft"
          : "Bag offloaded from aircraft",
      tag,
      zone: zoneNum,
      reason,
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

  const saveAircraftScan = async (tag, zoneNum) => {
    const scanRef = doc(db, "flights", flightId, "aircraftScans", tag);

    const existing = await getDoc(scanRef);

    if (existing.exists()) {
      const prev = existing.data();

      popup(
        "Duplicate scan",
        `⚠️ Already scanned in Aircraft.\nZone: ${prev.zone ?? "-"}`,
        "warning"
      );

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

  const saveActionReport = async ({
    type,
    reason,
    tag = null,
    zoneNum = null,
    extra = {},
  }) => {
    await addDoc(collection(db, "flights", flightId, "reports"), {
      type,
      reason,
      tag,
      zone: zoneNum,
      createdAt: serverTimestamp(),
      createdBy: {
        userId: user?.id || null,
        username: user?.username || null,
        role: user?.role || null,
      },
      flightSnapshot: {
        flightNumber: flight?.flightNumber || null,
        flightDate: flight?.flightDate || null,
        gate: flight?.gate || null,
        aircraftType: flight?.aircraftType || null,
        status: flight?.status || null,
      },
      ...extra,
    });
  };

  const handleReopenFlight = async () => {
    if (!canReopenOrOffload) {
      popup("No permission", "You don't have permission to reopen this flight.", "warning");
      return;
    }

    if (!isLoadingCompleted) {
      popup("Not completed", "This flight is already open for loading.", "info");
      return;
    }

    promptReason({
      title: "Reopen Flight",
      tone: "warning",
      confirmText: "Reopen Flight",
      message:
        `You are about to reopen this flight for loading.\n\n` +
        `Flight: ${flight?.flightNumber || flightId}\n` +
        `Date: ${flight?.flightDate || "-"}\n\n` +
        `Please enter the reason.`,
      onConfirm: async (reason) => {
        try {
          setReopening(true);
          setErr("");
          setMsg("");

          await saveActionReport({
            type: "REOPEN_FLIGHT",
            reason,
            extra: {
              previousStatus: flight?.status || null,
              previousAircraftLoadingCompleted: Boolean(flight?.aircraftLoadingCompleted),
              previousAircraftLoadedBags: flight?.aircraftLoadedBags ?? null,
            },
          });

          await setDoc(
            doc(db, "flights", flightId),
            {
              status: "LOADING",
              aircraftLoadingCompleted: false,
              aircraftLoadingCompletedAt: null,
              aircraftLoadingCompletedBy: null,
              reopenedAt: serverTimestamp(),
              reopenedReason: reason,
              reopenedBy: {
                userId: user?.id || null,
                username: user?.username || null,
                role: user?.role || null,
              },
              statusUpdatedAt: serverTimestamp(),
              statusUpdatedBy: {
                userId: user?.id || null,
                username: user?.username || null,
                role: user?.role || null,
              },
            },
            { merge: true }
          );

          setMsg("✅ Flight reopened. Reason saved in reports.");
        } catch (e) {
          console.error(e);
          setErr("Could not reopen flight. Check Firestore rules/connection.");
        } finally {
          setReopening(false);
        }
      },
    });
  };
    const handleOffloadBag = async (scan) => {
    if (!canReopenOrOffload) {
      popup("No permission", "You don't have permission to offload bags.", "warning");
      return;
    }

    const tag = String(scan?.tag || scan?.id || "").trim();
    const zoneNum = scan?.zone ?? null;

    if (!tag) return;

    promptReason({
      title: "Offload Bag",
      tone: "danger",
      confirmText: "Offload Bag",
      message:
        `You are about to offload this bag from aircraft.\n\n` +
        `Bag Tag: ${tag}\n` +
        `Zone: ${zoneNum ?? "-"}\n\n` +
        `Please enter the reason.`,
      onConfirm: async (reason) => {
        try {
          setOffloadingTag(tag);
          setErr("");
          setMsg("");

          await saveActionReport({
            type: "OFFLOAD_BAG",
            reason,
            tag,
            zoneNum,
            extra: {
              previousScan: scan || null,
            },
          });

          await deleteDoc(doc(db, "flights", flightId, "aircraftScans", tag));

          await setDoc(
            doc(db, "bagTags", tag),
            {
              tag,
              flightId,
              flightNumber: flight?.flightNumber || null,
              flightDate: flight?.flightDate || null,
              lastSeenAt: serverTimestamp(),
              lastSeenLocation: "offloaded",
              lastSeenZone: zoneNum,
              lastSeenBy: {
                userId: user?.id || null,
                username: user?.username || null,
                role: user?.role || null,
              },
              offloadedAt: serverTimestamp(),
              offloadedReason: reason,
              offloadedBy: {
                userId: user?.id || null,
                username: user?.username || null,
                role: user?.role || null,
              },
            },
            { merge: true }
          );

          await saveTrackingEvent({
            type: "OFFLOAD_BAG",
            tag,
            zoneNum,
            reason,
          });

          if (isLoadingCompleted) {
            await setDoc(
              doc(db, "flights", flightId),
              {
                status: "LOADING",
                aircraftLoadingCompleted: false,
                aircraftLoadingCompletedAt: null,
                aircraftLoadingCompletedBy: null,
                statusUpdatedAt: serverTimestamp(),
                statusUpdatedBy: {
                  userId: user?.id || null,
                  username: user?.username || null,
                  role: user?.role || null,
                },
              },
              { merge: true }
            );
          }

          setMsg(`✅ Bag offloaded: ${tag}. Reason saved in reports/tracking.`);
        } catch (e) {
          console.error(e);
          setErr("Could not offload bag. Check Firestore rules/connection.");
        } finally {
          setOffloadingTag("");
        }
      },
    });
  };

  const handleScanSubmit = async (forcedTag) => {
    if (isSubmittingRef.current) return;

    setMsg("");
    setErr("");
    setCompleteMsg("");

    if (isLoadingCompleted) {
      popup("Locked", "⚠️ Loading is already completed for this flight. Reopen flight first.", "warning");
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

      await saveTrackingEvent({
        type: "AIRCRAFT_LOAD",
        tag,
        zoneNum,
      });

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

  const scheduleAutoSubmit = (nextValue) => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);

    const cleaned = cleanTagValue(nextValue);

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

    if (!isLoadingCompleted) {
      scheduleAutoSubmit(v);
    }
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
      typeof flightDoc?.checkedBagsTotal === "number"
        ? flightDoc.checkedBagsTotal
        : null;

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
        ["Missing to load", missing],
      ],
      styles: { fontSize: 10 },
      headStyles: { fillColor: [240, 240, 240] },
    });

    const tags = aircraftRows
      .slice()
      .sort((a, b) => String(a.tag).localeCompare(String(b.tag)))
      .map((r) => [
        String(r.tag),
        `Z${r.zone ?? "-"}`,
        r.scannedBy?.username || "-",
      ]);

    autoTable(pdf, {
      startY: pdf.lastAutoTable.finalY + 8,
      head: [["Bag Tag", "Zone", "Scanned By"]],
      body: tags,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [240, 240, 240] },
    });

    pdf.setFontSize(9);
    pdf.text(
      `Generated: ${new Date().toLocaleString()}`,
      14,
      pdf.lastAutoTable.finalY + 10
    );

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

  const exportReportPdf = async () => {
    if (!flight) {
      popup("Error", "Flight not loaded yet.", "danger");
      return;
    }

    try {
      setExporting(true);
      setErr("");
      setMsg("");
      setCompleteMsg("");

      const pdfDoc = buildPdf({
        flightDoc: flight,
        aircraftRows: scans,
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
          type: "PDF_REPORT",
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
            gateTotal:
              typeof flight?.checkedBagsTotal === "number"
                ? flight.checkedBagsTotal
                : null,
            bagroomTotal: loadingBagroomTotal ? null : bagroomTotal,
            aircraftTotal: scans.length,
          },
        },
        { merge: true }
      );

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
        `❌ LOADING NOT COMPLETED\n\nChecked bags: ${checkedTotal}\nLoaded: ${aircraftTotal}\nMissing: ${missing}`,
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
          {`✅ ALL BAGS LOADED\n\nChecked bags: ${checkedTotal}\nLoaded on aircraft: ${aircraftTotal}\n\nMark loading completed and generate report PDF?`}
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

          await saveActionReport({
            type: "LOADING_COMPLETED",
            reason: "Aircraft loading completed.",
            extra: {
              aircraftLoadedBags: aircraftTotal,
              gateCheckedTotal: checkedTotal,
            },
          });

          await exportReportPdf();

          setCompleteMsg("✅ Aircraft loading completed successfully. Report saved.");
        } catch (e) {
          console.error(e);
          popup("Error", "Failed to mark loading completed / export PDF.", "danger");
        } finally {
          setCompleting(false);
        }
      },
    });
  };

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      {/* Aquí puedes pegar el mismo RETURN/JSX que ya tienes desde:
          <div style={{ display: "flex", justifyContent: "space-between"... }}
          hasta el final del archivo.
          No cambia nada visual en esta parte. */}
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

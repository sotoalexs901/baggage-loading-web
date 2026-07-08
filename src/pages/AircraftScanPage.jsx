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

function normalizeBagType(value) {
  const v = String(value || "CHECKED_BAG").trim().toUpperCase();

  return v === "CHECKED_BAG" || v === "GATE_CHECK" || v === "OVERSIZE"
    ? v
    : "CHECKED_BAG";
}

function getBagTypeLabel(value) {
  const v = normalizeBagType(value);

  if (v === "GATE_CHECK") return "Gate Check";
  if (v === "OVERSIZE") return "Oversize";
  return "Checked Bag";
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
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, []);

  const isLoadingCompleted =
    Boolean(flight?.aircraftLoadingCompleted) ||
    normalizeStatus(flight?.status) === "LOADED";

  const missingNow =
    typeof flight?.checkedBagsTotal === "number"
      ? Math.max(0, flight.checkedBagsTotal - scans.length)
      : null;

  const bagTypeCounts = useMemo(() => {
    const counts = {
      CHECKED_BAG: 0,
      GATE_CHECK: 0,
      OVERSIZE: 0,
    };

    for (const scan of scans) {
      const type = normalizeBagType(scan.bagType);
      counts[type] += 1;
    }

    return counts;
  }, [scans]);

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
      return {
        ok: false,
        message:
          `❌ Bag tag belongs to a different flight/date.\n\n` +
          `Current: ${flight?.flightNumber || flightId} (${flight?.flightDate || "-"})\n` +
          `Registered: ${existing.flightNumber || existing.flightId} (${existing.flightDate || "-"})\n\n` +
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
      return {
        ok: false,
        message:
          `❌ Bag tag NOT found in this flight manifest.\n\n` +
          `Flight: ${flight?.flightNumber || flightId} (${flight?.flightDate || "-"})\n` +
          `Tag: ${tag}\n\n` +
          `Check tag / passenger list. Do NOT load.`,
      };
    }

    return { ok: true };
  };
  const getBagTypeInfo = async (tag) => {
  const tagSnap = await getDoc(doc(db, "bagTags", tag));

  if (tagSnap.exists()) {
    const data = tagSnap.data();

    if (data.bagType) {
      return {
        bagType: normalizeBagType(data.bagType),
        bagTypeLabel: data.bagTypeLabel || getBagTypeLabel(data.bagType),
      };
    }
  }

  const counterSnap = await getDoc(
    doc(db, "flights", flightId, "counterScans", tag)
  );

  if (counterSnap.exists()) {
    const data = counterSnap.data();

    return {
      bagType: normalizeBagType(data.bagType),
      bagTypeLabel: data.bagTypeLabel || getBagTypeLabel(data.bagType),
    };
  }

  return {
    bagType: "CHECKED_BAG",
    bagTypeLabel: "Checked Bag",
  };
};

  const indexTagToThisFlight = async (tag, zoneNum, typeInfo) => {
    const tagRef = doc(db, "bagTags", tag);

    await setDoc(
      tagRef,
      {
        tag,
        flightId,
        flightNumber: flight?.flightNumber || null,
        flightDate: flight?.flightDate || null,
        gate: flight?.gate || null,
        bagType: typeInfo?.bagType || "CHECKED_BAG",
        bagTypeLabel: typeInfo?.bagTypeLabel || "Checked Bag",
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
    bagType = "CHECKED_BAG",
    bagTypeLabel = "Checked Bag",
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
          ? `Bag loaded on aircraft · ${bagTypeLabel}`
          : `Bag offloaded from aircraft · ${bagTypeLabel}`,
      tag,
      zone: zoneNum,
      bagType,
      bagTypeLabel,
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
  const typeInfo = await getBagTypeInfo(tag);

  if (existing.exists()) {
    const prev = existing.data();

    await setDoc(
      scanRef,
      {
        bagType: typeInfo.bagType,
        bagTypeLabel: typeInfo.bagTypeLabel,
      },
      { merge: true }
    );

    popup(
      "Duplicate scan",
      `⚠️ Already scanned in Aircraft.\nZone: ${prev.zone ?? "-"}\nType updated: ${typeInfo.bagTypeLabel}`,
      "warning"
    );

    return { ok: false, typeInfo };
  }

  await setDoc(scanRef, {
    tag,
    zone: zoneNum,
    bagType: typeInfo.bagType,
    bagTypeLabel: typeInfo.bagTypeLabel,
    createdAt: serverTimestamp(),
    scannedBy: {
      userId: user?.id || null,
      username: user?.username || null,
      role: user?.role || null,
    },
  });

  return { ok: true, typeInfo };
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
    const bagType = normalizeBagType(scan?.bagType);
    const bagTypeLabel = scan?.bagTypeLabel || getBagTypeLabel(scan?.bagType);

    if (!tag) return;

    promptReason({
      title: "Offload Bag",
      tone: "danger",
      confirmText: "Offload Bag",
      message:
        `You are about to offload this bag from aircraft.\n\n` +
        `Bag Tag: ${tag}\n` +
        `Type: ${bagTypeLabel}\n` +
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
              bagType,
              bagTypeLabel,
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
              gate: flight?.gate || null,
              bagType,
              bagTypeLabel,
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
            bagType,
            bagTypeLabel,
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

          setMsg(`✅ Bag offloaded: ${tag} · ${bagTypeLabel}. Reason saved in reports/tracking.`);
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
      popup(
        "Locked",
        "⚠️ Loading is already completed for this flight. Reopen flight first.",
        "warning"
      );
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

      const result = await saveAircraftScan(tag, zoneNum);
      if (!result.ok) {
        setTagInput("");
        return;
      }

      const typeInfo = result.typeInfo || {
        bagType: "CHECKED_BAG",
        bagTypeLabel: "Checked Bag",
      };

      await indexTagToThisFlight(tag, zoneNum, typeInfo);

      await saveTrackingEvent({
        type: "AIRCRAFT_LOAD",
        tag,
        zoneNum,
        bagType: typeInfo.bagType,
        bagTypeLabel: typeInfo.bagTypeLabel,
      });

      await ensureStatusLoading();

      setMsg(`Scanned ✅ Tag: ${tag} · ${typeInfo.bagTypeLabel} · Zone ${zoneNum}`);
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
    const computeZones = (rows) => {
    const z = { 1: 0, 2: 0, 3: 0, 4: 0 };

    for (const r of rows) {
      const zn = Number(r.zone);
      if (zn >= 1 && zn <= 4) z[zn] += 1;
    }

    return z;
  };

  const computeBagTypes = (rows) => {
    const counts = {
      CHECKED_BAG: 0,
      GATE_CHECK: 0,
      OVERSIZE: 0,
    };

    for (const r of rows) {
      const type = normalizeBagType(r.bagType);
      counts[type] += 1;
    }

    return counts;
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
    const bagTypes = computeBagTypes(aircraftRows);

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
        ["Checked Bags loaded", String(bagTypes.CHECKED_BAG)],
        ["Gate Checks loaded", String(bagTypes.GATE_CHECK)],
        ["Oversize loaded", String(bagTypes.OVERSIZE)],
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
        r.bagTypeLabel || getBagTypeLabel(r.bagType),
        `Z${r.zone ?? "-"}`,
        r.scannedBy?.username || "-",
      ]);

    autoTable(pdf, {
      startY: pdf.lastAutoTable.finalY + 8,
      head: [["Bag Tag", "Type", "Zone", "Scanned By"]],
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

      const downloadName = `BLCS_${safeStr(
        flight.flightNumber,
        flightId
      )}_${safeStr(flight.flightDate, "date")}.pdf`;

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
            bagTypes: bagTypeCounts,
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
          {`✅ ALL BAGS LOADED\n\nChecked bags: ${checkedTotal}\nLoaded on aircraft: ${aircraftTotal}\n\nChecked Bags: ${bagTypeCounts.CHECKED_BAG}\nGate Checks: ${bagTypeCounts.GATE_CHECK}\nOversize: ${bagTypeCounts.OVERSIZE}\n\nMark loading completed and generate report PDF?`}
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
              aircraftLoadedBagTypes: bagTypeCounts,
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
              aircraftLoadedBagTypes: bagTypeCounts,
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Aircraft Scan</h2>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
            Scan bags while loading by zone 1–4.
          </p>

          {isLoadingCompleted && (
            <p style={{ margin: "8px 0 0", color: "#16a34a", fontWeight: 900 }}>
              ✅ Loading Completed
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

      {canReopenOrOffload && isLoadingCompleted && (
        <section style={{ border: "1px solid #f59e0b", borderRadius: 12, padding: 12, background: "#fef3c7", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <h3 style={{ margin: 0, color: "#92400e" }}>Flight Locked</h3>
              <p style={{ margin: "6px 0 0", color: "#92400e", fontSize: "0.9rem" }}>
                To scan again or offload bags after completion, reopen the flight with a reason.
              </p>
            </div>

            <button
              onClick={handleReopenFlight}
              disabled={reopening}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #f59e0b",
                background: "#f59e0b",
                color: "white",
                fontWeight: 900,
                cursor: reopening ? "not-allowed" : "pointer",
                opacity: reopening ? 0.7 : 1,
              }}
            >
              {reopening ? "Reopening…" : "Reopen Flight"}
            </button>
          </div>
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb" }}>
          <h3 style={{ margin: 0 }}>Scan</h3>

          <p style={{ margin: "6px 0 10px", color: "#6b7280", fontSize: "0.9rem" }}>
            Select zone, then scan bag tag. Auto-save is enabled.
          </p>

          <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: 6 }}>
            Zone
          </label>

          <select
            value={zone}
            onChange={(e) => setZone(Number(e.target.value))}
            disabled={isLoadingCompleted}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: isLoadingCompleted ? "#f3f4f6" : "white",
            }}
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
            placeholder={isLoadingCompleted ? "Loading completed - reopen first" : "Scan bag tag…"}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: isLoadingCompleted ? "#f3f4f6" : "white",
            }}
          />

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
              cursor: exporting || !flight || loadingScans ? "not-allowed" : "pointer",
              opacity: exporting || !flight || loadingScans ? 0.7 : 1,
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
          {completeMsg && (
            <p style={{ marginTop: 10, color: "#16a34a", fontSize: "0.9rem", fontWeight: 800 }}>
              {completeMsg}
            </p>
          )}
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>Aircraft Scans</h3>

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

              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", fontSize: "0.82rem" }}>
                <span style={miniPill}>Checked: {bagTypeCounts.CHECKED_BAG}</span>
                <span style={miniPill}>Gate Check: {bagTypeCounts.GATE_CHECK}</span>
                <span style={miniPill}>Oversize: {bagTypeCounts.OVERSIZE}</span>
              </div>
            </div>

            {canCompleteLoading && (
              <button
                onClick={handleLoadingCompleted}
                disabled={completing || isLoadingCompleted}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "none",
                  background: completing || isLoadingCompleted ? "#86efac" : "#16a34a",
                  color: "white",
                  fontWeight: 900,
                  cursor: completing || isLoadingCompleted ? "not-allowed" : "pointer",
                }}
              >
                {isLoadingCompleted ? "Completed" : completing ? "Checking…" : "Loading Completed"}
              </button>
            )}
          </div>

          <div style={{ marginTop: 12, maxHeight: 360, overflow: "auto", borderTop: "1px solid #e5e7eb" }}>
            {loadingScans ? (
              <p style={{ color: "#6b7280", paddingTop: 10 }}>Loading…</p>
            ) : scans.length === 0 ? (
              <p style={{ color: "#6b7280", paddingTop: 10 }}>No scans yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={th}>Tag</th>
                    <th style={th}>Type</th>
                    <th style={th}>Zone</th>
                    <th style={th}>User</th>
                    <th style={{ ...th, textAlign: "right" }}>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {scans.map((s) => {
                    const tag = s.tag || s.id;
                    const busy = offloadingTag === tag;

                    return (
                      <tr key={s.id}>
                        <td style={td}><strong>{tag}</strong></td>
                        <td style={td}>{s.bagTypeLabel || getBagTypeLabel(s.bagType)}</td>
                        <td style={td}>{s.zone ?? "-"}</td>
                        <td style={{ ...td, color: "#6b7280" }}>{s.scannedBy?.username || "-"}</td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {canReopenOrOffload && (
                            <button
                              onClick={() => handleOffloadBag(s)}
                              disabled={busy}
                              style={{
                                padding: "5px 10px",
                                borderRadius: 999,
                                border: "1px solid #ef4444",
                                background: "#ef4444",
                                color: "white",
                                fontWeight: 800,
                                cursor: busy ? "not-allowed" : "pointer",
                                opacity: busy ? 0.7 : 1,
                              }}
                            >
                              {busy ? "Offloading…" : "Offload"}
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

          <p style={{ marginTop: 10, color: "#6b7280", fontSize: "0.8rem" }}>
            Tip: scans save automatically after the scanner finishes. Enter is optional.
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

const miniPill = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: 999,
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  color: "#374151",
  fontWeight: 800,
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

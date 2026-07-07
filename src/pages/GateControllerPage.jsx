// src/pages/GateControllerPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  query,
  orderBy,
  where,
  deleteDoc,
} from "firebase/firestore";
import { db, storage } from "../firebase";

import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function toIntSafe(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

const STATUS_COLORS = {
  OPEN: { bg: "#FEF3C7", text: "#92400E", border: "#F59E0B" },
  RECEIVING: { bg: "#DBEAFE", text: "#1E3A8A", border: "#60A5FA" },
  LOADING: { bg: "#FFEDD5", text: "#9A3412", border: "#FB923C" },
  LOADED: { bg: "#DCFCE7", text: "#166534", border: "#22C55E" },
};

function normalizeStatus(s) {
  const v = String(s || "OPEN").trim().toUpperCase();

  return v === "OPEN" || v === "RECEIVING" || v === "LOADING" || v === "LOADED"
    ? v
    : "OPEN";
}

function cleanTagValue(v) {
  return String(v || "").trim();
}

function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function isValidTag10(tag) {
  const t = onlyDigits(tag);
  return t.length === 10;
}

function normalizeCartNumber(value) {
  return String(value || "").trim().toUpperCase();
}

function extractBagTagsFromText(text, { exactLen = 10 } = {}) {
  const src = String(text || "");
  const matches = src.match(/\d+/g) || [];
  const tags = matches.map((s) => s.trim()).filter((s) => s.length === exactLen);

  const seen = new Set();
  const unique = [];

  for (const t of tags) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }

  return unique;
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("File read error"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file);
  });
}

async function readPdfAsText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it) => it.str);
    fullText += strings.join(" ") + "\n";
  }

  return fullText;
}

async function uploadPdfForOcr({ file, flightId, user }) {
  const safeName = String(file.name || "manifest.pdf").replaceAll(" ", "_");
  const path = `flights/${flightId}/manifests/${Date.now()}_${safeName}`;
  const r = storageRef(storage, path);

  await uploadBytes(r, file, {
    contentType: "application/pdf",
    customMetadata: {
      flightId: String(flightId),
      uploadedBy: String(user?.username || ""),
      role: String(user?.role || ""),
    },
  });

  const url = await getDownloadURL(r);
  return { path, url };
}

export default function GateControllerPage({
  flightId,
  user,
  gateControllerOnDuty,
  canEdit,
}) {
  const [gateControllers, setGateControllers] = useState([]);
  const [selectedGateController, setSelectedGateController] = useState(
    gateControllerOnDuty || localStorage.getItem("gateControllerOnDuty") || ""
  );
  const [gcMsg, setGcMsg] = useState("");

  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] = useState(true);

  const [checkedTotalInput, setCheckedTotalInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [aircraftTotal, setAircraftTotal] = useState(0);
  const [zones, setZones] = useState({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [aircraftLoading, setAircraftLoading] = useState(true);

  const [bagroomScans, setBagroomScans] = useState([]);
  const [loadingBagroomScans, setLoadingBagroomScans] = useState(true);
  const [activeBagroomTab, setActiveBagroomTab] = useState("summary");

  const [manifestText, setManifestText] = useState("");
  const [manifestTagsPreview, setManifestTagsPreview] = useState([]);
  const [manifestMsg, setManifestMsg] = useState("");
  const [manifestErr, setManifestErr] = useState("");
  const [importing, setImporting] = useState(false);

  const [strictManifest, setStrictManifest] = useState(false);

  const [scanInput, setScanInput] = useState("");
  const scanRef = useRef(null);
  const [scanMsg, setScanMsg] = useState("");
  const [scanErr, setScanErr] = useState("");
  const [savingScan, setSavingScan] = useState(false);

  const [allowedCount, setAllowedCount] = useState(0);
  const [recentAllowed, setRecentAllowed] = useState([]);
  const [allManifestTags, setAllManifestTags] = useState([]);
  const [loadingAllowed, setLoadingAllowed] = useState(true);
  const [deletingTag, setDeletingTag] = useState("");

  const [loadedAircraftTags, setLoadedAircraftTags] = useState([]);
  const [activeManifestTab, setActiveManifestTab] = useState("recent");

  const debounceRef = useRef(null);
    useEffect(() => {
    const loadGateControllers = async () => {
      try {
        const qGC = query(
          collection(db, "users"),
          where("role", "==", "gate_controller")
        );

        const snap = await getDocs(qGC);

        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => u.username);

        setGateControllers(list);
      } catch (e) {
        console.error("Error loading gate controllers:", e);
      }
    };

    loadGateControllers();
  }, []);

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

        if (typeof data.checkedBagsTotal === "number") {
          setCheckedTotalInput(String(data.checkedBagsTotal));
        } else if (
          data.checkedBagsTotal === null ||
          data.checkedBagsTotal === undefined
        ) {
          setCheckedTotalInput("");
        }

        if (typeof data.strictManifest === "boolean") {
          setStrictManifest(data.strictManifest);
        }

        if (data.gateControllerOnDuty) {
          setSelectedGateController(data.gateControllerOnDuty);
          localStorage.setItem("gateControllerOnDuty", data.gateControllerOnDuty);
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

  useEffect(() => {
    if (!flightId) return;

    setLoadingAllowed(true);

    const colRef = collection(db, "flights", flightId, "allowedBagTags");
    const qy = query(colRef, orderBy("importedAt", "desc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setAllowedCount(snap.size);

        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        setAllManifestTags(
          rows
            .map((r) => onlyDigits(r.tag || r.id))
            .filter((t) => isValidTag10(t))
        );

        setRecentAllowed(rows.slice(0, 60));
        setLoadingAllowed(false);
      },
      (e) => {
        console.error("allowedBagTags snapshot error:", e);
        setAllowedCount(0);
        setRecentAllowed([]);
        setAllManifestTags([]);
        setLoadingAllowed(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (!flightId) return;

    setLoadingBagroomScans(true);

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

        setBagroomScans(rows);
        setLoadingBagroomScans(false);
      },
      (e) => {
        console.error("bagroomScans snapshot error:", e);
        setBagroomScans([]);
        setLoadingBagroomScans(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (!flightId) return;

    const run = async () => {
      try {
        setAircraftLoading(true);

        const scansRef = collection(db, "flights", flightId, "aircraftScans");
        const snap = await getDocs(scansRef);

        let total = 0;
        const z = { 1: 0, 2: 0, 3: 0, 4: 0 };
        const loadedTags = [];

        snap.forEach((d) => {
          const data = d.data();

          total += 1;

          const zone = Number(data.zone);
          if (zone >= 1 && zone <= 4) {
            z[zone] += 1;
          }

          const tag = onlyDigits(
            data.bagTag ||
              data.tag ||
              data.bagTagNumber ||
              data.barcode ||
              d.id
          );

          if (isValidTag10(tag)) {
            loadedTags.push(tag);
          }
        });

        setAircraftTotal(total);
        setZones(z);
        setLoadedAircraftTags(loadedTags);
        setAircraftLoading(false);
      } catch (err) {
        console.error("GateControllerPage aircraft summary error:", err);

        setAircraftTotal(0);
        setZones({ 1: 0, 2: 0, 3: 0, 4: 0 });
        setLoadedAircraftTags([]);
        setAircraftLoading(false);
      }
    };

    run();
  }, [flightId]);

  const checkedBagsTotal =
    typeof flight?.checkedBagsTotal === "number" ? flight.checkedBagsTotal : null;

  const missing =
    checkedBagsTotal === null ? null : Math.max(0, checkedBagsTotal - aircraftTotal);

  const flightStatus = normalizeStatus(flight?.status);
  const statusStyle = STATUS_COLORS[flightStatus] || STATUS_COLORS.OPEN;

  const manifestTagSet = useMemo(() => {
    return new Set(allManifestTags);
  }, [allManifestTags]);

  const loadedTagSet = useMemo(() => {
    return new Set(
      loadedAircraftTags
        .map((t) => onlyDigits(t))
        .filter((t) => isValidTag10(t))
    );
  }, [loadedAircraftTags]);

  const missingManifestTags = useMemo(() => {
    return allManifestTags.filter((tag) => !loadedTagSet.has(tag));
  }, [allManifestTags, loadedTagSet]);
    const bagroomMatchedTags = useMemo(() => {
    return bagroomScans
      .map((s) => onlyDigits(s.tag || s.id))
      .filter((tag) => isValidTag10(tag) && manifestTagSet.has(tag));
  }, [bagroomScans, manifestTagSet]);

  const bagroomNotInManifest = useMemo(() => {
    return bagroomScans
      .map((s) => ({
        ...s,
        cleanTag: onlyDigits(s.tag || s.id),
      }))
      .filter((s) => isValidTag10(s.cleanTag) && !manifestTagSet.has(s.cleanTag));
  }, [bagroomScans, manifestTagSet]);

  const bagroomByCart = useMemo(() => {
    const groups = {};

    for (const scan of bagroomScans) {
      const cart = normalizeCartNumber(scan.cartNumber) || "NO CART";

      if (!groups[cart]) {
        groups[cart] = [];
      }

      groups[cart].push(scan);
    }

    return groups;
  }, [bagroomScans]);

  const ensureStatusReceiving = async () => {
    if (!flightId || !flight) return;

    const st = normalizeStatus(flight.status);
    if (st !== "OPEN") return;

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

  const saveGateControllerOnDuty = async () => {
    const picked = selectedGateController.trim();

    if (!picked) {
      setGcMsg("Please select a Gate Controller.");
      return;
    }

    try {
      localStorage.setItem("gateControllerOnDuty", picked);

      await setDoc(
        doc(db, "flights", flightId),
        {
          gateControllerOnDuty: picked,
          gateControllerUpdatedAt: serverTimestamp(),
          gateControllerUpdatedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
        },
        { merge: true }
      );

      setGcMsg(`Gate Controller saved: ${picked} ✅`);
      setTimeout(() => setGcMsg(""), 2500);
    } catch (e) {
      console.error(e);
      setGcMsg("Could not save Gate Controller.");
    }
  };

  const updateFlightStatus = async (nextStatus) => {
    setManifestMsg("");
    setManifestErr("");

    if (!canEdit) {
      setManifestErr("You don't have permission to change flight status.");
      return;
    }

    try {
      await setDoc(
        doc(db, "flights", flightId),
        {
          status: nextStatus,
          statusUpdatedAt: serverTimestamp(),
          statusUpdatedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
        },
        { merge: true }
      );

      setManifestMsg(`Status updated to ${nextStatus} ✅`);
      setTimeout(() => setManifestMsg(""), 2000);
    } catch (e) {
      console.error(e);
      setManifestErr("Could not update status. Check Firestore rules.");
    }
  };

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

      await setDoc(
        doc(db, "flights", flightId),
        {
          checkedBagsTotal: value,
          gateTotalUpdatedAt: serverTimestamp(),
          gateTotalUpdatedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
          gateControllerOnDuty: selectedGateController || null,
        },
        { merge: true }
      );

      setSaveMsg("Saved ✅");
      setSaving(false);

      setTimeout(() => setSaveMsg(""), 2000);
    } catch (err) {
      console.error("Save gate total error:", err);
      setSaveMsg("Could not save. Check Firestore rules.");
      setSaving(false);
    }
  };

  const updateStrictManifest = async (nextValue) => {
    setManifestMsg("");
    setManifestErr("");

    if (!canEdit) {
      setManifestErr("No permission to change Strict Manifest.");
      return;
    }

    try {
      await setDoc(
        doc(db, "flights", flightId),
        {
          strictManifest: Boolean(nextValue),
          strictManifestUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setStrictManifest(Boolean(nextValue));
      setManifestMsg(`Strict Manifest set to ${nextValue ? "ON" : "OFF"} ✅`);

      setTimeout(() => setManifestMsg(""), 2000);
    } catch (e) {
      console.error(e);
      setManifestErr("Could not update Strict Manifest (check rules).");
    }
  };
    const previewFromText = (text) => {
    setManifestMsg("");
    setManifestErr("");

    const tags = extractBagTagsFromText(text, { exactLen: 10 });
    setManifestTagsPreview(tags);

    if (tags.length === 0) {
      setManifestErr(
        "No 10-digit bag tag numbers found. If this is a scanned PDF, use OCR upload."
      );
      return;
    }

    setManifestMsg(`Preview: found ${tags.length} bag tags (ONLY 10 digits).`);
  };

  const removeFromPreview = (tag) => {
    setManifestTagsPreview((prev) => prev.filter((t) => t !== tag));
  };

  const handleFilePick = async (file) => {
    setManifestMsg("");
    setManifestErr("");

    try {
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");

      let text = "";

      if (isPdf) {
        setManifestMsg("Reading PDF (local)...");
        text = await readPdfAsText(file);
      } else {
        setManifestMsg("Reading file...");
        text = await readFileAsText(file);
      }

      setManifestText(text);
      previewFromText(text);

      const found = extractBagTagsFromText(text, { exactLen: 10 }).length;

      if (isPdf && found === 0) {
        setManifestMsg("No 10-digit tags found locally. Uploading PDF for OCR...");

        const up = await uploadPdfForOcr({ file, flightId, user });

        setManifestMsg(
          `PDF uploaded for OCR ✅\n\nPath: ${up.path}\n\nCloud OCR will import tags automatically.`
        );
      }
    } catch (e) {
      console.error(e);
      setManifestErr("Could not read file. If PDF is scanned, OCR upload is required.");
    }
  };

  const importManifest = async () => {
    setManifestMsg("");
    setManifestErr("");

    if (!canEdit) {
      setManifestErr("You don't have permission to import manifest.");
      return;
    }

    const tags = manifestTagsPreview;

    if (!tags || tags.length === 0) {
      setManifestErr("Nothing to import. Preview first.");
      return;
    }

    try {
      setImporting(true);

      const chunkSize = 450;
      let imported = 0;

      for (let i = 0; i < tags.length; i += chunkSize) {
        const chunk = tags.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        for (const tag of chunk) {
          if (!isValidTag10(tag)) continue;

          const ref = doc(db, "flights", flightId, "allowedBagTags", tag);

          batch.set(ref, {
            tag,
            importedAt: serverTimestamp(),
            importedBy: {
              userId: user?.id || null,
              username: user?.username || null,
              role: user?.role || null,
            },
            source: "import",
          });

          imported += 1;
        }

        await batch.commit();
      }

      await setDoc(
        doc(db, "flights", flightId),
        {
          strictManifest: true,
          strictManifestUpdatedAt: serverTimestamp(),
          manifestImportedAt: serverTimestamp(),
          manifestImportedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
        },
        { merge: true }
      );

      setStrictManifest(true);
      setManifestMsg(`Imported ${imported} bag tags ✅ Strict Manifest ON`);
      setTimeout(() => setManifestMsg(""), 2500);
    } catch (e) {
      console.error(e);
      setManifestErr("Import failed. Check Firestore rules and try again.");
    } finally {
      setImporting(false);
    }
  };

  const saveScannedTagToManifest = async (raw) => {
    setScanMsg("");
    setScanErr("");

    if (!canEdit) {
      setScanErr("You don't have permission to scan/import manifest tags.");
      return;
    }

    const cleaned = onlyDigits(cleanTagValue(raw));
    if (!cleaned) return;

    if (!isValidTag10(cleaned)) {
      setScanErr("Invalid bag tag. Must be exactly 10 digits.");
      return;
    }

    try {
      setSavingScan(true);

      await ensureStatusReceiving();

      const ref = doc(db, "flights", flightId, "allowedBagTags", cleaned);

      await setDoc(
        ref,
        {
          tag: cleaned,
          importedAt: serverTimestamp(),
          importedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
          source: "scan",
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "flights", flightId),
        {
          strictManifest: true,
          strictManifestUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setStrictManifest(true);
      setScanMsg(`Saved ✅ ${cleaned}`);
      setScanInput("");

      if (scanRef.current) {
        scanRef.current.focus();
      }
    } catch (e) {
      console.error(e);
      setScanErr("Could not save scanned tag. Check rules/connection.");
    } finally {
      setSavingScan(false);
    }
  };

  const deleteAllowedTag = async (tag) => {
    if (!canEdit) return;

    const id = String(tag || "").trim();
    if (!id) return;

    const ok = window.confirm(
      `Delete this manifest tag?\n\n${id}\n\nThis cannot be undone.`
    );

    if (!ok) return;

    try {
      setDeletingTag(id);
      await deleteDoc(doc(db, "flights", flightId, "allowedBagTags", id));
    } catch (e) {
      console.error(e);
      alert("Failed to delete tag. Check Firestore rules.");
    } finally {
      setDeletingTag("");
    }
  };

  const onScanKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveScannedTagToManifest(scanInput);
    }
  };

  useEffect(() => {
    if (!canEdit) return;

    const raw = scanInput;
    if (!raw) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const cleaned = onlyDigits(cleanTagValue(raw));

      if (isValidTag10(cleaned)) {
        saveScannedTagToManifest(cleaned);
      }
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanInput]);

  const title = "Gate Controller";

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
            Verified counts, Bagroom match, and manifest for Ramp coordination.
          </p>
        </div>

        <div style={{ textAlign: "right", fontSize: "0.9rem", minWidth: 260 }}>
          <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: 4 }}>
            Gate Controller on duty
          </label>

          <div style={{ display: "flex", gap: 6 }}>
            <select
              value={selectedGateController}
              onChange={(e) => setSelectedGateController(e.target.value)}
              disabled={!canEdit}
              style={{
                flex: 1,
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: canEdit ? "white" : "#f3f4f6",
              }}
            >
              <option value="">Select GC…</option>
              {gateControllers.map((gc) => (
                <option key={gc.id} value={gc.username}>
                  {gc.username}
                </option>
              ))}
            </select>

            <button
              onClick={saveGateControllerOnDuty}
              disabled={!canEdit}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #2563eb",
                background: canEdit ? "#2563eb" : "#93c5fd",
                color: "white",
                fontWeight: 700,
                cursor: canEdit ? "pointer" : "not-allowed",
              }}
            >
              Save
            </button>
          </div>

          {gcMsg && (
            <div
              style={{
                marginTop: 4,
                fontSize: "0.78rem",
                color: gcMsg.includes("✅") ? "#16a34a" : "#b91c1c",
              }}
            >
              {gcMsg}
            </div>
          )}
        </div>
      </div>
            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "14px 0" }} />

      {flightLoading ? (
        <p style={{ color: "#6b7280" }}>Loading flight...</p>
      ) : !flight ? (
        <p style={{ color: "#b91c1c" }}>Flight not found.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
          <InfoCard label="Flight" value={flight.flightNumber || "-"} />
          <InfoCard label="Date" value={flight.flightDate || "-"} />
          <InfoCard label="Gate" value={flight.gate || "-"} />
          <InfoCard label="Aircraft" value={flight.aircraftType || "-"} />
        </div>
      )}

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Flight Status</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
              Open → Receiving → Loading → Loaded
            </p>
          </div>

          <span
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${statusStyle.border}`,
              background: statusStyle.bg,
              color: statusStyle.text,
              fontWeight: 900,
              letterSpacing: "0.04em",
            }}
          >
            {flightStatus === "RECEIVING" ? "RECEIVING BAGS" : flightStatus}
          </span>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button disabled={!canEdit} onClick={() => updateFlightStatus("OPEN")} style={btnStatus(canEdit)}>Open</button>
          <button disabled={!canEdit} onClick={() => updateFlightStatus("RECEIVING")} style={btnStatus(canEdit)}>Receiving</button>
          <button disabled={!canEdit} onClick={() => updateFlightStatus("LOADING")} style={btnStatus(canEdit)}>Loading</button>
          <button disabled={!canEdit} onClick={() => updateFlightStatus("LOADED")} style={btnStatus(canEdit)}>Loaded</button>
        </div>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 14, background: "#f9fafb" }}>
        <h3 style={{ margin: 0 }}>Aircraft Loading</h3>

        <div style={aircraftStatusBox(missing)}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: "2rem" }}>
              {checkedBagsTotal === null ? "ℹ️" : missing === 0 ? "✅" : missing <= 3 ? "⚠️" : "❌"}
            </div>

            <div>
              <div style={{ fontSize: "1.05rem", fontWeight: 900 }}>
                {checkedBagsTotal === null
                  ? "Gate total pending"
                  : missing === 0
                    ? "All bags accounted for"
                    : `${missing} bag${missing === 1 ? "" : "s"} missing to load`}
              </div>

              <div style={{ fontSize: "0.85rem", marginTop: 3 }}>
                {checkedBagsTotal === null
                  ? "Enter Gate total to calculate missing bags."
                  : missing === 0
                    ? "All bags have been loaded."
                    : missing <= 3
                      ? "Almost complete. Verify remaining bags."
                      : "Attention required. Several bags are still missing."}
              </div>
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Total loaded</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 900 }}>
              {aircraftLoading ? "…" : aircraftTotal}
            </div>
            <div style={{ fontSize: "0.8rem" }}>
              of {checkedBagsTotal === null ? "—" : checkedBagsTotal}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginTop: 12 }}>
          <InfoCard label="Zone 1" value={aircraftLoading ? "…" : zones[1]} />
          <InfoCard label="Zone 2" value={aircraftLoading ? "…" : zones[2]} />
          <InfoCard label="Zone 3" value={aircraftLoading ? "…" : zones[3]} />
          <InfoCard label="Zone 4" value={aircraftLoading ? "…" : zones[4]} />
        </div>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 14, background: "#f9fafb" }}>
        <h3 style={{ margin: 0 }}>Bagroom Manifest Match</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 12 }}>
          <InfoCard label="Manifest Tags" value={loadingAllowed ? "…" : allManifestTags.length} />
          <InfoCard label="Bagroom Scanned" value={loadingBagroomScans ? "…" : bagroomScans.length} />
          <InfoCard label="Matched Manifest" value={loadingAllowed || loadingBagroomScans ? "…" : bagroomMatchedTags.length} />
          <InfoCard label="Not in Manifest" value={loadingAllowed || loadingBagroomScans ? "…" : bagroomNotInManifest.length} />
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setActiveBagroomTab("summary")} style={tabBtn(activeBagroomTab === "summary")}>By Cart</button>
          <button onClick={() => setActiveBagroomTab("matched")} style={tabBtn(activeBagroomTab === "matched")}>Matched ({bagroomMatchedTags.length})</button>
          <button onClick={() => setActiveBagroomTab("notManifest")} style={tabBtn(activeBagroomTab === "notManifest")}>Not in Manifest ({bagroomNotInManifest.length})</button>
        </div>

        <div style={{ marginTop: 12 }}>
          {loadingBagroomScans ? (
            <p style={{ color: "#6b7280" }}>Loading Bagroom scans…</p>
          ) : bagroomScans.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No Bagroom scans yet.</p>
          ) : activeBagroomTab === "summary" ? (
            <div style={{ display: "grid", gap: 12 }}>
              {Object.keys(bagroomByCart)
                .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
                .map((cart) => {
                  const rows = bagroomByCart[cart];
                  const matched = rows.filter((s) => manifestTagSet.has(onlyDigits(s.tag || s.id)));

                  return (
                    <div key={cart} style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "white", padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900 }}>
                        <span>Cart {cart}</span>
                        <span>{matched.length}/{rows.length} matched</span>
                      </div>

                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {rows.map((s) => {
                          const tag = onlyDigits(s.tag || s.id);
                          const ok = manifestTagSet.has(tag);

                          return (
                            <span key={s.id} style={{ ...tagPill, background: ok ? "#DCFCE7" : "#FEF2F2", color: ok ? "#166534" : "#991B1B" }}>
                              {tag || s.tag}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : activeBagroomTab === "matched" ? (
            bagroomMatchedTags.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No matched Bagroom tags yet.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {bagroomMatchedTags.map((tag) => (
                  <span key={tag} style={{ ...tagPill, background: "#DCFCE7", color: "#166534" }}>{tag}</span>
                ))}
              </div>
            )
          ) : bagroomNotInManifest.length === 0 ? (
            <p style={{ color: "#16a34a", fontWeight: 800 }}>All Bagroom scans are in the manifest ✅</p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {bagroomNotInManifest.map((s) => (
                <span key={s.id} style={{ ...tagPill, background: "#FEF2F2", color: "#991B1B" }}>
                  {s.cleanTag} · Cart {s.cartNumber || "-"}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 14, background: "#f9fafb" }}>
        <h3 style={{ margin: 0 }}>Manifest Loading Status</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 12 }}>
          <InfoCard label="Manifest Tags" value={loadingAllowed ? "…" : allManifestTags.length} />
          <InfoCard label="Aircraft Loaded" value={aircraftLoading ? "…" : loadedAircraftTags.length} />
          <InfoCard label="Missing to Load" value={loadingAllowed || aircraftLoading ? "…" : missingManifestTags.length} />
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setActiveManifestTab("recent")} style={tabBtn(activeManifestTab === "recent")}>
            Manifest Tags
          </button>

          <button onClick={() => setActiveManifestTab("missing")} style={tabBtn(activeManifestTab === "missing")}>
            Missing to Load ({missingManifestTags.length})
          </button>
        </div>

        <div style={{ marginTop: 12, maxHeight: 300, overflow: "auto" }}>
          {activeManifestTab === "recent" ? (
            loadingAllowed ? (
              <p style={{ color: "#6b7280" }}>Loading manifest…</p>
            ) : recentAllowed.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No manifest tags uploaded yet.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {recentAllowed.map((r) => {
                  const tag = r.tag || r.id;
                  const busy = deletingTag === tag;

                  return (
                    <span key={r.id} style={tagPill}>
                      {tag}
                      {canEdit && (
                        <button
                          onClick={() => deleteAllowedTag(tag)}
                          disabled={busy}
                          title="Delete tag"
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: busy ? "not-allowed" : "pointer",
                            fontWeight: 900,
                            color: "#b91c1c",
                            opacity: busy ? 0.6 : 1,
                          }}
                        >
                          {busy ? "…" : "✕"}
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )
          ) : loadingAllowed || aircraftLoading ? (
            <p style={{ color: "#6b7280" }}>Loading missing tags…</p>
          ) : missingManifestTags.length === 0 ? (
            <p style={{ color: "#16a34a", fontWeight: 800 }}>
              All manifest tags are loaded ✅
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {missingManifestTags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    ...tagPill,
                    background: "#FEF2F2",
                    color: "#991B1B",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb", marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>Checked Bags Total</h3>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
        <h3 style={{ margin: 0 }}>Flight Bag Tag Manifest (Import)</h3>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="file"
            accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf"
            disabled={!canEdit}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFilePick(f);
            }}
          />

          <button disabled={!canEdit} onClick={() => updateStrictManifest(!strictManifest)} style={btnStatus(canEdit)}>
            Toggle Strict Manifest
          </button>
        </div>

        <textarea
          value={manifestText}
          onChange={(e) => setManifestText(e.target.value)}
          disabled={!canEdit}
          rows={6}
          placeholder="Paste manifest text here..."
          style={{
            marginTop: 12,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #d1d5db",
            background: canEdit ? "white" : "#f3f4f6",
          }}
        />

        <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={() => previewFromText(manifestText)} disabled={!canEdit} style={btnStatus(canEdit)}>
            Preview Tags
          </button>

          <button
            onClick={importManifest}
            disabled={!canEdit || importing || manifestTagsPreview.length === 0}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #1d4ed8",
              background: !canEdit || importing ? "#93c5fd" : "#2563eb",
              color: "white",
              fontWeight: 800,
            }}
          >
            {importing ? "Importing..." : "Import to Flight"}
          </button>
        </div>

        {manifestMsg && <p style={{ color: "#16a34a", whiteSpace: "pre-wrap" }}>{manifestMsg}</p>}
        {manifestErr && <p style={{ color: "#b91c1c", whiteSpace: "pre-wrap" }}>{manifestErr}</p>}
      </section>
    </div>
  );
}

function btnStatus(canEdit) {
  return {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: canEdit ? "white" : "#f3f4f6",
    cursor: canEdit ? "pointer" : "not-allowed",
    fontWeight: 700,
  };
}

function tabBtn(active) {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    border: active ? "1px solid #111827" : "1px solid #d1d5db",
    background: active ? "#111827" : "white",
    color: active ? "white" : "#111827",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "0.82rem",
  };
}

function aircraftStatusBox(missing) {
  if (missing === null) {
    return baseAircraftBox("#d1d5db", "#f9fafb", "#374151");
  }

  if (missing === 0) {
    return baseAircraftBox("#22c55e", "#dcfce7", "#166534");
  }

  if (missing <= 3) {
    return baseAircraftBox("#f59e0b", "#fef3c7", "#92400e");
  }

  return baseAircraftBox("#ef4444", "#fee2e2", "#991b1b");
}

function baseAircraftBox(border, background, color) {
  return {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${border}`,
    background,
    color,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  };
}

const tagPill = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  fontSize: "0.82rem",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

function InfoCard({ label, value }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "white" }}>
      <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{value}</div>
    </div>
  );
}

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

function sortCartNumbers(list) {
  return [...list].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );
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
  const role = useMemo(() => normalizeRole(user?.role), [user]);

  const [gateControllers, setGateControllers] = useState([]);
  const [selectedGateController, setSelectedGateController] = useState(
    gateControllerOnDuty || localStorage.getItem("gateControllerOnDuty") || ""
  );
  const [gcMsg, setGcMsg] = useState("");

  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] = useState(true);

  const [cartInput, setCartInput] = useState("");
  const [cartNumbers, setCartNumbers] = useState([]);
  const [cartMsg, setCartMsg] = useState("");

  const [checkedTotalInput, setCheckedTotalInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [aircraftTotal, setAircraftTotal] = useState(0);
  const [zones, setZones] = useState({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [aircraftLoading, setAircraftLoading] = useState(true);

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

        if (Array.isArray(data.cartNumbers)) {
          setCartNumbers(sortCartNumbers(data.cartNumbers.map(normalizeCartNumber)));
        } else {
          setCartNumbers([]);
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

  const saveCartNumbers = async (nextCarts) => {
    try {
      const cleanCarts = sortCartNumbers(
        [...new Set(nextCarts.map(normalizeCartNumber).filter(Boolean))]
      );

      await setDoc(
        doc(db, "flights", flightId),
        {
          cartNumbers: cleanCarts,
          cartNumbersUpdatedAt: serverTimestamp(),
          cartNumbersUpdatedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
        },
        { merge: true }
      );

      setCartNumbers(cleanCarts);
      setCartMsg("Cart numbers saved ✅");
      setTimeout(() => setCartMsg(""), 2000);
    } catch (e) {
      console.error(e);
      setCartMsg("Could not save cart numbers.");
    }
  };

  const addCartNumber = async () => {
    const value = normalizeCartNumber(cartInput);

    if (!canEdit) {
      setCartMsg("You don't have permission to edit carts.");
      return;
    }

    if (!value) {
      setCartMsg("Enter a cart number.");
      return;
    }

    if (cartNumbers.includes(value)) {
      setCartMsg("This cart already exists.");
      return;
    }

    setCartInput("");
    await saveCartNumbers([...cartNumbers, value]);
  };

  const removeCartNumber = async (cart) => {
    if (!canEdit) return;

    const value = normalizeCartNumber(cart);
    const next = cartNumbers.filter((c) => c !== value);

    await saveCartNumbers(next);
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

      const ref = doc(db, "flights", flightId);

      const payload = {
        checkedBagsTotal: value,
        gateTotalUpdatedAt: serverTimestamp(),
        gateTotalUpdatedBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
        gateControllerOnDuty: selectedGateController || null,
      };

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
          `PDF uploaded for OCR ✅\n\nPath: ${up.path}\n\nCloud OCR will import tags automatically (refresh in a few seconds).`
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
      setManifestErr("Nothing to import. Preview first. (ONLY 10-digit tags are imported.)");
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

      setManifestMsg(`Imported ${imported} bag tags ✅ Strict Manifest ON (10-digit only)`);
      setImporting(false);

      setTimeout(() => setManifestMsg(""), 2500);
    } catch (e) {
      console.error(e);
      setManifestErr("Import failed. Check Firestore rules and try again.");
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
      setScanErr("Invalid bag tag (must be EXACTLY 10 digits).");
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
      setScanMsg(`Saved ✅  ${cleaned}`);
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
            Verified counts, cart setup, and manifest for Ramp coordination.
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
          <button disabled={!canEdit} onClick={() => updateFlightStatus("OPEN")} style={btnStatus(canEdit)}>
            Open
          </button>

          <button disabled={!canEdit} onClick={() => updateFlightStatus("RECEIVING")} style={btnStatus(canEdit)}>
            Receiving
          </button>

          <button disabled={!canEdit} onClick={() => updateFlightStatus("LOADING")} style={btnStatus(canEdit)}>
            Loading
          </button>

          <button disabled={!canEdit} onClick={() => updateFlightStatus("LOADED")} style={btnStatus(canEdit)}>
            Loaded
          </button>
        </div>

        {!canEdit && (
          <p style={{ marginTop: 10, fontSize: "0.85rem", color: "#6b7280" }}>
            Read-only access.
          </p>
        )}
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 14, background: "#f9fafb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Cart Numbers</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
              Add cart numbers so Bagroom and Ramp can load bags by cart.
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>Carts added</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 900 }}>{cartNumbers.length}</div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={cartInput}
            onChange={(e) => setCartInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCartNumber();
              }
            }}
            placeholder="Cart number, e.g. 1, 2, 3, BULK, LATE"
            disabled={!canEdit}
            style={{
              flex: 1,
              minWidth: 220,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: canEdit ? "white" : "#f3f4f6",
            }}
          />

          <button
            onClick={addCartNumber}
            disabled={!canEdit}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #111827",
              background: canEdit ? "#111827" : "#9ca3af",
              color: "white",
              fontWeight: 800,
              cursor: canEdit ? "pointer" : "not-allowed",
            }}
          >
            Add Cart
          </button>
        </div>

        {cartMsg && (
          <p style={{ marginTop: 8, color: cartMsg.includes("✅") ? "#16a34a" : "#b91c1c", fontWeight: 800 }}>
            {cartMsg}
          </p>
        )}

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {cartNumbers.length === 0 ? (
            <span style={{ color: "#6b7280" }}>No carts added yet.</span>
          ) : (
            cartNumbers.map((cart) => (
              <span
                key={cart}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #d1d5db",
                  background: "white",
                  fontWeight: 800,
                }}
              >
                Cart {cart}

                {canEdit && (
                  <button
                    onClick={() => removeCartNumber(cart)}
                    title="Remove cart"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#b91c1c",
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))
          )}
        </div>
      </section>
            <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 14, background: "#f9fafb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Scan Bag Tags (Build Manifest)</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
              Scan bags one-by-one to build this flight manifest. Saves into <strong>allowedBagTags</strong>.
              <br />
              <strong>Only 10-digit numeric tags are accepted.</strong>
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>Manifest tags saved</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 900 }}>{loadingAllowed ? "…" : allowedCount}</div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(240px, 1fr)", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: 6 }}>
              Bag Tag (10 digits)
            </label>

            <input
              ref={scanRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={onScanKeyDown}
              disabled={!canEdit || savingScan}
              placeholder={!canEdit ? "Read-only" : "Scan bag tag…"}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                background: canEdit ? "white" : "#f3f4f6",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: "0.95rem",
              }}
            />

            <button
              onClick={() => saveScannedTagToManifest(scanInput)}
              disabled={!canEdit || savingScan}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #111827",
                background: !canEdit ? "#9ca3af" : "#111827",
                color: "white",
                fontWeight: 900,
                cursor: !canEdit ? "not-allowed" : "pointer",
                opacity: savingScan ? 0.7 : 1,
              }}
            >
              {savingScan ? "Saving…" : "Save Tag"}
            </button>

            <p style={{ marginTop: 10, color: "#6b7280", fontSize: "0.8rem" }}>
              Tip: if your scanner does NOT send Enter, the system auto-saves after a short pause.
            </p>

            {scanMsg && <p style={{ marginTop: 8, color: "#16a34a", fontWeight: 800 }}>{scanMsg}</p>}
            {scanErr && <p style={{ marginTop: 8, color: "#b91c1c", fontWeight: 800 }}>{scanErr}</p>}
          </div>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "white", padding: 10, maxHeight: 300, overflow: "auto" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <button onClick={() => setActiveManifestTab("recent")} style={tabBtn(activeManifestTab === "recent")}>
                Manifest Tags
              </button>

              <button onClick={() => setActiveManifestTab("missing")} style={tabBtn(activeManifestTab === "missing")}>
                Missing to Load ({missingManifestTags.length})
              </button>
            </div>

            {activeManifestTab === "recent" ? (
              <>
                <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: 8 }}>
                  Recent manifest tags (click ❌ to delete)
                </div>

                {loadingAllowed ? (
                  <p style={{ color: "#6b7280" }}>Loading…</p>
                ) : recentAllowed.length === 0 ? (
                  <p style={{ color: "#6b7280" }}>No tags saved yet.</p>
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
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: 8 }}>
                  Bag tags from manifest not loaded/scanned in aircraft yet.
                </div>

                {loadingAllowed || aircraftLoading ? (
                  <p style={{ color: "#6b7280" }}>Loading…</p>
                ) : missingManifestTags.length === 0 ? (
                  <p style={{ color: "#16a34a", fontWeight: 800 }}>All manifest tags are loaded ✅</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {missingManifestTags.map((tag) => (
                      <span key={tag} style={{ ...tagPill, background: "#FEF2F2", color: "#991B1B" }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Gate Total */}
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb", marginBottom: 14 }}>
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
          </div>
        </div>
      </section>

      {/* Manifest Import */}
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Flight Bag Tag Manifest (Import)</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
              Upload CSV/TXT/PDF or paste a list. System ignores names/PNR and imports only bag tag numbers.
              <br />
              <strong>Import reads ONLY numeric tags with exactly 10 digits.</strong>
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>Strict Manifest</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 800, color: strictManifest ? "#16a34a" : "#6b7280" }}>
              {strictManifest ? "ON" : "OFF"}
            </div>
          </div>
        </div>

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

        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: 6 }}>
            Paste manifest text (names/PNR allowed — only 10-digit numbers are used)
          </label>

          <textarea
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
            placeholder={`Example:\nName 0123456789 9876543210\nPNR: XYZ123 0123456789`}
            disabled={!canEdit}
            rows={6}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: canEdit ? "white" : "#f3f4f6",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: "0.85rem",
            }}
          />
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
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
              cursor: !canEdit || importing ? "not-allowed" : "pointer",
            }}
          >
            {importing ? "Importing..." : "Import to Flight"}
          </button>
        </div>

        {manifestMsg && <p style={{ marginTop: 10, fontSize: "0.9rem", color: "#16a34a", whiteSpace: "pre-wrap" }}>{manifestMsg}</p>}
        {manifestErr && <p style={{ marginTop: 10, fontSize: "0.9rem", color: "#b91c1c", whiteSpace: "pre-wrap" }}>{manifestErr}</p>}

        {manifestTagsPreview.length > 0 && (
          <div style={{ marginTop: 10, borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>
            <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>
              Preview: <strong>{manifestTagsPreview.length}</strong> tags found (10-digit only)
              <span style={{ marginLeft: 8, color: "#6b7280" }}> — click ❌ to remove before import</span>
            </div>

            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 220, overflow: "auto" }}>
              {manifestTagsPreview.map((t) => (
                <span key={t} style={tagPill}>
                  {t}
                  <button
                    onClick={() => removeFromPreview(t)}
                    disabled={!canEdit}
                    title="Remove from preview"
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: canEdit ? "pointer" : "not-allowed",
                      fontWeight: 900,
                      color: "#b91c1c",
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginTop: 12 }}>
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
              <span style={{ color: "#b91c1c", fontWeight: 800 }}>Missing: {missing}</span>
            )}
          </div>
        </div>
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

      

// src/pages/GateControllerPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function toIntSafe(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

// Extrae SOLO números (bag tags) e ignora todo lo demás
// Por defecto: toma secuencias de 6 a 12 dígitos (ajustable)
function extractBagTagsFromText(text, { minLen = 6, maxLen = 12 } = {}) {
  const src = String(text || "");
  const matches = src.match(/\d+/g) || [];
  const tags = matches
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen && s.length <= maxLen);

  // Deduplicate manteniendo orden
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

export default function GateControllerPage({ flightId, user, gateControllerOnDuty, canEdit }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);
  const isGateController = role === "gate_controller";

  // vuelo
  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] = useState(true);

  // gate totals
  const [checkedTotalInput, setCheckedTotalInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // aircraft scans summary (subcolección aircraftScans)
  const [aircraftTotal, setAircraftTotal] = useState(0);
  const [zones, setZones] = useState({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [aircraftLoading, setAircraftLoading] = useState(true);

  // Manifest upload
  const [manifestText, setManifestText] = useState("");
  const [manifestTagsPreview, setManifestTagsPreview] = useState([]);
  const [manifestMsg, setManifestMsg] = useState("");
  const [manifestErr, setManifestErr] = useState("");
  const [importing, setImporting] = useState(false);

  // Strict manifest toggle (se guarda en el doc del vuelo)
  const [strictManifest, setStrictManifest] = useState(false);

  // Load flight doc
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
        } else if (data.checkedBagsTotal === null || data.checkedBagsTotal === undefined) {
          setCheckedTotalInput("");
        }

        if (typeof data.strictManifest === "boolean") {
          setStrictManifest(data.strictManifest);
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

  // Load aircraft scan summary
  useEffect(() => {
    if (!flightId) return;

    const run = async () => {
      try {
        setAircraftLoading(true);
        const scansRef = collection(db, "flights", flightId, "aircraftScans");
        const snap = await getDocs(scansRef);

        let total = 0;
        const z = { 1: 0, 2: 0, 3: 0, 4: 0 };

        snap.forEach((d) => {
          const data = d.data();
          total += 1;
          const zone = Number(data.zone);
          if (zone >= 1 && zone <= 4) z[zone] += 1;
        });

        setAircraftTotal(total);
        setZones(z);
        setAircraftLoading(false);
      } catch (err) {
        console.error("GateControllerPage aircraft summary error:", err);
        setAircraftTotal(0);
        setZones({ 1: 0, 2: 0, 3: 0, 4: 0 });
        setAircraftLoading(false);
      }
    };

    run();
  }, [flightId]);

  const checkedBagsTotal = typeof flight?.checkedBagsTotal === "number" ? flight.checkedBagsTotal : null;
  const missing = checkedBagsTotal === null ? null : Math.max(0, checkedBagsTotal - aircraftTotal);

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
        gateControllerOnDuty: gateControllerOnDuty || null,
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
        { strictManifest: Boolean(nextValue), strictManifestUpdatedAt: serverTimestamp() },
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

    const tags = extractBagTagsFromText(text, { minLen: 6, maxLen: 12 });
    setManifestTagsPreview(tags);

    if (tags.length === 0) {
      setManifestErr("No bag tag numbers found. Paste/upload manifest again.");
      return;
    }

    setManifestMsg(`Preview: found ${tags.length} bag tags (names/PNR ignored).`);
  };

  const handleFilePick = async (file) => {
    setManifestMsg("");
    setManifestErr("");
    try {
      const text = await readFileAsText(file);
      setManifestText(text);
      previewFromText(text);
    } catch (e) {
      console.error(e);
      setManifestErr("Could not read file. Please try CSV/TXT.");
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
      setManifestErr("Nothing to import. Click Preview first.");
      return;
    }

    try {
      setImporting(true);

      // Escribimos en flights/{flightId}/allowedBagTags/{tag}
      // en batches de 450 para ir seguros
      const chunkSize = 450;
      let imported = 0;

      for (let i = 0; i < tags.length; i += chunkSize) {
        const chunk = tags.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        for (const tag of chunk) {
          const ref = doc(db, "flights", flightId, "allowedBagTags", tag);
          batch.set(ref, {
            tag,
            importedAt: serverTimestamp(),
            importedBy: {
              userId: user?.id || null,
              username: user?.username || null,
              role: user?.role || null,
            },
            // 👇 intencionalmente NO guardamos nombre/PNR para evitar confusión
          });
        }

        await batch.commit();
        imported += chunk.length;
      }

      // Activamos Strict Manifest automáticamente (recomendado)
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
      setImporting(false);
      setTimeout(() => setManifestMsg(""), 2500);
    } catch (e) {
      console.error(e);
      setManifestErr("Import failed. Check Firestore rules and try again.");
      setImporting(false);
    }
  };

  const title = isGateController ? "Gate Controller (Read Only)" : "Gate Controller";

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
            Verified counts and manifest for Ramp coordination.
          </p>
        </div>

        {!isGateController && gateControllerOnDuty && (
          <div style={{ textAlign: "right", fontSize: "0.9rem" }}>
            Gate Controller on duty: <strong>{gateControllerOnDuty}</strong>
          </div>
        )}
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "14px 0" }} />

      {/* Flight info */}
      {flightLoading ? (
        <p style={{ color: "#6b7280" }}>Loading flight...</p>
      ) : !flight ? (
        <p style={{ color: "#b91c1c" }}>Flight not found.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
          <InfoCard label="Flight" value={flight.flightNumber || flight.id} />
          <InfoCard label="Date" value={flight.flightDate || "-"} />
          <InfoCard label="Gate" value={flight.gate || "-"} />
          <InfoCard label="Aircraft" value={flight.aircraftType || "-"} />
        </div>
      )}

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
            <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: 6 }}>Total</label>
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

            {!canEdit && (
              <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#6b7280" }}>
                Read-only access.
              </p>
            )}
          </div>
        </div>

        {flight?.gateTotalUpdatedBy?.username && (
          <p style={{ marginTop: 10, color: "#6b7280", fontSize: "0.85rem" }}>
            Last updated by <strong>{flight.gateTotalUpdatedBy.username}</strong>{" "}
            {flight.gateTotalUpdatedBy.role ? `(${flight.gateTotalUpdatedBy.role})` : ""}.
          </p>
        )}
      </section>

      {/* Manifest Import */}
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Flight Bag Tag Manifest</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
              Upload or paste a list. System ignores names/PNR and imports only bag tag numbers.
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
            accept=".csv,.txt,text/csv,text/plain"
            disabled={!canEdit}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFilePick(f);
            }}
          />

          <button
            disabled={!canEdit}
            onClick={() => updateStrictManifest(!strictManifest)}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: canEdit ? "white" : "#f3f4f6",
              cursor: canEdit ? "pointer" : "not-allowed",
            }}
          >
            Toggle Strict Manifest
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: 6 }}>
            Paste manifest text (names/PNR allowed — only numbers are used)
          </label>
          <textarea
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
            placeholder={`Example:\nAlexis Napoles 034498484 034578585\nPNR: XYZ123 03457474`}
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
          <button
            onClick={() => previewFromText(manifestText)}
            disabled={!canEdit}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "white",
              cursor: canEdit ? "pointer" : "not-allowed",
            }}
          >
            Preview Tags
          </button>

          <button
            onClick={importManifest}
            disabled={!canEdit || importing || manifestTagsPreview.length === 0}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #1d4ed8",
              background: (!canEdit || importing) ? "#93c5fd" : "#2563eb",
              color: "white",
              fontWeight: 800,
              cursor: (!canEdit || importing) ? "not-allowed" : "pointer",
            }}
          >
            {importing ? "Importing..." : "Import to Flight"}
          </button>
        </div>

        {manifestMsg && (
          <p style={{ marginTop: 10, fontSize: "0.9rem", color: "#16a34a" }}>{manifestMsg}</p>
        )}
        {manifestErr && (
          <p style={{ marginTop: 10, fontSize: "0.9rem", color: "#b91c1c" }}>{manifestErr}</p>
        )}

        {manifestTagsPreview.length > 0 && (
          <div style={{ marginTop: 10, borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>
            <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>
              Preview (first 30): <strong>{manifestTagsPreview.length}</strong> tags found
            </div>
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {manifestTagsPreview.slice(0, 30).map((t) => (
                <span
                  key={t}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 999,
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                    fontSize: "0.8rem",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  }}
                >
                  {t}
                </span>
              ))}
              {manifestTagsPreview.length > 30 && (
                <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                  … +{manifestTagsPreview.length - 30} more
                </span>
              )}
            </div>
          </div>
        )}

        {!canEdit && (
          <p style={{ marginTop: 10, fontSize: "0.85rem", color: "#6b7280" }}>
            Gate Controller has read-only access to manifests.
          </p>
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 12 }}>
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
              <span style={{ color: "#b91c1c", fontWeight: 800 }}>
                Missing: {missing}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "white" }}>
      <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{value}</div>
    </div>
  );
}

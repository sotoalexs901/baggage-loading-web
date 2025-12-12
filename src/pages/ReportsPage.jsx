// src/pages/ReportsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db, storage } from "../firebase";
import { deleteObject, ref as sRef } from "firebase/storage";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

export default function ReportsPage({ flightId, user }) {
  const role = useMemo(() => normalizeRole(user?.role), [user]);
  const canDelete = role === "station_manager" || role === "duty_manager";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");

  useEffect(() => {
    if (!flightId) return;

    setLoading(true);
    const q = query(collection(db, "flights", flightId, "reports"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRows(list);
        setLoading(false);
      },
      (err) => {
        console.error("ReportsPage error:", err);
        setRows([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  const handleDelete = async (r) => {
    if (!canDelete) return;

    const ok = window.confirm(
      `Delete this report?\n\n${r.fileName || r.id}\n\nThis cannot be undone.`
    );
    if (!ok) return;

    const docId = r.fileName || r.id;

    try {
      setDeletingId(docId);

      // 1) delete from Storage (best-effort)
      if (r.storagePath) {
        await deleteObject(sRef(storage, r.storagePath));
      }

      // 2) delete Firestore doc
      await deleteDoc(doc(db, "flights", flightId, "reports", docId));
    } catch (e) {
      console.error("Delete report failed:", e);
      alert(
        "Failed to delete report.\n\nIf Storage delete is blocked by rules, ask Station/Duty Manager to update Storage rules."
      );
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Flight Reports</h2>
          <p style={{ color: "#6b7280", marginTop: 0 }}>
            PDFs exported from Aircraft “Loading Completed” will appear here.
          </p>
        </div>

        <div style={{ fontSize: "0.85rem", color: canDelete ? "#16a34a" : "#6b7280", fontWeight: 800 }}>
          {canDelete ? "Delete enabled" : "Delete: Station/Duty Manager only"}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <p style={{ color: "#6b7280" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No reports saved yet for this flight.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={th}>File</th>
                <th style={th}>Created By</th>
                <th style={{ ...th, textAlign: "right" }}>Download</th>
                <th style={{ ...th, textAlign: "right" }}>Delete</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = r.fileName || r.id;
                const busy = deletingId === id;

                return (
                  <tr key={r.id}>
                    <td style={td}>
                      <strong>{id}</strong>
                    </td>
                    <td style={td}>{r.createdBy?.username || "-"}</td>

                    <td style={{ ...td, textAlign: "right" }}>
                      {r.downloadUrl ? (
                        <a href={r.downloadUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 800 }}>
                          Open PDF
                        </a>
                      ) : (
                        <span style={{ color: "#6b7280" }}>—</span>
                      )}
                    </td>

                    <td style={{ ...td, textAlign: "right" }}>
                      <button
                        onClick={() => handleDelete(r)}
                        disabled={!canDelete || busy}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: "1px solid #ef4444",
                          background: !canDelete ? "#fecaca" : "#ef4444",
                          color: "white",
                          fontWeight: 900,
                          cursor: !canDelete ? "not-allowed" : "pointer",
                          opacity: busy ? 0.7 : 1,
                        }}
                      >
                        {busy ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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

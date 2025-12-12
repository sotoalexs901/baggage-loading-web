// src/pages/ReportsPage.jsx
import React, { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";

export default function ReportsPage({ flightId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!flightId) return;

    setLoading(true);
    const q = query(
      collection(db, "flights", flightId, "reports"),
      orderBy("createdAt", "desc")
    );

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

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Flight Reports</h2>
      <p style={{ color: "#6b7280", marginTop: 6 }}>
        PDFs exported from Aircraft “Loading Completed” will appear here.
      </p>

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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}><strong>{r.fileName || r.id}</strong></td>
                  <td style={td}>{r.createdBy?.username || "-"}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {r.downloadUrl ? (
                      <a
                        href={r.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontWeight: 800 }}
                      >
                        Open PDF
                      </a>
                    ) : (
                      <span style={{ color: "#6b7280" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
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

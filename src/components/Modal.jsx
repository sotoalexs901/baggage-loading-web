// src/components/Modal.jsx
import React from "react";

export default function Modal({
  open,
  title,
  children,
  tone = "info", // info | success | warning | danger
  confirmText = "OK",
  cancelText = "Cancel",
  showCancel = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const toneMap = {
    info: { bar: "#2563eb", bg: "#eff6ff", text: "#1e3a8a", border: "#bfdbfe" },
    success: { bar: "#16a34a", bg: "#ecfdf5", text: "#065f46", border: "#bbf7d0" },
    warning: { bar: "#f59e0b", bg: "#fffbeb", text: "#92400e", border: "#fde68a" },
    danger: { bar: "#dc2626", bg: "#fef2f2", text: "#991b1b", border: "#fecaca" },
  };

  const c = toneMap[tone] || toneMap.info;

  return (
    <div style={styles.backdrop} onMouseDown={onCancel}>
      <div style={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ ...styles.topBar, background: c.bar }} />
        <div style={{ ...styles.header, background: c.bg, borderColor: c.border }}>
          <h3 style={{ margin: 0, color: c.text, fontSize: "1.05rem" }}>{title}</h3>
        </div>

        <div style={styles.body}>{children}</div>

        <div style={styles.footer}>
          {showCancel && (
            <button onClick={onCancel} style={styles.btnSecondary}>
              {cancelText}
            </button>
          )}
          <button onClick={onConfirm} style={styles.btnPrimary}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 9999,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 16,
    background: "white",
    boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
    overflow: "hidden",
  },
  topBar: { height: 6 },
  header: {
    padding: "12px 14px",
    borderBottom: "1px solid",
  },
  body: { padding: 14, color: "#111827", fontSize: "0.95rem", lineHeight: 1.35 },
  footer: {
    padding: 14,
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    borderTop: "1px solid #e5e7eb",
    background: "#f9fafb",
  },
  btnPrimary: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
  },
  btnSecondary: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "white",
    color: "#111827",
    fontWeight: 700,
    cursor: "pointer",
  },
};

// src/components/VersionUpdateNotice.jsx
import React, { useState } from "react";

const CURRENT_VERSION = "1.7";

const STORAGE_KEY =
  "blcsAcknowledgedVersion";

export default function VersionUpdateNotice() {
  const [visible, setVisible] = useState(() => {
    const savedVersion =
      localStorage.getItem(
        STORAGE_KEY
      );

    return (
      savedVersion !==
      CURRENT_VERSION
    );
  });

  const handleRefresh = () => {
    localStorage.setItem(
      STORAGE_KEY,
      CURRENT_VERSION
    );

    setVisible(false);

    window.location.reload();
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      style={{
        marginBottom: 14,
        padding: "13px 14px",
        borderRadius: 12,
        border: "1px solid #bfdbfe",
        background: "#eff6ff",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 220,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: "4px 8px",
            borderRadius: 999,
            background: "#dbeafe",
            color: "#1d4ed8",
            fontSize: "0.7rem",
            fontWeight: 900,
            marginBottom: 5,
          }}
        >
          NEW UPDATE · v{CURRENT_VERSION}
        </div>

        <div
          style={{
            color: "#1e3a8a",
            fontWeight: 900,
            fontSize: "0.95rem",
          }}
        >
          BLCS Version {CURRENT_VERSION} is now available
        </div>

        <div
          style={{
            marginTop: 3,
            color: "#475569",
            fontSize: "0.8rem",
            lineHeight: 1.45,
          }}
        >
          The system has been updated with new features and improvements.
          Please refresh BLCS to ensure you are using the latest version.
        </div>
      </div>

      <button
        type="button"
        onClick={handleRefresh}
        style={{
          minHeight: 42,
          padding: "9px 16px",
          borderRadius: 10,
          border: "1px solid #2563eb",
          background: "#2563eb",
          color: "white",
          fontWeight: 900,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Refresh Now
      </button>
    </div>
  );
}

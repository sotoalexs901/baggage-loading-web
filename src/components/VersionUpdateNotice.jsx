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

    return savedVersion !== CURRENT_VERSION;
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
        position: "fixed",
        inset: 0,
        zIndex: 9999,

        display: "flex",
        alignItems: "center",
        justifyContent: "center",

        padding: 16,

        background:
          "rgba(15, 23, 42, 0.55)",

        backdropFilter:
          "blur(3px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,

          background: "white",

          borderRadius: 18,

          padding: "22px 20px",

          boxShadow:
            "0 24px 70px rgba(15,23,42,0.35)",

          border:
            "1px solid #dbeafe",

          textAlign: "center",
        }}
      >
        {/* VERSION BADGE */}

        <div
          style={{
            display: "inline-flex",

            padding: "5px 10px",

            borderRadius: 999,

            background:
              "#dbeafe",

            color:
              "#1d4ed8",

            fontSize:
              "0.7rem",

            fontWeight:
              900,

            letterSpacing:
              "0.06em",

            marginBottom:
              12,
          }}
        >
          NEW UPDATE · v{CURRENT_VERSION}
        </div>

        {/* ICON */}

        <div
          style={{
            width: 54,
            height: 54,

            margin:
              "0 auto 12px",

            borderRadius:
              "50%",

            background:
              "#eff6ff",

            display:
              "flex",

            alignItems:
              "center",

            justifyContent:
              "center",

            fontSize:
              "1.6rem",
          }}
        >
          ↻
        </div>

        {/* TITLE */}

        <h3
          style={{
            margin:
              "0 0 8px",

            color:
              "#0f172a",

            fontSize:
              "1.15rem",

            fontWeight:
              900,
          }}
        >
          BLCS Version {CURRENT_VERSION}
        </h3>

        {/* MESSAGE */}

        <p
          style={{
            margin:
              "0 auto",

            maxWidth:
              300,

            color:
              "#64748b",

            fontSize:
              "0.82rem",

            lineHeight:
              1.5,
          }}
        >
          A new version of BLCS is available with
          new features and improvements.
          Please refresh the system before continuing.
        </p>

        {/* BUTTON */}

        <button
          type="button"
          onClick={
            handleRefresh
          }
          style={{
            width:
              "100%",

            minHeight:
              46,

            marginTop:
              18,

            borderRadius:
              12,

            border:
              "none",

            background:
              "#2563eb",

            color:
              "white",

            fontSize:
              "0.9rem",

            fontWeight:
              900,

            cursor:
              "pointer",

            boxShadow:
              "0 8px 18px rgba(37,99,235,0.22)",
          }}
        >
          Refresh Now
        </button>

        <div
          style={{
            marginTop:
              10,

            color:
              "#94a3b8",

            fontSize:
              "0.68rem",
          }}
        >
          BLCS · Baggage Loading Control System
        </div>
      </div>
    </div>
  );
}

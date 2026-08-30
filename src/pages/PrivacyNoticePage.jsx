// src/pages/PrivacyNoticePage.jsx
import React, { useState } from "react";

export const PRIVACY_NOTICE_VERSION = "1.0";

export default function PrivacyNoticePage({
  user,
  onAccept,
  onLogout,
  saving = false,
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background:
          "linear-gradient(135deg, #020617 0%, #0f172a 50%, #172554 100%)",
        padding: "20px 14px",
        boxSizing: "border-box",
        fontFamily:
          "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 760,
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: 20,
          overflow: "hidden",
          boxShadow:
            "0 25px 70px rgba(0,0,0,0.35)",
        }}
      >
        {/* HEADER */}

        <div
          style={{
            padding: "24px 22px",
            background:
              "linear-gradient(135deg, #172554, #2563eb)",
            color: "white",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              padding: "5px 9px",
              borderRadius: 999,
              background:
                "rgba(255,255,255,0.12)",
              border:
                "1px solid rgba(255,255,255,0.18)",
              fontSize: "0.7rem",
              fontWeight: 900,
              letterSpacing: "0.07em",
            }}
          >
            BLCS · TPA
          </div>

          <h1
            style={{
              margin: "12px 0 4px",
              fontSize: "1.65rem",
            }}
          >
            Privacy & System Use Notice
          </h1>

          <p
            style={{
              margin: 0,
              color: "#dbeafe",
              fontSize: "0.85rem",
              lineHeight: 1.5,
            }}
          >
            Baggage Loading Control System
          </p>
        </div>

        {/* CONTENT */}

        <div
          style={{
            padding: "22px",
          }}
        >
          <p
            style={{
              marginTop: 0,
              color: "#334155",
              lineHeight: 1.65,
              fontSize: "0.9rem",
            }}
          >
            Hello{" "}
            <strong>
              {user?.fullName ||
                user?.username ||
                "User"}
            </strong>
            . Before accessing BLCS, please
            review this notice regarding the
            operational information recorded
            through the system.
          </p>

          <NoticeSection title="Purpose of the System">
            BLCS is an operational baggage
            handling system used to support,
            document, verify, and track baggage
            movement and loading activities
            associated with airport operations.
          </NoticeSection>

          <NoticeSection title="Information Recorded">
            Depending on the function being
            performed, BLCS may record your
            assigned username, role, flight
            information, baggage tag numbers,
            scan activity, operational location
            or stage, date and time of activity,
            baggage status, loading information,
            reports, and other operational
            actions performed through your
            account.
          </NoticeSection>

          <NoticeSection title="Baggage Tracking">
            Baggage activity may be recorded
            across operational stages including
            Counter, Bagroom, Gate, and Aircraft.
            These records may be used to provide
            baggage traceability and to identify
            when and where an operational action
            was recorded.
          </NoticeSection>

          <NoticeSection title="Operational Accountability">
            Actions performed while signed in
            with your assigned credentials may
            be associated with your user account.
            Records may be reviewed for
            operational control, baggage
            reconciliation, safety, security,
            quality assurance, investigations,
            auditing, training, and compliance
            purposes.
          </NoticeSection>

          <NoticeSection title="Authorized Use">
            This system is intended only for
            authorized operational use. Users
            must use their own assigned
            credentials and must not share their
            username or PIN with another person.
          </NoticeSection>

          <NoticeSection title="Data Entry">
            Only information necessary to
            perform the applicable baggage or
            flight operation should be entered
            into BLCS. Users should not enter
            unnecessary personal, confidential,
            or unrelated information into the
            system.
          </NoticeSection>

          <NoticeSection title="System Records">
            Information recorded in BLCS may be
            retained as necessary to support
            operational records, baggage
            tracking, reporting, audits,
            investigations, compliance
            requirements, and system
            administration.
          </NoticeSection>

          <div
            style={{
              marginTop: 20,
              padding: 14,
              borderRadius: 12,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              color: "#1e3a8a",
              fontSize: "0.82rem",
              lineHeight: 1.55,
            }}
          >
            <strong>Important:</strong> BLCS
            records are operational records.
            Always verify that the correct
            flight and baggage information is
            selected before scanning or
            submitting information.
          </div>

          {/* ACCEPTANCE */}

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              marginTop: 22,
              padding: 15,
              borderRadius: 12,
              border: agreed
                ? "1px solid #2563eb"
                : "1px solid #cbd5e1",
              background: agreed
                ? "#eff6ff"
                : "#f8fafc",
              cursor: saving
                ? "default"
                : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={agreed}
              disabled={saving}
              onChange={(e) =>
                setAgreed(e.target.checked)
              }
              style={{
                width: 22,
                height: 22,
                marginTop: 1,
                flexShrink: 0,
              }}
            />

            <span
              style={{
                color: "#334155",
                fontSize: "0.86rem",
                lineHeight: 1.5,
                fontWeight: 600,
              }}
            >
              I have read and understand this
              Privacy & System Use Notice and
              agree to use BLCS in accordance
              with these requirements.
            </span>
          </label>

          {/* BUTTONS */}

          <button
            type="button"
            disabled={!agreed || saving}
            onClick={onAccept}
            style={{
              width: "100%",
              minHeight: 54,
              marginTop: 16,
              border: "none",
              borderRadius: 12,
              background:
                !agreed || saving
                  ? "#94a3b8"
                  : "#2563eb",
              color: "white",
              fontWeight: 900,
              fontSize: "0.95rem",
              cursor:
                !agreed || saving
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {saving
              ? "Saving acceptance..."
              : "Accept & Continue"}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={onLogout}
            style={{
              width: "100%",
              minHeight: 46,
              marginTop: 8,
              border:
                "1px solid #cbd5e1",
              borderRadius: 12,
              background: "white",
              color: "#475569",
              fontWeight: 700,
              cursor: saving
                ? "not-allowed"
                : "pointer",
            }}
          >
            Sign Out
          </button>

          <div
            style={{
              marginTop: 20,
              textAlign: "center",
              color: "#94a3b8",
              fontSize: "0.68rem",
              lineHeight: 1.5,
            }}
          >
            Privacy Notice Version{" "}
            {PRIVACY_NOTICE_VERSION}
            <br />
            System managed by{" "}
            <strong>ANapoles Solutions</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoticeSection({
  title,
  children,
}) {
  return (
    <div
      style={{
        marginTop: 17,
      }}
    >
      <h2
        style={{
          margin: "0 0 5px",
          color: "#0f172a",
          fontSize: "0.95rem",
        }}
      >
        {title}
      </h2>

      <p
        style={{
          margin: 0,
          color: "#64748b",
          fontSize: "0.84rem",
          lineHeight: 1.6,
        }}
      >
        {children}
      </p>
    </div>
  );
}

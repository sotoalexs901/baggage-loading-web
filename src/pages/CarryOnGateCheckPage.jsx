// src/pages/CarryOnGateCheckPage.jsx

import React, {
  useMemo,
  useState,
} from "react";

const TABS = [
  "SETUP",
  "COUNTER",
  "GATE",
  "RAMP",
  "TRACKING",
  "REPORT",
];

export default function CarryOnGateCheckPage({
  user,
  operationalContext,
}) {
  const [activeTab, setActiveTab] =
    useState("SETUP");

  const displayName =
    useMemo(
      () =>
        operationalContext?.employeeFullName ||
        user?.fullName ||
        user?.username ||
        "-",
      [
        operationalContext?.employeeFullName,
        user?.fullName,
        user?.username,
      ]
    );

  const positionLabel =
    operationalContext?.operationalPositionLabel ||
    operationalContext?.operationalPosition ||
    null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                color: "#7c3aed",
                fontSize: "0.72rem",
                fontWeight: 900,
                letterSpacing: "0.07em",
              }}
            >
              BLCS OPERATIONS
            </div>

            <h2 style={{ margin: "5px 0 0" }}>
              Carry-On Gate Check Control
            </h2>

            <p
              style={{
                margin: "6px 0 0",
                color: "#64748b",
                maxWidth: 720,
              }}
            >
              Control carry-on gate checks from flight
              setup and counter assignment through Gate
              collection, Ramp receipt, Aircraft loading,
              tracking and final reporting.
            </p>
          </div>

          <div
            style={{
              textAlign: "right",
              color: "#64748b",
              fontSize: "0.78rem",
            }}
          >
            <div>
              User:{" "}
              <strong style={{ color: "#0f172a" }}>
                {displayName}
              </strong>
            </div>

            {positionLabel && (
              <div style={{ marginTop: 4 }}>
                Working as:{" "}
                <strong style={{ color: "#0f172a" }}>
                  {positionLabel}
                </strong>
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {TABS.map((tab) => {
            const active = activeTab === tab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: active
                    ? "1px solid #7c3aed"
                    : "1px solid #d1d5db",
                  background: active
                    ? "#7c3aed"
                    : "white",
                  color: active
                    ? "white"
                    : "#334155",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </section>

      <section
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 16,
        }}
      >
        {activeTab === "SETUP" && <SetupPreview />}

        {activeTab === "COUNTER" && (
          <ComingSoon
            title="Counter Assignment"
            description="Passenger selection, assigned empty seat, Gate Check number and last-minute passenger / Gate Check entry will be built here."
          />
        )}

        {activeTab === "GATE" && (
          <ComingSoon
            title="Gate Collection"
            description="Gate Controller will confirm each Carry-On Gate Check as Collected at Gate."
          />
        )}

        {activeTab === "RAMP" && (
          <ComingSoon
            title="Ramp & Aircraft"
            description="Ramp will confirm Received at Ramp, then Loaded with Forward / Middle / Aft compartment."
          />
        )}

        {activeTab === "TRACKING" && (
          <ComingSoon
            title="Carry-On Tracking"
            description="Timeline from Counter Assigned through Aircraft Loaded."
          />
        )}

        {activeTab === "REPORT" && (
          <ComingSoon
            title="Final Report"
            description="Operational summary and printable final Carry-On Gate Check report."
          />
        )}
      </section>
    </div>
  );
}

function SetupPreview() {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h3 style={{ margin: 0 }}>
          Flight Setup
        </h3>

        <p
          style={{
            margin: "6px 0 0",
            color: "#64748b",
          }}
        >
          This is the first construction stage. The next
          version will connect PDF parsing and Firestore.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        <SetupCard
          title="Passenger Manifest"
          text="Upload manifest and retain only passenger name and original seat."
        />

        <SetupCard
          title="Empty Seats Report"
          text="Upload report and retain available seat number, seat type and blocked-seat status."
        />

        <SetupCard
          title="Required Carry-Ons"
          text="Supervisor manually sets how many Carry-On Gate Checks are required for this flight."
        />

        <SetupCard
          title="Gate Check Numbers"
          text="Duty Manager / Supervisor preloads the Gate Check numbers available for Counter assignment."
        />
      </div>

      <div
        style={{
          padding: 12,
          borderRadius: 12,
          border: "1px solid #fde68a",
          background: "#fffbeb",
          color: "#92400e",
        }}
      >
        <strong>
          Last-minute operations supported:
        </strong>{" "}
        Counter will be able to add a passenger name
        and/or a new Gate Check number without leaving
        the flight.
      </div>
    </div>
  );
}

function SetupCard({ title, text }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        background: "#f8fafc",
      }}
    >
      <strong style={{ color: "#0f172a" }}>
        {title}
      </strong>

      <div
        style={{
          marginTop: 5,
          color: "#64748b",
          fontSize: "0.82rem",
          lineHeight: 1.45,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ComingSoon({
  title,
  description,
}) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        background: "#f8fafc",
      }}
    >
      <h3 style={{ margin: 0 }}>
        {title}
      </h3>

      <p
        style={{
          margin: "6px 0 0",
          color: "#64748b",
        }}
      >
        {description}
      </p>
    </div>
  );
}

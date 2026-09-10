// src/pages/carryOn/CarryOnCounterPage.jsx

import React from "react";

export default function CarryOnCounterPage({
  selectedCarryOnFlightId,
}) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <h3 style={{ margin: 0 }}>Counter Assignment</h3>
      <p
        style={{
          margin: "6px 0 0",
          color: "#64748b",
        }}
      >
        Passenger, seat and Gate Check assignment will be built here next.
      </p>

      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 10,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          color: "#475569",
          fontSize: "0.82rem",
        }}
      >
        Selected Carry-On Flight:{" "}
        <strong>
          {selectedCarryOnFlightId || "None"}
        </strong>
      </div>
    </section>
  );
}

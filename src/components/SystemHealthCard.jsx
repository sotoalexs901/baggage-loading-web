// src/components/SystemHealthCard.jsx

import React from "react";

function getTone(
  successRate
) {
  if (
    successRate >= 98
  ) {
    return {
      label:
        "Healthy",

      background:
        "#f0fdf4",

      border:
        "#86efac",

      color:
        "#166534",
    };
  }

  if (
    successRate >= 94
  ) {
    return {
      label:
        "Warning",

      background:
        "#fffbeb",

      border:
        "#fde68a",

      color:
        "#92400e",
    };
  }

  return {
    label:
      "Attention",

    background:
      "#fef2f2",

    border:
      "#fecaca",

    color:
      "#991b1b",
  };
}

export default function SystemHealthCard({
  title,
  metrics,
  onClick,
}) {
  const total =
    Number(
      metrics?.totalActions ||
        0
    );

  const success =
    Number(
      metrics
        ?.statusCounts
        ?.SUCCESS ||
        0
    );

  const warnings =
    Number(
      metrics
        ?.statusCounts
        ?.WARNING ||
        0
    );

  const errors =
    Number(
      metrics
        ?.statusCounts
        ?.ERROR ||
        0
    );

  const successRate =
    total > 0
      ? (success / total) *
        100
      : 100;

  const performanceSamples =
    Number(
      metrics
        ?.performanceSamples ||
        0
    );

  const totalDurationMs =
    Number(
      metrics
        ?.totalDurationMs ||
        0
    );

  const averageMs =
    performanceSamples > 0
      ? totalDurationMs /
        performanceSamples
      : 0;

  const tone =
    getTone(
      successRate
    );

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        border:
          `1px solid ${tone.border}`,
        background:
          tone.background,
        borderRadius: 14,
        padding: 14,
        cursor:
          onClick
            ? "pointer"
            : "default",
      }}
    >
      <div
        style={{
          display:
            "flex",

          justifyContent:
            "space-between",

          gap: 10,
        }}
      >
        <strong
          style={{
            fontSize:
              "0.95rem",

            color:
              "#0f172a",
          }}
        >
          {title}
        </strong>

        <span
          style={{
            color:
              tone.color,

            fontWeight:
              900,

            fontSize:
              "0.72rem",
          }}
        >
          {tone.label}
        </span>
      </div>

      <div
        style={{
          marginTop:
            10,

          fontSize:
            "1.7rem",

          fontWeight:
            900,

          color:
            tone.color,
        }}
      >
        {successRate.toFixed(
          1
        )}
        %
      </div>

      <div
        style={{
          marginTop:
            3,

          color:
            "#64748b",

          fontSize:
            "0.75rem",
        }}
      >
        Success rate
      </div>

      <div
        style={{
          marginTop:
            12,

          display:
            "grid",

          gridTemplateColumns:
            "repeat(3, 1fr)",

          gap:
            6,
        }}
      >
        <Mini
          label="Actions"
          value={total}
        />

        <Mini
          label="Warnings"
          value={warnings}
        />

        <Mini
          label="Errors"
          value={errors}
        />
      </div>

      <div
        style={{
          marginTop:
            10,

          paddingTop:
            9,

          borderTop:
            "1px solid rgba(15,23,42,0.08)",

          color:
            "#475569",

          fontSize:
            "0.76rem",
        }}
      >
        Avg response:{" "}
        <strong>
          {averageMs > 0
            ? averageMs <
              1000
              ? `${Math.round(
                  averageMs
                )} ms`
              : `${(
                  averageMs /
                  1000
                ).toFixed(
                  2
                )} sec`
            : "No data"}
        </strong>
      </div>
    </button>
  );
}

function Mini({
  label,
  value,
}) {
  return (
    <div>
      <div
        style={{
          fontWeight:
            900,

          color:
            "#0f172a",
        }}
      >
        {value}
      </div>

      <div
        style={{
          color:
            "#64748b",

          fontSize:
            "0.67rem",
        }}
      >
        {label}
      </div>
    </div>
  );
}

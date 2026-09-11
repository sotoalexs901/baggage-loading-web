// src/pages/CarryOnReportPage.jsx

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  onSnapshot,
} from "firebase/firestore";

import { db } from "../firebase";

const BLCS_LOGO_SRC = "/blcs-icon-512.png";

function cleanUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function formatTimestamp(value) {
  if (!value) return "-";

  try {
    const date =
      typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString();
  } catch {
    return "-";
  }
}

function actorName(value) {
  return (
    value?.fullName ||
    value?.username ||
    "-"
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openPrintDocument(html, onBlocked) {
  const printWindow = window.open(
    "",
    "_blank",
    "width=1200,height=900"
  );

  if (!printWindow) {
    onBlocked?.();
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 400);
}


function buildCarryOnReportHtml({
  flight,
  rows,
  requiredCount,
  loadedCount,
  offloadedCount,
  remainingToLoad,
  additionalCount,
  compartmentTotals,
}) {
  const logoUrl = `${window.location.origin}/blcs-icon-512.png`;
  const route = `${flight?.origin || "-"} -> ${flight?.destination || "-"}`;

  const bodyRows = rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.passengerName || "-")}</td>
      <td>${escapeHtml(item.assignedSeat || "-")}</td>
      <td><strong>${escapeHtml(item.gateCheckNumber || "-")}</strong></td>
      <td>${escapeHtml(item.carryOnDescription || "-")}</td>
      <td>${escapeHtml(item.carryOnCode || "-")}</td>
      <td>${escapeHtml(item.counterRecordedWeightLbs ? `${item.counterRecordedWeightLbs} lb` : "-")}</td>
      <td>${escapeHtml(item.gateVerifiedWeightLbs ? `${item.gateVerifiedWeightLbs} lb` : "-")}</td>
      <td>${escapeHtml(item.status || "-")}</td>
      <td>${escapeHtml(formatTimestamp(item.counterAssignedAt))}</td>
      <td>${escapeHtml(actorName(item.counterAssignedBy))}</td>
      <td>${escapeHtml(formatTimestamp(item.gateCollectedAt))}</td>
      <td>${escapeHtml(actorName(item.gateCollectedBy))}</td>
      <td>${escapeHtml(formatTimestamp(item.rampReceivedAt))}</td>
      <td>${escapeHtml(actorName(item.rampReceivedBy))}</td>
      <td>${escapeHtml(formatTimestamp(item.aircraftLoadedAt))}</td>
      <td>${escapeHtml(actorName(item.aircraftLoadedBy))}</td>
      <td>${escapeHtml(item.compartment || "-")}</td>
      <td>${escapeHtml(item.gateCollectionNoteCombined || "-")}</td>
      <td>${escapeHtml(item.offloadReason || "-")}</td>
      <td>${escapeHtml(formatTimestamp(item.offloadedAt))}</td>
      <td>${escapeHtml(actorName(item.offloadedBy))}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>BLCS - Carry-On Gate Check Report</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #111827; background: #fff; }
        .brand { display:flex; align-items:center; justify-content:space-between; gap:18px; padding-bottom:15px; margin-bottom:18px; border-bottom:2px solid #dbeafe; }
        .brand-left { display:flex; align-items:center; gap:12px; }
        .logo { width:58px; height:58px; object-fit:contain; border-radius:12px; }
        .brand-name { font-size:13px; font-weight:900; letter-spacing:.12em; color:#0f4c81; }
        .brand-sub { margin-top:3px; font-size:11px; color:#64748b; font-weight:700; }
        .doc-label { text-align:right; font-size:11px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:.08em; }
        h1 { margin:0; font-size:27px; letter-spacing:-.03em; }
        .subtitle { margin-top:6px; color:#475569; font-weight:700; }
        .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:9px; margin:18px 0; }
        .card { border:1px solid #dbeafe; background:#f8fbff; border-radius:11px; padding:10px 11px; }
        .label { font-size:9px; color:#64748b; font-weight:800; text-transform:uppercase; letter-spacing:.07em; }
        .value { margin-top:4px; font-size:14px; font-weight:900; }
        table { width:100%; border-collapse:collapse; margin-top:14px; }
        th, td { border:1px solid #dbeafe; padding:6px 7px; text-align:left; font-size:9px; vertical-align:top; }
        th { background:#f8fbff; color:#475569; font-size:8px; text-transform:uppercase; letter-spacing:.04em; }
        .footer { margin-top:24px; padding-top:10px; border-top:1px solid #e2e8f0; color:#94a3b8; text-align:center; font-size:9px; }
        @page { size: landscape; margin: 10mm; }
        @media print { body { margin:0; } }
      </style>
    </head>
    <body>
      <div class="brand">
        <div class="brand-left">
          <img class="logo" src="${logoUrl}" alt="BLCS" />
          <div>
            <div class="brand-name">BLCS</div>
            <div class="brand-sub">Baggage Loading Control System</div>
          </div>
        </div>
        <div class="doc-label">Carry-On Gate Check Operational Report</div>
      </div>

      <h1>Carry-On Gate Check Report</h1>
      <div class="subtitle">${escapeHtml(flight?.flightNumber || "-")} &middot; ${escapeHtml(flight?.flightDate || "-")} &middot; ${escapeHtml(route)}</div>

      <div class="grid">
        <div class="card"><div class="label">Gate</div><div class="value">${escapeHtml(flight?.gate || "-")}</div></div>
        <div class="card"><div class="label">Tail</div><div class="value">${escapeHtml(flight?.tailNumber || "-")}</div></div>
        <div class="card"><div class="label">Required</div><div class="value">${requiredCount}</div></div>
        <div class="card"><div class="label">Assigned</div><div class="value">${rows.length}</div></div>
        <div class="card"><div class="label">Loaded</div><div class="value">${loadedCount}</div></div>
        <div class="card"><div class="label">Offloaded</div><div class="value">${offloadedCount}</div></div>
        <div class="card"><div class="label">Remaining</div><div class="value">${remainingToLoad}</div></div>
        <div class="card"><div class="label">Additional</div><div class="value">${additionalCount}</div></div>
        <div class="card"><div class="label">Forward</div><div class="value">${compartmentTotals.FORWARD}</div></div>
        <div class="card"><div class="label">Middle</div><div class="value">${compartmentTotals.MIDDLE}</div></div>
        <div class="card"><div class="label">Aft</div><div class="value">${compartmentTotals.AFT}</div></div>
      </div>

      <table>
        <thead><tr>
          <th>Passenger</th><th>Seat</th><th>Gate Check</th><th>Gate Check Description</th><th>Code</th><th>Counter Wt</th><th>Gate Wt</th><th>Status</th>
          <th>Counter Time</th><th>Counter By</th><th>Gate Time</th><th>Gate By</th><th>Ramp Time</th><th>Ramp By</th>
          <th>Loaded Time</th><th>Loaded By</th><th>Compartment</th><th>Gate Notes</th><th>Offload Reason</th><th>Offloaded At</th><th>Offloaded By</th>
        </tr></thead>
        <tbody>${bodyRows || '<tr><td colspan="21">No Carry-On assignments.</td></tr>'}</tbody>
      </table>

      <div class="footer">BLCS &middot; Baggage Loading Control System</div>
    </body>
  </html>`;
}

export default function CarryOnReportPage({
  selectedCarryOnFlightId,
  onSelectCarryOnFlight,
}) {
  const [flights, setFlights] =
    useState([]);

  const [assignments, setAssignments] =
    useState([]);

  const [error, setError] =
    useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "carryOnFlights"),
      (snap) => {
        const rows =
          snap.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }));

        rows.sort((a, b) =>
          String(b.flightDate || "").localeCompare(
            String(a.flightDate || "")
          )
        );

        setFlights(rows);
      },
      (snapshotError) => {
        console.error(
          "Carry-On Report flight list error:",
          snapshotError
        );

        setError(
          "Unable to load Carry-On flights."
        );
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selectedCarryOnFlightId) {
      setAssignments([]);
      return undefined;
    }

    const unsub = onSnapshot(
      collection(
        db,
        "carryOnFlights",
        selectedCarryOnFlightId,
        "assignments"
      ),
      (snap) => {
        setAssignments(
          snap.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
      },
      (snapshotError) => {
        console.error(
          "Carry-On Report assignments error:",
          snapshotError
        );

        setError(
          "Unable to load Carry-On assignments."
        );
      }
    );

    return () => unsub();
  }, [selectedCarryOnFlightId]);

  const selectedFlight = useMemo(
    () =>
      flights.find(
        (item) =>
          item.id === selectedCarryOnFlightId
      ) || null,
    [flights, selectedCarryOnFlightId]
  );

  const rows = useMemo(
    () =>
      assignments
        .slice()
        .sort((a, b) =>
          String(a.gateCheckNumber || "").localeCompare(
            String(b.gateCheckNumber || "")
          )
        ),
    [assignments]
  );

  const requiredCount =
    Number(
      selectedFlight?.requiredCarryOns || 0
    );

  const assignedCount =
    rows.length;

  const loadedRows =
    rows.filter(
      (item) =>
        cleanUpper(item?.status) ===
        "AIRCRAFT_LOADED"
    );

  const loadedCount =
    loadedRows.length;

  const offloadedRows =
    rows.filter(
      (item) =>
        cleanUpper(item?.status) ===
        "OFFLOADED"
    );

  const offloadedCount =
    offloadedRows.length;

  const remainingToLoad =
    Math.max(
      0,
      assignedCount -
      loadedCount -
      offloadedCount
    );

  const additionalCount =
    Math.max(
      0,
      assignedCount - requiredCount
    );

  const compartmentTotals =
    useMemo(() => {
      return loadedRows.reduce(
        (totals, item) => {
          const compartment =
            cleanUpper(item?.compartment);

          if (
            compartment === "FORWARD" ||
            compartment === "MIDDLE" ||
            compartment === "AFT"
          ) {
            totals[compartment] += 1;
          }

          return totals;
        },
        {
          FORWARD: 0,
          MIDDLE: 0,
          AFT: 0,
        }
      );
    }, [loadedRows]);

  const printReport = () => {
    if (!selectedFlight) return;

    const html = buildCarryOnReportHtml({
      flight: selectedFlight,
      rows,
      requiredCount,
      loadedCount,
      offloadedCount,
      remainingToLoad,
      additionalCount,
      compartmentTotals,
    });

    openPrintDocument(html, () => {
      setError("Pop-up blocked. Please allow pop-ups to print the report.");
    });
  };

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
      }}
    >
      <div
        className="carry-on-report-no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>
            Final Carry-On Report
          </h3>

          <p
            style={{
              margin: "6px 0 0",
              color: "#64748b",
              fontSize: "0.82rem",
            }}
          >
            Final operational summary from Counter through Aircraft Loading.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "flex-end",
          }}
        >
          <label
            style={{
              display: "grid",
              gap: 5,
              minWidth: 240,
            }}
          >
            <span
              style={{
                color: "#475569",
                fontSize: "0.75rem",
                fontWeight: 800,
              }}
            >
              Carry-On Flight
            </span>

            <select
              value={
                selectedCarryOnFlightId || ""
              }
              onChange={(event) =>
                onSelectCarryOnFlight?.(
                  event.target.value || null
                )
              }
              style={inputStyle}
            >
              <option value="">
                Select flight
              </option>

              {flights.map((flight) => (
                <option
                  key={flight.id}
                  value={flight.id}
                >
                  {flight.flightNumber} - {flight.flightDate}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={printReport}
            disabled={!selectedFlight}
            style={{
              ...primaryButton,
              opacity:
                selectedFlight ? 1 : 0.55,
            }}
          >
            Print Report
          </button>
        </div>
      </div>

      {selectedFlight ? (
        <div
          id="carry-on-final-report"
          style={{
            display: "grid",
            gap: 14,
          }}
        >
          <style>
            {`
              @media print {
                body * {
                  visibility: hidden !important;
                }

                #carry-on-final-report,
                #carry-on-final-report * {
                  visibility: visible !important;
                }

                #carry-on-final-report {
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 100% !important;
                  padding: 18px !important;
                  box-sizing: border-box !important;
                  background: white !important;
                }

                .carry-on-report-no-print {
                  display: none !important;
                }

                .carry-on-report-table {
                  font-size: 9px !important;
                }

                .carry-on-report-table th,
                .carry-on-report-table td {
                  padding: 5px !important;
                }
              }
            `}
          </style>

          <div
            style={{
              padding: 14,
              borderRadius: 12,
              border:
                "1px solid #cbd5e1",
              background: "white",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "flex-start",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    color: "#64748b",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                  }}
                >
                  BLCS OPERATIONS
                </div>

                <h2
                  style={{
                    margin: "4px 0 0",
                  }}
                >
                  Carry-On Gate Check Report
                </h2>

                <div
                  style={{
                    marginTop: 8,
                    color: "#0f172a",
                    fontWeight: 800,
                    fontSize: "0.92rem",
                  }}
                >
                  {selectedFlight.flightNumber}
                  {" - "}
                  {selectedFlight.flightDate}
                </div>
              </div>

              <img
                src={BLCS_LOGO_SRC}
                alt="BLCSYSTEM logo"
                style={{
                  width: 84,
                  maxWidth: "100%",
                  height: "auto",
                  objectFit: "contain",
                }}
                onError={(event) => {
                  event.currentTarget.style.display =
                    "none";
                }}
              />
            </div>

            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 8,
              }}
            >
              <Info
                label="Route"
                value={`${selectedFlight.origin || "-"} -> ${selectedFlight.destination || "-"}`}
              />

              <Info
                label="Gate"
                value={
                  selectedFlight.gate || "-"
                }
              />

              <Info
                label="Tail"
                value={
                  selectedFlight.tailNumber ||
                  "-"
                }
              />

              <Info
                label="Required"
                value={requiredCount}
              />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(125px, 1fr))",
              gap: 8,
            }}
          >
            <Metric
              label="Assigned"
              value={assignedCount}
            />

            <Metric
              label="Loaded"
              value={loadedCount}
            />

            <Metric
              label="Offloaded"
              value={offloadedCount}
            />

            <Metric
              label="Remaining"
              value={remainingToLoad}
            />

            <Metric
              label="Additional"
              value={additionalCount}
            />

            <Metric
              label="Forward"
              value={compartmentTotals.FORWARD}
            />

            <Metric
              label="Middle"
              value={compartmentTotals.MIDDLE}
            />

            <Metric
              label="Aft"
              value={compartmentTotals.AFT}
            />
          </div>

          <div
            style={{
              overflowX: "auto",
              borderRadius: 12,
              border:
                "1px solid #e2e8f0",
              background: "white",
            }}
          >
            <table
              className="carry-on-report-table"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 2280,
                fontSize: "0.76rem",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#f8fafc",
                  }}
                >
                  <Th>Passenger</Th>
                  <Th>Seat</Th>
                  <Th>Gate Check</Th>
                  <Th>Gate Check Description</Th>
                  <Th>Code</Th>
                  <Th>Source</Th>
                  <Th>Counter Weight</Th>
                  <Th>Gate Weight</Th>
                  <Th>Status</Th>
                  <Th>Counter Time</Th>
                  <Th>Counter By</Th>
                  <Th>Gate Time</Th>
                  <Th>Gate By</Th>
                  <Th>Ramp Time</Th>
                  <Th>Ramp By</Th>
                  <Th>Loaded Time</Th>
                  <Th>Loaded By</Th>
                  <Th>Compartment</Th>
                  <Th>Gate Notes</Th>
                  <Th>Offload Reason</Th>
                  <Th>Offloaded At</Th>
                  <Th>Offloaded By</Th>
                </tr>
              </thead>

              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan="22"
                      style={{
                        padding: 14,
                        textAlign: "center",
                        color: "#64748b",
                      }}
                    >
                      No Carry-On assignments for this flight.
                    </td>
                  </tr>
                ) : (
                  rows.map((item) => (
                    <tr key={item.id}>
                      <Td>
                        {item.passengerName || "-"}
                      </Td>

                      <Td>
                        {item.assignedSeat || "-"}
                      </Td>

                      <Td strong>
                        {item.gateCheckNumber || "-"}
                      </Td>

                      <Td>
                        {item.carryOnDescription || "-"}
                      </Td>

                      <Td>
                        {item.carryOnCode || "-"}
                      </Td>

                      <Td>
                        {item.passengerSource || "-"}
                      </Td>

                      <Td>
                        {item.counterRecordedWeightLbs
                          ? `${item.counterRecordedWeightLbs} lb`
                          : "-"}
                      </Td>

                      <Td>
                        {item.gateVerifiedWeightLbs
                          ? `${item.gateVerifiedWeightLbs} lb`
                          : "-"}
                      </Td>

                      <Td>
                        {item.status || "-"}
                      </Td>

                      <Td>
                        {formatTimestamp(
                          item.counterAssignedAt
                        )}
                      </Td>

                      <Td>
                        {actorName(
                          item.counterAssignedBy
                        )}
                      </Td>

                      <Td>
                        {formatTimestamp(
                          item.gateCollectedAt
                        )}
                      </Td>

                      <Td>
                        {actorName(
                          item.gateCollectedBy
                        )}
                      </Td>

                      <Td>
                        {formatTimestamp(
                          item.rampReceivedAt
                        )}
                      </Td>

                      <Td>
                        {actorName(
                          item.rampReceivedBy
                        )}
                      </Td>

                      <Td>
                        {formatTimestamp(
                          item.aircraftLoadedAt
                        )}
                      </Td>

                      <Td>
                        {actorName(
                          item.aircraftLoadedBy
                        )}
                      </Td>

                      <Td strong>
                        {item.compartment || "-"}
                      </Td>

                      <Td>
                        {item.gateCollectionNoteCombined || "-"}
                      </Td>

                      <Td>
                        {item.offloadReason || "-"}
                      </Td>

                      <Td>
                        {formatTimestamp(
                          item.offloadedAt
                        )}
                      </Td>

                      <Td>
                        {actorName(
                          item.offloadedBy
                        )}
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div
            style={{
              padding: 10,
              borderRadius: 10,
              background:
                remainingToLoad === 0 &&
                assignedCount > 0
                  ? "#f0fdf4"
                  : "#fffbeb",
              border:
                remainingToLoad === 0 &&
                assignedCount > 0
                  ? "1px solid #bbf7d0"
                  : "1px solid #fde68a",
              color:
                remainingToLoad === 0 &&
                assignedCount > 0
                  ? "#166534"
                  : "#92400e",
              fontWeight: 800,
              fontSize: "0.82rem",
            }}
          >
            {assignedCount === 0
              ? "No Carry-On assignments have been created."
              : remainingToLoad === 0
                ? offloadedCount > 0
                  ? `Operation complete: ${loadedCount} loaded and ${offloadedCount} offloaded.`
                  : "All assigned Carry-On items are loaded on the aircraft."
                : `${remainingToLoad} active Carry-On item(s) are still pending final disposition.`}
          </div>

          {error && (
            <Notice
              tone="error"
              text={error}
            />
          )}
        </div>
      ) : (
        <Notice
          tone="warning"
          text="Select a Carry-On flight to view the final report."
        />
      )}
    </div>
  );
}

function Th({ children }) {
  return (
    <th
      style={{
        padding: 8,
        borderBottom:
          "1px solid #e2e8f0",
        textAlign: "left",
        color: "#334155",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  strong = false,
}) {
  return (
    <td
      style={{
        padding: 8,
        borderBottom:
          "1px solid #f1f5f9",
        color: "#475569",
        fontWeight:
          strong ? 900 : 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

function Metric({ label, value }) {
  return (
    <div
      style={{
        padding: 9,
        borderRadius: 10,
        border:
          "1px solid #e2e8f0",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          color: "#64748b",
          fontSize: "0.68rem",
          fontWeight: 700,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 2,
          color: "#0f172a",
          fontSize: "1.12rem",
          fontWeight: 900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div
        style={{
          color: "#64748b",
          fontSize: "0.68rem",
          fontWeight: 800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 2,
          color: "#0f172a",
          fontWeight: 800,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Notice({ tone, text }) {
  const warning = tone === "warning";

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background: warning
          ? "#fffbeb"
          : "#fef2f2",
        border: warning
          ? "1px solid #fde68a"
          : "1px solid #fecaca",
        color: warning
          ? "#92400e"
          : "#991b1b",
        fontSize: "0.82rem",
        fontWeight: 800,
      }}
    >
      {text}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 10,
  border:
    "1px solid #cbd5e1",
  background: "white",
  fontSize: "0.9rem",
};

const primaryButton = {
  padding: "10px 14px",
  borderRadius: 10,
  border:
    "1px solid #0f172a",
  background: "#0f172a",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

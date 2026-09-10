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

  const remainingToLoad =
    Math.max(
      0,
      assignedCount - loadedCount
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
    window.print();
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
              </div>

              <div
                style={{
                  textAlign: "right",
                  fontSize: "0.82rem",
                }}
              >
                <strong>
                  {selectedFlight.flightNumber}
                </strong>
                <div>
                  {selectedFlight.flightDate}
                </div>
              </div>
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
                minWidth: 1500,
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
                  <Th>Source</Th>
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
                </tr>
              </thead>

              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan="14"
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
                        {item.passengerSource || "-"}
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
                ? "All assigned Carry-On items are loaded on the aircraft."
                : `${remainingToLoad} assigned Carry-On item(s) are not yet marked AIRCRAFT_LOADED.`}
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

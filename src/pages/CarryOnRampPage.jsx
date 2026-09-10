// src/pages/CarryOnRampPage.jsx

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "../firebase";

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function getActor(user, operationalContext) {
  return {
    userId: user?.id || null,
    username: user?.username || null,
    fullName:
      operationalContext?.employeeFullName ||
      user?.fullName ||
      user?.username ||
      null,
    role: user?.role || null,
    operationalPosition:
      operationalContext?.operationalPosition || null,
    operationalPositionLabel:
      operationalContext?.operationalPositionLabel || null,
  };
}

export default function CarryOnRampPage({
  user,
  operationalContext,
  selectedCarryOnFlightId,
  onSelectCarryOnFlight,
}) {
  const role = normalizeRole(user?.role);

  const actor = useMemo(
    () => getActor(user, operationalContext),
    [user, operationalContext]
  );

  const operationalPosition = cleanUpper(
    operationalContext?.operationalPosition
  );

  const canOperateRamp =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "duty_managers" ||
    role === "supervisor" ||
    role === "agent" ||
    operationalPosition === "AIRCRAFT_RAMP";

  const [flights, setFlights] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [receivingId, setReceivingId] = useState("");
  const [receivedExpanded, setReceivedExpanded] =
    useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "carryOnFlights"),
      (snap) => {
        const rows = snap.docs.map((item) => ({
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
          "Carry-On Ramp flight list error:",
          snapshotError
        );
        setError("Unable to load Carry-On flights.");
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
          "Carry-On Ramp assignments error:",
          snapshotError
        );
        setError("Unable to load Carry-On assignments.");
      }
    );

    return () => unsub();
  }, [selectedCarryOnFlightId]);

  const selectedFlight = useMemo(
    () =>
      flights.find(
        (item) => item.id === selectedCarryOnFlightId
      ) || null,
    [flights, selectedCarryOnFlightId]
  );

  const readyForRamp = useMemo(
    () =>
      assignments
        .filter((item) => {
          const status = cleanUpper(item?.status);
          return (
            status === "COUNTER_ASSIGNED" ||
            status === "GATE_COLLECTED"
          );
        })
        .sort((a, b) =>
          String(a.gateCheckNumber || "").localeCompare(
            String(b.gateCheckNumber || "")
          )
        ),
    [assignments]
  );

  const receivedAtRamp = useMemo(
    () =>
      assignments
        .filter(
          (item) =>
            cleanUpper(item?.status) === "RAMP_RECEIVED"
        )
        .sort((a, b) =>
          String(a.gateCheckNumber || "").localeCompare(
            String(b.gateCheckNumber || "")
          )
        ),
    [assignments]
  );

  const loadedCount = useMemo(
    () =>
      assignments.filter(
        (item) =>
          cleanUpper(item?.status) === "AIRCRAFT_LOADED"
      ).length,
    [assignments]
  );

  const filteredReady = useMemo(() => {
    const query = String(searchTerm || "")
      .trim()
      .toLowerCase();

    if (!query) return readyForRamp;

    return readyForRamp.filter((item) =>
      String(item?.gateCheckNumber || "")
        .toLowerCase()
        .includes(query)
    );
  }, [readyForRamp, searchTerm]);

  const filteredReceived = useMemo(() => {
    const query = String(searchTerm || "")
      .trim()
      .toLowerCase();

    if (!query) return receivedAtRamp;

    return receivedAtRamp.filter((item) =>
      String(item?.gateCheckNumber || "")
        .toLowerCase()
        .includes(query)
    );
  }, [receivedAtRamp, searchTerm]);

  const markReceivedAtRamp = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateRamp) {
      setError(
        "You do not have permission to confirm Ramp receipt."
      );
      return;
    }

    if (!selectedFlight || !assignment) return;

    const sourceStatus = cleanUpper(assignment.status);
    const bypassedGate =
      sourceStatus === "COUNTER_ASSIGNED";

    const ok = window.confirm(
      bypassedGate
        ? `Receive ${assignment.gateCheckNumber || "-"} directly at Ramp?\n\nGate has not marked this item as collected. A Gate bypass alert will be created.`
        : `Confirm ${assignment.gateCheckNumber || "-"} received at Ramp?`
    );

    if (!ok) return;

    try {
      setReceivingId(assignment.id);

      const assignmentRef = doc(
        db,
        "carryOnFlights",
        selectedFlight.id,
        "assignments",
        assignment.id
      );

      const gateCheckRef = doc(
        db,
        "carryOnFlights",
        selectedFlight.id,
        "gateCheckNumbers",
        assignment.id
      );

      await runTransaction(db, async (transaction) => {
        const assignmentSnap =
          await transaction.get(assignmentRef);

        if (!assignmentSnap.exists()) {
          throw new Error(
            "Carry-On assignment no longer exists."
          );
        }

        const currentStatus = cleanUpper(
          assignmentSnap.data()?.status
        );

        if (
          currentStatus !== "GATE_COLLECTED" &&
          currentStatus !== "COUNTER_ASSIGNED"
        ) {
          throw new Error(
            `This Carry-On cannot be received at Ramp from status ${currentStatus || "UNKNOWN"}.`
          );
        }

        const directFromCounter =
          currentStatus === "COUNTER_ASSIGNED";

        const receiptData = {
          status: "RAMP_RECEIVED",
          rampReceivedAt: serverTimestamp(),
          rampReceivedBy: actor,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
          ...(directFromCounter
            ? {
                rampBypassedGate: true,
                gateBypassDetectedAt:
                  serverTimestamp(),
                gateBypassAcknowledgedAt: null,
                gateBypassAcknowledgedBy: null,
              }
            : {}),
        };

        transaction.set(
          assignmentRef,
          receiptData,
          { merge: true }
        );

        transaction.set(
          gateCheckRef,
          receiptData,
          { merge: true }
        );
      });

      try {
        await setDoc(
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "events",
            `ramp_received_${assignment.id}_${Date.now()}`
          ),
          {
            type: bypassedGate
              ? "RAMP_RECEIVED_GATE_BYPASS"
              : "RAMP_RECEIVED",
            status: "RAMP_RECEIVED",
            assignmentId: assignment.id,
            passengerId:
              assignment.passengerId || null,
            passengerName:
              assignment.passengerName || null,
            assignedSeat:
              assignment.assignedSeat || null,
            gateCheckNumber:
              assignment.gateCheckNumber || null,
            rampBypassedGate:
              bypassedGate,
            message: bypassedGate
              ? `Carry-On ${assignment.gateCheckNumber || assignment.id} received at Ramp without Gate collection.`
              : `Carry-On ${assignment.gateCheckNumber || assignment.id} received at Ramp.`,
            createdAt: serverTimestamp(),
            createdBy: actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On Ramp event write error:",
          eventError
        );
      }

      setMessage(
        bypassedGate
          ? `${assignment.gateCheckNumber} received at Ramp. Gate bypass alert created.`
          : `${assignment.gateCheckNumber} received at Ramp.`
      );
    } catch (rampError) {
      console.error(
        "Carry-On Ramp receipt error:",
        rampError
      );

      setError(
        rampError?.message ||
          "Unable to confirm Ramp receipt."
      );
    } finally {
      setReceivingId("");
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
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
            Ramp Receipt
          </h3>

          <p
            style={{
              margin: "6px 0 0",
              color: "#64748b",
              fontSize: "0.82rem",
            }}
          >
            Select the Gate Check number physically received at Ramp.
          </p>
        </div>

        <label
          style={{
            display: "grid",
            gap: 5,
            minWidth: 220,
          }}
        >
          <span style={fieldLabel}>
            Carry-On Flight
          </span>

          <select
            value={selectedCarryOnFlightId || ""}
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
      </div>

      {selectedFlight ? (
        <>
          <FlightBar flight={selectedFlight} />

          <div style={quickFindWrap}>
            <div style={quickFindLabel}>
              QUICK FIND
            </div>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(event.target.value)
              }
              placeholder="Gate Check number"
              style={{
                ...inputStyle,
                border: "none",
                padding: "9px 10px",
              }}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 8,
            }}
          >
            <Metric
              label="Ready for Ramp"
              value={readyForRamp.length}
            />
            <Metric
              label="At Ramp"
              value={receivedAtRamp.length}
            />
            <Metric
              label="Loaded"
              value={loadedCount}
            />
          </div>

          {!canOperateRamp && (
            <Notice
              tone="warning"
              text="You can view Ramp status, but cannot confirm receipt."
            />
          )}

          <div style={panelStyle}>
            <h4 style={{ margin: 0 }}>
              Ready for Ramp
            </h4>

            <p style={helperText}>
              Includes items collected by Gate and, when necessary, items still showing Counter Assigned.
            </p>

            {filteredReady.length === 0 ? (
              <p style={emptyText}>
                No Gate Check numbers ready for Ramp receipt.
              </p>
            ) : (
              <div style={gateCheckGrid}>
                {filteredReady.map((item) => {
                  const bypass =
                    cleanUpper(item.status) ===
                    "COUNTER_ASSIGNED";

                  return (
                    <div
                      key={item.id}
                      style={{
                        ...gateCheckCard,
                        border: bypass
                          ? "1px solid #fde68a"
                          : "1px solid #bfdbfe",
                        background: bypass
                          ? "#fffbeb"
                          : "white",
                      }}
                    >
                      <div style={gateCheckNumberStyle}>
                        {item.gateCheckNumber || "-"}
                      </div>

                      {bypass && (
                        <div
                          style={{
                            marginTop: 5,
                            color: "#92400e",
                            fontSize: "0.65rem",
                            fontWeight: 900,
                          }}
                        >
                          DIRECT FROM COUNTER
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          markReceivedAtRamp(item)
                        }
                        disabled={
                          receivingId === item.id ||
                          !canOperateRamp
                        }
                        style={{
                          ...primaryButton,
                          width: "100%",
                          marginTop: 9,
                          opacity:
                            receivingId === item.id ||
                            !canOperateRamp
                              ? 0.55
                              : 1,
                        }}
                      >
                        {receivingId === item.id
                          ? "Receiving..."
                          : "Receive"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div
            style={{
              ...panelStyle,
              padding: 0,
              overflow: "hidden",
              background: "white",
            }}
          >
            <button
              type="button"
              onClick={() =>
                setReceivedExpanded(
                  (current) => !current
                )
              }
              style={sectionToggle}
            >
              <div>
                <strong>
                  Received Gate Checks
                </strong>
                <div style={toggleSubtext}>
                  {receivedAtRamp.length} at Ramp
                  {" - "}
                  Tap to {receivedExpanded ? "hide" : "view"}
                </div>
              </div>

              <span style={countBadge}>
                {receivedAtRamp.length}
              </span>
            </button>

            {receivedExpanded && (
              <div
                style={{
                  padding: "0 12px 12px",
                  borderTop:
                    "1px solid #f1f5f9",
                }}
              >
                {filteredReceived.length === 0 ? (
                  <p style={emptyText}>
                    No matching Gate Check numbers.
                  </p>
                ) : (
                  <div style={gateCheckGrid}>
                    {filteredReceived.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          ...gateCheckCard,
                          border:
                            "1px solid #bfdbfe",
                          background:
                            "#eff6ff",
                        }}
                      >
                        <div
                          style={{
                            ...gateCheckNumberStyle,
                            color: "#1d4ed8",
                          }}
                        >
                          {item.gateCheckNumber || "-"}
                        </div>

                        {item.rampBypassedGate === true && (
                          <div
                            style={{
                              marginTop: 5,
                              color: "#92400e",
                              fontSize: "0.64rem",
                              fontWeight: 900,
                            }}
                          >
                            GATE BYPASS
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {message && (
            <Notice tone="success" text={message} />
          )}

          {error && (
            <Notice tone="error" text={error} />
          )}
        </>
      ) : (
        <Notice
          tone="warning"
          text="Select a Carry-On flight to begin Ramp operations."
        />
      )}
    </div>
  );
}

function FlightBar({ flight }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border: "1px solid #c4b5fd",
        background: "#f5f3ff",
      }}
    >
      <strong>
        {flight.flightNumber} - {flight.flightDate}
      </strong>

      <div
        style={{
          marginTop: 4,
          color: "#64748b",
          fontSize: "0.8rem",
        }}
      >
        {flight.origin} {" -> "} {flight.destination}
        {flight.gate ? ` - Gate ${flight.gate}` : ""}
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div
      style={{
        padding: 9,
        borderRadius: 10,
        border: "1px solid #e2e8f0",
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

function Notice({ tone, text }) {
  const success = tone === "success";
  const warning = tone === "warning";

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background: success
          ? "#f0fdf4"
          : warning
            ? "#fffbeb"
            : "#fef2f2",
        border: success
          ? "1px solid #bbf7d0"
          : warning
            ? "1px solid #fde68a"
            : "1px solid #fecaca",
        color: success
          ? "#166534"
          : warning
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

const fieldLabel = {
  color: "#475569",
  fontSize: "0.75rem",
  fontWeight: 800,
};

const panelStyle = {
  padding: 13,
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  background: "#f8fafc",
};

const helperText = {
  margin: "5px 0 0",
  color: "#64748b",
  fontSize: "0.74rem",
};

const emptyText = {
  color: "#64748b",
  fontSize: "0.82rem",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "white",
  fontSize: "0.9rem",
};

const quickFindWrap = {
  padding: 8,
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
};

const quickFindLabel = {
  color: "#64748b",
  fontSize: "0.66rem",
  fontWeight: 800,
  marginBottom: 4,
};

const gateCheckGrid = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(135px, 1fr))",
  gap: 8,
  marginTop: 10,
};

const gateCheckCard = {
  padding: 11,
  borderRadius: 12,
  textAlign: "center",
};

const gateCheckNumberStyle = {
  color: "#0f172a",
  fontSize: "1rem",
  fontWeight: 900,
  letterSpacing: "0.02em",
  overflowWrap: "anywhere",
};

const primaryButton = {
  padding: "9px 11px",
  borderRadius: 10,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const sectionToggle = {
  width: "100%",
  border: "none",
  background: "white",
  padding: 14,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
};

const toggleSubtext = {
  marginTop: 3,
  color: "#64748b",
  fontSize: "0.74rem",
};

const countBadge = {
  minWidth: 34,
  height: 34,
  padding: "0 8px",
  borderRadius: 999,
  background: "#dbeafe",
  color: "#1d4ed8",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 900,
  fontSize: "0.8rem",
};

// src/pages/CarryOnRampPage.jsx

import React, { useEffect, useMemo, useState } from "react";
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

function formatTimestamp(value) {
  if (!value) return "-";

  try {
    const date =
      typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);

    return Number.isNaN(date.getTime())
      ? "-"
      : date.toLocaleString();
  } catch {
    return "-";
  }
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
  const [receivingId, setReceivingId] = useState("");
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

  const waitingForRamp = useMemo(
    () =>
      assignments
        .filter(
          (item) =>
            cleanUpper(item?.status) === "GATE_COLLECTED"
        )
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

    const ok = window.confirm(
      `Confirm Received at Ramp?\n\n` +
        `Passenger: ${assignment.passengerName || "-"}\n` +
        `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
        `Seat: ${assignment.assignedSeat || "-"}`
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

        if (currentStatus !== "GATE_COLLECTED") {
          throw new Error(
            `This Carry-On cannot be received at Ramp from status ${currentStatus || "UNKNOWN"}.`
          );
        }

        transaction.set(
          assignmentRef,
          {
            status: "RAMP_RECEIVED",
            rampReceivedAt: serverTimestamp(),
            rampReceivedBy: actor,
            updatedAt: serverTimestamp(),
            updatedBy: actor,
          },
          { merge: true }
        );

        transaction.set(
          gateCheckRef,
          {
            status: "RAMP_RECEIVED",
            rampReceivedAt: serverTimestamp(),
            rampReceivedBy: actor,
          },
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
            type: "RAMP_RECEIVED",
            status: "RAMP_RECEIVED",
            assignmentId: assignment.id,
            passengerId: assignment.passengerId || null,
            passengerName: assignment.passengerName || null,
            assignedSeat: assignment.assignedSeat || null,
            gateCheckNumber:
              assignment.gateCheckNumber || null,
            message:
              `Carry-On ${assignment.gateCheckNumber || assignment.id} received at Ramp.`,
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
        `${assignment.gateCheckNumber} received at Ramp.`
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
          <h3 style={{ margin: 0 }}>Ramp Receipt</h3>
          <p
            style={{
              margin: "6px 0 0",
              color: "#64748b",
              fontSize: "0.82rem",
            }}
          >
            Confirm each Carry-On when Ramp physically receives it from Gate.
          </p>
        </div>

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
            value={selectedCarryOnFlightId || ""}
            onChange={(event) =>
              onSelectCarryOnFlight?.(
                event.target.value || null
              )
            }
            style={inputStyle}
          >
            <option value="">Select flight</option>

            {flights.map((flight) => (
              <option key={flight.id} value={flight.id}>
                {flight.flightNumber} - {flight.flightDate}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedFlight ? (
        <>
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #c4b5fd",
              background: "#f5f3ff",
            }}
          >
            <strong>
              {selectedFlight.flightNumber}
              {" - "}
              {selectedFlight.flightDate}
            </strong>

            <div
              style={{
                marginTop: 4,
                color: "#64748b",
                fontSize: "0.8rem",
              }}
            >
              {selectedFlight.origin}
              {" -> "}
              {selectedFlight.destination}
              {selectedFlight.gate
                ? ` - Gate ${selectedFlight.gate}`
                : ""}
              {selectedFlight.tailNumber
                ? ` - Tail ${selectedFlight.tailNumber}`
                : ""}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 8,
            }}
          >
            <Metric
              label="Waiting for Ramp"
              value={waitingForRamp.length}
            />
            <Metric
              label="Received at Ramp"
              value={receivedAtRamp.length}
            />
            <Metric
              label="Already Loaded"
              value={loadedCount}
            />
          </div>

          {!canOperateRamp && (
            <Notice
              tone="warning"
              text="You can view Ramp status, but your current role/operational position cannot confirm receipt."
            />
          )}

          <div style={panelStyle}>
            <h4 style={{ margin: 0 }}>
              Waiting for Ramp Receipt
            </h4>

            {waitingForRamp.length === 0 ? (
              <p
                style={{
                  color: "#64748b",
                  fontSize: "0.82rem",
                }}
              >
                No Carry-On items are currently waiting for Ramp receipt.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {waitingForRamp.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                      alignItems: "center",
                      padding: 11,
                      borderRadius: 11,
                      border: "1px solid #e2e8f0",
                      background: "white",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <strong>{item.passengerName}</strong>
                        <span
                          style={{
                            color: "#6d28d9",
                            fontWeight: 900,
                          }}
                        >
                          {item.gateCheckNumber}
                        </span>
                      </div>

                      <div
                        style={{
                          marginTop: 4,
                          color: "#64748b",
                          fontSize: "0.78rem",
                        }}
                      >
                        Seat: {item.assignedSeat || "-"}
                        {" - "}
                        Status: GATE COLLECTED
                      </div>
                    </div>

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
                        opacity:
                          receivingId === item.id ||
                          !canOperateRamp
                            ? 0.55
                            : 1,
                      }}
                    >
                      {receivingId === item.id
                        ? "Saving..."
                        : "Received at Ramp"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <h4 style={{ margin: 0 }}>
              Received at Ramp
            </h4>

            {receivedAtRamp.length === 0 ? (
              <p
                style={{
                  color: "#64748b",
                  fontSize: "0.82rem",
                }}
              >
                No Carry-On items have been received by Ramp yet.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 7,
                  marginTop: 9,
                }}
              >
                {receivedAtRamp.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #bfdbfe",
                      background: "#eff6ff",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <strong>{item.passengerName}</strong>
                      <span
                        style={{
                          color: "#1d4ed8",
                          fontWeight: 900,
                        }}
                      >
                        {item.gateCheckNumber}
                      </span>
                    </div>

                    <div
                      style={{
                        marginTop: 4,
                        color: "#64748b",
                        fontSize: "0.78rem",
                      }}
                    >
                      Seat: {item.assignedSeat || "-"}
                      {" - "}
                      Received: {formatTimestamp(item.rampReceivedAt)}
                    </div>
                  </div>
                ))}
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
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </div>
  );
}

const panelStyle = {
  padding: 13,
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  background: "#f8fafc",
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

const primaryButton = {
  padding: "9px 13px",
  borderRadius: 10,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

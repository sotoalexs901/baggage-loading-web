// src/pages/CarryOnGatePage.jsx

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

function normalizeRole(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .toLowerCase();
}

function cleanUpper(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .toUpperCase();
}

function getActor(
  user,
  operationalContext
) {
  return {
    userId:
      user?.id ||
      null,

    username:
      user?.username ||
      null,

    fullName:
      operationalContext
        ?.employeeFullName ||
      user?.fullName ||
      user?.username ||
      null,

    role:
      user?.role ||
      null,

    operationalPosition:
      operationalContext
        ?.operationalPosition ||
      null,

    operationalPositionLabel:
      operationalContext
        ?.operationalPositionLabel ||
      null,
  };
}

export default function CarryOnGatePage({
  user,
  operationalContext,
  selectedCarryOnFlightId,
  onSelectCarryOnFlight,
}) {
  const role =
    normalizeRole(
      user?.role
    );

  const actor =
    useMemo(
      () =>
        getActor(
          user,
          operationalContext
        ),
      [
        user,
        operationalContext,
      ]
    );

  const operationalPosition =
    cleanUpper(
      operationalContext
        ?.operationalPosition
    );

  const canOperateGate =
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor" ||
    role ===
      "gate_controller" ||
    operationalPosition ===
      "GATE_CONTROLLER";

  const [
    flights,
    setFlights,
  ] = useState(
    []
  );

  const [
    assignments,
    setAssignments,
  ] = useState(
    []
  );

  const [
    processingId,
    setProcessingId,
  ] = useState(
    ""
  );

  const [
    message,
    setMessage,
  ] = useState(
    ""
  );

  const [
    error,
    setError,
  ] = useState(
    ""
  );

  useEffect(() => {
    const unsub =
      onSnapshot(
        collection(
          db,
          "carryOnFlights"
        ),

        (
          snap
        ) => {
          const rows =
            snap.docs.map(
              (
                item
              ) => ({
                id:
                  item.id,

                ...item.data(),
              })
            );

          rows.sort(
            (
              a,
              b
            ) =>
              String(
                b.flightDate ||
                ""
              ).localeCompare(
                String(
                  a.flightDate ||
                  ""
                )
              )
          );

          setFlights(
            rows
          );
        },

        (
          snapshotError
        ) => {
          console.error(
            "Carry-On Gate flight list error:",
            snapshotError
          );

          setError(
            "Unable to load Carry-On flights."
          );
        }
      );

    return () =>
      unsub();
  }, []);

  useEffect(() => {
    if (
      !selectedCarryOnFlightId
    ) {
      setAssignments(
        []
      );

      return undefined;
    }

    const unsub =
      onSnapshot(
        collection(
          db,
          "carryOnFlights",
          selectedCarryOnFlightId,
          "assignments"
        ),

        (
          snap
        ) => {
          setAssignments(
            snap.docs.map(
              (
                item
              ) => ({
                id:
                  item.id,

                ...item.data(),
              })
            )
          );
        },

        (
          snapshotError
        ) => {
          console.error(
            "Carry-On Gate assignments error:",
            snapshotError
          );

          setError(
            "Unable to load Carry-On assignments."
          );
        }
      );

    return () =>
      unsub();
  }, [
    selectedCarryOnFlightId,
  ]);

  const selectedFlight =
    useMemo(
      () =>
        flights.find(
          (
            item
          ) =>
            item.id ===
            selectedCarryOnFlightId
        ) ||
        null,
      [
        flights,
        selectedCarryOnFlightId,
      ]
    );

  const waitingAtGate =
    useMemo(
      () =>
        assignments
          .filter(
            (
              item
            ) =>
              cleanUpper(
                item?.status
              ) ===
              "COUNTER_ASSIGNED"
          )
          .sort(
            (
              a,
              b
            ) =>
              String(
                a.gateCheckNumber ||
                ""
              ).localeCompare(
                String(
                  b.gateCheckNumber ||
                  ""
                )
              )
          ),
      [
        assignments,
      ]
    );

  const collectedAtGate =
    useMemo(
      () =>
        assignments
          .filter(
            (
              item
            ) =>
              cleanUpper(
                item?.status
              ) ===
              "GATE_COLLECTED"
          )
          .sort(
            (
              a,
              b
            ) =>
              String(
                a.gateCheckNumber ||
                ""
              ).localeCompare(
                String(
                  b.gateCheckNumber ||
                  ""
                )
              )
          ),
      [
        assignments,
      ]
    );

  const markCollectedAtGate =
    async (
      assignment
    ) => {
      setMessage(
        ""
      );

      setError(
        ""
      );

      if (
        !canOperateGate
      ) {
        setError(
          "You do not have permission to confirm Gate collection."
        );

        return;
      }

      if (
        !selectedFlight ||
        !assignment
      ) {
        return;
      }

      const ok =
        window.confirm(
          `Confirm Collected at Gate?\n\n` +
            `Passenger: ${assignment.passengerName || "-"}\n` +
            `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
            `Seat: ${assignment.assignedSeat || "-"}`
        );

      if (
        !ok
      ) {
        return;
      }

      try {
        setProcessingId(
          assignment.id
        );

        const assignmentRef =
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "assignments",
            assignment.id
          );

        const gateCheckRef =
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "gateCheckNumbers",
            assignment.id
          );

        await runTransaction(
          db,
          async (
            transaction
          ) => {
            const assignmentSnap =
              await transaction.get(
                assignmentRef
              );

            if (
              !assignmentSnap.exists()
            ) {
              throw new Error(
                "Carry-On assignment no longer exists."
              );
            }

            const currentStatus =
              cleanUpper(
                assignmentSnap
                  .data()
                  ?.status
              );

            if (
              currentStatus !==
              "COUNTER_ASSIGNED"
            ) {
              throw new Error(
                `This Carry-On cannot be collected from status ${currentStatus || "UNKNOWN"}.`
              );
            }

            transaction.set(
              assignmentRef,
              {
                status:
                  "GATE_COLLECTED",

                gateCollectedAt:
                  serverTimestamp(),

                gateCollectedBy:
                  actor,

                updatedAt:
                  serverTimestamp(),

                updatedBy:
                  actor,
              },
              {
                merge:
                  true,
              }
            );

            transaction.set(
              gateCheckRef,
              {
                status:
                  "GATE_COLLECTED",

                gateCollectedAt:
                  serverTimestamp(),

                gateCollectedBy:
                  actor,
              },
              {
                merge:
                  true,
              }
            );
          }
        );

        await setDoc(
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "events",
            `gate_${assignment.id}_${Date.now()}`
          ),
          {
            type:
              "GATE_COLLECTED",

            status:
              "GATE_COLLECTED",

            assignmentId:
              assignment.id,

            passengerId:
              assignment
                .passengerId ||
              null,

            passengerName:
              assignment
                .passengerName ||
              null,

            assignedSeat:
              assignment
                .assignedSeat ||
              null,

            gateCheckNumber:
              assignment
                .gateCheckNumber ||
              null,

            message:
              `Carry-On ${assignment.gateCheckNumber || assignment.id} collected at Gate.`,

            createdAt:
              serverTimestamp(),

            createdBy:
              actor,
          }
        );

        setMessage(
          `${assignment.gateCheckNumber} collected at Gate.`
        );
      } catch (
        gateError
      ) {
        console.error(
          "Carry-On Gate collection error:",
          gateError
        );

        setError(
          gateError?.message ||
          "Unable to confirm Gate collection."
        );
      } finally {
        setProcessingId(
          ""
        );
      }
    };

  return (
    <div
      style={{
        display:
          "grid",

        gap:
          14,
      }}
    >
      <div
        style={{
          display:
            "flex",

          justifyContent:
            "space-between",

          gap:
            12,

          flexWrap:
            "wrap",

          alignItems:
            "flex-end",
        }}
      >
        <div>
          <h3
            style={{
              margin:
                0,
            }}
          >
            Gate Collection
          </h3>

          <p
            style={{
              margin:
                "6px 0 0",

              color:
                "#64748b",

              fontSize:
                "0.82rem",
            }}
          >
            Confirm each Carry-On when it is physically collected at the gate.
          </p>
        </div>

        <label
          style={{
            display:
              "grid",

            gap:
              5,

            minWidth:
              240,
          }}
        >
          <span
            style={{
              color:
                "#475569",

              fontSize:
                "0.75rem",

              fontWeight:
                800,
            }}
          >
            Carry-On Flight
          </span>

          <select
            value={
              selectedCarryOnFlightId ||
              ""
            }

            onChange={(
              event
            ) =>
              onSelectCarryOnFlight?.(
                event.target
                  .value ||
                null
              )
            }

            style={
              inputStyle
            }
          >
            <option value="">
              Select flight
            </option>

            {flights.map(
              (
                flight
              ) => (
                <option
                  key={
                    flight.id
                  }

                  value={
                    flight.id
                  }
                >
                  {flight.flightNumber} - {flight.flightDate}
                </option>
              )
            )}
          </select>
        </label>
      </div>

      {selectedFlight ? (
        <>
          <div
            style={{
              padding:
                12,

              borderRadius:
                12,

              border:
                "1px solid #c4b5fd",

              background:
                "#f5f3ff",
            }}
          >
            <strong>
              {selectedFlight.flightNumber}
              {" - "}
              {selectedFlight.flightDate}
            </strong>

            <div
              style={{
                marginTop:
                  4,

                color:
                  "#64748b",

                fontSize:
                  "0.8rem",
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
              display:
                "grid",

              gridTemplateColumns:
                "repeat(auto-fit, minmax(150px, 1fr))",

              gap:
                8,
            }}
          >
            <Metric
              label="Waiting at Gate"
              value={
                waitingAtGate.length
              }
            />

            <Metric
              label="Collected"
              value={
                collectedAtGate.length
              }
            />

            <Metric
              label="Total Assigned"
              value={
                assignments.length
              }
            />
          </div>

          {!canOperateGate && (
            <Notice
              tone="warning"
              text="You can view Gate status, but your current role/operational position cannot confirm collection."
            />
          )}

          <div
            style={
              panelStyle
            }
          >
            <h4
              style={{
                margin:
                  0,
              }}
            >
              Waiting for Gate Collection
            </h4>

            {waitingAtGate.length ===
            0 ? (
              <p
                style={{
                  color:
                    "#64748b",

                  fontSize:
                    "0.82rem",
                }}
              >
                No Carry-On items are currently waiting for Gate collection.
              </p>
            ) : (
              <div
                style={{
                  display:
                    "grid",

                  gap:
                    8,

                  marginTop:
                    10,
                }}
              >
                {waitingAtGate.map(
                  (
                    item
                  ) => (
                    <div
                      key={
                        item.id
                      }

                      style={{
                        display:
                          "flex",

                        justifyContent:
                          "space-between",

                        gap:
                          10,

                        flexWrap:
                          "wrap",

                        alignItems:
                          "center",

                        padding:
                          11,

                        borderRadius:
                          11,

                        border:
                          "1px solid #e2e8f0",

                        background:
                          "white",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display:
                              "flex",

                            gap:
                              8,

                            flexWrap:
                              "wrap",

                            alignItems:
                              "center",
                          }}
                        >
                          <strong>
                            {item.passengerName}
                          </strong>

                          <span
                            style={{
                              color:
                                "#6d28d9",

                              fontWeight:
                                900,
                            }}
                          >
                            {item.gateCheckNumber}
                          </span>
                        </div>

                        <div
                          style={{
                            marginTop:
                              4,

                            color:
                              "#64748b",

                            fontSize:
                              "0.78rem",
                          }}
                        >
                          Seat: {item.assignedSeat || "-"}
                          {" - "}
                          Status: COUNTER ASSIGNED
                        </div>
                      </div>

                      <button
                        type="button"

                        onClick={() =>
                          markCollectedAtGate(
                            item
                          )
                        }

                        disabled={
                          processingId ===
                            item.id ||
                          !canOperateGate
                        }

                        style={{
                          ...primaryButton,

                          opacity:
                            processingId ===
                              item.id ||
                            !canOperateGate
                              ? 0.55
                              : 1,
                        }}
                      >
                        {processingId ===
                        item.id
                          ? "Saving..."
                          : "Collected at Gate"}
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          <div
            style={
              panelStyle
            }
          >
            <h4
              style={{
                margin:
                  0,
              }}
            >
              Collected at Gate
            </h4>

            {collectedAtGate.length ===
            0 ? (
              <p
                style={{
                  color:
                    "#64748b",

                  fontSize:
                    "0.82rem",
                }}
              >
                No Carry-On items collected yet.
              </p>
            ) : (
              <div
                style={{
                  display:
                    "grid",

                  gap:
                    7,

                  marginTop:
                    9,
                }}
              >
                {collectedAtGate.map(
                  (
                    item
                  ) => (
                    <div
                      key={
                        item.id
                      }

                      style={{
                        padding:
                          10,

                        borderRadius:
                          10,

                        border:
                          "1px solid #bbf7d0",

                        background:
                          "#f0fdf4",
                      }}
                    >
                      <div
                        style={{
                          display:
                            "flex",

                          justifyContent:
                            "space-between",

                          gap:
                            10,

                          flexWrap:
                            "wrap",
                        }}
                      >
                        <strong>
                          {item.passengerName}
                        </strong>

                        <span
                          style={{
                            color:
                              "#166534",

                            fontWeight:
                              900,
                          }}
                        >
                          {item.gateCheckNumber}
                        </span>
                      </div>

                      <div
                        style={{
                          marginTop:
                            4,

                          color:
                            "#64748b",

                          fontSize:
                            "0.78rem",
                        }}
                      >
                        Seat: {item.assignedSeat || "-"}
                        {" - "}
                        Status: GATE COLLECTED
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {message && (
            <Notice
              tone="success"
              text={
                message
              }
            />
          )}

          {error && (
            <Notice
              tone="error"
              text={
                error
              }
            />
          )}
        </>
      ) : (
        <Notice
          tone="warning"
          text="Select a Carry-On flight to begin Gate collection."
        />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
}) {
  return (
    <div
      style={{
        padding:
          9,

        borderRadius:
          10,

        border:
          "1px solid #e2e8f0",

        background:
          "#f8fafc",
      }}
    >
      <div
        style={{
          color:
            "#64748b",

          fontSize:
            "0.68rem",

          fontWeight:
            700,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            2,

          color:
            "#0f172a",

          fontSize:
            "1.12rem",

          fontWeight:
            900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Notice({
  tone,
  text,
}) {
  const success =
    tone ===
    "success";

  const warning =
    tone ===
    "warning";

  return (
    <div
      style={{
        padding:
          10,

        borderRadius:
          10,

        background:
          success
            ? "#f0fdf4"
            : warning
              ? "#fffbeb"
              : "#fef2f2",

        border:
          success
            ? "1px solid #bbf7d0"
            : warning
              ? "1px solid #fde68a"
              : "1px solid #fecaca",

        color:
          success
            ? "#166534"
            : warning
              ? "#92400e"
              : "#991b1b",

        fontSize:
          "0.82rem",

        fontWeight:
          800,

        whiteSpace:
          "pre-wrap",
      }}
    >
      {text}
    </div>
  );
}

const panelStyle = {
  padding:
    13,

  border:
    "1px solid #e2e8f0",

  borderRadius:
    12,

  background:
    "#f8fafc",
};

const inputStyle = {
  width:
    "100%",

  boxSizing:
    "border-box",

  padding:
    "10px 12px",

  borderRadius:
    10,

  border:
    "1px solid #cbd5e1",

  background:
    "white",

  fontSize:
    "0.9rem",
};

const primaryButton = {
  padding:
    "9px 13px",

  borderRadius:
    10,

  border:
    "1px solid #2563eb",

  background:
    "#2563eb",

  color:
    "white",

  fontWeight:
    900,

  cursor:
    "pointer",
};

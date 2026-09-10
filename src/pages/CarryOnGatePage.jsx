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

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function cleanText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
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

const NOTE_OPTIONS = [
  "",
  "BAG DAMAGED",
  "PASSENGER UPSET",
  "PASSENGER REFUSED GATE CHECK",
  "OVERSIZE / SPECIAL HANDLING",
  "TAG ISSUE",
  "OTHER",
];

export default function CarryOnGatePage({
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

  const canOperateGate =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "duty_managers" ||
    role === "supervisor" ||
    role === "gate_controller" ||
    operationalPosition === "GATE_CONTROLLER";

  const [flights, setFlights] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [processingId, setProcessingId] = useState("");
  const [offloadingId, setOffloadingId] = useState("");
  const [noteTypeById, setNoteTypeById] = useState({});
  const [noteTextById, setNoteTextById] = useState({});
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
          "Carry-On Gate flight list error:",
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
          "Carry-On Gate assignments error:",
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

  const waitingAtGate = useMemo(
    () =>
      assignments
        .filter(
          (item) =>
            cleanUpper(item?.status) === "COUNTER_ASSIGNED"
        )
        .sort((a, b) =>
          String(a.gateCheckNumber || "").localeCompare(
            String(b.gateCheckNumber || "")
          )
        ),
    [assignments]
  );

  const collectedAtGate = useMemo(
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

  const offloaded = useMemo(
    () =>
      assignments
        .filter(
          (item) =>
            cleanUpper(item?.status) === "OFFLOADED"
        )
        .sort((a, b) =>
          String(a.gateCheckNumber || "").localeCompare(
            String(b.gateCheckNumber || "")
          )
        ),
    [assignments]
  );

  const getDraftNote = (assignmentId) => {
    const type = cleanText(
      noteTypeById[assignmentId] || ""
    );

    const text = cleanText(
      noteTextById[assignmentId] || ""
    );

    return {
      type,
      text,
      combined:
        [type, text]
          .filter(Boolean)
          .join(" - ") || "",
    };
  };

  const clearDraftNote = (assignmentId) => {
    setNoteTypeById((previous) => ({
      ...previous,
      [assignmentId]: "",
    }));

    setNoteTextById((previous) => ({
      ...previous,
      [assignmentId]: "",
    }));
  };

  const markCollectedAtGate = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateGate) {
      setError(
        "You do not have permission to confirm Gate collection."
      );
      return;
    }

    if (!selectedFlight || !assignment) return;

    const note = getDraftNote(assignment.id);

    const ok = window.confirm(
      `Confirm Collected at Gate?\n\n` +
        `Passenger: ${assignment.passengerName || "-"}\n` +
        `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
        `Seat: ${assignment.assignedSeat || "-"}\n` +
        `Note: ${note.combined || "None"}`
    );

    if (!ok) return;

    try {
      setProcessingId(assignment.id);

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

        if (currentStatus !== "COUNTER_ASSIGNED") {
          throw new Error(
            `This Carry-On cannot be collected from status ${currentStatus || "UNKNOWN"}.`
          );
        }

        transaction.set(
          assignmentRef,
          {
            status: "GATE_COLLECTED",
            gateCollectedAt: serverTimestamp(),
            gateCollectedBy: actor,
            gateCollectionNoteType:
              note.type || null,
            gateCollectionNote:
              note.text || null,
            gateCollectionNoteCombined:
              note.combined || null,
            updatedAt: serverTimestamp(),
            updatedBy: actor,
          },
          { merge: true }
        );

        transaction.set(
          gateCheckRef,
          {
            status: "GATE_COLLECTED",
            gateCollectedAt: serverTimestamp(),
            gateCollectedBy: actor,
            gateCollectionNoteType:
              note.type || null,
            gateCollectionNote:
              note.text || null,
            gateCollectionNoteCombined:
              note.combined || null,
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
            `gate_${assignment.id}_${Date.now()}`
          ),
          {
            type: "GATE_COLLECTED",
            status: "GATE_COLLECTED",
            assignmentId: assignment.id,
            passengerId: assignment.passengerId || null,
            passengerName: assignment.passengerName || null,
            assignedSeat: assignment.assignedSeat || null,
            gateCheckNumber:
              assignment.gateCheckNumber || null,
            gateCollectionNoteType:
              note.type || null,
            gateCollectionNote:
              note.text || null,
            gateCollectionNoteCombined:
              note.combined || null,
            message:
              `Carry-On ${assignment.gateCheckNumber || assignment.id} collected at Gate.`,
            createdAt: serverTimestamp(),
            createdBy: actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On Gate event write error:",
          eventError
        );
      }

      clearDraftNote(assignment.id);

      setMessage(
        `${assignment.gateCheckNumber} collected at Gate.`
      );
    } catch (gateError) {
      console.error(
        "Carry-On Gate collection error:",
        gateError
      );

      setError(
        gateError?.message ||
          "Unable to confirm Gate collection."
      );
    } finally {
      setProcessingId("");
    }
  };

  const offloadCarryOn = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateGate) {
      setError(
        "You do not have permission to Offload this Carry-On."
      );
      return;
    }

    if (!selectedFlight || !assignment) return;

    const note = getDraftNote(assignment.id);

    const existingNote =
      cleanText(
        assignment.gateCollectionNoteCombined ||
        assignment.gateCollectionNote ||
        ""
      );

    const offloadReason =
      note.combined || existingNote;

    if (!offloadReason) {
      setError(
        "Select or enter a note/reason before Offload."
      );
      return;
    }

    const ok = window.confirm(
      `OFFLOAD this Carry-On?\n\n` +
        `Passenger: ${assignment.passengerName || "-"}\n` +
        `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
        `Current Status: ${assignment.status || "-"}\n` +
        `Reason: ${offloadReason}\n\n` +
        `This item will no longer appear for Ramp receipt or Aircraft Loading.`
    );

    if (!ok) return;

    try {
      setOffloadingId(assignment.id);

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

        const data = assignmentSnap.data();
        const currentStatus = cleanUpper(
          data?.status
        );

        if (
          currentStatus !== "COUNTER_ASSIGNED" &&
          currentStatus !== "GATE_COLLECTED"
        ) {
          throw new Error(
            `This Carry-On cannot be Offloaded from status ${currentStatus || "UNKNOWN"}.`
          );
        }

        transaction.set(
          assignmentRef,
          {
            status: "OFFLOADED",
            statusBeforeOffload: currentStatus,
            offloadedAt: serverTimestamp(),
            offloadedBy: actor,
            offloadReason,
            offloadNoteType:
              note.type || null,
            offloadNote:
              note.text || null,
            updatedAt: serverTimestamp(),
            updatedBy: actor,
          },
          { merge: true }
        );

        transaction.set(
          gateCheckRef,
          {
            status: "OFFLOADED",
            statusBeforeOffload: currentStatus,
            offloadedAt: serverTimestamp(),
            offloadedBy: actor,
            offloadReason,
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
            `offloaded_${assignment.id}_${Date.now()}`
          ),
          {
            type: "OFFLOADED",
            status: "OFFLOADED",
            assignmentId: assignment.id,
            passengerId: assignment.passengerId || null,
            passengerName: assignment.passengerName || null,
            assignedSeat: assignment.assignedSeat || null,
            gateCheckNumber:
              assignment.gateCheckNumber || null,
            statusBeforeOffload:
              cleanUpper(assignment.status),
            offloadReason,
            message:
              `Carry-On ${assignment.gateCheckNumber || assignment.id} Offloaded at Gate.`,
            createdAt: serverTimestamp(),
            createdBy: actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On Offload event write error:",
          eventError
        );
      }

      clearDraftNote(assignment.id);

      setMessage(
        `${assignment.gateCheckNumber} Offloaded.`
      );
    } catch (offloadError) {
      console.error(
        "Carry-On Offload error:",
        offloadError
      );

      setError(
        offloadError?.message ||
          "Unable to Offload Carry-On."
      );
    } finally {
      setOffloadingId("");
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
      }}
    >
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
            Gate Collection
          </h3>

          <p
            style={{
              margin: "6px 0 0",
              color: "#64748b",
              fontSize: "0.82rem",
            }}
          >
            Confirm collection, record Gate notes, or Offload an item when required.
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
              label="Waiting at Gate"
              value={waitingAtGate.length}
            />
            <Metric
              label="Collected"
              value={collectedAtGate.length}
            />
            <Metric
              label="Offloaded"
              value={offloaded.length}
            />
            <Metric
              label="Total Assigned"
              value={assignments.length}
            />
          </div>

          {!canOperateGate && (
            <Notice
              tone="warning"
              text="You can view Gate status, but your current role/operational position cannot confirm collection or Offload."
            />
          )}

          <div style={panelStyle}>
            <h4 style={{ margin: 0 }}>
              Waiting for Gate Collection
            </h4>

            {waitingAtGate.length === 0 ? (
              <p style={emptyText}>
                No Carry-On items are currently waiting for Gate collection.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  marginTop: 10,
                }}
              >
                {waitingAtGate.map((item) => (
                  <GateActionCard
                    key={item.id}
                    item={item}
                    noteType={
                      noteTypeById[item.id] || ""
                    }
                    noteText={
                      noteTextById[item.id] || ""
                    }
                    setNoteType={(value) =>
                      setNoteTypeById(
                        (previous) => ({
                          ...previous,
                          [item.id]: value,
                        })
                      )
                    }
                    setNoteText={(value) =>
                      setNoteTextById(
                        (previous) => ({
                          ...previous,
                          [item.id]: value,
                        })
                      )
                    }
                    onCollect={() =>
                      markCollectedAtGate(item)
                    }
                    onOffload={() =>
                      offloadCarryOn(item)
                    }
                    collecting={
                      processingId === item.id
                    }
                    offloading={
                      offloadingId === item.id
                    }
                    canOperate={canOperateGate}
                  />
                ))}
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <h4 style={{ margin: 0 }}>
              Collected at Gate
            </h4>

            {collectedAtGate.length === 0 ? (
              <p style={emptyText}>
                No Carry-On items collected yet.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  marginTop: 9,
                }}
              >
                {collectedAtGate.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 11,
                      borderRadius: 10,
                      border: "1px solid #bbf7d0",
                      background: "#f0fdf4",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent:
                          "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <strong>
                          {item.passengerName}
                        </strong>
                        <div
                          style={{
                            marginTop: 4,
                            color: "#64748b",
                            fontSize: "0.78rem",
                          }}
                        >
                          Seat: {item.assignedSeat || "-"}
                          {" - "}
                          Collected: {formatTimestamp(item.gateCollectedAt)}
                        </div>

                        {item.gateCollectionNoteCombined && (
                          <div
                            style={{
                              marginTop: 5,
                              color: "#92400e",
                              fontSize: "0.76rem",
                              fontWeight: 800,
                            }}
                          >
                            Gate Note: {item.gateCollectionNoteCombined}
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gap: 7,
                          justifyItems: "end",
                        }}
                      >
                        <span
                          style={{
                            color: "#166534",
                            fontWeight: 900,
                          }}
                        >
                          {item.gateCheckNumber}
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            offloadCarryOn(item)
                          }
                          disabled={
                            offloadingId === item.id ||
                            !canOperateGate
                          }
                          style={{
                            ...dangerButton,
                            opacity:
                              offloadingId === item.id ||
                              !canOperateGate
                                ? 0.55
                                : 1,
                          }}
                        >
                          {offloadingId === item.id
                            ? "Offloading..."
                            : "Offload"}
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "minmax(180px, 240px) minmax(220px, 1fr)",
                        gap: 8,
                        marginTop: 10,
                      }}
                    >
                      <select
                        value={
                          noteTypeById[item.id] || ""
                        }
                        onChange={(event) =>
                          setNoteTypeById(
                            (previous) => ({
                              ...previous,
                              [item.id]:
                                event.target.value,
                            })
                          )
                        }
                        style={inputStyle}
                      >
                        {NOTE_OPTIONS.map((option) => (
                          <option
                            key={option || "NONE"}
                            value={option}
                          >
                            {option || "Offload reason / note type"}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        value={
                          noteTextById[item.id] || ""
                        }
                        placeholder="Offload note / reason..."
                        onChange={(event) =>
                          setNoteTextById(
                            (previous) => ({
                              ...previous,
                              [item.id]:
                                event.target.value,
                            })
                          )
                        }
                        style={inputStyle}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              ...panelStyle,
              border: "1px solid #fecaca",
              background: "#fff7f7",
            }}
          >
            <h4
              style={{
                margin: 0,
                color: "#991b1b",
              }}
            >
              Offloaded
            </h4>

            {offloaded.length === 0 ? (
              <p style={emptyText}>
                No Carry-On items have been Offloaded.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  marginTop: 9,
                }}
              >
                {offloaded.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #fecaca",
                      background: "white",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent:
                          "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <strong>
                        {item.passengerName}
                      </strong>

                      <span
                        style={{
                          color: "#991b1b",
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
                      Previous: {item.statusBeforeOffload || "-"}
                      {" - "}
                      Offloaded: {formatTimestamp(item.offloadedAt)}
                    </div>

                    <div
                      style={{
                        marginTop: 5,
                        color: "#991b1b",
                        fontSize: "0.76rem",
                        fontWeight: 800,
                      }}
                    >
                      Reason: {item.offloadReason || "-"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {message && (
            <Notice
              tone="success"
              text={message}
            />
          )}

          {error && (
            <Notice
              tone="error"
              text={error}
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

function GateActionCard({
  item,
  noteType,
  noteText,
  setNoteType,
  setNoteText,
  onCollect,
  onOffload,
  collecting,
  offloading,
  canOperate,
}) {
  return (
    <div
      style={{
        padding: 11,
        borderRadius: 11,
        border: "1px solid #e2e8f0",
        background: "white",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
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
            <strong>
              {item.passengerName}
            </strong>

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
            Status: COUNTER ASSIGNED
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(180px, 240px) minmax(220px, 1fr)",
          gap: 8,
          marginTop: 10,
        }}
      >
        <label
          style={{
            display: "grid",
            gap: 5,
          }}
        >
          <span style={fieldLabel}>
            Gate Note Type
          </span>

          <select
            value={noteType}
            onChange={(event) =>
              setNoteType(event.target.value)
            }
            style={inputStyle}
          >
            {NOTE_OPTIONS.map((option) => (
              <option
                key={option || "NONE"}
                value={option}
              >
                {option || "No quick note"}
              </option>
            ))}
          </select>
        </label>

        <label
          style={{
            display: "grid",
            gap: 5,
          }}
        >
          <span style={fieldLabel}>
            Gate Notes
          </span>

          <input
            type="text"
            value={noteText}
            placeholder="Example: bag damaged, passenger upset..."
            onChange={(event) =>
              setNoteText(event.target.value)
            }
            style={inputStyle}
          />
        </label>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 10,
        }}
      >
        <button
          type="button"
          onClick={onCollect}
          disabled={
            collecting ||
            offloading ||
            !canOperate
          }
          style={{
            ...primaryButton,
            opacity:
              collecting ||
              offloading ||
              !canOperate
                ? 0.55
                : 1,
          }}
        >
          {collecting
            ? "Saving..."
            : "Collected at Gate"}
        </button>

        <button
          type="button"
          onClick={onOffload}
          disabled={
            collecting ||
            offloading ||
            !canOperate
          }
          style={{
            ...dangerButton,
            opacity:
              collecting ||
              offloading ||
              !canOperate
                ? 0.55
                : 1,
          }}
        >
          {offloading
            ? "Offloading..."
            : "Offload"}
        </button>
      </div>
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

function Notice({
  tone,
  text,
}) {
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

const fieldLabel = {
  color: "#475569",
  fontSize: "0.75rem",
  fontWeight: 800,
};

const emptyText = {
  color: "#64748b",
  fontSize: "0.82rem",
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

const dangerButton = {
  padding: "9px 13px",
  borderRadius: 10,
  border: "1px solid #dc2626",
  background: "#dc2626",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

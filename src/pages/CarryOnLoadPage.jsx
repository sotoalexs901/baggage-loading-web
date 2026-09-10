// src/pages/CarryOnLoadPage.jsx

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
      operationalContext?.operationalPosition ||
      null,
    operationalPositionLabel:
      operationalContext?.operationalPositionLabel ||
      null,
  };
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

export default function CarryOnLoadPage({
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

  const operationalPosition =
    cleanUpper(
      operationalContext?.operationalPosition
    );

  const canOperateLoad =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "duty_managers" ||
    role === "supervisor" ||
    role === "agent" ||
    operationalPosition === "AIRCRAFT_RAMP";

  const [flights, setFlights] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [compartmentByAssignment, setCompartmentByAssignment] =
    useState({});
  const [loadingId, setLoadingId] = useState("");
  const [offloadingId, setOffloadingId] = useState("");
  const [offloadReasonById, setOffloadReasonById] =
    useState({});
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
          "Carry-On Load flight list error:",
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
          "Carry-On Load assignments error:",
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

  const readyToLoad = useMemo(
    () =>
      assignments
        .filter(
          (item) =>
            cleanUpper(item?.status) ===
            "RAMP_RECEIVED"
        )
        .sort((a, b) =>
          String(a.gateCheckNumber || "").localeCompare(
            String(b.gateCheckNumber || "")
          )
        ),
    [assignments]
  );

  const loaded = useMemo(
    () =>
      assignments
        .filter(
          (item) =>
            cleanUpper(item?.status) ===
            "AIRCRAFT_LOADED"
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
            cleanUpper(item?.status) ===
            "OFFLOADED"
        )
        .sort((a, b) =>
          String(a.gateCheckNumber || "").localeCompare(
            String(b.gateCheckNumber || "")
          )
        ),
    [assignments]
  );

  const compartmentTotals = useMemo(() => {
    return loaded.reduce(
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
  }, [loaded]);

  const offloadCarryOn = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateLoad) {
      setError(
        "You do not have permission to Offload this Carry-On."
      );
      return;
    }

    if (!selectedFlight || !assignment) return;

    const reason = String(
      offloadReasonById[assignment.id] || ""
    )
      .trim()
      .replace(/\s+/g, " ");

    if (!reason) {
      setError(
        "Enter an Offload reason before continuing."
      );
      return;
    }

    const ok = window.confirm(
      `OFFLOAD this Carry-On before loading?\n\n` +
        `Passenger: ${assignment.passengerName || "-"}\n` +
        `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
        `Reason: ${reason}`
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

        const currentStatus =
          cleanUpper(
            assignmentSnap.data()?.status
          );

        if (currentStatus !== "RAMP_RECEIVED") {
          throw new Error(
            `This Carry-On cannot be Offloaded from status ${currentStatus || "UNKNOWN"}.`
          );
        }

        transaction.set(
          assignmentRef,
          {
            status: "OFFLOADED",
            statusBeforeOffload: "RAMP_RECEIVED",
            offloadedAt: serverTimestamp(),
            offloadedBy: actor,
            offloadReason: reason,
            offloadStage: "LOAD",
            updatedAt: serverTimestamp(),
            updatedBy: actor,
          },
          { merge: true }
        );

        transaction.set(
          gateCheckRef,
          {
            status: "OFFLOADED",
            statusBeforeOffload: "RAMP_RECEIVED",
            offloadedAt: serverTimestamp(),
            offloadedBy: actor,
            offloadReason: reason,
            offloadStage: "LOAD",
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
            `load_offload_${assignment.id}_${Date.now()}`
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
            offloadReason: reason,
            offloadStage: "LOAD",
            message:
              `Carry-On ${assignment.gateCheckNumber || assignment.id} Offloaded before Aircraft Loading.`,
            createdAt: serverTimestamp(),
            createdBy: actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On Load Offload event error:",
          eventError
        );
      }

      setOffloadReasonById((previous) => ({
        ...previous,
        [assignment.id]: "",
      }));

      setMessage(
        `${assignment.gateCheckNumber} Offloaded before loading.`
      );
    } catch (offloadError) {
      console.error(
        "Carry-On Load Offload error:",
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

  const markLoaded = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateLoad) {
      setError(
        "You do not have permission to confirm Aircraft loading."
      );
      return;
    }

    if (!selectedFlight || !assignment) {
      return;
    }

    const compartment = cleanUpper(
      compartmentByAssignment[assignment.id]
    );

    if (
      !["FORWARD", "MIDDLE", "AFT"].includes(
        compartment
      )
    ) {
      setError(
        "Select FORWARD, MIDDLE or AFT before marking Loaded."
      );
      return;
    }

    const ok = window.confirm(
      `Confirm Loaded on Aircraft?\n\n` +
        `Passenger: ${assignment.passengerName || "-"}\n` +
        `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
        `Compartment: ${compartment}`
    );

    if (!ok) {
      return;
    }

    try {
      setLoadingId(assignment.id);

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

      await runTransaction(
        db,
        async (transaction) => {
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
            currentStatus !== "RAMP_RECEIVED"
          ) {
            throw new Error(
              `This Carry-On cannot be loaded from status ${currentStatus || "UNKNOWN"}.`
            );
          }

          transaction.set(
            assignmentRef,
            {
              status: "AIRCRAFT_LOADED",
              compartment,
              aircraftLoadedAt:
                serverTimestamp(),
              aircraftLoadedBy: actor,
              updatedAt:
                serverTimestamp(),
              updatedBy: actor,
            },
            {
              merge: true,
            }
          );

          transaction.set(
            gateCheckRef,
            {
              status: "AIRCRAFT_LOADED",
              compartment,
              aircraftLoadedAt:
                serverTimestamp(),
              aircraftLoadedBy: actor,
            },
            {
              merge: true,
            }
          );
        }
      );

      try {
        await setDoc(
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "events",
            `aircraft_loaded_${assignment.id}_${Date.now()}`
          ),
          {
            type: "AIRCRAFT_LOADED",
            status: "AIRCRAFT_LOADED",
            assignmentId: assignment.id,
            passengerId:
              assignment.passengerId || null,
            passengerName:
              assignment.passengerName || null,
            assignedSeat:
              assignment.assignedSeat || null,
            gateCheckNumber:
              assignment.gateCheckNumber || null,
            compartment,
            message:
              `Carry-On ${assignment.gateCheckNumber || assignment.id} loaded in ${compartment}.`,
            createdAt:
              serverTimestamp(),
            createdBy: actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On Load event write error:",
          eventError
        );
      }

      setMessage(
        `${assignment.gateCheckNumber} loaded in ${compartment}.`
      );

      setCompartmentByAssignment(
        (previous) => ({
          ...previous,
          [assignment.id]: "",
        })
      );
    } catch (loadError) {
      console.error(
        "Carry-On aircraft load error:",
        loadError
      );

      setError(
        loadError?.message ||
          "Unable to confirm Aircraft loading."
      );
    } finally {
      setLoadingId("");
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
            Aircraft Loading
          </h3>

          <p
            style={{
              margin: "6px 0 0",
              color: "#64748b",
              fontSize: "0.82rem",
            }}
          >
            Load Carry-On items received by Ramp and record the final aircraft compartment.
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
      </div>

      {selectedFlight ? (
        <>
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border:
                "1px solid #c4b5fd",
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
                "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 8,
            }}
          >
            <Metric
              label="Ready to Load"
              value={readyToLoad.length}
            />

            <Metric
              label="Loaded"
              value={loaded.length}
            />

            <Metric
              label="Offloaded"
              value={offloaded.length}
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

          {!canOperateLoad && (
            <Notice
              tone="warning"
              text="You can view Aircraft Loading status, but your current role/operational position cannot confirm loading."
            />
          )}

          <div style={panelStyle}>
            <h4 style={{ margin: 0 }}>
              Ready to Load
            </h4>

            {readyToLoad.length === 0 ? (
              <p
                style={{
                  color: "#64748b",
                  fontSize: "0.82rem",
                }}
              >
                No Carry-On items are currently ready for aircraft loading.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {readyToLoad.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 11,
                      borderRadius: 11,
                      border:
                        "1px solid #bfdbfe",
                      background: "#eff6ff",
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
                          Status: RAMP RECEIVED
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gap: 7,
                          minWidth: 300,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: 7,
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <select
                            value={
                              compartmentByAssignment[
                                item.id
                              ] || ""
                            }
                            onChange={(event) =>
                              setCompartmentByAssignment(
                                (previous) => ({
                                  ...previous,
                                  [item.id]:
                                    event.target.value,
                                })
                              )
                            }
                            style={{
                              ...inputStyle,
                              minWidth: 145,
                            }}
                          >
                            <option value="">
                              Compartment
                            </option>
                            <option value="FORWARD">
                              FORWARD
                            </option>
                            <option value="MIDDLE">
                              MIDDLE
                            </option>
                            <option value="AFT">
                              AFT
                            </option>
                          </select>

                          <button
                            type="button"
                            onClick={() =>
                              markLoaded(item)
                            }
                            disabled={
                              loadingId === item.id ||
                              offloadingId === item.id ||
                              !canOperateLoad
                            }
                            style={{
                              ...primaryButton,
                              opacity:
                                loadingId === item.id ||
                                offloadingId === item.id ||
                                !canOperateLoad
                                  ? 0.55
                                  : 1,
                            }}
                          >
                            {loadingId === item.id
                              ? "Saving..."
                              : "Loaded"}
                          </button>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            gap: 7,
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="text"
                            value={
                              offloadReasonById[
                                item.id
                              ] || ""
                            }
                            placeholder="Offload reason..."
                            onChange={(event) =>
                              setOffloadReasonById(
                                (previous) => ({
                                  ...previous,
                                  [item.id]:
                                    event.target.value,
                                })
                              )
                            }
                            style={{
                              ...inputStyle,
                              minWidth: 190,
                            }}
                          />

                          <button
                            type="button"
                            onClick={() =>
                              offloadCarryOn(item)
                            }
                            disabled={
                              offloadingId === item.id ||
                              loadingId === item.id ||
                              !canOperateLoad
                            }
                            style={{
                              ...dangerButton,
                              opacity:
                                offloadingId === item.id ||
                                loadingId === item.id ||
                                !canOperateLoad
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <h4 style={{ margin: 0 }}>
              Loaded on Aircraft
            </h4>

            {loaded.length === 0 ? (
              <p
                style={{
                  color: "#64748b",
                  fontSize: "0.82rem",
                }}
              >
                No Carry-On items loaded yet.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 7,
                  marginTop: 9,
                }}
              >
                {loaded.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border:
                        "1px solid #bbf7d0",
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
                      }}
                    >
                      <strong>
                        {item.passengerName}
                      </strong>

                      <span
                        style={{
                          color: "#166534",
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
                      Compartment: {item.compartment || "-"}
                      {" - "}
                      Loaded: {formatTimestamp(item.aircraftLoadedAt)}
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
              <p
                style={{
                  color: "#64748b",
                  fontSize: "0.82rem",
                }}
              >
                No Carry-On items have been Offloaded.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 7,
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
                        justifyContent: "space-between",
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
                      Reason: {item.offloadReason || "-"}
                      {" - "}
                      Stage: {item.offloadStage || "-"}
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
          text="Select a Carry-On flight to begin Aircraft Loading."
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
  border:
    "1px solid #e2e8f0",
  borderRadius: 12,
  background: "#f8fafc",
};

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
  padding: "9px 13px",
  borderRadius: 10,
  border:
    "1px solid #16a34a",
  background: "#16a34a",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

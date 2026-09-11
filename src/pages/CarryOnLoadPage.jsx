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
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCompartment, setActiveCompartment] = useState("");
  const [selectedReadyIds, setSelectedReadyIds] = useState([]);
  const [readyExpanded, setReadyExpanded] = useState(true);
  const [loadedExpanded, setLoadedExpanded] = useState(false);
  const [offloadedExpanded, setOffloadedExpanded] = useState(false);
  const [expandedLoadedId, setExpandedLoadedId] = useState("");
  const [loadingId, setLoadingId] = useState("");
  const [offloadingId, setOffloadingId] = useState("");
  const [unloadingId, setUnloadingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [offloadReasonById, setOffloadReasonById] =
    useState({});
  const [unloadReasonById, setUnloadReasonById] =
    useState({});
  const [editCompartmentById, setEditCompartmentById] =
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

  const matchesSearch = (item) => {
    const query = String(searchTerm || "").trim().toLowerCase();
    if (!query) return true;
    return String(
      item?.gateCheckNumber || ""
    )
      .toLowerCase()
      .includes(query);
  };

  const filteredReadyToLoad = readyToLoad.filter(matchesSearch);
  const filteredLoaded = loaded.filter(matchesSearch);
  const filteredOffloaded = offloaded.filter(matchesSearch);

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
      `OFFLOAD this Carry-On?\n\n` +
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

        if (
          currentStatus !== "RAMP_RECEIVED" &&
          currentStatus !== "AIRCRAFT_LOADED"
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
            offloadReason: reason,
            offloadStage:
              currentStatus === "AIRCRAFT_LOADED"
                ? "AIRCRAFT"
                : "LOAD",
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
            offloadReason: reason,
            offloadStage:
              currentStatus === "AIRCRAFT_LOADED"
                ? "AIRCRAFT"
                : "LOAD",
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

  const unloadCarryOn = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateLoad) {
      setError(
        "You do not have permission to Unload this Carry-On."
      );
      return;
    }

    if (!selectedFlight || !assignment) return;

    const reason = String(
      unloadReasonById[assignment.id] || ""
    )
      .trim()
      .replace(/\s+/g, " ");

    if (!reason) {
      setError(
        "Enter an Unload reason before continuing."
      );
      return;
    }

    const ok = window.confirm(
      `UNLOAD this Carry-On from the aircraft?\n\n` +
        `Passenger: ${assignment.passengerName || "-"}\n` +
        `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
        `Compartment: ${assignment.compartment || "-"}\n` +
        `Reason: ${reason}\n\n` +
        `The item will return to Ramp and can be loaded again.`
    );

    if (!ok) return;

    try {
      setUnloadingId(assignment.id);

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
        const currentStatus =
          cleanUpper(data?.status);

        if (currentStatus !== "AIRCRAFT_LOADED") {
          throw new Error(
            `This Carry-On cannot be Unloaded from status ${currentStatus || "UNKNOWN"}.`
          );
        }

        transaction.set(
          assignmentRef,
          {
            status: "RAMP_RECEIVED",
            previousAircraftLoadedAt:
              data?.aircraftLoadedAt || null,
            previousAircraftLoadedBy:
              data?.aircraftLoadedBy || null,
            unloadedFromCompartment:
              data?.compartment || null,
            unloadedAt: serverTimestamp(),
            unloadedBy: actor,
            unloadReason: reason,
            aircraftLoadedAt: null,
            aircraftLoadedBy: null,
            compartment: null,
            updatedAt: serverTimestamp(),
            updatedBy: actor,
          },
          { merge: true }
        );

        transaction.set(
          gateCheckRef,
          {
            status: "RAMP_RECEIVED",
            unloadedFromCompartment:
              data?.compartment || null,
            unloadedAt: serverTimestamp(),
            unloadedBy: actor,
            unloadReason: reason,
            aircraftLoadedAt: null,
            aircraftLoadedBy: null,
            compartment: null,
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
            `aircraft_unloaded_${assignment.id}_${Date.now()}`
          ),
          {
            type: "AIRCRAFT_UNLOADED",
            status: "RAMP_RECEIVED",
            assignmentId: assignment.id,
            passengerId: assignment.passengerId || null,
            passengerName: assignment.passengerName || null,
            assignedSeat: assignment.assignedSeat || null,
            gateCheckNumber:
              assignment.gateCheckNumber || null,
            unloadedFromCompartment:
              assignment.compartment || null,
            unloadReason: reason,
            message:
              `Carry-On ${assignment.gateCheckNumber || assignment.id} unloaded from aircraft and returned to Ramp.`,
            createdAt: serverTimestamp(),
            createdBy: actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On Unload event write error:",
          eventError
        );
      }

      setUnloadReasonById((previous) => ({
        ...previous,
        [assignment.id]: "",
      }));

      setMessage(
        `${assignment.gateCheckNumber} unloaded and returned to Ramp.`
      );
    } catch (unloadError) {
      console.error(
        "Carry-On Unload error:",
        unloadError
      );

      setError(
        unloadError?.message ||
          "Unable to Unload Carry-On."
      );
    } finally {
      setUnloadingId("");
    }
  };

  const updateLoadedCompartment = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateLoad) {
      setError(
        "You do not have permission to edit the loaded compartment."
      );
      return;
    }

    if (!selectedFlight || !assignment) return;

    const newCompartment = cleanUpper(
      editCompartmentById[assignment.id] ||
      assignment.compartment ||
      ""
    );

    if (
      !["FORWARD", "MIDDLE", "AFT"].includes(
        newCompartment
      )
    ) {
      setError(
        "Select FORWARD, MIDDLE or AFT."
      );
      return;
    }

    if (
      newCompartment ===
      cleanUpper(assignment.compartment)
    ) {
      setMessage(
        `${assignment.gateCheckNumber} is already in ${newCompartment}.`
      );
      return;
    }

    const ok = window.confirm(
      `Update aircraft compartment?\n\n` +
        `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
        `From: ${assignment.compartment || "-"}\n` +
        `To: ${newCompartment}`
    );

    if (!ok) return;

    try {
      setEditingId(assignment.id);

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
        const currentStatus =
          cleanUpper(data?.status);

        if (currentStatus !== "AIRCRAFT_LOADED") {
          throw new Error(
            `Compartment cannot be edited from status ${currentStatus || "UNKNOWN"}.`
          );
        }

        transaction.set(
          assignmentRef,
          {
            previousCompartment:
              data?.compartment || null,
            compartment: newCompartment,
            compartmentEditedAt:
              serverTimestamp(),
            compartmentEditedBy: actor,
            updatedAt: serverTimestamp(),
            updatedBy: actor,
          },
          { merge: true }
        );

        transaction.set(
          gateCheckRef,
          {
            previousCompartment:
              data?.compartment || null,
            compartment: newCompartment,
            compartmentEditedAt:
              serverTimestamp(),
            compartmentEditedBy: actor,
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
            `compartment_edit_${assignment.id}_${Date.now()}`
          ),
          {
            type: "AIRCRAFT_COMPARTMENT_UPDATED",
            status: "AIRCRAFT_LOADED",
            assignmentId: assignment.id,
            passengerName:
              assignment.passengerName || null,
            gateCheckNumber:
              assignment.gateCheckNumber || null,
            previousCompartment:
              assignment.compartment || null,
            compartment: newCompartment,
            message:
              `Carry-On ${assignment.gateCheckNumber || assignment.id} moved from ${assignment.compartment || "-"} to ${newCompartment}.`,
            createdAt: serverTimestamp(),
            createdBy: actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On compartment edit event error:",
          eventError
        );
      }

      setEditCompartmentById((previous) => ({
        ...previous,
        [assignment.id]: "",
      }));

      setMessage(
        `${assignment.gateCheckNumber} moved to ${newCompartment}.`
      );
    } catch (editError) {
      console.error(
        "Carry-On compartment edit error:",
        editError
      );

      setError(
        editError?.message ||
          "Unable to update compartment."
      );
    } finally {
      setEditingId("");
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


  const toggleReadySelection = (assignmentId) => {
    setSelectedReadyIds((current) =>
      current.includes(assignmentId)
        ? current.filter((id) => id !== assignmentId)
        : [...current, assignmentId]
    );
  };

  const clearReadySelection = () => {
    setSelectedReadyIds([]);
  };

  const loadSelectedIntoCompartment = async () => {
    setMessage("");
    setError("");

    if (!canOperateLoad) {
      setError("You do not have permission to confirm Aircraft loading.");
      return;
    }

    const compartment = cleanUpper(activeCompartment);

    if (!["FORWARD", "MIDDLE", "AFT"].includes(compartment)) {
      setError("Select FORWARD, MIDDLE or AFT first.");
      return;
    }

    const selectedItems = readyToLoad.filter((item) =>
      selectedReadyIds.includes(item.id)
    );

    if (!selectedItems.length) {
      setError("Select at least one Gate Check number to load.");
      return;
    }

    const ok = window.confirm(
      `Load ${selectedItems.length} Carry-On item(s) into ${compartment}?\n\n` +
        selectedItems
          .map((item) => item.gateCheckNumber || item.id)
          .join(", ")
    );

    if (!ok) return;

    try {
      setLoadingId("BATCH");

      for (const assignment of selectedItems) {
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
          const assignmentSnap = await transaction.get(assignmentRef);

          if (!assignmentSnap.exists()) {
            throw new Error("Carry-On assignment no longer exists.");
          }

          const currentStatus = cleanUpper(assignmentSnap.data()?.status);

          if (currentStatus !== "RAMP_RECEIVED") {
            throw new Error(
              `Carry-On ${assignment.gateCheckNumber || assignment.id} cannot be loaded from status ${currentStatus || "UNKNOWN"}.`
            );
          }

          transaction.set(
            assignmentRef,
            {
              status: "AIRCRAFT_LOADED",
              compartment,
              aircraftLoadedAt: serverTimestamp(),
              aircraftLoadedBy: actor,
              updatedAt: serverTimestamp(),
              updatedBy: actor,
            },
            { merge: true }
          );

          transaction.set(
            gateCheckRef,
            {
              status: "AIRCRAFT_LOADED",
              compartment,
              aircraftLoadedAt: serverTimestamp(),
              aircraftLoadedBy: actor,
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
              `aircraft_loaded_${assignment.id}_${Date.now()}`
            ),
            {
              type: "AIRCRAFT_LOADED",
              status: "AIRCRAFT_LOADED",
              assignmentId: assignment.id,
              passengerId: assignment.passengerId || null,
              passengerName: assignment.passengerName || null,
              assignedSeat: assignment.assignedSeat || null,
              gateCheckNumber: assignment.gateCheckNumber || null,
              compartment,
              message: `Carry-On ${assignment.gateCheckNumber || assignment.id} loaded in ${compartment}.`,
              createdAt: serverTimestamp(),
              createdBy: actor,
            }
          );
        } catch (eventError) {
          console.error("Carry-On Load event write error:", eventError);
        }
      }

      setMessage(
        `${selectedItems.length} Carry-On item(s) loaded in ${compartment}.`
      );
      clearReadySelection();
    } catch (loadError) {
      console.error("Carry-On batch load error:", loadError);
      setError(loadError?.message || "Unable to load selected Carry-Ons.");
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
            Choose the aircraft compartment first, then select the Gate Check numbers that will be loaded there.
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
              padding: 8,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
            }}
          >
            <div
              style={{
                color: "#64748b",
                fontSize: "0.66rem",
                fontWeight: 800,
                marginBottom: 4,
              }}
            >
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
              onClick={() => setReadyExpanded((current) => !current)}
              style={{
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
              }}
            >
              <div>
                <strong>Ready to Load</strong>
                <div
                  style={{
                    marginTop: 3,
                    color: "#64748b",
                    fontSize: "0.74rem",
                  }}
                >
                  {readyToLoad.length} ready - Tap to {readyExpanded ? "hide" : "view"}
                </div>
              </div>

              <span
                style={{
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
                }}
              >
                {readyToLoad.length}
              </span>
            </button>

            {readyExpanded && (
              <div
                style={{
                  padding: "0 12px 12px",
                  borderTop: "1px solid #f1f5f9",
                }}
              >
                <div
                  style={{
                    marginTop: 10,
                    padding: 11,
                    borderRadius: 12,
                    border: "1px solid #c4b5fd",
                    background: "#faf5ff",
                  }}
                >
                  <div
                    style={{
                      color: "#5b21b6",
                      fontSize: "0.7rem",
                      fontWeight: 900,
                      marginBottom: 7,
                    }}
                  >
                    1. SELECT COMPARTMENT
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: 8,
                    }}
                  >
                    {["FORWARD", "MIDDLE", "AFT"].map((compartment) => {
                      const active = activeCompartment === compartment;

                      return (
                        <button
                          key={compartment}
                          type="button"
                          onClick={() => {
                            setActiveCompartment(compartment);
                            clearReadySelection();
                          }}
                          style={{
                            padding: "12px 8px",
                            borderRadius: 10,
                            border: active
                              ? "2px solid #7c3aed"
                              : "1px solid #d1d5db",
                            background: active ? "#ede9fe" : "white",
                            color: active ? "#5b21b6" : "#334155",
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          {compartment}
                        </button>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      color: "#64748b",
                      fontSize: "0.74rem",
                    }}
                  >
                    Select one compartment first, then choose all Gate Checks that will be loaded there. Change the compartment and continue with the next group.
                  </div>
                </div>

                {activeCompartment ? (
                  <>
                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            color: "#64748b",
                            fontSize: "0.68rem",
                            fontWeight: 800,
                          }}
                        >
                          2. SELECT GATE CHECKS
                        </div>
                        <strong style={{ color: "#0f172a" }}>
                          Loading into {activeCompartment}
                        </strong>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 7,
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedReadyIds(
                              filteredReadyToLoad.map((item) => item.id)
                            )
                          }
                          style={secondaryButton}
                        >
                          Select All
                        </button>

                        <button
                          type="button"
                          onClick={clearReadySelection}
                          style={secondaryButton}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {filteredReadyToLoad.length === 0 ? (
                      <p style={{ color: "#64748b", fontSize: "0.82rem" }}>
                        No Gate Check numbers are currently ready to load.
                      </p>
                    ) : (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(120px, 1fr))",
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        {filteredReadyToLoad.map((item) => {
                          const selected = selectedReadyIds.includes(item.id);

                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => toggleReadySelection(item.id)}
                              style={{
                                padding: 12,
                                borderRadius: 12,
                                border: selected
                                  ? "2px solid #16a34a"
                                  : "1px solid #bfdbfe",
                                background: selected ? "#f0fdf4" : "white",
                                color: selected ? "#166534" : "#1d4ed8",
                                fontWeight: 900,
                                cursor: "pointer",
                                textAlign: "center",
                              }}
                            >
                              <div style={{ fontSize: "1rem" }}>
                                {item.gateCheckNumber || "-"}
                              </div>
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: "0.66rem",
                                  color: selected ? "#166534" : "#64748b",
                                }}
                              >
                                {selected ? "SELECTED" : "Tap to select"}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={loadSelectedIntoCompartment}
                      disabled={
                        loadingId === "BATCH" ||
                        selectedReadyIds.length === 0 ||
                        !canOperateLoad
                      }
                      style={{
                        ...primaryButton,
                        width: "100%",
                        marginTop: 12,
                        opacity:
                          loadingId === "BATCH" ||
                          selectedReadyIds.length === 0 ||
                          !canOperateLoad
                            ? 0.55
                            : 1,
                      }}
                    >
                      {loadingId === "BATCH"
                        ? "Loading Selected..."
                        : `Load ${selectedReadyIds.length} to ${activeCompartment}`}
                    </button>
                  </>
                ) : (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 10,
                      background: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      color: "#1e3a8a",
                      fontSize: "0.78rem",
                      fontWeight: 800,
                    }}
                  >
                    Choose FORWARD, MIDDLE or AFT to begin loading.
                  </div>
                )}
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
                setLoadedExpanded(
                  (current) => !current
                )
              }
              style={{
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
              }}
            >
              <div>
                <strong>
                  Loaded Gate Checks
                </strong>

                <div
                  style={{
                    marginTop: 3,
                    color: "#64748b",
                    fontSize: "0.74rem",
                  }}
                >
                  {loaded.length} loaded
                  {" - "}
                  Tap to {loadedExpanded ? "hide" : "view"}
                </div>
              </div>

              <span
                style={{
                  minWidth: 34,
                  height: 34,
                  padding: "0 8px",
                  borderRadius: 999,
                  background: "#dcfce7",
                  color: "#166534",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: "0.8rem",
                }}
              >
                {loaded.length}
              </span>
            </button>

            {loadedExpanded && (
              <div
                style={{
                  padding: "0 12px 12px",
                  borderTop: "1px solid #f1f5f9",
                }}
              >
                {filteredLoaded.length === 0 ? (
                  <p
                    style={{
                      color: "#64748b",
                      fontSize: "0.82rem",
                    }}
                  >
                    No matching loaded Gate Check numbers.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(145px, 1fr))",
                      gap: 8,
                      marginTop: 10,
                    }}
                  >
                    {filteredLoaded.map((item) => {
                      const expanded =
                        expandedLoadedId === item.id;

                      return (
                        <div
                          key={item.id}
                          style={{
                            padding: 10,
                            borderRadius: 12,
                            border: "1px solid #bbf7d0",
                            background: "#f0fdf4",
                            textAlign: "center",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedLoadedId(
                                expanded ? "" : item.id
                              )
                            }
                            style={{
                              width: "100%",
                              border: "none",
                              background: "transparent",
                              color: "#166534",
                              fontSize: "1rem",
                              fontWeight: 900,
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            {item.gateCheckNumber || "-"}
                          </button>

                          <div
                            style={{
                              marginTop: 4,
                              color: "#64748b",
                              fontSize: "0.67rem",
                            }}
                          >
                            {item.compartment || "-"}
                            {" - "}
                            Tap for controls
                          </div>

                          {expanded && (
                            <div
                              style={{
                                display: "grid",
                                gap: 7,
                                marginTop: 9,
                                textAlign: "left",
                              }}
                            >
                              <select
                                value={
                                  editCompartmentById[item.id] ||
                                  item.compartment ||
                                  ""
                                }
                                onChange={(event) =>
                                  setEditCompartmentById(
                                    (previous) => ({
                                      ...previous,
                                      [item.id]:
                                        event.target.value,
                                    })
                                  )
                                }
                                style={inputStyle}
                              >
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
                                  updateLoadedCompartment(
                                    item
                                  )
                                }
                                disabled={
                                  editingId === item.id ||
                                  !canOperateLoad
                                }
                                style={secondaryButton}
                              >
                                {editingId === item.id
                                  ? "Updating..."
                                  : "Update Compartment"}
                              </button>

                              <input
                                type="text"
                                value={
                                  unloadReasonById[item.id] ||
                                  ""
                                }
                                placeholder="Unload reason"
                                onChange={(event) =>
                                  setUnloadReasonById(
                                    (previous) => ({
                                      ...previous,
                                      [item.id]:
                                        event.target.value,
                                    })
                                  )
                                }
                                style={inputStyle}
                              />

                              <button
                                type="button"
                                onClick={() =>
                                  unloadCarryOn(item)
                                }
                                disabled={
                                  unloadingId === item.id ||
                                  !canOperateLoad
                                }
                                style={warningButton}
                              >
                                {unloadingId === item.id
                                  ? "Unloading..."
                                  : "Unload to Ramp"}
                              </button>

                              <input
                                type="text"
                                value={
                                  offloadReasonById[item.id] ||
                                  ""
                                }
                                placeholder="Offload reason"
                                onChange={(event) =>
                                  setOffloadReasonById(
                                    (previous) => ({
                                      ...previous,
                                      [item.id]:
                                        event.target.value,
                                    })
                                  )
                                }
                                style={inputStyle}
                              />

                              <button
                                type="button"
                                onClick={() =>
                                  offloadCarryOn(item)
                                }
                                disabled={
                                  offloadingId === item.id ||
                                  !canOperateLoad
                                }
                                style={dangerButton}
                              >
                                {offloadingId === item.id
                                  ? "Offloading..."
                                  : "Offload"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            style={{
              ...panelStyle,
              padding: 0,
              overflow: "hidden",
              background: "white",
              border: "1px solid #fecaca",
            }}
          >
            <button
              type="button"
              onClick={() =>
                setOffloadedExpanded(
                  (current) => !current
                )
              }
              style={{
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
              }}
            >
              <div>
                <strong
                  style={{
                    color: "#991b1b",
                  }}
                >
                  Offloaded Gate Checks
                </strong>

                <div
                  style={{
                    marginTop: 3,
                    color: "#64748b",
                    fontSize: "0.74rem",
                  }}
                >
                  {offloaded.length} offloaded
                  {" - "}
                  Tap to {offloadedExpanded ? "hide" : "view"}
                </div>
              </div>

              <span
                style={{
                  minWidth: 34,
                  height: 34,
                  padding: "0 8px",
                  borderRadius: 999,
                  background: "#fee2e2",
                  color: "#991b1b",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: "0.8rem",
                }}
              >
                {offloaded.length}
              </span>
            </button>

            {offloadedExpanded && (
              <div
                style={{
                  padding: "0 12px 12px",
                  borderTop: "1px solid #fee2e2",
                }}
              >
                {filteredOffloaded.length === 0 ? (
                  <p
                    style={{
                      color: "#64748b",
                      fontSize: "0.82rem",
                    }}
                  >
                    No matching Offloaded Gate Check numbers.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(145px, 1fr))",
                      gap: 8,
                      marginTop: 10,
                    }}
                  >
                    {filteredOffloaded.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid #fecaca",
                          background: "#fef2f2",
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            color: "#991b1b",
                            fontSize: "1rem",
                            fontWeight: 900,
                          }}
                        >
                          {item.gateCheckNumber || "-"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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


const dangerButton = {
  padding: "9px 13px",
  borderRadius: 10,
  border: "1px solid #dc2626",
  background: "#dc2626",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const warningButton = {
  padding: "9px 13px",
  borderRadius: 10,
  border: "1px solid #d97706",
  background: "#d97706",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryButton = {
  padding: "9px 13px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "white",
  color: "#334155",
  fontWeight: 900,
  cursor: "pointer",
};

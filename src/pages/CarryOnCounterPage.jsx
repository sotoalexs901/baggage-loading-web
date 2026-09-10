// src/pages/carryOn/CarryOnCounterPage.jsx

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

function safeDocId(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .replace(
      /[^A-Za-z0-9_-]/g,
      "_"
    );
}

function normalizeGateCheckNumber(
  value
) {
  return cleanUpper(
    value
  )
    .replace(
      /\s+/g,
      ""
    )
    .replace(
      /[^A-Z0-9-]/g,
      ""
    );
}

function normalizeSeat(
  value
) {
  return cleanUpper(
    value
  ).replace(
    /\s+/g,
    ""
  );
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

export default function CarryOnCounterPage({
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

  const canOperateCounter =
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor" ||
    role ===
      "agent" ||
    cleanUpper(
      operationalContext
        ?.operationalPosition
    ) ===
      "COUNTER_SCAN";

  const [
    flights,
    setFlights,
  ] = useState(
    []
  );

  const [
    passengers,
    setPassengers,
  ] = useState(
    []
  );

  const [
    seats,
    setSeats,
  ] = useState(
    []
  );

  const [
    gateChecks,
    setGateChecks,
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
    selectedPassengerId,
    setSelectedPassengerId,
  ] = useState(
    ""
  );

  const [
    selectedSeatId,
    setSelectedSeatId,
  ] = useState(
    ""
  );

  const [
    selectedGateCheckId,
    setSelectedGateCheckId,
  ] = useState(
    ""
  );

  const [
    carryOnWeight,
    setCarryOnWeight,
  ] = useState(
    ""
  );

  const [
    lastMinuteName,
    setLastMinuteName,
  ] = useState(
    ""
  );

  const [
    lastMinuteSeat,
    setLastMinuteSeat,
  ] = useState(
    ""
  );

  const [
    lastMinuteGateCheck,
    setLastMinuteGateCheck,
  ] = useState(
    ""
  );

  const [
    lastMinuteWeight,
    setLastMinuteWeight,
  ] = useState(
    ""
  );

  const [
    assignmentSearch,
    setAssignmentSearch,
  ] = useState(
    ""
  );

  const [
    assignmentsExpanded,
    setAssignmentsExpanded,
  ] = useState(
    false
  );

  const [
    editingAssignmentId,
    setEditingAssignmentId,
  ] = useState(
    ""
  );

  const [
    editPassengerName,
    setEditPassengerName,
  ] = useState(
    ""
  );

  const [
    editSeatId,
    setEditSeatId,
  ] = useState(
    ""
  );

  const [
    editGateCheckId,
    setEditGateCheckId,
  ] = useState(
    ""
  );

  const [
    editWeight,
    setEditWeight,
  ] = useState(
    ""
  );

  const [
    savingAssignmentEdit,
    setSavingAssignmentEdit,
  ] = useState(
    false
  );

  const [
    assigning,
    setAssigning,
  ] = useState(
    false
  );

  const [
    addingLastMinute,
    setAddingLastMinute,
  ] = useState(
    false
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
            "Carry-On Counter flight list error:",
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
      setPassengers(
        []
      );

      setSeats(
        []
      );

      setGateChecks(
        []
      );

      setAssignments(
        []
      );

      return undefined;
    }

    const unsubscribers =
      [];

    const subscribe =
      (
        subcollection,
        setter,
        fallback
      ) => {
        const unsub =
          onSnapshot(
            collection(
              db,
              "carryOnFlights",
              selectedCarryOnFlightId,
              subcollection
            ),

            (
              snap
            ) => {
              setter(
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
                fallback,
                snapshotError
              );

              setError(
                fallback
              );
            }
          );

        unsubscribers.push(
          unsub
        );
      };

    subscribe(
      "passengers",
      setPassengers,
      "Unable to load Carry-On passengers."
    );

    subscribe(
      "availableSeats",
      setSeats,
      "Unable to load Carry-On seats."
    );

    subscribe(
      "gateCheckNumbers",
      setGateChecks,
      "Unable to load Carry-On Gate Check numbers."
    );

    subscribe(
      "assignments",
      setAssignments,
      "Unable to load Carry-On assignments."
    );

    return () => {
      unsubscribers.forEach(
        (
          unsub
        ) => {
          try {
            unsub();
          } catch {
            // Cleanup only.
          }
        }
      );
    };
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

  const availablePassengers =
    useMemo(
      () =>
        passengers
          .filter(
            (
              item
            ) =>
              item?.assigned !==
              true
          )
          .sort(
            (
              a,
              b
            ) =>
              String(
                a.passengerName ||
                ""
              ).localeCompare(
                String(
                  b.passengerName ||
                  ""
                )
              )
          ),
      [
        passengers,
      ]
    );

  const availableSeats =
    useMemo(
      () =>
        seats
          .filter(
            (
              item
            ) =>
              cleanUpper(
                item?.status
              ) ===
              "AVAILABLE"
          )
          .sort(
            (
              a,
              b
            ) =>
              String(
                a.seatNumber ||
                ""
              ).localeCompare(
                String(
                  b.seatNumber ||
                  ""
                ),
                undefined,
                {
                  numeric:
                    true,
                }
              )
          ),
      [
        seats,
      ]
    );

  const availableGateChecks =
    useMemo(
      () =>
        gateChecks
          .filter(
            (
              item
            ) =>
              cleanUpper(
                item?.status
              ) ===
              "AVAILABLE"
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
        gateChecks,
      ]
    );

  const assignedCount =
    assignments.length;

  const requiredCount =
    Number(
      selectedFlight
        ?.requiredCarryOns ||
      0
    );

  const remainingCount =
    Math.max(
      0,
      requiredCount -
        assignedCount
    );

  const additionalCount =
    Math.max(
      0,
      assignedCount -
        requiredCount
    );

  const selectedPassenger =
    passengers.find(
      (
        item
      ) =>
        item.id ===
        selectedPassengerId
    ) ||
    null;

  const selectedSeat =
    seats.find(
      (
        item
      ) =>
        item.id ===
        selectedSeatId
    ) ||
    null;

  const selectedGateCheck =
    gateChecks.find(
      (
        item
      ) =>
        item.id ===
        selectedGateCheckId
    ) ||
    null;

  const filteredAssignments = useMemo(() => {
    const query = String(assignmentSearch || "")
      .trim()
      .toLowerCase();

    if (!query) return assignments;

    return assignments.filter((item) =>
      [
        item.passengerName,
        item.assignedSeat,
        item.gateCheckNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [assignments, assignmentSearch]);

  const createAssignment =
    async ({
      passengerId,
      passengerName,
      passengerSource,
      seatId,
      seatNumber,
      seatType,
      gateCheckId,
      gateCheckNumber,
      gateCheckSource,
      counterWeightLbs,
      createPassenger = false,
      createSeat = false,
      createGateCheck = false,
    }) => {
      const flightRef =
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id
        );

      const passengerRef =
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "passengers",
          passengerId
        );

      const seatRef =
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "availableSeats",
          seatId
        );

      const gateCheckRef =
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "gateCheckNumbers",
          gateCheckId
        );

      const assignmentId =
        gateCheckId;

      const assignmentRef =
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "assignments",
          assignmentId
        );

      await runTransaction(
        db,
        async (
          transaction
        ) => {
          const [
            flightSnap,
            passengerSnap,
            seatSnap,
            gateCheckSnap,
            assignmentSnap,
          ] =
            await Promise.all([
              transaction.get(
                flightRef
              ),

              transaction.get(
                passengerRef
              ),

              transaction.get(
                seatRef
              ),

              transaction.get(
                gateCheckRef
              ),

              transaction.get(
                assignmentRef
              ),
            ]);

          if (
            assignmentSnap.exists()
          ) {
            throw new Error(
              "This Gate Check number already has an assignment."
            );
          }

          if (
            passengerSnap.exists() &&
            passengerSnap
              .data()
              ?.assigned ===
              true
          ) {
            throw new Error(
              "This passenger already has a Carry-On assignment."
            );
          }

          if (
            seatSnap.exists() &&
            cleanUpper(
              seatSnap
                .data()
                ?.status
            ) !==
              "AVAILABLE"
          ) {
            throw new Error(
              "This seat is already assigned."
            );
          }

          if (
            gateCheckSnap.exists() &&
            cleanUpper(
              gateCheckSnap
                .data()
                ?.status
            ) !==
              "AVAILABLE"
          ) {
            throw new Error(
              "This Gate Check number is already assigned."
            );
          }

          if (
            !createPassenger &&
            !passengerSnap.exists()
          ) {
            throw new Error(
              "Passenger no longer exists."
            );
          }

          if (
            !createSeat &&
            !seatSnap.exists()
          ) {
            throw new Error(
              "Seat no longer exists."
            );
          }

          if (
            !createGateCheck &&
            !gateCheckSnap.exists()
          ) {
            throw new Error(
              "Gate Check number no longer exists."
            );
          }

          transaction.set(
            passengerRef,
            {
              passengerName,

              source:
                passengerSource,

              assigned:
                true,

              assignedSeat:
                seatNumber,

              gateCheckNumber,

              assignmentId,

              updatedAt:
                serverTimestamp(),

              ...(createPassenger
                ? {
                    createdAt:
                      serverTimestamp(),

                    createdBy:
                      actor,
                  }
                : {}),
            },
            {
              merge:
                true,
            }
          );

          transaction.set(
            seatRef,
            {
              seatNumber,

              seatType:
                seatType ||
                null,

              blocked:
                false,

              status:
                "ASSIGNED",

              assignmentId,

              passengerId,

              passengerName,

              gateCheckNumber,

              assignedAt:
                serverTimestamp(),

              assignedBy:
                actor,

              ...(createSeat
                ? {
                    source:
                      "LAST_MINUTE",
                  }
                : {}),
            },
            {
              merge:
                true,
            }
          );

          transaction.set(
            gateCheckRef,
            {
              gateCheckNumber,

              status:
                "ASSIGNED",

              source:
                gateCheckSource,

              assignmentId,

              passengerId,

              passengerName,

              assignedSeat:
                seatNumber,

              counterRecordedWeightLbs:
                counterWeightLbs,

              assignedAt:
                serverTimestamp(),

              assignedBy:
                actor,

              ...(createGateCheck
                ? {
                    addedAt:
                      serverTimestamp(),

                    addedBy:
                      actor,
                  }
                : {}),
            },
            {
              merge:
                true,
            }
          );

          transaction.set(
            assignmentRef,
            {
              passengerId,

              passengerName,

              passengerSource,

              assignedSeat:
                seatNumber,

              assignedSeatType:
                seatType ||
                null,

              gateCheckNumber,

              gateCheckSource,

              counterRecordedWeightLbs:
                counterWeightLbs,

              counterWeightRecordedAt:
                serverTimestamp(),

              counterWeightRecordedBy:
                actor,

              status:
                "COUNTER_ASSIGNED",

              counterAssignedAt:
                serverTimestamp(),

              counterAssignedBy:
                actor,

              createdAt:
                serverTimestamp(),

              createdBy:
                actor,

              updatedAt:
                serverTimestamp(),

              updatedBy:
                actor,
            }
          );

          const previousCount =
            Number(
              flightSnap
                .data()
                ?.assignmentCount ||
              0
            );

          transaction.set(
            flightRef,
            {
              status:
                "IN_PROGRESS",

              assignmentCount:
                previousCount +
                1,

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
        }
      );

      await setDoc(
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "events",
          `counter_${assignmentId}_${Date.now()}`
        ),
        {
          type:
            "COUNTER_ASSIGNED",

          status:
            "COUNTER_ASSIGNED",

          passengerId,

          passengerName,

          assignedSeat:
            seatNumber,

          gateCheckNumber,

          counterRecordedWeightLbs:
            counterWeightLbs,

          message:
            `Carry-On ${gateCheckNumber} assigned at Counter.`,

          createdAt:
            serverTimestamp(),

          createdBy:
            actor,
        }
      );
    };

  const beginAssignmentEdit = (item) => {
    if (cleanUpper(item?.status) !== "COUNTER_ASSIGNED") {
      setError("Only Carry-Ons still at Counter can be edited here.");
      return;
    }

    setEditingAssignmentId(item.id);
    setEditPassengerName(item.passengerName || "");
    setEditSeatId(item.assignedSeat ? safeDocId(item.assignedSeat) : "");
    setEditGateCheckId(item.id || "");
    setEditWeight(String(item.counterRecordedWeightLbs || ""));
    setMessage("");
    setError("");
  };

  const cancelAssignmentEdit = () => {
    setEditingAssignmentId("");
    setEditPassengerName("");
    setEditSeatId("");
    setEditGateCheckId("");
    setEditWeight("");
  };

  const saveAssignmentEdit = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateCounter || !selectedFlight || !assignment) return;

    const passengerName = String(editPassengerName || "").trim();
    const newWeight = Number(editWeight);
    const oldSeatId = safeDocId(assignment.assignedSeat || "");
    const oldGateCheckId = assignment.id;
    const newSeatId = editSeatId || oldSeatId;
    const newGateCheckId = editGateCheckId || oldGateCheckId;
    const newSeat = seats.find((item) => item.id === newSeatId) || null;
    const newGateCheck = gateChecks.find((item) => item.id === newGateCheckId) || null;

    if (!passengerName) {
      setError("Passenger Name is required.");
      return;
    }

    if (!Number.isFinite(newWeight) || newWeight <= 0) {
      setError("Enter a valid Carry-On weight in pounds.");
      return;
    }

    if (!newSeat || !newGateCheck) {
      setError("Select a valid Seat and Gate Check number.");
      return;
    }

    try {
      setSavingAssignmentEdit(true);

      const oldAssignmentRef = doc(
        db, "carryOnFlights", selectedFlight.id, "assignments", oldGateCheckId
      );
      const nextAssignmentRef = doc(
        db, "carryOnFlights", selectedFlight.id, "assignments", newGateCheckId
      );
      const passengerRef = doc(
        db, "carryOnFlights", selectedFlight.id, "passengers", assignment.passengerId
      );
      const oldSeatRef = doc(
        db, "carryOnFlights", selectedFlight.id, "availableSeats", oldSeatId
      );
      const nextSeatRef = doc(
        db, "carryOnFlights", selectedFlight.id, "availableSeats", newSeatId
      );
      const oldGateCheckRef = doc(
        db, "carryOnFlights", selectedFlight.id, "gateCheckNumbers", oldGateCheckId
      );
      const nextGateCheckRef = doc(
        db, "carryOnFlights", selectedFlight.id, "gateCheckNumbers", newGateCheckId
      );

      await runTransaction(db, async (transaction) => {
        const refs = [
          oldAssignmentRef,
          passengerRef,
          oldSeatRef,
          nextSeatRef,
          oldGateCheckRef,
          nextGateCheckRef,
        ];
        if (newGateCheckId !== oldGateCheckId) refs.push(nextAssignmentRef);

        const snaps = [];
        for (const ref of refs) snaps.push(await transaction.get(ref));

        const oldAssignmentSnap = snaps[0];
        if (!oldAssignmentSnap.exists()) {
          throw new Error("Carry-On assignment no longer exists.");
        }
        const currentData = oldAssignmentSnap.data();
        if (cleanUpper(currentData?.status) !== "COUNTER_ASSIGNED") {
          throw new Error("This Carry-On already moved beyond Counter and can no longer be edited here.");
        }

        const nextSeatSnap = snaps[3];
        if (
          newSeatId !== oldSeatId &&
          (!nextSeatSnap.exists() || cleanUpper(nextSeatSnap.data()?.status) !== "AVAILABLE")
        ) {
          throw new Error("The selected seat is no longer available.");
        }

        const nextGateSnap = snaps[5];
        if (
          newGateCheckId !== oldGateCheckId &&
          (!nextGateSnap.exists() || cleanUpper(nextGateSnap.data()?.status) !== "AVAILABLE")
        ) {
          throw new Error("The selected Gate Check number is no longer available.");
        }

        if (newGateCheckId !== oldGateCheckId) {
          const nextAssignmentSnap = snaps[6];
          if (nextAssignmentSnap?.exists()) {
            throw new Error("The selected Gate Check number already has an assignment.");
          }
        }

        const updatedAssignment = {
          ...currentData,
          passengerName,
          assignedSeat: newSeat.seatNumber,
          assignedSeatType: newSeat.seatType || null,
          gateCheckNumber: newGateCheck.gateCheckNumber,
          gateCheckSource: newGateCheck.source || currentData.gateCheckSource || "PRELOADED",
          counterRecordedWeightLbs: Math.round(newWeight * 10) / 10,
          editedAt: serverTimestamp(),
          editedBy: actor,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        };

        if (newSeatId !== oldSeatId) {
          transaction.set(oldSeatRef, {
            status: "AVAILABLE",
            assignmentId: null,
            passengerId: null,
            passengerName: null,
            gateCheckNumber: null,
            assignedAt: null,
            assignedBy: null,
          }, { merge: true });
        }

        transaction.set(nextSeatRef, {
          status: "ASSIGNED",
          assignmentId: newGateCheckId,
          passengerId: assignment.passengerId,
          passengerName,
          gateCheckNumber: newGateCheck.gateCheckNumber,
          assignedAt: currentData.counterAssignedAt || serverTimestamp(),
          assignedBy: currentData.counterAssignedBy || actor,
        }, { merge: true });

        if (newGateCheckId !== oldGateCheckId) {
          transaction.set(oldGateCheckRef, {
            status: "AVAILABLE",
            assignmentId: null,
            passengerId: null,
            passengerName: null,
            assignedSeat: null,
            counterRecordedWeightLbs: null,
            assignedAt: null,
            assignedBy: null,
          }, { merge: true });
        }

        transaction.set(nextGateCheckRef, {
          status: "ASSIGNED",
          assignmentId: newGateCheckId,
          passengerId: assignment.passengerId,
          passengerName,
          assignedSeat: newSeat.seatNumber,
          counterRecordedWeightLbs: Math.round(newWeight * 10) / 10,
          assignedAt: currentData.counterAssignedAt || serverTimestamp(),
          assignedBy: currentData.counterAssignedBy || actor,
        }, { merge: true });

        transaction.set(passengerRef, {
          passengerName,
          assigned: true,
          assignedSeat: newSeat.seatNumber,
          gateCheckNumber: newGateCheck.gateCheckNumber,
          assignmentId: newGateCheckId,
          updatedAt: serverTimestamp(),
        }, { merge: true });

        transaction.set(nextAssignmentRef, updatedAssignment, { merge: false });
        if (newGateCheckId !== oldGateCheckId) {
          transaction.delete(oldAssignmentRef);
        }
      });

      try {
        await setDoc(
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "events",
            `counter_edit_${newGateCheckId}_${Date.now()}`
          ),
          {
            type: "COUNTER_ASSIGNMENT_EDITED",
            status: "COUNTER_ASSIGNED",
            assignmentId: newGateCheckId,
            previousAssignmentId: oldGateCheckId,
            passengerId: assignment.passengerId,
            passengerName,
            previousPassengerName: assignment.passengerName || null,
            assignedSeat: newSeat.seatNumber,
            previousSeat: assignment.assignedSeat || null,
            gateCheckNumber: newGateCheck.gateCheckNumber,
            previousGateCheckNumber: assignment.gateCheckNumber || null,
            counterRecordedWeightLbs: Math.round(newWeight * 10) / 10,
            createdAt: serverTimestamp(),
            createdBy: actor,
          }
        );
      } catch (eventError) {
        console.error("Carry-On Counter edit event error:", eventError);
      }

      cancelAssignmentEdit();
      setMessage("Counter assignment updated successfully.");
    } catch (editError) {
      console.error("Carry-On Counter assignment edit error:", editError);
      setError(editError?.message || "Unable to update Counter assignment.");
    } finally {
      setSavingAssignmentEdit(false);
    }
  };

  const assignCarryOn =
    async () => {
      setMessage(
        ""
      );

      setError(
        ""
      );

      if (
        !canOperateCounter
      ) {
        setError(
          "You do not have permission to assign Carry-On Gate Checks."
        );

        return;
      }

      const parsedWeight =
        Number(
          carryOnWeight
        );

      if (
        !selectedFlight ||
        !selectedPassenger ||
        !selectedSeat ||
        !selectedGateCheck
      ) {
        setError(
          "Select Passenger, Assigned Seat and Gate Check Number."
        );

        return;
      }

      if (
        !Number.isFinite(
          parsedWeight
        ) ||
        parsedWeight <=
          0
      ) {
        setError(
          "Enter a valid Carry-On weight in pounds."
        );

        return;
      }

      try {
        setAssigning(
          true
        );

        await createAssignment({
          passengerId:
            selectedPassenger.id,

          passengerName:
            selectedPassenger
              .passengerName,

          passengerSource:
            selectedPassenger
              .source ||
            "LOAD_MANIFEST",

          seatId:
            selectedSeat.id,

          seatNumber:
            selectedSeat
              .seatNumber,

          seatType:
            selectedSeat
              .seatType ||
            null,

          gateCheckId:
            selectedGateCheck.id,

          gateCheckNumber:
            selectedGateCheck
              .gateCheckNumber,

          gateCheckSource:
            selectedGateCheck
              .source ||
            "PRELOADED",

          counterWeightLbs:
            Math.round(
              parsedWeight *
                10
            ) /
            10,
        });

        setMessage(
          `Assigned ${selectedGateCheck.gateCheckNumber} to ${selectedPassenger.passengerName}.`
        );

        setSelectedPassengerId(
          ""
        );

        setSelectedSeatId(
          ""
        );

        setSelectedGateCheckId(
          ""
        );

        setCarryOnWeight(
          ""
        );
      } catch (
        assignmentError
      ) {
        console.error(
          "Carry-On Counter assignment error:",
          assignmentError
        );

        setError(
          assignmentError?.message ||
          "Unable to create Carry-On assignment."
        );
      } finally {
        setAssigning(
          false
        );
      }
    };

  const addLastMinuteAssignment =
    async () => {
      setMessage(
        ""
      );

      setError(
        ""
      );

      if (
        !canOperateCounter
      ) {
        setError(
          "You do not have permission to add last-minute Carry-On assignments."
        );

        return;
      }

      if (
        !selectedFlight
      ) {
        setError(
          "Select a Carry-On flight first."
        );

        return;
      }

      const passengerName =
        String(
          lastMinuteName ||
          ""
        )
          .trim()
          .replace(
            /\s+/g,
            " "
          );

      const seatNumber =
        normalizeSeat(
          lastMinuteSeat
        );

      const gateCheckNumber =
        normalizeGateCheckNumber(
          lastMinuteGateCheck
        );

      const parsedWeight =
        Number(
          lastMinuteWeight
        );

      if (
        !passengerName ||
        !seatNumber ||
        !gateCheckNumber ||
        !Number.isFinite(
          parsedWeight
        ) ||
        parsedWeight <=
          0
      ) {
        setError(
          "Passenger Name, Assigned Seat, Gate Check Number and valid Carry-On Weight are required."
        );

        return;
      }

      try {
        setAddingLastMinute(
          true
        );

        const passengerId =
          safeDocId(
            `LAST_${Date.now()}`
          );

        const seatId =
          safeDocId(
            seatNumber
          );

        const gateCheckId =
          safeDocId(
            gateCheckNumber
          );

        const existingSeat =
          seats.find(
            (
              item
            ) =>
              normalizeSeat(
                item
                  ?.seatNumber
              ) ===
              seatNumber
          );

        const existingGateCheck =
          gateChecks.find(
            (
              item
            ) =>
              normalizeGateCheckNumber(
                item
                  ?.gateCheckNumber
              ) ===
              gateCheckNumber
          );

        await createAssignment({
          passengerId,

          passengerName,

          passengerSource:
            "LAST_MINUTE",

          seatId:
            existingSeat?.id ||
            seatId,

          seatNumber,

          seatType:
            existingSeat
              ?.seatType ||
            null,

          gateCheckId:
            existingGateCheck
              ?.id ||
            gateCheckId,

          gateCheckNumber,

          gateCheckSource:
            existingGateCheck
              ?.source ||
            "LAST_MINUTE",

          createPassenger:
            true,

          createSeat:
            !existingSeat,

          createGateCheck:
            !existingGateCheck,

          counterWeightLbs:
            Math.round(
              parsedWeight *
                10
            ) /
            10,
        });

        setMessage(
          `Last-minute Carry-On assigned to ${passengerName}.`
        );

        setLastMinuteName(
          ""
        );

        setLastMinuteSeat(
          ""
        );

        setLastMinuteGateCheck(
          ""
        );

        setLastMinuteWeight(
          ""
        );
      } catch (
        lastMinuteError
      ) {
        console.error(
          "Carry-On last-minute assignment error:",
          lastMinuteError
        );

        setError(
          lastMinuteError?.message ||
          "Unable to create last-minute Carry-On assignment."
        );
      } finally {
        setAddingLastMinute(
          false
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
            Counter Assignment
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
            Select a passenger, available seat and Gate Check number.
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
                "repeat(auto-fit, minmax(125px, 1fr))",

              gap:
                8,
            }}
          >
            <Metric
              label="Required"
              value={
                requiredCount
              }
            />

            <Metric
              label="Assigned"
              value={
                assignedCount
              }
            />

            <Metric
              label="Remaining"
              value={
                remainingCount
              }
            />

            <Metric
              label="Additional"
              value={
                additionalCount
              }
            />

            <Metric
              label="Passengers Available"
              value={
                availablePassengers.length
              }
            />

            <Metric
              label="Seats Available"
              value={
                availableSeats.length
              }
            />

            <Metric
              label="Gate Checks Available"
              value={
                availableGateChecks.length
              }
            />
          </div>

          {cleanUpper(
            selectedFlight.status
          ) ===
            "SETUP" && (
            <Notice
              tone="warning"
              text="This flight is still in SETUP. Complete and save the document setup before starting Counter assignments."
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
              Assign Carry-On
            </h4>

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(auto-fit, minmax(220px, 1fr))",

                gap:
                  10,

                marginTop:
                  10,
              }}
            >
              <SelectField
                label="Passenger"
                value={
                  selectedPassengerId
                }
                onChange={
                  setSelectedPassengerId
                }
              >
                <option value="">
                  Select passenger
                </option>

                {availablePassengers.map(
                  (
                    item
                  ) => (
                    <option
                      key={
                        item.id
                      }

                      value={
                        item.id
                      }
                    >
                      {item.passengerName}
                    </option>
                  )
                )}
              </SelectField>

              <SelectField
                label="Assigned Seat"
                value={
                  selectedSeatId
                }
                onChange={
                  setSelectedSeatId
                }
              >
                <option value="">
                  Select seat
                </option>

                {availableSeats.map(
                  (
                    item
                  ) => (
                    <option
                      key={
                        item.id
                      }

                      value={
                        item.id
                      }
                    >
                      {item.seatNumber}
                      {item.seatType
                        ? ` - ${item.seatType}`
                        : ""}
                    </option>
                  )
                )}
              </SelectField>

              <SelectField
                label="Gate Check Number"
                value={
                  selectedGateCheckId
                }
                onChange={
                  setSelectedGateCheckId
                }
              >
                <option value="">
                  Select Gate Check
                </option>

                {availableGateChecks.map(
                  (
                    item
                  ) => (
                    <option
                      key={
                        item.id
                      }

                      value={
                        item.id
                      }
                    >
                      {item.gateCheckNumber}
                    </option>
                  )
                )}
              </SelectField>

              <TextField
                label="Carry-On Weight (lb)"
                value={
                  carryOnWeight
                }
                onChange={
                  setCarryOnWeight
                }
                placeholder="Example: 22.5"
                type="number"
                inputMode="decimal"
              />
            </div>

            <button
              type="button"

              onClick={
                assignCarryOn
              }

              disabled={
                assigning ||
                !canOperateCounter ||
                cleanUpper(
                  selectedFlight.status
                ) ===
                  "SETUP"
              }

              style={{
                ...primaryButton,

                marginTop:
                  11,

                opacity:
                  assigning ||
                  !canOperateCounter ||
                  cleanUpper(
                    selectedFlight.status
                  ) ===
                    "SETUP"
                    ? 0.55
                    : 1,
              }}
            >
              {assigning
                ? "Assigning..."
                : "Confirm Carry-On Assignment"}
            </button>
          </div>

          <div
            style={{
              ...panelStyle,

              border:
                "1px solid #fde68a",

              background:
                "#fffbeb",
            }}
          >
            <h4
              style={{
                margin:
                  0,

                color:
                  "#92400e",
              }}
            >
              Last-Minute Assignment
            </h4>

            <p
              style={{
                margin:
                  "6px 0 0",

                color:
                  "#92400e",

                fontSize:
                  "0.8rem",
              }}
            >
              For passengers or Gate Check numbers not included in the original setup.
            </p>

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(auto-fit, minmax(200px, 1fr))",

                gap:
                  10,

                marginTop:
                  10,
              }}
            >
              <TextField
                label="Passenger Name"
                value={
                  lastMinuteName
                }
                onChange={
                  setLastMinuteName
                }
                placeholder="Example: ANA LOPEZ"
              />

              <TextField
                label="Assigned Seat"
                value={
                  lastMinuteSeat
                }
                onChange={
                  setLastMinuteSeat
                }
                placeholder="Example: 18F"
              />

              <TextField
                label="Gate Check Number"
                value={
                  lastMinuteGateCheck
                }
                onChange={
                  setLastMinuteGateCheck
                }
                placeholder="Example: GC823999"
              />

              <TextField
                label="Carry-On Weight (lb)"
                value={
                  lastMinuteWeight
                }
                onChange={
                  setLastMinuteWeight
                }
                placeholder="Example: 22.5"
                type="number"
                inputMode="decimal"
              />
            </div>

            <button
              type="button"

              onClick={
                addLastMinuteAssignment
              }

              disabled={
                addingLastMinute ||
                !canOperateCounter ||
                cleanUpper(
                  selectedFlight.status
                ) ===
                  "SETUP"
              }

              style={{
                ...primaryButton,

                marginTop:
                  11,

                background:
                  "#d97706",

                border:
                  "1px solid #d97706",

                opacity:
                  addingLastMinute ||
                  !canOperateCounter ||
                  cleanUpper(
                    selectedFlight.status
                  ) ===
                    "SETUP"
                    ? 0.55
                    : 1,
              }}
            >
              {addingLastMinute
                ? "Adding..."
                : "Add & Assign Last-Minute Carry-On"}
            </button>
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
                setAssignmentsExpanded(
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
                gap: 12,
                cursor: "pointer",
                textAlign: "left",
                font: "inherit",
              }}
            >
              <div>
                <div
                  style={{
                    color: "#0f172a",
                    fontSize: "0.92rem",
                    fontWeight: 900,
                  }}
                >
                  Assigned Gate Checks
                </div>

                <div
                  style={{
                    marginTop: 3,
                    color: "#64748b",
                    fontSize: "0.75rem",
                  }}
                >
                  {assignedCount} assigned
                  {assignedCount === 1 ? " item" : " items"}
                  {" - "}
                  Tap to {assignmentsExpanded ? "hide" : "view"} details
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flex: "0 0 auto",
                }}
              >
                <span
                  style={{
                    minWidth: 34,
                    height: 34,
                    padding: "0 8px",
                    borderRadius: 999,
                    background: "#ede9fe",
                    color: "#6d28d9",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                    fontSize: "0.8rem",
                  }}
                >
                  {assignedCount}
                </span>

                <span
                  aria-hidden="true"
                  style={{
                    color: "#64748b",
                    fontSize: "1rem",
                    fontWeight: 900,
                    transform: assignmentsExpanded
                      ? "rotate(180deg)"
                      : "rotate(0deg)",
                    transition: "transform 160ms ease",
                  }}
                >
                  v
                </span>
              </div>
            </button>

            {assignmentsExpanded && (
              <div
                style={{
                  padding: "0 12px 12px",
                  borderTop: "1px solid #f1f5f9",
                }}
              >
                <div
                  style={{
                    marginTop: 10,
                    padding: 8,
                    borderRadius: 12,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div
                    style={{
                      color: "#64748b",
                      fontSize: "0.68rem",
                      fontWeight: 800,
                      marginBottom: 5,
                    }}
                  >
                    QUICK FIND
                  </div>

                  <input
                    type="search"
                    value={assignmentSearch}
                    onChange={(event) =>
                      setAssignmentSearch(
                        event.target.value
                      )
                    }
                    placeholder="Seat or Gate Check number"
                    style={{
                      ...inputStyle,
                      border: "none",
                      boxShadow: "none",
                      padding: "9px 10px",
                    }}
                  />
                </div>

                {assignments.length === 0 ? (
                  <p
                    style={{
                      color: "#64748b",
                      fontSize: "0.82rem",
                      margin: "12px 2px 2px",
                    }}
                  >
                    No Carry-On assignments yet.
                  </p>
                ) : filteredAssignments.length === 0 ? (
                  <p
                    style={{
                      color: "#64748b",
                      fontSize: "0.82rem",
                      margin: "12px 2px 2px",
                    }}
                  >
                    No assignments match this search.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      marginTop: 10,
                    }}
                  >
                    {filteredAssignments
                      .slice()
                      .sort((a, b) =>
                        String(
                          a.passengerName || ""
                        ).localeCompare(
                          String(
                            b.passengerName || ""
                          )
                        )
                      )
                      .map((item) => (
                        <div
                          key={item.id}
                          style={{
                            padding: 11,
                            borderRadius: 12,
                            border: "1px solid #e2e8f0",
                            background: "#ffffff",
                            boxShadow:
                              "0 1px 2px rgba(15, 23, 42, 0.04)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              flexWrap: "wrap",
                              alignItems: "flex-start",
                            }}
                          >
                            <div
                              style={{
                                minWidth: 0,
                                flex: "1 1 180px",
                              }}
                            >
                              <strong
                                style={{
                                  display: "block",
                                  color: "#0f172a",
                                  fontSize: "0.9rem",
                                  overflowWrap: "anywhere",
                                }}
                              >
                                {item.passengerName || "-"}
                              </strong>

                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  flexWrap: "wrap",
                                  marginTop: 7,
                                }}
                              >
                                <MiniPill
                                  label="Seat"
                                  value={item.assignedSeat || "-"}
                                />
                                <MiniPill
                                  label="Weight"
                                  value={`${item.counterRecordedWeightLbs || "-"} lb`}
                                />
                                <MiniPill
                                  label="Status"
                                  value={
                                    item.status ||
                                    "COUNTER_ASSIGNED"
                                  }
                                />
                              </div>
                            </div>

                            <div
                              style={{
                                flex: "0 0 auto",
                                minWidth: 94,
                                textAlign: "right",
                              }}
                            >
                              <div
                                style={{
                                  color: "#64748b",
                                  fontSize: "0.64rem",
                                  fontWeight: 800,
                                }}
                              >
                                GATE CHECK
                              </div>

                              <div
                                style={{
                                  marginTop: 2,
                                  color: "#6d28d9",
                                  fontSize: "0.98rem",
                                  fontWeight: 900,
                                }}
                              >
                                {item.gateCheckNumber || "-"}
                              </div>
                            </div>
                          </div>

                          {item.passengerSource === "LAST_MINUTE" && (
                            <div
                              style={{
                                marginTop: 8,
                                display: "inline-flex",
                                padding: "4px 7px",
                                borderRadius: 999,
                                background: "#fffbeb",
                                border: "1px solid #fde68a",
                                color: "#92400e",
                                fontSize: "0.64rem",
                                fontWeight: 900,
                              }}
                            >
                              LAST MINUTE
                            </div>
                          )}

                          {cleanUpper(item.status) ===
                            "COUNTER_ASSIGNED" && (
                            <div style={{ marginTop: 10 }}>
                              {editingAssignmentId === item.id ? (
                                <div
                                  style={{
                                    display: "grid",
                                    gap: 8,
                                    padding: 10,
                                    borderRadius: 10,
                                    border: "1px solid #c4b5fd",
                                    background: "#faf5ff",
                                  }}
                                >
                                  <TextField
                                    label="Passenger Name"
                                    value={editPassengerName}
                                    onChange={setEditPassengerName}
                                    placeholder="Passenger Name"
                                  />

                                  <SelectField
                                    label="Assigned Seat"
                                    value={editSeatId}
                                    onChange={setEditSeatId}
                                  >
                                    {seats
                                      .filter((seat) =>
                                        seat.id ===
                                          safeDocId(
                                            item.assignedSeat || ""
                                          ) ||
                                        cleanUpper(
                                          seat.status
                                        ) === "AVAILABLE"
                                      )
                                      .sort((a, b) =>
                                        String(
                                          a.seatNumber || ""
                                        ).localeCompare(
                                          String(
                                            b.seatNumber || ""
                                          )
                                        )
                                      )
                                      .map((seat) => (
                                        <option
                                          key={seat.id}
                                          value={seat.id}
                                        >
                                          {seat.seatNumber}
                                        </option>
                                      ))}
                                  </SelectField>

                                  <SelectField
                                    label="Gate Check Number"
                                    value={editGateCheckId}
                                    onChange={setEditGateCheckId}
                                  >
                                    {gateChecks
                                      .filter((gateCheck) =>
                                        gateCheck.id === item.id ||
                                        cleanUpper(
                                          gateCheck.status
                                        ) === "AVAILABLE"
                                      )
                                      .sort((a, b) =>
                                        String(
                                          a.gateCheckNumber || ""
                                        ).localeCompare(
                                          String(
                                            b.gateCheckNumber || ""
                                          )
                                        )
                                      )
                                      .map((gateCheck) => (
                                        <option
                                          key={gateCheck.id}
                                          value={gateCheck.id}
                                        >
                                          {gateCheck.gateCheckNumber}
                                        </option>
                                      ))}
                                  </SelectField>

                                  <TextField
                                    label="Carry-On Weight (lb)"
                                    value={editWeight}
                                    onChange={setEditWeight}
                                    placeholder="Example: 22.5"
                                    type="number"
                                    inputMode="decimal"
                                  />

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
                                        saveAssignmentEdit(item)
                                      }
                                      disabled={savingAssignmentEdit}
                                      style={{
                                        ...primaryButton,
                                        opacity:
                                          savingAssignmentEdit
                                            ? 0.55
                                            : 1,
                                      }}
                                    >
                                      {savingAssignmentEdit
                                        ? "Saving..."
                                        : "Save Changes"}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={cancelAssignmentEdit}
                                      disabled={savingAssignmentEdit}
                                      style={secondaryButton}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    beginAssignmentEdit(item)
                                  }
                                  style={{
                                    ...secondaryButton,
                                    width: "100%",
                                  }}
                                >
                                  Edit Assignment
                                </button>
                              )}
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
          text="Select a Carry-On flight to begin Counter assignments."
        />
      )}
    </div>
  );
}

function MiniPill({
  label,
  value,
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 7px",
        borderRadius: 999,
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        color: "#475569",
        fontSize: "0.67rem",
        fontWeight: 800,
        maxWidth: "100%",
      }}
    >
      <span
        style={{
          color: "#94a3b8",
        }}
      >
        {label}:
      </span>
      <span
        style={{
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </span>
    </span>
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

function SelectField({
  label,
  value,
  onChange,
  children,
}) {
  return (
    <label
      style={{
        display:
          "grid",

        gap:
          5,
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
        {label}
      </span>

      <select
        value={
          value
        }

        onChange={(
          event
        ) =>
          onChange(
            event.target
              .value
          )
        }

        style={
          inputStyle
        }
      >
        {children}
      </select>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
}) {
  return (
    <label
      style={{
        display:
          "grid",

        gap:
          5,
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
        {label}
      </span>

      <input
        type={
          type
        }

        inputMode={
          inputMode
        }

        value={
          value
        }

        placeholder={
          placeholder
        }

        onChange={(
          event
        ) =>
          onChange(
            event.target
              .value
          )
        }

        style={
          inputStyle
        }
      />
    </label>
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

const secondaryButton = {
  padding: "9px 13px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "white",
  color: "#334155",
  fontWeight: 900,
  cursor: "pointer",
};

const primaryButton = {
  padding:
    "10px 14px",

  borderRadius:
    10,

  border:
    "1px solid #7c3aed",

  background:
    "#7c3aed",

  color:
    "white",

  fontWeight:
    900,

  cursor:
    "pointer",
};

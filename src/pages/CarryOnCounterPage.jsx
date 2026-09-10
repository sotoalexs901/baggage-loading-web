// src/pages/carryOn/CarryOnCounterPage.jsx

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "../../firebase";

import {
  cleanUpper,
  getActor,
  normalizeGateCheckNumber,
  normalizeRole,
  normalizeSeat,
  safeDocId,
} from "./carryOnUtils.js";

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
    operationalContext
      ?.operationalPosition ===
      "COUNTER_SCAN";

  const [
    flights,
    setFlights,
  ] = useState(
    []
  );

  const [
    selectedFlight,
    setSelectedFlight,
  ] = useState(
    null
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

  /* =========================
     FLIGHT LIST
  ========================= */

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
            "Carry-On Counter flights snapshot error:",
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
    const next =
      flights.find(
        (
          item
        ) =>
          item.id ===
          selectedCarryOnFlightId
      ) ||
      null;

    setSelectedFlight(
      next
    );
  }, [
    flights,
    selectedCarryOnFlightId,
  ]);

  /* =========================
     SUBSCRIPTIONS
  ========================= */

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
        errorLabel
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

              setter(
                rows
              );
            },

            (
              snapshotError
            ) => {
              console.error(
                errorLabel,
                snapshotError
              );

              setError(
                errorLabel
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
      "Unable to load Carry-On available seats."
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
            // Ignore unsubscribe cleanup errors.
          }
        }
      );
    };
  }, [
    selectedCarryOnFlightId,
  ]);

  /* =========================
     DERIVED DATA
  ========================= */

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

  /* =========================
     ASSIGNMENT
  ========================= */

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

      const assignmentId =
        safeDocId(
          selectedGateCheck
            .gateCheckNumber
        );

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
          selectedPassenger.id
        );

      const seatRef =
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "availableSeats",
          selectedSeat.id
        );

      const gateCheckRef =
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "gateCheckNumbers",
          selectedGateCheck.id
        );

      const assignmentRef =
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "assignments",
          assignmentId
        );

      try {
        setAssigning(
          true
        );

        await runTransaction(
          db,
          async (
            transaction
          ) => {
            const [
              passengerSnap,
              seatSnap,
              gateCheckSnap,
              assignmentSnap,
              flightSnap,
            ] =
              await Promise.all([
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

                transaction.get(
                  flightRef
                ),
              ]);

            if (
              !passengerSnap.exists()
            ) {
              throw new Error(
                "Passenger no longer exists."
              );
            }

            if (
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
              !seatSnap.exists() ||
              cleanUpper(
                seatSnap
                  .data()
                  ?.status
              ) !==
                "AVAILABLE"
            ) {
              throw new Error(
                "This seat is no longer available."
              );
            }

            if (
              !gateCheckSnap.exists() ||
              cleanUpper(
                gateCheckSnap
                  .data()
                  ?.status
              ) !==
                "AVAILABLE"
            ) {
              throw new Error(
                "This Gate Check number is no longer available."
              );
            }

            if (
              assignmentSnap.exists()
            ) {
              throw new Error(
                "This Gate Check number already has an assignment."
              );
            }

            const assignmentData = {
              passengerId:
                selectedPassenger.id,

              passengerName:
                selectedPassenger
                  .passengerName,

              passengerSource:
                selectedPassenger
                  .source ||
                "LOAD_MANIFEST",

              originalSeat:
                selectedPassenger
                  .originalSeat ||
                null,

              assignedSeat:
                selectedSeat
                  .seatNumber,

              assignedSeatType:
                selectedSeat
                  .seatType ||
                null,

              gateCheckNumber:
                selectedGateCheck
                  .gateCheckNumber,

              gateCheckSource:
                selectedGateCheck
                  .source ||
                "PRELOADED",

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
            };

            transaction.set(
              assignmentRef,
              assignmentData
            );

            transaction.set(
              passengerRef,
              {
                assigned:
                  true,

                assignmentId,

                assignedSeat:
                  selectedSeat
                    .seatNumber,

                gateCheckNumber:
                  selectedGateCheck
                    .gateCheckNumber,

                updatedAt:
                  serverTimestamp(),
              },
              {
                merge:
                  true,
              }
            );

            transaction.set(
              seatRef,
              {
                status:
                  "ASSIGNED",

                assignmentId,

                passengerId:
                  selectedPassenger.id,

                passengerName:
                  selectedPassenger
                    .passengerName,

                gateCheckNumber:
                  selectedGateCheck
                    .gateCheckNumber,

                assignedAt:
                  serverTimestamp(),

                assignedBy:
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
                  "ASSIGNED",

                assignmentId,

                passengerId:
                  selectedPassenger.id,

                passengerName:
                  selectedPassenger
                    .passengerName,

                assignedSeat:
                  selectedSeat
                    .seatNumber,

                assignedAt:
                  serverTimestamp(),

                assignedBy:
                  actor,
              },
              {
                merge:
                  true,
              }
            );

            transaction.set(
              flightRef,
              {
                status:
                  "IN_PROGRESS",

                assignmentCount:
                  (
                    Number(
                      flightSnap
                        .data()
                        ?.assignmentCount ||
                      0
                    ) +
                    1
                  ),

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

            passengerId:
              selectedPassenger.id,

            passengerName:
              selectedPassenger
                .passengerName,

            assignedSeat:
              selectedSeat
                .seatNumber,

            gateCheckNumber:
              selectedGateCheck
                .gateCheckNumber,

            message:
              `Carry-On ${selectedGateCheck.gateCheckNumber} assigned at Counter.`,

            createdAt:
              serverTimestamp(),

            createdBy:
              actor,
          }
        );

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
      } catch (
        assignError
      ) {
        console.error(
          "Carry-On Counter assignment error:",
          assignError
        );

        setError(
          assignError?.message ||
          "Unable to create Carry-On assignment."
        );
      } finally {
        setAssigning(
          false
        );
      }
    };

  /* =========================
     LAST MINUTE
  ========================= */

  const addLastMinute =
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
          "You do not have permission to add last-minute Carry-On data."
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

      if (
        !passengerName
      ) {
        setError(
          "Passenger Name is required."
        );

        return;
      }

      if (
        !seatNumber
      ) {
        setError(
          "Assigned Seat is required."
        );

        return;
      }

      if (
        !gateCheckNumber
      ) {
        setError(
          "Gate Check Number is required."
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

        const gateCheckId =
          safeDocId(
            gateCheckNumber
          );

        const assignmentId =
          gateCheckId;

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
            safeDocId(
              seatNumber
            )
          );

        const gateCheckRef =
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "gateCheckNumbers",
            gateCheckId
          );

        const assignmentRef =
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "assignments",
            assignmentId
          );

        const flightRef =
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id
          );

        await runTransaction(
          db,
          async (
            transaction
          ) => {
            const [
              seatSnap,
              gateCheckSnap,
              assignmentSnap,
              flightSnap,
            ] =
              await Promise.all([
                transaction.get(
                  seatRef
                ),

                transaction.get(
                  gateCheckRef
                ),

                transaction.get(
                  assignmentRef
                ),

                transaction.get(
                  flightRef
                ),
              ]);

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
              assignmentSnap.exists()
            ) {
              throw new Error(
                "This Gate Check number already has an assignment."
              );
            }

            transaction.set(
              passengerRef,
              {
                passengerName,

                source:
                  "LAST_MINUTE",

                assigned:
                  true,

                assignedSeat:
                  seatNumber,

                gateCheckNumber,

                assignmentId,

                createdAt:
                  serverTimestamp(),

                createdBy:
                  actor,

                updatedAt:
                  serverTimestamp(),
              }
            );

            transaction.set(
              seatRef,
              {
                seatNumber,

                seatType:
                  seatSnap.exists()
                    ? seatSnap
                        .data()
                        ?.seatType ||
                      null
                    : null,

                blocked:
                  false,

                status:
                  "ASSIGNED",

                source:
                  seatSnap.exists()
                    ? seatSnap
                        .data()
                        ?.source ||
                      "EMPTY_SEATS_REPORT"
                    : "LAST_MINUTE",

                assignmentId,

                passengerId,

                passengerName,

                gateCheckNumber,

                assignedAt:
                  serverTimestamp(),

                assignedBy:
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
                gateCheckNumber,

                status:
                  "ASSIGNED",

                source:
                  gateCheckSnap.exists()
                    ? gateCheckSnap
                        .data()
                        ?.source ||
                      "PRELOADED"
                    : "LAST_MINUTE",

                assignmentId,

                passengerId,

                passengerName,

                assignedSeat:
                  seatNumber,

                addedAt:
                  gateCheckSnap.exists()
                    ? gateCheckSnap
                        .data()
                        ?.addedAt ||
                      serverTimestamp()
                    : serverTimestamp(),

                addedBy:
                  gateCheckSnap.exists()
                    ? gateCheckSnap
                        .data()
                        ?.addedBy ||
                      actor
                    : actor,

                assignedAt:
                  serverTimestamp(),

                assignedBy:
                  actor,
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

                passengerSource:
                  "LAST_MINUTE",

                originalSeat:
                  null,

                assignedSeat:
                  seatNumber,

                assignedSeatType:
                  seatSnap.exists()
                    ? seatSnap
                        .data()
                        ?.seatType ||
                      null
                    : null,

                gateCheckNumber,

                gateCheckSource:
                  gateCheckSnap.exists()
                    ? gateCheckSnap
                        .data()
                        ?.source ||
                      "PRELOADED"
                    : "LAST_MINUTE",

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

            transaction.set(
              flightRef,
              {
                status:
                  "IN_PROGRESS",

                assignmentCount:
                  (
                    Number(
                      flightSnap
                        .data()
                        ?.assignmentCount ||
                      0
                    ) +
                    1
                  ),

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

            source:
              "LAST_MINUTE",

            message:
              `Last-minute Carry-On ${gateCheckNumber} assigned at Counter.`,

            createdAt:
              serverTimestamp(),

            createdBy:
              actor,
          }
        );

        setMessage(
          `Last-minute assignment created for ${passengerName}.`
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
      } catch (
        lastMinuteError
      ) {
        console.error(
          "Carry-On last-minute assignment error:",
          lastMinuteError
        );

        setError(
          lastMinuteError?.message ||
          "Unable to create last-minute assignment."
        );
      } finally {
        setAddingLastMinute(
          false
        );
      }
    };

  return (
    <section
      style={{
        background:
          "white",

        border:
          "1px solid #e5e7eb",

        borderRadius:
          14,

        padding:
          16,
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
            "flex-start",
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
            Assign Passenger + Seat + Gate Check Number.
          </p>
        </div>

        <select
          value={
            selectedCarryOnFlightId ||
            ""
          }

          onChange={(
            event
          ) => {
            const value =
              event.target
                .value;

            if (
              typeof onSelectCarryOnFlight ===
              "function"
            ) {
              onSelectCarryOnFlight(
                value ||
                null
              );
            }
          }}

          style={{
            minWidth:
              230,

            padding:
              "9px 10px",

            borderRadius:
              10,

            border:
              "1px solid #cbd5e1",

            background:
              "white",

            fontWeight:
              800,
          }}
        >
          <option value="">
            Select Carry-On Flight
          </option>

          {flights.map(
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
                {item.flightNumber} - {item.flightDate}
              </option>
            )
          )}
        </select>
      </div>

      {selectedFlight ? (
        <>
          <div
            style={{
              marginTop:
                14,

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
              {" \u2192 "}
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
                "repeat(auto-fit, minmax(130px, 1fr))",

              gap:
                8,

              marginTop:
                12,
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
              label="Pax Available"
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

          <div
            style={{
              marginTop:
                14,

              padding:
                13,

              border:
                "1px solid #e2e8f0",

              borderRadius:
                12,

              background:
                "#f8fafc",
            }}
          >
            <h4
              style={{
                margin:
                  0,
              }}
            >
              Assign from Load Manifest
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
                  Select available seat
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
            </div>

            <button
              type="button"

              onClick={
                assignCarryOn
              }

              disabled={
                assigning ||
                !canOperateCounter
              }

              style={{
                ...primaryButton,

                marginTop:
                  11,

                opacity:
                  assigning ||
                  !canOperateCounter
                    ? 0.6
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
              marginTop:
                14,

              padding:
                13,

              border:
                "1px solid #fde68a",

              borderRadius:
                12,

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
              Last-Minute Passenger / Gate Check
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
              Use this when a passenger or Gate Check Number was not included in the original setup.
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
            </div>

            <button
              type="button"

              onClick={
                addLastMinute
              }

              disabled={
                addingLastMinute ||
                !canOperateCounter
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
                  !canOperateCounter
                    ? 0.6
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
              marginTop:
                14,
            }}
          >
            <h4
              style={{
                margin:
                  0,
              }}
            >
              Current Assignments
            </h4>

            {assignments.length ===
            0 ? (
              <p
                style={{
                  color:
                    "#64748b",

                  fontSize:
                    "0.82rem",
                }}
              >
                No Carry-On assignments yet.
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
                {assignments
                  .slice()
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
                  )
                  .map(
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
                            "1px solid #e2e8f0",

                          background:
                            "white",
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
                          Status: {item.status || "COUNTER_ASSIGNED"}
                          {item.passengerSource ===
                          "LAST_MINUTE"
                            ? " - LAST MINUTE"
                            : ""}
                        </div>
                      </div>
                    )
                  )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div
          style={{
            marginTop:
              14,

            padding:
              14,

            borderRadius:
              10,

            border:
              "1px dashed #cbd5e1",

            background:
              "#f8fafc",

            color:
              "#64748b",
          }}
        >
          Select a Carry-On flight to begin Counter assignments.
        </div>
      )}

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
    </section>
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
        type="text"

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

  return (
    <div
      style={{
        marginTop:
          12,

        padding:
          10,

        borderRadius:
          10,

        background:
          success
            ? "#f0fdf4"
            : "#fef2f2",

        border:
          success
            ? "1px solid #bbf7d0"
            : "1px solid #fecaca",

        color:
          success
            ? "#166534"
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

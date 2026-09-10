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

function getTodayYYYYMMDD() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(
    now.getMonth() + 1
  ).padStart(
    2,
    "0"
  );

  const day = String(
    now.getDate()
  ).padStart(
    2,
    "0"
  );

  return `${year}-${month}-${day}`;
}

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


const CARRY_ON_COLORS = [
  { name: "Black", code: "BLK", swatch: "#111827" },
  { name: "Blue", code: "BLU", swatch: "#2563eb" },
  { name: "Silver", code: "SLV", swatch: "#cbd5e1" },
  { name: "Gray", code: "GRY", swatch: "#6b7280" },
  { name: "Red", code: "RED", swatch: "#dc2626" },
  { name: "Green", code: "GRN", swatch: "#16a34a" },
  { name: "Purple", code: "PUR", swatch: "#7e22ce" },
  { name: "Rose Gold", code: "RGD", swatch: "#e8a49b" },
  { name: "White", code: "WHT", swatch: "#f8fafc" },
  { name: "Tan", code: "TAN", swatch: "#c9a77c" },
  { name: "Orange", code: "ORG", swatch: "#f97316" },
  { name: "Yellow", code: "YLW", swatch: "#eab308" },
  { name: "Multi Color", code: "MUL", swatch: "linear-gradient(135deg,#ef4444 0 20%,#f59e0b 20% 40%,#22c55e 40% 60%,#3b82f6 60% 80%,#a855f7 80%)" },
];

const CARRY_ON_GROUPS = [
  { size: "22", type: "Hard Case", typeCode: "HC" },
  { size: "24", type: "Hard Case", typeCode: "HC" },
  { size: "22", type: "Soft Case", typeCode: "SC" },
  { size: "24", type: "Soft Case", typeCode: "SC" },
];

const SPECIAL_CARRY_ON_ITEMS = [
  { description: "Walker", code: "WALKER", type: "Walker", icon: "WALKER" },
  { description: "Stroller", code: "STROLLER", type: "Stroller", icon: "STROLLER" },
  { description: "WCHR", code: "WCHR", type: "WCHR", icon: "WCHR" },
  { description: "Musical Instrument", code: "MUSICAL_INSTRUMENT", type: "Musical Instrument", icon: "MUSICAL_INSTRUMENT" },
  { description: "Car Seat", code: "CAR_SEAT", type: "Car Seat", icon: "CAR_SEAT" },
  { description: "Booster Seat", code: "BOOSTER_SEAT", type: "Booster Seat", icon: "BOOSTER_SEAT" },
  { description: "Gift Item", code: "GIFT_ITEM", type: "Gift Item", icon: "GIFT_ITEM" },
];

function makeCarryOnSelection({ color, size, type, typeCode }) {
  return {
    color: color.name,
    colorCode: color.code,
    size,
    type,
    code: `${color.code}-${size}-${typeCode}`,
    description: `${color.name} ${size} ${type}`,
  };
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
  const today =
    useMemo(
      () =>
        getTodayYYYYMMDD(),
      []
    );

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
    carryOnSelection,
    setCarryOnSelection,
  ] = useState(
    null
  );

  const [
    visualSelectorTarget,
    setVisualSelectorTarget,
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
    lastMinuteCarryOnSelection,
    setLastMinuteCarryOnSelection,
  ] = useState(
    null
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
    editCarryOnSelection,
    setEditCarryOnSelection,
  ] = useState(
    null
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
            snap.docs
              .map(
                (
                  item
                ) => ({
                  id:
                    item.id,

                  ...item.data(),
                })
              )
              .filter(
                (
                  item
                ) =>
                  String(
                    item.flightDate ||
                    ""
                  ) ===
                  today &&
                  item?.isDeleted !==
                    true
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
  }, [
    today,
  ]);

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

  useEffect(() => {
    const selectedIsToday =
      flights.some(
        (
          flight
        ) =>
          flight.id ===
          selectedCarryOnFlightId
      );

    if (selectedIsToday) {
      return;
    }

    if (flights.length === 1) {
      onSelectCarryOnFlight?.(
        flights[0].id
      );
      return;
    }

    if (selectedCarryOnFlightId) {
      onSelectCarryOnFlight?.(
        null
      );
    }
  }, [
    flights,
    selectedCarryOnFlightId,
    onSelectCarryOnFlight,
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
      carryOnDescription,
      carryOnColor,
      carryOnColorCode,
      carryOnSize,
      carryOnType,
      carryOnCode,
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

              carryOnDescription:
                carryOnDescription ||
                null,

              carryOnColor:
                carryOnColor ||
                null,

              carryOnColorCode:
                carryOnColorCode ||
                null,

              carryOnSize:
                carryOnSize ||
                null,

              carryOnType:
                carryOnType ||
                null,

              carryOnCode:
                carryOnCode ||
                null,

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

              carryOnDescription:
                carryOnDescription ||
                null,

              carryOnColor:
                carryOnColor ||
                null,

              carryOnColorCode:
                carryOnColorCode ||
                null,

              carryOnSize:
                carryOnSize ||
                null,

              carryOnType:
                carryOnType ||
                null,

              carryOnCode:
                carryOnCode ||
                null,

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

          carryOnDescription:
            carryOnDescription ||
            null,

          carryOnColor:
            carryOnColor ||
            null,

          carryOnSize:
            carryOnSize ||
            null,

          carryOnType:
            carryOnType ||
            null,

          carryOnCode:
            carryOnCode ||
            null,

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
    setEditCarryOnSelection(
      item.carryOnCode
        ? {
            description: item.carryOnDescription || "",
            color: item.carryOnColor || null,
            colorCode: item.carryOnColorCode || null,
            size: item.carryOnSize || null,
            type: item.carryOnType || null,
            code: item.carryOnCode || null,
          }
        : null
    );
    setMessage("");
    setError("");
  };

  const cancelAssignmentEdit = () => {
    setEditingAssignmentId("");
    setEditPassengerName("");
    setEditSeatId("");
    setEditGateCheckId("");
    setEditWeight("");
    setEditCarryOnSelection(null);
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

    if (!editCarryOnSelection?.code) {
      setError("Select the Gate Check description before saving changes.");
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
          carryOnDescription: editCarryOnSelection.description,
          carryOnColor: editCarryOnSelection.color || null,
          carryOnColorCode: editCarryOnSelection.colorCode || null,
          carryOnSize: editCarryOnSelection.size || null,
          carryOnType: editCarryOnSelection.type || null,
          carryOnCode: editCarryOnSelection.code,
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
          carryOnDescription: editCarryOnSelection.description,
          carryOnColor: editCarryOnSelection.color || null,
          carryOnColorCode: editCarryOnSelection.colorCode || null,
          carryOnSize: editCarryOnSelection.size || null,
          carryOnType: editCarryOnSelection.type || null,
          carryOnCode: editCarryOnSelection.code,
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
            carryOnDescription: editCarryOnSelection.description,
            carryOnColor: editCarryOnSelection.color || null,
            carryOnSize: editCarryOnSelection.size || null,
            carryOnType: editCarryOnSelection.type || null,
            carryOnCode: editCarryOnSelection.code,
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

      if (
        !carryOnSelection?.code
      ) {
        setError(
          "Select the Gate Check description."
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

          carryOnDescription:
            carryOnSelection.description,

          carryOnColor:
            carryOnSelection.color ||
            null,

          carryOnColorCode:
            carryOnSelection.colorCode ||
            null,

          carryOnSize:
            carryOnSelection.size ||
            null,

          carryOnType:
            carryOnSelection.type ||
            null,

          carryOnCode:
            carryOnSelection.code,
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

        setCarryOnSelection(
          null
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

      if (
        !lastMinuteCarryOnSelection?.code
      ) {
        setError(
          "Select the Gate Check description."
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

          carryOnDescription:
            lastMinuteCarryOnSelection.description,

          carryOnColor:
            lastMinuteCarryOnSelection.color ||
            null,

          carryOnColorCode:
            lastMinuteCarryOnSelection.colorCode ||
            null,

          carryOnSize:
            lastMinuteCarryOnSelection.size ||
            null,

          carryOnType:
            lastMinuteCarryOnSelection.type ||
            null,

          carryOnCode:
            lastMinuteCarryOnSelection.code,
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

        setLastMinuteCarryOnSelection(
          null
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
            Today's Carry-On Flight
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
              Select today's flight
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

              <CarryOnDescriptionField
                label="Gate Check Description"
                selection={carryOnSelection}
                onClick={() =>
                  setVisualSelectorTarget(
                    "NORMAL"
                  )
                }
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

              <CarryOnDescriptionField
                label="Gate Check Description"
                selection={lastMinuteCarryOnSelection}
                onClick={() =>
                  setVisualSelectorTarget(
                    "LAST_MINUTE"
                  )
                }
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
                                  label="Carry-On"
                                  value={
                                    item.carryOnDescription ||
                                    "Not classified"
                                  }
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

                                  <CarryOnDescriptionField
                                    label="Gate Check Description"
                                    selection={editCarryOnSelection}
                                    onClick={() =>
                                      setVisualSelectorTarget(
                                        "EDIT"
                                      )
                                    }
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

          {visualSelectorTarget && (
            <CarryOnVisualSelector
              currentSelection={
                visualSelectorTarget === "NORMAL"
                  ? carryOnSelection
                  : visualSelectorTarget === "LAST_MINUTE"
                    ? lastMinuteCarryOnSelection
                    : editCarryOnSelection
              }
              onClose={() =>
                setVisualSelectorTarget(
                  ""
                )
              }
              onSelect={(selection) => {
                if (
                  visualSelectorTarget ===
                  "NORMAL"
                ) {
                  setCarryOnSelection(
                    selection
                  );
                } else if (
                  visualSelectorTarget ===
                  "LAST_MINUTE"
                ) {
                  setLastMinuteCarryOnSelection(
                    selection
                  );
                } else {
                  setEditCarryOnSelection(
                    selection
                  );
                }

                setVisualSelectorTarget(
                  ""
                );
              }}
            />
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
        </>
      ) : (
        <Notice
          tone="warning"
          text={`No Carry-On flight is selected for today (${today}).`}
        />
      )}
    </div>
  );
}


function CarryOnDescriptionField({
  label,
  selection,
  onClick,
}) {
  return (
    <label
      style={{
        display: "grid",
        gap: 5,
      }}
    >
      <span
        style={{
          color: "#475569",
          fontSize: "0.75rem",
          fontWeight: 800,
        }}
      >
        {label}
      </span>

      <button
        type="button"
        onClick={onClick}
        style={{
          minHeight: 44,
          width: "100%",
          boxSizing: "border-box",
          padding: "9px 11px",
          borderRadius: 10,
          border: selection
            ? "1px solid #7c3aed"
            : "1px dashed #94a3b8",
          background: selection
            ? "#faf5ff"
            : "white",
          color: selection
            ? "#5b21b6"
            : "#64748b",
          fontWeight: 900,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {selection?.description ||
          "Tap to select Gate Check description"}
        {selection?.code
          ? ` (${selection.code})`
          : ""}
      </button>
    </label>
  );
}

function CarryOnVisualSelector({
  currentSelection,
  onClose,
  onSelect,
}) {
  const [pending, setPending] = useState(
    currentSelection || null
  );

  const selectBag = (group, color) => {
    setPending(
      makeCarryOnSelection({
        color,
        size: group.size,
        type: group.type,
        typeCode: group.typeCode,
      })
    );
  };

  const selectSpecial = (item) => {
    setPending({
      description: item.description,
      color: null,
      colorCode: null,
      size: null,
      type: item.type,
      code: item.code,
    });
  };

  return (
    <div
      style={carryOnModalOverlay}
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div style={carryOnModalCard}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                color: "#0f172a",
              }}
            >
              Select Gate Check Item
            </h3>
            <div
              style={{
                marginTop: 4,
                color: "#64748b",
                fontSize: "0.78rem",
              }}
            >
              Tap the item that best matches the passenger's Gate Check item.
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={carryOnModalClose}
          >
            X
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gap: 12,
            marginTop: 12,
          }}
        >
          {CARRY_ON_GROUPS.map((group) => (
            <div
              key={`${group.size}-${group.typeCode}`}
              style={carryOnGroupCard}
            >
              <div
                style={{
                  color: "#1e3a8a",
                  fontWeight: 900,
                  fontSize: "0.82rem",
                  marginBottom: 8,
                }}
              >
                {group.size}&quot; {group.type}
              </div>

              <div style={carryOnChoiceGrid}>
                {CARRY_ON_COLORS.filter((color) => {
                  if (
                    group.typeCode === "HC" &&
                    color.name === "Gray"
                  ) {
                    return false;
                  }

                  if (
                    group.typeCode === "SC" &&
                    color.name === "Silver"
                  ) {
                    return false;
                  }

                  return true;
                }).map((color) => {
                  const candidate =
                    makeCarryOnSelection({
                      color,
                      size: group.size,
                      type: group.type,
                      typeCode: group.typeCode,
                    });

                  const active =
                    pending?.code ===
                    candidate.code;

                  return (
                    <button
                      key={candidate.code}
                      type="button"
                      onClick={() =>
                        selectBag(group, color)
                      }
                      style={{
                        ...carryOnChoiceButton,
                        border: active
                          ? "2px solid #2563eb"
                          : "1px solid #dbeafe",
                        background: active
                          ? "#eff6ff"
                          : "white",
                      }}
                    >
                      <CarryOnSuitcaseIcon
                        swatch={color.swatch}
                        soft={
                          group.typeCode ===
                          "SC"
                        }
                      />

                      <span
                        style={{
                          marginTop: 5,
                          color: "#0f172a",
                          fontSize: "0.68rem",
                          fontWeight: 900,
                          lineHeight: 1.15,
                        }}
                      >
                        {color.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={carryOnGroupCard}>
            <div
              style={{
                color: "#1e3a8a",
                fontWeight: 900,
                fontSize: "0.82rem",
                marginBottom: 8,
              }}
            >
              Special Items
            </div>

            <div style={carryOnSpecialGrid}>
              {SPECIAL_CARRY_ON_ITEMS.map((item) => {
                const active =
                  pending?.code ===
                  item.code;

                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() =>
                      selectSpecial(item)
                    }
                    style={{
                      ...carryOnSpecialButton,
                      border: active
                        ? "2px solid #2563eb"
                        : "1px solid #dbeafe",
                      background: active
                        ? "#eff6ff"
                        : "white",
                    }}
                  >
                    <SpecialCarryOnIcon
                      kind={item.icon}
                    />
                    <span
                      style={{
                        marginTop: 6,
                        fontWeight: 900,
                        color: "#0f172a",
                      }}
                    >
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 12,
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
          }}
        >
          <div
            style={{
              color: "#1e3a8a",
              fontSize: "0.68rem",
              fontWeight: 900,
            }}
          >
            SELECTED ITEM
          </div>

          <div
            style={{
              marginTop: 4,
              color: "#0f172a",
              fontWeight: 900,
            }}
          >
            {pending?.description ||
              "No item selected"}
          </div>

          {pending?.code && (
            <div
              style={{
                marginTop: 3,
                color: "#64748b",
                fontSize: "0.72rem",
              }}
            >
              Code: {pending.code}
            </div>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={secondaryButton}
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!pending?.code}
            onClick={() =>
              pending && onSelect(pending)
            }
            style={{
              ...primaryButton,
              opacity: pending?.code
                ? 1
                : 0.5,
            }}
          >
            Confirm Selection
          </button>
        </div>
      </div>
    </div>
  );
}

function CarryOnSuitcaseIcon({
  swatch,
  soft,
}) {
  const isGradient =
    String(swatch).includes(
      "gradient"
    );

  const shellBackground =
    isGradient
      ? swatch
      : `linear-gradient(90deg, rgba(255,255,255,0.18), transparent 18%, transparent 82%, rgba(0,0,0,0.12)), ${swatch}`;

  return (
    <div
      style={{
        width: 58,
        height: 72,
        position: "relative",
        margin: "0 auto",
        filter: "drop-shadow(0 4px 5px rgba(15,23,42,0.18))",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 20,
          width: 18,
          height: 16,
          border: "3px solid #1f2937",
          borderBottom: "none",
          borderRadius: "5px 5px 0 0",
          boxSizing: "border-box",
          background: "#e5e7eb",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 13,
          left: 5,
          right: 5,
          bottom: 7,
          borderRadius: soft ? 10 : 7,
          border: "2px solid #1f2937",
          background: shellBackground,
          overflow: "hidden",
        }}
      >
        {soft ? (
          <>
            <div
              style={{
                position: "absolute",
                left: 8,
                right: 8,
                top: 13,
                height: 18,
                border: "1px solid rgba(15,23,42,0.45)",
                borderRadius: 5,
                background: "rgba(255,255,255,0.08)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 8,
                right: 8,
                bottom: 8,
                height: 15,
                border: "1px solid rgba(15,23,42,0.45)",
                borderRadius: 5,
                background: "rgba(255,255,255,0.06)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 4,
                left: "50%",
                width: 12,
                height: 2,
                marginLeft: -6,
                background: "rgba(15,23,42,0.7)",
                borderRadius: 999,
              }}
            />
          </>
        ) : (
          [11, 19, 27, 35, 43].map((top) => (
            <div
              key={top}
              style={{
                position: "absolute",
                left: 6,
                right: 6,
                top,
                borderTop: "1px solid rgba(15,23,42,0.28)",
                boxShadow: "0 1px 0 rgba(255,255,255,0.12)",
              }}
            />
          ))
        )}
      </div>

      <div
        style={{
          position: "absolute",
          left: 8,
          bottom: 1,
          width: 7,
          height: 7,
          borderRadius: 999,
          background: "#111827",
          border: "1px solid #64748b",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 8,
          bottom: 1,
          width: 7,
          height: 7,
          borderRadius: 999,
          background: "#111827",
          border: "1px solid #64748b",
        }}
      />
    </div>
  );
}

function SpecialCarryOnIcon({ kind }) {
  if (kind === "WALKER") {
    return (
      <svg viewBox="0 0 90 76" width="74" height="62" aria-hidden="true">
        <defs>
          <linearGradient id="walkerMetal" x1="0" x2="1">
            <stop offset="0" stopColor="#cbd5e1" />
            <stop offset="0.5" stopColor="#f8fafc" />
            <stop offset="1" stopColor="#94a3b8" />
          </linearGradient>
        </defs>
        <path d="M24 10 L16 58 M66 10 L74 58 M24 10 L66 10 M21 30 L69 30 M16 58 L31 58 M74 58 L59 58" fill="none" stroke="url(#walkerMetal)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="63" r="5" fill="#111827" />
        <circle cx="74" cy="63" r="5" fill="#111827" />
      </svg>
    );
  }

  if (kind === "STROLLER") {
    return (
      <svg viewBox="0 0 95 78" width="78" height="64" aria-hidden="true">
        <defs>
          <linearGradient id="strollerFabric" x1="0" x2="1">
            <stop offset="0" stopColor="#111827" />
            <stop offset="1" stopColor="#475569" />
          </linearGradient>
        </defs>
        <path d="M27 20 C44 8 64 14 71 31 L62 48 L29 48 Z" fill="url(#strollerFabric)" />
        <path d="M68 20 L80 8" fill="none" stroke="#374151" strokeWidth="5" strokeLinecap="round" />
        <path d="M30 48 L22 61 M61 48 L70 61" fill="none" stroke="#4b5563" strokeWidth="4" strokeLinecap="round" />
        <circle cx="20" cy="64" r="8" fill="#111827" />
        <circle cx="72" cy="64" r="8" fill="#111827" />
      </svg>
    );
  }

  if (kind === "WCHR") {
    return (
      <svg viewBox="0 0 95 78" width="78" height="64" aria-hidden="true">
        <circle cx="56" cy="48" r="21" fill="none" stroke="#374151" strokeWidth="5" />
        <circle cx="38" cy="14" r="8" fill="#475569" />
        <path d="M40 25 L45 40 L64 40 M45 31 L28 31 M48 40 L34 58 L21 58 M64 40 L74 61" fill="none" stroke="#475569" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "MUSICAL_INSTRUMENT") {
    return (
      <svg viewBox="0 0 95 78" width="78" height="64" aria-hidden="true">
        <defs>
          <linearGradient id="guitarWood" x1="0" x2="1">
            <stop offset="0" stopColor="#a16207" />
            <stop offset="1" stopColor="#d97706" />
          </linearGradient>
        </defs>
        <ellipse cx="42" cy="52" rx="20" ry="17" fill="url(#guitarWood)" stroke="#78350f" strokeWidth="2" />
        <ellipse cx="48" cy="36" rx="14" ry="12" fill="url(#guitarWood)" stroke="#78350f" strokeWidth="2" />
        <rect x="54" y="10" width="8" height="28" rx="3" transform="rotate(25 58 24)" fill="#78350f" />
        <circle cx="46" cy="45" r="4" fill="#111827" />
        <path d="M34 20 C55 9 78 15 82 28 L67 66 C51 71 34 65 26 52 Z" fill="none" stroke="#1f2937" strokeWidth="5" opacity="0.35" />
      </svg>
    );
  }

  if (kind === "CAR_SEAT") {
    return (
      <svg viewBox="0 0 95 78" width="78" height="64" aria-hidden="true">
        <path d="M29 15 C22 31 23 51 31 63 L69 63 C75 48 72 25 62 14 Z" fill="#1f2937" stroke="#111827" strokeWidth="3" />
        <path d="M38 22 L56 22 L63 52 L33 52 Z" fill="#374151" />
        <path d="M47 26 L47 50 M37 37 L57 37" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />
        <rect x="24" y="62" width="50" height="6" rx="3" fill="#111827" />
      </svg>
    );
  }

  if (kind === "BOOSTER_SEAT") {
    return (
      <svg viewBox="0 0 95 78" width="78" height="64" aria-hidden="true">
        <path d="M24 42 C28 30 39 26 48 34 C58 25 70 31 74 42 L70 57 L28 57 Z" fill="#374151" stroke="#111827" strokeWidth="3" />
        <path d="M34 43 C40 48 56 48 64 43" fill="none" stroke="#64748b" strokeWidth="3" />
        <rect x="29" y="56" width="40" height="6" rx="3" fill="#111827" />
      </svg>
    );
  }

  if (kind === "GIFT_ITEM") {
    return (
      <svg viewBox="0 0 95 78" width="78" height="64" aria-hidden="true">
        <rect x="24" y="29" width="48" height="36" rx="3" fill="#f5e7c8" stroke="#b45309" strokeWidth="2" />
        <rect x="44" y="29" width="8" height="36" fill="#dc2626" />
        <rect x="24" y="41" width="48" height="8" fill="#dc2626" />
        <path d="M48 28 C37 19 34 13 40 10 C45 8 49 16 48 28 Z" fill="#ef4444" stroke="#b91c1c" strokeWidth="2" />
        <path d="M48 28 C59 19 62 13 56 10 C51 8 47 16 48 28 Z" fill="#ef4444" stroke="#b91c1c" strokeWidth="2" />
      </svg>
    );
  }

  return null;
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


const carryOnModalOverlay = {
  position: "fixed",
  inset: 0,
  zIndex: 9999,
  background: "rgba(15,23,42,0.68)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 10,
};

const carryOnModalCard = {
  width: "min(1050px, 100%)",
  maxHeight: "94dvh",
  overflowY: "auto",
  background: "white",
  borderRadius: 16,
  border: "1px solid #cbd5e1",
  padding: 14,
  boxShadow: "0 24px 70px rgba(15,23,42,0.32)",
};

const carryOnModalClose = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "white",
  color: "#475569",
  fontWeight: 900,
  cursor: "pointer",
};

const carryOnGroupCard = {
  padding: 10,
  borderRadius: 12,
  border: "1px solid #dbeafe",
  background: "#f8fbff",
};

const carryOnChoiceGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))",
  gap: 7,
};

const carryOnChoiceButton = {
  minHeight: 92,
  borderRadius: 10,
  padding: "7px 5px",
  cursor: "pointer",
  display: "grid",
  alignContent: "center",
  justifyItems: "center",
  font: "inherit",
};

const carryOnSpecialGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: 8,
};

const carryOnSpecialButton = {
  minHeight: 102,
  borderRadius: 10,
  padding: 8,
  cursor: "pointer",
  display: "grid",
  alignContent: "center",
  justifyItems: "center",
  font: "inherit",
};

const specialIconBox = {
  width: 58,
  height: 58,
  borderRadius: 12,
  background: "#f1f5f9",
  color: "#0f172a",
  display: "grid",
  alignContent: "center",
  justifyItems: "center",
  lineHeight: 1,
};

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

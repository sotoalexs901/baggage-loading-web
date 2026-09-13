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

function safeDocId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_");
}

function normalizeGateCheckNumber(value) {
  return cleanUpper(value)
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

function normalizeSeat(value) {
  return cleanUpper(value).replace(/\s+/g, "");
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function existingGateChecksFromRecord(data) {
  if (!data) return [];
  const list = Array.isArray(data.gateCheckNumbers)
    ? [...data.gateCheckNumbers]
    : [];
  if (data.gateCheckNumber) list.push(data.gateCheckNumber);
  return uniqueStrings(list);
}

function existingAssignmentIdsFromRecord(data) {
  if (!data) return [];
  const list = Array.isArray(data.assignmentIds)
    ? [...data.assignmentIds]
    : [];
  if (data.assignmentId) list.push(data.assignmentId);
  return uniqueStrings(list);
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

const GATE_ITEM_OPTIONS = [
  "Carry-On",
  "Stroller",
  "Car Seat",
  "Booster Seat",
  "WCHR",
  "Walker",
  "Musical Instrument",
  "Gift Item",
  "Backpack",
  "Small Soft Bag / Duffel Bag",
  "Wagon",
  "Other",
];

const NOTE_OPTIONS = [
  "",
  "BAG DAMAGED",
  "PASSENGER UPSET",
  "PASSENGER REFUSED GATE CHECK",
  "OVERSIZE / SPECIAL HANDLING",
  "TAG ISSUE",
  "WEIGHT ISSUE",
  "OTHER",
];

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
  { description: "Backpack", code: "BACKPACK", type: "Backpack", icon: "BACKPACK" },
  { description: "Small Soft Bag / Duffel Bag", code: "SMALL_SOFT_BAG", type: "Small Soft Bag / Duffel Bag", icon: "SMALL_SOFT_BAG" },
  { description: "Wagon", code: "WAGON", type: "Wagon", icon: "WAGON" },
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
  const [passengers, setPassengers] = useState([]);
  const [seats, setSeats] = useState([]);
  const [gateChecks, setGateChecks] = useState([]);
  const [processingId, setProcessingId] = useState("");
  const [offloadingId, setOffloadingId] = useState("");
  const [restoringId, setRestoringId] = useState("");
  const [acknowledgingBypassId, setAcknowledgingBypassId] =
    useState("");
  const [closingFlight, setClosingFlight] = useState(false);
  const [noteTypeById, setNoteTypeById] = useState({});
  const [noteTextById, setNoteTextById] = useState({});
  const [weightById, setWeightById] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [dashboardFilter, setDashboardFilter] =
    useState("WAITING_GATE");
  const [waitingSectionOpen, setWaitingSectionOpen] = useState(false);
  const [collectedSectionOpen, setCollectedSectionOpen] = useState(false);
  const [gateEntryOpen, setGateEntryOpen] = useState(false);
  const [gateEntryPassengerName, setGateEntryPassengerName] = useState("");
  const [gateEntrySeat, setGateEntrySeat] = useState("");
  const [gateEntryGateCheck, setGateEntryGateCheck] = useState("");
  const [gateEntryWeight, setGateEntryWeight] = useState("");
  const [gateEntryDescription, setGateEntryDescription] = useState("Carry-On");
  const [gateEntryCarryOnSelection, setGateEntryCarryOnSelection] = useState(null);
  const [gateVisualSelectorOpen, setGateVisualSelectorOpen] = useState(false);
  const [addingGateEntry, setAddingGateEntry] = useState(false);
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
      setPassengers([]);
      setSeats([]);
      setGateChecks([]);
      return undefined;
    }

    const unsubscribers = [];

    const subscribe = (subcollection, setter, fallback) => {
      const unsub = onSnapshot(
        collection(
          db,
          "carryOnFlights",
          selectedCarryOnFlightId,
          subcollection
        ),
        (snap) => {
          setter(
            snap.docs.map((item) => ({
              id: item.id,
              ...item.data(),
            }))
          );
        },
        (snapshotError) => {
          console.error(fallback, snapshotError);
          setError(fallback);
        }
      );
      unsubscribers.push(unsub);
    };

    subscribe("assignments", setAssignments, "Unable to load Carry-On assignments.");
    subscribe("passengers", setPassengers, "Unable to load Carry-On passengers.");
    subscribe("availableSeats", setSeats, "Unable to load Carry-On seats.");
    subscribe("gateCheckNumbers", setGateChecks, "Unable to load Carry-On Gate Check numbers.");

    return () => {
      unsubscribers.forEach((unsub) => {
        try { unsub(); } catch { /* Cleanup only. */ }
      });
    };
  }, [selectedCarryOnFlightId]);

  const selectedFlight = useMemo(
    () =>
      flights.find(
        (item) => item.id === selectedCarryOnFlightId
      ) || null,
    [flights, selectedCarryOnFlightId]
  );

  const flightClosed =
    cleanUpper(
      selectedFlight?.status
    ) === "CLOSED";

  const loadedCount =
    assignments.filter(
      (item) =>
        cleanUpper(item?.status) ===
        "AIRCRAFT_LOADED"
    ).length;

  const rampCount =
    assignments.filter(
      (item) =>
        cleanUpper(item?.status) ===
        "RAMP_RECEIVED"
    ).length;

  const activeAssignments =
    assignments.filter(
      (item) =>
        cleanUpper(item?.status) !==
        "OFFLOADED"
    );

  const allActiveLoaded =
    activeAssignments.length > 0 &&
    activeAssignments.every(
      (item) =>
        cleanUpper(item?.status) ===
        "AIRCRAFT_LOADED"
    );

  const workflowStage =
    flightClosed
      ? "CLOSED"
      : allActiveLoaded
        ? "LOADED"
        : assignments.some(
            (item) =>
              cleanUpper(item?.status) ===
              "GATE_COLLECTED" ||
              cleanUpper(item?.status) ===
              "RAMP_RECEIVED"
          )
          ? "GATE_RECEIVING"
          : assignments.length > 0
            ? "CHECKING"
            : "OPEN";

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

  const getDraftWeight = (assignmentId) => {
    const raw = String(
      weightById[assignmentId] || ""
    ).trim();

    if (!raw) {
      return null;
    }

    const parsed = Number(raw);

    if (
      !Number.isFinite(parsed) ||
      parsed <= 0
    ) {
      return NaN;
    }

    return Math.round(parsed * 10) / 10;
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

    setWeightById((previous) => ({
      ...previous,
      [assignmentId]: "",
    }));
  };

  const matchesSearch = (item) => {
    const query = String(searchTerm || "").trim().toLowerCase();
    if (!query) return true;
    return [
      item?.assignedSeat,
      item?.gateCheckNumber,
      item?.carryOnDescription,
      item?.carryOnCode,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  };

  const filteredWaitingAtGate = waitingAtGate.filter(matchesSearch);
  const filteredCollectedAtGate = collectedAtGate.filter(matchesSearch);
  const filteredOffloaded = offloaded.filter(matchesSearch);


  const gateBypassAlerts = useMemo(
    () =>
      assignments
        .filter(
          (item) =>
            item?.rampBypassedGate === true &&
            !item?.gateBypassAcknowledgedAt
        )
        .sort((a, b) =>
          String(a.gateCheckNumber || "").localeCompare(
            String(b.gateCheckNumber || "")
          )
        ),
    [assignments]
  );

  const addGateCheckAtGate = async () => {
    setMessage("");
    setError("");

    if (!canOperateGate) {
      setError("You do not have permission to add Gate Check items at Gate.");
      return;
    }

    if (!selectedFlight || flightClosed) {
      setError(flightClosed ? "This Carry-On flight is closed." : "Select a Carry-On flight first.");
      return;
    }

    const passengerName = cleanText(gateEntryPassengerName);
    const seatNumber = normalizeSeat(gateEntrySeat);
    const gateCheckNumber = normalizeGateCheckNumber(gateEntryGateCheck);
    const verifiedWeightLbs = Math.round(Number(gateEntryWeight) * 10) / 10;
    const description = gateEntryCarryOnSelection?.description || cleanText(gateEntryDescription);

    if (!passengerName || !seatNumber || !gateCheckNumber || !gateEntryCarryOnSelection?.code || !description || !Number.isFinite(verifiedWeightLbs) || verifiedWeightLbs <= 0) {
      setError("Passenger Name, Seat, Gate Check Number, Gate Check Description and valid Weight are required.");
      return;
    }

    const alreadyUsed =
      assignments.some((item) => normalizeGateCheckNumber(item?.gateCheckNumber) === gateCheckNumber) ||
      gateChecks.some((item) => normalizeGateCheckNumber(item?.gateCheckNumber) === gateCheckNumber && cleanUpper(item?.status) !== "AVAILABLE");

    if (alreadyUsed) {
      setError(`Gate Check ${gateCheckNumber} is already in use and cannot be reused.`);
      return;
    }

    const samePassengerAssignments = assignments.filter((item) => cleanUpper(item?.passengerName) === cleanUpper(passengerName));
    const sameSeatAssignments = assignments.filter((item) => normalizeSeat(item?.assignedSeat) === seatNumber);

    if (samePassengerAssignments.length >= 5) {
      setError("This passenger already has the maximum of 5 Gate Check items.");
      return;
    }
    if (sameSeatAssignments.length >= 5) {
      setError("This seat already has the maximum of 5 Gate Check items.");
      return;
    }

    const existingPassenger = passengers.find((item) => cleanUpper(item?.passengerName) === cleanUpper(passengerName));
    const existingSeat = seats.find((item) => normalizeSeat(item?.seatNumber) === seatNumber);
    const existingGateCheck = gateChecks.find((item) => normalizeGateCheckNumber(item?.gateCheckNumber) === gateCheckNumber);

    const passengerId = existingPassenger?.id || safeDocId(`GATE_PAX_${passengerName}_${Date.now()}`);
    const seatId = existingSeat?.id || safeDocId(seatNumber);
    const gateCheckId = existingGateCheck?.id || safeDocId(gateCheckNumber);
    const assignmentId = gateCheckId;

    try {
      setAddingGateEntry(true);

      const flightRef = doc(db, "carryOnFlights", selectedFlight.id);
      const passengerRef = doc(db, "carryOnFlights", selectedFlight.id, "passengers", passengerId);
      const seatRef = doc(db, "carryOnFlights", selectedFlight.id, "availableSeats", seatId);
      const gateCheckRef = doc(db, "carryOnFlights", selectedFlight.id, "gateCheckNumbers", gateCheckId);
      const assignmentRef = doc(db, "carryOnFlights", selectedFlight.id, "assignments", assignmentId);

      await runTransaction(db, async (transaction) => {
        const [flightSnap, passengerSnap, seatSnap, gateCheckSnap, assignmentSnap] = await Promise.all([
          transaction.get(flightRef),
          transaction.get(passengerRef),
          transaction.get(seatRef),
          transaction.get(gateCheckRef),
          transaction.get(assignmentRef),
        ]);

        if (assignmentSnap.exists()) throw new Error("This Gate Check number already has an assignment.");
        if (gateCheckSnap.exists() && cleanUpper(gateCheckSnap.data()?.status) !== "AVAILABLE") {
          throw new Error("This Gate Check number is already assigned.");
        }

        const passengerData = passengerSnap.exists() ? passengerSnap.data() : {};
        const seatData = seatSnap.exists() ? seatSnap.data() : {};
        const passengerGateChecks = existingGateChecksFromRecord(passengerData);
        const passengerAssignmentIds = existingAssignmentIdsFromRecord(passengerData);
        const seatGateChecks = existingGateChecksFromRecord(seatData);
        const seatAssignmentIds = existingAssignmentIdsFromRecord(seatData);

        if (passengerGateChecks.length >= 5 || passengerAssignmentIds.length >= 5) {
          throw new Error("This passenger already has the maximum of 5 Gate Check items.");
        }
        if (seatGateChecks.length >= 5 || seatAssignmentIds.length >= 5) {
          throw new Error("This seat already has the maximum of 5 Gate Check items.");
        }

        transaction.set(passengerRef, {
          passengerName,
          source: existingPassenger?.source || "GATE_GOSHOW",
          assigned: true,
          assignedSeat: seatNumber,
          gateCheckNumber,
          assignmentId,
          gateCheckNumbers: uniqueStrings([...passengerGateChecks, gateCheckNumber]),
          assignmentIds: uniqueStrings([...passengerAssignmentIds, assignmentId]),
          gateCheckCount: uniqueStrings([...passengerGateChecks, gateCheckNumber]).length,
          updatedAt: serverTimestamp(),
          ...(!passengerSnap.exists() ? { createdAt: serverTimestamp(), createdBy: actor } : {}),
        }, { merge: true });

        transaction.set(seatRef, {
          seatNumber,
          seatType: existingSeat?.seatType || null,
          blocked: false,
          status: "ASSIGNED",
          assignmentId,
          assignmentIds: uniqueStrings([...seatAssignmentIds, assignmentId]),
          passengerId,
          passengerName,
          gateCheckNumber,
          gateCheckNumbers: uniqueStrings([...seatGateChecks, gateCheckNumber]),
          gateCheckCount: uniqueStrings([...seatGateChecks, gateCheckNumber]).length,
          assignedAt: serverTimestamp(),
          assignedBy: actor,
          ...(!seatSnap.exists() ? { source: "GATE_GOSHOW" } : {}),
        }, { merge: true });

        const carryOnCode = safeDocId(cleanUpper(description));
        transaction.set(gateCheckRef, {
          gateCheckNumber,
          status: "GATE_COLLECTED",
          source: existingGateCheck?.source || "GATE_GOSHOW",
          assignmentId,
          passengerId,
          passengerName,
          assignedSeat: seatNumber,
          counterRecordedWeightLbs: verifiedWeightLbs,
          carryOnDescription: description,
          carryOnType: description,
          carryOnCode,
          assignedAt: serverTimestamp(),
          assignedBy: actor,
          gateCollectedAt: serverTimestamp(),
          gateCollectedBy: actor,
          gateVerifiedWeightLbs: verifiedWeightLbs,
          gateWeightVerifiedAt: serverTimestamp(),
          gateWeightVerifiedBy: actor,
          ...(!gateCheckSnap.exists() ? { addedAt: serverTimestamp(), addedBy: actor } : {}),
        }, { merge: true });

        transaction.set(assignmentRef, {
          passengerId,
          passengerName,
          passengerSource: existingPassenger?.source || "GATE_GOSHOW",
          assignedSeat: seatNumber,
          assignedSeatType: existingSeat?.seatType || null,
          gateCheckNumber,
          gateCheckSource: existingGateCheck?.source || "GATE_GOSHOW",
          counterRecordedWeightLbs: verifiedWeightLbs,
          carryOnDescription: description,
          carryOnColor: null,
          carryOnColorCode: null,
          carryOnSize: null,
          carryOnType: description,
          carryOnCode,
          counterWeightRecordedAt: serverTimestamp(),
          counterWeightRecordedBy: actor,
          status: "GATE_COLLECTED",
          counterAssignedAt: serverTimestamp(),
          counterAssignedBy: actor,
          gateCollectedAt: serverTimestamp(),
          gateCollectedBy: actor,
          gateVerifiedWeightLbs: verifiedWeightLbs,
          gateWeightVerifiedAt: serverTimestamp(),
          gateWeightVerifiedBy: actor,
          createdAt: serverTimestamp(),
          createdBy: actor,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        });

        const previousCount = Number(flightSnap.data()?.assignmentCount || 0);
        transaction.set(flightRef, { status: "IN_PROGRESS", assignmentCount: previousCount + 1, updatedAt: serverTimestamp(), updatedBy: actor }, { merge: true });
      });

      try {
        await setDoc(doc(db, "carryOnFlights", selectedFlight.id, "events", `gate_goshow_${assignmentId}_${Date.now()}`), {
          type: "GATE_GOSHOW_ADDED",
          status: "GATE_COLLECTED",
          assignmentId, passengerId, passengerName, assignedSeat: seatNumber, gateCheckNumber,
          carryOnDescription: description, carryOnCode: gateEntryCarryOnSelection?.code || null, carryOnColor: gateEntryCarryOnSelection?.color || null, carryOnSize: gateEntryCarryOnSelection?.size || null, carryOnType: gateEntryCarryOnSelection?.type || description, gateVerifiedWeightLbs: verifiedWeightLbs,
          message: `Gate Check ${gateCheckNumber} added and collected directly at Gate.`,
          createdAt: serverTimestamp(), createdBy: actor,
        });
      } catch (eventError) {
        console.error("Gate GoShow event error:", eventError);
      }

      setGateEntryPassengerName("");
      setGateEntrySeat("");
      setGateEntryGateCheck("");
      setGateEntryWeight("");
      setGateEntryDescription("Carry-On");
      setGateEntryCarryOnSelection(null);
      setGateVisualSelectorOpen(false);
      setMessage(`${gateCheckNumber} added and collected directly at Gate.`);
      setDashboardFilter("GATE_COLLECTED");
    } catch (gateEntryError) {
      console.error("Add Gate Check at Gate error:", gateEntryError);
      setError(gateEntryError?.message || "Unable to add Gate Check at Gate.");
    } finally {
      setAddingGateEntry(false);
    }
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

    if (flightClosed) {
      setError(
        "This Carry-On flight is closed."
      );
      return;
    }

    const note = getDraftNote(assignment.id);
    const verifiedWeightLbs =
      getDraftWeight(assignment.id);

    if (
      verifiedWeightLbs === null ||
      Number.isNaN(verifiedWeightLbs)
    ) {
      setError(
        "Enter the verified Gate weight in pounds before confirming collection."
      );
      return;
    }

    const ok = window.confirm(
      `Confirm Collected at Gate?\n\n` +
        `Passenger: ${assignment.passengerName || "-"}\n` +
        `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
        `Seat: ${assignment.assignedSeat || "-"}\n` +
        `Gate Check Description: ${assignment.carryOnDescription || "-"}\n` +
        `Weight: ${verifiedWeightLbs} lb\n` +
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
            gateVerifiedWeightLbs:
              verifiedWeightLbs,
            gateWeightVerifiedAt:
              serverTimestamp(),
            gateWeightVerifiedBy:
              actor,
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
            gateVerifiedWeightLbs:
              verifiedWeightLbs,
            gateWeightVerifiedAt:
              serverTimestamp(),
            gateWeightVerifiedBy:
              actor,
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
            carryOnDescription:
              assignment.carryOnDescription || null,
            carryOnCode:
              assignment.carryOnCode || null,
            gateCollectionNoteType:
              note.type || null,
            gateCollectionNote:
              note.text || null,
            gateCollectionNoteCombined:
              note.combined || null,
            gateVerifiedWeightLbs:
              verifiedWeightLbs,
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

    if (flightClosed) {
      setError(
        "This Carry-On flight is closed."
      );
      return;
    }

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

  const acknowledgeGateBypass = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateGate) {
      setError(
        "You do not have permission to acknowledge this Gate bypass."
      );
      return;
    }

    if (!selectedFlight || !assignment) return;

    try {
      setAcknowledgingBypassId(assignment.id);

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

        if (data?.rampBypassedGate !== true) {
          throw new Error(
            "This Carry-On does not have a Gate bypass alert."
          );
        }

        transaction.set(
          assignmentRef,
          {
            gateBypassAcknowledgedAt:
              serverTimestamp(),
            gateBypassAcknowledgedBy:
              actor,
            updatedAt:
              serverTimestamp(),
            updatedBy:
              actor,
          },
          { merge: true }
        );

        transaction.set(
          gateCheckRef,
          {
            gateBypassAcknowledgedAt:
              serverTimestamp(),
            gateBypassAcknowledgedBy:
              actor,
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
            `gate_bypass_ack_${assignment.id}_${Date.now()}`
          ),
          {
            type: "GATE_BYPASS_ACKNOWLEDGED",
            status:
              cleanUpper(assignment.status),
            assignmentId:
              assignment.id,
            passengerId:
              assignment.passengerId || null,
            passengerName:
              assignment.passengerName || null,
            assignedSeat:
              assignment.assignedSeat || null,
            gateCheckNumber:
              assignment.gateCheckNumber || null,
            message:
              `Gate acknowledged that ${assignment.gateCheckNumber || assignment.id} was received by Ramp without Gate collection.`,
            createdAt:
              serverTimestamp(),
            createdBy:
              actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On Gate bypass acknowledgment event error:",
          eventError
        );
      }

      setMessage(
        `${assignment.gateCheckNumber} Gate bypass acknowledged.`
      );
    } catch (ackError) {
      console.error(
        "Carry-On Gate bypass acknowledgment error:",
        ackError
      );

      setError(
        ackError?.message ||
          "Unable to acknowledge Gate bypass."
      );
    } finally {
      setAcknowledgingBypassId("");
    }
  };

  const restoreOffloadedToGate = async (assignment) => {
    setMessage("");
    setError("");

    if (!canOperateGate) {
      setError(
        "You do not have permission to restore this Carry-On."
      );
      return;
    }

    if (flightClosed) {
      setError(
        "This flight is closed."
      );
      return;
    }

    if (!selectedFlight || !assignment) return;

    const ok = window.confirm(
      `Return this Carry-On to Ready for Gate Pickup?\n\n` +
        `Passenger: ${assignment.passengerName || "-"}\n` +
        `Gate Check: ${assignment.gateCheckNumber || "-"}\n` +
        `Previous Offload Reason: ${assignment.offloadReason || "-"}`
    );

    if (!ok) return;

    try {
      setRestoringId(assignment.id);

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

        if (currentStatus !== "OFFLOADED") {
          throw new Error(
            `Only OFFLOADED Carry-Ons can be returned to Gate pickup. Current status: ${currentStatus || "UNKNOWN"}.`
          );
        }

        transaction.set(
          assignmentRef,
          {
            status: "COUNTER_ASSIGNED",
            restoredFromOffloadAt:
              serverTimestamp(),
            restoredFromOffloadBy:
              actor,
            previousOffloadReason:
              data?.offloadReason || null,
            previousOffloadedAt:
              data?.offloadedAt || null,
            previousOffloadedBy:
              data?.offloadedBy || null,
            offloadReason: null,
            offloadNote: null,
            offloadNoteType: null,
            offloadedAt: null,
            offloadedBy: null,
            statusBeforeOffload: null,
            gateCollectedAt: null,
            gateCollectedBy: null,
            gateCollectionNoteType: null,
            gateCollectionNote: null,
            gateCollectionNoteCombined: null,
            gateVerifiedWeightLbs: null,
            gateWeightVerifiedAt: null,
            gateWeightVerifiedBy: null,
            rampReceivedAt: null,
            rampReceivedBy: null,
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
            status: "ASSIGNED",
            restoredFromOffloadAt:
              serverTimestamp(),
            restoredFromOffloadBy:
              actor,
            offloadReason: null,
            offloadedAt: null,
            offloadedBy: null,
            statusBeforeOffload: null,
            gateCollectedAt: null,
            gateCollectedBy: null,
            gateCollectionNoteType: null,
            gateCollectionNote: null,
            gateCollectionNoteCombined: null,
            gateVerifiedWeightLbs: null,
            gateWeightVerifiedAt: null,
            gateWeightVerifiedBy: null,
            rampReceivedAt: null,
            rampReceivedBy: null,
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
            `restore_gate_${assignment.id}_${Date.now()}`
          ),
          {
            type: "OFFLOAD_RESTORED_TO_GATE",
            status: "COUNTER_ASSIGNED",
            assignmentId: assignment.id,
            passengerId:
              assignment.passengerId || null,
            passengerName:
              assignment.passengerName || null,
            assignedSeat:
              assignment.assignedSeat || null,
            gateCheckNumber:
              assignment.gateCheckNumber || null,
            previousOffloadReason:
              assignment.offloadReason || null,
            message:
              `Carry-On ${assignment.gateCheckNumber || assignment.id} returned to Ready for Gate Pickup.`,
            createdAt: serverTimestamp(),
            createdBy: actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On restore event write error:",
          eventError
        );
      }

      setMessage(
        `${assignment.gateCheckNumber} returned to Ready for Gate Pickup.`
      );

      setDashboardFilter(
        "WAITING_GATE"
      );
    } catch (restoreError) {
      console.error(
        "Carry-On Gate restore error:",
        restoreError
      );

      setError(
        restoreError?.message ||
          "Unable to restore Carry-On."
      );
    } finally {
      setRestoringId("");
    }
  };

  const closeCarryOnFlight = async () => {
    setMessage("");
    setError("");

    if (!canOperateGate) {
      setError(
        "You do not have permission to close this Carry-On flight."
      );
      return;
    }

    if (!selectedFlight) return;

    if (flightClosed) {
      setMessage(
        "This Carry-On flight is already closed."
      );
      return;
    }

    const pending = assignments.filter((item) => {
      const status = cleanUpper(item?.status);

      return (
        status !== "AIRCRAFT_LOADED" &&
        status !== "OFFLOADED"
      );
    });

    if (pending.length > 0) {
      setError(
        `Flight cannot be closed yet. ${pending.length} active Carry-On item(s) are still pending.`
      );
      return;
    }

    const ok = window.confirm(
      `Close Carry-On flight ${selectedFlight.flightNumber || ""}?\n\n` +
        `Loaded: ${loadedCount}\n` +
        `Offloaded: ${offloaded.length}\n\n` +
        `No further Gate collection will be allowed from this page.`
    );

    if (!ok) return;

    try {
      setClosingFlight(true);

      await setDoc(
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id
        ),
        {
          status: "CLOSED",
          closedAt: serverTimestamp(),
          closedBy: actor,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        },
        { merge: true }
      );

      try {
        await setDoc(
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "events",
            `flight_closed_${Date.now()}`
          ),
          {
            type: "FLIGHT_CLOSED",
            status: "CLOSED",
            loadedCount,
            offloadedCount:
              offloaded.length,
            message:
              `Carry-On flight ${selectedFlight.flightNumber || selectedFlight.id} closed.`,
            createdAt:
              serverTimestamp(),
            createdBy:
              actor,
          }
        );
      } catch (eventError) {
        console.error(
          "Carry-On flight close event write error:",
          eventError
        );
      }

      setMessage(
        `Flight ${selectedFlight.flightNumber || ""} closed successfully.`
      );
    } catch (closeError) {
      console.error(
        "Carry-On flight close error:",
        closeError
      );

      setError(
        closeError?.message ||
          "Unable to close Carry-On flight."
      );
    } finally {
      setClosingFlight(false);
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
            Verify Carry-On weight, confirm collection, record Gate notes, or Offload an item when required.
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
              padding: 12,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "white",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
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
                  FLIGHT PROGRESS
                </div>

                <div
                  style={{
                    marginTop: 3,
                    color: "#0f172a",
                    fontWeight: 900,
                  }}
                >
                  {flightClosed
                    ? "Flight Closed"
                    : "Live Carry-On Operation"}
                </div>
              </div>

              <button
                type="button"
                onClick={closeCarryOnFlight}
                disabled={
                  closingFlight ||
                  flightClosed ||
                  !canOperateGate
                }
                style={{
                  ...closeButton,
                  opacity:
                    closingFlight ||
                    flightClosed ||
                    !canOperateGate
                      ? 0.55
                      : 1,
                }}
              >
                {flightClosed
                  ? "Flight Closed"
                  : closingFlight
                    ? "Closing..."
                    : "Close Flight"}
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(4, minmax(0, 1fr))",
                gap: 6,
                marginTop: 12,
              }}
            >
              <StageSegment
                label="Open"
                active={
                  workflowStage === "OPEN"
                }
                complete={
                  workflowStage !== "OPEN"
                }
              />

              <StageSegment
                label="Checking"
                active={
                  workflowStage === "CHECKING"
                }
                complete={
                  ["GATE_RECEIVING", "LOADED", "CLOSED"].includes(
                    workflowStage
                  )
                }
              />

              <StageSegment
                label="Receiving at Gate"
                active={
                  workflowStage === "GATE_RECEIVING"
                }
                complete={
                  ["LOADED", "CLOSED"].includes(
                    workflowStage
                  )
                }
              />

              <StageSegment
                label="Loaded"
                active={
                  workflowStage === "LOADED" ||
                  workflowStage === "CLOSED"
                }
                complete={
                  workflowStage === "CLOSED"
                }
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 7,
                marginTop: 10,
              }}
            >
              <MiniStat
                label="Need Pickup"
                value={waitingAtGate.length}
              />
              <MiniStat
                label="At Gate"
                value={collectedAtGate.length}
              />
              <MiniStat
                label="At Ramp"
                value={rampCount}
              />
              <MiniStat
                label="Loaded"
                value={loadedCount}
              />
            </div>
          </div>

          <div
            style={{
              ...panelStyle,
              border: "1px solid #bfdbfe",
              background: "#eff6ff",
            }}
          >
            <button
              type="button"
              onClick={() => setGateEntryOpen((previous) => !previous)}
              style={collapsibleHeaderButton}
            >
              <span>Add Gate Check at Gate / GoShow</span>
              <span style={collapsibleCountBadge}>{gateEntryOpen ? "Hide" : "Add"}</span>
            </button>

            {gateEntryOpen && (
              <>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: "0.78rem" }}>
                  Add a Gate Check directly from Gate without returning to Counter. The Gate Check number must be unique. Up to 5 Gate Checks are allowed for the same passenger / seat.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 10 }}>
                  <label style={{ display: "grid", gap: 5 }}>
                    <span style={fieldLabel}>Passenger Name</span>
                    <input type="text" value={gateEntryPassengerName} onChange={(event) => setGateEntryPassengerName(event.target.value)} placeholder="Passenger Name" style={inputStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 5 }}>
                    <span style={fieldLabel}>Seat</span>
                    <input type="text" value={gateEntrySeat} onChange={(event) => setGateEntrySeat(event.target.value)} placeholder="Example: 18F" style={inputStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 5 }}>
                    <span style={fieldLabel}>Gate Check Number</span>
                    <input type="text" value={gateEntryGateCheck} onChange={(event) => setGateEntryGateCheck(event.target.value)} placeholder="Example: GC823999" style={inputStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 5 }}>
                    <span style={fieldLabel}>Weight (lb)</span>
                    <input type="number" min="0.1" step="0.1" inputMode="decimal" value={gateEntryWeight} onChange={(event) => setGateEntryWeight(event.target.value)} placeholder="Example: 22.5" style={inputStyle} />
                  </label>
                  <CarryOnDescriptionField
                    label="Gate Check Description"
                    selection={gateEntryCarryOnSelection}
                    onClick={() =>
                      setGateVisualSelectorOpen(true)
                    }
                  />
                </div>

                <button type="button" onClick={addGateCheckAtGate} disabled={addingGateEntry || !canOperateGate || flightClosed} style={{ ...primaryButton, marginTop: 10, width: "100%", opacity: addingGateEntry || !canOperateGate || flightClosed ? 0.55 : 1 }}>
                  {addingGateEntry ? "Adding..." : "Add & Collect at Gate"}
                </button>
              </>
            )}
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
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by Seat or Gate Check"
            style={inputStyle}
          />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(145px, 1fr))",
              gap: 8,
            }}
          >
            <DashboardMetric
              label="Need Gate Pickup"
              value={waitingAtGate.length}
              active={dashboardFilter === "WAITING_GATE"}
              onClick={() => setDashboardFilter("WAITING_GATE")}
            />

            <DashboardMetric
              label="Collected / To Ramp"
              value={collectedAtGate.length}
              active={dashboardFilter === "GATE_COLLECTED"}
              onClick={() => setDashboardFilter("GATE_COLLECTED")}
            />

            <DashboardMetric
              label="At Ramp"
              value={
                assignments.filter(
                  (item) =>
                    cleanUpper(item?.status) === "RAMP_RECEIVED"
                ).length
              }
              active={dashboardFilter === "RAMP_RECEIVED"}
              onClick={() => setDashboardFilter("RAMP_RECEIVED")}
            />

            <DashboardMetric
              label="Loaded"
              value={
                assignments.filter(
                  (item) =>
                    cleanUpper(item?.status) === "AIRCRAFT_LOADED"
                ).length
              }
              active={dashboardFilter === "AIRCRAFT_LOADED"}
              onClick={() => setDashboardFilter("AIRCRAFT_LOADED")}
            />

            <DashboardMetric
              label="Offloaded"
              value={offloaded.length}
              active={dashboardFilter === "OFFLOADED"}
              onClick={() => setDashboardFilter("OFFLOADED")}
            />
          </div>

          <GateDashboardDetail
            filter={dashboardFilter}
            assignments={assignments}
            searchTerm={searchTerm}
          />

          {gateBypassAlerts.length > 0 && (
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid #fde68a",
                background: "#fffbeb",
              }}
            >
              <div
                style={{
                  color: "#92400e",
                  fontWeight: 900,
                  fontSize: "0.84rem",
                }}
              >
                Ramp Received Without Gate Collection
              </div>

              <div
                style={{
                  marginTop: 4,
                  color: "#92400e",
                  fontSize: "0.74rem",
                }}
              >
                Ramp received the following Gate Check number(s) directly from Counter. Gate can acknowledge the exception without changing the current Ramp/Load status.
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(145px, 1fr))",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {gateBypassAlerts.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #fde68a",
                      background: "white",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        color: "#92400e",
                        fontWeight: 900,
                        fontSize: "1rem",
                      }}
                    >
                      {item.gateCheckNumber || "-"}
                    </div>

                    <div
                      style={{
                        marginTop: 4,
                        color: "#64748b",
                        fontSize: "0.68rem",
                      }}
                    >
                      Received at Ramp without Gate
                    </div>

                    <div
                      style={{
                        marginTop: 4,
                        color: "#5b21b6",
                        fontSize: "0.68rem",
                        fontWeight: 800,
                      }}
                    >
                      {item.carryOnDescription || "Not classified"}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        acknowledgeGateBypass(item)
                      }
                      disabled={
                        acknowledgingBypassId === item.id ||
                        !canOperateGate
                      }
                      style={{
                        ...ackButton,
                        width: "100%",
                        marginTop: 8,
                        opacity:
                          acknowledgingBypassId === item.id ||
                          !canOperateGate
                            ? 0.55
                            : 1,
                      }}
                    >
                      {acknowledgingBypassId === item.id
                        ? "Acknowledging..."
                        : "Acknowledge"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!canOperateGate && (
            <Notice
              tone="warning"
              text="You can view Gate status, but your current role/operational position cannot confirm collection or Offload."
            />
          )}

          <div style={panelStyle}>
            <button
              type="button"
              onClick={() =>
                setWaitingSectionOpen((previous) => !previous)
              }
              style={collapsibleHeaderButton}
            >
              <span>Waiting for Gate Collection</span>
              <span style={collapsibleCountBadge}>
                {waitingAtGate.length}
              </span>
            </button>

            {waitingSectionOpen && (
              waitingAtGate.length === 0 ? (
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
                  {filteredWaitingAtGate.map((item) => (
                    <GateActionCard
                      key={item.id}
                      item={item}
                      noteType={
                        noteTypeById[item.id] || ""
                      }
                      noteText={
                        noteTextById[item.id] || ""
                      }
                      weight={
                        weightById[item.id] || ""
                      }
                      setWeight={(value) =>
                        setWeightById(
                          (previous) => ({
                            ...previous,
                            [item.id]: value,
                          })
                        )
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
                      canOperate={
                        canOperateGate &&
                        !flightClosed
                      }
                    />
                  ))}
                </div>
              )
            )}
          </div>

          <div style={panelStyle}>
            <button
              type="button"
              onClick={() =>
                setCollectedSectionOpen((previous) => !previous)
              }
              style={collapsibleHeaderButton}
            >
              <span>Collected at Gate</span>
              <span style={collapsibleCountBadge}>
                {collectedAtGate.length}
              </span>
            </button>

            {collectedSectionOpen && (
              collectedAtGate.length === 0 ? (
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
                  {filteredCollectedAtGate.map((item) => (
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
                          justifyContent: "space-between",
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
                            Gate Check Description: {item.carryOnDescription || "Not classified"}
                            {" - "}
                            Counter: {item.counterRecordedWeightLbs || "-"} lb
                            {" - "}
                            Gate Verified: {item.gateVerifiedWeightLbs || "-"} lb
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
              )
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
                {filteredOffloaded.map((item) => (
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
                      Gate Check Description: {item.carryOnDescription || "Not classified"}
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

                    <button
                      type="button"
                      onClick={() =>
                        restoreOffloadedToGate(item)
                      }
                      disabled={
                        restoringId === item.id ||
                        flightClosed ||
                        !canOperateGate
                      }
                      style={{
                        ...restoreButton,
                        marginTop: 9,
                        width: "100%",
                        opacity:
                          restoringId === item.id ||
                          flightClosed ||
                          !canOperateGate
                            ? 0.55
                            : 1,
                      }}
                    >
                      {restoringId === item.id
                        ? "Restoring..."
                        : "Return to Ready for Gate Pickup"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {gateVisualSelectorOpen && (
            <CarryOnVisualSelector
              currentSelection={gateEntryCarryOnSelection}
              onClose={() =>
                setGateVisualSelectorOpen(false)
              }
              onSelect={(selection) => {
                setGateEntryCarryOnSelection(selection);
                setGateEntryDescription(
                  selection?.description || ""
                );
                setGateVisualSelectorOpen(false);
              }}
            />
          )}

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

  if (kind === "BACKPACK") {
    return (
      <svg viewBox="0 0 95 78" width="78" height="64" aria-hidden="true">
        <path
          d="M34 18 C34 9 61 9 61 18 L68 29 L68 65 L27 65 L27 29 Z"
          fill="#2563eb"
          stroke="#172554"
          strokeWidth="3"
        />
        <path
          d="M38 18 C38 12 57 12 57 18"
          fill="none"
          stroke="#172554"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <rect
          x="34"
          y="39"
          width="27"
          height="17"
          rx="6"
          fill="#60a5fa"
          stroke="#172554"
          strokeWidth="2"
        />
        <path
          d="M27 31 C17 34 17 54 24 60 M68 31 C78 34 78 54 71 60"
          fill="none"
          stroke="#334155"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (kind === "SMALL_SOFT_BAG") {
    return (
      <svg viewBox="0 0 95 78" width="78" height="64" aria-hidden="true">
        <rect
          x="15"
          y="31"
          width="65"
          height="32"
          rx="12"
          fill="#475569"
          stroke="#1f2937"
          strokeWidth="3"
        />
        <path
          d="M30 32 C31 12 63 12 65 32"
          fill="none"
          stroke="#1f2937"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M27 43 L67 43"
          stroke="#94a3b8"
          strokeWidth="2"
        />
        <circle cx="24" cy="65" r="4" fill="#111827" />
        <circle cx="71" cy="65" r="4" fill="#111827" />
      </svg>
    );
  }

  if (kind === "WAGON") {
    return (
      <svg viewBox="0 0 95 78" width="78" height="64" aria-hidden="true">
        <rect x="17" y="29" width="58" height="29" rx="6" fill="#2563eb" stroke="#1e3a8a" strokeWidth="3" />
        <path d="M75 31 L86 14" fill="none" stroke="#334155" strokeWidth="5" strokeLinecap="round" />
        <path d="M25 29 L31 20 L61 20 L68 29" fill="#93c5fd" stroke="#1e3a8a" strokeWidth="3" strokeLinejoin="round" />
        <circle cx="29" cy="63" r="7" fill="#111827" />
        <circle cx="65" cy="63" r="7" fill="#111827" />
      </svg>
    );
  }

  return null;
}



function GateActionCard({
  item,
  noteType,
  noteText,
  weight,
  setWeight,
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

          <div
            style={{
              marginTop: 5,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 8px",
              borderRadius: 999,
              background: "#f5f3ff",
              border: "1px solid #ddd6fe",
              color: "#5b21b6",
              fontSize: "0.72rem",
              fontWeight: 900,
            }}
          >
            Gate Check Description: {item.carryOnDescription || "Not classified"}
            {item.carryOnCode ? ` (${item.carryOnCode})` : ""}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(140px, 180px) minmax(180px, 240px) minmax(220px, 1fr)",
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
            Verify Gate Weight (lb)
          </span>

          <div
            style={{
              marginBottom: 4,
              color: "#64748b",
              fontSize: "0.72rem",
              fontWeight: 700,
            }}
          >
            Counter Weight: {item.counterRecordedWeightLbs || "-"} lb
          </div>

          <input
            type="number"
            min="0.1"
            step="0.1"
            inputMode="decimal"
            value={weight}
            placeholder="Example: 22.5"
            onChange={(event) =>
              setWeight(event.target.value)
            }
            style={inputStyle}
          />
        </label>

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

function StageSegment({
  label,
  active,
  complete,
}) {
  const emphasized =
    active || complete;

  return (
    <div
      style={{
        minWidth: 0,
        padding: "8px 5px",
        borderRadius: 9,
        border: emphasized
          ? "1px solid #86efac"
          : "1px solid #e2e8f0",
        background: active
          ? "#dcfce7"
          : complete
            ? "#f0fdf4"
            : "#f8fafc",
        color: emphasized
          ? "#166534"
          : "#94a3b8",
        textAlign: "center",
        fontSize: "0.64rem",
        fontWeight: 900,
        lineHeight: 1.15,
      }}
    >
      {label}
    </div>
  );
}

function MiniStat({
  label,
  value,
}) {
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 9,
        border: "1px solid #e2e8f0",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          color: "#64748b",
          fontSize: "0.62rem",
          fontWeight: 800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 2,
          color: "#0f172a",
          fontSize: "1rem",
          fontWeight: 900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DashboardMetric({
  label,
  value,
  active,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: 11,
        borderRadius: 10,
        border: active
          ? "2px solid #7c3aed"
          : "1px solid #e2e8f0",
        background: active
          ? "#faf5ff"
          : "#f8fafc",
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
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
          fontSize: "1.15rem",
          fontWeight: 900,
        }}
      >
        {value}
      </div>

      <div
        style={{
          marginTop: 4,
          color: "#7c3aed",
          fontSize: "0.66rem",
          fontWeight: 800,
        }}
      >
        View details
      </div>
    </button>
  );
}

function GateDashboardDetail({
  filter,
  assignments,
  searchTerm,
}) {
  const [open, setOpen] = useState(false);
  const rows = assignments
    .filter((item) => {
      const status = cleanUpper(item?.status);

      const targetStatus =
        filter === "WAITING_GATE"
          ? "COUNTER_ASSIGNED"
          : filter;

      if (status !== targetStatus) return false;

      const query = String(searchTerm || "").trim().toLowerCase();
      if (!query) return true;

      return [item?.assignedSeat, item?.gateCheckNumber]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) =>
      String(a.gateCheckNumber || "").localeCompare(
        String(b.gateCheckNumber || "")
      )
    );

  const labels = {
    WAITING_GATE:
      "Carry-Ons Still Waiting for Gate Pickup",
    GATE_COLLECTED:
      "Collected at Gate / Waiting for Ramp",
    RAMP_RECEIVED:
      "Carry-Ons at Ramp",
    AIRCRAFT_LOADED:
      "Carry-Ons Loaded on Aircraft",
    OFFLOADED:
      "Offloaded Carry-Ons",
  };

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border: "1px solid #ddd6fe",
        background: "#faf5ff",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        style={collapsibleHeaderButton}
      >
        <span>{labels[filter] || "Operational Detail"}</span>
        <span style={collapsibleCountBadge}>{rows.length}</span>
      </button>

      {open && (
        rows.length === 0 ? (
          <p
            style={{
              margin: "8px 0 0",
              color: "#64748b",
              fontSize: "0.8rem",
            }}
          >
            No Carry-On items in this status.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 7,
              marginTop: 9,
            }}
          >
            {rows.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: 9,
                  borderRadius: 9,
                  border: "1px solid #e2e8f0",
                  background: "white",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <strong>
                    {item.passengerName || "-"}
                  </strong>

                  <span
                    style={{
                      color: "#6d28d9",
                      fontWeight: 900,
                    }}
                  >
                    {item.gateCheckNumber || "-"}
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 4,
                    color: "#64748b",
                    fontSize: "0.75rem",
                  }}
                >
                  Seat: {item.assignedSeat || "-"}
                  {" - "}
                  Gate Check Description: {item.carryOnDescription || "Not classified"}
                  {" - "}
                  Counter Weight: {item.counterRecordedWeightLbs || "-"} lb
                  {item.gateVerifiedWeightLbs
                    ? ` - Gate Verified: ${item.gateVerifiedWeightLbs} lb`
                    : ""}
                  {item.compartment
                    ? ` - Compartment: ${item.compartment}`
                    : ""}
                </div>

                {item.offloadReason && (
                  <div
                    style={{
                      marginTop: 4,
                      color: "#991b1b",
                      fontSize: "0.74rem",
                      fontWeight: 800,
                    }}
                  >
                    Offload Reason: {item.offloadReason}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
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

const collapsibleHeaderButton = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: 0,
  border: "none",
  background: "transparent",
  color: "#0f172a",
  fontSize: "1rem",
  fontWeight: 900,
  textAlign: "left",
  cursor: "pointer",
};

const collapsibleCountBadge = {
  minWidth: 34,
  height: 30,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid #c4b5fd",
  background: "white",
  color: "#6d28d9",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.82rem",
  fontWeight: 900,
  flex: "0 0 auto",
};

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


const restoreButton = {
  padding: "9px 13px",
  borderRadius: 10,
  border: "1px solid #2563eb",
  background: "#eff6ff",
  color: "#1d4ed8",
  fontWeight: 900,
  cursor: "pointer",
};

const closeButton = {
  padding: "9px 13px",
  borderRadius: 10,
  border: "1px solid #0f172a",
  background: "#0f172a",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};


const ackButton = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #d97706",
  background: "#fff7ed",
  color: "#9a3412",
  fontWeight: 900,
  cursor: "pointer",
};

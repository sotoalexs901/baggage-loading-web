// src/pages/GateCheckDatabasePage.jsx

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebase";

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function cleanUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeGateCheckNumber(value) {
  return cleanUpper(value)
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

function safeDocId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_");
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
  };
}

function numericGateCheckSort(a, b) {
  const aValue = String(a?.gateCheckNumber || "");
  const bValue = String(b?.gateCheckNumber || "");

  return aValue.localeCompare(
    bValue,
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    }
  );
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

function parseCsvGateChecks(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const candidates = [];

  lines.forEach((line, index) => {
    const columns = line
      .split(/[,\t;]/)
      .map((value) =>
        String(value || "")
          .trim()
          .replace(/^["']|["']$/g, "")
      )
      .filter(Boolean);

    if (columns.length === 0) return;

    const first = normalizeGateCheckNumber(
      columns[0]
    );

    if (
      index === 0 &&
      [
        "GATECHECKNUMBER",
        "GATECHECK",
        "GCNUMBER",
        "GC",
        "NUMBER",
      ].includes(
        first.replace(/-/g, "")
      )
    ) {
      return;
    }

    const value =
      columns
        .map(normalizeGateCheckNumber)
        .find(
          (candidate) =>
            candidate &&
            ![
              "GATECHECKNUMBER",
              "GATECHECK",
              "GCNUMBER",
              "NUMBER",
            ].includes(
              candidate.replace(/-/g, "")
            )
        ) || "";

    if (value) {
      candidates.push(value);
    }
  });

  return Array.from(
    new Set(candidates)
  ).sort((a, b) =>
    a.localeCompare(
      b,
      undefined,
      {
        numeric: true,
      }
    )
  );
}

export default function GateCheckDatabasePage({
  user,
  operationalContext,
}) {
  const role = normalizeRole(
    user?.role
  );

  const actor = useMemo(
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

  const canManage =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "duty_managers" ||
    role === "supervisor";

  const [
    inventory,
    setInventory,
  ] = useState([]);

  const [
    flights,
    setFlights,
  ] = useState([]);

  const [
    flightGateChecks,
    setFlightGateChecks,
  ] = useState([]);

  const [
    selectedFlightId,
    setSelectedFlightId,
  ] = useState("");

  const [
    allocateQuantity,
    setAllocateQuantity,
  ] = useState("20");

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("ALL");

  const [
    csvPreview,
    setCsvPreview,
  ] = useState([]);

  const [
    csvFileName,
    setCsvFileName,
  ] = useState("");

  const [
    manualNumber,
    setManualNumber,
  ] = useState("");

  const [
    editingItem,
    setEditingItem,
  ] = useState(null);

  const [
    editNumber,
    setEditNumber,
  ] = useState("");

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    error,
    setError,
  ] = useState("");

  useEffect(() => {
    const unsub =
      onSnapshot(
        collection(
          db,
          "gateCheckInventory"
        ),
        (snap) => {
          const rows =
            snap.docs.map(
              (item) => ({
                id: item.id,
                ...item.data(),
              })
            );

          rows.sort(
            numericGateCheckSort
          );

          setInventory(rows);
        },
        (snapshotError) => {
          console.error(
            "Gate Check inventory error:",
            snapshotError
          );

          setError(
            "Unable to load Gate Check Database."
          );
        }
      );

    return () =>
      unsub();
  }, []);

  useEffect(() => {
    const unsub =
      onSnapshot(
        collection(
          db,
          "carryOnFlights"
        ),
        (snap) => {
          const rows =
            snap.docs
              .map((item) => ({
                id: item.id,
                ...item.data(),
              }))
              .filter(
                (item) =>
                  item?.isDeleted !==
                  true
              );

          rows.sort((a, b) => {
            const dateCompare =
              String(
                b.flightDate ||
                  ""
              ).localeCompare(
                String(
                  a.flightDate ||
                    ""
                )
              );

            if (dateCompare !== 0) {
              return dateCompare;
            }

            return String(
              a.flightNumber ||
                ""
            ).localeCompare(
              String(
                b.flightNumber ||
                  ""
              )
            );
          });

          setFlights(rows);
        },
        (snapshotError) => {
          console.error(
            "Gate Check database flight list error:",
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
    if (!selectedFlightId) {
      setFlightGateChecks([]);
      return undefined;
    }

    const unsub =
      onSnapshot(
        collection(
          db,
          "carryOnFlights",
          selectedFlightId,
          "gateCheckNumbers"
        ),
        (snap) => {
          const rows =
            snap.docs.map(
              (item) => ({
                id: item.id,
                ...item.data(),
              })
            );

          rows.sort(
            numericGateCheckSort
          );

          setFlightGateChecks(
            rows
          );
        },
        (snapshotError) => {
          console.error(
            "Flight Gate Check inventory error:",
            snapshotError
          );

          setError(
            "Unable to load Gate Checks allocated to this flight."
          );
        }
      );

    return () =>
      unsub();
  }, [
    selectedFlightId,
  ]);

  const selectedFlight =
    useMemo(
      () =>
        flights.find(
          (item) =>
            item.id ===
            selectedFlightId
        ) || null,
      [
        flights,
        selectedFlightId,
      ]
    );

  const counts =
    useMemo(() => {
      return inventory.reduce(
        (result, item) => {
          const status =
            cleanUpper(
              item?.status
            ) || "AVAILABLE";

          result.total += 1;

          if (
            status ===
            "AVAILABLE"
          ) {
            result.available +=
              1;
          } else if (
            status ===
            "ALLOCATED"
          ) {
            result.allocated +=
              1;
          } else if (
            status === "USED"
          ) {
            result.used += 1;
          } else if (
            status ===
            "DISABLED"
          ) {
            result.disabled +=
              1;
          }

          return result;
        },
        {
          total: 0,
          available: 0,
          allocated: 0,
          used: 0,
          disabled: 0,
        }
      );
    }, [
      inventory,
    ]);

  const availableInventory =
    useMemo(
      () =>
        inventory
          .filter(
            (item) =>
              cleanUpper(
                item?.status
              ) ===
              "AVAILABLE"
          )
          .sort(
            numericGateCheckSort
          ),
      [
        inventory,
      ]
    );

  const allocatedToSelectedFlight =
    useMemo(
      () =>
        inventory
          .filter(
            (item) =>
              cleanUpper(
                item?.status
              ) ===
                "ALLOCATED" &&
              item
                ?.allocatedFlightId ===
                selectedFlightId
          )
          .sort(
            numericGateCheckSort
          ),
      [
        inventory,
        selectedFlightId,
      ]
    );

  const filteredInventory =
    useMemo(() => {
      const query =
        String(search || "")
          .trim()
          .toLowerCase();

      return inventory.filter(
        (item) => {
          const status =
            cleanUpper(
              item?.status
            ) || "AVAILABLE";

          if (
            statusFilter !==
              "ALL" &&
            status !==
              statusFilter
          ) {
            return false;
          }

          if (!query) {
            return true;
          }

          return [
            item.gateCheckNumber,
            item.allocatedFlightNumber,
            item.usedFlightNumber,
            item.source,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query);
        }
      );
    }, [
      inventory,
      search,
      statusFilter,
    ]);

  const csvAnalysis =
    useMemo(() => {
      const existing =
        new Set(
          inventory.map(
            (item) =>
              normalizeGateCheckNumber(
                item
                  .gateCheckNumber
              )
          )
        );

      const newNumbers =
        csvPreview.filter(
          (number) =>
            !existing.has(
              normalizeGateCheckNumber(
                number
              )
            )
        );

      const existingNumbers =
        csvPreview.filter(
          (number) =>
            existing.has(
              normalizeGateCheckNumber(
                number
              )
            )
        );

      return {
        newNumbers,
        existingNumbers,
      };
    }, [
      csvPreview,
      inventory,
    ]);

  const handleCsvFile =
    async (event) => {
      setMessage("");
      setError("");

      const file =
        event.target
          .files?.[0];

      if (!file) return;

      try {
        const text =
          await file.text();

        const parsed =
          parseCsvGateChecks(
            text
          );

        setCsvFileName(
          file.name
        );

        setCsvPreview(
          parsed
        );

        if (
          parsed.length === 0
        ) {
          setError(
            "No valid Gate Check numbers were found in the CSV file."
          );
        }
      } catch (
        fileError
      ) {
        console.error(
          "CSV read error:",
          fileError
        );

        setError(
          "Unable to read the CSV file."
        );
      } finally {
        event.target.value =
          "";
      }
    };

  const importCsvNumbers =
    async () => {
      setMessage("");
      setError("");

      if (!canManage) {
        setError(
          "Only Supervisor, Duty Manager or Station Manager can edit the Gate Check Database."
        );

        return;
      }

      if (
        csvAnalysis
          .newNumbers.length ===
        0
      ) {
        setError(
          "There are no new Gate Check numbers to import."
        );

        return;
      }

      try {
        setBusy(true);

        const chunks = [];

        for (
          let index = 0;
          index <
          csvAnalysis
            .newNumbers.length;
          index += 350
        ) {
          chunks.push(
            csvAnalysis
              .newNumbers.slice(
                index,
                index + 350
              )
          );
        }

        for (
          const chunk of chunks
        ) {
          const batch =
            writeBatch(db);

          chunk.forEach(
            (number) => {
              const id =
                safeDocId(
                  number
                );

              batch.set(
                doc(
                  db,
                  "gateCheckInventory",
                  id
                ),
                {
                  gateCheckNumber:
                    number,
                  status:
                    "AVAILABLE",
                  source:
                    "CSV_IMPORT",
                  importFileName:
                    csvFileName ||
                    null,
                  createdAt:
                    serverTimestamp(),
                  createdBy:
                    actor,
                  updatedAt:
                    serverTimestamp(),
                  updatedBy:
                    actor,
                },
                {
                  merge:
                    false,
                }
              );
            }
          );

          await batch.commit();
        }

        await setDoc(
          doc(
            collection(
              db,
              "gateCheckInventoryEvents"
            )
          ),
          {
            type:
              "CSV_IMPORT",
            importedCount:
              csvAnalysis
                .newNumbers
                .length,
            skippedExistingCount:
              csvAnalysis
                .existingNumbers
                .length,
            fileName:
              csvFileName ||
              null,
            createdAt:
              serverTimestamp(),
            createdBy:
              actor,
          }
        );

        setMessage(
          `${csvAnalysis.newNumbers.length} Gate Check number(s) imported. ${csvAnalysis.existingNumbers.length} existing number(s) were skipped.`
        );

        setCsvPreview([]);
        setCsvFileName("");
      } catch (
        importError
      ) {
        console.error(
          "Gate Check CSV import error:",
          importError
        );

        setError(
          importError?.message ||
            "Unable to import Gate Check numbers."
        );
      } finally {
        setBusy(false);
      }
    };

  const addManualNumber =
    async () => {
      setMessage("");
      setError("");

      if (!canManage) {
        setError(
          "You do not have permission to add Gate Check numbers."
        );
        return;
      }

      const number =
        normalizeGateCheckNumber(
          manualNumber
        );

      if (!number) {
        setError(
          "Enter a valid Gate Check number."
        );
        return;
      }

      const duplicate =
        inventory.some(
          (item) =>
            normalizeGateCheckNumber(
              item.gateCheckNumber
            ) === number
        );

      if (duplicate) {
        setError(
          `${number} already exists in the Gate Check Database.`
        );
        return;
      }

      try {
        setBusy(true);

        await setDoc(
          doc(
            db,
            "gateCheckInventory",
            safeDocId(number)
          ),
          {
            gateCheckNumber:
              number,
            status:
              "AVAILABLE",
            source:
              "MANUAL",
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

        setManualNumber("");

        setMessage(
          `${number} added to the Gate Check Database.`
        );
      } catch (
        addError
      ) {
        console.error(
          "Add Gate Check inventory error:",
          addError
        );

        setError(
          addError?.message ||
            "Unable to add Gate Check number."
        );
      } finally {
        setBusy(false);
      }
    };

  const startEdit =
    (item) => {
      if (
        cleanUpper(
          item?.status
        ) !== "AVAILABLE"
      ) {
        setError(
          "Only AVAILABLE Gate Check numbers can be edited. Return or finalize the number first."
        );
        return;
      }

      setEditingItem(item);
      setEditNumber(
        item
          .gateCheckNumber ||
          ""
      );
      setMessage("");
      setError("");
    };

  const saveEdit =
    async () => {
      setMessage("");
      setError("");

      if (
        !canManage ||
        !editingItem
      ) {
        return;
      }

      const nextNumber =
        normalizeGateCheckNumber(
          editNumber
        );

      if (!nextNumber) {
        setError(
          "Enter a valid Gate Check number."
        );
        return;
      }

      const oldNumber =
        normalizeGateCheckNumber(
          editingItem
            .gateCheckNumber
        );

      if (
        nextNumber !==
          oldNumber &&
        inventory.some(
          (item) =>
            item.id !==
              editingItem.id &&
            normalizeGateCheckNumber(
              item
                .gateCheckNumber
            ) ===
              nextNumber
        )
      ) {
        setError(
          `${nextNumber} already exists in the database.`
        );
        return;
      }

      try {
        setBusy(true);

        const batch =
          writeBatch(db);

        const oldRef =
          doc(
            db,
            "gateCheckInventory",
            editingItem.id
          );

        const nextId =
          safeDocId(
            nextNumber
          );

        const nextRef =
          doc(
            db,
            "gateCheckInventory",
            nextId
          );

        batch.set(
          nextRef,
          {
            ...editingItem,
            gateCheckNumber:
              nextNumber,
            correctedFrom:
              oldNumber !==
              nextNumber
                ? oldNumber
                : editingItem
                    .correctedFrom ||
                  null,
            correctedAt:
              oldNumber !==
              nextNumber
                ? serverTimestamp()
                : editingItem
                    .correctedAt ||
                  null,
            correctedBy:
              oldNumber !==
              nextNumber
                ? actor
                : editingItem
                    .correctedBy ||
                  null,
            updatedAt:
              serverTimestamp(),
            updatedBy:
              actor,
          },
          {
            merge: true,
          }
        );

        if (
          nextId !==
          editingItem.id
        ) {
          batch.delete(
            oldRef
          );
        }

        await batch.commit();

        setEditingItem(
          null
        );

        setEditNumber(
          ""
        );

        setMessage(
          oldNumber ===
            nextNumber
            ? `${nextNumber} updated.`
            : `${oldNumber} changed to ${nextNumber}.`
        );
      } catch (
        editError
      ) {
        console.error(
          "Gate Check edit error:",
          editError
        );

        setError(
          editError?.message ||
            "Unable to edit Gate Check number."
        );
      } finally {
        setBusy(false);
      }
    };

  const setDisabled =
    async (
      item,
      disabled
    ) => {
      setMessage("");
      setError("");

      if (!canManage) return;

      const currentStatus =
        cleanUpper(
          item?.status
        );

      if (
        disabled &&
        currentStatus !==
          "AVAILABLE"
      ) {
        setError(
          "Only AVAILABLE Gate Check numbers can be disabled."
        );
        return;
      }

      if (
        !disabled &&
        currentStatus !==
          "DISABLED"
      ) {
        return;
      }

      try {
        await setDoc(
          doc(
            db,
            "gateCheckInventory",
            item.id
          ),
          {
            status:
              disabled
                ? "DISABLED"
                : "AVAILABLE",
            disabledAt:
              disabled
                ? serverTimestamp()
                : null,
            disabledBy:
              disabled
                ? actor
                : null,
            updatedAt:
              serverTimestamp(),
            updatedBy:
              actor,
          },
          {
            merge: true,
          }
        );

        setMessage(
          `${item.gateCheckNumber} ${disabled ? "disabled" : "returned to Available"}.`
        );
      } catch (
        statusError
      ) {
        console.error(
          "Gate Check inventory status error:",
          statusError
        );

        setError(
          statusError?.message ||
            "Unable to update Gate Check status."
        );
      }
    };

  const allocateToFlight =
    async () => {
      setMessage("");
      setError("");

      if (!canManage) {
        setError(
          "You do not have permission to allocate Gate Check numbers."
        );
        return;
      }

      if (!selectedFlight) {
        setError(
          "Select a Carry-On flight."
        );
        return;
      }

      const quantity =
        Number(
          allocateQuantity
        );

      if (
        !Number.isInteger(
          quantity
        ) ||
        quantity <= 0
      ) {
        setError(
          "Enter a valid quantity."
        );
        return;
      }

      if (
        availableInventory
          .length <
        quantity
      ) {
        setError(
          `Only ${availableInventory.length} Gate Check number(s) are currently available.`
        );
        return;
      }

      const chosen =
        availableInventory.slice(
          0,
          quantity
        );

      const ok =
        window.confirm(
          `Allocate the next ${quantity} available Gate Check number(s) to ${selectedFlight.flightNumber || selectedFlight.id}?\n\n` +
            `First: ${chosen[0]?.gateCheckNumber || "-"}\n` +
            `Last: ${chosen[chosen.length - 1]?.gateCheckNumber || "-"}`
        );

      if (!ok) return;

      try {
        setBusy(true);

        const chunks = [];

        for (
          let index = 0;
          index <
          chosen.length;
          index += 180
        ) {
          chunks.push(
            chosen.slice(
              index,
              index + 180
            )
          );
        }

        for (
          const chunk of chunks
        ) {
          const batch =
            writeBatch(db);

          chunk.forEach(
            (item) => {
              batch.set(
                doc(
                  db,
                  "gateCheckInventory",
                  item.id
                ),
                {
                  status:
                    "ALLOCATED",
                  allocatedFlightId:
                    selectedFlight.id,
                  allocatedFlightNumber:
                    selectedFlight
                      .flightNumber ||
                    null,
                  allocatedFlightDate:
                    selectedFlight
                      .flightDate ||
                    null,
                  allocatedAt:
                    serverTimestamp(),
                  allocatedBy:
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

              batch.set(
                doc(
                  db,
                  "carryOnFlights",
                  selectedFlight.id,
                  "gateCheckNumbers",
                  item.id
                ),
                {
                  gateCheckNumber:
                    item
                      .gateCheckNumber,
                  status:
                    "AVAILABLE",
                  source:
                    "MASTER_DATABASE",
                  inventoryId:
                    item.id,
                  allocatedFromDatabaseAt:
                    serverTimestamp(),
                  allocatedFromDatabaseBy:
                    actor,
                },
                {
                  merge:
                    true,
                }
              );
            }
          );

          await batch.commit();
        }

        await setDoc(
          doc(
            collection(
              db,
              "gateCheckInventoryEvents"
            )
          ),
          {
            type:
              "ALLOCATED_TO_FLIGHT",
            flightId:
              selectedFlight.id,
            flightNumber:
              selectedFlight
                .flightNumber ||
              null,
            flightDate:
              selectedFlight
                .flightDate ||
              null,
            quantity:
              chosen.length,
            gateCheckNumbers:
              chosen.map(
                (item) =>
                  item
                    .gateCheckNumber
              ),
            createdAt:
              serverTimestamp(),
            createdBy:
              actor,
          }
        );

        setMessage(
          `${chosen.length} Gate Check number(s) allocated to ${selectedFlight.flightNumber || selectedFlight.id}.`
        );
      } catch (
        allocationError
      ) {
        console.error(
          "Gate Check allocation error:",
          allocationError
        );

        setError(
          allocationError?.message ||
            "Unable to allocate Gate Check numbers."
        );
      } finally {
        setBusy(false);
      }
    };

  const returnUnusedNumber =
    async (item) => {
      setMessage("");
      setError("");

      if (
        !canManage ||
        !selectedFlight
      ) {
        return;
      }

      const flightItem =
        flightGateChecks.find(
          (row) =>
            row.id ===
            item.id
        );

      if (
        cleanUpper(
          flightItem?.status
        ) !== "AVAILABLE"
      ) {
        setError(
          `${item.gateCheckNumber} cannot be returned because it is no longer AVAILABLE on this flight.`
        );
        return;
      }

      try {
        const batch =
          writeBatch(db);

        batch.set(
          doc(
            db,
            "gateCheckInventory",
            item.id
          ),
          {
            status:
              "AVAILABLE",
            allocatedFlightId:
              null,
            allocatedFlightNumber:
              null,
            allocatedFlightDate:
              null,
            returnedAt:
              serverTimestamp(),
            returnedBy:
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

        batch.set(
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id,
            "gateCheckNumbers",
            item.id
          ),
          {
            status:
              "RETURNED_TO_POOL",
            returnedToDatabaseAt:
              serverTimestamp(),
            returnedToDatabaseBy:
              actor,
          },
          {
            merge:
              true,
          }
        );

        await batch.commit();

        setMessage(
          `${item.gateCheckNumber} returned to the Gate Check Database.`
        );
      } catch (
        returnError
      ) {
        console.error(
          "Return Gate Check error:",
          returnError
        );

        setError(
          returnError?.message ||
            "Unable to return Gate Check number."
        );
      }
    };

  const closeFlightInventory =
    async () => {
      setMessage("");
      setError("");

      if (
        !canManage ||
        !selectedFlight
      ) {
        return;
      }

      const allocated =
        allocatedToSelectedFlight;

      if (
        allocated.length ===
        0
      ) {
        setError(
          "This flight has no Gate Check numbers allocated from the database."
        );
        return;
      }

      const flightMap =
        new Map(
          flightGateChecks.map(
            (item) => [
              item.id,
              item,
            ]
          )
        );

      const unused =
        allocated.filter(
          (item) =>
            cleanUpper(
              flightMap.get(
                item.id
              )?.status
            ) ===
            "AVAILABLE"
        );

      const used =
        allocated.filter(
          (item) => {
            const status =
              cleanUpper(
                flightMap.get(
                  item.id
                )?.status
              );

            return (
              status &&
              status !==
                "AVAILABLE" &&
              status !==
                "RETURNED_TO_POOL"
            );
          }
        );

      const unresolved =
        allocated.filter(
          (item) => {
            const status =
              cleanUpper(
                flightMap.get(
                  item.id
                )?.status
              );

            return !status;
          }
        );

      const ok =
        window.confirm(
          `Close Gate Check inventory for ${selectedFlight.flightNumber || selectedFlight.id}?\n\n` +
            `Return to database: ${unused.length}\n` +
            `Mark used/consumed: ${used.length}\n` +
            `Unresolved: ${unresolved.length}\n\n` +
            `Used Gate Check numbers will NOT be reusable.`
        );

      if (!ok) return;

      try {
        setBusy(true);

        const batch =
          writeBatch(db);

        unused.forEach(
          (item) => {
            batch.set(
              doc(
                db,
                "gateCheckInventory",
                item.id
              ),
              {
                status:
                  "AVAILABLE",
                allocatedFlightId:
                  null,
                allocatedFlightNumber:
                  null,
                allocatedFlightDate:
                  null,
                returnedAt:
                  serverTimestamp(),
                returnedBy:
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

            batch.set(
              doc(
                db,
                "carryOnFlights",
                selectedFlight.id,
                "gateCheckNumbers",
                item.id
              ),
              {
                status:
                  "RETURNED_TO_POOL",
                returnedToDatabaseAt:
                  serverTimestamp(),
                returnedToDatabaseBy:
                  actor,
              },
              {
                merge:
                  true,
              }
            );
          }
        );

        used.forEach(
          (item) => {
            const flightItem =
              flightMap.get(
                item.id
              );

            batch.set(
              doc(
                db,
                "gateCheckInventory",
                item.id
              ),
              {
                status:
                  "USED",
                usedFlightId:
                  selectedFlight.id,
                usedFlightNumber:
                  selectedFlight
                    .flightNumber ||
                  null,
                usedFlightDate:
                  selectedFlight
                    .flightDate ||
                  null,
                finalFlightStatus:
                  flightItem?.status ||
                  null,
                usedAt:
                  serverTimestamp(),
                usedBy:
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
          }
        );

        await batch.commit();

        await setDoc(
          doc(
            collection(
              db,
              "gateCheckInventoryEvents"
            )
          ),
          {
            type:
              "FLIGHT_INVENTORY_CLOSED",
            flightId:
              selectedFlight.id,
            flightNumber:
              selectedFlight
                .flightNumber ||
              null,
            returnedCount:
              unused.length,
            usedCount:
              used.length,
            unresolvedCount:
              unresolved.length,
            createdAt:
              serverTimestamp(),
            createdBy:
              actor,
          }
        );

        setMessage(
          `${unused.length} unused Gate Check number(s) returned to the database. ${used.length} used number(s) marked USED.`
        );
      } catch (
        closeError
      ) {
        console.error(
          "Close Gate Check inventory error:",
          closeError
        );

        setError(
          closeError?.message ||
            "Unable to close Gate Check inventory."
        );
      } finally {
        setBusy(false);
      }
    };

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
      }}
    >
      <div>
        <div
          style={{
            color: "#7c3aed",
            fontSize: "0.7rem",
            fontWeight: 900,
            letterSpacing: "0.08em",
          }}
        >
          BLCS INVENTORY
        </div>

        <h3
          style={{
            margin:
              "4px 0 0",
          }}
        >
          Gate Check Database
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
          Master storage for Gate Check numbers. Import, organize, allocate to flights, and return unused numbers for future operations.
        </p>
      </div>

      <div
        style={
          metricGridStyle
        }
      >
        <Metric
          label="Total"
          value={counts.total}
        />
        <Metric
          label="Available"
          value={counts.available}
        />
        <Metric
          label="Allocated"
          value={counts.allocated}
        />
        <Metric
          label="Used"
          value={counts.used}
        />
        <Metric
          label="Disabled"
          value={counts.disabled}
        />
      </div>

      {!canManage && (
        <Notice
          tone="warning"
          text="Read-only access. Supervisor, Duty Manager or Station Manager is required to change Gate Check inventory."
        />
      )}

      <div
        style={
          twoColumnStyle
        }
      >
        <div
          style={panelStyle}
        >
          <h4
            style={{
              margin: 0,
            }}
          >
            Import Gate Checks
          </h4>

          <p style={smallText}>
            Upload a CSV with one Gate Check number per row. A header such as GateCheckNumber, GC Number or Number is optional.
          </p>

          <input
            type="file"
            accept=".csv,text/csv"
            onChange={
              handleCsvFile
            }
            disabled={!canManage}
          />

          {csvFileName && (
            <div
              style={{
                marginTop: 8,
                fontSize: "0.76rem",
                color: "#475569",
                fontWeight: 800,
              }}
            >
              {csvFileName}
            </div>
          )}

          {csvPreview.length >
            0 && (
            <div
              style={{
                marginTop: 10,
                display: "grid",
                gap: 8,
              }}
            >
              <div
                style={
                  previewGridStyle
                }
              >
                <MiniMetric
                  label="Read"
                  value={
                    csvPreview.length
                  }
                />
                <MiniMetric
                  label="New"
                  value={
                    csvAnalysis
                      .newNumbers
                      .length
                  }
                />
                <MiniMetric
                  label="Already Exists"
                  value={
                    csvAnalysis
                      .existingNumbers
                      .length
                  }
                />
              </div>

              <div
                style={
                  csvPreviewBoxStyle
                }
              >
                {csvPreview
                  .slice(0, 40)
                  .map(
                    (number) => (
                      <span
                        key={
                          number
                        }
                        style={
                          numberChipStyle
                        }
                      >
                        {number}
                      </span>
                    )
                  )}

                {csvPreview.length >
                  40 && (
                  <span
                    style={
                      numberChipStyle
                    }
                  >
                    +{csvPreview.length - 40} more
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={
                  importCsvNumbers
                }
                disabled={
                  busy ||
                  !canManage ||
                  csvAnalysis
                    .newNumbers
                    .length ===
                    0
                }
                style={{
                  ...primaryButton,
                  opacity:
                    busy ||
                    !canManage ||
                    csvAnalysis
                      .newNumbers
                      .length ===
                      0
                      ? 0.5
                      : 1,
                }}
              >
                Import New Numbers
              </button>
            </div>
          )}
        </div>

        <div
          style={panelStyle}
        >
          <h4
            style={{
              margin: 0,
            }}
          >
            Add One Manually
          </h4>

          <p style={smallText}>
            Use this for a missing number or a single replacement.
          </p>

          <input
            type="text"
            value={manualNumber}
            onChange={(event) =>
              setManualNumber(
                event.target.value
              )
            }
            placeholder="Example: GC823001"
            style={inputStyle}
            disabled={!canManage}
          />

          <button
            type="button"
            onClick={
              addManualNumber
            }
            disabled={
              busy ||
              !canManage
            }
            style={{
              ...secondaryPurpleButton,
              marginTop: 8,
              width: "100%",
              opacity:
                busy ||
                !canManage
                  ? 0.5
                  : 1,
            }}
          >
            Add to Database
          </button>
        </div>
      </div>

      <div
        style={{
          ...panelStyle,
          border:
            "1px solid #c4b5fd",
          background:
            "#faf5ff",
        }}
      >
        <h4
          style={{
            margin: 0,
            color:
              "#5b21b6",
          }}
        >
          Allocate Gate Checks to Flight
        </h4>

        <p style={smallText}>
          During flight setup, choose the flight and quantity. BLCS takes the next available Gate Check numbers in numeric order and places them in that flight's Gate Check list.
        </p>

        <div
          style={
            allocationGridStyle
          }
        >
          <label
            style={
              fieldStyle
            }
          >
            <span
              style={
                fieldLabel
              }
            >
              Carry-On Flight
            </span>

            <select
              value={
                selectedFlightId
              }
              onChange={(event) =>
                setSelectedFlightId(
                  event.target
                    .value
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
                (flight) => (
                  <option
                    key={
                      flight.id
                    }
                    value={
                      flight.id
                    }
                  >
                    {flight.flightNumber} - {flight.flightDate} - {flight.origin} to {flight.destination}
                  </option>
                )
              )}
            </select>
          </label>

          <label
            style={
              fieldStyle
            }
          >
            <span
              style={
                fieldLabel
              }
            >
              Quantity Needed
            </span>

            <input
              type="number"
              min="1"
              step="1"
              value={
                allocateQuantity
              }
              onChange={(event) =>
                setAllocateQuantity(
                  event.target
                    .value
                )
              }
              style={
                inputStyle
              }
            />
          </label>

          <button
            type="button"
            onClick={
              allocateToFlight
            }
            disabled={
              busy ||
              !canManage ||
              !selectedFlight
            }
            style={{
              ...primaryButton,
              alignSelf:
                "end",
              minHeight: 42,
              opacity:
                busy ||
                !canManage ||
                !selectedFlight
                  ? 0.5
                  : 1,
            }}
          >
            Allocate Next Available
          </button>
        </div>

        {selectedFlight && (
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gap: 9,
            }}
          >
            <div
              style={
                selectedFlightStyle
              }
            >
              <div>
                <strong>
                  {selectedFlight.flightNumber} - {selectedFlight.flightDate}
                </strong>

                <div
                  style={
                    smallText
                  }
                >
                  {selectedFlight.origin} to {selectedFlight.destination}
                  {selectedFlight.gate
                    ? ` | Gate ${selectedFlight.gate}`
                    : ""}
                </div>
              </div>

              <span
                style={
                  purpleBadgeStyle
                }
              >
                {allocatedToSelectedFlight.length} from Database
              </span>
            </div>

            {allocatedToSelectedFlight.length >
            0 ? (
              <>
                <div
                  style={
                    allocationListStyle
                  }
                >
                  {allocatedToSelectedFlight.map(
                    (item) => {
                      const flightItem =
                        flightGateChecks.find(
                          (row) =>
                            row.id ===
                            item.id
                        );

                      const flightStatus =
                        cleanUpper(
                          flightItem
                            ?.status
                        ) ||
                        "UNKNOWN";

                      const canReturn =
                        flightStatus ===
                        "AVAILABLE";

                      return (
                        <div
                          key={
                            item.id
                          }
                          style={
                            allocationRowStyle
                          }
                        >
                          <div>
                            <strong>
                              {item.gateCheckNumber}
                            </strong>

                            <div
                              style={
                                smallText
                              }
                            >
                              Flight status: {flightStatus}
                            </div>
                          </div>

                          {canReturn && (
                            <button
                              type="button"
                              onClick={() =>
                                returnUnusedNumber(
                                  item
                                )
                              }
                              disabled={
                                busy ||
                                !canManage
                              }
                              style={
                                smallReturnButton
                              }
                            >
                              Return
                            </button>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>

                <button
                  type="button"
                  onClick={
                    closeFlightInventory
                  }
                  disabled={
                    busy ||
                    !canManage
                  }
                  style={{
                    ...darkButton,
                    width:
                      "100%",
                    opacity:
                      busy ||
                      !canManage
                        ? 0.5
                        : 1,
                  }}
                >
                  Close Flight Inventory & Return Unused
                </button>
              </>
            ) : (
              <div
                style={
                  emptyStyle
                }
              >
                No Gate Check numbers from the master database are allocated to this flight.
              </div>
            )}
          </div>
        )}
      </div>

      <div
        style={panelStyle}
      >
        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            gap: 10,
            alignItems:
              "center",
            flexWrap:
              "wrap",
          }}
        >
          <div>
            <h4
              style={{
                margin: 0,
              }}
            >
              Master Gate Check Inventory
            </h4>

            <div
              style={
                smallText
              }
            >
              Organized numerically. Used Gate Checks are retained for audit and cannot be reused.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 7,
              flexWrap:
                "wrap",
            }}
          >
            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target
                    .value
                )
              }
              placeholder="Search GC or flight"
              style={{
                ...inputStyle,
                width: 190,
              }}
            />

            <select
              value={
                statusFilter
              }
              onChange={(event) =>
                setStatusFilter(
                  event.target
                    .value
                )
              }
              style={{
                ...inputStyle,
                width: 145,
              }}
            >
              <option value="ALL">
                All
              </option>
              <option value="AVAILABLE">
                Available
              </option>
              <option value="ALLOCATED">
                Allocated
              </option>
              <option value="USED">
                Used
              </option>
              <option value="DISABLED">
                Disabled
              </option>
            </select>
          </div>
        </div>

        {filteredInventory.length ===
        0 ? (
          <div
            style={
              emptyStyle
            }
          >
            No Gate Check numbers match the current filter.
          </div>
        ) : (
          <div
            style={
              inventoryGridStyle
            }
          >
            {filteredInventory.map(
              (item) => {
                const status =
                  cleanUpper(
                    item.status
                  ) ||
                  "AVAILABLE";

                return (
                  <div
                    key={
                      item.id
                    }
                    style={
                      inventoryCardStyle
                    }
                  >
                    <div
                      style={{
                        display:
                          "flex",
                        justifyContent:
                          "space-between",
                        gap: 8,
                        alignItems:
                          "flex-start",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            color:
                              "#0f172a",
                            fontSize:
                              "1rem",
                            fontWeight:
                              900,
                          }}
                        >
                          {item.gateCheckNumber}
                        </div>

                        <div
                          style={{
                            marginTop: 5,
                          }}
                        >
                          <StatusBadge
                            status={
                              status
                            }
                          />
                        </div>
                      </div>

                      {status ===
                        "AVAILABLE" &&
                        canManage && (
                          <button
                            type="button"
                            onClick={() =>
                              startEdit(
                                item
                              )
                            }
                            style={
                              editButton
                            }
                          >
                            Edit
                          </button>
                        )}
                    </div>

                    {status ===
                      "ALLOCATED" && (
                      <div
                        style={
                          cardMetaStyle
                        }
                      >
                        Flight: {item.allocatedFlightNumber || "-"}
                        <br />
                        Date: {item.allocatedFlightDate || "-"}
                      </div>
                    )}

                    {status ===
                      "USED" && (
                      <div
                        style={
                          cardMetaStyle
                        }
                      >
                        Used: {item.usedFlightNumber || "-"}
                        <br />
                        Date: {item.usedFlightDate || "-"}
                      </div>
                    )}

                    {item.correctedFrom && (
                      <div
                        style={
                          correctionStyle
                        }
                      >
                        Corrected from: {item.correctedFrom}
                      </div>
                    )}

                    {status ===
                      "AVAILABLE" &&
                      canManage && (
                      <button
                        type="button"
                        onClick={() =>
                          setDisabled(
                            item,
                            true
                          )
                        }
                        style={{
                          ...smallDisableButton,
                          marginTop: 8,
                        }}
                      >
                        Disable
                      </button>
                    )}

                    {status ===
                      "DISABLED" &&
                      canManage && (
                      <button
                        type="button"
                        onClick={() =>
                          setDisabled(
                            item,
                            false
                          )
                        }
                        style={{
                          ...smallReturnButton,
                          marginTop: 8,
                          width: "100%",
                        }}
                      >
                        Return to Available
                      </button>
                    )}
                  </div>
                );
              }
            )}
          </div>
        )}
      </div>

      {editingItem && (
        <div
          style={
            modalOverlay
          }
        >
          <div
            style={
              modalCard
            }
          >
            <h3
              style={{
                margin: 0,
              }}
            >
              Edit Gate Check Number
            </h3>

            <p style={smallText}>
              Use this to correct a number that was read incorrectly during CSV import. Only AVAILABLE numbers can be changed.
            </p>

            <input
              type="text"
              value={editNumber}
              onChange={(event) =>
                setEditNumber(
                  event.target
                    .value
                )
              }
              style={inputStyle}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "1fr 1fr",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setEditingItem(
                    null
                  );
                  setEditNumber(
                    ""
                  );
                }}
                style={
                  secondaryButton
                }
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  saveEdit
                }
                disabled={
                  busy
                }
                style={
                  primaryButton
                }
              >
                Save Correction
              </button>
            </div>
          </div>
        </div>
      )}

      {(message ||
        error) && (
        <div
          style={{
            ...noticeOverlay,
            border:
              error
                ? "2px solid #ef4444"
                : "2px solid #22c55e",
          }}
        >
          <strong>
            {error
              ? "Action Required"
              : "Completed"}
          </strong>

          <div
            style={{
              marginTop: 5,
              whiteSpace:
                "pre-wrap",
          }}
          >
            {error ||
              message}
          </div>

          <button
            type="button"
            onClick={() => {
              setError("");
              setMessage("");
            }}
            style={{
              ...primaryButton,
              width: "100%",
              marginTop: 10,
              background:
                error
                  ? "#dc2626"
                  : "#16a34a",
              border:
                error
                  ? "1px solid #dc2626"
                  : "1px solid #16a34a",
            }}
          >
            Close
          </button>
        </div>
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
      style={
        metricCardStyle
      }
    >
      <div
        style={{
          color:
            "#64748b",
          fontSize:
            "0.68rem",
          fontWeight:
            800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 3,
          color:
            "#0f172a",
          fontSize:
            "1.2rem",
          fontWeight:
            900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
}) {
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 9,
        border:
          "1px solid #e2e8f0",
        background:
          "white",
      }}
    >
      <div
        style={{
          color:
            "#64748b",
          fontSize:
            "0.65rem",
          fontWeight:
            800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 2,
          fontWeight:
            900,
          color:
            "#0f172a",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
}) {
  const map = {
    AVAILABLE: {
      background:
        "#dcfce7",
      color:
        "#166534",
      border:
        "#86efac",
    },
    ALLOCATED: {
      background:
        "#ede9fe",
      color:
        "#5b21b6",
      border:
        "#c4b5fd",
    },
    USED: {
      background:
        "#e2e8f0",
      color:
        "#334155",
      border:
        "#cbd5e1",
    },
    DISABLED: {
      background:
        "#fee2e2",
      color:
        "#991b1b",
      border:
        "#fecaca",
    },
  };

  const style =
    map[status] ||
    map.AVAILABLE;

  return (
    <span
      style={{
        display:
          "inline-flex",
        padding:
          "4px 7px",
        borderRadius:
          999,
        background:
          style.background,
        color:
          style.color,
        border:
          `1px solid ${style.border}`,
        fontSize:
          "0.64rem",
        fontWeight:
          900,
      }}
    >
      {status}
    </span>
  );
}

function Notice({
  tone,
  text,
}) {
  const warning =
    tone ===
    "warning";

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background:
          warning
            ? "#fffbeb"
            : "#f8fafc",
        border:
          warning
            ? "1px solid #fde68a"
            : "1px solid #e2e8f0",
        color:
          warning
            ? "#92400e"
            : "#475569",
        fontSize:
          "0.82rem",
        fontWeight:
          800,
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
  background:
    "#f8fafc",
};

const metricGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(110px, 1fr))",
  gap: 8,
};

const metricCardStyle = {
  padding: 10,
  borderRadius: 11,
  border:
    "1px solid #e2e8f0",
  background:
    "white",
};

const twoColumnStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 10,
};

const allocationGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "minmax(260px, 1.5fr) minmax(140px, 0.5fr) auto",
  gap: 9,
  alignItems: "end",
};

const fieldStyle = {
  display: "grid",
  gap: 5,
};

const fieldLabel = {
  color: "#475569",
  fontSize: "0.72rem",
  fontWeight: 900,
};

const smallText = {
  margin: "6px 0 0",
  color: "#64748b",
  fontSize: "0.76rem",
  lineHeight: 1.4,
};

const inputStyle = {
  width: "100%",
  boxSizing:
    "border-box",
  padding: "10px 11px",
  borderRadius: 10,
  border:
    "1px solid #cbd5e1",
  background:
    "white",
  fontSize: "0.88rem",
};

const primaryButton = {
  padding: "10px 13px",
  borderRadius: 10,
  border:
    "1px solid #7c3aed",
  background:
    "#7c3aed",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryPurpleButton = {
  padding: "9px 12px",
  borderRadius: 10,
  border:
    "1px solid #c4b5fd",
  background:
    "#f5f3ff",
  color: "#6d28d9",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryButton = {
  padding: "9px 12px",
  borderRadius: 10,
  border:
    "1px solid #cbd5e1",
  background:
    "white",
  color: "#334155",
  fontWeight: 900,
  cursor: "pointer",
};

const darkButton = {
  padding: "10px 13px",
  borderRadius: 10,
  border:
    "1px solid #0f172a",
  background:
    "#0f172a",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const editButton = {
  padding: "6px 9px",
  borderRadius: 8,
  border:
    "1px solid #c4b5fd",
  background:
    "#f5f3ff",
  color: "#6d28d9",
  fontSize: "0.7rem",
  fontWeight: 900,
  cursor: "pointer",
};

const smallReturnButton = {
  padding: "6px 9px",
  borderRadius: 8,
  border:
    "1px solid #86efac",
  background:
    "#f0fdf4",
  color: "#166534",
  fontSize: "0.7rem",
  fontWeight: 900,
  cursor: "pointer",
};

const smallDisableButton = {
  width: "100%",
  padding: "6px 9px",
  borderRadius: 8,
  border:
    "1px solid #fecaca",
  background:
    "#fff7f7",
  color: "#991b1b",
  fontSize: "0.7rem",
  fontWeight: 900,
  cursor: "pointer",
};

const previewGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(3, 1fr)",
  gap: 7,
};

const csvPreviewBoxStyle = {
  maxHeight: 135,
  overflowY: "auto",
  display: "flex",
  gap: 5,
  flexWrap: "wrap",
  padding: 8,
  borderRadius: 10,
  background: "white",
  border:
    "1px solid #e2e8f0",
};

const numberChipStyle = {
  padding: "4px 7px",
  borderRadius: 999,
  background:
    "#f5f3ff",
  border:
    "1px solid #ddd6fe",
  color: "#5b21b6",
  fontSize: "0.68rem",
  fontWeight: 900,
};

const selectedFlightStyle = {
  padding: 10,
  borderRadius: 10,
  border:
    "1px solid #ddd6fe",
  background:
    "white",
  display: "flex",
  justifyContent:
    "space-between",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

const purpleBadgeStyle = {
  display: "inline-flex",
  padding: "5px 9px",
  borderRadius: 999,
  background:
    "#ede9fe",
  color: "#5b21b6",
  border:
    "1px solid #c4b5fd",
  fontSize: "0.7rem",
  fontWeight: 900,
};

const allocationListStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(145px, 1fr))",
  gap: 7,
};

const allocationRowStyle = {
  padding: 9,
  borderRadius: 10,
  border:
    "1px solid #e2e8f0",
  background:
    "white",
  display: "flex",
  justifyContent:
    "space-between",
  gap: 8,
  alignItems: "center",
};

const inventoryGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fill, minmax(160px, 1fr))",
  gap: 8,
  marginTop: 11,
};

const inventoryCardStyle = {
  padding: 10,
  borderRadius: 11,
  border:
    "1px solid #e2e8f0",
  background:
    "white",
  boxShadow:
    "0 1px 2px rgba(15,23,42,0.04)",
};

const cardMetaStyle = {
  marginTop: 7,
  color: "#64748b",
  fontSize: "0.68rem",
  lineHeight: 1.45,
};

const correctionStyle = {
  marginTop: 7,
  padding: "5px 7px",
  borderRadius: 7,
  background:
    "#fffbeb",
  border:
    "1px solid #fde68a",
  color: "#92400e",
  fontSize: "0.65rem",
  fontWeight: 800,
};

const emptyStyle = {
  marginTop: 10,
  padding: 11,
  borderRadius: 10,
  border:
    "1px dashed #cbd5e1",
  color: "#64748b",
  fontSize: "0.78rem",
  textAlign: "center",
};

const modalOverlay = {
  position: "fixed",
  inset: 0,
  zIndex: 13000,
  background:
    "rgba(15,23,42,0.64)",
  display: "flex",
  alignItems: "center",
  justifyContent:
    "center",
  padding: 14,
};

const modalCard = {
  width:
    "min(460px, 100%)",
  padding: 16,
  borderRadius: 16,
  background:
    "white",
  border:
    "1px solid #cbd5e1",
  boxShadow:
    "0 24px 70px rgba(15,23,42,0.35)",
};

const noticeOverlay = {
  position: "fixed",
  zIndex: 14000,
  left: "50%",
  top: "50%",
  transform:
    "translate(-50%, -50%)",
  width:
    "min(420px, calc(100% - 28px))",
  padding: 16,
  borderRadius: 16,
  background:
    "white",
  color: "#0f172a",
  boxShadow:
    "0 24px 70px rgba(15,23,42,0.35)",
  textAlign: "center",
  fontSize: "0.82rem",
};

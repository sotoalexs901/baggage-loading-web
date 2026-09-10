// src/pages/CarryOnGateCheckPage.jsx

import React, {
  useMemo,
  useState,
} from "react";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebase";

import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  pdfWorker;

/* =========================
   CONSTANTS
========================= */

const TABS = [
  "SETUP",
  "COUNTER",
  "GATE",
  "RAMP",
  "TRACKING",
  "REPORT",
];

const MAX_BATCH_WRITES = 400;

/* =========================
   BASIC HELPERS
========================= */

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

function normalizeFlightNumber(
  airline,
  number
) {
  const carrier =
    cleanUpper(airline)
      .replace(/[^A-Z0-9]/g, "");

  const flight =
    String(number || "")
      .trim()
      .replace(/[^0-9]/g, "");

  return `${carrier}${flight}`;
}

function normalizeGateCheckNumber(
  value
) {
  return cleanUpper(value)
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

function normalizeSeat(value) {
  return cleanUpper(value)
    .replace(/\s+/g, "");
}

function safeDocId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_");
}

function buildCarryOnFlightId(
  flightNumber,
  flightDate
) {
  return safeDocId(
    `${flightNumber}_${flightDate}`
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

/* =========================
   PDF TEXT
========================= */

async function readPdfDocumentData(
  file
) {
  const arrayBuffer =
    await file.arrayBuffer();

  const pdf =
    await pdfjsLib
      .getDocument({
        data:
          arrayBuffer,
      })
      .promise;

  let fullText =
    "";

  const lines =
    [];

  for (
    let pageNumber = 1;
    pageNumber <=
    pdf.numPages;
    pageNumber += 1
  ) {
    const page =
      await pdf.getPage(
        pageNumber
      );

    const content =
      await page.getTextContent();

    /*
     * PDF text items are not guaranteed to arrive in the same
     * order that they appear visually on the page.
     *
     * For manifests we rebuild visual rows using the Y coordinate,
     * then sort each row from left to right.
     */
    const rowMap =
      new Map();

    for (
      const item of
        content.items
    ) {
      const value =
        String(
          item?.str ||
          ""
        ).trim();

      if (!value) {
        continue;
      }

      const transform =
        Array.isArray(
          item?.transform
        )
          ? item.transform
          : [];

      const x =
        Number(
          transform?.[4] ||
          0
        );

      const y =
        Number(
          transform?.[5] ||
          0
        );

      /*
       * Rounding Y to the nearest 2 points gives enough tolerance
       * for text items that belong to the same printed table row.
       */
      const yKey =
        Math.round(
          y / 2
        ) * 2;

      if (
        !rowMap.has(
          yKey
        )
      ) {
        rowMap.set(
          yKey,
          []
        );
      }

      rowMap
        .get(
          yKey
        )
        .push({
          x,
          value,
        });
    }

    const pageRows =
      Array.from(
        rowMap.entries()
      )
        .sort(
          (
            a,
            b
          ) =>
            b[0] -
            a[0]
        )
        .map(
          (
            [
              ,
              items,
            ]
          ) =>
            items
              .sort(
                (
                  a,
                  b
                ) =>
                  a.x -
                  b.x
              )
              .map(
                (
                  item
                ) =>
                  item.value
              )
              .join(
                " "
              )
              .replace(
                /\s+/g,
                " "
              )
              .trim()
        )
        .filter(
          Boolean
        );

    lines.push(
      ...pageRows
    );

    fullText +=
      `${pageRows.join("\n")}\n`;
  }

  return {
    fullText,
    lines,
  };
}

/* =========================
   FLIGHT META PARSER
========================= */

function parseFlightMeta(
  text
) {
  const source =
    String(text || "");

  const flightMatch =
    source.match(
      /Flight:\s*([A-Z0-9]{2,3})\s*([0-9]{1,4})/i
    );

  const originMatch =
    source.match(
      /Origin:\s*([A-Z]{3})\b/i
    );

  const destinationMatch =
    source.match(
      /Destination:\s*([A-Z]{3})\b/i
    );

  const stdMatch =
    source.match(
      /STD:\s*([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4})\s*@\s*([0-9]{1,2}:[0-9]{2})/i
    );

  const aircraftMatch =
    source.match(
      /Aircraft:\s*([^\n\r]+?)(?=\s+Origin:|\n|$)/i
    );

  const airline =
    flightMatch?.[1]
      ? cleanUpper(
          flightMatch[1]
        )
      : "";

  const flightNumberOnly =
    flightMatch?.[2]
      ? String(
          flightMatch[2]
        )
      : "";

  const flightNumber =
    airline &&
    flightNumberOnly
      ? normalizeFlightNumber(
          airline,
          flightNumberOnly
        )
      : "";

  let flightDate =
    "";

  if (
    stdMatch?.[1]
  ) {
    const parsed =
      new Date(
        `${stdMatch[1]} 00:00:00`
      );

    if (
      !Number.isNaN(
        parsed.getTime()
      )
    ) {
      const year =
        parsed.getFullYear();

      const month =
        String(
          parsed.getMonth() + 1
        ).padStart(
          2,
          "0"
        );

      const day =
        String(
          parsed.getDate()
        ).padStart(
          2,
          "0"
        );

      flightDate =
        `${year}-${month}-${day}`;
    }
  }

  return {
    airline,

    flightNumberOnly,

    flightNumber,

    flightDate,

    origin:
      originMatch?.[1]
        ? cleanUpper(
            originMatch[1]
          )
        : "",

    destination:
      destinationMatch?.[1]
        ? cleanUpper(
            destinationMatch[1]
          )
        : "",

    stdTime:
      stdMatch?.[2] ||
      "",

    aircraft:
      aircraftMatch?.[1]
        ? String(
            aircraftMatch[1]
          ).trim()
        : "",
  };
}

/* =========================
   PASSENGER MANIFEST PARSER
========================= */

function parsePassengerManifest(
  documentData
) {
  const lines =
    Array.isArray(
      documentData?.lines
    )
      ? documentData.lines
      : String(
          documentData?.fullText ||
          documentData ||
          ""
        )
          .split(
            /\n+/
          )
          .map(
            (
              line
            ) =>
              line.trim()
          )
          .filter(
            Boolean
          );

  const passengers =
    [];

  const seen =
    new Set();

  /*
   * We detect rows by their stable manifest structure:
   *
   * Seq + SEC + PNR + passenger name + DOB + Gender + Dest + Seat
   *
   * Example:
   * 34 C QZL81I ALFONSO VALDES ELIAN 03-Dec-1999 M HAV 11B 7
   *
   * This does not depend on bag count, bag tags, PNR remarks or
   * other columns after Seat.
   */
  const rowRegex =
    /^(\d{1,3})\s+[A-Z]\s+[A-Z0-9]{4,10}\s+(.+?)\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+[MF]\s+[A-Z]{3}\s+(\d{1,2}[A-F])(?:\s|$)/i;

  for (
    let index = 0;
    index <
    lines.length;
    index += 1
  ) {
    let line =
      String(
        lines[index] ||
        ""
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (!line) {
      continue;
    }

    let match =
      line.match(
        rowRegex
      );

    /*
     * Some passenger names wrap to a second visual line in the PDF.
     * If the first row starts with Seq/SEC/PNR but does not yet contain
     * the DOB/seat fields, join the next visual row and try again.
     */
    if (
      !match &&
      /^\d{1,3}\s+[A-Z]\s+[A-Z0-9]{4,10}\s+/i.test(
        line
      ) &&
      index + 1 <
        lines.length
    ) {
      const combined =
        `${line} ${String(
          lines[
            index + 1
          ] ||
          ""
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim()}`;

      const combinedMatch =
        combined.match(
          rowRegex
        );

      if (
        combinedMatch
      ) {
        line =
          combined;

        match =
          combinedMatch;

        index +=
          1;
      }
    }

    if (!match) {
      continue;
    }

    const sequence =
      String(
        match[1]
      );

    const rawName =
      String(
        match[2] ||
        ""
      )
        .trim()
        .replace(
          /\s+/g,
          " "
        );

    const originalSeat =
      normalizeSeat(
        match[4]
      );

    if (
      !rawName ||
      !originalSeat
    ) {
      continue;
    }

    const key =
      `${sequence}_${rawName}_${originalSeat}`;

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    passengers.push({
      id:
        safeDocId(
          `PAX_${sequence}`
        ),

      sequence,

      passengerName:
        rawName,

      originalSeat,

      source:
        "MANIFEST",
    });
  }

  /*
   * Fallback:
   * If visual row reconstruction still yields nothing, try the
   * complete text as one stream. This keeps the parser resilient
   * across slightly different PDF generators.
   */
  if (
    passengers.length ===
    0
  ) {
    const source =
      String(
        documentData?.fullText ||
        ""
      )
        .replace(
          /\r/g,
          " "
        )
        .replace(
          /\n+/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        );

    const fallbackRegex =
      /\b(\d{1,3})\s+[A-Z]\s+[A-Z0-9]{4,10}\s+(.+?)\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+[MF]\s+[A-Z]{3}\s+(\d{1,2}[A-F])\b/gi;

    let match =
      fallbackRegex.exec(
        source
      );

    while (
      match
    ) {
      const sequence =
        String(
          match[1]
        );

      const rawName =
        String(
          match[2] ||
          ""
        )
          .trim()
          .replace(
            /\s+/g,
            " "
          );

      const originalSeat =
        normalizeSeat(
          match[4]
        );

      const key =
        `${sequence}_${rawName}_${originalSeat}`;

      if (
        rawName &&
        originalSeat &&
        !seen.has(
          key
        )
      ) {
        seen.add(
          key
        );

        passengers.push({
          id:
            safeDocId(
              `PAX_${sequence}`
            ),

          sequence,

          passengerName:
            rawName,

          originalSeat,

          source:
            "MANIFEST",
        });
      }

      match =
        fallbackRegex.exec(
          source
        );
    }
  }

  return passengers;
}

/* =========================
   EMPTY SEAT PARSER
========================= */

function parseEmptySeats(
  text
) {
  const source =
    String(text || "")
      .replace(/\r/g, " ")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ");

  const seats =
    [];

  const seen =
    new Set();

  /*
   * Empty Seats Report shape:
   * Seat No. Seat Type Blocked Seat? Remarks
   *
   * If the word YES immediately follows the seat
   * type, treat the seat as blocked and exclude it
   * from assignable inventory.
   */
  const regex =
    /\b(\d{1,2}[A-F])\s+(Premium|Standard|Emergency)\b(?:\s+(Yes|No))?/gi;

  let match =
    regex.exec(
      source
    );

  while (match) {
    const seatNumber =
      normalizeSeat(
        match[1]
      );

    const seatType =
      cleanUpper(
        match[2]
      );

    const blocked =
      cleanUpper(
        match[3]
      ) ===
      "YES";

    if (
      seatNumber &&
      !seen.has(
        seatNumber
      )
    ) {
      seen.add(
        seatNumber
      );

      seats.push({
        id:
          safeDocId(
            seatNumber
          ),

        seatNumber,

        seatType,

        blocked,

        status:
          blocked
            ? "BLOCKED"
            : "AVAILABLE",
      });
    }

    match =
      regex.exec(
        source
      );
  }

  return seats;
}

/* =========================
   DOCUMENT MATCH
========================= */

function compareDocuments(
  passengerMeta,
  emptySeatMeta
) {
  const fields = [
    {
      key:
        "flightNumber",

      label:
        "Flight",
    },

    {
      key:
        "flightDate",

      label:
        "Date",
    },

    {
      key:
        "origin",

      label:
        "Origin",
    },

    {
      key:
        "destination",

      label:
        "Destination",
    },
  ];

  const mismatches =
    [];

  for (
    const field of
      fields
  ) {
    const left =
      cleanUpper(
        passengerMeta?.[
          field.key
        ]
      );

    const right =
      cleanUpper(
        emptySeatMeta?.[
          field.key
        ]
      );

    if (
      left &&
      right &&
      left !== right
    ) {
      mismatches.push({
        label:
          field.label,

        passengerValue:
          left,

        emptySeatValue:
          right,
      });
    }
  }

  const missingCritical =
    fields.filter(
      (
        field
      ) =>
        !passengerMeta?.[
          field.key
        ] ||
        !emptySeatMeta?.[
          field.key
        ]
    );

  return {
    ok:
      mismatches.length ===
        0 &&
      missingCritical.length ===
        0,

    mismatches,

    missingCritical,
  };
}

/* =========================
   FIRESTORE BATCH HELPER
========================= */

async function commitWrites(
  operations
) {
  for (
    let index = 0;
    index <
    operations.length;
    index +=
      MAX_BATCH_WRITES
  ) {
    const batch =
      writeBatch(
        db
      );

    const chunk =
      operations.slice(
        index,
        index +
          MAX_BATCH_WRITES
      );

    for (
      const operation
        of chunk
    ) {
      batch.set(
        operation.ref,
        operation.data,
        operation.options
      );
    }

    await batch.commit();
  }
}

/* =========================
   MAIN PAGE
========================= */

export default function CarryOnGateCheckPage({
  user,
  operationalContext,
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

  const canUploadDocuments =
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor";

  const canSetRequired =
    role ===
      "station_manager" ||
    role ===
      "supervisor";

  const canManageGateChecks =
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor";

  const [
    activeTab,
    setActiveTab,
  ] = useState(
    "SETUP"
  );

  const [
    passengerFile,
    setPassengerFile,
  ] = useState(
    null
  );

  const [
    emptySeatFile,
    setEmptySeatFile,
  ] = useState(
    null
  );

  const [
    passengerMeta,
    setPassengerMeta,
  ] = useState(
    null
  );

  const [
    emptySeatMeta,
    setEmptySeatMeta,
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
    emptySeats,
    setEmptySeats,
  ] = useState(
    []
  );

  const [
    requiredCarryOns,
    setRequiredCarryOns,
  ] = useState(
    ""
  );

  const [
    gateCheckText,
    setGateCheckText,
  ] = useState(
    ""
  );

  const [
    parsingPassenger,
    setParsingPassenger,
  ] = useState(
    false
  );

  const [
    parsingSeats,
    setParsingSeats,
  ] = useState(
    false
  );

  const [
    savingSetup,
    setSavingSetup,
  ] = useState(
    false
  );

  const [
    setupMessage,
    setSetupMessage,
  ] = useState(
    ""
  );

  const [
    setupError,
    setSetupError,
  ] = useState(
    ""
  );

  const displayName =
    operationalContext
      ?.employeeFullName ||
    user?.fullName ||
    user?.username ||
    "-";

  const positionLabel =
    operationalContext
      ?.operationalPositionLabel ||
    operationalContext
      ?.operationalPosition ||
    null;

  const documentMatch =
    useMemo(
      () =>
        passengerMeta &&
        emptySeatMeta
          ? compareDocuments(
              passengerMeta,
              emptySeatMeta
            )
          : null,
      [
        passengerMeta,
        emptySeatMeta,
      ]
    );

  const availableSeats =
    useMemo(
      () =>
        emptySeats.filter(
          (
            seat
          ) =>
            seat.blocked !==
              true &&
            seat.status ===
              "AVAILABLE"
        ),
      [
        emptySeats,
      ]
    );

  const gateCheckNumbers =
    useMemo(
      () => {
        const seen =
          new Set();

        return String(
          gateCheckText ||
          ""
        )
          .split(
            /[\s,;\n]+/
          )
          .map(
            (
              value
            ) =>
              normalizeGateCheckNumber(
                value
              )
          )
          .filter(
            (
              value
            ) => {
              if (
                !value ||
                seen.has(
                  value
                )
              ) {
                return false;
              }

              seen.add(
                value
              );

              return true;
            }
          );
      },
      [
        gateCheckText,
      ]
    );

  const requiredNumber =
    Number(
      requiredCarryOns
    );

  const validRequiredNumber =
    Number.isFinite(
      requiredNumber
    ) &&
    requiredNumber >=
      0;

  const setupFlightMeta =
    documentMatch?.ok
      ? passengerMeta
      : null;

  const handlePassengerPdf =
    async (
      file
    ) => {
      if (!file) {
        return;
      }

      setSetupError(
        ""
      );

      setSetupMessage(
        ""
      );

      try {
        setParsingPassenger(
          true
        );

        const documentData =
          await readPdfDocumentData(
            file
          );

        const meta =
          parseFlightMeta(
            documentData.fullText
          );

        const parsedPassengers =
          parsePassengerManifest(
            documentData
          );

        if (
          !meta.flightNumber ||
          !meta.flightDate
        ) {
          throw new Error(
            "Unable to identify flight number/date from Passenger Manifest."
          );
        }

        if (
          parsedPassengers.length ===
          0
        ) {
          throw new Error(
            "No passengers could be extracted from Passenger Manifest."
          );
        }

        setPassengerFile(
          file
        );

        setPassengerMeta(
          meta
        );

        setPassengers(
          parsedPassengers
        );

        setSetupMessage(
          `Passenger Manifest parsed: ${parsedPassengers.length} passenger(s).`
        );
      } catch (
        error
      ) {
        console.error(
          "Passenger manifest parse error:",
          error
        );

        setPassengerFile(
          null
        );

        setPassengerMeta(
          null
        );

        setPassengers(
          []
        );

        setSetupError(
          error?.message ||
          "Unable to parse Passenger Manifest."
        );
      } finally {
        setParsingPassenger(
          false
        );
      }
    };

  const handleEmptySeatPdf =
    async (
      file
    ) => {
      if (!file) {
        return;
      }

      setSetupError(
        ""
      );

      setSetupMessage(
        ""
      );

      try {
        setParsingSeats(
          true
        );

        const documentData =
          await readPdfDocumentData(
            file
          );

        const meta =
          parseFlightMeta(
            documentData.fullText
          );

        const parsedSeats =
          parseEmptySeats(
            documentData.fullText
          );

        if (
          !meta.flightNumber ||
          !meta.flightDate
        ) {
          throw new Error(
            "Unable to identify flight number/date from Empty Seats Report."
          );
        }

        if (
          parsedSeats.length ===
          0
        ) {
          throw new Error(
            "No empty seats could be extracted from Empty Seats Report."
          );
        }

        setEmptySeatFile(
          file
        );

        setEmptySeatMeta(
          meta
        );

        setEmptySeats(
          parsedSeats
        );

        setSetupMessage(
          `Empty Seats Report parsed: ${parsedSeats.length} seat(s).`
        );
      } catch (
        error
      ) {
        console.error(
          "Empty seats parse error:",
          error
        );

        setEmptySeatFile(
          null
        );

        setEmptySeatMeta(
          null
        );

        setEmptySeats(
          []
        );

        setSetupError(
          error?.message ||
          "Unable to parse Empty Seats Report."
        );
      } finally {
        setParsingSeats(
          false
        );
      }
    };

  const saveSetup =
    async () => {
      setSetupError(
        ""
      );

      setSetupMessage(
        ""
      );

      if (
        !canManageGateChecks
      ) {
        setSetupError(
          "You do not have permission to create or update Carry-On flight setup."
        );

        return;
      }

      if (
        !documentMatch?.ok
      ) {
        setSetupError(
          "Passenger Manifest and Empty Seats Report must belong to the same flight before setup can be saved."
        );

        return;
      }

      if (
        passengers.length ===
        0
      ) {
        setSetupError(
          "Passenger list is empty."
        );

        return;
      }

      if (
        availableSeats.length ===
        0
      ) {
        setSetupError(
          "Available seat list is empty."
        );

        return;
      }

      if (
        !validRequiredNumber
      ) {
        setSetupError(
          "Enter a valid Required Carry-On Gate Checks value."
        );

        return;
      }

      const flightNumber =
        setupFlightMeta
          ?.flightNumber;

      const flightDate =
        setupFlightMeta
          ?.flightDate;

      const carryOnFlightId =
        buildCarryOnFlightId(
          flightNumber,
          flightDate
        );

      const flightRef =
        doc(
          db,
          "carryOnFlights",
          carryOnFlightId
        );

      try {
        setSavingSetup(
          true
        );

        const existingSnap =
          await getDoc(
            flightRef
          );

        if (
          existingSnap.exists()
        ) {
          const existing =
            existingSnap.data();

          const existingStatus =
            cleanUpper(
              existing?.status
            );

          if (
            existingStatus &&
            existingStatus !==
              "SETUP" &&
            existingStatus !==
              "READY"
          ) {
            throw new Error(
              "This Carry-On flight already has an active operation. Setup cannot overwrite an in-progress flight."
            );
          }
        }

        await setDoc(
          flightRef,
          {
            flightNumber,

            flightDate,

            airline:
              setupFlightMeta
                ?.airline ||
              null,

            origin:
              setupFlightMeta
                ?.origin ||
              null,

            destination:
              setupFlightMeta
                ?.destination ||
              null,

            stdTime:
              setupFlightMeta
                ?.stdTime ||
              null,

            aircraft:
              setupFlightMeta
                ?.aircraft ||
              emptySeatMeta
                ?.aircraft ||
              null,

            status:
              gateCheckNumbers.length >
              0
                ? "READY"
                : "SETUP",

            requiredCarryOns:
              Math.trunc(
                requiredNumber
              ),

            passengerCount:
              passengers.length,

            availableSeatCount:
              availableSeats.length,

            gateCheckNumberCount:
              gateCheckNumbers.length,

            documents: {
              passengerManifest: {
                fileName:
                  passengerFile
                    ?.name ||
                  null,

                parsedAt:
                  serverTimestamp(),

                passengerCount:
                  passengers.length,
              },

              emptySeatsReport: {
                fileName:
                  emptySeatFile
                    ?.name ||
                  null,

                parsedAt:
                  serverTimestamp(),

                availableSeatCount:
                  availableSeats.length,
              },
            },

            createdAt:
              existingSnap.exists()
                ? existingSnap
                    .data()
                    ?.createdAt ||
                  serverTimestamp()
                : serverTimestamp(),

            createdBy:
              existingSnap.exists()
                ? existingSnap
                    .data()
                    ?.createdBy ||
                  actor
                : actor,

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

        const operations =
          [];

        for (
          const passenger of
            passengers
        ) {
          operations.push({
            ref:
              doc(
                db,
                "carryOnFlights",
                carryOnFlightId,
                "passengers",
                passenger.id
              ),

            data: {
              ...passenger,

              assigned:
                false,

              updatedAt:
                serverTimestamp(),
            },

            options: {
              merge:
                true,
            },
          });
        }

        for (
          const seat of
            availableSeats
        ) {
          operations.push({
            ref:
              doc(
                db,
                "carryOnFlights",
                carryOnFlightId,
                "availableSeats",
                seat.id
              ),

            data: {
              ...seat,

              updatedAt:
                serverTimestamp(),
            },

            options: {
              merge:
                true,
            },
          });
        }

        for (
          const gateCheckNumber of
            gateCheckNumbers
        ) {
          operations.push({
            ref:
              doc(
                db,
                "carryOnFlights",
                carryOnFlightId,
                "gateCheckNumbers",
                safeDocId(
                  gateCheckNumber
                )
              ),

            data: {
              gateCheckNumber,

              status:
                "AVAILABLE",

              source:
                "PRELOADED",

              addedAt:
                serverTimestamp(),

              addedBy:
                actor,
            },

            options: {
              merge:
                true,
            },
          });
        }

        await commitWrites(
          operations
        );

        setSetupMessage(
          `Carry-On flight ${flightNumber} created/updated successfully.`
        );
      } catch (
        error
      ) {
        console.error(
          "Carry-On setup save error:",
          error
        );

        setSetupError(
          error?.message ||
          "Unable to save Carry-On flight setup."
        );
      } finally {
        setSavingSetup(
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
      {/* HEADER */}

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
              14,

            flexWrap:
              "wrap",

            alignItems:
              "flex-start",
          }}
        >
          <div>
            <div
              style={{
                color:
                  "#7c3aed",

                fontSize:
                  "0.72rem",

                fontWeight:
                  900,

                letterSpacing:
                  "0.07em",
              }}
            >
              BLCS OPERATIONS
            </div>

            <h2
              style={{
                margin:
                  "5px 0 0",
              }}
            >
              Carry-On Gate Check Control
            </h2>

            <p
              style={{
                margin:
                  "6px 0 0",

                color:
                  "#64748b",

                maxWidth:
                  760,
              }}
            >
              Independent Carry-On flow. Existing BLCS baggage collections and operational pages are not modified by this module.
            </p>
          </div>

          <div
            style={{
              textAlign:
                "right",

              color:
                "#64748b",

              fontSize:
                "0.78rem",
            }}
          >
            <div>
              User:{" "}
              <strong
                style={{
                  color:
                    "#0f172a",
                }}
              >
                {displayName}
              </strong>
            </div>

            {positionLabel && (
              <div
                style={{
                  marginTop:
                    4,
                }}
              >
                Working as:{" "}
                <strong
                  style={{
                    color:
                      "#0f172a",
                  }}
                >
                  {positionLabel}
                </strong>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* TABS */}

      <section
        style={{
          background:
            "white",

          border:
            "1px solid #e5e7eb",

          borderRadius:
            14,

          padding:
            12,
        }}
      >
        <div
          style={{
            display:
              "flex",

            gap:
              8,

            flexWrap:
              "wrap",
          }}
        >
          {TABS.map(
            (
              tab
            ) => {
              const active =
                activeTab ===
                tab;

              return (
                <button
                  key={
                    tab
                  }

                  type="button"

                  onClick={() =>
                    setActiveTab(
                      tab
                    )
                  }

                  style={{
                    padding:
                      "8px 12px",

                    borderRadius:
                      999,

                    border:
                      active
                        ? "1px solid #7c3aed"
                        : "1px solid #d1d5db",

                    background:
                      active
                        ? "#7c3aed"
                        : "white",

                    color:
                      active
                        ? "white"
                        : "#334155",

                    fontWeight:
                      900,

                    cursor:
                      "pointer",
                  }}
                >
                  {tab}
                </button>
              );
            }
          )}
        </div>
      </section>

      {/* CONTENT */}

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
        {activeTab ===
          "SETUP" && (
          <div
            style={{
              display:
                "grid",

              gap:
                14,
            }}
          >
            <div>
              <h3
                style={{
                  margin:
                    0,
                }}
              >
                Flight Setup
              </h3>

              <p
                style={{
                  margin:
                    "6px 0 0",

                  color:
                    "#64748b",
                }}
              >
                Upload both flight documents. BLCS will keep only the operational data required for Carry-On Gate Check Control.
              </p>
            </div>

            {!canUploadDocuments && (
              <Notice
                tone="warning"
                text="Your role can view this page, but flight setup changes are restricted to operational management."
              />
            )}

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(auto-fit, minmax(280px, 1fr))",

                gap:
                  12,
              }}
            >
              <UploadCard
                title="Passenger Manifest"
                description="Extracts passenger name and original seat only."
                file={
                  passengerFile
                }
                loading={
                  parsingPassenger
                }
                disabled={
                  !canUploadDocuments
                }
                onFile={
                  handlePassengerPdf
                }
                summary={
                  passengerMeta
                    ? `${passengerMeta.flightNumber} - ${passengerMeta.flightDate} - ${passengers.length} passenger(s)`
                    : null
                }
              />

              <UploadCard
                title="Empty Seats Report"
                description="Extracts available seat number, seat type and blocked status."
                file={
                  emptySeatFile
                }
                loading={
                  parsingSeats
                }
                disabled={
                  !canUploadDocuments
                }
                onFile={
                  handleEmptySeatPdf
                }
                summary={
                  emptySeatMeta
                    ? `${emptySeatMeta.flightNumber} - ${emptySeatMeta.flightDate} - ${availableSeats.length} assignable seat(s)`
                    : null
                }
              />
            </div>

            {documentMatch && (
              documentMatch.ok
                ? (
                  <Notice
                    tone="success"
                    text={`Documents match: ${passengerMeta.flightNumber} ${passengerMeta.origin}-${passengerMeta.destination} ${passengerMeta.flightDate}`}
                  />
                )
                : (
                  <div
                    style={{
                      padding:
                        12,

                      borderRadius:
                        12,

                      border:
                        "1px solid #fca5a5",

                      background:
                        "#fef2f2",

                      color:
                        "#991b1b",
                    }}
                  >
                    <strong>
                      DOCUMENT MISMATCH - Setup is blocked.
                    </strong>

                    {documentMatch
                      .mismatches
                      .map(
                        (
                          item
                        ) => (
                          <div
                            key={
                              item.label
                            }
                            style={{
                              marginTop:
                                5,

                              fontSize:
                                "0.82rem",
                            }}
                          >
                            {item.label}: Passenger Manifest = {item.passengerValue} / Empty Seats = {item.emptySeatValue}
                          </div>
                        )
                      )}

                    {documentMatch
                      .missingCritical
                      .map(
                        (
                          item
                        ) => (
                          <div
                            key={
                              item.label
                            }
                            style={{
                              marginTop:
                                5,

                              fontSize:
                                "0.82rem",
                            }}
                          >
                            Missing flight information: {item.label}
                          </div>
                        )
                      )}
                  </div>
                )
            )}

            {documentMatch?.ok && (
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
                <Stat
                  label="Flight"
                  value={
                    passengerMeta
                      .flightNumber
                  }
                />

                <Stat
                  label="Route"
                  value={`${passengerMeta.origin}-${passengerMeta.destination}`}
                />

                <Stat
                  label="Passengers"
                  value={
                    passengers.length
                  }
                />

                <Stat
                  label="Available Seats"
                  value={
                    availableSeats.length
                  }
                />
              </div>
            )}

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(auto-fit, minmax(280px, 1fr))",

                gap:
                  12,
              }}
            >
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
                  Required Carry-On Gate Checks
                </h4>

                <p
                  style={
                    smallText
                  }
                >
                  Supervisor sets the operational target manually. This is a target, not a hard assignment limit.
                </p>

                <input
                  type="number"

                  min="0"

                  value={
                    requiredCarryOns
                  }

                  onChange={(
                    event
                  ) =>
                    setRequiredCarryOns(
                      event.target
                        .value
                    )
                  }

                  disabled={
                    !canSetRequired
                  }

                  placeholder="Example: 10"

                  style={
                    inputStyle
                  }
                />
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
                  Gate Check Numbers
                </h4>

                <p
                  style={
                    smallText
                  }
                >
                  Duty Manager / Supervisor can paste numbers separated by spaces, commas or new lines.
                </p>

                <textarea
                  rows={5}

                  value={
                    gateCheckText
                  }

                  onChange={(
                    event
                  ) =>
                    setGateCheckText(
                      event.target
                        .value
                    )
                  }

                  disabled={
                    !canManageGateChecks
                  }

                  placeholder={
                    "Example:\nGC823001\nGC823002\nGC823003"
                  }

                  style={{
                    ...inputStyle,

                    resize:
                      "vertical",
                  }}
                />

                <div
                  style={{
                    marginTop:
                      7,

                    color:
                      "#475569",

                    fontSize:
                      "0.78rem",

                    fontWeight:
                      800,
                  }}
                >
                  Unique Gate Check Numbers: {gateCheckNumbers.length}
                </div>
              </div>
            </div>

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
              <button
                type="button"

                onClick={
                  saveSetup
                }

                disabled={
                  savingSetup ||
                  !canManageGateChecks ||
                  !documentMatch?.ok ||
                  !validRequiredNumber
                }

                style={{
                  padding:
                    "10px 14px",

                  borderRadius:
                    10,

                  border:
                    "1px solid #7c3aed",

                  background:
                    savingSetup ||
                    !canManageGateChecks ||
                    !documentMatch?.ok ||
                    !validRequiredNumber
                      ? "#c4b5fd"
                      : "#7c3aed",

                  color:
                    "white",

                  fontWeight:
                    900,

                  cursor:
                    savingSetup ||
                    !canManageGateChecks ||
                    !documentMatch?.ok ||
                    !validRequiredNumber
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {savingSetup
                  ? "Saving Setup..."
                  : "Create / Save Carry-On Flight"}
              </button>

              {documentMatch?.ok &&
                validRequiredNumber && (
                <span
                  style={{
                    color:
                      "#64748b",

                    fontSize:
                      "0.78rem",
                  }}
                >
                  Required: {Math.trunc(requiredNumber)} - Preloaded Gate Checks: {gateCheckNumbers.length}
                </span>
              )}
            </div>

            {setupMessage && (
              <Notice
                tone="success"
                text={
                  setupMessage
                }
              />
            )}

            {setupError && (
              <Notice
                tone="error"
                text={
                  setupError
                }
              />
            )}

            <Notice
              tone="warning"
              text="Last-minute passenger and last-minute Gate Check creation will be available in COUNTER. The Required Carry-On number will not block extra operational assignments."
            />
          </div>
        )}

        {activeTab ===
          "COUNTER" && (
          <ComingSoon
            title="Counter Assignment"
            description="Next phase: select passenger, assign empty seat and Gate Check number, plus last-minute passenger / Gate Check."
          />
        )}

        {activeTab ===
          "GATE" && (
          <ComingSoon
            title="Gate Collection"
            description="Gate Controller will mark each Carry-On as Collected at Gate."
          />
        )}

        {activeTab ===
          "RAMP" && (
          <ComingSoon
            title="Ramp & Aircraft"
            description="Ramp will confirm Received at Ramp and then Loaded in Forward / Middle / Aft."
          />
        )}

        {activeTab ===
          "TRACKING" && (
          <ComingSoon
            title="Carry-On Tracking"
            description="Timeline from Counter Assigned through Aircraft Loaded."
          />
        )}

        {activeTab ===
          "REPORT" && (
          <ComingSoon
            title="Final Report"
            description="Operational summary and printable Carry-On Gate Check report."
          />
        )}
      </section>
    </div>
  );
}

/* =========================
   UI HELPERS
========================= */

function UploadCard({
  title,
  description,
  file,
  loading,
  disabled,
  onFile,
  summary,
}) {
  return (
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
        {title}
      </h4>

      <p
        style={
          smallText
        }
      >
        {description}
      </p>

      <input
        type="file"

        accept="application/pdf,.pdf"

        disabled={
          disabled ||
          loading
        }

        onChange={(
          event
        ) => {
          const selected =
            event.target
              .files?.[0];

          if (
            selected
          ) {
            onFile(
              selected
            );
          }
        }}
      />

      <div
        style={{
          marginTop:
            8,

          color:
            loading
              ? "#2563eb"
              : file
                ? "#166534"
                : "#64748b",

          fontSize:
            "0.78rem",

          fontWeight:
            800,
        }}
      >
        {loading
          ? "Parsing PDF..."
          : summary ||
            file?.name ||
            "No PDF selected"}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
}) {
  return (
    <div
      style={{
        padding:
          10,

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
            "0.7rem",
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
  const tones = {
    success: {
      background:
        "#f0fdf4",

      border:
        "#bbf7d0",

      color:
        "#166534",
    },

    warning: {
      background:
        "#fffbeb",

      border:
        "#fde68a",

      color:
        "#92400e",
    },

    error: {
      background:
        "#fef2f2",

      border:
        "#fecaca",

      color:
        "#991b1b",
    },
  };

  const selected =
    tones[tone] ||
    tones.warning;

  return (
    <div
      style={{
        padding:
          11,

        borderRadius:
          10,

        background:
          selected.background,

        border:
          `1px solid ${selected.border}`,

        color:
          selected.color,

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

function ComingSoon({
  title,
  description,
}) {
  return (
    <div
      style={{
        padding:
          18,

        borderRadius:
          12,

        border:
          "1px solid #e2e8f0",

        background:
          "#f8fafc",
      }}
    >
      <h3
        style={{
          margin:
            0,
        }}
      >
        {title}
      </h3>

      <p
        style={{
          margin:
            "6px 0 0",

          color:
            "#64748b",
        }}
      >
        {description}
      </p>
    </div>
  );
}

const panelStyle = {
  padding:
    12,

  borderRadius:
    12,

  border:
    "1px solid #e2e8f0",

  background:
    "#f8fafc",
};

const smallText = {
  margin:
    "6px 0 10px",

  color:
    "#64748b",

  fontSize:
    "0.8rem",

  lineHeight:
    1.45,
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

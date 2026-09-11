// src/pages/CarryOnGateCheckPage.jsx

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
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebase";

import CarryOnCounterPage from "./CarryOnCounterPage.jsx";
import CarryOnGatePage from "./CarryOnGatePage.jsx";
import CarryOnRampPage from "./CarryOnRampPage.jsx";
import CarryOnLoadPage from "./CarryOnLoadPage.jsx";
import CarryOnReportPage from "./CarryOnReportPage.jsx";
import CarryOnTrackingPage from "./CarryOnTrackingPage.jsx";
import CarryOnSummaryPage from "./CarryOnSummaryPage.jsx";

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
  "LOAD",
  "TRACKING",
  "REPORT",
  "SUMMARY",
];

const MAX_BATCH_WRITES = 400;

/* =========================
   HELPERS
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
      .replace(
        /[^A-Z0-9]/g,
        ""
      );

  const flight =
    String(number || "")
      .trim()
      .replace(
        /[^0-9]/g,
        ""
      );

  return `${carrier}${flight}`;
}

function normalizeGateCheckNumber(
  value
) {
  return cleanUpper(value)
    .replace(
      /\s+/g,
      ""
    )
    .replace(
      /[^A-Z0-9-]/g,
      ""
    );
}

function normalizeSeat(value) {
  return cleanUpper(value)
    .replace(
      /\s+/g,
      ""
    );
}

function safeDocId(value) {
  return String(value || "")
    .trim()
    .replace(
      /[^A-Za-z0-9_-]/g,
      "_"
    );
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

function formatTimestamp(
  timestamp
) {
  if (
    !timestamp
  ) {
    return "-";
  }

  try {
    const date =
      timestamp?.toDate
        ? timestamp.toDate()
        : new Date(
            timestamp
          );

    return date.toLocaleString();
  } catch {
    return "-";
  }
}

/* =========================
   PDF READER
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

  const pages =
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

    const pageItems =
      [];

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

      pageItems.push({
        value,

        x:
          Number(
            transform?.[4] ||
            0
          ),

        y:
          Number(
            transform?.[5] ||
            0
          ),
      });
    }

    pages.push({
      pageNumber,
      items:
        pageItems,
    });

    const rowMap =
      new Map();

    for (
      const item of
        pageItems
    ) {
      const yKey =
        Math.round(
          item.y / 4
        ) * 4;

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
        .push(
          item
        );
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
    pages,
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
   LOAD MANIFEST PARSER
========================= */

function parseLoadManifestPassengers(
  documentData
) {
  const lines =
    Array.isArray(
      documentData?.lines
    )
      ? documentData.lines
      : [];

  const passengers =
    [];

  const seen =
    new Set();

  /*
   * World Atlantic Load Manifest rows use:
   * LAST NAME / FIRST NAME
   *
   * We intentionally keep Passenger Name only.
   */
  const passengerPattern =
    /^([A-Z][A-Z .'-]{1,60})\s*\/\s*([A-Z][A-Z .'-]{1,40})(?:\s|$)/i;

  const excludedStarts = [
    "PASSENGER NAME",
    "LOAD MANIFEST",
    "TOTAL ",
    "PRINTED:",
    "SIGNATURE",
    "EMPLOYEE NUMBER",
    "FLIGHT:",
    "ORIGIN:",
    "DESTINATION:",
    "STD:",
    "STA:",
    "AIRCRAFT:",
    "PASSENGER BAGS",
    "CHECKED BAGS",
    "CARRY ON",
    "BODY WEIGHT",
    "BAG TAGS",
    "WEIGHT",
    "BAGS:",
  ];

  for (
    const rawLine of
      lines
  ) {
    const line =
      cleanUpper(
        rawLine
      )
        .replace(
          /\s+/g,
          " "
        );

    if (
      !line
    ) {
      continue;
    }

    if (
      excludedStarts.some(
        (
          prefix
        ) =>
          line.startsWith(
            prefix
          )
      )
    ) {
      continue;
    }

    const match =
      line.match(
        passengerPattern
      );

    if (
      !match
    ) {
      continue;
    }

    const lastName =
      String(
        match[1] ||
        ""
      )
        .trim()
        .replace(
          /\s+/g,
          " "
        );

    const firstName =
      String(
        match[2] ||
        ""
      )
        .trim()
        .replace(
          /\s+/g,
          " "
        );

    const passengerName =
      `${lastName} / ${firstName}`;

    if (
      seen.has(
        passengerName
      )
    ) {
      continue;
    }

    seen.add(
      passengerName
    );

    passengers.push({
      id:
        safeDocId(
          `PAX_${String(
            passengers.length +
            1
          ).padStart(
            3,
            "0"
          )}`
        ),

      sequence:
        passengers.length +
        1,

      passengerName,

      source:
        "LOAD_MANIFEST",

      assigned:
        false,
    });
  }

  const totalMatch =
    String(
      documentData?.fullText ||
      ""
    ).match(
      /Total\s+([0-9]{1,3})\s+passengers/i
    );

  const declaredTotal =
    totalMatch?.[1]
      ? Number(
          totalMatch[1]
        )
      : null;

  return {
    passengers,

    declaredTotal,
  };
}

/* =========================
   EMPTY SEAT PARSER
========================= */

function parseEmptySeats(
  text
) {
  const source =
    String(text || "")
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

  const seats =
    [];

  const seen =
    new Set();

  const regex =
    /\b(\d{1,2}[A-F])\s+(Premium|Standard|Emergency)\b(?:\s+(Yes|No))?/gi;

  let match =
    regex.exec(
      source
    );

  while (
    match
  ) {
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
   DOCUMENT VALIDATION
========================= */

function validateDocumentAgainstFlight(
  meta,
  flight
) {
  if (
    !meta ||
    !flight
  ) {
    return {
      ok:
        false,

      issues: [
        "Missing flight information.",
      ],
    };
  }

  const issues =
    [];

  const checks = [
    [
      "Flight",
      cleanUpper(
        meta.flightNumber
      ),
      cleanUpper(
        flight.flightNumber
      ),
    ],

    [
      "Date",
      cleanUpper(
        meta.flightDate
      ),
      cleanUpper(
        flight.flightDate
      ),
    ],

    [
      "Origin",
      cleanUpper(
        meta.origin
      ),
      cleanUpper(
        flight.origin
      ),
    ],

    [
      "Destination",
      cleanUpper(
        meta.destination
      ),
      cleanUpper(
        flight.destination
      ),
    ],
  ];

  for (
    const [
      label,
      documentValue,
      selectedValue,
    ] of checks
  ) {
    if (
      !documentValue
    ) {
      issues.push(
        `${label}: not identified in PDF.`
      );

      continue;
    }

    if (
      documentValue !==
      selectedValue
    ) {
      issues.push(
        `${label}: PDF ${documentValue} / Selected flight ${selectedValue}`
      );
    }
  }

  return {
    ok:
      issues.length ===
      0,

    issues,
  };
}

/* =========================
   FIRESTORE BATCH
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
      const operation of
        chunk
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

  const canCreateFlight =
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor";

  const operationalPosition =
    cleanUpper(
      operationalContext
        ?.operationalPosition
    );

  const canUploadDocuments =
    canCreateFlight;

  const canSetRequired =
    role ===
      "station_manager" ||
    role ===
      "supervisor";

  /*
   * Gate Check numbers are intentionally separated from
   * the office document setup.
   *
   * Office:
   *   Load Manifest + Empty Seats Report + Required target
   *
   * Counter:
   *   Gate Check numbers can be added after document setup
   *   has been saved.
   */
  const canManageGateChecks =
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor" ||
    operationalPosition ===
      "COUNTER_SCAN";

  const [
    activeTab,
    setActiveTab,
  ] = useState(
    () =>
      sessionStorage.getItem(
        "carryOnActiveTab"
      ) ||
      "SETUP"
  );

  const [
    carryOnFlights,
    setCarryOnFlights,
  ] = useState(
    []
  );

  const [
    selectedCarryOnFlightId,
    setSelectedCarryOnFlightId,
  ] = useState(
    () =>
      sessionStorage.getItem(
        "selectedCarryOnFlightId"
      ) ||
      null
  );

  const [
    createForm,
    setCreateForm,
  ] = useState({
    airline:
      "WL",

    flightNumber:
      "",

    flightDate:
      "",

    origin:
      "TPA",

    destination:
      "",

    gate:
      "",

    aircraft:
      "",

    tailNumber:
      "",
  });

  const [
    creatingFlight,
    setCreatingFlight,
  ] = useState(
    false
  );

  const [
    editingFlight,
    setEditingFlight,
  ] = useState(
    false
  );

  const [
    savingFlightEdit,
    setSavingFlightEdit,
  ] = useState(
    false
  );

  const [
    editFlightForm,
    setEditFlightForm,
  ] = useState({
    airline:
      "",

    flightNumber:
      "",

    gate:
      "",

    tailNumber:
      "",
  });

  const [
    loadManifestFile,
    setLoadManifestFile,
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
    loadManifestMeta,
    setLoadManifestMeta,
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
    declaredPassengerTotal,
    setDeclaredPassengerTotal,
  ] = useState(
    null
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
    setupGateChecks,
    setSetupGateChecks,
  ] = useState(
    []
  );

  const [
    gateCheckManagerText,
    setGateCheckManagerText,
  ] = useState(
    ""
  );

  const [
    editingGateCheckId,
    setEditingGateCheckId,
  ] = useState(
    ""
  );

  const [
    editingGateCheckValue,
    setEditingGateCheckValue,
  ] = useState(
    ""
  );

  const [
    savingGateCheckManager,
    setSavingGateCheckManager,
  ] = useState(
    false
  );

  const [
    parsingLoadManifest,
    setParsingLoadManifest,
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

  const selectedFlight =
    useMemo(
      () =>
        carryOnFlights.find(
          (
            item
          ) =>
            item.id ===
            selectedCarryOnFlightId
        ) ||
        null,
      [
        carryOnFlights,
        selectedCarryOnFlightId,
      ]
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

  const documentSetupSaved =
    Boolean(
      selectedFlight &&
      Number(
        selectedFlight
          ?.passengerCount ||
        0
      ) >
        0 &&
      Number(
        selectedFlight
          ?.availableSeatCount ||
        0
      ) >
        0 &&
      selectedFlight
        ?.documents
        ?.loadManifest &&
      selectedFlight
        ?.documents
        ?.emptySeatsReport
    );

  /* =========================
     CARRY-ON NAVIGATION STATE
  ========================= */

  useEffect(() => {
    sessionStorage.setItem(
      "carryOnActiveTab",
      activeTab
    );
  }, [
    activeTab,
  ]);

  useEffect(() => {
    if (
      selectedCarryOnFlightId
    ) {
      sessionStorage.setItem(
        "selectedCarryOnFlightId",
        selectedCarryOnFlightId
      );
    } else {
      sessionStorage.removeItem(
        "selectedCarryOnFlightId"
      );
    }
  }, [
    selectedCarryOnFlightId,
  ]);

  /* =========================
     FLIGHT LIST
  ========================= */

  useEffect(() => {
    const ref =
      collection(
        db,
        "carryOnFlights"
      );

    const unsub =
      onSnapshot(
        ref,

        (
          snap
        ) => {
          const list =
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
                (item) =>
                  item?.isDeleted !== true
              );

          list.sort(
            (
              a,
              b
            ) => {
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

              if (
                dateCompare !==
                0
              ) {
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
            }
          );

          setCarryOnFlights(
            list
          );
        },

        (
          snapshotError
        ) => {
          console.error(
            "Carry-On flights snapshot error:",
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
    if (!selectedCarryOnFlightId) {
      setSetupGateChecks([]);
      return undefined;
    }

    const unsub = onSnapshot(
      collection(
        db,
        "carryOnFlights",
        selectedCarryOnFlightId,
        "gateCheckNumbers"
      ),
      (snap) => {
        const rows = snap.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        rows.sort((a, b) =>
          String(a.gateCheckNumber || "").localeCompare(
            String(b.gateCheckNumber || "")
          )
        );

        setSetupGateChecks(rows);
      },
      (snapshotError) => {
        console.error(
          "Carry-On setup Gate Check snapshot error:",
          snapshotError
        );
      }
    );

    return () => unsub();
  }, [selectedCarryOnFlightId]);

  /* =========================
     LOAD SELECTED SETUP
  ========================= */

  useEffect(() => {
    if (
      !selectedFlight
    ) {
      return;
    }

    setRequiredCarryOns(
      String(
        selectedFlight
          ?.requiredCarryOns ??
        ""
      )
    );

    setGateCheckText(
      ""
    );

    setLoadManifestFile(
      null
    );

    setEmptySeatFile(
      null
    );

    setLoadManifestMeta(
      null
    );

    setEmptySeatMeta(
      null
    );

    setPassengers(
      []
    );

    setDeclaredPassengerTotal(
      null
    );

    setEmptySeats(
      []
    );

    setMessage(
      ""
    );

    setError(
      ""
    );

    setEditingFlight(
      false
    );

    setEditFlightForm({
      airline:
        selectedFlight
          ?.airline ||
        "",

      flightNumber:
        selectedFlight
          ?.flightNumberOnly ||
        String(
          selectedFlight
            ?.flightNumber ||
          ""
        ).replace(
          /^[A-Z]+/i,
          ""
        ),

      gate:
        selectedFlight
          ?.gate ||
        "",

      tailNumber:
        selectedFlight
          ?.tailNumber ||
        "",
    });
  }, [
    selectedCarryOnFlightId,
  ]);

  /* =========================
     CREATE FLIGHT
  ========================= */

  const createCarryOnFlight =
    async () => {
      setMessage(
        ""
      );

      setError(
        ""
      );

      if (
        !canCreateFlight
      ) {
        setError(
          "You do not have permission to create Carry-On flights."
        );

        return;
      }

      const airline =
        cleanUpper(
          createForm
            .airline
        );

      const flightNumberOnly =
        String(
          createForm
            .flightNumber ||
          ""
        )
          .trim()
          .replace(
            /[^0-9]/g,
            ""
          );

      const flightNumber =
        normalizeFlightNumber(
          airline,
          flightNumberOnly
        );

      const flightDate =
        String(
          createForm
            .flightDate ||
          ""
        );

      const origin =
        cleanUpper(
          createForm
            .origin
        );

      const destination =
        cleanUpper(
          createForm
            .destination
        );

      const gate =
        cleanUpper(
          createForm
            .gate
        );

      const aircraft =
        String(
          createForm
            .aircraft ||
          ""
        ).trim();

      const tailNumber =
        cleanUpper(
          createForm
            .tailNumber
        );

      if (
        !airline ||
        !flightNumberOnly ||
        !flightDate ||
        !origin ||
        !destination
      ) {
        setError(
          "Airline, Flight Number, Flight Date, Origin and Destination are required."
        );

        return;
      }

      const carryOnFlightId =
        buildCarryOnFlightId(
          flightNumber,
          flightDate
        );

      const ref =
        doc(
          db,
          "carryOnFlights",
          carryOnFlightId
        );

      try {
        setCreatingFlight(
          true
        );

        const existing =
          await getDoc(
            ref
          );

        if (
          existing.exists()
        ) {
          setSelectedCarryOnFlightId(
            carryOnFlightId
          );

          setMessage(
            `Carry-On flight ${flightNumber} already exists. It has been opened.`
          );

          return;
        }

        await setDoc(
          ref,
          {
            flightNumber,

            airline,

            flightNumberOnly,

            flightDate,

            origin,

            destination,

            gate:
              gate ||
              null,

            aircraft:
              aircraft ||
              null,

            tailNumber:
              tailNumber ||
              null,

            status:
              "SETUP",

            requiredCarryOns:
              0,

            passengerCount:
              0,

            availableSeatCount:
              0,

            gateCheckNumberCount:
              0,

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

        setSelectedCarryOnFlightId(
          carryOnFlightId
        );

        setMessage(
          `Carry-On flight ${flightNumber} created successfully.`
        );
      } catch (
        createError
      ) {
        console.error(
          "Create Carry-On flight error:",
          createError
        );

        setError(
          createError?.message ||
          "Unable to create Carry-On flight."
        );
      } finally {
        setCreatingFlight(
          false
        );
      }
    };

  /* =========================
     EDIT FLIGHT INFORMATION
  ========================= */

  const saveFlightInformation =
    async () => {
      setMessage(
        ""
      );

      setError(
        ""
      );

      if (
        !selectedFlight
      ) {
        setError(
          "Select a Carry-On flight first."
        );

        return;
      }

      if (
        !canCreateFlight
      ) {
        setError(
          "You do not have permission to edit Carry-On flight information."
        );

        return;
      }

      const airline =
        cleanUpper(
          editFlightForm
            .airline
        );

      const flightNumberOnly =
        String(
          editFlightForm
            .flightNumber ||
          ""
        )
          .trim()
          .replace(
            /[^0-9]/g,
            ""
          );

      const flightNumber =
        normalizeFlightNumber(
          airline,
          flightNumberOnly
        );

      const gate =
        cleanUpper(
          editFlightForm
            .gate
        );

      const tailNumber =
        cleanUpper(
          editFlightForm
            .tailNumber
        );

      if (
        !airline ||
        !flightNumberOnly
      ) {
        setError(
          "Airline and Flight Number are required."
        );

        return;
      }

      try {
        setSavingFlightEdit(
          true
        );

        await setDoc(
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id
          ),
          {
            airline,

            flightNumberOnly,

            flightNumber,

            gate:
              gate ||
              null,

            tailNumber:
              tailNumber ||
              null,

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

        setEditingFlight(
          false
        );

        setMessage(
          `Flight information updated for ${flightNumber}.`
        );
      } catch (
        editError
      ) {
        console.error(
          "Edit Carry-On flight error:",
          editError
        );

        setError(
          editError?.message ||
          "Unable to update Carry-On flight information."
        );
      } finally {
        setSavingFlightEdit(
          false
        );
      }
    };

  /* =========================
     LOAD MANIFEST
  ========================= */

  const handleLoadManifest =
    async (
      file
    ) => {
      if (
        !file ||
        !selectedFlight
      ) {
        return;
      }

      setError(
        ""
      );

      setMessage(
        ""
      );

      try {
        setParsingLoadManifest(
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

        const validation =
          validateDocumentAgainstFlight(
            meta,
            selectedFlight
          );

        if (
          !validation.ok
        ) {
          throw new Error(
            `Load Manifest does not match selected flight.\n${validation.issues.join("\n")}`
          );
        }

        const result =
          parseLoadManifestPassengers(
            documentData
          );

        if (
          result
            .passengers
            .length ===
          0
        ) {
          throw new Error(
            "No passenger names could be extracted from Load Manifest."
          );
        }

        setLoadManifestFile(
          file
        );

        setLoadManifestMeta(
          meta
        );

        setPassengers(
          result.passengers
        );

        setDeclaredPassengerTotal(
          result.declaredTotal
        );

        const totalMessage =
          result.declaredTotal
            ? ` / PDF total: ${result.declaredTotal}`
            : "";

        setMessage(
          `Load Manifest parsed: ${result.passengers.length} passenger(s)${totalMessage}.`
        );
      } catch (
        parseError
      ) {
        console.error(
          "Load Manifest parse error:",
          parseError
        );

        setLoadManifestFile(
          null
        );

        setLoadManifestMeta(
          null
        );

        setPassengers(
          []
        );

        setDeclaredPassengerTotal(
          null
        );

        setError(
          parseError?.message ||
          "Unable to parse Load Manifest."
        );
      } finally {
        setParsingLoadManifest(
          false
        );
      }
    };

  /* =========================
     EMPTY SEATS
  ========================= */

  const handleEmptySeatPdf =
    async (
      file
    ) => {
      if (
        !file ||
        !selectedFlight
      ) {
        return;
      }

      setError(
        ""
      );

      setMessage(
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

        const validation =
          validateDocumentAgainstFlight(
            meta,
            selectedFlight
          );

        if (
          !validation.ok
        ) {
          throw new Error(
            `Empty Seats Report does not match selected flight.\n${validation.issues.join("\n")}`
          );
        }

        const parsedSeats =
          parseEmptySeats(
            documentData.fullText
          );

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

        setMessage(
          `Empty Seats Report parsed: ${parsedSeats.length} seat(s).`
        );
      } catch (
        parseError
      ) {
        console.error(
          "Empty Seats parse error:",
          parseError
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

        setError(
          parseError?.message ||
          "Unable to parse Empty Seats Report."
        );
      } finally {
        setParsingSeats(
          false
        );
      }
    };

  const addManagedGateChecks = async () => {
    setError("");
    setMessage("");

    if (!selectedFlight || !canManageGateChecks) {
      setError("You do not have permission to manage Gate Check numbers.");
      return;
    }

    if (!documentSetupSaved) {
      setError(
        "Save the Load Manifest and Empty Seats setup first. Gate Check numbers can be added after passenger and seat data are saved."
      );
      return;
    }

    const seen = new Set();
    const requested = String(gateCheckManagerText || "")
      .split(/[\s,;\n]+/)
      .map((value) => normalizeGateCheckNumber(value))
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });

    if (!requested.length) {
      setError("Enter at least one valid Gate Check number.");
      return;
    }

    const existing = new Set(
      setupGateChecks.map((item) => normalizeGateCheckNumber(item.gateCheckNumber))
    );
    const additions = requested.filter((value) => !existing.has(value));

    if (!additions.length) {
      setMessage("All entered Gate Check numbers already exist for this flight.");
      return;
    }

    try {
      setSavingGateCheckManager(true);
      const operations = additions.map((gateCheckNumber) => ({
        ref: doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "gateCheckNumbers",
          safeDocId(gateCheckNumber)
        ),
        data: {
          gateCheckNumber,
          status: "AVAILABLE",
          source: "SETUP_MANUAL",
          addedAt: serverTimestamp(),
          addedBy: actor,
        },
        options: { merge: true },
      }));

      operations.push({
        ref: doc(db, "carryOnFlights", selectedFlight.id),
        data: {
          gateCheckNumberCount: setupGateChecks.length + additions.length,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        },
        options: { merge: true },
      });

      await commitWrites(operations);
      setGateCheckManagerText("");
      setMessage(`${additions.length} Gate Check number(s) added.`);
    } catch (manageError) {
      console.error("Add Gate Check numbers error:", manageError);
      setError(manageError?.message || "Unable to add Gate Check numbers.");
    } finally {
      setSavingGateCheckManager(false);
    }
  };

  const removeManagedGateCheck = async (item) => {
    setError("");
    setMessage("");

    if (!selectedFlight || !canManageGateChecks || !item) return;

    if (!documentSetupSaved) {
      setError(
        "Gate Check numbers cannot be changed until the document setup has been saved."
      );
      return;
    }

    if (cleanUpper(item.status) !== "AVAILABLE") {
      setError("Only AVAILABLE Gate Check numbers can be removed from Setup.");
      return;
    }

    const ok = window.confirm(
      `Remove Gate Check ${item.gateCheckNumber || item.id}?`
    );
    if (!ok) return;

    try {
      setSavingGateCheckManager(true);
      const batch = writeBatch(db);
      batch.delete(
        doc(
          db,
          "carryOnFlights",
          selectedFlight.id,
          "gateCheckNumbers",
          item.id
        )
      );
      batch.set(
        doc(db, "carryOnFlights", selectedFlight.id),
        {
          gateCheckNumberCount: Math.max(0, setupGateChecks.length - 1),
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        },
        { merge: true }
      );
      await batch.commit();
      setMessage(`Gate Check ${item.gateCheckNumber || item.id} removed.`);
    } catch (manageError) {
      console.error("Remove Gate Check error:", manageError);
      setError(manageError?.message || "Unable to remove Gate Check number.");
    } finally {
      setSavingGateCheckManager(false);
    }
  };

  const saveManagedGateCheckEdit = async (item) => {
    setError("");
    setMessage("");

    if (!selectedFlight || !canManageGateChecks || !item) return;

    if (!documentSetupSaved) {
      setError(
        "Gate Check numbers cannot be changed until the document setup has been saved."
      );
      return;
    }

    if (cleanUpper(item.status) !== "AVAILABLE") {
      setError("Only AVAILABLE Gate Check numbers can be edited from Setup.");
      return;
    }

    const nextNumber = normalizeGateCheckNumber(editingGateCheckValue);
    const currentNumber = normalizeGateCheckNumber(item.gateCheckNumber);

    if (!nextNumber) {
      setError("Enter a valid Gate Check number.");
      return;
    }

    if (nextNumber === currentNumber) {
      setEditingGateCheckId("");
      setEditingGateCheckValue("");
      return;
    }

    const duplicate = setupGateChecks.some(
      (row) => row.id !== item.id && normalizeGateCheckNumber(row.gateCheckNumber) === nextNumber
    );
    if (duplicate) {
      setError("That Gate Check number already exists for this flight.");
      return;
    }

    try {
      setSavingGateCheckManager(true);
      const batch = writeBatch(db);
      const nextRef = doc(
        db,
        "carryOnFlights",
        selectedFlight.id,
        "gateCheckNumbers",
        safeDocId(nextNumber)
      );
      const oldRef = doc(
        db,
        "carryOnFlights",
        selectedFlight.id,
        "gateCheckNumbers",
        item.id
      );

      batch.set(
        nextRef,
        {
          ...item,
          gateCheckNumber: nextNumber,
          status: "AVAILABLE",
          editedAt: serverTimestamp(),
          editedBy: actor,
        },
        { merge: true }
      );
      batch.delete(oldRef);
      batch.set(
        doc(db, "carryOnFlights", selectedFlight.id),
        {
          gateCheckNumberCount: setupGateChecks.length,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        },
        { merge: true }
      );

      await batch.commit();
      setEditingGateCheckId("");
      setEditingGateCheckValue("");
      setMessage(`Gate Check ${currentNumber} changed to ${nextNumber}.`);
    } catch (manageError) {
      console.error("Edit Gate Check error:", manageError);
      setError(manageError?.message || "Unable to edit Gate Check number.");
    } finally {
      setSavingGateCheckManager(false);
    }
  };

  /* =========================
     SAVE SETUP
  ========================= */

  const saveSetup =
    async () => {
      setError(
        ""
      );

      setMessage(
        ""
      );

      if (
        !selectedFlight
      ) {
        setError(
          "Select a Carry-On flight first."
        );

        return;
      }

      if (
        !canUploadDocuments
      ) {
        setError(
          "You do not have permission to save the Carry-On document setup."
        );

        return;
      }

      if (
        passengers.length ===
        0
      ) {
        setError(
          "Upload a valid Load Manifest first."
        );

        return;
      }

      if (
        availableSeats.length ===
        0
      ) {
        setError(
          "Upload a valid Empty Seats Report first."
        );

        return;
      }

      if (
        !validRequiredNumber
      ) {
        setError(
          "Enter a valid Required Carry-On Gate Checks value."
        );

        return;
      }

      try {
        setSavingSetup(
          true
        );

        const flightRef =
          doc(
            db,
            "carryOnFlights",
            selectedFlight.id
          );

        const currentSnap =
          await getDoc(
            flightRef
          );

        if (
          !currentSnap.exists()
        ) {
          throw new Error(
            "Selected Carry-On flight no longer exists."
          );
        }

        const currentData =
          currentSnap.data();

        const currentStatus =
          cleanUpper(
            currentData?.status
          );

        if (
          currentStatus &&
          currentStatus !==
            "SETUP" &&
          currentStatus !==
            "READY"
        ) {
          throw new Error(
            "This Carry-On flight is already in operation. Setup cannot overwrite operational data."
          );
        }

        await setDoc(
          flightRef,
          {
            requiredCarryOns:
              Math.trunc(
                requiredNumber
              ),

            passengerCount:
              passengers.length,

            declaredPassengerTotal:
              declaredPassengerTotal ??
              null,

            availableSeatCount:
              availableSeats.length,

            gateCheckNumberCount:
              setupGateChecks.length,

            status:
              "READY",

            documents: {
              loadManifest: {
                fileName:
                  loadManifestFile
                    ?.name ||
                  null,

                parsedAt:
                  serverTimestamp(),

                passengerCount:
                  passengers.length,

                declaredPassengerTotal:
                  declaredPassengerTotal ??
                  null,
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
                selectedFlight.id,
                "passengers",
                passenger.id
              ),

            data: {
              ...passenger,

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
                selectedFlight.id,
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

        await commitWrites(
          operations
        );

        setMessage(
          `Passenger and seat setup saved for ${selectedFlight.flightNumber}. Gate Check numbers can now be added from Counter.`
        );
      } catch (
        saveError
      ) {
        console.error(
          "Save Carry-On setup error:",
          saveError
        );

        setError(
          saveError?.message ||
          "Unable to save Carry-On setup."
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
              Independent Carry-On flow. Existing BLCS baggage operations remain unchanged.
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
            display: "flex",
            gap: 7,
            flexWrap: "nowrap",
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
            paddingBottom: 2,
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
                      "9px 12px",

                    minWidth:
                      "max-content",

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
                16,
            }}
          >
            <div>
              <h3
                style={{
                  margin:
                    0,
                }}
              >
                Carry-On Flights
              </h3>

              <p
                style={
                  smallText
                }
              >
                Step 1: upload the Load Manifest and Empty Seats Report from the office and save passenger/seat setup. Step 2: Gate Check numbers can be added later from Counter.
              </p>
            </div>

            <Notice
              tone="warning"
              text="Office setup first: upload Load Manifest + Empty Seats Report and save. Gate Check numbers remain locked until passenger and seat data are saved."
            />

            <div
              style={{
                ...panelStyle,
                background:
                  selectedFlight
                    ? "#f8fafc"
                    : "#fffbeb",
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
                  <h4 style={{ margin: 0 }}>
                    Current Carry-On Flight
                  </h4>
                  <p style={smallText}>
                    Setup now shows only the selected flight. Use Carry Ons Resumen to search or open another flight.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setActiveTab("SUMMARY")
                  }
                  style={smallSecondaryButton}
                >
                  Carry Ons Resumen
                </button>
              </div>

              {selectedFlight ? (
                <div
                  style={{
                    marginTop: 8,
                    padding: 11,
                    borderRadius: 11,
                    border: "1px solid #c4b5fd",
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
                      {selectedFlight.flightNumber || "-"}
                      {" - "}
                      {selectedFlight.flightDate || "-"}
                    </strong>

                    <span
                      style={{
                        color: "#6d28d9",
                        fontWeight: 900,
                        fontSize: "0.76rem",
                      }}
                    >
                      {selectedFlight.status || "SETUP"}
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: 4,
                      color: "#64748b",
                      fontSize: "0.78rem",
                    }}
                  >
                    {selectedFlight.origin || "-"}
                    {" -> "}
                    {selectedFlight.destination || "-"}
                    {selectedFlight.gate
                      ? ` - Gate ${selectedFlight.gate}`
                      : ""}
                    {selectedFlight.tailNumber
                      ? ` - Tail ${selectedFlight.tailNumber}`
                      : ""}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 8,
                    padding: 12,
                    borderRadius: 10,
                    border: "1px dashed #f59e0b",
                    background: "white",
                    color: "#92400e",
                    fontSize: "0.8rem",
                    fontWeight: 800,
                  }}
                >
                  No flight selected. Open Carry Ons Resumen and choose a flight.
                </div>
              )}
            </div>

            {selectedFlight && (
              <>
                <div
                  style={{
                    padding:
                      13,

                    borderRadius:
                      12,

                    border:
                      "1px solid #c4b5fd",

                    background:
                      "#f5f3ff",
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

                      alignItems:
                        "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color:
                            "#5b21b6",

                          fontSize:
                            "0.72rem",

                          fontWeight:
                            900,
                        }}
                      >
                        SELECTED CARRY-ON FLIGHT
                      </div>

                      <div
                        style={{
                          marginTop:
                            3,

                          fontSize:
                            "1.15rem",

                          fontWeight:
                            900,
                        }}
                      >
                        {selectedFlight.flightNumber}
                        {" - "}
                        {selectedFlight.flightDate}
                      </div>

                      <div
                        style={{
                          marginTop:
                            3,

                          color:
                            "#64748b",
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

                    {canCreateFlight && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingFlight(
                            !editingFlight
                          );

                          setEditFlightForm({
                            airline:
                              selectedFlight
                                ?.airline ||
                              "",

                            flightNumber:
                              selectedFlight
                                ?.flightNumberOnly ||
                              String(
                                selectedFlight
                                  ?.flightNumber ||
                                ""
                              ).replace(
                                /^[A-Z]+/i,
                                ""
                              ),

                            gate:
                              selectedFlight
                                ?.gate ||
                              "",

                            tailNumber:
                              selectedFlight
                                ?.tailNumber ||
                              "",
                          });

                          setMessage(
                            ""
                          );

                          setError(
                            ""
                          );
                        }}
                        style={{
                          padding:
                            "7px 11px",

                          borderRadius:
                            9,

                          border:
                            "1px solid #7c3aed",

                          background:
                            "white",

                          color:
                            "#6d28d9",

                          fontWeight:
                            900,

                          cursor:
                            "pointer",
                        }}
                      >
                        {editingFlight
                          ? "Cancel Edit"
                          : "Edit Flight"}
                      </button>
                    )}
                  </div>

                  {editingFlight && (
                    <div
                      style={{
                        marginTop:
                          12,

                        paddingTop:
                          12,

                        borderTop:
                          "1px solid #ddd6fe",
                      }}
                    >
                      <div
                        style={{
                          display:
                            "grid",

                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(150px, 1fr))",

                          gap:
                            9,
                        }}
                      >
                        <Field
                          label="Airline"
                          value={
                            editFlightForm
                              .airline
                          }
                          disabled={
                            savingFlightEdit
                          }
                          onChange={(
                            value
                          ) =>
                            setEditFlightForm(
                              (
                                previous
                              ) => ({
                                ...previous,

                                airline:
                                  value,
                              })
                            )
                          }
                        />

                        <Field
                          label="Flight Number"
                          value={
                            editFlightForm
                              .flightNumber
                          }
                          disabled={
                            savingFlightEdit
                          }
                          inputMode="numeric"
                          onChange={(
                            value
                          ) =>
                            setEditFlightForm(
                              (
                                previous
                              ) => ({
                                ...previous,

                                flightNumber:
                                  value,
                              })
                            )
                          }
                        />

                        <Field
                          label="Assigned Gate"
                          value={
                            editFlightForm
                              .gate
                          }
                          disabled={
                            savingFlightEdit
                          }
                          placeholder="Example: F88"
                          onChange={(
                            value
                          ) =>
                            setEditFlightForm(
                              (
                                previous
                              ) => ({
                                ...previous,

                                gate:
                                  value,
                              })
                            )
                          }
                        />

                        <Field
                          label="Tail Number"
                          value={
                            editFlightForm
                              .tailNumber
                          }
                          disabled={
                            savingFlightEdit
                          }
                          placeholder="Example: N802WA"
                          onChange={(
                            value
                          ) =>
                            setEditFlightForm(
                              (
                                previous
                              ) => ({
                                ...previous,

                                tailNumber:
                                  value,
                              })
                            )
                          }
                        />
                      </div>

                      <button
                        type="button"
                        onClick={
                          saveFlightInformation
                        }
                        disabled={
                          savingFlightEdit
                        }
                        style={{
                          ...primaryButton,

                          marginTop:
                            10,

                          opacity:
                            savingFlightEdit
                              ? 0.6
                              : 1,
                        }}
                      >
                        {savingFlightEdit
                          ? "Saving..."
                          : "Save Flight Information"}
                      </button>
                    </div>
                  )}
                </div>

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
                    title="Load Manifest"
                    description="Imports Passenger Name only."
                    file={
                      loadManifestFile
                    }
                    loading={
                      parsingLoadManifest
                    }
                    disabled={
                      !canUploadDocuments
                    }
                    onFile={
                      handleLoadManifest
                    }
                    summary={
                      loadManifestMeta
                        ? `${passengers.length} passenger(s) imported${
                            declaredPassengerTotal
                              ? ` / PDF total ${declaredPassengerTotal}`
                              : ""
                          }`
                        : null
                    }
                  />

                  <UploadCard
                    title="Empty Seats Report"
                    description="Imports available seat number and seat type."
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
                        ? `${availableSeats.length} assignable seat(s)`
                        : null
                    }
                  />
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
                  <Stat
                    label="Passengers"
                    value={
                      passengers.length ||
                      selectedFlight.passengerCount ||
                      0
                    }
                  />

                  <Stat
                    label="Available Seats"
                    value={
                      availableSeats.length ||
                      selectedFlight.availableSeatCount ||
                      0
                    }
                  />

                  <Stat
                    label="Required"
                    value={
                      validRequiredNumber
                        ? Math.trunc(
                            requiredNumber
                          )
                        : selectedFlight.requiredCarryOns ||
                          0
                    }
                  />

                  <Stat
                    label="Gate Checks"
                    value={
                      setupGateChecks.length ||
                      selectedFlight.gateCheckNumberCount ||
                      0
                    }
                  />
                </div>

                <div
                  style={{
                    display:
                      "grid",
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
                      Supervisor sets this operational target during office setup. It does not require Gate Check numbers to be entered yet.
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

                  <Notice
                    tone={
                      documentSetupSaved
                        ? "success"
                        : "warning"
                    }
                    text={
                      documentSetupSaved
                        ? "Passenger and seat setup is saved. Gate Check numbers are now available for Counter entry."
                        : "Gate Check numbers will unlock only after Load Manifest + Empty Seats Report are saved."
                    }
                  />
                </div>

                {documentSetupSaved && (
                  <>
                <div style={panelStyle}>
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
                      <h4 style={{ margin: 0 }}>
                        Manage Gate Check Numbers
                      </h4>
                      <p style={smallText}>
                        Counter can add Gate Check numbers after the office document setup is saved. Assigned numbers remain protected from deletion or renaming.
                      </p>
                    </div>

                    <strong style={{ color: "#6d28d9" }}>
                      Total: {setupGateChecks.length}
                    </strong>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(220px, 1fr) auto",
                      gap: 8,
                      marginTop: 10,
                    }}
                  >
                    <textarea
                      rows={3}
                      value={gateCheckManagerText}
                      onChange={(event) => setGateCheckManagerText(event.target.value)}
                      disabled={!documentSetupSaved || !canManageGateChecks || savingGateCheckManager}
                      placeholder={"Add numbers:\nGC823010\nGC823011"}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />

                    <button
                      type="button"
                      onClick={addManagedGateChecks}
                      disabled={!documentSetupSaved || !canManageGateChecks || savingGateCheckManager}
                      style={{
                        ...primaryButton,
                        opacity: !canManageGateChecks || savingGateCheckManager ? 0.55 : 1,
                        alignSelf: "stretch",
                      }}
                    >
                      {savingGateCheckManager ? "Saving..." : "Add Numbers"}
                    </button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: 7,
                      marginTop: 12,
                      maxHeight: 360,
                      overflowY: "auto",
                    }}
                  >
                    {setupGateChecks.length === 0 ? (
                      <div style={smallText}>No Gate Check numbers saved yet.</div>
                    ) : (
                      setupGateChecks.map((item) => {
                        const available = cleanUpper(item.status) === "AVAILABLE";
                        const editing = editingGateCheckId === item.id;

                        return (
                          <div
                            key={item.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              flexWrap: "wrap",
                              alignItems: "center",
                              padding: 9,
                              borderRadius: 10,
                              border: "1px solid #e2e8f0",
                              background: "white",
                            }}
                          >
                            <div style={{ minWidth: 140 }}>
                              {editing ? (
                                <input
                                  value={editingGateCheckValue}
                                  onChange={(event) => setEditingGateCheckValue(event.target.value)}
                                  style={{ ...inputStyle, padding: "8px 10px" }}
                                />
                              ) : (
                                <strong>{item.gateCheckNumber || item.id}</strong>
                              )}
                              <div style={{ ...smallText, marginTop: 2 }}>
                                {item.status || "AVAILABLE"}
                                {item.passengerName ? ` - ${item.passengerName}` : ""}
                                {item.assignedSeat ? ` - Seat ${item.assignedSeat}` : ""}
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {editing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => saveManagedGateCheckEdit(item)}
                                    disabled={savingGateCheckManager}
                                    style={smallActionButton}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingGateCheckId("");
                                      setEditingGateCheckValue("");
                                    }}
                                    style={smallSecondaryButton}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingGateCheckId(item.id);
                                      setEditingGateCheckValue(item.gateCheckNumber || "");
                                    }}
                                    disabled={!available || !canManageGateChecks || savingGateCheckManager}
                                    style={{ ...smallActionButton, opacity: available ? 1 : 0.45 }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeManagedGateCheck(item)}
                                    disabled={!available || !canManageGateChecks || savingGateCheckManager}
                                    style={{ ...smallDangerButton, opacity: available ? 1 : 0.45 }}
                                  >
                                    Remove
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                  </>
                )}

                <button
                  type="button"

                  onClick={
                    saveSetup
                  }

                  disabled={
                    savingSetup ||
                    !canUploadDocuments ||
                    passengers.length ===
                      0 ||
                    availableSeats.length ===
                      0 ||
                    !validRequiredNumber
                  }

                  style={{
                    ...primaryButton,

                    opacity:
                      savingSetup ||
                      !canUploadDocuments ||
                      passengers.length ===
                        0 ||
                      availableSeats.length ===
                        0 ||
                      !validRequiredNumber
                        ? 0.55
                        : 1,
                  }}
                >
                  {savingSetup
                    ? "Saving Passenger / Seat Setup..."
                    : "Save Passenger & Seat Setup"}
                </button>

                <Notice
                  tone="warning"
                  text="After passenger/seat setup is saved, Counter can add the physical Gate Check numbers. Last-minute passengers and Gate Checks remain available in COUNTER, and extra assignments are still allowed above the Required target."
                />
              </>
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
          </div>
        )}

        {activeTab ===
          "COUNTER" && (
          <CarryOnCounterPage
            user={
              user
            }
            operationalContext={
              operationalContext
            }
            selectedCarryOnFlightId={
              selectedCarryOnFlightId
            }
            onSelectCarryOnFlight={
              setSelectedCarryOnFlightId
            }
          />
        )}

        {activeTab ===
          "GATE" && (
          <CarryOnGatePage
            user={
              user
            }
            operationalContext={
              operationalContext
            }
            selectedCarryOnFlightId={
              selectedCarryOnFlightId
            }
            onSelectCarryOnFlight={
              setSelectedCarryOnFlightId
            }
          />
        )}

        {activeTab ===
          "RAMP" && (
          <CarryOnRampPage
            user={
              user
            }
            operationalContext={
              operationalContext
            }
            selectedCarryOnFlightId={
              selectedCarryOnFlightId
            }
            onSelectCarryOnFlight={
              setSelectedCarryOnFlightId
            }
          />
        )}

        {activeTab ===
          "LOAD" && (
          <CarryOnLoadPage
            user={
              user
            }
            operationalContext={
              operationalContext
            }
            selectedCarryOnFlightId={
              selectedCarryOnFlightId
            }
            onSelectCarryOnFlight={
              setSelectedCarryOnFlightId
            }
          />
        )}

        {activeTab ===
          "TRACKING" && (
          <CarryOnTrackingPage
            selectedCarryOnFlightId={
              selectedCarryOnFlightId
            }
            onSelectCarryOnFlight={
              setSelectedCarryOnFlightId
            }
          />
        )}

        {activeTab ===
          "REPORT" && (
          <CarryOnReportPage
            selectedCarryOnFlightId={
              selectedCarryOnFlightId
            }
            onSelectCarryOnFlight={
              setSelectedCarryOnFlightId
            }
          />
        )}

        {activeTab ===
          "SUMMARY" && (
          <CarryOnSummaryPage
            user={
              user
            }
            operationalContext={
              operationalContext
            }
            selectedCarryOnFlightId={
              selectedCarryOnFlightId
            }
            onSelectCarryOnFlight={
              setSelectedCarryOnFlightId
            }
            onOpenTab={(tab) =>
              setActiveTab(tab)
            }
          />
        )}
      </section>
    </div>
  );
}

/* =========================
   UI
========================= */

function Field({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  inputMode,
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
        type={
          type
        }

        value={
          value
        }

        inputMode={
          inputMode
        }

        disabled={
          disabled
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

const smallActionButton = {
  padding: "7px 10px",
  borderRadius: 9,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const smallSecondaryButton = {
  padding: "7px 10px",
  borderRadius: 9,
  border: "1px solid #cbd5e1",
  background: "white",
  color: "#334155",
  fontWeight: 800,
  cursor: "pointer",
};

const smallDangerButton = {
  padding: "7px 10px",
  borderRadius: 9,
  border: "1px solid #dc2626",
  background: "#dc2626",
  color: "white",
  fontWeight: 800,
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

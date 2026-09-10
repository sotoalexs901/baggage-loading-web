// src/pages/FlightsPage.jsx

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";

import {
  httpsCallable,
} from "firebase/functions";

import {
  db,
  functions,
} from "../firebase";

import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  pdfWorker;

import {
  logSystemIncident,
  logSystemSuccess,
  startSystemTimer,
} from "../utils/systemLogger.js";

const MOBILE_BREAKPOINT = 760;

/* =========================
   HELPERS
========================= */

function getTodayYYYYMMDD() {
  const d = new Date();

  const y = d.getFullYear();

  const m = String(
    d.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    d.getDate()
  ).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function normalizeRole(
  roleRaw
) {
  return String(
    roleRaw || ""
  )
    .trim()
    .toLowerCase();
}

function normalizeOperationalPosition(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .toUpperCase();
}

function canCreateFlights(
  roleRaw
) {
  const role =
    normalizeRole(
      roleRaw
    );

  return (
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor" ||
    role ===
      "gate_controller"
  );
}

function isManager(
  roleRaw
) {
  const role =
    normalizeRole(
      roleRaw
    );

  return (
    role ===
      "station_manager" ||
    role ===
      "duty_manager" ||
    role ===
      "duty_managers" ||
    role ===
      "supervisor" ||
    role ===
      "gate_controller"
  );
}

function normalizeStatus(
  value
) {
  const status =
    String(
      value || "OPEN"
    )
      .trim()
      .toUpperCase();

  return [
    "OPEN",
    "RECEIVING",
    "LOADING",
    "LOADED",
  ].includes(status)
    ? status
    : "OPEN";
}

function getOperationalActor(
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

    role:
      user?.role ||
      null,

    fullName:
      operationalContext
        ?.employeeFullName ||
      user?.fullName ||
      user?.name ||
      user?.username ||
      null,

    employeeFullName:
      operationalContext
        ?.employeeFullName ||
      user?.fullName ||
      user?.name ||
      user?.username ||
      null,

    operationalPosition:
      normalizeOperationalPosition(
        operationalContext
          ?.operationalPosition
      ) || null,

    operationalPositionLabel:
      operationalContext
        ?.operationalPositionLabel ||
      null,

    basePosition:
      operationalContext
        ?.basePosition ||
      user?.position ||
      null,

    systemRole:
      operationalContext
        ?.systemRole ||
      normalizeRole(
        user?.role
      ) ||
      null,

    loginAt:
      operationalContext
        ?.loginAt ||
      null,
  };
}

function formatCallableError(
  error
) {
  const code =
    error?.code
      ? String(
          error.code
        )
      : "";

  const message =
    error?.message
      ? String(
          error.message
        )
      : "Unknown error";

  let details = "";

  try {
    details =
      error?.details
        ? JSON.stringify(
            error.details
          )
        : "";
  } catch {
    details = "";
  }

  return [
    code &&
      `(${code})`,

    message,

    details &&
      `Details: ${details}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/* =========================
   CARRY-ON REPORT RESTORE
========================= */

function cleanCarryOnText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCarryOnUpper(value) {
  return cleanCarryOnText(value)
    .toUpperCase();
}

function safeCarryOnDocId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_");
}

function normalizeCarryOnGateCheck(value) {
  return cleanCarryOnUpper(value)
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

function normalizeCarryOnSeat(value) {
  return cleanCarryOnUpper(value)
    .replace(/\s+/g, "");
}

function canonicalCarryOnStatus(value) {
  const normalized =
    cleanCarryOnUpper(value)
      .replace(/\s+/g, "_");

  if (
    normalized.includes("OFFLOAD")
  ) {
    return "OFFLOADED";
  }

  if (
    normalized.includes("AIRCRAFT") &&
    normalized.includes("LOAD")
  ) {
    return "AIRCRAFT_LOADED";
  }

  if (
    normalized === "LOADED" ||
    normalized.includes("AIRCRAFT_LOADED")
  ) {
    return "AIRCRAFT_LOADED";
  }

  if (
    normalized.includes("RAMP")
  ) {
    return "RAMP_RECEIVED";
  }

  if (
    normalized.includes("GATE")
  ) {
    return "GATE_COLLECTED";
  }

  return "COUNTER_ASSIGNED";
}

function actorFromReport(value) {
  const name =
    cleanCarryOnText(value);

  if (
    !name ||
    name === "-"
  ) {
    return null;
  }

  return {
    fullName:
      name,
    username:
      null,
    userId:
      null,
    role:
      null,
    restoredFromReport:
      true,
  };
}

function parseReportDateValue(value) {
  const raw =
    cleanCarryOnText(value);

  if (
    !raw ||
    raw === "-"
  ) {
    return null;
  }

  return raw;
}

function groupPdfItemsIntoRows(items) {
  const rowMap =
    new Map();

  for (
    const item of
      items
  ) {
    const value =
      cleanCarryOnText(
        item?.str
      );

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

    const key =
      Math.round(
        y / 3
      ) * 3;

    if (
      !rowMap.has(
        key
      )
    ) {
      rowMap.set(
        key,
        []
      );
    }

    rowMap
      .get(
        key
      )
      .push({
        text:
          value,
        x,
        y,
      });
  }

  return Array.from(
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
          rowItems,
        ]
      ) => ({
        items:
          rowItems.sort(
            (
              a,
              b
            ) =>
              a.x -
              b.x
          ),
        text:
          rowItems
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
                item.text
            )
            .join(" ")
            .replace(
              /\s+/g,
              " "
            )
            .trim(),
      })
    )
    .filter(
      (
        row
      ) =>
        Boolean(
          row.text
        )
    );
}

async function readCarryOnReportPdf(file) {
  const buffer =
    await file.arrayBuffer();

  const pdf =
    await pdfjsLib
      .getDocument({
        data:
          buffer,
      })
      .promise;

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

    const rows =
      groupPdfItemsIntoRows(
        content.items ||
        []
      );

    pages.push({
      pageNumber,
      rows,
    });
  }

  return pages;
}

function findReportMetadata(pages) {
  const lines =
    pages.flatMap(
      (
        page
      ) =>
        page.rows.map(
          (
            row
          ) =>
            row.text
        )
    );

  const fullText =
    lines.join("\n");

  let flightNumber =
    "";

  let flightDate =
    "";

  for (
    const line of
      lines
  ) {
    const match =
      line.match(
        /\b([A-Z0-9]{2,3}[0-9]{1,4})\b\s*[-\u2013\u2014]\s*(\d{4}-\d{2}-\d{2})\b/i
      );

    if (
      match
    ) {
      flightNumber =
        cleanCarryOnUpper(
          match[1]
        );

      flightDate =
        match[2];

      break;
    }
  }

  if (
    !flightNumber
  ) {
    const match =
      fullText.match(
        /\b([A-Z0-9]{2,3}[0-9]{1,4})\b/i
      );

    if (
      match
    ) {
      flightNumber =
        cleanCarryOnUpper(
          match[1]
        );
    }
  }

  if (
    !flightDate
  ) {
    const match =
      fullText.match(
        /\b(\d{4}-\d{2}-\d{2})\b/
      );

    if (
      match
    ) {
      flightDate =
        match[1];
    }
  }

  let origin =
    "";

  let destination =
    "";

  const routeMatch =
    fullText.match(
      /\bRoute\b\s*:?\s*([A-Z]{3})\s*(?:->|\u2192|\u2794|\u27A1)\s*([A-Z]{3})/i
    ) ||
    fullText.match(
      /\b([A-Z]{3})\s*(?:->|\u2192|\u2794|\u27A1)\s*([A-Z]{3})\b/
    );

  if (
    routeMatch
  ) {
    origin =
      cleanCarryOnUpper(
        routeMatch[1]
      );

    destination =
      cleanCarryOnUpper(
        routeMatch[2]
      );
  }

  const gateMatch =
    fullText.match(
      /\bGate\b\s*:?\s*([A-Z0-9-]+)/i
    );

  const tailMatch =
    fullText.match(
      /\bTail\b\s*:?\s*([A-Z0-9-]+)/i
    );

  const requiredMatch =
    fullText.match(
      /\bRequired\b\s*:?\s*(\d+)/i
    );

  return {
    flightNumber,
    flightDate,
    origin,
    destination,
    gate:
      gateMatch
        ? cleanCarryOnUpper(
            gateMatch[1]
          )
        : "",
    tailNumber:
      tailMatch
        ? cleanCarryOnUpper(
            tailMatch[1]
          )
        : "",
    requiredCarryOns:
      requiredMatch
        ? Number(
            requiredMatch[1]
          )
        : 0,
  };
}

const REPORT_HEADER_KEYS = [
  {
    key:
      "passengerName",
    tests: [
      "PASSENGER",
    ],
  },
  {
    key:
      "assignedSeat",
    tests: [
      "SEAT",
    ],
  },
  {
    key:
      "gateCheckNumber",
    tests: [
      "GATE CHECK",
      "GATECHECK",
    ],
  },
  {
    key:
      "passengerSource",
    tests: [
      "SOURCE",
    ],
  },
  {
    key:
      "counterRecordedWeightLbs",
    tests: [
      "COUNTER WEIGHT",
    ],
  },
  {
    key:
      "gateVerifiedWeightLbs",
    tests: [
      "GATE WEIGHT",
      "GATE VERIFIED",
    ],
  },
  {
    key:
      "status",
    tests: [
      "STATUS",
    ],
  },
  {
    key:
      "counterTime",
    tests: [
      "COUNTER TIME",
    ],
  },
  {
    key:
      "counterBy",
    tests: [
      "COUNTER BY",
    ],
  },
  {
    key:
      "gateTime",
    tests: [
      "GATE TIME",
    ],
  },
  {
    key:
      "gateBy",
    tests: [
      "GATE BY",
    ],
  },
  {
    key:
      "rampTime",
    tests: [
      "RAMP TIME",
    ],
  },
  {
    key:
      "rampBy",
    tests: [
      "RAMP BY",
    ],
  },
  {
    key:
      "loadedTime",
    tests: [
      "LOADED TIME",
    ],
  },
  {
    key:
      "loadedBy",
    tests: [
      "LOADED BY",
    ],
  },
  {
    key:
      "compartment",
    tests: [
      "COMPARTMENT",
    ],
  },
  {
    key:
      "gateNotes",
    tests: [
      "GATE NOTES",
      "GATE NOTE",
    ],
  },
  {
    key:
      "offloadReason",
    tests: [
      "OFFLOAD REASON",
    ],
  },
  {
    key:
      "offloadedAt",
    tests: [
      "OFFLOADED AT",
    ],
  },
  {
    key:
      "offloadedBy",
    tests: [
      "OFFLOADED BY",
    ],
  },
];

function detectReportHeader(row) {
  const upper =
    cleanCarryOnUpper(
      row?.text
    );

  if (
    !upper.includes(
      "PASSENGER"
    ) ||
    !upper.includes(
      "SEAT"
    ) ||
    !upper.includes(
      "GATE"
    )
  ) {
    return null;
  }

  const columns =
    [];

  for (
    const item of
      row.items ||
      []
  ) {
    const itemUpper =
      cleanCarryOnUpper(
        item.text
      );

    let key =
      null;

    for (
      const definition of
        REPORT_HEADER_KEYS
    ) {
      if (
        definition.tests.some(
          (
            test
          ) =>
            itemUpper ===
              test ||
            itemUpper.includes(
              test
            )
        )
      ) {
        key =
          definition.key;

        break;
      }
    }

    if (
      key
    ) {
      columns.push({
        key,
        x:
          item.x,
      });
    }
  }

  if (
    columns.length <
    3
  ) {
    return null;
  }

  return columns.sort(
    (
      a,
      b
    ) =>
      a.x -
      b.x
  );
}

function assignRowItemsToColumns(
  row,
  columns
) {
  if (
    !columns ||
    columns.length ===
      0
  ) {
    return null;
  }

  const result =
    {};

  for (
    const column of
      columns
  ) {
    result[
      column.key
    ] =
      [];
  }

  for (
    const item of
      row.items ||
      []
  ) {
    let selectedIndex =
      0;

    let bestDistance =
      Number.POSITIVE_INFINITY;

    columns.forEach(
      (
        column,
        index
      ) => {
        const distance =
          Math.abs(
            item.x -
              column.x
          );

        if (
          distance <
          bestDistance
        ) {
          bestDistance =
            distance;

          selectedIndex =
            index;
        }
      }
    );

    const selected =
      columns[
        selectedIndex
      ];

    result[
      selected.key
    ].push(
      item.text
    );
  }

  const output =
    {};

  Object.entries(
    result
  ).forEach(
    (
      [
        key,
        values,
      ]
    ) => {
      output[
        key
      ] =
        cleanCarryOnText(
          values.join(
            " "
          )
        );
    }
  );

  return output;
}

function parseCarryOnReportRows(pages) {
  const parsed =
    [];

  for (
    const page of
      pages
  ) {
    let columns =
      null;

    for (
      const row of
        page.rows
    ) {
      const detected =
        detectReportHeader(
          row
        );

      if (
        detected
      ) {
        columns =
          detected;
        continue;
      }

      if (
        !columns
      ) {
        continue;
      }

      const data =
        assignRowItemsToColumns(
          row,
          columns
        );

      if (
        !data
      ) {
        continue;
      }

      const gateCheckNumber =
        normalizeCarryOnGateCheck(
          data.gateCheckNumber
        );

      const passengerName =
        cleanCarryOnText(
          data.passengerName
        );

      const assignedSeat =
        normalizeCarryOnSeat(
          data.assignedSeat
        );

      if (
        !gateCheckNumber ||
        gateCheckNumber.length <
          3 ||
        !passengerName ||
        passengerName ===
          "-"
      ) {
        continue;
      }

      const counterWeight =
        Number(
          String(
            data.counterRecordedWeightLbs ||
            ""
          )
            .replace(
              /[^0-9.]/g,
              ""
            )
        );

      const gateWeight =
        Number(
          String(
            data.gateVerifiedWeightLbs ||
            ""
          )
            .replace(
              /[^0-9.]/g,
              ""
            )
        );

      parsed.push({
        passengerName,
        assignedSeat,
        gateCheckNumber,
        passengerSource:
          cleanCarryOnUpper(
            data.passengerSource
          ) ||
          "RESTORED_REPORT",
        status:
          canonicalCarryOnStatus(
            data.status
          ),
        counterRecordedWeightLbs:
          Number.isFinite(
            counterWeight
          ) &&
          counterWeight >
            0
            ? counterWeight
            : null,
        gateVerifiedWeightLbs:
          Number.isFinite(
            gateWeight
          ) &&
          gateWeight >
            0
            ? gateWeight
            : null,
        counterTime:
          parseReportDateValue(
            data.counterTime
          ),
        counterBy:
          cleanCarryOnText(
            data.counterBy
          ),
        gateTime:
          parseReportDateValue(
            data.gateTime
          ),
        gateBy:
          cleanCarryOnText(
            data.gateBy
          ),
        rampTime:
          parseReportDateValue(
            data.rampTime
          ),
        rampBy:
          cleanCarryOnText(
            data.rampBy
          ),
        loadedTime:
          parseReportDateValue(
            data.loadedTime
          ),
        loadedBy:
          cleanCarryOnText(
            data.loadedBy
          ),
        compartment:
          cleanCarryOnUpper(
            data.compartment
          ),
        gateCollectionNoteCombined:
          cleanCarryOnText(
            data.gateNotes
          ),
        offloadReason:
          cleanCarryOnText(
            data.offloadReason
          ),
        offloadedAt:
          parseReportDateValue(
            data.offloadedAt
          ),
        offloadedBy:
          cleanCarryOnText(
            data.offloadedBy
          ),
      });
    }
  }

  const seen =
    new Set();

  return parsed.filter(
    (
      item
    ) => {
      const key =
        item.gateCheckNumber;

      if (
        seen.has(
          key
        )
      ) {
        return false;
      }

      seen.add(
        key
      );

      return true;
    }
  );
}

async function parseCarryOnReportFile(file) {
  if (
    !file ||
    file.type !==
      "application/pdf"
  ) {
    throw new Error(
      "Select the Carry-On Gate Check Report as a PDF file."
    );
  }

  const pages =
    await readCarryOnReportPdf(
      file
    );

  const metadata =
    findReportMetadata(
      pages
    );

  const assignments =
    parseCarryOnReportRows(
      pages
    );

  if (
    !metadata.flightNumber ||
    !metadata.flightDate
  ) {
    throw new Error(
      "Flight Number or Flight Date could not be identified in the report."
    );
  }

  if (
    assignments.length ===
    0
  ) {
    throw new Error(
      "No Carry-On assignment rows could be identified. Use a BLCS Carry-On Gate Check Report generated by this system."
    );
  }

  return {
    metadata,
    assignments,
  };
}

async function commitCarryOnRestoreWrites(
  operations
) {
  const maxBatch =
    400;

  for (
    let index = 0;
    index <
    operations.length;
    index +=
      maxBatch
  ) {
    const batch =
      writeBatch(
        db
      );

    const chunk =
      operations.slice(
        index,
        index +
          maxBatch
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
   STATUS
========================= */

const STATUS_COLORS = {
  OPEN: {
    bg:
      "#fef3c7",

    text:
      "#92400e",

    border:
      "#f59e0b",
  },

  RECEIVING: {
    bg:
      "#dbeafe",

    text:
      "#1e3a8a",

    border:
      "#60a5fa",
  },

  LOADING: {
    bg:
      "#ffedd5",

    text:
      "#9a3412",

    border:
      "#fb923c",
  },

  LOADED: {
    bg:
      "#dcfce7",

    text:
      "#166534",

    border:
      "#22c55e",
  },
};

function StatusPill({
  status,
}) {
  const normalized =
    normalizeStatus(
      status
    );

  const colors =
    STATUS_COLORS[
      normalized
    ] ||
    STATUS_COLORS.OPEN;

  return (
    <span
      style={{
        display:
          "inline-flex",

        alignItems:
          "center",

        padding:
          "4px 10px",

        borderRadius:
          999,

        border:
          `1px solid ${colors.border}`,

        background:
          colors.bg,

        color:
          colors.text,

        fontWeight:
          900,

        fontSize:
          "0.75rem",

        letterSpacing:
          "0.04em",
      }}
    >
      {normalized}
    </span>
  );
}

/* =========================
   PAGE
========================= */

export default function FlightsPage({
  user,
  operationalContext,
  onFlightSelected,
  onOpenCarryOnSetup,
}) {
  const today =
    useMemo(
      () =>
        getTodayYYYYMMDD(),
      []
    );

  const [
    isMobile,
    setIsMobile,
  ] = useState(
    typeof window !==
      "undefined"
      ? window.innerWidth <
          MOBILE_BREAKPOINT
      : false
  );

  const [
    selectedDate,
    setSelectedDate,
  ] = useState(
    today
  );

  const [
    statusFilter,
    setStatusFilter,
  ] = useState(
    "active"
  );

  const [
    flights,
    setFlights,
  ] = useState([]);

  const [
    carryOnFlights,
    setCarryOnFlights,
  ] = useState([]);

  const [
    deletedCarryOnFlights,
    setDeletedCarryOnFlights,
  ] = useState([]);

  const [
    showDeletedCarryOn,
    setShowDeletedCarryOn,
  ] = useState(
    false
  );

  const [
    loadingCarryOn,
    setLoadingCarryOn,
  ] = useState(
    true
  );

  const [
    loading,
    setLoading,
  ] = useState(
    true
  );

  const [
    showCreate,
    setShowCreate,
  ] = useState(
    false
  );

  const [
    form,
    setForm,
  ] = useState({
    operationType:
      "REGULAR",

    flightNumber:
      "",

    flightDate:
      today,

    gate:
      "",

    aircraftType:
      "",

    origin:
      "TPA",

    destination:
      "",

    tailNumber:
      "",
  });

  const [
    formError,
    setFormError,
  ] = useState("");

  const [
    saving,
    setSaving,
  ] = useState(
    false
  );

  const [
    actionMsg,
    setActionMsg,
  ] = useState("");

  const [
    actionErr,
    setActionErr,
  ] = useState("");

  const [
    deletingId,
    setDeletingId,
  ] = useState("");

  const [
    reopeningId,
    setReopeningId,
  ] = useState("");

  const [
    editingCarryOn,
    setEditingCarryOn,
  ] = useState(
    null
  );

  const [
    editCarryOnForm,
    setEditCarryOnForm,
  ] = useState({
    flightNumber:
      "",

    flightDate:
      "",

    gate:
      "",

    aircraftType:
      "",

    origin:
      "",

    destination:
      "",

    tailNumber:
      "",
  });

  const [
    savingCarryOnEdit,
    setSavingCarryOnEdit,
  ] = useState(
    false
  );

  const [
    deletingCarryOnId,
    setDeletingCarryOnId,
  ] = useState(
    ""
  );

  const [
    restoringCarryOnId,
    setRestoringCarryOnId,
  ] = useState(
    ""
  );

  const [
    showRestoreReport,
    setShowRestoreReport,
  ] = useState(
    false
  );

  const [
    restoreReportFile,
    setRestoreReportFile,
  ] = useState(
    null
  );

  const [
    restoreReportPreview,
    setRestoreReportPreview,
  ] = useState(
    null
  );

  const [
    restoreReportForm,
    setRestoreReportForm,
  ] = useState({
    flightNumber:
      "",
    flightDate:
      "",
    origin:
      "",
    destination:
      "",
    gate:
      "",
    tailNumber:
      "",
    requiredCarryOns:
      0,
  });

  const [
    parsingRestoreReport,
    setParsingRestoreReport,
  ] = useState(
    false
  );

  const [
    restoringFromReport,
    setRestoringFromReport,
  ] = useState(
    false
  );

  const [
    restoreReportError,
    setRestoreReportError,
  ] = useState(
    ""
  );

  const allowCreate =
    canCreateFlights(
      user?.role
    );

  const allowManage =
    isManager(
      user?.role
    );

  const operationalActor =
    useMemo(
      () =>
        getOperationalActor(
          user,
          operationalContext
        ),
      [
        user,
        operationalContext,
      ]
    );

  /* =========================
     RESPONSIVE
  ========================= */

  useEffect(() => {
    const handleResize =
      () => {
        setIsMobile(
          window.innerWidth <
            MOBILE_BREAKPOINT
        );
      };

    window.addEventListener(
      "resize",
      handleResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleResize
      );
    };
  }, []);

  /* =========================
     FLIGHT SUBSCRIPTION
  ========================= */

  useEffect(() => {
    setLoading(
      true
    );

    const qRef =
      query(
        collection(
          db,
          "flights"
        ),

        where(
          "flightDate",
          "==",
          selectedDate
        ),

        orderBy(
          "createdAt",
          "desc"
        )
      );

    const unsub =
      onSnapshot(
        qRef,

        (
          snap
        ) => {
          const rows =
            snap.docs.map(
              (
                documentSnapshot
              ) => ({
                id:
                  documentSnapshot.id,

                ...documentSnapshot.data(),
              })
            );

          const filtered =
            statusFilter ===
            "all"
              ? rows
              : statusFilter ===
                  "completed"
                ? rows.filter(
                    (
                      flight
                    ) =>
                      normalizeStatus(
                        flight.status
                      ) ===
                      "LOADED"
                  )
                : rows.filter(
                    (
                      flight
                    ) =>
                      normalizeStatus(
                        flight.status
                      ) !==
                      "LOADED"
                  );

          setFlights(
            filtered
          );

          setLoading(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "Flights onSnapshot error:",
            error
          );

          setFlights([]);

          setLoading(
            false
          );

          logSystemIncident({
            module:
              "FLIGHTS",

            action:
              "LOAD_FLIGHTS",

            status:
              "ERROR",

            severity:
              "HIGH",

            errorType:
              "FIRESTORE_SNAPSHOT",

            errorCode:
              error?.code ||
              error?.name ||
              null,

            message:
              error?.message ||
              "Unable to load flights.",

            user,

            operationalContext,

            currentView:
              "flights",

            metadata: {
              selectedDate,
              statusFilter,
            },
          });
        }
      );

    return () => {
      unsub();
    };
  }, [
    selectedDate,
    statusFilter,
    user,
    operationalContext,
  ]);

  /* =========================
     CARRY-ON FLIGHTS SUBSCRIPTION
  ========================= */

  useEffect(() => {
    setLoadingCarryOn(
      true
    );

    const qRef =
      query(
        collection(
          db,
          "carryOnFlights"
        ),

        where(
          "flightDate",
          "==",
          selectedDate
        )
      );

    const unsub =
      onSnapshot(
        qRef,

        (
          snap
        ) => {
          const rows =
            snap.docs.map(
              (
                documentSnapshot
              ) => ({
                id:
                  documentSnapshot.id,

                ...documentSnapshot.data(),
              })
            );

          rows.sort(
            (
              a,
              b
            ) =>
              String(
                a.flightNumber ||
                ""
              ).localeCompare(
                String(
                  b.flightNumber ||
                  ""
                )
              )
          );

          const activeRows =
            rows.filter(
              (
                flight
              ) =>
                flight?.isDeleted !==
                true
            );

          const deletedRows =
            rows.filter(
              (
                flight
              ) =>
                flight?.isDeleted ===
                true
            );

          setCarryOnFlights(
            activeRows
          );

          setDeletedCarryOnFlights(
            deletedRows
          );

          setLoadingCarryOn(
            false
          );
        },

        (
          error
        ) => {
          console.error(
            "Carry-On flights snapshot error:",
            error
          );

          setCarryOnFlights(
            []
          );

          setLoadingCarryOn(
            false
          );
        }
      );

    return () => {
      unsub();
    };
  }, [
    selectedDate,
  ]);

  /* =========================
     CREATE MODAL
  ========================= */

  const openCreate =
    () => {
      setFormError(
        ""
      );

      setForm({
        operationType:
          "REGULAR",

        flightNumber:
          "",

        flightDate:
          selectedDate,

        gate:
          "",

        aircraftType:
          "",

        origin:
          "TPA",

        destination:
          "",

        tailNumber:
          "",
      });

      setShowCreate(
        true
      );
    };

  const closeCreate =
    () => {
      if (saving) {
        return;
      }

      setShowCreate(
        false
      );

      setFormError(
        ""
      );
    };

  /* =========================
     CREATE FLIGHT
  ========================= */

  const handleCreate =
    async () => {
      if (saving) {
        return;
      }

      setFormError(
        ""
      );

      setActionMsg(
        ""
      );

      setActionErr(
        ""
      );

      const timer =
        startSystemTimer();

      const operationType =
        String(
          form.operationType ||
          "REGULAR"
        )
          .trim()
          .toUpperCase();

      const flightNumber =
        form.flightNumber
          .trim()
          .toUpperCase();

      const flightDate =
        form.flightDate
          .trim();

      const gate =
        form.gate
          .trim()
          .toUpperCase();

      const aircraftType =
        form.aircraftType
          .trim()
          .toUpperCase();

      const origin =
        form.origin
          .trim()
          .toUpperCase();

      const destination =
        form.destination
          .trim()
          .toUpperCase();

      const tailNumber =
        form.tailNumber
          .trim()
          .toUpperCase();

      if (
        !flightNumber ||
        !flightDate
      ) {
        setFormError(
          "Flight number and date are required."
        );

        return;
      }

      try {
        setSaving(
          true
        );

        if (
          operationType ===
          "CARRY_ON_ONLY"
        ) {
          if (
            !origin ||
            !destination
          ) {
            throw new Error(
              "Origin and Destination are required for Carry-On-only flights."
            );
          }

          const match =
            flightNumber.match(
              /^([A-Z0-9]{2,3})([0-9]{1,4})$/
            );

          if (
            !match
          ) {
            throw new Error(
              "Use a complete flight number such as WL294."
            );
          }

          const carryOnFlightId =
            `${flightNumber}_${flightDate}`
              .replace(
                /[^A-Za-z0-9_-]/g,
                "_"
              );

          const carryOnRef =
            doc(
              db,
              "carryOnFlights",
              carryOnFlightId
            );

          const existing =
            await getDoc(
              carryOnRef
            );

          if (
            existing.exists()
          ) {
            setFormError(
              "This Carry-On flight already exists for that date."
            );

            return;
          }

          await setDoc(
            carryOnRef,
            {
              operationType:
                "CARRY_ON_ONLY",

              flightNumber,

              airline:
                match[1],

              flightNumberOnly:
                match[2],

              flightDate,

              origin,

              destination,

              gate:
                gate ||
                null,

              aircraft:
                aircraftType ||
                null,

              aircraftType:
                aircraftType ||
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
                operationalActor,
            }
          );

          await logSystemSuccess({
            module:
              "FLIGHTS",

            action:
              "CREATE_CARRY_ON_FLIGHT",

            durationMs:
              timer.elapsed(),
          });

          setShowCreate(
            false
          );

          setActionMsg(
            `Carry-On flight created: ${flightNumber}. Use Setup to upload documents.`
          );

          return;
        }

        const dupQ =
          query(
            collection(
              db,
              "flights"
            ),

            where(
              "flightDate",
              "==",
              flightDate
            ),

            where(
              "flightNumber",
              "==",
              flightNumber
            ),

            limit(
              1
            )
          );

        const dupSnap =
          await getDocs(
            dupQ
          );

        if (
          !dupSnap.empty
        ) {
          setFormError(
            "This flight already exists for that date."
          );

          return;
        }

        const payload = {
          flightNumber,
          flightDate,

          gate:
            gate ||
            null,

          aircraftType:
            aircraftType ||
            null,

          status:
            "OPEN",

          createdAt:
            serverTimestamp(),

          createdBy:
            operationalActor,

          createdByUsername:
            user?.username ||
            null,

          createdByFullName:
            operationalActor
              .employeeFullName,

          createdByOperationalPosition:
            operationalActor
              .operationalPosition,

          createdByOperationalPositionLabel:
            operationalActor
              .operationalPositionLabel,
        };

        const docRef =
          await addDoc(
            collection(
              db,
              "flights"
            ),

            payload
          );

        await logSystemSuccess({
          module:
            "FLIGHTS",

          action:
            "CREATE_FLIGHT",

          durationMs:
            timer.elapsed(),
        });

        setShowCreate(
          false
        );

        setActionMsg(
          `Flight created: ${flightNumber}`
        );

        onFlightSelected?.(
          docRef.id,
          flightNumber
        );
      } catch (
        error
      ) {
        console.error(
          "Create flight error:",
          error
        );

        setFormError(
          error?.message ||
          "Could not create flight."
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  /* =========================
     OPEN FLIGHT
  ========================= */

  const openFlight =
    async (
      flight
    ) => {
      const timer =
        startSystemTimer();

      try {
        if (
          typeof onFlightSelected !==
          "function"
        ) {
          throw new Error(
            "Flight selection handler is not available."
          );
        }

        onFlightSelected(
          flight.id,
          flight.flightNumber ||
            null
        );

        await logSystemSuccess({
          module:
            "FLIGHTS",

          action:
            "OPEN_FLIGHT",

          durationMs:
            timer.elapsed(),
        });
      } catch (
        error
      ) {
        console.error(
          "Open flight error:",
          error
        );

        setActionErr(
          "Could not open selected flight."
        );

        await logSystemIncident({
          module:
            "FLIGHTS",

          action:
            "OPEN_FLIGHT",

          status:
            "ERROR",

          severity:
            "HIGH",

          errorType:
            "NAVIGATION",

          errorCode:
            error?.code ||
            error?.name ||
            null,

          message:
            error?.message ||
            "Could not open selected flight.",

          user,

          operationalContext,

          flightId:
            flight?.id ||
            null,

          flightNumber:
            flight
              ?.flightNumber ||
            null,

          currentView:
            "flights",

          durationMs:
            timer.elapsed(),
        });
      }
    };

  /* =========================
     REOPEN FLIGHT
  ========================= */

  const handleReopen =
    async (
      flight
    ) => {
      if (
        !allowManage
      ) {
        return;
      }

      setActionMsg(
        ""
      );

      setActionErr(
        ""
      );

      const ok =
        window.confirm(
          `Reopen this flight?\n\n` +
            `${flight.flightNumber || flight.id} ` +
            `(${flight.flightDate || "-"})\n\n` +
            `This will unlock scanning again.`
        );

      if (!ok) {
        return;
      }

      const timer =
        startSystemTimer();

      try {
        setReopeningId(
          flight.id
        );

        const reopenFlight =
          httpsCallable(
            functions,
            "reopenFlight"
          );

        await reopenFlight({
          flightId:
            flight.id,

          userRole:
            user?.role ||
            null,

          username:
            user?.username ||
            null,

          employeeFullName:
            operationalActor
              .employeeFullName,

          operationalPosition:
            operationalActor
              .operationalPosition,

          operationalPositionLabel:
            operationalActor
              .operationalPositionLabel,
        });

        await logSystemSuccess({
          module:
            "FLIGHTS",

          action:
            "REOPEN_FLIGHT",

          durationMs:
            timer.elapsed(),
        });

        setActionMsg(
          `Flight reopened: ${
            flight.flightNumber ||
            flight.id
          }`
        );

        window.setTimeout(
          () => {
            setActionMsg(
              ""
            );
          },
          2500
        );
      } catch (
        error
      ) {
        console.error(
          "reopenFlight failed:",
          error
        );

        const message =
          formatCallableError(
            error
          );

        setActionErr(
          message
        );

        await logSystemIncident({
          module:
            "FLIGHTS",

          action:
            "REOPEN_FLIGHT",

          status:
            "ERROR",

          severity:
            "HIGH",

          errorType:
            "CLOUD_FUNCTION",

          errorCode:
            error?.code ||
            error?.name ||
            null,

          message,

          user,

          operationalContext,

          flightId:
            flight.id,

          flightNumber:
            flight
              ?.flightNumber ||
            null,

          currentView:
            "flights",

          durationMs:
            timer.elapsed(),
        });
      } finally {
        setReopeningId(
          ""
        );
      }
    };

  /* =========================
     DELETE FLIGHT
  ========================= */

  const handleDelete =
    async (
      flight
    ) => {
      if (
        !allowManage
      ) {
        return;
      }

      setActionMsg(
        ""
      );

      setActionErr(
        ""
      );

      const labelText =
        `${flight.flightNumber || flight.id} ` +
        `(${flight.flightDate || "-"})`;

      const ok =
        window.confirm(
          `DELETE FLIGHT?\n\n` +
            `${labelText}\n\n` +
            `This will permanently remove:\n` +
            `- Counter scans\n` +
            `- Bagroom / Oversize / Gate-Ramp scans\n` +
            `- Aircraft scans\n` +
            `- Manifest tags\n` +
            `- Reports\n` +
            `- PDFs and flight files in Storage\n` +
            `- Global bagTags tracking records\n` +
            `- Bag tag event history\n\n` +
            `This cannot be undone.`
        );

      if (!ok) {
        return;
      }

      const timer =
        startSystemTimer();

      try {
        setDeletingId(
          flight.id
        );

        const deleteFlightCascade =
          httpsCallable(
            functions,
            "deleteFlightCascade"
          );

        const result =
          await deleteFlightCascade({
            flightId:
              flight.id,

            userRole:
              user?.role ||
              null,

            username:
              user?.username ||
              null,

            employeeFullName:
              operationalActor
                .employeeFullName,

            operationalPosition:
              operationalActor
                .operationalPosition,

            operationalPositionLabel:
              operationalActor
                .operationalPositionLabel,
          });

        const deletedBagTags =
          result?.data
            ?.deletedBagTags ||
          0;

        await logSystemSuccess({
          module:
            "FLIGHTS",

          action:
            "DELETE_FLIGHT",

          durationMs:
            timer.elapsed(),
        });

        setActionMsg(
          `Flight deleted: ${labelText}. ` +
            `${deletedBagTags} tracked bag tag record(s) removed.`
        );

        window.setTimeout(
          () => {
            setActionMsg(
              ""
            );
          },
          3500
        );
      } catch (
        error
      ) {
        console.error(
          "deleteFlightCascade failed:",
          error
        );

        const message =
          formatCallableError(
            error
          );

        setActionErr(
          message
        );

        await logSystemIncident({
          module:
            "FLIGHTS",

          action:
            "DELETE_FLIGHT",

          status:
            "ERROR",

          severity:
            "CRITICAL",

          errorType:
            "CLOUD_FUNCTION",

          errorCode:
            error?.code ||
            error?.name ||
            null,

          message,

          user,

          operationalContext,

          flightId:
            flight.id,

          flightNumber:
            flight
              ?.flightNumber ||
            null,

          currentView:
            "flights",

          durationMs:
            timer.elapsed(),
        });
      } finally {
        setDeletingId(
          ""
        );
      }
    };

  /* =========================
     CARRY-ON EDIT / DELETE
  ========================= */

  const openCarryOnEdit =
    (
      flight
    ) => {
      setActionMsg(
        ""
      );

      setActionErr(
        ""
      );

      setEditingCarryOn(
        flight
      );

      setEditCarryOnForm({
        flightNumber:
          flight
            ?.flightNumber ||
          "",

        flightDate:
          flight
            ?.flightDate ||
          selectedDate,

        gate:
          flight
            ?.gate ||
          "",

        aircraftType:
          flight
            ?.aircraftType ||
          flight
            ?.aircraft ||
          "",

        origin:
          flight
            ?.origin ||
          "",

        destination:
          flight
            ?.destination ||
          "",

        tailNumber:
          flight
            ?.tailNumber ||
          "",
      });
    };

  const saveCarryOnEdit =
    async () => {
      if (
        !editingCarryOn ||
        savingCarryOnEdit
      ) {
        return;
      }

      setActionMsg(
        ""
      );

      setActionErr(
        ""
      );

      const flightNumber =
        String(
          editCarryOnForm
            .flightNumber ||
          ""
        )
          .trim()
          .toUpperCase();

      const flightDate =
        String(
          editCarryOnForm
            .flightDate ||
          ""
        ).trim();

      const gate =
        String(
          editCarryOnForm
            .gate ||
          ""
        )
          .trim()
          .toUpperCase();

      const aircraftType =
        String(
          editCarryOnForm
            .aircraftType ||
          ""
        )
          .trim()
          .toUpperCase();

      const origin =
        String(
          editCarryOnForm
            .origin ||
          ""
        )
          .trim()
          .toUpperCase();

      const destination =
        String(
          editCarryOnForm
            .destination ||
          ""
        )
          .trim()
          .toUpperCase();

      const tailNumber =
        String(
          editCarryOnForm
            .tailNumber ||
          ""
        )
          .trim()
          .toUpperCase();

      const match =
        flightNumber.match(
          /^([A-Z0-9]{2,3})([0-9]{1,4})$/
        );

      if (
        !match ||
        !flightDate ||
        !origin ||
        !destination
      ) {
        setActionErr(
          "Flight Number, Date, Origin and Destination are required."
        );

        return;
      }

      try {
        setSavingCarryOnEdit(
          true
        );

        await updateDoc(
          doc(
            db,
            "carryOnFlights",
            editingCarryOn.id
          ),
          {
            flightNumber,

            airline:
              match[1],

            flightNumberOnly:
              match[2],

            flightDate,

            gate:
              gate ||
              null,

            aircraft:
              aircraftType ||
              null,

            aircraftType:
              aircraftType ||
              null,

            origin,

            destination,

            tailNumber:
              tailNumber ||
              null,

            updatedAt:
              serverTimestamp(),

            updatedBy:
              operationalActor,
          }
        );

        setEditingCarryOn(
          null
        );

        setActionMsg(
          `Carry-On flight updated: ${flightNumber}`
        );
      } catch (
        error
      ) {
        console.error(
          "Carry-On edit failed:",
          error
        );

        setActionErr(
          error?.message ||
          "Could not update Carry-On flight."
        );
      } finally {
        setSavingCarryOnEdit(
          false
        );
      }
    };

  const deleteCarryOnSubcollection =
    async (
      flightId,
      subcollectionName
    ) => {
      const snap =
        await getDocs(
          collection(
            db,
            "carryOnFlights",
            flightId,
            subcollectionName
          )
        );

      const docs =
        snap.docs;

      for (
        let index = 0;
        index <
        docs.length;
        index += 400
      ) {
        const batch =
          writeBatch(
            db
          );

        docs
          .slice(
            index,
            index + 400
          )
          .forEach(
            (
              item
            ) => {
              batch.delete(
                item.ref
              );
            }
          );

        await batch.commit();
      }
    };

  const handleDeleteCarryOn =
    async (
      flight
    ) => {
      if (
        !allowManage ||
        deletingCarryOnId
      ) {
        return;
      }

      const ok =
        window.confirm(
          `MOVE CARRY-ON FLIGHT TO DELETED?\n\n` +
            `${flight.flightNumber || flight.id} ` +
            `(${flight.flightDate || "-"})\n\n` +
            `The flight and all Carry-On operational data will be kept so it can be restored if this was a mistake.`
        );

      if (!ok) {
        return;
      }

      try {
        setDeletingCarryOnId(
          flight.id
        );

        await updateDoc(
          doc(
            db,
            "carryOnFlights",
            flight.id
          ),
          {
            isDeleted:
              true,

            deletedAt:
              serverTimestamp(),

            deletedBy:
              operationalActor,

            updatedAt:
              serverTimestamp(),

            updatedBy:
              operationalActor,
          }
        );

        if (
          sessionStorage.getItem(
            "selectedCarryOnFlightId"
          ) ===
          flight.id
        ) {
          sessionStorage.removeItem(
            "selectedCarryOnFlightId"
          );
        }

        setActionMsg(
          `Carry-On flight moved to Deleted: ${flight.flightNumber || flight.id}`
        );
      } catch (
        error
      ) {
        console.error(
          "Carry-On soft delete failed:",
          error
        );

        setActionErr(
          error?.message ||
          "Could not move Carry-On flight to Deleted."
        );
      } finally {
        setDeletingCarryOnId(
          ""
        );
      }
    };

  const handleRestoreCarryOn =
    async (
      flight
    ) => {
      if (
        !allowManage ||
        restoringCarryOnId
      ) {
        return;
      }

      const ok =
        window.confirm(
          `RESTORE CARRY-ON FLIGHT?\n\n` +
            `${flight.flightNumber || flight.id} ` +
            `(${flight.flightDate || "-"})\n\n` +
            `The flight and its existing Carry-On data will return to the active list.`
        );

      if (!ok) {
        return;
      }

      try {
        setRestoringCarryOnId(
          flight.id
        );

        await updateDoc(
          doc(
            db,
            "carryOnFlights",
            flight.id
          ),
          {
            isDeleted:
              false,

            restoredAt:
              serverTimestamp(),

            restoredBy:
              operationalActor,

            deletedAt:
              null,

            deletedBy:
              null,

            updatedAt:
              serverTimestamp(),

            updatedBy:
              operationalActor,
          }
        );

        setActionMsg(
          `Carry-On flight restored: ${flight.flightNumber || flight.id}`
        );
      } catch (
        error
      ) {
        console.error(
          "Carry-On restore failed:",
          error
        );

        setActionErr(
          error?.message ||
          "Could not restore Carry-On flight."
        );
      } finally {
        setRestoringCarryOnId(
          ""
        );
      }
    };

  const openRestoreFromReport =
    () => {
      setRestoreReportFile(
        null
      );

      setRestoreReportPreview(
        null
      );

      setRestoreReportForm({
        flightNumber:
          "",
        flightDate:
          "",
        origin:
          "",
        destination:
          "",
        gate:
          "",
        tailNumber:
          "",
        requiredCarryOns:
          0,
      });

      setRestoreReportError(
        ""
      );

      setShowRestoreReport(
        true
      );
    };

  const closeRestoreFromReport =
    () => {
      if (
        parsingRestoreReport ||
        restoringFromReport
      ) {
        return;
      }

      setShowRestoreReport(
        false
      );

      setRestoreReportFile(
        null
      );

      setRestoreReportPreview(
        null
      );

      setRestoreReportError(
        ""
      );
    };

  const handleRestoreReportFile =
    async (
      file
    ) => {
      setRestoreReportError(
        ""
      );

      setRestoreReportPreview(
        null
      );

      setRestoreReportFile(
        file ||
        null
      );

      if (!file) {
        return;
      }

      try {
        setParsingRestoreReport(
          true
        );

        const parsed =
          await parseCarryOnReportFile(
            file
          );

        setRestoreReportPreview(
          parsed
        );

        setRestoreReportForm({
          flightNumber:
            parsed.metadata
              .flightNumber ||
            "",
          flightDate:
            parsed.metadata
              .flightDate ||
            "",
          origin:
            parsed.metadata
              .origin ||
            "",
          destination:
            parsed.metadata
              .destination ||
            "",
          gate:
            parsed.metadata
              .gate ||
            "",
          tailNumber:
            parsed.metadata
              .tailNumber ||
            "",
          requiredCarryOns:
            Number(
              parsed.metadata
                .requiredCarryOns ||
              parsed.assignments
                .length
            ),
        });
      } catch (
        error
      ) {
        console.error(
          "Carry-On report parse error:",
          error
        );

        setRestoreReportError(
          error?.message ||
          "Unable to read Carry-On report."
        );
      } finally {
        setParsingRestoreReport(
          false
        );
      }
    };

  const restoreFlightFromReport =
    async () => {
      if (
        !allowManage ||
        !restoreReportPreview ||
        restoringFromReport
      ) {
        return;
      }

      setRestoreReportError(
        ""
      );

      const flightNumber =
        cleanCarryOnUpper(
          restoreReportForm
            .flightNumber
        );

      const flightDate =
        cleanCarryOnText(
          restoreReportForm
            .flightDate
        );

      const origin =
        cleanCarryOnUpper(
          restoreReportForm
            .origin
        );

      const destination =
        cleanCarryOnUpper(
          restoreReportForm
            .destination
        );

      const gate =
        cleanCarryOnUpper(
          restoreReportForm
            .gate
        );

      const tailNumber =
        cleanCarryOnUpper(
          restoreReportForm
            .tailNumber
        );

      const requiredCarryOns =
        Math.max(
          0,
          Math.trunc(
            Number(
              restoreReportForm
                .requiredCarryOns ||
              0
            )
          )
        );

      if (
        !flightNumber ||
        !flightDate
      ) {
        setRestoreReportError(
          "Flight Number and Flight Date are required."
        );

        return;
      }

      const match =
        flightNumber.match(
          /^([A-Z0-9]{2,3})([0-9]{1,4})$/
        );

      if (!match) {
        setRestoreReportError(
          "Use a complete Flight Number such as WL294."
        );

        return;
      }

      const assignments =
        restoreReportPreview
          .assignments ||
        [];

      if (
        assignments.length ===
        0
      ) {
        setRestoreReportError(
          "There are no Carry-On assignments to restore."
        );

        return;
      }

      const flightId =
        safeCarryOnDocId(
          `${flightNumber}_${flightDate}`
        );

      const flightRef =
        doc(
          db,
          "carryOnFlights",
          flightId
        );

      try {
        setRestoringFromReport(
          true
        );

        const existing =
          await getDoc(
            flightRef
          );

        if (
          existing.exists() &&
          existing.data()
            ?.isDeleted !==
            true
        ) {
          throw new Error(
            "An active Carry-On flight already exists with this Flight Number and Date."
          );
        }

        const ok =
          window.confirm(
            `RESTORE CARRY-ON FLIGHT FROM REPORT?\n\n` +
              `${flightNumber} - ${flightDate}\n` +
              `${assignments.length} Carry-On assignment(s) found.\n\n` +
              `This will recreate the flight, passengers, assigned seats, Gate Check numbers and assignment status from the report.`
          );

        if (!ok) {
          return;
        }

        const loadedCount =
          assignments.filter(
            (
              item
            ) =>
              item.status ===
              "AIRCRAFT_LOADED"
          ).length;

        const offloadedCount =
          assignments.filter(
            (
              item
            ) =>
              item.status ===
              "OFFLOADED"
          ).length;

        const terminalCount =
          loadedCount +
          offloadedCount;

        const rootStatus =
          terminalCount ===
            assignments.length
            ? "CLOSED"
            : "IN_PROGRESS";

        const operations =
          [];

        assignments.forEach(
          (
            item,
            index
          ) => {
            const gateCheckNumber =
              normalizeCarryOnGateCheck(
                item.gateCheckNumber
              );

            const gateCheckId =
              safeCarryOnDocId(
                gateCheckNumber
              );

            const seatNumber =
              normalizeCarryOnSeat(
                item.assignedSeat
              );

            const passengerId =
              safeCarryOnDocId(
                `RESTORED_${index + 1}_${gateCheckNumber}`
              );

            const assignmentData = {
              passengerId,

              passengerName:
                item.passengerName,

              passengerSource:
                item.passengerSource ||
                "RESTORED_REPORT",

              assignedSeat:
                seatNumber ||
                null,

              assignedSeatType:
                null,

              gateCheckNumber,

              gateCheckSource:
                "RESTORED_REPORT",

              status:
                item.status,

              counterRecordedWeightLbs:
                item.counterRecordedWeightLbs ??
                null,

              gateVerifiedWeightLbs:
                item.gateVerifiedWeightLbs ??
                null,

              counterAssignedAt:
                item.counterTime ||
                null,

              counterAssignedBy:
                actorFromReport(
                  item.counterBy
                ),

              gateCollectedAt:
                item.gateTime ||
                null,

              gateCollectedBy:
                actorFromReport(
                  item.gateBy
                ),

              rampReceivedAt:
                item.rampTime ||
                null,

              rampReceivedBy:
                actorFromReport(
                  item.rampBy
                ),

              aircraftLoadedAt:
                item.loadedTime ||
                null,

              aircraftLoadedBy:
                actorFromReport(
                  item.loadedBy
                ),

              compartment:
                item.compartment &&
                item.compartment !==
                  "-"
                  ? item.compartment
                  : null,

              gateCollectionNoteCombined:
                item.gateCollectionNoteCombined &&
                item.gateCollectionNoteCombined !==
                  "-"
                  ? item.gateCollectionNoteCombined
                  : null,

              offloadReason:
                item.offloadReason &&
                item.offloadReason !==
                  "-"
                  ? item.offloadReason
                  : null,

              offloadedAt:
                item.offloadedAt ||
                null,

              offloadedBy:
                actorFromReport(
                  item.offloadedBy
                ),

              restoredFromReport:
                true,

              restoreSourceFileName:
                restoreReportFile
                  ?.name ||
                null,

              restoredAt:
                serverTimestamp(),

              restoredBy:
                operationalActor,

              createdAt:
                serverTimestamp(),

              createdBy:
                operationalActor,

              updatedAt:
                serverTimestamp(),

              updatedBy:
                operationalActor,
            };

            operations.push({
              ref:
                doc(
                  db,
                  "carryOnFlights",
                  flightId,
                  "assignments",
                  gateCheckId
                ),
              data:
                assignmentData,
            });

            operations.push({
              ref:
                doc(
                  db,
                  "carryOnFlights",
                  flightId,
                  "gateCheckNumbers",
                  gateCheckId
                ),
              data: {
                gateCheckNumber,
                status:
                  item.status,
                source:
                  "RESTORED_REPORT",
                assignmentId:
                  gateCheckId,
                passengerId,
                passengerName:
                  item.passengerName,
                assignedSeat:
                  seatNumber ||
                  null,
                counterRecordedWeightLbs:
                  item.counterRecordedWeightLbs ??
                  null,
                gateVerifiedWeightLbs:
                  item.gateVerifiedWeightLbs ??
                  null,
                restoredFromReport:
                  true,
                restoredAt:
                  serverTimestamp(),
                restoredBy:
                  operationalActor,
              },
            });

            operations.push({
              ref:
                doc(
                  db,
                  "carryOnFlights",
                  flightId,
                  "passengers",
                  passengerId
                ),
              data: {
                passengerName:
                  item.passengerName,
                source:
                  item.passengerSource ||
                  "RESTORED_REPORT",
                assigned:
                  true,
                assignedSeat:
                  seatNumber ||
                  null,
                gateCheckNumber,
                assignmentId:
                  gateCheckId,
                restoredFromReport:
                  true,
                restoredAt:
                  serverTimestamp(),
                restoredBy:
                  operationalActor,
              },
            });

            if (
              seatNumber
            ) {
              operations.push({
                ref:
                  doc(
                    db,
                    "carryOnFlights",
                    flightId,
                    "availableSeats",
                    safeCarryOnDocId(
                      seatNumber
                    )
                  ),
                data: {
                  seatNumber,
                  seatType:
                    null,
                  blocked:
                    false,
                  status:
                    "ASSIGNED",
                  assignmentId:
                    gateCheckId,
                  passengerId,
                  passengerName:
                    item.passengerName,
                  gateCheckNumber,
                  source:
                    "RESTORED_REPORT",
                  restoredFromReport:
                    true,
                  restoredAt:
                    serverTimestamp(),
                  restoredBy:
                    operationalActor,
                },
              });
            }
          }
        );

        operations.push({
          ref:
            flightRef,
          data: {
            operationType:
              "CARRY_ON_ONLY",

            flightNumber,

            airline:
              match[1],

            flightNumberOnly:
              match[2],

            flightDate,

            origin:
              origin ||
              null,

            destination:
              destination ||
              null,

            gate:
              gate ||
              null,

            tailNumber:
              tailNumber ||
              null,

            status:
              rootStatus,

            requiredCarryOns,

            passengerCount:
              assignments.length,

            availableSeatCount:
              assignments.filter(
                (
                  item
                ) =>
                  Boolean(
                    normalizeCarryOnSeat(
                      item.assignedSeat
                    )
                  )
              ).length,

            gateCheckNumberCount:
              assignments.length,

            assignmentCount:
              assignments.length,

            restoredFromReport:
              true,

            restoreSource:
              "CARRY_ON_GATE_CHECK_REPORT_PDF",

            restoreSourceFileName:
              restoreReportFile
                ?.name ||
              null,

            restoredAt:
              serverTimestamp(),

            restoredBy:
              operationalActor,

            isDeleted:
              false,

            deletedAt:
              null,

            deletedBy:
              null,

            closedAt:
              rootStatus ===
                "CLOSED"
                ? serverTimestamp()
                : null,

            createdAt:
              serverTimestamp(),

            createdBy:
              operationalActor,

            updatedAt:
              serverTimestamp(),

            updatedBy:
              operationalActor,
          },
          options: {
            merge:
              true,
          },
        });

        operations.push({
          ref:
            doc(
              db,
              "carryOnFlights",
              flightId,
              "events",
              `restored_report_${Date.now()}`
            ),
          data: {
            type:
              "FLIGHT_RESTORED_FROM_REPORT",
            status:
              rootStatus,
            restoredAssignments:
              assignments.length,
            loadedCount,
            offloadedCount,
            sourceFileName:
              restoreReportFile
                ?.name ||
              null,
            message:
              `Carry-On flight ${flightNumber} restored from printed BLCS report.`,
            createdAt:
              serverTimestamp(),
            createdBy:
              operationalActor,
          },
        });

        await commitCarryOnRestoreWrites(
          operations
        );

        setSelectedDate(
          flightDate
        );

        setShowRestoreReport(
          false
        );

        setRestoreReportPreview(
          null
        );

        setRestoreReportFile(
          null
        );

        setActionMsg(
          `Carry-On flight restored from report: ${flightNumber}. ${assignments.length} assignment(s) recreated.`
        );
      } catch (
        error
      ) {
        console.error(
          "Carry-On report restore error:",
          error
        );

        setRestoreReportError(
          error?.message ||
          "Unable to restore Carry-On flight from report."
        );
      } finally {
        setRestoringFromReport(
          false
        );
      }
    };

  /* =========================
     RENDER
  ========================= */

  return (
    <div
      style={{
        background:
          "white",

        borderRadius:
          isMobile
            ? 10
            : 12,

        padding:
          isMobile
            ? 10
            : 16,

        border:
          "1px solid #e5e7eb",
      }}
    >
      <div
        style={{
          display:
            "flex",

          flexDirection:
            isMobile
              ? "column"
              : "row",

          justifyContent:
            "space-between",

          alignItems:
            isMobile
              ? "stretch"
              : "end",

          gap:
            12,

          flexWrap:
            "wrap",
        }}
      >
        <div>
          <h2
            style={{
              margin:
                0,
            }}
          >
            Flights
          </h2>

          <p
            style={{
              margin:
                "6px 0 0",

              color:
                "#6b7280",

              fontSize:
                "0.9rem",
            }}
          >
            Select a date, filter, then choose a flight.
          </p>

          {operationalContext
            ?.operationalPositionLabel && (
            <div
              style={{
                display:
                  "inline-flex",

                marginTop:
                  8,

                padding:
                  "5px 9px",

                borderRadius:
                  999,

                background:
                  "#eff6ff",

                border:
                  "1px solid #bfdbfe",

                color:
                  "#1d4ed8",

                fontSize:
                  "0.72rem",

                fontWeight:
                  900,
              }}
            >
              Working as:{" "}
              {
                operationalContext
                  .operationalPositionLabel
              }
            </div>
          )}
        </div>

        <div
          style={{
            display:
              "grid",

            gridTemplateColumns:
              isMobile
                ? "1fr 1fr"
                : "auto auto auto auto",

            gap:
              8,

            alignItems:
              "end",

            width:
              isMobile
                ? "100%"
                : "auto",
          }}
        >
          <div>
            <label
              style={
                label
              }
            >
              Date
            </label>

            <input
              type="date"

              value={
                selectedDate
              }

              onChange={(
                event
              ) => {
                setSelectedDate(
                  event.target
                    .value
                );
              }}

              style={{
                ...input,

                minHeight:
                  42,
              }}
            />
          </div>

          <div>
            <label
              style={
                label
              }
            >
              Filter
            </label>

            <select
              value={
                statusFilter
              }

              onChange={(
                event
              ) => {
                setStatusFilter(
                  event.target
                    .value
                );
              }}

              style={{
                ...input,

                minHeight:
                  42,
              }}
            >
              <option value="active">
                Active
              </option>

              <option value="completed">
                Completed
              </option>

              <option value="all">
                All
              </option>
            </select>
          </div>

          {allowCreate ? (
            <>
              <button
                type="button"

                onClick={
                  openCreate
                }

                style={{
                  minHeight:
                    42,

                  padding:
                    "8px 12px",

                  borderRadius:
                    10,

                  border:
                    "1px solid #111827",

                  background:
                    "#111827",

                  color:
                    "white",

                  fontWeight:
                    800,

                  cursor:
                    "pointer",

                  gridColumn:
                    isMobile
                      ? "1 / -1"
                      : "auto",
                }}
              >
                + Create Flight
              </button>

              {allowManage && (
                <button
                  type="button"
                  onClick={
                    openRestoreFromReport
                  }
                  style={{
                    minHeight:
                      42,

                    padding:
                      "8px 12px",

                    borderRadius:
                      10,

                    border:
                      "1px solid #7c3aed",

                    background:
                      "#7c3aed",

                    color:
                      "white",

                    fontWeight:
                      800,

                    cursor:
                      "pointer",

                    gridColumn:
                      isMobile
                        ? "1 / -1"
                        : "auto",
                  }}
                >
                  Restore Carry-On Report
                </button>
              )}
            </>
          ) : (
            <div
              style={{
                color:
                  "#6b7280",

                fontSize:
                  "0.82rem",

                gridColumn:
                  isMobile
                    ? "1 / -1"
                    : "auto",
              }}
            >
              Create Flight: managers only
            </div>
          )}
        </div>
      </div>

      {(actionMsg ||
        actionErr) && (
        <div
          style={{
            marginTop:
              12,
          }}
        >
          {actionMsg && (
            <div
              style={{
                padding:
                  "10px 12px",

                borderRadius:
                  10,

                background:
                  "#dcfce7",

                border:
                  "1px solid #86efac",

                color:
                  "#166534",

                fontWeight:
                  800,
              }}
            >
              {actionMsg}
            </div>
          )}

          {actionErr && (
            <div
              style={{
                padding:
                  "10px 12px",

                borderRadius:
                  10,

                background:
                  "#fee2e2",

                border:
                  "1px solid #fecaca",

                color:
                  "#991b1b",

                fontWeight:
                  800,

                overflowWrap:
                  "anywhere",
              }}
            >
              {actionErr}
            </div>
          )}
        </div>
      )}

      <hr
        style={{
          border:
            "none",

          borderTop:
            "1px solid #e5e7eb",

          margin:
            "14px 0",
        }}
      />

      {loading ? (
        <p
          style={{
            color:
              "#6b7280",
          }}
        >
          Loading flights...
        </p>
      ) : flights.length ===
        0 ? (
        <p
          style={{
            color:
              "#6b7280",
          }}
        >
          No flights found for{" "}
          {selectedDate} (
          {statusFilter}).
        </p>
      ) : isMobile ? (
        <div
          style={{
            display:
              "grid",

            gap:
              9,
          }}
        >
          {flights.map(
            (
              flight
            ) => {
              const status =
                normalizeStatus(
                  flight.status
                );

              const isCompleted =
                status ===
                "LOADED";

              const busyDelete =
                deletingId ===
                flight.id;

              const busyReopen =
                reopeningId ===
                flight.id;

              return (
                <div
                  key={
                    flight.id
                  }

                  style={{
                    border:
                      "1px solid #e5e7eb",

                    borderRadius:
                      12,

                    padding:
                      11,

                    background:
                      "#ffffff",

                    boxShadow:
                      "0 1px 3px rgba(15,23,42,0.04)",
                  }}
                >
                  <div
                    style={{
                      display:
                        "flex",

                      justifyContent:
                        "space-between",

                      gap:
                        8,

                      alignItems:
                        "start",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize:
                            "1.05rem",

                          fontWeight:
                            900,

                          color:
                            "#0f172a",
                        }}
                      >
                        {flight
                          .flightNumber ||
                          flight.id}
                      </div>

                      <div
                        style={{
                          marginTop:
                            3,

                          color:
                            "#64748b",

                          fontSize:
                            "0.78rem",
                        }}
                      >
                        {flight
                          .flightDate ||
                          "-"}
                      </div>
                    </div>

                    <StatusPill
                      status={
                        status
                      }
                    />
                  </div>

                  <div
                    style={{
                      display:
                        "grid",

                      gridTemplateColumns:
                        "repeat(2, minmax(0, 1fr))",

                      gap:
                        7,

                      marginTop:
                        10,
                    }}
                  >
                    <MiniInfo
                      label="Gate"
                      value={
                        flight.gate ||
                        "-"
                      }
                    />

                    <MiniInfo
                      label="Aircraft"
                      value={
                        flight
                          .aircraftType ||
                        "-"
                      }
                    />
                  </div>

                  <div
                    style={{
                      display:
                        "grid",

                      gridTemplateColumns:
                        allowManage &&
                        isCompleted
                          ? "repeat(3, minmax(0, 1fr))"
                          : allowManage
                            ? "repeat(2, minmax(0, 1fr))"
                            : "1fr",

                      gap:
                        7,

                      marginTop:
                        10,
                    }}
                  >
                    <ActionButton
                      label={
                        isCompleted
                          ? "View"
                          : "Open"
                      }

                      onClick={() =>
                        openFlight(
                          flight
                        )
                      }
                    />

                    {allowManage &&
                      isCompleted && (
                        <ActionButton
                          label={
                            busyReopen
                              ? "Reopening..."
                              : "Reopen"
                          }

                          onClick={() =>
                            handleReopen(
                              flight
                            )
                          }

                          disabled={
                            busyReopen ||
                            busyDelete
                          }

                          tone="success"
                        />
                      )}

                    {allowManage && (
                      <ActionButton
                        label={
                          busyDelete
                            ? "Deleting..."
                            : "Delete"
                        }

                        onClick={() =>
                          handleDelete(
                            flight
                          )
                        }

                        disabled={
                          busyDelete ||
                          busyReopen
                        }

                        tone="danger"
                      />
                    )}
                  </div>
                </div>
              );
            }
          )}
        </div>
      ) : (
        <div
          style={{
            overflowX:
              "auto",

            WebkitOverflowScrolling:
              "touch",
          }}
        >
          <table
            style={{
              width:
                "100%",

              borderCollapse:
                "collapse",

              fontSize:
                "0.92rem",

              minWidth:
                760,
            }}
          >
            <thead>
              <tr
                style={{
                  background:
                    "#f9fafb",
                }}
              >
                <th style={th}>
                  Flight
                </th>

                <th style={th}>
                  Date
                </th>

                <th style={th}>
                  Gate
                </th>

                <th style={th}>
                  Aircraft
                </th>

                <th style={th}>
                  Status
                </th>

                <th
                  style={{
                    ...th,

                    textAlign:
                      "right",
                  }}
                >
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {flights.map(
                (
                  flight
                ) => {
                  const status =
                    normalizeStatus(
                      flight.status
                    );

                  const isCompleted =
                    status ===
                    "LOADED";

                  const busyDelete =
                    deletingId ===
                    flight.id;

                  const busyReopen =
                    reopeningId ===
                    flight.id;

                  return (
                    <tr
                      key={
                        flight.id
                      }
                    >
                      <td
                        style={
                          td
                        }
                      >
                        <strong>
                          {flight
                            .flightNumber ||
                            flight.id}
                        </strong>
                      </td>

                      <td
                        style={
                          td
                        }
                      >
                        {flight
                          .flightDate ||
                          "-"}
                      </td>

                      <td
                        style={
                          td
                        }
                      >
                        {flight.gate ||
                          "-"}
                      </td>

                      <td
                        style={
                          td
                        }
                      >
                        {flight
                          .aircraftType ||
                          "-"}
                      </td>

                      <td
                        style={
                          td
                        }
                      >
                        <StatusPill
                          status={
                            status
                          }
                        />
                      </td>

                      <td
                        style={{
                          ...td,

                          textAlign:
                            "right",

                          whiteSpace:
                            "nowrap",
                        }}
                      >
                        <button
                          type="button"

                          onClick={() =>
                            openFlight(
                              flight
                            )
                          }

                          style={
                            tableOpenButton
                          }
                        >
                          {isCompleted
                            ? "View"
                            : "Open"}
                        </button>

                        {allowManage &&
                          isCompleted && (
                            <button
                              type="button"

                              onClick={() =>
                                handleReopen(
                                  flight
                                )
                              }

                              disabled={
                                busyReopen ||
                                busyDelete
                              }

                              style={{
                                ...tableReopenButton,

                                opacity:
                                  busyReopen ||
                                  busyDelete
                                    ? 0.7
                                    : 1,

                                cursor:
                                  busyReopen ||
                                  busyDelete
                                    ? "not-allowed"
                                    : "pointer",
                              }}
                            >
                              {busyReopen
                                ? "Reopening..."
                                : "Reopen"}
                            </button>
                          )}

                        {allowManage && (
                          <button
                            type="button"

                            onClick={() =>
                              handleDelete(
                                flight
                              )
                            }

                            disabled={
                              busyDelete ||
                              busyReopen
                            }

                            style={{
                              ...tableDeleteButton,

                              opacity:
                                busyDelete ||
                                busyReopen
                                  ? 0.7
                                  : 1,

                              cursor:
                                busyDelete ||
                                busyReopen
                                  ? "not-allowed"
                                  : "pointer",
                            }}
                          >
                            {busyDelete
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>

          <p
            style={{
              marginTop:
                10,

              color:
                "#6b7280",

              fontSize:
                "0.8rem",
            }}
          >
            Tip: Completed flights (LOADED) remain accessible for Gate, Aircraft, and Reports. Managers can Reopen if needed.
          </p>
        </div>
      )}

      {/* =========================
          CARRY-ON CHECK ONLY FLIGHTS
      ========================= */}

      <div
        style={{
          marginTop:
            18,

          paddingTop:
            16,

          borderTop:
            "1px solid #e5e7eb",
        }}
      >
        <h3
          style={{
            margin:
              0,

            color:
              "#4c1d95",
          }}
        >
          Carry-On Check Only Flights
        </h3>

        <p
          style={{
            margin:
              "5px 0 10px",

            color:
              "#64748b",

            fontSize:
              "0.82rem",
          }}
        >
          Carry-On-only flights remain managed from Flights. Open Setup only when you are ready to upload documents.
        </p>

        {loadingCarryOn ? (
          <p
            style={{
              color:
                "#64748b",
            }}
          >
            Loading Carry-On flights...
          </p>
        ) : carryOnFlights.length ===
          0 ? (
          <p
            style={{
              color:
                "#64748b",
            }}
          >
            No Carry-On-only flights found for {selectedDate}.
          </p>
        ) : (
          <div
            style={{
              display:
                "grid",

              gap:
                8,
            }}
          >
            {carryOnFlights.map(
              (
                flight
              ) => (
                <div
                  key={
                    flight.id
                  }

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

                    padding:
                      11,

                    borderRadius:
                      12,

                    border:
                      "1px solid #ddd6fe",

                    background:
                      "#faf5ff",
                  }}
                >
                  <div>
                    <strong>
                      {flight.flightNumber ||
                        flight.id}
                    </strong>

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
                      {flight.origin || "-"}
                      {" \u2192 "}
                      {flight.destination || "-"}
                      {flight.gate
                        ? ` - Gate ${flight.gate}`
                        : ""}
                      {" - "}
                      {flight.status || "SETUP"}
                    </div>
                  </div>

                  <div
                    style={{
                      display:
                        "flex",

                      gap:
                        7,

                      flexWrap:
                        "wrap",
                    }}
                  >
                    <button
                      type="button"

                      onClick={() =>
                        onOpenCarryOnSetup?.(
                          flight.id
                        )
                      }

                      style={{
                        padding:
                          "7px 12px",

                        borderRadius:
                          999,

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
                      }}
                    >
                      Setup
                    </button>

                    {allowManage && (
                      <button
                        type="button"

                        onClick={() =>
                          openCarryOnEdit(
                            flight
                          )
                        }

                        style={{
                          padding:
                            "7px 12px",

                          borderRadius:
                            999,

                          border:
                            "1px solid #cbd5e1",

                          background:
                            "white",

                          color:
                            "#334155",

                          fontWeight:
                            900,

                          cursor:
                            "pointer",
                        }}
                      >
                        Edit
                      </button>
                    )}

                    {allowManage && (
                      <button
                        type="button"

                        onClick={() =>
                          handleDeleteCarryOn(
                            flight
                          )
                        }

                        disabled={
                          deletingCarryOnId ===
                          flight.id
                        }

                        style={{
                          padding:
                            "7px 12px",

                          borderRadius:
                            999,

                          border:
                            "1px solid #ef4444",

                          background:
                            "#ef4444",

                          color:
                            "white",

                          fontWeight:
                            900,

                          cursor:
                            deletingCarryOnId ===
                            flight.id
                              ? "not-allowed"
                              : "pointer",

                          opacity:
                            deletingCarryOnId ===
                            flight.id
                              ? 0.6
                              : 1,
                        }}
                      >
                        {deletingCarryOnId ===
                        flight.id
                          ? "Deleting..."
                          : "Delete"}
                      </button>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {allowManage && (
        <div
          style={{
            marginTop:
              12,
          }}
        >
          <button
            type="button"
            onClick={() =>
              setShowDeletedCarryOn(
                (
                  current
                ) =>
                  !current
              )
            }
            style={{
              width:
                "100%",
              padding:
                "10px 12px",
              borderRadius:
                12,
              border:
                "1px solid #e2e8f0",
              background:
                "white",
              color:
                "#475569",
              fontWeight:
                900,
              cursor:
                "pointer",
              display:
                "flex",
              justifyContent:
                "space-between",
              alignItems:
                "center",
              gap:
                10,
              textAlign:
                "left",
            }}
          >
            <span>
              Recently Deleted Carry-On Flights
            </span>

            <span
              style={{
                minWidth:
                  30,
                height:
                  30,
                padding:
                  "0 7px",
                borderRadius:
                  999,
                background:
                  deletedCarryOnFlights.length > 0
                    ? "#fee2e2"
                    : "#f1f5f9",
                color:
                  deletedCarryOnFlights.length > 0
                    ? "#991b1b"
                    : "#64748b",
                display:
                  "inline-flex",
                alignItems:
                  "center",
                justifyContent:
                  "center",
                fontSize:
                  "0.76rem",
                fontWeight:
                  900,
              }}
            >
              {deletedCarryOnFlights.length}
            </span>
          </button>

          {showDeletedCarryOn && (
            <div
              style={{
                marginTop:
                  8,
                display:
                  "grid",
                gap:
                  8,
              }}
            >
              {deletedCarryOnFlights.length === 0 ? (
                <div
                  style={{
                    padding:
                      11,
                    borderRadius:
                      10,
                    background:
                      "#f8fafc",
                    border:
                      "1px solid #e2e8f0",
                    color:
                      "#64748b",
                    fontSize:
                      "0.8rem",
                  }}
                >
                  No deleted Carry-On flights for {selectedDate}.
                </div>
              ) : (
                deletedCarryOnFlights.map(
                  (
                    flight
                  ) => (
                    <div
                      key={
                        flight.id
                      }
                      style={{
                        padding:
                          11,
                        borderRadius:
                          12,
                        border:
                          "1px solid #fecaca",
                        background:
                          "#fff7f7",
                        display:
                          "flex",
                        justifyContent:
                          "space-between",
                        alignItems:
                          "center",
                        gap:
                          10,
                        flexWrap:
                          "wrap",
                      }}
                    >
                      <div>
                        <strong
                          style={{
                            color:
                              "#991b1b",
                          }}
                        >
                          {flight.flightNumber || flight.id}
                        </strong>

                        <div
                          style={{
                            marginTop:
                              3,
                            color:
                              "#64748b",
                            fontSize:
                              "0.75rem",
                          }}
                        >
                          {flight.flightDate || "-"}
                          {" - "}
                          {flight.origin || "-"}
                          {" -> "}
                          {flight.destination || "-"}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          handleRestoreCarryOn(
                            flight
                          )
                        }
                        disabled={
                          restoringCarryOnId ===
                          flight.id
                        }
                        style={{
                          padding:
                            "8px 12px",
                          borderRadius:
                            999,
                          border:
                            "1px solid #16a34a",
                          background:
                            "#16a34a",
                          color:
                            "white",
                          fontWeight:
                            900,
                          cursor:
                            restoringCarryOnId ===
                            flight.id
                              ? "not-allowed"
                              : "pointer",
                          opacity:
                            restoringCarryOnId ===
                            flight.id
                              ? 0.6
                              : 1,
                        }}
                      >
                        {restoringCarryOnId ===
                        flight.id
                          ? "Restoring..."
                          : "Restore"}
                      </button>
                    </div>
                  )
                )
              )}
            </div>
          )}
        </div>
      )}

      {/* =========================
          EDIT CARRY-ON MODAL
      ========================= */}

      {editingCarryOn && (
        <div
          style={
            overlay
          }
        >
          <div
            style={{
              ...modal,

              maxHeight:
                "90dvh",

              overflowY:
                "auto",
            }}
          >
            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                alignItems:
                  "center",

                gap:
                  10,
              }}
            >
              <div>
                <h3
                  style={{
                    margin:
                      0,
                  }}
                >
                  Edit Carry-On Flight
                </h3>

                <div
                  style={{
                    marginTop:
                      3,

                    color:
                      "#64748b",

                    fontSize:
                      "0.76rem",
                  }}
                >
                  Carry-On Check Only
                </div>
              </div>

              <button
                type="button"

                onClick={() =>
                  setEditingCarryOn(
                    null
                  )
                }

                disabled={
                  savingCarryOnEdit
                }

                style={
                  xBtn
                }
              >
                {"\u2715"}
              </button>
            </div>

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  isMobile
                    ? "1fr"
                    : "1fr 1fr",

                gap:
                  10,

                marginTop:
                  12,
              }}
            >
              {[
                [
                  "Flight Number",
                  "flightNumber",
                ],

                [
                  "Date",
                  "flightDate",
                ],

                [
                  "Gate",
                  "gate",
                ],

                [
                  "Aircraft Type",
                  "aircraftType",
                ],

                [
                  "Origin",
                  "origin",
                ],

                [
                  "Destination",
                  "destination",
                ],

                [
                  "Tail Number",
                  "tailNumber",
                ],
              ].map(
                (
                  [
                    fieldLabel,
                    key,
                  ]
                ) => (
                  <div
                    key={
                      key
                    }
                  >
                    <label
                      style={
                        label
                      }
                    >
                      {fieldLabel}
                    </label>

                    <input
                      type={
                        key ===
                        "flightDate"
                          ? "date"
                          : "text"
                      }

                      value={
                        editCarryOnForm[
                          key
                        ]
                      }

                      onChange={(
                        event
                      ) =>
                        setEditCarryOnForm(
                          (
                            previous
                          ) => ({
                            ...previous,

                            [key]:
                              event
                                .target
                                .value,
                          })
                        )
                      }

                      style={
                        input
                      }
                    />
                  </div>
                )
              )}
            </div>

            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "flex-end",

                gap:
                  8,

                marginTop:
                  14,
              }}
            >
              <button
                type="button"

                onClick={() =>
                  setEditingCarryOn(
                    null
                  )
                }

                disabled={
                  savingCarryOnEdit
                }

                style={
                  btnGhost
                }
              >
                Cancel
              </button>

              <button
                type="button"

                onClick={
                  saveCarryOnEdit
                }

                disabled={
                  savingCarryOnEdit
                }

                style={
                  btnPrimary
                }
              >
                {savingCarryOnEdit
                  ? "Saving..."
                  : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================
          RESTORE CARRY-ON REPORT
      ========================= */}

      {showRestoreReport && (
        <div
          style={
            overlay
          }
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeRestoreFromReport();
            }
          }}
        >
          <div
            style={{
              ...modal,
              maxWidth:
                760,
              maxHeight:
                "92dvh",
              overflowY:
                "auto",
            }}
          >
            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
                gap:
                  10,
              }}
            >
              <div>
                <h3
                  style={{
                    margin:
                      0,
                  }}
                >
                  Restore Carry-On Flight from Report
                </h3>

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
                  Upload a BLCS Carry-On Gate Check Report PDF.
                </div>
              </div>

              <button
                type="button"
                onClick={
                  closeRestoreFromReport
                }
                disabled={
                  parsingRestoreReport ||
                  restoringFromReport
                }
                style={
                  xBtn
                }
              >
                {"\u2715"}
              </button>
            </div>

            <div
              style={{
                marginTop:
                  12,
                padding:
                  12,
                borderRadius:
                  12,
                border:
                  "1px dashed #c4b5fd",
                background:
                  "#faf5ff",
              }}
            >
              <label
                style={
                  label
                }
              >
                Carry-On Gate Check Report PDF
              </label>

              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={
                  parsingRestoreReport ||
                  restoringFromReport
                }
                onChange={(
                  event
                ) =>
                  handleRestoreReportFile(
                    event.target
                      .files?.[0] ||
                    null
                  )
                }
                style={{
                  ...input,
                  padding:
                    8,
                }}
              />

              {restoreReportFile && (
                <div
                  style={{
                    marginTop:
                      7,
                    color:
                      "#64748b",
                    fontSize:
                      "0.75rem",
                  }}
                >
                  File:{" "}
                  <strong>
                    {restoreReportFile.name}
                  </strong>
                </div>
              )}

              {parsingRestoreReport && (
                <div
                  style={{
                    marginTop:
                      8,
                    color:
                      "#6d28d9",
                    fontSize:
                      "0.8rem",
                    fontWeight:
                      900,
                  }}
                >
                  Reading report...
                </div>
              )}
            </div>

            {restoreReportPreview && (
              <>
                <div
                  style={{
                    marginTop:
                      12,
                    padding:
                      11,
                    borderRadius:
                      12,
                    border:
                      "1px solid #bbf7d0",
                    background:
                      "#f0fdf4",
                    color:
                      "#166534",
                    fontWeight:
                      900,
                  }}
                >
                  {restoreReportPreview.assignments.length} Carry-On assignment(s) identified.
                </div>

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      isMobile
                        ? "1fr"
                        : "1fr 1fr",
                    gap:
                      10,
                    marginTop:
                      12,
                  }}
                >
                  {[
                    [
                      "Flight Number",
                      "flightNumber",
                      "text",
                    ],
                    [
                      "Flight Date",
                      "flightDate",
                      "date",
                    ],
                    [
                      "Origin",
                      "origin",
                      "text",
                    ],
                    [
                      "Destination",
                      "destination",
                      "text",
                    ],
                    [
                      "Gate",
                      "gate",
                      "text",
                    ],
                    [
                      "Tail Number",
                      "tailNumber",
                      "text",
                    ],
                    [
                      "Required Carry-Ons",
                      "requiredCarryOns",
                      "number",
                    ],
                  ].map(
                    (
                      [
                        fieldLabel,
                        key,
                        type,
                      ]
                    ) => (
                      <div
                        key={
                          key
                        }
                      >
                        <label
                          style={
                            label
                          }
                        >
                          {fieldLabel}
                        </label>

                        <input
                          type={
                            type
                          }
                          value={
                            restoreReportForm[
                              key
                            ]
                          }
                          onChange={(
                            event
                          ) =>
                            setRestoreReportForm(
                              (
                                previous
                              ) => ({
                                ...previous,
                                [key]:
                                  event.target
                                    .value,
                              })
                            )
                          }
                          style={
                            input
                          }
                        />
                      </div>
                    )
                  )}
                </div>

                <div
                  style={{
                    marginTop:
                      12,
                    borderRadius:
                      12,
                    border:
                      "1px solid #e2e8f0",
                    overflow:
                      "hidden",
                  }}
                >
                  <div
                    style={{
                      padding:
                        "9px 11px",
                      background:
                        "#f8fafc",
                      borderBottom:
                        "1px solid #e2e8f0",
                      fontWeight:
                        900,
                      color:
                        "#334155",
                      fontSize:
                        "0.8rem",
                    }}
                  >
                    Recovery Preview
                  </div>

                  <div
                    style={{
                      maxHeight:
                        260,
                      overflowY:
                        "auto",
                    }}
                  >
                    {restoreReportPreview.assignments
                      .slice(
                        0,
                        25
                      )
                      .map(
                        (
                          item
                        ) => (
                          <div
                            key={
                              item.gateCheckNumber
                            }
                            style={{
                              padding:
                                "9px 11px",
                              borderBottom:
                                "1px solid #f1f5f9",
                              display:
                                "flex",
                              justifyContent:
                                "space-between",
                              gap:
                                10,
                              flexWrap:
                                "wrap",
                              fontSize:
                                "0.76rem",
                            }}
                          >
                            <div>
                              <strong>
                                {item.passengerName}
                              </strong>

                              <div
                                style={{
                                  marginTop:
                                    2,
                                  color:
                                    "#64748b",
                                }}
                              >
                                Seat {item.assignedSeat || "-"}
                                {" - "}
                                {item.status}
                              </div>
                            </div>

                            <strong
                              style={{
                                color:
                                  "#6d28d9",
                              }}
                            >
                              {item.gateCheckNumber}
                            </strong>
                          </div>
                        )
                      )}
                  </div>
                </div>

                <div
                  style={{
                    marginTop:
                      10,
                    padding:
                      9,
                    borderRadius:
                      10,
                    border:
                      "1px solid #fde68a",
                    background:
                      "#fffbeb",
                    color:
                      "#92400e",
                    fontSize:
                      "0.75rem",
                    lineHeight:
                      1.45,
                  }}
                >
                  The report can restore the data printed in the document. Unused seats, unused Gate Check numbers, original PDF setup files, and event-by-event history that were not printed cannot be recreated automatically.
                </div>
              </>
            )}

            {restoreReportError && (
              <div
                style={{
                  marginTop:
                    10,
                  padding:
                    10,
                  borderRadius:
                    10,
                  background:
                    "#fef2f2",
                  border:
                    "1px solid #fecaca",
                  color:
                    "#991b1b",
                  fontWeight:
                    800,
                  fontSize:
                    "0.8rem",
                  whiteSpace:
                    "pre-wrap",
                }}
              >
                {restoreReportError}
              </div>
            )}

            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "flex-end",
                gap:
                  8,
                flexWrap:
                  "wrap",
                marginTop:
                  14,
              }}
            >
              <button
                type="button"
                onClick={
                  closeRestoreFromReport
                }
                disabled={
                  parsingRestoreReport ||
                  restoringFromReport
                }
                style={
                  btnGhost
                }
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  restoreFlightFromReport
                }
                disabled={
                  !restoreReportPreview ||
                  parsingRestoreReport ||
                  restoringFromReport
                }
                style={{
                  ...btnPrimary,
                  background:
                    "#7c3aed",
                  border:
                    "1px solid #7c3aed",
                  opacity:
                    !restoreReportPreview ||
                    parsingRestoreReport ||
                    restoringFromReport
                      ? 0.55
                      : 1,
                }}
              >
                {restoringFromReport
                  ? "Restoring..."
                  : "Restore Flight"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================
          CREATE FLIGHT MODAL
      ========================= */}

      {showCreate && (
        <div
          style={
            overlay
          }

          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeCreate();
            }
          }}
        >
          <div
            style={{
              ...modal,

              maxHeight:
                "90dvh",

              overflowY:
                "auto",

              padding:
                isMobile
                  ? 14
                  : 16,
            }}
          >
            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                alignItems:
                  "center",

                gap:
                  12,
              }}
            >
              <div>
                <h3
                  style={{
                    margin:
                      0,
                  }}
                >
                  Create Flight
                </h3>

                {operationalContext
                  ?.operationalPositionLabel && (
                  <div
                    style={{
                      marginTop:
                        3,

                      color:
                        "#64748b",

                      fontSize:
                        "0.76rem",
                    }}
                  >
                    Working as:{" "}
                    <strong>
                      {
                        operationalContext
                          .operationalPositionLabel
                      }
                    </strong>
                  </div>
                )}
              </div>

              <button
                type="button"

                onClick={
                  closeCreate
                }

                style={
                  xBtn
                }

                aria-label="Close"

                disabled={
                  saving
                }
              >
                {"\u2715"}
              </button>
            </div>

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  isMobile
                    ? "1fr"
                    : "1fr 1fr",

                gap:
                  12,

                marginTop:
                  12,
              }}
            >
              <div
                style={{
                  gridColumn:
                    isMobile
                      ? "auto"
                      : "1 / -1",
                }}
              >
                <label
                  style={
                    label
                  }
                >
                  Flight Operation
                </label>

                <select
                  value={
                    form.operationType
                  }

                  onChange={(
                    event
                  ) =>
                    setForm(
                      (
                        previous
                      ) => ({
                        ...previous,

                        operationType:
                          event
                            .target
                            .value,
                      })
                    )
                  }

                  style={
                    input
                  }
                >
                  <option value="REGULAR">
                    Regular Flight - Full Baggage Flow
                  </option>

                  <option value="CARRY_ON_ONLY">
                    Carry-On Check Only
                  </option>
                </select>
              </div>

              <div>
                <label
                  style={
                    label
                  }
                >
                  Flight Number
                </label>

                <input
                  value={
                    form.flightNumber
                  }

                  onChange={(
                    event
                  ) =>
                    setForm(
                      (
                        previous
                      ) => ({
                        ...previous,

                        flightNumber:
                          event
                            .target
                            .value,
                      })
                    )
                  }

                  placeholder="e.g. SY214"

                  autoCapitalize="characters"

                  style={
                    input
                  }
                />
              </div>

              <div>
                <label
                  style={
                    label
                  }
                >
                  Date
                </label>

                <input
                  type="date"

                  value={
                    form.flightDate
                  }

                  onChange={(
                    event
                  ) =>
                    setForm(
                      (
                        previous
                      ) => ({
                        ...previous,

                        flightDate:
                          event
                            .target
                            .value,
                      })
                    )
                  }

                  style={
                    input
                  }
                />
              </div>

              <div>
                <label
                  style={
                    label
                  }
                >
                  Gate
                </label>

                <input
                  value={
                    form.gate
                  }

                  onChange={(
                    event
                  ) =>
                    setForm(
                      (
                        previous
                      ) => ({
                        ...previous,

                        gate:
                          event
                            .target
                            .value,
                      })
                    )
                  }

                  placeholder="e.g. E68"

                  autoCapitalize="characters"

                  style={
                    input
                  }
                />
              </div>

              <div>
                <label
                  style={
                    label
                  }
                >
                  Aircraft Type
                </label>

                <input
                  value={
                    form.aircraftType
                  }

                  onChange={(
                    event
                  ) =>
                    setForm(
                      (
                        previous
                      ) => ({
                        ...previous,

                        aircraftType:
                          event
                            .target
                            .value,
                      })
                    )
                  }

                  placeholder="e.g. B737-800"

                  autoCapitalize="characters"

                  style={
                    input
                  }
                />
              </div>

              {form.operationType ===
                "CARRY_ON_ONLY" && (
                <>
                  <div>
                    <label
                      style={
                        label
                      }
                    >
                      Origin
                    </label>

                    <input
                      value={
                        form.origin
                      }

                      onChange={(
                        event
                      ) =>
                        setForm(
                          (
                            previous
                          ) => ({
                            ...previous,

                            origin:
                              event
                                .target
                                .value,
                          })
                        )
                      }

                      placeholder="e.g. TPA"
                      style={
                        input
                      }
                    />
                  </div>

                  <div>
                    <label
                      style={
                        label
                      }
                    >
                      Destination
                    </label>

                    <input
                      value={
                        form.destination
                      }

                      onChange={(
                        event
                      ) =>
                        setForm(
                          (
                            previous
                          ) => ({
                            ...previous,

                            destination:
                              event
                                .target
                                .value,
                          })
                        )
                      }

                      placeholder="e.g. SNU"
                      style={
                        input
                      }
                    />
                  </div>

                  <div>
                    <label
                      style={
                        label
                      }
                    >
                      Tail Number
                    </label>

                    <input
                      value={
                        form.tailNumber
                      }

                      onChange={(
                        event
                      ) =>
                        setForm(
                          (
                            previous
                          ) => ({
                            ...previous,

                            tailNumber:
                              event
                                .target
                                .value,
                          })
                        )
                      }

                      placeholder="e.g. N802WA"
                      style={
                        input
                      }
                    />
                  </div>
                </>
              )}
            </div>

            {formError && (
              <div
                style={{
                  marginTop:
                    10,

                  padding:
                    10,

                  borderRadius:
                    10,

                  background:
                    "#fef2f2",

                  border:
                    "1px solid #fecaca",

                  color:
                    "#b91c1c",

                  fontSize:
                    "0.86rem",

                  fontWeight:
                    800,
                }}
              >
                {formError}
              </div>
            )}

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  isMobile
                    ? "1fr 1fr"
                    : "auto auto",

                justifyContent:
                  isMobile
                    ? "stretch"
                    : "end",

                gap:
                  10,

                marginTop:
                  16,
              }}
            >
              <button
                type="button"

                onClick={
                  closeCreate
                }

                disabled={
                  saving
                }

                style={{
                  ...btnGhost,

                  minHeight:
                    44,
                }}
              >
                Cancel
              </button>

              <button
                type="button"

                onClick={
                  handleCreate
                }

                disabled={
                  saving
                }

                style={{
                  ...btnPrimary,

                  minHeight:
                    44,

                  opacity:
                    saving
                      ? 0.7
                      : 1,

                  cursor:
                    saving
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {saving
                  ? "Creating..."
                  : "Create Flight"}
              </button>
            </div>

            <div
              style={{
                marginTop:
                  12,

                padding:
                  9,

                borderRadius:
                  10,

                background:
                  "#f8fafc",

                border:
                  "1px solid #e2e8f0",

                color:
                  "#64748b",

                fontSize:
                  "0.75rem",

                lineHeight:
                  1.5,
              }}
            >
              Created by:{" "}
              <strong>
                {operationalActor
                  .employeeFullName ||
                  user?.username ||
                  "-"}
              </strong>

              {operationalActor
                .operationalPositionLabel && (
                <>
                  {" - "}
                  Working as:{" "}
                  <strong>
                    {
                      operationalActor
                        .operationalPositionLabel
                    }
                  </strong>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   UI
========================= */

function MiniInfo({
  label,
  value,
}) {
  return (
    <div
      style={{
        padding:
          8,

        borderRadius:
          10,

        background:
          "#f8fafc",

        border:
          "1px solid #e2e8f0",
      }}
    >
      <div
        style={{
          color:
            "#64748b",

          fontSize:
            "0.68rem",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            1,

          color:
            "#0f172a",

          fontWeight:
            900,

          fontSize:
            "0.88rem",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled = false,
  tone = "default",
}) {
  let background =
    "white";

  let color =
    "#334155";

  let border =
    "#cbd5e1";

  if (
    tone ===
    "success"
  ) {
    background =
      "#16a34a";

    color =
      "white";

    border =
      "#16a34a";
  }

  if (
    tone ===
    "danger"
  ) {
    background =
      "#ef4444";

    color =
      "white";

    border =
      "#ef4444";
  }

  return (
    <button
      type="button"

      onClick={
        onClick
      }

      disabled={
        disabled
      }

      style={{
        minHeight:
          42,

        padding:
          "7px 8px",

        borderRadius:
          10,

        border:
          `1px solid ${border}`,

        background,

        color,

        fontSize:
          "0.76rem",

        fontWeight:
          900,

        cursor:
          disabled
            ? "not-allowed"
            : "pointer",

        opacity:
          disabled
            ? 0.65
            : 1,
      }}
    >
      {label}
    </button>
  );
}

/* =========================
   STYLES
========================= */

const th = {
  textAlign:
    "left",

  padding:
    "10px 8px",

  borderBottom:
    "1px solid #e5e7eb",

  fontSize:
    "0.8rem",

  textTransform:
    "uppercase",

  letterSpacing:
    "0.04em",

  color:
    "#6b7280",

  whiteSpace:
    "nowrap",
};

const td = {
  padding:
    "10px 8px",

  borderBottom:
    "1px solid #f3f4f6",

  color:
    "#111827",

  verticalAlign:
    "middle",
};

const overlay = {
  position:
    "fixed",

  inset:
    0,

  background:
    "rgba(15,23,42,0.5)",

  display:
    "flex",

  alignItems:
    "center",

  justifyContent:
    "center",

  padding:
    16,

  zIndex:
    9999,

  backdropFilter:
    "blur(2px)",
};

const modal = {
  width:
    "100%",

  maxWidth:
    640,

  background:
    "white",

  borderRadius:
    14,

  padding:
    16,

  boxShadow:
    "0 20px 50px rgba(0,0,0,0.25)",
};

const label = {
  display:
    "block",

  fontSize:
    "0.82rem",

  color:
    "#374151",

  marginBottom:
    5,

  fontWeight:
    800,
};

const input = {
  width:
    "100%",

  boxSizing:
    "border-box",

  minHeight:
    44,

  padding:
    "8px 10px",

  borderRadius:
    10,

  border:
    "1px solid #d1d5db",

  background:
    "white",

  color:
    "#111827",
};

const btnPrimary = {
  padding:
    "8px 12px",

  borderRadius:
    10,

  border:
    "1px solid #111827",

  background:
    "#111827",

  color:
    "white",

  fontWeight:
    800,
};

const btnGhost = {
  padding:
    "8px 12px",

  borderRadius:
    10,

  border:
    "1px solid #d1d5db",

  background:
    "white",

  color:
    "#334155",

  fontWeight:
    800,

  cursor:
    "pointer",
};

const xBtn = {
  border:
    "1px solid #e5e7eb",

  borderRadius:
    10,

  background:
    "white",

  color:
    "#334155",

  width:
    36,

  height:
    36,

  cursor:
    "pointer",

  fontWeight:
    900,
};

const tableOpenButton = {
  padding:
    "6px 12px",

  borderRadius:
    999,

  border:
    "1px solid #d1d5db",

  background:
    "white",

  color:
    "#334155",

  cursor:
    "pointer",

  fontWeight:
    800,

  marginRight:
    8,
};

const tableReopenButton = {
  padding:
    "6px 12px",

  borderRadius:
    999,

  border:
    "1px solid #16a34a",

  background:
    "#16a34a",

  color:
    "white",

  fontWeight:
    900,

  marginRight:
    8,
};

const tableDeleteButton = {
  padding:
    "6px 12px",

  borderRadius:
    999,

  border:
    "1px solid #ef4444",

  background:
    "#ef4444",

  color:
    "white",

  fontWeight:
    900,
};

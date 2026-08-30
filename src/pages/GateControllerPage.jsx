// src/pages/GateControllerPage.jsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db, storage } from "../firebase";

import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MOBILE_BREAKPOINT = 760;

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function normalizeOperationalPosition(value) {
  return String(value || "").trim().toUpperCase();
}

function userCanWorkGateController(item) {
  if (!item) return false;

  if (normalizeRole(item.role) === "gate_controller") {
    return true;
  }

  const candidates = [
    item.operationalPositions,
    item.allowedOperationalPositions,
    item.availableOperationalPositions,
    item.positions,
  ];

  return candidates.some((list) => {
    if (!Array.isArray(list)) return false;

    return list.some((value) => {
      const normalized = normalizeOperationalPosition(value);

      return (
        normalized === "GATE_CONTROLLER" ||
        normalized === "GATE CONTROLLER"
      );
    });
  });
}

function getOperationalActor(user, operationalContext) {
  return {
    userId: user?.id || null,
    username: user?.username || null,
    role: user?.role || null,
    fullName:
      operationalContext?.employeeFullName ||
      user?.fullName ||
      user?.name ||
      user?.username ||
      null,
    employeeFullName:
      operationalContext?.employeeFullName ||
      user?.fullName ||
      user?.name ||
      user?.username ||
      null,
    operationalPosition:
      operationalContext?.operationalPosition || null,
    operationalPositionLabel:
      operationalContext?.operationalPositionLabel || null,
    basePosition:
      operationalContext?.basePosition ||
      user?.position ||
      null,
    systemRole:
      operationalContext?.systemRole ||
      normalizeRole(user?.role) ||
      null,
  };
}

function toIntSafe(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return null;

  return Math.max(0, Math.trunc(number));
}

const STATUS_COLORS = {
  OPEN: {
    bg: "#FEF3C7",
    text: "#92400E",
    border: "#F59E0B",
  },
  RECEIVING: {
    bg: "#DBEAFE",
    text: "#1E3A8A",
    border: "#60A5FA",
  },
  LOADING: {
    bg: "#FFEDD5",
    text: "#9A3412",
    border: "#FB923C",
  },
  LOADED: {
    bg: "#DCFCE7",
    text: "#166534",
    border: "#22C55E",
  },
};

function normalizeStatus(status) {
  const value = String(status || "OPEN")
    .trim()
    .toUpperCase();

  return value === "OPEN" ||
    value === "RECEIVING" ||
    value === "LOADING" ||
    value === "LOADED"
    ? value
    : "OPEN";
}

function normalizeBagType(value) {
  const type = String(value || "CHECKED_BAG")
    .trim()
    .toUpperCase();

  return type === "CHECKED_BAG" ||
    type === "GATE_CHECK" ||
    type === "OVERSIZE" ||
    type === "GATE_BAG"
    ? type
    : "CHECKED_BAG";
}

function getBagTypeLabel(value) {
  const type = normalizeBagType(value);

  if (type === "GATE_CHECK") {
    return "Gate Check";
  }

  if (type === "OVERSIZE") {
    return "Oversize";
  }

  if (type === "GATE_BAG") {
    return "Bag Tagged at Gate";
  }

  return "Checked Bag";
}

function cleanTagValue(value) {
  return String(value || "").trim();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function isValidTag10(tag) {
  return onlyDigits(tag).length === 10;
}

function normalizeCartNumber(value) {
  return String(value || "").trim().toUpperCase();
}

/*
 * Converts Firestore Timestamp, Date, string, or number
 * into a readable local date and time.
 */
function formatTrackerDateTime(value) {
  if (!value) return "Not available";

  let date = null;

  if (typeof value?.toDate === "function") {
    date = value.toDate();
  } else if (
    typeof value?.seconds === "number"
  ) {
    date = new Date(value.seconds * 1000);
  } else if (value instanceof Date) {
    date = value;
  } else {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/*
 * Converts stored location keys into labels
 * that are easier for the Gate Controller to read.
 */
function getTrackerLocationLabel(value) {
  const location = String(value || "")
    .trim()
    .toLowerCase();

  const labels = {
    counter: "Ticket Counter",
    ticket_counter: "Ticket Counter",
    checkin: "Ticket Counter",
    check_in: "Ticket Counter",
    tsa: "TSA",
    security: "TSA",
    bagroom: "Bagroom",
    bag_room: "Bagroom",
    baggage_room: "Bagroom",
    makeup: "Bagroom / Make-up Area",
    makeup_area: "Bagroom / Make-up Area",
    oversize: "Oversize",
    oversize_belt: "Oversize Belt",
    transfer: "Transfer Area",
    customs: "Customs",
    cbp: "Customs / CBP",
    gate: "Boarding Gate",
    jetbridge: "Jet Bridge",
    ramp: "Ramp",
    aircraft: "Aircraft",
    aircraft_hold: "Aircraft Hold",
    hold: "Aircraft Hold",
    loaded: "Aircraft Loaded",
    offloaded: "Offloaded",
  };

  if (labels[location]) {
    return labels[location];
  }

  if (!location) {
    return "No location recorded";
  }

  return location
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

/*
 * Retrieves the best available username from
 * different event/document formats.
 */
function getTrackerUsername(source) {
  if (!source) return "Not available";

  return (
    source.username ||
    source.employeeName ||
    source.agentName ||
    source.scannedBy?.username ||
    source.scannedBy?.fullName ||
    source.createdBy?.username ||
    source.createdBy?.fullName ||
    source.updatedBy?.username ||
    source.lastSeenBy?.username ||
    source.lastSeenBy?.fullName ||
    "Not available"
  );
}

/*
 * Retrieves the most useful event description.
 */
function getTrackerEventLabel(source) {
  if (!source) return "No event information";

  return (
    source.message ||
    source.description ||
    source.eventLabel ||
    source.action ||
    source.type ||
    "Bag scan recorded"
  );
}

function extractBagTagsFromText(
  text,
  { exactLen = 10 } = {}
) {
  const source = String(text || "");
  const matches = source.match(/\d+/g) || [];

  const tags = matches
    .map((value) => value.trim())
    .filter(
      (value) => value.length === exactLen
    );

  const seen = new Set();
  const unique = [];

  for (const tag of tags) {
    if (!seen.has(tag)) {
      seen.add(tag);
      unique.push(tag);
    }
  }

  return unique;
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("File read error"));
    };

    reader.onload = () => {
      resolve(String(reader.result || ""));
    };

    reader.readAsText(file);
  });
}

async function readPdfAsText(file) {
  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
  }).promise;

  let fullText = "";

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber += 1
  ) {
    const page = await pdf.getPage(pageNumber);
    const content =
      await page.getTextContent();

    const strings = content.items.map(
      (item) => item.str
    );

    fullText += `${strings.join(" ")}\n`;
  }

  return fullText;
}

async function uploadPdfForOcr({
  file,
  flightId,
  user,
}) {
  const safeName = String(
    file.name || "manifest.pdf"
  ).replaceAll(" ", "_");

  const path =
    `flights/${flightId}/manifests/` +
    `${Date.now()}_${safeName}`;

  const fileRef = storageRef(storage, path);

  await uploadBytes(fileRef, file, {
    contentType: "application/pdf",
    customMetadata: {
      flightId: String(flightId),
      uploadedBy: String(
        user?.username || ""
      ),
      role: String(user?.role || ""),
    },
  });

  const url = await getDownloadURL(fileRef);

  return {
    path,
    url,
  };
}

export default function GateControllerPage({
  flightId,
  user,
  operationalContext,
  gateControllerOnDuty,
  canEdit,
}) {
  const role = useMemo(
    () => normalizeRole(user?.role),
    [user]
  );

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined"
      ? window.innerWidth < MOBILE_BREAKPOINT
      : false
  );

  const operationalActor = useMemo(
    () => getOperationalActor(user, operationalContext),
    [user, operationalContext]
  );

  const canDeleteGateBags =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "supervisor" ||
    role === "gate_controller";

  const [gateControllers, setGateControllers] =
    useState([]);

  const [
    selectedGateController,
    setSelectedGateController,
  ] = useState(
    gateControllerOnDuty ||
      localStorage.getItem(
        "gateControllerOnDuty"
      ) ||
      ""
  );

  const [gcMsg, setGcMsg] = useState("");

  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] =
    useState(true);

  const [
    checkedTotalInput,
    setCheckedTotalInput,
  ] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [aircraftTotal, setAircraftTotal] =
    useState(0);

  const [zones, setZones] = useState({
    1: 0,
    2: 0,
    3: 0,
    4: 0,
  });

  const [
    aircraftLoading,
    setAircraftLoading,
  ] = useState(true);

  const [
    aircraftScans,
    setAircraftScans,
  ] = useState([]);

  const [
    loadedAircraftTags,
    setLoadedAircraftTags,
  ] = useState([]);

  const [
    bagroomScans,
    setBagroomScans,
  ] = useState([]);

  const [
    loadingBagroomScans,
    setLoadingBagroomScans,
  ] = useState(true);

  const [
    activeBagroomTab,
    setActiveBagroomTab,
  ] = useState("summary");

  const [manifestText, setManifestText] =
    useState("");

  const [
    manifestTagsPreview,
    setManifestTagsPreview,
  ] = useState([]);

  const [manifestMsg, setManifestMsg] =
    useState("");

  const [manifestErr, setManifestErr] =
    useState("");

  const [importing, setImporting] =
    useState(false);

  const [
    strictManifest,
    setStrictManifest,
  ] = useState(false);

  const [scanInput, setScanInput] =
    useState("");

  const scanRef = useRef(null);

  const [scanMsg, setScanMsg] = useState("");
  const [scanErr, setScanErr] = useState("");

  const [savingScan, setSavingScan] =
    useState(false);

  const [allowedCount, setAllowedCount] =
    useState(0);

  const [
    recentAllowed,
    setRecentAllowed,
  ] = useState([]);

  const [
    allManifestTags,
    setAllManifestTags,
  ] = useState([]);

  const [
    loadingAllowed,
    setLoadingAllowed,
  ] = useState(true);

  const [deletingTag, setDeletingTag] =
    useState("");

  const [
    activeManifestTab,
    setActiveManifestTab,
  ] = useState("recent");

  /*
   * Missing bag tracker modal.
   *
   * The tracker is activated when the flight has
   * between 1 and 5 manifest bags missing to load.
   */
  const [
    trackerOpen,
    setTrackerOpen,
  ] = useState(false);

  const [
    trackerTag,
    setTrackerTag,
  ] = useState("");

  const [
    trackerLoading,
    setTrackerLoading,
  ] = useState(false);

  const [
    trackerError,
    setTrackerError,
  ] = useState("");

  const [
    trackerData,
    setTrackerData,
  ] = useState(null);

  /*
   * Gate-tagged bags:
   * direct Gate â Aircraft.
   */
  const [
    gateBagInput,
    setGateBagInput,
  ] = useState("");

  const gateBagInputRef = useRef(null);
  const gateBagTimerRef = useRef(null);
  const gateBagSavingRef = useRef(false);

  const [
    gateBagScans,
    setGateBagScans,
  ] = useState([]);

  const [
    loadingGateBagScans,
    setLoadingGateBagScans,
  ] = useState(true);

  const [
    gateBagMsg,
    setGateBagMsg,
  ] = useState("");

  const [
    gateBagErr,
    setGateBagErr,
  ] = useState("");

  const [
    deletingGateBagTag,
    setDeletingGateBagTag,
  ] = useState("");

  const debounceRef = useRef(null);

  const isFlightLoaded =
    Boolean(
      flight?.aircraftLoadingCompleted
    ) ||
    normalizeStatus(flight?.status) ===
      "LOADED";

  const loadedAircraftTagSet = useMemo(() => {
    return new Set(
      aircraftScans
        .map((scan) =>
          onlyDigits(
            scan.tag ||
              scan.bagTag ||
              scan.bagTagNumber ||
              scan.barcode ||
              scan.id
          )
        )
        .filter((tag) =>
          isValidTag10(tag)
        )
    );
  }, [aircraftScans]);

  const gateBagLoadedCount = useMemo(() => {
    return gateBagScans.filter((scan) => {
      const tag = onlyDigits(
        scan.tag || scan.id
      );

      return loadedAircraftTagSet.has(tag);
    }).length;
  }, [
    gateBagScans,
    loadedAircraftTagSet,
  ]);

  const gateBagPendingCount = Math.max(
    0,
    gateBagScans.length -
      gateBagLoadedCount
  );

  const aircraftBagTypeCounts =
    useMemo(() => {
      const counts = {
        CHECKED_BAG: 0,
        GATE_CHECK: 0,
        OVERSIZE: 0,
        GATE_BAG: 0,
      };

      for (const scan of aircraftScans) {
        const type = normalizeBagType(
          scan.bagType
        );

        counts[type] += 1;
      }

      return counts;
    }, [aircraftScans]);
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(
        window.innerWidth < MOBILE_BREAKPOINT
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

  useEffect(() => {
    const loadGateControllers = async () => {
      try {
        const snap = await getDocs(
          collection(db, "users")
        );

        const list = snap.docs
          .map((document) => ({
            id: document.id,
            ...document.data(),
          }))
          .filter(
            (candidate) =>
              candidate.username &&
              candidate.active !== false &&
              userCanWorkGateController(candidate)
          )
          .sort((a, b) =>
            String(
              a.fullName ||
                a.username ||
                ""
            ).localeCompare(
              String(
                b.fullName ||
                  b.username ||
                  ""
              )
            )
          );

        setGateControllers(list);
      } catch (error) {
        console.error(
          "Error loading gate controllers:",
          error
        );
      }
    };

    loadGateControllers();
  }, []);

  useEffect(() => {
    if (!flightId) {
      setFlight(null);
      setFlightLoading(false);
      return;
    }

    setFlightLoading(true);

    const flightRef = doc(
      db,
      "flights",
      flightId
    );

    const unsub = onSnapshot(
      flightRef,
      (snap) => {
        if (!snap.exists()) {
          setFlight(null);
          setFlightLoading(false);
          return;
        }

        const data = {
          id: snap.id,
          ...snap.data(),
        };

        setFlight(data);

        if (
          typeof data.checkedBagsTotal ===
          "number"
        ) {
          setCheckedTotalInput(
            String(data.checkedBagsTotal)
          );
        } else {
          setCheckedTotalInput("");
        }

        if (
          typeof data.strictManifest ===
          "boolean"
        ) {
          setStrictManifest(
            data.strictManifest
          );
        }

        if (data.gateControllerOnDuty) {
          setSelectedGateController(
            data.gateControllerOnDuty
          );

          localStorage.setItem(
            "gateControllerOnDuty",
            data.gateControllerOnDuty
          );
        }

        setFlightLoading(false);
      },
      (error) => {
        console.error(
          "GateControllerPage flight snapshot error:",
          error
        );

        setFlight(null);
        setFlightLoading(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (!flightId) {
      setAllowedCount(0);
      setRecentAllowed([]);
      setAllManifestTags([]);
      setLoadingAllowed(false);
      return;
    }

    setLoadingAllowed(true);

    const collectionRef = collection(
      db,
      "flights",
      flightId,
      "allowedBagTags"
    );

    const manifestQuery = query(
      collectionRef,
      orderBy("importedAt", "desc")
    );

    const unsub = onSnapshot(
      manifestQuery,
      (snap) => {
        setAllowedCount(snap.size);

        const rows = snap.docs.map(
          (document) => ({
            id: document.id,
            ...document.data(),
          })
        );

        const tags = rows
          .map((row) =>
            onlyDigits(
              row.tag || row.id
            )
          )
          .filter((tag) =>
            isValidTag10(tag)
          );

        setAllManifestTags(tags);
        setRecentAllowed(
          rows.slice(0, 60)
        );
        setLoadingAllowed(false);
      },
      (error) => {
        console.error(
          "allowedBagTags snapshot error:",
          error
        );

        setAllowedCount(0);
        setRecentAllowed([]);
        setAllManifestTags([]);
        setLoadingAllowed(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (!flightId) {
      setBagroomScans([]);
      setLoadingBagroomScans(false);
      return;
    }

    setLoadingBagroomScans(true);

    const bagroomRef = collection(
      db,
      "flights",
      flightId,
      "bagroomScans"
    );

    const unsub = onSnapshot(
      bagroomRef,
      (snap) => {
        const rows = snap.docs.map(
          (document) => ({
            id: document.id,
            ...document.data(),
          })
        );

        rows.sort((a, b) => {
          const timeA =
            a.createdAt?.seconds || 0;

          const timeB =
            b.createdAt?.seconds || 0;

          return timeB - timeA;
        });

        setBagroomScans(rows);
        setLoadingBagroomScans(false);
      },
      (error) => {
        console.error(
          "Bagroom scans snapshot error:",
          error
        );

        setBagroomScans([]);
        setLoadingBagroomScans(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (!flightId) {
      setAircraftTotal(0);

      setZones({
        1: 0,
        2: 0,
        3: 0,
        4: 0,
      });

      setAircraftScans([]);
      setLoadedAircraftTags([]);
      setAircraftLoading(false);
      return;
    }

    setAircraftLoading(true);

    const aircraftRef = collection(
      db,
      "flights",
      flightId,
      "aircraftScans"
    );

    const unsub = onSnapshot(
      aircraftRef,
      (snap) => {
        const rows = snap.docs.map(
          (document) => ({
            id: document.id,
            ...document.data(),
          })
        );

        rows.sort((a, b) => {
          const timeA =
            a.createdAt?.seconds || 0;

          const timeB =
            b.createdAt?.seconds || 0;

          return timeB - timeA;
        });

        const zoneCounts = {
          1: 0,
          2: 0,
          3: 0,
          4: 0,
        };

        const loadedTags = [];

        for (const row of rows) {
          const zone = Number(row.zone);

          if (
            zone >= 1 &&
            zone <= 4
          ) {
            zoneCounts[zone] += 1;
          }

          const tag = onlyDigits(
            row.bagTag ||
              row.tag ||
              row.bagTagNumber ||
              row.barcode ||
              row.id
          );

          if (isValidTag10(tag)) {
            loadedTags.push(tag);
          }
        }

        setAircraftScans(rows);
        setAircraftTotal(rows.length);
        setZones(zoneCounts);
        setLoadedAircraftTags(
          loadedTags
        );
        setAircraftLoading(false);
      },
      (error) => {
        console.error(
          "GateControllerPage aircraft snapshot error:",
          error
        );

        setAircraftTotal(0);

        setZones({
          1: 0,
          2: 0,
          3: 0,
          4: 0,
        });

        setAircraftScans([]);
        setLoadedAircraftTags([]);
        setAircraftLoading(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    if (!flightId) {
      setGateBagScans([]);
      setLoadingGateBagScans(false);
      return;
    }

    setLoadingGateBagScans(true);

    const gateBagRef = collection(
      db,
      "flights",
      flightId,
      "gateBagScans"
    );

    const unsub = onSnapshot(
      gateBagRef,
      (snap) => {
        const rows = snap.docs.map(
          (document) => ({
            id: document.id,
            ...document.data(),
          })
        );

        rows.sort((a, b) => {
          const timeA =
            a.createdAt?.seconds || 0;

          const timeB =
            b.createdAt?.seconds || 0;

          return timeB - timeA;
        });

        setGateBagScans(rows);
        setLoadingGateBagScans(false);
      },
      (error) => {
        console.error(
          "Gate bag scans snapshot error:",
          error
        );

        setGateBagScans([]);
        setLoadingGateBagScans(false);
      }
    );

    return () => unsub();
  }, [flightId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(
          debounceRef.current
        );
      }

      if (gateBagTimerRef.current) {
        clearTimeout(
          gateBagTimerRef.current
        );
      }
    };
  }, []);

  const checkedBagsTotal =
    typeof flight?.checkedBagsTotal ===
    "number"
      ? flight.checkedBagsTotal
      : null;

  const missing =
    checkedBagsTotal === null
      ? null
      : Math.max(
          0,
          checkedBagsTotal -
            aircraftTotal
        );

  const flightStatus = normalizeStatus(
    flight?.status
  );

  const statusStyle =
    STATUS_COLORS[flightStatus] ||
    STATUS_COLORS.OPEN;

  const manifestTagSet = useMemo(() => {
    return new Set(allManifestTags);
  }, [allManifestTags]);

  const loadedTagSet = useMemo(() => {
    return new Set(
      loadedAircraftTags
        .map((tag) =>
          onlyDigits(tag)
        )
        .filter((tag) =>
          isValidTag10(tag)
        )
    );
  }, [loadedAircraftTags]);

  const missingManifestTags =
    useMemo(() => {
      return allManifestTags.filter(
        (tag) =>
          !loadedTagSet.has(tag)
      );
    }, [
      allManifestTags,
      loadedTagSet,
    ]);

  /*
   * Tracker buttons only become active
   * when there are between 1 and 5
   * manifest bags missing to load.
   */
  const missingTrackerEnabled =
    missingManifestTags.length >= 1 &&
    missingManifestTags.length <= 5;

  const bagroomMatchedTags = useMemo(() => {
    return bagroomScans
      .map((scan) =>
        onlyDigits(
          scan.tag || scan.id
        )
      )
      .filter(
        (tag) =>
          isValidTag10(tag) &&
          manifestTagSet.has(tag)
      );
  }, [
    bagroomScans,
    manifestTagSet,
  ]);

  const bagroomNotInManifest =
    useMemo(() => {
      return bagroomScans
        .map((scan) => ({
          ...scan,
          cleanTag: onlyDigits(
            scan.tag || scan.id
          ),
        }))
        .filter(
          (scan) =>
            isValidTag10(
              scan.cleanTag
            ) &&
            !manifestTagSet.has(
              scan.cleanTag
            )
        );
    }, [
      bagroomScans,
      manifestTagSet,
    ]);

  const bagroomByCart = useMemo(() => {
    const groups = {};

    for (const scan of bagroomScans) {
      const cart =
        normalizeCartNumber(
          scan.cartNumber
        ) || "NO CART";

      if (!groups[cart]) {
        groups[cart] = [];
      }

      groups[cart].push(scan);
    }

    return groups;
  }, [bagroomScans]);

  const gateBagTagSet = useMemo(() => {
    return new Set(
      gateBagScans
        .map((scan) =>
          onlyDigits(
            scan.tag || scan.id
          )
        )
        .filter((tag) =>
          isValidTag10(tag)
        )
    );
  }, [gateBagScans]);

  const loadedGateBagTags =
    useMemo(() => {
      return gateBagScans
        .map((scan) =>
          onlyDigits(
            scan.tag || scan.id
          )
        )
        .filter(
          (tag) =>
            isValidTag10(tag) &&
            loadedAircraftTagSet.has(
              tag
            )
        );
    }, [
      gateBagScans,
      loadedAircraftTagSet,
    ]);

  const pendingGateBagTags =
    useMemo(() => {
      return gateBagScans
        .map((scan) =>
          onlyDigits(
            scan.tag || scan.id
          )
        )
        .filter(
          (tag) =>
            isValidTag10(tag) &&
            !loadedAircraftTagSet.has(
              tag
            )
        );
    }, [
      gateBagScans,
      loadedAircraftTagSet,
    ]);

  /*
   * Closes and resets the missing bag
   * tracking modal.
   */
  const closeBagTracker = () => {
    setTrackerOpen(false);
    setTrackerTag("");
    setTrackerData(null);
    setTrackerError("");
    setTrackerLoading(false);
  };

  /*
   * Looks for the latest baggage location.
   *
   * Priority:
   * 1. Most recent document inside:
   *    bagTags/{tag}/events
   *
   * 2. Summary fields stored in:
   *    bagTags/{tag}
   *
   * 3. Current flight scan collections,
   *    used as a fallback if the tracker
   *    document or events are unavailable.
   */
  const openBagTracker = async (
    rawTag
  ) => {
    const tag = onlyDigits(rawTag);

    if (!isValidTag10(tag)) {
      return;
    }

    setTrackerOpen(true);
    setTrackerTag(tag);
    setTrackerData(null);
    setTrackerError("");
    setTrackerLoading(true);

    try {
      const tagRef = doc(
        db,
        "bagTags",
        tag
      );

      const tagSnap =
        await getDoc(tagRef);

      const tagSummary = tagSnap.exists()
        ? {
            id: tagSnap.id,
            ...tagSnap.data(),
          }
        : null;

      let latestEvent = null;

      try {
        const latestEventQuery = query(
          collection(
            db,
            "bagTags",
            tag,
            "events"
          ),
          orderBy(
            "createdAt",
            "desc"
          ),
          limit(1)
        );

        const eventSnap =
          await getDocs(
            latestEventQuery
          );

        if (!eventSnap.empty) {
          const eventDoc =
            eventSnap.docs[0];

          latestEvent = {
            id: eventDoc.id,
            ...eventDoc.data(),
          };
        }
      } catch (eventError) {
        console.warn(
          "Could not query tracker events:",
          eventError
        );
      }

      /*
       * Fallback scan records from the
       * currently selected flight.
       */
      const currentFlightCandidates = [];

      const bagroomRecord =
        bagroomScans.find(
          (scan) =>
            onlyDigits(
              scan.tag || scan.id
            ) === tag
        );

      if (bagroomRecord) {
        currentFlightCandidates.push({
          ...bagroomRecord,
          location: "bagroom",
          message:
            bagroomRecord.message ||
            `Bag scanned in Bagroom${
              bagroomRecord.cartNumber
                ? ` Â· Cart ${bagroomRecord.cartNumber}`
                : ""
            }`,
          trackerSource:
            "Current Flight Bagroom",
          trackerTime:
            bagroomRecord.createdAt ||
            bagroomRecord.scannedAt,
        });
      }

      const gateRecord =
        gateBagScans.find(
          (scan) =>
            onlyDigits(
              scan.tag || scan.id
            ) === tag
        );

      if (gateRecord) {
        currentFlightCandidates.push({
          ...gateRecord,
          location: "gate",
          message:
            gateRecord.message ||
            "Bag tagged at Gate Â· Direct to Aircraft",
          trackerSource:
            "Current Flight Gate",
          trackerTime:
            gateRecord.createdAt ||
            gateRecord.scannedAt,
        });
      }

      const aircraftRecord =
        aircraftScans.find(
          (scan) =>
            onlyDigits(
              scan.tag ||
                scan.bagTag ||
                scan.bagTagNumber ||
                scan.barcode ||
                scan.id
            ) === tag
        );

      if (aircraftRecord) {
        currentFlightCandidates.push({
          ...aircraftRecord,
          location:
            aircraftRecord.location ||
            "aircraft",
          message:
            aircraftRecord.message ||
            `Bag loaded on Aircraft${
              aircraftRecord.zone
                ? ` Â· Zone ${aircraftRecord.zone}`
                : ""
            }`,
          trackerSource:
            "Current Flight Aircraft",
          trackerTime:
            aircraftRecord.createdAt ||
            aircraftRecord.scannedAt,
        });
      }

      currentFlightCandidates.sort(
        (a, b) => {
          const timeA =
            a.trackerTime?.seconds ||
            0;

          const timeB =
            b.trackerTime?.seconds ||
            0;

          return timeB - timeA;
        }
      );

      const latestFlightScan =
        currentFlightCandidates[0] ||
        null;

      /*
       * Choose the best available source.
       */
      let bestSource = null;
      let sourceName = "";

      if (latestEvent) {
        bestSource = latestEvent;
        sourceName =
          "Baggage Tracker Event";
      } else if (tagSummary) {
        bestSource = tagSummary;
        sourceName =
          "Baggage Tracker Summary";
      } else if (latestFlightScan) {
        bestSource =
          latestFlightScan;
        sourceName =
          latestFlightScan.trackerSource ||
          "Current Flight Scan";
      }

      if (!bestSource) {
        setTrackerData({
          tag,
          found: false,
        });

        setTrackerError(
          "No previous scan or location was found for this bag tag."
        );

        return;
      }

      const location =
        bestSource.location ||
        bestSource.lastSeenLocation ||
        bestSource.currentLocation ||
        bestSource.scanLocation ||
        tagSummary?.lastSeenLocation ||
        latestFlightScan?.location ||
        "";

      const eventTime =
        bestSource.createdAt ||
        bestSource.scannedAt ||
        bestSource.updatedAt ||
        bestSource.lastSeenAt ||
        bestSource.timestamp ||
        tagSummary?.lastSeenAt ||
        latestFlightScan?.trackerTime ||
        null;

      const userName =
        getTrackerUsername(
          bestSource
        ) !== "Not available"
          ? getTrackerUsername(
              bestSource
            )
          : getTrackerUsername(
              tagSummary
            ) !== "Not available"
            ? getTrackerUsername(
                tagSummary
              )
            : getTrackerUsername(
                latestFlightScan
              );

      const eventLabel =
        getTrackerEventLabel(
          bestSource
        );

      setTrackerData({
        tag,
        found: true,
        sourceName,
        location,
        locationLabel:
          getTrackerLocationLabel(
            location
          ),
        eventTime,
        formattedTime:
          formatTrackerDateTime(
            eventTime
          ),
        userName,
        eventLabel,
        cartNumber:
          bestSource.cartNumber ||
          latestFlightScan?.cartNumber ||
          null,
        gate:
          bestSource.gate ||
          tagSummary?.gate ||
          flight?.gate ||
          null,
        zone:
          bestSource.zone ||
          latestFlightScan?.zone ||
          null,
        flightNumber:
          bestSource.flightNumber ||
          tagSummary?.flightNumber ||
          flight?.flightNumber ||
          null,
        flightDate:
          bestSource.flightDate ||
          tagSummary?.flightDate ||
          flight?.flightDate ||
          null,
        bagTypeLabel:
          bestSource.bagTypeLabel ||
          tagSummary?.bagTypeLabel ||
          getBagTypeLabel(
            bestSource.bagType ||
              tagSummary?.bagType
          ),
      });
    } catch (error) {
      console.error(
        "Missing bag tracker error:",
        error
      );

      setTrackerData(null);

      setTrackerError(
        "Could not retrieve the last baggage location. Check the connection and Firestore permissions."
      );
    } finally {
      setTrackerLoading(false);
    }
  };

  /*
   * Allows the modal to close with
   * the Escape key.
   */
  useEffect(() => {
    if (!trackerOpen) return;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        closeBagTracker();
      }
    };

    window.addEventListener(
      "keydown",
      handleEscape
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, [trackerOpen]);

  /*
   * Automatically closes the modal if
   * the selected missing bag becomes loaded.
   */
  useEffect(() => {
    if (
      trackerOpen &&
      trackerTag &&
      loadedTagSet.has(trackerTag)
    ) {
      closeBagTracker();
    }
  }, [
    trackerOpen,
    trackerTag,
    loadedTagSet,
  ]);

  const ensureStatusReceiving =
    async () => {
      if (!flightId || !flight) {
        return;
      }

      const currentStatus =
        normalizeStatus(
          flight.status
        );

      if (currentStatus !== "OPEN") {
        return;
      }

      await setDoc(
        doc(
          db,
          "flights",
          flightId
        ),
        {
          status: "RECEIVING",
          statusUpdatedAt:
            serverTimestamp(),
          statusUpdatedBy: operationalActor,
        },
        {
          merge: true,
        }
      );
    };

  const saveGateControllerOnDuty =
    async () => {
      const picked =
        selectedGateController.trim();

      if (!picked) {
        setGcMsg(
          "Please select a Gate Controller."
        );
        return;
      }

      try {
        localStorage.setItem(
          "gateControllerOnDuty",
          picked
        );

        await setDoc(
          doc(
            db,
            "flights",
            flightId
          ),
          {
            gateControllerOnDuty:
              picked,
            gateControllerUpdatedAt:
              serverTimestamp(),
            gateControllerUpdatedBy: operationalActor,
          },
          {
            merge: true,
          }
        );

        setGcMsg(
          `Gate Controller saved: ${picked} â`
        );

        setTimeout(
          () => setGcMsg(""),
          2500
        );
      } catch (error) {
        console.error(error);

        setGcMsg(
          "Could not save Gate Controller."
        );
      }
    };

  const updateFlightStatus =
    async (nextStatus) => {
      setManifestMsg("");
      setManifestErr("");

      if (!canEdit) {
        setManifestErr(
          "You don't have permission to change flight status."
        );
        return;
      }

      try {
        await setDoc(
          doc(
            db,
            "flights",
            flightId
          ),
          {
            status: nextStatus,
            statusUpdatedAt:
              serverTimestamp(),
            statusUpdatedBy: operationalActor,
          },
          {
            merge: true,
          }
        );

        setManifestMsg(
          `Status updated to ${nextStatus} â`
        );

        setTimeout(
          () =>
            setManifestMsg(""),
          2000
        );
      } catch (error) {
        console.error(error);

        setManifestErr(
          "Could not update status. Check Firestore rules."
        );
      }
    };
    const saveTotal = async () => {
    setSaveMsg("");

    const value = toIntSafe(
      checkedTotalInput
    );

    if (value === null) {
      setSaveMsg(
        "Please enter a valid number."
      );
      return;
    }

    if (!canEdit) {
      setSaveMsg(
        "You don't have permission to edit this field."
      );
      return;
    }

    try {
      setSaving(true);

      await setDoc(
        doc(
          db,
          "flights",
          flightId
        ),
        {
          checkedBagsTotal: value,
          gateTotalUpdatedAt:
            serverTimestamp(),
          gateTotalUpdatedBy: operationalActor,
          gateControllerOnDuty:
            selectedGateController ||
            null,
        },
        {
          merge: true,
        }
      );

      setSaveMsg("Saved â");

      setTimeout(
        () => setSaveMsg(""),
        2000
      );
    } catch (error) {
      console.error(
        "Save gate total error:",
        error
      );

      setSaveMsg(
        "Could not save. Check Firestore rules."
      );
    } finally {
      setSaving(false);
    }
  };

  const updateStrictManifest =
    async (nextValue) => {
      setManifestMsg("");
      setManifestErr("");

      if (!canEdit) {
        setManifestErr(
          "No permission to change Strict Manifest."
        );
        return;
      }

      try {
        await setDoc(
          doc(
            db,
            "flights",
            flightId
          ),
          {
            strictManifest:
              Boolean(nextValue),
            strictManifestUpdatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );

        setStrictManifest(
          Boolean(nextValue)
        );

        setManifestMsg(
          `Strict Manifest set to ${
            nextValue
              ? "ON"
              : "OFF"
          } â`
        );

        setTimeout(
          () =>
            setManifestMsg(""),
          2000
        );
      } catch (error) {
        console.error(error);

        setManifestErr(
          "Could not update Strict Manifest (check rules)."
        );
      }
    };

  const previewFromText = (text) => {
    setManifestMsg("");
    setManifestErr("");

    const tags =
      extractBagTagsFromText(
        text,
        {
          exactLen: 10,
        }
      );

    setManifestTagsPreview(tags);

    if (tags.length === 0) {
      setManifestErr(
        "No 10-digit bag tag numbers found. If this is a scanned PDF, use OCR upload."
      );
      return;
    }

    setManifestMsg(
      `Preview: found ${tags.length} bag tags (ONLY 10 digits).`
    );
  };

  const removeFromPreview = (tag) => {
    setManifestTagsPreview(
      (previous) =>
        previous.filter(
          (item) => item !== tag
        )
    );
  };

  const handleFilePick =
    async (file) => {
      setManifestMsg("");
      setManifestErr("");

      try {
        const isPdf =
          file.type ===
            "application/pdf" ||
          file.name
            .toLowerCase()
            .endsWith(".pdf");

        let text = "";

        if (isPdf) {
          setManifestMsg(
            "Reading PDF (local)..."
          );

          text =
            await readPdfAsText(
              file
            );
        } else {
          setManifestMsg(
            "Reading file..."
          );

          text =
            await readFileAsText(
              file
            );
        }

        setManifestText(text);
        previewFromText(text);

        const found =
          extractBagTagsFromText(
            text,
            {
              exactLen: 10,
            }
          ).length;

        if (
          isPdf &&
          found === 0
        ) {
          setManifestMsg(
            "No 10-digit tags found locally. Uploading PDF for OCR..."
          );

          const uploaded =
            await uploadPdfForOcr({
              file,
              flightId,
              user,
            });

          setManifestMsg(
            `PDF uploaded for OCR â\n\nPath: ${uploaded.path}\n\nCloud OCR will import tags automatically.`
          );
        }
      } catch (error) {
        console.error(error);

        setManifestErr(
          "Could not read file. If PDF is scanned, OCR upload is required."
        );
      }
    };

  const importManifest = async () => {
    setManifestMsg("");
    setManifestErr("");

    if (!canEdit) {
      setManifestErr(
        "You don't have permission to import manifest."
      );
      return;
    }

    const tags =
      manifestTagsPreview;

    if (
      !tags ||
      tags.length === 0
    ) {
      setManifestErr(
        "Nothing to import. Preview first."
      );
      return;
    }

    try {
      setImporting(true);

      const chunkSize = 450;
      let imported = 0;

      for (
        let index = 0;
        index < tags.length;
        index += chunkSize
      ) {
        const chunk = tags.slice(
          index,
          index + chunkSize
        );

        const batch =
          writeBatch(db);

        for (const tag of chunk) {
          if (
            !isValidTag10(tag)
          ) {
            continue;
          }

          const tagRef = doc(
            db,
            "flights",
            flightId,
            "allowedBagTags",
            tag
          );

          batch.set(tagRef, {
            tag,
            importedAt:
              serverTimestamp(),
            importedBy: operationalActor,
            source: "import",
          });

          imported += 1;
        }

        await batch.commit();
      }

      await setDoc(
        doc(
          db,
          "flights",
          flightId
        ),
        {
          strictManifest: true,
          strictManifestUpdatedAt:
            serverTimestamp(),
          manifestImportedAt:
            serverTimestamp(),
          manifestImportedBy: operationalActor,
        },
        {
          merge: true,
        }
      );

      setStrictManifest(true);

      setManifestMsg(
        `Imported ${imported} bag tags â Strict Manifest ON`
      );

      setTimeout(
        () =>
          setManifestMsg(""),
        2500
      );
    } catch (error) {
      console.error(error);

      setManifestErr(
        "Import failed. Check Firestore rules and try again."
      );
    } finally {
      setImporting(false);
    }
  };

  const saveScannedTagToManifest =
    async (raw) => {
      setScanMsg("");
      setScanErr("");

      if (!canEdit) {
        setScanErr(
          "You don't have permission to scan/import manifest tags."
        );
        return;
      }

      const cleaned = onlyDigits(
        cleanTagValue(raw)
      );

      if (!cleaned) return;

      if (
        !isValidTag10(cleaned)
      ) {
        setScanErr(
          "Invalid bag tag. Must be exactly 10 digits."
        );
        return;
      }

      try {
        setSavingScan(true);

        await ensureStatusReceiving();

        const tagRef = doc(
          db,
          "flights",
          flightId,
          "allowedBagTags",
          cleaned
        );

        await setDoc(
          tagRef,
          {
            tag: cleaned,
            importedAt:
              serverTimestamp(),
            importedBy: operationalActor,
            source: "scan",
          },
          {
            merge: true,
          }
        );

        await setDoc(
          doc(
            db,
            "flights",
            flightId
          ),
          {
            strictManifest: true,
            strictManifestUpdatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );

        setStrictManifest(true);

        setScanMsg(
          `Saved â ${cleaned}`
        );

        setScanInput("");

        if (scanRef.current) {
          scanRef.current.focus();
        }
      } catch (error) {
        console.error(error);

        setScanErr(
          "Could not save scanned tag. Check rules/connection."
        );
      } finally {
        setSavingScan(false);
      }
    };

  const deleteAllowedTag =
    async (tag) => {
      if (!canEdit) return;

      const id = String(
        tag || ""
      ).trim();

      if (!id) return;

      const confirmed =
        window.confirm(
          `Delete this manifest tag?\n\n${id}\n\nThis cannot be undone.`
        );

      if (!confirmed) return;

      try {
        setDeletingTag(id);

        await deleteDoc(
          doc(
            db,
            "flights",
            flightId,
            "allowedBagTags",
            id
          )
        );
      } catch (error) {
        console.error(error);

        window.alert(
          "Failed to delete tag. Check Firestore rules."
        );
      } finally {
        setDeletingTag("");
      }
    };

  const validateGateBagOtherFlight =
    async (tag) => {
      const tagRef = doc(
        db,
        "bagTags",
        tag
      );

      const tagSnap =
        await getDoc(tagRef);

      if (!tagSnap.exists()) {
        return {
          ok: true,
        };
      }

      const existing =
        tagSnap.data();

      if (
        existing.flightId &&
        existing.flightId !==
          flightId
      ) {
        return {
          ok: false,
          message:
            `â This bag tag belongs to another flight/date.\n\n` +
            `Current flight: ${
              flight?.flightNumber ||
              flightId
            } (${
              flight?.flightDate ||
              "-"
            })\n` +
            `Registered flight: ${
              existing.flightNumber ||
              existing.flightId
            } (${
              existing.flightDate ||
              "-"
            })\n\n` +
            "Do NOT accept this bag for this flight.",
        };
      }

      return {
        ok: true,
      };
    };

  const saveGateBagTrackingEvent =
    async (tag) => {
      const eventRef = doc(
        db,
        "bagTags",
        tag,
        "events",
        `gate_bag_${Date.now()}`
      );

      await setDoc(eventRef, {
        type: "GATE_BAG_SCAN",
        location: "gate",
        message:
          "Bag tag created / scanned at gate Â· Direct to Aircraft",
        tag,
        bagType: "GATE_BAG",
        bagTypeLabel:
          "Bag Tagged at Gate",
        directToAircraft: true,
        employeeFullName:
          operationalActor.employeeFullName,
        operationalPosition:
          operationalActor.operationalPosition,
        operationalPositionLabel:
          operationalActor.operationalPositionLabel,
        basePosition:
          operationalActor.basePosition,
        flightId,
        flightNumber:
          flight?.flightNumber ||
          null,
        flightDate:
          flight?.flightDate ||
          null,
        gate:
          flight?.gate || null,
        createdAt:
          serverTimestamp(),
        createdBy: operationalActor,
      });
    };

  const saveGateBagScan =
    async (tag) => {
      const currentScanRef = doc(
        db,
        "flights",
        flightId,
        "gateBagScans",
        tag
      );

      const existingScan =
        await getDoc(
          currentScanRef
        );

      if (
        existingScan.exists()
      ) {
        setGateBagErr(
          `Duplicate scan. Bag tag ${tag} was already tagged at Gate.`
        );

        setGateBagInput("");

        return false;
      }

      const crossFlight =
        await validateGateBagOtherFlight(
          tag
        );

      if (!crossFlight.ok) {
        setGateBagErr(
          crossFlight.message
        );

        setGateBagInput("");

        return false;
      }

      await setDoc(
        currentScanRef,
        {
          tag,
          location: "gate",
          bagType: "GATE_BAG",
          bagTypeLabel:
            "Bag Tagged at Gate",
          directToAircraft: true,
          employeeFullName:
            operationalActor.employeeFullName,
          operationalPosition:
            operationalActor.operationalPosition,
          operationalPositionLabel:
            operationalActor.operationalPositionLabel,
          basePosition:
            operationalActor.basePosition,
          createdAt:
            serverTimestamp(),
          scannedBy: operationalActor,
        }
      );

      await setDoc(
        doc(
          db,
          "bagTags",
          tag
        ),
        {
          tag,
          flightId,
          flightNumber:
            flight?.flightNumber ||
            null,
          flightDate:
            flight?.flightDate ||
            null,
          gate:
            flight?.gate || null,
          bagType: "GATE_BAG",
          bagTypeLabel:
            "Bag Tagged at Gate",
          directToAircraft: true,
          employeeFullName:
            operationalActor.employeeFullName,
          operationalPosition:
            operationalActor.operationalPosition,
          operationalPositionLabel:
            operationalActor.operationalPositionLabel,
          basePosition:
            operationalActor.basePosition,
          firstSeenAt:
            serverTimestamp(),
          lastSeenAt:
            serverTimestamp(),
          lastSeenLocation:
            "gate",
          lastSeenBy: operationalActor,
        },
        {
          merge: true,
        }
      );

      await saveGateBagTrackingEvent(
        tag
      );

      return true;
    };

  const handleGateBagSubmit =
    async (forcedValue) => {
      if (
        gateBagSavingRef.current
      ) {
        return;
      }

      setGateBagMsg("");
      setGateBagErr("");

      if (!canEdit) {
        setGateBagErr(
          "You don't have permission to create Gate bag tags."
        );
        return;
      }

      if (isFlightLoaded) {
        setGateBagErr(
          "This flight is already LOADED. Gate bag scanning is locked."
        );

        setGateBagInput("");
        return;
      }

      const tag = onlyDigits(
        cleanTagValue(
          forcedValue ??
            gateBagInput
        )
      );

      if (!tag) return;

      if (!isValidTag10(tag)) {
        setGateBagErr(
          "Invalid bag tag. Must be exactly 10 digits."
        );
        return;
      }

      try {
        gateBagSavingRef.current =
          true;

        const saved =
          await saveGateBagScan(
            tag
          );

        if (!saved) return;

        setGateBagMsg(
          `Gate bag saved â ${tag} Â· Direct to Aircraft`
        );

        setGateBagInput("");

        if (
          gateBagInputRef.current
        ) {
          gateBagInputRef.current.focus();
        }
      } catch (error) {
        console.error(
          "Gate bag scan error:",
          error
        );

        setGateBagErr(
          "Could not save Gate bag. Check Firestore rules/connection."
        );
      } finally {
        gateBagSavingRef.current =
          false;
      }
    };

  const scheduleGateBagSubmit =
    (value) => {
      if (
        gateBagTimerRef.current
      ) {
        clearTimeout(
          gateBagTimerRef.current
        );
      }

      const cleaned = onlyDigits(
        cleanTagValue(value)
      );

      gateBagTimerRef.current =
        setTimeout(() => {
          if (
            isValidTag10(cleaned)
          ) {
            handleGateBagSubmit(
              cleaned
            );
          }
        }, 120);
    };

  const handleGateBagChange =
    (event) => {
      const value =
        event.target.value;

      setGateBagInput(value);

      if (!isFlightLoaded) {
        scheduleGateBagSubmit(
          value
        );
      }
    };

  const handleGateBagKeyDown =
    (event) => {
      if (
        event.key === "Enter" ||
        event.key === "Tab"
      ) {
        event.preventDefault();

        handleGateBagSubmit();
      }
    };

  const deleteGateBagScan =
    async (scan) => {
      const tag = onlyDigits(
        scan?.tag || scan?.id
      );

      if (!tag) return;

      if (!canDeleteGateBags) {
        setGateBagErr(
          "You don't have permission to delete Gate bag tags."
        );
        return;
      }

      if (isFlightLoaded) {
        setGateBagErr(
          "This flight is already LOADED. Gate bag tags are locked."
        );
        return;
      }

      if (
        loadedAircraftTagSet.has(
          tag
        )
      ) {
        setGateBagErr(
          `Bag tag ${tag} is already loaded on Aircraft and cannot be deleted from Gate. Offload it from Aircraft first.`
        );
        return;
      }

      const confirmed =
        window.confirm(
          `Delete Gate bag tag?\n\n` +
            `Bag Tag: ${tag}\n` +
            "Flow: Gate â Aircraft\n\n" +
            "This action cannot be undone."
        );

      if (!confirmed) return;

      try {
        setDeletingGateBagTag(
          tag
        );

        setGateBagErr("");
        setGateBagMsg("");

        await deleteDoc(
          doc(
            db,
            "flights",
            flightId,
            "gateBagScans",
            tag
          )
        );

        const aircraftSnap =
          await getDoc(
            doc(
              db,
              "flights",
              flightId,
              "aircraftScans",
              tag
            )
          );

        const counterSnap =
          await getDoc(
            doc(
              db,
              "flights",
              flightId,
              "counterScans",
              tag
            )
          );

        const bagroomSnap =
          await getDoc(
            doc(
              db,
              "flights",
              flightId,
              "bagroomScans",
              tag
            )
          );

        if (
          !aircraftSnap.exists() &&
          !counterSnap.exists() &&
          !bagroomSnap.exists()
        ) {
          await deleteDoc(
            doc(
              db,
              "bagTags",
              tag
            )
          );
        }

        setGateBagMsg(
          `Gate bag deleted â ${tag}`
        );
      } catch (error) {
        console.error(
          "Delete Gate bag error:",
          error
        );

        setGateBagErr(
          "Could not delete Gate bag. Check Firestore rules/connection."
        );
      } finally {
        setDeletingGateBagTag(
          ""
        );
      }
    };

  const onScanKeyDown =
    (event) => {
      if (
        event.key === "Enter"
      ) {
        event.preventDefault();

        saveScannedTagToManifest(
          scanInput
        );
      }
    };

  useEffect(() => {
    if (!canEdit) return;

    const raw = scanInput;

    if (!raw) return;

    if (debounceRef.current) {
      clearTimeout(
        debounceRef.current
      );
    }

    debounceRef.current =
      setTimeout(() => {
        const cleaned =
          onlyDigits(
            cleanTagValue(raw)
          );

        if (
          isValidTag10(
            cleaned
          )
        ) {
          saveScannedTagToManifest(
            cleaned
          );
        }
      }, 200);

    return () => {
      if (
        debounceRef.current
      ) {
        clearTimeout(
          debounceRef.current
        );
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanInput]);

  const title =
    "Gate Controller";

  return (
    <>
      <div
        style={{
          background: "white",
          border:
            "1px solid #e5e7eb",
          borderRadius: isMobile ? 8 : 12,
          padding: isMobile ? 10 : 16,
          fontSize: isMobile ? "14px" : "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection:
              isMobile ? "column" : "row",
            justifyContent:
              "space-between",
            alignItems:
              isMobile ? "stretch" : "end",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>
              {title}
            </h2>

            <p
              style={{
                margin: "6px 0 0",
                color: "#6b7280",
                fontSize: "0.9rem",
              }}
            >
              Verified counts,
              Gate-tagged bags,
              Bagroom match, and
              manifest for Ramp
              coordination.
            </p>

            {operationalContext?.operationalPositionLabel && (
              <div
                style={{
                  display: "inline-flex",
                  marginTop: 8,
                  padding: "5px 9px",
                  borderRadius: 999,
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  color: "#1d4ed8",
                  fontSize: "0.74rem",
                  fontWeight: 900,
                }}
              >
                Working as: {operationalContext.operationalPositionLabel}
              </div>
            )}
          </div>

          <div
            style={{
              textAlign:
                isMobile ? "left" : "right",
              fontSize: "0.9rem",
              minWidth: isMobile ? 0 : 260,
              width: isMobile ? "100%" : "auto",
            }}
          >
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                color: "#6b7280",
                marginBottom: 4,
              }}
            >
              Gate Controller on duty
            </label>

            <div
              style={{
                display: "flex",
                gap: 6,
              }}
            >
              <select
                value={
                  selectedGateController
                }
                onChange={(event) =>
                  setSelectedGateController(
                    event.target.value
                  )
                }
                disabled={!canEdit}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 8,
                  border:
                    "1px solid #d1d5db",
                  background: canEdit
                    ? "white"
                    : "#f3f4f6",
                }}
              >
                <option value="">
                  Select GCâ¦
                </option>

                {gateControllers.map(
                  (
                    gateController
                  ) => (
                    <option
                      key={
                        gateController.id
                      }
                      value={
                        gateController.username
                      }
                    >
                      {gateController.fullName
                        ? `${gateController.fullName} (${gateController.username})`
                        : gateController.username}
                    </option>
                  )
                )}
              </select>

              <button
                onClick={
                  saveGateControllerOnDuty
                }
                disabled={!canEdit}
                style={{
                  padding:
                    "6px 10px",
                  borderRadius: 8,
                  border:
                    "1px solid #2563eb",
                  background: canEdit
                    ? "#2563eb"
                    : "#93c5fd",
                  color: "white",
                  fontWeight: 700,
                  cursor: canEdit
                    ? "pointer"
                    : "not-allowed",
                }}
              >
                Save
              </button>
            </div>

            {gcMsg && (
              <div
                style={{
                  marginTop: 4,
                  fontSize:
                    "0.78rem",
                  color:
                    gcMsg.includes(
                      "â"
                    )
                      ? "#16a34a"
                      : "#b91c1c",
                }}
              >
                {gcMsg}
              </div>
            )}
          </div>
        </div>
                <hr
          style={{
            border: "none",
            borderTop:
              "1px solid #e5e7eb",
            margin: "14px 0",
          }}
        />

        {flightLoading ? (
          <p style={{ color: "#6b7280" }}>
            Loading flight...
          </p>
        ) : !flight ? (
          <p style={{ color: "#b91c1c" }}>
            Flight not found.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                isMobile
                  ? "repeat(2, minmax(0, 1fr))"
                  : "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <InfoCard
              label="Flight"
              value={
                flight.flightNumber || "-"
              }
            />

            <InfoCard
              label="Date"
              value={
                flight.flightDate || "-"
              }
            />

            <InfoCard
              label="Gate"
              value={flight.gate || "-"}
            />

            <InfoCard
              label="Aircraft"
              value={
                flight.aircraftType || "-"
              }
            />
          </div>
        )}

        <section
          style={{
            border:
              "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h3 style={{ margin: 0 }}>
                Flight Status
              </h3>

              <p
                style={{
                  margin: "6px 0 0",
                  color: "#6b7280",
                  fontSize: "0.9rem",
                }}
              >
                Open â Receiving â
                Loading â Loaded
              </p>
            </div>

            <span
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${statusStyle.border}`,
                background:
                  statusStyle.bg,
                color: statusStyle.text,
                fontWeight: 900,
                letterSpacing:
                  "0.04em",
              }}
            >
              {flightStatus ===
              "RECEIVING"
                ? "RECEIVING BAGS"
                : flightStatus}
            </span>
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              disabled={!canEdit}
              onClick={() =>
                updateFlightStatus(
                  "OPEN"
                )
              }
              style={btnStatus(canEdit)}
            >
              Open
            </button>

            <button
              disabled={!canEdit}
              onClick={() =>
                updateFlightStatus(
                  "RECEIVING"
                )
              }
              style={btnStatus(canEdit)}
            >
              Receiving
            </button>

            <button
              disabled={!canEdit}
              onClick={() =>
                updateFlightStatus(
                  "LOADING"
                )
              }
              style={btnStatus(canEdit)}
            >
              Loading
            </button>

            <button
              disabled={!canEdit}
              onClick={() =>
                updateFlightStatus(
                  "LOADED"
                )
              }
              style={btnStatus(canEdit)}
            >
              Loaded
            </button>
          </div>
        </section>

        <section
          style={{
            border:
              "1px solid #7c3aed",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
            background: "#f5f3ff",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "start",
            }}
          >
            <div>
              <h3
                style={{
                  margin: 0,
                  color: "#5b21b6",
                }}
              >
                Gate Bag Tag Scan
              </h3>

              <p
                style={{
                  margin: "6px 0 0",
                  color: "#6d28d9",
                  fontSize: "0.88rem",
                }}
              >
                Create or scan a bag
                tag at the boarding
                gate. This bag goes
                directly from Gate to
                Aircraft and does not
                pass through Counter
                or Bagroom.
              </p>
            </div>

            <span
              style={{
                display: "inline-flex",
                padding: "5px 10px",
                borderRadius: 999,
                border:
                  "1px solid #c4b5fd",
                background: "#ede9fe",
                color: "#5b21b6",
                fontSize: "0.78rem",
                fontWeight: 900,
              }}
            >
              GATE â AIRCRAFT
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            <InfoCard
              label="Gate Tagged"
              value={
                loadingGateBagScans
                  ? "â¦"
                  : gateBagScans.length
              }
            />

            <InfoCard
              label="Loaded on Aircraft"
              value={
                loadingGateBagScans ||
                aircraftLoading
                  ? "â¦"
                  : gateBagLoadedCount
              }
            />

            <InfoCard
              label="Pending Aircraft"
              value={
                loadingGateBagScans ||
                aircraftLoading
                  ? "â¦"
                  : gateBagPendingCount
              }
            />

            <InfoCard
              label="Aircraft Gate Bags"
              value={
                aircraftLoading
                  ? "â¦"
                  : aircraftBagTypeCounts.GATE_BAG
              }
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                isMobile
                  ? "1fr"
                  : "minmax(240px, 1fr) auto",
              gap: 8,
              marginTop: 12,
            }}
          >
            <input
              ref={gateBagInputRef}
              value={gateBagInput}
              onChange={
                handleGateBagChange
              }
              onKeyDown={
                handleGateBagKeyDown
              }
              disabled={
                !canEdit ||
                isFlightLoaded
              }
              placeholder={
                isFlightLoaded
                  ? "Flight loaded / locked"
                  : "Scan 10-digit Gate bag tagâ¦"
              }
              inputMode="numeric"
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 12,
                border:
                  "1px solid #c4b5fd",
                background:
                  !canEdit ||
                  isFlightLoaded
                    ? "#f3f4f6"
                    : "white",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              }}
            />

            <button
              onClick={() =>
                handleGateBagSubmit()
              }
              disabled={
                !canEdit ||
                isFlightLoaded
              }
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border:
                  "1px solid #7c3aed",
                background:
                  !canEdit ||
                  isFlightLoaded
                    ? "#c4b5fd"
                    : "#7c3aed",
                color: "white",
                fontWeight: 900,
                cursor:
                  !canEdit ||
                  isFlightLoaded
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Add Gate Bag
            </button>
          </div>

          {gateBagMsg && (
            <p
              style={{
                margin: "9px 0 0",
                color: "#16a34a",
                fontWeight: 800,
              }}
            >
              {gateBagMsg}
            </p>
          )}

          {gateBagErr && (
            <p
              style={{
                margin: "9px 0 0",
                color: "#b91c1c",
                fontWeight: 800,
                whiteSpace:
                  "pre-wrap",
              }}
            >
              {gateBagErr}
            </p>
          )}

          <div
            style={{
              marginTop: 12,
              maxHeight: 320,
              overflow: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {loadingGateBagScans ||
            aircraftLoading ? (
              <p
                style={{
                  color: "#6b7280",
                }}
              >
                Loading Gate bagsâ¦
              </p>
            ) : gateBagScans.length ===
              0 ? (
              <p
                style={{
                  color: "#6b7280",
                }}
              >
                No bags tagged at Gate
                yet.
              </p>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse:
                    "collapse",
                  background: "white",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background:
                        "#ede9fe",
                    }}
                  >
                    <th
                      style={tableHeader}
                    >
                      Bag Tag
                    </th>

                    <th
                      style={tableHeader}
                    >
                      Status
                    </th>

                    <th
                      style={tableHeader}
                    >
                      User
                    </th>

                    <th
                      style={{
                        ...tableHeader,
                        textAlign:
                          "right",
                      }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {gateBagScans.map(
                    (scan) => {
                      const tag =
                        onlyDigits(
                          scan.tag ||
                            scan.id
                        );

                      const loaded =
                        loadedAircraftTagSet.has(
                          tag
                        );

                      const busy =
                        deletingGateBagTag ===
                        tag;

                      return (
                        <tr
                          key={scan.id}
                          style={{
                            background:
                              loaded
                                ? "#f0fdf4"
                                : "#fef2f2",
                          }}
                        >
                          <td
                            style={
                              tableCell
                            }
                          >
                            <strong
                              style={{
                                color:
                                  loaded
                                    ? "#166534"
                                    : "#991b1b",
                              }}
                            >
                              {tag}
                            </strong>
                          </td>

                          <td
                            style={
                              tableCell
                            }
                          >
                            <span
                              style={{
                                display:
                                  "inline-flex",
                                padding:
                                  "4px 8px",
                                borderRadius:
                                  999,
                                border: `1px solid ${
                                  loaded
                                    ? "#86efac"
                                    : "#fca5a5"
                                }`,
                                background:
                                  loaded
                                    ? "#dcfce7"
                                    : "#fee2e2",
                                color:
                                  loaded
                                    ? "#166534"
                                    : "#991b1b",
                                fontSize:
                                  "0.75rem",
                                fontWeight:
                                  900,
                              }}
                            >
                              {loaded
                                ? "LOADED"
                                : "PENDING"}
                            </span>
                          </td>

                          <td
                            style={{
                              ...tableCell,
                              color:
                                "#6b7280",
                            }}
                          >
                            {scan.scannedBy
                              ?.fullName ||
                              scan.scannedBy
                                ?.employeeFullName ||
                              scan.employeeFullName ||
                              scan.scannedBy
                                ?.username ||
                              "-"}
                          </td>

                          <td
                            style={{
                              ...tableCell,
                              textAlign:
                                "right",
                            }}
                          >
                            {canDeleteGateBags && (
                              <button
                                onClick={() =>
                                  deleteGateBagScan(
                                    scan
                                  )
                                }
                                disabled={
                                  busy ||
                                  loaded ||
                                  isFlightLoaded
                                }
                                title={
                                  loaded
                                    ? "Already loaded on Aircraft"
                                    : "Delete Gate bag"
                                }
                                style={{
                                  padding:
                                    "5px 9px",
                                  borderRadius:
                                    999,
                                  border:
                                    "1px solid #ef4444",
                                  background:
                                    busy ||
                                    loaded ||
                                    isFlightLoaded
                                      ? "#fca5a5"
                                      : "#ef4444",
                                  color:
                                    "white",
                                  fontWeight:
                                    800,
                                  cursor:
                                    busy ||
                                    loaded ||
                                    isFlightLoaded
                                      ? "not-allowed"
                                      : "pointer",
                                  opacity:
                                    busy ||
                                    loaded
                                      ? 0.7
                                      : 1,
                                }}
                              >
                                {busy
                                  ? "Deletingâ¦"
                                  : loaded
                                    ? "Loaded"
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
            )}
          </div>
        </section>

        <section
          style={{
            border:
              "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
            background: "#f9fafb",
          }}
        >
          <h3 style={{ margin: 0 }}>
            Aircraft Loading
          </h3>

          <div
            style={aircraftStatusBox(
              missing
            )}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontSize: "2rem",
                }}
              >
                {checkedBagsTotal ===
                null
                  ? "â¹ï¸"
                  : missing === 0
                    ? "â"
                    : missing <= 3
                      ? "â ï¸"
                      : "â"}
              </div>

              <div>
                <div
                  style={{
                    fontSize:
                      "1.05rem",
                    fontWeight: 900,
                  }}
                >
                  {checkedBagsTotal ===
                  null
                    ? "Gate total pending"
                    : missing === 0
                      ? "All bags accounted for"
                      : `${missing} bag${
                          missing === 1
                            ? ""
                            : "s"
                        } missing to load`}
                </div>

                <div
                  style={{
                    fontSize:
                      "0.85rem",
                    marginTop: 3,
                  }}
                >
                  {checkedBagsTotal ===
                  null
                    ? "Enter Gate total to calculate missing bags."
                    : missing === 0
                      ? "All expected bags have been loaded."
                      : missing <= 3
                        ? "Almost complete. Verify the remaining bags."
                        : "Attention required. Several bags are still missing."}
                </div>
              </div>
            </div>

            <div
              style={{
                textAlign: "right",
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 700,
                }}
              >
                Total loaded
              </div>

              <div
                style={{
                  fontSize: "1.6rem",
                  fontWeight: 900,
                }}
              >
                {aircraftLoading
                  ? "â¦"
                  : aircraftTotal}
              </div>

              <div
                style={{
                  fontSize: "0.8rem",
                }}
              >
                of{" "}
                {checkedBagsTotal ===
                null
                  ? "â"
                  : checkedBagsTotal}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            <InfoCard
              label="Zone 1"
              value={
                aircraftLoading
                  ? "â¦"
                  : zones[1]
              }
            />

            <InfoCard
              label="Zone 2"
              value={
                aircraftLoading
                  ? "â¦"
                  : zones[2]
              }
            />

            <InfoCard
              label="Zone 3"
              value={
                aircraftLoading
                  ? "â¦"
                  : zones[3]
              }
            />

            <InfoCard
              label="Zone 4"
              value={
                aircraftLoading
                  ? "â¦"
                  : zones[4]
              }
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            <InfoCard
              label="Checked Bags Loaded"
              value={
                aircraftLoading
                  ? "â¦"
                  : aircraftBagTypeCounts.CHECKED_BAG
              }
            />

            <InfoCard
              label="Gate Checks Loaded"
              value={
                aircraftLoading
                  ? "â¦"
                  : aircraftBagTypeCounts.GATE_CHECK
              }
            />

            <InfoCard
              label="Oversize Loaded"
              value={
                aircraftLoading
                  ? "â¦"
                  : aircraftBagTypeCounts.OVERSIZE
              }
            />

            <InfoCard
              label="Gate Tagged Loaded"
              value={
                aircraftLoading
                  ? "â¦"
                  : aircraftBagTypeCounts.GATE_BAG
              }
            />
          </div>
        </section>

        <section
          style={{
            border:
              "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
            background: "#f9fafb",
          }}
        >
          <h3 style={{ margin: 0 }}>
            Bagroom Manifest Match
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            <InfoCard
              label="Manifest Tags"
              value={
                loadingAllowed
                  ? "â¦"
                  : allManifestTags.length
              }
            />

            <InfoCard
              label="Bagroom Scanned"
              value={
                loadingBagroomScans
                  ? "â¦"
                  : bagroomScans.length
              }
            />

            <InfoCard
              label="Matched Manifest"
              value={
                loadingAllowed ||
                loadingBagroomScans
                  ? "â¦"
                  : bagroomMatchedTags.length
              }
            />

            <InfoCard
              label="Not in Manifest"
              value={
                loadingAllowed ||
                loadingBagroomScans
                  ? "â¦"
                  : bagroomNotInManifest.length
              }
            />
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() =>
                setActiveBagroomTab(
                  "summary"
                )
              }
              style={tabBtn(
                activeBagroomTab ===
                  "summary"
              )}
            >
              By Cart
            </button>

            <button
              onClick={() =>
                setActiveBagroomTab(
                  "matched"
                )
              }
              style={tabBtn(
                activeBagroomTab ===
                  "matched"
              )}
            >
              Matched (
              {bagroomMatchedTags.length})
            </button>

            <button
              onClick={() =>
                setActiveBagroomTab(
                  "notManifest"
                )
              }
              style={tabBtn(
                activeBagroomTab ===
                  "notManifest"
              )}
            >
              Not in Manifest (
              {
                bagroomNotInManifest.length
              }
              )
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            {loadingBagroomScans ? (
              <p
                style={{
                  color: "#6b7280",
                }}
              >
                Loading Bagroom scansâ¦
              </p>
            ) : bagroomScans.length ===
              0 ? (
              <p
                style={{
                  color: "#6b7280",
                }}
              >
                No Bagroom scans yet.
              </p>
            ) : activeBagroomTab ===
              "summary" ? (
              <div
                style={{
                  display: "grid",
                  gap: 12,
                }}
              >
                {Object.keys(
                  bagroomByCart
                )
                  .sort((a, b) =>
                    String(
                      a
                    ).localeCompare(
                      String(b),
                      undefined,
                      {
                        numeric: true,
                      }
                    )
                  )
                  .map((cart) => {
                    const rows =
                      bagroomByCart[
                        cart
                      ];

                    const matched =
                      rows.filter(
                        (scan) =>
                          manifestTagSet.has(
                            onlyDigits(
                              scan.tag ||
                                scan.id
                            )
                          )
                      );

                    return (
                      <div
                        key={cart}
                        style={{
                          border:
                            "1px solid #e5e7eb",
                          borderRadius:
                            12,
                          background:
                            "white",
                          padding: 10,
                        }}
                      >
                        <div
                          style={{
                            display:
                              "flex",
                            justifyContent:
                              "space-between",
                            gap: 10,
                            fontWeight:
                              900,
                          }}
                        >
                          <span>
                            Cart {cart}
                          </span>

                          <span>
                            {
                              matched.length
                            }
                            /{rows.length}{" "}
                            matched
                          </span>
                        </div>

                        <div
                          style={{
                            marginTop: 8,
                            display:
                              "flex",
                            flexWrap:
                              "wrap",
                            gap: 6,
                          }}
                        >
                          {rows.map(
                            (scan) => {
                              const tag =
                                onlyDigits(
                                  scan.tag ||
                                    scan.id
                                );

                              const matchedManifest =
                                manifestTagSet.has(
                                  tag
                                );

                              return (
                                <span
                                  key={
                                    scan.id
                                  }
                                  style={{
                                    ...tagPill,
                                    background:
                                      matchedManifest
                                        ? "#DCFCE7"
                                        : "#FEF2F2",
                                    color:
                                      matchedManifest
                                        ? "#166534"
                                        : "#991B1B",
                                  }}
                                >
                                  {tag ||
                                    scan.tag}
                                </span>
                              );
                            }
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : activeBagroomTab ===
              "matched" ? (
              bagroomMatchedTags.length ===
              0 ? (
                <p
                  style={{
                    color: "#6b7280",
                  }}
                >
                  No matched Bagroom
                  tags yet.
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  {bagroomMatchedTags.map(
                    (tag) => (
                      <span
                        key={tag}
                        style={{
                          ...tagPill,
                          background:
                            "#DCFCE7",
                          color:
                            "#166534",
                        }}
                      >
                        {tag}
                      </span>
                    )
                  )}
                </div>
              )
            ) : bagroomNotInManifest.length ===
              0 ? (
              <p
                style={{
                  color: "#16a34a",
                  fontWeight: 800,
                }}
              >
                All Bagroom scans are
                in the manifest â
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {bagroomNotInManifest.map(
                  (scan) => (
                    <span
                      key={scan.id}
                      style={{
                        ...tagPill,
                        background:
                          "#FEF2F2",
                        color:
                          "#991B1B",
                      }}
                    >
                      {scan.cleanTag} Â·
                      Cart{" "}
                      {scan.cartNumber ||
                        "-"}
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        </section>

        <section
          style={{
            border:
              missingTrackerEnabled
                ? "2px solid #f59e0b"
                : "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
            background:
              missingTrackerEnabled
                ? "#fffbeb"
                : "#f9fafb",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "start",
            }}
          >
            <div>
              <h3 style={{ margin: 0 }}>
                Manifest Loading Status
              </h3>

              {missingTrackerEnabled && (
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "#92400e",
                    fontSize:
                      "0.86rem",
                    fontWeight: 800,
                  }}
                >
                  â ï¸ Final bag search
                  activated. Click a
                  missing bag tag to
                  view its last scanned
                  location.
                </p>
              )}
            </div>

            {missingTrackerEnabled && (
              <span
                style={{
                  display:
                    "inline-flex",
                  alignItems: "center",
                  padding: "5px 10px",
                  borderRadius: 999,
                  border:
                    "1px solid #f59e0b",
                  background:
                    "#fef3c7",
                  color: "#92400e",
                  fontSize:
                    "0.76rem",
                  fontWeight: 900,
                }}
              >
                BAG TRACKER ACTIVE
              </span>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            <InfoCard
              label="Manifest Tags"
              value={
                loadingAllowed
                  ? "â¦"
                  : allManifestTags.length
              }
            />

            <InfoCard
              label="Aircraft Loaded"
              value={
                aircraftLoading
                  ? "â¦"
                  : loadedAircraftTags.length
              }
            />

            <InfoCard
              label="Missing to Load"
              value={
                loadingAllowed ||
                aircraftLoading
                  ? "â¦"
                  : missingManifestTags.length
              }
            />
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() =>
                setActiveManifestTab(
                  "recent"
                )
              }
              style={tabBtn(
                activeManifestTab ===
                  "recent"
              )}
            >
              Manifest Tags
            </button>

            <button
              onClick={() =>
                setActiveManifestTab(
                  "missing"
                )
              }
              style={tabBtn(
                activeManifestTab ===
                  "missing"
              )}
            >
              Missing to Load (
              {
                missingManifestTags.length
              }
              )
            </button>
          </div>

          <div
            style={{
              marginTop: 12,
              maxHeight: 300,
              overflow: "auto",
            }}
          >
            {activeManifestTab ===
            "recent" ? (
              loadingAllowed ? (
                <p
                  style={{
                    color: "#6b7280",
                  }}
                >
                  Loading manifestâ¦
                </p>
              ) : recentAllowed.length ===
                0 ? (
                <p
                  style={{
                    color: "#6b7280",
                  }}
                >
                  No manifest tags
                  uploaded yet.
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  {recentAllowed.map(
                    (row) => {
                      const tag =
                        row.tag ||
                        row.id;

                      const busy =
                        deletingTag ===
                        tag;

                      return (
                        <span
                          key={row.id}
                          style={tagPill}
                        >
                          {tag}

                          {canEdit && (
                            <button
                              onClick={() =>
                                deleteAllowedTag(
                                  tag
                                )
                              }
                              disabled={
                                busy
                              }
                              title="Delete tag"
                              style={{
                                border:
                                  "none",
                                background:
                                  "transparent",
                                cursor:
                                  busy
                                    ? "not-allowed"
                                    : "pointer",
                                fontWeight:
                                  900,
                                color:
                                  "#b91c1c",
                                opacity:
                                  busy
                                    ? 0.6
                                    : 1,
                              }}
                            >
                              {busy
                                ? "â¦"
                                : "â"}
                            </button>
                          )}
                        </span>
                      );
                    }
                  )}
                </div>
              )
            ) : loadingAllowed ||
              aircraftLoading ? (
              <p
                style={{
                  color: "#6b7280",
                }}
              >
                Loading missing tagsâ¦
              </p>
            ) : missingManifestTags.length ===
              0 ? (
              <p
                style={{
                  color: "#16a34a",
                  fontWeight: 800,
                }}
              >
                All manifest tags are
                loaded â
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                {missingManifestTags.map(
                  (tag) =>
                    missingTrackerEnabled ? (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          openBagTracker(
                            tag
                          )
                        }
                        title={`View last scanned location for ${tag}`}
                        style={{
                          ...tagPill,
                          background:
                            "#fee2e2",
                          color:
                            "#991b1b",
                          border:
                            "1px solid #f87171",
                          cursor:
                            "pointer",
                          fontWeight: 900,
                          boxShadow:
                            "0 1px 2px rgba(0, 0, 0, 0.08)",
                        }}
                      >
                        <span>
                          ð
                        </span>

                        <span>
                          {tag}
                        </span>

                        <span
                          style={{
                            fontSize:
                              "0.72rem",
                            color:
                              "#b91c1c",
                          }}
                        >
                          View location
                        </span>
                      </button>
                    ) : (
                      <span
                        key={tag}
                        style={{
                          ...tagPill,
                          background:
                            "#FEF2F2",
                          color:
                            "#991B1B",
                        }}
                        title="Bag Tracker becomes available when 5 or fewer bags remain."
                      >
                        {tag}
                      </span>
                    )
                )}
              </div>
            )}
          </div>
        </section>
                <section
          style={{
            border:
              "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            background: "#f9fafb",
            marginBottom: 14,
          }}
        >
          <h3 style={{ margin: 0 }}>
            Checked Bags Total
          </h3>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 12,
            }}
          >
            <input
              type="number"
              min="0"
              value={checkedTotalInput}
              onChange={(event) =>
                setCheckedTotalInput(
                  event.target.value
                )
              }
              placeholder="0"
              disabled={!canEdit}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 12,
                border:
                  "1px solid #d1d5db",
                background: canEdit
                  ? "white"
                  : "#f3f4f6",
              }}
            />

            <button
              onClick={saveTotal}
              disabled={!canEdit || saving}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border:
                  "1px solid #1d4ed8",
                background:
                  !canEdit || saving
                    ? "#93c5fd"
                    : "#2563eb",
                color: "white",
                fontWeight: 700,
                minWidth: 90,
                cursor:
                  !canEdit || saving
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {saving
                ? "Saving..."
                : "Save"}
            </button>
          </div>

          {saveMsg && (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "0.85rem",
                color: saveMsg.includes(
                  "â"
                )
                  ? "#16a34a"
                  : "#b91c1c",
              }}
            >
              {saveMsg}
            </p>
          )}
        </section>

        <section
          style={{
            border:
              "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>
            Flight Bag Tag Manifest
            (Import)
          </h3>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <input
              type="file"
              accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf"
              disabled={!canEdit}
              onChange={(event) => {
                const file =
                  event.target.files?.[0];

                if (file) {
                  handleFilePick(file);
                }
              }}
            />

            <button
              disabled={!canEdit}
              onClick={() =>
                updateStrictManifest(
                  !strictManifest
                )
              }
              style={btnStatus(canEdit)}
            >
              Strict Manifest:{" "}
              {strictManifest
                ? "ON"
                : "OFF"}
            </button>
          </div>

          <textarea
            value={manifestText}
            onChange={(event) =>
              setManifestText(
                event.target.value
              )
            }
            disabled={!canEdit}
            rows={6}
            placeholder="Paste manifest text here..."
            style={{
              marginTop: 12,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border:
                "1px solid #d1d5db",
              background: canEdit
                ? "white"
                : "#f3f4f6",
            }}
          />

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() =>
                previewFromText(
                  manifestText
                )
              }
              disabled={!canEdit}
              style={btnStatus(canEdit)}
            >
              Preview Tags
            </button>

            <button
              onClick={importManifest}
              disabled={
                !canEdit ||
                importing ||
                manifestTagsPreview.length ===
                  0
              }
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border:
                  "1px solid #1d4ed8",
                background:
                  !canEdit ||
                  importing ||
                  manifestTagsPreview.length ===
                    0
                    ? "#93c5fd"
                    : "#2563eb",
                color: "white",
                fontWeight: 800,
                cursor:
                  !canEdit ||
                  importing ||
                  manifestTagsPreview.length ===
                    0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {importing
                ? "Importing..."
                : "Import to Flight"}
            </button>
          </div>

          {manifestTagsPreview.length >
            0 && (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                maxHeight: 180,
                overflow: "auto",
              }}
            >
              {manifestTagsPreview.map(
                (tag) => (
                  <span
                    key={tag}
                    style={tagPill}
                  >
                    {tag}

                    <button
                      type="button"
                      onClick={() =>
                        removeFromPreview(
                          tag
                        )
                      }
                      disabled={!canEdit}
                      title="Remove from preview"
                      style={{
                        border: "none",
                        background:
                          "transparent",
                        color: "#b91c1c",
                        cursor: canEdit
                          ? "pointer"
                          : "not-allowed",
                        fontWeight: 900,
                      }}
                    >
                      â
                    </button>
                  </span>
                )
              )}
            </div>
          )}

          {manifestMsg && (
            <p
              style={{
                color: "#16a34a",
                whiteSpace: "pre-wrap",
              }}
            >
              {manifestMsg}
            </p>
          )}

          {manifestErr && (
            <p
              style={{
                color: "#b91c1c",
                whiteSpace: "pre-wrap",
              }}
            >
              {manifestErr}
            </p>
          )}
        </section>
      </div>

      {trackerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Bag tracker ${trackerTag}`}
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeBagTracker();
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background:
              "rgba(17, 24, 39, 0.66)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              maxHeight: "90vh",
              overflowY: "auto",
              borderRadius: 18,
              background: "white",
              border:
                "1px solid #e5e7eb",
              boxShadow:
                "0 25px 50px rgba(0, 0, 0, 0.28)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems: "center",
                gap: 12,
                padding: "16px 18px",
                borderBottom:
                  "1px solid #e5e7eb",
                background: "#111827",
                color: "white",
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "0.76rem",
                    textTransform:
                      "uppercase",
                    letterSpacing:
                      "0.08em",
                    color: "#d1d5db",
                    fontWeight: 800,
                  }}
                >
                  Last Bag Location
                </div>

                <div
                  style={{
                    marginTop: 3,
                    fontSize: "1.2rem",
                    fontWeight: 900,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  }}
                >
                  {trackerTag}
                </div>
              </div>

              <button
                type="button"
                onClick={
                  closeBagTracker
                }
                aria-label="Close bag tracker"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  border:
                    "1px solid #4b5563",
                  background: "#374151",
                  color: "white",
                  fontSize: "1.1rem",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                â
              </button>
            </div>

            <div
              style={{
                padding: 18,
              }}
            >
              {trackerLoading ? (
                <div
                  style={{
                    minHeight: 180,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent:
                      "center",
                    gap: 10,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: "2rem",
                    }}
                  >
                    ð
                  </div>

                  <div
                    style={{
                      fontWeight: 900,
                      color: "#111827",
                    }}
                  >
                    Searching baggage
                    history...
                  </div>

                  <div
                    style={{
                      color: "#6b7280",
                      fontSize: "0.88rem",
                    }}
                  >
                    Checking the latest
                    tracker event and
                    current flight scans.
                  </div>
                </div>
              ) : trackerError &&
                !trackerData?.found ? (
                <div
                  style={{
                    border:
                      "1px solid #fca5a5",
                    background: "#fef2f2",
                    color: "#991b1b",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 900,
                    }}
                  >
                    No location found
                  </div>

                  <div
                    style={{
                      marginTop: 5,
                      fontSize: "0.88rem",
                      lineHeight: 1.5,
                    }}
                  >
                    {trackerError}
                  </div>
                </div>
              ) : trackerData?.found ? (
                <>
                  <div
                    style={{
                      border: `1px solid ${getTrackerLocationStyle(
                        trackerData.location
                      ).border}`,
                      background:
                        getTrackerLocationStyle(
                          trackerData.location
                        ).background,
                      color:
                        getTrackerLocationStyle(
                          trackerData.location
                        ).color,
                      borderRadius: 14,
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 900,
                        textTransform:
                          "uppercase",
                        letterSpacing:
                          "0.06em",
                      }}
                    >
                      Last Known Location
                    </div>

                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        alignItems:
                          "center",
                        gap: 10,
                        fontSize: "1.35rem",
                        fontWeight: 900,
                      }}
                    >
                      <span>
                        {getTrackerLocationStyle(
                          trackerData.location
                        ).icon}
                      </span>

                      <span>
                        {
                          trackerData.locationLabel
                        }
                      </span>
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                        fontSize: "0.88rem",
                        fontWeight: 700,
                      }}
                    >
                      {
                        trackerData.eventLabel
                      }
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 10,
                      marginTop: 14,
                    }}
                  >
                    <TrackerInfoCard
                      label="Last Scan"
                      value={
                        trackerData.formattedTime
                      }
                    />

                    <TrackerInfoCard
                      label="Employee"
                      value={
                        trackerData.userName
                      }
                    />

                    <TrackerInfoCard
                      label="Flight"
                      value={
                        trackerData.flightNumber ||
                        "-"
                      }
                    />

                    <TrackerInfoCard
                      label="Flight Date"
                      value={
                        trackerData.flightDate ||
                        "-"
                      }
                    />

                    <TrackerInfoCard
                      label="Gate"
                      value={
                        trackerData.gate ||
                        "-"
                      }
                    />

                    <TrackerInfoCard
                      label="Bag Type"
                      value={
                        trackerData.bagTypeLabel ||
                        "-"
                      }
                    />

                    {trackerData.cartNumber && (
                      <TrackerInfoCard
                        label="Cart"
                        value={
                          trackerData.cartNumber
                        }
                      />
                    )}

                    {trackerData.zone && (
                      <TrackerInfoCard
                        label="Aircraft Zone"
                        value={
                          trackerData.zone
                        }
                      />
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      padding: 12,
                      borderRadius: 12,
                      border:
                        "1px solid #dbeafe",
                      background: "#eff6ff",
                      color: "#1e3a8a",
                    }}
                  >
                    <div
                      style={{
                        fontSize:
                          "0.75rem",
                        fontWeight: 900,
                        textTransform:
                          "uppercase",
                        letterSpacing:
                          "0.05em",
                      }}
                    >
                      Tracking Source
                    </div>

                    <div
                      style={{
                        marginTop: 4,
                        fontWeight: 800,
                      }}
                    >
                      {
                        trackerData.sourceName
                      }
                    </div>
                  </div>

                  {trackerError && (
                    <div
                      style={{
                        marginTop: 12,
                        color: "#92400e",
                        background:
                          "#fffbeb",
                        border:
                          "1px solid #fcd34d",
                        borderRadius: 10,
                        padding: 10,
                        fontSize:
                          "0.82rem",
                      }}
                    >
                      {trackerError}
                    </div>
                  )}
                </>
              ) : (
                <div
                  style={{
                    color: "#6b7280",
                    textAlign: "center",
                    padding: 20,
                  }}
                >
                  No tracking information
                  available.
                </div>
              )}

              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  justifyContent:
                    "flex-end",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    openBagTracker(
                      trackerTag
                    )
                  }
                  disabled={
                    trackerLoading
                  }
                  style={{
                    padding: "9px 12px",
                    borderRadius: 10,
                    border:
                      "1px solid #2563eb",
                    background:
                      trackerLoading
                        ? "#bfdbfe"
                        : "#2563eb",
                    color: "white",
                    fontWeight: 800,
                    cursor:
                      trackerLoading
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Refresh Location
                </button>

                <button
                  type="button"
                  onClick={
                    closeBagTracker
                  }
                  style={{
                    padding: "9px 12px",
                    borderRadius: 10,
                    border:
                      "1px solid #d1d5db",
                    background: "white",
                    color: "#111827",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function btnStatus(canEdit) {
  return {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: canEdit
      ? "white"
      : "#f3f4f6",
    cursor: canEdit
      ? "pointer"
      : "not-allowed",
    fontWeight: 700,
  };
}

function tabBtn(active) {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    border: active
      ? "1px solid #111827"
      : "1px solid #d1d5db",
    background: active
      ? "#111827"
      : "white",
    color: active
      ? "white"
      : "#111827",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "0.82rem",
  };
}

function aircraftStatusBox(missing) {
  if (missing === null) {
    return baseAircraftBox(
      "#d1d5db",
      "#f9fafb",
      "#374151"
    );
  }

  if (missing === 0) {
    return baseAircraftBox(
      "#22c55e",
      "#dcfce7",
      "#166534"
    );
  }

  if (missing <= 3) {
    return baseAircraftBox(
      "#f59e0b",
      "#fef3c7",
      "#92400e"
    );
  }

  return baseAircraftBox(
    "#ef4444",
    "#fee2e2",
    "#991b1b"
  );
}

function baseAircraftBox(
  border,
  background,
  color
) {
  return {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${border}`,
    background,
    color,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  };
}

/*
 * Color and icon used by the tracking modal
 * based on the last known baggage location.
 */
function getTrackerLocationStyle(
  locationValue
) {
  const location = String(
    locationValue || ""
  )
    .trim()
    .toLowerCase();

  if (
    location === "aircraft" ||
    location === "aircraft_hold" ||
    location === "hold" ||
    location === "loaded"
  ) {
    return {
      border: "#22c55e",
      background: "#dcfce7",
      color: "#166534",
      icon: "âï¸",
    };
  }

  if (
    location === "gate" ||
    location === "jetbridge" ||
    location === "ramp"
  ) {
    return {
      border: "#eab308",
      background: "#fef9c3",
      color: "#854d0e",
      icon: "ðª",
    };
  }

  if (
    location === "bagroom" ||
    location === "bag_room" ||
    location === "baggage_room" ||
    location === "makeup" ||
    location === "makeup_area"
  ) {
    return {
      border: "#3b82f6",
      background: "#dbeafe",
      color: "#1e3a8a",
      icon: "ð",
    };
  }

  if (
    location === "tsa" ||
    location === "security"
  ) {
    return {
      border: "#8b5cf6",
      background: "#ede9fe",
      color: "#5b21b6",
      icon: "ð",
    };
  }

  if (
    location === "counter" ||
    location === "ticket_counter" ||
    location === "checkin" ||
    location === "check_in"
  ) {
    return {
      border: "#f97316",
      background: "#ffedd5",
      color: "#9a3412",
      icon: "ð«",
    };
  }

  if (
    location === "oversize" ||
    location === "oversize_belt"
  ) {
    return {
      border: "#ec4899",
      background: "#fce7f3",
      color: "#9d174d",
      icon: "ð¦",
    };
  }

  if (
    location === "customs" ||
    location === "cbp"
  ) {
    return {
      border: "#0f766e",
      background: "#ccfbf1",
      color: "#115e59",
      icon: "ð",
    };
  }

  if (location === "transfer") {
    return {
      border: "#06b6d4",
      background: "#cffafe",
      color: "#155e75",
      icon: "ð",
    };
  }

  if (location === "offloaded") {
    return {
      border: "#ef4444",
      background: "#fee2e2",
      color: "#991b1b",
      icon: "â¬ï¸",
    };
  }

  return {
    border: "#9ca3af",
    background: "#f3f4f6",
    color: "#374151",
    icon: "ð",
  };
}

const tagPill = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  fontSize: "0.82rem",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

const tableHeader = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom:
    "1px solid #ddd6fe",
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#5b21b6",
  whiteSpace: "nowrap",
};

const tableCell = {
  padding: "10px 8px",
  borderBottom:
    "1px solid #f3f4f6",
  color: "#111827",
  verticalAlign: "middle",
};

function InfoCard({ label, value }) {
  return (
    <div
      style={{
        border:
          "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 10,
        background: "white",
      }}
    >
      <div
        style={{
          fontSize: "0.8rem",
          color: "#6b7280",
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: "1.1rem",
          fontWeight: 800,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TrackerInfoCard({
  label,
  value,
}) {
  return (
    <div
      style={{
        border:
          "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 11,
        background: "#f9fafb",
      }}
    >
      <div
        style={{
          fontSize: "0.73rem",
          color: "#6b7280",
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 4,
          color: "#111827",
          fontSize: "0.92rem",
          fontWeight: 800,
          overflowWrap: "anywhere",
        }}
      >
        {value || "-"}
      </div>
    </div>
  );
}

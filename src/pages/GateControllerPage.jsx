// src/pages/GateControllerPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
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
  const value = String(status || "OPEN").trim().toUpperCase();

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

  if (type === "GATE_CHECK") return "Gate Check";
  if (type === "OVERSIZE") return "Oversize";
  if (type === "GATE_BAG") return "Bag Tagged at Gate";

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

function extractBagTagsFromText(text, { exactLen = 10 } = {}) {
  const source = String(text || "");
  const matches = source.match(/\d+/g) || [];

  const tags = matches
    .map((value) => value.trim())
    .filter((value) => value.length === exactLen);

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

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const strings = content.items.map((item) => item.str);

    fullText += `${strings.join(" ")}\n`;
  }

  return fullText;
}

async function uploadPdfForOcr({
  file,
  flightId,
  user,
}) {
  const safeName = String(file.name || "manifest.pdf")
    .replaceAll(" ", "_");

  const path =
    `flights/${flightId}/manifests/` +
    `${Date.now()}_${safeName}`;

  const fileRef = storageRef(storage, path);

  await uploadBytes(fileRef, file, {
    contentType: "application/pdf",
    customMetadata: {
      flightId: String(flightId),
      uploadedBy: String(user?.username || ""),
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
  gateControllerOnDuty,
  canEdit,
}) {
  const role = useMemo(
    () => normalizeRole(user?.role),
    [user]
  );

  const canDeleteGateBags =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "supervisor" ||
    role === "gate_controller";

  const [gateControllers, setGateControllers] = useState([]);

  const [selectedGateController, setSelectedGateController] =
    useState(
      gateControllerOnDuty ||
        localStorage.getItem("gateControllerOnDuty") ||
        ""
    );

  const [gcMsg, setGcMsg] = useState("");

  const [flight, setFlight] = useState(null);
  const [flightLoading, setFlightLoading] = useState(true);

  const [checkedTotalInput, setCheckedTotalInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [aircraftTotal, setAircraftTotal] = useState(0);

  const [zones, setZones] = useState({
    1: 0,
    2: 0,
    3: 0,
    4: 0,
  });

  const [aircraftLoading, setAircraftLoading] = useState(true);
  const [aircraftScans, setAircraftScans] = useState([]);
  const [loadedAircraftTags, setLoadedAircraftTags] = useState([]);

  const [bagroomScans, setBagroomScans] = useState([]);
  const [loadingBagroomScans, setLoadingBagroomScans] =
    useState(true);

  const [activeBagroomTab, setActiveBagroomTab] =
    useState("summary");

  const [manifestText, setManifestText] = useState("");
  const [manifestTagsPreview, setManifestTagsPreview] =
    useState([]);

  const [manifestMsg, setManifestMsg] = useState("");
  const [manifestErr, setManifestErr] = useState("");
  const [importing, setImporting] = useState(false);

  const [strictManifest, setStrictManifest] = useState(false);

  const [scanInput, setScanInput] = useState("");
  const scanRef = useRef(null);

  const [scanMsg, setScanMsg] = useState("");
  const [scanErr, setScanErr] = useState("");
  const [savingScan, setSavingScan] = useState(false);

  const [allowedCount, setAllowedCount] = useState(0);
  const [recentAllowed, setRecentAllowed] = useState([]);
  const [allManifestTags, setAllManifestTags] = useState([]);
  const [loadingAllowed, setLoadingAllowed] = useState(true);
  const [deletingTag, setDeletingTag] = useState("");

  const [activeManifestTab, setActiveManifestTab] =
    useState("recent");

  // Gate-tagged bags: direct Gate → Aircraft.
  const [gateBagInput, setGateBagInput] = useState("");
  const gateBagInputRef = useRef(null);
  const gateBagTimerRef = useRef(null);
  const gateBagSavingRef = useRef(false);

  const [gateBagScans, setGateBagScans] = useState([]);
  const [loadingGateBagScans, setLoadingGateBagScans] =
    useState(true);

  const [gateBagMsg, setGateBagMsg] = useState("");
  const [gateBagErr, setGateBagErr] = useState("");
  const [deletingGateBagTag, setDeletingGateBagTag] =
    useState("");

  const debounceRef = useRef(null);

  const isFlightLoaded =
    Boolean(flight?.aircraftLoadingCompleted) ||
    normalizeStatus(flight?.status) === "LOADED";

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
        .filter((tag) => isValidTag10(tag))
    );
  }, [aircraftScans]);

  const gateBagLoadedCount = useMemo(() => {
    return gateBagScans.filter((scan) => {
      const tag = onlyDigits(scan.tag || scan.id);

      return loadedAircraftTagSet.has(tag);
    }).length;
  }, [gateBagScans, loadedAircraftTagSet]);

  const gateBagPendingCount = Math.max(
    0,
    gateBagScans.length - gateBagLoadedCount
  );

  const aircraftBagTypeCounts = useMemo(() => {
    const counts = {
      CHECKED_BAG: 0,
      GATE_CHECK: 0,
      OVERSIZE: 0,
      GATE_BAG: 0,
    };

    for (const scan of aircraftScans) {
      const type = normalizeBagType(scan.bagType);
      counts[type] += 1;
    }

    return counts;
  }, [aircraftScans]);
    useEffect(() => {
    const loadGateControllers = async () => {
      try {
        const qGC = query(
          collection(db, "users"),
          where("role", "==", "gate_controller")
        );

        const snap = await getDocs(qGC);

        const list = snap.docs
          .map((document) => ({
            id: document.id,
            ...document.data(),
          }))
          .filter((gateController) => gateController.username);

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

    const flightRef = doc(db, "flights", flightId);

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

        if (typeof data.checkedBagsTotal === "number") {
          setCheckedTotalInput(
            String(data.checkedBagsTotal)
          );
        } else {
          setCheckedTotalInput("");
        }

        if (typeof data.strictManifest === "boolean") {
          setStrictManifest(data.strictManifest);
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

        const rows = snap.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        const tags = rows
          .map((row) => onlyDigits(row.tag || row.id))
          .filter((tag) => isValidTag10(tag));

        setAllManifestTags(tags);
        setRecentAllowed(rows.slice(0, 60));
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
        const rows = snap.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        rows.sort((a, b) => {
          const timeA = a.createdAt?.seconds || 0;
          const timeB = b.createdAt?.seconds || 0;

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
        const rows = snap.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        rows.sort((a, b) => {
          const timeA = a.createdAt?.seconds || 0;
          const timeB = b.createdAt?.seconds || 0;

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

          if (zone >= 1 && zone <= 4) {
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
        setLoadedAircraftTags(loadedTags);
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
        const rows = snap.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        rows.sort((a, b) => {
          const timeA = a.createdAt?.seconds || 0;
          const timeB = b.createdAt?.seconds || 0;

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
        clearTimeout(debounceRef.current);
      }

      if (gateBagTimerRef.current) {
        clearTimeout(gateBagTimerRef.current);
      }
    };
  }, []);

  const checkedBagsTotal =
    typeof flight?.checkedBagsTotal === "number"
      ? flight.checkedBagsTotal
      : null;

  const missing =
    checkedBagsTotal === null
      ? null
      : Math.max(
          0,
          checkedBagsTotal - aircraftTotal
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
        .map((tag) => onlyDigits(tag))
        .filter((tag) => isValidTag10(tag))
    );
  }, [loadedAircraftTags]);

  const missingManifestTags = useMemo(() => {
    return allManifestTags.filter(
      (tag) => !loadedTagSet.has(tag)
    );
  }, [allManifestTags, loadedTagSet]);

  const bagroomMatchedTags = useMemo(() => {
    return bagroomScans
      .map((scan) =>
        onlyDigits(scan.tag || scan.id)
      )
      .filter(
        (tag) =>
          isValidTag10(tag) &&
          manifestTagSet.has(tag)
      );
  }, [bagroomScans, manifestTagSet]);

  const bagroomNotInManifest = useMemo(() => {
    return bagroomScans
      .map((scan) => ({
        ...scan,
        cleanTag: onlyDigits(
          scan.tag || scan.id
        ),
      }))
      .filter(
        (scan) =>
          isValidTag10(scan.cleanTag) &&
          !manifestTagSet.has(scan.cleanTag)
      );
  }, [bagroomScans, manifestTagSet]);

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
          onlyDigits(scan.tag || scan.id)
        )
        .filter((tag) => isValidTag10(tag))
    );
  }, [gateBagScans]);

  const loadedGateBagTags = useMemo(() => {
    return gateBagScans
      .map((scan) => onlyDigits(scan.tag || scan.id))
      .filter(
        (tag) =>
          isValidTag10(tag) &&
          loadedAircraftTagSet.has(tag)
      );
  }, [gateBagScans, loadedAircraftTagSet]);

  const pendingGateBagTags = useMemo(() => {
    return gateBagScans
      .map((scan) => onlyDigits(scan.tag || scan.id))
      .filter(
        (tag) =>
          isValidTag10(tag) &&
          !loadedAircraftTagSet.has(tag)
      );
  }, [gateBagScans, loadedAircraftTagSet]);

  const ensureStatusReceiving = async () => {
    if (!flightId || !flight) return;

    const currentStatus = normalizeStatus(
      flight.status
    );

    if (currentStatus !== "OPEN") return;

    await setDoc(
      doc(db, "flights", flightId),
      {
        status: "RECEIVING",
        statusUpdatedAt: serverTimestamp(),
        statusUpdatedBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
      },
      {
        merge: true,
      }
    );
  };
    const saveGateControllerOnDuty = async () => {
    const picked = selectedGateController.trim();

    if (!picked) {
      setGcMsg("Please select a Gate Controller.");
      return;
    }

    try {
      localStorage.setItem("gateControllerOnDuty", picked);

      await setDoc(
        doc(db, "flights", flightId),
        {
          gateControllerOnDuty: picked,
          gateControllerUpdatedAt: serverTimestamp(),
          gateControllerUpdatedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
        },
        { merge: true }
      );

      setGcMsg(`Gate Controller saved: ${picked} ✅`);
      setTimeout(() => setGcMsg(""), 2500);
    } catch (error) {
      console.error(error);
      setGcMsg("Could not save Gate Controller.");
    }
  };

  const updateFlightStatus = async (nextStatus) => {
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
        doc(db, "flights", flightId),
        {
          status: nextStatus,
          statusUpdatedAt: serverTimestamp(),
          statusUpdatedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
        },
        { merge: true }
      );

      setManifestMsg(`Status updated to ${nextStatus} ✅`);
      setTimeout(() => setManifestMsg(""), 2000);
    } catch (error) {
      console.error(error);
      setManifestErr(
        "Could not update status. Check Firestore rules."
      );
    }
  };

  const saveTotal = async () => {
    setSaveMsg("");

    const value = toIntSafe(checkedTotalInput);

    if (value === null) {
      setSaveMsg("Please enter a valid number.");
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
        doc(db, "flights", flightId),
        {
          checkedBagsTotal: value,
          gateTotalUpdatedAt: serverTimestamp(),
          gateTotalUpdatedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
          gateControllerOnDuty:
            selectedGateController || null,
        },
        { merge: true }
      );

      setSaveMsg("Saved ✅");
      setTimeout(() => setSaveMsg(""), 2000);
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

  const updateStrictManifest = async (
    nextValue
  ) => {
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
        doc(db, "flights", flightId),
        {
          strictManifest: Boolean(nextValue),
          strictManifestUpdatedAt:
            serverTimestamp(),
        },
        { merge: true }
      );

      setStrictManifest(Boolean(nextValue));

      setManifestMsg(
        `Strict Manifest set to ${
          nextValue ? "ON" : "OFF"
        } ✅`
      );

      setTimeout(() => setManifestMsg(""), 2000);
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

    const tags = extractBagTagsFromText(text, {
      exactLen: 10,
    });

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
    setManifestTagsPreview((previous) =>
      previous.filter((item) => item !== tag)
    );
  };

  const handleFilePick = async (file) => {
    setManifestMsg("");
    setManifestErr("");

    try {
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");

      let text = "";

      if (isPdf) {
        setManifestMsg("Reading PDF (local)...");

        text = await readPdfAsText(file);
      } else {
        setManifestMsg("Reading file...");

        text = await readFileAsText(file);
      }

      setManifestText(text);
      previewFromText(text);

      const found = extractBagTagsFromText(
        text,
        {
          exactLen: 10,
        }
      ).length;

      if (isPdf && found === 0) {
        setManifestMsg(
          "No 10-digit tags found locally. Uploading PDF for OCR..."
        );

        const uploaded = await uploadPdfForOcr({
          file,
          flightId,
          user,
        });

        setManifestMsg(
          `PDF uploaded for OCR ✅\n\nPath: ${uploaded.path}\n\nCloud OCR will import tags automatically.`
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

    const tags = manifestTagsPreview;

    if (!tags || tags.length === 0) {
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

        const batch = writeBatch(db);

        for (const tag of chunk) {
          if (!isValidTag10(tag)) continue;

          const tagRef = doc(
            db,
            "flights",
            flightId,
            "allowedBagTags",
            tag
          );

          batch.set(tagRef, {
            tag,
            importedAt: serverTimestamp(),
            importedBy: {
              userId: user?.id || null,
              username: user?.username || null,
              role: user?.role || null,
            },
            source: "import",
          });

          imported += 1;
        }

        await batch.commit();
      }

      await setDoc(
        doc(db, "flights", flightId),
        {
          strictManifest: true,
          strictManifestUpdatedAt:
            serverTimestamp(),
          manifestImportedAt: serverTimestamp(),
          manifestImportedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
        },
        { merge: true }
      );

      setStrictManifest(true);

      setManifestMsg(
        `Imported ${imported} bag tags ✅ Strict Manifest ON`
      );

      setTimeout(() => setManifestMsg(""), 2500);
    } catch (error) {
      console.error(error);

      setManifestErr(
        "Import failed. Check Firestore rules and try again."
      );
    } finally {
      setImporting(false);
    }
  };

  const saveScannedTagToManifest = async (
    raw
  ) => {
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

    if (!isValidTag10(cleaned)) {
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
          importedAt: serverTimestamp(),
          importedBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
          source: "scan",
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "flights", flightId),
        {
          strictManifest: true,
          strictManifestUpdatedAt:
            serverTimestamp(),
        },
        { merge: true }
      );

      setStrictManifest(true);
      setScanMsg(`Saved ✅ ${cleaned}`);
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

  const deleteAllowedTag = async (tag) => {
    if (!canEdit) return;

    const id = String(tag || "").trim();

    if (!id) return;

    const confirmed = window.confirm(
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

  const validateGateBagOtherFlight = async (
    tag
  ) => {
    const tagRef = doc(db, "bagTags", tag);
    const tagSnap = await getDoc(tagRef);

    if (!tagSnap.exists()) {
      return {
        ok: true,
      };
    }

    const existing = tagSnap.data();

    if (
      existing.flightId &&
      existing.flightId !== flightId
    ) {
      return {
        ok: false,
        message:
          `❌ This bag tag belongs to another flight/date.\n\n` +
          `Current flight: ${
            flight?.flightNumber || flightId
          } (${flight?.flightDate || "-"})\n` +
          `Registered flight: ${
            existing.flightNumber ||
            existing.flightId
          } (${existing.flightDate || "-"})\n\n` +
          `Do NOT accept this bag for this flight.`,
      };
    }

    return {
      ok: true,
    };
  };

  const saveGateBagTrackingEvent = async (
    tag
  ) => {
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
        "Bag tag created / scanned at gate · Direct to Aircraft",
      tag,
      bagType: "GATE_BAG",
      bagTypeLabel: "Bag Tagged at Gate",
      directToAircraft: true,
      flightId,
      flightNumber:
        flight?.flightNumber || null,
      flightDate:
        flight?.flightDate || null,
      gate: flight?.gate || null,
      createdAt: serverTimestamp(),
      createdBy: {
        userId: user?.id || null,
        username: user?.username || null,
        role: user?.role || null,
      },
    });
  };

  const saveGateBagScan = async (tag) => {
    const scanRef = doc(
      db,
      "flights",
      flightId,
      "gateBagScans",
      tag
    );

    const existingScan = await getDoc(scanRef);

    if (existingScan.exists()) {
      setGateBagErr(
        `Duplicate scan. Bag tag ${tag} was already tagged at Gate.`
      );

      setGateBagInput("");

      return false;
    }

    const crossFlight =
      await validateGateBagOtherFlight(tag);

    if (!crossFlight.ok) {
      setGateBagErr(crossFlight.message);
      setGateBagInput("");

      return false;
    }

    await setDoc(scanRef, {
      tag,
      location: "gate",
      bagType: "GATE_BAG",
      bagTypeLabel: "Bag Tagged at Gate",
      directToAircraft: true,
      createdAt: serverTimestamp(),
      scannedBy: {
        userId: user?.id || null,
        username: user?.username || null,
        role: user?.role || null,
      },
    });

    await setDoc(
      doc(db, "bagTags", tag),
      {
        tag,
        flightId,
        flightNumber:
          flight?.flightNumber || null,
        flightDate:
          flight?.flightDate || null,
        gate: flight?.gate || null,
        bagType: "GATE_BAG",
        bagTypeLabel: "Bag Tagged at Gate",
        directToAircraft: true,
        firstSeenAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        lastSeenLocation: "gate",
        lastSeenBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
      },
      { merge: true }
    );

    await saveGateBagTrackingEvent(tag);

    return true;
  };
    const handleGateBagSubmit = async (
    forcedValue
  ) => {
    if (gateBagSavingRef.current) return;

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
        forcedValue ?? gateBagInput
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
      gateBagSavingRef.current = true;

      const saved = await saveGateBagScan(tag);

      if (!saved) return;

      setGateBagMsg(
        `Gate bag saved ✅ ${tag} · Direct to Aircraft`
      );

      setGateBagInput("");

      if (gateBagInputRef.current) {
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
      gateBagSavingRef.current = false;
    }
  };

  const scheduleGateBagSubmit = (
    value
  ) => {
    if (gateBagTimerRef.current) {
      clearTimeout(gateBagTimerRef.current);
    }

    const cleaned = onlyDigits(
      cleanTagValue(value)
    );

    gateBagTimerRef.current = setTimeout(() => {
      if (isValidTag10(cleaned)) {
        handleGateBagSubmit(cleaned);
      }
    }, 120);
  };

  const handleGateBagChange = (event) => {
    const value = event.target.value;

    setGateBagInput(value);

    if (!isFlightLoaded) {
      scheduleGateBagSubmit(value);
    }
  };

  const handleGateBagKeyDown = (
    event
  ) => {
    if (
      event.key === "Enter" ||
      event.key === "Tab"
    ) {
      event.preventDefault();

      handleGateBagSubmit();
    }
  };

  const deleteGateBagScan = async (
    scan
  ) => {
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

    if (loadedAircraftTagSet.has(tag)) {
      setGateBagErr(
        `Bag tag ${tag} is already loaded on Aircraft and cannot be deleted from Gate. Offload it from Aircraft first.`
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete Gate bag tag?\n\n` +
        `Bag Tag: ${tag}\n` +
        `Flow: Gate → Aircraft\n\n` +
        `This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      setDeletingGateBagTag(tag);
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

      const aircraftSnap = await getDoc(
        doc(
          db,
          "flights",
          flightId,
          "aircraftScans",
          tag
        )
      );

      const counterSnap = await getDoc(
        doc(
          db,
          "flights",
          flightId,
          "counterScans",
          tag
        )
      );

      const bagroomSnap = await getDoc(
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
          doc(db, "bagTags", tag)
        );
      }

      setGateBagMsg(
        `Gate bag deleted ✅ ${tag}`
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
      setDeletingGateBagTag("");
    }
  };

  const onScanKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();

      saveScannedTagToManifest(scanInput);
    }
  };

  useEffect(() => {
    if (!canEdit) return;

    const raw = scanInput;

    if (!raw) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const cleaned = onlyDigits(
        cleanTagValue(raw)
      );

      if (isValidTag10(cleaned)) {
        saveScannedTagToManifest(cleaned);
      }
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanInput]);

  const title = "Gate Controller";

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "end",
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
            Verified counts, Gate-tagged bags,
            Bagroom match, and manifest for Ramp
            coordination.
          </p>
        </div>

        <div
          style={{
            textAlign: "right",
            fontSize: "0.9rem",
            minWidth: 260,
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
              value={selectedGateController}
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
                Select GC…
              </option>

              {gateControllers.map(
                (gateController) => (
                  <option
                    key={gateController.id}
                    value={
                      gateController.username
                    }
                  >
                    {gateController.username}
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
                padding: "6px 10px",
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
                fontSize: "0.78rem",
                color: gcMsg.includes("✅")
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
              "repeat(auto-fit, minmax(220px, 1fr))",
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
              Open → Receiving → Loading →
              Loaded
            </p>
          </div>

          <span
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${statusStyle.border}`,
              background: statusStyle.bg,
              color: statusStyle.text,
              fontWeight: 900,
              letterSpacing: "0.04em",
            }}
          >
            {flightStatus === "RECEIVING"
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
              updateFlightStatus("OPEN")
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
              updateFlightStatus("LOADING")
            }
            style={btnStatus(canEdit)}
          >
            Loading
          </button>

          <button
            disabled={!canEdit}
            onClick={() =>
              updateFlightStatus("LOADED")
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
              Create or scan a bag tag at
              the boarding gate. This bag
              goes directly from Gate to
              Aircraft and does not pass
              through Counter or Bagroom.
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
            GATE → AIRCRAFT
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
                ? "…"
                : gateBagScans.length
            }
          />

          <InfoCard
            label="Loaded on Aircraft"
            value={
              loadingGateBagScans ||
              aircraftLoading
                ? "…"
                : gateBagLoadedCount
            }
          />

          <InfoCard
            label="Pending Aircraft"
            value={
              loadingGateBagScans ||
              aircraftLoading
                ? "…"
                : gateBagPendingCount
            }
          />

          <InfoCard
            label="Aircraft Gate Bags"
            value={
              aircraftLoading
                ? "…"
                : aircraftBagTypeCounts.GATE_BAG
            }
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(240px, 1fr) auto",
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
                : "Scan 10-digit Gate bag tag…"
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
              whiteSpace: "pre-wrap",
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
          }}
        >
          {loadingGateBagScans ||
          aircraftLoading ? (
            <p style={{ color: "#6b7280" }}>
              Loading Gate bags…
            </p>
          ) : gateBagScans.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              No bags tagged at Gate yet.
            </p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: "white",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#ede9fe",
                  }}
                >
                  <th style={tableHeader}>
                    Bag Tag
                  </th>

                  <th style={tableHeader}>
                    Status
                  </th>

                  <th style={tableHeader}>
                    User
                  </th>

                  <th
                    style={{
                      ...tableHeader,
                      textAlign: "right",
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {gateBagScans.map(
                  (scan) => {
                    const tag = onlyDigits(
                      scan.tag || scan.id
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
                          background: loaded
                            ? "#f0fdf4"
                            : "#fef2f2",
                        }}
                      >
                        <td style={tableCell}>
                          <strong
                            style={{
                              color: loaded
                                ? "#166534"
                                : "#991b1b",
                            }}
                          >
                            {tag}
                          </strong>
                        </td>

                        <td style={tableCell}>
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
                              color: loaded
                                ? "#166534"
                                : "#991b1b",
                              fontSize:
                                "0.75rem",
                              fontWeight: 900,
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
                            color: "#6b7280",
                          }}
                        >
                          {scan.scannedBy
                            ?.username || "-"}
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
                                color: "white",
                                fontWeight: 800,
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
                                ? "Deleting…"
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
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          marginBottom: 14,
          background: "#f9fafb",
        }}
      >
        <h3 style={{ margin: 0 }}>Aircraft Loading</h3>

        <div style={aircraftStatusBox(missing)}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ fontSize: "2rem" }}>
              {checkedBagsTotal === null
                ? "ℹ️"
                : missing === 0
                  ? "✅"
                  : missing <= 3
                    ? "⚠️"
                    : "❌"}
            </div>

            <div>
              <div
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 900,
                }}
              >
                {checkedBagsTotal === null
                  ? "Gate total pending"
                  : missing === 0
                    ? "All bags accounted for"
                    : `${missing} bag${missing === 1 ? "" : "s"} missing to load`}
              </div>

              <div
                style={{
                  fontSize: "0.85rem",
                  marginTop: 3,
                }}
              >
                {checkedBagsTotal === null
                  ? "Enter Gate total to calculate missing bags."
                  : missing === 0
                    ? "All expected bags have been loaded."
                    : missing <= 3
                      ? "Almost complete. Verify the remaining bags."
                      : "Attention required. Several bags are still missing."}
              </div>
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
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
              {aircraftLoading ? "…" : aircraftTotal}
            </div>

            <div style={{ fontSize: "0.8rem" }}>
              of{" "}
              {checkedBagsTotal === null
                ? "—"
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
            value={aircraftLoading ? "…" : zones[1]}
          />

          <InfoCard
            label="Zone 2"
            value={aircraftLoading ? "…" : zones[2]}
          />

          <InfoCard
            label="Zone 3"
            value={aircraftLoading ? "…" : zones[3]}
          />

          <InfoCard
            label="Zone 4"
            value={aircraftLoading ? "…" : zones[4]}
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
                ? "…"
                : aircraftBagTypeCounts.CHECKED_BAG
            }
          />

          <InfoCard
            label="Gate Checks Loaded"
            value={
              aircraftLoading
                ? "…"
                : aircraftBagTypeCounts.GATE_CHECK
            }
          />

          <InfoCard
            label="Oversize Loaded"
            value={
              aircraftLoading
                ? "…"
                : aircraftBagTypeCounts.OVERSIZE
            }
          />

          <InfoCard
            label="Gate Tagged Loaded"
            value={
              aircraftLoading
                ? "…"
                : aircraftBagTypeCounts.GATE_BAG
            }
          />
        </div>
      </section>

      <section
        style={{
          border: "1px solid #e5e7eb",
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
                ? "…"
                : allManifestTags.length
            }
          />

          <InfoCard
            label="Bagroom Scanned"
            value={
              loadingBagroomScans
                ? "…"
                : bagroomScans.length
            }
          />

          <InfoCard
            label="Matched Manifest"
            value={
              loadingAllowed ||
              loadingBagroomScans
                ? "…"
                : bagroomMatchedTags.length
            }
          />

          <InfoCard
            label="Not in Manifest"
            value={
              loadingAllowed ||
              loadingBagroomScans
                ? "…"
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
              setActiveBagroomTab("summary")
            }
            style={tabBtn(
              activeBagroomTab === "summary"
            )}
          >
            By Cart
          </button>

          <button
            onClick={() =>
              setActiveBagroomTab("matched")
            }
            style={tabBtn(
              activeBagroomTab === "matched"
            )}
          >
            Matched ({bagroomMatchedTags.length})
          </button>

          <button
            onClick={() =>
              setActiveBagroomTab("notManifest")
            }
            style={tabBtn(
              activeBagroomTab === "notManifest"
            )}
          >
            Not in Manifest (
            {bagroomNotInManifest.length})
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {loadingBagroomScans ? (
            <p style={{ color: "#6b7280" }}>
              Loading Bagroom scans…
            </p>
          ) : bagroomScans.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              No Bagroom scans yet.
            </p>
          ) : activeBagroomTab === "summary" ? (
            <div
              style={{
                display: "grid",
                gap: 12,
              }}
            >
              {Object.keys(bagroomByCart)
                .sort((a, b) =>
                  String(a).localeCompare(
                    String(b),
                    undefined,
                    { numeric: true }
                  )
                )
                .map((cart) => {
                  const rows =
                    bagroomByCart[cart];

                  const matched = rows.filter(
                    (scan) =>
                      manifestTagSet.has(
                        onlyDigits(
                          scan.tag || scan.id
                        )
                      )
                  );

                  return (
                    <div
                      key={cart}
                      style={{
                        border:
                          "1px solid #e5e7eb",
                        borderRadius: 12,
                        background: "white",
                        padding: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent:
                            "space-between",
                          gap: 10,
                          fontWeight: 900,
                        }}
                      >
                        <span>Cart {cart}</span>

                        <span>
                          {matched.length}/
                          {rows.length} matched
                        </span>
                      </div>

                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                        }}
                      >
                        {rows.map((scan) => {
                          const tag = onlyDigits(
                            scan.tag || scan.id
                          );

                          const matchedManifest =
                            manifestTagSet.has(tag);

                          return (
                            <span
                              key={scan.id}
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
                              {tag || scan.tag}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : activeBagroomTab === "matched" ? (
            bagroomMatchedTags.length === 0 ? (
              <p style={{ color: "#6b7280" }}>
                No matched Bagroom tags yet.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {bagroomMatchedTags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      ...tagPill,
                      background: "#DCFCE7",
                      color: "#166534",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )
          ) : bagroomNotInManifest.length === 0 ? (
            <p
              style={{
                color: "#16a34a",
                fontWeight: 800,
              }}
            >
              All Bagroom scans are in the
              manifest ✅
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
                      background: "#FEF2F2",
                      color: "#991B1B",
                    }}
                  >
                    {scan.cleanTag} · Cart{" "}
                    {scan.cartNumber || "-"}
                  </span>
                )
              )}
            </div>
          )}
        </div>
      </section>

      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          marginBottom: 14,
          background: "#f9fafb",
        }}
      >
        <h3 style={{ margin: 0 }}>
          Manifest Loading Status
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
                ? "…"
                : allManifestTags.length
            }
          />

          <InfoCard
            label="Aircraft Loaded"
            value={
              aircraftLoading
                ? "…"
                : loadedAircraftTags.length
            }
          />

          <InfoCard
            label="Missing to Load"
            value={
              loadingAllowed || aircraftLoading
                ? "…"
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
              setActiveManifestTab("recent")
            }
            style={tabBtn(
              activeManifestTab === "recent"
            )}
          >
            Manifest Tags
          </button>

          <button
            onClick={() =>
              setActiveManifestTab("missing")
            }
            style={tabBtn(
              activeManifestTab === "missing"
            )}
          >
            Missing to Load (
            {missingManifestTags.length})
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            maxHeight: 300,
            overflow: "auto",
          }}
        >
          {activeManifestTab === "recent" ? (
            loadingAllowed ? (
              <p style={{ color: "#6b7280" }}>
                Loading manifest…
              </p>
            ) : recentAllowed.length === 0 ? (
              <p style={{ color: "#6b7280" }}>
                No manifest tags uploaded yet.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {recentAllowed.map((row) => {
                  const tag =
                    row.tag || row.id;

                  const busy =
                    deletingTag === tag;

                  return (
                    <span
                      key={row.id}
                      style={tagPill}
                    >
                      {tag}

                      {canEdit && (
                        <button
                          onClick={() =>
                            deleteAllowedTag(tag)
                          }
                          disabled={busy}
                          title="Delete tag"
                          style={{
                            border: "none",
                            background:
                              "transparent",
                            cursor: busy
                              ? "not-allowed"
                              : "pointer",
                            fontWeight: 900,
                            color: "#b91c1c",
                            opacity: busy
                              ? 0.6
                              : 1,
                          }}
                        >
                          {busy ? "…" : "✕"}
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )
          ) : loadingAllowed ||
            aircraftLoading ? (
            <p style={{ color: "#6b7280" }}>
              Loading missing tags…
            </p>
          ) : missingManifestTags.length ===
            0 ? (
            <p
              style={{
                color: "#16a34a",
                fontWeight: 800,
              }}
            >
              All manifest tags are loaded ✅
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {missingManifestTags.map(
                (tag) => (
                  <span
                    key={tag}
                    style={{
                      ...tagPill,
                      background: "#FEF2F2",
                      color: "#991B1B",
                    }}
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
          border: "1px solid #e5e7eb",
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
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        {saveMsg && (
          <p
            style={{
              margin: "8px 0 0",
              fontSize: "0.85rem",
              color: saveMsg.includes("✅")
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
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <h3 style={{ margin: 0 }}>
          Flight Bag Tag Manifest (Import)
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
            {strictManifest ? "ON" : "OFF"}
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
              previewFromText(manifestText)
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
              manifestTagsPreview.length === 0
            }
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border:
                "1px solid #1d4ed8",
              background:
                !canEdit ||
                importing ||
                manifestTagsPreview.length === 0
                  ? "#93c5fd"
                  : "#2563eb",
              color: "white",
              fontWeight: 800,
              cursor:
                !canEdit ||
                importing ||
                manifestTagsPreview.length === 0
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {importing
              ? "Importing..."
              : "Import to Flight"}
          </button>
        </div>

        {manifestTagsPreview.length > 0 && (
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
                      removeFromPreview(tag)
                    }
                    disabled={!canEdit}
                    title="Remove from preview"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#b91c1c",
                      cursor: canEdit
                        ? "pointer"
                        : "not-allowed",
                      fontWeight: 900,
                    }}
                  >
                    ✕
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
  borderBottom: "1px solid #ddd6fe",
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#5b21b6",
  whiteSpace: "nowrap",
};

const tableCell = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
  verticalAlign: "middle",
};

function InfoCard({ label, value }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
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

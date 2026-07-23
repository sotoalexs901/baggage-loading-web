// src/pages/BagroomScanPage.jsx
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
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "../firebase";
import Modal from "../components/Modal.jsx";
import { useModal } from "../components/useModal.js";

const BAG_TAG_LENGTH = 10;
const AUTO_SUBMIT_IDLE_MS = 140;
const COMPACT_SCREEN_WIDTH = 760;

const RECEIVING_LOCATIONS = {
  BAGROOM: {
    value: "BAGROOM",
    trackingLocation: "bagroom",
    label: "Bagroom",
    department: "BAGROOM",
    eventType: "BAGROOM_SCAN",
    message: "Bag received/scanned in Bagroom",
    icon: "🛄",
  },

  OVERSIZE: {
    value: "OVERSIZE",
    trackingLocation: "oversize",
    label: "Oversize",
    department: "OVERSIZE",
    eventType: "OVERSIZE_SCAN",
    message: "Bag received/scanned at Oversize",
    icon: "📦",
  },

  GATE: {
    value: "GATE",
    trackingLocation: "gate",
    label: "Gate / Ramp",
    department: "RAMP",
    eventType: "GATE_RAMP_SCAN",
    message: "Bag received/scanned at Gate by Ramp",
    icon: "🚪",
  },
};

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeBagTag(value) {
  return onlyDigits(value).slice(0, BAG_TAG_LENGTH);
}

function isValidBagTag(value) {
  return onlyDigits(value).length === BAG_TAG_LENGTH;
}

function normalizeCartNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeReceivingLocation(value) {
  const raw = String(value || "BAGROOM")
    .trim()
    .toUpperCase();

  if (
    raw === "GATE_RAMP" ||
    raw === "GATE / RAMP" ||
    raw === "RAMP"
  ) {
    return "GATE";
  }

  return RECEIVING_LOCATIONS[raw]
    ? raw
    : "BAGROOM";
}

function getReceivingLocationConfig(value) {
  return RECEIVING_LOCATIONS[
    normalizeReceivingLocation(value)
  ];
}

function getScanReceivingLocation(scan) {
  return normalizeReceivingLocation(
    scan?.receivingLocation ||
      scan?.location ||
      "BAGROOM"
  );
}

function getScanLocationLabel(scan) {
  if (scan?.locationLabel) {
    return String(scan.locationLabel);
  }

  const location =
    getScanReceivingLocation(scan);

  return getReceivingLocationConfig(
    location
  ).label;
}

function getScanGroupName(scan) {
  const location =
    getScanReceivingLocation(scan);

  if (location === "OVERSIZE") {
    return "OVERSIZE";
  }

  if (location === "GATE") {
    return "GATE / RAMP";
  }

  return (
    normalizeCartNumber(scan?.cartNumber) ||
    "NO CART"
  );
}

function normalizeStatus(status) {
  const value = String(status || "OPEN")
    .trim()
    .toUpperCase();

  return [
    "OPEN",
    "RECEIVING",
    "LOADING",
    "LOADED",
  ].includes(value)
    ? value
    : "OPEN";
}

function normalizeBagType(value) {
  const type = String(value || "CHECKED_BAG")
    .trim()
    .toUpperCase();

  return [
    "CHECKED_BAG",
    "GATE_CHECK",
    "OVERSIZE",
    "GATE_BAG",
  ].includes(type)
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
    return "Gate Bag";
  }

  return "Checked Bag";
}

function useCompactScreen() {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return (
      window.innerWidth <= COMPACT_SCREEN_WIDTH
    );
  });

  useEffect(() => {
    const update = () => {
      setCompact(
        window.innerWidth <=
          COMPACT_SCREEN_WIDTH
      );
    };

    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener(
        "resize",
        update
      );
    };
  }, []);

  return compact;
}

export default function BagroomScanPage({
  flightId,
  user,
}) {
  const compactScreen = useCompactScreen();

  const role = useMemo(
    () => normalizeRole(user?.role),
    [user?.role]
  );

  const canDeleteScans = [
    "station_manager",
    "duty_manager",
    "supervisor",
    "gate_controller",
  ].includes(role);

  const [flight, setFlight] = useState(null);

  const [
    flightLoading,
    setFlightLoading,
  ] = useState(true);

  const [
    receivingLocation,
    setReceivingLocation,
  ] = useState("BAGROOM");

  const [cartNumber, setCartNumber] =
    useState("");

  const [scannerMode, setScannerMode] =
    useState(() => {
      return (
        localStorage.getItem(
          "bagroomScannerMode"
        ) !== "manual"
      );
    });

  const [tagInput, setTagInput] =
    useState("");

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [scans, setScans] = useState([]);

  const [
    loadingScans,
    setLoadingScans,
  ] = useState(true);

  const [
    counterScans,
    setCounterScans,
  ] = useState([]);

  const [
    loadingCounterScans,
    setLoadingCounterScans,
  ] = useState(true);

  const [
    strictManifest,
    setStrictManifest,
  ] = useState(false);

  const [
    deletingCounterTag,
    setDeletingCounterTag,
  ] = useState("");

  const [
    deletingReceivingTag,
    setDeletingReceivingTag,
  ] = useState("");

  const inputRef = useRef(null);
  const autoTimerRef = useRef(null);
  const isSubmittingRef = useRef(false);

  const lastSubmittedTagRef =
    useRef("");

  const lastSubmittedTimeRef =
    useRef(0);

  const { modal, show, close } =
    useModal();

  const normalizedReceivingLocation =
    normalizeReceivingLocation(
      receivingLocation
    );

  const receivingLocationConfig =
    getReceivingLocationConfig(
      normalizedReceivingLocation
    );

  const isRegularBagroom =
    normalizedReceivingLocation === "BAGROOM";

  const selectedCart =
    normalizeCartNumber(cartNumber);

  /*
   * Bagroom requires a cart.
   * Oversize and Gate / Ramp do not.
   */
  const locationReady =
    !isRegularBagroom ||
    Boolean(selectedCart);

  const isLoadingCompleted =
    Boolean(
      flight?.aircraftLoadingCompleted
    ) ||
    normalizeStatus(flight?.status) ===
      "LOADED";

  const focusScanner = () => {
    window.setTimeout(() => {
      if (
        inputRef.current &&
        locationReady &&
        !isLoadingCompleted
      ) {
        inputRef.current.focus();
      }
    }, 180);
  };

  const popup = (
    title,
    message,
    tone = "info"
  ) => {
    show({
      title,
      tone,

      content: (
        <div
          style={{
            whiteSpace: "pre-wrap",
          }}
        >
          {message}
        </div>
      ),

      confirmText: "OK",

      onConfirm: () => {
        close();
        focusScanner();
      },

      onCancel: () => {
        close();
        focusScanner();
      },
    });
  };

  const availableCarts = useMemo(() => {
    const carts = new Set();

    if (Array.isArray(flight?.cartNumbers)) {
      flight.cartNumbers.forEach((cart) => {
        const normalized =
          normalizeCartNumber(cart);

        if (normalized) {
          carts.add(normalized);
        }
      });
    }

    scans.forEach((scan) => {
      const scanLocation =
        getScanReceivingLocation(scan);

      if (scanLocation !== "BAGROOM") {
        return;
      }

      const normalized =
        normalizeCartNumber(
          scan.cartNumber
        );

      if (normalized) {
        carts.add(normalized);
      }
    });

    if (selectedCart) {
      carts.add(selectedCart);
    }

    return [...carts].sort((a, b) =>
      String(a).localeCompare(
        String(b),
        undefined,
        {
          numeric: true,
        }
      )
    );
  }, [
    flight?.cartNumbers,
    scans,
    selectedCart,
  ]);

  const counterTagSet = useMemo(() => {
    return new Set(
      counterScans
        .map((scan) =>
          onlyDigits(
            scan.tag ||
              scan.bagTag ||
              scan.id
          )
        )
        .filter(isValidBagTag)
    );
  }, [counterScans]);

  /*
   * Every scan saved inside bagroomScans
   * counts as received:
   *
   * - Bagroom
   * - Oversize
   * - Gate / Ramp
   */
  const receivedTagSet = useMemo(() => {
    return new Set(
      scans
        .map((scan) =>
          onlyDigits(
            scan.tag ||
              scan.bagTag ||
              scan.id
          )
        )
        .filter(isValidBagTag)
    );
  }, [scans]);

  const receivedScanByTag = useMemo(() => {
    const map = new Map();

    scans.forEach((scan) => {
      const tag = onlyDigits(
        scan.tag ||
          scan.bagTag ||
          scan.id
      );

      if (isValidBagTag(tag)) {
        map.set(tag, scan);
      }
    });

    return map;
  }, [scans]);

  const receivedCounterScans =
    useMemo(() => {
      return counterScans.filter(
        (scan) => {
          const tag = onlyDigits(
            scan.tag ||
              scan.bagTag ||
              scan.id
          );

          return (
            isValidBagTag(tag) &&
            receivedTagSet.has(tag)
          );
        }
      );
    }, [
      counterScans,
      receivedTagSet,
    ]);

  const pendingCounterScans =
    useMemo(() => {
      return counterScans.filter(
        (scan) => {
          const tag = onlyDigits(
            scan.tag ||
              scan.bagTag ||
              scan.id
          );

          return (
            isValidBagTag(tag) &&
            !receivedTagSet.has(tag)
          );
        }
      );
    }, [
      counterScans,
      receivedTagSet,
    ]);

  const receivedWithoutCounter =
    useMemo(() => {
      return scans.filter((scan) => {
        const tag = onlyDigits(
          scan.tag ||
            scan.bagTag ||
            scan.id
        );

        return (
          isValidBagTag(tag) &&
          !counterTagSet.has(tag)
        );
      });
    }, [scans, counterTagSet]);

  const groupedByReceivingArea =
    useMemo(() => {
      const groups = {};

      scans.forEach((scan) => {
        const groupName =
          getScanGroupName(scan);

        if (!groups[groupName]) {
          groups[groupName] = [];
        }

        groups[groupName].push(scan);
      });

      return groups;
    }, [scans]);

  const bagroomScanCount = useMemo(() => {
    return scans.filter((scan) => {
      return (
        getScanReceivingLocation(scan) ===
        "BAGROOM"
      );
    }).length;
  }, [scans]);

  const oversizeScanCount = useMemo(() => {
    return scans.filter((scan) => {
      return (
        getScanReceivingLocation(scan) ===
        "OVERSIZE"
      );
    }).length;
  }, [scans]);

  const gateRampScanCount = useMemo(() => {
    return scans.filter((scan) => {
      return (
        getScanReceivingLocation(scan) ===
        "GATE"
      );
    }).length;
  }, [scans]);
    /*
   * Flight subscription.
   */
  useEffect(() => {
    if (!flightId) {
      setFlight(null);
      setFlightLoading(false);
      return undefined;
    }

    setFlightLoading(true);

    const flightRef = doc(
      db,
      "flights",
      flightId
    );

    const unsubscribe = onSnapshot(
      flightRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setFlight(null);
          setFlightLoading(false);
          return;
        }

        const flightData = {
          id: snapshot.id,
          ...snapshot.data(),
        };

        setFlight(flightData);

        if (
          typeof flightData.strictManifest ===
          "boolean"
        ) {
          setStrictManifest(
            flightData.strictManifest
          );
        }

        setFlightLoading(false);
      },
      (error) => {
        console.error(
          "Bagroom flight snapshot error:",
          error
        );

        setFlight(null);
        setFlightLoading(false);
      }
    );

    return () => unsubscribe();
  }, [flightId]);

  /*
   * Receiving scans subscription.
   *
   * Bagroom, Oversize, and Gate / Ramp
   * are all stored in bagroomScans.
   */
  useEffect(() => {
    if (!flightId) {
      setScans([]);
      setLoadingScans(false);
      return undefined;
    }

    setLoadingScans(true);

    const receivingScansRef = collection(
      db,
      "flights",
      flightId,
      "bagroomScans"
    );

    const unsubscribe = onSnapshot(
      receivingScansRef,
      (snapshot) => {
        const rows = snapshot.docs.map(
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

        setScans(rows);
        setLoadingScans(false);
      },
      (error) => {
        console.error(
          "Receiving scans snapshot error:",
          error
        );

        setScans([]);
        setLoadingScans(false);
      }
    );

    return () => unsubscribe();
  }, [flightId]);

  /*
   * Counter scans subscription.
   */
  useEffect(() => {
    if (!flightId) {
      setCounterScans([]);
      setLoadingCounterScans(false);
      return undefined;
    }

    setLoadingCounterScans(true);

    const counterScansRef = collection(
      db,
      "flights",
      flightId,
      "counterScans"
    );

    const unsubscribe = onSnapshot(
      counterScansRef,
      (snapshot) => {
        const rows = snapshot.docs.map(
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

        setCounterScans(rows);
        setLoadingCounterScans(false);
      },
      (error) => {
        console.error(
          "Counter scans snapshot error:",
          error
        );

        setCounterScans([]);
        setLoadingCounterScans(false);
      }
    );

    return () => unsubscribe();
  }, [flightId]);

  /*
   * Restore the saved receiving area and
   * cart when the selected flight changes.
   */
  useEffect(() => {
    if (!flightId) {
      setReceivingLocation("BAGROOM");
      setCartNumber("");
      setTagInput("");
      setMsg("");
      setErr("");
      return;
    }

    const savedLocation =
      localStorage.getItem(
        `bagroomReceivingLocation_${flightId}`
      ) || "BAGROOM";

    const normalizedLocation =
      normalizeReceivingLocation(
        savedLocation
      );

    setReceivingLocation(
      normalizedLocation
    );

    const savedCart =
      localStorage.getItem(
        `bagroomLastRegularCart_${flightId}`
      ) ||
      localStorage.getItem(
        `bagroomCart_${flightId}`
      ) ||
      "";

    setCartNumber(savedCart);
    setTagInput("");
    setMsg("");
    setErr("");

    if (autoTimerRef.current) {
      window.clearTimeout(
        autoTimerRef.current
      );

      autoTimerRef.current = null;
    }
  }, [flightId]);

  /*
   * Restore scanner focus after changing
   * area, cart, mode, or flight status.
   */
  useEffect(() => {
    if (
      scannerMode &&
      locationReady &&
      !isLoadingCompleted
    ) {
      focusScanner();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCart,
    normalizedReceivingLocation,
    scannerMode,
    isLoadingCompleted,
  ]);

  /*
   * Clear the auto-submit timer when the
   * page is unmounted.
   */
  useEffect(() => {
    return () => {
      if (autoTimerRef.current) {
        window.clearTimeout(
          autoTimerRef.current
        );
      }
    };
  }, []);

  const dataLoading =
    loadingScans ||
    loadingCounterScans;

  const pagePadding = compactScreen
    ? 8
    : 16;

  const ensureStatusReceiving = async () => {
    if (!flightId || !flight) {
      return;
    }

    const currentStatus = normalizeStatus(
      flight.status
    );

    if (
      currentStatus === "RECEIVING" ||
      currentStatus === "LOADING" ||
      currentStatus === "LOADED"
    ) {
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

        statusUpdatedBy: {
          userId:
            user?.id || null,

          username:
            user?.username || null,

          role:
            user?.role || null,
        },
      },
      {
        merge: true,
      }
    );
  };

  const saveCartToFlight = async (
    cartValue = selectedCart
  ) => {
    const normalizedCart =
      normalizeCartNumber(cartValue);

    if (
      !flightId ||
      !normalizedCart
    ) {
      return;
    }

    const existingCarts =
      Array.isArray(flight?.cartNumbers)
        ? flight.cartNumbers
            .map(normalizeCartNumber)
            .filter(Boolean)
        : [];

    if (
      existingCarts.includes(
        normalizedCart
      )
    ) {
      return;
    }

    const nextCarts = [
      ...existingCarts,
      normalizedCart,
    ].sort((a, b) =>
      String(a).localeCompare(
        String(b),
        undefined,
        {
          numeric: true,
        }
      )
    );

    await setDoc(
      doc(
        db,
        "flights",
        flightId
      ),
      {
        cartNumbers: nextCarts,

        cartNumbersUpdatedAt:
          serverTimestamp(),

        cartNumbersUpdatedBy: {
          userId:
            user?.id || null,

          username:
            user?.username || null,

          role:
            user?.role || null,
        },
      },
      {
        merge: true,
      }
    );
  };

  const selectReceivingLocation = (
    nextLocation
  ) => {
    const normalizedLocation =
      normalizeReceivingLocation(
        nextLocation
      );

    if (autoTimerRef.current) {
      window.clearTimeout(
        autoTimerRef.current
      );

      autoTimerRef.current = null;
    }

    setReceivingLocation(
      normalizedLocation
    );

    localStorage.setItem(
      `bagroomReceivingLocation_${flightId}`,
      normalizedLocation
    );

    setTagInput("");
    setMsg("");
    setErr("");

    if (normalizedLocation === "BAGROOM") {
      const savedCart =
        localStorage.getItem(
          `bagroomLastRegularCart_${flightId}`
        ) ||
        localStorage.getItem(
          `bagroomCart_${flightId}`
        ) ||
        "";

      setCartNumber(savedCart);
    }

    window.setTimeout(() => {
      if (
        scannerMode &&
        !isLoadingCompleted
      ) {
        inputRef.current?.focus();
      }
    }, 250);
  };

  const selectCart = (value) => {
    const normalizedCart =
      normalizeCartNumber(value);

    setCartNumber(normalizedCart);

    if (normalizedCart) {
      localStorage.setItem(
        `bagroomCart_${flightId}`,
        normalizedCart
      );

      localStorage.setItem(
        `bagroomLastRegularCart_${flightId}`,
        normalizedCart
      );
    } else {
      localStorage.removeItem(
        `bagroomCart_${flightId}`
      );
    }

    setTagInput("");
    setMsg("");
    setErr("");

    if (
      normalizedCart &&
      scannerMode &&
      !isLoadingCompleted
    ) {
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 200);
    }
  };

  const changeScannerMode = (
    nextScannerMode
  ) => {
    const enabled =
      Boolean(nextScannerMode);

    setScannerMode(enabled);

    localStorage.setItem(
      "bagroomScannerMode",
      enabled
        ? "scanner"
        : "manual"
    );

    setTagInput("");
    setMsg("");
    setErr("");

    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 200);
  };

  const findBagInAnotherFlight = async (
    bagTag
  ) => {
    const trackingRef = doc(
      db,
      "bagTags",
      bagTag
    );

    const trackingSnapshot =
      await getDoc(trackingRef);

    if (!trackingSnapshot.exists()) {
      return null;
    }

    const trackingData =
      trackingSnapshot.data();

    const trackedFlightId =
      trackingData?.flightId ||
      trackingData?.currentFlightId ||
      null;

    if (
      trackedFlightId &&
      trackedFlightId !== flightId
    ) {
      return {
        flightId: trackedFlightId,

        flightNumber:
          trackingData?.flightNumber ||
          trackingData?.currentFlightNumber ||
          trackedFlightId,

        data: trackingData,
      };
    }

    return null;
  };

  const saveTrackingEvent = async ({
    bagTag,
    locationConfig,
    cart,
    matchedCounter,
  }) => {
    if (!flightId || !bagTag) {
      return;
    }

    const trackingRef = doc(
      db,
      "bagTags",
      bagTag
    );

    const trackingSnapshot =
      await getDoc(trackingRef);

    const existingData =
      trackingSnapshot.exists()
        ? trackingSnapshot.data()
        : {};

    const existingEvents =
      Array.isArray(existingData.events)
        ? existingData.events
        : [];

    const event = {
      type:
        locationConfig.eventType,

      event:
        locationConfig.eventType,

      message:
        locationConfig.message,

      location:
        locationConfig.trackingLocation,

      receivingLocation:
        locationConfig.value,

      locationLabel:
        locationConfig.label,

      department:
        locationConfig.department,

      cartNumber:
        locationConfig.value === "BAGROOM"
          ? cart || null
          : null,

      flightId,

      flightNumber:
        flight?.flightNumber || null,

      flightDate:
        flight?.flightDate || null,

      gate:
        flight?.gate || null,

      matchedCounter:
        Boolean(matchedCounter),

      timestamp:
        new Date().toISOString(),

      createdBy: {
        userId:
          user?.id || null,

        username:
          user?.username || null,

        role:
          user?.role || null,
      },
    };

    const nextEvents = [
      ...existingEvents,
      event,
    ].slice(-100);

    await setDoc(
      trackingRef,
      {
        tag: bagTag,
        bagTag,

        flightId,

        currentFlightId:
          flightId,

        flightNumber:
          flight?.flightNumber || null,

        currentFlightNumber:
          flight?.flightNumber || null,

        flightDate:
          flight?.flightDate || null,

        gate:
          flight?.gate || null,

        location:
          locationConfig.trackingLocation,

        receivingLocation:
          locationConfig.value,

        locationLabel:
          locationConfig.label,

        department:
          locationConfig.department,

        cartNumber:
          locationConfig.value === "BAGROOM"
            ? cart || null
            : null,

        lastEvent:
          locationConfig.eventType,

        lastMessage:
          locationConfig.message,

        matchedCounter:
          Boolean(matchedCounter),

        updatedAt:
          serverTimestamp(),

        updatedBy: {
          userId:
            user?.id || null,

          username:
            user?.username || null,

          role:
            user?.role || null,
        },

        events: nextEvents,
      },
      {
        merge: true,
      }
    );
  };

  const saveReceivingScan = async (
    bagTag
  ) => {
    const locationConfig =
      getReceivingLocationConfig(
        normalizedReceivingLocation
      );

    const cart =
      locationConfig.value === "BAGROOM"
        ? selectedCart
        : null;

    const matchedCounter =
      counterTagSet.has(bagTag);

    const receivingScanRef = doc(
      db,
      "flights",
      flightId,
      "bagroomScans",
      bagTag
    );

    const existingSnapshot =
      await getDoc(receivingScanRef);

    if (existingSnapshot.exists()) {
      const existingScan =
        existingSnapshot.data();

      const existingLocation =
        getScanLocationLabel(
          existingScan
        );

      const existingCart =
        normalizeCartNumber(
          existingScan.cartNumber
        );

      const existingDetails =
        getScanReceivingLocation(
          existingScan
        ) === "BAGROOM"
          ? `${existingLocation} / Cart ${
              existingCart || "-"
            }`
          : existingLocation;

      throw new Error(
        `Bag tag ${bagTag} was already received at ${existingDetails}.`
      );
    }

    await setDoc(
      receivingScanRef,
      {
        tag: bagTag,
        bagTag,

        flightId,

        flightNumber:
          flight?.flightNumber || null,

        flightDate:
          flight?.flightDate || null,

        gate:
          flight?.gate || null,

        receivingLocation:
          locationConfig.value,

        location:
          locationConfig.value,

        trackingLocation:
          locationConfig.trackingLocation,

        locationLabel:
          locationConfig.label,

        department:
          locationConfig.department,

        eventType:
          locationConfig.eventType,

        message:
          locationConfig.message,

        cartNumber: cart,

        matchedCounter,

        source:
          "BAGGAGE_RECEIVING",

        createdAt:
          serverTimestamp(),

        scannedAt:
          serverTimestamp(),

        scannedBy: {
          userId:
            user?.id || null,

          username:
            user?.username || null,

          role:
            user?.role || null,
        },

        createdBy: {
          userId:
            user?.id || null,

          username:
            user?.username || null,

          role:
            user?.role || null,
        },
      }
    );

    await saveTrackingEvent({
      bagTag,
      locationConfig,
      cart,
      matchedCounter,
    });

    if (
      locationConfig.value ===
        "BAGROOM" &&
      cart
    ) {
      await saveCartToFlight(cart);
    }

    await ensureStatusReceiving();

    return {
      locationConfig,
      cart,
      matchedCounter,
    };
  };
    const handleScanSubmit = async (
    value = tagInput
  ) => {
    if (isSubmittingRef.current) {
      return;
    }

    const bagTag =
      normalizeBagTag(value);

    if (!flightId || !flight) {
      setErr(
        "Flight information is not available."
      );

      focusScanner();
      return;
    }

    if (isLoadingCompleted) {
      setErr(
        "This flight is already loaded. Scanning is locked."
      );

      popup(
        "Flight Locked",
        "This flight is already loaded. No additional bags can be received.",
        "warning"
      );

      return;
    }

    if (!locationReady) {
      setErr(
        "Select a cart before scanning bags into Bagroom."
      );

      popup(
        "Cart Required",
        "Please select or enter a cart number before scanning a bag into Bagroom.",
        "warning"
      );

      return;
    }

    if (!isValidBagTag(bagTag)) {
      setErr(
        `Bag tag must contain exactly ${BAG_TAG_LENGTH} digits.`
      );

      setTagInput(bagTag);
      focusScanner();
      return;
    }

    const now = Date.now();

    if (
      lastSubmittedTagRef.current ===
        bagTag &&
      now -
        lastSubmittedTimeRef.current <
        1200
    ) {
      setTagInput("");
      focusScanner();
      return;
    }

    isSubmittingRef.current = true;

    lastSubmittedTagRef.current =
      bagTag;

    lastSubmittedTimeRef.current =
      now;

    if (autoTimerRef.current) {
      window.clearTimeout(
        autoTimerRef.current
      );

      autoTimerRef.current = null;
    }

    setMsg("");
    setErr("");

    try {
      const existingOtherFlight =
        await findBagInAnotherFlight(
          bagTag
        );

      if (existingOtherFlight) {
        const otherFlightLabel =
          existingOtherFlight.flightNumber ||
          existingOtherFlight.flightId;

        const confirmed =
          window.confirm(
            `Bag tag ${bagTag} is currently associated with flight ${otherFlightLabel}.\n\nDo you want to receive it on this flight?`
          );

        if (!confirmed) {
          setTagInput("");
          setErr(
            `Scan cancelled. Bag remains associated with flight ${otherFlightLabel}.`
          );

          return;
        }
      }

      if (
        strictManifest &&
        !counterTagSet.has(bagTag)
      ) {
        const confirmed =
          window.confirm(
            `Bag tag ${bagTag} was not found in Counter scans.\n\nStrict Manifest is active. Do you still want to receive this bag?`
          );

        if (!confirmed) {
          setTagInput("");
          setErr(
            "Scan cancelled because the bag was not found in Counter scans."
          );

          return;
        }
      }

      const result =
        await saveReceivingScan(
          bagTag
        );

      const locationLabel =
        result.locationConfig.label;

      const cartDescription =
        result.locationConfig.value ===
          "BAGROOM" &&
        result.cart
          ? ` · Cart ${result.cart}`
          : "";

      const matchDescription =
        result.matchedCounter
          ? " · Counter matched"
          : " · No Counter match";

      setMsg(
        `${bagTag} received at ${locationLabel}${cartDescription}${matchDescription}`
      );

      setTagInput("");
    } catch (error) {
      console.error(
        "Receiving scan error:",
        error
      );

      const message =
        error?.message ||
        "Unable to save the receiving scan.";

      setErr(message);
      setTagInput("");

      popup(
        "Scan Not Saved",
        message,
        "error"
      );
    } finally {
      isSubmittingRef.current =
        false;

      window.setTimeout(() => {
        focusScanner();
      }, 120);
    }
  };

  const scheduleAutoSubmit = (
    nextValue
  ) => {
    if (autoTimerRef.current) {
      window.clearTimeout(
        autoTimerRef.current
      );
    }

    if (
      nextValue.length !==
      BAG_TAG_LENGTH
    ) {
      autoTimerRef.current = null;
      return;
    }

    autoTimerRef.current =
      window.setTimeout(() => {
        autoTimerRef.current = null;

        handleScanSubmit(nextValue);
      }, AUTO_SUBMIT_IDLE_MS);
  };

  const handleChange = (event) => {
    const nextValue =
      normalizeBagTag(
        event.target.value
      );

    setTagInput(nextValue);
    setMsg("");
    setErr("");

    if (scannerMode) {
      scheduleAutoSubmit(
        nextValue
      );
    }
  };

  const handleKeyDown = (event) => {
    if (
      event.key !== "Enter" &&
      event.key !== "Tab"
    ) {
      return;
    }

    event.preventDefault();

    if (autoTimerRef.current) {
      window.clearTimeout(
        autoTimerRef.current
      );

      autoTimerRef.current = null;
    }

    handleScanSubmit(
      event.currentTarget.value
    );
  };

  const deleteCounterScan = (
    scan
  ) => {
    if (
      !canDeleteScans ||
      !flightId
    ) {
      return;
    }

    const bagTag =
      onlyDigits(
        scan?.tag ||
          scan?.bagTag ||
          scan?.id
      );

    show({
      title:
        "Delete Counter Scan",

      tone:
        "warning",

      content: (
        <div>
          Delete Counter scan{" "}
          <strong>
            {bagTag}
          </strong>
          ?
          <br />
          <br />
          This will not delete an existing
          receiving scan.
        </div>
      ),

      confirmText:
        "Delete",

      cancelText:
        "Cancel",

      showCancel:
        true,

      onConfirm:
        async () => {
          close();

          setDeletingCounterTag(
            bagTag
          );

          try {
            await deleteDoc(
              doc(
                db,
                "flights",
                flightId,
                "counterScans",
                scan.id
              )
            );

            setMsg(
              `Counter scan ${bagTag} deleted.`
            );

            setErr("");
          } catch (error) {
            console.error(
              "Delete Counter scan error:",
              error
            );

            popup(
              "Delete Failed",
              error?.message ||
                "Unable to delete the Counter scan.",
              "error"
            );
          } finally {
            setDeletingCounterTag(
              ""
            );

            focusScanner();
          }
        },

      onCancel: () => {
        close();
        focusScanner();
      },
    });
  };

  const deleteReceivingScan = (
    scan
  ) => {
    if (
      !canDeleteScans ||
      !flightId
    ) {
      return;
    }

    const bagTag =
      onlyDigits(
        scan?.tag ||
          scan?.bagTag ||
          scan?.id
      );

    const locationLabel =
      getScanLocationLabel(scan);

    show({
      title:
        "Delete Receiving Scan",

      tone:
        "warning",

      content: (
        <div>
          Delete receiving scan{" "}
          <strong>
            {bagTag}
          </strong>
          {" "}from{" "}
          <strong>
            {locationLabel}
          </strong>
          ?
          <br />
          <br />
          The bag will return to Pending if
          it exists in Counter scans.
        </div>
      ),

      confirmText:
        "Delete",

      cancelText:
        "Cancel",

      showCancel:
        true,

      onConfirm:
        async () => {
          close();

          setDeletingReceivingTag(
            bagTag
          );

          try {
            await deleteDoc(
              doc(
                db,
                "flights",
                flightId,
                "bagroomScans",
                scan.id
              )
            );

            const trackingRef = doc(
              db,
              "bagTags",
              bagTag
            );

            const trackingSnapshot =
              await getDoc(
                trackingRef
              );

            if (
              trackingSnapshot.exists()
            ) {
              const trackingData =
                trackingSnapshot.data();

              const existingEvents =
                Array.isArray(
                  trackingData.events
                )
                  ? trackingData.events
                  : [];

              const deleteEvent = {
                type:
                  "RECEIVING_SCAN_DELETED",

                event:
                  "RECEIVING_SCAN_DELETED",

                message:
                  `Receiving scan deleted from ${locationLabel}`,

                location:
                  "counter",

                receivingLocation:
                  null,

                locationLabel:
                  "Counter / Pending",

                department:
                  "COUNTER",

                cartNumber:
                  null,

                flightId,

                flightNumber:
                  flight?.flightNumber ||
                  null,

                flightDate:
                  flight?.flightDate ||
                  null,

                gate:
                  flight?.gate || null,

                timestamp:
                  new Date().toISOString(),

                createdBy: {
                  userId:
                    user?.id ||
                    null,

                  username:
                    user?.username ||
                    null,

                  role:
                    user?.role ||
                    null,
                },
              };

              await setDoc(
                trackingRef,
                {
                  location:
                    counterTagSet.has(
                      bagTag
                    )
                      ? "counter"
                      : "unknown",

                  receivingLocation:
                    null,

                  locationLabel:
                    counterTagSet.has(
                      bagTag
                    )
                      ? "Counter / Pending"
                      : "Unknown",

                  department:
                    counterTagSet.has(
                      bagTag
                    )
                      ? "COUNTER"
                      : null,

                  cartNumber:
                    null,

                  lastEvent:
                    "RECEIVING_SCAN_DELETED",

                  lastMessage:
                    deleteEvent.message,

                  matchedCounter:
                    false,

                  updatedAt:
                    serverTimestamp(),

                  updatedBy: {
                    userId:
                      user?.id ||
                      null,

                    username:
                      user?.username ||
                      null,

                    role:
                      user?.role ||
                      null,
                  },

                  events: [
                    ...existingEvents,
                    deleteEvent,
                  ].slice(-100),
                },
                {
                  merge: true,
                }
              );
            }

            setMsg(
              `Receiving scan ${bagTag} deleted.`
            );

            setErr("");
          } catch (error) {
            console.error(
              "Delete receiving scan error:",
              error
            );

            popup(
              "Delete Failed",
              error?.message ||
                "Unable to delete the receiving scan.",
              "error"
            );
          } finally {
            setDeletingReceivingTag(
              ""
            );

            focusScanner();
          }
        },

      onCancel: () => {
        close();
        focusScanner();
      },
    });
  };

  return (
    <div
      style={{
        background:
          "white",

        border:
          "1px solid #e5e7eb",

        borderRadius:
          compactScreen
            ? 8
            : 12,

        padding:
          pagePadding,

        fontSize:
          compactScreen
            ? "14px"
            : "16px",
      }}
      onClick={(event) => {
        const clickedInteractiveElement =
          event.target.closest?.(
            "button,input,select,textarea,a"
          );

        if (
          scannerMode &&
          !clickedInteractiveElement
        ) {
          focusScanner();
        }
      }}
    >
      <header
        style={{
          display:
            "flex",

          flexDirection:
            compactScreen
              ? "column"
              : "row",

          justifyContent:
            "space-between",

          gap:
            8,
        }}
      >
        <div>
          <h2
            style={{
              margin:
                0,

              fontSize:
                compactScreen
                  ? "1.35rem"
                  : "1.5rem",
            }}
          >
            Baggage Receiving
          </h2>

          <p
            style={{
              margin:
                "4px 0 0",

              color:
                "#6b7280",

              fontSize:
                "0.82rem",
            }}
          >
            Select the receiving area and scan
            a 10-digit bag tag.
          </p>
        </div>

        <div
          style={{
            padding:
              compactScreen
                ? 8
                : 0,

            borderRadius:
              8,

            background:
              compactScreen
                ? "#f9fafb"
                : "transparent",

            fontSize:
              "0.82rem",
          }}
        >
          <div>
            Flight:{" "}
            <strong>
              {flightLoading
                ? "…"
                : flight?.flightNumber ||
                  flightId}
            </strong>
          </div>

          <div>
            Date:{" "}
            <strong>
              {flightLoading
                ? "…"
                : flight?.flightDate ||
                  "-"}
            </strong>
          </div>

          <div>
            Gate:{" "}
            <strong>
              {flightLoading
                ? "…"
                : flight?.gate ||
                  "-"}
            </strong>
          </div>
        </div>
      </header>

      {isLoadingCompleted && (
        <div
          style={{
            marginTop:
              10,

            padding:
              10,

            borderRadius:
              10,

            background:
              "#dcfce7",

            color:
              "#166534",

            fontWeight:
              900,

            textAlign:
              "center",
          }}
        >
          ✅ FLIGHT LOADED — SCANNING LOCKED
        </div>
      )}

      <hr
        style={{
          border:
            "none",

          borderTop:
            "1px solid #e5e7eb",

          margin:
            "12px 0",
        }}
      />

      <div
        style={{
          display:
            "grid",

          gridTemplateColumns:
            compactScreen
              ? "1fr"
              : "minmax(320px, 0.85fr) minmax(520px, 1.15fr)",

          gap:
            12,

          alignItems:
            "start",
        }}
      >
        <section
          style={{
            border:
              "1px solid #dbeafe",

            borderRadius:
              12,

            padding:
              compactScreen
                ? 10
                : 14,

            background:
              "#f8fafc",
          }}
        >
          <div
            style={{
              display:
                "flex",

              gap:
                6,

              marginBottom:
                12,
            }}
          >
            <ModeButton
              active={
                scannerMode
              }
              label="Scanner"
              onClick={() =>
                changeScannerMode(
                  true
                )
              }
            />

            <ModeButton
              active={
                !scannerMode
              }
              label="Manual"
              onClick={() =>
                changeScannerMode(
                  false
                )
              }
            />
          </div>

          <h3
            style={{
              margin:
                "0 0 8px",

              fontSize:
                "1rem",
            }}
          >
            1. Receiving Area
          </h3>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",

              gap:
                6,

              marginBottom:
                14,
            }}
          >
            <LocationButton
              label="Bagroom"
              icon="🛄"
              active={
                normalizedReceivingLocation ===
                "BAGROOM"
              }
              disabled={
                isLoadingCompleted
              }
              onClick={() =>
                selectReceivingLocation(
                  "BAGROOM"
                )
              }
            />

            <LocationButton
              label="Oversize"
              icon="📦"
              active={
                normalizedReceivingLocation ===
                "OVERSIZE"
              }
              disabled={
                isLoadingCompleted
              }
              onClick={() =>
                selectReceivingLocation(
                  "OVERSIZE"
                )
              }
            />

            <LocationButton
              label="Gate / Ramp"
              icon="🚪"
              active={
                normalizedReceivingLocation ===
                "GATE"
              }
              disabled={
                isLoadingCompleted
              }
              onClick={() =>
                selectReceivingLocation(
                  "GATE"
                )
              }
            />
          </div>
                    <div
            style={{
              padding: 10,
              borderRadius: 10,

              border: `1px solid ${
                normalizedReceivingLocation ===
                "BAGROOM"
                  ? "#bfdbfe"
                  : normalizedReceivingLocation ===
                      "OVERSIZE"
                    ? "#fed7aa"
                    : "#ddd6fe"
              }`,

              background:
                normalizedReceivingLocation ===
                "BAGROOM"
                  ? "#eff6ff"
                  : normalizedReceivingLocation ===
                      "OVERSIZE"
                    ? "#fff7ed"
                    : "#f5f3ff",

              color:
                normalizedReceivingLocation ===
                "BAGROOM"
                  ? "#1d4ed8"
                  : normalizedReceivingLocation ===
                      "OVERSIZE"
                    ? "#9a3412"
                    : "#5b21b6",

              textAlign: "center",
              fontWeight: 900,
              marginBottom: 12,
            }}
          >
            {receivingLocationConfig.icon}{" "}
            Active Area:{" "}
            {receivingLocationConfig.label}
          </div>

          {isRegularBagroom ? (
            <>
              <h3
                style={{
                  margin: "0 0 8px",
                  fontSize: "1rem",
                }}
              >
                2. Select Cart
              </h3>

              {availableCarts.length > 0 && (
                <div
                  style={{
                    display: "grid",

                    gridTemplateColumns:
                      "repeat(3, minmax(0, 1fr))",

                    gap: 6,
                    marginBottom: 8,
                  }}
                >
                  {availableCarts.map(
                    (cart) => (
                      <button
                        key={cart}
                        type="button"
                        onPointerDown={(
                          event
                        ) => {
                          event.stopPropagation();
                        }}
                        onClick={(
                          event
                        ) => {
                          event.preventDefault();
                          event.stopPropagation();

                          selectCart(cart);
                        }}
                        disabled={
                          isLoadingCompleted
                        }
                        style={{
                          minHeight: 46,
                          padding: "6px 4px",
                          borderRadius: 10,

                          border:
                            selectedCart ===
                            cart
                              ? "2px solid #16a34a"
                              : "1px solid #d1d5db",

                          background:
                            selectedCart ===
                            cart
                              ? "#dcfce7"
                              : isLoadingCompleted
                                ? "#f3f4f6"
                                : "white",

                          color:
                            selectedCart ===
                            cart
                              ? "#166534"
                              : "#111827",

                          fontWeight: 900,
                          fontSize: "1rem",

                          cursor:
                            isLoadingCompleted
                              ? "not-allowed"
                              : "pointer",

                          touchAction:
                            "manipulation",

                          WebkitTapHighlightColor:
                            "transparent",
                        }}
                      >
                        {cart}
                      </button>
                    )
                  )}
                </div>
              )}

              <input
                value={cartNumber}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onChange={(event) => {
                  selectCart(
                    event.target.value
                  );
                }}
                disabled={
                  isLoadingCompleted
                }
                placeholder="Cart number"
                autoComplete="off"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: 50,
                  padding: "10px 12px",
                  borderRadius: 10,

                  border:
                    "1px solid #d1d5db",

                  background:
                    isLoadingCompleted
                      ? "#f3f4f6"
                      : "white",

                  fontSize: "1rem",
                  fontWeight: 900,

                  textTransform:
                    "uppercase",
                }}
              />

              <div
                style={{
                  marginTop: 8,
                  padding: 10,
                  borderRadius: 10,

                  background:
                    selectedCart
                      ? "#dcfce7"
                      : "#fef3c7",

                  color:
                    selectedCart
                      ? "#166534"
                      : "#92400e",

                  fontWeight: 900,
                  textAlign: "center",
                }}
              >
                {selectedCart
                  ? `ACTIVE CART: ${selectedCart}`
                  : "CART REQUIRED"}
              </div>
            </>
          ) : (
            <div
              style={{
                padding: 12,
                borderRadius: 10,

                background:
                  normalizedReceivingLocation ===
                  "OVERSIZE"
                    ? "#ffedd5"
                    : "#ede9fe",

                color:
                  normalizedReceivingLocation ===
                  "OVERSIZE"
                    ? "#9a3412"
                    : "#5b21b6",

                fontWeight: 900,
                textAlign: "center",
              }}
            >
              {normalizedReceivingLocation ===
              "OVERSIZE"
                ? "📦 Cart is not required for Oversize"
                : "🚪 Receiving at Gate as Ramp"}
            </div>
          )}

          <hr
            style={{
              border: "none",

              borderTop:
                "1px solid #e5e7eb",

              margin: "14px 0",
            }}
          />

          <h3
            style={{
              margin: "0 0 8px",
              fontSize: "1rem",
            }}
          >
            {isRegularBagroom
              ? "3. Scan Bag Tag"
              : "2. Scan Bag Tag"}
          </h3>

          <input
            ref={inputRef}
            value={tagInput}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={
              isLoadingCompleted ||
              !locationReady
            }
            inputMode={
              scannerMode
                ? "none"
                : "numeric"
            }
            pattern="[0-9]*"
            maxLength={BAG_TAG_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={
              isLoadingCompleted
                ? "FLIGHT LOCKED"
                : !locationReady
                  ? "SELECT CART FIRST"
                  : "SCAN 10 DIGITS"
            }
            style={{
              width: "100%",
              boxSizing: "border-box",

              minHeight:
                compactScreen
                  ? 62
                  : 54,

              padding: "10px 12px",
              borderRadius: 12,

              border:
                tagInput.length ===
                BAG_TAG_LENGTH
                  ? "3px solid #16a34a"
                  : "2px solid #2563eb",

              background:
                isLoadingCompleted ||
                !locationReady
                  ? "#f3f4f6"
                  : "white",

              color: "#111827",

              fontSize:
                compactScreen
                  ? "1.45rem"
                  : "1.2rem",

              fontWeight: 900,
              textAlign: "center",
              letterSpacing: "0.08em",

              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          />

          <div
            style={{
              display: "flex",

              justifyContent:
                "space-between",

              marginTop: 6,
              gap: 8,

              fontSize:
                "0.8rem",
            }}
          >
            <span
              style={{
                color:
                  scannerMode
                    ? "#2563eb"
                    : "#6b7280",

                fontWeight: 800,
              }}
            >
              {scannerMode
                ? "Hardware scanner active"
                : "Manual keyboard active"}
            </span>

            <strong
              style={{
                color:
                  tagInput.length ===
                  BAG_TAG_LENGTH
                    ? "#16a34a"
                    : "#6b7280",
              }}
            >
              {tagInput.length}/
              {BAG_TAG_LENGTH}
            </strong>
          </div>

          <button
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();

              handleScanSubmit();
            }}
            disabled={
              isLoadingCompleted ||
              !locationReady ||
              tagInput.length !==
                BAG_TAG_LENGTH
            }
            style={{
              width: "100%",
              minHeight: 54,
              marginTop: 10,
              borderRadius: 12,

              border:
                "1px solid #1d4ed8",

              background:
                isLoadingCompleted ||
                !locationReady ||
                tagInput.length !==
                  BAG_TAG_LENGTH
                  ? "#93c5fd"
                  : "#2563eb",

              color: "white",
              fontWeight: 900,
              fontSize: "1rem",

              cursor:
                isLoadingCompleted ||
                !locationReady ||
                tagInput.length !==
                  BAG_TAG_LENGTH
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            SAVE{" "}
            {receivingLocationConfig.label.toUpperCase()}{" "}
            SCAN
          </button>

          {msg && (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 10,

                background:
                  "#dcfce7",

                color:
                  "#166534",

                fontWeight: 900,
                textAlign: "center",
              }}
            >
              {msg}
            </div>
          )}

          {err && (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 10,

                background:
                  "#fee2e2",

                color:
                  "#991b1b",

                fontWeight: 900,
                textAlign: "center",
              }}
            >
              {err}
            </div>
          )}

          {strictManifest && (
            <p
              style={{
                color: "#b91c1c",

                fontSize:
                  "0.78rem",

                fontWeight:
                  900,
              }}
            >
              ⚠️ Strict Manifest ON
            </p>
          )}
        </section>

        <section
          style={{
            border:
              "1px solid #e5e7eb",

            borderRadius:
              12,

            padding:
              compactScreen
                ? 8
                : 12,

            minWidth:
              0,
          }}
        >
          <h3
            style={{
              marginTop: 0,
            }}
          >
            Counter → Receiving
          </h3>

          <div
            style={{
              display: "grid",

              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",

              gap: 6,
            }}
          >
            <SummaryCard
              label="Counter"
              value={
                loadingCounterScans
                  ? "…"
                  : counterScans.length
              }
              background="#eff6ff"
              color="#1d4ed8"
            />

            <SummaryCard
              label="Received"
              value={
                dataLoading
                  ? "…"
                  : receivedCounterScans.length
              }
              background="#dcfce7"
              color="#166534"
            />

            <SummaryCard
              label="Pending"
              value={
                dataLoading
                  ? "…"
                  : pendingCounterScans.length
              }
              background="#fee2e2"
              color="#991b1b"
            />
          </div>

          <div
            style={{
              display: "grid",

              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",

              gap: 6,
              marginTop: 6,
            }}
          >
            <SummaryCard
              label="Bagroom"
              value={
                loadingScans
                  ? "…"
                  : bagroomScanCount
              }
              background="#eff6ff"
              color="#1d4ed8"
            />

            <SummaryCard
              label="Oversize"
              value={
                loadingScans
                  ? "…"
                  : oversizeScanCount
              }
              background="#ffedd5"
              color="#9a3412"
            />

            <SummaryCard
              label="Gate / Ramp"
              value={
                loadingScans
                  ? "…"
                  : gateRampScanCount
              }
              background="#ede9fe"
              color="#5b21b6"
            />
          </div>

          <div
            style={{
              marginTop: 10,

              maxHeight:
                compactScreen
                  ? 330
                  : 430,

              overflow:
                "auto",
            }}
          >
            {dataLoading ? (
              <p>Loading scans…</p>
            ) : counterScans.length ===
              0 ? (
              <p
                style={{
                  color: "#6b7280",
                }}
              >
                No Counter scans.
              </p>
            ) : compactScreen ? (
              counterScans.map(
                (scan) => {
                  const tag =
                    onlyDigits(
                      scan.tag ||
                        scan.bagTag ||
                        scan.id
                    );

                  const received =
                    receivedTagSet.has(
                      tag
                    );

                  const receivedScan =
                    receivedScanByTag.get(
                      tag
                    );

                  const subtitle =
                    receivedScan
                      ? `${getBagTypeLabel(
                          scan.bagType
                        )} · ${getScanLocationLabel(
                          receivedScan
                        )}`
                      : getBagTypeLabel(
                          scan.bagType
                        );

                  return (
                    <ScanCard
                      key={scan.id}
                      tag={tag}
                      subtitle={subtitle}
                      status={
                        received
                          ? "RECEIVED"
                          : "PENDING"
                      }
                      success={received}
                      username={
                        scan.scannedBy
                          ?.username ||
                        scan.createdBy
                          ?.username ||
                        "-"
                      }
                      canDelete={
                        canDeleteScans
                      }
                      deleting={
                        deletingCounterTag ===
                        tag
                      }
                      onDelete={() => {
                        deleteCounterScan(
                          scan
                        );
                      }}
                    />
                  );
                }
              )
            ) : (
              <table
                style={tableStyle}
              >
                <thead>
                  <tr>
                    <th style={th}>
                      Bag Tag
                    </th>

                    <th style={th}>
                      Type
                    </th>

                    <th style={th}>
                      Status
                    </th>

                    <th style={th}>
                      Last Area
                    </th>

                    <th style={th}>
                      User
                    </th>

                    {canDeleteScans && (
                      <th
                        style={{
                          ...th,

                          textAlign:
                            "right",
                        }}
                      >
                        Action
                      </th>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {counterScans.map(
                    (scan) => {
                      const tag =
                        onlyDigits(
                          scan.tag ||
                            scan.bagTag ||
                            scan.id
                        );

                      const received =
                        receivedTagSet.has(
                          tag
                        );

                      const receivedScan =
                        receivedScanByTag.get(
                          tag
                        );

                      return (
                        <tr
                          key={scan.id}
                          style={{
                            background:
                              received
                                ? "#f0fdf4"
                                : "#fef2f2",
                          }}
                        >
                          <td style={td}>
                            <strong>
                              {tag}
                            </strong>
                          </td>

                          <td style={td}>
                            {getBagTypeLabel(
                              scan.bagType
                            )}
                          </td>

                          <td style={td}>
                            <StatusBadge
                              received={
                                received
                              }
                            />
                          </td>

                          <td style={td}>
                            {receivedScan
                              ? getScanLocationLabel(
                                  receivedScan
                                )
                              : "-"}
                          </td>

                          <td style={td}>
                            {scan.scannedBy
                              ?.username ||
                              scan.createdBy
                                ?.username ||
                              "-"}
                          </td>

                          {canDeleteScans && (
                            <td
                              style={{
                                ...td,

                                textAlign:
                                  "right",
                              }}
                            >
                              <DeleteButton
                                busy={
                                  deletingCounterTag ===
                                  tag
                                }
                                onClick={() => {
                                  deleteCounterScan(
                                    scan
                                  );
                                }}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            )}
          </div>

          <hr
            style={{
              border: "none",

              borderTop:
                "1px solid #e5e7eb",

              margin: "14px 0",
            }}
          />

          <h3>
            Received Bags
          </h3>

          <div
            style={{
              display: "grid",

              gridTemplateColumns:
                "repeat(2, minmax(0, 1fr))",

              gap: 6,
            }}
          >
            <SummaryCard
              label="Total Received"
              value={
                loadingScans
                  ? "…"
                  : scans.length
              }
              background="#dcfce7"
              color="#166534"
            />

            <SummaryCard
              label="No Counter"
              value={
                dataLoading
                  ? "…"
                  : receivedWithoutCounter.length
              }
              background={
                receivedWithoutCounter.length
                  ? "#ffedd5"
                  : "#f3f4f6"
              }
              color={
                receivedWithoutCounter.length
                  ? "#9a3412"
                  : "#374151"
              }
            />
          </div>
                    <div
            style={{
              marginTop: 10,

              maxHeight:
                compactScreen
                  ? 330
                  : 430,

              overflow:
                "auto",
            }}
          >
            {loadingScans ? (
              <p>
                Loading receiving scans…
              </p>
            ) : scans.length === 0 ? (
              <p
                style={{
                  color: "#6b7280",
                }}
              >
                No receiving scans.
              </p>
            ) : compactScreen ? (
              scans.map((scan) => {
                const tag =
                  onlyDigits(
                    scan.tag ||
                      scan.bagTag ||
                      scan.id
                  );

                const matched =
                  counterTagSet.has(
                    tag
                  );

                const locationLabel =
                  getScanLocationLabel(
                    scan
                  );

                const scanLocation =
                  getScanReceivingLocation(
                    scan
                  );

                const subtitle =
                  scanLocation ===
                  "BAGROOM"
                    ? `${locationLabel} · Cart ${
                        scan.cartNumber ||
                        "-"
                      }`
                    : locationLabel;

                return (
                  <ScanCard
                    key={scan.id}
                    tag={tag}
                    subtitle={subtitle}
                    status={
                      matched
                        ? "MATCHED"
                        : "NO COUNTER"
                    }
                    success={matched}
                    warning={!matched}
                    username={
                      scan.scannedBy
                        ?.username ||
                      scan.createdBy
                        ?.username ||
                      "-"
                    }
                    canDelete={
                      canDeleteScans
                    }
                    deleting={
                      deletingReceivingTag ===
                      tag
                    }
                    onDelete={() => {
                      deleteReceivingScan(
                        scan
                      );
                    }}
                  />
                );
              })
            ) : (
              <table
                style={tableStyle}
              >
                <thead>
                  <tr>
                    <th style={th}>
                      Bag Tag
                    </th>

                    <th style={th}>
                      Location
                    </th>

                    <th style={th}>
                      Cart
                    </th>

                    <th style={th}>
                      Match
                    </th>

                    <th style={th}>
                      User
                    </th>

                    {canDeleteScans && (
                      <th
                        style={{
                          ...th,

                          textAlign:
                            "right",
                        }}
                      >
                        Action
                      </th>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {scans.map(
                    (scan) => {
                      const tag =
                        onlyDigits(
                          scan.tag ||
                            scan.bagTag ||
                            scan.id
                        );

                      const matched =
                        counterTagSet.has(
                          tag
                        );

                      const scanLocation =
                        getScanReceivingLocation(
                          scan
                        );

                      return (
                        <tr
                          key={scan.id}
                          style={{
                            background:
                              matched
                                ? "#f0fdf4"
                                : "#fff7ed",
                          }}
                        >
                          <td style={td}>
                            <strong>
                              {tag}
                            </strong>
                          </td>

                          <td style={td}>
                            {getScanLocationLabel(
                              scan
                            )}
                          </td>

                          <td style={td}>
                            {scanLocation ===
                            "BAGROOM"
                              ? scan.cartNumber ||
                                "-"
                              : "N/A"}
                          </td>

                          <td style={td}>
                            <MatchBadge
                              matched={
                                matched
                              }
                            />
                          </td>

                          <td style={td}>
                            {scan.scannedBy
                              ?.username ||
                              scan.createdBy
                                ?.username ||
                              "-"}
                          </td>

                          {canDeleteScans && (
                            <td
                              style={{
                                ...td,

                                textAlign:
                                  "right",
                              }}
                            >
                              <DeleteButton
                                busy={
                                  deletingReceivingTag ===
                                  tag
                                }
                                onClick={() => {
                                  deleteReceivingScan(
                                    scan
                                  );
                                }}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <section
        style={{
          marginTop:
            12,

          border:
            "1px solid #e5e7eb",

          borderRadius:
            12,

          padding:
            compactScreen
              ? 8
              : 12,

          background:
            "#f9fafb",
        }}
      >
        <h3
          style={{
            marginTop:
              0,
          }}
        >
          Received Bags by Area
        </h3>

        {loadingScans ? (
          <p>
            Loading…
          </p>
        ) : scans.length === 0 ? (
          <p
            style={{
              color:
                "#6b7280",
            }}
          >
            No scans yet.
          </p>
        ) : (
          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                compactScreen
                  ? "1fr"
                  : "repeat(auto-fit, minmax(260px, 1fr))",

              gap:
                8,
            }}
          >
            {Object.keys(
              groupedByReceivingArea
            )
              .sort((a, b) =>
                String(a).localeCompare(
                  String(b),
                  undefined,
                  {
                    numeric:
                      true,
                  }
                )
              )
              .map((groupName) => {
                const groupScans =
                  groupedByReceivingArea[
                    groupName
                  ];

                const firstScan =
                  groupScans[0];

                const scanLocation =
                  getScanReceivingLocation(
                    firstScan
                  );

                const groupActive =
                  scanLocation ===
                    normalizedReceivingLocation &&
                  (
                    scanLocation !==
                      "BAGROOM" ||
                    groupName ===
                      selectedCart
                  );

                return (
                  <div
                    key={groupName}
                    style={{
                      border:
                        "1px solid #e5e7eb",

                      borderRadius:
                        10,

                      background:
                        "white",

                      overflow:
                        "hidden",
                    }}
                  >
                    <button
                      type="button"
                      onPointerDown={(
                        event
                      ) => {
                        event.stopPropagation();
                      }}
                      onClick={(
                        event
                      ) => {
                        event.preventDefault();
                        event.stopPropagation();

                        if (
                          scanLocation ===
                          "BAGROOM"
                        ) {
                          selectReceivingLocation(
                            "BAGROOM"
                          );

                          window.setTimeout(
                            () => {
                              selectCart(
                                groupName
                              );
                            },
                            50
                          );
                        } else {
                          selectReceivingLocation(
                            scanLocation
                          );
                        }
                      }}
                      disabled={
                        isLoadingCompleted
                      }
                      style={{
                        width:
                          "100%",

                        border:
                          "none",

                        padding:
                          "10px",

                        background:
                          groupActive
                            ? "#166534"
                            : scanLocation ===
                                "OVERSIZE"
                              ? "#9a3412"
                              : scanLocation ===
                                  "GATE"
                                ? "#5b21b6"
                                : "#111827",

                        color:
                          "white",

                        display:
                          "flex",

                        justifyContent:
                          "space-between",

                        gap:
                          8,

                        fontWeight:
                          900,

                        cursor:
                          isLoadingCompleted
                            ? "not-allowed"
                            : "pointer",

                        opacity:
                          isLoadingCompleted
                            ? 0.7
                            : 1,

                        touchAction:
                          "manipulation",

                        WebkitTapHighlightColor:
                          "transparent",
                      }}
                    >
                      <span>
                        {scanLocation ===
                        "BAGROOM"
                          ? `Cart ${groupName}`
                          : groupName}
                      </span>

                      <span>
                        {
                          groupScans.length
                        }{" "}
                        bags
                      </span>
                    </button>

                    <div
                      style={{
                        padding:
                          8,

                        display:
                          "flex",

                        flexWrap:
                          "wrap",

                        gap:
                          5,
                      }}
                    >
                      {groupScans.map(
                        (scan) => {
                          const tag =
                            onlyDigits(
                              scan.tag ||
                                scan.bagTag ||
                                scan.id
                            );

                          const matched =
                            counterTagSet.has(
                              tag
                            );

                          return (
                            <span
                              key={
                                scan.id
                              }
                              style={{
                                padding:
                                  "4px 7px",

                                borderRadius:
                                  999,

                                background:
                                  matched
                                    ? "#dcfce7"
                                    : "#ffedd5",

                                color:
                                  matched
                                    ? "#166534"
                                    : "#9a3412",

                                fontFamily:
                                  "ui-monospace, monospace",

                                fontWeight:
                                  800,

                                fontSize:
                                  "0.75rem",
                              }}
                            >
                              {tag}
                            </span>
                          );
                        }
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      <Modal
        open={modal.open}
        title={modal.title}
        tone={modal.tone}
        confirmText={
          modal.confirmText
        }
        cancelText={
          modal.cancelText
        }
        showCancel={
          modal.showCancel
        }
        onConfirm={() => {
          if (
            typeof modal.onConfirm ===
            "function"
          ) {
            modal.onConfirm();
          } else {
            close();
            focusScanner();
          }
        }}
        onCancel={() => {
          if (
            typeof modal.onCancel ===
            "function"
          ) {
            modal.onCancel();
          } else {
            close();
            focusScanner();
          }
        }}
      >
        {modal.content}
      </Modal>
    </div>
  );
}

function LocationButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}) {
  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (
          typeof onClick ===
          "function"
        ) {
          onClick();
        }
      }}
      disabled={disabled}
      style={{
        minHeight:
          62,

        padding:
          "7px 4px",

        borderRadius:
          10,

        border:
          active
            ? "2px solid #2563eb"
            : "1px solid #d1d5db",

        background:
          active
            ? "#dbeafe"
            : disabled
              ? "#f3f4f6"
              : "white",

        color:
          active
            ? "#1d4ed8"
            : "#374151",

        fontWeight:
          900,

        cursor:
          disabled
            ? "not-allowed"
            : "pointer",

        opacity:
          disabled
            ? 0.7
            : 1,

        touchAction:
          "manipulation",

        WebkitTapHighlightColor:
          "transparent",
      }}
    >
      <div
        style={{
          fontSize:
            "1.2rem",
        }}
      >
        {icon}
      </div>

      <div
        style={{
          marginTop:
            2,

          fontSize:
            "0.72rem",
        }}
      >
        {label}
      </div>
    </button>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}) {
  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (
          typeof onClick ===
          "function"
        ) {
          onClick();
        }
      }}
      style={{
        flex:
          1,

        minHeight:
          44,

        borderRadius:
          10,

        border:
          active
            ? "2px solid #2563eb"
            : "1px solid #d1d5db",

        background:
          active
            ? "#dbeafe"
            : "white",

        color:
          active
            ? "#1d4ed8"
            : "#374151",

        fontWeight:
          900,

        cursor:
          "pointer",

        touchAction:
          "manipulation",

        WebkitTapHighlightColor:
          "transparent",
      }}
    >
      {label}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  background,
  color,
}) {
  return (
    <div
      style={{
        minWidth:
          0,

        padding:
          "9px 4px",

        borderRadius:
          10,

        background,

        color,

        textAlign:
          "center",

        border:
          "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          fontSize:
            "0.68rem",

          fontWeight:
            900,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize:
            "1.25rem",

          fontWeight:
            900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ScanCard({
  tag,
  subtitle,
  status,
  success,
  warning,
  username,
  canDelete,
  deleting,
  onDelete,
}) {
  const background =
    success
      ? "#f0fdf4"
      : warning
        ? "#fff7ed"
        : "#fef2f2";

  const color =
    success
      ? "#166534"
      : warning
        ? "#9a3412"
        : "#991b1b";

  return (
    <div
      style={{
        marginBottom:
          6,

        padding:
          9,

        borderRadius:
          10,

        background,

        border:
          `1px solid ${color}33`,
      }}
    >
      <div
        style={{
          display:
            "flex",

          justifyContent:
            "space-between",

          gap:
            6,

          alignItems:
            "center",
        }}
      >
        <strong
          style={{
            fontFamily:
              "ui-monospace, monospace",

            fontSize:
              "0.95rem",
          }}
        >
          {tag}
        </strong>

        <span
          style={{
            padding:
              "3px 7px",

            borderRadius:
              999,

            background:
              "white",

            color,

            fontSize:
              "0.65rem",

            fontWeight:
              900,
          }}
        >
          {status}
        </span>
      </div>

      <div
        style={{
          marginTop:
            5,

          display:
            "flex",

          justifyContent:
            "space-between",

          alignItems:
            "center",

          gap:
            6,

          color:
            "#6b7280",

          fontSize:
            "0.75rem",
        }}
      >
        <span>
          {subtitle} · {username}
        </span>

        {canDelete && (
          <DeleteButton
            busy={deleting}
            onClick={onDelete}
          />
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  received,
}) {
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
          received
            ? "#dcfce7"
            : "#fee2e2",

        color:
          received
            ? "#166534"
            : "#991b1b",

        fontSize:
          "0.68rem",

        fontWeight:
          900,
      }}
    >
      {received
        ? "RECEIVED"
        : "PENDING"}
    </span>
  );
}

function MatchBadge({
  matched,
}) {
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
          matched
            ? "#dcfce7"
            : "#ffedd5",

        color:
          matched
            ? "#166534"
            : "#9a3412",

        fontSize:
          "0.68rem",

        fontWeight:
          900,
      }}
    >
      {matched
        ? "MATCHED"
        : "NO COUNTER"}
    </span>
  );
}

function DeleteButton({
  busy,
  onClick,
}) {
  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (
          typeof onClick ===
          "function"
        ) {
          onClick();
        }
      }}
      disabled={busy}
      style={{
        minHeight:
          32,

        padding:
          "4px 8px",

        borderRadius:
          999,

        border:
          "1px solid #ef4444",

        background:
          busy
            ? "#fca5a5"
            : "#ef4444",

        color:
          "white",

        fontSize:
          "0.7rem",

        fontWeight:
          900,

        cursor:
          busy
            ? "not-allowed"
            : "pointer",

        opacity:
          busy
            ? 0.7
            : 1,

        touchAction:
          "manipulation",

        WebkitTapHighlightColor:
          "transparent",
      }}
    >
      {busy
        ? "…"
        : "Delete"}
    </button>
  );
}

const tableStyle = {
  width:
    "100%",

  borderCollapse:
    "collapse",
};

const th = {
  textAlign:
    "left",

  padding:
    "9px 7px",

  borderBottom:
    "1px solid #e5e7eb",

  fontSize:
    "0.72rem",

  textTransform:
    "uppercase",

  color:
    "#6b7280",

  whiteSpace:
    "nowrap",
};

const td = {
  padding:
    "9px 7px",

  borderBottom:
    "1px solid #f3f4f6",

  color:
    "#111827",

  verticalAlign:
    "middle",
};

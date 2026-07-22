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
  const location = String(value || "BAGROOM")
    .trim()
    .toUpperCase();

  return RECEIVING_LOCATIONS[location]
    ? location
    : "BAGROOM";
}

function getReceivingLocationConfig(value) {
  return (
    RECEIVING_LOCATIONS[
      normalizeReceivingLocation(value)
    ] || RECEIVING_LOCATIONS.BAGROOM
  );
}

function getScanLocationLabel(scan) {
  if (scan?.locationLabel) {
    return String(scan.locationLabel);
  }

  const location =
    scan?.receivingLocation ||
    scan?.location ||
    "BAGROOM";

  return getReceivingLocationConfig(location).label;
}

function getScanGroupName(scan) {
  const location = normalizeReceivingLocation(
    scan?.receivingLocation ||
      scan?.location
  );

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
  ] = useState(() => {
    return (
      localStorage.getItem(
        `bagroomReceivingLocation_${flightId}`
      ) || "BAGROOM"
    );
  });

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

  const [cartNumber, setCartNumber] = useState(
    () => {
      return (
        localStorage.getItem(
          `bagroomLastRegularCart_${flightId}`
        ) ||
        localStorage.getItem(
          `bagroomCart_${flightId}`
        ) ||
        ""
      );
    }
  );

  const selectedCart =
    normalizeCartNumber(cartNumber);

  /*
   * A cart is required only when the
   * selected receiving area is Bagroom.
   *
   * Oversize and Gate/Ramp can scan
   * without selecting a cart.
   */
  const locationReady =
    !isRegularBagroom ||
    Boolean(selectedCart);

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

  const inputRef = useRef(null);

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
    deletingBagroomTag,
    setDeletingBagroomTag,
  ] = useState("");

  const autoTimerRef = useRef(null);
  const isSubmittingRef = useRef(false);

  const lastSubmittedTagRef =
    useRef("");

  const lastSubmittedTimeRef =
    useRef(0);

  const { modal, show, close } =
    useModal();

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
    }, 100);
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
        normalizeReceivingLocation(
          scan.receivingLocation ||
            scan.location
        );

      /*
       * Only regular Bagroom carts
       * appear as selectable carts.
       */
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
   * All receiving scans count as
   * received from Counter:
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

      for (const scan of scans) {
        const groupName =
          getScanGroupName(scan);

        if (!groups[groupName]) {
          groups[groupName] = [];
        }

        groups[groupName].push(scan);
      }

      return groups;
    }, [scans]);

  const bagroomScanCount = useMemo(() => {
    return scans.filter((scan) => {
      return (
        normalizeReceivingLocation(
          scan.receivingLocation ||
            scan.location
        ) === "BAGROOM"
      );
    }).length;
  }, [scans]);

  const oversizeScanCount = useMemo(() => {
    return scans.filter((scan) => {
      return (
        normalizeReceivingLocation(
          scan.receivingLocation ||
            scan.location
        ) === "OVERSIZE"
      );
    }).length;
  }, [scans]);

  const gateRampScanCount = useMemo(() => {
    return scans.filter((scan) => {
      return (
        normalizeReceivingLocation(
          scan.receivingLocation ||
            scan.location
        ) === "GATE"
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

      (snapshot) => {
        if (!snapshot.exists()) {
          setFlight(null);
          setFlightLoading(false);
          return;
        }

        const data = {
          id: snapshot.id,
          ...snapshot.data(),
        };

        setFlight(data);

        if (
          typeof data.strictManifest ===
          "boolean"
        ) {
          setStrictManifest(
            data.strictManifest
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

    return () => unsub();
  }, [flightId]);

  /*
   * Receiving scans subscription.
   *
   * All three reception areas are saved
   * in bagroomScans so the Counter match
   * recognizes them as received.
   */
  useEffect(() => {
    if (!flightId) {
      setScans([]);
      setLoadingScans(false);
      return;
    }

    setLoadingScans(true);

    const receivingRef = collection(
      db,
      "flights",
      flightId,
      "bagroomScans"
    );

    const unsub = onSnapshot(
      receivingRef,

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

    return () => unsub();
  }, [flightId]);

  /*
   * Counter scans subscription.
   */
  useEffect(() => {
    if (!flightId) {
      setCounterScans([]);
      setLoadingCounterScans(false);
      return;
    }

    setLoadingCounterScans(true);

    const counterRef = collection(
      db,
      "flights",
      flightId,
      "counterScans"
    );

    const unsub = onSnapshot(
      counterRef,

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

    return () => unsub();
  }, [flightId]);

  /*
   * Restore the saved receiving area
   * whenever the selected flight changes.
   */
  useEffect(() => {
    const savedLocation =
      localStorage.getItem(
        `bagroomReceivingLocation_${flightId}`
      ) || "BAGROOM";

    setReceivingLocation(
      normalizeReceivingLocation(
        savedLocation
      )
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
  }, [flightId]);

  useEffect(() => {
    focusScanner();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCart,
    normalizedReceivingLocation,
    scannerMode,
    isLoadingCompleted,
  ]);

  useEffect(() => {
    return () => {
      if (autoTimerRef.current) {
        clearTimeout(
          autoTimerRef.current
        );
      }
    };
  }, []);
    const ensureStatusReceiving = async () => {
    if (!flight) return;

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
      doc(db, "flights", flightId),
      {
        status: "RECEIVING",

        statusUpdatedAt:
          serverTimestamp(),

        statusUpdatedBy: {
          userId: user?.id || null,
          username:
            user?.username || null,
          role: user?.role || null,
        },
      },
      {
        merge: true,
      }
    );
  };

  const saveCartToFlight = async () => {
    if (
      !isRegularBagroom ||
      !selectedCart ||
      !flightId
    ) {
      return;
    }

    const existingCarts =
      Array.isArray(
        flight?.cartNumbers
      )
        ? flight.cartNumbers
            .map(
              normalizeCartNumber
            )
            .filter(Boolean)
        : [];

    if (
      existingCarts.includes(
        selectedCart
      )
    ) {
      return;
    }

    const nextCarts = [
      ...existingCarts,
      selectedCart,
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
            user?.username ||
            null,

          role:
            user?.role ||
              return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: compactScreen ? 8 : 12,
        padding: pagePadding,
        fontSize: compactScreen
          ? "14px"
          : "16px",
      }}
      onClick={() => {
        if (scannerMode) {
          focusScanner();
        }
      }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: compactScreen
            ? "column"
            : "row",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: compactScreen
                ? "1.35rem"
                : "1.5rem",
            }}
          >
            Baggage Receiving
          </h2>

          <p
            style={{
              margin: "4px 0 0",
              color: "#6b7280",
              fontSize: "0.82rem",
            }}
          >
            Select the receiving area and scan
            a 10-digit bag tag.
          </p>
        </div>

        <div
          style={{
            padding: compactScreen ? 8 : 0,
            borderRadius: 8,
            background: compactScreen
              ? "#f9fafb"
              : "transparent",
            fontSize: "0.82rem",
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
                : flight?.flightDate || "-"}
            </strong>
          </div>

          <div>
            Gate:{" "}
            <strong>
              {flightLoading
                ? "…"
                : flight?.gate || "-"}
            </strong>
          </div>
        </div>
      </header>

      {isLoadingCompleted && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 10,
            background: "#dcfce7",
            color: "#166534",
            fontWeight: 900,
            textAlign: "center",
          }}
        >
          ✅ FLIGHT LOADED — SCANNING LOCKED
        </div>
      )}

      <hr
        style={{
          border: "none",
          borderTop: "1px solid #e5e7eb",
          margin: "12px 0",
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compactScreen
            ? "1fr"
            : "minmax(320px, 0.85fr) minmax(520px, 1.15fr)",
          gap: 12,
          alignItems: "start",
        }}
      >
        <section
          style={{
            border: "1px solid #dbeafe",
            borderRadius: 12,
            padding: compactScreen ? 10 : 14,
            background: "#f8fafc",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 12,
            }}
          >
            <ModeButton
              active={scannerMode}
              label="Scanner"
              onClick={() =>
                changeScannerMode(true)
              }
            />

            <ModeButton
              active={!scannerMode}
              label="Manual"
              onClick={() =>
                changeScannerMode(false)
              }
            />
          </div>

          <h3
            style={{
              margin: "0 0 8px",
              fontSize: "1rem",
            }}
          >
            1. Receiving Area
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",
              gap: 6,
              marginBottom: 14,
            }}
          >
            <LocationButton
              label="Bagroom"
              icon="🛄"
              active={
                normalizedReceivingLocation ===
                "BAGROOM"
              }
              disabled={isLoadingCompleted}
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
              disabled={isLoadingCompleted}
              onClick={() =>
                selectReceivingLocation(
                  "OVERSIZE"
                )
              }
            />

            <LocationButton
              label="Gate"
              icon="🚪"
              active={
                normalizedReceivingLocation ===
                "GATE"
              }
              disabled={isLoadingCompleted}
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
                        onClick={() =>
                          selectCart(cart)
                        }
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
                onChange={(event) =>
                  selectCart(
                    event.target.value
                  )
                }
                disabled={isLoadingCompleted}
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
                  background: selectedCart
                    ? "#dcfce7"
                    : "#fef3c7",
                  color: selectedCart
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
              minHeight: compactScreen
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
              fontSize: compactScreen
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
              fontSize: "0.8rem",
            }}
          >
            <span
              style={{
                color: scannerMode
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
            onClick={() =>
              handleScanSubmit()
            }
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
            SAVE {receivingLocationConfig.label.toUpperCase()} SCAN
          </button>

          {msg && (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 10,
                background: "#dcfce7",
                color: "#166534",
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
                background: "#fee2e2",
                color: "#991b1b",
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
                fontSize: "0.78rem",
                fontWeight: 900,
              }}
            >
              ⚠️ Strict Manifest ON
            </p>
          )}
        </section>

        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: compactScreen
              ? 8
              : 12,
            minWidth: 0,
          }}
        >
          <h3 style={{ marginTop: 0 }}>
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
              maxHeight: compactScreen
                ? 330
                : 430,
              overflow: "auto",
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
                    scans.find(
                      (row) =>
                        onlyDigits(
                          row.tag ||
                            row.bagTag ||
                            row.id
                        ) === tag
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
                      onDelete={() =>
                        deleteCounterScan(
                          scan
                        )
                      }
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
                        scans.find(
                          (row) =>
                            onlyDigits(
                              row.tag ||
                                row.bagTag ||
                                row.id
                            ) === tag
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
                                onClick={() =>
                                  deleteCounterScan(
                                    scan
                                  )
                                }
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

          <h3>Received Bags</h3>

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
              maxHeight: compactScreen
                ? 330
                : 430,
              overflow: "auto",
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

                const subtitle =
                  normalizeReceivingLocation(
                    scan.receivingLocation ||
                      scan.location
                  ) === "BAGROOM"
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
                      "-"
                    }
                    canDelete={
                      canDeleteScans
                    }
                    deleting={
                      deletingBagroomTag ===
                      tag
                    }
                    onDelete={() =>
                      deleteReceivingScan(
                        scan
                      )
                    }
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
                        normalizeReceivingLocation(
                          scan.receivingLocation ||
                            scan.location
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
                                  deletingBagroomTag ===
                                  tag
                                }
                                onClick={() =>
                                  deleteReceivingScan(
                                    scan
                                  )
                                }
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
          marginTop: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: compactScreen
            ? 8
            : 12,
          background: "#f9fafb",
        }}
      >
        <h3 style={{ marginTop: 0 }}>
          Received Bags by Area
        </h3>

        {loadingScans ? (
          <p>Loading…</p>
        ) : scans.length === 0 ? (
          <p
            style={{
              color: "#6b7280",
            }}
          >
            No scans yet.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                compactScreen
                  ? "1fr"
                  : "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 8,
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
                    numeric: true,
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
                  normalizeReceivingLocation(
                    firstScan
                      ?.receivingLocation ||
                      firstScan?.location
                  );

                const groupActive =
                  scanLocation ===
                    normalizedReceivingLocation &&
                  (scanLocation !==
                    "BAGROOM" ||
                    groupName ===
                      selectedCart);

                return (
                  <div
                    key={groupName}
                    style={{
                      border:
                        "1px solid #e5e7eb",
                      borderRadius: 10,
                      background: "white",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          scanLocation ===
                          "BAGROOM"
                        ) {
                          selectReceivingLocation(
                            "BAGROOM"
                          );

                          selectCart(
                            groupName
                          );
                        } else {
                          selectReceivingLocation(
                            scanLocation
                          );
                        }
                      }}
                      style={{
                        width: "100%",
                        border: "none",
                        padding: "10px",
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
                        color: "white",
                        display: "flex",
                        justifyContent:
                          "space-between",
                        gap: 8,
                        fontWeight: 900,
                        cursor: "pointer",
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
                        padding: 8,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 5,
                      }}
                    >
                      {groupScans.map(
                        (scan) => {
                          const tag =
                            onlyDigits(
                              scan.tag ||
                                scan.id
                            );

                          const matched =
                            counterTagSet.has(
                              tag
                            );

                          return (
                            <span
                              key={scan.id}
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
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 62,
        padding: "7px 4px",
        borderRadius: 10,
        border: active
          ? "2px solid #2563eb"
          : "1px solid #d1d5db",
        background: active
          ? "#dbeafe"
          : disabled
            ? "#f3f4f6"
            : "white",
        color: active
          ? "#1d4ed8"
          : "#374151",
        fontWeight: 900,
        cursor: disabled
          ? "not-allowed"
          : "pointer",
        opacity: disabled
          ? 0.7
          : 1,
      }}
    >
      <div
        style={{
          fontSize: "1.2rem",
        }}
      >
        {icon}
      </div>

      <div
        style={{
          marginTop: 2,
          fontSize: "0.72rem",
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
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        border: active
          ? "2px solid #2563eb"
          : "1px solid #d1d5db",
        background: active
          ? "#dbeafe"
          : "white",
        color: active
          ? "#1d4ed8"
          : "#374151",
        fontWeight: 900,
        cursor: "pointer",
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
        minWidth: 0,
        padding: "9px 4px",
        borderRadius: 10,
        background,
        color,
        textAlign: "center",
        border:
          "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          fontSize: "0.68rem",
          fontWeight: 900,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: "1.25rem",
          fontWeight: 900,
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
  const background = success
    ? "#f0fdf4"
    : warning
      ? "#fff7ed"
      : "#fef2f2";

  const color = success
    ? "#166534"
    : warning
      ? "#9a3412"
      : "#991b1b";

  return (
    <div
      style={{
        marginBottom: 6,
        padding: 9,
        borderRadius: 10,
        background,
        border: `1px solid ${color}33`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          gap: 6,
          alignItems: "center",
        }}
      >
        <strong
          style={{
            fontFamily:
              "ui-monospace, monospace",
            fontSize: "0.95rem",
          }}
        >
          {tag}
        </strong>

        <span
          style={{
            padding: "3px 7px",
            borderRadius: 999,
            background: "white",
            color,
            fontSize: "0.65rem",
            fontWeight: 900,
          }}
        >
          {status}
        </span>
      </div>

      <div
        style={{
          marginTop: 5,
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "center",
          gap: 6,
          color: "#6b7280",
          fontSize: "0.75rem",
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
        display: "inline-flex",
        padding: "4px 7px",
        borderRadius: 999,
        background: received
          ? "#dcfce7"
          : "#fee2e2",
        color: received
          ? "#166534"
          : "#991b1b",
        fontSize: "0.68rem",
        fontWeight: 900,
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
        display: "inline-flex",
        padding: "4px 7px",
        borderRadius: 999,
        background: matched
          ? "#dcfce7"
          : "#ffedd5",
        color: matched
          ? "#166534"
          : "#9a3412",
        fontSize: "0.68rem",
        fontWeight: 900,
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
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={busy}
      style={{
        minHeight: 32,
        padding: "4px 8px",
        borderRadius: 999,
        border:
          "1px solid #ef4444",
        background: busy
          ? "#fca5a5"
          : "#ef4444",
        color: "white",
        fontSize: "0.7rem",
        fontWeight: 900,
        cursor: busy
          ? "not-allowed"
          : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      {busy ? "…" : "Delete"}
    </button>
  );
}

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
};

const th = {
  textAlign: "left",
  padding: "9px 7px",
  borderBottom:
    "1px solid #e5e7eb",
  fontSize: "0.72rem",
  textTransform: "uppercase",
  color: "#6b7280",
  whiteSpace: "nowrap",
};

const td = {
  padding: "9px 7px",
  borderBottom:
    "1px solid #f3f4f6",
  color: "#111827",
  verticalAlign: "middle",
};

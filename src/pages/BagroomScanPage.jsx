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

function normalizeStatus(status) {
  const value = String(status || "OPEN")
    .trim()
    .toUpperCase();

  return ["OPEN", "RECEIVING", "LOADING", "LOADED"].includes(
    value
  )
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

  if (type === "GATE_CHECK") return "Gate Check";
  if (type === "OVERSIZE") return "Oversize";
  if (type === "GATE_BAG") return "Gate Bag";

  return "Checked Bag";
}

function useCompactScreen() {
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined"
      ? window.innerWidth <= COMPACT_SCREEN_WIDTH
      : false
  );

  useEffect(() => {
    const update = () => {
      setCompact(
        window.innerWidth <= COMPACT_SCREEN_WIDTH
      );
    };

    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
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
  const [flightLoading, setFlightLoading] =
    useState(true);

  const [cartNumber, setCartNumber] = useState(
    localStorage.getItem(`bagroomCart_${flightId}`) ||
      ""
  );

  const selectedCart =
    normalizeCartNumber(cartNumber);

  const [scannerMode, setScannerMode] = useState(
    () =>
      localStorage.getItem("bagroomScannerMode") !==
      "manual"
  );

  const [tagInput, setTagInput] = useState("");
  const inputRef = useRef(null);

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [scans, setScans] = useState([]);
  const [loadingScans, setLoadingScans] =
    useState(true);

  const [counterScans, setCounterScans] =
    useState([]);

  const [
    loadingCounterScans,
    setLoadingCounterScans,
  ] = useState(true);

  const [strictManifest, setStrictManifest] =
    useState(false);

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
  const lastSubmittedTagRef = useRef("");
  const lastSubmittedTimeRef = useRef(0);

  const { modal, show, close } = useModal();

  const focusScanner = () => {
    window.setTimeout(() => {
      if (
        inputRef.current &&
        selectedCart &&
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
        <div style={{ whiteSpace: "pre-wrap" }}>
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

  const isLoadingCompleted =
    Boolean(flight?.aircraftLoadingCompleted) ||
    normalizeStatus(flight?.status) === "LOADED";

  const availableCarts = useMemo(() => {
    const carts = new Set();

    if (Array.isArray(flight?.cartNumbers)) {
      flight.cartNumbers.forEach((cart) => {
        const normalized =
          normalizeCartNumber(cart);

        if (normalized) carts.add(normalized);
      });
    }

    scans.forEach((scan) => {
      const normalized =
        normalizeCartNumber(scan.cartNumber);

      if (normalized) carts.add(normalized);
    });

    if (selectedCart) {
      carts.add(selectedCart);
    }

    return [...carts].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, {
        numeric: true,
      })
    );
  }, [flight?.cartNumbers, scans, selectedCart]);

  const counterTagSet = useMemo(() => {
    return new Set(
      counterScans
        .map((scan) =>
          onlyDigits(
            scan.tag || scan.bagTag || scan.id
          )
        )
        .filter(isValidBagTag)
    );
  }, [counterScans]);

  const bagroomTagSet = useMemo(() => {
    return new Set(
      scans
        .map((scan) =>
          onlyDigits(
            scan.tag || scan.bagTag || scan.id
          )
        )
        .filter(isValidBagTag)
    );
  }, [scans]);

  const receivedCounterScans = useMemo(() => {
    return counterScans.filter((scan) => {
      const tag = onlyDigits(
        scan.tag || scan.bagTag || scan.id
      );

      return (
        isValidBagTag(tag) &&
        bagroomTagSet.has(tag)
      );
    });
  }, [counterScans, bagroomTagSet]);

  const pendingCounterScans = useMemo(() => {
    return counterScans.filter((scan) => {
      const tag = onlyDigits(
        scan.tag || scan.bagTag || scan.id
      );

      return (
        isValidBagTag(tag) &&
        !bagroomTagSet.has(tag)
      );
    });
  }, [counterScans, bagroomTagSet]);

  const bagroomWithoutCounter = useMemo(() => {
    return scans.filter((scan) => {
      const tag = onlyDigits(
        scan.tag || scan.bagTag || scan.id
      );

      return (
        isValidBagTag(tag) &&
        !counterTagSet.has(tag)
      );
    });
  }, [scans, counterTagSet]);

  const groupedByCart = useMemo(() => {
    const groups = {};

    for (const scan of scans) {
      const cart =
        normalizeCartNumber(scan.cartNumber) ||
        "NO CART";

      if (!groups[cart]) groups[cart] = [];

      groups[cart].push(scan);
    }

    return groups;
  }, [scans]);

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
          typeof data.strictManifest === "boolean"
        ) {
          setStrictManifest(data.strictManifest);
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

  useEffect(() => {
    if (!flightId) {
      setScans([]);
      setLoadingScans(false);
      return;
    }

    setLoadingScans(true);

    const bagroomRef = collection(
      db,
      "flights",
      flightId,
      "bagroomScans"
    );

    const unsub = onSnapshot(
      bagroomRef,
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
          "Bagroom scans snapshot error:",
          error
        );

        setScans([]);
        setLoadingScans(false);
      }
    );

    return () => unsub();
  }, [flightId]);

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

  useEffect(() => {
    focusScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCart,
    scannerMode,
    isLoadingCompleted,
  ]);

  useEffect(() => {
    return () => {
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
      }
    };
  }, []);

  const ensureStatusReceiving = async () => {
    if (!flight) return;

    const current = normalizeStatus(
      flight.status
    );

    if (
      current === "RECEIVING" ||
      current === "LOADING" ||
      current === "LOADED"
    ) {
      return;
    }

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
      { merge: true }
    );
  };

  const saveCartToFlight = async () => {
    if (!selectedCart || !flightId) return;

    const existingCarts = Array.isArray(
      flight?.cartNumbers
    )
      ? flight.cartNumbers
          .map(normalizeCartNumber)
          .filter(Boolean)
      : [];

    if (existingCarts.includes(selectedCart)) {
      return;
    }

    const nextCarts = [
      ...existingCarts,
      selectedCart,
    ].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, {
        numeric: true,
      })
    );

    await setDoc(
      doc(db, "flights", flightId),
      {
        cartNumbers: nextCarts,
        cartNumbersUpdatedAt:
          serverTimestamp(),
        cartNumbersUpdatedBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
      },
      { merge: true }
    );
  };

  const validateAgainstOtherFlight = async (
    tag
  ) => {
    const tagRef = doc(db, "bagTags", tag);
    const snapshot = await getDoc(tagRef);

    if (!snapshot.exists()) {
      return {
        ok: true,
        firstTime: true,
      };
    }

    const existing = snapshot.data();

    if (
      existing.flightId &&
      existing.flightId !== flightId
    ) {
      return {
        ok: false,
        message:
          `❌ Bag tag belongs to another flight/date.\n\n` +
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
      firstTime: false,
    };
  };

  const indexTag = async (tag) => {
    const tagRef = doc(db, "bagTags", tag);
    const current = await getDoc(tagRef);

    const firstSeenAt = current.exists()
      ? current.data().firstSeenAt ||
        serverTimestamp()
      : serverTimestamp();

    await setDoc(
      tagRef,
      {
        tag,
        flightId,
        flightNumber:
          flight?.flightNumber || null,
        flightDate:
          flight?.flightDate || null,
        gate: flight?.gate || null,
        lastSeenAt: serverTimestamp(),
        lastSeenLocation: "bagroom",
        lastSeenCart: selectedCart || null,
        lastSeenBy: {
          userId: user?.id || null,
          username: user?.username || null,
          role: user?.role || null,
        },
        firstSeenAt,
      },
      { merge: true }
    );
  };

  const saveTrackingEvent = async (tag) => {
    const eventRef = doc(
      db,
      "bagTags",
      tag,
      "events",
      `bagroom_${Date.now()}`
    );

    await setDoc(eventRef, {
      type: "BAGROOM_SCAN",
      location: "bagroom",
      message:
        "Bag received/scanned in Bagroom",
      tag,
      cartNumber: selectedCart || null,
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

  const saveBagroomScan = async (tag) => {
    const scanRef = doc(
      db,
      "flights",
      flightId,
      "bagroomScans",
      tag
    );

    const existing = await getDoc(scanRef);

    if (existing.exists()) {
      popup(
        "Duplicate scan",
        `⚠️ Bag ${tag} was already scanned in Bagroom.`,
        "warning"
      );

      return false;
    }

    await setDoc(scanRef, {
      tag,
      cartNumber: selectedCart,
      createdAt: serverTimestamp(),
      scannedBy: {
        userId: user?.id || null,
        username: user?.username || null,
        role: user?.role || null,
      },
    });

    return true;
  };

  const handleScanSubmit = async (
    forcedTag
  ) => {
    if (isSubmittingRef.current) return;

    setMsg("");
    setErr("");

    if (isLoadingCompleted) {
      popup(
        "Flight locked",
        "Aircraft loading is already completed. Bagroom scanning is locked.",
        "warning"
      );

      setTagInput("");
      return;
    }

    if (!selectedCart) {
      popup(
        "Cart required",
        "Select or enter a cart number before scanning.",
        "warning"
      );

      return;
    }

    const tag = onlyDigits(
      forcedTag ?? tagInput
    );

    if (!tag) return;

    if (!isValidBagTag(tag)) {
      popup(
        "Invalid Bag Tag",
        `Bag tags must contain exactly ${BAG_TAG_LENGTH} digits.\n\nDetected: ${tag.length} digits`,
        "danger"
      );

      setTagInput("");
      return;
    }

    const now = Date.now();

    if (
      lastSubmittedTagRef.current === tag &&
      now - lastSubmittedTimeRef.current < 1200
    ) {
      setTagInput("");
      focusScanner();
      return;
    }

    try {
      isSubmittingRef.current = true;
      lastSubmittedTagRef.current = tag;
      lastSubmittedTimeRef.current = now;

      if (!flight) {
        setErr("Flight not loaded.");
        return;
      }

      const cross =
        await validateAgainstOtherFlight(tag);

      if (!cross.ok) {
        popup(
          "Wrong Flight",
          cross.message,
          "danger"
        );

        setTagInput("");
        return;
      }

      await saveCartToFlight();

      const saved =
        await saveBagroomScan(tag);

      if (!saved) {
        setTagInput("");
        return;
      }

      await indexTag(tag);
      await saveTrackingEvent(tag);
      await ensureStatusReceiving();

      localStorage.setItem(
        `bagroomCart_${flightId}`,
        selectedCart
      );

      setMsg(
        `✅ ${tag} received in Cart ${selectedCart}`
      );

      setTagInput("");
    } catch (error) {
      console.error(
        "Bagroom scan error:",
        error
      );

      setErr(
        "Scan failed. Check the connection and try again."
      );
    } finally {
      isSubmittingRef.current = false;
      focusScanner();
    }
  };

  const scheduleAutoSubmit = (
    rawValue
  ) => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
    }

    const cleaned = onlyDigits(rawValue);

    if (cleaned.length > BAG_TAG_LENGTH) {
      setErr(
        `Only ${BAG_TAG_LENGTH} digits are allowed.`
      );

      return;
    }

    if (cleaned.length !== BAG_TAG_LENGTH) {
      return;
    }

    autoTimerRef.current = setTimeout(() => {
      handleScanSubmit(cleaned);
    }, AUTO_SUBMIT_IDLE_MS);
  };

  const handleChange = (event) => {
    const rawValue = event.target.value;
    const digits = normalizeBagTag(rawValue);

    setTagInput(digits);
    setErr("");

    if (!isLoadingCompleted) {
      scheduleAutoSubmit(rawValue);
    }
  };

  const handleKeyDown = (event) => {
    if (
      event.key === "Enter" ||
      event.key === "Tab"
    ) {
      event.preventDefault();

      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
      }

      handleScanSubmit(tagInput);
    }
  };

  const changeScannerMode = (
    nextScannerMode
  ) => {
    setScannerMode(nextScannerMode);

    localStorage.setItem(
      "bagroomScannerMode",
      nextScannerMode ? "scanner" : "manual"
    );

    setTagInput("");
    setErr("");
  };

  const selectCart = (cart) => {
    const normalized =
      normalizeCartNumber(cart);

    setCartNumber(normalized);

    localStorage.setItem(
      `bagroomCart_${flightId}`,
      normalized
    );

    setTagInput("");
    focusScanner();
  };

  const deleteCounterScan = async (
    scan
  ) => {
    const tag = onlyDigits(
      scan?.tag ||
        scan?.bagTag ||
        scan?.id
    );

    if (!tag || !canDeleteScans) return;

    const confirmed = window.confirm(
      `Delete Counter scan?\n\nBag Tag: ${tag}`
    );

    if (!confirmed) return;

    try {
      setDeletingCounterTag(tag);

      await deleteDoc(
        doc(
          db,
          "flights",
          flightId,
          "counterScans",
          scan.id || tag
        )
      );

      setMsg(
        `Counter scan deleted: ${tag}`
      );
    } catch (error) {
      console.error(error);

      popup(
        "Delete failed",
        "Could not delete the Counter scan.",
        "danger"
      );
    } finally {
      setDeletingCounterTag("");
      focusScanner();
    }
  };

  const deleteBagroomScan = async (
    scan
  ) => {
    const tag = onlyDigits(
      scan?.tag ||
        scan?.bagTag ||
        scan?.id
    );

    if (!tag || !canDeleteScans) return;

    const confirmed = window.confirm(
      `Delete Bagroom scan?\n\nBag Tag: ${tag}\nCart: ${
        scan?.cartNumber || "-"
      }`
    );

    if (!confirmed) return;

    try {
      setDeletingBagroomTag(tag);

      await deleteDoc(
        doc(
          db,
          "flights",
          flightId,
          "bagroomScans",
          scan.id || tag
        )
      );

      const counterSnapshot =
        await getDoc(
          doc(
            db,
            "flights",
            flightId,
            "counterScans",
            tag
          )
        );

      await setDoc(
        doc(db, "bagTags", tag),
        {
          lastSeenAt: serverTimestamp(),
          lastSeenLocation:
            counterSnapshot.exists()
              ? "counter"
              : "bagroom_scan_deleted",
          lastSeenCart: null,
          lastSeenBy: {
            userId: user?.id || null,
            username: user?.username || null,
            role: user?.role || null,
          },
        },
        { merge: true }
      );

      setMsg(
        `Bagroom scan deleted: ${tag}`
      );
    } catch (error) {
      console.error(error);

      popup(
        "Delete failed",
        "Could not delete the Bagroom scan.",
        "danger"
      );
    } finally {
      setDeletingBagroomTag("");
      focusScanner();
    }
  };

  const dataLoading =
    loadingScans ||
    loadingCounterScans;

  const pagePadding = compactScreen ? 8 : 16;

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
            Bagroom Scan
          </h2>

          <p
            style={{
              margin: "4px 0 0",
              color: "#6b7280",
              fontSize: "0.82rem",
            }}
          >
            Select cart and scan a 10-digit
            bag tag.
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
            : "minmax(300px, 0.8fr) minmax(500px, 1.2fr)",
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
            1. Select Cart
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
              {availableCarts.map((cart) => (
                <button
                  key={cart}
                  type="button"
                  onClick={() =>
                    selectCart(cart)
                  }
                  disabled={isLoadingCompleted}
                  style={{
                    minHeight: 46,
                    padding: "6px 4px",
                    borderRadius: 10,
                    border:
                      selectedCart === cart
                        ? "2px solid #16a34a"
                        : "1px solid #d1d5db",
                    background:
                      selectedCart === cart
                        ? "#dcfce7"
                        : "white",
                    color:
                      selectedCart === cart
                        ? "#166534"
                        : "#111827",
                    fontWeight: 900,
                    fontSize: "1rem",
                  }}
                >
                  {cart}
                </button>
              ))}
            </div>
          )}

          <input
            value={cartNumber}
            onChange={(event) =>
              selectCart(event.target.value)
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
              border: "1px solid #d1d5db",
              background: isLoadingCompleted
                ? "#f3f4f6"
                : "white",
              fontSize: "1rem",
              fontWeight: 900,
              textTransform: "uppercase",
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
            2. Scan Bag Tag
          </h3>

          <input
            ref={inputRef}
            value={tagInput}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={
              isLoadingCompleted ||
              !selectedCart
            }
            inputMode={
              scannerMode ? "none" : "numeric"
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
                : !selectedCart
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
                !selectedCart
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
              justifyContent: "space-between",
              marginTop: 6,
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
              !selectedCart ||
              tagInput.length !==
                BAG_TAG_LENGTH
            }
            style={{
              width: "100%",
              minHeight: 54,
              marginTop: 10,
              borderRadius: 12,
              border: "1px solid #1d4ed8",
              background:
                isLoadingCompleted ||
                !selectedCart ||
                tagInput.length !==
                  BAG_TAG_LENGTH
                  ? "#93c5fd"
                  : "#2563eb",
              color: "white",
              fontWeight: 900,
              fontSize: "1rem",
              cursor:
                isLoadingCompleted ||
                !selectedCart ||
                tagInput.length !==
                  BAG_TAG_LENGTH
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            SAVE BAGROOM SCAN
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
            padding: compactScreen ? 8 : 12,
            minWidth: 0,
          }}
        >
          <h3 style={{ marginTop: 0 }}>
            Counter → Bagroom
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
              marginTop: 10,
              maxHeight: compactScreen
                ? 330
                : 430,
              overflow: "auto",
            }}
          >
            {dataLoading ? (
              <p>Loading scans…</p>
            ) : counterScans.length === 0 ? (
              <p style={{ color: "#6b7280" }}>
                No Counter scans.
              </p>
            ) : compactScreen ? (
              counterScans.map((scan) => {
                const tag = onlyDigits(
                  scan.tag ||
                    scan.bagTag ||
                    scan.id
                );

                const received =
                  bagroomTagSet.has(tag);

                return (
                  <ScanCard
                    key={scan.id}
                    tag={tag}
                    subtitle={getBagTypeLabel(
                      scan.bagType
                    )}
                    status={
                      received
                        ? "RECEIVED"
                        : "PENDING"
                    }
                    success={received}
                    username={
                      scan.scannedBy?.username ||
                      scan.createdBy?.username ||
                      "-"
                    }
                    canDelete={canDeleteScans}
                    deleting={
                      deletingCounterTag === tag
                    }
                    onDelete={() =>
                      deleteCounterScan(scan)
                    }
                  />
                );
              })
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={th}>Bag Tag</th>
                    <th style={th}>Type</th>
                    <th style={th}>Status</th>
                    <th style={th}>User</th>
                    {canDeleteScans && (
                      <th
                        style={{
                          ...th,
                          textAlign: "right",
                        }}
                      >
                        Action
                      </th>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {counterScans.map((scan) => {
                    const tag = onlyDigits(
                      scan.tag ||
                        scan.bagTag ||
                        scan.id
                    );

                    const received =
                      bagroomTagSet.has(tag);

                    return (
                      <tr
                        key={scan.id}
                        style={{
                          background: received
                            ? "#f0fdf4"
                            : "#fef2f2",
                        }}
                      >
                        <td style={td}>
                          <strong>{tag}</strong>
                        </td>

                        <td style={td}>
                          {getBagTypeLabel(
                            scan.bagType
                          )}
                        </td>

                        <td style={td}>
                          <StatusBadge
                            received={received}
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
                  })}
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

          <h3>Bagroom Received</h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(2, minmax(0, 1fr))",
              gap: 6,
            }}
          >
            <SummaryCard
              label="Total"
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
                  : bagroomWithoutCounter.length
              }
              background={
                bagroomWithoutCounter.length
                  ? "#ffedd5"
                  : "#f3f4f6"
              }
              color={
                bagroomWithoutCounter.length
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
              <p>Loading Bagroom scans…</p>
            ) : scans.length === 0 ? (
              <p style={{ color: "#6b7280" }}>
                No Bagroom scans.
              </p>
            ) : compactScreen ? (
              scans.map((scan) => {
                const tag = onlyDigits(
                  scan.tag ||
                    scan.bagTag ||
                    scan.id
                );

                const matched =
                  counterTagSet.has(tag);

                return (
                  <ScanCard
                    key={scan.id}
                    tag={tag}
                    subtitle={`Cart ${
                      scan.cartNumber || "-"
                    }`}
                    status={
                      matched
                        ? "MATCHED"
                        : "NO COUNTER"
                    }
                    success={matched}
                    warning={!matched}
                    username={
                      scan.scannedBy?.username ||
                      "-"
                    }
                    canDelete={canDeleteScans}
                    deleting={
                      deletingBagroomTag === tag
                    }
                    onDelete={() =>
                      deleteBagroomScan(scan)
                    }
                  />
                );
              })
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={th}>Bag Tag</th>
                    <th style={th}>Cart</th>
                    <th style={th}>Match</th>
                    <th style={th}>User</th>
                    {canDeleteScans && (
                      <th
                        style={{
                          ...th,
                          textAlign: "right",
                        }}
                      >
                        Action
                      </th>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {scans.map((scan) => {
                    const tag = onlyDigits(
                      scan.tag ||
                        scan.bagTag ||
                        scan.id
                    );

                    const matched =
                      counterTagSet.has(tag);

                    return (
                      <tr
                        key={scan.id}
                        style={{
                          background: matched
                            ? "#f0fdf4"
                            : "#fff7ed",
                        }}
                      >
                        <td style={td}>
                          <strong>{tag}</strong>
                        </td>

                        <td style={td}>
                          {scan.cartNumber || "-"}
                        </td>

                        <td style={td}>
                          <MatchBadge
                            matched={matched}
                          />
                        </td>

                        <td style={td}>
                          {scan.scannedBy
                            ?.username || "-"}
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
                                deleteBagroomScan(
                                  scan
                                )
                              }
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
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
          padding: compactScreen ? 8 : 12,
          background: "#f9fafb",
        }}
      >
        <h3 style={{ marginTop: 0 }}>
          Bags by Cart
        </h3>

        {loadingScans ? (
          <p>Loading…</p>
        ) : scans.length === 0 ? (
          <p style={{ color: "#6b7280" }}>
            No scans yet.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: compactScreen
                ? "1fr"
                : "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 8,
            }}
          >
            {Object.keys(groupedByCart)
              .sort((a, b) =>
                String(a).localeCompare(
                  String(b),
                  undefined,
                  { numeric: true }
                )
              )
              .map((cart) => (
                <div
                  key={cart}
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
                    onClick={() =>
                      selectCart(cart)
                    }
                    style={{
                      width: "100%",
                      border: "none",
                      padding: "10px",
                      background:
                        selectedCart === cart
                          ? "#166534"
                          : "#111827",
                      color: "white",
                      display: "flex",
                      justifyContent:
                        "space-between",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    <span>Cart {cart}</span>
                    <span>
                      {
                        groupedByCart[cart]
                          .length
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
                    {groupedByCart[cart].map(
                      (scan) => {
                        const tag = onlyDigits(
                          scan.tag || scan.id
                        );

                        const matched =
                          counterTagSet.has(tag);

                        return (
                          <span
                            key={scan.id}
                            style={{
                              padding: "4px 7px",
                              borderRadius: 999,
                              background: matched
                                ? "#dcfce7"
                                : "#ffedd5",
                              color: matched
                                ? "#166534"
                                : "#9a3412",
                              fontFamily:
                                "ui-monospace, monospace",
                              fontWeight: 800,
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
              ))}
          </div>
        )}
      </section>

      <Modal
        open={modal.open}
        title={modal.title}
        tone={modal.tone}
        confirmText={modal.confirmText}
        cancelText={modal.cancelText}
        showCancel={modal.showCancel}
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
        border: "1px solid rgba(0,0,0,0.06)",
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
          justifyContent: "space-between",
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
          justifyContent: "space-between",
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

function StatusBadge({ received }) {
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
      {received ? "RECEIVED" : "PENDING"}
    </span>
  );
}

function MatchBadge({ matched }) {
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
      {matched ? "MATCHED" : "NO COUNTER"}
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
        border: "1px solid #ef4444",
        background: busy
          ? "#fca5a5"
          : "#ef4444",
        color: "white",
        fontSize: "0.7rem",
        fontWeight: 900,
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
  borderBottom: "1px solid #e5e7eb",
  fontSize: "0.72rem",
  textTransform: "uppercase",
  color: "#6b7280",
  whiteSpace: "nowrap",
};

const td = {
  padding: "9px 7px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
  verticalAlign: "middle",
};

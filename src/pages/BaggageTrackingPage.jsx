// src/pages/BaggageTrackingPage.jsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  collection,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";

import { db } from "../firebase";

const BAG_TAG_LENGTH = 10;
const MOBILE_BREAKPOINT = 760;

function cleanTag(value) {
  return String(value || "")
    .replace(/\D+/g, "")
    .slice(0, BAG_TAG_LENGTH);
}

function getTimestampMs(value) {
  if (!value) return 0;

  if (
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  if (
    typeof value.seconds === "number"
  ) {
    return value.seconds * 1000;
  }

  const parsed =
    value instanceof Date
      ? value.getTime()
      : new Date(value).getTime();

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function formatDateTime(value) {
  const milliseconds =
    getTimestampMs(value);

  if (!milliseconds) {
    return "-";
  }

  return new Date(
    milliseconds
  ).toLocaleString();
}

function normalizeEventType(type) {
  return String(type || "")
    .trim()
    .toUpperCase();
}

function normalizeLocation(value) {
  const location = String(
    value || ""
  )
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, "_");

  if (
    [
      "GATE",
      "RAMP",
      "GATE_RAMP",
      "GATERAMP",
    ].includes(location)
  ) {
    return "GATE";
  }

  if (
    location === "OVERSIZE"
  ) {
    return "OVERSIZE";
  }

  if (
    [
      "BAGROOM",
      "BAG_ROOM",
      "BAGGAGE_ROOM",
    ].includes(location)
  ) {
    return "BAGROOM";
  }

  if (
    location === "COUNTER"
  ) {
    return "COUNTER";
  }

  if (
    location === "AIRCRAFT"
  ) {
    return "AIRCRAFT";
  }

  if (
    location === "OFFLOADED"
  ) {
    return "OFFLOADED";
  }

  return "UNKNOWN";
}

function getLocationLabel(value) {
  const location =
    normalizeLocation(value);

  if (
    location === "COUNTER"
  ) {
    return "Counter";
  }

  if (
    location === "BAGROOM"
  ) {
    return "Bagroom";
  }

  if (
    location === "OVERSIZE"
  ) {
    return "Oversize";
  }

  if (
    location === "GATE"
  ) {
    return "Gate / Ramp";
  }

  if (
    location === "AIRCRAFT"
  ) {
    return "Aircraft";
  }

  if (
    location === "OFFLOADED"
  ) {
    return "Offloaded";
  }

  return "Unknown";
}

function getEventTitle(type) {
  const t =
    normalizeEventType(type);

  if (
    t === "COUNTER_SCAN"
  ) {
    return "Counter Scan";
  }

  if (
    t === "BAGROOM_SCAN"
  ) {
    return "Bagroom Received";
  }

  if (
    t === "OVERSIZE_SCAN"
  ) {
    return "Oversize Received";
  }

  if (
    t === "GATE_RAMP_SCAN"
  ) {
    return "Gate / Ramp Received";
  }

  if (
    t === "AIRCRAFT_LOAD"
  ) {
    return "Loaded on Aircraft";
  }

  if (
    t === "OFFLOAD_BAG"
  ) {
    return "Offloaded";
  }

  if (
    t === "RELOAD_BAG"
  ) {
    return "Reloaded";
  }

  if (
    t === "RECEIVING_SCAN_DELETED"
  ) {
    return "Receiving Scan Deleted";
  }

  return (
    t ||
    "Tracking Event"
  );
}

function getEventIcon(type) {
  const t =
    normalizeEventType(type);

  if (
    t === "COUNTER_SCAN"
  ) {
    return "\uD83D\uDFE2";
  }

  if (
    t === "BAGROOM_SCAN"
  ) {
    return "\uD83D\uDFE1";
  }

  if (
    t === "OVERSIZE_SCAN"
  ) {
    return "\uD83D\uDCE6";
  }

  if (
    t === "GATE_RAMP_SCAN"
  ) {
    return "\uD83D\uDEAA";
  }

  if (
    t === "AIRCRAFT_LOAD"
  ) {
    return "\uD83D\uDD35";
  }

  if (
    t === "OFFLOAD_BAG"
  ) {
    return "\uD83D\uDD34";
  }

  if (
    t === "RELOAD_BAG"
  ) {
    return "\uD83D\uDFE3";
  }

  if (
    t === "RECEIVING_SCAN_DELETED"
  ) {
    return "\u26A0\uFE0F";
  }

  return "\u26AA";
}

function getEventBorder(type) {
  const t =
    normalizeEventType(type);

  if (
    t === "COUNTER_SCAN"
  ) {
    return "#22c55e";
  }

  if (
    t === "BAGROOM_SCAN"
  ) {
    return "#f59e0b";
  }

  if (
    t === "OVERSIZE_SCAN"
  ) {
    return "#f97316";
  }

  if (
    t === "GATE_RAMP_SCAN"
  ) {
    return "#7c3aed";
  }

  if (
    t === "AIRCRAFT_LOAD"
  ) {
    return "#2563eb";
  }

  if (
    t === "OFFLOAD_BAG"
  ) {
    return "#dc2626";
  }

  if (
    t === "RELOAD_BAG"
  ) {
    return "#7c3aed";
  }

  if (
    t === "RECEIVING_SCAN_DELETED"
  ) {
    return "#d97706";
  }

  return "#9ca3af";
}

function getActor(data) {
  const source =
    data?.createdBy ||
    data?.scannedBy ||
    data?.updatedBy ||
    {};

  return {
    username:
      source?.username ||
      data?.username ||
      null,

    fullName:
      source?.fullName ||
      source?.employeeFullName ||
      data?.employeeFullName ||
      source?.username ||
      data?.username ||
      null,

    operationalPosition:
      source
        ?.operationalPosition ||
      data
        ?.operationalPosition ||
      null,

    operationalPositionLabel:
      source
        ?.operationalPositionLabel ||
      data
        ?.operationalPositionLabel ||
      null,
  };
}

function getActorLabel(data) {
  const actor =
    getActor(data);

  return (
    actor.fullName ||
    actor.username ||
    "-"
  );
}

function getOperationalPositionLabel(
  data
) {
  const actor =
    getActor(data);

  return (
    actor.operationalPositionLabel ||
    actor.operationalPosition ||
    null
  );
}

function getLastStatusText(tagDoc) {
  const location =
    normalizeLocation(
      tagDoc?.lastSeenLocation ||
        tagDoc?.location ||
        tagDoc?.receivingLocation
    );

  if (
    location === "COUNTER"
  ) {
    return "At Counter";
  }

  if (
    location === "BAGROOM"
  ) {
    const cart =
      tagDoc?.lastSeenCart ||
      tagDoc?.cartNumber;

    return cart
      ? `In Bagroom - Cart ${cart}`
      : "In Bagroom";
  }

  if (
    location === "OVERSIZE"
  ) {
    return "At Oversize";
  }

  if (
    location === "GATE"
  ) {
    return "At Gate / Ramp";
  }

  if (
    location === "AIRCRAFT"
  ) {
    const zone =
      tagDoc?.lastSeenZone;

    return zone
      ? `Loaded on Aircraft - Zone ${zone}`
      : "Loaded on Aircraft";
  }

  if (
    location === "OFFLOADED"
  ) {
    return "Offloaded";
  }

  return "Unknown";
}

function getEventTime(event) {
  return (
    event?.createdAt ||
    event?.timestamp ||
    event?.scannedAt ||
    event?.updatedAt ||
    null
  );
}

/*
 * IMPORTANT:
 * This page is already tracking ONE bag at a time.
 * Therefore, the bag tag itself must NOT be used
 * to identify duplicate normal movement events.
 *
 * Some old embedded Bagroom events do not include
 * "tag", while the fallback copy does include it.
 * If tag is part of the signature, the same
 * Bagroom movement appears twice.
 */
function eventSignature(event) {
  const type =
    normalizeEventType(
      event?.type ||
        event?.event
    );

  const location =
    normalizeLocation(
      event?.receivingLocation ||
        event?.location ||
        event?.trackingLocation
    );

  const flightId =
    String(
      event?.flightId || ""
    );

  const zone =
    String(
      event?.zone ?? ""
    );

  const cart =
    String(
      event?.cartNumber ?? ""
    );

  /*
   * One normal physical movement per bag/flight.
   * Timestamp and tag are intentionally excluded
   * so duplicate copies from different Firebase
   * sources collapse into ONE timeline item.
   */
  const singleMovementTypes = [
    "COUNTER_SCAN",
    "BAGROOM_SCAN",
    "OVERSIZE_SCAN",
    "GATE_RAMP_SCAN",
    "AIRCRAFT_LOAD",
  ];

  if (
    singleMovementTypes.includes(
      type
    )
  ) {
    return [
      type,
      flightId,
      location,
      zone,
      cart,
    ].join("|");
  }

  /*
   * Historical actions may legitimately happen
   * more than once, so preserve timestamp there.
   */
  const time =
    getTimestampMs(
      getEventTime(event)
    );

  return [
    type,
    flightId,
    location,
    zone,
    cart,
    time,
  ].join("|");
}

function mergeUniqueEvents(
  ...eventGroups
) {
  const map =
    new Map();

  for (
    const group
    of eventGroups
  ) {
    for (
      const event
      of group || []
    ) {
      if (!event) {
        continue;
      }

      const signature =
        eventSignature(
          event
        );

      /*
       * Call order determines priority:
       * 1. event subcollection
       * 2. embedded events[]
       * 3. fallback scan docs
       *
       * First copy wins.
       */
      if (
        !map.has(
          signature
        )
      ) {
        map.set(
          signature,
          event
        );
      }
    }
  }

  return [
    ...map.values(),
  ];
}

export default function BaggageTrackingPage({
  user,
  operationalContext,
}) {
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
    tagInput,
    setTagInput,
  ] = useState("");

  const [
    searchedTag,
    setSearchedTag,
  ] = useState("");

  const [
    tagDoc,
    setTagDoc,
  ] = useState(null);

  const [
    events,
    setEvents,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    err,
    setErr,
  ] = useState("");

  const inputRef =
    useRef(null);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(
        window.innerWidth <
          MOBILE_BREAKPOINT
      );
    };

    window.addEventListener(
      "resize",
      onResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        onResize
      );
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sortedEvents =
    useMemo(() => {
      return [
        ...events,
      ].sort(
        (a, b) =>
          getTimestampMs(
            getEventTime(a)
          ) -
          getTimestampMs(
            getEventTime(b)
          )
      );
    }, [events]);

  const loadFallbackEvents =
    async (
      tag,
      mainData
    ) => {
      const currentFlightId =
        mainData?.flightId ||
        mainData
          ?.currentFlightId;

      if (
        !currentFlightId
      ) {
        return [];
      }

      const fallback = [];

      const counterSnap =
        await getDoc(
          doc(
            db,
            "flights",
            currentFlightId,
            "counterScans",
            tag
          )
        );

      if (
        counterSnap.exists()
      ) {
        const data =
          counterSnap.data();

        fallback.push({
          id:
            "fallback_counter",

          type:
            "COUNTER_SCAN",

          message:
            "Bag tag scanned at Counter",

          tag,

          location:
            "counter",

          flightId:
            currentFlightId,

          flightNumber:
            mainData.flightNumber ||
            mainData.currentFlightNumber ||
            null,

          flightDate:
            mainData.flightDate ||
            null,

          gate:
            mainData.gate ||
            null,

          createdAt:
            data.createdAt ||
            data.scannedAt ||
            null,

          createdBy:
            data.scannedBy ||
            data.createdBy ||
            null,

          employeeFullName:
            data.employeeFullName ||
            null,

          operationalPosition:
            data.operationalPosition ||
            null,

          operationalPositionLabel:
            data.operationalPositionLabel ||
            null,

          source:
            "fallback_counter",
        });
      }

      const receivingSnap =
        await getDoc(
          doc(
            db,
            "flights",
            currentFlightId,
            "bagroomScans",
            tag
          )
        );

      if (
        receivingSnap.exists()
      ) {
        const data =
          receivingSnap.data();

        const location =
          normalizeLocation(
            data.receivingLocation ||
            data.location ||
            data.trackingLocation
          );

        let type =
          "BAGROOM_SCAN";

        if (
          location ===
          "OVERSIZE"
        ) {
          type =
            "OVERSIZE_SCAN";
        } else if (
          location ===
          "GATE"
        ) {
          type =
            "GATE_RAMP_SCAN";
        }

        fallback.push({
          id:
            "fallback_receiving",

          type,

          message:
            data.message ||
            `Bag received/scanned at ${getLocationLabel(
              location
            )}`,

          tag,

          receivingLocation:
            location,

          location,

          locationLabel:
            data.locationLabel ||
            getLocationLabel(
              location
            ),

          cartNumber:
            location ===
            "BAGROOM"
              ? data.cartNumber ||
                null
              : null,

          flightId:
            currentFlightId,

          flightNumber:
            mainData.flightNumber ||
            mainData.currentFlightNumber ||
            null,

          flightDate:
            mainData.flightDate ||
            null,

          gate:
            mainData.gate ||
            null,

          createdAt:
            data.createdAt ||
            data.scannedAt ||
            null,

          createdBy:
            data.scannedBy ||
            data.createdBy ||
            null,

          employeeFullName:
            data.employeeFullName ||
            null,

          operationalPosition:
            data.operationalPosition ||
            null,

          operationalPositionLabel:
            data.operationalPositionLabel ||
            null,

          source:
            "fallback_receiving",
        });
      }

      const aircraftSnap =
        await getDoc(
          doc(
            db,
            "flights",
            currentFlightId,
            "aircraftScans",
            tag
          )
        );

      if (
        aircraftSnap.exists()
      ) {
        const data =
          aircraftSnap.data();

        fallback.push({
          id:
            "fallback_aircraft",

          type:
            "AIRCRAFT_LOAD",

          message:
            "Bag loaded on aircraft",

          tag,

          location:
            "aircraft",

          zone:
            data.zone ||
            null,

          previousLocation:
            data.previousLocation ||
            null,

          previousLocationLabel:
            data.previousLocationLabel ||
            null,

          previousCartNumber:
            data.previousCartNumber ||
            null,

          flightId:
            currentFlightId,

          flightNumber:
            mainData.flightNumber ||
            mainData.currentFlightNumber ||
            null,

          flightDate:
            mainData.flightDate ||
            null,

          gate:
            mainData.gate ||
            null,

          createdAt:
            data.createdAt ||
            null,

          createdBy:
            data.scannedBy ||
            null,

          employeeFullName:
            data.employeeFullName ||
            null,

          operationalPosition:
            data.operationalPosition ||
            null,

          operationalPositionLabel:
            data.operationalPositionLabel ||
            null,

          source:
            "fallback_aircraft",
        });
      }

      return fallback;
    };

  const handleSearch =
    async (
      forcedTag
    ) => {
      setErr("");
      setTagDoc(null);
      setEvents([]);

      const tag =
        cleanTag(
          forcedTag ??
            tagInput
        );

      if (!tag) {
        setErr(
          "Enter a bag tag number."
        );

        return;
      }

      if (
        tag.length !==
        BAG_TAG_LENGTH
      ) {
        setErr(
          `Bag tag must contain exactly ${BAG_TAG_LENGTH} digits.`
        );

        return;
      }

      try {
        setLoading(true);
        setSearchedTag(
          tag
        );

        const tagRef =
          doc(
            db,
            "bagTags",
            tag
          );

        const tagSnap =
          await getDoc(
            tagRef
          );

        if (
          !tagSnap.exists()
        ) {
          setErr(
            `No tracking found for bag tag ${tag}.`
          );

          return;
        }

        const mainData = {
          id:
            tagSnap.id,

          ...tagSnap.data(),
        };

        setTagDoc(
          mainData
        );

        let subcollectionEvents =
          [];

        try {
          const eventsSnap =
            await getDocs(
              collection(
                db,
                "bagTags",
                tag,
                "events"
              )
            );

          subcollectionEvents =
            eventsSnap.docs.map(
              (document) => ({
                id:
                  document.id,

                ...document.data(),

                source:
                  "event_subcollection",
              })
            );
        } catch (
          eventError
        ) {
          console.error(
            "Events read error:",
            eventError
          );
        }

        const embeddedEvents =
          Array.isArray(
            mainData.events
          )
            ? mainData.events.map(
                (
                  event,
                  index
                ) => ({
                  id:
                    `embedded_${index}`,

                  ...event,

                  type:
                    event.type ||
                    event.event ||
                    "TRACKING_EVENT",

                  createdAt:
                    event.createdAt ||
                    event.timestamp ||
                    null,

                  source:
                    "embedded_events",
                })
              )
            : [];

        let fallbackEvents =
          [];

        try {
          fallbackEvents =
            await loadFallbackEvents(
              tag,
              mainData
            );
        } catch (
          fallbackError
        ) {
          console.error(
            "Fallback tracking error:",
            fallbackError
          );
        }

        const merged =
          mergeUniqueEvents(
            subcollectionEvents,
            embeddedEvents,
            fallbackEvents
          );

        setEvents(
          merged
        );
      } catch (e) {
        console.error(
          "Baggage tracking search error:",
          e
        );

        setErr(
          "Could not load tracking. Check Firestore rules/connection."
        );
      } finally {
        setLoading(false);

        window.setTimeout(
          () => {
            inputRef.current?.focus();
          },
          100
        );
      }
    };

  const handleChange =
    (event) => {
      setTagInput(
        cleanTag(
          event.target.value
        )
      );

      setErr("");
    };

  const handleKeyDown =
    (event) => {
      if (
        event.key ===
          "Enter" ||
        event.key ===
          "Tab"
      ) {
        event.preventDefault();

        handleSearch(
          event.currentTarget
            .value
        );
      }
    };

  const currentUserName =
    operationalContext
      ?.employeeFullName ||
    user?.fullName ||
    user?.username ||
    "-";

  const currentPosition =
    operationalContext
      ?.operationalPositionLabel ||
    operationalContext
      ?.operationalPosition ||
    null;

  return (
    <div
      style={{
        background:
          "white",

        border:
          "1px solid #e5e7eb",

        borderRadius:
          isMobile
            ? 8
            : 12,

        padding:
          isMobile
            ? 10
            : 16,
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

          gap:
            12,

          flexWrap:
            "wrap",

          alignItems:
            isMobile
              ? "stretch"
              : "end",
        }}
      >
        <div>
          <h2
            style={{
              margin:
                0,

              fontSize:
                isMobile
                  ? "1.3rem"
                  : "1.5rem",
            }}
          >
            Baggage Tracking
          </h2>

          <p
            style={{
              marginTop:
                6,

              marginBottom:
                0,

              color:
                "#6b7280",

              fontSize:
                "0.9rem",
            }}
          >
            Track a bag from Counter to Receiving to Aircraft and any offload activity.
          </p>
        </div>

        <div
          style={{
            textAlign:
              isMobile
                ? "left"
                : "right",

            fontSize:
              "0.8rem",

            color:
              "#6b7280",
          }}
        >
          User:{" "}
          <strong>
            {currentUserName}
          </strong>

          {currentPosition && (
            <div
              style={{
                marginTop:
                  3,
              }}
            >
              Working as:{" "}
              <strong>
                {
                  currentPosition
                }
              </strong>
            </div>
          )}
        </div>
      </div>

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

      <section
        style={{
          border:
            "1px solid #e5e7eb",

          borderRadius:
            12,

          padding:
            12,

          background:
            "#f9fafb",

          marginBottom:
            14,
        }}
      >
        <label
          style={{
            display:
              "block",

            fontSize:
              "0.85rem",

            color:
              "#374151",

            marginBottom:
              6,

            fontWeight:
              800,
          }}
        >
          Bag Tag Number
        </label>

        <div
          style={{
            display:
              "flex",

            flexDirection:
              isMobile
                ? "column"
                : "row",

            gap:
              8,
          }}
        >
          <input
            ref={
              inputRef
            }

            value={
              tagInput
            }

            onChange={
              handleChange
            }

            onKeyDown={
              handleKeyDown
            }

            inputMode="numeric"

            pattern="[0-9]*"

            maxLength={
              BAG_TAG_LENGTH
            }

            autoComplete="off"

            placeholder="Scan or enter 10-digit bag tag"

            style={{
              flex:
                1,

              minWidth:
                0,

              width:
                "100%",

              boxSizing:
                "border-box",

              minHeight:
                isMobile
                  ? 58
                  : 48,

              padding:
                "12px",

              borderRadius:
                12,

              border:
                tagInput.length ===
                BAG_TAG_LENGTH
                  ? "2px solid #16a34a"
                  : "2px solid #60a5fa",

              background:
                "white",

              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",

              fontSize:
                isMobile
                  ? "1.12rem"
                  : "0.95rem",

              fontWeight:
                900,

              letterSpacing:
                "0.06em",
            }}
          />

          <button
            type="button"

            onClick={() =>
              handleSearch()
            }

            disabled={
              loading ||
              tagInput.length !==
                BAG_TAG_LENGTH
            }

            style={{
              padding:
                "10px 14px",

              minHeight:
                isMobile
                  ? 52
                  : 48,

              borderRadius:
                12,

              border:
                "1px solid #2563eb",

              background:
                loading ||
                tagInput.length !==
                  BAG_TAG_LENGTH
                  ? "#93c5fd"
                  : "#2563eb",

              color:
                "white",

              fontWeight:
                900,

              cursor:
                loading ||
                tagInput.length !==
                  BAG_TAG_LENGTH
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {loading
              ? "Searching..."
              : "Track Bag"}
          </button>
        </div>

        <div
          style={{
            marginTop:
              6,

            textAlign:
              "right",

            color:
              tagInput.length ===
              BAG_TAG_LENGTH
                ? "#16a34a"
                : "#6b7280",

            fontSize:
              "0.74rem",

            fontWeight:
              800,
          }}
        >
          {tagInput.length}/
          {BAG_TAG_LENGTH}
        </div>

        {err && (
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

              fontWeight:
                800,

              whiteSpace:
                "pre-wrap",
            }}
          >
            {err}
          </div>
        )}
      </section>

      {tagDoc && (
        <section
          style={{
            border:
              "1px solid #e5e7eb",

            borderRadius:
              12,

            padding:
              12,

            marginBottom:
              14,
          }}
        >
          <h3
            style={{
              marginTop:
                0,
            }}
          >
            Bag Summary
          </h3>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                isMobile
                  ? "repeat(2, minmax(0, 1fr))"
                  : "repeat(auto-fit, minmax(180px, 1fr))",

              gap:
                8,
            }}
          >
            <InfoCard
              label="Bag Tag"

              value={
                tagDoc.tag ||
                tagDoc.bagTag ||
                searchedTag
              }
            />

            <InfoCard
              label="Flight"

              value={
                tagDoc.flightNumber ||
                tagDoc.currentFlightNumber ||
                tagDoc.flightId ||
                "-"
              }
            />

            <InfoCard
              label="Date"

              value={
                tagDoc.flightDate ||
                "-"
              }
            />

            <InfoCard
              label="Gate"

              value={
                tagDoc.gate ||
                "-"
              }
            />

            <InfoCard
              label="Last Status"

              value={
                getLastStatusText(
                  tagDoc
                )
              }
            />

            <InfoCard
              label="Last Seen"

              value={
                formatDateTime(
                  tagDoc.lastSeenAt ||
                    tagDoc.updatedAt
                )
              }
            />

            <InfoCard
              label="Last Handled By"

              value={
                tagDoc.lastSeenBy
                  ?.fullName ||
                tagDoc.lastSeenBy
                  ?.username ||
                tagDoc.updatedBy
                  ?.fullName ||
                tagDoc.updatedBy
                  ?.username ||
                "-"
              }
            />

            <InfoCard
              label="Position"

              value={
                tagDoc.lastSeenBy
                  ?.operationalPositionLabel ||
                tagDoc
                  .operationalPositionLabel ||
                "-"
              }
            />
          </div>
        </section>
      )}

      {tagDoc && (
        <section
          style={{
            border:
              "1px solid #e5e7eb",

            borderRadius:
              12,

            padding:
              12,
          }}
        >
          <h3
            style={{
              marginTop:
                0,
            }}
          >
            Tracking Timeline
          </h3>

          {sortedEvents.length ===
          0 ? (
            <p
              style={{
                color:
                  "#6b7280",
              }}
            >
              No event timeline found for this bag yet.
            </p>
          ) : (
            <div
              style={{
                display:
                  "grid",

                gap:
                  10,
              }}
            >
              {sortedEvents.map(
                (
                  event,
                  index
                ) => {
                  const type =
                    event.type ||
                    event.event;

                  const position =
                    getOperationalPositionLabel(
                      event
                    );

                  const location =
                    event.locationLabel ||
                    getLocationLabel(
                      event.receivingLocation ||
                        event.location
                    );

                  return (
                    <div
                      key={`${event.id || "event"}_${index}`}
                      style={{
                        border:
                          `1px solid ${getEventBorder(
                            type
                          )}`,

                        borderLeft:
                          `8px solid ${getEventBorder(
                            type
                          )}`,

                        borderRadius:
                          12,

                        padding:
                          isMobile
                            ? 10
                            : 12,

                        background:
                          "white",
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
                        }}
                      >
                        <div
                          style={{
                            fontWeight:
                              900,
                          }}
                        >
                          {getEventIcon(
                            type
                          )}{" "}
                          {getEventTitle(
                            type
                          )}
                        </div>

                        <div
                          style={{
                            color:
                              "#6b7280",

                            fontSize:
                              "0.82rem",
                          }}
                        >
                          {formatDateTime(
                            getEventTime(
                              event
                            )
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop:
                            8,

                          color:
                            "#374151",

                          fontSize:
                            "0.9rem",
                        }}
                      >
                        {event.message ||
                          "-"}
                      </div>

                      <div
                        style={{
                          marginTop:
                            8,

                          display:
                            "flex",

                          gap:
                            6,

                          flexWrap:
                            "wrap",

                          fontSize:
                            "0.8rem",
                        }}
                      >
                        {(event.tag ||
                          event.bagTag) && (
                          <Badge
                            label={`Tag ${
                              event.tag ||
                              event.bagTag
                            }`}
                          />
                        )}

                        {location !==
                          "Unknown" && (
                          <Badge
                            label={
                              location
                            }
                          />
                        )}

                        {event.cartNumber && (
                          <Badge
                            label={`Cart ${event.cartNumber}`}
                          />
                        )}

                        {event.zone && (
                          <Badge
                            label={`Zone ${event.zone}`}
                          />
                        )}

                        {event.bagTypeLabel && (
                          <Badge
                            label={
                              event.bagTypeLabel
                            }
                          />
                        )}

                        {event.flightNumber && (
                          <Badge
                            label={`Flight ${event.flightNumber}`}
                          />
                        )}

                        {event.flightDate && (
                          <Badge
                            label={`Date ${event.flightDate}`}
                          />
                        )}

                        {getActorLabel(
                          event
                        ) !== "-" && (
                          <Badge
                            label={`By ${getActorLabel(
                              event
                            )}`}
                          />
                        )}

                        {position && (
                          <Badge
                            label={`Position ${position}`}
                          />
                        )}
                      </div>

                      {event.previousLocationLabel && (
                        <div
                          style={{
                            marginTop:
                              8,

                            padding:
                              8,

                            borderRadius:
                              10,

                            background:
                              "#eff6ff",

                            color:
                              "#1d4ed8",

                            fontSize:
                              "0.8rem",
                          }}
                        >
                          Previous location:{" "}
                          <strong>
                            {
                              event.previousLocationLabel
                            }
                            {event.previousCartNumber
                              ? ` - Cart ${event.previousCartNumber}`
                              : ""}
                          </strong>
                        </div>
                      )}

                      {event.reason && (
                        <div
                          style={{
                            marginTop:
                              8,

                            padding:
                              8,

                            borderRadius:
                              10,

                            background:
                              "#fef2f2",

                            color:
                              "#991b1b",

                            fontSize:
                              "0.85rem",

                            fontWeight:
                              800,
                          }}
                        >
                          Reason:{" "}
                          {
                            event.reason
                          }
                        </div>
                      )}
                    </div>
                  );
                }
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
}) {
  return (
    <div
      style={{
        border:
          "1px solid #e5e7eb",

        borderRadius:
          12,

        padding:
          10,

        background:
          "#f9fafb",

        minWidth:
          0,
      }}
    >
      <div
        style={{
          fontSize:
            "0.75rem",

          color:
            "#6b7280",
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            2,

          fontSize:
            "0.95rem",

          fontWeight:
            900,

          overflowWrap:
            "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Badge({
  label,
}) {
  return (
    <span
      style={{
        display:
          "inline-flex",

        alignItems:
          "center",

        padding:
          "3px 8px",

        borderRadius:
          999,

        background:
          "#f3f4f6",

        border:
          "1px solid #e5e7eb",

        color:
          "#374151",

        fontWeight:
          800,
      }}
    >
      {label}
    </span>
  );
}

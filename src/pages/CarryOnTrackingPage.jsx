// src/pages/CarryOnTrackingPage.jsx

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  onSnapshot,
} from "firebase/firestore";

import { db } from "../firebase";

const BLCS_LOGO_SRC = "/blcs-icon-512.png";

function cleanUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function formatTimestamp(value) {
  if (!value) return "-";

  try {
    const date =
      typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString();
  } catch {
    return "-";
  }
}

function actorName(value) {
  return (
    value?.fullName ||
    value?.username ||
    "-"
  );
}

function statusLabel(status) {
  switch (cleanUpper(status)) {
    case "COUNTER_ASSIGNED":
      return "Counter Assigned";
    case "GATE_COLLECTED":
      return "Gate Collected";
    case "RAMP_RECEIVED":
      return "Ramp Received";
    case "AIRCRAFT_LOADED":
      return "Aircraft Loaded";
    default:
      return status || "-";
  }
}

function statusRank(status) {
  switch (cleanUpper(status)) {
    case "COUNTER_ASSIGNED":
      return 1;
    case "GATE_COLLECTED":
      return 2;
    case "RAMP_RECEIVED":
      return 3;
    case "AIRCRAFT_LOADED":
      return 4;
    default:
      return 0;
  }
}

export default function CarryOnTrackingPage({
  selectedCarryOnFlightId,
  onSelectCarryOnFlight,
}) {
  const [flights, setFlights] =
    useState([]);

  const [assignments, setAssignments] =
    useState([]);

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("ALL");

  const [selectedAssignmentId, setSelectedAssignmentId] =
    useState("");

  const [printMode, setPrintMode] =
    useState("FULL");

  const [error, setError] =
    useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "carryOnFlights"),
      (snap) => {
        const rows = snap.docs.map(
          (item) => ({
            id: item.id,
            ...item.data(),
          })
        );

        rows.sort((a, b) =>
          String(b.flightDate || "").localeCompare(
            String(a.flightDate || "")
          )
        );

        setFlights(rows);
      },
      (snapshotError) => {
        console.error(
          "Carry-On Tracking flight list error:",
          snapshotError
        );

        setError(
          "Unable to load Carry-On flights."
        );
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selectedCarryOnFlightId) {
      setAssignments([]);
      setSelectedAssignmentId("");
      return undefined;
    }

    const unsub = onSnapshot(
      collection(
        db,
        "carryOnFlights",
        selectedCarryOnFlightId,
        "assignments"
      ),
      (snap) => {
        setAssignments(
          snap.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
      },
      (snapshotError) => {
        console.error(
          "Carry-On Tracking assignments error:",
          snapshotError
        );

        setError(
          "Unable to load Carry-On assignments."
        );
      }
    );

    return () => unsub();
  }, [selectedCarryOnFlightId]);

  const selectedFlight = useMemo(
    () =>
      flights.find(
        (item) =>
          item.id === selectedCarryOnFlightId
      ) || null,
    [flights, selectedCarryOnFlightId]
  );

  const totals = useMemo(() => {
    const values = {
      total: assignments.length,
      counter: 0,
      gate: 0,
      ramp: 0,
      loaded: 0,
    };

    assignments.forEach((item) => {
      const status = cleanUpper(
        item?.status
      );

      if (status === "COUNTER_ASSIGNED") {
        values.counter += 1;
      }

      if (status === "GATE_COLLECTED") {
        values.gate += 1;
      }

      if (status === "RAMP_RECEIVED") {
        values.ramp += 1;
      }

      if (status === "AIRCRAFT_LOADED") {
        values.loaded += 1;
      }
    });

    return values;
  }, [assignments]);

  const filteredAssignments =
    useMemo(() => {
      const query =
        String(search || "")
          .trim()
          .toLowerCase();

      return assignments
        .filter((item) => {
          const status =
            cleanUpper(item?.status);

          if (
            statusFilter !== "ALL" &&
            status !== statusFilter
          ) {
            return false;
          }

          if (!query) {
            return true;
          }

          const haystack = [
            item?.passengerName,
            item?.gateCheckNumber,
            item?.assignedSeat,
            item?.compartment,
            item?.status,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return haystack.includes(query);
        })
        .sort((a, b) => {
          const rankDifference =
            statusRank(a?.status) -
            statusRank(b?.status);

          if (rankDifference !== 0) {
            return rankDifference;
          }

          return String(
            a.gateCheckNumber || ""
          ).localeCompare(
            String(b.gateCheckNumber || "")
          );
        });
    }, [
      assignments,
      search,
      statusFilter,
    ]);

  const selectedAssignment = useMemo(
    () =>
      assignments.find(
        (item) =>
          item.id === selectedAssignmentId
      ) || null,
    [assignments, selectedAssignmentId]
  );

  const printFullTracking = () => {
    setPrintMode("FULL");

    window.setTimeout(() => {
      window.print();
    }, 50);
  };

  const printPassengerDetail = () => {
    if (!selectedAssignment) return;

    setPrintMode("PASSENGER");

    window.setTimeout(() => {
      window.print();
    }, 50);
  };

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
      }}
    >
      <style>
        {`
          @media print {
            body * {
              visibility: hidden !important;
            }

            #carry-on-tracking-print-area,
            #carry-on-tracking-print-area * {
              visibility: visible !important;
            }

            #carry-on-tracking-print-area {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              padding: 18px !important;
              box-sizing: border-box !important;
              background: white !important;
            }

            .tracking-no-print {
              display: none !important;
            }

            .tracking-print-full-only {
              display: ${
                printMode === "FULL"
                  ? "block"
                  : "none"
              } !important;
            }

            .tracking-print-passenger-only {
              display: ${
                printMode === "PASSENGER"
                  ? "block"
                  : "none"
              } !important;
            }
          }
        `}
      </style>

      <div
        className="tracking-no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>
            Carry-On Tracking
          </h3>

          <p
            style={{
              margin: "6px 0 0",
              color: "#64748b",
              fontSize: "0.82rem",
            }}
          >
            Follow each Gate Check from Counter assignment through final Aircraft Loading.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "flex-end",
          }}
        >
          <label
            style={{
              display: "grid",
              gap: 5,
              minWidth: 240,
            }}
          >
            <span
              style={{
                color: "#475569",
                fontSize: "0.75rem",
                fontWeight: 800,
              }}
            >
              Carry-On Flight
            </span>

            <select
              value={
                selectedCarryOnFlightId || ""
              }
              onChange={(event) => {
                onSelectCarryOnFlight?.(
                  event.target.value || null
                );
                setSelectedAssignmentId("");
              }}
              style={inputStyle}
            >
              <option value="">
                Select flight
              </option>

              {flights.map((flight) => (
                <option
                  key={flight.id}
                  value={flight.id}
                >
                  {flight.flightNumber} - {flight.flightDate}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={printFullTracking}
            disabled={!selectedFlight}
            style={{
              ...secondaryButton,
              opacity:
                selectedFlight ? 1 : 0.55,
            }}
          >
            Print Full Detail
          </button>
        </div>
      </div>

      {selectedFlight ? (
        <div
          id="carry-on-tracking-print-area"
          style={{
            display: "grid",
            gap: 14,
          }}
        >
          <DocumentHeader
            title="Carry-On Tracking"
            subtitle="BLCS OPERATIONS"
            flightNumber={selectedFlight.flightNumber}
            flightDate={selectedFlight.flightDate}
            origin={selectedFlight.origin}
            destination={selectedFlight.destination}
            gate={selectedFlight.gate}
            tailNumber={selectedFlight.tailNumber}
          />

          <div
            className="tracking-print-full-only"
            style={{
              display: "grid",
              gap: 14,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(130px, 1fr))",
                gap: 8,
              }}
            >
              <Metric
                label="Total"
                value={totals.total}
              />
              <Metric
                label="At Counter"
                value={totals.counter}
              />
              <Metric
                label="At Gate"
                value={totals.gate}
              />
              <Metric
                label="At Ramp"
                value={totals.ramp}
              />
              <Metric
                label="Loaded"
                value={totals.loaded}
              />
            </div>

            <div
              className="tracking-no-print"
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(220px, 1fr) minmax(180px, 240px)",
                gap: 8,
              }}
            >
              <label
                style={{
                  display: "grid",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    color: "#475569",
                    fontSize: "0.75rem",
                    fontWeight: 800,
                  }}
                >
                  Search
                </span>

                <input
                  type="text"
                  value={search}
                  placeholder="Passenger, Gate Check, Seat..."
                  onChange={(event) =>
                    setSearch(
                      event.target.value
                    )
                  }
                  style={inputStyle}
                />
              </label>

              <label
                style={{
                  display: "grid",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    color: "#475569",
                    fontSize: "0.75rem",
                    fontWeight: 800,
                  }}
                >
                  Status
                </span>

                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value
                    )
                  }
                  style={inputStyle}
                >
                  <option value="ALL">
                    All
                  </option>

                  <option value="COUNTER_ASSIGNED">
                    Counter Assigned
                  </option>

                  <option value="GATE_COLLECTED">
                    Gate Collected
                  </option>

                  <option value="RAMP_RECEIVED">
                    Ramp Received
                  </option>

                  <option value="AIRCRAFT_LOADED">
                    Aircraft Loaded
                  </option>
                </select>
              </label>
            </div>

            {filteredAssignments.length ===
            0 ? (
              <Notice
                tone="warning"
                text="No Carry-On assignments match the current filter."
              />
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 10,
                }}
              >
                {filteredAssignments.map(
                  (item) => (
                    <TrackingCard
                      key={item.id}
                      item={item}
                      selected={
                        item.id ===
                        selectedAssignmentId
                      }
                      onSelect={() =>
                        setSelectedAssignmentId(
                          item.id
                        )
                      }
                    />
                  )
                )}
              </div>
            )}
          </div>

          {selectedAssignment && (
            <div
              className="tracking-print-passenger-only"
              style={{
                display:
                  printMode === "PASSENGER"
                    ? "block"
                    : "none",
              }}
            >
              <PassengerFullDetail
                item={selectedAssignment}
                selectedFlight={selectedFlight}
              />
            </div>
          )}

          {selectedAssignment && (
            <div
              className="tracking-no-print"
              style={{
                padding: 13,
                borderRadius: 12,
                border:
                  "1px solid #c4b5fd",
                background: "#faf5ff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong>
                    Selected Passenger
                  </strong>

                  <div
                    style={{
                      marginTop: 3,
                      color: "#64748b",
                      fontSize: "0.78rem",
                    }}
                  >
                    {selectedAssignment.passengerName || "-"}
                    {" - "}
                    {selectedAssignment.gateCheckNumber || "-"}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={printPassengerDetail}
                    style={primaryButton}
                  >
                    Print Passenger Detail
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedAssignmentId("")
                    }
                    style={secondaryButton}
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <Notice
              tone="error"
              text={error}
            />
          )}
        </div>
      ) : (
        <Notice
          tone="warning"
          text="Select a Carry-On flight to view Tracking."
        />
      )}
    </div>
  );
}

function TrackingCard({
  item,
  selected,
  onSelect,
}) {
  const status =
    cleanUpper(item?.status);

  const steps = [
    {
      key: "COUNTER_ASSIGNED",
      label: "Counter Assigned",
      active:
        statusRank(status) >= 1,
      time:
        item.counterAssignedAt,
      actor:
        item.counterAssignedBy,
    },
    {
      key: "GATE_COLLECTED",
      label: "Gate Collected",
      active:
        statusRank(status) >= 2,
      time:
        item.gateCollectedAt,
      actor:
        item.gateCollectedBy,
    },
    {
      key: "RAMP_RECEIVED",
      label: "Ramp Received",
      active:
        statusRank(status) >= 3,
      time:
        item.rampReceivedAt,
      actor:
        item.rampReceivedBy,
    },
    {
      key: "AIRCRAFT_LOADED",
      label: "Aircraft Loaded",
      active:
        statusRank(status) >= 4,
      time:
        item.aircraftLoadedAt,
      actor:
        item.aircraftLoadedBy,
    },
  ];

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: "100%",
        textAlign: "left",
        padding: 13,
        borderRadius: 12,
        border: selected
          ? "2px solid #7c3aed"
          : "1px solid #e2e8f0",
        background: selected
          ? "#faf5ff"
          : "white",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <strong>
              {item.passengerName || "-"}
            </strong>

            <span
              style={{
                color: "#6d28d9",
                fontWeight: 900,
              }}
            >
              {item.gateCheckNumber || "-"}
            </span>
          </div>

          <div
            style={{
              marginTop: 4,
              color: "#64748b",
              fontSize: "0.78rem",
            }}
          >
            Seat: {item.assignedSeat || "-"}
            {" - "}
            Status: {statusLabel(item.status)}
            {item.compartment
              ? ` - ${item.compartment}`
              : ""}
          </div>
        </div>

        <StatusBadge
          status={item.status}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 8,
          marginTop: 12,
        }}
      >
        {steps.map((step) => (
          <div
            key={step.key}
            style={{
              padding: 10,
              borderRadius: 10,
              border: step.active
                ? "1px solid #bbf7d0"
                : "1px solid #e2e8f0",
              background: step.active
                ? "#f0fdf4"
                : "#f8fafc",
              opacity: step.active
                ? 1
                : 0.68,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background:
                    step.active
                      ? "#16a34a"
                      : "#cbd5e1",
                  flex:
                    "0 0 auto",
                }}
              />

              <strong
                style={{
                  fontSize: "0.78rem",
                  color:
                    step.active
                      ? "#166534"
                      : "#64748b",
                }}
              >
                {step.label}
              </strong>
            </div>

            <div
              style={{
                marginTop: 7,
                color: "#475569",
                fontSize: "0.72rem",
              }}
            >
              {step.active
                ? formatTimestamp(
                    step.time
                  )
                : "Pending"}
            </div>

            <div
              style={{
                marginTop: 2,
                color: "#64748b",
                fontSize: "0.7rem",
              }}
            >
              {step.active
                ? actorName(
                    step.actor
                  )
                : "-"}
            </div>
          </div>
        ))}
      </div>

      {status ===
        "AIRCRAFT_LOADED" && (
        <div
          style={{
            marginTop: 10,
            padding: 9,
            borderRadius: 9,
            background: "#f0fdf4",
            border:
              "1px solid #bbf7d0",
            color: "#166534",
            fontSize: "0.76rem",
            fontWeight: 800,
          }}
        >
          Final location: {item.compartment || "-"}
        </div>
      )}
    </button>
  );
}

function PassengerFullDetail({
  item,
  selectedFlight,
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 14,
      }}
    >
      <DocumentHeader
        title="Carry-On Passenger Full Detail"
        subtitle="BLCS OPERATIONS"
        flightNumber={selectedFlight?.flightNumber}
        flightDate={selectedFlight?.flightDate}
        origin={selectedFlight?.origin}
        destination={selectedFlight?.destination}
        gate={selectedFlight?.gate}
        tailNumber={selectedFlight?.tailNumber}
      >
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
          }}
        >
          <Info
            label="Passenger"
            value={item.passengerName || "-"}
          />

          <Info
            label="Seat"
            value={item.assignedSeat || "-"}
          />

          <Info
            label="Gate Check"
            value={item.gateCheckNumber || "-"}
          />

          <Info
            label="Status"
            value={statusLabel(item.status)}
          />

          <Info
            label="Compartment"
            value={item.compartment || "-"}
          />

          <Info
            label="Source"
            value={item.passengerSource || "-"}
          />

          <Info
            label="Flight"
            value={selectedFlight?.flightNumber || "-"}
          />

          <Info
            label="Date"
            value={selectedFlight?.flightDate || "-"}
          />

          <Info
            label="Route"
            value={`${selectedFlight?.origin || "-"} -> ${selectedFlight?.destination || "-"}`}
          />

          <Info
            label="Gate"
            value={selectedFlight?.gate || "-"}
          />

          <Info
            label="Tail"
            value={selectedFlight?.tailNumber || "-"}
          />
        </div>
      </DocumentHeader>

      <DetailStep
        title="1. Counter Assigned"
        time={item.counterAssignedAt}
        actor={item.counterAssignedBy}
      />

      <DetailStep
        title="2. Gate Collected"
        time={item.gateCollectedAt}
        actor={item.gateCollectedBy}
      />

      <DetailStep
        title="3. Ramp Received"
        time={item.rampReceivedAt}
        actor={item.rampReceivedBy}
      />

      <DetailStep
        title="4. Aircraft Loaded"
        time={item.aircraftLoadedAt}
        actor={item.aircraftLoadedBy}
        extra={
          item.compartment
            ? `Compartment: ${item.compartment}`
            : null
        }
      />
    </div>
  );
}

function DocumentHeader({
  title,
  subtitle = "BLCS OPERATIONS",
  flightNumber,
  flightDate,
  origin,
  destination,
  gate,
  tailNumber,
  children,
}) {
  const routeText =
    origin || destination
      ? `${origin || "-"} -> ${destination || "-"}`
      : null;

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border:
          "1px solid #cbd5e1",
        background: "white",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              color: "#64748b",
              fontSize: "0.72rem",
              fontWeight: 800,
            }}
          >
            {subtitle}
          </div>

          <h2
            style={{
              margin: "4px 0 0",
            }}
          >
            {title}
          </h2>

          <div
            style={{
              marginTop: 8,
              color: "#0f172a",
              fontWeight: 800,
              fontSize: "0.92rem",
            }}
          >
            {(flightNumber || "-") +
              " - " +
              (flightDate || "-")}
          </div>

          {(routeText || gate || tailNumber) && (
            <div
              style={{
                marginTop: 4,
                color: "#64748b",
                fontSize: "0.8rem",
              }}
            >
              {routeText || ""}
              {gate
                ? `${routeText ? " - " : ""}Gate ${gate}`
                : ""}
              {tailNumber
                ? `${routeText || gate ? " - " : ""}Tail ${tailNumber}`
                : ""}
            </div>
          )}
        </div>

        <img
          src={BLCS_LOGO_SRC}
          alt="BLCSYSTEM logo"
          style={{
            width: 84,
            maxWidth: "100%",
            height: "auto",
            objectFit: "contain",
          }}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      </div>

      {children}
    </div>
  );
}

function DetailStep({
  title,
  time,
  actor,
  extra,
}) {
  const complete = Boolean(time);

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 11,
        border: complete
          ? "1px solid #bbf7d0"
          : "1px solid #e2e8f0",
        background: complete
          ? "#f0fdf4"
          : "#f8fafc",
      }}
    >
      <strong>
        {title}
      </strong>

      <div
        style={{
          marginTop: 6,
          color: "#475569",
          fontSize: "0.8rem",
        }}
      >
        Time: {formatTimestamp(time)}
      </div>

      <div
        style={{
          marginTop: 3,
          color: "#64748b",
          fontSize: "0.78rem",
        }}
      >
        By: {actorName(actor)}
      </div>

      {extra && (
        <div
          style={{
            marginTop: 3,
            color: "#166534",
            fontSize: "0.78rem",
            fontWeight: 800,
          }}
        >
          {extra}
        </div>
      )}
    </div>
  );
}

function Info({
  label,
  value,
}) {
  return (
    <div>
      <div
        style={{
          color: "#64748b",
          fontSize: "0.68rem",
          fontWeight: 800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 2,
          color: "#0f172a",
          fontWeight: 800,
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
  const normalized =
    cleanUpper(status);

  const config = {
    COUNTER_ASSIGNED: {
      label: "COUNTER",
      background:
        "#f5f3ff",
      border:
        "#c4b5fd",
      color:
        "#6d28d9",
    },
    GATE_COLLECTED: {
      label: "GATE",
      background:
        "#eff6ff",
      border:
        "#bfdbfe",
      color:
        "#1d4ed8",
    },
    RAMP_RECEIVED: {
      label: "RAMP",
      background:
        "#fff7ed",
      border:
        "#fed7aa",
      color:
        "#c2410c",
    },
    AIRCRAFT_LOADED: {
      label: "LOADED",
      background:
        "#f0fdf4",
      border:
        "#bbf7d0",
      color:
        "#166534",
    },
  };

  const selected =
    config[normalized] || {
      label:
        normalized || "UNKNOWN",
      background:
        "#f8fafc",
      border:
        "#e2e8f0",
      color:
        "#475569",
    };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "5px 8px",
        borderRadius: 999,
        background:
          selected.background,
        border:
          `1px solid ${selected.border}`,
        color:
          selected.color,
        fontSize: "0.68rem",
        fontWeight: 900,
      }}
    >
      {selected.label}
    </span>
  );
}

function Metric({
  label,
  value,
}) {
  return (
    <div
      style={{
        padding: 9,
        borderRadius: 10,
        border:
          "1px solid #e2e8f0",
        background:
          "#f8fafc",
      }}
    >
      <div
        style={{
          color: "#64748b",
          fontSize: "0.68rem",
          fontWeight: 700,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 2,
          color: "#0f172a",
          fontSize: "1.12rem",
          fontWeight: 900,
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
  const warning =
    tone === "warning";

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background: warning
          ? "#fffbeb"
          : "#fef2f2",
        border: warning
          ? "1px solid #fde68a"
          : "1px solid #fecaca",
        color: warning
          ? "#92400e"
          : "#991b1b",
        fontSize: "0.82rem",
        fontWeight: 800,
      }}
    >
      {text}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 10,
  border:
    "1px solid #cbd5e1",
  background: "white",
  fontSize: "0.9rem",
};

const primaryButton = {
  padding: "10px 14px",
  borderRadius: 10,
  border:
    "1px solid #7c3aed",
  background: "#7c3aed",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryButton = {
  padding: "10px 14px",
  borderRadius: 10,
  border:
    "1px solid #cbd5e1",
  background: "white",
  color: "#334155",
  fontWeight: 900,
  cursor: "pointer",
};

// src/pages/CarryOnSummaryPage.jsx

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "../firebase";

function cleanUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function formatTimestamp(value) {
  if (!value) return "-";

  try {
    const date = typeof value?.toDate === "function"
      ? value.toDate()
      : new Date(value);

    return Number.isNaN(date.getTime())
      ? "-"
      : date.toLocaleString();
  } catch {
    return "-";
  }
}

function actorName(value) {
  return value?.fullName || value?.username || "-";
}

function getActor(user, operationalContext) {
  return {
    userId: user?.id || null,
    username: user?.username || null,
    fullName:
      operationalContext?.employeeFullName ||
      user?.fullName ||
      user?.username ||
      null,
    role: user?.role || null,
    operationalPosition:
      operationalContext?.operationalPosition || null,
    operationalPositionLabel:
      operationalContext?.operationalPositionLabel || null,
  };
}

function statusLabel(value) {
  const status = cleanUpper(value);
  if (!status) return "SETUP";
  return status.replaceAll("_", " ");
}

export default function CarryOnSummaryPage({
  user,
  operationalContext,
  selectedCarryOnFlightId,
  onSelectCarryOnFlight,
  onOpenTab,
}) {
  const role = normalizeRole(user?.role);
  const actor = useMemo(
    () => getActor(user, operationalContext),
    [user, operationalContext]
  );

  const canDelete =
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "duty_managers" ||
    role === "supervisor";

  const [flights, setFlights] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [events, setEvents] = useState([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [quickRange, setQuickRange] = useState("ALL");
  const [showDeleted, setShowDeleted] = useState(false);
  const [expandedFlightId, setExpandedFlightId] = useState("");
  const [assignmentsExpanded, setAssignmentsExpanded] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [processingId, setProcessingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "carryOnFlights"),
      (snap) => {
        const rows = snap.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        rows.sort((a, b) => {
          const dateCompare = String(b.flightDate || "").localeCompare(
            String(a.flightDate || "")
          );
          if (dateCompare !== 0) return dateCompare;
          return String(a.flightNumber || "").localeCompare(
            String(b.flightNumber || "")
          );
        });

        setFlights(rows);
      },
      (snapshotError) => {
        console.error("Carry-On Summary flights error:", snapshotError);
        setError("Unable to load Carry-On flights.");
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const targetId = expandedFlightId;

    if (!targetId) {
      setAssignments([]);
      setEvents([]);
      return undefined;
    }

    const unsubAssignments = onSnapshot(
      collection(db, "carryOnFlights", targetId, "assignments"),
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
        setAssignments(rows);
      },
      (snapshotError) => {
        console.error("Carry-On Summary assignments error:", snapshotError);
      }
    );

    const unsubEvents = onSnapshot(
      collection(db, "carryOnFlights", targetId, "events"),
      (snap) => {
        const rows = snap.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        rows.sort((a, b) => {
          const aMillis = a?.createdAt?.toMillis?.() || 0;
          const bMillis = b?.createdAt?.toMillis?.() || 0;
          return bMillis - aMillis;
        });

        setEvents(rows);
      },
      (snapshotError) => {
        console.error("Carry-On Summary events error:", snapshotError);
      }
    );

    return () => {
      unsubAssignments();
      unsubEvents();
    };
  }, [expandedFlightId]);


  const applyQuickRange = (range) => {
    setQuickRange(range);

    if (range === "ALL") {
      setDateFrom("");
      setDateTo("");
      return;
    }

    const today = new Date();
    const toDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const fromDate = new Date(toDate);

    if (range === "TODAY") {
      // Same day.
    } else if (range === "7D") {
      fromDate.setDate(fromDate.getDate() - 6);
    } else if (range === "30D") {
      fromDate.setDate(fromDate.getDate() - 29);
    }

    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    setDateFrom(formatDate(fromDate));
    setDateTo(formatDate(toDate));
  };

  const clearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setStatusFilter("ALL");
    setQuickRange("ALL");
  };

  const filteredFlights = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();

    return flights.filter((flight) => {
      const deleted = flight?.isDeleted === true;
      if (!showDeleted && deleted) return false;
      if (showDeleted && !deleted) return false;

      if (dateFrom && String(flight.flightDate || "") < dateFrom) {
        return false;
      }

      if (dateTo && String(flight.flightDate || "") > dateTo) {
        return false;
      }

      if (
        statusFilter !== "ALL" &&
        cleanUpper(flight?.status) !== statusFilter
      ) {
        return false;
      }

      if (!query) return true;

      const haystack = [
        flight?.flightNumber,
        flight?.flightDate,
        flight?.origin,
        flight?.destination,
        flight?.gate,
        flight?.tailNumber,
        flight?.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [flights, search, dateFrom, dateTo, statusFilter, showDeleted]);

  const filteredTotals = useMemo(() => {
    return filteredFlights.reduce(
      (totals, flight) => {
        totals.flights += 1;
        totals.gateChecks += Number(flight?.gateCheckNumberCount || 0);

        if (cleanUpper(flight?.status) === "CLOSED") {
          totals.closed += 1;
        }

        return totals;
      },
      {
        flights: 0,
        gateChecks: 0,
        closed: 0,
      }
    );
  }, [filteredFlights]);

  const detailFlight = useMemo(() => {
    if (!expandedFlightId) return null;
    return flights.find((item) => item.id === expandedFlightId) || null;
  }, [flights, expandedFlightId]);

  const counts = useMemo(() => {
    const result = {
      assigned: assignments.length,
      counter: 0,
      gate: 0,
      ramp: 0,
      loaded: 0,
      offloaded: 0,
    };

    assignments.forEach((item) => {
      const status = cleanUpper(item?.status);
      if (status === "COUNTER_ASSIGNED") result.counter += 1;
      if (status === "GATE_COLLECTED") result.gate += 1;
      if (status === "RAMP_RECEIVED") result.ramp += 1;
      if (status === "AIRCRAFT_LOADED") result.loaded += 1;
      if (status === "OFFLOADED") result.offloaded += 1;
    });

    return result;
  }, [assignments]);

  const openFlight = (flight, targetTab = "TRACKING") => {
    if (!flight) return;
    onSelectCarryOnFlight?.(flight.id);
    setExpandedFlightId(flight.id);
    onOpenTab?.(targetTab);
  };

  const softDeleteFlight = async (flight) => {
    setError("");
    setMessage("");

    if (!canDelete) {
      setError("You do not have permission to delete Carry-On flights.");
      return;
    }

    const ok = window.confirm(
      `Move ${flight.flightNumber || "this Carry-On flight"} - ${flight.flightDate || ""} to deleted flights?\n\nOperational history will be preserved.`
    );

    if (!ok) return;

    try {
      setProcessingId(flight.id);

      await setDoc(
        doc(db, "carryOnFlights", flight.id),
        {
          isDeleted: true,
          deletedAt: serverTimestamp(),
          deletedBy: actor,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        },
        { merge: true }
      );

      if (selectedCarryOnFlightId === flight.id) {
        onSelectCarryOnFlight?.(null);
      }

      if (expandedFlightId === flight.id) {
        setExpandedFlightId("");
      }

      setMessage(`${flight.flightNumber || "Carry-On flight"} moved to deleted flights.`);
    } catch (deleteError) {
      console.error("Carry-On Summary delete error:", deleteError);
      setError(deleteError?.message || "Unable to delete Carry-On flight.");
    } finally {
      setProcessingId("");
    }
  };

  const restoreFlight = async (flight) => {
    setError("");
    setMessage("");

    if (!canDelete) {
      setError("You do not have permission to restore Carry-On flights.");
      return;
    }

    try {
      setProcessingId(flight.id);

      await setDoc(
        doc(db, "carryOnFlights", flight.id),
        {
          isDeleted: false,
          restoredAt: serverTimestamp(),
          restoredBy: actor,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        },
        { merge: true }
      );

      setMessage(`${flight.flightNumber || "Carry-On flight"} restored.`);
    } catch (restoreError) {
      console.error("Carry-On Summary restore error:", restoreError);
      setError(restoreError?.message || "Unable to restore Carry-On flight.");
    } finally {
      setProcessingId("");
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <style>{`
        @media (max-width: 760px) {
          .carry-on-summary-filters {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={eyebrowStyle}>CARRY-ON HISTORY</div>
          <h3 style={{ margin: "4px 0 0" }}>Carry Ons Resumen</h3>
          <p style={smallText}>
            Search previous Carry-On flights, review the complete operational history, reopen a flight, or safely remove it from the active list.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowDeleted((previous) => !previous)}
          style={secondaryButton}
        >
          {showDeleted ? "Show Active Flights" : "Deleted Flights"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 7,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {[
          ["ALL", "All"],
          ["TODAY", "Today"],
          ["7D", "Last 7 Days"],
          ["30D", "Last 30 Days"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => applyQuickRange(value)}
            style={{
              ...quickFilterButton,
              ...(quickRange === value
                ? quickFilterButtonActive
                : {}),
            }}
          >
            {label}
          </button>
        ))}

        <button
          type="button"
          onClick={clearFilters}
          style={secondaryButton}
        >
          Clear Filters
        </button>
      </div>

      <div className="carry-on-summary-filters" style={filterPanelStyle}>
        <label style={fieldWrapStyle}>
          <span style={fieldLabelStyle}>Search</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Flight, date, route, gate, tail..."
            style={inputStyle}
          />
        </label>

        <label style={fieldWrapStyle}>
          <span style={fieldLabelStyle}>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
              setQuickRange("CUSTOM");
            }}
            style={inputStyle}
          />
        </label>

        <label style={fieldWrapStyle}>
          <span style={fieldLabelStyle}>To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
              setQuickRange("CUSTOM");
            }}
            style={inputStyle}
          />
        </label>

        <label style={fieldWrapStyle}>
          <span style={fieldLabelStyle}>Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            style={inputStyle}
          >
            <option value="ALL">All</option>
            <option value="SETUP">Setup</option>
            <option value="READY">Ready</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
      </div>

      <div style={summaryMetricsGridStyle}>
        <MiniMetric
          label="Flights"
          value={filteredTotals.flights}
        />
        <MiniMetric
          label="Gate Checks"
          value={filteredTotals.gateChecks}
        />
        <MiniMetric
          label="Closed Flights"
          value={filteredTotals.closed}
        />
        <MiniMetric
          label={showDeleted ? "Deleted View" : "Active View"}
          value={filteredFlights.length}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <strong style={{ color: "#0f172a" }}>
          {showDeleted ? "Deleted" : "Active"} Carry-On Flights
        </strong>
        <span style={{ color: "#64748b", fontSize: "0.78rem", fontWeight: 800 }}>
          {filteredFlights.length} flight(s)
        </span>
      </div>

      {filteredFlights.length === 0 ? (
        <div style={emptyStateStyle}>
          No Carry-On flights match the current filters.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 9 }}>
          {filteredFlights.map((flight) => {
            const expanded = detailFlight?.id === flight.id;
            const deleted = flight?.isDeleted === true;

            return (
              <div
                key={flight.id}
                style={{
                  border: expanded
                    ? "2px solid #7c3aed"
                    : "1px solid #e2e8f0",
                  borderRadius: 14,
                  background: expanded ? "#faf5ff" : "white",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const nextId = expanded ? "" : flight.id;
                    onSelectCarryOnFlight?.(flight.id);
                    setExpandedFlightId(nextId);
                    setAssignmentsExpanded(false);
                    setTimelineExpanded(false);
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    background: "transparent",
                    padding: 13,
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          gap: 7,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <strong style={{ fontSize: "1rem", color: "#0f172a" }}>
                          {flight.flightNumber || "-"}
                        </strong>
                        <span style={statusPillStyle}>
                          {statusLabel(flight.status)}
                        </span>
                      </div>

                      <div style={{ marginTop: 4, color: "#475569", fontSize: "0.8rem" }}>
                        {flight.flightDate || "-"} | {flight.origin || "-"} -&gt; {flight.destination || "-"}
                        {flight.gate ? ` | Gate ${flight.gate}` : ""}
                      </div>

                      <div style={{ marginTop: 3, color: "#64748b", fontSize: "0.74rem" }}>
                        Tail: {flight.tailNumber || "-"} | Required: {Number(flight.requiredCarryOns || 0)} | Gate Checks: {Number(flight.gateCheckNumberCount || 0)}
                      </div>
                    </div>

                    <span style={{ color: "#7c3aed", fontWeight: 900 }}>
                      {expanded ? "Hide" : "View"}
                    </span>
                  </div>
                </button>

                {expanded && (
                  <div
                    style={{
                      padding: "0 13px 13px",
                      display: "grid",
                      gap: 11,
                    }}
                  >
                    <div style={metricsGridStyle}>
                      <MiniMetric label="Assigned" value={counts.assigned} />
                      <MiniMetric label="Counter" value={counts.counter} />
                      <MiniMetric label="Gate" value={counts.gate} />
                      <MiniMetric label="Ramp" value={counts.ramp} />
                      <MiniMetric label="Loaded" value={counts.loaded} />
                      <MiniMetric label="Offloaded" value={counts.offloaded} />
                    </div>

                    <div style={actionsStyle}>
                      {!deleted && (
                        <>
                          <button
                            type="button"
                            onClick={() => openFlight(flight, "SETUP")}
                            style={secondaryButton}
                          >
                            Open Setup
                          </button>
                          <button
                            type="button"
                            onClick={() => openFlight(flight, "TRACKING")}
                            style={primaryButton}
                          >
                            Open Tracking
                          </button>
                          <button
                            type="button"
                            onClick={() => openFlight(flight, "REPORT")}
                            style={secondaryButton}
                          >
                            Open Report
                          </button>
                        </>
                      )}

                      {canDelete && !deleted && (
                        <button
                          type="button"
                          onClick={() => softDeleteFlight(flight)}
                          disabled={processingId === flight.id}
                          style={dangerButton}
                        >
                          {processingId === flight.id ? "Deleting..." : "Delete"}
                        </button>
                      )}

                      {canDelete && deleted && (
                        <button
                          type="button"
                          onClick={() => restoreFlight(flight)}
                          disabled={processingId === flight.id}
                          style={restoreButton}
                        >
                          {processingId === flight.id ? "Restoring..." : "Restore"}
                        </button>
                      )}
                    </div>

                    <div
                      style={{
                        ...detailPanelStyle,
                        padding: 0,
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setAssignmentsExpanded(
                            (previous) => !previous
                          )
                        }
                        style={collapsibleHeaderButton}
                      >
                        <div>
                          <strong>Gate Check Assignments</strong>
                          <div style={rowSubStyle}>
                            {assignments.length} item(s) - Tap to {assignmentsExpanded ? "hide" : "view"}
                          </div>
                        </div>

                        <span style={countBadgeStyle}>
                          {assignments.length}
                        </span>
                      </button>

                      {assignmentsExpanded && (
                        <div
                          style={{
                            padding: "0 10px 10px",
                            borderTop: "1px solid #f1f5f9",
                          }}
                        >
                          {assignments.length === 0 ? (
                            <div style={emptyInlineStyle}>No assignments recorded.</div>
                          ) : (
                            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                              {assignments.map((item) => (
                                <div key={item.id} style={assignmentRowStyle}>
                                  <div>
                                    <strong>{item.gateCheckNumber || "-"}</strong>
                                    <div style={rowSubStyle}>
                                      {item.passengerName || "-"} | Seat {item.assignedSeat || "-"}
                                    </div>
                                    <div style={rowSubStyle}>
                                      {item.carryOnDescription || "Not classified"}
                                      {item.carryOnCode ? ` | ${item.carryOnCode}` : ""}
                                    </div>
                                  </div>

                                  <div style={{ textAlign: "right" }}>
                                    <strong style={{ color: "#6d28d9", fontSize: "0.76rem" }}>
                                      {statusLabel(item.status)}
                                    </strong>
                                    <div style={rowSubStyle}>
                                      Compartment: {item.compartment || "-"}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        ...detailPanelStyle,
                        padding: 0,
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setTimelineExpanded(
                            (previous) => !previous
                          )
                        }
                        style={collapsibleHeaderButton}
                      >
                        <div>
                          <strong>Operational Timeline</strong>
                          <div style={rowSubStyle}>
                            {events.length} event(s) - Tap to {timelineExpanded ? "hide" : "view"}
                          </div>
                        </div>

                        <span style={countBadgeStyle}>
                          {events.length}
                        </span>
                      </button>

                      {timelineExpanded && (
                        <div
                          style={{
                            padding: "0 10px 10px",
                            borderTop: "1px solid #f1f5f9",
                          }}
                        >
                          {events.length === 0 ? (
                            <div style={emptyInlineStyle}>No events recorded.</div>
                          ) : (
                            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                              {events.map((event) => (
                                <div key={event.id} style={eventRowStyle}>
                                  <div>
                                    <strong style={{ fontSize: "0.78rem" }}>
                                      {statusLabel(event.type || event.status)}
                                    </strong>
                                    <div style={rowSubStyle}>
                                      {event.message || event.gateCheckNumber || "Operational event"}
                                    </div>
                                  </div>

                                  <div style={{ textAlign: "right", color: "#64748b", fontSize: "0.7rem" }}>
                                    <div>{formatTimestamp(event.createdAt)}</div>
                                    <div>{actorName(event.createdBy)}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {message && <Notice tone="success" text={message} />}
      {error && <Notice tone="error" text={error} />}
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div style={metricStyle}>
      <div style={{ color: "#64748b", fontSize: "0.65rem", fontWeight: 800 }}>
        {label}
      </div>
      <div style={{ marginTop: 2, color: "#0f172a", fontSize: "1.05rem", fontWeight: 900 }}>
        {value}
      </div>
    </div>
  );
}

function Notice({ tone, text }) {
  const success = tone === "success";

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background: success ? "#f0fdf4" : "#fef2f2",
        border: success ? "1px solid #bbf7d0" : "1px solid #fecaca",
        color: success ? "#166534" : "#991b1b",
        fontSize: "0.8rem",
        fontWeight: 800,
      }}
    >
      {text}
    </div>
  );
}

const eyebrowStyle = {
  color: "#7c3aed",
  fontSize: "0.7rem",
  fontWeight: 900,
  letterSpacing: "0.07em",
};

const smallText = {
  margin: "6px 0 0",
  color: "#64748b",
  fontSize: "0.8rem",
  lineHeight: 1.45,
  maxWidth: 760,
};

const quickFilterButton = {
  padding: "8px 11px",
  borderRadius: 999,
  border: "1px solid #cbd5e1",
  background: "white",
  color: "#475569",
  fontWeight: 900,
  cursor: "pointer",
  fontSize: "0.76rem",
};

const quickFilterButtonActive = {
  border: "1px solid #7c3aed",
  background: "#7c3aed",
  color: "white",
};

const summaryMetricsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
  gap: 7,
};

const collapsibleHeaderButton = {
  width: "100%",
  border: "none",
  background: "white",
  padding: 10,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
};

const countBadgeStyle = {
  minWidth: 32,
  height: 32,
  padding: "0 8px",
  borderRadius: 999,
  background: "#f5f3ff",
  border: "1px solid #ddd6fe",
  color: "#6d28d9",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.74rem",
  fontWeight: 900,
};

const filterPanelStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(190px, 2fr) repeat(3, minmax(130px, 1fr))",
  gap: 8,
  padding: 10,
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
};

const fieldWrapStyle = {
  display: "grid",
  gap: 5,
  minWidth: 0,
};

const fieldLabelStyle = {
  color: "#475569",
  fontSize: "0.7rem",
  fontWeight: 800,
};

const inputStyle = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "9px 10px",
  borderRadius: 9,
  border: "1px solid #cbd5e1",
  background: "white",
  fontSize: "0.82rem",
};

const emptyStateStyle = {
  padding: 18,
  borderRadius: 12,
  border: "1px dashed #cbd5e1",
  background: "#f8fafc",
  color: "#64748b",
  textAlign: "center",
  fontSize: "0.82rem",
};

const statusPillStyle = {
  padding: "4px 7px",
  borderRadius: 999,
  background: "#f5f3ff",
  border: "1px solid #ddd6fe",
  color: "#6d28d9",
  fontSize: "0.66rem",
  fontWeight: 900,
};

const metricsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
  gap: 7,
};

const metricStyle = {
  padding: 8,
  borderRadius: 9,
  border: "1px solid #e2e8f0",
  background: "white",
};

const actionsStyle = {
  display: "flex",
  gap: 7,
  flexWrap: "wrap",
};

const primaryButton = {
  padding: "8px 11px",
  borderRadius: 9,
  border: "1px solid #7c3aed",
  background: "#7c3aed",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryButton = {
  padding: "8px 11px",
  borderRadius: 9,
  border: "1px solid #cbd5e1",
  background: "white",
  color: "#334155",
  fontWeight: 900,
  cursor: "pointer",
};

const dangerButton = {
  padding: "8px 11px",
  borderRadius: 9,
  border: "1px solid #dc2626",
  background: "#dc2626",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const restoreButton = {
  padding: "8px 11px",
  borderRadius: 9,
  border: "1px solid #2563eb",
  background: "#eff6ff",
  color: "#1d4ed8",
  fontWeight: 900,
  cursor: "pointer",
};

const detailPanelStyle = {
  padding: 10,
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "white",
};

const assignmentRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  padding: 8,
  borderRadius: 8,
  border: "1px solid #f1f5f9",
  background: "#f8fafc",
};

const eventRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  padding: 8,
  borderRadius: 8,
  borderLeft: "3px solid #7c3aed",
  background: "#faf5ff",
};

const rowSubStyle = {
  marginTop: 2,
  color: "#64748b",
  fontSize: "0.7rem",
};

const emptyInlineStyle = {
  marginTop: 7,
  color: "#64748b",
  fontSize: "0.76rem",
};

// src/pages/FlightsPage.jsx
import React, { useEffect, useMemo, useState } from "react";

import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import { db, functions } from "../firebase";

const MOBILE_BREAKPOINT = 760;

function getTodayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function normalizeRole(roleRaw) {
  return String(roleRaw || "")
    .trim()
    .toLowerCase();
}

function normalizeOperationalPosition(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function canCreateFlights(roleRaw) {
  const role = normalizeRole(roleRaw);

  return (
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "duty_managers" ||
    role === "supervisor" ||
    role === "gate_controller"
  );
}

function isManager(roleRaw) {
  const role = normalizeRole(roleRaw);

  return (
    role === "station_manager" ||
    role === "duty_manager" ||
    role === "duty_managers" ||
    role === "supervisor" ||
    role === "gate_controller"
  );
}

function normalizeStatus(value) {
  const status = String(value || "OPEN")
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

function getOperationalActor(user, operationalContext) {
  return {
    userId:
      user?.id || null,

    username:
      user?.username || null,

    role:
      user?.role || null,

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
      normalizeOperationalPosition(
        operationalContext?.operationalPosition
      ) || null,

    operationalPositionLabel:
      operationalContext?.operationalPositionLabel ||
      null,

    basePosition:
      operationalContext?.basePosition ||
      user?.position ||
      null,

    systemRole:
      operationalContext?.systemRole ||
      normalizeRole(user?.role) ||
      null,

    loginAt:
      operationalContext?.loginAt ||
      null,
  };
}

const STATUS_COLORS = {
  OPEN: {
    bg: "#fef3c7",
    text: "#92400e",
    border: "#f59e0b",
  },

  RECEIVING: {
    bg: "#fef3c7",
    text: "#92400e",
    border: "#f59e0b",
  },

  LOADING: {
    bg: "#ffedd5",
    text: "#9a3412",
    border: "#fb923c",
  },

  LOADED: {
    bg: "#dcfce7",
    text: "#166534",
    border: "#22c55e",
  },
};

function StatusPill({ status }) {
  const normalized =
    normalizeStatus(status);

  const colors =
    STATUS_COLORS[normalized] ||
    STATUS_COLORS.OPEN;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.text,
        fontWeight: 900,
        fontSize: "0.75rem",
        letterSpacing: "0.04em",
      }}
    >
      {normalized}
    </span>
  );
}

function formatCallableError(error) {
  const code =
    error?.code
      ? String(error.code)
      : "";

  const message =
    error?.message
      ? String(error.message)
      : "Unknown error";

  let details = "";

  try {
    details =
      error?.details
        ? JSON.stringify(error.details)
        : "";
  } catch {
    details = "";
  }

  return [
    code && `(${code})`,
    message,
    details && `Details: ${details}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export default function FlightsPage({
  user,
  operationalContext,
  onFlightSelected,
}) {
  const today =
    useMemo(
      () => getTodayYYYYMMDD(),
      []
    );

  const [
    isMobile,
    setIsMobile,
  ] = useState(
    typeof window !== "undefined"
      ? window.innerWidth < MOBILE_BREAKPOINT
      : false
  );

  const [
    selectedDate,
    setSelectedDate,
  ] = useState(today);

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("active");

  const [
    flights,
    setFlights,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    showCreate,
    setShowCreate,
  ] = useState(false);

  const [
    form,
    setForm,
  ] = useState({
    flightNumber: "",
    flightDate: today,
    gate: "",
    aircraftType: "",
  });

  const [
    formError,
    setFormError,
  ] = useState("");

  const [
    saving,
    setSaving,
  ] = useState(false);

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

  useEffect(() => {
    const handleResize = () => {
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

  useEffect(() => {
    setLoading(true);

    const qRef = query(
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

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows =
          snap.docs.map(
            (documentSnapshot) => ({
              id:
                documentSnapshot.id,

              ...documentSnapshot.data(),
            })
          );

        const filtered =
          statusFilter === "all"
            ? rows
            : statusFilter === "completed"
              ? rows.filter(
                  (flight) =>
                    normalizeStatus(
                      flight.status
                    ) === "LOADED"
                )
              : rows.filter(
                  (flight) =>
                    normalizeStatus(
                      flight.status
                    ) !== "LOADED"
                );

        setFlights(
          filtered
        );

        setLoading(
          false
        );
      },
      (error) => {
        console.error(
          "Flights onSnapshot error:",
          error
        );

        setFlights([]);
        setLoading(false);
      }
    );

    return () => {
      unsub();
    };
  }, [
    selectedDate,
    statusFilter,
  ]);

  const openCreate = () => {
    setFormError("");

    setForm({
      flightNumber: "",
      flightDate: selectedDate,
      gate: "",
      aircraftType: "",
    });

    setShowCreate(true);
  };

  const closeCreate = () => {
    if (saving) {
      return;
    }

    setShowCreate(false);
    setFormError("");
  };

  const handleCreate = async () => {
    if (saving) {
      return;
    }

    setFormError("");
    setActionMsg("");
    setActionErr("");

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
      setSaving(true);

      const dupQ = query(
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
        limit(1)
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
          gate || null,

        aircraftType:
          aircraftType || null,

        status:
          "OPEN",

        createdAt:
          serverTimestamp(),

        createdBy:
          operationalActor,

        createdByUsername:
          user?.username || null,

        createdByFullName:
          operationalActor.employeeFullName,

        createdByOperationalPosition:
          operationalActor.operationalPosition,

        createdByOperationalPositionLabel:
          operationalActor.operationalPositionLabel,
      };

      const docRef =
        await addDoc(
          collection(
            db,
            "flights"
          ),
          payload
        );

      setShowCreate(false);

      setActionMsg(
        `Flight created: ${flightNumber}`
      );

      window.setTimeout(
        () => {
          setActionMsg("");
        },
        2500
      );

      onFlightSelected?.(
        docRef.id
      );
    } catch (error) {
      console.error(
        "Create flight error:",
        error
      );

      setFormError(
        error?.message ||
          "Could not create flight. Check permissions/rules."
      );
    } finally {
      setSaving(false);
    }
  };

  const openFlight = (
    flight
  ) => {
    onFlightSelected?.(
      flight.id
    );
  };

  const handleReopen = async (
    flight
  ) => {
    if (!allowManage) {
      return;
    }

    setActionMsg("");
    setActionErr("");

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
          user?.role || null,

        username:
          user?.username || null,

        employeeFullName:
          operationalActor.employeeFullName,

        operationalPosition:
          operationalActor.operationalPosition,

        operationalPositionLabel:
          operationalActor.operationalPositionLabel,
      });

      setActionMsg(
        `Flight reopened: ${
          flight.flightNumber ||
          flight.id
        }`
      );

      window.setTimeout(
        () => {
          setActionMsg("");
        },
        2500
      );
    } catch (error) {
      console.error(
        "reopenFlight failed:",
        error
      );

      setActionErr(
        formatCallableError(
          error
        )
      );
    } finally {
      setReopeningId("");
    }
  };

  const handleDelete = async (
    flight
  ) => {
    if (!allowManage) {
      return;
    }

    setActionMsg("");
    setActionErr("");

    const label =
      `${flight.flightNumber || flight.id} ` +
      `(${flight.flightDate || "-"})`;

    const ok =
      window.confirm(
        `DELETE FLIGHT?\n\n` +
          `${label}\n\n` +
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
            user?.role || null,

          username:
            user?.username || null,

          employeeFullName:
            operationalActor.employeeFullName,

          operationalPosition:
            operationalActor.operationalPosition,

          operationalPositionLabel:
            operationalActor.operationalPositionLabel,
        });

      const deletedBagTags =
        result?.data
          ?.deletedBagTags || 0;

      setActionMsg(
        `Flight deleted: ${label}. ` +
          `${deletedBagTags} tracked bag tag record(s) removed.`
      );

      window.setTimeout(
        () => {
          setActionMsg("");
        },
        3500
      );
    } catch (error) {
      console.error(
        "deleteFlightCascade failed:",
        error
      );

      setActionErr(
        formatCallableError(
          error
        )
      );
    } finally {
      setDeletingId("");
    }
  };

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
              margin: 0,
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
                : "auto auto auto",

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
              style={label}
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
                  event.target.value
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
              style={label}
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
                  event.target.value
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
            (flight) => {
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
                        {
                          flight.flightNumber ||
                          flight.id
                        }
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
                        {
                          flight.flightDate ||
                          "-"
                        }
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
                        flight.aircraftType ||
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
                (flight) => {
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
                      <td style={td}>
                        <strong>
                          {
                            flight.flightNumber ||
                            flight.id
                          }
                        </strong>
                      </td>

                      <td style={td}>
                        {
                          flight.flightDate ||
                          "-"
                        }
                      </td>

                      <td style={td}>
                        {
                          flight.gate ||
                          "-"
                        }
                      </td>

                      <td style={td}>
                        {
                          flight.aircraftType ||
                          "-"
                        }
                      </td>

                      <td style={td}>
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
                          style={tableOpenButton}
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
            Tip: Completed flights (LOADED) remain accessible for
            Gate, Aircraft, and Reports. Managers can Reopen if needed.
          </p>
        </div>
      )}

      {showCreate && (
        <div
          style={overlay}
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
              <div>
                <label
                  style={label}
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
                          event.target.value,
                      })
                    )
                  }
                  placeholder="e.g. SY214"
                  autoCapitalize="characters"
                  style={input}
                />
              </div>

              <div>
                <label
                  style={label}
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
                          event.target.value,
                      })
                    )
                  }
                  style={input}
                />
              </div>

              <div>
                <label
                  style={label}
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
                          event.target.value,
                      })
                    )
                  }
                  placeholder="e.g. E68"
                  autoCapitalize="characters"
                  style={input}
                />
              </div>

              <div>
                <label
                  style={label}
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
                          event.target.value,
                      })
                    )
                  }
                  placeholder="e.g. B737-800"
                  autoCapitalize="characters"
                  style={input}
                />
              </div>
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
                {
                  operationalActor.employeeFullName ||
                  user?.username ||
                  "-"
                }
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
    tone === "success"
  ) {
    background =
      "#16a34a";

    color =
      "white";

    border =
      "#16a34a";
  }

  if (
    tone === "danger"
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

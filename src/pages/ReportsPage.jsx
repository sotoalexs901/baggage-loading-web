// src/pages/ReportsPage.jsx
import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import {
  db,
  functions,
} from "../firebase";

import {
  logSystemIncident,
  logSystemSuccess,
} from "../utils/systemLogger.js";

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

function getMonthValue(dateText) {
  const d = String(
    dateText ||
      getTodayYYYYMMDD()
  );

  return d.slice(0, 7);
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function normalizeOperationalPosition(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function formatOperationalPosition(value) {
  const normalized =
    normalizeOperationalPosition(
      value
    );

  const labels = {
    COUNTER_SCAN:
      "Counter Scan",

    GATE_CONTROLLER:
      "Gate Controller",

    BAGROOM_SCAN:
      "Bagroom Scan",

    AIRCRAFT_RAMP:
      "Aircraft / Ramp",

    SUPERVISOR:
      "Supervisor",
  };

  return (
    labels[normalized] ||
    normalized ||
    "-"
  );
}

function formatDateTime(ts) {
  if (!ts) return "-";

  try {
    const d = ts.toDate
      ? ts.toDate()
      : new Date(ts);

    return d.toLocaleString();
  } catch {
    return "-";
  }
}

function cleanTag(value) {
  return String(value || "")
    .replace(/\D+/g, "");
}

function normalizeReceivingLocation(scan) {
  const raw = String(
    scan?.receivingLocation ||
      scan?.location ||
      scan?.trackingLocation ||
      "BAGROOM"
  )
    .trim()
    .toUpperCase();

  if (
    raw === "GATE_RAMP" ||
    raw === "GATE / RAMP" ||
    raw === "RAMP"
  ) {
    return "GATE";
  }

  if (
    raw === "OVERSIZE"
  ) {
    return "OVERSIZE";
  }

  return "BAGROOM";
}

function getReceivingLocationLabel(scan) {
  const location =
    normalizeReceivingLocation(
      scan
    );

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

  return "Bagroom";
}

function getScanUser(scan) {
  const source =
    scan?.scannedBy ||
    scan?.createdBy ||
    scan?.updatedBy ||
    {};

  return {
    userId:
      source?.userId ||
      null,

    username:
      source?.username ||
      "Unknown",

    fullName:
      source?.fullName ||
      source?.employeeFullName ||
      scan?.employeeFullName ||
      source?.username ||
      "Unknown",

    role:
      source?.role ||
      source?.systemRole ||
      null,

    operationalPosition:
      source
        ?.operationalPosition ||
      scan
        ?.operationalPosition ||
      null,

    operationalPositionLabel:
      source
        ?.operationalPositionLabel ||
      scan
        ?.operationalPositionLabel ||
      null,
  };
}

function getDisplayEmployeeName(scan) {
  const person =
    getScanUser(scan);

  return (
    person.fullName ||
    person.username ||
    "Unknown"
  );
}

function getEmployeePositionLabel(
  scan,
  fallback
) {
  const person =
    getScanUser(scan);

  if (
    person
      .operationalPositionLabel
  ) {
    return person
      .operationalPositionLabel;
  }

  if (
    person
      .operationalPosition
  ) {
    return formatOperationalPosition(
      person
        .operationalPosition
    );
  }

  return fallback || "-";
}

function groupScansByEmployee(
  scans,
  fallbackPosition
) {
  const groups = new Map();

  scans.forEach((scan) => {
    const person =
      getScanUser(scan);

    const username =
      person.username ||
      "Unknown";

    const fullName =
      person.fullName ||
      username;

    const key =
      person.userId ||
      `${username}|${fullName}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        userId:
          person.userId ||
          null,

        username,
        fullName,

        role:
          person.role ||
          null,

        operationalPosition:
          person
            .operationalPosition ||
          null,

        operationalPositionLabel:
          person
            .operationalPositionLabel ||
          getEmployeePositionLabel(
            scan,
            fallbackPosition
          ),

        scans: [],
        tags: [],
      });
    }

    const group =
      groups.get(key);

    group.scans.push(scan);

    const tag =
      cleanTag(
        scan?.tag ||
          scan?.bagTag ||
          scan?.id
      );

    if (
      tag &&
      !group.tags.includes(tag)
    ) {
      group.tags.push(tag);
    }

    if (
      !group
        .operationalPositionLabel
    ) {
      group
        .operationalPositionLabel =
        getEmployeePositionLabel(
          scan,
          fallbackPosition
        );
    }
  });

  return [
    ...groups.values(),
  ].sort((a, b) =>
    String(
      a.fullName
    ).localeCompare(
      String(
        b.fullName
      )
    )
  );
}

function sortBagTags(tags) {
  return [
    ...new Set(
      tags
        .map(cleanTag)
        .filter(Boolean)
    ),
  ].sort((a, b) =>
    String(a).localeCompare(
      String(b),
      undefined,
      {
        numeric: true,
      }
    )
  );
}

function findAircraftPdf(
  reportRows
) {
  const pdfReports =
    reportRows.filter(
      (row) =>
        row?.downloadUrl &&
        (
          row?.type ===
            "PDF_REPORT" ||
          String(
            row?.fileName ||
              ""
          )
            .toUpperCase()
            .startsWith(
              "BLCS_"
            )
        )
    );

  if (
    pdfReports.length === 0
  ) {
    return null;
  }

  return pdfReports[0];
}

export default function ReportsPage({
  flightId,
  flight,
  user,
  operationalContext,
}) {
  const today = useMemo(
    () =>
      getTodayYYYYMMDD(),
    []
  );

  const defaultFrom =
    useMemo(
      () =>
        today.slice(
          0,
          8
        ) + "01",
      [today]
    );

  const resolvedFlightId =
    useMemo(() => {
      if (
        typeof flightId ===
        "string"
      ) {
        return flightId;
      }

      if (
        flightId &&
        typeof flightId ===
          "object" &&
        typeof flightId.id ===
          "string"
      ) {
        return flightId.id;
      }

      if (
        flight &&
        typeof flight ===
          "object" &&
        typeof flight.id ===
          "string"
      ) {
        return flight.id;
      }

      return "";
    }, [
      flightId,
      flight,
    ]);

  const role =
    normalizeRole(
      user?.role
    );

  const canDeleteMonth =
    role ===
    "station_manager";

  const [
    dateFrom,
    setDateFrom,
  ] = useState(
    defaultFrom
  );

  const [
    dateTo,
    setDateTo,
  ] = useState(today);

  const [
    loadedFlights,
    setLoadedFlights,
  ] = useState([]);

  const [
    loadingFlights,
    setLoadingFlights,
  ] = useState(true);

  const [
    selectedFlightId,
    setSelectedFlightId,
  ] = useState(
    resolvedFlightId
  );

  const [
    reportRows,
    setReportRows,
  ] = useState([]);

  const [
    loadingReports,
    setLoadingReports,
  ] = useState(false);

  const [
    counterScans,
    setCounterScans,
  ] = useState([]);

  const [
    bagroomScans,
    setBagroomScans,
  ] = useState([]);

  const [
    aircraftScans,
    setAircraftScans,
  ] = useState([]);

  const [
    loadingOperationalData,
    setLoadingOperationalData,
  ] = useState(false);

  const [
    deleteMonth,
    setDeleteMonth,
  ] = useState(
    getMonthValue(today)
  );

  const [
    deletingMonth,
    setDeletingMonth,
  ] = useState(false);

  const [
    deleteMsg,
    setDeleteMsg,
  ] = useState("");

  const [
    deleteErr,
    setDeleteErr,
  ] = useState("");

  const logReportsIncident = ({
    action,
    status = "ERROR",
    severity = "MEDIUM",
    errorType = null,
    errorCode = null,
    message = null,
    durationMs = null,
    flightNumber = null,
    metadata = {},
  }) => {
    void logSystemIncident({
      module:
        "REPORTS",

      action,

      status,

      severity,

      errorType,

      errorCode,

      message,

      user,

      operationalContext,

      flightId:
        selectedFlightId ||
        resolvedFlightId ||
        null,

      flightNumber,

      durationMs,

      currentView:
        "reports",

      metadata,
    });
  };

  useEffect(() => {
    setSelectedFlightId(
      resolvedFlightId
    );
  }, [
    resolvedFlightId,
  ]);

  useEffect(() => {
    setLoadingFlights(true);

    const qRef = query(
      collection(
        db,
        "flights"
      ),
      orderBy(
        "flightDate",
        "desc"
      )
    );

    const unsub =
      onSnapshot(
        qRef,
        (snap) => {
          const list =
            snap.docs
              .map((d) => ({
                id: d.id,
                ...d.data(),
              }))
              .filter((f) => {
                const fd =
                  String(
                    f.flightDate ||
                      ""
                  );

                if (!fd) {
                  return false;
                }

                const status =
                  String(
                    f.status ||
                      ""
                  )
                    .trim()
                    .toUpperCase();

                return (
                  fd >= dateFrom &&
                  fd <= dateTo &&
                  (
                    status ===
                      "LOADED" ||
                    status ===
                      "LOADING"
                  )
                );
              });

          setLoadedFlights(
            list
          );

          setLoadingFlights(
            false
          );
        },
        (err) => {
          console.error(
            "Loaded flights error:",
            err
          );

          setLoadedFlights(
            []
          );

          setLoadingFlights(
            false
          );

          logReportsIncident({
            action:
              "LOAD_FLIGHTS",

            severity:
              "HIGH",

            errorType:
              "FIRESTORE_SNAPSHOT",

            errorCode:
              err?.code ||
              err?.name ||
              null,

            message:
              err?.message ||
              "Unable to load report flights.",

            metadata: {
              dateFrom,
              dateTo,
            },
          });
        }
      );

    return () =>
      unsub();
  }, [
    dateFrom,
    dateTo,
  ]);

  useEffect(() => {
    if (
      !selectedFlightId
    ) {
      setReportRows([]);
      setLoadingReports(false);
      return;
    }

    setLoadingReports(true);

    const qRef = query(
      collection(
        db,
        "flights",
        selectedFlightId,
        "reports"
      ),
      orderBy(
        "createdAt",
        "desc"
      )
    );

    const unsub =
      onSnapshot(
        qRef,
        (snap) => {
          const list =
            snap.docs.map(
              (d) => ({
                id: d.id,
                ...d.data(),
              })
            );

          setReportRows(
            list
          );

          setLoadingReports(
            false
          );
        },
        (err) => {
          console.error(
            "ReportsPage error:",
            err
          );

          setReportRows(
            []
          );

          setLoadingReports(
            false
          );

          logReportsIncident({
            action:
              "LOAD_REPORT_DOCUMENTS",

            severity:
              "HIGH",

            errorType:
              "FIRESTORE_SNAPSHOT",

            errorCode:
              err?.code ||
              err?.name ||
              null,

            message:
              err?.message ||
              "Unable to load flight report documents.",
          });
        }
      );

    return () =>
      unsub();
  }, [
    selectedFlightId,
  ]);

  useEffect(() => {
    if (
      !selectedFlightId
    ) {
      setCounterScans([]);
      setBagroomScans([]);
      setAircraftScans([]);
      setLoadingOperationalData(
        false
      );

      return;
    }

    setLoadingOperationalData(
      true
    );

    let counterReady = false;
    let bagroomReady = false;
    let aircraftReady = false;
    let buildLogged = false;
    const startedAt = Date.now();

    const updateLoading = () => {
      if (
        counterReady &&
        bagroomReady &&
        aircraftReady
      ) {
        setLoadingOperationalData(
          false
        );

        if (!buildLogged) {
          buildLogged = true;

          void logSystemSuccess({
            module:
              "REPORTS",

            action:
              "BUILD_OPERATIONAL_REPORT",

            durationMs:
              Date.now() -
              startedAt,
          });
        }
      }
    };

    const counterRef =
      collection(
        db,
        "flights",
        selectedFlightId,
        "counterScans"
      );

    const bagroomRef =
      collection(
        db,
        "flights",
        selectedFlightId,
        "bagroomScans"
      );

    const aircraftRef =
      collection(
        db,
        "flights",
        selectedFlightId,
        "aircraftScans"
      );

    const unsubCounter =
      onSnapshot(
        counterRef,
        (snap) => {
          setCounterScans(
            snap.docs.map(
              (d) => ({
                id: d.id,
                ...d.data(),
              })
            )
          );

          counterReady = true;
          updateLoading();
        },
        (error) => {
          console.error(
            "Report counter scans error:",
            error
          );

          setCounterScans(
            []
          );

          counterReady = true;
          updateLoading();

          logReportsIncident({
            action:
              "LOAD_COUNTER_SCANS",

            severity:
              "MEDIUM",

            errorType:
              "FIRESTORE_SNAPSHOT",

            errorCode:
              error?.code ||
              error?.name ||
              null,

            message:
              error?.message ||
              "Unable to load Counter scans for report.",
          });
        }
      );

    const unsubBagroom =
      onSnapshot(
        bagroomRef,
        (snap) => {
          setBagroomScans(
            snap.docs.map(
              (d) => ({
                id: d.id,
                ...d.data(),
              })
            )
          );

          bagroomReady = true;
          updateLoading();
        },
        (error) => {
          console.error(
            "Report bagroom scans error:",
            error
          );

          setBagroomScans(
            []
          );

          bagroomReady = true;
          updateLoading();

          logReportsIncident({
            action:
              "LOAD_BAGROOM_SCANS",

            severity:
              "MEDIUM",

            errorType:
              "FIRESTORE_SNAPSHOT",

            errorCode:
              error?.code ||
              error?.name ||
              null,

            message:
              error?.message ||
              "Unable to load Bagroom scans for report.",
          });
        }
      );

    const unsubAircraft =
      onSnapshot(
        aircraftRef,
        (snap) => {
          setAircraftScans(
            snap.docs.map(
              (d) => ({
                id: d.id,
                ...d.data(),
              })
            )
          );

          aircraftReady = true;
          updateLoading();
        },
        (error) => {
          console.error(
            "Report aircraft scans error:",
            error
          );

          setAircraftScans(
            []
          );

          aircraftReady = true;
          updateLoading();

          logReportsIncident({
            action:
              "LOAD_AIRCRAFT_SCANS",

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
              "Unable to load Aircraft scans for report.",
          });
        }
      );

    return () => {
      unsubCounter();
      unsubBagroom();
      unsubAircraft();
    };
  }, [
    selectedFlightId,
  ]);

  const selectedFlight =
    useMemo(() => {
      return (
        loadedFlights.find(
          (f) =>
            f.id ===
            selectedFlightId
        ) ||
        (
          flight &&
          flight.id ===
            selectedFlightId
            ? flight
            : null
        )
      );
    }, [
      loadedFlights,
      selectedFlightId,
      flight,
    ]);

  const aircraftPdf =
    useMemo(
      () =>
        findAircraftPdf(
          reportRows
        ),
      [reportRows]
    );

  const counterGroups =
    useMemo(
      () =>
        groupScansByEmployee(
          counterScans,
          "Counter Scan"
        ),
      [counterScans]
    );

  const regularBagroomScans =
    useMemo(
      () =>
        bagroomScans.filter(
          (scan) =>
            normalizeReceivingLocation(
              scan
            ) ===
            "BAGROOM"
        ),
      [bagroomScans]
    );

  const oversizeScans =
    useMemo(
      () =>
        bagroomScans.filter(
          (scan) =>
            normalizeReceivingLocation(
              scan
            ) ===
            "OVERSIZE"
        ),
      [bagroomScans]
    );

  const gateRampScans =
    useMemo(
      () =>
        bagroomScans.filter(
          (scan) =>
            normalizeReceivingLocation(
              scan
            ) ===
            "GATE"
        ),
      [bagroomScans]
    );

  const bagroomGroups =
    useMemo(
      () =>
        groupScansByEmployee(
          regularBagroomScans,
          "Bagroom Scan"
        ),
      [regularBagroomScans]
    );

  const oversizeGroups =
    useMemo(
      () =>
        groupScansByEmployee(
          oversizeScans,
          "Oversize"
        ),
      [oversizeScans]
    );

  const gateRampGroups =
    useMemo(
      () =>
        groupScansByEmployee(
          gateRampScans,
          "Gate / Ramp"
        ),
      [gateRampScans]
    );

  const aircraftGroups =
    useMemo(
      () =>
        groupScansByEmployee(
          aircraftScans,
          "Aircraft / Ramp"
        ),
      [aircraftScans]
    );

  const allLoadedBagTags =
    useMemo(
      () =>
        sortBagTags(
          aircraftScans.map(
            (scan) =>
              scan?.tag ||
              scan?.bagTag ||
              scan?.id
          )
        ),
      [aircraftScans]
    );

  const counterBagTags =
    useMemo(
      () =>
        sortBagTags(
          counterScans.map(
            (scan) =>
              scan?.tag ||
              scan?.bagTag ||
              scan?.id
          )
        ),
      [counterScans]
    );

  const bagroomBagTags =
    useMemo(
      () =>
        sortBagTags(
          regularBagroomScans.map(
            (scan) =>
              scan?.tag ||
              scan?.bagTag ||
              scan?.id
          )
        ),
      [regularBagroomScans]
    );

  const oversizeBagTags =
    useMemo(
      () =>
        sortBagTags(
          oversizeScans.map(
            (scan) =>
              scan?.tag ||
              scan?.bagTag ||
              scan?.id
          )
        ),
      [oversizeScans]
    );

  const gateRampBagTags =
    useMemo(
      () =>
        sortBagTags(
          gateRampScans.map(
            (scan) =>
              scan?.tag ||
              scan?.bagTag ||
              scan?.id
          )
        ),
      [gateRampScans]
    );

  const zoneCounts =
    useMemo(() => {
      const counts = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
      };

      aircraftScans.forEach(
        (scan) => {
          const zone =
            Number(
              scan?.zone
            );

          if (
            zone >= 1 &&
            zone <= 4
          ) {
            counts[zone] += 1;
          }
        }
      );

      return counts;
    }, [
      aircraftScans,
    ]);

  const handlePrint = () => {
    const startedAt =
      Date.now();

    try {
      window.print();

      void logSystemSuccess({
        module:
          "REPORTS",

        action:
          "PRINT_REPORT",

        durationMs:
          Date.now() -
          startedAt,
      });
    } catch (
      error
    ) {
      console.error(
        "Print report error:",
        error
      );

      logReportsIncident({
        action:
          "PRINT_REPORT",

        severity:
          "MEDIUM",

        errorType:
          "PRINT_ERROR",

        errorCode:
          error?.code ||
          error?.name ||
          null,

        message:
          error?.message ||
          "Unable to print flight report.",

        durationMs:
          Date.now() -
          startedAt,

        flightNumber:
          selectedFlight
            ?.flightNumber ||
          null,
      });
    }
  };

  const handleDeleteMonth =
    async () => {
      setDeleteMsg("");
      setDeleteErr("");

      if (
        !canDeleteMonth
      ) {
        setDeleteErr(
          "Only Station Manager can delete a full month."
        );

        logReportsIncident({
          action:
            "DELETE_MONTH_PERMISSION_DENIED",

          status:
            "WARNING",

          severity:
            "MEDIUM",

          errorType:
            "PERMISSION_DENIED",

          message:
            "A non-Station Manager attempted to delete a full month.",

          metadata: {
            deleteMonth,
          },
        });

        return;
      }

      const [
        yearText,
        monthText,
      ] = String(
        deleteMonth || ""
      ).split("-");

      const year =
        Number(
          yearText
        );

      const month =
        Number(
          monthText
        );

      if (
        !year ||
        !month
      ) {
        setDeleteErr(
          "Please select a valid month."
        );

        logReportsIncident({
          action:
            "DELETE_MONTH_INVALID_INPUT",

          status:
            "WARNING",

          severity:
            "LOW",

          errorType:
            "INVALID_MONTH",

          message:
            "Invalid month selected for monthly deletion.",

          metadata: {
            deleteMonth,
          },
        });

        return;
      }

      const ok =
        window.confirm(
          `DELETE ALL LOADED FLIGHTS FOR ${deleteMonth}?\n\n` +
            `This will delete loaded flights, scans, manifests, reports, PDFs, and bag tag indexes.\n\n` +
            `This cannot be undone.`
        );

      if (!ok) return;

      const startedAt =
        Date.now();

      try {
        setDeletingMonth(
          true
        );

        const fn =
          httpsCallable(
            functions,
            "deleteLoadedFlightsByMonth"
          );

        const res =
          await fn({
            year,
            month,

            username:
              user?.username ||
              null,

            userRole:
              user?.role ||
              null,

            operationalPosition:
              operationalContext
                ?.operationalPosition ||
              null,
          });

        setDeleteMsg(
          `Deleted ${
            res.data
              ?.deletedFlights ||
            0
          } loaded flight(s) for ${
            res.data?.month ||
            deleteMonth
          }.`
        );

        if (
          selectedFlightId
        ) {
          setSelectedFlightId(
            ""
          );
        }

        void logSystemSuccess({
          module:
            "REPORTS",

          action:
            "DELETE_LOADED_FLIGHTS_BY_MONTH",

          durationMs:
            Date.now() -
            startedAt,
        });
      } catch (e) {
        console.error(e);

        setDeleteErr(
          e?.message ||
            "Could not delete month."
        );

        logReportsIncident({
          action:
            "DELETE_LOADED_FLIGHTS_BY_MONTH",

          severity:
            "CRITICAL",

          errorType:
            "CLOUD_FUNCTION",

          errorCode:
            e?.code ||
            e?.name ||
            null,

          message:
            e?.message ||
            "Could not delete loaded flights by month.",

          durationMs:
            Date.now() -
            startedAt,

          metadata: {
            year,
            month,
            deleteMonth,
          },
        });
      } finally {
        setDeletingMonth(
          false
        );
      }
    };

  const reportLoading =
    loadingReports ||
    loadingOperationalData;

  return (
    <div
      className="reports-page"
      style={{
        background:
          "white",

        border:
          "1px solid #e5e7eb",

        borderRadius:
          12,

        padding:
          16,
      }}
    >
      <style>
        {`
          @media print {
            body {
              background: white !important;
            }

            .reports-page {
              border: none !important;
              padding: 0 !important;
            }

            .no-print {
              display: none !important;
            }

            .print-break {
              break-before: page;
            }

            .avoid-break {
              break-inside: avoid;
            }

            a {
              color: black !important;
              text-decoration: none !important;
            }
          }
        `}
      </style>

      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2
            style={{
              marginTop: 0,
              marginBottom: 4,
            }}
          >
            Flight Reports
          </h2>

          <p
            style={{
              color:
                "#6b7280",

              margin:
                0,
            }}
          >
            Complete operational report by flight, employee, position, and bag tag.
          </p>
        </div>

        <button
          type="button"
          onClick={
            handlePrint
          }
          disabled={
            !selectedFlightId ||
            reportLoading
          }
          style={{
            padding:
              "9px 14px",

            borderRadius:
              10,

            border:
              "1px solid #111827",

            background:
              !selectedFlightId ||
              reportLoading
                ? "#9ca3af"
                : "#111827",

            color:
              "white",

            fontWeight:
              900,

            cursor:
              !selectedFlightId ||
              reportLoading
                ? "not-allowed"
                : "pointer",
          }}
        >
          Print Flight Report
        </button>
      </div>

      <section
        className="no-print"
        style={{
          border:
            "1px solid #e5e7eb",

          borderRadius:
            12,

          padding:
            12,

          marginTop:
            14,
        }}
      >
        <h3
          style={{
            margin: 0,
          }}
        >
          Loaded / Reopened Flights
        </h3>

        <div
          style={{
            display:
              "flex",

            gap:
              10,

            flexWrap:
              "wrap",

            marginTop:
              12,
          }}
        >
          <div>
            <label
              style={
                label
              }
            >
              From
            </label>

            <input
              type="date"

              value={
                dateFrom
              }

              onChange={(e) =>
                setDateFrom(
                  e.target.value
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
              To
            </label>

            <input
              type="date"

              value={
                dateTo
              }

              onChange={(e) =>
                setDateTo(
                  e.target.value
                )
              }

              style={
                input
              }
            />
          </div>
        </div>

        <div
          style={{
            marginTop:
              12,
          }}
        >
          {loadingFlights ? (
            <p
              style={{
                color:
                  "#6b7280",
              }}
            >
              Loading flights...
            </p>
          ) : loadedFlights.length ===
            0 ? (
            <p
              style={{
                color:
                  "#6b7280",
              }}
            >
              No LOADED or LOADING flights found for this date range.
            </p>
          ) : (
            <select
              value={
                selectedFlightId
              }

              onChange={(e) =>
                setSelectedFlightId(
                  e.target.value
                )
              }

              style={{
                ...input,
                width:
                  "100%",
              }}
            >
              <option value="">
                Select flight...
              </option>

              {loadedFlights.map(
                (f) => (
                  <option
                    key={
                      f.id
                    }

                    value={
                      f.id
                    }
                  >
                    {f.flightDate ||
                      "-"}{" "}
                    -{" "}
                    {f.flightNumber ||
                      f.id}{" "}
                    -{" "}
                    {f.gate ||
                      "-"}{" "}
                    -{" "}
                    {f.status ||
                      "-"}
                  </option>
                )
              )}
            </select>
          )}
        </div>
      </section>

      {canDeleteMonth && (
        <section
          className="no-print"
          style={{
            border:
              "1px solid #fecaca",

            borderRadius:
              12,

            padding:
              12,

            marginTop:
              14,

            background:
              "#fef2f2",
          }}
        >
          <h3
            style={{
              margin:
                0,

              color:
                "#991b1b",
            }}
          >
            Delete Loaded Flights by Month
          </h3>

          <p
            style={{
              color:
                "#991b1b",

              fontSize:
                "0.9rem",
            }}
          >
            Deletes all LOADED flights for the selected month, including scans, manifests, reports, PDFs, and bag tag indexes.
          </p>

          <div
            style={{
              display:
                "flex",

              gap:
                10,

              flexWrap:
                "wrap",

              alignItems:
                "end",
            }}
          >
            <div>
              <label
                style={
                  label
                }
              >
                Month
              </label>

              <input
                type="month"

                value={
                  deleteMonth
                }

                onChange={(e) =>
                  setDeleteMonth(
                    e.target.value
                  )
                }

                style={
                  input
                }
              />
            </div>

            <button
              onClick={
                handleDeleteMonth
              }

              disabled={
                deletingMonth
              }

              style={{
                padding:
                  "9px 12px",

                borderRadius:
                  12,

                border:
                  "1px solid #dc2626",

                background:
                  "#dc2626",

                color:
                  "white",

                fontWeight:
                  900,

                cursor:
                  deletingMonth
                    ? "not-allowed"
                    : "pointer",

                opacity:
                  deletingMonth
                    ? 0.7
                    : 1,
              }}
            >
              {deletingMonth
                ? "Deleting..."
                : "Delete Month"}
            </button>
          </div>

          {deleteMsg && (
            <p
              style={{
                color:
                  "#16a34a",

                fontWeight:
                  800,
              }}
            >
              {deleteMsg}
            </p>
          )}

          {deleteErr && (
            <p
              style={{
                color:
                  "#b91c1c",

                fontWeight:
                  800,
              }}
            >
              {deleteErr}
            </p>
          )}
        </section>
      )}

      {!selectedFlightId ? (
        <section
          style={{
            border:
              "1px solid #e5e7eb",

            borderRadius:
              12,

            padding:
              20,

            marginTop:
              14,

            textAlign:
              "center",

            color:
              "#6b7280",
          }}
        >
          Select a flight to build the complete operational report.
        </section>
      ) : reportLoading ? (
        <section
          style={{
            border:
              "1px solid #e5e7eb",

            borderRadius:
              12,

            padding:
              20,

            marginTop:
              14,

            textAlign:
              "center",

            color:
              "#6b7280",
          }}
        >
          Building flight report...
        </section>
      ) : (
        <>
          <section
            className="avoid-break"
            style={{
              marginTop:
                14,

              border:
                "2px solid #111827",

              borderRadius:
                14,

              padding:
                16,
            }}
          >
            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                gap:
                  12,

                flexWrap:
                  "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize:
                      "0.72rem",

                    fontWeight:
                      900,

                    color:
                      "#6b7280",

                    letterSpacing:
                      "0.08em",
                  }}
                >
                  BLCS OPERATIONAL FLIGHT REPORT
                </div>

                <h2
                  style={{
                    margin:
                      "5px 0 0",
                  }}
                >
                  Flight{" "}
                  {selectedFlight
                    ?.flightNumber ||
                    selectedFlightId}
                </h2>
              </div>

              <div
                style={{
                  textAlign:
                    "right",

                  fontSize:
                    "0.85rem",
                }}
              >
                <div>
                  Date:{" "}
                  <strong>
                    {selectedFlight
                      ?.flightDate ||
                      "-"}
                  </strong>
                </div>

                <div>
                  Gate:{" "}
                  <strong>
                    {selectedFlight
                      ?.gate ||
                      "-"}
                  </strong>
                </div>

                <div>
                  Aircraft:{" "}
                  <strong>
                    {selectedFlight
                      ?.aircraftType ||
                      "-"}
                  </strong>
                </div>

                <div>
                  Status:{" "}
                  <strong>
                    {selectedFlight
                      ?.status ||
                      "-"}
                  </strong>
                </div>
              </div>
            </div>

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(auto-fit, minmax(135px, 1fr))",

                gap:
                  8,

                marginTop:
                  14,
              }}
            >
              <SummaryBox
                label="Counter Scanned"
                value={
                  counterScans.length
                }
              />

              <SummaryBox
                label="Bagroom"
                value={
                  regularBagroomScans.length
                }
              />

              <SummaryBox
                label="Oversize"
                value={
                  oversizeScans.length
                }
              />

              <SummaryBox
                label="Gate / Ramp"
                value={
                  gateRampScans.length
                }
              />

              <SummaryBox
                label="Aircraft Loaded"
                value={
                  aircraftScans.length
                }
              />
            </div>
          </section>

          <section
            className="avoid-break"
            style={sectionStyle}
          >
            <SectionTitle>
              Aircraft Loading PDF
            </SectionTitle>

            {aircraftPdf ? (
              <div>
                <p
                  style={{
                    margin:
                      "6px 0 10px",

                    color:
                      "#6b7280",
                  }}
                >
                  Aircraft loading PDF generated when the loading process was completed.
                </p>

                <a
                  href={
                    aircraftPdf.downloadUrl
                  }

                  target="_blank"

                  rel="noreferrer"

                  className="no-print"

                  style={{
                    display:
                      "inline-flex",

                    padding:
                      "8px 12px",

                    borderRadius:
                      9,

                    background:
                      "#2563eb",

                    color:
                      "white",

                    fontWeight:
                      900,

                    textDecoration:
                      "none",
                  }}
                >
                  Open Aircraft PDF
                </a>

                <div
                  style={{
                    marginTop:
                      8,

                    fontSize:
                      "0.8rem",

                    color:
                      "#6b7280",
                  }}
                >
                  File:{" "}
                  {aircraftPdf.fileName ||
                    aircraftPdf.id}
                  <br />
                  Created:{" "}
                  {formatDateTime(
                    aircraftPdf.createdAt
                  )}
                </div>
              </div>
            ) : (
              <p
                style={{
                  color:
                    "#6b7280",
                }}
              >
                No aircraft loading PDF is currently saved for this flight.
              </p>
            )}
          </section>

          <EmployeeSection
            title="Counter Scan Activity"
            description="Employees who scanned baggage at the ticket counter and the bag tags scanned by each employee."
            groups={
              counterGroups
            }
            emptyText="No Counter scans for this flight."
          />

          <EmployeeSection
            title="Bagroom Scan Activity"
            description="Employees who received/scanned baggage in Bagroom and the bag tags handled by each employee."
            groups={
              bagroomGroups
            }
            emptyText="No Bagroom scans for this flight."
            showLocation
            locationLabel="Bagroom"
          />

          <EmployeeSection
            title="Oversize Activity"
            description="Employees who received/scanned Oversize baggage and the bag tags handled by each employee."
            groups={
              oversizeGroups
            }
            emptyText="No Oversize scans for this flight."
            showLocation
            locationLabel="Oversize"
          />

          <EmployeeSection
            title="Gate / Ramp Receiving Activity"
            description="Employees who received/scanned baggage at Gate / Ramp before aircraft loading."
            groups={
              gateRampGroups
            }
            emptyText="No Gate / Ramp receiving scans for this flight."
            showLocation
            locationLabel="Gate / Ramp"
          />

          <EmployeeSection
            title="Aircraft Loading Activity"
            description="Employees who loaded/scanned baggage on the aircraft and the bag tags loaded by each employee."
            groups={
              aircraftGroups
            }
            emptyText="No Aircraft scans for this flight."
            showZones
          />

          <section
            className="print-break"
            style={sectionStyle}
          >
            <SectionTitle>
              All Bags Loaded on Aircraft
            </SectionTitle>

            <p
              style={{
                margin:
                  "6px 0 10px",

                color:
                  "#6b7280",

                fontSize:
                  "0.85rem",
              }}
            >
              Complete list of bag tags recorded in Aircraft scans for this flight.
            </p>

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(auto-fit, minmax(110px, 1fr))",

                gap:
                  7,

                marginBottom:
                  12,
              }}
            >
              <SummaryBox
                label="Zone 1"
                value={
                  zoneCounts[1]
                }
              />

              <SummaryBox
                label="Zone 2"
                value={
                  zoneCounts[2]
                }
              />

              <SummaryBox
                label="Zone 3"
                value={
                  zoneCounts[3]
                }
              />

              <SummaryBox
                label="Zone 4"
                value={
                  zoneCounts[4]
                }
              />
            </div>

            <TagGrid
              tags={
                allLoadedBagTags
              }
              emptyText="No loaded bag tags."
            />
          </section>

          <section
            style={sectionStyle}
          >
            <SectionTitle>
              Baggage Flow Lists
            </SectionTitle>

            <TagListBlock
              title="Counter"
              tags={
                counterBagTags
              }
            />

            <TagListBlock
              title="Bagroom"
              tags={
                bagroomBagTags
              }
            />

            <TagListBlock
              title="Oversize"
              tags={
                oversizeBagTags
              }
            />

            <TagListBlock
              title="Gate / Ramp"
              tags={
                gateRampBagTags
              }
            />

            <TagListBlock
              title="Aircraft"
              tags={
                allLoadedBagTags
              }
            />
          </section>

          <section
            style={sectionStyle}
          >
            <SectionTitle>
              Flight Events / Existing Reports
            </SectionTitle>

            {reportRows.length ===
            0 ? (
              <p
                style={{
                  color:
                    "#6b7280",
                }}
              >
                No additional reports saved for this flight.
              </p>
            ) : (
              <div
                style={{
                  overflowX:
                    "auto",
                }}
              >
                <table
                  style={{
                    width:
                      "100%",

                    borderCollapse:
                      "collapse",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background:
                          "#f9fafb",
                      }}
                    >
                      <th
                        style={
                          th
                        }
                      >
                        Type
                      </th>

                      <th
                        style={
                          th
                        }
                      >
                        Details
                      </th>

                      <th
                        style={
                          th
                        }
                      >
                        Created
                      </th>

                      <th
                        style={
                          th
                        }
                      >
                        Created By
                      </th>

                      <th
                        className="no-print"
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
                    {reportRows.map(
                      (r) => (
                        <tr
                          key={
                            r.id
                          }
                        >
                          <td
                            style={
                              td
                            }
                          >
                            <strong>
                              {r.type ||
                                "PDF_REPORT"}
                            </strong>
                          </td>

                          <td
                            style={
                              td
                            }
                          >
                            {r.type ===
                            "OFFLOAD_BAG" ? (
                              <>
                                <strong>
                                  Bag:
                                </strong>{" "}
                                {r.tag ||
                                  "-"}{" "}
                                -{" "}
                                <strong>
                                  Zone:
                                </strong>{" "}
                                {r.zone ||
                                  "-"}

                                <br />

                                <span
                                  style={{
                                    color:
                                      "#6b7280",
                                  }}
                                >
                                  {r.reason ||
                                    "-"}
                                </span>
                              </>
                            ) : r.type ===
                              "REOPEN_FLIGHT" ? (
                              <>
                                <strong>
                                  Flight reopened
                                </strong>

                                <br />

                                <span
                                  style={{
                                    color:
                                      "#6b7280",
                                  }}
                                >
                                  {r.reason ||
                                    "-"}
                                </span>
                              </>
                            ) : r.type ===
                              "LOADING_COMPLETED" ? (
                              <>
                                <strong>
                                  Loading completed
                                </strong>

                                <br />

                                <span
                                  style={{
                                    color:
                                      "#6b7280",
                                  }}
                                >
                                  {r.reason ||
                                    "-"}
                                </span>
                              </>
                            ) : (
                              <strong>
                                {r.fileName ||
                                  r.id}
                              </strong>
                            )}
                          </td>

                          <td
                            style={
                              td
                            }
                          >
                            {formatDateTime(
                              r.createdAt
                            )}
                          </td>

                          <td
                            style={
                              td
                            }
                          >
                            {r.createdBy
                              ?.fullName ||
                              r.createdBy
                                ?.username ||
                              "-"}
                          </td>

                          <td
                            className="no-print"
                            style={{
                              ...td,

                              textAlign:
                                "right",
                            }}
                          >
                            {r.downloadUrl ? (
                              <a
                                href={
                                  r.downloadUrl
                                }

                                target="_blank"

                                rel="noreferrer"

                                style={{
                                  fontWeight:
                                    800,
                                }}
                              >
                                Open PDF
                              </a>
                            ) : (
                              <span
                                style={{
                                  color:
                                    "#6b7280",
                                }}
                              >
                                -
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div
            style={{
              marginTop:
                16,

              paddingTop:
                10,

              borderTop:
                "1px solid #e5e7eb",

              color:
                "#6b7280",

              fontSize:
                "0.72rem",
            }}
          >
            Generated from BLCS live flight records.
            Printed by{" "}
            {operationalContext
              ?.employeeFullName ||
              user?.fullName ||
              user?.username ||
              "-"}
            {" "}as{" "}
            {operationalContext
              ?.operationalPositionLabel ||
              formatOperationalPosition(
                operationalContext
                  ?.operationalPosition
              )}
            .
          </div>
        </>
      )}
    </div>
  );
}

function SectionTitle({
  children,
}) {
  return (
    <h3
      style={{
        margin:
          0,

        color:
          "#111827",
      }}
    >
      {children}
    </h3>
  );
}

function SummaryBox({
  label,
  value,
}) {
  return (
    <div
      style={{
        padding:
          9,

        borderRadius:
          10,

        background:
          "#f9fafb",

        border:
          "1px solid #e5e7eb",

        textAlign:
          "center",
      }}
    >
      <div
        style={{
          color:
            "#6b7280",

          fontSize:
            "0.7rem",

          fontWeight:
            800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            2,

          fontSize:
            "1.2rem",

          fontWeight:
            900,

          color:
            "#111827",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function EmployeeSection({
  title,
  description,
  groups,
  emptyText,
  showLocation = false,
  locationLabel = "",
  showZones = false,
}) {
  return (
    <section
      style={sectionStyle}
    >
      <SectionTitle>
        {title}
      </SectionTitle>

      <p
        style={{
          margin:
            "6px 0 10px",

          color:
            "#6b7280",

          fontSize:
            "0.85rem",
        }}
      >
        {description}
      </p>

      {groups.length ===
      0 ? (
        <p
          style={{
            color:
              "#6b7280",
          }}
        >
          {emptyText}
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
          {groups.map(
            (group) => (
              <EmployeeScanCard
                key={
                  group.key
                }

                group={
                  group
                }

                showLocation={
                  showLocation
                }

                locationLabel={
                  locationLabel
                }

                showZones={
                  showZones
                }
              />
            )
          )}
        </div>
      )}
    </section>
  );
}

function EmployeeScanCard({
  group,
  showLocation,
  locationLabel,
  showZones,
}) {
  const zoneCounts = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
  };

  if (showZones) {
    group.scans.forEach(
      (scan) => {
        const zone =
          Number(
            scan?.zone
          );

        if (
          zone >= 1 &&
          zone <= 4
        ) {
          zoneCounts[zone] += 1;
        }
      }
    );
  }

  return (
    <div
      className="avoid-break"
      style={{
        border:
          "1px solid #e5e7eb",

        borderRadius:
          12,

        overflow:
          "hidden",
      }}
    >
      <div
        style={{
          padding:
            "10px 12px",

          background:
            "#f9fafb",

          borderBottom:
            "1px solid #e5e7eb",

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
        <div>
          <div
            style={{
              fontWeight:
                900,

              color:
                "#111827",
            }}
          >
            {group.fullName ||
              group.username}
          </div>

          <div
            style={{
              marginTop:
                2,

              color:
                "#6b7280",

              fontSize:
                "0.75rem",
            }}
          >
            @{group.username}
            {" - "}
            {group
              .operationalPositionLabel ||
              "-"}
            {showLocation &&
              locationLabel
                ? ` - ${locationLabel}`
                : ""}
          </div>
        </div>

        <div
          style={{
            fontWeight:
              900,

            color:
              "#1d4ed8",
          }}
        >
          {group.tags.length} bag(s)
        </div>
      </div>

      {showZones && (
        <div
          style={{
            display:
              "grid",

            gridTemplateColumns:
              "repeat(4, minmax(0, 1fr))",

            gap:
              5,

            padding:
              "8px 10px 0",
          }}
        >
          {[1, 2, 3, 4].map(
            (zone) => (
              <div
                key={
                  zone
                }

                style={{
                  padding:
                    6,

                  borderRadius:
                    8,

                  background:
                    "#eff6ff",

                  color:
                    "#1d4ed8",

                  textAlign:
                    "center",

                  fontSize:
                    "0.7rem",

                  fontWeight:
                    900,
                }}
              >
                Z{zone}:{" "}
                {
                  zoneCounts[
                    zone
                  ]
                }
              </div>
            )
          )}
        </div>
      )}

      <div
        style={{
          padding:
            10,
        }}
      >
        <TagGrid
          tags={
            group.tags
          }
          emptyText="No bag tags."
        />
      </div>
    </div>
  );
}

function TagGrid({
  tags,
  emptyText,
}) {
  if (
    !tags ||
    tags.length === 0
  ) {
    return (
      <p
        style={{
          color:
            "#6b7280",

          margin:
            0,
        }}
      >
        {emptyText}
      </p>
    );
  }

  return (
    <div
      style={{
        display:
          "flex",

        flexWrap:
          "wrap",

        gap:
          6,
      }}
    >
      {tags.map(
        (tag) => (
          <span
            key={
              tag
            }

            style={{
              padding:
                "4px 7px",

              borderRadius:
                999,

              background:
                "#f3f4f6",

              border:
                "1px solid #e5e7eb",

              color:
                "#111827",

              fontSize:
                "0.75rem",

              fontWeight:
                800,

              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          >
            {tag}
          </span>
        )
      )}
    </div>
  );
}

function TagListBlock({
  title,
  tags,
}) {
  return (
    <div
      className="avoid-break"
      style={{
        marginTop:
          12,

        paddingTop:
          10,

        borderTop:
          "1px solid #f3f4f6",
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

          marginBottom:
            7,
        }}
      >
        <strong>
          {title}
        </strong>

        <strong>
          {tags.length}
        </strong>
      </div>

      <TagGrid
        tags={
          tags
        }
        emptyText="No bag tags."
      />
    </div>
  );
}

const sectionStyle = {
  border:
    "1px solid #e5e7eb",

  borderRadius:
    12,

  padding:
    12,

  marginTop:
    14,

  background:
    "white",
};

const label = {
  display:
    "block",

  fontSize:
    "0.85rem",

  color:
    "#374151",

  marginBottom:
    4,
};

const input = {
  padding:
    "8px 10px",

  borderRadius:
    10,

  border:
    "1px solid #d1d5db",

  background:
    "white",
};

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
};

const td = {
  padding:
    "10px 8px",

  borderBottom:
    "1px solid #f3f4f6",

  color:
    "#111827",

  verticalAlign:
    "top",
};

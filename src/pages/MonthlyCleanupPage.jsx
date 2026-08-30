// src/pages/MonthlyCleanupPage.jsx
import React, { useMemo, useState } from "react";

import {
  collection,
  getDocs,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import {
  db,
  functions,
} from "../firebase";

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function getCurrentMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(
    d.getMonth() + 1
  ).padStart(2, "0");

  return `${y}-${m}`;
}

function formatMonthLabel(value) {
  if (
    !value ||
    !value.includes("-")
  ) {
    return value || "-";
  }

  const [year, month] =
    value.split("-");

  const date =
    new Date(
      Number(year),
      Number(month) - 1,
      1
    );

  return date.toLocaleDateString(
    undefined,
    {
      month: "long",
      year: "numeric",
    }
  );
}

function formatCallableError(
  error,
  fallbackMessage
) {
  const details =
    error?.details
      ? typeof error.details ===
        "string"
        ? error.details
        : JSON.stringify(
            error.details
          )
      : null;

  return [
    fallbackMessage,
    error?.code
      ? `Code: ${error.code}`
      : null,
    error?.message
      ? `Message: ${error.message}`
      : null,
    details
      ? `Details: ${details}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export default function MonthlyCleanupPage({
  user,
}) {
  const role =
    normalizeRole(
      user?.role
    );

  const isStationManager =
    role ===
    "station_manager";

  const [
    monthValue,
    setMonthValue,
  ] = useState(
    getCurrentMonth()
  );

  const [
    preview,
    setPreview,
  ] = useState(null);

  const [
    loadingPreview,
    setLoadingPreview,
  ] = useState(false);

  const [
    deleting,
    setDeleting,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    error,
    setError,
  ] = useState("");

  const monthLabel =
    useMemo(
      () =>
        formatMonthLabel(
          monthValue
        ),
      [monthValue]
    );

  /*
   * Preview reads Firestore directly.
   *
   * IMPORTANT:
   * Nothing is deleted here.
   * The Cloud Function is only used
   * when the Station Manager confirms
   * permanent deletion.
   */
  const runPreview =
    async () => {
      setMessage("");
      setError("");
      setPreview(null);

      const [
        yearText,
        monthText,
      ] =
        String(
          monthValue || ""
        ).split("-");

      const year =
        Number(yearText);

      const month =
        Number(monthText);

      if (
        !year ||
        !month ||
        month < 1 ||
        month > 12
      ) {
        setError(
          "Please select a valid month."
        );

        return;
      }

      try {
        setLoadingPreview(
          true
        );

        const monthPrefix =
          `${year}-${String(
            month
          ).padStart(
            2,
            "0"
          )}`;

        /*
         * Read all flights.
         * Filter by flightDate YYYY-MM.
         *
         * This avoids depending on the
         * preview Cloud Function.
         */
        const flightsSnapshot =
          await getDocs(
            collection(
              db,
              "flights"
            )
          );

        const flights =
          flightsSnapshot.docs
            .map(
              (
                document
              ) => ({
                id:
                  document.id,

                ...document.data(),
              })
            )
            .filter(
              (
                flight
              ) => {
                const flightDate =
                  String(
                    flight
                      ?.flightDate ||
                      ""
                  );

                return flightDate.startsWith(
                  monthPrefix
                );
              }
            );

        const statusCounts = {
          OPEN: 0,
          RECEIVING: 0,
          LOADING: 0,
          LOADED: 0,
          OTHER: 0,
        };

        flights.forEach(
          (
            flight
          ) => {
            const status =
              String(
                flight
                  ?.status ||
                  "OPEN"
              )
                .trim()
                .toUpperCase();

            if (
              Object.prototype
                .hasOwnProperty
                .call(
                  statusCounts,
                  status
                )
            ) {
              statusCounts[
                status
              ] += 1;
            } else {
              statusCounts
                .OTHER +=
                1;
            }
          }
        );

        flights.sort(
          (
            a,
            b
          ) => {
            const dateCompare =
              String(
                a
                  ?.flightDate ||
                  ""
              ).localeCompare(
                String(
                  b
                    ?.flightDate ||
                    ""
                )
              );

            if (
              dateCompare !==
              0
            ) {
              return dateCompare;
            }

            return String(
              a
                ?.flightNumber ||
                ""
            ).localeCompare(
              String(
                b
                  ?.flightNumber ||
                  ""
              ),
              undefined,
              {
                numeric: true,
              }
            );
          }
        );

        /*
         * Try to count global bagTags
         * connected to flights in the month.
         *
         * If Firestore rules block this read,
         * preview still works and shows "â".
         */
        let bagTagCount =
          0;

        try {
          const flightIds =
            new Set(
              flights.map(
                (
                  flight
                ) =>
                  flight.id
              )
            );

          const bagTagsSnapshot =
            await getDocs(
              collection(
                db,
                "bagTags"
              )
            );

          bagTagCount =
            bagTagsSnapshot.docs.filter(
              (
                document
              ) => {
                const data =
                  document.data();

                const linkedFlightId =
                  String(
                    data
                      ?.flightId ||
                      data
                        ?.currentFlightId ||
                      ""
                  );

                return flightIds.has(
                  linkedFlightId
                );
              }
            ).length;
        } catch (
          bagTagError
        ) {
          console.warn(
            "Unable to count bagTags during preview:",
            bagTagError
          );

          bagTagCount =
            null;
        }

        const previewFlights =
          flights.map(
            (
              flight
            ) => ({
              id:
                flight.id,

              flightNumber:
                flight
                  ?.flightNumber ||
                null,

              flightDate:
                flight
                  ?.flightDate ||
                null,

              gate:
                flight
                  ?.gate ||
                null,

              status:
                String(
                  flight
                    ?.status ||
                    "OPEN"
                )
                  .trim()
                  .toUpperCase(),
            })
          );

        setPreview({
          ok: true,

          month:
            monthPrefix,

          flightCount:
            previewFlights.length,

          bagTagCount,

          statusCounts,

          flights:
            previewFlights,
        });
      } catch (
        previewError
      ) {
        console.error(
          "Monthly cleanup preview error:",
          previewError
        );

        setError(
          formatCallableError(
            previewError,
            "Unable to load monthly preview."
          )
        );
      } finally {
        setLoadingPreview(
          false
        );
      }
    };

  const runDelete =
    async () => {
      setMessage("");
      setError("");

      if (!preview) {
        setError(
          "Run Preview before deleting."
        );

        return;
      }

      const [
        yearText,
        monthText,
      ] =
        String(
          monthValue || ""
        ).split("-");

      const year =
        Number(yearText);

      const month =
        Number(monthText);

      if (
        !year ||
        !month ||
        month < 1 ||
        month > 12
      ) {
        setError(
          "Please select a valid month."
        );

        return;
      }

      if (
        preview.month !==
        monthValue
      ) {
        setError(
          "The selected month changed. Run Preview again before deleting."
        );

        setPreview(null);

        return;
      }

      const bagTagLabel =
        preview
          .bagTagCount ===
        null
          ? "Not available in preview"
          : preview
              .bagTagCount;

      const firstConfirm =
        window.confirm(
          `FULL MONTHLY CLEANUP\n\n` +
            `${monthLabel}\n\n` +
            `Flights: ${preview.flightCount || 0}\n` +
            `Tracked Bag Tags: ${bagTagLabel}\n\n` +
            `This will permanently delete all flights in the selected month and their baggage history.\n\n` +
            `Continue?`
        );

      if (
        !firstConfirm
      ) {
        return;
      }

      const confirmationText =
        `DELETE ${monthValue}`;

      const typed =
        window.prompt(
          `Type ${confirmationText} to confirm permanent deletion.`
        );

      if (
        typed !==
        confirmationText
      ) {
        setError(
          "Cleanup cancelled. Confirmation text did not match."
        );

        return;
      }

      try {
        setDeleting(
          true
        );

        const fn =
          httpsCallable(
            functions,
            "deleteFlightsByMonth"
          );

        const result =
          await fn({
            year,
            month,

            username:
              user
                ?.username ||
              null,

            userRole:
              user
                ?.role ||
              null,

            confirmation:
              confirmationText,
          });

        const data =
          result
            ?.data ||
          {};

        setMessage(
          `Cleanup completed. Deleted ${data.deletedFlights || 0} flight(s) and ` +
            `${data.deletedBagTags || 0} tracked bag tag record(s) for ${
              data.month ||
              monthValue
            }.`
        );

        setPreview(
          null
        );
      } catch (
        deleteError
      ) {
        console.error(
          "Monthly cleanup delete error:",
          deleteError
        );

        setError(
          formatCallableError(
            deleteError,
            "Monthly cleanup failed."
          )
        );
      } finally {
        setDeleting(
          false
        );
      }
    };

  if (
    !isStationManager
  ) {
    return (
      <div
        style={{
          background:
            "#fef2f2",

          border:
            "1px solid #fecaca",

          color:
            "#991b1b",

          borderRadius:
            12,

          padding:
            16,

          fontWeight:
            800,
        }}
      >
        Only Station Manager can access Monthly Data Cleanup.
      </div>
    );
  }

  return (
    <div
      style={{
        background:
          "white",

        border:
          "1px solid #e5e7eb",

        borderRadius:
          14,

        padding:
          16,
      }}
    >
      <div>
        <div
          style={{
            color:
              "#dc2626",

            fontSize:
              "0.72rem",

            fontWeight:
              900,

            letterSpacing:
              "0.08em",

            textTransform:
              "uppercase",
          }}
        >
          BLCS Administration
        </div>

        <h2
          style={{
            margin:
              "4px 0 0",
          }}
        >
          Monthly Data Cleanup
        </h2>

        <p
          style={{
            margin:
              "7px 0 0",

            color:
              "#64748b",

            fontSize:
              "0.88rem",

            lineHeight:
              1.5,
          }}
        >
          Permanently remove old flights and all associated baggage records for a selected month.
        </p>
      </div>

      <section
        style={{
          marginTop:
            16,

          border:
            "1px solid #fecaca",

          borderRadius:
            12,

          padding:
            12,

          background:
            "#fff7f7",
        }}
      >
        <div
          style={{
            fontWeight:
              900,

            color:
              "#991b1b",

            marginBottom:
              7,
          }}
        >
          Permanent deletion
        </div>

        <div
          style={{
            color:
              "#7f1d1d",

            fontSize:
              "0.82rem",

            lineHeight:
              1.55,
          }}
        >
          This cleanup removes the flight document, Counter scans, Bagroom / Oversize / Gate-Ramp scans, Aircraft scans, allowed manifest tags, reports, uploaded report PDFs, manifest files, global bag tag tracking records, and bag tag event history associated with those flights.
        </div>
      </section>

      <section
        style={{
          marginTop:
            14,

          border:
            "1px solid #e5e7eb",

          borderRadius:
            12,

          padding:
            12,

          background:
            "#f8fafc",
        }}
      >
        <label
          style={{
            display:
              "block",

            marginBottom:
              5,

            color:
              "#334155",

            fontSize:
              "0.8rem",

            fontWeight:
              900,
          }}
        >
          Select Month
        </label>

        <div
          style={{
            display:
              "flex",

            gap:
              8,

            flexWrap:
              "wrap",

            alignItems:
              "center",
          }}
        >
          <input
            type="month"

            value={
              monthValue
            }

            onChange={(
              event
            ) => {
              setMonthValue(
                event
                  .target
                  .value
              );

              setPreview(
                null
              );

              setMessage(
                ""
              );

              setError(
                ""
              );
            }}

            disabled={
              loadingPreview ||
              deleting
            }

            style={{
              minHeight:
                44,

              padding:
                "8px 10px",

              borderRadius:
                10,

              border:
                "1px solid #cbd5e1",

              background:
                "white",

              fontWeight:
                800,
            }}
          />

          <button
            type="button"

            onClick={
              runPreview
            }

            disabled={
              !monthValue ||
              loadingPreview ||
              deleting
            }

            style={{
              minHeight:
                44,

              padding:
                "8px 13px",

              borderRadius:
                10,

              border:
                "1px solid #2563eb",

              background:
                !monthValue ||
                loadingPreview ||
                deleting
                  ? "#93c5fd"
                  : "#2563eb",

              color:
                "white",

              fontWeight:
                900,

              cursor:
                !monthValue ||
                loadingPreview ||
                deleting
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {loadingPreview
              ? "Checking..."
              : "Preview Cleanup"}
          </button>
        </div>
      </section>

      {preview && (
        <section
          style={{
            marginTop:
              14,

            border:
              "1px solid #e5e7eb",

            borderRadius:
              12,

            padding:
              12,
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

              alignItems:
                "center",
            }}
          >
            <div>
              <h3
                style={{
                  margin:
                    0,
                }}
              >
                Cleanup Preview
              </h3>

              <div
                style={{
                  marginTop:
                    4,

                  color:
                    "#64748b",

                  fontSize:
                    "0.8rem",
                }}
              >
                {monthLabel}
              </div>
            </div>

            <span
              style={{
                padding:
                  "5px 9px",

                borderRadius:
                  999,

                background:
                  "#fef3c7",

                border:
                  "1px solid #fcd34d",

                color:
                  "#92400e",

                fontWeight:
                  900,

                fontSize:
                  "0.72rem",
              }}
            >
              PREVIEW ONLY
            </span>
          </div>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "repeat(auto-fit, minmax(140px, 1fr))",

              gap:
                8,

              marginTop:
                12,
            }}
          >
            <SummaryCard
              label="Flights"

              value={
                preview
                  .flightCount ||
                0
              }

              background="#eff6ff"

              color="#1d4ed8"
            />

            <SummaryCard
              label="Loaded"

              value={
                preview
                  .statusCounts
                  ?.LOADED ||
                0
              }

              background="#dcfce7"

              color="#166534"
            />

            <SummaryCard
              label="Open / Active"

              value={
                (preview
                  .statusCounts
                  ?.OPEN ||
                  0) +
                (preview
                  .statusCounts
                  ?.RECEIVING ||
                  0) +
                (preview
                  .statusCounts
                  ?.LOADING ||
                  0)
              }

              background="#fef3c7"

              color="#92400e"
            />

            <SummaryCard
              label="Tracked Bag Tags"

              value={
                preview
                  .bagTagCount ===
                null
                  ? "â"
                  : preview
                      .bagTagCount
              }

              background="#f3e8ff"

              color="#6b21a8"
            />
          </div>

          {Array.isArray(
            preview
              .flights
          ) &&
            preview
              .flights
              .length >
              0 && (
              <div
                style={{
                  marginTop:
                    12,

                  maxHeight:
                    300,

                  overflow:
                    "auto",

                  border:
                    "1px solid #e5e7eb",

                  borderRadius:
                    10,
                }}
              >
                <table
                  style={{
                    width:
                      "100%",

                    borderCollapse:
                      "collapse",

                    minWidth:
                      600,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background:
                          "#f8fafc",
                      }}
                    >
                      <th
                        style={
                          th
                        }
                      >
                        Date
                      </th>

                      <th
                        style={
                          th
                        }
                      >
                        Flight
                      </th>

                      <th
                        style={
                          th
                        }
                      >
                        Gate
                      </th>

                      <th
                        style={
                          th
                        }
                      >
                        Status
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {preview
                      .flights
                      .map(
                        (
                          flight
                        ) => (
                          <tr
                            key={
                              flight.id
                            }
                          >
                            <td
                              style={
                                td
                              }
                            >
                              {flight
                                .flightDate ||
                                "-"}
                            </td>

                            <td
                              style={
                                td
                              }
                            >
                              <strong>
                                {flight
                                  .flightNumber ||
                                  flight.id}
                              </strong>
                            </td>

                            <td
                              style={
                                td
                              }
                            >
                              {flight
                                .gate ||
                                "-"}
                            </td>

                            <td
                              style={
                                td
                              }
                            >
                              {flight
                                .status ||
                                "-"}
                            </td>
                          </tr>
                        )
                      )}
                  </tbody>
                </table>
              </div>
            )}

          {preview
            .flightCount ===
            0 && (
            <div
              style={{
                marginTop:
                  12,

                padding:
                  12,

                borderRadius:
                  10,

                background:
                  "#f8fafc",

                border:
                  "1px solid #e2e8f0",

                color:
                  "#64748b",

                fontWeight:
                  700,
              }}
            >
              No flights were found for {monthLabel}.
            </div>
          )}

          <button
            type="button"

            onClick={
              runDelete
            }

            disabled={
              deleting ||
              (preview
                .flightCount ||
                0) ===
                0
            }

            style={{
              width:
                "100%",

              minHeight:
                50,

              marginTop:
                12,

              borderRadius:
                12,

              border:
                "1px solid #dc2626",

              background:
                deleting ||
                (preview
                  .flightCount ||
                  0) ===
                  0
                  ? "#fca5a5"
                  : "#dc2626",

              color:
                "white",

              fontWeight:
                900,

              fontSize:
                "0.92rem",

              cursor:
                deleting ||
                (preview
                  .flightCount ||
                  0) ===
                  0
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {deleting
              ? "Deleting Monthly Data..."
              : `Delete ${monthLabel} Data`}
          </button>
        </section>
      )}

      {message && (
        <div
          style={{
            marginTop:
              12,

            padding:
              10,

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
          {message}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop:
              12,

            padding:
              10,

            borderRadius:
              10,

            background:
              "#fef2f2",

            border:
              "1px solid #fecaca",

            color:
              "#991b1b",

            fontWeight:
              800,

            whiteSpace:
              "pre-wrap",
          }}
        >
          {error}
        </div>
      )}
    </div>
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
        padding:
          10,

        borderRadius:
          12,

        border:
          "1px solid rgba(15,23,42,0.08)",

        background,

        color,

        textAlign:
          "center",
      }}
    >
      <div
        style={{
          fontSize:
            "0.7rem",

          fontWeight:
            900,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            2,

          fontSize:
            "1.3rem",

          fontWeight:
            900,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const th = {
  textAlign:
    "left",

  padding:
    "9px 8px",

  borderBottom:
    "1px solid #e5e7eb",

  color:
    "#64748b",

  fontSize:
    "0.72rem",

  textTransform:
    "uppercase",

  letterSpacing:
    "0.04em",

  whiteSpace:
    "nowrap",
};

const td = {
  padding:
    "9px 8px",

  borderBottom:
    "1px solid #f1f5f9",

  color:
    "#334155",

  fontSize:
    "0.82rem",
};

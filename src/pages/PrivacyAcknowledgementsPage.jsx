// src/pages/PrivacyAcknowledgementsPage.jsx
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

import { db } from "../firebase";

import {
  PRIVACY_NOTICE_VERSION,
} from "./PrivacyNoticePage.jsx";

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function formatRole(role) {
  return String(role || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  try {
    const date =
      typeof value.toDate === "function"
        ? value.toDate()
        : new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "-";
    }

    return date.toLocaleString();
  } catch {
    return "-";
  }
}

function getPrivacyStatus(user) {
  const consent =
    user?.privacyConsent || {};

  if (
    consent.accepted !== true
  ) {
    return "PENDING";
  }

  if (
    String(
      consent.version || ""
    ) !==
    String(
      PRIVACY_NOTICE_VERSION
    )
  ) {
    return "OUTDATED";
  }

  return "ACCEPTED";
}

function getStatusStyle(status) {
  if (
    status === "ACCEPTED"
  ) {
    return {
      background:
        "#dcfce7",
      color:
        "#166534",
      border:
        "#86efac",
    };
  }

  if (
    status === "OUTDATED"
  ) {
    return {
      background:
        "#fef3c7",
      color:
        "#92400e",
      border:
        "#fcd34d",
    };
  }

  return {
    background:
      "#fee2e2",
    color:
      "#991b1b",
    border:
      "#fca5a5",
  };
}

function csvEscape(value) {
  const text =
    String(
      value ?? ""
    );

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replaceAll(
      '"',
      '""'
    )}"`;
  }

  return text;
}

export default function PrivacyAcknowledgementsPage({
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
    users,
    setUsers,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  const [
    searchText,
    setSearchText,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("ALL");

  useEffect(() => {
    if (
      !isStationManager
    ) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const usersQuery =
      query(
        collection(
          db,
          "users"
        ),
        orderBy(
          "username"
        )
      );

    const unsubscribe =
      onSnapshot(
        usersQuery,
        (snapshot) => {
          const list =
            snapshot.docs.map(
              (document) => ({
                id:
                  document.id,
                ...document.data(),
              })
            );

          setUsers(list);
          setLoading(false);
        },
        (snapshotError) => {
          console.error(
            "Privacy acknowledgements users error:",
            snapshotError
          );

          setUsers([]);
          setLoading(false);

          setError(
            snapshotError?.message ||
              "Unable to load privacy acknowledgements."
          );
        }
      );

    return () =>
      unsubscribe();
  }, [
    isStationManager,
  ]);

  const summary =
    useMemo(() => {
      let accepted = 0;
      let pending = 0;
      let outdated = 0;
      let activeUsers = 0;

      users.forEach(
        (item) => {
          if (
            item.active !== false
          ) {
            activeUsers += 1;
          }

          const status =
            getPrivacyStatus(
              item
            );

          if (
            status ===
            "ACCEPTED"
          ) {
            accepted += 1;
          } else if (
            status ===
            "OUTDATED"
          ) {
            outdated += 1;
          } else {
            pending += 1;
          }
        }
      );

      return {
        total:
          users.length,
        activeUsers,
        accepted,
        pending,
        outdated,
      };
    }, [users]);

  const filteredUsers =
    useMemo(() => {
      const search =
        searchText
          .trim()
          .toLowerCase();

      return users.filter(
        (item) => {
          const status =
            getPrivacyStatus(
              item
            );

          if (
            statusFilter !==
              "ALL" &&
            status !==
              statusFilter
          ) {
            return false;
          }

          if (!search) {
            return true;
          }

          const haystack = [
            item.username,
            item.fullName,
            item.position,
            item.role,
            item
              ?.privacyConsent
              ?.version,
            item
              ?.privacyConsent
              ?.acceptedBy
              ?.username,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return haystack.includes(
            search
          );
        }
      );
    }, [
      users,
      searchText,
      statusFilter,
    ]);

  const handleExportCsv =
    () => {
      const header = [
        "Full Name",
        "Username",
        "Role",
        "Position",
        "Active",
        "Privacy Status",
        "Current Notice Version",
        "Accepted Version",
        "Accepted At",
        "Accepted By",
      ];

      const dataRows =
        filteredUsers.map(
          (item) => {
            const status =
              getPrivacyStatus(
                item
              );

            return [
              item.fullName ||
                "",
              item.username ||
                "",
              formatRole(
                item.role
              ),
              item.position ||
                "",
              item.active ===
              false
                ? "No"
                : "Yes",
              status,
              PRIVACY_NOTICE_VERSION,
              item
                ?.privacyConsent
                ?.version ||
                "",
              formatDateTime(
                item
                  ?.privacyConsent
                  ?.acceptedAt
              ),
              item
                ?.privacyConsent
                ?.acceptedBy
                ?.username ||
                "",
            ];
          }
        );

      const csv =
        [
          header,
          ...dataRows,
        ]
          .map((row) =>
            row
              .map(
                csvEscape
              )
              .join(",")
          )
          .join("\n");

      const blob =
        new Blob(
          [csv],
          {
            type:
              "text/csv;charset=utf-8;",
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const link =
        document.createElement(
          "a"
        );

      link.href = url;

      link.download =
        `BLCS_Privacy_Acknowledgements_${new Date()
          .toISOString()
          .slice(
            0,
            10
          )}.csv`;

      document.body.appendChild(
        link
      );

      link.click();

      document.body.removeChild(
        link
      );

      URL.revokeObjectURL(
        url
      );
    };

  if (
    !isStationManager
  ) {
    return (
      <div
        style={{
          padding:
            20,

          border:
            "1px solid #fecaca",

          borderRadius:
            12,

          background:
            "#fef2f2",

          color:
            "#991b1b",

          fontWeight:
            800,
        }}
      >
        You do not have permission to view Privacy Acknowledgements.
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
      <div
        style={{
          display:
            "flex",

          justifyContent:
            "space-between",

          alignItems:
            "start",

          gap:
            12,

          flexWrap:
            "wrap",
        }}
      >
        <div>
          <div
            style={{
              color:
                "#2563eb",

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
            Privacy Acknowledgements
          </h2>

          <p
            style={{
              margin:
                "6px 0 0",

              color:
                "#64748b",

              fontSize:
                "0.88rem",
            }}
          >
            Review employee acknowledgement status for the current BLCS Privacy Notice.
          </p>
        </div>

        <div
          style={{
            padding:
              "8px 11px",

            borderRadius:
              10,

            background:
              "#eff6ff",

            border:
              "1px solid #bfdbfe",

            color:
              "#1d4ed8",

            fontSize:
              "0.78rem",

            fontWeight:
              900,
          }}
        >
          Current Version:{" "}
          {
            PRIVACY_NOTICE_VERSION
          }
        </div>
      </div>

      <div
        style={{
          display:
            "grid",

          gridTemplateColumns:
            "repeat(auto-fit, minmax(130px, 1fr))",

          gap:
            8,

          marginTop:
            16,
        }}
      >
        <SummaryCard
          label="Total Users"
          value={
            loading
              ? "..."
              : summary.total
          }
          background="#f8fafc"
          color="#0f172a"
        />

        <SummaryCard
          label="Active Users"
          value={
            loading
              ? "..."
              : summary.activeUsers
          }
          background="#eff6ff"
          color="#1d4ed8"
        />

        <SummaryCard
          label="Accepted"
          value={
            loading
              ? "..."
              : summary.accepted
          }
          background="#dcfce7"
          color="#166534"
        />

        <SummaryCard
          label="Pending"
          value={
            loading
              ? "..."
              : summary.pending
          }
          background="#fee2e2"
          color="#991b1b"
        />

        <SummaryCard
          label="Old Version"
          value={
            loading
              ? "..."
              : summary.outdated
          }
          background="#fef3c7"
          color="#92400e"
        />
      </div>

      <section
        style={{
          marginTop:
            16,

          padding:
            12,

          border:
            "1px solid #e5e7eb",

          borderRadius:
            12,

          background:
            "#f8fafc",
        }}
      >
        <div
          style={{
            display:
              "grid",

            gridTemplateColumns:
              "minmax(220px, 1fr) minmax(160px, 220px) auto",

            gap:
              8,

            alignItems:
              "end",
          }}
        >
          <div>
            <label
              style={
                labelStyle
              }
            >
              Search Employee
            </label>

            <input
              type="text"

              value={
                searchText
              }

              onChange={(event) =>
                setSearchText(
                  event.target.value
                )
              }

              placeholder="Name, username, role..."

              style={{
                ...inputStyle,
                width:
                  "100%",
              }}
            />
          </div>

          <div>
            <label
              style={
                labelStyle
              }
            >
              Status
            </label>

            <select
              value={
                statusFilter
              }

              onChange={(event) =>
                setStatusFilter(
                  event.target.value
                )
              }

              style={{
                ...inputStyle,
                width:
                  "100%",
              }}
            >
              <option value="ALL">
                All
              </option>

              <option value="ACCEPTED">
                Accepted
              </option>

              <option value="PENDING">
                Pending
              </option>

              <option value="OUTDATED">
                Old Version
              </option>
            </select>
          </div>

          <button
            type="button"

            onClick={
              handleExportCsv
            }

            disabled={
              loading ||
              filteredUsers.length ===
                0
            }

            style={{
              minHeight:
                42,

              padding:
                "8px 12px",

              borderRadius:
                10,

              border:
                "1px solid #2563eb",

              background:
                loading ||
                filteredUsers.length ===
                  0
                  ? "#93c5fd"
                  : "#2563eb",

              color:
                "white",

              fontWeight:
                900,

              cursor:
                loading ||
                filteredUsers.length ===
                  0
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            Export CSV
          </button>
        </div>
      </section>

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
          }}
        >
          {error}
        </div>
      )}

      <section
        style={{
          marginTop:
            14,

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
              "#f8fafc",

            borderBottom:
              "1px solid #e5e7eb",

            display:
              "flex",

            justifyContent:
              "space-between",

            gap:
              8,

            flexWrap:
              "wrap",
          }}
        >
          <strong>
            Employee Acknowledgements
          </strong>

          <span
            style={{
              color:
                "#64748b",

              fontSize:
                "0.8rem",
            }}
          >
            Showing{" "}
            {
              filteredUsers.length
            }{" "}
            employee(s)
          </span>
        </div>

        {loading ? (
          <div
            style={{
              padding:
                18,

              color:
                "#64748b",
            }}
          >
            Loading privacy acknowledgements...
          </div>
        ) : filteredUsers.length ===
          0 ? (
          <div
            style={{
              padding:
                18,

              color:
                "#64748b",
            }}
          >
            No employees match the selected filters.
          </div>
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

                minWidth:
                  850,
              }}
            >
              <thead>
                <tr
                  style={{
                    background:
                      "#ffffff",
                  }}
                >
                  <th
                    style={
                      th
                    }
                  >
                    Employee
                  </th>

                  <th
                    style={
                      th
                    }
                  >
                    Role
                  </th>

                  <th
                    style={
                      th
                    }
                  >
                    Status
                  </th>

                  <th
                    style={
                      th
                    }
                  >
                    Version
                  </th>

                  <th
                    style={
                      th
                    }
                  >
                    Accepted At
                  </th>

                  <th
                    style={
                      th
                    }
                  >
                    Accepted By
                  </th>

                  <th
                    style={
                      th
                    }
                  >
                    Account
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredUsers.map(
                  (item) => {
                    const status =
                      getPrivacyStatus(
                        item
                      );

                    const statusStyle =
                      getStatusStyle(
                        status
                      );

                    return (
                      <tr
                        key={
                          item.id
                        }
                      >
                        <td
                          style={
                            td
                          }
                        >
                          <div
                            style={{
                              fontWeight:
                                900,

                              color:
                                "#0f172a",
                            }}
                          >
                            {item.fullName ||
                              item.username ||
                              "-"}
                          </div>

                          <div
                            style={{
                              marginTop:
                                2,

                              color:
                                "#64748b",

                              fontSize:
                                "0.75rem",
                            }}
                          >
                            @
                            {item.username ||
                              "-"}
                            {item.position
                              ? ` - ${item.position}`
                              : ""}
                          </div>
                        </td>

                        <td
                          style={
                            td
                          }
                        >
                          {formatRole(
                            item.role
                          )}
                        </td>

                        <td
                          style={
                            td
                          }
                        >
                          <span
                            style={{
                              display:
                                "inline-flex",

                              padding:
                                "4px 8px",

                              borderRadius:
                                999,

                              background:
                                statusStyle.background,

                              border:
                                `1px solid ${statusStyle.border}`,

                              color:
                                statusStyle.color,

                              fontSize:
                                "0.7rem",

                              fontWeight:
                                900,
                            }}
                          >
                            {status ===
                            "OUTDATED"
                              ? "OLD VERSION"
                              : status}
                          </span>
                        </td>

                        <td
                          style={
                            td
                          }
                        >
                          {item
                            ?.privacyConsent
                            ?.version ||
                            "-"}
                        </td>

                        <td
                          style={
                            td
                          }
                        >
                          {formatDateTime(
                            item
                              ?.privacyConsent
                              ?.acceptedAt
                          )}
                        </td>

                        <td
                          style={
                            td
                          }
                        >
                          {item
                            ?.privacyConsent
                            ?.acceptedBy
                            ?.username ||
                            "-"}
                        </td>

                        <td
                          style={
                            td
                          }
                        >
                          <span
                            style={{
                              fontWeight:
                                800,

                              color:
                                item.active ===
                                false
                                  ? "#991b1b"
                                  : "#166534",
                            }}
                          >
                            {item.active ===
                            false
                              ? "Inactive"
                              : "Active"}
                          </span>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div
        style={{
          marginTop:
            12,

          padding:
            10,

          borderRadius:
            10,

          background:
            "#eff6ff",

          color:
            "#1e40af",

          fontSize:
            "0.78rem",

          lineHeight:
            1.5,
        }}
      >
        <strong>
          Status logic:
        </strong>{" "}
        Accepted means the employee accepted the current Privacy Notice version. Pending means no acknowledgement is stored. Old Version means the employee previously accepted a different version and will be required to acknowledge the current notice on the next login.
      </div>
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

const labelStyle = {
  display:
    "block",

  marginBottom:
    5,

  color:
    "#334155",

  fontSize:
    "0.78rem",

  fontWeight:
    800,
};

const inputStyle = {
  minHeight:
    42,

  padding:
    "8px 10px",

  borderRadius:
    10,

  border:
    "1px solid #cbd5e1",

  background:
    "white",

  boxSizing:
    "border-box",
};

const th = {
  textAlign:
    "left",

  padding:
    "10px 9px",

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
    "10px 9px",

  borderBottom:
    "1px solid #f1f5f9",

  color:
    "#334155",

  fontSize:
    "0.82rem",

  verticalAlign:
    "middle",
};

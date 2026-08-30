// src/pages/LoginPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebase";

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

const OPERATIONAL_POSITIONS = [
  {
    value: "COUNTER_SCAN",
    label: "Counter Scan",
    description: "Ticket counter bag tag scanning",
  },
  {
    value: "GATE_CONTROLLER",
    label: "Gate Controller",
    description: "Gate baggage control and coordination",
  },
  {
    value: "BAGROOM_SCAN",
    label: "Bagroom Scan",
    description: "Bagroom receiving and cart scanning",
  },
  {
    value: "AIRCRAFT_RAMP",
    label: "Aircraft / Ramp",
    description: "Aircraft loading and ramp scanning",
  },
  {
    value: "SUPERVISOR",
    label: "Supervisor",
    description: "Operational supervision for the shift",
  },
];

function normalizeOperationalPosition(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getOperationalPositionLabel(value) {
  const normalized =
    normalizeOperationalPosition(value);

  return (
    OPERATIONAL_POSITIONS.find(
      (item) => item.value === normalized
    )?.label ||
    normalized ||
    "-"
  );
}

function getLegacyOperationalPositions(role) {
  const normalizedRole =
    normalizeRole(role);

  if (normalizedRole === "gate_controller") {
    return ["GATE_CONTROLLER"];
  }

  if (
    normalizedRole === "station_manager" ||
    normalizedRole === "duty_manager" ||
    normalizedRole === "supervisor"
  ) {
    return ["SUPERVISOR"];
  }

  return ["COUNTER_SCAN"];
}

function getAllowedOperationalPositions(userData) {
  const configured =
    Array.isArray(
      userData?.allowedOperationalPositions
    )
      ? userData.allowedOperationalPositions
          .map(normalizeOperationalPosition)
          .filter(Boolean)
      : [];

  const validValues =
    new Set(
      OPERATIONAL_POSITIONS.map(
        (item) => item.value
      )
    );

  const uniqueConfigured = [
    ...new Set(
      configured.filter((value) =>
        validValues.has(value)
      )
    ),
  ];

  if (uniqueConfigured.length > 0) {
    return uniqueConfigured;
  }

  return getLegacyOperationalPositions(
    userData?.role
  );
}

export default function LoginPage({
  onLogin,
}) {
  const [username, setUsername] =
    useState("");

  const [pin, setPin] =
    useState("");

  const [error, setError] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [
    isCompact,
    setIsCompact,
  ] = useState(
    typeof window !== "undefined"
      ? window.innerWidth < 760
      : false
  );

  /*
   * STEP 2 state.
   * Credentials are validated first.
   * Then the employee selects the job
   * they are performing for this login.
   */
  const [
    verifiedUser,
    setVerifiedUser,
  ] = useState(null);

  const [
    selectedOperationalPosition,
    setSelectedOperationalPosition,
  ] = useState("");

  useEffect(() => {
    const handleResize = () => {
      setIsCompact(
        window.innerWidth < 760
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

  const allowedOperationalPositions =
    useMemo(() => {
      if (!verifiedUser) {
        return [];
      }

      return getAllowedOperationalPositions(
        verifiedUser
      );
    }, [verifiedUser]);

  const operationalPositionCards =
    useMemo(() => {
      return allowedOperationalPositions
        .map((value) => {
          return OPERATIONAL_POSITIONS.find(
            (item) =>
              item.value === value
          );
        })
        .filter(Boolean);
    }, [allowedOperationalPositions]);

  const handleCredentials = async () => {
    if (loading) return;

    setError("");

    const cleanUsername =
      username.trim().toLowerCase();

    const cleanPin =
      pin.trim();

    if (!cleanUsername || !cleanPin) {
      setError(
        "Please enter your username and PIN."
      );

      return;
    }

    try {
      setLoading(true);

      const qUser = query(
        collection(db, "users"),

        where(
          "username",
          "==",
          cleanUsername
        ),

        where(
          "pin",
          "==",
          cleanPin
        )
      );

      const snap =
        await getDocs(qUser);

      if (snap.empty) {
        setError(
          "Username or PIN is incorrect."
        );

        return;
      }

      const userData = {
        id: snap.docs[0].id,
        ...snap.docs[0].data(),
      };

      if (userData.active === false) {
        setError(
          "This employee account is inactive. Contact a Station Manager."
        );

        return;
      }

      const allowed =
        getAllowedOperationalPositions(
          userData
        );

      if (allowed.length === 0) {
        setError(
          "No operational position is assigned to this employee."
        );

        return;
      }

      const configuredDefault =
        normalizeOperationalPosition(
          userData.defaultOperationalPosition
        );

      const nextDefault =
        allowed.includes(
          configuredDefault
        )
          ? configuredDefault
          : allowed[0];

      setVerifiedUser(userData);

      setSelectedOperationalPosition(
        nextDefault
      );

      setError("");
    } catch (err) {
      console.error(
        "BLCS login error:",
        err
      );

      setError(
        "Unable to login. Check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const completeLogin = () => {
    if (!verifiedUser) {
      setError(
        "Please verify your credentials first."
      );

      return;
    }

    const operationalPosition =
      normalizeOperationalPosition(
        selectedOperationalPosition
      );

    if (
      !allowedOperationalPositions.includes(
        operationalPosition
      )
    ) {
      setError(
        "Please select an authorized operational position."
      );

      return;
    }

    const operationalPositionLabel =
      getOperationalPositionLabel(
        operationalPosition
      );

    /*
     * Gate Controller on duty should reflect
     * the actual operational position selected
     * for this login - not only the employee's
     * permanent System Role.
     */
    const gateControllerUsername =
      operationalPosition ===
      "GATE_CONTROLLER"
        ? verifiedUser.username
        : localStorage.getItem(
            "gateControllerOnDuty"
          ) || null;

    onLogin(verifiedUser, {
      gateControllerUsername,

      operationalPosition,

      operationalPositionLabel,

      employeeFullName:
        verifiedUser.fullName ||
        verifiedUser.username ||
        "",

      basePosition:
        verifiedUser.position ||
        "",

      systemRole:
        verifiedUser.role ||
        null,

      loginAt:
        new Date().toISOString(),
    });
  };

  const handleKeyDown = (e) => {
    if (e.key !== "Enter") {
      return;
    }

    e.preventDefault();

    if (verifiedUser) {
      completeLogin();
    } else {
      handleCredentials();
    }
  };

  const goBackToCredentials = () => {
    setVerifiedUser(null);

    setSelectedOperationalPosition(
      ""
    );

    setError("");

    setPin("");

    window.setTimeout(() => {
      document
        .getElementById(
          "blcs-pin"
        )
        ?.focus();
    }, 150);
  };

  const displayName =
    verifiedUser?.fullName ||
    verifiedUser?.username ||
    "Employee";

  return (
    <div
      style={{
        minHeight: "100dvh",

        background:
          "linear-gradient(135deg, #020617 0%, #0f172a 50%, #172554 100%)",

        display: "flex",

        alignItems: "center",

        justifyContent: "center",

        padding:
          isCompact
            ? 14
            : 28,

        boxSizing: "border-box",

        fontFamily:
          "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 980,

          minHeight:
            isCompact
              ? "auto"
              : 560,

          display: "grid",

          gridTemplateColumns:
            isCompact
              ? "1fr"
              : "1.05fr 0.95fr",

          background: "#ffffff",

          borderRadius:
            isCompact
              ? 20
              : 28,

          overflow: "hidden",

          boxShadow:
            "0 30px 80px rgba(0,0,0,0.38)",

          border:
            "1px solid rgba(255,255,255,0.15)",
        }}
      >
        {/* BRAND PANEL */}

        <div
          style={{
            position: "relative",

            minHeight:
              isCompact
                ? 175
                : "100%",

            padding:
              isCompact
                ? "22px 20px"
                : "42px",

            boxSizing: "border-box",

            background:
              "linear-gradient(145deg, #172554 0%, #1d4ed8 55%, #2563eb 100%)",

            color: "white",

            display: "flex",

            flexDirection: "column",

            justifyContent:
              "space-between",

            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",

              width: 280,
              height: 280,

              borderRadius: "50%",

              background:
                "rgba(255,255,255,0.07)",

              right: -90,
              top: -110,
            }}
          />

          <div
            style={{
              position: "absolute",

              width: 180,
              height: 180,

              borderRadius: "50%",

              background:
                "rgba(255,255,255,0.05)",

              left: -80,
              bottom: -90,
            }}
          />

          <div
            style={{
              position: "relative",
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: "inline-flex",

                alignItems: "center",

                gap: 8,

                padding: "6px 10px",

                background:
                  "rgba(255,255,255,0.12)",

                border:
                  "1px solid rgba(255,255,255,0.18)",

                borderRadius: 999,

                fontSize: "0.72rem",

                fontWeight: 800,

                letterSpacing: "0.08em",
              }}
            >
              TPA - BAGGAGE OPERATIONS
            </div>

            <h1
              style={{
                margin:
                  isCompact
                    ? "14px 0 3px"
                    : "26px 0 6px",

                fontSize:
                  isCompact
                    ? "2rem"
                    : "3rem",

                lineHeight: 1,

                letterSpacing:
                  "-0.04em",
              }}
            >
              BLCS
            </h1>

            <div
              style={{
                fontSize:
                  isCompact
                    ? "0.9rem"
                    : "1.05rem",

                color: "#dbeafe",

                fontWeight: 600,
              }}
            >
              Baggage Loading Control System
            </div>
          </div>

          {!isCompact && (
            <div
              style={{
                position: "relative",
                zIndex: 1,

                display: "flex",

                justifyContent:
                  "center",

                alignItems:
                  "center",

                padding:
                  "20px 0",
              }}
            >
              <div
                style={{
                  width: 210,
                  height: 210,

                  borderRadius:
                    "50%",

                  background:
                    "rgba(255,255,255,0.10)",

                  border:
                    "1px solid rgba(255,255,255,0.16)",

                  display:
                    "flex",

                  alignItems:
                    "center",

                  justifyContent:
                    "center",

                  boxShadow:
                    "inset 0 0 40px rgba(255,255,255,0.05)",
                }}
              >
                {/*
                  ASCII-safe baggage symbol.
                  The escape is interpreted by JavaScript.
                */}
                <span
                  role="img"
                  aria-label="Baggage"
                  style={{
                    fontSize: 110,

                    filter:
                      "drop-shadow(0 14px 15px rgba(0,0,0,0.22))",
                  }}
                >
                  {"\uD83E\uDDF3"}
                </span>
              </div>
            </div>
          )}

          <div
            style={{
              position: "relative",
              zIndex: 1,

              display:
                isCompact
                  ? "none"
                  : "block",

              fontSize:
                "0.78rem",

              color:
                "#bfdbfe",

              lineHeight:
                1.6,
            }}
          >
            Counter - Bagroom - Gate - Aircraft
            <br />
            Real-time baggage tracking
          </div>
        </div>

        {/* LOGIN / POSITION PANEL */}

        <div
          style={{
            padding:
              isCompact
                ? "26px 20px 22px"
                : "52px 50px",

            boxSizing: "border-box",

            display: "flex",

            flexDirection: "column",

            justifyContent: "center",

            background: "#ffffff",
          }}
        >
          {!verifiedUser ? (
            <>
              <div
                style={{
                  marginBottom: 26,
                }}
              >
                <div
                  style={{
                    color: "#2563eb",

                    fontSize:
                      "0.75rem",

                    fontWeight:
                      900,

                    letterSpacing:
                      "0.08em",

                    textTransform:
                      "uppercase",

                    marginBottom:
                      7,
                  }}
                >
                  Secure Access
                </div>

                <h2
                  style={{
                    margin: 0,

                    color:
                      "#0f172a",

                    fontSize:
                      isCompact
                        ? "1.55rem"
                        : "1.8rem",

                    letterSpacing:
                      "-0.02em",
                  }}
                >
                  Welcome back
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
                  Sign in to access baggage operations.
                </p>
              </div>

              <div
                style={{
                  marginBottom: 18,
                }}
              >
                <label
                  htmlFor="blcs-username"
                  style={{
                    display: "block",

                    marginBottom:
                      7,

                    color:
                      "#334155",

                    fontSize:
                      "0.82rem",

                    fontWeight:
                      800,
                  }}
                >
                  Username
                </label>

                <input
                  id="blcs-username"

                  type="text"

                  value={
                    username
                  }

                  autoComplete="username"

                  autoCapitalize="none"

                  spellCheck={false}

                  disabled={
                    loading
                  }

                  onChange={(e) =>
                    setUsername(
                      e.target.value
                    )
                  }

                  onKeyDown={
                    handleKeyDown
                  }

                  placeholder="Enter username"

                  style={{
                    width: "100%",

                    height:
                      isCompact
                        ? 54
                        : 50,

                    padding:
                      "0 15px",

                    boxSizing:
                      "border-box",

                    borderRadius:
                      12,

                    border:
                      "1px solid #cbd5e1",

                    background:
                      loading
                        ? "#f1f5f9"
                        : "#f8fafc",

                    color:
                      "#0f172a",

                    fontSize:
                      isCompact
                        ? "1rem"
                        : "0.95rem",

                    outline:
                      "none",
                  }}
                />
              </div>

              <div
                style={{
                  marginBottom: 18,
                }}
              >
                <label
                  htmlFor="blcs-pin"
                  style={{
                    display: "block",

                    marginBottom:
                      7,

                    color:
                      "#334155",

                    fontSize:
                      "0.82rem",

                    fontWeight:
                      800,
                  }}
                >
                  PIN
                </label>

                <input
                  id="blcs-pin"

                  type="password"

                  value={
                    pin
                  }

                  inputMode="numeric"

                  autoComplete="current-password"

                  disabled={
                    loading
                  }

                  onChange={(e) =>
                    setPin(
                      e.target.value
                    )
                  }

                  onKeyDown={
                    handleKeyDown
                  }

                  placeholder="Enter PIN"

                  style={{
                    width:
                      "100%",

                    height:
                      isCompact
                        ? 58
                        : 50,

                    padding:
                      "0 15px",

                    boxSizing:
                      "border-box",

                    borderRadius:
                      12,

                    border:
                      "1px solid #cbd5e1",

                    background:
                      loading
                        ? "#f1f5f9"
                        : "#f8fafc",

                    color:
                      "#0f172a",

                    fontSize:
                      isCompact
                        ? "1.15rem"
                        : "1rem",

                    letterSpacing:
                      "0.12em",

                    outline:
                      "none",
                  }}
                />
              </div>

              {error && (
                <ErrorBox>
                  {error}
                </ErrorBox>
              )}

              <button
                type="button"

                onClick={
                  handleCredentials
                }

                disabled={
                  loading
                }

                style={{
                  width: "100%",

                  minHeight:
                    isCompact
                      ? 58
                      : 52,

                  borderRadius:
                    12,

                  border:
                    "none",

                  background:
                    loading
                      ? "#94a3b8"
                      : "#2563eb",

                  color:
                    "white",

                  fontSize:
                    isCompact
                      ? "1rem"
                      : "0.95rem",

                  fontWeight:
                    900,

                  cursor:
                    loading
                      ? "wait"
                      : "pointer",

                  boxShadow:
                    loading
                      ? "none"
                      : "0 8px 20px rgba(37,99,235,0.24)",
                }}
              >
                {loading
                  ? "Checking..."
                  : "Continue"}
              </button>

              <div
                style={{
                  marginTop:
                    18,

                  padding:
                    "10px 12px",

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

                  textAlign:
                    "center",
                }}
              >
                Use your assigned{" "}
                <strong>
                  username
                </strong>{" "}
                and{" "}
                <strong>
                  PIN
                </strong>
                .
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  marginBottom:
                    18,
                }}
              >
                <div
                  style={{
                    color:
                      "#2563eb",

                    fontSize:
                      "0.75rem",

                    fontWeight:
                      900,

                    letterSpacing:
                      "0.08em",

                    textTransform:
                      "uppercase",

                    marginBottom:
                      7,
                  }}
                >
                  Shift Assignment
                </div>

                <h2
                  style={{
                    margin: 0,

                    color:
                      "#0f172a",

                    fontSize:
                      isCompact
                        ? "1.45rem"
                        : "1.75rem",

                    letterSpacing:
                      "-0.02em",
                  }}
                >
                  Welcome, {displayName}
                </h2>

                <p
                  style={{
                    margin:
                      "7px 0 0",

                    color:
                      "#64748b",

                    fontSize:
                      "0.86rem",

                    lineHeight:
                      1.5,
                  }}
                >
                  Select the position you are working for this login.
                  This position will be recorded with your operational activity.
                </p>
              </div>

              <div
                style={{
                  display:
                    "grid",

                  gridTemplateColumns:
                    isCompact
                      ? "1fr"
                      : "repeat(2, minmax(0, 1fr))",

                  gap:
                    9,

                  marginBottom:
                    16,
                }}
              >
                {operationalPositionCards.map(
                  (position) => {
                    const active =
                      selectedOperationalPosition ===
                      position.value;

                    return (
                      <button
                        key={
                          position.value
                        }

                        type="button"

                        onClick={() => {
                          setSelectedOperationalPosition(
                            position.value
                          );

                          setError("");
                        }}

                        style={{
                          minHeight:
                            isCompact
                              ? 68
                              : 76,

                          padding:
                            "10px 12px",

                          borderRadius:
                            12,

                          border:
                            active
                              ? "2px solid #2563eb"
                              : "1px solid #cbd5e1",

                          background:
                            active
                              ? "#eff6ff"
                              : "#ffffff",

                          color:
                            active
                              ? "#1d4ed8"
                              : "#334155",

                          textAlign:
                            "left",

                          cursor:
                            "pointer",

                          boxShadow:
                            active
                              ? "0 6px 16px rgba(37,99,235,0.10)"
                              : "none",
                        }}
                      >
                        <div
                          style={{
                            fontSize:
                              "0.9rem",

                            fontWeight:
                              900,
                          }}
                        >
                          {position.label}
                        </div>

                        <div
                          style={{
                            marginTop:
                              4,

                            color:
                              active
                                ? "#1e40af"
                                : "#64748b",

                            fontSize:
                              "0.72rem",

                            lineHeight:
                              1.35,

                            fontWeight:
                              600,
                          }}
                        >
                          {position.description}
                        </div>
                      </button>
                    );
                  }
                )}
              </div>

              <div
                style={{
                  padding:
                    "10px 12px",

                  borderRadius:
                    10,

                  background:
                    "#f8fafc",

                  border:
                    "1px solid #e2e8f0",

                  color:
                    "#475569",

                  fontSize:
                    "0.75rem",

                  lineHeight:
                    1.45,

                  marginBottom:
                    14,
                }}
              >
                <strong>
                  System Role:
                </strong>{" "}
                {String(
                  verifiedUser.role ||
                  "-"
                ).replaceAll(
                  "_",
                  " "
                )}
                <br />

                <strong>
                  Base Position:
                </strong>{" "}
                {verifiedUser.position ||
                  "-"}
              </div>

              {error && (
                <ErrorBox>
                  {error}
                </ErrorBox>
              )}

              <button
                type="button"

                onClick={
                  completeLogin
                }

                disabled={
                  !selectedOperationalPosition
                }

                style={{
                  width:
                    "100%",

                  minHeight:
                    isCompact
                      ? 58
                      : 52,

                  borderRadius:
                    12,

                  border:
                    "none",

                  background:
                    selectedOperationalPosition
                      ? "#16a34a"
                      : "#94a3b8",

                  color:
                    "white",

                  fontSize:
                    isCompact
                      ? "1rem"
                      : "0.95rem",

                  fontWeight:
                    900,

                  cursor:
                    selectedOperationalPosition
                      ? "pointer"
                      : "not-allowed",

                  boxShadow:
                    selectedOperationalPosition
                      ? "0 8px 20px rgba(22,163,74,0.22)"
                      : "none",
                }}
              >
                Start Shift as{" "}
                {selectedOperationalPosition
                  ? getOperationalPositionLabel(
                      selectedOperationalPosition
                    )
                  : "Selected Position"}
              </button>

              <button
                type="button"

                onClick={
                  goBackToCredentials
                }

                style={{
                  width:
                    "100%",

                  minHeight:
                    42,

                  marginTop:
                    8,

                  borderRadius:
                    10,

                  border:
                    "1px solid #cbd5e1",

                  background:
                    "white",

                  color:
                    "#475569",

                  fontWeight:
                    800,

                  cursor:
                    "pointer",
                }}
              >
                Back
              </button>
            </>
          )}

          <div
            style={{
              marginTop:
                22,

              textAlign:
                "center",

              color:
                "#94a3b8",

              fontSize:
                "0.66rem",

              lineHeight:
                1.5,
            }}
          >
            Authorized operational use only.
            <br />
            System managed by{" "}
            <strong>
              ANapoles Solutions
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorBox({
  children,
}) {
  return (
    <div
      role="alert"

      style={{
        marginBottom:
          16,

        padding:
          "11px 12px",

        borderRadius:
          10,

        background:
          "#fef2f2",

        border:
          "1px solid #fecaca",

        color:
          "#b91c1c",

        fontSize:
          "0.82rem",

        fontWeight:
          700,

        lineHeight:
          1.4,
      }}
    >
      {children}
    </div>
  );
}

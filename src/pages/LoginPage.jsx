// src/pages/LoginPage.jsx
import React, { useMemo, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function needsGateCheckIn(role) {
  // Supervisor, Duty Manager, Station Manager deben seleccionar GC on duty
  return role === "supervisor" || role === "duty_manager" || role === "station_manager";
}

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Modal check-in
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [loggedUser, setLoggedUser] = useState(null);
  const [gateControllers, setGateControllers] = useState([]);
  const [selectedGC, setSelectedGC] = useState("");
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInError, setCheckInError] = useState("");

  const canProceedCheckIn = useMemo(() => selectedGC.trim().length > 0, [selectedGC]);

  const fetchGateControllers = async () => {
    // Traemos los users con role gate_controller
    const qGC = query(collection(db, "users"), where("role", "==", "gate_controller"));
    const snap = await getDocs(qGC);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u.username);
  };

  const handleLogin = async () => {
    setError("");
    setCheckInError("");

    const cleanUsername = username.trim();
    const cleanPin = pin.trim();

    if (!cleanUsername || !cleanPin) {
      setError("Please enter username and PIN.");
      return;
    }

    try {
      setLoading(true);

      const qUser = query(
        collection(db, "users"),
        where("username", "==", cleanUsername),
        where("pin", "==", cleanPin)
      );

      const snap = await getDocs(qUser);

      if (snap.empty) {
        setError("Invalid credentials.");
        setLoading(false);
        return;
      }

      const userData = { id: snap.docs[0].id, ...snap.docs[0].data() };
      const role = normalizeRole(userData.role);

      // Si el que entra es Gate Controller, no preguntamos nada:
      if (role === "gate_controller") {
        onLogin(userData, { gateControllerUsername: userData.username });
        setLoading(false);
        return;
      }

      // Para supervisor/duty/station_manager: Quick Check-in
      if (needsGateCheckIn(role)) {
        setLoggedUser(userData);
        setShowCheckIn(true);
        setCheckInLoading(true);

        const list = await fetchGateControllers();
        setGateControllers(list);

        // Si solo existe 1 GC, lo selecciona por defecto
        if (list.length === 1) setSelectedGC(list[0].username);

        setCheckInLoading(false);
        setLoading(false);
        return;
      }

      // Otros roles (si existieran) entran sin check-in
      onLogin(userData, { gateControllerUsername: null });
      setLoading(false);
    } catch (err) {
      console.error(err);
      setError("Login error. Try again.");
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleLogin();
  };

  const confirmCheckIn = async () => {
    setCheckInError("");

    if (!loggedUser) {
      setCheckInError("Session error. Please login again.");
      return;
    }

    const picked = selectedGC.trim();
    if (!picked) {
      setCheckInError("Please select a Gate Controller on duty.");
      return;
    }

    // Confirmación final:
    onLogin(loggedUser, { gateControllerUsername: picked });
  };

  const cancelCheckIn = () => {
    // Vuelve al login limpio
    setShowCheckIn(false);
    setLoggedUser(null);
    setGateControllers([]);
    setSelectedGC("");
    setCheckInError("");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
      }}
    >
      <div
        style={{
          background: "rgba(15,23,42,0.92)",
          padding: "24px",
          borderRadius: "16px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
          width: "100%",
          maxWidth: "360px",
          color: "white",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: "4px", textAlign: "center", fontSize: "1.6rem" }}>
          BLCS System
        </h1>
        <p style={{ textAlign: "center", marginTop: 0, marginBottom: "16px", fontSize: "0.85rem", color: "#cbd5f5" }}>
          Baggage Loading Control · TPA
        </p>

        {/* Username */}
        <div style={{ marginBottom: "12px" }}>
          <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9rem" }}>User</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your username"
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "6px",
              border: "1px solid #4b5563",
              background: "#020617",
              color: "white",
            }}
          />
        </div>

        {/* PIN */}
        <div style={{ marginBottom: "12px" }}>
          <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9rem" }}>PIN</label>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your PIN"
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "6px",
              border: "1px solid #4b5563",
              background: "#020617",
              color: "white",
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <p style={{ color: "#fecaca", fontSize: "0.75rem", textAlign: "center", marginTop: "0.25rem", marginBottom: "0.5rem" }}>
            {error}
          </p>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: "100%",
            padding: "8px 0",
            borderRadius: "999px",
            border: "none",
            background: loading ? "#1f2937" : "#2563eb",
            color: "white",
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
            marginTop: "4px",
            marginBottom: "8px",
          }}
        >
          {loading ? "Checking..." : "Login"}
        </button>

        <p style={{ fontSize: "0.7rem", textAlign: "center", color: "#9ca3af", marginTop: "4px" }}>
          Use the same <strong>username</strong> and <strong>PIN</strong> as in TPA Schedule System.
        </p>
      </div>

      {/* Quick Check-in Modal */}
      {showCheckIn && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: "white",
              borderRadius: 16,
              padding: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Quick Check-in</h3>
                <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
                  Select the Gate Controller working with Ramp for this shift.
                </p>
              </div>
              <button
                onClick={cancelCheckIn}
                style={{
                  border: "1px solid #e5e7eb",
                  background: "white",
                  borderRadius: 10,
                  width: 36,
                  height: 36,
                  cursor: "pointer",
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ marginBottom: 10, fontSize: "0.9rem" }}>
                Logged in as: <strong>{loggedUser?.username}</strong> ({loggedUser?.role})
              </div>

              <label style={{ display: "block", fontSize: "0.85rem", color: "#374151", marginBottom: 6 }}>
                Gate Controller on duty
              </label>

              {checkInLoading ? (
                <p style={{ color: "#6b7280" }}>Loading Gate Controllers...</p>
              ) : gateControllers.length === 0 ? (
                <p style={{ color: "#b91c1c" }}>
                  No users with role <strong>gate_controller</strong> found in Firestore.
                  Create at least 1 Gate Controller user first.
                </p>
              ) : (
                <select
                  value={selectedGC}
                  onChange={(e) => setSelectedGC(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #d1d5db",
                    background: "white",
                  }}
                >
                  <option value="">Select Gate Controller…</option>
                  {gateControllers.map((gc) => (
                    <option key={gc.id} value={gc.username}>
                      {gc.username}
                    </option>
                  ))}
                </select>
              )}

              {checkInError && (
                <p style={{ color: "#b91c1c", marginTop: 10, marginBottom: 0, fontSize: "0.9rem" }}>
                  {checkInError}
                </p>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                <button
                  onClick={cancelCheckIn}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 12,
                    border: "1px solid #d1d5db",
                    background: "white",
                    cursor: "pointer",
                  }}
                >
                  Back
                </button>
                <button
                  onClick={confirmCheckIn}
                  disabled={!canProceedCheckIn || gateControllers.length === 0}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 12,
                    border: "1px solid #1d4ed8",
                    background: !canProceedCheckIn ? "#93c5fd" : "#2563eb",
                    color: "white",
                    fontWeight: 600,
                    cursor: !canProceedCheckIn ? "not-allowed" : "pointer",
                  }}
                >
                  Continue
                </button>
              </div>

              <p style={{ marginTop: 12, fontSize: "0.8rem", color: "#6b7280" }}>
                This selection is saved only for this session.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

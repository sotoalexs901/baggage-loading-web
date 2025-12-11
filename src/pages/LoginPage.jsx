// src/pages/LoginPage.jsx
import React, { useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";

// Este Login NO usa Firebase Auth.
// Usa la colección "users" en Firestore con campos: username, pin, etc.
export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");

    const cleanUsername = username.trim();
    const cleanPin = pin.trim();

    if (!cleanUsername || !cleanPin) {
      setError("Please enter username and PIN.");
      return;
    }

    try {
      setLoading(true);

      const q = query(
        collection(db, "users"),
        where("username", "==", cleanUsername),
        where("pin", "==", cleanPin)
      );

      const snap = await getDocs(q);

      if (snap.empty) {
        setError("Invalid credentials.");
        setLoading(false);
        return;
      }

      const userData = { id: snap.docs[0].id, ...snap.docs[0].data() };

      // Aquí ya tenemos el mismo tipo de usuario que en TPA Schedule.
      // En lugar de navigate/context, usamos la prop onLogin:
      onLogin(userData);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setError("Login error. Try again.");
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleLogin();
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
        backgroundImage: "radial-gradient(circle at top, #1d4ed8 0, #0f172a 60%)",
      }}
    >
      <div
        style={{
          background: "rgba(15,23,42,0.9)",
          padding: "24px",
          borderRadius: "16px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
          width: "100%",
          maxWidth: "360px",
          color: "white",
        }}
      >
        <h1
          style={{
            marginTop: 0,
            marginBottom: "4px",
            textAlign: "center",
            fontSize: "1.6rem",
          }}
        >
          BLCS System
        </h1>
        <p
          style={{
            textAlign: "center",
            marginTop: 0,
            marginBottom: "16px",
            fontSize: "0.85rem",
            color: "#cbd5f5",
          }}
        >
          Baggage Loading Control · TPA
        </p>

        {/* Username */}
        <div style={{ marginBottom: "12px" }}>
          <label
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "0.9rem",
            }}
          >
            User
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g.Enter your username"
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
          <label
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "0.9rem",
            }}
          >
            PIN
          </label>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Enter your PIN"
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
          <p
            style={{
              color: "#fecaca",
              fontSize: "0.75rem",
              textAlign: "center",
              marginTop: "0.25rem",
              marginBottom: "0.5rem",
            }}
          >
            {error}
          </p>
        )}

        {/* Button */}
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

        <p
          style={{
            fontSize: "0.7rem",
            textAlign: "center",
            color: "#9ca3af",
            marginTop: "4px",
          }}
        >
          Use the same <strong>username</strong> and <strong>PIN</strong> as in
          TPA Schedule System.
        </p>
      </div>
    </div>
  );
}

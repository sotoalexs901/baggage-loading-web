import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";

// Dominio interno para construir el email a partir del PIN.
// Debe coincidir con el que usaste al crear los usuarios en Firebase Auth.
const PIN_LOGIN_DOMAIN = blcsystem.com

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);

    try {
      const trimmedPin = pin.trim();
      if (!trimmedPin) {
        throw new Error("PIN requerido");
      }

      const email = `${trimmedPin}@${PIN_LOGIN_DOMAIN}`;
      const password = trimmedPin; // o una contraseña fija si así lo decides

      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged en App.jsx se encargará del resto
    } catch (err) {
      console.error(err);
      let niceMessage = "Error al iniciar sesión con PIN.";
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        niceMessage = "PIN incorrecto.";
      } else if (err.code === "auth/user-not-found") {
        niceMessage = "No existe un usuario con ese PIN.";
      }
      setErrorMsg(niceMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
      }}
    >
      <div
        style={{
          background: "white",
          padding: "24px",
          borderRadius: "8px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
          width: "100%",
          maxWidth: "320px",
        }}
      >
        <h2
          style={{
            marginTop: 0,
            marginBottom: "16px",
            textAlign: "center",
          }}
        >
          BLCS – Login
        </h2>
        <p
          style={{
            fontSize: "0.9rem",
            textAlign: "center",
            marginBottom: "16px",
          }}
        >
          Ingresa tu <strong>PIN</strong> (mismo que en TPA Schedule).
        </p>

        <form onSubmit={handleSubmit}>
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
              // type password para que no se vea el PIN
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #d1d5db",
                fontSize: "1rem",
              }}
            />
          </div>

          {errorMsg && (
            <p style={{ color: "red", fontSize: "0.85rem", marginBottom: "8px" }}>
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "8px 0",
              borderRadius: "4px",
              border: "none",
              background: "#2563eb",
              color: "white",
              fontWeight: "600",
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Ingresando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

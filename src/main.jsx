// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/* =========================
   BLCS SERVICE WORKER
========================= */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => {
        console.log(
          "BLCS Service Worker registered:",
          registration.scope
        );
      })
      .catch((error) => {
        console.error(
          "BLCS Service Worker registration failed:",
          error
        );
      });
  });
}

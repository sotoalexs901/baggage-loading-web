// src/pages/BaggageTrackingPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../firebase";

function cleanTag(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function formatDateTime(ts) {
  if (!ts) return "-";

  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "-";
  }
}

function getEventTitle(type) {
  const t = String(type || "").toUpperCase();

  if (t === "COUNTER_SCAN") return "Counter Scan";
  if (t === "BAGROOM_SCAN") return "Bagroom Received";
  if (t === "AIRCRAFT_LOAD") return "Loaded on Aircraft";
  if (t === "OFFLOAD_BAG") return "Offloaded";
  if (t === "RELOAD_BAG") return "Reloaded";
  return t || "Tracking Event";
}

function getEventIcon(type) {
  const t = String(type || "").toUpperCase();

  if (t === "COUNTER_SCAN") return "🟢";
  if (t === "BAGROOM_SCAN") return "🟡";
  if (t === "AIRCRAFT_LOAD") return "🔵";
  if (t === "OFFLOAD_BAG") return "🔴";
  if (t === "RELOAD_BAG") return "🟣";
  return "⚪";
}

function getEventBorder(type) {
  const t = String(type || "").toUpperCase();

  if (t === "COUNTER_SCAN") return "#22c55e";
  if (t === "BAGROOM_SCAN") return "#f59e0b";
  if (t === "AIRCRAFT_LOAD") return "#2563eb";
  if (t === "OFFLOAD_BAG") return "#dc2626";
  if (t === "RELOAD_BAG") return "#7c3aed";
  return "#9ca3af";
}

function getLastStatusText(tagDoc) {
  const loc = String(tagDoc?.lastSeenLocation || "").toLowerCase();

  if (loc === "counter") return "At Counter";
  if (loc === "bagroom") return `In Bagroom${tagDoc?.lastSeenCart ? ` · Cart ${tagDoc.lastSeenCart}` : ""}`;
  if (loc === "aircraft") return `Loaded on Aircraft${tagDoc?.lastSeenZone ? ` · Zone ${tagDoc.lastSeenZone}` : ""}`;
  if (loc === "offloaded") return "Offloaded";
  return "Unknown";
}

export default function BaggageTrackingPage({ user }) {
  const [tagInput, setTagInput] = useState("");
  const [searchedTag, setSearchedTag] = useState("");

  const [tagDoc, setTagDoc] = useState(null);
  const [events, setEvents] = useState([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const ta = a.createdAt?.seconds || 0;
      const tb = b.createdAt?.seconds || 0;
      return ta - tb;
    });
  }, [events]);
  const handleSearch = async (forcedTag) => {
    setErr("");
    setTagDoc(null);
    setEvents([]);

    const tag = cleanTag(forcedTag ?? tagInput);

    if (!tag) {
      setErr("Enter a bag tag number.");
      return;
    }

    try {
      setLoading(true);
      setSearchedTag(tag);

      const tagRef = doc(db, "bagTags", tag);
      const tagSnap = await getDoc(tagRef);

      if (!tagSnap.exists()) {
        setErr(`No tracking found for bag tag ${tag}.`);
        setLoading(false);
        return;
      }

      const mainData = {
        id: tagSnap.id,
        ...tagSnap.data(),
      };

      setTagDoc(mainData);

      const eventsRef = collection(db, "bagTags", tag, "events");
      const qRef = query(eventsRef, orderBy("createdAt", "asc"));
      const eventsSnap = await getDocs(qRef);

      const list = eventsSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setEvents(list);
      setLoading(false);
    } catch (e) {
      console.error("Baggage tracking search error:", e);
      setErr("Could not load tracking. Check Firestore rules/connection.");
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "end",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Baggage Tracking</h2>

          <p style={{ marginTop: 6, color: "#6b7280", fontSize: "0.9rem" }}>
            Track one bag from Counter → Bagroom → Aircraft → Offload/Reload.
          </p>
        </div>

        <div style={{ textAlign: "right", fontSize: "0.85rem", color: "#6b7280" }}>
          User: <strong>{user?.username || "-"}</strong>
        </div>
      </div>

      <hr
        style={{
          border: "none",
          borderTop: "1px solid #e5e7eb",
          margin: "14px 0",
        }}
      />

      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          background: "#f9fafb",
          marginBottom: 14,
        }}
      >
        <label
          style={{
            display: "block",
            fontSize: "0.85rem",
            color: "#374151",
            marginBottom: 6,
          }}
        >
          Bag Tag Number
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            ref={inputRef}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Scan or enter bag tag…"
            style={{
              flex: 1,
              minWidth: 240,
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "white",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: "0.95rem",
            }}
          />

          <button
            onClick={() => handleSearch()}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #2563eb",
              background: loading ? "#93c5fd" : "#2563eb",
              color: "white",
              fontWeight: 900,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Searching…" : "Track Bag"}
          </button>
        </div>

        {err && (
          <p
            style={{
              marginTop: 10,
              color: "#b91c1c",
              fontWeight: 800,
              whiteSpace: "pre-wrap",
            }}
          >
            {err}
          </p>
        )}
      </section>
            {tagDoc && (
        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Bag Summary</h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
            }}
          >
            <InfoCard label="Bag Tag" value={tagDoc.tag || searchedTag} />
            <InfoCard label="Flight" value={tagDoc.flightNumber || tagDoc.flightId || "-"} />
            <InfoCard label="Date" value={tagDoc.flightDate || "-"} />
            <InfoCard label="Gate" value={tagDoc.gate || "-"} />
            <InfoCard label="Last Status" value={getLastStatusText(tagDoc)} />
            <InfoCard label="Last Seen" value={formatDateTime(tagDoc.lastSeenAt)} />
          </div>
        </section>
      )}

      {tagDoc && (
        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Tracking Timeline</h3>

          {sortedEvents.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              No event timeline found for this bag yet.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {sortedEvents.map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    border: `1px solid ${getEventBorder(ev.type)}`,
                    borderLeft: `8px solid ${getEventBorder(ev.type)}`,
                    borderRadius: 12,
                    padding: 12,
                    background: "white",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      {getEventIcon(ev.type)} {getEventTitle(ev.type)}
                    </div>

                    <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                      {formatDateTime(ev.createdAt)}
                    </div>
                  </div>

                  <div style={{ marginTop: 8, color: "#374151", fontSize: "0.9rem" }}>
                    {ev.message || "-"}
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      fontSize: "0.82rem",
                    }}
                  >
                    {ev.tag && <Badge label={`Tag ${ev.tag}`} />}
                    {ev.cartNumber && <Badge label={`Cart ${ev.cartNumber}`} />}
                    {ev.zone && <Badge label={`Zone ${ev.zone}`} />}
                    {ev.flightNumber && <Badge label={`Flight ${ev.flightNumber}`} />}
                    {ev.flightDate && <Badge label={`Date ${ev.flightDate}`} />}
                    {ev.createdBy?.username && <Badge label={`By ${ev.createdBy.username}`} />}
                  </div>

                  {ev.reason && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 8,
                        borderRadius: 10,
                        background: "#fef2f2",
                        color: "#991b1b",
                        fontSize: "0.85rem",
                        fontWeight: 800,
                      }}
                    >
                      Reason: {ev.reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 10,
        background: "#f9fafb",
      }}
    >
      <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function Badge({ label }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: 999,
        background: "#f3f4f6",
        border: "1px solid #e5e7eb",
        color: "#374151",
        fontWeight: 800,
      }}
    >
      {label}
    </span>
  );
}

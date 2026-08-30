// src/pages/AdminUsersPage.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

const OPERATIONAL_POSITIONS = [
  { value: "COUNTER_SCAN", label: "Counter Scan" },
  { value: "GATE_CONTROLLER", label: "Gate Controller" },
  { value: "BAGROOM_SCAN", label: "Bagroom Scan" },
  { value: "AIRCRAFT_RAMP", label: "Aircraft / Ramp" },
  { value: "SUPERVISOR", label: "Supervisor" },
];

function normalizeOperationalPositions(value) {
  if (!Array.isArray(value)) return [];

  const allowed = new Set(OPERATIONAL_POSITIONS.map((item) => item.value));

  return value
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item) => allowed.has(item));
}

function getOperationalPositionLabel(value) {
  const normalized = String(value || "").trim().toUpperCase();

  return (
    OPERATIONAL_POSITIONS.find((item) => item.value === normalized)?.label ||
    normalized ||
    "-"
  );
}

export default function AdminUsersPage({ user }) {
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState(null);

  const [form, setForm] = useState({
    username: "",
    pin: "",
    role: "agent",
    fullName: "",
    position: "",
    active: true,
    allowedOperationalPositions: ["COUNTER_SCAN"],
    defaultOperationalPosition: "COUNTER_SCAN",
  });

  const currentRole = normalizeRole(user?.role);
  const isStationManager = currentRole === "station_manager";

  const selectedOperationalPositions = useMemo(
    () => normalizeOperationalPositions(form.allowedOperationalPositions),
    [form.allowedOperationalPositions]
  );

  useEffect(() => {
    if (!isStationManager) return;

    const q = query(collection(db, "users"), orderBy("username"));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));

        setUsers(data);
      },
      (error) => {
        console.error("Error loading users:", error);
        setMessage(`Error loading users: ${error.message}`);
      }
    );

    return () => unsub();
  }, [isStationManager]);

  if (!isStationManager) {
    return <p>You do not have permission to access this page.</p>;
  }

  const resetForm = () => {
    setEditingId(null);

    setForm({
      username: "",
      pin: "",
      role: "agent",
      fullName: "",
      position: "",
      active: true,
      allowedOperationalPositions: ["COUNTER_SCAN"],
      defaultOperationalPosition: "COUNTER_SCAN",
    });
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const toggleOperationalPosition = (positionValue) => {
    setForm((prev) => {
      const current = normalizeOperationalPositions(
        prev.allowedOperationalPositions
      );

      const exists = current.includes(positionValue);

      const next = exists
        ? current.filter((item) => item !== positionValue)
        : [...current, positionValue];

      let nextDefault = prev.defaultOperationalPosition;

      if (!next.includes(nextDefault)) {
        nextDefault = next[0] || "";
      }

      return {
        ...prev,
        allowedOperationalPositions: next,
        defaultOperationalPosition: nextDefault,
      };
    });
  };

  const handleSubmitUser = async (e) => {
    e.preventDefault();
    setMessage("");

    const username = form.username.trim().toLowerCase();
    const pin = form.pin.trim();
    const role = normalizeRole(form.role);

    const allowedOperationalPositions = normalizeOperationalPositions(
      form.allowedOperationalPositions
    );

    const defaultOperationalPosition = String(
      form.defaultOperationalPosition || ""
    )
      .trim()
      .toUpperCase();

    if (!username || !pin || !role) {
      setMessage("Username, PIN and role are required.");
      return;
    }

    if (allowedOperationalPositions.length === 0) {
      setMessage("Select at least one operational position.");
      return;
    }

    if (!allowedOperationalPositions.includes(defaultOperationalPosition)) {
      setMessage(
        "Default operational position must be one of the allowed positions."
      );
      return;
    }

    try {
      setSaving(true);

      const payload = {
        username,
        pin,
        role,

        // HR / base information
        fullName: form.fullName.trim(),
        position: form.position.trim(),

        // Operational assignment options shown at login
        allowedOperationalPositions,
        defaultOperationalPosition,

        active: Boolean(form.active),

        updatedAt: serverTimestamp(),
        updatedBy: user?.username || "admin",
      };

      if (editingId) {
        await updateDoc(doc(db, "users", editingId), payload);
        setMessage("User updated successfully.");
      } else {
        await addDoc(collection(db, "users"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: user?.username || "admin",
        });

        setMessage("User created successfully.");
      }

      resetForm();
    } catch (error) {
      console.error("Error saving user:", error);
      setMessage(`Error saving user: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEditUser = (item) => {
    setEditingId(item.id);
    setMessage("");

    const allowedOperationalPositions = normalizeOperationalPositions(
      item.allowedOperationalPositions
    );

    const fallbackPositions =
      allowedOperationalPositions.length > 0
        ? allowedOperationalPositions
        : ["COUNTER_SCAN"];

    const defaultOperationalPosition =
      item.defaultOperationalPosition &&
      fallbackPositions.includes(
        String(item.defaultOperationalPosition).trim().toUpperCase()
      )
        ? String(item.defaultOperationalPosition).trim().toUpperCase()
        : fallbackPositions[0];

    setForm({
      username: item.username || "",
      pin: item.pin || "",
      role: item.role || "agent",
      fullName: item.fullName || "",
      position: item.position || "",
      active: item.active === false ? false : true,
      allowedOperationalPositions: fallbackPositions,
      defaultOperationalPosition,
    });
  };

  const handleDeleteUser = async (item) => {
    const confirmed = window.confirm(`Delete user "${item.username}"?`);

    if (!confirmed) return;

    try {
      setMessage("");
      await deleteDoc(doc(db, "users", item.id));
      setMessage("User deleted successfully.");

      if (editingId === item.id) {
        resetForm();
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setMessage(`Error deleting user: ${error.message}`);
    }
  };

  return (
    <section
      style={{
        maxWidth: 1180,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "end",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Employee Administration</h2>

          <p
            style={{
              margin: "6px 0 0",
              color: "#6b7280",
              fontSize: "0.9rem",
            }}
          >
            Manage employee access and the operational positions they can select
            when logging in.
          </p>
        </div>

        <div
          style={{
            padding: "8px 12px",
            borderRadius: 12,
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            color: "#1d4ed8",
            fontWeight: 900,
          }}
        >
          {users.length} Employees
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <form
          onSubmit={handleSubmitUser}
          style={{
            display: "grid",
            gap: 12,
            padding: 16,
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            background: "#f9fafb",
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>
              {editingId ? "Edit Employee" : "Create Employee"}
            </h3>

            <p
              style={{
                margin: "5px 0 0",
                color: "#6b7280",
                fontSize: "0.82rem",
              }}
            >
              System Role controls permissions. Operational Position records the
              job being performed during the current login/session.
            </p>
          </div>

          <FieldLabel label="Full Name">
            <input
              placeholder="Alexis Napoles"
              value={form.fullName}
              onChange={(e) => handleChange("fullName", e.target.value)}
              style={inputStyle}
            />
          </FieldLabel>

          <FieldLabel label="Username">
            <input
              placeholder="anapoles"
              value={form.username}
              onChange={(e) => handleChange("username", e.target.value)}
              style={inputStyle}
            />
          </FieldLabel>

          <FieldLabel label="PIN">
            <input
              placeholder="PIN"
              value={form.pin}
              onChange={(e) => handleChange("pin", e.target.value)}
              style={inputStyle}
            />
          </FieldLabel>

          <FieldLabel label="System Role / Permission Level">
            <select
              value={form.role}
              onChange={(e) => handleChange("role", e.target.value)}
              style={inputStyle}
            >
              <option value="station_manager">Station Manager</option>
              <option value="duty_manager">Duty Manager</option>
              <option value="supervisor">Supervisor</option>
              <option value="gate_controller">Gate Controller</option>
              <option value="agent">Agent</option>
            </select>
          </FieldLabel>

          <FieldLabel label="Base / HR Position">
            <input
              placeholder="Agent, Supervisor, etc."
              value={form.position}
              onChange={(e) => handleChange("position", e.target.value)}
              style={inputStyle}
            />
          </FieldLabel>

          <div>
            <div
              style={{
                fontSize: "0.82rem",
                color: "#374151",
                fontWeight: 900,
                marginBottom: 7,
              }}
            >
              Operational Positions Allowed at Login
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
                gap: 8,
              }}
            >
              {OPERATIONAL_POSITIONS.map((item) => {
                const checked = selectedOperationalPositions.includes(
                  item.value
                );

                return (
                  <label
                    key={item.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "9px 10px",
                      borderRadius: 10,
                      border: checked
                        ? "2px solid #2563eb"
                        : "1px solid #d1d5db",
                      background: checked ? "#eff6ff" : "white",
                      color: checked ? "#1d4ed8" : "#374151",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOperationalPosition(item.value)}
                    />

                    {item.label}
                  </label>
                );
              })}
            </div>
          </div>

          <FieldLabel label="Default Position at Login">
            <select
              value={form.defaultOperationalPosition}
              onChange={(e) =>
                handleChange("defaultOperationalPosition", e.target.value)
              }
              disabled={selectedOperationalPositions.length === 0}
              style={inputStyle}
            >
              {selectedOperationalPositions.length === 0 ? (
                <option value="">Select operational positions first</option>
              ) : (
                selectedOperationalPositions.map((positionValue) => (
                  <option key={positionValue} value={positionValue}>
                    {getOperationalPositionLabel(positionValue)}
                  </option>
                ))
              )}
            </select>
          </FieldLabel>

          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: "10px 12px",
              borderRadius: 10,
              background: form.active ? "#dcfce7" : "#fee2e2",
              color: form.active ? "#166534" : "#991b1b",
              fontWeight: 900,
            }}
          >
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => handleChange("active", e.target.checked)}
            />

            Employee Active
          </label>

          <button
            type="submit"
            disabled={saving}
            style={{
              minHeight: 46,
              border: "none",
              borderRadius: 12,
              background: saving ? "#93c5fd" : "#2563eb",
              color: "white",
              fontWeight: 900,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving
              ? "Saving..."
              : editingId
                ? "Update Employee"
                : "Create Employee"}
          </button>

          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              style={{
                minHeight: 42,
                borderRadius: 12,
                border: "1px solid #d1d5db",
                background: "white",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Cancel Edit
            </button>
          )}

          {message && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: message.toLowerCase().includes("error")
                  ? "#fee2e2"
                  : "#dcfce7",
                color: message.toLowerCase().includes("error")
                  ? "#991b1b"
                  : "#166534",
                fontWeight: 800,
                fontSize: "0.82rem",
              }}
            >
              {message}
            </div>
          )}
        </form>

        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            background: "white",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 14,
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <h3 style={{ margin: 0 }}>Current Employees</h3>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
                minWidth: 900,
              }}
            >
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <th style={th}>Employee</th>
                  <th style={th}>Username</th>
                  <th style={th}>System Role</th>
                  <th style={th}>Base Position</th>
                  <th style={th}>Login Positions</th>
                  <th style={th}>Default</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>

              <tbody>
                {users.map((item) => {
                  const positions = normalizeOperationalPositions(
                    item.allowedOperationalPositions
                  );

                  return (
                    <tr key={item.id}>
                      <td style={td}>
                        <strong>{item.fullName || "-"}</strong>
                      </td>

                      <td style={td}>{item.username}</td>

                      <td style={td}>
                        <RolePill role={item.role} />
                      </td>

                      <td style={td}>{item.position || "-"}</td>

                      <td style={td}>
                        <div
                          style={{
                            display: "flex",
                            gap: 5,
                            flexWrap: "wrap",
                          }}
                        >
                          {(positions.length ? positions : ["COUNTER_SCAN"]).map(
                            (positionValue) => (
                              <span
                                key={positionValue}
                                style={{
                                  padding: "3px 7px",
                                  borderRadius: 999,
                                  background: "#eff6ff",
                                  color: "#1d4ed8",
                                  fontSize: "0.7rem",
                                  fontWeight: 800,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {getOperationalPositionLabel(positionValue)}
                              </span>
                            )
                          )}
                        </div>
                      </td>

                      <td style={td}>
                        {getOperationalPositionLabel(
                          item.defaultOperationalPosition ||
                            positions[0] ||
                            "COUNTER_SCAN"
                        )}
                      </td>

                      <td style={td}>
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: 999,
                            background:
                              item.active === false ? "#fee2e2" : "#dcfce7",
                            color:
                              item.active === false ? "#991b1b" : "#166534",
                            fontSize: "0.72rem",
                            fontWeight: 900,
                          }}
                        >
                          {item.active === false ? "INACTIVE" : "ACTIVE"}
                        </span>
                      </td>

                      <td style={{ ...td, textAlign: "right" }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            gap: 6,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handleEditUser(item)}
                            style={editButton}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteUser(item)}
                            style={deleteButton}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {users.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: 20,
                        textAlign: "center",
                        color: "#6b7280",
                      }}
                    >
                      No employees found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

function FieldLabel({ label, children }) {
  return (
    <label>
      <div
        style={{
          fontSize: "0.8rem",
          color: "#374151",
          fontWeight: 800,
          marginBottom: 5,
        }}
      >
        {label}
      </div>

      {children}
    </label>
  );
}

function RolePill({ role }) {
  const normalized = normalizeRole(role);

  const labels = {
    station_manager: "Station Manager",
    duty_manager: "Duty Manager",
    supervisor: "Supervisor",
    gate_controller: "Gate Controller",
    agent: "Agent",
  };

  return (
    <span
      style={{
        padding: "4px 8px",
        borderRadius: 999,
        background: "#f3f4f6",
        color: "#374151",
        fontSize: "0.72rem",
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      {labels[normalized] || normalized || "-"}
    </span>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
  padding: "9px 11px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  fontSize: "0.9rem",
};

const th = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "#6b7280",
  whiteSpace: "nowrap",
};

const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
  verticalAlign: "middle",
  fontSize: "0.82rem",
};

const editButton = {
  padding: "6px 9px",
  borderRadius: 8,
  border: "1px solid #2563eb",
  background: "#eff6ff",
  color: "#1d4ed8",
  fontWeight: 800,
  cursor: "pointer",
};

const deleteButton = {
  padding: "6px 9px",
  borderRadius: 8,
  border: "1px solid #ef4444",
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 800,
  cursor: "pointer",
};

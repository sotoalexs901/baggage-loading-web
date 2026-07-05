import { useEffect, useState } from "react";
import { collection, addDoc, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../firebase";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

export default function AdminUsersPage({ user }) {
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    username: "",
    pin: "",
    role: "agent",
    fullName: "",
    position: "",
  });

  const currentRole = normalizeRole(user?.role);
  const isStationManager = currentRole === "station_manager";

  useEffect(() => {
    if (!isStationManager) return;

    const q = query(collection(db, "users"), orderBy("username"));

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setUsers(data);
    });

    return () => unsub();
  }, [isStationManager]);

  if (!isStationManager) {
    return <p>You do not have permission to access this page.</p>;
  }

  const handleChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setMessage("");

    const username = form.username.trim().toLowerCase();
    const pin = form.pin.trim();
    const role = normalizeRole(form.role);

    if (!username || !pin || !role) {
      setMessage("Username, PIN and role are required.");
      return;
    }

    try {
      setSaving(true);

      await addDoc(collection(db, "users"), {
        username,
        pin,
        role,
        fullName: form.fullName.trim(),
        position: form.position.trim(),
        active: true,
        createdAt: new Date(),
        createdBy: user?.username || "admin",
      });

      setForm({
        username: "",
        pin: "",
        role: "agent",
        fullName: "",
        position: "",
      });

      setMessage("User created successfully.");
    } catch (error) {
      console.error("Error creating user:", error);
      setMessage("Error creating user.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h2>Admin Users</h2>

      <form
        onSubmit={handleCreateUser}
        style={{
          display: "grid",
          gap: 10,
          maxWidth: 420,
          marginBottom: 24,
        }}
      >
        <input
          placeholder="Username"
          value={form.username}
          onChange={(e) => handleChange("username", e.target.value)}
        />

        <input
          placeholder="PIN"
          value={form.pin}
          onChange={(e) => handleChange("pin", e.target.value)}
        />

        <select
          value={form.role}
          onChange={(e) => handleChange("role", e.target.value)}
        >
          <option value="station_manager">Station Manager</option>
          <option value="duty_manager">Duty Manager</option>
          <option value="supervisor">Supervisor</option>
          <option value="gate_controller">Gate Controller</option>
          <option value="agent">Agent</option>
        </select>

        <input
          placeholder="Full name"
          value={form.fullName}
          onChange={(e) => handleChange("fullName", e.target.value)}
        />

        <input
          placeholder="Position"
          value={form.position}
          onChange={(e) => handleChange("position", e.target.value)}
        />

        <button type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create User"}
        </button>
      </form>

      {message && <p>{message}</p>}

      <h3>Current Users</h3>

      <table border="1" cellPadding="8" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Full Name</th>
            <th>Position</th>
            <th>Active</th>
          </tr>
        </thead>

        <tbody>
          {users.map((item) => (
            <tr key={item.id}>
              <td>{item.username}</td>
              <td>{item.role}</td>
              <td>{item.fullName || "-"}</td>
              <td>{item.position || "-"}</td>
              <td>{item.active === false ? "No" : "Yes"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

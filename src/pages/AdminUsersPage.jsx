import { useEffect, useState } from "react";
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
  });

  const currentRole = normalizeRole(user?.role);
  const isStationManager = currentRole === "station_manager";

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
    });
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmitUser = async (e) => {
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

      const payload = {
        username,
        pin,
        role,
        fullName: form.fullName.trim(),
        position: form.position.trim(),
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

    setForm({
      username: item.username || "",
      pin: item.pin || "",
      role: item.role || "agent",
      fullName: item.fullName || "",
      position: item.position || "",
      active: item.active === false ? false : true,
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
    <section>
      <h2>Admin Users</h2>

      <form
        onSubmit={handleSubmitUser}
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

        <select value={form.role} onChange={(e) => handleChange("role", e.target.value)}>
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

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => handleChange("active", e.target.checked)}
          />
          Active
        </label>

        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : editingId ? "Update User" : "Create User"}
        </button>

        {editingId && (
          <button type="button" onClick={resetForm}>
            Cancel Edit
          </button>
        )}
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
            <th>Actions</th>
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
              <td>
                <button type="button" onClick={() => handleEditUser(item)}>
                  Edit
                </button>{" "}
                <button type="button" onClick={() => handleDeleteUser(item)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

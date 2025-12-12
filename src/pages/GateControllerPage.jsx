// src/pages/GateControllerPage.jsx
export default function GateControllerPage({ flightId, user, gateControllerOnDuty, canEdit }) {
  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <h2>Gate Controller</h2>
      <p><strong>Flight:</strong> {flightId}</p>
      <p><strong>User:</strong> {user?.username} ({user?.role})</p>

      {!user ? (
        <p>Loading user…</p>
      ) : (
        <>
          {gateControllerOnDuty && (
            <p><strong>Gate Controller on duty:</strong> {gateControllerOnDuty}</p>
          )}
          <p><strong>Can edit totals:</strong> {String(canEdit)}</p>
          <p style={{ color: "#6b7280" }}>
            (Next step) Aquí mostraremos el total de maletas chequeadas y el conteo de Aircraft Loading.
          </p>
        </>
      )}
    </div>
  );
}

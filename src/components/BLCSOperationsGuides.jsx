// src/components/BLCSOperationsGuides.jsx
// Standalone bilingual guide panel for the BLCS Dashboard.
// No Firebase dependency. Safe/additive component.

import React, { useMemo, useState } from "react";

const GUIDE_TEXT = {
  en: {
    title: "BLCS Operations Guides",
    subtitle:
      "Quick role-based instructions for Regular Flights and Carry-On Only operations.",
    language: "Language",
    regular: "Regular Flight",
    carryOn: "Carry-On Only",
    supervisor: "Supervisor Guide",
    agent: "Agent Guide",
    quickRole: "Where should I work?",
    important: "Important",
    regularSupervisor: {
      intro:
        "Supervisors coordinate the flight, monitor progress, resolve exceptions and review the final operation.",
      roleMap: [
        ["Flight Setup / Flight Control", "Create or open the correct regular flight and verify the flight information before the operation starts."],
        ["Tracking / Monitoring", "Monitor the progress of bags through Counter, Gate, Bagroom and Aircraft/Ramp."],
        ["Reports", "Review the operational totals and final flight information after loading is complete."],
        ["Exception Support", "Assist agents with incorrect scans, operational exceptions or items that require supervisor review."],
      ],
      steps: [
        {
          title: "1. Open the correct flight",
          body:
            "Confirm Flight Number, Flight Date, route, gate and any other available flight information before the team begins working.",
        },
        {
          title: "2. Monitor the operation",
          body:
            "Use the available tracking and operational pages to confirm that baggage is progressing through the expected workflow and that no items remain unexpectedly pending.",
        },
        {
          title: "3. Review exceptions",
          body:
            "Investigate items that appear in the wrong stage, duplicate scans, missing movements or other operational exceptions before the flight is finalized.",
        },
        {
          title: "4. Review the final result",
          body:
            "Confirm the final baggage totals and aircraft loading information. Use the reporting tools to document the completed operation.",
        },
      ],
      note:
        "Supervisors should avoid performing an agent step unless they are actually covering that operational position.",
    },
    regularAgent: {
      intro:
        "Agents should work only in the page that matches the physical position they are covering.",
      roleMap: [
        ["Counter Agent", "COUNTER / Counter Scan"],
        ["Gate Agent", "GATE / Gate Controller"],
        ["Bagroom Agent", "BAGROOM"],
        ["Aircraft / Ramp Agent", "AIRCRAFT / RAMP"],
      ],
      steps: [
        {
          title: "1. Counter",
          body:
            "Scan or register the baggage at Counter according to the regular-flight workflow. Verify the correct flight before confirming the bag.",
        },
        {
          title: "2. Gate",
          body:
            "Work from the Gate page when handling baggage or exceptions at the boarding gate. Confirm the correct bag before completing the Gate action.",
        },
        {
          title: "3. Bagroom",
          body:
            "Use the Bagroom page for baggage physically received or processed in the bagroom. Do not complete a Bagroom action before the bag is physically present.",
        },
        {
          title: "4. Aircraft / Ramp",
          body:
            "Use the Aircraft/Ramp page for bags physically received or loaded at the aircraft. Verify the bag before confirming the movement.",
        },
      ],
      note:
        "Always verify the flight and bag before confirming an action. The page you use becomes part of the operational history.",
    },
    carrySupervisor: {
      intro:
        "Supervisors primarily use SETUP, TRACKING and REPORT, and manage operational exceptions when needed.",
      roleMap: [
        ["Prepare the flight", "SETUP"],
        ["Monitor the operation", "TRACKING"],
        ["Review final results", "REPORT"],
        ["Operational exception support", "GATE when supervisor intervention is required"],
      ],
      steps: [
        {
          title: "1. SETUP - Prepare the flight",
          body:
            "Open the Carry-On Only flight. Verify Flight Number, Flight Date, route, gate, tail number, required Carry-Ons, passenger information, available seats and Gate Check numbers. Add, edit or remove available Gate Check numbers when needed.",
        },
        {
          title: "2. TRACKING - Monitor the operation",
          body:
            "Follow every Gate Check through Counter Assigned, Gate Collected, Ramp Received, Aircraft Loaded or Offloaded. Search by passenger, seat, Gate Check or Gate Check Description and review weights, notes, compartments and timestamps.",
        },
        {
          title: "3. Manage exceptions",
          body:
            "Review Gate bypass alerts, Offloaded items and other exceptions. When appropriate, acknowledge a Gate bypass or return an Offloaded item to Ready for Gate Pickup.",
        },
        {
          title: "4. REPORT - Final review",
          body:
            "Review Assigned, Loaded, Offloaded, Remaining, Additional and Forward/Middle/Aft totals. Confirm passenger, seat, Gate Check, Gate Check Description, weights, timestamps, users, compartment and notes before printing or saving the final report.",
        },
        {
          title: "5. Close the flight",
          body:
            "Close the Carry-On flight only after active items have reached their final disposition, such as Aircraft Loaded or Offloaded.",
        },
      ],
      note:
        "Use Tracking and Report as the supervisor's primary oversight tools. Operational actions should remain tied to the position that physically handled the item.",
    },
    carryAgent: {
      intro:
        "Agents follow the physical movement of each Gate Check through Counter, Gate, Ramp and Load.",
      roleMap: [
        ["Counter Agent", "COUNTER"],
        ["Gate Agent", "GATE"],
        ["Ramp Agent", "RAMP"],
        ["Load / Aircraft Agent", "LOAD"],
      ],
      steps: [
        {
          title: "1. COUNTER - Assign the Gate Check",
          body:
            "Select today's Carry-On flight. Select the Passenger, Assigned Seat and Gate Check Number. Record the Carry-On Weight and choose the Gate Check Description using the visual selector. Confirm the assignment. If still at Counter, the assignment can be corrected before it moves forward.",
        },
        {
          title: "2. GATE - Collect the item",
          body:
            "Locate the item by Seat or Gate Check Number. Compare the physical item with the Gate Check Description, verify the weight and add a Gate Note if needed. Select Collected at Gate. Use Offload only when the item will not continue in the normal flow.",
        },
        {
          title: "3. RAMP - Receive the item",
          body:
            "Identify the physical Gate Check Number and select Receive. Ramp may also receive an item that still shows Counter Assigned; BLCS records the Gate bypass and sends an alert to Gate for acknowledgment.",
        },
        {
          title: "4. LOAD - Load the item",
          body:
            "Select the Gate Check Number, choose FORWARD, MIDDLE or AFT, then select Load. Loaded Gate Checks can be expanded when a correction is needed. Available controls include Update Compartment, Unload to Ramp and Offload.",
        },
      ],
      note:
        "Work only in the page that matches the position you are physically covering. This keeps the BLCS tracking history accurate.",
    },
  },

  es: {
    title: "Guias Operacionales de BLCS",
    subtitle:
      "Instrucciones rapidas por funcion para vuelos regulares y operaciones Carry-On Only.",
    language: "Idioma",
    regular: "Vuelo Regular",
    carryOn: "Carry-On Only",
    supervisor: "Guia de Supervisor",
    agent: "Guia de Agente",
    quickRole: "Donde debo trabajar?",
    important: "Importante",
    regularSupervisor: {
      intro:
        "Los Supervisores coordinan el vuelo, monitorean el progreso, atienden excepciones y revisan el resultado final de la operacion.",
      roleMap: [
        ["Preparacion / Control del vuelo", "Crear o abrir el vuelo regular correcto y verificar la informacion antes de comenzar la operacion."],
        ["Tracking / Monitoreo", "Monitorear el movimiento de los equipajes entre Counter, Gate, Bagroom y Aircraft/Ramp."],
        ["Reportes", "Revisar los totales operacionales y la informacion final del vuelo despues de completar la carga."],
        ["Apoyo en excepciones", "Asistir a los agentes con scans incorrectos, excepciones operacionales o situaciones que requieran revision de Supervisor."],
      ],
      steps: [
        {
          title: "1. Abrir el vuelo correcto",
          body:
            "Confirmar Flight Number, Flight Date, ruta, gate y cualquier otra informacion disponible antes de que el equipo comience a trabajar.",
        },
        {
          title: "2. Monitorear la operacion",
          body:
            "Usar Tracking y las paginas operacionales disponibles para confirmar que los equipajes avanzan por el flujo esperado y que no queden piezas pendientes sin razon.",
        },
        {
          title: "3. Revisar excepciones",
          body:
            "Investigar equipajes en una etapa incorrecta, scans duplicados, movimientos faltantes u otras excepciones antes de finalizar el vuelo.",
        },
        {
          title: "4. Revisar el resultado final",
          body:
            "Confirmar los totales finales de equipaje y la informacion de carga del avion. Utilizar los reportes para documentar la operacion completada.",
        },
      ],
      note:
        "El Supervisor debe evitar completar una accion de Agent a menos que realmente este cubriendo esa posicion operacional.",
    },
    regularAgent: {
      intro:
        "Los Agents deben trabajar solamente en la pagina que corresponda con la posicion fisica que estan cubriendo.",
      roleMap: [
        ["Counter Agent", "COUNTER / Counter Scan"],
        ["Gate Agent", "GATE / Gate Controller"],
        ["Bagroom Agent", "BAGROOM"],
        ["Aircraft / Ramp Agent", "AIRCRAFT / RAMP"],
      ],
      steps: [
        {
          title: "1. Counter",
          body:
            "Escanear o registrar el equipaje en Counter siguiendo el flujo del vuelo regular. Verificar el vuelo correcto antes de confirmar la pieza.",
        },
        {
          title: "2. Gate",
          body:
            "Trabajar desde la pagina Gate cuando se manejen equipajes o excepciones en la puerta de embarque. Confirmar la pieza correcta antes de completar la accion.",
        },
        {
          title: "3. Bagroom",
          body:
            "Usar la pagina Bagroom para equipajes fisicamente recibidos o procesados en el bagroom. No completar una accion de Bagroom antes de tener la pieza fisicamente.",
        },
        {
          title: "4. Aircraft / Ramp",
          body:
            "Usar Aircraft/Ramp para equipajes fisicamente recibidos o cargados en el avion. Verificar la pieza antes de confirmar el movimiento.",
        },
      ],
      note:
        "Siempre verificar el vuelo y el equipaje antes de confirmar una accion. La pagina utilizada forma parte del historial operacional.",
    },
    carrySupervisor: {
      intro:
        "Los Supervisores trabajan principalmente en SETUP, TRACKING y REPORT, y manejan excepciones operacionales cuando sea necesario.",
      roleMap: [
        ["Preparar el vuelo", "SETUP"],
        ["Monitorear la operacion", "TRACKING"],
        ["Revisar el resultado final", "REPORT"],
        ["Apoyo en excepciones", "GATE cuando se requiera intervencion del Supervisor"],
      ],
      steps: [
        {
          title: "1. SETUP - Preparar el vuelo",
          body:
            "Abrir el vuelo Carry-On Only. Verificar Flight Number, Flight Date, ruta, gate, tail number, cantidad requerida de Carry-Ons, pasajeros, asientos disponibles y Gate Check numbers. Agregar, editar o remover Gate Check numbers disponibles cuando sea necesario.",
        },
        {
          title: "2. TRACKING - Monitorear la operacion",
          body:
            "Dar seguimiento a cada Gate Check por Counter Assigned, Gate Collected, Ramp Received, Aircraft Loaded u Offloaded. Buscar por pasajero, asiento, Gate Check o Gate Check Description y revisar pesos, notas, compartment y timestamps.",
        },
        {
          title: "3. Manejar excepciones",
          body:
            "Revisar alertas de Gate bypass, piezas Offloaded y otras excepciones. Cuando corresponda, reconocer un Gate bypass o devolver una pieza Offloaded a Ready for Gate Pickup.",
        },
        {
          title: "4. REPORT - Revision final",
          body:
            "Revisar Assigned, Loaded, Offloaded, Remaining, Additional y los totales Forward/Middle/Aft. Confirmar passenger, seat, Gate Check, Gate Check Description, pesos, tiempos, usuarios, compartment y notas antes de imprimir o guardar el reporte final.",
        },
        {
          title: "5. Cerrar el vuelo",
          body:
            "Cerrar el vuelo Carry-On solamente cuando las piezas activas hayan llegado a su disposicion final, como Aircraft Loaded u Offloaded.",
        },
      ],
      note:
        "Tracking y Report son las herramientas principales de supervision. Las acciones operacionales deben permanecer asociadas a la posicion que fisicamente manejo la pieza.",
    },
    carryAgent: {
      intro:
        "Los Agents siguen el movimiento fisico de cada Gate Check por Counter, Gate, Ramp y Load.",
      roleMap: [
        ["Counter Agent", "COUNTER"],
        ["Gate Agent", "GATE"],
        ["Ramp Agent", "RAMP"],
        ["Load / Aircraft Agent", "LOAD"],
      ],
      steps: [
        {
          title: "1. COUNTER - Asignar el Gate Check",
          body:
            "Seleccionar el vuelo Carry-On del dia. Seleccionar Passenger, Assigned Seat y Gate Check Number. Registrar el Carry-On Weight y escoger la Gate Check Description usando el selector visual. Confirmar la asignacion. Mientras permanezca en Counter, la informacion puede corregirse antes de continuar.",
        },
        {
          title: "2. GATE - Recoger la pieza",
          body:
            "Localizar la pieza por Seat o Gate Check Number. Comparar la pieza fisica con la Gate Check Description, verificar el peso y agregar Gate Note cuando sea necesario. Seleccionar Collected at Gate. Usar Offload solamente cuando la pieza no continuara por el flujo normal.",
        },
        {
          title: "3. RAMP - Recibir la pieza",
          body:
            "Identificar fisicamente el Gate Check Number y seleccionar Receive. Ramp tambien puede recibir una pieza que aun aparezca como Counter Assigned; BLCS registra el Gate bypass y genera una alerta para que Gate la reconozca.",
        },
        {
          title: "4. LOAD - Cargar la pieza",
          body:
            "Seleccionar el Gate Check Number, escoger FORWARD, MIDDLE o AFT y luego seleccionar Load. Los Gate Checks ya cargados pueden abrirse si se necesita una correccion. Los controles disponibles incluyen Update Compartment, Unload to Ramp y Offload.",
        },
      ],
      note:
        "Trabajar solamente en la pagina correspondiente a la posicion que estas cubriendo fisicamente. Esto mantiene correcto el historial de BLCS.",
    },
  },
};

export default function BLCSOperationsGuides() {
  const [language, setLanguage] = useState("en");
  const [operation, setOperation] = useState("carryOn");
  const [role, setRole] = useState("agent");
  const [expandedStep, setExpandedStep] = useState(0);

  const t = GUIDE_TEXT[language];

  const guide = useMemo(() => {
    if (operation === "regular" && role === "supervisor") {
      return t.regularSupervisor;
    }

    if (operation === "regular" && role === "agent") {
      return t.regularAgent;
    }

    if (operation === "carryOn" && role === "supervisor") {
      return t.carrySupervisor;
    }

    return t.carryAgent;
  }, [operation, role, t]);

  const changeOperation = (value) => {
    setOperation(value);
    setExpandedStep(0);
  };

  const changeRole = (value) => {
    setRole(value);
    setExpandedStep(0);
  };

  return (
    <section style={shellStyle}>
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>BLCS TRAINING</div>
          <h2 style={titleStyle}>{t.title}</h2>
          <p style={subtitleStyle}>{t.subtitle}</p>
        </div>

        <div style={languageWrapStyle}>
          <span style={smallLabelStyle}>{t.language}</span>

          <div style={segmentedStyle}>
            <ToggleButton
              active={language === "en"}
              onClick={() => setLanguage("en")}
            >
              English
            </ToggleButton>

            <ToggleButton
              active={language === "es"}
              onClick={() => setLanguage("es")}
            >
              Espanol
            </ToggleButton>
          </div>
        </div>
      </div>

      <div style={topTabsStyle}>
        <ToggleButton
          active={operation === "regular"}
          onClick={() => changeOperation("regular")}
          large
        >
          {t.regular}
        </ToggleButton>

        <ToggleButton
          active={operation === "carryOn"}
          onClick={() => changeOperation("carryOn")}
          large
        >
          {t.carryOn}
        </ToggleButton>
      </div>

      <div style={roleTabsStyle}>
        <ToggleButton
          active={role === "supervisor"}
          onClick={() => changeRole("supervisor")}
          large
        >
          {t.supervisor}
        </ToggleButton>

        <ToggleButton
          active={role === "agent"}
          onClick={() => changeRole("agent")}
          large
        >
          {t.agent}
        </ToggleButton>
      </div>

      <div style={guideCardStyle}>
        <p style={introStyle}>{guide.intro}</p>

        <div style={quickRoleBoxStyle}>
          <div style={quickRoleTitleStyle}>{t.quickRole}</div>

          <div style={roleMapGridStyle}>
            {guide.roleMap.map(([position, page]) => (
              <div key={`${position}-${page}`} style={roleMapItemStyle}>
                <div style={rolePositionStyle}>{position}</div>
                <div style={rolePageStyle}>{page}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={stepsWrapStyle}>
          {guide.steps.map((step, index) => {
            const open = expandedStep === index;

            return (
              <div key={step.title} style={stepCardStyle}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedStep(open ? -1 : index)
                  }
                  style={stepButtonStyle}
                >
                  <span>{step.title}</span>

                  <span
                    style={{
                      ...arrowStyle,
                      transform: open
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                    }}
                    aria-hidden="true"
                  >
                    v
                  </span>
                </button>

                {open && (
                  <div style={stepBodyStyle}>
                    {step.body}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={importantStyle}>
          <strong>{t.important}:</strong> {guide.note}
        </div>
      </div>
    </section>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
  large = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: active
          ? "1px solid #7c3aed"
          : "1px solid #e2e8f0",
        background: active
          ? "#7c3aed"
          : "white",
        color: active
          ? "white"
          : "#475569",
        borderRadius: 10,
        padding: large
          ? "10px 14px"
          : "7px 10px",
        fontWeight: 900,
        fontSize: large
          ? "0.82rem"
          : "0.74rem",
        cursor: "pointer",
        minHeight: large
          ? 42
          : 34,
        flex: large
          ? "1 1 180px"
          : "0 0 auto",
      }}
    >
      {children}
    </button>
  );
}

const shellStyle = {
  display: "grid",
  gap: 12,
  padding: 14,
  borderRadius: 16,
  border: "1px solid #e2e8f0",
  background: "white",
  boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  alignItems: "flex-start",
  flexWrap: "wrap",
};

const eyebrowStyle = {
  color: "#7c3aed",
  fontSize: "0.68rem",
  fontWeight: 900,
  letterSpacing: "0.08em",
};

const titleStyle = {
  margin: "4px 0 0",
  color: "#0f172a",
  fontSize: "1.18rem",
};

const subtitleStyle = {
  margin: "5px 0 0",
  color: "#64748b",
  fontSize: "0.8rem",
  lineHeight: 1.45,
};

const languageWrapStyle = {
  display: "grid",
  gap: 5,
};

const smallLabelStyle = {
  color: "#64748b",
  fontSize: "0.66rem",
  fontWeight: 800,
};

const segmentedStyle = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};

const topTabsStyle = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const roleTabsStyle = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const guideCardStyle = {
  display: "grid",
  gap: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid #ddd6fe",
  background: "#faf5ff",
};

const introStyle = {
  margin: 0,
  color: "#334155",
  fontSize: "0.82rem",
  lineHeight: 1.5,
  fontWeight: 700,
};

const quickRoleBoxStyle = {
  padding: 11,
  borderRadius: 12,
  border: "1px solid #dbeafe",
  background: "white",
};

const quickRoleTitleStyle = {
  color: "#1e3a8a",
  fontSize: "0.72rem",
  fontWeight: 900,
  marginBottom: 8,
};

const roleMapGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 7,
};

const roleMapItemStyle = {
  padding: 9,
  borderRadius: 10,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
};

const rolePositionStyle = {
  color: "#64748b",
  fontSize: "0.66rem",
  fontWeight: 800,
};

const rolePageStyle = {
  marginTop: 3,
  color: "#0f172a",
  fontSize: "0.76rem",
  fontWeight: 900,
};

const stepsWrapStyle = {
  display: "grid",
  gap: 7,
};

const stepCardStyle = {
  borderRadius: 11,
  border: "1px solid #e2e8f0",
  background: "white",
  overflow: "hidden",
};

const stepButtonStyle = {
  width: "100%",
  border: "none",
  background: "white",
  padding: "11px 12px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  textAlign: "left",
  color: "#0f172a",
  fontSize: "0.8rem",
  fontWeight: 900,
  cursor: "pointer",
  font: "inherit",
};

const arrowStyle = {
  color: "#7c3aed",
  fontWeight: 900,
  transition: "transform 160ms ease",
  flex: "0 0 auto",
};

const stepBodyStyle = {
  padding: "0 12px 12px",
  color: "#475569",
  fontSize: "0.78rem",
  lineHeight: 1.55,
};

const importantStyle = {
  padding: 10,
  borderRadius: 10,
  border: "1px solid #fde68a",
  background: "#fffbeb",
  color: "#92400e",
  fontSize: "0.76rem",
  lineHeight: 1.5,
};

// src/components/BLCSOperationsGuides.jsx
// Standalone bilingual guide panel for the BLCS Dashboard.
// No Firebase dependency. Safe/additive component.

import React, { useMemo, useState } from "react";

const GUIDE_TEXT = {
  en: {
    title: "BLCS Operations Guides",
    subtitle:
      "Detailed role-based instructions for Regular Flights and Carry-On Only operations.",
    language: "Language",
    regular: "Regular Flight",
    carryOn: "Carry-On Only",
    supervisor: "Supervisor Guide",
    agent: "Agent Guide",
    quickRole: "Where should I work?",
    important: "Important",

    regularSupervisor: {
      intro:
        "Supervisors control the regular-flight lifecycle: verify the flight, monitor each baggage handoff, manage exceptions and confirm the final operation before closing.",
      roleMap: [
        ["Flight Control", "FLIGHTS / DASHBOARD"],
        ["Counter oversight", "COUNTER SCAN"],
        ["Gate oversight", "GATE CONTROLLER"],
        ["Bagroom oversight", "BAGROOM"],
        ["Aircraft / Ramp oversight", "AIRCRAFT"],
        ["Bag history", "BAGGAGE TRACKING"],
        ["Final review", "REPORTS"],
      ],
      steps: [
        {
          title: "1. Create or open the correct regular flight",
          body:
            "Verify Flight Number, Flight Date, origin, destination, gate, aircraft/tail information and current flight status. Confirm the team is working the correct flight before scanning begins.",
        },
        {
          title: "2. Confirm operational assignments",
          body:
            "Confirm which employee is covering Counter, Gate Controller, Bagroom and Aircraft/Ramp. The operational position determines where the employee should record physical baggage movements.",
        },
        {
          title: "3. Monitor Counter Scan",
          body:
            "Counter creates the initial baggage record for checked bags, Gate Checks and Oversize items. Review unexpected duplicates, wrong-flight warnings and tags that do not belong to the active flight. A bag should not be accepted into the operation when BLCS identifies it as belonging to another active flight.",
        },
        {
          title: "4. Monitor Gate Controller",
          body:
            "Use Gate Controller for gate-related baggage, manifest/totals and boarding-gate exceptions. Verify that gate activity belongs to the correct flight and investigate discrepancies before the flight progresses.",
        },
        {
          title: "5. Monitor Bagroom / receiving locations",
          body:
            "Confirm bags are recorded only when physically received. Review Bagroom, Oversize or Gate/Ramp receiving locations as applicable. Missing or duplicate movements should be resolved before loading.",
        },
        {
          title: "6. Monitor Aircraft / Ramp loading",
          body:
            "Confirm the bag is physically at the aircraft before the Aircraft/Ramp action is completed. Review aircraft totals, loading progress and any offload or correction before the flight is finalized.",
        },
        {
          title: "7. Use Baggage Tracking for exceptions",
          body:
            "Search the Bag Tag and review its complete movement history, including flight, location, timestamp and employee. Use Tracking to identify where the last confirmed physical handoff occurred.",
        },
        {
          title: "8. Control flight status",
          body:
            "Use OPEN, RECEIVING, LOADING and LOADED according to the actual operation. Do not mark the flight LOADED until loading and required reconciliation are complete. Reopen only when an operational correction is legitimately required.",
        },
        {
          title: "9. Review Reports before completion",
          body:
            "Compare Counter, Bagroom/Gate, Aircraft and other operational totals. Investigate discrepancies and pending bags before considering the flight complete.",
        },
        {
          title: "10. Protect the audit trail",
          body:
            "Deleting or correcting scans changes the operational record. Make corrections only when supported by the physical operation and use supervisor authority responsibly.",
        },
      ],
      note:
        "The physical movement of the bag must match the BLCS movement. Supervisors should monitor and correct exceptions, not create artificial movements to make totals match.",
    },

    regularAgent: {
      intro:
        "Agents record the physical movement of baggage. Work only in the page that matches the position you are actually covering.",
      roleMap: [
        ["Counter Agent", "COUNTER SCAN"],
        ["Gate Agent", "GATE CONTROLLER"],
        ["Bagroom Agent", "BAGROOM"],
        ["Aircraft / Ramp Agent", "AIRCRAFT"],
        ["Find a bag", "BAGGAGE TRACKING"],
      ],
      steps: [
        {
          title: "1. Verify the flight before every operation",
          body:
            "Confirm the selected flight number/date before scanning. Never continue a scan into the wrong flight just because the scanner accepted the barcode.",
        },
        {
          title: "2. COUNTER - Create the initial baggage record",
          body:
            "Scan the Bag Tag and select the correct bag type when required: Checked Bag, Gate Check or Oversize. Confirm BLCS does not show a wrong-flight or duplicate warning before accepting the bag.",
        },
        {
          title: "3. GATE - Record gate-related baggage correctly",
          body:
            "Use Gate Controller only for baggage physically handled at the boarding gate or for the gate function you are assigned. Verify the Bag Tag and flight before confirming the action.",
        },
        {
          title: "4. BAGROOM - Confirm physical receipt",
          body:
            "Do not complete a Bagroom action until the bag is physically present. Use the correct receiving location/cart information when required and verify the tag before confirming.",
        },
        {
          title: "5. AIRCRAFT / RAMP - Confirm physical loading",
          body:
            "Use Aircraft/Ramp only for bags physically received at the aircraft or loaded according to the page workflow. Never pre-scan bags that have not reached the aircraft.",
        },
        {
          title: "6. Stop when BLCS shows a conflict",
          body:
            "If BLCS reports a duplicate, wrong flight, locked flight or unexpected status, stop and contact the Supervisor. Do not bypass the warning by creating another record.",
        },
        {
          title: "7. Use Tracking when a bag cannot be located",
          body:
            "Search the Bag Tag in Baggage Tracking to identify the last recorded location, time and employee. Tracking is the system history; it should match the physical operation.",
        },
        {
          title: "8. Corrections and deletions",
          body:
            "Do not delete or recreate scans simply to fix totals. If a scan was made in error, notify the Supervisor and follow the approved correction process.",
        },
      ],
      note:
        "Scan only what you physically have. Verify the flight and Bag Tag before every confirmation. Never create a system movement before the physical movement occurs.",
    },

    carrySupervisor: {
      intro:
        "Supervisors manage Carry-On setup, reusable Gate Check inventory, the mandatory Counter-to-Gate-to-Ramp-to-Load chain, exceptions and final reconciliation.",
      roleMap: [
        ["Create/open Carry-On flight", "FLIGHTS"],
        ["Prepare flight", "SETUP"],
        ["Master Gate Check inventory", "GATE CHECK DATABASE"],
        ["Monitor live movement", "TRACKING"],
        ["Final reconciliation", "REPORT / SUMMARY"],
      ],
      steps: [
        {
          title: "1. Create or open the Carry-On flight",
          body:
            "Confirm Flight Number, Flight Date, route, gate and tail/aircraft information. Carry-On flights remain separate from the regular baggage workflow.",
        },
        {
          title: "2. SETUP - Upload and verify flight documents",
          body:
            "Load the required Load Manifest and Empty Seats Report. Verify passenger data, available seats and the Required Carry-Ons target before releasing the operation.",
        },
        {
          title: "3. SETUP - Confirm Required Carry-Ons",
          body:
            "Required Carry-Ons is the operational target. Additional assignments above the target are allowed and must remain visible as Additional rather than being blocked.",
        },
        {
          title: "4. GATE CHECK DATABASE - Allocate reusable numbers",
          body:
            "The Database is separate from the agent workflow and is limited to Supervisor, Duty Manager and Station Manager access. Import or add Gate Check numbers, allocate the required quantity to the flight, correct AVAILABLE numbers when necessary and disable damaged/invalid numbers.",
        },
        {
          title: "5. COUNTER - Monitor assignments",
          body:
            "Counter assigns Passenger, Seat, Gate Check Number, weight and visual description. Up to 5 Gate Checks may be associated with the same passenger/seat. The same Gate Check Number must never be reused on the same flight.",
        },
        {
          title: "6. GoShow handling",
          body:
            "A GoShow may be created during live operation. Counter may create it, and Gate may create a Gate GoShow directly when necessary. Gate-created GoShows are recorded as Gate/GoShow and must not appear as Counter-created activity.",
        },
        {
          title: "7. GATE - Mandatory handoff before Ramp",
          body:
            "Every Carry-On Gate Check must reach GATE_COLLECTED before Ramp can receive it. Ramp no longer accepts COUNTER_ASSIGNED items. If a Gate Check is missing from Ramp, verify Gate collection first rather than bypassing Gate.",
        },
        {
          title: "8. GATE - Safety confirmation",
          body:
            "For applicable Carry-Ons, Gate confirms the item is secured with a zip tie and the passenger was advised to remove high-value items, medications and laptops. Strollers, Walkers, Wagons, Car Seats, Booster Seats and WCHR are not subject to this Carry-On safety prompt.",
        },
        {
          title: "9. RAMP - Monitor receipt and comments",
          body:
            "Ramp receives only Gate Checks already marked GATE_COLLECTED. Ramp may enter an Additional Comment when operational context is needed; the comment becomes part of Tracking, Report and Summary.",
        },
        {
          title: "10. LOAD - Confirm compartment before loading",
          body:
            "The Load Agent selects FORWARD, MIDDLE or AFT first, then selects one or multiple Gate Checks and confirms Load. Use Update Compartment, Unload to Ramp or Offload only when the physical operation requires a correction.",
        },
        {
          title: "11. TRACKING - Follow each Gate Check",
          body:
            "Use Tracking to review Counter Assigned, Gate Collected, Ramp Received, Aircraft Loaded and Offloaded history, including users, timestamps, weights, Gate notes, Ramp comments, safety confirmation and compartment.",
        },
        {
          title: "12. REPORT / SUMMARY - Reconcile the flight",
          body:
            "Review Assigned, Required, Additional, Loaded, Remaining, Offloaded and Forward/Middle/Aft totals. Investigate every remaining active Gate Check before final completion.",
        },
        {
          title: "13. Return unused Gate Check numbers",
          body:
            "After the operation, return only unused numbers that remain AVAILABLE to the Gate Check Database. Numbers actually used remain USED for audit history and are not returned for reuse.",
        },
      ],
      note:
        "Carry-On operational order is mandatory: Counter (or Gate GoShow) -> Gate Collected -> Ramp Received -> Aircraft Loaded. Do not use a later page to compensate for a missing earlier physical handoff.",
    },

    carryAgent: {
      intro:
        "Carry-On Agents record each physical handoff. The normal sequence is COUNTER -> GATE -> RAMP -> LOAD; a Gate GoShow begins at Gate but still must continue Gate -> Ramp -> Load.",
      roleMap: [
        ["Counter Agent", "COUNTER"],
        ["Gate Agent", "GATE"],
        ["Ramp Agent", "RAMP"],
        ["Load / Aircraft Agent", "LOAD"],
      ],
      steps: [
        {
          title: "1. COUNTER - Select the correct flight",
          body:
            "Confirm the Carry-On flight before assigning anything. Select Passenger, Assigned Seat and an available Gate Check Number.",
        },
        {
          title: "2. COUNTER - Record weight and description",
          body:
            "Enter the Carry-On weight and choose the correct visual Gate Check Description. Up to 5 Gate Checks may be assigned to the same passenger/seat, but one Gate Check Number cannot be reused.",
        },
        {
          title: "3. COUNTER - Use GoShow when required",
          body:
            "Use GoShow for a passenger or Gate Check added during live operation. Once the Gate Check is assigned, it is no longer available for another assignment.",
        },
        {
          title: "4. GATE - Confirm physical collection",
          body:
            "Locate the item by Seat or Gate Check Number, compare the physical item to the description, verify weight when required and add a Gate Note if needed. Select Collected only after the item is physically under Gate control.",
        },
        {
          title: "5. GATE - Create a Gate GoShow when necessary",
          body:
            "Gate may add a GoShow directly without sending the Agent back to Counter. Select passenger/seat, Gate Check Number, weight and visual description. A Gate-created GoShow is recorded as Gate/GoShow.",
        },
        {
          title: "6. GATE - Complete Carry-On safety confirmation",
          body:
            "For applicable Carry-Ons, confirm the zip tie and that the passenger was advised to remove valuables, medications and laptops. This prompt does not apply to Stroller, Walker, Wagon, Car Seat, Booster Seat or WCHR categories.",
        },
        {
          title: "7. RAMP - Gate collection is mandatory",
          body:
            "Ramp can receive only Gate Checks showing GATE_COLLECTED. If the item is still COUNTER_ASSIGNED, stop and contact Gate. Do not bypass Gate and do not create a Ramp receipt early.",
        },
        {
          title: "8. RAMP - Verify and receive",
          body:
            "Physically verify the Gate Check Number, then select Receive. Use Additional Comment only when useful operational information should follow the item, such as damage, late delivery or special handling.",
        },
        {
          title: "9. LOAD - Select compartment first",
          body:
            "Select FORWARD, MIDDLE or AFT before selecting Gate Checks. Then choose one or multiple received Gate Checks and confirm Load.",
        },
        {
          title: "10. LOAD - Corrections",
          body:
            "If the physical operation changes, use the available correction controls such as Update Compartment, Unload to Ramp or Offload. Do not change a status only to make the report balance.",
        },
        {
          title: "11. Ask for help when status and reality do not match",
          body:
            "If the physical item is in front of you but BLCS shows the wrong prior status, stop and notify the Supervisor. The system sequence must reflect the actual handoff history.",
        },
      ],
      note:
        "Agents do not manage the Gate Check Database. Always verify the physical Gate Check before confirming an action, and never skip Gate before Ramp.",
    },
  },

  es: {
    title: "Guias Operacionales de BLCS",
    subtitle:
      "Instrucciones detalladas por funcion para vuelos regulares y operaciones Carry-On Only.",
    language: "Idioma",
    regular: "Vuelo Regular",
    carryOn: "Carry-On Only",
    supervisor: "Guia de Supervisor",
    agent: "Guia de Agente",
    quickRole: "Donde debo trabajar?",
    important: "Importante",

    regularSupervisor: {
      intro:
        "Los Supervisores controlan el ciclo del vuelo regular: verifican el vuelo, monitorean cada entrega fisica del equipaje, manejan excepciones y confirman el resultado final.",
      roleMap: [
        ["Control del vuelo", "FLIGHTS / DASHBOARD"],
        ["Supervision Counter", "COUNTER SCAN"],
        ["Supervision Gate", "GATE CONTROLLER"],
        ["Supervision Bagroom", "BAGROOM"],
        ["Supervision Aircraft / Ramp", "AIRCRAFT"],
        ["Historial del equipaje", "BAGGAGE TRACKING"],
        ["Revision final", "REPORTS"],
      ],
      steps: [
        {
          title: "1. Crear o abrir el vuelo regular correcto",
          body:
            "Verificar Flight Number, Flight Date, origen, destino, gate, aircraft/tail y status actual. Confirmar que todo el equipo trabaje en el vuelo correcto antes de comenzar los scans.",
        },
        {
          title: "2. Confirmar posiciones operacionales",
          body:
            "Confirmar quien cubre Counter, Gate Controller, Bagroom y Aircraft/Ramp. La posicion operacional determina donde debe registrarse el movimiento fisico.",
        },
        {
          title: "3. Monitorear Counter Scan",
          body:
            "Counter crea el registro inicial de Checked Bags, Gate Checks y Oversize. Revisar duplicados, alertas de wrong flight y tags que pertenezcan a otro vuelo activo.",
        },
        {
          title: "4. Monitorear Gate Controller",
          body:
            "Usar Gate Controller para equipajes y funciones relacionadas con la puerta de embarque, manifest/totals y excepciones. Resolver discrepancias antes de continuar.",
        },
        {
          title: "5. Monitorear Bagroom y receiving locations",
          body:
            "Confirmar que una pieza se registre solamente cuando llegue fisicamente. Revisar Bagroom, Oversize o Gate/Ramp receiving locations segun corresponda.",
        },
        {
          title: "6. Monitorear Aircraft / Ramp",
          body:
            "Confirmar que la pieza este fisicamente en aircraft/ramp antes de completar la accion. Revisar carga, totales, offloads y correcciones antes de finalizar.",
        },
        {
          title: "7. Usar Baggage Tracking para excepciones",
          body:
            "Buscar el Bag Tag y revisar vuelo, ubicacion, hora y empleado de cada movimiento. Tracking debe indicar el ultimo handoff fisico confirmado.",
        },
        {
          title: "8. Controlar el status del vuelo",
          body:
            "Usar OPEN, RECEIVING, LOADING y LOADED de acuerdo con la operacion real. No marcar LOADED hasta terminar carga y reconciliacion. Reopen solo cuando una correccion operacional sea necesaria.",
        },
        {
          title: "9. Revisar Reports",
          body:
            "Comparar Counter, Bagroom/Gate, Aircraft y otros totales. Investigar diferencias y equipajes pendientes antes de considerar el vuelo completo.",
        },
        {
          title: "10. Proteger el audit trail",
          body:
            "Eliminar o corregir scans modifica el historial. Hacer correcciones solamente cuando correspondan con la operacion fisica.",
        },
      ],
      note:
        "El movimiento fisico debe coincidir con el movimiento registrado en BLCS. No crear movimientos artificiales solamente para cuadrar totales.",
    },

    regularAgent: {
      intro:
        "Los Agents registran el movimiento fisico del equipaje y deben trabajar solo en la pagina correspondiente a la posicion que realmente estan cubriendo.",
      roleMap: [
        ["Counter Agent", "COUNTER SCAN"],
        ["Gate Agent", "GATE CONTROLLER"],
        ["Bagroom Agent", "BAGROOM"],
        ["Aircraft / Ramp Agent", "AIRCRAFT"],
        ["Localizar equipaje", "BAGGAGE TRACKING"],
      ],
      steps: [
        {
          title: "1. Verificar el vuelo antes de cada accion",
          body:
            "Confirmar Flight Number y fecha antes del scan. No continuar una operacion sobre el vuelo incorrecto aunque el scanner lea el barcode.",
        },
        {
          title: "2. COUNTER - Crear el registro inicial",
          body:
            "Escanear el Bag Tag y seleccionar el tipo correcto cuando aplique: Checked Bag, Gate Check u Oversize. Verificar que BLCS no muestre wrong flight o duplicate.",
        },
        {
          title: "3. GATE - Registrar operaciones de Gate",
          body:
            "Usar Gate Controller solamente para piezas fisicamente manejadas en Gate o para la funcion de Gate asignada. Confirmar Bag Tag y vuelo.",
        },
        {
          title: "4. BAGROOM - Confirmar recibo fisico",
          body:
            "No registrar Bagroom antes de tener la pieza fisicamente. Usar receiving location/cart correcto cuando aplique.",
        },
        {
          title: "5. AIRCRAFT / RAMP - Confirmar carga fisica",
          body:
            "Usar Aircraft/Ramp solamente para equipajes que realmente llegaron al avion o fueron cargados segun el workflow. No hacer pre-scan.",
        },
        {
          title: "6. Detenerse ante una alerta",
          body:
            "Si BLCS muestra duplicate, wrong flight, flight locked o status inesperado, detener la accion y contactar al Supervisor. No crear otro registro para evadir la alerta.",
        },
        {
          title: "7. Usar Tracking para localizar piezas",
          body:
            "Buscar el Bag Tag para ver la ultima ubicacion, hora y empleado registrado. El historial debe coincidir con la operacion fisica.",
        },
        {
          title: "8. Correcciones",
          body:
            "No borrar o recrear scans solamente para cuadrar totales. Informar al Supervisor si un scan se hizo incorrectamente.",
        },
      ],
      note:
        "Registrar solamente lo que tienes fisicamente. Verificar vuelo y Bag Tag antes de cada confirmacion.",
    },

    carrySupervisor: {
      intro:
        "Los Supervisores administran Setup, inventario reutilizable de Gate Checks, el flujo obligatorio Counter-Gate-Ramp-Load, excepciones y reconciliacion final.",
      roleMap: [
        ["Crear/abrir vuelo Carry-On", "FLIGHTS"],
        ["Preparar vuelo", "SETUP"],
        ["Inventario maestro", "GATE CHECK DATABASE"],
        ["Monitoreo en vivo", "TRACKING"],
        ["Reconciliacion final", "REPORT / SUMMARY"],
      ],
      steps: [
        {
          title: "1. Crear o abrir el vuelo Carry-On",
          body:
            "Confirmar Flight Number, Flight Date, ruta, gate y tail/aircraft. Carry-On permanece separado del flujo de baggage regular.",
        },
        {
          title: "2. SETUP - Cargar documentos",
          body:
            "Cargar Load Manifest y Empty Seats Report. Verificar passengers, available seats y Required Carry-Ons antes de liberar la operacion.",
        },
        {
          title: "3. SETUP - Confirmar Required Carry-Ons",
          body:
            "Required es el target operacional. Se permiten assignments adicionales y deben mostrarse como Additional sin bloquear la operacion.",
        },
        {
          title: "4. GATE CHECK DATABASE - Asignar numeros",
          body:
            "Database es una pagina separada solo para Supervisor, Duty Manager y Station Manager. Importar/agregar numeros, asignar la cantidad requerida, corregir AVAILABLE y deshabilitar numeros invalidos.",
        },
        {
          title: "5. COUNTER - Monitorear assignments",
          body:
            "Counter asigna Passenger, Seat, Gate Check Number, Weight y visual Description. Se permiten hasta 5 Gate Checks por passenger/seat. Un mismo Gate Check Number nunca debe reutilizarse en el vuelo.",
        },
        {
          title: "6. Manejo de GoShow",
          body:
            "GoShow puede crearse durante la operacion. Counter puede crearlo y Gate puede crear un Gate GoShow directamente. Un Gate GoShow debe registrarse como Gate/GoShow, no como creado en Counter.",
        },
        {
          title: "7. GATE - Handoff obligatorio antes de Ramp",
          body:
            "Todo Gate Check debe llegar a GATE_COLLECTED antes de que Ramp pueda recibirlo. Ramp ya no acepta COUNTER_ASSIGNED. Si falta una pieza en Ramp, revisar primero Gate Collection.",
        },
        {
          title: "8. GATE - Safety confirmation",
          body:
            "Para Carry-Ons aplicables, Gate confirma zip tie y que el pax fue informado de remover high-value items, medications y laptops. Stroller, Walker, Wagon, Car Seat, Booster Seat y WCHR no requieren este prompt.",
        },
        {
          title: "9. RAMP - Recibo y comentarios",
          body:
            "Ramp recibe solamente GATE_COLLECTED. Puede agregar Additional Comment cuando exista informacion operacional util; el comentario aparece en Tracking, Report y Summary.",
        },
        {
          title: "10. LOAD - Compartimento primero",
          body:
            "Seleccionar FORWARD, MIDDLE o AFT antes de seleccionar uno o multiples Gate Checks. Update Compartment, Unload to Ramp y Offload se usan solo cuando la operacion fisica lo requiere.",
        },
        {
          title: "11. TRACKING - Seguir cada Gate Check",
          body:
            "Revisar Counter Assigned, Gate Collected, Ramp Received, Aircraft Loaded y Offloaded con usuarios, timestamps, weights, Gate Notes, Ramp Comments, safety confirmation y compartment.",
        },
        {
          title: "12. REPORT / SUMMARY - Reconciliar",
          body:
            "Revisar Assigned, Required, Additional, Loaded, Remaining, Offloaded y totales Forward/Middle/Aft. Investigar todo Gate Check activo pendiente.",
        },
        {
          title: "13. Devolver Gate Checks no utilizados",
          body:
            "Al finalizar, devolver al Database solamente numeros no utilizados que permanezcan AVAILABLE. Los numeros USED quedan en historial y no se reutilizan.",
        },
      ],
      note:
        "Orden obligatorio Carry-On: Counter (o Gate GoShow) -> Gate Collected -> Ramp Received -> Aircraft Loaded. No usar una etapa posterior para compensar un handoff anterior faltante.",
    },

    carryAgent: {
      intro:
        "Los Agents registran cada handoff fisico. El orden normal es COUNTER -> GATE -> RAMP -> LOAD; un Gate GoShow comienza en Gate y continua Gate -> Ramp -> Load.",
      roleMap: [
        ["Counter Agent", "COUNTER"],
        ["Gate Agent", "GATE"],
        ["Ramp Agent", "RAMP"],
        ["Load / Aircraft Agent", "LOAD"],
      ],
      steps: [
        {
          title: "1. COUNTER - Seleccionar el vuelo correcto",
          body:
            "Confirmar el vuelo Carry-On antes de asignar. Seleccionar Passenger, Assigned Seat y Gate Check Number disponible.",
        },
        {
          title: "2. COUNTER - Registrar Weight y Description",
          body:
            "Registrar Weight y escoger la visual Gate Check Description correcta. Se permiten hasta 5 Gate Checks por passenger/seat, pero un mismo numero no puede reutilizarse.",
        },
        {
          title: "3. COUNTER - GoShow",
          body:
            "Usar GoShow para passenger o Gate Check agregado durante la operacion. Una vez asignado el numero deja de estar disponible.",
        },
        {
          title: "4. GATE - Confirmar collection fisica",
          body:
            "Localizar por Seat o Gate Check Number, comparar la pieza con Description, verificar Weight cuando corresponda y agregar Gate Note si es necesario. Marcar Collected solamente cuando Gate tenga fisicamente la pieza.",
        },
        {
          title: "5. GATE - Crear Gate GoShow",
          body:
            "Gate puede agregar un GoShow directamente sin regresar a Counter. Seleccionar passenger/seat, Gate Check Number, Weight y visual Description. Se registra como Gate/GoShow.",
        },
        {
          title: "6. GATE - Safety confirmation",
          body:
            "Para Carry-Ons aplicables, confirmar zip tie y que el pax fue informado de remover valuables, medications y laptops. No aplica a Stroller, Walker, Wagon, Car Seat, Booster Seat o WCHR.",
        },
        {
          title: "7. RAMP - Gate es obligatorio",
          body:
            "Ramp solamente puede recibir Gate Checks con status GATE_COLLECTED. Si aparece COUNTER_ASSIGNED, detenerse y contactar Gate. No existe bypass directo Counter-to-Ramp.",
        },
        {
          title: "8. RAMP - Verificar y recibir",
          body:
            "Verificar fisicamente el Gate Check Number y seleccionar Receive. Additional Comment es opcional y se usa para informacion como damage, late delivery o special handling.",
        },
        {
          title: "9. LOAD - Seleccionar compartment primero",
          body:
            "Seleccionar FORWARD, MIDDLE o AFT; luego seleccionar uno o multiples Gate Checks recibidos y confirmar Load.",
        },
        {
          title: "10. LOAD - Correcciones",
          body:
            "Usar Update Compartment, Unload to Ramp u Offload solamente cuando cambie la operacion fisica. No cambiar status solo para cuadrar reportes.",
        },
        {
          title: "11. Cuando BLCS y la operacion no coinciden",
          body:
            "Si tienes la pieza fisicamente pero BLCS muestra un status previo incorrecto, detenerse y avisar al Supervisor. El historial debe reflejar el handoff real.",
        },
      ],
      note:
        "Los Agents no administran Gate Check Database. Verificar siempre la pieza fisica antes de confirmar y nunca saltar Gate antes de Ramp.",
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

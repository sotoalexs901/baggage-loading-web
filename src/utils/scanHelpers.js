// src/utils/scanHelpers.js
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

// Valida cross-flight y crea/actualiza el índice global bagTags/{tag}
export async function validateAndIndexBagTag({ db, flightId, tag, location, zone }) {
  // 1) leer vuelo actual
  const flightRef = doc(db, "flights", flightId);
  const flightSnap = await getDoc(flightRef);
  if (!flightSnap.exists()) {
    return { ok: false, type: "FLIGHT_NOT_FOUND", message: "Flight not found." };
  }
  const flight = { id: flightSnap.id, ...flightSnap.data() };

  const flightNumber = flight.flightNumber || null;
  const flightDate = flight.flightDate || null;

  // 2) leer índice global por tag
  const tagRef = doc(db, "bagTags", tag);
  const tagSnap = await getDoc(tagRef);

  if (tagSnap.exists()) {
    const existing = tagSnap.data();

    // Si pertenece a otro vuelo → aviso
    if (existing.flightId && existing.flightId !== flightId) {
      return {
        ok: false,
        type: "WRONG_FLIGHT",
        message: `This bag tag belongs to a different flight/date.\n\nScanned flight: ${flightNumber || flightId} (${flightDate || "no date"})\nRegistered flight: ${existing.flightNumber || existing.flightId} (${existing.flightDate || "no date"})`,
        existing,
        current: { flightId, flightNumber, flightDate },
      };
    }

    // mismo vuelo, ok → actualiza lastSeen
    await setDoc(
      tagRef,
      {
        lastSeenAt: serverTimestamp(),
        lastSeenLocation: location,
        lastSeenZone: zone ?? null,
      },
      { merge: true }
    );

    return { ok: true, flight };
  }

  // 3) primera vez visto → crear índice
  await setDoc(tagRef, {
    tag,
    flightId,
    flightNumber,
    flightDate,
    firstSeenAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    lastSeenLocation: location,
    lastSeenZone: zone ?? null,
  });

  return { ok: true, flight };
}

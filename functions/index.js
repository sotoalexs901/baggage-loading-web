const functions = require("firebase-functions");
const admin = require("firebase-admin");
const vision = require("@google-cloud/vision");

admin.initializeApp();

const db = admin.firestore();
const client = new vision.ImageAnnotatorClient();

// Extrae SOLO números (bag tags) e ignora todo lo demás
function extractBagTagsFromText(text, { minLen = 6, maxLen = 12 } = {}) {
  const src = String(text || "");
  const matches = src.match(/\d+/g) || [];
  const tags = matches
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen && s.length <= maxLen);

  const seen = new Set();
  const unique = [];
  for (const t of tags) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }
  return unique;
}

exports.ocrManifestPdf = functions.storage.object().onFinalize(async (object) => {
  try {
    const filePath = object.name || "";
    const contentType = object.contentType || "";

    // Solo PDFs en /manifests/
    if (!filePath.includes("/manifests/")) return null;
    if (contentType !== "application/pdf" && !filePath.toLowerCase().endsWith(".pdf")) return null;

    const meta = object.metadata || {};
    const flightId = meta.flightId;

    if (!flightId) {
      console.log("No flightId in metadata. Skipping OCR.");
      return null;
    }

    const gcsUri = `gs://${object.bucket}/${filePath}`;

    // OCR (si el PDF es escaneado, esto es lo que lo lee)
    const [result] = await client.documentTextDetection(gcsUri);

    const fullText =
      result?.fullTextAnnotation?.text ||
      result?.textAnnotations?.[0]?.description ||
      "";

    const tags = extractBagTagsFromText(fullText, { minLen: 6, maxLen: 12 });
    console.log(`OCR tags found: ${tags.length}`);

    if (tags.length === 0) {
      await db.doc(`flights/${flightId}`).set(
        {
          ocrLastRunAt: admin.firestore.FieldValue.serverTimestamp(),
          ocrLastResult: "NO_TAGS_FOUND",
          ocrLastFile: filePath,
        },
        { merge: true }
      );
      return null;
    }

    // Importar a flights/{flightId}/allowedBagTags/{tag}
    const batchSize = 450;
    for (let i = 0; i < tags.length; i += batchSize) {
      const chunk = tags.slice(i, i + batchSize);
      const batch = db.batch();

      chunk.forEach((tag) => {
        const ref = db.doc(`flights/${flightId}/allowedBagTags/${tag}`);
        batch.set(ref, {
          tag,
          importedAt: admin.firestore.FieldValue.serverTimestamp(),
          importedBy: { via: "OCR", filePath },
        });
      });

      await batch.commit();
    }

    // Activar Strict Manifest
    await db.doc(`flights/${flightId}`).set(
      {
        strictManifest: true,
        strictManifestUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        manifestImportedAt: admin.firestore.FieldValue.serverTimestamp(),
        manifestImportedBy: { via: "OCR", filePath },
        ocrLastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        ocrLastResult: "IMPORTED",
        ocrLastFile: filePath,
        ocrTagCount: tags.length,
      },
      { merge: true }
    );

    return null;
  } catch (e) {
    console.error("OCR function error:", e);

    // (opcional) guardar error en el vuelo si tienes flightId en metadata
    try {
      const meta = object.metadata || {};
      const flightId = meta.flightId;
      if (flightId) {
        await db.doc(`flights/${flightId}`).set(
          {
            ocrLastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            ocrLastResult: "ERROR",
            ocrLastError: String(e?.message || e),
          },
          { merge: true }
        );
      }
    } catch (_) {}

    return null;
  }
});

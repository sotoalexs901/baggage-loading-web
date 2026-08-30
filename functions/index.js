// functions/index.js

const functions =
  require("firebase-functions/v1");

exports.blcsFunctionHealth =
  functions
    .region("us-east4")
    .https
    .onCall(
      async () => {
        return {
          ok: true,
          version:
            "BLCS-HEALTH-TEST-V2",
          region:
            "us-east4",
          message:
            "Backend is working.",
          timestamp:
            new Date().toISOString(),
        };
      }
    );

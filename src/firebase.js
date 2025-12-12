// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";

/**
 * Firebase config (Vite envs)
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize app
const app = initializeApp(firebaseConfig);

// Core services
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

/**
 * ✅ IMPORTANT
 * Cloud Functions MUST match the region used in functions/index.js
 * We are using: us-east4
 */
export const functions = getFunctions(app, "us-east4");

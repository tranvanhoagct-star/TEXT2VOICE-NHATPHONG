import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, doc, getDocFromServer } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAkqMuxYwW5LEA1QbnTJoRoP5YZBO_29iU",
  authDomain: "perfect-hall-fhh41.firebaseapp.com",
  projectId: "perfect-hall-fhh41",
  storageBucket: "perfect-hall-fhh41.firebasestorage.app",
  messagingSenderId: "716563054238",
  appId: "1:716563054238:web:4f9b8c64dd01fbce25c58f"
};

const databaseId = "ai-studio-texttospeechwith-d628ed4c-d306-4d6b-bdb3-6eb5328a414d";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase services with custom database ID
export const auth = getAuth(app);
export const db = getFirestore(app, databaseId);

// Sign in anonymously to secure the session and rules
export async function initAuth() {
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    return auth.currentUser;
  } catch (error) {
    console.error("Firebase auth login failed:", error);
    return null;
  }
}

// Validate connection to Firestore as requested by firebase-integration skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

// Run connection test
testConnection();

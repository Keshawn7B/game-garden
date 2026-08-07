import { getApp, getApps, initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { browserLocalPersistence, getAuth, GoogleAuthProvider, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAi5t4zHcCG1AOeFi2Uye3cwKqXNNHV1PU",
  authDomain: "game-garden-658de.firebaseapp.com",
  projectId: "game-garden-658de",
  storageBucket: "game-garden-658de.firebasestorage.app",
  messagingSenderId: "458019129487",
  appId: "1:458019129487:web:e269fb303b11a8762f48fa",
  measurementId: "G-48Z99Z56VY",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY?.trim();
if (typeof window !== "undefined" && appCheckSiteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (!code.includes("already-initialized")) throw error;
  }
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({ prompt: "select_account" });
void setPersistence(auth, browserLocalPersistence).catch(() => undefined);

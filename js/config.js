// Firebase web config for the "Mission Charts" app inside the
// "Brookhouser Family Apps" project. Paste the real values here
// (see SETUP.md). Leave the YOUR_* placeholders and the site stays
// in preview mode: sample routines, a sign-in picker, and a fake clock.
// Nothing is sent to Firebase until every placeholder is replaced.

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// Top-level Firestore collections. Other family apps share this
// database and must use their own prefix, not missionCharts_.
export const COLLECTIONS = {
  routines: "missionCharts_routines",
  days: "missionCharts_days",
};

export function isFirebaseConfigured(config = firebaseConfig) {
  const values = [
    config.apiKey,
    config.authDomain,
    config.projectId,
    config.appId,
  ];
  return values.every((value) => {
    const text = String(value || "").trim();
    return text.length > 0 && !text.includes("YOUR_");
  });
}

export function shouldUseDemo() {
  const params =
    typeof location !== "undefined"
      ? new URLSearchParams(location.search)
      : new URLSearchParams();
  if (params.get("demo") === "1") return true;
  return !isFirebaseConfigured();
}

import { COLLECTIONS, firebaseConfig, shouldUseDemo } from "./config.js";
import { personByEmail } from "./people.js";
import { defaultRoutineMap, buildDemoDays } from "./seed.js";

const DEMO_KEY = "missionCharts.demo.v1";

function emptyCache() {
  return { routines: defaultRoutineMap(), days: {} };
}

export async function createBackend(hooks) {
  if (shouldUseDemo()) return createDemoBackend(hooks);
  try {
    return await createFirebaseBackend(hooks);
  } catch (error) {
    console.error(error);
    hooks.onError(
      "Firebase didn’t start. Check js/config.js. Preview mode still works at ?demo=1.",
    );
    hooks.onUser(null);
    return createDemoBackend(hooks, { failedLive: true });
  }
}

function createDemoBackend(hooks, { failedLive = false } = {}) {
  let data = loadDemo();

  function now() {
    if (data.fakeOffset == null) return Date.now();
    return Date.now() + data.fakeOffset;
  }

  function emit() {
    hooks.onData({
      routines: structuredClone(data.routines),
      days: structuredClone(data.days),
    });
  }

  function persist() {
    localStorage.setItem(
      DEMO_KEY,
      JSON.stringify({
        version: 1,
        userEmail: data.userEmail,
        fakeOffset: data.fakeOffset,
        routines: data.routines,
        days: data.days,
      }),
    );
  }

  const user = data.userEmail ? personByEmail(data.userEmail) : null;
  hooks.onUser(user);
  emit();

  return {
    mode: "demo",
    failedLive,
    now,
    isFakeClock: () => data.fakeOffset != null,
    setFakeNow(ms) {
      data.fakeOffset = ms == null ? null : ms - Date.now();
      persist();
      emit();
    },
    async signIn(email) {
      const person = personByEmail(email);
      if (!person) {
        hooks.onError("That account isn’t on the family list.");
        return;
      }
      data.userEmail = person.email;
      persist();
      hooks.onUser(person);
      emit();
    },
    async signOut() {
      data.userEmail = null;
      persist();
      hooks.onUser(null);
    },
    async setCheck(kidId, date, taskId, on) {
      const id = `${kidId}_${date}`;
      const day = data.days[id] || { kidId, date, checks: {} };
      const checks = { ...(day.checks || {}) };
      if (on) checks[taskId] = now();
      else delete checks[taskId];
      data.days[id] = { ...day, kidId, date, checks, updatedAt: Date.now() };
      persist();
      emit();
    },
    async setSchoolDay(kidId, date, schoolDay) {
      const id = `${kidId}_${date}`;
      const day = data.days[id] || { kidId, date, checks: {} };
      data.days[id] = {
        ...day,
        kidId,
        date,
        checks: day.checks || {},
        schoolDay,
        updatedAt: Date.now(),
      };
      persist();
      emit();
    },
    async setScore(kidId, date, score, actorEmail) {
      const id = `${kidId}_${date}`;
      const day = data.days[id] || { kidId, date, checks: {} };
      const next = {
        ...day,
        kidId,
        date,
        checks: day.checks || {},
        tierStatus: score.tierStatus,
        scoredBy: actorEmail,
        scoredAt: now(),
        updatedAt: Date.now(),
      };
      if (score.tierStatus === "confirmed") next.tier = score.tier;
      else delete next.tier;
      data.days[id] = next;
      persist();
      emit();
    },
    async saveRoutine(routine) {
      data.routines[routine.id] = {
        id: routine.id,
        kidId: routine.kidId,
        period: routine.period,
        sections: routine.sections,
        updatedAt: Date.now(),
      };
      persist();
      emit();
    },
    async resetDemo() {
      const email = data.userEmail;
      data = freshDemo();
      data.userEmail = email;
      persist();
      emit();
    },
    watchLive() {},
    async refreshHistory() {},
  };
}

function freshDemo() {
  return {
    version: 1,
    userEmail: null,
    fakeOffset: null,
    routines: defaultRoutineMap(),
    days: buildDemoDays(Date.now()),
  };
}

function loadDemo() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return freshDemo();
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || !parsed.routines || !parsed.days) return freshDemo();
    return {
      version: 1,
      userEmail: parsed.userEmail || null,
      fakeOffset: Number.isFinite(parsed.fakeOffset) ? parsed.fakeOffset : null,
      routines: { ...defaultRoutineMap(), ...parsed.routines },
      days: parsed.days,
    };
  } catch {
    return freshDemo();
  }
}

async function createFirebaseBackend(hooks) {
  const { initializeApp } = await import(
    "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js"
  );
  const authMod = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
  const fs = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");

  const app = initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  await authMod.setPersistence(auth, authMod.browserLocalPersistence);

  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
  } catch {
    db = fs.getFirestore(app);
  }

  const cache = emptyCache();
  let pending = 0;
  let liveUnsubs = [];
  let liveKey = "";
  let queue = Promise.resolve();
  let currentEmail = null;

  function emit() {
    hooks.onData({
      routines: structuredClone(cache.routines),
      days: structuredClone(cache.days),
    });
  }

  function enqueue(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  function friendlyAuth(error) {
    const code = error?.code || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      return "Sign-in was cancelled.";
    }
    if (code === "auth/unauthorized-domain") {
      return "Add brookhouser.github.io under Firebase Authentication → Authorized domains.";
    }
    if (code === "auth/operation-not-allowed") {
      return "Turn on Google as a sign-in provider in Firebase Authentication.";
    }
    if (code === "auth/popup-blocked") {
      return "The sign-in popup was blocked. Allow popups, or try again.";
    }
    return "Sign-in didn’t go through. Try again.";
  }

  async function pullDay(id) {
    const snap = await fs.getDoc(fs.doc(db, COLLECTIONS.days, id));
    if (snap.exists()) cache.days[id] = snap.data();
    else delete cache.days[id];
    emit();
  }

  function applyUser(firebaseUser) {
    if (!firebaseUser) {
      currentEmail = null;
      hooks.onUser(null);
      return;
    }
    const person = personByEmail(firebaseUser.email);
    if (!person) {
      currentEmail = null;
      authMod.signOut(auth);
      hooks.onError("That Google account isn’t on the family list.");
      hooks.onUser(null);
      return;
    }
    currentEmail = person.email;
    hooks.onUser({ ...person, uid: firebaseUser.uid });
    listenRoutines(person);
  }

  function listenRoutines(person) {
    const ids =
      person.role === "admin"
        ? ["sam_morning", "sam_evening", "wally_morning", "wally_evening"]
        : [`${person.kidId}_morning`, `${person.kidId}_evening`];
    for (const id of ids) {
      fs.onSnapshot(
        fs.doc(db, COLLECTIONS.routines, id),
        (snap) => {
          if (snap.exists()) {
            cache.routines[id] = { id, ...snap.data() };
          } else {
            cache.routines[id] = defaultRoutineMap()[id];
          }
          emit();
        },
        () => {
          hooks.onError("Couldn’t read routines. Check that Firestore rules are published.");
        },
      );
    }
  }

  authMod.onAuthStateChanged(auth, (firebaseUser) => {
    applyUser(firebaseUser);
  });

  try {
    await authMod.getRedirectResult(auth);
  } catch (error) {
    hooks.onError(friendlyAuth(error));
  }

  return {
    mode: "live",
    failedLive: false,
    now: () => Date.now(),
    isFakeClock: () => false,
    setFakeNow() {},
    async signIn() {
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (error) {
        if (error?.code === "auth/popup-blocked") {
          await authMod.signInWithRedirect(auth, provider);
          return;
        }
        hooks.onError(friendlyAuth(error));
      }
    },
    async signOut() {
      await authMod.signOut(auth);
    },
    async setCheck(kidId, date, taskId, on) {
      return enqueue(async () => {
        const id = `${kidId}_${date}`;
        const existing = cache.days[id] || { kidId, date, checks: {} };
        const checks = { ...(existing.checks || {}) };
        const ts = Date.now();
        if (on) checks[taskId] = ts;
        else delete checks[taskId];
        cache.days[id] = { ...existing, kidId, date, checks, updatedAt: ts };
        pending += 1;
        emit();
        try {
          const ref = fs.doc(db, COLLECTIONS.days, id);
          const snap = await fs.getDoc(ref);
          if (!snap.exists()) {
            if (on) {
              await fs.setDoc(ref, { kidId, date, checks: { [taskId]: ts }, updatedAt: ts });
            }
          } else if (on) {
            await fs.updateDoc(ref, { [`checks.${taskId}`]: ts, updatedAt: ts });
          } else {
            await fs.updateDoc(ref, {
              [`checks.${taskId}`]: fs.deleteField(),
              updatedAt: ts,
            });
          }
        } catch (error) {
          console.error(error);
          hooks.onError("Couldn’t save that check. The rules or the connection said no.");
        } finally {
          pending -= 1;
          if (pending === 0) await pullDay(id);
        }
      });
    },
    async setSchoolDay(kidId, date, schoolDay) {
      return enqueue(async () => {
        const id = `${kidId}_${date}`;
        const existing = cache.days[id];
        const ts = Date.now();
        cache.days[id] = {
          ...(existing || { checks: {} }),
          kidId,
          date,
          schoolDay,
          updatedAt: ts,
        };
        pending += 1;
        emit();
        try {
          const payload = { kidId, date, schoolDay, updatedAt: ts };
          if (!existing) payload.checks = {};
          await fs.setDoc(fs.doc(db, COLLECTIONS.days, id), payload, { merge: true });
        } catch (error) {
          console.error(error);
          hooks.onError("Couldn’t update the school day.");
        } finally {
          pending -= 1;
          if (pending === 0) await pullDay(id);
        }
      });
    },
    async setScore(kidId, date, score, actorEmail) {
      return enqueue(async () => {
        const id = `${kidId}_${date}`;
        const existing = cache.days[id];
        const ts = Date.now();
        const next = {
          ...(existing || { checks: {} }),
          kidId,
          date,
          tierStatus: score.tierStatus,
          scoredBy: actorEmail || currentEmail,
          scoredAt: ts,
          updatedAt: ts,
        };
        if (score.tierStatus === "confirmed") next.tier = score.tier;
        else delete next.tier;
        cache.days[id] = next;
        pending += 1;
        emit();
        try {
          const payload = {
            kidId,
            date,
            tierStatus: score.tierStatus,
            scoredBy: actorEmail || currentEmail || "",
            scoredAt: ts,
            updatedAt: ts,
          };
          if (!existing) payload.checks = {};
          if (score.tierStatus === "confirmed") payload.tier = score.tier;
          else payload.tier = fs.deleteField();
          await fs.setDoc(fs.doc(db, COLLECTIONS.days, id), payload, { merge: true });
        } catch (error) {
          console.error(error);
          hooks.onError("Couldn’t save the tier. Only a parent account can set it.");
        } finally {
          pending -= 1;
          if (pending === 0) await pullDay(id);
        }
      });
    },
    async saveRoutine(routine) {
      const payload = {
        kidId: routine.kidId,
        period: routine.period,
        sections: routine.sections,
        updatedAt: Date.now(),
      };
      cache.routines[routine.id] = { id: routine.id, ...payload };
      emit();
      try {
        await fs.setDoc(fs.doc(db, COLLECTIONS.routines, routine.id), payload);
      } catch (error) {
        console.error(error);
        hooks.onError("Couldn’t save the routine. Only a parent account can edit it.");
      }
    },
    async resetDemo() {},
    watchLive(kidIds, dates) {
      const key = `${kidIds.join(",")}|${dates.join(",")}`;
      if (key === liveKey) return;
      liveKey = key;
      for (const unsub of liveUnsubs) unsub();
      liveUnsubs = [];
      for (const kidId of kidIds) {
        for (const date of dates) {
          const id = `${kidId}_${date}`;
          const unsub = fs.onSnapshot(
            fs.doc(db, COLLECTIONS.days, id),
            (snap) => {
              if (pending > 0) return;
              if (snap.exists()) cache.days[id] = snap.data();
              else delete cache.days[id];
              emit();
            },
            () => {
              hooks.onError("Couldn’t read the day. Check Firestore rules.");
            },
          );
          liveUnsubs.push(unsub);
        }
      }
    },
    async refreshHistory(kidIds, dates) {
      await Promise.all(
        kidIds.flatMap((kidId) =>
          dates.map(async (date) => {
            const id = `${kidId}_${date}`;
            try {
              const snap = await fs.getDoc(fs.doc(db, COLLECTIONS.days, id));
              if (snap.exists()) cache.days[id] = snap.data();
            } catch (error) {
              console.error(error);
            }
          }),
        ),
      );
      if (pending === 0) emit();
    },
  };
}

import { shouldUseDemo } from "./config.js";
import { PEOPLE, personName } from "./people.js";
import { defaultRoutineMap } from "./seed.js";
import { createBackend } from "./store.js";
import * as L from "./logic.js";

const RING_R = 52;
const RING_CIRC = 2 * Math.PI * RING_R;

const DUE_KINDS = [
  ["clock", "Clock time"],
  ["ready", "Ready by 7:25"],
  ["bedtime", "Tonight's bedtime"],
  ["beforeBed", "Minutes before bedtime"],
  ["winddown", "Winddown start"],
  ["beforeWinddown", "Minutes before winddown"],
];

const PRESETS = [
  ["6:32 AM · morning", 6, 32],
  ["7:40 AM · morning closed", 7, 40],
  ["4:10 PM · before dinner", 16, 10],
  ["8:02 PM · winddown", 20, 2],
  ["9:45 PM · bedtime", 21, 45],
  ["11:20 PM · late", 23, 20],
];

const state = {
  user: null,
  authReady: false,
  error: "",
  notice: "",
  routines: null,
  days: {},
  pinnedDate: null,
  sheet: null,
  flash: false,
  draft: null,
  dirty: false,
  editNonce: 0,
};

let backend = null;
let booted = false;
let lastKey = "";
let historyKey = "";
let watchKey = "";
let frameQueued = false;

const app = document.querySelector("#app");

function invalidate() {
  lastKey = "";
  if (frameQueued) return;
  frameQueued = true;
  queueMicrotask(() => {
    frameQueued = false;
    frame();
  });
}

function frame() {
  if (!backend) return;
  const key = signature();
  if (key === lastKey) {
    patchLive();
    return;
  }
  const active = document.activeElement;
  if (active?.matches?.("input, textarea, select") && active.closest("[data-editor]")) {
    return;
  }
  lastKey = key;
  render();
  syncLiveData();
}

function signature() {
  const route = currentRoute();
  const now = backend.now();
  if (route.name === "edit" && state.user?.role === "admin") {
    return JSON.stringify({
      edit: route.id,
      nonce: state.editNonce,
      user: state.user.email,
      err: state.error,
      notice: state.notice,
      sheet: state.sheet,
    });
  }
  return JSON.stringify({
    user: state.user?.email || "",
    ready: state.authReady,
    err: state.error,
    route: location.hash,
    sheet: state.sheet,
    minute: Math.floor(now / 60000),
    fake: backend.isFakeClock() ? 1 : 0,
    pinned: state.pinnedDate,
    flash: state.flash,
    days: state.days,
    routines: state.routines,
  });
}

function currentRoute() {
  const parts = (location.hash || "#/").replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] === "tasks") return { name: "tasks" };
  if (parts[0] === "history") return { name: "history" };
  if (parts[0] === "edit") return { name: "edit", id: parts[1] || "sam_morning" };
  return { name: "home" };
}

function routineOf(id) {
  return state.routines?.[id] || defaultRoutineMap()[id];
}

function modelFor(kidId, viewDate, realNow) {
  const instant = L.instantForChartDate(viewDate, realNow);
  const day = state.days[L.dayId(kidId, viewDate)] || null;
  return L.suggestDay({
    kidId,
    schoolDay: L.isSchoolDay(viewDate, day),
    morningRoutine: routineOf(`${kidId}_morning`),
    eveningRoutine: routineOf(`${kidId}_evening`),
    day,
    now: instant,
  });
}

function render() {
  const now = backend.now();
  const route = guardedRoute();
  applyTheme(now);
  app.innerHTML = page(route, now);
  app.classList.toggle("just-checked", state.flash);
  for (const row of app.querySelectorAll("[data-task]")) applyKindVisibility(row);
}

function guardedRoute() {
  const route = currentRoute();
  if (state.user?.role === "kid" && (route.name === "history" || route.name === "edit")) {
    return { name: "home" };
  }
  return route;
}

function applyTheme(now) {
  let theme = "day";
  if (state.user) {
    const kidId = state.user.kidId || "sam";
    const today = L.chartContext(now).date;
    const phase = modelFor(kidId, today, now).phase;
    if (phase === "winddown") theme = "winddown";
    else if (phase === "evening" || phase === "bedtime") theme = "evening";
  } else if (new Date(now).getHours() >= 17) {
    theme = "evening";
  }
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "day" ? "#efe6d6" : "#14161c");
}

function page(route, now) {
  if (!state.authReady) {
    return `<main class="gate"><p class="wordmark">Mission Charts</p><h1>Loading…</h1></main>`;
  }
  if (!state.user) return signedOut();
  const chart = L.chartContext(now);
  if (state.user.role === "kid") {
    const model = modelFor(state.user.kidId, chart.date, now);
    const body = route.name === "tasks" ? tasksHtml(model, state.user.kidId, chart.date, false) : focusHtml(model, state.user.kidId);
    return layout({
      now,
      admin: false,
      body,
      nav: navHtml([
        ["#/", "Now", route.name === "home"],
        ["#/tasks", "Tasks", route.name === "tasks"],
      ]),
    });
  }
  const viewDate = state.pinnedDate || chart.date;
  let body = "";
  if (route.name === "history") body = historyHtml(chart.date);
  else if (route.name === "edit") body = editorHtml(route.id);
  else body = boardHtml(viewDate, now, chart.date);
  return layout({
    now,
    admin: true,
    body,
    nav: navHtml([
      ["#/", "Today", route.name === "home"],
      ["#/history", "History", route.name === "history"],
      ["#/edit", "Routines", route.name === "edit"],
    ]),
  });
}

function layout({ now, admin, body, nav }) {
  return `
    ${demoBar(now)}
    <div class="frame ${admin ? "wide" : ""}">
      ${state.error ? `<p class="error" role="status">${L.esc(state.error)} <button data-action="dismiss-error">Dismiss</button></p>` : ""}
      ${state.notice ? `<p class="notice" role="status">${L.esc(state.notice)}</p>` : ""}
      ${body}
    </div>
    ${nav}
    ${state.sheet === "clock" ? clockSheet(now) : ""}
  `;
}

function demoBar(now) {
  if (!state.user || backend.mode !== "demo") return "";
  const label = backend.isFakeClock() ? `${L.formatClock(now)} · pretend` : "Clock";
  return `
    <div class="demo-bar">
      <span>Preview</span>
      <span class="demo-actions">
        <button data-action="open-sheet" data-testid="clock-button">${L.esc(label)}</button>
        <button data-action="sign-out">Switch</button>
      </span>
    </div>
  `;
}

function signedOut() {
  const preview = backend.mode === "demo";
  const people = PEOPLE.map(
    (person) => `
      <button class="person" data-action="demo-sign-in" data-email="${L.esc(person.email)}" data-testid="sign-in-${person.role === "kid" ? person.kidId : person.name.toLowerCase()}">
        <span class="person-name">${L.esc(person.name)}</span>
        <span class="person-role">${person.role === "kid" ? "Kid · their chart only" : "Parent · both boys"}</span>
      </button>`,
  ).join("");
  return `
    <main class="gate">
      <p class="wordmark">Mission Charts</p>
      <h1>Morning and evening, on the clock.</h1>
      <p class="lede">Sam and Wally. Out of bed by 6:40, ready by 7:25, bedtime set by how the day went.</p>
      ${state.error ? `<p class="error">${L.esc(state.error)}</p>` : ""}
      ${
        preview
          ? `<div class="people">${people}</div>
             <p class="fine">Preview mode keeps sample days on this phone. Use Clock after you sign in to pretend it’s 6:32 AM or winddown. Nothing here is shared until Firebase is connected.</p>`
          : `<button class="done google" data-action="google-sign-in">Continue with Google</button>
             <p class="fine">Use a family Google account. Other accounts are turned away.</p>
             ${backend.failedLive ? `<p class="fine"><a href="?demo=1">Open preview mode</a></p>` : ""}`
      }
    </main>
  `;
}

function focusHtml(model, kidId) {
  const name = kidId === "sam" ? "Sam" : "Wally";
  return `
    <main class="shell">
      ${topHtml(name, model, model.chart.date)}
      ${dealHtml(model, kidId)}
      <section class="hero" data-testid="hero">
        ${heroHtml(model.hero)}
      </section>
      ${dealDetails(kidId)}
      ${liveSignOut()}
    </main>
  `;
}

function topHtml(name, model, dateStr) {
  const { status } = model;
  return `
    <header class="top">
      <div>
        <p class="eyebrow">${L.esc(L.formatDayLabel(dateStr))} · <span data-live="clock">${L.esc(L.formatClock(backend.now()))}</span></p>
        <h1>${L.esc(name)}</h1>
      </div>
      <div class="pill" data-letter="${L.esc(status.letter)}" data-kind="${L.esc(status.kind)}">
        <span class="pill-letter" data-testid="tier-letter">${L.esc(status.letter)}</span>
        <span class="pill-label">${L.esc(status.label)}</span>
      </div>
    </header>
  `;
}

function dealHtml(model, kidId) {
  const bed = L.formatDue(model.bedtime);
  const note = footnote(model);
  const sub =
    kidId === "wally"
      ? `Winddown ${L.formatDue(model.winddown)} · screens off`
      : "Screens OK until bedtime";
  return `
    <section class="deal">
      <p data-testid="bedtime">Bedtime <strong>${L.esc(bed)}</strong></p>
      <p data-testid="winddown">${L.esc(sub)}</p>
      ${note ? `<p class="note">${L.esc(note)}</p>` : ""}
    </section>
  `;
}

function footnote(model) {
  const { status, suggestion } = model;
  if (status.kind === "waived") return "No penalty tonight. Bedtime stays at the S time.";
  if (status.kind === "confirmed") return "";
  if (suggestion === "pending") return "";
  if (suggestion === "S") return "Waiting on a parent to confirm.";
  return `Suggested ${status.letter}. Bedtime stays put until a parent sets it.`;
}

function heroHtml(hero) {
  const banner = hero.banner
    ? `<p class="banner" data-testid="phase-banner">${L.esc(hero.banner)}</p>`
    : "";
  const detail = hero.detail ? `<p class="detail">${L.esc(hero.detail)}</p>` : "";
  const extra = hero.extra ? `<p class="detail muted">${L.esc(hero.extra)}</p>` : "";
  const face = hero.countdownTo == null ? "" : clockFace(hero);
  const done = hero.allowDone
    ? `<button class="done" data-action="check-next" data-testid="done">Done</button>`
    : "";
  const preview = hero.preview ? previewHtml(hero.preview) : "";
  return `
    ${banner}
    <p class="kicker">${L.esc(hero.kicker || "")}</p>
    <h2 data-testid="hero-title">${L.esc(hero.title)}</h2>
    ${detail}
    ${face}
    ${extra}
    ${done}
    ${preview}
    ${progressHtml(hero.progress)}
  `;
}

function clockFace(hero) {
  const nowMin = L.chartContext(backend.now()).minutes;
  const delta = L.formatDelta(hero.countdownTo, nowMin);
  const frac = L.ringFraction(hero.countdownTo, nowMin);
  const offset = RING_CIRC * (1 - frac);
  return `
    <p class="due-line">${L.esc(hero.countdownLabel || "")}</p>
    <div class="clockface ${delta.late ? "late" : ""}">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="${RING_R}" class="ring-track"></circle>
        <circle cx="60" cy="60" r="${RING_R}" class="ring-value" data-live="ring"
          data-due="${hero.countdownTo}" data-circ="${RING_CIRC}"
          stroke-dasharray="${RING_CIRC}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <p class="ring-label ${delta.late ? "late" : ""}" data-live="delta" data-due="${hero.countdownTo}" data-testid="countdown">${L.esc(delta.text)}</p>
    </div>
  `;
}

function previewHtml(preview) {
  const section = preview.sectionTitle === "Checklist" ? "Evening" : preview.sectionTitle;
  return `
    <section class="preview">
      <p class="kicker">Up next · ${L.esc(section)}</p>
      <h3>${L.esc(preview.title)}</h3>
      <p>Due ${L.esc(L.formatDue(preview.dueMin))}</p>
    </section>
  `;
}

function progressHtml(progress) {
  if (!progress?.total) return "";
  const pct = Math.round((progress.done / progress.total) * 100);
  return `
    <div class="progress">
      <div class="bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <p>${L.esc(progress.label)} · ${progress.done} of ${progress.total}</p>
    </div>
  `;
}

function dealDetails(kidId) {
  if (kidId === "sam") {
    return `
      <details class="how">
        <summary>How tonight works</summary>
        <ul>
          <li><b>S</b> on time, on your own · 9:30</li>
          <li><b>A</b> on time, needed reminders · 9:15</li>
          <li><b>B</b> lots of reminders and still late · 9:00</li>
        </ul>
        <p>Morning and evening together. Screens stay OK until bedtime. A parent sets the tier. You don’t.</p>
      </details>
    `;
  }
  return `
    <details class="how">
      <summary>How tonight works</summary>
      <ul>
        <li><b>S</b> on time, on your own · 8:30, winddown 8:00</li>
        <li><b>A</b> on time, needed reminders · 8:15, winddown 7:45</li>
        <li><b>B</b> lots of reminders and still late · 8:00, winddown 7:30</li>
      </ul>
      <p>Winddown starts 30 minutes before bedtime. Screens off. A parent sets the tier. You don’t.</p>
    </details>
  `;
}

function tasksHtml(model, kidId, date, admin) {
  const blocks = [];
  if (!model.schoolDay) {
    blocks.push(`<p class="day-note">No school morning. These don’t count unless a parent turns school on.</p>`);
  }
  blocks.push(taskGroup("Morning", model.morningTasks, kidId, date, !model.schoolDay, model.chart.minutes));
  blocks.push(taskGroup("Evening", model.eveningTasks, kidId, date, false, model.chart.minutes));
  const title = admin ? "" : `<header class="top"><div><p class="eyebrow">Checklist</p><h1>${kidId === "sam" ? "Sam" : "Wally"}</h1></div></header>`;
  return `<main class="shell">${title}${blocks.join("")}${admin ? "" : liveSignOut()}</main>`;
}

function taskGroup(label, tasks, kidId, date, dim, nowMin) {
  const sections = [];
  let current = null;
  for (const task of tasks) {
    if (!current || current.title !== task.sectionTitle) {
      current = { title: task.sectionTitle, tasks: [] };
      sections.push(current);
    }
    current.tasks.push(task);
  }
  const body = sections
    .map(
      (section) => `
        <section class="group ${dim ? "dim" : ""}">
          <h2>${L.esc(section.title)}</h2>
          ${section.tasks.map((task) => taskRow(task, kidId, date, nowMin)).join("")}
        </section>`,
    )
    .join("");
  return `<h3 class="period">${L.esc(label)}</h3>${body}`;
}

function taskRow(task, kidId, date, nowMin) {
  const late = !task.checked && L.isPast(nowMin, task.dueMin);
  const meta = task.checked
    ? `Checked ${L.esc(L.formatClock(task.checkedAt))}`
    : late
      ? `Overdue · was due ${L.esc(L.formatDue(task.dueMin))}`
      : `Due ${L.esc(L.formatDue(task.dueMin))}`;
  return `
    <button class="row ${task.checked ? "checked" : ""} ${late ? "late" : ""}" data-action="toggle" data-kid="${L.esc(kidId)}" data-date="${L.esc(date)}" data-task="${L.esc(task.id)}" aria-pressed="${task.checked ? "true" : "false"}">
      <span class="box" aria-hidden="true"></span>
      <span class="row-copy">
        <span class="row-title">${L.esc(task.title)}</span>
        <span class="row-meta">${meta}</span>
      </span>
    </button>
  `;
}

function boardHtml(viewDate, now, today) {
  const sam = modelFor("sam", viewDate, now);
  const wally = modelFor("wally", viewDate, now);
  const yesterday = L.addDays(today, -1);
  const showGap = viewDate === today && (!scored(state.days[L.dayId("sam", yesterday)]) || !scored(state.days[L.dayId("wally", yesterday)]));
  return `
    <main class="shell">
      <header class="top admin-top">
        <div>
          <p class="wordmark">Mission Charts</p>
          <h1>${L.esc(L.formatDayLabel(viewDate))}</h1>
          <p class="eyebrow"><span data-live="clock">${L.esc(L.formatClock(now))}</span>${viewDate === today ? " · today" : ""}</p>
        </div>
        <div class="date-nav">
          <button data-action="pin-prev" aria-label="Previous day">←</button>
          <button data-action="pin-today" ${viewDate === today ? "disabled" : ""}>Today</button>
          <button data-action="pin-next" aria-label="Next day" ${viewDate >= today ? "disabled" : ""}>→</button>
        </div>
      </header>
      ${showGap ? `<button class="gap" data-action="open-day" data-date="${yesterday}">Last night isn’t scored yet</button>` : ""}
      <div class="board">
        ${kidCard("sam", "Sam", sam, viewDate, today)}
        ${kidCard("wally", "Wally", wally, viewDate, today)}
      </div>
      ${liveSignOut()}
    </main>
  `;
}

function scored(day) {
  return day?.tierStatus === "confirmed" || day?.tierStatus === "waived";
}

function kidCard(kidId, name, model, viewDate, today) {
  const day = state.days[L.dayId(kidId, viewDate)] || null;
  const morning = L.routineSummary(model.morningTasks, model.chart.minutes);
  const evening = L.routineSummary(model.eveningTasks, model.chart.minutes);
  const streak = L.sStreak(state.days, kidId, today);
  const by = day?.scoredBy ? personName(day.scoredBy) : "";
  return `
    <article class="card" data-testid="admin-${kidId}">
      <header class="card-top">
        <h2>${L.esc(name)}</h2>
        ${schoolToggle(kidId, model.schoolDay)}
      </header>
      <p class="card-tier" data-letter="${L.esc(model.status.letter)}">
        <strong>${L.esc(model.status.letter)}</strong>
        ${L.esc(model.status.label)} · bed ${L.esc(L.formatDue(model.bedtime))}
        ${kidId === "wally" ? ` · winddown ${L.esc(L.formatDue(model.winddown))}` : ""}
      </p>
      ${by ? `<p class="muted">Set by ${L.esc(by)}</p>` : ""}
      ${routineBlock("Morning", morning, { off: !model.schoolDay })}
      ${routineBlock("Evening", evening)}
      <div class="scores">${scoreButtons(kidId, day)}</div>
      <p class="streak" data-testid="streak-${kidId}">S streak ${streak}</p>
      <div class="dots">${dotsHtml(kidId, today)}</div>
      <details class="fix">
        <summary>Fix a check</summary>
        ${taskGroup("Morning", model.morningTasks, kidId, viewDate, !model.schoolDay, model.chart.minutes)}
        ${taskGroup("Evening", model.eveningTasks, kidId, viewDate, false, model.chart.minutes)}
      </details>
    </article>
  `;
}

function schoolToggle(kidId, school) {
  return `
    <div class="segment" role="group" aria-label="School day">
      <button data-action="school" data-kid="${kidId}" data-value="1" class="${school ? "on" : ""}">School</button>
      <button data-action="school" data-kid="${kidId}" data-value="0" class="${school ? "" : "on"}">Off</button>
    </div>
  `;
}

function routineBlock(title, summary, { off = false } = {}) {
  if (off) {
    return `<section class="block"><header><h3>${title}</h3></header><p class="muted">No school morning</p></section>`;
  }
  const next = summary.next;
  const overdueIds = new Set(summary.overdue.map((task) => task.id));
  let line = `<p class="ok">All done</p>`;
  if (next) {
    const over = overdueIds.has(next.id);
    line = `
      <p class="nextline"><span>${over ? "Overdue" : "Next"}</span> ${L.esc(next.title)}</p>
      <p class="meta">${over ? "Was due" : "Due"} ${L.esc(L.formatDue(next.dueMin))}</p>
    `;
  }
  const extra =
    summary.overdue.length > 1 ? `<p class="over">${summary.overdue.length} overdue</p>` : "";
  return `
    <section class="block">
      <header><h3>${title}</h3><span>${summary.done}/${summary.total}</span></header>
      ${line}
      ${extra}
    </section>
  `;
}

function scoreButtons(kidId, day) {
  const confirmed = day?.tierStatus === "confirmed" ? day.tier : "";
  const waived = day?.tierStatus === "waived";
  const tiers = ["S", "A", "B"]
    .map((tier) => {
      const bed = L.formatDue(L.bedtimeMinutes(kidId, tier));
      return `<button class="score ${confirmed === tier ? "on" : ""}" data-action="score" data-kid="${kidId}" data-tier="${tier}"><span>${tier}</span><small>${L.esc(bed)}</small></button>`;
    })
    .join("");
  return `${tiers}<button class="score waive ${waived ? "on" : ""}" data-action="score" data-kid="${kidId}" data-tier="waive"><span>Waive</span><small>clear</small></button>`;
}

function dotsHtml(kidId, today) {
  return L.recentDates(today, 7)
    .map((date) => {
      const day = state.days[L.dayId(kidId, date)];
      let mark = "·";
      if (day?.tierStatus === "waived") mark = "W";
      else if (day?.tierStatus === "confirmed" && day.tier) mark = day.tier;
      const label = L.formatDayLabel(date, { weekday: "short" });
      return `<button class="dot" data-letter="${L.esc(mark)}" data-action="open-day" data-date="${date}" aria-label="${L.esc(label)} ${L.esc(mark)}">${L.esc(mark)}</button>`;
    })
    .join("");
}

function historyHtml(today) {
  const dates = L.recentDates(today, 14, { includeToday: true }).reverse();
  return `
    <main class="shell">
      <header class="top">
        <div>
          <p class="wordmark">Mission Charts</p>
          <h1>History</h1>
        </div>
      </header>
      <div class="board">
        ${historyColumn("sam", "Sam", dates, today)}
        ${historyColumn("wally", "Wally", dates, today)}
      </div>
    </main>
  `;
}

function historyColumn(kidId, name, dates, today) {
  const streak = L.sStreak(state.days, kidId, today);
  const rows = dates
    .map((date) => {
      const day = state.days[L.dayId(kidId, date)];
      const school = L.isSchoolDay(date, day);
      let mark = "·";
      if (day?.tierStatus === "waived") mark = "W";
      else if (day?.tierStatus === "confirmed" && day.tier) mark = day.tier;
      return `
        <button class="hist" data-action="open-day" data-date="${date}">
          <span>${L.esc(L.formatDayLabel(date, { weekday: "short", month: "short", day: "numeric" }))}</span>
          <span class="muted">${school ? "School" : "Off"}</span>
          <span class="dot" data-letter="${L.esc(mark)}">${L.esc(mark)}</span>
        </button>
      `;
    })
    .join("");
  return `
    <article class="card">
      <header class="card-top"><h2>${name}</h2><p class="streak">S streak ${streak}</p></header>
      <div class="hist-list">${rows}</div>
    </article>
  `;
}

function editorHtml(id) {
  const routine = routineOf(id);
  if (!state.draft || state.draft.id !== id) {
    state.draft = structuredClone(routine);
    state.dirty = false;
  }
  const draft = state.draft;
  const chips = ["sam_morning", "sam_evening", "wally_morning", "wally_evening"]
    .map((routineId) => {
      const [kid, period] = routineId.split("_");
      const label = `${kid === "sam" ? "Sam" : "Wally"} ${period}`;
      return `<a class="${routineId === id ? "on" : ""}" href="#/edit/${routineId}">${label}</a>`;
    })
    .join("");
  const sections = draft.sections
    .map((section, index) => {
      const tasks = section.tasks
        .map((item, taskIndex) => taskEditor(item, draft.kidId, taskIndex, section.tasks.length))
        .join("");
      return `
        <section class="edit-section" data-section="${L.esc(section.id)}">
          <div class="edit-section-top">
            <input data-field="section-title" value="${L.esc(section.title)}" aria-label="Section name">
            <div class="icon-row">
              <button data-action="section-up" data-index="${index}" aria-label="Move section up" ${index === 0 ? "disabled" : ""}>↑</button>
              <button data-action="section-down" data-index="${index}" aria-label="Move section down" ${index === draft.sections.length - 1 ? "disabled" : ""}>↓</button>
              <button data-action="section-delete" data-index="${index}" aria-label="Delete section">✕</button>
            </div>
          </div>
          ${tasks || `<p class="muted">No tasks in this section.</p>`}
          <button class="texty" data-action="add-task" data-index="${index}">Add task</button>
        </section>
      `;
    })
    .join("");
  return `
    <main class="shell editor" data-editor>
      <header class="top">
        <div>
          <p class="wordmark">Mission Charts</p>
          <h1>Routines</h1>
        </div>
      </header>
      <div class="chips">${chips}</div>
      <p class="fine">6:40 and 7:25 are the chart. The minutes in between are a walking clock you can change. Evening times shift when you confirm A or B.</p>
      <div id="editor-root">${sections}</div>
      <button class="texty" data-action="add-section">Add section</button>
      <div class="save-row">
        <button class="done" data-action="save-routine">Save</button>
        <button class="texty danger" data-action="reset-routine">Reset this chart</button>
      </div>
    </main>
  `;
}

function taskEditor(item, kidId, index, count) {
  const due = item.due || { kind: "clock", time: "07:00" };
  const options = DUE_KINDS.map(
    ([kind, label]) => `<option value="${kind}" ${due.kind === kind ? "selected" : ""}>${label}</option>`,
  ).join("");
  const previewMin = L.resolveDue(due, {
    bedtime: L.bedtimeMinutes(kidId, "S"),
    winddown: L.winddownMinutes(kidId, "S"),
    ready: L.READY_MIN,
  });
  return `
    <div class="edit-task" data-task="${L.esc(item.id)}">
      <input data-field="title" value="${L.esc(item.title)}" aria-label="Task">
      <label class="field">
        <span>Due</span>
        <select data-field="kind">${options}</select>
      </label>
      <label class="field time-field">
        <span>Time</span>
        <input data-field="time" type="time" value="${L.esc(due.time || "07:00")}">
      </label>
      <label class="field min-field">
        <span>Minutes before</span>
        <input data-field="minutes" type="number" min="0" max="240" value="${Number(due.minutes || 0)}">
      </label>
      <p class="preview-line" data-field="preview">On an S night this is ${L.esc(L.formatDue(previewMin))}.</p>
      <div class="icon-row">
        <button data-action="task-up" data-index="${index}" aria-label="Move task up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button data-action="task-down" data-index="${index}" aria-label="Move task down" ${index === count - 1 ? "disabled" : ""}>↓</button>
        <button data-action="task-delete" data-index="${index}" aria-label="Delete task">✕</button>
      </div>
    </div>
  `;
}

function navHtml(items) {
  return `
    <nav class="tabs">
      ${items
        .map(
          ([href, label, on]) =>
            `<a href="${href}" ${on ? 'aria-current="page"' : ""}>${label}</a>`,
        )
        .join("")}
    </nav>
  `;
}

function liveSignOut() {
  if (backend.mode === "demo") return "";
  return `<p class="signout"><button data-action="sign-out">Sign out</button></p>`;
}

function clockSheet(now) {
  const real = new Date();
  const dateValue = L.formatDate(real);
  const timeValue = `${String(real.getHours()).padStart(2, "0")}:${String(real.getMinutes()).padStart(2, "0")}`;
  const presets = PRESETS.map(
    ([label, h, m]) =>
      `<button data-action="preset" data-h="${h}" data-m="${m}">${L.esc(label)}</button>`,
  ).join("");
  return `
    <div class="sheet-back" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Set the clock">
      <header>
        <h2>Pretend time</h2>
        <button data-action="close-sheet" aria-label="Close">✕</button>
      </header>
      <p class="fine">Now showing ${L.esc(L.formatClock(now))}${backend.isFakeClock() ? " (pretend)" : " (the real clock)"}.</p>
      <div class="presets">${presets}</div>
      <button data-action="use-real-time">Use the real time</button>
      <form class="custom-time" data-action="apply-custom">
        <input name="date" type="date" value="${dateValue}" required>
        <input name="time" type="time" value="${timeValue}" required>
        <button type="submit">Set</button>
      </form>
      <button class="texty danger" data-action="reset-demo">Reset preview data</button>
    </div>
  `;
}

function patchLive() {
  if (!backend) return;
  const now = backend.now();
  const minutes = L.chartContext(now).minutes;
  for (const el of document.querySelectorAll('[data-live="clock"]')) {
    el.textContent = L.formatClock(now);
  }
  for (const el of document.querySelectorAll('[data-live="delta"]')) {
    const delta = L.formatDelta(Number(el.dataset.due), minutes);
    el.textContent = delta.text;
    el.classList.toggle("late", delta.late);
    el.closest(".clockface")?.classList.toggle("late", delta.late);
  }
  for (const el of document.querySelectorAll('[data-live="ring"]')) {
    const circ = Number(el.dataset.circ);
    const frac = L.ringFraction(Number(el.dataset.due), minutes);
    el.style.strokeDashoffset = String(circ * (1 - frac));
  }
}

function syncLiveData() {
  if (!state.user) return;
  const today = L.chartContext(backend.now()).date;
  const kids = state.user.role === "admin" ? ["sam", "wally"] : [state.user.kidId];
  const historyDates = [];
  for (let i = 0; i < 21; i += 1) historyDates.push(L.addDays(today, -i));
  const key = `${state.user.email}:${today}`;
  if (key !== historyKey) {
    historyKey = key;
    backend.refreshHistory(kids, historyDates);
  }
  const liveDates = [...new Set([today, L.addDays(today, -1), state.pinnedDate].filter(Boolean))];
  const nextWatch = `${kids.join(",")}|${liveDates.join(",")}`;
  if (nextWatch !== watchKey) {
    watchKey = nextWatch;
    backend.watchLive(kids, liveDates);
  }
}

function viewDateNow() {
  const today = L.chartContext(backend.now()).date;
  return state.pinnedDate || today;
}

async function onClick(event) {
  const link = event.target.closest('a[href^="#/edit/"]');
  if (link && state.dirty && !confirm("Leave without saving this routine?")) {
    event.preventDefault();
    return;
  }
  if (link && state.dirty) state.dirty = false;

  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;

  if (action === "dismiss-error") {
    state.error = "";
    invalidate();
    return;
  }
  if (action === "demo-sign-in") {
    await backend.signIn(button.dataset.email);
    return;
  }
  if (action === "google-sign-in") {
    await backend.signIn();
    return;
  }
  if (action === "sign-out") {
    state.pinnedDate = null;
    state.draft = null;
    state.dirty = false;
    await backend.signOut();
    return;
  }
  if (action === "open-sheet") {
    state.sheet = "clock";
    invalidate();
    return;
  }
  if (action === "close-sheet") {
    state.sheet = null;
    invalidate();
    return;
  }
  if (action === "preset") {
    const base = new Date();
    base.setHours(Number(button.dataset.h), Number(button.dataset.m), 10, 0);
    backend.setFakeNow(base.getTime());
    state.sheet = null;
    invalidate();
    return;
  }
  if (action === "use-real-time") {
    backend.setFakeNow(null);
    state.sheet = null;
    invalidate();
    return;
  }
  if (action === "reset-demo") {
    if (confirm("Clear preview checks, scores, and routine edits on this phone?")) {
      await backend.resetDemo();
      state.sheet = null;
      state.draft = null;
      invalidate();
    }
    return;
  }
  if (action === "check-next") {
    const kidId = state.user.kidId;
    const today = L.chartContext(backend.now()).date;
    const hero = modelFor(kidId, today, backend.now()).hero;
    if (!hero.taskId) return;
    await backend.setCheck(kidId, today, hero.taskId, true);
    pulse();
    return;
  }
  if (action === "toggle") {
    const { kid, date, task } = button.dataset;
    if (state.user.role === "kid" && kid !== state.user.kidId) return;
    const existing = state.days[L.dayId(kid, date)];
    const on = existing?.checks?.[task] == null;
    await backend.setCheck(kid, date, task, on);
    if (on) pulse();
    return;
  }
  if (action === "score") {
    const date = viewDateNow();
    const tier = button.dataset.tier;
    const score =
      tier === "waive"
        ? { tierStatus: "waived" }
        : { tierStatus: "confirmed", tier };
    await backend.setScore(button.dataset.kid, date, score, state.user.email);
    return;
  }
  if (action === "school") {
    await backend.setSchoolDay(button.dataset.kid, viewDateNow(), button.dataset.value === "1");
    return;
  }
  if (action === "pin-prev" || action === "pin-next" || action === "pin-today" || action === "open-day") {
    const today = L.chartContext(backend.now()).date;
    if (action === "pin-today") state.pinnedDate = null;
    else if (action === "open-day") state.pinnedDate = button.dataset.date === today ? null : button.dataset.date;
    else {
      const current = viewDateNow();
      const next = L.addDays(current, action === "pin-next" ? 1 : -1);
      if (action === "pin-next" && next > today) return;
      state.pinnedDate = next === today ? null : next;
    }
    if (location.hash !== "#/" && location.hash !== "") location.hash = "#/";
    invalidate();
    return;
  }
  if (action.startsWith("section-") || action.startsWith("task-") || action === "add-task" || action === "add-section") {
    editAction(action, button);
    return;
  }
  if (action === "save-routine") {
    syncDraftFromDom();
    const total = state.draft.sections.reduce((sum, section) => sum + section.tasks.length, 0);
    if (!total) {
      state.error = "A routine needs at least one task.";
      invalidate();
      return;
    }
    await backend.saveRoutine(state.draft);
    state.dirty = false;
    state.error = "";
    state.notice = "Saved";
    state.editNonce += 1;
    invalidate();
    setTimeout(() => {
      state.notice = "";
      invalidate();
    }, 1600);
    return;
  }
  if (action === "reset-routine") {
    if (!confirm("Reset this routine to the original chart?")) return;
    const fresh = defaultRoutineMap()[state.draft.id];
    state.draft = structuredClone(fresh);
    state.dirty = true;
    await backend.saveRoutine(state.draft);
    state.dirty = false;
    state.editNonce += 1;
    invalidate();
  }
}

function editAction(action, button) {
  syncDraftFromDom();
  const index = Number(button.dataset.index);
  const sections = state.draft.sections;
  if (action === "add-section") {
    sections.push({ id: nid("sec"), title: "New section", tasks: [] });
  } else if (action === "section-delete") {
    if (sections.length === 1) return;
    sections.splice(index, 1);
  } else if (action === "section-up" && index > 0) {
    [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
  } else if (action === "section-down" && index < sections.length - 1) {
    [sections[index + 1], sections[index]] = [sections[index], sections[index + 1]];
  } else if (action === "add-task") {
    sections[index].tasks.push({
      id: nid("t"),
      title: "New task",
      due: { kind: "clock", time: "07:00" },
    });
  } else if (action === "task-delete" || action === "task-up" || action === "task-down") {
    const sectionEl = button.closest("[data-section]");
    const section = sections.find((item) => item.id === sectionEl.dataset.section);
    if (!section) return;
    if (action === "task-delete") section.tasks.splice(index, 1);
    else if (action === "task-up" && index > 0) {
      [section.tasks[index - 1], section.tasks[index]] = [section.tasks[index], section.tasks[index - 1]];
    } else if (action === "task-down" && index < section.tasks.length - 1) {
      [section.tasks[index + 1], section.tasks[index]] = [section.tasks[index], section.tasks[index + 1]];
    }
  }
  state.dirty = true;
  state.editNonce += 1;
  invalidate();
}

function syncDraftFromDom() {
  const root = document.getElementById("editor-root");
  if (!root || !state.draft) return;
  state.draft.sections = [...root.querySelectorAll("[data-section]")].map((sectionEl) => ({
    id: sectionEl.dataset.section,
    title: sectionEl.querySelector("[data-field=section-title]").value.trim() || "Section",
    tasks: [...sectionEl.querySelectorAll("[data-task]")].map((row) => ({
      id: row.dataset.task,
      title: row.querySelector("[data-field=title]").value.trim() || "Untitled",
      due: dueFromRow(row),
    })),
  }));
}

function dueFromRow(row) {
  const kind = row.querySelector("[data-field=kind]").value;
  if (kind === "clock") {
    return { kind, time: row.querySelector("[data-field=time]").value || "07:00" };
  }
  if (kind === "beforeBed" || kind === "beforeWinddown") {
    return { kind, minutes: Number(row.querySelector("[data-field=minutes]").value || 0) };
  }
  return { kind };
}

function applyKindVisibility(row) {
  const kind = row.querySelector("[data-field=kind]")?.value;
  if (!kind) return;
  const timeField = row.querySelector(".time-field");
  const minField = row.querySelector(".min-field");
  if (timeField) timeField.hidden = kind !== "clock";
  if (minField) minField.hidden = kind !== "beforeBed" && kind !== "beforeWinddown";
  const preview = row.querySelector("[data-field=preview]");
  if (preview && state.draft) {
    const due = dueFromRow(row);
    const minutes = L.resolveDue(due, {
      bedtime: L.bedtimeMinutes(state.draft.kidId, "S"),
      winddown: L.winddownMinutes(state.draft.kidId, "S"),
      ready: L.READY_MIN,
    });
    preview.textContent = `On an S night this is ${L.formatDue(minutes)}.`;
  }
}

function onChange(event) {
  if (event.target.dataset?.field === "kind") applyKindVisibility(event.target.closest("[data-task]"));
}

function onInput(event) {
  if (!event.target.closest("[data-editor]")) return;
  state.dirty = true;
  if (event.target.dataset?.field === "kind" || event.target.dataset?.field === "time" || event.target.dataset?.field === "minutes") {
    applyKindVisibility(event.target.closest("[data-task]"));
  }
}

function onSubmit(event) {
  const form = event.target.closest?.("[data-action=apply-custom]") || (event.target.matches?.("[data-action=apply-custom]") ? event.target : null);
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const [y, m, d] = String(data.get("date")).split("-").map(Number);
  const [hh, mm] = String(data.get("time")).split(":").map(Number);
  backend.setFakeNow(new Date(y, m - 1, d, hh, mm, 10, 0).getTime());
  state.sheet = null;
  invalidate();
}

function pulse() {
  state.flash = true;
  if (navigator.vibrate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    navigator.vibrate(8);
  }
  invalidate();
  setTimeout(() => {
    state.flash = false;
    invalidate();
  }, 450);
}

function nid(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${rand}`;
}

document.addEventListener("click", (event) => {
  onClick(event).catch((error) => {
    console.error(error);
    state.error = "Something didn’t save.";
    invalidate();
  });
});
document.addEventListener("change", onChange);
document.addEventListener("input", onInput);
document.addEventListener("submit", onSubmit);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.sheet) {
    state.sheet = null;
    invalidate();
  }
});
window.addEventListener("hashchange", () => invalidate());

createBackend({
  onUser(user) {
    state.user = user;
    state.authReady = true;
    if (!user) {
      historyKey = "";
      watchKey = "";
    }
    if (booted) invalidate();
  },
  onData(data) {
    state.routines = data.routines;
    state.days = data.days;
    if (booted) invalidate();
  },
  onError(message) {
    state.error = message;
    if (booted) invalidate();
  },
}).then((api) => {
  backend = api;
  booted = true;
  invalidate();
  setInterval(frame, 1000);
});

// Clock, phases, and tier suggestion. Pure functions: no DOM, no Firebase.
//
// Bedtime shown to the kids follows the confirmed tier. Until a parent
// confirms or waives, the clock they are racing is the S schedule
// (Sam 9:30, Wally 8:30). Suggesting a lower tier does not move
// bedtime by itself — parents score most nights, and they may waive.
// Deadlines are graded against that same schedule, so a suggestion
// cannot shift the deadlines it is measured against.

export const READY_MIN = 7 * 60 + 25;
export const WAKE_MIN = 6 * 60 + 40;
export const EVENING_START = 15 * 60 + 30;
export const WEEKEND_EVENING_START = 12 * 60;
export const CHART_ROLLOVER = 4 * 60;
export const WINDDOWN_LEAD = 30;

export const BEDTIME = {
  sam: { S: 21 * 60 + 30, A: 21 * 60 + 15, B: 21 * 60 },
  wally: { S: 20 * 60 + 30, A: 20 * 60 + 15, B: 20 * 60 },
};

const TIERS = ["S", "A", "B"];

export function bedtimeMinutes(kidId, tier) {
  const table = BEDTIME[kidId];
  if (!table) return BEDTIME.sam.S;
  return table[tier] ?? table.S;
}

export function winddownMinutes(kidId, tier) {
  if (kidId !== "wally") return null;
  return bedtimeMinutes(kidId, tier) - WINDDOWN_LEAD;
}

export function scheduleTierOf(day) {
  if (!day) return "S";
  if (day.tierStatus === "waived") return "S";
  if (day.tierStatus === "confirmed" && TIERS.includes(day.tier)) return day.tier;
  return "S";
}

export function parseTime(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return formatDate(new Date(y, m - 1, d + delta));
}

export function chartDayStartMs(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function defaultSchoolDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  return weekday >= 1 && weekday <= 5;
}

export function isSchoolDay(dateStr, day) {
  if (day && typeof day.schoolDay === "boolean") return day.schoolDay;
  return defaultSchoolDay(dateStr);
}

// A chart day runs from 4:00am to 3:59am so a late bedtime still
// belongs to the evening that started the previous calendar day.
export function chartContext(now) {
  const date = new Date(now);
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  if (minutes < CHART_ROLLOVER) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    return {
      date: formatDate(day),
      minutes: minutes + 24 * 60,
      weekday: day.getDay(),
    };
  }
  return { date: formatDate(date), minutes, weekday: date.getDay() };
}

// When a parent opens a past day, grade it as if that night is over.
// A future day stays at the start of the chart day so nothing is late yet.
export function instantForChartDate(viewDate, realNow) {
  const today = chartContext(realNow).date;
  if (viewDate === today) return realNow;
  if (viewDate < today) {
    const [y, m, d] = addDays(viewDate, 1).split("-").map(Number);
    return new Date(y, m - 1, d, 3, 50, 0).getTime();
  }
  const [y, m, d] = viewDate.split("-").map(Number);
  return new Date(y, m - 1, d, 4, 5, 0).getTime();
}

export function formatDue(min) {
  const normalized = ((Math.floor(min) % 1440) + 1440) % 1440;
  let h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

export function formatClock(now) {
  const date = new Date(now);
  let h = date.getHours();
  const m = date.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

export function formatDayLabel(dateStr, options = { weekday: "long", month: "short", day: "numeric" }) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", options);
}

function humanDuration(abs) {
  if (abs >= 3600) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    return `${h}h ${m}m`;
  }
  if (abs >= 600) return `${Math.round(abs / 60)} min`;
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Counts down to the start of the due minute. That minute itself still
// counts as on time; the label reads "now" until the next minute.
export function formatDelta(dueMin, nowMin) {
  const remainSec = Math.round(Math.floor(dueMin) * 60 - nowMin * 60);
  if (remainSec > 0) return { late: false, text: humanDuration(remainSec) };
  if (!isPast(nowMin, dueMin)) return { late: false, text: "now" };
  const overSec = Math.max(0, Math.round(nowMin * 60 - (Math.floor(dueMin) + 1) * 60));
  if (overSec <= 0) return { late: true, text: "now" };
  return { late: true, text: `${humanDuration(overSec)} over` };
}

export function ringFraction(dueMin, nowMin) {
  const remainSec = Math.floor(dueMin) * 60 - nowMin * 60;
  if (remainSec <= 0) return 0;
  return Math.min(1, remainSec / 600);
}

export function isPast(nowMin, dueMin) {
  return Math.floor(nowMin) > Math.floor(dueMin);
}

export function resolveDue(due, ctx) {
  if (!due) return ctx.bedtime;
  let value;
  switch (due.kind) {
    case "clock":
      value = parseTime(due.time);
      break;
    case "ready":
      value = ctx.ready;
      break;
    case "bedtime":
      value = ctx.bedtime;
      break;
    case "beforeBed":
      value = ctx.bedtime - Number(due.minutes || 0);
      break;
    case "winddown":
      value = ctx.winddown ?? ctx.bedtime;
      break;
    case "beforeWinddown":
      value = (ctx.winddown ?? ctx.bedtime) - Number(due.minutes || 0);
      break;
    default:
      value = ctx.bedtime;
  }
  return value;
}

export function flattenRoutine(routine) {
  if (!routine?.sections) return [];
  const tasks = [];
  for (const section of routine.sections) {
    for (const task of section.tasks || []) {
      tasks.push({
        ...task,
        sectionId: section.id,
        sectionTitle: section.title,
      });
    }
  }
  return tasks;
}

export function annotateTasks(routine, ctx, checks) {
  return flattenRoutine(routine).map((task) => ({
    ...task,
    dueMin: resolveDue(task.due, ctx),
    checkedAt: checks?.[task.id] ?? null,
    checked: checks?.[task.id] != null,
  }));
}

export function gradeRoutine(tasks, checks, nowMin, periodEnd, chartDate) {
  let step = false;
  let missed = false;
  let pending = false;
  const start = chartDayStartMs(chartDate);
  for (const task of tasks) {
    const due = task.dueMin;
    const ts = checks?.[task.id];
    if (ts == null) {
      if (isPast(nowMin, periodEnd)) missed = true;
      else if (isPast(nowMin, due)) step = true;
      else pending = true;
      continue;
    }
    const checkedMin = (ts - start) / 60000;
    if (isPast(checkedMin, periodEnd)) missed = true;
    else if (isPast(checkedMin, due)) step = true;
  }
  if (missed) return "B";
  if (step && pending) return "pending-A";
  if (step) return "A";
  if (pending) return "pending";
  return "S";
}

export function combineGrades(morning, evening) {
  if (morning === "skip") return evening;
  const grades = [morning, evening];
  if (grades.includes("B")) return "B";
  if (grades.includes("A")) return "A";
  if (grades.includes("pending-A")) return "pending-A";
  if (grades.includes("pending")) return "pending";
  return "S";
}

export function statusOf({ suggestion, day }) {
  if (day?.tierStatus === "waived") {
    return { kind: "waived", label: "Waived", letter: "S" };
  }
  if (day?.tierStatus === "confirmed" && TIERS.includes(day.tier)) {
    return { kind: "confirmed", label: "Tonight", letter: day.tier };
  }
  if (suggestion === "pending") return { kind: "open", label: "On track", letter: "S" };
  if (suggestion === "pending-A") return { kind: "open", label: "Slipping", letter: "A" };
  if (suggestion === "S") return { kind: "open", label: "Suggested", letter: "S" };
  if (suggestion === "A") return { kind: "open", label: "Suggested", letter: "A" };
  return { kind: "open", label: "Suggested", letter: "B" };
}

export function phaseFor({ minutes, schoolDay, kidId, bedtimeMin }) {
  const m = Math.floor(minutes);
  const bed = Math.floor(bedtimeMin);
  const wind = kidId === "wally" ? bed - WINDDOWN_LEAD : null;
  if (m >= bed) return "bedtime";
  if (wind != null && m >= wind) return "winddown";
  const eveningStart = schoolDay ? EVENING_START : WEEKEND_EVENING_START;
  if (m >= eveningStart) return "evening";
  if (!schoolDay) return "dayoff";
  if (m > READY_MIN) return "morningClosed";
  return "morning";
}

function firstOpen(tasks) {
  return tasks.find((task) => !task.checked) || null;
}

function kickerFor(task, phase) {
  if (!task) return "Next";
  if (phase === "winddown" && task.sectionTitle.startsWith("By winddown")) return "By winddown";
  if (phase === "winddown" && task.sectionTitle.startsWith("During winddown")) return "During winddown";
  if (task.sectionTitle === "Checklist") return "Next";
  return task.sectionTitle;
}

export function routineSummary(tasks, nowMin) {
  const overdue = tasks.filter((task) => !task.checked && isPast(nowMin, task.dueMin));
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.checked).length,
    overdue,
    next: firstOpen(tasks),
  };
}

export function buildHero({ phase, kidId, morningTasks, eveningTasks, bedtimeMin, winddownMin }) {
  const morning = routineSummary(morningTasks, 0);
  const evening = routineSummary(eveningTasks, 0);
  const morningDone = morning.done;
  const morningTotal = morning.total;

  if (phase === "morning") {
    const next = firstOpen(morningTasks);
    if (!next) {
      return {
        mode: "done",
        kicker: "Morning",
        title: "Morning's done",
        detail: "Ready by 7:25.",
        countdownTo: READY_MIN,
        countdownLabel: "Until 7:25",
        allowDone: false,
        banner: null,
        progress: { done: morningDone, total: morningTotal, label: "Morning" },
      };
    }
    return taskHero(next, phase, "morning", morningTasks);
  }

  if (phase === "morningClosed") {
    const left = morningTotal - morningDone;
    const preview = firstOpen(eveningTasks);
    return {
      mode: "closed",
      kicker: "Morning",
      title: left === 0 ? "Morning's done" : "Morning's closed",
      detail:
        left === 0
          ? `All ${morningTotal} checked. Ready time was 7:25.`
          : `${morningDone} of ${morningTotal} checked. Ready time was 7:25. What's left counts as late.`,
      preview: preview
        ? {
            id: preview.id,
            title: preview.title,
            sectionTitle: preview.sectionTitle,
            dueMin: preview.dueMin,
          }
        : null,
      allowDone: false,
      banner: null,
      countdownTo: null,
      progress: { done: morningDone, total: morningTotal, label: "Morning" },
    };
  }

  if (phase === "dayoff") {
    const preview = firstOpen(eveningTasks);
    return {
      mode: "dayoff",
      kicker: "Today",
      title: "No school today",
      detail: "No morning chart. Evening still sets bedtime.",
      preview: preview
        ? {
            id: preview.id,
            title: preview.title,
            sectionTitle: preview.sectionTitle,
            dueMin: preview.dueMin,
          }
        : null,
      allowDone: false,
      banner: null,
      countdownTo: null,
      progress: null,
    };
  }

  if (phase === "bedtime") {
    const bedTasks = eveningTasks.filter((task) => task.sectionTitle === "Bedtime");
    const nextBed = firstOpen(bedTasks);
    const earlierOpen = eveningTasks.filter(
      (task) => !task.checked && task.sectionTitle !== "Bedtime",
    ).length;
    const earlier =
      earlierOpen === 0
        ? ""
        : earlierOpen === 1
          ? "1 earlier task still open."
          : `${earlierOpen} earlier tasks still open.`;
    if (!nextBed) {
      return {
        mode: "bedtime",
        kicker: "Tonight",
        title: "Bedtime",
        detail: earlier ? `In bed. ${earlier}` : "In bed.",
        countdownTo: null,
        allowDone: false,
        banner: "Bedtime",
        taskId: null,
        progress: {
          done: evening.done,
          total: evening.total,
          label: "Evening",
        },
      };
    }
    return {
      mode: "task",
      kicker: "Bedtime",
      title: "Bedtime",
      detail: nextBed.title,
      extra: earlier,
      dueMin: nextBed.dueMin,
      taskId: nextBed.id,
      countdownTo: bedtimeMin,
      countdownLabel: `Bed at ${formatDue(bedtimeMin)}`,
      allowDone: true,
      banner: "Bedtime",
      progress: { done: evening.done, total: evening.total, label: "Evening" },
    };
  }

  const next = firstOpen(eveningTasks);
  const banner = phase === "winddown" ? "Winddown · screens off" : null;
  if (!next) {
    let detail = "In bed by bedtime.";
    if (kidId === "sam") detail = `Screens are OK until ${formatDue(bedtimeMin)}.`;
    if (kidId === "wally" && phase === "winddown") detail = `In bed by ${formatDue(bedtimeMin)}.`;
    if (kidId === "wally" && phase === "evening" && winddownMin != null) {
      detail = `Winddown at ${formatDue(winddownMin)}. Screens off then.`;
    }
    return {
      mode: "done",
      kicker: phase === "winddown" ? "Winddown" : "Evening",
      title: phase === "winddown" ? "Winddown" : "Evening's done",
      detail,
      countdownTo: bedtimeMin,
      countdownLabel: `Bed at ${formatDue(bedtimeMin)}`,
      allowDone: false,
      banner,
      progress: { done: evening.done, total: evening.total, label: "Evening" },
    };
  }
  const hero = taskHero(next, phase, "evening", eveningTasks);
  hero.banner = banner;
  return hero;
}

function taskHero(task, phase, label, tasks) {
  const summary = routineSummary(tasks, 0);
  return {
    mode: "task",
    kicker: kickerFor(task, phase),
    title: task.title,
    detail: "",
    dueMin: task.dueMin,
    taskId: task.id,
    countdownTo: task.dueMin,
    countdownLabel: `Due ${formatDue(task.dueMin)}`,
    allowDone: true,
    banner: null,
    progress: {
      done: summary.done,
      total: summary.total,
      label: label === "morning" ? "Morning" : "Evening",
    },
  };
}

export function suggestDay({ kidId, schoolDay, morningRoutine, eveningRoutine, day, now }) {
  const chart = chartContext(now);
  const scheduleTier = scheduleTierOf(day);
  const bedtime = bedtimeMinutes(kidId, scheduleTier);
  const winddown = winddownMinutes(kidId, scheduleTier);
  const ctx = { bedtime, winddown, ready: READY_MIN };
  const checks = day?.checks || {};
  const morningTasks = annotateTasks(morningRoutine, ctx, checks);
  const eveningTasks = annotateTasks(eveningRoutine, ctx, checks);
  const morningGrade = schoolDay
    ? gradeRoutine(morningTasks, checks, chart.minutes, READY_MIN, chart.date)
    : "skip";
  const eveningGrade = gradeRoutine(eveningTasks, checks, chart.minutes, bedtime, chart.date);
  const suggestion = combineGrades(morningGrade, eveningGrade);
  const phase = phaseFor({
    minutes: chart.minutes,
    schoolDay: Boolean(schoolDay),
    kidId,
    bedtimeMin: bedtime,
  });
  const hero = buildHero({
    phase,
    kidId,
    morningTasks,
    eveningTasks,
    bedtimeMin: bedtime,
    winddownMin: winddown,
  });
  const status = statusOf({ suggestion, day });
  return {
    chart,
    scheduleTier,
    bedtime,
    winddown,
    morningTasks,
    eveningTasks,
    morningGrade,
    eveningGrade,
    suggestion,
    phase,
    hero,
    status,
    schoolDay: Boolean(schoolDay),
  };
}

export function sStreak(daysById, kidId, todayStr) {
  let streak = 0;
  let date = todayStr;
  for (let i = 0; i < 90; i += 1) {
    const rec = daysById[`${kidId}_${date}`];
    const isToday = date === todayStr;
    const tierStatus = rec?.tierStatus;
    if (!tierStatus || tierStatus === "open") {
      if (isToday) {
        date = addDays(date, -1);
        continue;
      }
      break;
    }
    if (tierStatus === "waived") {
      date = addDays(date, -1);
      continue;
    }
    if (tierStatus === "confirmed" && rec.tier === "S") {
      streak += 1;
      date = addDays(date, -1);
      continue;
    }
    break;
  }
  return streak;
}

export function recentDates(todayStr, count, { includeToday = false } = {}) {
  const dates = [];
  const start = includeToday ? 0 : 1;
  for (let i = start + count - 1; i >= start; i -= 1) dates.push(addDays(todayStr, -i));
  return dates;
}

export function dayId(kidId, date) {
  return `${kidId}_${date}`;
}

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Default routines, seeded from the four Mission Charts boards.
// Order and section groupings match the chart. Clock times between
// "out of bed by 6:40" and "ready by 7:25" are editable defaults so
// the app can walk a kid through the list. Parents can change any
// time, label, or section without touching code.
//
// Evening steps use offsets from tonight's bedtime (and, for Wally,
// from winddown) so a confirmed A or B moves the rest of the night.

import {
  READY_MIN,
  addDays,
  annotateTasks,
  bedtimeMinutes,
  chartContext,
  chartDayStartMs,
  defaultSchoolDay,
  flattenRoutine,
  resolveDue,
  winddownMinutes,
} from "./logic.js";

const clock = (time) => ({ kind: "clock", time });
const beforeBed = (minutes) => ({ kind: "beforeBed", minutes });
const beforeWind = (minutes) => ({ kind: "beforeWinddown", minutes });
const task = (id, title, due) => ({ id, title, due });
const section = (id, title, tasks) => ({ id, title, tasks });

const ROUTINES = [
  {
    id: "sam_morning",
    kidId: "sam",
    period: "morning",
    sections: [
      section("checklist", "Checklist", [
        task("sm-wake", "Wake up and out of bed by 6:40", clock("06:40")),
        task("sm-bed", "Make the bed", clock("06:45")),
        task("sm-breakfast", "Eat breakfast", clock("07:00")),
        task("sm-meds", "Take meds and vitamins", clock("07:05")),
      ]),
      section("bathroom", "Bathroom (in order)", [
        task("sm-brush", "Brush teeth", clock("07:08")),
        task("sm-wash", "Wash face", clock("07:10")),
        task("sm-spray", "Spray face", clock("07:12")),
        task("sm-moist", "Moisturize", clock("07:14")),
        task("sm-sun", "Sunscreen", clock("07:16")),
        task("sm-deo", "Deodorize", clock("07:18")),
        task("sm-dressed", "Get dressed", clock("07:20")),
        task("sm-feed", "Feed the animals", clock("07:23")),
        task("sm-pack", "Backpack in the car (packed last night with uniform)", clock("07:25")),
      ]),
    ],
  },
  {
    id: "wally_morning",
    kidId: "wally",
    period: "morning",
    sections: [
      section("checklist", "Checklist", [
        task("wm-wake", "Wake up and out of bed by 6:40", clock("06:40")),
        task("wm-bed", "Make the bed", clock("06:48")),
        task("wm-breakfast", "Eat breakfast", clock("07:00")),
        task("wm-meds", "Take meds and vitamins", clock("07:06")),
        task("wm-brush", "Brush teeth and wash face", clock("07:12")),
        task("wm-dressed", "Get dressed", clock("07:18")),
        task("wm-dishes", "Check the dishwasher. Empty it if the dishes are clean", clock("07:22")),
        task("wm-pack", "Backpack in the car (packed last night)", clock("07:25")),
      ]),
    ],
  },
  {
    id: "sam_evening",
    kidId: "sam",
    period: "evening",
    sections: [
      section("before-dinner", "Before dinner", [
        task("se-feed", "Feed the animals", clock("17:30")),
      ]),
      section("before-bedtime", "Before bedtime", [
        task("se-hw", "Homework done", beforeBed(90)),
        task("se-uniform", "School uniform packed in backpack", beforeBed(40)),
        task("se-backpack", "Backpack packed", beforeBed(35)),
        task("se-light", "Overhead light off", beforeBed(25)),
      ]),
      section("evening-checklist", "Evening checklist", [
        task("se-floss", "Floss teeth", beforeBed(20)),
        task("se-brush", "Brush teeth", beforeBed(18)),
        task("se-wash", "Wash face", beforeBed(16)),
        task("se-spray", "Spray face", beforeBed(14)),
        task("se-moist", "Moisturize", beforeBed(12)),
        task("se-bath", "Bath or shower in the past 48 hours", { kind: "bedtime" }),
        task("se-uniform-off", "Out of school uniform", beforeBed(10)),
        task("se-tidy", "Tidy room", beforeBed(8)),
        task("se-water", "Get water for bed", beforeBed(5)),
      ]),
      section("bedtime", "Bedtime", [
        task("se-screens", "Screens off / devices on a charger", { kind: "bedtime" }),
        task("se-inbed", "In bed by tonight\u2019s bedtime", { kind: "bedtime" }),
      ]),
    ],
  },
  {
    id: "wally_evening",
    kidId: "wally",
    period: "evening",
    sections: [
      section("by-winddown", "By winddown (ready when screens go off)", [
        task("we-hw", "Homework done", beforeWind(45)),
        task("we-backpack", "Backpack packed", beforeWind(30)),
        task("we-devices", "Devices put away and on a charger", beforeWind(15)),
        task("we-light", "Overhead light off", beforeWind(10)),
        task("we-dishes", "Check the dishwasher. Empty it if the dishes are clean", beforeWind(5)),
        task("we-screens", "Screens off (winddown starts)", { kind: "winddown" }),
      ]),
      section("during-winddown", "During winddown", [
        task("we-floss", "Floss teeth", beforeBed(25)),
        task("we-brush", "Brush teeth", beforeBed(22)),
        task("we-uniform", "Out of school uniform", beforeBed(18)),
        task("we-tidy", "Tidy room", beforeBed(14)),
        task("we-water", "Get water for bed", beforeBed(10)),
        task("we-mag", "Take magnesium", beforeBed(6)),
        task("we-folders", "Folders organized neatly", beforeBed(3)),
      ]),
      section("bedtime", "Bedtime", [
        task("we-inbed", "In bed by tonight\u2019s bedtime, ready to read and snuggle", { kind: "bedtime" }),
      ]),
    ],
  },
];

export function defaultRoutines() {
  return structuredClone(ROUTINES);
}

export function defaultRoutineMap() {
  return Object.fromEntries(defaultRoutines().map((routine) => [routine.id, routine]));
}

function stamp(date, minutes) {
  return chartDayStartMs(date) + Math.floor(minutes) * 60 * 1000;
}

function onTimeChecks(routine, date) {
  const bedtime = bedtimeMinutes(routine.kidId, "S");
  const winddown = winddownMinutes(routine.kidId, "S");
  const ctx = { bedtime, winddown, ready: READY_MIN };
  const checks = {};
  for (const item of flattenRoutine(routine)) {
    const due = resolveDue(item.due, ctx);
    checks[item.id] = stamp(date, due - 1);
  }
  return checks;
}

function dayRecord(kidId, date, code, routines) {
  const schoolDay = defaultSchoolDay(date);
  const morning = routines[`${kidId}_morning`];
  const evening = routines[`${kidId}_evening`];
  const checks = {
    ...onTimeChecks(morning, date),
    ...onTimeChecks(evening, date),
  };
  const base = {
    kidId,
    date,
    schoolDay,
    checks,
    updatedAt: chartDayStartMs(date),
    scoredAt: stamp(date, bedtimeMinutes(kidId, "S")),
    scoredBy: "brookhouser@gmail.com",
  };
  if (code === "waive") {
    return {
      ...base,
      checks: {},
      tierStatus: "waived",
      scoredBy: "bbrookhouser@gmail.com",
    };
  }
  if (code === "A" && schoolDay) {
    const wakeId = kidId === "sam" ? "sm-wake" : "wm-wake";
    checks[wakeId] = stamp(date, 6 * 60 + 52);
  }
  return { ...base, checks, tierStatus: "confirmed", tier: code };
}

// A few scored days so preview mode can show streaks before anyone taps.
export function buildDemoDays(now = Date.now()) {
  const today = chartContext(now).date;
  const routines = defaultRoutineMap();
  const plan = [
    { offset: -1, sam: "S", wally: "S" },
    { offset: -2, sam: "S", wally: "S" },
    { offset: -3, sam: "S", wally: "A" },
    { offset: -4, sam: "S", wally: "S" },
    { offset: -5, sam: "S", wally: "S" },
    { offset: -6, sam: "waive", wally: "S" },
  ];
  const days = {};
  for (const item of plan) {
    const date = addDays(today, item.offset);
    for (const kidId of ["sam", "wally"]) {
      days[`${kidId}_${date}`] = dayRecord(kidId, date, item[kidId], routines);
    }
  }
  return days;
}

export function scheduleContext(kidId, tier) {
  return {
    bedtime: bedtimeMinutes(kidId, tier),
    winddown: winddownMinutes(kidId, tier),
    ready: READY_MIN,
  };
}

export function previewDue(task, kidId, tier = "S") {
  return resolveDue(task.due, scheduleContext(kidId, tier));
}

export function annotatedDefaults(kidId, period, tier = "S") {
  const routine = defaultRoutineMap()[`${kidId}_${period}`];
  return annotateTasks(routine, scheduleContext(kidId, tier), {});
}

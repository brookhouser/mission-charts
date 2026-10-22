import assert from "node:assert/strict";
import test from "node:test";
import * as L from "../js/logic.js";
import { buildDemoDays, defaultRoutineMap } from "../js/seed.js";
import { isFirebaseConfigured } from "../js/config.js";
import { readFileSync } from "node:fs";

const routines = defaultRoutineMap();
const THU = new Date(2026, 9, 22, 6, 32, 0).getTime();

function view(kidId, when, day = null, schoolDay) {
  const date = L.chartContext(when).date;
  const school = schoolDay ?? L.isSchoolDay(date, day);
  return L.suggestDay({
    kidId,
    schoolDay: school,
    morningRoutine: routines[`${kidId}_morning`],
    eveningRoutine: routines[`${kidId}_evening`],
    day,
    now: when,
  });
}

test("chart titles and sections match the four boards", () => {
  const titles = (id) =>
    routines[id].sections.map((section) => ({
      title: section.title,
      tasks: section.tasks.map((task) => task.title),
    }));

  assert.deepEqual(titles("sam_morning"), [
    {
      title: "Checklist",
      tasks: [
        "Wake up and out of bed by 6:40",
        "Make the bed",
        "Eat breakfast",
        "Take meds and vitamins",
      ],
    },
    {
      title: "Bathroom (in order)",
      tasks: [
        "Brush teeth",
        "Wash face",
        "Spray face",
        "Moisturize",
        "Sunscreen",
        "Deodorize",
        "Get dressed",
        "Feed the animals",
        "Backpack in the car (packed last night with uniform)",
      ],
    },
  ]);

  assert.deepEqual(titles("wally_morning"), [
    {
      title: "Checklist",
      tasks: [
        "Wake up and out of bed by 6:40",
        "Make the bed",
        "Eat breakfast",
        "Take meds and vitamins",
        "Brush teeth and wash face",
        "Get dressed",
        "Check the dishwasher. Empty it if the dishes are clean",
        "Backpack in the car (packed last night)",
      ],
    },
  ]);

  assert.deepEqual(titles("sam_evening"), [
    { title: "Before dinner", tasks: ["Feed the animals"] },
    {
      title: "Before bedtime",
      tasks: [
        "Homework done",
        "School uniform packed in backpack",
        "Backpack packed",
        "Overhead light off",
      ],
    },
    {
      title: "Evening checklist",
      tasks: [
        "Floss teeth",
        "Brush teeth",
        "Wash face",
        "Spray face",
        "Moisturize",
        "Bath or shower in the past 48 hours",
        "Out of school uniform",
        "Tidy room",
        "Get water for bed",
      ],
    },
    {
      title: "Bedtime",
      tasks: [
        "Screens off / devices on a charger",
        "In bed by tonight\u2019s bedtime",
      ],
    },
  ]);

  assert.deepEqual(titles("wally_evening"), [
    {
      title: "By winddown (ready when screens go off)",
      tasks: [
        "Homework done",
        "Backpack packed",
        "Devices put away and on a charger",
        "Overhead light off",
        "Check the dishwasher. Empty it if the dishes are clean",
        "Screens off (winddown starts)",
      ],
    },
    {
      title: "During winddown",
      tasks: [
        "Floss teeth",
        "Brush teeth",
        "Out of school uniform",
        "Tidy room",
        "Get water for bed",
        "Take magnesium",
        "Folders organized neatly",
      ],
    },
    {
      title: "Bedtime",
      tasks: ["In bed by tonight\u2019s bedtime, ready to read and snuggle"],
    },
  ]);
});

test("Thursday 6:32 is Sam's morning, on track for 9:30", () => {
  const model = view("sam", THU);
  assert.equal(model.phase, "morning");
  assert.equal(model.hero.mode, "task");
  assert.equal(model.hero.taskId, "sm-wake");
  assert.equal(model.hero.title, "Wake up and out of bed by 6:40");
  assert.equal(model.hero.dueMin, 6 * 60 + 40);
  assert.equal(model.status.label, "On track");
  assert.equal(model.status.letter, "S");
  assert.equal(model.bedtime, 21 * 60 + 30);
  assert.equal(model.winddown, null);
  assert.equal(L.formatDelta(model.hero.dueMin, model.chart.minutes).text, "8:00");
});

test("after 7:25 the morning is closed and Sam's next preview is feed the animals", () => {
  const model = view("sam", new Date(2026, 9, 22, 7, 40, 0).getTime());
  assert.equal(model.phase, "morningClosed");
  assert.equal(model.hero.mode, "closed");
  assert.match(model.hero.title, /closed/);
  assert.equal(model.hero.preview.id, "se-feed");
  assert.equal(model.hero.preview.sectionTitle, "Before dinner");
  assert.equal(model.hero.allowDone, false);
});

test("before dinner, Sam's focus is feed the animals", () => {
  const model = view("sam", new Date(2026, 9, 22, 16, 10, 0).getTime());
  assert.equal(model.phase, "evening");
  assert.equal(model.hero.mode, "task");
  assert.equal(model.hero.taskId, "se-feed");
  assert.equal(model.hero.kicker, "Before dinner");
  assert.equal(model.hero.allowDone, true);
});

test("late night reads as bedtime", () => {
  const model = view("sam", new Date(2026, 9, 22, 23, 15, 0).getTime());
  assert.equal(model.phase, "bedtime");
  assert.equal(model.hero.banner, "Bedtime");
  assert.equal(model.hero.title, "Bedtime");
  assert.equal(model.hero.taskId, "se-screens");
});

test("1:30am still belongs to the previous chart day", () => {
  const model = view("sam", new Date(2026, 9, 23, 1, 30, 0).getTime());
  assert.equal(model.chart.date, "2026-10-22");
  assert.equal(model.phase, "bedtime");
});

test("Wally during winddown shows the first during-winddown task", () => {
  const date = "2026-10-22";
  const start = L.chartDayStartMs(date);
  const checks = {};
  for (const task of routines.wally_evening.sections[0].tasks) {
    checks[task.id] = start + (19 * 60 + 40) * 60000;
  }
  const model = view("wally", new Date(2026, 9, 22, 20, 2, 0).getTime(), {
    kidId: "wally",
    date,
    checks,
  });
  assert.equal(model.phase, "winddown");
  assert.equal(model.hero.banner, "Winddown · screens off");
  assert.equal(model.hero.kicker, "During winddown");
  assert.equal(model.hero.taskId, "we-floss");
  assert.equal(model.bedtime, 20 * 60 + 30);
  assert.equal(model.winddown, 20 * 60);
  assert.equal(model.hero.dueMin, 20 * 60 + 5);
});

test("a confirmed B moves Wally's winddown to 7:30", () => {
  const early = view("wally", new Date(2026, 9, 22, 19, 40, 0).getTime());
  assert.equal(early.phase, "evening");
  assert.equal(early.winddown, 20 * 60);
  const dropped = view("wally", new Date(2026, 9, 22, 19, 40, 0).getTime(), {
    tierStatus: "confirmed",
    tier: "B",
    checks: {},
  });
  assert.equal(dropped.bedtime, 20 * 60);
  assert.equal(dropped.winddown, 19 * 60 + 30);
  assert.equal(dropped.phase, "winddown");
  assert.equal(dropped.status.kind, "confirmed");
  assert.equal(dropped.status.letter, "B");
});

test("tier suggestion uses deadlines and keeps S bedtime until a parent confirms", () => {
  const morning = {
    id: "sam_morning",
    kidId: "sam",
    period: "morning",
    sections: [
      {
        id: "c",
        title: "Checklist",
        tasks: [
          { id: "a", title: "A", due: { kind: "clock", time: "06:40" } },
          { id: "b", title: "B", due: { kind: "clock", time: "07:25" } },
        ],
      },
    ],
  };
  const evening = {
    id: "sam_evening",
    kidId: "sam",
    period: "evening",
    sections: [
      {
        id: "bed",
        title: "Bedtime",
        tasks: [{ id: "bed", title: "In bed", due: { kind: "bedtime" } }],
      },
    ],
  };
  const date = "2026-10-22";
  const start = L.chartDayStartMs(date);
  const at = (h, m) => start + (h * 60 + m) * 60000;
  const run = (when, checks) =>
    L.suggestDay({
      kidId: "sam",
      schoolDay: true,
      morningRoutine: morning,
      eveningRoutine: evening,
      day: { checks },
      now: when,
    });

  const clean = run(at(7, 10), { a: at(6, 39), b: at(7, 9) });
  assert.equal(clean.morningGrade, "S");
  assert.equal(clean.suggestion, "pending");
  assert.equal(clean.bedtime, 21 * 60 + 30);

  const slipped = run(at(7, 22), { a: at(6, 50), b: at(7, 20) });
  assert.equal(slipped.morningGrade, "A");
  assert.equal(slipped.suggestion, "A");
  assert.equal(slipped.status.label, "Suggested");
  assert.equal(slipped.bedtime, 21 * 60 + 30);

  const missed = run(at(7, 40), {});
  assert.equal(missed.morningGrade, "B");
  assert.equal(missed.suggestion, "B");

  const afterReady = run(at(7, 20), { a: at(6, 39), b: at(7, 30) });
  assert.equal(afterReady.morningGrade, "B");

  const both = run(at(22, 0), {
    a: at(6, 39),
    b: at(7, 10),
    bed: at(21, 20),
  });
  assert.equal(both.suggestion, "S");

  const lateBed = run(at(22, 10), {
    a: at(6, 39),
    b: at(7, 10),
    bed: at(22, 0),
  });
  assert.equal(lateBed.suggestion, "B");
});

test("a non-school morning does not count, Saturday evening still does", () => {
  const morning = view("sam", new Date(2026, 9, 24, 10, 0, 0).getTime());
  assert.equal(morning.phase, "dayoff");
  assert.equal(morning.morningGrade, "skip");
  assert.equal(morning.suggestion, "pending");
  assert.equal(morning.hero.title, "No school today");

  const evening = view("sam", new Date(2026, 9, 24, 16, 10, 0).getTime());
  assert.equal(evening.phase, "evening");
  assert.equal(evening.hero.taskId, "se-feed");
});

test("waive keeps the S bedtime and does not break an S streak", () => {
  const waived = view("sam", THU, { tierStatus: "waived", checks: {} });
  assert.equal(waived.status.kind, "waived");
  assert.equal(waived.bedtime, 21 * 60 + 30);

  const days = {
    "sam_2026-10-22": { tierStatus: "open" },
    "sam_2026-10-21": { tierStatus: "confirmed", tier: "S" },
    "sam_2026-10-20": { tierStatus: "waived" },
    "sam_2026-10-19": { tierStatus: "confirmed", tier: "S" },
    "sam_2026-10-18": { tierStatus: "confirmed", tier: "A" },
  };
  assert.equal(L.sStreak(days, "sam", "2026-10-22"), 2);
});

test("weekday defaults and past days are graded as finished", () => {
  assert.equal(L.defaultSchoolDay("2026-10-22"), true);
  assert.equal(L.defaultSchoolDay("2026-10-24"), false);
  const past = L.instantForChartDate("2026-10-21", THU);
  assert.equal(L.chartContext(past).date, "2026-10-21");
  assert.ok(L.chartContext(past).minutes > L.BEDTIME.sam.S);
});

test("preview history scores yesterday and leaves today empty", () => {
  const days = buildDemoDays(THU);
  assert.equal(days["sam_2026-10-22"], undefined);
  assert.equal(days["sam_2026-10-21"].tier, "S");
  assert.equal(days["wally_2026-10-19"].tier, "A");
  assert.equal(days["sam_2026-10-16"].tierStatus, "waived");
  assert.equal(days["sam_2026-10-16"].tier, undefined);
  assert.ok(L.sStreak(days, "sam", "2026-10-22") >= 4);
  assert.equal(L.sStreak(days, "wally", "2026-10-22"), 2);
});

test("firebase config stays in preview until the placeholders are replaced", () => {
  assert.equal(isFirebaseConfigured(), false);
  assert.equal(
    isFirebaseConfigured({
      apiKey: "abc",
      authDomain: "brookhouser.firebaseapp.com",
      projectId: "brookhouser",
      appId: "1:2",
    }),
    true,
  );
});

test("firestore rules lock the family allowlist and the missionCharts prefix", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  for (const email of [
    "sambrookhouser@gmail.com",
    "wilsonbrookhouser@gmail.com",
    "brookhouser@gmail.com",
    "bbrookhouser@gmail.com",
  ]) {
    assert.ok(rules.includes(email), email);
  }
  assert.match(rules, /missionCharts_days/);
  assert.match(rules, /missionCharts_routines/);
  assert.match(rules, /email_verified/);
  assert.match(rules, /google\.com/);
  assert.match(rules, /allow create, update: if isAdmin\(\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['checks', 'updatedAt'\]\)/);
});

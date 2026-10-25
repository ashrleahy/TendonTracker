import { test } from "node:test";
import assert from "node:assert/strict";
import { dayStatus, addDays, baselineFor, trendFor, heavySteps } from "./logic.ts";
import { planFor } from "./plan.ts";
import { DEFAULT_SETTINGS, normaliseSettings, type Entry, type Settings } from "./types.ts";

const days = (start: string, n: number, f: (d: string, i: number) => Partial<Entry>): Entry[] =>
  Array.from({ length: n }, (_, i) => {
    const d = addDays(start, i);
    return { date: d, ...f(d, i) };
  });

// Mon 2 Nov 2026 start, leg days Mon/Sat, no NSAID
const S: Settings = { ...DEFAULT_SETTINGS, planStart: "2026-11-02", lastNsaid: undefined };
const green = (): Partial<Entry> => ({ morningPain: 2, eveningPain: 2, steps: 9000 });

test("baseline needs 3 days and uses median", () => {
  const e = days("2026-10-01", 4, (_, i) => ({ morningPain: [2, 3, 9, 3][i] }));
  assert.equal(baselineFor("2026-10-05", e).morning, 3);
  assert.equal(baselineFor("2026-10-03", e).morning, undefined);
});

test("status: +1 amber, +2 red, absolute threshold, training pain, evening rise, flare", () => {
  const base = days("2026-10-01", 7, () => ({ morningPain: 2, eveningPain: 2 }));
  const s = (p: Partial<Entry>) => dayStatus({ date: "2026-10-08", ...p }, base)!.status;
  assert.equal(s({ morningPain: 2 }), "green");
  assert.equal(s({ morningPain: 3 }), "amber");
  assert.equal(s({ morningPain: 4 }), "red");
  assert.equal(s({ morningPain: 2, trainingPain: 4 }), "amber");
  assert.equal(s({ morningPain: 2, trainingPain: 6 }), "red");
  assert.equal(s({ morningPain: 2, eveningPain: 4 }), "amber");
  assert.equal(s({ morningPain: 1, flare: true }), "red");
  const high = days("2026-10-01", 7, () => ({ morningPain: 5 }));
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 5 }, high)!.status, "red");
});

test("trend compares this week with last week", () => {
  const e = days("2026-11-02", 14, (_, i) => ({ morningPain: i < 7 ? 2 : 3 }));
  assert.equal(trendFor("2026-11-15", e)!.dir, "rising");
  const f = days("2026-11-02", 14, (_, i) => ({ morningPain: i < 7 ? 3 : 2 }));
  assert.equal(trendFor("2026-11-15", f)!.dir, "falling");
});

test("heavy steps flagged relative to usual", () => {
  const e = [...days("2026-11-02", 10, () => ({ steps: 8000 })), { date: "2026-11-12", steps: 11000 }];
  assert.ok(heavySteps("2026-11-12", e));
  assert.equal(heavySteps("2026-11-11", e), undefined);
});

test("isometrics assumed done: climb after 5 green days without any logging of holds", () => {
  const e = days("2026-11-02", 7, green);
  assert.equal(planFor(e, S, "2026-11-06").plan.iso.load, 20);
  assert.equal(planFor(e, S, "2026-11-07").plan.iso.load, 25); // +5 in light range
});

test("no progression before morning pain is logged that day", () => {
  const e = [...days("2026-11-02", 5, green), { date: "2026-11-07", steps: 8000 }];
  assert.equal(planFor(e, S, "2026-11-07").plan.iso.load, 20);
});

test("anti-inflammatory washout masks evidence", () => {
  const e = days("2026-11-02", 10, green);
  const s = { ...S, lastNsaid: "2026-11-03" }; // masked through 7 Nov
  assert.equal(planFor(e, s, "2026-11-11").plan.iso.load, 20);
  assert.equal(planFor(e, s, "2026-11-08").plan.alerts.some((a) => a.id === "nsaid"), false);
});

test("red morning returns isometrics to the previous load", () => {
  const e = [...days("2026-11-02", 6, green), { date: "2026-11-08", morningPain: 5 }];
  assert.equal(planFor(e, S, "2026-11-07").plan.iso.load, 25);
  const p = planFor(e, S, "2026-11-08").plan;
  assert.equal(p.iso.load, 20);
  assert.equal(p.iso.effort, "30–50%");
});

test("calves: 3 tolerated sessions then one step; leg days default to done as prescribed", () => {
  // Mon/Sat leg days from 2 Nov: 2, 7, 9, 14 (Mon 16 is the next)
  const e = days("2026-11-02", 15, green);
  const p14 = planFor(e, S, "2026-11-14").plan;
  assert.equal(p14.calves!.seated.load, 20); // 3 banked, but the isometric step the day before blocks a calf step within 2 days
  const p16 = planFor(e, S, "2026-11-16");
  const calfUps = p16.events.filter((x) => (x.kind === "seated" || x.kind === "standing") && x.dir > 0);
  assert.equal(calfUps.length, 1);
});

test("red morning after a leg session steps calves back", () => {
  const e = [...days("2026-11-02", 15, green)];
  const ups = planFor(e, S, "2026-11-16").plan.state.seated;
  assert.ok(ups > 20);
  const e2 = [...e, { date: "2026-11-16", morningPain: 2, training: "done" as const }, { date: "2026-11-17", morningPain: 5 }];
  assert.equal(planFor(e2, S, "2026-11-17").plan.state.seated, 20);
});

test("skipped session doesn't count toward calves", () => {
  const e = days("2026-11-02", 15, (d) => ({ ...green(), training: [1, 6].includes(new Date(d).getUTCDay()) ? ("skipped" as const) : undefined }));
  const ev = planFor(e, S, "2026-11-16").events;
  assert.equal(ev.filter((x) => (x.kind === "seated" || x.kind === "standing") && x.dir > 0).length, 0);
});

test("flare: iso down ~20%, calves down, no loaded calves, settles after 2 good mornings", () => {
  const e: Entry[] = [...days("2026-11-02", 15, green)];
  const before = planFor(e, S, "2026-11-16").plan.state;
  const e2 = [...e, { date: "2026-11-17", morningPain: 4, flare: true }, { date: "2026-11-18", morningPain: 3 }];
  const p = planFor(e2, S, "2026-11-17").plan;
  assert.ok(p.state.iso < before.iso);
  assert.equal(p.state.flare, true);
  assert.ok(p.alerts.some((a) => a.id === "flare"));
  const e3 = [...e2, { date: "2026-11-19", morningPain: 2 }, { date: "2026-11-20", morningPain: 2 }];
  assert.equal(planFor(e3, S, "2026-11-20").plan.state.flare, false);
  // still no progression within a week of settling
  const e4 = [...e3, ...days("2026-11-21", 5, green)];
  const ups = planFor(e4, S, "2026-11-25").events.filter((x) => x.dir > 0 && x.date > "2026-11-17");
  assert.equal(ups.length, 0);
});

test("rising trend scales back once and blocks progression", () => {
  const e = [...days("2026-11-02", 14, green), ...days("2026-11-16", 7, () => ({ morningPain: 3, eveningPain: 3 }))];
  const { events } = planFor(e, S, "2026-11-22");
  assert.ok(events.some((x) => x.dir < 0 && /trending up/.test(x.why)));
});

test("settings v4 → v5: last NSAID date from the old taper", () => {
  const s = normaliseSettings({ version: 4, planStart: "2026-10-19", courses: [{ steps: [{ from: "2026-10-19", to: "2026-10-22" }, { from: "2026-10-27", to: "2026-10-28" }] }] });
  assert.equal(s.lastNsaid, "2026-10-28");
  assert.equal("courses" in s, false);
});

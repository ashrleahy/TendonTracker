import { test } from "node:test";
import assert from "node:assert/strict";
import { dayStatus, addDays, baselineFor } from "./logic.ts";
import { planFor, nsaidHold, doseOn, clearDays, rescueCourse } from "./plan.ts";
import { DEFAULT_SETTINGS, type Entry, type Settings } from "./types.ts";

const days = (start: string, n: number, f: (d: string, i: number) => Partial<Entry>): Entry[] =>
  Array.from({ length: n }, (_, i) => {
    const d = addDays(start, i);
    return { date: d, ...f(d, i) };
  });

const noCourse: Settings = { ...DEFAULT_SETTINGS, planStart: "2026-11-02", courses: [] };
const greenDay = (d: string): Partial<Entry> => ({
  morningPain: 2,
  eveningPain: 2,
  steps: new Date(d).getUTCDay() % 6 === 0 ? 10000 : 6200,
  isoDone: true,
});

test("baseline needs 3 days and uses median", () => {
  const e = days("2026-10-01", 4, (_, i) => ({ morningPain: [2, 3, 9, 3][i] }));
  assert.equal(baselineFor("2026-10-05", e).morning, 3);
  assert.equal(baselineFor("2026-10-03", e).morning, undefined);
});

test("status: +1 amber, +2 red, during >3 amber", () => {
  const base = days("2026-10-01", 7, () => ({ morningPain: 2, eveningPain: 2 }));
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 2 }, base)!.status, "green");
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 3 }, base)!.status, "amber");
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 4 }, base)!.status, "red");
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 2, isoPain: 4 }, base)!.status, "amber");
});

test("default taper: doses and hold until 1 Nov", () => {
  assert.deepEqual([doseOn(DEFAULT_SETTINGS, "2026-10-22")!.mg, doseOn(DEFAULT_SETTINGS, "2026-10-22")!.perDay], [50, 3]);
  assert.equal(doseOn(DEFAULT_SETTINGS, "2026-10-23")!.mg, 25);
  assert.equal(doseOn(DEFAULT_SETTINGS, "2026-10-27")!.perDay, 1);
  assert.equal(doseOn(DEFAULT_SETTINGS, "2026-10-29"), null);
  assert.equal(nsaidHold(DEFAULT_SETTINGS, "2026-11-01").active, true);
  assert.equal(nsaidHold(DEFAULT_SETTINGS, "2026-11-02").active, false);
});

test("no progression during the taper even when green", () => {
  const e = days("2026-10-19", 14, greenDay);
  const { plan, events } = planFor(e, DEFAULT_SETTINGS, "2026-11-01");
  assert.equal(events.filter((x) => x.dir > 0).length, 0);
  assert.equal(plan.iso.load, 20);
  assert.equal(plan.steps.target, 10000); // Sunday
});

test("isometric load climbs 2.5kg after 5 green days, not before", () => {
  const e = days("2026-11-02", 6, greenDay);
  assert.equal(planFor(e, noCourse, "2026-11-06").plan.iso.load, 20);
  assert.equal(planFor(e, noCourse, "2026-11-07").plan.iso.load, 22.5);
});

test("steps need 2 clean weeks and a steps week, then +500; weekend unchanged", () => {
  const e = days("2026-11-02", 15, greenDay);
  assert.equal(planFor(e, noCourse, "2026-11-09").plan.state.weekday, 6000); // only 1 week
  const { plan } = planFor(e, noCourse, "2026-11-16");
  assert.equal(plan.state.weekday, 6500);
  assert.equal(plan.state.weekend, 10000);
  assert.equal(plan.steps.target, 6500);
});

test("consolidation week every 4th week blocks progression", () => {
  const e = days("2026-11-02", 40, (d) => ({
    ...greenDay(d),
    ...([2, 4].includes(new Date(d).getUTCDay()) ? { legDay: true, isotonicPain: 2 } : {}),
  }));
  const { events } = planFor(e, noCourse, "2026-12-11");
  const inWeek4 = events.filter((x) => x.dir > 0 && x.date >= "2026-11-23" && x.date <= "2026-11-29");
  assert.equal(inWeek4.length, 0);
  assert.ok(events.some((x) => x.dir > 0 && x.date >= "2026-11-30")); // resumes after
});

test("old v1 settings adopt conservative defaults", async () => {
  const { normaliseSettings } = await import("./types.ts");
  const s = normaliseSettings({ stepIncrement: 750, painThreshold: 6, weekdayStart: 6000 });
  assert.equal(s.stepIncrement, 500);
  assert.equal(s.painThreshold, 5);
});

test("red morning: steps back to baseline, iso drops, calf work skipped", () => {
  const e = days("2026-11-02", 8, greenDay);
  // Tue 10 Nov red (a leg day)
  e.push({ date: "2026-11-10", morningPain: 6 });
  const { plan } = planFor(e, noCourse, "2026-11-10");
  assert.equal(plan.status, "red");
  assert.equal(plan.steps.target, 6000);
  assert.ok(plan.iso.load < 30);
  assert.equal(plan.calves?.skip, true);
});

test("pain threshold: rescue offered only after 7 clear days", () => {
  const e: Entry[] = [{ date: "2026-11-03", morningPain: 7 }];
  const early = planFor(e, DEFAULT_SETTINGS, "2026-11-03").plan.alerts.find((a) => a.id === "pain")!;
  assert.equal(early.action, undefined); // last dose 28 Oct → 5 clear days
  const e2: Entry[] = [{ date: "2026-11-06", morningPain: 7 }];
  const later = planFor(e2, DEFAULT_SETTINGS, "2026-11-06").plan.alerts.find((a) => a.id === "pain")!;
  assert.equal(later.action, "start-rescue");
  assert.equal(clearDays(DEFAULT_SETTINGS, [], "2026-11-05"), 7);
});

test("two rescue courses in 4 weeks escalates", () => {
  const s: Settings = { ...noCourse, courses: [rescueCourse("2026-11-01"), rescueCourse("2026-11-12")] };
  const a = planFor([{ date: "2026-11-25", morningPain: 7 }], s, "2026-11-25").plan.alerts.find((x) => x.id === "pain")!;
  assert.match(a.title, /escalate/);
});

test("seated raise +2.5kg after three tolerated leg days", () => {
  const e = days("2026-11-02", 10, (d) => ({
    ...greenDay(d),
    ...([2, 4].includes(new Date(d).getUTCDay()) ? { legDay: true, isotonicPain: 2 } : {}),
  }));
  // Tue 3, Thu 5, Tue 10 tolerated → progress on Thu 12
  const { events } = planFor(e, noCourse, "2026-11-12");
  const up = events.find((x) => x.kind === "seated");
  assert.equal(up?.date, "2026-11-12");
  assert.equal(up?.to, "22.5kg");
});

test("steps and calf progressions never land in the same week", () => {
  const e = days("2026-11-02", 60, (d) => ({
    ...greenDay(d),
    ...([2, 4].includes(new Date(d).getUTCDay()) ? { legDay: true, isotonicPain: 2 } : {}),
  }));
  const { events } = planFor(e, noCourse, "2026-12-31");
  const monday = (d: string) => addDays(d, -((new Date(d).getUTCDay() + 6) % 7));
  const ups = events.filter((x) => x.dir > 0 && x.kind !== "iso");
  const byWeek = new Map<string, Set<string>>();
  for (const u of ups) {
    const k = monday(u.date);
    byWeek.set(k, (byWeek.get(k) ?? new Set()).add(u.kind === "steps" ? "steps" : "calves"));
  }
  assert.ok(ups.some((u) => u.kind === "steps") && ups.some((u) => u.kind !== "steps"));
  for (const [w, kinds] of byWeek) assert.equal(kinds.size, 1, `week of ${w}`);
  // at most one calf progression per week
  const calfWeeks = ups.filter((u) => u.kind !== "steps").map((u) => monday(u.date));
  assert.equal(new Set(calfWeeks).size, calfWeeks.length);
});

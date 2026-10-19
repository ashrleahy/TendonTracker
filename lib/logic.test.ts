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

test("isometric load climbs 5kg after 3 green days", () => {
  const e = days("2026-11-02", 4, greenDay);
  const { plan } = planFor(e, noCourse, "2026-11-05");
  assert.equal(plan.iso.load, 25);
});

test("green week raises weekday steps on Monday, weekend unchanged", () => {
  const e = days("2026-11-02", 8, greenDay);
  const { plan } = planFor(e, noCourse, "2026-11-09");
  assert.equal(plan.state.weekday, 6500);
  assert.equal(plan.state.weekend, 10000);
  assert.equal(plan.steps.target, 6500);
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

test("seated raise +5kg after two tolerated leg days, locked a week after a step increase", () => {
  // Leg days Tue/Thu. Plan start Mon 2 Nov.
  const e = days("2026-11-02", 10, (d) => ({
    ...greenDay(d),
    ...([2, 4].includes(new Date(d).getUTCDay()) ? { legDay: true, isotonicPain: 2 } : {}),
  }));
  // Tue 3 + Thu 5 tolerated → progress on Tue 10, unless a step increase on Mon 9 locks it
  const { events } = planFor(e, noCourse, "2026-11-11");
  const stepUp = events.find((x) => x.kind === "steps" && x.dir > 0);
  const seatedUp = events.find((x) => x.kind === "seated");
  assert.ok(stepUp);
  assert.equal(seatedUp, undefined); // locked by the Monday step increase → standing progresses instead? no: lock applies to both
});

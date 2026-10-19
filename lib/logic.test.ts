import { test } from "node:test";
import assert from "node:assert/strict";
import { dayStatus, suggestions, addDays, nsaidHold, baselineFor } from "./logic.ts";
import { DEFAULT_SETTINGS, type Entry, type Settings } from "./types.ts";

const days = (start: string, n: number, f: (d: string, i: number) => Partial<Entry>): Entry[] =>
  Array.from({ length: n }, (_, i) => {
    const d = addDays(start, i);
    return { date: d, ...f(d, i) };
  });

test("baseline needs 3 days and uses median", () => {
  const e = days("2026-10-01", 4, (_, i) => ({ morningPain: [2, 3, 9, 3][i] }));
  assert.equal(baselineFor("2026-10-05", e).morning, 3);
  assert.equal(baselineFor("2026-10-03", e).morning, undefined);
});

test("morning +1 amber, +2 red, during >3 amber", () => {
  const base = days("2026-10-01", 7, () => ({ morningPain: 2, eveningPain: 2 }));
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 2 }, base)!.status, "green");
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 3 }, base)!.status, "amber");
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 4 }, base)!.status, "red");
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 2, isoPain: 4 }, base)!.status, "amber");
  assert.equal(dayStatus({ date: "2026-10-08", morningPain: 2, statusOverride: "red" }, base)!.status, "red");
});

test("nsaid washout = end + 4 days", () => {
  const s: Settings = { ...DEFAULT_SETTINGS, nsaidStart: "2026-10-17", nsaidEnd: "2026-10-23" };
  assert.equal(nsaidHold(s, "2026-10-27").active, true);
  assert.equal(nsaidHold(s, "2026-10-28").active, false);
});

test("green week at target suggests +500 weekdays, weekend unchanged", () => {
  const today = "2026-11-10";
  const e = days(addDays(today, -13), 14, (d) => ({ morningPain: 2, steps: 6200, isoDone: true }));
  const sug = suggestions(e, DEFAULT_SETTINGS, today);
  const steps = sug.find((s) => s.id === "steps")!;
  assert.equal(steps.tone, "progress");
  assert.equal(steps.action!.to, 6500);
  assert.equal(steps.action!.weekendTo, 10000);
  assert.equal(sug.find((s) => s.id === "iso")!.action!.to, 25);
});

test("NSAID hold blocks progression", () => {
  const today = "2026-10-22";
  const e = days(addDays(today, -13), 14, () => ({ morningPain: 2, steps: 6200, isoDone: true }));
  const s: Settings = { ...DEFAULT_SETTINGS, nsaidStart: "2026-10-17", nsaidEnd: "2026-10-23" };
  const sug = suggestions(e, s, today);
  assert.ok(sug.some((x) => x.id === "nsaid"));
  assert.ok(!sug.some((x) => x.tone === "progress"));
});

test("red day drops steps back", () => {
  const today = "2026-11-10";
  const e = days(addDays(today, -13), 14, (_, i) => ({ morningPain: i === 12 ? 5 : 2, steps: 7000 }));
  const s: Settings = { ...DEFAULT_SETTINGS, weekdayTarget: 7000 };
  const steps = suggestions(e, s, today).find((x) => x.id === "steps")!;
  assert.equal(steps.tone, "back");
  assert.equal(steps.action!.to, 6500);
});

test("weekly lock after a step increase", () => {
  const today = "2026-11-10";
  const e = days(addDays(today, -13), 14, () => ({ morningPain: 2, steps: 7000 }));
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    weekdayTarget: 6500,
    changes: [{ date: addDays(today, -3), kind: "steps", from: 6000, to: 6500 }],
  };
  assert.equal(suggestions(e, s, today).find((x) => x.id === "steps")!.tone, "hold");
});

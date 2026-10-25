import type { Entry, Status } from "./types.ts";

// ---------- dates (all YYYY-MM-DD, timezone-free arithmetic) ----------
export function toDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}
export function dow(s: string): number {
  return toDate(s).getUTCDay(); // 0 = Sun
}
export function isWeekend(s: string): boolean {
  const d = dow(s);
  return d === 0 || d === 6;
}
export function localToday(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}
export function prettyDate(s: string): string {
  return toDate(s).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}


function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function byDate(entries: Entry[]): Map<string, Entry> {
  return new Map(entries.map((e) => [e.date, e]));
}

// ---------- baseline, trend & daily status ----------
export interface Baseline {
  morning?: number;
  evening?: number;
}

/** Median of the previous 7 days (needs >= 3 values), excluding the day itself. */
export function baselineFor(date: string, entries: Entry[]): Baseline {
  const map = byDate(entries);
  const morning: number[] = [];
  const evening: number[] = [];
  for (let i = 1; i <= 7; i++) {
    const e = map.get(addDays(date, -i));
    if (!e) continue;
    if (e.morningPain != null) morning.push(e.morningPain);
    if (e.eveningPain != null) evening.push(e.eveningPain);
  }
  return {
    morning: morning.length >= 3 ? median(morning) : undefined,
    evening: evening.length >= 3 ? median(evening) : undefined,
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface Trend {
  recent: number; // mean morning pain, last 7 days (incl. the day)
  prior: number; // mean morning pain, the 7 days before that
  delta: number;
  dir: "rising" | "flat" | "falling";
}

/** Morning-pain trend: last 7 days vs the 7 before. Needs 4+ scores in each window. */
export function trendFor(date: string, entries: Entry[]): Trend | undefined {
  const map = byDate(entries);
  const win = (from: number) =>
    Array.from({ length: 7 }, (_, i) => map.get(addDays(date, -(from + i)))?.morningPain).filter((v): v is number => v != null);
  const a = win(0);
  const b = win(7);
  if (a.length < 4 || b.length < 4) return undefined;
  const recent = Math.round(mean(a) * 10) / 10;
  const prior = Math.round(mean(b) * 10) / 10;
  const delta = Math.round((recent - prior) * 10) / 10;
  return { recent, prior, delta, dir: delta >= 1 ? "rising" : delta <= -0.5 ? "falling" : "flat" };
}

/** Typical daily steps: median of the previous 14 days (needs 5). */
export function typicalSteps(date: string, entries: Entry[]): number | undefined {
  const map = byDate(entries);
  const xs = Array.from({ length: 14 }, (_, i) => map.get(addDays(date, -(i + 1)))?.steps).filter((v): v is number => v != null && v > 0);
  return xs.length >= 5 ? Math.round(median(xs) / 100) * 100 : undefined;
}

/** A walking day well above usual (25%+ over the 14-day median, and over 8k). */
export function heavySteps(date: string, entries: Entry[]): { steps: number; typical: number } | undefined {
  const e = entries.find((x) => x.date === date);
  const t = typicalSteps(date, entries);
  if (!e?.steps || !t) return undefined;
  return e.steps >= t * 1.25 && e.steps >= 8000 ? { steps: e.steps, typical: t } : undefined;
}

export const trainingPainOf = (e: Entry) => e.trainingPain ?? e.isotonicPain ?? e.isoPain;

export interface DayStatus {
  status: Status;
  reasons: string[];
  computed: Status;
}

const rank: Record<Status, number> = { green: 0, amber: 1, red: 2 };
export const worst = (a: Status, b: Status): Status => (rank[a] >= rank[b] ? a : b);

/**
 * Pain-monitoring model (Silbernagel-style):
 *  - flare logged: red
 *  - morning pain at/above the threshold (default 5): red
 *  - morning vs 7-day baseline: +1 amber, +2 or more red
 *  - pain during training: 4-5 amber, over 5 red
 *  - evening 2+ above the morning (or evening baseline): amber (the day stirred it up)
 * Returns null when there is nothing to judge.
 */
export function dayStatus(entry: Entry | undefined, entries: Entry[], threshold = 5): DayStatus | null {
  if (!entry) return null;
  const tp = trainingPainOf(entry);
  const hasPain = entry.morningPain != null || entry.eveningPain != null || tp != null || entry.flare;
  if (!hasPain && !entry.statusOverride) return null;

  const base = baselineFor(entry.date, entries);
  let s: Status = "green";
  const reasons: string[] = [];
  const am = entry.morningPain;

  if (entry.flare) {
    s = "red";
    reasons.push("Flare logged");
  }
  if (am != null && am >= threshold) {
    s = worst(s, "red");
    reasons.push(`Morning ${am}/10 (at or over ${threshold})`);
  } else if (am != null && base.morning != null) {
    const d = am - base.morning;
    if (d >= 2) {
      s = worst(s, "red");
      reasons.push(`Morning ${am}/10 vs usual ${base.morning}`);
    } else if (d >= 1) {
      s = worst(s, "amber");
      reasons.push(`Morning ${am}/10, 1 above usual ${base.morning}`);
    }
  }
  if (tp != null && tp > 5) {
    s = worst(s, "red");
    reasons.push(`Training pain ${tp}/10 (over 5)`);
  } else if (tp != null && tp > 3) {
    s = worst(s, "amber");
    reasons.push(`Training pain ${tp}/10 (over 3)`);
  }
  const pm = entry.eveningPain;
  const ref = am ?? base.evening;
  if (pm != null && ref != null && pm - ref >= 2) {
    s = worst(s, "amber");
    reasons.push(`Evening ${pm}/10, up from ${am != null ? `morning ${am}` : `usual ${ref}`}`);
  }
  if (!reasons.length) {
    reasons.push(base.morning == null ? "Building a baseline (needs 3 mornings)" : `At or below usual (${base.morning}/10)`);
  }
  return {
    computed: s,
    status: entry.statusOverride ?? s,
    reasons: entry.statusOverride ? [`Manually set to ${entry.statusOverride}`, ...reasons] : reasons,
  };
}

// ---------- summaries ----------
export function streak(entries: Entry[], today: string, threshold = 5): number {
  const map = byDate(entries);
  let n = 0;
  for (let i = 0; i < 60; i++) {
    const d = addDays(today, -i);
    const s = dayStatus(map.get(d), entries, threshold)?.status;
    if (s === "green") n++;
    else if (i === 0 && !s) continue;
    else break;
  }
  return n;
}

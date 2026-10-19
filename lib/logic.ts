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

// ---------- baseline & daily status ----------
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

export interface DayStatus {
  status: Status;
  reasons: string[];
  computed: Status;
}

const rank: Record<Status, number> = { green: 0, amber: 1, red: 2 };
const worst = (a: Status, b: Status): Status => (rank[a] >= rank[b] ? a : b);

/**
 * Silbernagel-style monitoring:
 *  - morning (first steps) vs 7-day baseline: +0 green, +1 amber, +2 or more red
 *  - evening vs baseline: +1 amber, +2 or more red
 *  - pain during loading > 3/10: at least amber
 * Returns null when there is nothing to judge.
 */
export function dayStatus(entry: Entry | undefined, entries: Entry[]): DayStatus | null {
  if (!entry) return null;
  const hasPain =
    entry.morningPain != null ||
    entry.eveningPain != null ||
    entry.isoPain != null ||
    entry.isotonicPain != null ||
    entry.toeOffPain != null;
  if (!hasPain && !entry.statusOverride) return null;

  const base = baselineFor(entry.date, entries);
  let s: Status = "green";
  const reasons: string[] = [];

  if (entry.morningPain != null && base.morning != null) {
    const d = entry.morningPain - base.morning;
    if (d >= 2) {
      s = worst(s, "red");
      reasons.push(`Morning ${entry.morningPain}/10 vs baseline ${base.morning}`);
    } else if (d >= 1) {
      s = worst(s, "amber");
      reasons.push(`Morning ${entry.morningPain}/10, 1 above baseline ${base.morning}`);
    }
  }
  if (entry.eveningPain != null && base.evening != null) {
    const d = entry.eveningPain - base.evening;
    if (d >= 2) {
      s = worst(s, "red");
      reasons.push(`Evening ${entry.eveningPain}/10 vs baseline ${base.evening}`);
    } else if (d >= 1) {
      s = worst(s, "amber");
      reasons.push(`Evening ${entry.eveningPain}/10, 1 above baseline ${base.evening}`);
    }
  }
  for (const [label, v] of [
    ["Isometric", entry.isoPain],
    ["Isotonic", entry.isotonicPain],
    ["Walking/toe-off", entry.toeOffPain],
  ] as const) {
    if (v != null && v > 3) {
      s = worst(s, "amber");
      reasons.push(`${label} pain ${v}/10 (over 3)`);
    }
  }
  if (!reasons.length) {
    reasons.push(
      base.morning == null
        ? "Building baseline (needs 3 days of morning scores)"
        : "At or below baseline"
    );
  }
  return {
    computed: s,
    status: entry.statusOverride ?? s,
    reasons: entry.statusOverride ? [`Manually set to ${entry.statusOverride}`, ...reasons] : reasons,
  };
}

// ---------- summaries ----------
export function streak(entries: Entry[], today: string): number {
  const map = byDate(entries);
  let n = 0;
  for (let i = 0; i < 60; i++) {
    const d = addDays(today, -i);
    const s = dayStatus(map.get(d), entries)?.status;
    if (s === "green") n++;
    else if (i === 0 && !s) continue;
    else break;
  }
  return n;
}

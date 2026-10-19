import type { Entry, Settings, Status, ChangeLog } from "./types.ts";

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

export function stepTarget(settings: Settings, date: string): number {
  return isWeekend(date) ? settings.weekendTarget : settings.weekdayTarget;
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

// ---------- NSAID washout ----------
export function nsaidHold(settings: Settings, today: string): { active: boolean; until?: string } {
  if (!settings.nsaidStart) return { active: false };
  const end = settings.nsaidEnd ?? addDays(settings.nsaidStart, 6);
  const until = addDays(end, 4);
  return { active: today >= settings.nsaidStart && today <= until, until };
}

// ---------- suggestions ----------
export interface Suggestion {
  id: string;
  tone: "progress" | "hold" | "back" | "info";
  title: string;
  detail: string;
  action?: { kind: ChangeLog["kind"]; to: number; weekendTo?: number };
}

/** Steps and isotonic loading count as the weekly "one variable". */
export function weeklyLock(settings: Settings, today: string): { locked: boolean; until?: string; kind?: string } {
  const recent = settings.changes
    .filter((c) => c.kind !== "iso" && c.to > c.from) // drops back don't lock
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!recent) return { locked: false };
  const until = addDays(recent.date, 7);
  return { locked: today < until, until, kind: recent.kind };
}

export function suggestions(entries: Entry[], settings: Settings, today: string): Suggestion[] {
  const map = byDate(entries);
  const out: Suggestion[] = [];
  const hold = nsaidHold(settings, today);
  const lock = weeklyLock(settings, today);
  const st = (d: string) => dayStatus(map.get(d), entries)?.status;

  if (hold.active) {
    out.push({
      id: "nsaid",
      tone: "hold",
      title: `Hold all progressions until ${prettyDate(hold.until!)}`,
      detail:
        "Diclofenac blunts the pain signal. Keep steps at the current target and isometrics with the bar only. Re-baseline 3–4 days after stopping.",
    });
  }

  // Monday weekend check
  if (dow(today) === 1) {
    const mon = map.get(today)?.morningPain;
    const fri = map.get(addDays(today, -3))?.morningPain;
    if (mon != null && fri != null) {
      const ok = mon <= fri;
      out.push({
        id: "monday",
        tone: ok ? "info" : "hold",
        title: ok ? "Weekend tolerated" : "Weekend cost you something",
        detail: ok
          ? `Monday morning ${mon}/10 vs Friday ${fri}/10. The 10k days are within capacity.`
          : `Monday morning ${mon}/10 vs Friday ${fri}/10. Weekends may be at your ceiling, so hold weekday steps until Mondays settle.`,
      });
    } else {
      out.push({
        id: "monday",
        tone: "info",
        title: "Monday check",
        detail: "Log this morning's first-steps pain to compare against Friday morning.",
      });
    }
  }

  // ----- Steps (weekly) -----
  const window = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const statuses = window.map(st).filter(Boolean) as Status[];
  const reds = statuses.filter((s) => s === "red").length;
  const ambers = statuses.filter((s) => s === "amber").length;
  const weekdayLogged = window
    .filter((d) => !isWeekend(d))
    .map((d) => map.get(d)?.steps)
    .filter((x): x is number => x != null);
  const weekdayAvg = weekdayLogged.length
    ? weekdayLogged.reduce((a, b) => a + b, 0) / weekdayLogged.length
    : 0;

  if (statuses.length < 5) {
    out.push({
      id: "steps",
      tone: "info",
      title: "Steps: keep logging",
      detail: `${statuses.length} of the last 7 days have a status. Need 5 before a step decision.`,
    });
  } else if (reds > 0) {
    const to = Math.max(6000, settings.weekdayTarget - settings.stepIncrement);
    out.push({
      id: "steps",
      tone: to < settings.weekdayTarget ? "back" : "hold",
      title: to < settings.weekdayTarget ? `Steps: drop weekdays to ${to.toLocaleString()}` : "Steps: hold at 6,000",
      detail: `${reds} red day${reds > 1 ? "s" : ""} in the last 7. ${to < settings.weekdayTarget ? "Drop back one step" : "Already at the 6,000 floor, so hold"} until mornings settle.`,
      action: to < settings.weekdayTarget ? { kind: "steps", to, weekendTo: settings.weekendTarget } : undefined,
    });
  } else if (ambers >= 2) {
    out.push({
      id: "steps",
      tone: "hold",
      title: `Steps: hold at ${settings.weekdayTarget.toLocaleString()}`,
      detail: `${ambers} amber days in the last 7. Hold until the week is mostly green.`,
    });
  } else if (hold.active) {
    // covered by the NSAID card
  } else if (lock.locked) {
    out.push({
      id: "steps",
      tone: "hold",
      title: "Steps: green, but wait",
      detail: `You changed ${lock.kind === "steps" ? "steps" : "isotonic load"} recently. One variable per week, so next step change from ${prettyDate(lock.until!)}.`,
    });
  } else if (weekdayAvg < settings.weekdayTarget * 0.9) {
    out.push({
      id: "steps",
      tone: "hold",
      title: "Steps: green, but under target",
      detail: `Weekday average ${Math.round(weekdayAvg).toLocaleString()} vs target ${settings.weekdayTarget.toLocaleString()}. Hit the current target for a week before raising it.`,
    });
  } else if (settings.weekdayTarget < settings.weekendTarget) {
    const to = Math.min(settings.weekendTarget, settings.weekdayTarget + settings.stepIncrement);
    out.push({
      id: "steps",
      tone: "progress",
      title: `Steps: raise weekdays to ${to.toLocaleString()}`,
      detail: "Green week. Weekends stay at their baseline; weekdays catch up.",
      action: { kind: "steps", to, weekendTo: settings.weekendTarget },
    });
  } else if (settings.weekdayTarget < settings.goalSteps) {
    const to = Math.min(settings.goalSteps, settings.weekdayTarget + settings.stepIncrement);
    out.push({
      id: "steps",
      tone: "progress",
      title: `Steps: raise all days to ${to.toLocaleString()}`,
      detail: "Weekdays have caught up with weekends, so the whole week moves together now.",
      action: { kind: "steps", to, weekendTo: Math.max(settings.weekendTarget, to) },
    });
  } else {
    out.push({
      id: "steps",
      tone: "info",
      title: "Steps: at goal",
      detail: `You're at ${settings.goalSteps.toLocaleString()}. Hold here, or raise the goal in Plan.`,
    });
  }

  // ----- Isometric load (every 3–4 green days) -----
  const last3 = [0, 1, 2].map((i) => addDays(today, -i));
  const todayStatus = st(today);
  const lastIso = [...settings.changes].filter((c) => c.kind === "iso").sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const isoRecent = lastIso && daysBetween(lastIso.date, today) < 3;
  if (todayStatus === "red" && settings.isoLoadKg > 20) {
    const to = lastIso && lastIso.to === settings.isoLoadKg ? lastIso.from : Math.max(20, settings.isoLoadKg - 5);
    out.push({
      id: "iso",
      tone: "back",
      title: `Isometrics: drop to ${to}kg`,
      detail: "Red today. Go back to the last load that was green.",
      action: { kind: "iso", to },
    });
  } else if (!hold.active && !isoRecent && last3.every((d) => st(d) === "green" && map.get(d)?.isoDone)) {
    const to = settings.isoLoadKg + 5;
    out.push({
      id: "iso",
      tone: "progress",
      title: `Isometrics: add 5kg (to ${to}kg)`,
      detail: "Three green days in a row with holds done.",
      action: { kind: "iso", to },
    });
  } else {
    out.push({
      id: "iso",
      tone: "info",
      title: `Isometrics: ${settings.isoLoadKg}kg`,
      detail: hold.active
        ? "Bar only during the NSAID washout."
        : isoRecent
          ? "Load changed in the last 3 days. Give it time."
          : "Needs 3 consecutive green days with holds logged to add 5kg.",
    });
  }

  // ----- Isotonic (seated raise) after leg days -----
  const legDays = entries
    .filter((e) => e.legDay && e.date < today && daysBetween(e.date, today) <= 14)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const after = (e: Entry) => st(addDays(e.date, 1));
  if (legDays.length) {
    const last = legDays[0];
    if (after(last) === "red") {
      const to = Math.max(0, settings.seatedLoadKg - 5);
      out.push({
        id: "isotonic",
        tone: "back",
        title: `Seated raise: drop to ${to}kg`,
        detail: `Red the morning after ${prettyDate(last.date)}'s session.`,
        action: { kind: "isotonic", to },
      });
    } else if (
      legDays.length >= 2 &&
      legDays.slice(0, 2).every((e) => after(e) === "green" && (e.isotonicPain ?? 0) <= 3) &&
      !hold.active &&
      !lock.locked
    ) {
      const to = settings.seatedLoadKg + 5;
      out.push({
        id: "isotonic",
        tone: "progress",
        title: `Seated raise: add 5kg (to ${to}kg)`,
        detail: "Two leg days in a row tolerated. This counts as this week's change.",
        action: { kind: "isotonic", to },
      });
    }
  }

  return out;
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

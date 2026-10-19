import type { Entry, Settings, Status, Course, DoseStep } from "./types.ts";
import { addDays, daysBetween, dayStatus, dow, isWeekend, prettyDate } from "./logic.ts";

// ======================================================================
// Diclofenac
// ======================================================================
export const courseStart = (c: Course) => c.steps.reduce((m, s) => (s.from < m ? s.from : m), c.steps[0]?.from ?? "9999-12-31");
export const courseEnd = (c: Course) => c.steps.reduce((m, s) => (s.to > m ? s.to : m), c.steps[0]?.to ?? "0000-01-01");

export function doseOn(settings: Settings, date: string): (DoseStep & { course: Course }) | null {
  for (const c of settings.courses) for (const s of c.steps) if (s.from <= date && date <= s.to) return { ...s, course: c };
  return null;
}

/** Progressions hold from a course's first day until 4 days after its last dose. */
export function nsaidHold(settings: Settings, date: string): { active: boolean; until?: string } {
  let until: string | undefined;
  for (const c of settings.courses) {
    if (!c.steps.length) continue;
    const u = addDays(courseEnd(c), 4);
    if (courseStart(c) <= date && date <= u && (!until || u > until)) until = u;
  }
  return { active: !!until, until };
}

/** Most recent day before `date` with a dose, scheduled or logged. */
export function lastDoseBefore(settings: Settings, entries: Entry[], date: string): string | undefined {
  let last: string | undefined;
  for (const c of settings.courses)
    for (const s of c.steps) {
      if (s.from >= date) continue;
      const end = s.to < date ? s.to : addDays(date, -1);
      if (!last || end > last) last = end;
    }
  for (const e of entries) if (e.date < date && ((e.doses ?? 0) > 0 || e.nsaid) && (!last || e.date > last)) last = e.date;
  return last;
}

export function clearDays(settings: Settings, entries: Entry[], date: string): number {
  const last = lastDoseBefore(settings, entries, date);
  return last ? daysBetween(last, date) - 1 : 999;
}

export const RESCUE_DAYS = 3;
export const CLEAR_DAYS_REQUIRED = 7;

export function rescueCourse(start: string): Course {
  return {
    id: `rescue-${start}`,
    kind: "rescue",
    steps: [{ from: start, to: addDays(start, RESCUE_DAYS - 1), mg: 50, perDay: 3 }],
  };
}

// ======================================================================
// Replay: targets evolve day by day from history
// ======================================================================
export interface PlanEvent {
  date: string;
  kind: "steps" | "iso" | "seated" | "standing" | "reset";
  from: string;
  to: string;
  why: string;
  dir: 1 | -1 | 0;
}

export interface DayState {
  date: string;
  weekday: number;
  weekend: number;
  iso: number;
  seated: number;
  standingLevel: number; // 0 bilateral BW, 1 single-leg BW, 2+ single-leg + (level-1)*2.5kg
  hold: boolean;
  holdUntil?: string;
  status?: Status;
}

const STANDING_NAMES = (lvl: number) =>
  lvl <= 0 ? "Double-leg, bodyweight" : lvl === 1 ? "Single-leg, bodyweight" : `Single-leg + ${(lvl - 1) * 2.5}kg`;

export function standingRx(level: number) {
  if (level <= 0) return { desc: "Double-leg, bodyweight", sets: 3, reps: 15, loadKg: 0 };
  if (level === 1) return { desc: "Single-leg, bodyweight", sets: 3, reps: 12, loadKg: 0 };
  return { desc: `Single-leg, hold ${(level - 1) * 2.5}kg`, sets: 3, reps: 10, loadKg: (level - 1) * 2.5 };
}

export function seatedScheme(load: number) {
  if (load < 40) return { sets: 3, reps: 15 };
  if (load < 70) return { sets: 3, reps: 12 };
  return { sets: 4, reps: 8 };
}

function anchorMonday(settings: Settings): string {
  // first Monday on/after plan start that is clear of every diclofenac hold
  let anchor = settings.planStart;
  for (let i = 0; i < 400 && (dow(anchor) !== 1 || nsaidHold(settings, anchor).active); i++) anchor = addDays(anchor, 1);
  return anchor;
}

export type WeekKind = "pre" | "steps" | "calves" | "hold";

/**
 * Weeks run Monday–Sunday from the first Monday after the diclofenac hold.
 * Every Nth week is a hold week; the others alternate steps week / calf week,
 * so only one thing changes in any week and both get regular turns.
 */
export function weekKind(settings: Settings, date: string): WeekKind {
  const anchor = anchorMonday(settings);
  if (date < anchor) return "pre";
  const w = Math.floor(daysBetween(anchor, date) / 7);
  const n = settings.consolidateEvery;
  if (n >= 2 && w % n === n - 1) return "hold";
  const active = n >= 2 ? w - Math.floor((w + 1) / n) : w; // non-hold weeks before this one
  return active % 2 === 0 ? "steps" : "calves";
}

export const isConsolidation = (settings: Settings, date: string) => weekKind(settings, date) === "hold";

export function replay(entries: Entry[], settings: Settings, through: string): { days: DayState[]; events: PlanEvent[] } {
  const map = new Map(entries.map((e) => [e.date, e]));
  const statusCache = new Map<string, Status | undefined>();
  const st = (d: string) => {
    if (!statusCache.has(d)) statusCache.set(d, dayStatus(map.get(d), entries)?.status);
    return statusCache.get(d);
  };
  const tolerated = (e: Entry) => (e.isotonicPain ?? 0) <= 3 && st(addDays(e.date, 1)) === "green";
  // days on (or just off) diclofenac are masked, so they never count as evidence for progressing
  const evidence = (d: string) => d >= settings.planStart && !nsaidHold(settings, d).active;
  let lastCalfUp: string | undefined;
  let lastCalfKind: "seated" | "standing" = "standing";
  // one calf progression per calf week
  const calfUpThisWeek = (d: string) => !!lastCalfUp && lastCalfUp >= addDays(d, -((dow(d) + 6) % 7));

  let weekday = settings.weekdayStart;
  let weekend = settings.weekendStart;
  let iso = settings.isoStart;
  let seated = settings.seatedStart;
  let standing = 0;
  const isoStack: number[] = [];
  let lastIsoChange = addDays(settings.planStart, -10);
  let legSinceSeatedUp = 0;
  let legSinceStandingUp = 0;

  const days: DayState[] = [];
  const events: PlanEvent[] = [];
  const ev = (e: PlanEvent) => events.push(e);
  const overrides = [...settings.overrides].sort((a, b) => (a.date < b.date ? -1 : 1));

  if (through < settings.planStart) return { days, events };

  for (let d = settings.planStart; d <= through; d = addDays(d, 1)) {
    for (const o of overrides.filter((o) => o.date === d)) {
      if (o.weekday != null) weekday = o.weekday;
      if (o.weekend != null) weekend = o.weekend;
      if (o.iso != null) iso = o.iso;
      if (o.seated != null) seated = o.seated;
      ev({ date: d, kind: "reset", from: "", to: "manual", why: "Targets reset in Plan", dir: 0 });
    }

    const hold = nsaidHold(settings, d);
    const today = st(d);

    // ---- leg-day sessions completed before today (for isotonic rules) ----
    const yesterday = map.get(addDays(d, -1));
    if (yesterday?.legDay && yesterday.date >= settings.planStart) {
      const masked = !evidence(yesterday.date);
      // judged this morning
      if (st(d) === "red") {
        if (seated > settings.seatedStart) {
          ev({ date: d, kind: "seated", from: `${seated}kg`, to: `${Math.max(settings.seatedStart, seated - settings.seatedIncrement)}kg`, why: "Red morning after a leg day", dir: -1 });
          seated = Math.max(settings.seatedStart, seated - settings.seatedIncrement);
        }
        if (standing > 0) {
          ev({ date: d, kind: "standing", from: STANDING_NAMES(standing), to: STANDING_NAMES(standing - 1), why: "Red morning after a leg day", dir: -1 });
          standing -= 1;
        }
        legSinceSeatedUp = 0;
        legSinceStandingUp = 0;
      } else if (masked) {
        // doesn't count either way
      } else if (tolerated(yesterday)) {
        legSinceSeatedUp++;
        legSinceStandingUp++;
      } else {
        legSinceSeatedUp = 0;
        legSinceStandingUp = 0;
      }
    }

    // ---- steps: weekly review on Mondays ----
    if (dow(d) === 1 && daysBetween(settings.planStart, d) >= 7) {
      const win = Array.from({ length: 7 }, (_, i) => addDays(d, -i));
      const ss = win.map(st).filter(Boolean) as Status[];
      const reds = ss.filter((s) => s === "red").length;
      const ambers = ss.filter((s) => s === "amber").length;
      const wk = win
        .filter((x) => !isWeekend(x) && x !== d)
        .map((x) => map.get(x)?.steps)
        .filter((x): x is number => x != null);
      const avg = wk.length ? wk.reduce((a, b) => a + b, 0) / wk.length : 0;
      const mon = map.get(d)?.morningPain;
      const fri = map.get(addDays(d, -3))?.morningPain;
      const weekendCost = mon != null && fri != null && mon > fri;
      const win14 = Array.from({ length: 14 }, (_, i) => addDays(d, -i)).filter((x) => x >= settings.planStart);
      const ss14 = win14.map(st).filter(Boolean) as Status[];
      const reds14 = ss14.filter((s) => s === "red").length;
      const stable = win14.length >= 14 && win14.every(evidence) && ss14.length >= 10 && reds14 === 0;

      if (reds > 0 && weekday > settings.weekdayStart) {
        const to = Math.max(settings.weekdayStart, weekday - settings.stepIncrement);
        ev({ date: d, kind: "steps", from: weekday.toLocaleString(), to: to.toLocaleString(), why: `${reds} red day${reds > 1 ? "s" : ""} last week`, dir: -1 });
        weekday = to;
        if (weekend > settings.weekendStart) weekend = Math.max(settings.weekendStart, weekend - settings.stepIncrement);
      } else if (weekKind(settings, d) === "steps" && stable && ambers <= 1 && !hold.active && !weekendCost && wk.length >= 3 && avg >= weekday * 0.9) {
        if (weekday < weekend) {
          const to = Math.min(weekend, weekday + settings.stepIncrement);
          ev({ date: d, kind: "steps", from: weekday.toLocaleString(), to: to.toLocaleString(), why: "2 weeks without a red, last week green, at target", dir: 1 });
          weekday = to;

        } else if (weekday < settings.goalSteps) {
          const to = Math.min(settings.goalSteps, weekday + settings.stepIncrement);
          ev({ date: d, kind: "steps", from: weekday.toLocaleString(), to: `${to.toLocaleString()} (all days)`, why: "Green week; weekdays caught up with weekends", dir: 1 });
          weekday = to;
          weekend = Math.max(weekend, to);

        }
      }
    }

    // ---- isometrics ----
    if (today === "red" && iso > settings.isoStart) {
      const to = isoStack.pop() ?? Math.max(settings.isoStart, iso - settings.isoIncrement);
      ev({ date: d, kind: "iso", from: `${iso}kg`, to: `${to}kg`, why: "Red morning", dir: -1 });
      iso = to;
      lastIsoChange = d;
    } else if (
      !hold.active &&
      !isConsolidation(settings, d) &&
      iso + settings.isoIncrement <= settings.isoMax &&
      daysBetween(lastIsoChange, d) >= settings.isoGreenDays &&
      Array.from({ length: settings.isoGreenDays }, (_, k) => k + 1).every((i) => {
        const x = addDays(d, -i);
        return evidence(x) && st(x) === "green" && map.get(x)?.isoDone;
      }) &&
      today !== "amber"
    ) {
      isoStack.push(iso);
      ev({ date: d, kind: "iso", from: `${iso}kg`, to: `${iso + settings.isoIncrement}kg`, why: `${settings.isoGreenDays} green days with holds done`, dir: 1 });
      iso += settings.isoIncrement;
      lastIsoChange = d;
    }

    // ---- isotonics: progress on a scheduled leg day ----
    if (settings.legDays.includes(dow(d)) && !hold.active && today !== "red" && today !== "amber" && weekKind(settings, d) === "calves" && !calfUpThisWeek(d)) {
      const need = settings.sessionsToProgress;
      const seatedReady = legSinceSeatedUp >= need;
      const standingReady = legSinceStandingUp >= need && standing < 8;
      const pick: "seated" | "standing" | undefined =
        seatedReady && standingReady ? (lastCalfKind === "seated" ? "standing" : "seated") : seatedReady ? "seated" : standingReady ? "standing" : undefined;
      if (pick === "seated") {
        ev({ date: d, kind: "seated", from: `${seated}kg`, to: `${seated + settings.seatedIncrement}kg`, why: `${need} leg days tolerated`, dir: 1 });
        seated += settings.seatedIncrement;
        legSinceSeatedUp = 0;
        lastCalfUp = d;
        lastCalfKind = "seated";
      } else if (pick === "standing") {
        ev({ date: d, kind: "standing", from: STANDING_NAMES(standing), to: STANDING_NAMES(standing + 1), why: `${need} leg days tolerated`, dir: 1 });
        standing += 1;
        legSinceStandingUp = 0;
        lastCalfUp = d;
        lastCalfKind = "standing";
      }
    }

    days.push({ date: d, weekday, weekend, iso, seated, standingLevel: standing, hold: hold.active, holdUntil: hold.until, status: today });
  }
  return { days, events };
}

// ======================================================================
// Today's prescription
// ======================================================================
export interface Alert {
  id: string;
  tone: "info" | "hold" | "back" | "progress";
  title: string;
  detail: string;
  action?: "start-rescue";
}

export interface DayPlan {
  date: string;
  state: DayState;
  status?: Status;
  morningLogged: boolean;
  steps: { target: number; note: string };
  iso: { load: number; sets: number; hold: string; effort: string; note: string };
  legDay: boolean;
  calves?: {
    skip: boolean;
    note: string;
    seated: { load: number; sets: number; reps: number };
    standing: { desc: string; sets: number; reps: number; loadKg: number };
  };
  legMods: string[];
  dose?: { mg: number; perDay: number; kind: Course["kind"]; phaseEnds: string; then: string };
  alerts: Alert[];
  todayEvents: PlanEvent[];
}

export const LEG_MODS = [
  "Calf work first, while fresh",
  "Squat: box squat to parallel, heels raised (lifting shoes or wedge)",
  "Deadlift: trap bar or block pulls",
  "Lunges → rear-foot-elevated split squat, vertical front shin (or low step-ups)",
  "Leg press: feet high, press through heels, stop before heels lift",
  "Leg extensions and hamstring curls as normal",
  "Hold leg loads where they are this block",
];

export function planFor(entries: Entry[], settings: Settings, date: string): { plan: DayPlan; events: PlanEvent[]; days: DayState[] } {
  const { days, events } = replay(entries, settings, date);
  const state: DayState =
    days[days.length - 1] ??
    ({ date, weekday: settings.weekdayStart, weekend: settings.weekendStart, iso: settings.isoStart, seated: settings.seatedStart, standingLevel: 0, hold: false } as DayState);
  const entry = entries.find((e) => e.date === date);
  const status = dayStatus(entry, entries)?.status;
  const weekend = isWeekend(date);
  const baseline = weekend ? settings.weekendStart : settings.weekdayStart;
  const alerts: Alert[] = [];

  // ---- steps ----
  let target = weekend ? state.weekend : state.weekday;
  let stepNote = "Spread it through the day in 10–15 min chunks, flat ground, rocker shoes.";
  if (status === "red") {
    target = Math.min(target, baseline);
    stepNote =
      target === baseline
        ? `Red morning: baseline only (${baseline.toLocaleString()}). No extra walking; shorter stride, short chunks.`
        : `Red morning: back to baseline ${baseline.toLocaleString()} today.`;
  } else if (status === "amber") {
    stepNote = "Amber: hit the target, don't exceed it. " + stepNote;
  }
  if (weekend) stepNote += " Weekend baseline is fixed; manage how, not how much.";

  // ---- isometrics ----
  const isoSets = status === "red" ? 4 : 5;
  const iso = {
    load: state.iso,
    sets: isoSets,
    hold: "30–45 s",
    effort: status === "red" ? "30–50%" : "50–70%",
    note: `Seated soleus hold, heels halfway up, ${state.iso}kg across knees. ${weekend ? "Do a set before longer walks." : "At work: desk push at the same effort instead."} Pain ≤3/10 and should ease.`,
  };

  // ---- leg day ----
  const legDay = settings.legDays.includes(dow(date));
  let calves: DayPlan["calves"];
  if (legDay) {
    const sch = seatedScheme(state.seated);
    const stand = standingRx(state.standingLevel);
    calves = {
      skip: status === "red",
      note:
        status === "red"
          ? "Red morning: skip calf isotonics today. Leg session without loaded calf work (extensions, curls, trap bar)."
          : status === "amber"
            ? "Amber: same loads, no extra sets."
            : "3 s up, 3 s down. Flat floor, no drop below neutral.",
      seated: { load: state.seated, ...sch },
      standing: stand,
    };
  }

  // ---- diclofenac ----
  const d = doseOn(settings, date);
  const dose: DayPlan["dose"] = d ? { mg: d.mg, perDay: d.perDay, kind: d.course.kind, phaseEnds: d.to, then: "" } : undefined;
  if (dose) {
    const next = settings.courses
      .flatMap((c) => c.steps)
      .filter((x) => x.from > date)
      .sort((x, y) => (x.from < y.from ? -1 : 1))[0];
    dose.then =
      next && next.from === addDays(dose.phaseEnds, 1)
        ? `Until ${prettyDate(dose.phaseEnds)}, then ${next.mg}mg × ${next.perDay}`
        : `Until ${prettyDate(dose.phaseEnds)}, then stop`;
  }
  if (state.hold && state.holdUntil) {
    alerts.push({
      id: "hold",
      tone: "hold",
      title: `Progressions on hold until ${prettyDate(state.holdUntil)}`,
      detail: "Diclofenac blunts the pain signal, so targets stay put until 4 days after the last dose.",
    });
  }

  // ---- pain threshold ----
  const t = settings.painThreshold;
  const high = entry
    ? ([
        ["morning", entry.morningPain],
        ["walking", entry.toeOffPain],
        ["evening", entry.eveningPain],
      ] as const).filter(([, v]) => v != null && v >= t)
    : [];
  const prevStatus = dayStatus(entries.find((e) => e.date === addDays(date, -1)), entries)?.status;
  const twoReds = status === "red" && prevStatus === "red";
  if (high.length || twoReds) {
    const why = high.length ? `${high.map(([k, v]) => `${k} ${v}/10`).join(", ")} (threshold ${t})` : "Two red days in a row";
    const onCourse = !!d;
    const clear = clearDays(settings, entries, date);
    const rescues28 = settings.courses.filter((c) => c.kind === "rescue" && daysBetween(courseStart(c), date) < 28 && courseStart(c) <= date).length;
    // persistent high pain on a course
    const recentHigh = [0, 1, 2].every((i) => {
      const e = entries.find((x) => x.date === addDays(date, -i));
      return e && [e.morningPain, e.toeOffPain, e.eveningPain].some((v) => v != null && v >= t);
    });
    if (onCourse) {
      alerts.push({
        id: "pain",
        tone: "back",
        title: "Pain over threshold while on diclofenac",
        detail: `${why}. Don't increase the dose. Offload: CAM boot with heel wedges for 2–3 days, baseline steps only, isometrics only.${recentHigh ? " Three days over threshold on an NSAID: book MRI and a sports physician." : ""}`,
      });
    } else if (rescues28 >= 2) {
      alerts.push({
        id: "pain",
        tone: "back",
        title: "Pain over threshold: escalate",
        detail: `${why}. Two rescue courses in the last 4 weeks. More NSAID isn't the answer: offload (boot), and book MRI and a sports physician.`,
      });
    } else if (clear >= CLEAR_DAYS_REQUIRED) {
      alerts.push({
        id: "pain",
        tone: "back",
        title: "Pain over threshold: consider a short course",
        detail: `${why}. Option: diclofenac 50mg × 3 with food for ${RESCUE_DAYS} days, then stop. Offload alongside (boot or baseline steps, isometrics only). Progressions will hold until 4 days after.`,
        action: "start-rescue",
      });
    } else {
      const ok = addDays(date, CLEAR_DAYS_REQUIRED - clear);
      alerts.push({
        id: "pain",
        tone: "back",
        title: "Pain over threshold: offload, no NSAID yet",
        detail: `${why}. Only ${clear} clear day${clear === 1 ? "" : "s"} since the last dose; a new course needs ${CLEAR_DAYS_REQUIRED} (earliest ${prettyDate(ok)}). Use the boot or baseline steps and isometrics only.`,
      });
    }
  }

  // ---- escalation after stopping ----
  const lastCourse = [...settings.courses].sort((a, b) => (courseEnd(a) < courseEnd(b) ? 1 : -1))[0];
  if (lastCourse && !d) {
    const since = daysBetween(courseEnd(lastCourse), date);
    if (since >= 7 && since <= 21) {
      const win = Array.from({ length: 7 }, (_, i) => dayStatus(entries.find((e) => e.date === addDays(date, -i)), entries)?.status);
      const bad = win.filter((s) => s === "red").length >= 2 || win.filter((s) => s && s !== "green").length >= 5;
      if (bad)
        alerts.push({
          id: "escalate",
          tone: "back",
          title: "Not settling since stopping diclofenac",
          detail: `${since} days off and still mostly amber/red. That's the trigger we set: MRI and sports physician review.`,
        });
    }
  }

  const wk = weekKind(settings, date);
  if (wk === "hold")
    alerts.push({ id: "week", tone: "info", title: "Hold week", detail: `Every ${settings.consolidateEvery}th week nothing progresses. Same targets; let the tendon catch up.` });
  else if (wk === "steps")
    alerts.push({ id: "week", tone: "info", title: "Steps week", detail: "Steps can step up on Monday if the last 2 weeks earned it. Calf loads stay put this week." });
  else if (wk === "calves")
    alerts.push({ id: "week", tone: "info", title: "Calf week", detail: "One calf progression is allowed on a leg day this week if earned. Steps stay put." });

  // ---- Monday ----
  if (dow(date) === 1) {
    const mon = entry?.morningPain;
    const fri = entries.find((e) => e.date === addDays(date, -3))?.morningPain;
    if (mon != null && fri != null)
      alerts.push({
        id: "monday",
        tone: mon <= fri ? "progress" : "hold",
        title: mon <= fri ? "Weekend tolerated" : "Weekend cost you something",
        detail: `Monday ${mon}/10 vs Friday ${fri}/10.${mon <= fri ? "" : " Weekday steps won't progress this week."}`,
      });
  }

  const todayEvents = events.filter((e) => e.date === date);
  for (const e of todayEvents)
    if (e.kind !== "reset")
      alerts.push({
        id: `ev-${e.kind}`,
        tone: e.dir < 0 ? "back" : "progress",
        title: `${{ steps: "Weekday steps", iso: "Isometric load", seated: "Seated raise", standing: "Standing raise", reset: "" }[e.kind]}: ${e.from} → ${e.to}`,
        detail: e.why,
      });

  return {
    plan: {
      date,
      state,
      status,
      morningLogged: entry?.morningPain != null,
      steps: { target, note: stepNote },
      iso,
      legDay,
      calves,
      legMods: LEG_MODS,
      dose,
      alerts,
      todayEvents,
    },
    events,
    days,
  };
}

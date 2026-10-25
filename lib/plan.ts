import type { Entry, Settings, Status, Training } from "./types.ts";
import {
  addDays,
  baselineFor,
  daysBetween,
  dayStatus,
  dow,
  heavySteps,
  prettyDate,
  trainingPainOf,
  trendFor,
  typicalSteps,
  type Trend,
} from "./logic.ts";

// ======================================================================
// Loads
// ======================================================================
export const STANDING_NAMES = (lvl: number) =>
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

/** Light range moves in double steps. */
export const stepFor = (load: number, inc: number, lightKg: number) => (load < lightKg ? inc * 2 : inc);
/** Step size when coming down from `load` (the step that got you there). */
const stepDown = (load: number, inc: number, lightKg: number) => (load <= lightKg ? inc * 2 : inc);
const round25 = (x: number) => Math.round(x / 2.5) * 2.5;

// ======================================================================
// Replay: loads evolve day by day from the log
// ======================================================================
export interface PlanEvent {
  date: string;
  kind: "iso" | "seated" | "standing" | "reset" | "flare";
  from: string;
  to: string;
  why: string;
  dir: 1 | -1 | 0;
}

export interface DayState {
  date: string;
  iso: number;
  seated: number;
  standingLevel: number;
  status?: Status; // full day status (morning, training, evening, flare)
  morning?: Status; // morning-only status, drives today's decisions
  masked: boolean; // anti-inflammatory washout: doesn't count as evidence
  flare: boolean;
  flareStart?: string;
  flareTarget?: number; // morning score that counts as settled
  legDay: boolean;
  skipCalves: boolean;
  training?: Training; // resolved session for the day
  isoBanked: number; // green days counted toward the next isometric step
  sessionsBanked: number; // tolerated sessions toward the next calf step
  trend?: Trend;
}

export function isScheduledLegDay(settings: Settings, date: string) {
  return settings.legDays.includes(dow(date));
}

const hasData = (e: Entry) => e.morningPain != null || e.eveningPain != null || e.steps != null || trainingPainOf(e) != null;

export function replay(entries: Entry[], settings: Settings, through: string) {
  const map = new Map(entries.map((e) => [e.date, e]));
  const th = settings.painThreshold;
  const cache = new Map<string, Status | undefined>();
  const st = (d: string) => {
    if (!cache.has(d)) cache.set(d, dayStatus(map.get(d), entries, th)?.status);
    return cache.get(d);
  };
  const amSt = (d: string) => {
    const e = map.get(d);
    if (!e || (e.morningPain == null && !e.flare)) return undefined;
    return dayStatus({ date: d, morningPain: e.morningPain, flare: e.flare }, entries, th)?.status;
  };
  const dosedNear = (d: string) =>
    [0, 1, 2, 3, 4].some((i) => {
      const e = map.get(addDays(d, -i));
      return !!e && ((e.doses ?? 0) > 0 || !!e.nsaid);
    });
  const masked = (d: string) => d < settings.planStart || (!!settings.lastNsaid && d <= addDays(settings.lastNsaid, 4)) || dosedNear(d);

  let iso = settings.isoStart;
  let seated = settings.seatedStart;
  let standing = 0;
  const isoStack: number[] = [];
  let lastIsoChange = addDays(settings.planStart, -30);
  let lastCalfChange = addDays(settings.planStart, -30);
  let lastDrop = addDays(settings.planStart, -30);
  let sessions = 0;
  let lastCalfKind: "seated" | "standing" = "standing";
  let flare = false;
  let flareStart: string | undefined;
  let flareTarget = 2;
  const flareStarts: string[] = [];

  const days: DayState[] = [];
  const events: PlanEvent[] = [];
  const ev = (e: PlanEvent) => events.push(e);
  const overrides = [...settings.overrides].sort((a, b) => (a.date < b.date ? -1 : 1));
  const inc = settings.isoIncrement;
  const sInc = settings.seatedIncrement;
  const L = settings.lightKg;

  const calvesDown = (d: string, why: string) => {
    if (seated > settings.seatedStart) {
      const to = Math.max(settings.seatedStart, seated - stepDown(seated, sInc, L));
      ev({ date: d, kind: "seated", from: `${seated}kg`, to: `${to}kg`, why, dir: -1 });
      seated = to;
    }
    if (standing > 0) {
      ev({ date: d, kind: "standing", from: STANDING_NAMES(standing), to: STANDING_NAMES(standing - 1), why, dir: -1 });
      standing -= 1;
    }
    sessions = 0;
  };
  const isoBack = (d: string, why: string) => {
    if (iso <= settings.isoStart) return;
    const to = isoStack.pop() ?? Math.max(settings.isoStart, iso - stepDown(iso, inc, L));
    ev({ date: d, kind: "iso", from: `${iso}kg`, to: `${to}kg`, why, dir: -1 });
    iso = to;
    lastIsoChange = d;
  };

  if (through < settings.planStart) return { days, events, flareStarts };

  for (let d = settings.planStart; d <= through; d = addDays(d, 1)) {
    for (const o of overrides.filter((o) => o.date === d)) {
      if (o.iso != null) iso = o.iso;
      if (o.seated != null) seated = o.seated;
      if (o.standing != null) standing = o.standing;
      isoStack.length = 0;
      ev({ date: d, kind: "reset", from: "", to: "manual", why: "Loads reset in Plan", dir: 0 });
    }

    const e = map.get(d);
    const am = amSt(d);
    const isMasked = masked(d);
    const prev = days[days.length - 1];
    const yd = addDays(d, -1);
    const trend = trendFor(d, entries);
    const heavyY = heavySteps(yd, entries);
    const stepsNote = heavyY ? ` (after ${heavyY.steps.toLocaleString()} steps, usual ${heavyY.typical.toLocaleString()})` : "";
    let changedDown = false;

    // ---- yesterday's leg session, judged by this morning ----
    if (prev && (prev.training === "done" || prev.training === "light")) {
      const ye = map.get(yd);
      const tp = ye ? trainingPainOf(ye) : undefined;
      if (am === "red" && !e?.flare) {
        calvesDown(d, `Red morning after a leg session${stepsNote}`);
        changedDown = true;
      } else if (tp != null && tp > 5) {
        calvesDown(d, `Training pain ${tp}/10 yesterday`);
        changedDown = true;
      } else if (am === "green" && prev.training === "done" && !prev.masked && (tp == null || tp <= 3)) {
        sessions++;
      } else if (am === "amber" || (tp != null && tp > 3)) {
        sessions = 0;
      }
    }

    // ---- exacerbation ----
    const flareOnset = !!e?.flare && !flare;
    if (flareOnset) {
      flare = true;
      flareStart = d;
      flareStarts.push(d);
      const b = baselineFor(d, entries).morning;
      flareTarget = b ?? map.get(yd)?.morningPain ?? 2;
      const to = Math.max(settings.isoStart, round25(iso * 0.8));
      if (to < iso) ev({ date: d, kind: "iso", from: `${iso}kg`, to: `${to}kg`, why: "Flare: isometrics down ~20%", dir: -1 });
      iso = to;
      isoStack.length = 0;
      lastIsoChange = d;
      calvesDown(d, "Flare: calf loads down a step");
      ev({ date: d, kind: "flare", from: "", to: "", why: `Flare logged. Settled once 2 mornings in a row are back to ${flareTarget}/10 or lower`, dir: -1 });
      lastDrop = d;
      changedDown = true;
    } else if (flare && flareStart) {
      const ok = (x: string) => {
        const v = map.get(x);
        return !!v && !v.flare && v.morningPain != null && v.morningPain <= flareTarget;
      };
      if (daysBetween(flareStart, d) >= 2 && ok(d) && ok(yd)) {
        flare = false;
        ev({ date: d, kind: "flare", from: "", to: "", why: `Flare settled (2 mornings at ${flareTarget}/10 or lower). Progressions resume after a week`, dir: 0 });
      }
    }

    // ---- red morning (not a new flare): isometrics back to the previous load ----
    if (!flareOnset && am === "red") {
      isoBack(d, `Red morning${stepsNote}`);
      lastDrop = d;
      changedDown = true;
    }

    // ---- rising trend: scale back once, then give it a week ----
    if (!flare && !changedDown && trend?.dir === "rising" && daysBetween(lastDrop, d) >= 7 && (iso > settings.isoStart || seated > settings.seatedStart || standing > 0)) {
      const why = `Morning pain trending up (7-day avg ${trend.recent} vs ${trend.prior})`;
      isoBack(d, why);
      calvesDown(d, why);
      lastDrop = d;
      changedDown = true;
    }

    // ---- gates shared by both progressions ----
    const recentFlare = flareStarts.some((f) => daysBetween(f, d) < 7) || events.some((x) => x.kind === "flare" && x.dir === 0 && daysBetween(x.date, d) < 7);
    const gateOpen = !flare && !recentFlare && !isMasked && am === "green" && trend?.dir !== "rising" && !changedDown;

    // green days banked since the last isometric change
    let isoBanked = 0;
    for (let i = 1; i <= settings.isoGreenDays; i++) {
      const x = addDays(d, -i);
      if (x <= lastIsoChange || masked(x) || st(x) !== "green") break;
      isoBanked++;
    }

    // ---- isometrics progress ----
    const isoStep = stepFor(iso, inc, L);
    if (gateOpen && isoBanked >= settings.isoGreenDays && iso + isoStep <= settings.isoMax && daysBetween(lastCalfChange, d) >= 2) {
      isoStack.push(iso);
      ev({ date: d, kind: "iso", from: `${iso}kg`, to: `${iso + isoStep}kg`, why: `${settings.isoGreenDays} green days in a row${trend ? `, trend ${trend.dir}` : ""}`, dir: 1 });
      iso += isoStep;
      lastIsoChange = d;
    }

    // ---- calves ----
    const scheduled = isScheduledLegDay(settings, d);
    const skipCalves = flare || am === "red";
    const legDay = scheduled || (!!e?.training && e.training !== "skipped") || !!e?.legDay;
    if (
      scheduled &&
      gateOpen &&
      sessions >= settings.sessionsToProgress &&
      daysBetween(lastIsoChange, d) >= 2 &&
      daysBetween(lastCalfChange, d) >= 6
    ) {
      const pick: "seated" | "standing" = standing >= 8 ? "seated" : lastCalfKind === "seated" ? "standing" : "seated";
      if (pick === "seated") {
        const s = stepFor(seated, sInc, L);
        ev({ date: d, kind: "seated", from: `${seated}kg`, to: `${seated + s}kg`, why: `${settings.sessionsToProgress} leg sessions tolerated`, dir: 1 });
        seated += s;
      } else {
        ev({ date: d, kind: "standing", from: STANDING_NAMES(standing), to: STANDING_NAMES(standing + 1), why: `${settings.sessionsToProgress} leg sessions tolerated`, dir: 1 });
        standing += 1;
      }
      lastCalfKind = pick;
      lastCalfChange = d;
      sessions = 0;
    }

    let training: Training | undefined = e?.training;
    if (!training && e?.legDay) training = "done";
    if (!training && scheduled && e && hasData(e)) training = skipCalves ? "skipped" : "done";

    days.push({
      date: d,
      iso,
      seated,
      standingLevel: standing,
      status: st(d),
      morning: am,
      masked: isMasked,
      flare,
      flareStart: flare ? flareStart : undefined,
      flareTarget: flare ? flareTarget : undefined,
      legDay,
      skipCalves,
      training,
      isoBanked,
      sessionsBanked: sessions,
      trend,
    });
  }
  return { days, events, flareStarts };
}

// ======================================================================
// Today's prescription
// ======================================================================
export interface Alert {
  id: string;
  tone: "info" | "hold" | "back" | "progress";
  title: string;
  detail: string;
}

export interface DayPlan {
  date: string;
  state: DayState;
  status?: Status;
  morningLogged: boolean;
  iso: { load: number; sets: number; hold: string; effort: string; note: string };
  legDay: boolean;
  scheduledLegDay: boolean;
  calves?: {
    skip: boolean;
    note: string;
    seated: { load: number; sets: number; reps: number };
    standing: { desc: string; sets: number; reps: number; loadKg: number };
  };
  legMods: string[];
  steps: { typical?: number; heavy: boolean; note: string };
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
  "No jumping, skipping or running",
];

const KIND_LABEL: Record<PlanEvent["kind"], string> = {
  iso: "Isometric load",
  seated: "Seated raise",
  standing: "Standing raise",
  reset: "Reset",
  flare: "Flare",
};

export function planFor(entries: Entry[], settings: Settings, date: string): { plan: DayPlan; events: PlanEvent[]; days: DayState[] } {
  const { days, events, flareStarts } = replay(entries, settings, date);
  const state: DayState =
    days[days.length - 1] ??
    ({
      date,
      iso: settings.isoStart,
      seated: settings.seatedStart,
      standingLevel: 0,
      masked: true,
      flare: false,
      legDay: isScheduledLegDay(settings, date),
      skipCalves: false,
      isoBanked: 0,
      sessionsBanked: 0,
    } as DayState);
  const entry = entries.find((e) => e.date === date);
  const status = dayStatus(entry, entries, settings.painThreshold)?.status;
  const am = state.morning;
  const alerts: Alert[] = [];

  // ---- isometrics (assumed done every day) ----
  const easy = state.flare || am === "red";
  const iso = {
    load: state.iso,
    sets: easy ? 4 : 5,
    hold: easy ? "30 s" : "45 s",
    effort: easy ? "30–50%" : "60–70%",
    note: easy
      ? "Keep doing them: they settle pain. Lighter effort, stop if pain climbs over 3/10."
      : "Seated soleus hold, heels halfway up, load across knees. 2 min rest. Pain ≤3/10 and should ease during the set.",
  };

  // ---- calves ----
  const scheduledLegDay = isScheduledLegDay(settings, date);
  const legDay = scheduledLegDay || state.legDay;
  let calves: DayPlan["calves"];
  if (legDay) {
    calves = {
      skip: state.skipCalves,
      note: state.flare
        ? "Flare: no loaded calf work until it settles. Leg session without calf loading (extensions, curls, trap bar) if it feels OK."
        : am === "red"
          ? "Red morning: skip calf raises today. Rest of the session without calf loading."
          : am === "amber"
            ? "Amber morning: same loads, no extra sets, pain ≤3/10."
            : "3 s up, 3 s down. Flat floor, no drop below neutral. Pain ≤3/10.",
      seated: { load: state.seated, ...seatedScheme(state.seated) },
      standing: standingRx(state.standingLevel),
    };
  }

  // ---- steps (everyday walking, context only) ----
  const typical = typicalSteps(date, entries);
  const heavy = !!heavySteps(date, entries);
  let stepNote = "Everyday walking, no target. Logged so the plan can tell whether a bad morning came from walking or training.";
  if (state.flare || am === "red") stepNote = "Where you can: skip optional walking, break the rest into short chunks, supportive shoes.";
  else if (am === "amber") stepNote = "Amber: don't add any walking on top of what the day needs.";

  // ---- alerts ----
  if (state.flare && state.flareStart) {
    const n = daysBetween(state.flareStart, date) + 1;
    alerts.push({
      id: "flare",
      tone: "back",
      title: `Flare, day ${n}: deload`,
      detail: `Isometrics stay daily at ${state.iso}kg, lighter effort. No loaded calf work. Cut optional walking. Settled when 2 mornings in a row are ${state.flareTarget}/10 or lower; progressions then wait another week.`,
    });
  }

  const flares28 = flareStarts.filter((f) => daysBetween(f, date) < 28 && f <= date).length;
  const last7 = days.slice(-7).map((x) => x.status);
  const notGreen = last7.filter((s) => s === "amber" || s === "red").length;
  const flareLong = state.flare && state.flareStart && daysBetween(state.flareStart, date) >= 10;
  if (flareLong || flares28 >= 2 || (days.length >= 7 && notGreen >= 5)) {
    alerts.push({
      id: "escalate",
      tone: "back",
      title: "Get it reviewed",
      detail: flareLong
        ? "Flare hasn't settled in 10 days. Book physio or sports physician review (consider imaging)."
        : flares28 >= 2
          ? `${flares28} flares in 4 weeks. The load isn't the only problem: book physio or sports physician review.`
          : `${notGreen} of the last 7 days amber or red. Not settling: book physio or sports physician review.`,
    });
  }

  if (state.masked && settings.lastNsaid && date <= addDays(settings.lastNsaid, 4)) {
    alerts.push({
      id: "nsaid",
      tone: "hold",
      title: `Anti-inflammatory washout until ${prettyDate(addDays(settings.lastNsaid, 4))}`,
      detail: "Pain is still partly masked, so these days don't count toward progressions. Change the last-dose date in Plan if it's wrong.",
    });
  }

  const heavyY = heavySteps(addDays(date, -1), entries);
  if (heavyY && (am === "amber" || am === "red") && !state.flare) {
    const trainedY = days[days.length - 2]?.training === "done" || days[days.length - 2]?.training === "light";
    alerts.push({
      id: "walk",
      tone: "info",
      title: "Probably the walking",
      detail: `Yesterday was ${heavyY.steps.toLocaleString()} steps (usual ${heavyY.typical.toLocaleString()}).${trainedY ? " There was also a leg session, so both are in play." : " No leg session, so training loads aren't to blame."}`,
    });
  }

  const todayEvents = events.filter((e) => e.date === date);
  for (const e of todayEvents)
    if (e.kind !== "reset" && e.kind !== "flare")
      alerts.push({
        id: `ev-${e.kind}`,
        tone: e.dir < 0 ? "back" : "progress",
        title: `${KIND_LABEL[e.kind]}: ${e.from} → ${e.to}`,
        detail: e.why,
      });
  const settled = todayEvents.find((e) => e.kind === "flare" && e.dir === 0);
  if (settled) alerts.push({ id: "settled", tone: "progress", title: "Flare settled", detail: settled.why });

  if (state.trend) {
    const t = state.trend;
    alerts.push({
      id: "trend",
      tone: t.dir === "rising" ? "back" : t.dir === "falling" ? "progress" : "info",
      title: `Trend: ${t.dir}`,
      detail: `Morning pain averaged ${t.recent}/10 this week vs ${t.prior}/10 the week before.${t.dir === "rising" ? " No progressions while it's rising; loads drop a step once a week until it turns." : ""}`,
    });
  }

  if (!state.flare && !todayEvents.some((e) => e.dir > 0)) {
    const isoNext = state.iso + stepFor(state.iso, settings.isoIncrement, settings.lightKg);
    const parts: string[] = [];
    if (isoNext <= settings.isoMax) parts.push(`Isometric → ${isoNext}kg: ${Math.min(state.isoBanked, settings.isoGreenDays)} of ${settings.isoGreenDays} green days`);
    parts.push(`Next calf step: ${Math.min(state.sessionsBanked, settings.sessionsToProgress)} of ${settings.sessionsToProgress} tolerated sessions`);
    alerts.push({ id: "watch", tone: "info", title: "Progress watch", detail: parts.join(" · ") });
  }

  return {
    plan: {
      date,
      state,
      status,
      morningLogged: entry?.morningPain != null,
      iso,
      legDay,
      scheduledLegDay,
      calves,
      legMods: LEG_MODS,
      steps: { typical, heavy, note: stepNote },
      alerts,
      todayEvents,
    },
    events,
    days,
  };
}

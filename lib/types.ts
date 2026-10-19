export type Status = "green" | "amber" | "red";

export interface Entry {
  date: string; // YYYY-MM-DD
  steps?: number;
  morningPain?: number; // first steps, 0-10 (reflects yesterday's load)
  toeOffPain?: number; // walking/toe-off during the day, 0-10
  eveningPain?: number; // 0-10
  nsaid?: boolean; // legacy flag
  doses?: number; // diclofenac doses taken today

  // Isometrics (daily)
  isoDone?: boolean;
  isoMode?: "bar" | "desk";
  isoLoadKg?: number;
  isoSets?: number;
  isoPain?: number;

  // Leg day / isotonics
  legDay?: boolean;
  seatedLoadKg?: number;
  seatedSets?: number;
  seatedReps?: number;
  standingLoadKg?: number;
  standingSets?: number;
  standingReps?: number;
  isotonicPain?: number;

  notes?: string;
  statusOverride?: Status;
}

/** One dosing phase, inclusive dates. */
export interface DoseStep {
  from: string;
  to: string;
  mg: number;
  perDay: number;
}

export interface Course {
  id: string;
  kind: "planned" | "rescue";
  steps: DoseStep[];
}

/** Manual reset of targets, applied from that date onward. */
export interface Override {
  date: string;
  weekday?: number;
  weekend?: number;
  iso?: number;
  seated?: number;
}

export interface Settings {
  planStart: string;
  weekdayStart: number; // unavoidable weekday baseline
  weekendStart: number; // unavoidable weekend baseline
  goalSteps: number;
  stepIncrement: number;
  isoStart: number;
  seatedStart: number;
  legDays: number[]; // 0=Sun..6=Sat
  painThreshold: number; // any score at/above triggers an alert
  courses: Course[];
  overrides: Override[];
}

export const DEFAULT_SETTINGS: Settings = {
  planStart: "2026-10-19",
  weekdayStart: 6000,
  weekendStart: 10000,
  goalSteps: 11000,
  stepIncrement: 500,
  isoStart: 20,
  seatedStart: 20,
  legDays: [2, 4],
  painThreshold: 6,
  courses: [
    {
      id: "taper-oct-2026",
      kind: "planned",
      steps: [
        { from: "2026-10-19", to: "2026-10-22", mg: 50, perDay: 3 },
        { from: "2026-10-23", to: "2026-10-26", mg: 25, perDay: 3 },
        { from: "2026-10-27", to: "2026-10-28", mg: 25, perDay: 1 },
      ],
    },
  ],
  overrides: [],
};

/** Merge stored settings (possibly from the older schema) with defaults. */
export function normaliseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(Object.entries(r).filter(([k]) => k in DEFAULT_SETTINGS)),
    courses: Array.isArray(r.courses) ? r.courses : DEFAULT_SETTINGS.courses,
    overrides: Array.isArray(r.overrides) ? r.overrides : [],
    legDays: Array.isArray(r.legDays) ? r.legDays : DEFAULT_SETTINGS.legDays,
  } as Settings;
}

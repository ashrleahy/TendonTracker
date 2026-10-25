export type Status = "green" | "amber" | "red";
export type Training = "done" | "light" | "skipped";

export interface Entry {
  date: string; // YYYY-MM-DD
  morningPain?: number; // first steps, 0-10 (reflects yesterday's load)
  steps?: number; // total for the day (everyday walking, not prescribed)
  training?: Training; // leg/calf session; unset on a scheduled leg day = done as prescribed
  trainingPain?: number; // worst pain during the session, 0-10
  eveningPain?: number; // 0-10
  flare?: boolean; // exacerbation: it's got worse
  flareNote?: string;
  notes?: string;
  statusOverride?: Status;

  // ---- legacy fields (older versions), still read where useful ----
  toeOffPain?: number;
  nsaid?: boolean;
  doses?: number;
  isoDone?: boolean;
  isoMode?: "bar" | "desk";
  isoLoadKg?: number;
  isoSets?: number;
  isoPain?: number;
  legDay?: boolean;
  seatedLoadKg?: number;
  seatedSets?: number;
  seatedReps?: number;
  standingLoadKg?: number;
  standingSets?: number;
  standingReps?: number;
  isotonicPain?: number;
}

/** Manual reset of loads, applied from that date onward. */
export interface Override {
  date: string;
  iso?: number;
  seated?: number;
  standing?: number;
}

export interface Settings {
  planStart: string;
  lastNsaid?: string; // last anti-inflammatory dose; nothing counts as evidence until 4 days after
  isoStart: number;
  seatedStart: number;
  legDays: number[]; // 0=Sun..6=Sat
  painThreshold: number; // morning pain at/above this is red on its own
  isoIncrement: number; // kg
  isoMax: number; // kg ceiling for holds
  lightKg: number; // below this, iso and seated increments double
  isoGreenDays: number; // consecutive green days needed for an isometric step
  seatedIncrement: number; // kg
  sessionsToProgress: number; // tolerated leg sessions needed for a calf step
  version?: number;
  overrides: Override[];
}

export const DEFAULT_SETTINGS: Settings = {
  planStart: "2026-10-19",
  lastNsaid: undefined,
  isoStart: 20,
  seatedStart: 20,
  legDays: [1, 6],
  painThreshold: 5,
  isoIncrement: 2.5,
  isoMax: 100,
  lightKg: 50,
  isoGreenDays: 5,
  seatedIncrement: 2.5,
  sessionsToProgress: 3,
  version: 5,
  overrides: [],
};

interface LegacyCourse {
  steps?: { to?: string }[];
}

/** Merge stored settings (possibly from an older schema) with defaults. */
export function normaliseSettings(raw: unknown): Settings {
  let r = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings> & { courses?: LegacyCourse[] };
  if ((r.version ?? 0) < 4) {
    // leg days moved from the Tue/Thu default to Mon/Sat
    const ld = r.legDays;
    if (!ld || (ld.length === 2 && ld.includes(2) && ld.includes(4))) {
      const { legDays: _d, ...rest } = r;
      r = rest;
    }
  }
  if ((r.version ?? 0) < 5) {
    // v5: diclofenac courses replaced by a single "last dose" date; step targets dropped
    let last: string | undefined;
    for (const c of r.courses ?? []) for (const s of c.steps ?? []) if (s.to && (!last || s.to > last)) last = s.to;
    if (last && !r.lastNsaid) r = { ...r, lastNsaid: last };
    r = { ...r, version: 5 };
  }
  const known = Object.fromEntries(Object.entries(r).filter(([k]) => k in DEFAULT_SETTINGS || k === "lastNsaid"));
  return {
    ...DEFAULT_SETTINGS,
    ...known,
    overrides: Array.isArray(r.overrides) ? r.overrides : [],
    legDays: Array.isArray(r.legDays) ? r.legDays : DEFAULT_SETTINGS.legDays,
    version: 5,
  } as Settings;
}

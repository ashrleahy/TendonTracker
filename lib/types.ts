export type Status = "green" | "amber" | "red";

export interface Entry {
  date: string; // YYYY-MM-DD
  steps?: number;
  morningPain?: number; // first steps, 0-10 (reflects yesterday's load)
  toeOffPain?: number; // walking/toe-off during the day, 0-10
  eveningPain?: number; // 0-10
  nsaid?: boolean;

  // Isometrics (daily)
  isoDone?: boolean;
  isoMode?: "bar" | "desk";
  isoLoadKg?: number; // bar version
  isoSets?: number;
  isoPain?: number; // pain during holds, 0-10

  // Leg day / isotonics
  legDay?: boolean;
  seatedLoadKg?: number;
  seatedSets?: number;
  seatedReps?: number;
  standingLoadKg?: number;
  standingSets?: number;
  standingReps?: number;
  isotonicPain?: number; // 0-10

  notes?: string;
  statusOverride?: Status;
}

export interface ChangeLog {
  date: string;
  kind: "steps" | "iso" | "isotonic";
  from: number;
  to: number;
}

export interface Settings {
  weekdayTarget: number;
  weekendTarget: number;
  goalSteps: number;
  stepIncrement: number;
  isoLoadKg: number;
  seatedLoadKg: number;
  nsaidStart?: string;
  nsaidEnd?: string;
  changes: ChangeLog[];
}

export const DEFAULT_SETTINGS: Settings = {
  weekdayTarget: 6000,
  weekendTarget: 10000,
  goalSteps: 11000,
  stepIncrement: 500,
  isoLoadKg: 20,
  seatedLoadKg: 20,
  changes: [],
};

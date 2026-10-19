"use client";
import { normaliseSettings, type Entry, type Settings } from "./types";

const LS_ENTRIES = "tt.entries";
const LS_SETTINGS = "tt.settings";
const LS_CODE = "tt.passcode";

function lsGet<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export function getPasscode(): string {
  return lsGet<string>(LS_CODE, "");
}
export function setPasscode(c: string) {
  lsSet(LS_CODE, c);
}

export type Mode = "cloud" | "local";
export class PasscodeError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-passcode": getPasscode(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 401) throw new PasscodeError("passcode");
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export async function detectMode(): Promise<{ mode: Mode; passcodeRequired: boolean; authorised: boolean }> {
  try {
    const h = await api<{ db: boolean; passcodeRequired: boolean; authorised: boolean }>("/api/health");
    return { mode: h.db ? "cloud" : "local", passcodeRequired: h.passcodeRequired, authorised: h.authorised };
  } catch {
    return { mode: "local", passcodeRequired: false, authorised: true };
  }
}

export async function loadAll(mode: Mode): Promise<{ entries: Entry[]; settings: Settings }> {
  if (mode === "cloud") {
    const [entries, settings] = await Promise.all([api<Entry[]>("/api/entries"), api<Settings>("/api/settings")]);
    // keep a local copy as an offline/backup cache
    lsSet(LS_ENTRIES, entries);
    lsSet(LS_SETTINGS, settings);
    return { entries, settings: normaliseSettings(settings) };
  }
  return {
    entries: lsGet<Entry[]>(LS_ENTRIES, []),
    settings: normaliseSettings(lsGet<unknown>(LS_SETTINGS, {})),
  };
}

export async function saveEntry(mode: Mode, entry: Entry, all: Entry[]) {
  const next = [...all.filter((e) => e.date !== entry.date), entry].sort((a, b) => (a.date < b.date ? -1 : 1));
  lsSet(LS_ENTRIES, next);
  if (mode === "cloud") await api("/api/entries", { method: "PUT", body: JSON.stringify(entry) });
  return next;
}

export async function deleteEntry(mode: Mode, date: string, all: Entry[]) {
  const next = all.filter((e) => e.date !== date);
  lsSet(LS_ENTRIES, next);
  if (mode === "cloud") await api(`/api/entries?date=${date}`, { method: "DELETE" });
  return next;
}

export async function saveSettings(mode: Mode, s: Settings) {
  lsSet(LS_SETTINGS, s);
  if (mode === "cloud") await api("/api/settings", { method: "PUT", body: JSON.stringify(s) });
}

export async function importEntries(mode: Mode, incoming: Entry[], all: Entry[]) {
  const map = new Map(all.map((e) => [e.date, e]));
  for (const e of incoming) if (e?.date) map.set(e.date, e);
  const next = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  lsSet(LS_ENTRIES, next);
  if (mode === "cloud") await api("/api/entries", { method: "PUT", body: JSON.stringify(incoming) });
  return next;
}

"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Entry, Settings, Status, Course, DoseStep } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { addDays, dayStatus, isWeekend, localToday, prettyDate, streak } from "@/lib/logic";
import { planFor, rescueCourse, courseStart, courseEnd, type Alert, type DayPlan } from "@/lib/plan";
import * as store from "@/lib/store";
import { LineChart, StepsChart } from "./Charts";

type Tab = "today" | "trends" | "history" | "plan";

const STATUS_LABEL: Record<Status, string> = { green: "Green", amber: "Amber", red: "Red" };
const STATUS_ICON: Record<Status, string> = { green: "✓", amber: "!", red: "✕" };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StatusPill({ s, small }: { s?: Status; small?: boolean }) {
  if (!s) return <span className={`pill none ${small ? "small" : ""}`}>No status</span>;
  return (
    <span className={`pill ${s} ${small ? "small" : ""}`}>
      <span aria-hidden>{STATUS_ICON[s]}</span> {STATUS_LABEL[s]}
    </span>
  );
}

export default function App() {
  const [mode, setMode] = useState<store.Mode | null>(null);
  const [needCode, setNeedCode] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [tab, setTab] = useState<Tab>("today");
  const [date, setDate] = useState(localToday());
  const [error, setError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    setError(null);
    const m = await store.detectMode();
    if (m.passcodeRequired && !m.authorised) {
      setNeedCode(true);
      return;
    }
    setNeedCode(false);
    try {
      const data = await store.loadAll(m.mode);
      setEntries(data.entries);
      setSettings(data.settings);
      setMode(m.mode);
    } catch (e) {
      if (e instanceof store.PasscodeError) setNeedCode(true);
      else {
        setError("Couldn't reach the database. Showing the copy saved on this device.");
        const data = await store.loadAll("local");
        setEntries(data.entries);
        setSettings(data.settings);
        setMode("local");
      }
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  const persistSettings = async (s: Settings) => {
    setSettings(s);
    try {
      await store.saveSettings(mode!, s);
    } catch {
      setError("Plan saved on this device only. Sync failed.");
    }
  };

  if (needCode) return <PasscodeGate onDone={boot} />;
  if (!mode)
    return (
      <main className="shell">
        <p className="muted center">Loading…</p>
      </main>
    );

  const n = streak(entries, localToday());
  return (
    <main className="shell">
      <header className="top">
        <div>
          <h1>Tendon Tracker</h1>
          <p className="muted small">
            {mode === "cloud" ? "Synced" : "Saved on this device"} · {n} green day{n === 1 ? "" : "s"} in a row
          </p>
        </div>
      </header>
      {error && (
        <div className="banner warn" role="status">
          {error}
        </div>
      )}

      {tab === "today" && (
        <Today
          key={date}
          date={date}
          setDate={setDate}
          entries={entries}
          settings={settings}
          mode={mode}
          onSaved={setEntries}
          onSettings={persistSettings}
          onError={setError}
        />
      )}
      {tab === "trends" && <Trends entries={entries} settings={settings} />}
      {tab === "history" && (
        <History
          entries={entries}
          mode={mode}
          onChange={setEntries}
          onOpen={(d) => {
            setDate(d);
            setTab("today");
          }}
        />
      )}
      {tab === "plan" && <Plan entries={entries} settings={settings} onSave={persistSettings} mode={mode} />}

      <nav className="tabs" aria-label="Sections">
        {(
          [
            ["today", "Today"],
            ["trends", "Trends"],
            ["history", "History"],
            ["plan", "Plan"],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} aria-current={tab === t}>
            {l}
          </button>
        ))}
      </nav>
    </main>
  );
}

// ---------------------------------------------------------------- passcode
function PasscodeGate({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  return (
    <main className="shell">
      <form
        className="card gate"
        onSubmit={(e) => {
          e.preventDefault();
          store.setPasscode(code.trim());
          onDone();
        }}
      >
        <h1>Tendon Tracker</h1>
        <label>
          Passcode
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </label>
        <button className="primary">Unlock</button>
        <p className="muted small">Saved on this device after the first unlock.</p>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------- inputs
function Scale({ label, hint, value, onChange }: { label: string; hint?: string; value?: number; onChange: (v?: number) => void }) {
  return (
    <fieldset className="scale">
      <legend>
        {label}
        {value != null && <b> {value}/10</b>}
        {hint && <span className="muted small"> · {hint}</span>}
      </legend>
      <div className="scale-row">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            type="button"
            key={i}
            className={`${value === i ? "on" : ""} ${i > 3 ? "high" : ""}`}
            onClick={() => onChange(value === i ? undefined : i)}
            aria-pressed={value === i}
          >
            {i}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  placeholder,
}: {
  label: string;
  value?: number;
  onChange: (v?: number) => void;
  step?: number;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="num">
      <span>{label}</span>
      <div>
        <button type="button" onClick={() => onChange(Math.max(0, (value ?? 0) - step))} aria-label={`Decrease ${label}`}>
          −
        </button>
        <input
          inputMode="decimal"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.]/g, "");
            onChange(v === "" ? undefined : Number(v));
          }}
        />
        <button type="button" onClick={() => onChange((value ?? 0) + step)} aria-label={`Increase ${label}`}>
          +
        </button>
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- today
function AlertCard({ a, onRescue }: { a: Alert; onRescue: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <div className={`sugg ${a.tone}`}>
      <div>
        <b>{a.title}</b>
        <p>{a.detail}</p>
      </div>
      {a.action === "start-rescue" && (
        <button
          disabled={done}
          onClick={() => {
            if (confirm("Add a 3-day diclofenac course (50mg × 3, with food) starting today?")) {
              onRescue();
              setDone(true);
            }
          }}
        >
          {done ? "Added" : "Start course"}
        </button>
      )}
    </div>
  );
}

function Rx({ big, unit, sub }: { big: string; unit?: string; sub?: string }) {
  return (
    <div className="rx">
      <span className="rx-big">
        {big}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="rx-sub">{sub}</span>}
    </div>
  );
}

function Today({
  date,
  setDate,
  entries,
  settings,
  mode,
  onSaved,
  onSettings,
  onError,
}: {
  date: string;
  setDate: (d: string) => void;
  entries: Entry[];
  settings: Settings;
  mode: store.Mode;
  onSaved: (e: Entry[]) => void;
  onSettings: (s: Settings) => void;
  onError: (m: string | null) => void;
}) {
  const existing = entries.find((e) => e.date === date);
  const [e, setE] = useState<Entry>(existing ?? { date });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMods, setShowMods] = useState(false);
  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => {
    setE((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };
  const patch = (p: Partial<Entry>) => {
    setE((x) => ({ ...x, ...p }));
    setDirty(true);
  };

  // plan reflects what's been entered so far (unsaved included)
  const merged = useMemo(() => [...entries.filter((x) => x.date !== date), e], [entries, e, date]);
  const { plan } = useMemo(() => planFor(merged, settings, date), [merged, settings, date]);
  const statusInfo = useMemo(() => dayStatus(e, merged), [e, merged]);
  const today = localToday();
  const isPast = date < today;

  const save = async () => {
    setSaving(true);
    try {
      const next = await store.saveEntry(mode, e, entries);
      onSaved(next);
      setDirty(false);
      onError(null);
    } catch (err) {
      if (err instanceof store.PasscodeError) onError("Passcode rejected. Reload to re-enter it.");
      else onError("Saved on this device only. Sync failed, so try again when online.");
    } finally {
      setSaving(false);
    }
  };

  const startRescue = () => {
    const c = rescueCourse(date);
    onSettings({ ...settings, courses: [...settings.courses.filter((x) => x.id !== c.id), c] });
  };

  const isoAsPrescribed = () =>
    patch({ isoDone: true, isoMode: e.isoMode ?? "bar", isoLoadKg: plan.iso.load, isoSets: plan.iso.sets });
  const calvesAsPrescribed = () =>
    plan.calves &&
    patch({
      legDay: true,
      seatedLoadKg: plan.calves.seated.load,
      seatedSets: plan.calves.seated.sets,
      seatedReps: plan.calves.seated.reps,
      standingLoadKg: plan.calves.standing.loadKg,
      standingSets: plan.calves.standing.sets,
      standingReps: plan.calves.standing.reps,
    });
  const showLeg = plan.legDay || e.legDay;

  return (
    <section className="stack">
      <div className="datebar">
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          ‹
        </button>
        <div>
          <b>{date === today ? "Today" : prettyDate(date)}</b>
          <span className="muted small">
            {[date === today ? prettyDate(date) : "", isWeekend(date) ? "weekend" : "", plan.legDay ? "leg day" : ""].filter(Boolean).join(" · ")}
          </span>
        </div>
        <button onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
          ›
        </button>
      </div>

      {/* 1. Morning check drives the plan */}
      <div className="card">
        <div className="card-head">
          <h2>Morning check</h2>
          <StatusPill s={statusInfo?.status} small />
        </div>
        <Scale label="First steps" hint="reflects yesterday's load" value={e.morningPain} onChange={(v) => set("morningPain", v)} />
        {statusInfo && <p className="muted small reasons">{statusInfo.reasons.join(" · ")}</p>}
        {!plan.morningLogged && !isPast && <p className="nudge">Log first-steps pain and the plan below adjusts to it.</p>}
      </div>

      {plan.alerts.length > 0 && (
        <div className="stack tight">
          {plan.alerts.map((a) => (
            <AlertCard key={a.id} a={a} onRescue={startRescue} />
          ))}
        </div>
      )}

      <h3 className="section">{isPast ? "That day's plan" : "Today's plan"}</h3>

      {/* Diclofenac */}
      {plan.dose && (
        <div className="card">
          <div className="card-head">
            <h2>Diclofenac</h2>
            <span className="muted small">{plan.dose.kind === "rescue" ? "Rescue course" : "Taper"}</span>
          </div>
          <Rx big={`${plan.dose.mg}`} unit={`mg × ${plan.dose.perDay}`} sub={`With food · ${plan.dose.then}`} />
          <div className="doses" role="group" aria-label="Doses taken">
            {Array.from({ length: plan.dose.perDay }, (_, i) => {
              const taken = (e.doses ?? 0) > i;
              return (
                <button key={i} className={taken ? "on" : ""} onClick={() => set("doses", taken ? i : i + 1)} aria-pressed={taken}>
                  {taken ? "✓ " : ""}Dose {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="card">
        <h2>Steps</h2>
        <Rx big={plan.steps.target.toLocaleString()} unit="steps" sub={isWeekend(date) ? "weekend target" : "weekday target"} />
        <p className="muted small">{plan.steps.note}</p>
        <Num label="Steps done" value={e.steps} onChange={(v) => set("steps", v)} step={500} placeholder="0" />
        <div className="meter" aria-hidden>
          <div
            style={{ width: `${Math.min(100, ((e.steps ?? 0) / plan.steps.target) * 100)}%` }}
            className={(e.steps ?? 0) > plan.steps.target * 1.1 ? "over" : ""}
          />
        </div>
        {(e.steps ?? 0) > plan.steps.target * 1.1 && <p className="muted small">Over target by more than 10%.</p>}
      </div>

      {/* Isometrics */}
      <div className="card">
        <div className="card-head">
          <h2>Isometrics</h2>
          {e.isoDone && <span className="done-tag">✓ Done</span>}
        </div>
        <Rx big={`${plan.iso.sets} × ${plan.iso.hold}`} sub={`${plan.iso.load}kg · ${plan.iso.effort} effort · 2 min rest`} />
        <p className="muted small">{plan.iso.note}</p>
        {!e.isoDone ? (
          <button className="primary full" onClick={isoAsPrescribed}>
            Done as prescribed
          </button>
        ) : (
          <>
            <div className="seg" role="radiogroup" aria-label="Isometric method">
              {(["bar", "desk"] as const).map((m) => (
                <button key={m} type="button" className={e.isoMode === m ? "on" : ""} onClick={() => set("isoMode", m)} role="radio" aria-checked={e.isoMode === m}>
                  {m === "bar" ? "Seated + bar" : "Desk push"}
                </button>
              ))}
            </div>
            <div className="row">
              {e.isoMode !== "desk" && <Num label="Load" value={e.isoLoadKg} onChange={(v) => set("isoLoadKg", v)} step={5} suffix="kg" />}
              <Num label="Sets" value={e.isoSets} onChange={(v) => set("isoSets", v)} />
            </div>
            <Scale label="Pain during holds" value={e.isoPain} onChange={(v) => set("isoPain", v)} />
            <button className="link" onClick={() => patch({ isoDone: false })}>
              Undo
            </button>
          </>
        )}
      </div>

      {/* Leg day */}
      {showLeg && plan.calves && (
        <div className="card">
          <div className="card-head">
            <h2>Leg day: calves first</h2>
            {e.legDay && <span className="done-tag">✓ Done</span>}
          </div>
          {plan.calves.skip ? (
            <p className="nudge warn">{plan.calves.note}</p>
          ) : (
            <>
              <div className="rx-list">
                <div>
                  <b>Seated calf raise</b>
                  <span>
                    {plan.calves.seated.sets} × {plan.calves.seated.reps} at {plan.calves.seated.load}kg
                  </span>
                </div>
                <div>
                  <b>Standing calf raise</b>
                  <span>
                    {plan.calves.standing.sets} × {plan.calves.standing.reps}, {plan.calves.standing.desc.toLowerCase()}
                  </span>
                </div>
              </div>
              <p className="muted small">{plan.calves.note}</p>
            </>
          )}
          <button className="link" onClick={() => setShowMods((x) => !x)}>
            {showMods ? "Hide" : "Show"} leg session modifications
          </button>
          {showMods && (
            <ul className="mods">
              {plan.legMods.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          {!e.legDay ? (
            !plan.calves.skip && (
              <button className="primary full" onClick={calvesAsPrescribed}>
                Done as prescribed
              </button>
            )
          ) : (
            <>
              <p className="label">Seated calf raise</p>
              <div className="row three">
                <Num label="Load" value={e.seatedLoadKg} onChange={(v) => set("seatedLoadKg", v)} step={5} suffix="kg" />
                <Num label="Sets" value={e.seatedSets} onChange={(v) => set("seatedSets", v)} />
                <Num label="Reps" value={e.seatedReps} onChange={(v) => set("seatedReps", v)} />
              </div>
              <p className="label">Standing calf raise</p>
              <div className="row three">
                <Num label="Load" value={e.standingLoadKg} onChange={(v) => set("standingLoadKg", v)} step={2.5} suffix="kg" placeholder="BW" />
                <Num label="Sets" value={e.standingSets} onChange={(v) => set("standingSets", v)} />
                <Num label="Reps" value={e.standingReps} onChange={(v) => set("standingReps", v)} />
              </div>
              <Scale label="Pain during calf work" value={e.isotonicPain} onChange={(v) => set("isotonicPain", v)} />
              <button className="link" onClick={() => patch({ legDay: false })}>
                Undo
              </button>
            </>
          )}
        </div>
      )}
      {!plan.legDay && !e.legDay && (
        <button className="link left" onClick={() => patch({ legDay: true })}>
          + Did a leg session today anyway
        </button>
      )}

      {/* End of day */}
      <h3 className="section">End of day</h3>
      <div className="card">
        <Scale label="Walking / toe-off" hint="worst during the day" value={e.toeOffPain} onChange={(v) => set("toeOffPain", v)} />
        <Scale label="Evening" value={e.eveningPain} onChange={(v) => set("eveningPain", v)} />
        <label className="field">
          <span>Notes</span>
          <textarea rows={2} value={e.notes ?? ""} onChange={(ev) => set("notes", ev.target.value || undefined)} placeholder="Anything that might explain today" />
        </label>
        <label className="field">
          <span>Override status</span>
          <select value={e.statusOverride ?? ""} onChange={(ev) => set("statusOverride", (ev.target.value || undefined) as Status | undefined)}>
            <option value="">Automatic{statusInfo ? ` (${STATUS_LABEL[statusInfo.computed]})` : ""}</option>
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="red">Red</option>
          </select>
        </label>
      </div>

      <div className="savebar">
        <button className="primary big" onClick={save} disabled={saving || (!dirty && !!existing)}>
          {saving ? "Saving…" : dirty || !existing ? "Save day" : "Saved"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- trends
function Trends({ entries, settings }: { entries: Entry[]; settings: Settings }) {
  const [range, setRange] = useState(28);
  const today = localToday();
  const dates = Array.from({ length: range }, (_, i) => addDays(today, i - range + 1));
  const map = new Map(entries.map((e) => [e.date, e]));
  const get = (k: keyof Entry) => dates.map((d) => (map.get(d)?.[k] as number | undefined) ?? null);
  const { days } = useMemo(() => planFor(entries, settings, today), [entries, settings, today]);
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const targetFor = (d: string) => {
    const s = dayMap.get(d);
    if (!s) return isWeekend(d) ? settings.weekendStart : settings.weekdayStart;
    return isWeekend(d) ? s.weekend : s.weekday;
  };
  const statuses = dates.map((d) => dayStatus(map.get(d), entries)?.status);
  const counts = { green: 0, amber: 0, red: 0 } as Record<Status, number>;
  statuses.forEach((s) => s && counts[s]++);
  const shown = Math.min(range, 28);

  return (
    <section className="stack">
      <div className="seg" role="radiogroup" aria-label="Range">
        {[14, 28, 56].map((r) => (
          <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)} role="radio" aria-checked={range === r}>
            {r} days
          </button>
        ))}
      </div>

      <div className="card">
        <h2>Daily status</h2>
        <div className="strip" style={{ gridTemplateColumns: `repeat(${Math.min(shown, 14)}, minmax(0, 1fr))` }}>
          {dates.slice(-shown).map((d, k) => {
            const s = statuses[statuses.length - shown + k];
            const dosed = (map.get(d)?.doses ?? 0) > 0;
            return (
              <span key={d} className={`cell ${s ?? "none"} ${dosed ? "dosed" : ""}`} title={`${prettyDate(d)}: ${s ? STATUS_LABEL[s] : "no data"}${dosed ? " · diclofenac" : ""}`}>
                {s ? STATUS_ICON[s] : ""}
              </span>
            );
          })}
        </div>
        <p className="muted small">
          {counts.green} green · {counts.amber} amber · {counts.red} red in the last {range} days. Underlined = diclofenac taken.
        </p>
      </div>

      <div className="card">
        <h2>Pain</h2>
        <LineChart
          label="Pain scores"
          dates={dates}
          yMax={10}
          unit="/10"
          series={[
            { name: "Morning", color: "var(--series-1)", values: get("morningPain") },
            { name: "Toe-off", color: "var(--series-2)", values: get("toeOffPain") },
            { name: "Evening", color: "var(--series-3)", values: get("eveningPain") },
          ]}
        />
      </div>

      <div className="card">
        <h2>Steps</h2>
        <StepsChart dates={dates} steps={get("steps")} targets={dates.map(targetFor)} />
      </div>

      <div className="card">
        <h2>Isometric load</h2>
        <LineChart
          label="Isometric load in kilograms"
          dates={dates}
          unit="kg"
          series={[
            { name: "Prescribed", color: "var(--series-1)", values: dates.map((d) => dayMap.get(d)?.iso ?? null) },
            { name: "Done", color: "var(--series-2)", values: get("isoLoadKg"), connectGaps: true },
          ]}
        />
      </div>

      <div className="card">
        <h2>Seated calf raise</h2>
        <LineChart
          label="Seated calf raise load in kilograms"
          dates={dates}
          unit="kg"
          series={[
            { name: "Prescribed", color: "var(--series-1)", values: dates.map((d) => dayMap.get(d)?.seated ?? null) },
            { name: "Done", color: "var(--series-2)", values: get("seatedLoadKg"), connectGaps: true },
          ]}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- history
function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function History({
  entries,
  mode,
  onChange,
  onOpen,
}: {
  entries: Entry[];
  mode: store.Mode;
  onChange: (e: Entry[]) => void;
  onOpen: (d: string) => void;
}) {
  const list = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  const csv = () => {
    const cols: (keyof Entry)[] = [
      "date", "steps", "morningPain", "toeOffPain", "eveningPain", "doses", "isoDone", "isoMode", "isoLoadKg", "isoSets", "isoPain",
      "legDay", "seatedLoadKg", "seatedSets", "seatedReps", "standingLoadKg", "standingSets", "standingReps", "isotonicPain", "notes",
    ];
    const rows = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => {
      const st = dayStatus(e, entries)?.status ?? "";
      return [...cols.map((c) => JSON.stringify(e[c] ?? "")), st].join(",");
    });
    download("tendon-tracker.csv", [...cols, "status"].join(",") + "\n" + rows.join("\n"), "text/csv");
  };
  return (
    <section className="stack">
      <div className="row three-btn">
        <button onClick={() => download("tendon-tracker.json", JSON.stringify(entries, null, 2), "application/json")}>Export JSON</button>
        <button onClick={csv}>Export CSV</button>
        <label className="button">
          Import
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              if (!f) return;
              try {
                const data = JSON.parse(await f.text());
                if (!Array.isArray(data)) throw new Error();
                onChange(await store.importEntries(mode, data, entries));
              } catch {
                alert("That file isn't a Tendon Tracker export.");
              }
            }}
          />
        </label>
      </div>
      {!list.length && <p className="muted center">Nothing logged yet.</p>}
      {list.map((e) => {
        const st = dayStatus(e, entries);
        return (
          <div key={e.date} className="card hist" onClick={() => onOpen(e.date)} role="button" tabIndex={0} onKeyDown={(k) => k.key === "Enter" && onOpen(e.date)}>
            <div className="hist-top">
              <b>{prettyDate(e.date)}</b>
              <StatusPill s={st?.status} small />
            </div>
            <div className="hist-grid">
              <span>Steps <b>{e.steps?.toLocaleString() ?? "–"}</b></span>
              <span>Morning <b>{e.morningPain ?? "–"}</b></span>
              <span>Toe-off <b>{e.toeOffPain ?? "–"}</b></span>
              <span>Evening <b>{e.eveningPain ?? "–"}</b></span>
            </div>
            <p className="muted small">
              {[
                e.isoDone && `Iso ${e.isoMode === "desk" ? "desk" : `${e.isoLoadKg ?? "?"}kg`}`,
                e.legDay && `Leg day, seated ${e.seatedLoadKg ?? "?"}kg`,
                (e.doses ?? 0) > 0 && `Diclofenac ×${e.doses}`,
                e.notes,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <button
              className="link danger"
              onClick={async (ev) => {
                ev.stopPropagation();
                if (confirm(`Delete ${prettyDate(e.date)}?`)) onChange(await store.deleteEntry(mode, e.date, entries));
              }}
            >
              Delete
            </button>
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------- plan
function CourseEditor({ c, onChange, onDelete }: { c: Course; onChange: (c: Course) => void; onDelete: () => void }) {
  const setStep = (i: number, p: Partial<DoseStep>) => onChange({ ...c, steps: c.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <div className="course">
      <div className="card-head">
        <b>
          {c.kind === "rescue" ? "Rescue course" : "Planned course"} · {prettyDate(courseStart(c))} – {prettyDate(courseEnd(c))}
        </b>
        <button className="link danger" onClick={onDelete}>
          Remove
        </button>
      </div>
      {c.steps.map((s, i) => (
        <div key={i} className="dose-row">
          <input type="date" value={s.from} onChange={(e) => setStep(i, { from: e.target.value })} aria-label="From" />
          <input type="date" value={s.to} onChange={(e) => setStep(i, { to: e.target.value })} aria-label="To" />
          <select value={s.mg} onChange={(e) => setStep(i, { mg: Number(e.target.value) })} aria-label="Dose">
            <option value={25}>25mg</option>
            <option value={50}>50mg</option>
          </select>
          <select value={s.perDay} onChange={(e) => setStep(i, { perDay: Number(e.target.value) })} aria-label="Times per day">
            <option value={1}>× 1</option>
            <option value={2}>× 2</option>
            <option value={3}>× 3</option>
          </select>
          <button className="link danger" onClick={() => onChange({ ...c, steps: c.steps.filter((_, j) => j !== i) })} aria-label="Remove phase">
            ✕
          </button>
        </div>
      ))}
      <button
        className="link"
        onClick={() => {
          const last = c.steps[c.steps.length - 1];
          const from = last ? addDays(last.to, 1) : localToday();
          onChange({ ...c, steps: [...c.steps, { from, to: addDays(from, 2), mg: 25, perDay: 1 }] });
        }}
      >
        + Add phase
      </button>
    </div>
  );
}

function Plan({ entries, settings, onSave, mode }: { entries: Entry[]; settings: Settings; onSave: (s: Settings) => void; mode: store.Mode }) {
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(true);
  const [reset, setReset] = useState<{ weekday?: number; weekend?: number; iso?: number; seated?: number }>({});
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };
  const today = localToday();
  const { plan, events } = useMemo(() => planFor(entries, s, today), [entries, s, today]);
  const st = plan.state;

  return (
    <section className="stack">
      <div className="card">
        <h2>Current targets</h2>
        <div className="targets">
          <div><span>Weekday</span><b>{st.weekday.toLocaleString()}</b></div>
          <div><span>Weekend</span><b>{st.weekend.toLocaleString()}</b></div>
          <div><span>Isometric</span><b>{st.iso}kg</b></div>
          <div><span>Seated raise</span><b>{st.seated}kg</b></div>
        </div>
        <p className="muted small">Worked out from your log since {prettyDate(s.planStart)}. {st.hold && st.holdUntil ? `On hold until ${prettyDate(st.holdUntil)}.` : ""}</p>
        <details>
          <summary className="small">Reset targets from today</summary>
          <div className="row">
            <Num label="Weekday" value={reset.weekday} onChange={(v) => setReset({ ...reset, weekday: v })} step={500} placeholder={String(st.weekday)} />
            <Num label="Weekend" value={reset.weekend} onChange={(v) => setReset({ ...reset, weekend: v })} step={500} placeholder={String(st.weekend)} />
          </div>
          <div className="row">
            <Num label="Isometric" value={reset.iso} onChange={(v) => setReset({ ...reset, iso: v })} step={5} suffix="kg" placeholder={String(st.iso)} />
            <Num label="Seated" value={reset.seated} onChange={(v) => setReset({ ...reset, seated: v })} step={5} suffix="kg" placeholder={String(st.seated)} />
          </div>
          <button
            disabled={Object.values(reset).every((v) => v == null)}
            onClick={() => {
              set("overrides", [...s.overrides.filter((o) => o.date !== today), { date: today, ...reset }]);
              setReset({});
            }}
          >
            Apply reset
          </button>
        </details>
      </div>

      <div className="card">
        <h2>Diclofenac</h2>
        {s.courses.length === 0 && <p className="muted small">No courses.</p>}
        {[...s.courses]
          .sort((a, b) => (courseStart(a) < courseStart(b) ? 1 : -1))
          .map((c) => (
            <CourseEditor
              key={c.id}
              c={c}
              onChange={(nc) => set("courses", s.courses.map((x) => (x.id === c.id ? nc : x)))}
              onDelete={() => confirm("Remove this course?") && set("courses", s.courses.filter((x) => x.id !== c.id))}
            />
          ))}
        <button
          className="link"
          onClick={() =>
            set("courses", [...s.courses, { id: `course-${Date.now()}`, kind: "planned", steps: [{ from: today, to: addDays(today, 2), mg: 50, perDay: 3 }] }])
          }
        >
          + Add course
        </button>
        <p className="muted small">Progressions hold until 4 days after each course&apos;s last dose. A new course needs 7 clear days.</p>
      </div>

      <div className="card">
        <h2>Settings</h2>
        <div className="row">
          <label className="field">
            <span>Plan start</span>
            <input type="date" value={s.planStart} onChange={(e) => set("planStart", e.target.value)} />
          </label>
          <Num label="Pain alert at" value={s.painThreshold} onChange={(v) => set("painThreshold", Math.min(10, v ?? 6))} suffix="/10" />
        </div>
        <div className="row">
          <Num label="Weekday baseline" value={s.weekdayStart} onChange={(v) => set("weekdayStart", v ?? 6000)} step={500} />
          <Num label="Weekend baseline" value={s.weekendStart} onChange={(v) => set("weekendStart", v ?? 10000)} step={500} />
        </div>
        <div className="row">
          <Num label="Step goal" value={s.goalSteps} onChange={(v) => set("goalSteps", v ?? 11000)} step={500} />
          <Num label="Step increment" value={s.stepIncrement} onChange={(v) => set("stepIncrement", v ?? 500)} step={250} />
        </div>
        <div className="row">
          <Num label="Isometric start" value={s.isoStart} onChange={(v) => set("isoStart", v ?? 20)} step={5} suffix="kg" />
          <Num label="Seated start" value={s.seatedStart} onChange={(v) => set("seatedStart", v ?? 20)} step={5} suffix="kg" />
        </div>
        <p className="label">Progression (conservative defaults)</p>
        <div className="row">
          <Num label="Isometric step" value={s.isoIncrement} onChange={(v) => set("isoIncrement", v ?? 2.5)} step={1.25} suffix="kg" />
          <Num label="Green days needed" value={s.isoGreenDays} onChange={(v) => set("isoGreenDays", Math.max(2, v ?? 5))} />
        </div>
        <div className="row">
          <Num label="Seated step" value={s.seatedIncrement} onChange={(v) => set("seatedIncrement", v ?? 2.5)} step={1.25} suffix="kg" />
          <Num label="Sessions needed" value={s.sessionsToProgress} onChange={(v) => set("sessionsToProgress", Math.max(1, v ?? 3))} />
        </div>
        <div className="row">
          <Num label="Hold week every" value={s.consolidateEvery} onChange={(v) => set("consolidateEvery", v ?? 4)} suffix="wks" />
          <Num label="Isometric ceiling" value={s.isoMax} onChange={(v) => set("isoMax", v ?? 100)} step={5} suffix="kg" />
        </div>
        <div className="row">
          <Num label="Double steps below" value={s.lightKg} onChange={(v) => set("lightKg", v ?? 50)} step={5} suffix="kg" />
          <span />
        </div>
        <p className="label">Leg days</p>
        <div className="chips">
          {DOW.map((d, i) => (
            <button
              key={d}
              className={s.legDays.includes(i) ? "on" : ""}
              onClick={() => set("legDays", s.legDays.includes(i) ? s.legDays.filter((x) => x !== i) : [...s.legDays, i].sort())}
              aria-pressed={s.legDays.includes(i)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="savebar">
        <button
          className="primary big"
          disabled={saved}
          onClick={() => {
            onSave(s);
            setSaved(true);
          }}
        >
          {saved ? "Plan saved" : "Save plan"}
        </button>
      </div>

      <div className="card">
        <h2>Plan changes</h2>
        {!events.filter((e) => e.kind !== "reset").length && <p className="muted small">No changes yet. They appear as your log earns them.</p>}
        <ul className="changes">
          {[...events].reverse().map((ev, i) => (
            <li key={i} className={ev.dir < 0 ? "down" : ev.dir > 0 ? "up" : ""}>
              <span>{prettyDate(ev.date)}</span>
              {ev.kind === "reset" ? "Manual reset" : `${{ steps: "Steps", iso: "Isometric", seated: "Seated raise", standing: "Standing raise" }[ev.kind]}: ${ev.from} → ${ev.to}`}
              <em>{ev.why}</em>
            </li>
          ))}
        </ul>
      </div>

      <details className="card rules">
        <summary>How the plan works</summary>
        <ul>
          <li><b>Status</b> compares first-steps (and evening) pain with the median of the previous 7 days: same or lower green, +1 amber, +2 red. Pain over 3/10 during loading or walking makes it at least amber.</li>
          <li><b>Weeks</b> alternate from the first Monday after the diclofenac hold: steps week, calf week, steps week, then a hold week every {s.consolidateEvery}th week. Only one thing changes in any week. Isometrics progress independently.</li>
          <li><b>Steps</b> can rise {s.stepIncrement} on the Monday of a steps week, only after 2 weeks with no red day and no diclofenac, last week at most 1 amber, weekdays at target, and Monday no worse than Friday. Weekdays climb to the weekend baseline first, then all days move toward the goal. A red day in the week drops weekdays back a step; a red morning drops that day to baseline.</li>
          <li><b>Isometrics</b> add {s.isoIncrement}kg ({s.isoIncrement * 2}kg below {s.lightKg}kg) after {s.isoGreenDays} green days in a row with holds done (not counting diclofenac days), up to {s.isoMax}kg; a red morning returns to the previous load.</li>
          <li><b>Calves</b>: in a calf week, after {s.sessionsToProgress} tolerated leg sessions (pain ≤3/10, green next morning), one exercise progresses: seated raise +{s.seatedIncrement}kg ({s.seatedIncrement * 2}kg below {s.lightKg}kg) or standing raise up a level (double → single leg → single leg + 2.5kg steps), taking turns. Nothing progresses on an amber or red leg day; a red morning after a leg day steps both back.</li>
          <li><b>Diclofenac</b>: nothing progresses until 4 days after the last dose. Pain at or above {s.painThreshold}/10 (or two red days running) triggers advice: offload; a 3-day 50mg × 3 course only after 7 clear days; escalate after two rescue courses in 4 weeks or three days over threshold on an NSAID.</li>
          <li><b>Escalate</b> if still mostly amber/red 1–3 weeks after stopping: MRI and sports physician.</li>
        </ul>
        <p className="muted small">Storage: {mode === "cloud" ? "Neon Postgres (synced across devices)" : "this browser only. Add DATABASE_URL in Vercel to sync."}</p>
      </details>
    </section>
  );
}

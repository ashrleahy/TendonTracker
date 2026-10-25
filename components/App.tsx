"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Entry, Settings, Status, Training } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { addDays, dayStatus, isWeekend, localToday, prettyDate, streak, trainingPainOf } from "@/lib/logic";
import { planFor, STANDING_NAMES, type Alert } from "@/lib/plan";
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

  const n = streak(entries, localToday(), settings.painThreshold);
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
          onError={setError}
        />
      )}
      {tab === "trends" && <Trends entries={entries} settings={settings} />}
      {tab === "history" && (
        <History
          entries={entries}
          settings={settings}
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
function AlertCard({ a }: { a: Alert }) {
  return (
    <div className={`sugg ${a.tone}`}>
      <div>
        <b>{a.title}</b>
        <p>{a.detail}</p>
      </div>
    </div>
  );
}

const TRAINING_LABEL: Record<Training, string> = { done: "As prescribed", light: "Lighter", skipped: "Skipped" };

function Today({
  date,
  setDate,
  entries,
  settings,
  mode,
  onSaved,
  onError,
}: {
  date: string;
  setDate: (d: string) => void;
  entries: Entry[];
  settings: Settings;
  mode: store.Mode;
  onSaved: (e: Entry[]) => void;
  onError: (m: string | null) => void;
}) {
  const existing = entries.find((e) => e.date === date);
  const [e, setE] = useState<Entry>(existing ?? { date });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => {
    setE((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  // plan reflects what's been entered so far (unsaved included)
  const merged = useMemo(() => [...entries.filter((x) => x.date !== date), e], [entries, e, date]);
  const { plan } = useMemo(() => planFor(merged, settings, date), [merged, settings, date]);
  const statusInfo = useMemo(() => dayStatus(e, merged, settings.painThreshold), [e, merged, settings.painThreshold]);
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

  const defaultTraining: Training = plan.calves?.skip ? "skipped" : "done";
  const training = e.training ?? defaultTraining;
  const showCalves = plan.scheduledLegDay || (!!e.training && e.training !== "skipped");
  const flareActive = plan.state.flare && !e.flare;

  return (
    <section className="stack">
      <div className="datebar">
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          ‹
        </button>
        <div>
          <b>{date === today ? "Today" : prettyDate(date)}</b>
          <span className="muted small">
            {[date === today ? prettyDate(date) : "", plan.scheduledLegDay ? "leg day" : "", plan.state.flare ? "flare" : ""].filter(Boolean).join(" · ")}
          </span>
        </div>
        <button onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
          ›
        </button>
      </div>

      {/* 1. Start of day */}
      <div className="card">
        <div className="card-head">
          <h2>Pain at start of day</h2>
          <StatusPill s={statusInfo?.status} small />
        </div>
        <Scale label="First steps" hint="reflects yesterday" value={e.morningPain} onChange={(v) => set("morningPain", v)} />
        {statusInfo && <p className="muted small reasons">{statusInfo.reasons.join(" · ")}</p>}
        {!plan.morningLogged && !isPast && <p className="nudge">Log first-steps pain and today&apos;s training adjusts to it.</p>}
      </div>

      {plan.alerts.length > 0 && (
        <div className="stack tight">
          {plan.alerts.map((a) => (
            <AlertCard key={a.id} a={a} />
          ))}
        </div>
      )}

      {/* 2. Steps */}
      <div className="card">
        <div className="card-head">
          <h2>Total steps</h2>
          {plan.steps.typical && <span className="muted small">usual ~{plan.steps.typical.toLocaleString()}</span>}
        </div>
        <Num label="Steps" value={e.steps} onChange={(v) => set("steps", v)} step={500} placeholder="0" />
        {plan.steps.heavy && <p className="nudge caution">Heavy walking day. If tomorrow morning is worse, this is the likely reason.</p>}
        <p className="muted small">{plan.steps.note}</p>
      </div>

      {/* 3. Training */}
      <div className="card">
        <h2>Training</h2>
        <div className="rx-list">
          <div>
            <b>
              Isometrics <span className="done-tag">Daily · assumed done</span>
            </b>
            <span>
              {plan.iso.sets} × {plan.iso.hold} at {plan.iso.load}kg
            </span>
            <em className="muted small">{plan.iso.effort} effort. {plan.iso.note}</em>
          </div>
          {showCalves && plan.calves && !plan.calves.skip && (
            <>
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
            </>
          )}
        </div>
        {showCalves && plan.calves && (
          <>
            <p className={plan.calves.skip ? "nudge warn" : "muted small"}>{plan.calves.note}</p>
            <p className="label">Leg session</p>
            <div className="seg" role="radiogroup" aria-label="Leg session">
              {(["done", "light", "skipped"] as Training[]).map((t) => (
                <button key={t} type="button" className={training === t ? "on" : ""} onClick={() => set("training", t)} role="radio" aria-checked={training === t}>
                  {TRAINING_LABEL[t]}
                </button>
              ))}
            </div>
            {training !== "skipped" && (
              <Scale label="Pain during calf work" hint="optional" value={e.trainingPain ?? e.isotonicPain} onChange={(v) => set("trainingPain", v)} />
            )}
            <details className="mods-wrap">
              <summary className="small">Leg session modifications</summary>
              <ul className="mods">
                {plan.legMods.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </details>
          </>
        )}
        {!showCalves && (
          <button className="link left" onClick={() => set("training", "done")}>
            + Did a leg session today
          </button>
        )}
      </div>

      {/* 4. End of day */}
      <div className="card">
        <h2>Pain at end of day</h2>
        <Scale label="Evening" value={e.eveningPain} onChange={(v) => set("eveningPain", v)} />
        <label className="field">
          <span>Notes</span>
          <textarea rows={2} value={e.notes ?? ""} onChange={(ev) => set("notes", ev.target.value || undefined)} placeholder="Anything that might explain today" />
        </label>
      </div>

      {/* 5. Exacerbation */}
      <div className={`card ${e.flare || flareActive ? "flare-card" : ""}`}>
        <h2>Exacerbation</h2>
        {flareActive && plan.state.flareStart && (
          <p className="small">
            Flare running since {prettyDate(plan.state.flareStart)}. It clears itself after 2 mornings at {plan.state.flareTarget}/10 or lower.
          </p>
        )}
        <Toggle label="It's got worse: log a flare" value={e.flare} onChange={(v) => set("flare", v || undefined)} />
        {e.flare && (
          <>
            <label className="field">
              <span>What happened?</span>
              <textarea rows={2} value={e.flareNote ?? ""} onChange={(ev) => set("flareNote", ev.target.value || undefined)} placeholder="e.g. long day on feet, stairs, sudden sharp pain" />
            </label>
            <p className="muted small">
              Isometrics drop ~20% and keep going daily at lighter effort, calf loads drop a step and loaded calf work stops until it settles, and nothing progresses for a week after.
            </p>
          </>
        )}
        <details>
          <summary className="small muted">Override today&apos;s status</summary>
          <select value={e.statusOverride ?? ""} onChange={(ev) => set("statusOverride", (ev.target.value || undefined) as Status | undefined)}>
            <option value="">Automatic{statusInfo ? ` (${STATUS_LABEL[statusInfo.computed]})` : ""}</option>
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="red">Red</option>
          </select>
        </details>
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
  const statuses = dates.map((d) => dayStatus(map.get(d), entries, settings.painThreshold)?.status);
  const counts = { green: 0, amber: 0, red: 0 } as Record<Status, number>;
  statuses.forEach((s) => s && counts[s]++);
  const shown = Math.min(range, 28);
  const avg = (k: "morningPain" | "steps", n: number) =>
    dates.map((d) => {
      const xs = Array.from({ length: n }, (_, i) => map.get(addDays(d, -i))?.[k]).filter((v): v is number => v != null);
      return xs.length >= Math.ceil(n / 2) ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * (k === "steps" ? 1 : 10)) / (k === "steps" ? 1 : 10) : null;
    });
  const stepAvg = avg("steps", 7);

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
            const fl = !!dayMap.get(d)?.flare;
            return (
              <span key={d} className={`cell ${s ?? "none"} ${fl ? "dosed" : ""}`} title={`${prettyDate(d)}: ${s ? STATUS_LABEL[s] : "no data"}${fl ? " · flare" : ""}`}>
                {s ? STATUS_ICON[s] : ""}
              </span>
            );
          })}
        </div>
        <p className="muted small">
          {counts.green} green · {counts.amber} amber · {counts.red} red in the last {range} days. Underlined = flare running.
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
            { name: "Evening", color: "var(--series-2)", values: get("eveningPain") },
            { name: "7-day avg", color: "var(--series-3)", values: avg("morningPain", 7) },
          ]}
        />
      </div>

      <div className="card">
        <h2>Steps</h2>
        <StepsChart dates={dates} steps={get("steps")} targets={stepAvg.map((v) => v ?? 0)} targetLabel="7-day avg" />
      </div>

      <div className="card">
        <h2>Loads</h2>
        <LineChart
          label="Isometric and seated calf raise load in kilograms"
          dates={dates}
          unit="kg"
          series={[
            { name: "Isometric", color: "var(--series-1)", values: dates.map((d) => dayMap.get(d)?.iso ?? null) },
            { name: "Seated raise", color: "var(--series-2)", values: dates.map((d) => dayMap.get(d)?.seated ?? null) },
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
  settings,
  mode,
  onChange,
  onOpen,
}: {
  entries: Entry[];
  settings: Settings;
  mode: store.Mode;
  onChange: (e: Entry[]) => void;
  onOpen: (d: string) => void;
}) {
  const list = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  const { days } = useMemo(() => planFor(entries, settings, localToday()), [entries, settings]);
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const csv = () => {
    const cols: (keyof Entry)[] = ["date", "morningPain", "steps", "training", "trainingPain", "eveningPain", "flare", "flareNote", "notes"];
    const rows = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => {
      const st = dayStatus(e, entries, settings.painThreshold)?.status ?? "";
      const d = dayMap.get(e.date);
      return [...cols.map((c) => JSON.stringify(c === "training" ? (d?.training ?? e.training ?? "") : (e[c] ?? ""))), st, d?.iso ?? "", d?.seated ?? ""].join(",");
    });
    download("tendon-tracker.csv", [...cols, "status", "isoKg", "seatedKg"].join(",") + "\n" + rows.join("\n"), "text/csv");
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
        const st = dayStatus(e, entries, settings.painThreshold);
        const d = dayMap.get(e.date);
        const tp = trainingPainOf(e);
        return (
          <div key={e.date} className="card hist" onClick={() => onOpen(e.date)} role="button" tabIndex={0} onKeyDown={(k) => k.key === "Enter" && onOpen(e.date)}>
            <div className="hist-top">
              <b>{prettyDate(e.date)}</b>
              <StatusPill s={st?.status} small />
            </div>
            <div className="hist-grid">
              <span>Morning <b>{e.morningPain ?? "–"}</b></span>
              <span>Steps <b>{e.steps?.toLocaleString() ?? "–"}</b></span>
              <span>Training <b>{tp ?? (d?.training ? "✓" : "–")}</b></span>
              <span>Evening <b>{e.eveningPain ?? "–"}</b></span>
            </div>
            <p className="muted small">
              {[
                d && `Iso ${d.iso}kg`,
                d?.training && d.training !== "skipped" && `Leg session${d.training === "light" ? " (lighter)" : ""}, seated ${d.seated}kg`,
                d?.training === "skipped" && "Leg session skipped",
                e.flare && `Flare${e.flareNote ? `: ${e.flareNote}` : ""}`,
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
function Plan({ entries, settings, onSave, mode }: { entries: Entry[]; settings: Settings; onSave: (s: Settings) => void; mode: store.Mode }) {
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(true);
  const [reset, setReset] = useState<{ iso?: number; seated?: number }>({});
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
        <h2>Current loads</h2>
        <div className="targets">
          <div><span>Isometric</span><b>{st.iso}kg</b></div>
          <div><span>Seated raise</span><b>{st.seated}kg</b></div>
          <div className="wide"><span>Standing raise</span><b>{STANDING_NAMES(st.standingLevel)}</b></div>
        </div>
        <p className="muted small">Worked out from your log since {prettyDate(s.planStart)}.</p>
        <details>
          <summary className="small">Reset loads from today</summary>
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
        <h2>Settings</h2>
        <div className="row">
          <label className="field">
            <span>Plan start</span>
            <input type="date" value={s.planStart} onChange={(e) => set("planStart", e.target.value)} />
          </label>
          <label className="field">
            <span>Last anti-inflammatory</span>
            <input type="date" value={s.lastNsaid ?? ""} onChange={(e) => set("lastNsaid", e.target.value || undefined)} />
          </label>
        </div>
        <div className="row">
          <Num label="Morning red at" value={s.painThreshold} onChange={(v) => set("painThreshold", Math.min(10, v ?? 5))} suffix="/10" />
          <span />
        </div>
        <div className="row">
          <Num label="Isometric start" value={s.isoStart} onChange={(v) => set("isoStart", v ?? 20)} step={5} suffix="kg" />
          <Num label="Seated start" value={s.seatedStart} onChange={(v) => set("seatedStart", v ?? 20)} step={5} suffix="kg" />
        </div>
        <p className="label">Progression</p>
        <div className="row">
          <Num label="Isometric step" value={s.isoIncrement} onChange={(v) => set("isoIncrement", v ?? 2.5)} step={1.25} suffix="kg" />
          <Num label="Green days needed" value={s.isoGreenDays} onChange={(v) => set("isoGreenDays", Math.max(2, v ?? 5))} />
        </div>
        <div className="row">
          <Num label="Seated step" value={s.seatedIncrement} onChange={(v) => set("seatedIncrement", v ?? 2.5)} step={1.25} suffix="kg" />
          <Num label="Sessions needed" value={s.sessionsToProgress} onChange={(v) => set("sessionsToProgress", Math.max(1, v ?? 3))} />
        </div>
        <div className="row">
          <Num label="Isometric ceiling" value={s.isoMax} onChange={(v) => set("isoMax", v ?? 100)} step={5} suffix="kg" />
          <Num label="Double steps below" value={s.lightKg} onChange={(v) => set("lightKg", v ?? 50)} step={5} suffix="kg" />
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
              {ev.kind === "reset"
                ? "Manual reset"
                : ev.kind === "flare"
                  ? ev.dir === 0
                    ? "Flare settled"
                    : "Flare"
                  : `${{ iso: "Isometric", seated: "Seated raise", standing: "Standing raise" }[ev.kind]}: ${ev.from} → ${ev.to}`}
              <em>{ev.why}</em>
            </li>
          ))}
        </ul>
      </div>

      <details className="card rules">
        <summary>How the plan works</summary>
        <ul>
          <li><b>Status</b> each day. Red: flare logged, morning pain {s.painThreshold}/10 or more, morning 2+ above your usual (7-day median), or pain over 5/10 during calf work. Amber: morning 1 above usual, training pain 4–5/10, or evening 2+ higher than the morning.</li>
          <li><b>Trend</b>: this week&apos;s average morning pain against last week&apos;s. Up by 1 or more is &quot;rising&quot;: no progressions, and loads drop a step (at most once a week) until it turns.</li>
          <li><b>Isometrics</b> are assumed done every day. They go up {s.isoIncrement}kg ({s.isoIncrement * 2}kg below {s.lightKg}kg) after {s.isoGreenDays} green days in a row, with today&apos;s morning green and the trend not rising, up to {s.isoMax}kg. A red morning puts them back to the previous load.</li>
          <li><b>Calves</b> (leg days {s.legDays.map((d) => DOW[d]).join("/")}, assumed done as prescribed unless you mark lighter or skipped). A session counts as tolerated if training pain was ≤3/10 and the next morning was green. After {s.sessionsToProgress}, one exercise steps up on a green leg-day morning, taking turns: seated +{s.seatedIncrement}kg ({s.seatedIncrement * 2}kg below {s.lightKg}kg), or standing up a level (double → single leg → single leg + 2.5kg). At most one calf step a week, never within 2 days of an isometric step. A red morning after a session, or training pain over 5/10, steps both back.</li>
          <li><b>Steps</b> aren&apos;t a target. A day 25%+ above your usual (and over 8k) is flagged as heavy. When a bad morning follows a heavy day without a leg session, calf loads aren&apos;t blamed.</li>
          <li><b>Flare</b> (Exacerbation section): isometrics down ~20% and kept daily at lighter effort, calf loads down a step and no loaded calf work until 2 mornings in a row are back to your pre-flare usual. Nothing progresses for a week after it settles.</li>
          <li><b>Get it reviewed</b> if a flare runs 10+ days, there are 2 flares in 4 weeks, or 5 of the last 7 days are amber/red.</li>
          <li><b>Anti-inflammatories</b>: days up to 4 after the last dose (set above, or any logged dose) don&apos;t count as evidence.</li>
        </ul>
        <p className="muted small">Storage: {mode === "cloud" ? "Neon Postgres (synced across devices)" : "this browser only. Add DATABASE_URL in Vercel to sync."}</p>
      </details>
    </section>
  );
}

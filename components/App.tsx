"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Entry, Settings, Status, ChangeLog } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import {
  addDays,
  dayStatus,
  isWeekend,
  localToday,
  nsaidHold,
  prettyDate,
  stepTarget,
  streak,
  suggestions,
  type Suggestion,
} from "@/lib/logic";
import * as store from "@/lib/store";
import { LineChart, StepsChart } from "./Charts";

type Tab = "today" | "trends" | "history" | "plan";

const STATUS_LABEL: Record<Status, string> = { green: "Green", amber: "Amber", red: "Red" };
const STATUS_ICON: Record<Status, string> = { green: "✓", amber: "!", red: "✕" };

export function StatusPill({ s, small }: { s?: Status; small?: boolean }) {
  if (!s) return <span className={`pill none ${small ? "small" : ""}`}>No data</span>;
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
      setError("Settings saved on this device only. Sync failed.");
    }
  };

  const applySuggestion = (sg: Suggestion) => {
    if (!sg.action) return;
    const today = localToday();
    const a = sg.action;
    const s = { ...settings, changes: [...settings.changes] };
    let from = 0;
    if (a.kind === "steps") {
      from = s.weekdayTarget;
      s.weekdayTarget = a.to;
      if (a.weekendTo != null) s.weekendTarget = a.weekendTo;
    } else if (a.kind === "iso") {
      from = s.isoLoadKg;
      s.isoLoadKg = a.to;
    } else {
      from = s.seatedLoadKg;
      s.seatedLoadKg = a.to;
    }
    const log: ChangeLog = { date: today, kind: a.kind, from, to: a.to };
    s.changes.push(log);
    persistSettings(s);
  };

  if (needCode) return <PasscodeGate onDone={boot} />;
  if (!mode)
    return (
      <main className="shell">
        <p className="muted center">Loading…</p>
      </main>
    );

  return (
    <main className="shell">
      <header className="top">
        <div>
          <h1>Tendon Tracker</h1>
          <p className="muted small">
            {mode === "cloud" ? "Synced" : "Saved on this device"} · {streak(entries, localToday())} green day
            {streak(entries, localToday()) === 1 ? "" : "s"} in a row
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
          onApply={applySuggestion}
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
      {tab === "plan" && <Plan settings={settings} onSave={persistSettings} mode={mode} />}

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
function Scale({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value?: number;
  onChange: (v?: number) => void;
}) {
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
function SuggestionCard({ s, onApply }: { s: Suggestion; onApply: (s: Suggestion) => void }) {
  const [done, setDone] = useState(false);
  return (
    <div className={`sugg ${s.tone}`}>
      <div>
        <b>{s.title}</b>
        <p>{s.detail}</p>
      </div>
      {s.action && (
        <button
          className={s.tone === "back" ? "" : "primary"}
          disabled={done}
          onClick={() => {
            onApply(s);
            setDone(true);
          }}
        >
          {done ? "Applied" : "Apply"}
        </button>
      )}
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
  onApply,
  onError,
}: {
  date: string;
  setDate: (d: string) => void;
  entries: Entry[];
  settings: Settings;
  mode: store.Mode;
  onSaved: (e: Entry[]) => void;
  onApply: (s: Suggestion) => void;
  onError: (m: string | null) => void;
}) {
  const existing = entries.find((e) => e.date === date);
  const hold = nsaidHold(settings, date);
  const [e, setE] = useState<Entry>(
    existing ?? {
      date,
      nsaid:
        settings.nsaidStart && date >= settings.nsaidStart && (settings.nsaidEnd ? date <= settings.nsaidEnd : hold.active)
          ? true
          : undefined,
    }
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => {
    setE((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  const preview = useMemo(() => {
    const others = entries.filter((x) => x.date !== date);
    return dayStatus(e, [...others, e]);
  }, [e, entries, date]);
  const today = localToday();
  const sugg = useMemo(() => (date === today ? suggestions(entries, settings, today) : []), [entries, settings, date, today]);
  const target = stepTarget(settings, date);

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

  return (
    <section className="stack">
      <div className="datebar">
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          ‹
        </button>
        <div>
          <b>{date === today ? "Today" : prettyDate(date)}</b>
          <span className="muted small">
            {date === today ? prettyDate(date) : ""} {isWeekend(date) ? "· weekend" : ""}
          </span>
        </div>
        <button onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Next day">
          ›
        </button>
      </div>

      <div className="card status-card">
        <StatusPill s={preview?.status} />
        <ul>{preview?.reasons.map((r) => <li key={r}>{r}</li>) ?? <li>Log pain scores to get a status.</li>}</ul>
      </div>

      {sugg.length > 0 && (
        <div className="stack tight">
          {sugg.map((s) => (
            <SuggestionCard key={s.id} s={s} onApply={onApply} />
          ))}
        </div>
      )}

      <div className="card">
        <h2>Pain</h2>
        <Scale label="Morning first steps" hint="reflects yesterday" value={e.morningPain} onChange={(v) => set("morningPain", v)} />
        <Scale label="Walking / toe-off" hint="worst during the day" value={e.toeOffPain} onChange={(v) => set("toeOffPain", v)} />
        <Scale label="Evening" value={e.eveningPain} onChange={(v) => set("eveningPain", v)} />
      </div>

      <div className="card">
        <h2>Steps</h2>
        <Num label="Steps" value={e.steps} onChange={(v) => set("steps", v)} step={500} placeholder="0" />
        <div className="meter" aria-hidden>
          <div style={{ width: `${Math.min(100, ((e.steps ?? 0) / target) * 100)}%` }} className={(e.steps ?? 0) > target * 1.1 ? "over" : ""} />
        </div>
        <p className="muted small">
          Target {target.toLocaleString()} ({isWeekend(date) ? "weekend" : "weekday"})
          {(e.steps ?? 0) > target * 1.1 ? " · over target by more than 10%" : ""}
        </p>
      </div>

      <div className="card">
        <h2>Isometrics</h2>
        <Toggle label="Holds done" value={e.isoDone} onChange={(v) => {
          set("isoDone", v);
          if (v && e.isoMode == null) {
            set("isoMode", "bar");
            set("isoLoadKg", settings.isoLoadKg);
            set("isoSets", 5);
          }
        }} />
        {e.isoDone && (
          <>
            <div className="seg" role="radiogroup" aria-label="Isometric method">
              {(["bar", "desk"] as const).map((m) => (
                <button key={m} type="button" className={e.isoMode === m ? "on" : ""} onClick={() => set("isoMode", m)} role="radio" aria-checked={e.isoMode === m}>
                  {m === "bar" ? "Seated + bar" : "Desk push"}
                </button>
              ))}
            </div>
            <div className="row">
              {e.isoMode === "bar" && <Num label="Load" value={e.isoLoadKg} onChange={(v) => set("isoLoadKg", v)} step={5} suffix="kg" />}
              <Num label="Sets" value={e.isoSets} onChange={(v) => set("isoSets", v)} />
            </div>
            <Scale label="Pain during holds" value={e.isoPain} onChange={(v) => set("isoPain", v)} />
          </>
        )}
      </div>

      <div className="card">
        <h2>Leg day</h2>
        <Toggle label="Leg session today" value={e.legDay} onChange={(v) => {
          set("legDay", v);
          if (v && e.seatedLoadKg == null) {
            set("seatedLoadKg", settings.seatedLoadKg);
            set("seatedSets", 3);
            set("seatedReps", 15);
          }
        }} />
        {e.legDay && (
          <>
            <p className="label">Seated calf raise</p>
            <div className="row three">
              <Num label="Load" value={e.seatedLoadKg} onChange={(v) => set("seatedLoadKg", v)} step={5} suffix="kg" />
              <Num label="Sets" value={e.seatedSets} onChange={(v) => set("seatedSets", v)} />
              <Num label="Reps" value={e.seatedReps} onChange={(v) => set("seatedReps", v)} />
            </div>
            <p className="label">Standing calf raise (flat floor)</p>
            <div className="row three">
              <Num label="Load" value={e.standingLoadKg} onChange={(v) => set("standingLoadKg", v)} step={2.5} suffix="kg" placeholder="BW" />
              <Num label="Sets" value={e.standingSets} onChange={(v) => set("standingSets", v)} />
              <Num label="Reps" value={e.standingReps} onChange={(v) => set("standingReps", v)} />
            </div>
            <Scale label="Pain during calf work" value={e.isotonicPain} onChange={(v) => set("isotonicPain", v)} />
          </>
        )}
      </div>

      <div className="card">
        <h2>Other</h2>
        <Toggle label="Took diclofenac today" value={e.nsaid} onChange={(v) => set("nsaid", v)} />
        <label className="field">
          <span>Notes</span>
          <textarea rows={2} value={e.notes ?? ""} onChange={(ev) => set("notes", ev.target.value || undefined)} placeholder="Anything that might explain today" />
        </label>
        <label className="field">
          <span>Override status</span>
          <select value={e.statusOverride ?? ""} onChange={(ev) => set("statusOverride", (ev.target.value || undefined) as Status | undefined)}>
            <option value="">Automatic ({preview ? STATUS_LABEL[preview.computed] : "none yet"})</option>
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
  // target history: replay the change log
  const targetFor = (d: string) => {
    let wd = DEFAULT_SETTINGS.weekdayTarget;
    let we = DEFAULT_SETTINGS.weekendTarget;
    const stepChanges = settings.changes.filter((c) => c.kind === "steps").sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!stepChanges.length) return stepTarget(settings, d);
    wd = stepChanges[0].from;
    for (const c of stepChanges) if (c.date <= d) wd = c.to;
    we = Math.max(settings.weekendTarget, wd);
    if (wd < settings.weekendTarget) we = settings.weekendTarget;
    return isWeekend(d) ? we : wd;
  };
  const statuses = dates.map((d) => dayStatus(map.get(d), entries)?.status);
  const counts = { green: 0, amber: 0, red: 0 } as Record<Status, number>;
  statuses.forEach((s) => s && counts[s]++);
  const hasIso = get("isoLoadKg").some((v) => v != null) || get("seatedLoadKg").some((v) => v != null);

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
        <div className="strip" style={{ gridTemplateColumns: `repeat(${Math.min(range, 14)}, minmax(0, 1fr))` }}>
          {dates.slice(-28).map((d, k) => {
            const s = statuses[statuses.length - Math.min(range, 28) + k];
            return (
              <span key={d} className={`cell ${s ?? "none"}`} title={`${prettyDate(d)}: ${s ? STATUS_LABEL[s] : "no data"}`}>
                {s ? STATUS_ICON[s] : ""}
              </span>
            );
          })}
        </div>
        <p className="muted small">
          {counts.green} green · {counts.amber} amber · {counts.red} red in the last {range} days
          {range > 28 ? " (strip shows the last 28)" : ""}
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

      {hasIso && (
        <div className="card">
          <h2>Calf loading</h2>
          <LineChart
            label="Calf loading in kilograms"
            dates={dates}
            unit="kg"
            series={[
              { name: "Isometric", color: "var(--series-1)", values: get("isoLoadKg") },
              { name: "Seated raise", color: "var(--series-2)", values: get("seatedLoadKg"), connectGaps: true },
            ]}
          />
        </div>
      )}
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
      "date", "steps", "morningPain", "toeOffPain", "eveningPain", "nsaid", "isoDone", "isoMode", "isoLoadKg", "isoSets", "isoPain",
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
      <div className="row">
        <button onClick={() => download("tendon-tracker.json", JSON.stringify(entries, null, 2), "application/json")}>Export JSON</button>
        <button onClick={csv}>Export CSV</button>
        <label className="button">
          Import JSON
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
                e.nsaid && "Diclofenac",
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
function Plan({ settings, onSave, mode }: { settings: Settings; onSave: (s: Settings) => void; mode: store.Mode }) {
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };
  const hold = nsaidHold(s, localToday());
  return (
    <section className="stack">
      <div className="card">
        <h2>Targets</h2>
        <div className="row">
          <Num label="Weekday steps" value={s.weekdayTarget} onChange={(v) => set("weekdayTarget", v ?? 6000)} step={500} />
          <Num label="Weekend steps" value={s.weekendTarget} onChange={(v) => set("weekendTarget", v ?? 10000)} step={500} />
        </div>
        <div className="row">
          <Num label="Goal" value={s.goalSteps} onChange={(v) => set("goalSteps", v ?? 11000)} step={500} />
          <Num label="Weekly increment" value={s.stepIncrement} onChange={(v) => set("stepIncrement", v ?? 500)} step={250} />
        </div>
        <div className="row">
          <Num label="Isometric load" value={s.isoLoadKg} onChange={(v) => set("isoLoadKg", v ?? 20)} step={5} suffix="kg" />
          <Num label="Seated raise load" value={s.seatedLoadKg} onChange={(v) => set("seatedLoadKg", v ?? 20)} step={5} suffix="kg" />
        </div>
      </div>

      <div className="card">
        <h2>Diclofenac course</h2>
        <div className="row">
          <label className="field">
            <span>Started</span>
            <input type="date" value={s.nsaidStart ?? ""} onChange={(e) => set("nsaidStart", e.target.value || undefined)} />
          </label>
          <label className="field">
            <span>Last dose</span>
            <input type="date" value={s.nsaidEnd ?? ""} onChange={(e) => set("nsaidEnd", e.target.value || undefined)} />
          </label>
        </div>
        {s.nsaidStart && (
          <p className="muted small">
            Progressions held until {prettyDate(hold.until!)}
            {!s.nsaidEnd ? " (assumes a 7-day course until you enter the last dose)" : ""}.
          </p>
        )}
      </div>

      <button
        className="primary big"
        onClick={() => {
          onSave(s);
          setSaved(true);
        }}
      >
        {saved ? "Saved" : "Save plan"}
      </button>

      <div className="card">
        <h2>Changes</h2>
        {!settings.changes.length && <p className="muted small">None yet. Applied suggestions appear here.</p>}
        <ul className="changes">
          {[...settings.changes].reverse().map((c, i) => (
            <li key={i}>
              <span>{prettyDate(c.date)}</span>
              {c.kind === "steps" ? "Weekday steps" : c.kind === "iso" ? "Isometric load" : "Seated raise"}: {c.from.toLocaleString()} → {c.to.toLocaleString()}
              {c.kind !== "steps" ? "kg" : ""}
            </li>
          ))}
        </ul>
      </div>

      <details className="card rules">
        <summary>How the rules work</summary>
        <ul>
          <li><b>Status</b> compares this morning&apos;s first-steps pain (and evening pain) with the median of the previous 7 days. Same or lower is green, +1 is amber, +2 or more is red. Pain over 3/10 during holds, calf work or walking makes the day at least amber.</li>
          <li><b>Steps</b> are reviewed over the last 7 days. Any red drops weekdays back one increment. Two or more ambers holds. A green week at target raises weekdays; weekends stay at their baseline until weekdays catch up, then everything moves together to the goal.</li>
          <li><b>One variable per week:</b> raising steps or seated-raise load locks the other for 7 days. Isometric load is exempt.</li>
          <li><b>Isometrics</b> add 5kg after 3 consecutive green days with holds done; a red day drops back to the previous load.</li>
          <li><b>Seated raise</b> adds 5kg after two leg days in a row with pain ≤3/10 and a green next morning.</li>
          <li><b>Diclofenac:</b> all progressions hold until 4 days after the last dose.</li>
          <li><b>Escalate</b> if the insertion hasn&apos;t settled within 1–2 weeks of stopping diclofenac: MRI and sports physician.</li>
        </ul>
        <p className="muted small">Storage: {mode === "cloud" ? "Neon Postgres (synced across devices)" : "this browser only. Add DATABASE_URL in Vercel to sync."}</p>
      </details>
    </section>
  );
}

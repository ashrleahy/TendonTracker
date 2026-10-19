"use client";
import { useMemo, useRef, useState } from "react";
import { prettyDate } from "@/lib/logic";

export interface Series {
  name: string;
  color: string; // css var
  values: (number | null)[];
  connectGaps?: boolean;
}

const W = 640;
const PAD = { l: 40, r: 70, t: 12, b: 26 };

function useHover(n: number, plotW: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [i, setI] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current;
    if (!svg || n === 0) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W - PAD.l;
    const step = n > 1 ? plotW / (n - 1) : plotW;
    setI(Math.max(0, Math.min(n - 1, Math.round(n > 1 ? x / step : 0))));
  };
  return { ref, i, onMove, onLeave: () => setI(null) };
}

function ticks(max: number, count = 4): number[] {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  let v = 0;
  out.push(0);
  while (v < max - 1e-9) {
    v += step;
    out.push(+v.toFixed(6));
  }
  return out;
}

function xLabels(dates: string[]) {
  const n = dates.length;
  const every = Math.max(1, Math.ceil(n / 5));
  const idx: number[] = [];
  for (let i = n - 1; i >= 0; i -= every) idx.unshift(i); // anchor on today
  return idx;
}

const shortDate = (s: string) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });

export function LineChart({
  dates,
  series,
  height = 220,
  yMax,
  unit = "",
  label,
}: {
  dates: string[];
  series: Series[];
  height?: number;
  yMax?: number;
  unit?: string;
  label: string;
}) {
  const plotW = W - PAD.l - PAD.r;
  const plotH = height - PAD.t - PAD.b;
  const max = useMemo(() => {
    if (yMax != null) return yMax;
    const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
    const m = Math.max(1, ...all);
    const t = ticks(m * 1.05);
    return t[t.length - 1];
  }, [series, yMax]);
  const yt = ticks(max);
  const n = dates.length;
  const x = (i: number) => PAD.l + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const { ref, i, onMove, onLeave } = useHover(n, plotW);

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, k) => {
      if (v == null) {
        if (!s.connectGaps) pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  // direct labels at last value, nudged apart
  const ends = series
    .map((s, k) => {
      let last = -1;
      s.values.forEach((v, j) => v != null && (last = j));
      return last < 0 ? null : { k, y: y(s.values[last]!), name: s.name, color: s.color };
    })
    .filter(Boolean) as { k: number; y: number; name: string; color: string }[];
  ends.sort((a, b) => a.y - b.y);
  for (let j = 1; j < ends.length; j++) if (ends[j].y - ends[j - 1].y < 13) ends[j].y = ends[j - 1].y + 13;

  return (
    <figure className="chart" aria-label={label}>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="chart-wrap">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${height}`}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          role="img"
          aria-label={label}
        >
          {yt.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={PAD.l - 6} y={y(t) + 4} className="tick" textAnchor="end">
                {t >= 1000 ? `${t / 1000}k` : t}
              </text>
            </g>
          ))}
          {xLabels(dates).map((k) => (
            <text key={k} x={x(k)} y={height - 6} className="tick" textAnchor="middle">
              {shortDate(dates[k])}
            </text>
          ))}
          {i != null && <line x1={x(i)} x2={x(i)} y1={PAD.t} y2={PAD.t + plotH} className="crosshair" />}
          {paths.map((d, k) => (
            <path key={k} d={d} fill="none" stroke={series[k].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s, k) =>
            s.values.map((v, j) =>
              v == null ? null : (
                <circle
                  key={`${k}-${j}`}
                  cx={x(j)}
                  cy={y(v)}
                  r={i === j ? 5 : n <= 31 ? 3 : 0}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )
            )
          )}
          {ends.map((e) => (
            <text key={e.k} x={W - PAD.r + 8} y={e.y + 4} className="dlabel">
              {e.name}
            </text>
          ))}
        </svg>
        {i != null && (
          <div className="tooltip" style={{ left: `${(x(i) / W) * 100}%` }}>
            <b>{prettyDate(dates[i])}</b>
            {series.map((s) => (
              <div key={s.name}>
                <i style={{ background: s.color }} />
                {s.name}
                <span>{s.values[i] == null ? "–" : `${s.values[i]}${unit}`}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

export function StepsChart({
  dates,
  steps,
  targets,
  height = 220,
}: {
  dates: string[];
  steps: (number | null)[];
  targets: number[];
  height?: number;
}) {
  const plotW = W - PAD.l - PAD.r;
  const plotH = height - PAD.t - PAD.b;
  const n = dates.length;
  const rawMax = Math.max(1000, ...steps.map((s) => s ?? 0), ...targets) * 1.1;
  const yt = ticks(rawMax);
  const max = yt[yt.length - 1];
  const slot = plotW / Math.max(1, n);
  const bw = Math.max(2, Math.min(24, slot - 2));
  const cx = (k: number) => PAD.l + slot * k + slot / 2;
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const ref = useRef<SVGSVGElement>(null);
  const [i, setI] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const xx = ((e.clientX - r.left) / r.width) * W - PAD.l;
    setI(Math.max(0, Math.min(n - 1, Math.floor(xx / slot))));
  };
  // target as a step line
  let tp = "";
  targets.forEach((t, k) => {
    const x0 = PAD.l + slot * k;
    tp += `${k ? "L" : "M"}${x0},${y(t)}L${x0 + slot},${y(t)}`;
  });

  return (
    <figure className="chart" aria-label="Daily steps against target">
      <div className="legend">
        <span>
          <i style={{ background: "var(--series-1)" }} />
          Steps
        </span>
        <span>
          <i className="dash" />
          Target
        </span>
      </div>
      <div className="chart-wrap">
        <svg ref={ref} viewBox={`0 0 ${W} ${height}`} onPointerMove={onMove} onPointerLeave={() => setI(null)} role="img" aria-label="Daily steps against target">
          {yt.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={PAD.l - 6} y={y(t) + 4} className="tick" textAnchor="end">
                {t >= 1000 ? `${t / 1000}k` : t}
              </text>
            </g>
          ))}
          {xLabels(dates).map((k) => (
            <text key={k} x={cx(k)} y={height - 6} className="tick" textAnchor="middle">
              {shortDate(dates[k])}
            </text>
          ))}
          {steps.map((s, k) => {
            if (s == null || s <= 0) return null;
            const top = y(s);
            const h = PAD.t + plotH - top;
            const r = Math.min(4, bw / 2, h);
            const x0 = cx(k) - bw / 2;
            return (
              <path
                key={k}
                d={`M${x0},${PAD.t + plotH}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${PAD.t + plotH}Z`}
                fill="var(--series-1)"
                opacity={i == null || i === k ? 1 : 0.55}
              />
            );
          })}
          <path d={tp} fill="none" stroke="var(--text-2)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={W - PAD.r + 8} y={y(targets[targets.length - 1] ?? 0) + 4} className="dlabel">
            Target
          </text>
        </svg>
        {i != null && (
          <div className="tooltip" style={{ left: `${(cx(i) / W) * 100}%` }}>
            <b>{prettyDate(dates[i])}</b>
            <div>
              Steps<span>{steps[i] == null ? "–" : steps[i]!.toLocaleString()}</span>
            </div>
            <div>
              Target<span>{targets[i].toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}

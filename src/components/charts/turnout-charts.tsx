"use client";
import { useMemo, useState } from "react";
import { ChartShell, Tooltip, TipRow, compact, niceTicks, useWidth } from "@/components/charts/kit";
import { formatHour, num } from "@/lib/format";

export type Point = { at: string; votes: number; cumulative: number };
const H = 220; const PAD = { l: 44, r: 12, t: 10, b: 28 };

function useXLabels(points: Point[], tz: string, bucket: "hour" | "day", plotW: number) {
  return useMemo(() => {
    const n = points.length; if (!n) return [];
    const maxLabels = Math.max(2, Math.floor(plotW / 120));
    const every = Math.max(1, Math.ceil(n / maxLabels));
    const out: { i: number; text: string }[] = [];
    let lastDay = "";
    for (let i = 0; i < n; i += every) {
      const d = new Date(points[i]!.at);
      const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(d);
      const text = bucket === "day" ? day : day !== lastDay || i === 0 ? formatHour(d, tz, true) : formatHour(d, tz);
      lastDay = day; out.push({ i, text });
    }
    return out;
  }, [points, tz, bucket, plotW]);
}

/** Cumulative ballots over time: one 2px line, a 10% wash beneath it, a crosshair that snaps to the nearest hour. */
export function CumulativeChart({ points, bucket, timezone, eligible }: { points: Point[]; bucket: "hour" | "day"; timezone: string; eligible?: number | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(0, width - PAD.l - PAD.r); const plotH = H - PAD.t - PAD.b;
  const total = points.at(-1)?.cumulative ?? 0;
  const yMax = Math.max(1, total, eligible && eligible < total * 4 ? eligible : 0);
  const ticks = niceTicks(yMax); const top = ticks.at(-1)!;
  const x = (i: number) => PAD.l + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;
  const labels = useXLabels(points, timezone, bucket, plotW);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(" ");
  const area = points.length ? `${path} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : "";
  const unit = bucket === "hour" ? "hour" : "day";
  const move = (clientX: number, rect: DOMRect) => {
    if (!points.length) return;
    const rel = clientX - rect.left - PAD.l; const i = Math.round((rel / Math.max(1, plotW)) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };
  const h = hover === null ? null : points[hover]!;
  return (
    <ChartShell title="Ballots over time" subtitle={`Running total of ballots cast, by ${unit}`}
      table={{ columns: [bucket === "hour" ? "Hour" : "Day", "Ballots", "Running total"], rows: points.map((p) => [formatHour(p.at, timezone, true), p.votes, p.cumulative]) }}>
      <div ref={ref} className="relative" style={{ height: H }}>
        {width > 0 && points.length > 0 && (
          <>
            <svg width={width} height={H} role="img" aria-label={`Running total of ballots, reaching ${total}`} className="block touch-pan-y"
              onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setHover(null)}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                  <text x={PAD.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-fg text-[11px] tabular-nums">{compact(t)}</text>
                </g>
              ))}
              {labels.map((l) => <text key={l.i} x={x(l.i)} y={H - 8} textAnchor={l.i === 0 ? "start" : x(l.i) > width - PAD.r - 36 ? "end" : "middle"} className="fill-muted-fg text-[11px]">{l.text}</text>)}
              <path d={area} fill="var(--chart-1)" fillOpacity={0.1} />
              <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="q-chart-mark" />
              {h && <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={y(0)} stroke="var(--chart-mute)" strokeWidth={1} />}
              {points.length > 0 && <circle cx={x(hover ?? points.length - 1)} cy={y((h ?? points.at(-1)!).cumulative)} r={5} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} />}
            </svg>
            {h && (
              <Tooltip x={x(hover!)} y={y(h.cumulative)} bounds={width}>
                <p className="mb-1 text-xs text-muted-fg">{formatHour(h.at, timezone, true)}</p>
                <TipRow value={num(h.cumulative)} label="total" />
                <p className="mt-0.5 text-xs text-muted-fg tabular-nums">+{num(h.votes)} this {unit}</p>
              </Tooltip>
            )}
          </>
        )}
      </div>
    </ChartShell>
  );
}

/** Ballots per hour (or day): thin columns on one baseline, 4px rounded tops, never wider than 24px. */
export function ActivityColumns({ points, bucket, timezone }: { points: Point[]; bucket: "hour" | "day"; timezone: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = 160; const pad = { l: 44, r: 12, t: 8, b: 26 };
  const plotW = Math.max(0, width - pad.l - pad.r); const plotH = h - pad.t - pad.b;
  const max = Math.max(1, ...points.map((p) => p.votes)); const ticks = niceTicks(max, 3); const top = ticks.at(-1)!;
  const slot = points.length ? plotW / points.length : 0; const bw = Math.min(24, Math.max(2, slot - 2));
  const labels = useXLabels(points, timezone, bucket, plotW);
  const unit = bucket === "hour" ? "hour" : "day";
  const p = hover === null ? null : points[hover]!;
  return (
    <ChartShell title={`Ballots per ${unit}`} subtitle="When people voted" table={{ columns: [bucket === "hour" ? "Hour" : "Day", "Ballots"], rows: points.map((q) => [formatHour(q.at, timezone, true), q.votes]) }}>
      <div ref={ref} className="relative" style={{ height: h }}>
        {width > 0 && points.length > 0 && (
          <>
            <svg width={width} height={h} role="img" aria-label={`Ballots per ${unit}`} className="block" onPointerLeave={() => setHover(null)}>
              {ticks.map((t) => {
                const yy = pad.t + plotH - (t / top) * plotH;
                return (<g key={t}><line x1={pad.l} x2={width - pad.r} y1={yy} y2={yy} stroke="var(--chart-grid)" strokeWidth={1} /><text x={pad.l - 8} y={yy} textAnchor="end" dominantBaseline="middle" className="fill-muted-fg text-[11px] tabular-nums">{compact(t)}</text></g>);
              })}
              {points.map((q, i) => {
                const bh = (q.votes / top) * plotH; const cx = pad.l + slot * i + slot / 2;
                return (
                  <g key={q.at} onPointerMove={() => setHover(i)}>
                    <rect x={pad.l + slot * i} y={pad.t} width={slot} height={plotH} fill="transparent" tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${formatHour(q.at, timezone, true)}: ${q.votes} ballots`} />
                    {q.votes > 0 && <path d={`M${cx - bw / 2},${pad.t + plotH} V${pad.t + plotH - bh + Math.min(4, bh)} q0,${-Math.min(4, bh)} ${Math.min(4, bw / 2)},${-Math.min(4, bh)} h${Math.max(0, bw - 2 * Math.min(4, bw / 2))} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, bh)} V${pad.t + plotH} Z`} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.55} className="q-chart-mark" />}
                  </g>
                );
              })}
              <line x1={pad.l} x2={width - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} stroke="var(--chart-mute)" strokeWidth={1} />
              {labels.map((l) => <text key={l.i} x={pad.l + slot * l.i + slot / 2} y={h - 8} textAnchor={l.i === 0 ? "start" : pad.l + slot * l.i + slot / 2 > width - pad.r - 36 ? "end" : "middle"} className="fill-muted-fg text-[11px]">{l.text}</text>)}
            </svg>
            {p && <Tooltip x={pad.l + slot * hover! + slot / 2} y={pad.t + plotH - (p.votes / top) * plotH} bounds={width}><p className="mb-1 text-xs text-muted-fg">{formatHour(p.at, timezone, true)}</p><TipRow value={num(p.votes)} label={p.votes === 1 ? "ballot" : "ballots"} /></Tooltip>}
          </>
        )}
      </div>
    </ChartShell>
  );
}

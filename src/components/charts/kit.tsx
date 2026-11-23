"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Table2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Shared chart pieces. Every chart ships with: a title that names what's plotted, hover + keyboard
 * tooltips that never gate information, and a table view with the same numbers (accessibility, and the
 * home for anything a label couldn't fit).
 */

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el); setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export type TableData = { columns: string[]; rows: (string | number)[][] };

export function ChartShell({ title, subtitle, table, children, legend, className, actions }: { title: string; subtitle?: string; table: TableData; children: ReactNode; legend?: ReactNode; className?: string; actions?: ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <figure className={cn("rounded-lg border border-border bg-card p-5", className)}>
      <figcaption className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-6 tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-muted-fg">{subtitle}</p>}
        </div>
        <div className="q-noprint flex shrink-0 items-center gap-1">
          {actions}
          <button type="button" onClick={() => setView(view === "chart" ? "table" : "chart")} aria-pressed={view === "table"}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-fg transition-colors hover:bg-muted hover:text-fg">
            {view === "chart" ? <><Table2 className="size-3.5" />Table</> : <><BarChart3 className="size-3.5" />Chart</>}
          </button>
        </div>
      </figcaption>
      {legend && view === "chart" && <div className="mt-3">{legend}</div>}
      <div className="mt-4">
        {view === "chart" ? children : (
          <div className="max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 bg-muted text-left text-muted-fg"><tr>{table.columns.map((c) => <th key={c} scope="col" className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={cn("px-3 py-2", j === 0 && "font-medium")}>{v}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </figure>
  );
}

/** Clean axis ticks: 0..max in 4–5 round steps. */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  // Everything charted here is a count of people or ballots, so ticks are whole numbers (never 0.5 or 1.5).
  const rough = Math.max(1, max / target);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough && Number.isInteger(s)) ?? Math.ceil(rough);
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) { out.push(Math.round(v * 1e6) / 1e6); if (v >= max) break; }
  return out;
}
export const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n.toLocaleString("en-GB"));

export function Tooltip({ x, y, children, bounds }: { x: number; y: number; children: ReactNode; bounds: number }) {
  const flip = x > bounds * 0.6;
  return (
    <div role="tooltip" className="q-fade pointer-events-none absolute z-10 min-w-28 rounded-md border border-border bg-card px-2.5 py-2 text-sm shadow-lg" style={{ left: flip ? undefined : x + 12, right: flip ? bounds - x + 12 : undefined, top: Math.max(0, y - 8) }}>
      {children}
    </div>
  );
}
export const TipRow = ({ value, label }: { value: ReactNode; label: ReactNode }) => (
  <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--chart-1)" }} aria-hidden /><span className="font-semibold tabular-nums">{value}</span><span className="text-muted-fg">{label}</span></div>
);

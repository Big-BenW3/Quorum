"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ChartShell } from "@/components/charts/kit";
import { pct } from "@/lib/format";

export type BarItem = { id: string; label: string; value: number; share: number; state?: "winner" | "tied" | "none" };

/**
 * One series, ranked. Emphasis, not categorical colour: winners (or tied candidates) take the accent,
 * everyone else is neutral grey. Bars are capped at 20px with a 4px rounded tip, flush at the baseline.
 * The value sits at the bar tip, outside the mark, so labels never clip.
 */
export function RankedBars({ title, subtitle, items, ballots, abstentions, seats }: { title: string; subtitle?: string; items: BarItem[]; ballots: number; abstentions?: number; seats?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value), abstentions ?? 0);
  const [active, setActive] = useState<string | null>(null);
  const rows = [...items.map((i) => ({ ...i, kind: "candidate" as const })), ...(abstentions !== undefined ? [{ id: "__abstain", label: "Abstained", value: abstentions, share: ballots ? abstentions / ballots : 0, state: "none" as const, kind: "abstain" as const }] : [])];
  return (
    <ChartShell
      title={title} subtitle={subtitle}
      table={{ columns: ["Choice", "Votes", "Share of ballots", "Outcome"], rows: rows.map((r) => [r.label, r.value, pct(r.share, 1), r.state === "winner" ? "Elected" : r.state === "tied" ? "Tied" : ""]) }}
      legend={<p className="text-sm text-muted-fg">{seats && seats > 1 ? `${seats} seats. ` : ""}Share is of all ballots cast ({ballots.toLocaleString("en-GB")}).</p>}
    >
      <ul className="space-y-3" aria-label={title}>
        {rows.map((r) => {
          const on = active === r.id;
          const color = r.kind === "abstain" ? "var(--chart-mute)" : r.state === "winner" || r.state === "tied" ? "var(--chart-1)" : "var(--chart-mute)";
          return (
            <li key={r.id} className="group" onPointerEnter={() => setActive(r.id)} onPointerLeave={() => setActive(null)}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className={cn("min-w-0 truncate", r.kind === "abstain" ? "text-muted-fg" : "font-medium")}>
                  {r.label}
                  {r.state === "winner" && <span className="ml-2 text-xs font-normal text-muted-fg">Elected</span>}
                  {r.state === "tied" && <span className="ml-2 text-xs font-normal text-warn">Tied</span>}
                </span>
                <span className="shrink-0 tabular-nums"><span className="font-semibold">{r.value.toLocaleString("en-GB")}</span> <span className="text-muted-fg">{pct(r.share, 1)}</span></span>
              </div>
              <div tabIndex={0} role="img" aria-label={`${r.label}: ${r.value} votes, ${pct(r.share, 1)} of ballots`} onFocus={() => setActive(r.id)} onBlur={() => setActive(null)} className="h-5 rounded-[4px] bg-muted/70">
                <div className="q-bar h-5 rounded-r-[4px] transition-[filter] duration-150" style={{ width: `${Math.max(r.value ? 0.8 : 0, (r.value / max) * 100)}%`, background: color, filter: on ? "brightness(1.08)" : undefined }} />
              </div>
            </li>
          );
        })}
      </ul>
    </ChartShell>
  );
}

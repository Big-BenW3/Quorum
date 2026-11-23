"use client";
import { ChartShell } from "@/components/charts/kit";
import { num, pct } from "@/lib/format";

/** Funnel: three ordered stages, one hue stepped light → dark (validated ordinal ramp), values at the bar tip. */
export function Funnel({ eligible, verified, voted }: { eligible: number; verified: number; voted: number }) {
  const stages = [
    { label: "On the voter list", value: eligible, color: "var(--stage-1)", note: "" },
    { label: "Verified their identity", value: verified, color: "var(--stage-2)", note: eligible ? `${pct(verified / eligible)} of the list` : "" },
    { label: "Submitted a ballot", value: voted, color: "var(--stage-3)", note: eligible ? `${pct(voted / eligible)} of the list` : "" },
  ];
  const dropped = Math.max(0, verified - voted);
  return (
    <ChartShell title="From voter list to ballot" subtitle="Where people dropped off" table={{ columns: ["Stage", "People", "Share of list"], rows: stages.map((s) => [s.label, s.value, eligible ? pct(s.value / eligible, 1) : "–"]) }}
      legend={dropped > 0 ? <p className="text-sm text-muted-fg">{num(dropped)} {dropped === 1 ? "person verified" : "people verified"} but didn&apos;t finish voting.</p> : undefined}>
      <ul className="space-y-3.5">
        {stages.map((s) => (
          <li key={s.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums"><span className="font-semibold">{num(s.value)}</span>{s.note && <span className="ml-2 text-muted-fg">{s.note}</span>}</span>
            </div>
            <div className="h-5 rounded-[4px] bg-muted/70" role="img" aria-label={`${s.label}: ${s.value}`}>
              <div className="q-bar h-5 rounded-r-[4px]" style={{ width: `${eligible ? Math.max(s.value ? 0.8 : 0, (s.value / eligible) * 100) : 0}%`, background: s.color }} />
            </div>
          </li>
        ))}
      </ul>
    </ChartShell>
  );
}

/** Several ratios, one per named row, each against its own whole → meter list (bar in a same-hue track). */
export function MeterList({ title, subtitle, rows, note }: { title: string; subtitle?: string; rows: { label: string; value: number; of: number }[]; note?: string }) {
  return (
    <ChartShell title={title} subtitle={subtitle} table={{ columns: ["Group", "Voted", "On the list", "Turnout"], rows: rows.map((r) => [r.label, r.value, r.of, r.of ? pct(r.value / r.of, 1) : "–"]) }} legend={note ? <p className="text-sm text-muted-fg">{note}</p> : undefined}>
      <ul className="space-y-3.5">
        {rows.map((r) => {
          const rate = r.of ? r.value / r.of : 0;
          return (
            <li key={r.label}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{r.label}</span>
                <span className="shrink-0 tabular-nums"><span className="font-semibold">{pct(rate)}</span> <span className="text-muted-fg">{num(r.value)} of {num(r.of)}</span></span>
              </div>
              <div className="h-2 rounded-full" style={{ background: "var(--chart-track)" }} role="img" aria-label={`${r.label}: ${pct(rate)} turnout`}>
                <div className="q-bar h-2 rounded-full" style={{ width: `${Math.max(rate ? 1 : 0, rate * 100)}%`, background: "var(--chart-1)" }} />
              </div>
            </li>
          );
        })}
      </ul>
    </ChartShell>
  );
}

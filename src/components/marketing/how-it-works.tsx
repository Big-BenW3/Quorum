"use client";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

const steps = [
  {
    id: "ballot", title: "Build the ballot",
    body: "Add positions and candidates, choose how many people a voter may pick, and whether abstaining is allowed. The ballot locks the moment voting is scheduled to begin.",
    panel: (
      <ul className="space-y-2 text-sm">
        {[["President", "3 candidates · choose 1"], ["Committee", "6 candidates · choose up to 3"], ["Constitution change", "Yes / No"]].map(([a, b]) => (
          <li key={a} className="flex items-center justify-between rounded-lg border border-border bg-card px-3.5 py-3"><span className="font-medium">{a}</span><span className="text-muted-fg">{b}</span></li>
        ))}
      </ul>
    ),
  },
  {
    id: "voters", title: "Import your voters",
    body: "Upload a CSV, or a PDF, Word file or photo if a document reader is set up. You review every row, fix mistakes, and decide on look-alike entries before anything is saved. The list freezes 24 hours before voting starts.",
    panel: (
      <div className="overflow-hidden rounded-lg border border-border bg-card text-sm">
        {[["maya@club.org", "Ready", "good"], ["maya@club.org", "Duplicate, skipped", "neutral"], ["j.lee@", "Needs a valid email", "danger"]].map(([a, b, t]) => (
          <div key={a + b} className="flex items-center justify-between border-b border-border px-3.5 py-2.5 last:border-0"><span className="font-mono text-[13px]">{a}</span><span className={t === "good" ? "text-good" : t === "danger" ? "text-danger" : "text-muted-fg"}>{b}</span></div>
        ))}
      </div>
    ),
  },
  {
    id: "vote", title: "Open voting",
    body: "Share one link. Voters prove they&apos;re on the list, get a single-use pass, and cast one ballot. You watch turnout, never choices, and can extend the deadline if you need to.",
    panel: (
      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        <div className="flex items-baseline justify-between"><span className="text-muted-fg">Turnout so far</span><span className="font-semibold">Live, admins only</span></div>
        <div className="mt-3 h-2 rounded-full" style={{ background: "var(--chart-track)" }}><div className="h-2 w-2/3 rounded-full" style={{ background: "var(--chart-1)" }} /></div>
        <p className="mt-3 text-muted-fg">Who has voted is visible. What they chose is not stored against their name.</p>
      </div>
    ),
  },
  {
    id: "results", title: "Share the results",
    body: "Results stay hidden until you choose: live, after the vote closes, or when you publish. Once voting ends you also get turnout over time, participation by group, margins and abstentions, with a CSV or JSON report.",
    panel: (
      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        {[["Amara Okafor", 62, true], ["Daniel Reyes", 41, false], ["Priya Nair", 27, false]].map(([n, v, w]) => (
          <div key={String(n)} className="mb-3 last:mb-0">
            <div className="mb-1 flex justify-between"><span className="font-medium">{n}</span><span className="tabular-nums text-muted-fg">{v}</span></div>
            <div className="h-4 rounded-[4px] bg-muted"><div className="h-4 rounded-r-[4px]" style={{ width: `${(Number(v) / 62) * 100}%`, background: w ? "var(--chart-1)" : "var(--chart-mute)" }} /></div>
          </div>
        ))}
        <p className="mt-3 text-xs text-muted-fg">Illustration only.</p>
      </div>
    ),
  },
];

/** Click or arrow-key driven. Nothing here reacts to scrolling. */
export function HowItWorks() {
  const [i, setI] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const n = e.key === "ArrowDown" || e.key === "ArrowRight" ? (i + 1) % steps.length : e.key === "ArrowUp" || e.key === "ArrowLeft" ? (i + steps.length - 1) % steps.length : null;
    if (n === null) return;
    e.preventDefault(); setI(n); refs.current[n]?.focus();
  };
  const s = steps[i]!;
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
      <div role="tablist" aria-orientation="vertical" aria-label="Steps" onKeyDown={onKey} className="divide-y divide-border border-y border-border">
        {steps.map((st, idx) => (
          <button key={st.id} ref={(el) => { refs.current[idx] = el; }} role="tab" id={`${base}-t-${idx}`} aria-selected={i === idx} aria-controls={`${base}-p`} tabIndex={i === idx ? 0 : -1} onClick={() => setI(idx)}
            className={cn("group flex w-full gap-4 px-1 py-5 text-left transition-colors", i === idx ? "text-fg" : "text-muted-fg hover:text-fg")}>
            <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums transition-colors", i === idx ? "border-fg bg-fg text-bg" : "border-input")}>{idx + 1}</span>
            <span className="min-w-0">
              <span className="block text-[17px] font-medium tracking-tight">{st.title}</span>
              {i === idx && <span className="q-fade mt-1.5 block max-w-md text-[15px] leading-6 text-muted-fg">{st.body}</span>}
            </span>
          </button>
        ))}
      </div>
      <div id={`${base}-p`} role="tabpanel" aria-labelledby={`${base}-t-${i}`} className="self-start rounded-xl border border-border bg-muted/50 p-5 sm:p-7">
        <div key={s.id} className="q-fade">{s.panel}</div>
      </div>
    </div>
  );
}

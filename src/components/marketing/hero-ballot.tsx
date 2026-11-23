/** A sample ballot, drawn in markup. It is labelled as a sample and carries no numbers. */
export function HeroBallot() {
  const rows = [
    { name: "Amara Okafor", note: "Treasurer, 2 terms", on: true },
    { name: "Daniel Reyes", note: "Member since 2021", on: false },
    { name: "Priya Nair", note: "Chair of events", on: false },
  ];
  return (
    <div className="q-rise relative mx-auto w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-[0_1px_0_0_var(--border)]" style={{ animationDelay: ".1s" }} aria-label="Sample ballot">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Club president</p>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-fg">Sample ballot</span>
      </div>
      <p className="mt-1 text-sm text-muted-fg">Choose one candidate, or abstain.</p>
      <ul className="mt-5 space-y-2.5">
        {rows.map((r) => (
          <li key={r.name} className={`flex items-center gap-3 rounded-lg border p-3.5 ${r.on ? "border-fg" : "border-border"}`}>
            <span className={`grid size-5 shrink-0 place-items-center rounded-full border ${r.on ? "border-fg bg-fg" : "border-input"}`}>
              {r.on && <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="var(--bg)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path className="q-check" d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-medium leading-5">{r.name}</span>
              <span className="block text-sm text-muted-fg">{r.note}</span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3.5 text-sm text-muted-fg">
          <span className="size-5 shrink-0 rounded-full border border-input" />Abstain
        </li>
      </ul>
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
        <span className="text-muted-fg">Your ballot isn&apos;t linked to your name.</span>
        <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg">Review</span>
      </div>
    </div>
  );
}

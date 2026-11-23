"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";
import type { Turnout } from "@/server/domain/turnout";
import { CumulativeChart } from "@/components/charts/turnout-charts";
import { Button } from "@/components/ui/button";
import { Badge, Notice, Spinner, type Tone } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { num, pct } from "@/lib/format";

type Roll = { restricted: boolean; total: number; page: number; pageSize: number; rows: { id: string; label: string; group: string | null; state: "NOT_VOTED" | "VERIFIED" | "VOTED" }[] };
const STATE: Record<string, { label: string; tone: Tone }> = { VOTED: { label: "Voted", tone: "good" }, VERIFIED: { label: "Verified, not finished", tone: "warn" }, NOT_VOTED: { label: "Not yet voted", tone: "neutral" } };

export function TurnoutBoard({ electionId, initial, timezone }: { electionId: string; initial: Turnout; timezone: string }) {
  const live = initial.status === "OPEN";
  const { data, error, refresh } = usePolling<Turnout>(live ? `/api/elections/${electionId}/turnout` : null, { intervalMs: 15_000, initial });
  const t = data ?? initial;
  const [spin, setSpin] = useState(false);
  const asOf = new Date(t.asOf).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="space-y-8">
      <div className={cn("grid gap-3 sm:grid-cols-2", t.restricted ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        <Tile label={t.restricted ? "Turnout" : "Ballots cast"} value={t.restricted && t.rate !== null ? pct(t.rate, t.rate < 0.1 ? 1 : 0) : num(t.ballots)} hint={t.restricted ? `${num(t.ballots)} of ${num(t.eligible)}` : undefined} />
        {t.restricted && <Tile label="Still to vote" value={num(t.pending)} />}
        {t.restricted && <Tile label="Verified, not finished" value={num(Math.max(0, (t.verified ?? 0) - t.ballots))} hint="Started but haven’t submitted" />}
        {!t.restricted && <Tile label="Voting" value={live ? "Open" : "Closed"} />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-fg">
        <p>{live ? <>Updates every 15 seconds. Last updated {asOf}.</> : <>Voting has ended. Final figures as of {asOf}.</>}</p>
        {live && <Button variant="ghost" size="sm" onClick={async () => { setSpin(true); await refresh(); setSpin(false); }}><RefreshCw className={cn("size-3.5", spin && "animate-spin")} />Refresh</Button>}
      </div>
      {error && <Notice tone="warn">We couldn’t refresh just now, so these figures may be a little behind. We’ll keep trying.</Notice>}

      {t.series.points.length > 0 ? <CumulativeChart points={t.series.points} bucket={t.series.bucket} timezone={timezone} eligible={t.eligible} /> : <Notice tone="info">No one has voted yet. The chart starts once the first ballot is in.</Notice>}

      {t.restricted ? <RollCall electionId={electionId} /> : <p className="text-sm text-muted-fg">This election is open to anyone with the link, so there is no voter list to check people off against.</p>}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-lg border border-border bg-card p-5"><p className="text-sm text-muted-fg">{label}</p><p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>{hint && <p className="mt-1 text-sm text-muted-fg">{hint}</p>}</div>;
}

function RollCall({ electionId }: { electionId: string }) {
  const [state, setState] = useState<string>("");
  const [q, setQ] = useState(""); const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Roll | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => { setTerm(q); setPage(1); }, 300); return () => clearTimeout(h); }, [q]);
  useEffect(() => {
    let live = true;
    api<Roll>("GET", `/api/elections/${electionId}/roll-call?page=${page}${state ? `&state=${state}` : ""}${term ? `&q=${encodeURIComponent(term)}` : ""}`)
      .then((r) => { if (live) { setData(r); setErr(null); } }).catch((e) => { if (live) setErr(errorMessage(e)); });
    return () => { live = false; };
  }, [electionId, page, state, term]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section aria-labelledby="roll-h" className="space-y-4">
      <div><h2 id="roll-h" className="text-lg font-semibold tracking-tight">Roll call</h2><p className="mt-1 max-w-prose text-sm text-muted-fg">Who has voted, like a paper attendance register. It never shows what anyone chose, or when they voted.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or group" aria-label="Search the roll call" className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm sm:max-w-xs" />
        <div className="flex gap-1.5" role="group" aria-label="Filter by status">
          {[["", "Everyone"], ["NOT_VOTED", "Not yet voted"], ["VOTED", "Voted"]].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={state === v} onClick={() => { setState(v!); setPage(1); }} className={cn("rounded-full border px-3 py-1 text-sm transition-colors", state === v ? "border-fg bg-fg text-bg" : "border-border bg-card text-muted-fg hover:text-fg")}>{l}</button>
          ))}
        </div>
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-muted-fg"><tr><th scope="col" className="px-5 py-2.5 font-medium">Voter</th><th scope="col" className="hidden px-5 py-2.5 font-medium sm:table-cell">Group</th><th scope="col" className="px-5 py-2.5 font-medium">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {data?.rows.map((r) => <tr key={r.id}><td className="px-5 py-3 font-medium">{r.label}</td><td className="hidden px-5 py-3 text-muted-fg sm:table-cell">{r.group ?? "–"}</td><td className="px-5 py-3"><Badge tone={STATE[r.state]!.tone}>{STATE[r.state]!.label}</Badge></td></tr>)}
            {data && data.rows.length === 0 && <tr><td colSpan={3} className="px-5 py-10 text-center text-muted-fg">No one matches.</td></tr>}
            {!data && <tr><td colSpan={3} className="px-5 py-10 text-center"><Spinner className="mx-auto size-5" /></td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && <div className="flex items-center justify-between text-sm"><span className="text-muted-fg">Page {page} of {pages}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
    </section>
  );
}

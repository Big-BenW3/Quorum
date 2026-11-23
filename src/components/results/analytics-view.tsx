import type { AnalyticsPayload } from "@/server/domain/results";
import { ActivityColumns, CumulativeChart } from "@/components/charts/turnout-charts";
import { Funnel, MeterList } from "@/components/charts/participation";
import { Card, CardBody, Notice } from "@/components/ui/misc";
import { duration, formatHour, num, pct, plural } from "@/lib/format";

export function AnalyticsView({ payload }: { payload: AnalyticsPayload }) {
  const { analytics: a, election } = payload;
  const tz = election.timezone;
  const s = a.summary;
  const rate = s.turnoutRate;
  // Without a voter list the headline card already shows ballots cast, so don't repeat it as a tile.
  const tiles = [
    ...(rate !== null ? [{ label: "Ballots cast", value: num(s.ballots) }] : []),
    ...(s.eligible !== null ? [{ label: "On the voter list", value: num(s.eligible) }] : []),
    { label: "Voting stayed open", value: s.durationHours === null ? "–" : duration(s.durationHours * 3_600_000) },
    { label: "Busiest hour", value: s.peak ? formatHour(s.peak.at, tz, true) : "–", hint: s.peak ? plural(s.peak.votes, "ballot") : undefined },
    { label: "Half had voted by", value: s.medianHour ? formatHour(s.medianHour, tz, true) : "–" },
  ];
  const hasSeries = a.series.points.some((p) => p.votes > 0);

  return (
    <div className="space-y-6">
      <Card><CardBody className="grid gap-6 sm:grid-cols-[minmax(0,260px)_1fr] sm:items-center">
        <div>
          <p className="text-sm text-muted-fg">{rate !== null ? "Turnout" : "Ballots cast"}</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">{rate !== null ? pct(rate, rate < 0.1 ? 1 : 0) : num(s.ballots)}</p>
          <p className="mt-2 text-sm text-muted-fg">{rate !== null && s.eligible !== null ? `${num(s.ballots)} of ${num(s.eligible)} people on the voter list voted.` : "Open access has no voter list, so there is no turnout rate."}</p>
        </div>
        {rate !== null && (
          <div role="img" aria-label={`Turnout ${pct(rate)}`} className="h-3 rounded-full" style={{ background: "var(--chart-track)" }}><div className="q-bar h-3 rounded-full" style={{ width: `${Math.max(rate ? 1 : 0, rate * 100)}%`, background: "var(--chart-1)" }} /></div>
        )}
      </CardBody></Card>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-border bg-card p-4"><dt className="text-sm text-muted-fg">{t.label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums tracking-tight">{t.value}</dd>{t.hint && <p className="text-sm text-muted-fg">{t.hint}</p>}</div>
        ))}
      </dl>

      {hasSeries ? (
        <>
          <CumulativeChart points={a.series.points} bucket={a.series.bucket} timezone={tz} eligible={s.eligible} />
          <ActivityColumns points={a.series.points} bucket={a.series.bucket} timezone={tz} />
        </>
      ) : <Notice tone="info">No ballots were cast, so there’s no timeline to draw.</Notice>}

      <div className="grid gap-6 lg:grid-cols-2">
        {a.funnel && <Funnel eligible={a.funnel.eligible} verified={a.funnel.verified} voted={a.funnel.voted} />}
        {a.groups && a.groups.rows.length > 0 && (
          <MeterList title="Turnout by group" subtitle="Share of each group that voted" rows={a.groups.rows.map((g) => ({ label: g.group, value: g.voted, of: g.eligible }))}
            note={a.groups.combinedGroups > 0 || a.groups.hiddenVoters > 0 ? `Groups with fewer than ${a.groups.minGroupSize} voters are combined or left out so individuals are harder to pick out.` : undefined} />
        )}
      </div>

      <section aria-labelledby="pos-h" className="rounded-lg border border-border bg-card">
        <div className="p-5 pb-0"><h3 id="pos-h" className="text-[15px] font-semibold tracking-tight">Margins and abstentions</h3><p className="mt-0.5 text-sm text-muted-fg">How close each position was, and how many ballots skipped it.</p></div>
        <div className="p-5">
          <div className="hidden grid-cols-[1.1fr_0.7fr_2fr_0.8fr] gap-x-6 border-b border-border pb-2 text-sm text-muted-fg sm:grid"><span>Position</span><span>Outcome</span><span>Margin</span><span className="text-right">Abstained</span></div>
          <ul className="divide-y divide-border">
            {a.positions.map((p) => (
              <li key={p.id} className="grid gap-1 py-3.5 text-sm sm:grid-cols-[1.1fr_0.7fr_2fr_0.8fr] sm:gap-x-6">
                <p className="font-medium">{p.title}</p>
                <p className="text-muted-fg sm:text-fg">{p.outcome === "decided" ? "Decided" : p.outcome === "tie" ? "Tie" : "No votes"}</p>
                <p className="tabular-nums">{p.margin ? <>{plural(p.margin.votes, "vote")} <span className="text-muted-fg">({pct(p.margin.shareOfBallots, 1)} of ballots){p.margin.runnerUp ? `, ${p.margin.leader} over ${p.margin.runnerUp}` : `, ${p.margin.leader} unopposed`}</span></> : <span className="text-muted-fg">–</span>}</p>
                <p className="tabular-nums sm:text-right"><span className="text-muted-fg sm:hidden">Abstained: </span>{num(p.abstentions)} <span className="text-muted-fg">({pct(p.abstentionRate, 1)})</span></p>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <p className="max-w-prose text-sm leading-6 text-muted-fg">Timing is rounded to the hour and never linked to a person’s choices. These figures are a software tally, not a certified result.</p>
    </div>
  );
}

import type { ResultsPayload } from "@/server/domain/results";
import { RankedBars, type BarItem } from "@/components/charts/ranked-bars";
import { Notice } from "@/components/ui/misc";
import { plural } from "@/lib/format";

type Position = ResultsPayload["tally"]["positions"][number];

export function outcomeText(p: Position, tieRule: "REPORT_TIE" | "REQUIRE_RUNOFF"): string {
  const name = (id: string) => p.candidates.find((c) => c.id === id)?.name ?? "Unknown";
  const o = p.outcome;
  if (o.status === "no_votes") return "No votes recorded";
  const elected = o.winners.length ? `Elected: ${o.winners.map(name).join(", ")}` : "";
  if (o.status === "decided") return [elected, o.seatsOpen > 0 ? `${plural(o.seatsOpen, "seat")} unfilled` : ""].filter(Boolean).join(". ");
  const tie = `Tie between ${o.tied.map(name).join(" and ")} for ${o.seatsOpen === 1 ? "the last seat" : `${o.seatsOpen} seats`}${tieRule === "REQUIRE_RUNOFF" ? ". A runoff is required" : ""}`;
  return [elected, tie].filter(Boolean).join(". ");
}

export function ResultsView({ payload }: { payload: ResultsPayload }) {
  const { tally, election } = payload;
  return (
    <div className="space-y-6">
      {election.status === "OPEN" && <Notice tone="warn" title="Live totals">Voting is still open, so these numbers will change until it closes.</Notice>}
      <p className="text-sm text-muted-fg"><span className="font-medium text-fg">{plural(tally.ballots, "ballot")}</span> cast.</p>
      {tally.positions.map((p) => {
        const won = new Set(p.outcome.winners as string[]); const tied = new Set(p.outcome.tied as string[]);
        const items: BarItem[] = [...p.candidates].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name))
          .map((c) => ({ id: c.id, label: c.name, value: c.votes, share: c.shareOfBallots, state: won.has(c.id) ? "winner" : tied.has(c.id) ? "tied" : "none" }));
        return <RankedBars key={p.id} title={p.title} subtitle={outcomeText(p, election.tieRule)} items={items} ballots={p.ballots} abstentions={p.abstentions > 0 ? p.abstentions : undefined} seats={p.seats} />;
      })}
      <p className="max-w-prose text-sm leading-6 text-muted-fg">Counted by plurality: each choice a voter selects is one vote, and the candidates with the most votes fill the seats. Ties are reported, never broken silently. This is a software tally, not a certified result.</p>
    </div>
  );
}

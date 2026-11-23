import "server-only";
import { db } from "@/server/db";
import { open } from "@/server/crypto/keys";
import { now } from "@/server/clock";
import { loadElection, type Actor } from "@/server/domain/election";
import { buildSeries, hourlyVotes } from "@/server/domain/results";

/**
 * Turnout is about PARTICIPATION, never about choices. Administrators can see how many people have
 * voted and (in restricted elections) which roster entries have or haven't, exactly like a paper
 * attendance register. They cannot see what anyone chose, and nothing here touches ballots except
 * for one aggregate count.
 *
 * This is available while voting is open regardless of the results-disclosure setting, because the
 * organizer needs it to chase turnout. Tallies are a separate, gated surface (results.ts).
 */

export type Turnout = Awaited<ReturnType<typeof getTurnout>>;

export async function getTurnout(actor: Actor, electionId: string) {
  const { election: e } = await loadElection(actor, electionId);
  const restricted = e.eligibilityMode === "RESTRICTED";
  const [ballots, eligible, verified, hours] = await Promise.all([
    db.ballot.count({ where: { electionId } }),
    restricted ? db.eligibleVoter.count({ where: { electionId } }) : Promise.resolve(null),
    restricted ? db.attendance.count({ where: { electionId } }) : Promise.resolve(null),
    hourlyVotes(e),
  ]);
  return {
    status: e.status,
    restricted,
    ballots,
    eligible,
    verified,
    pending: eligible === null ? null : Math.max(0, eligible - ballots),
    rate: eligible ? ballots / eligible : null,
    series: buildSeries(hours, e.openedAt ?? e.startsAt, e.status === "OPEN" ? now() : e.closedAt ?? e.endsAt),
    asOf: now(),
  };
}

export type RollState = "NOT_VOTED" | "VERIFIED" | "VOTED";

export async function rollCall(actor: Actor, electionId: string, opts: { page: number; q?: string; state?: RollState }) {
  const { election: e } = await loadElection(actor, electionId);
  const pageSize = 50;
  if (e.eligibilityMode !== "RESTRICTED") return { restricted: false as const, total: 0, page: opts.page, pageSize, rows: [] };
  const voters = await db.eligibleVoter.findMany({ where: { electionId }, select: { id: true, labelSealed: true, groupLabel: true, attendance: { select: { state: true } } } });
  const q = opts.q?.trim().toLowerCase();
  let rows = voters.map((v) => ({
    id: v.id,
    label: open(v.labelSealed, `voter-label:${electionId}`),
    group: v.groupLabel,
    // Deliberately no per-voter timestamps: the register says whether, not when.
    state: (v.attendance ? (v.attendance.state === "VOTED" ? "VOTED" : "VERIFIED") : "NOT_VOTED") as RollState,
  }));
  if (opts.state) rows = rows.filter((r) => r.state === opts.state);
  if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q) || (r.group ?? "").toLowerCase().includes(q));
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return { restricted: true as const, total: rows.length, page: opts.page, pageSize, rows: rows.slice((opts.page - 1) * pageSize, opts.page * pageSize) };
}

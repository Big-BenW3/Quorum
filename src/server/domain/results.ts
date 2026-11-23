import "server-only";
import type { Election } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { now } from "@/server/clock";
import { AppError, notFound } from "@/server/errors";
import { findByResultsSlug, loadElection, type Actor } from "@/server/domain/election";
import { getBallot } from "@/server/domain/ballot-config";
import { analyticsVisible, decide, resultsVisible, whyHidden, type Audience, type PositionOutcome } from "@/server/domain/rules";

/**
 * Tallies and post-election analytics.
 *
 * Everything here sits behind ONE gate (`resultsVisible` / `analyticsVisible` in rules.ts), evaluated on
 * the server for every request. Hidden results are never computed, never sent to the browser and never
 * included in realtime events — the UI cannot "just not show" something it was never given.
 *
 * Counting method: plurality, with ties reported rather than broken (see `decide`).
 *
 * Analytics are derived from data the app already holds without weakening ballot privacy:
 *   - turnout over time comes from hour-truncated attendance / credential times, never from ballots
 *     (ballots carry no timestamp at all);
 *   - group turnout counts who voted per roster group, never what they chose;
 *   - margins and abstention rates come from the same aggregate tallies the results page shows.
 */

export const GROUP_MIN = 5; // groups smaller than this are combined in group turnout

type Meta = { title: string; status: Election["status"]; resultsDisclosure: Election["resultsDisclosure"]; startsAt: Date | null; endsAt: Date | null; closedAt: Date | null; publishedAt: Date | null; timezone: string; tieRule: Election["tieRule"] };
const metaOf = (e: Election): Meta => ({ title: e.title, status: e.status, resultsDisclosure: e.resultsDisclosure, startsAt: e.startsAt, endsAt: e.endsAt, closedAt: e.closedAt, publishedAt: e.publishedAt, timezone: e.timezone, tieRule: e.tieRule });

export type Hidden = { available: false; reason: ReturnType<typeof whyHidden>; election: Meta };

// ───────────────────────── tallies ─────────────────────────

export type CandidateResult = { id: string; name: string; votes: number; shareOfBallots: number };
export type PositionResult = {
  id: string;
  title: string;
  seats: number;
  maxSelections: number;
  ballots: number;
  abstentions: number;
  candidates: CandidateResult[];
  outcome: PositionOutcome;
  margin: { votes: number; shareOfBallots: number; leader: string; runnerUp: string | null } | null;
};
export type Tally = { ballots: number; positions: PositionResult[] };

export async function computeTally(electionId: string): Promise<Tally> {
  const [positions, rows, ballots] = await Promise.all([
    getBallot(electionId),
    db.ballotSelection.groupBy({ by: ["positionId", "candidateId"], where: { ballot: { electionId } }, _count: { _all: true } }),
    db.ballot.count({ where: { electionId } }),
  ]);
  const count = new Map<string, number>();
  const abstain = new Map<string, number>();
  for (const r of rows) {
    if (r.candidateId === null) abstain.set(r.positionId, (abstain.get(r.positionId) ?? 0) + r._count._all);
    else count.set(`${r.positionId}:${r.candidateId}`, r._count._all);
  }
  const share = (n: number) => (ballots ? n / ballots : 0);
  return {
    ballots,
    positions: positions.map((p) => {
      const candidates = p.candidates
        .map((c) => ({ id: c.id, name: c.name, votes: count.get(`${p.id}:${c.id}`) ?? 0 }))
        .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
      const outcome = decide(candidates, p.seats);
      const [first, second] = candidates;
      return {
        id: p.id, title: p.title, seats: p.seats, maxSelections: p.maxSelections, ballots,
        abstentions: abstain.get(p.id) ?? 0,
        candidates: candidates.map((c) => ({ ...c, shareOfBallots: share(c.votes) })),
        outcome,
        margin: first && first.votes > 0 ? { votes: first.votes - (second?.votes ?? 0), shareOfBallots: share(first.votes - (second?.votes ?? 0)), leader: first.name, runnerUp: second?.name ?? null } : null,
      };
    }),
  };
}

// ───────────────────────── analytics ─────────────────────────

export type SeriesPoint = { at: string; votes: number; cumulative: number };
export type GroupRow = { group: string; eligible: number; voted: number; rate: number };
export type Analytics = {
  summary: { ballots: number; eligible: number | null; turnoutRate: number | null; opened: Date | null; closed: Date | null; durationHours: number | null; peak: { at: string; votes: number } | null; medianHour: string | null };
  funnel: { eligible: number; verified: number; voted: number } | null;
  series: { bucket: "hour" | "day"; points: SeriesPoint[] };
  positions: { id: string; title: string; ballots: number; abstentions: number; abstentionRate: number; margin: PositionResult["margin"]; outcome: PositionOutcome["status"]; candidates: CandidateResult[] }[];
  groups: { minGroupSize: number; rows: GroupRow[]; combinedGroups: number; hiddenVoters: number } | null;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export async function hourlyVotes(e: Election): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  if (e.eligibilityMode === "RESTRICTED") {
    const rows = await db.attendance.groupBy({ by: ["votedHour"], where: { electionId: e.id, state: "VOTED", votedHour: { not: null } }, _count: { _all: true } });
    for (const r of rows) if (r.votedHour) m.set(r.votedHour.getTime(), r._count._all);
  } else {
    const rows = await db.votingCredential.groupBy({ by: ["consumedAt"], where: { electionId: e.id, consumedAt: { not: null } }, _count: { _all: true } });
    for (const r of rows) if (r.consumedAt) m.set(r.consumedAt.getTime(), (m.get(r.consumedAt.getTime()) ?? 0) + r._count._all);
  }
  return m;
}

/** Continuous hourly (or daily, for long elections) series including zero-vote buckets so charts have honest axes. */
export function buildSeries(hours: Map<number, number>, from: Date | null, to: Date | null): Analytics["series"] {
  if (hours.size === 0) return { bucket: "hour", points: [] };
  const keys = [...hours.keys()];
  const startMs = Math.floor((from ?? new Date(Math.min(...keys))).getTime() / HOUR) * HOUR;
  const endMs = Math.max(Math.floor((to ?? new Date(Math.max(...keys))).getTime() / HOUR) * HOUR, Math.max(...keys));
  const first = Math.min(startMs, Math.min(...keys));
  const span = endMs - first;
  const bucket: "hour" | "day" = span > 96 * HOUR ? "day" : "hour";
  const size = bucket === "hour" ? HOUR : DAY;
  const base = bucket === "hour" ? first : Math.floor(first / DAY) * DAY;
  const n = Math.min(Math.floor((endMs - base) / size) + 1, 2200);
  const votes = new Array<number>(n).fill(0);
  for (const [t, c] of hours) { const i = Math.floor((t - base) / size); if (i >= 0 && i < n) votes[i]! += c; }
  let running = 0;
  return { bucket, points: votes.map((v, i) => ({ at: new Date(base + i * size).toISOString(), votes: v, cumulative: (running += v) })) };
}

export function groupTurnout(rows: { group: string | null; voted: boolean }[]): NonNullable<Analytics["groups"]> {
  const m = new Map<string, { eligible: number; voted: number }>();
  for (const r of rows) {
    const k = r.group ?? "No group";
    const cur = m.get(k) ?? { eligible: 0, voted: 0 };
    cur.eligible++; if (r.voted) cur.voted++;
    m.set(k, cur);
  }
  const big: GroupRow[] = [];
  const small = { eligible: 0, voted: 0, groups: 0 };
  for (const [group, v] of m) {
    if (v.eligible >= GROUP_MIN) big.push({ group, ...v, rate: v.voted / v.eligible });
    else { small.eligible += v.eligible; small.voted += v.voted; small.groups++; }
  }
  big.sort((a, b) => b.eligible - a.eligible || a.group.localeCompare(b.group));
  let hiddenVoters = 0;
  if (small.groups > 0) {
    if (small.eligible >= GROUP_MIN) big.push({ group: "Smaller groups combined", eligible: small.eligible, voted: small.voted, rate: small.voted / small.eligible });
    else hiddenVoters = small.eligible;
  }
  return { minGroupSize: GROUP_MIN, rows: big, combinedGroups: small.groups, hiddenVoters };
}

function medianOf(hours: Map<number, number>): string | null {
  const total = [...hours.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  let run = 0;
  for (const k of [...hours.keys()].sort((a, b) => a - b)) { run += hours.get(k)!; if (run >= total / 2) return new Date(k).toISOString(); }
  return null;
}

async function computeAnalytics(e: Election, tally: Tally, audience: Audience): Promise<Analytics> {
  const hours = await hourlyVotes(e);
  const series = buildSeries(hours, e.openedAt ?? e.startsAt, e.closedAt ?? e.endsAt);
  const peak = series.points.reduce<SeriesPoint | null>((best, p) => (!best || p.votes > best.votes ? p : best), null);

  let eligible: number | null = null; let funnel: Analytics["funnel"] = null; let groups: Analytics["groups"] = null;
  if (e.eligibilityMode === "RESTRICTED") {
    const voters = await db.eligibleVoter.findMany({ where: { electionId: e.id }, select: { groupLabel: true, attendance: { select: { state: true } } } });
    eligible = voters.length;
    const verified = voters.filter((v) => v.attendance).length;
    const voted = voters.filter((v) => v.attendance?.state === "VOTED").length;
    funnel = { eligible, verified, voted };
    // Per-group participation is an administrator view; the public page gets totals only.
    if (audience === "admin") groups = groupTurnout(voters.map((v) => ({ group: v.groupLabel, voted: v.attendance?.state === "VOTED" })));
  }
  const opened = e.openedAt ?? e.startsAt; const closed = e.closedAt ?? e.endsAt;
  return {
    summary: {
      ballots: tally.ballots, eligible, turnoutRate: eligible ? tally.ballots / eligible : null,
      opened, closed, durationHours: opened && closed ? Math.max(0, (closed.getTime() - opened.getTime()) / HOUR) : null,
      peak: peak && peak.votes > 0 ? { at: peak.at, votes: peak.votes } : null, medianHour: medianOf(hours),
    },
    funnel, series, groups,
    positions: tally.positions.map((p) => ({ id: p.id, title: p.title, ballots: p.ballots, abstentions: p.abstentions, abstentionRate: p.ballots ? p.abstentions / p.ballots : 0, margin: p.margin, outcome: p.outcome.status, candidates: p.candidates })),
  };
}

// ───────────────────────── gated entry points ─────────────────────────

export type ResultsPayload = { available: true; election: Meta; audience: Audience; live: boolean; tally: Tally; generatedAt: Date };
export type AnalyticsPayload = { available: true; election: Meta; audience: Audience; analytics: Analytics; generatedAt: Date };

async function results(e: Election, audience: Audience): Promise<ResultsPayload | Hidden> {
  if (!resultsVisible(e, audience)) return { available: false, reason: whyHidden(e), election: metaOf(e) };
  return { available: true, election: metaOf(e), audience, live: e.status === "OPEN", tally: await computeTally(e.id), generatedAt: now() };
}

async function analytics(e: Election, audience: Audience): Promise<AnalyticsPayload | Hidden> {
  if (!analyticsVisible(e, audience)) return { available: false, reason: whyHidden(e), election: metaOf(e) };
  return { available: true, election: metaOf(e), audience, analytics: await computeAnalytics(e, await computeTally(e.id), audience), generatedAt: now() };
}

export async function getAdminResults(actor: Actor, electionId: string) {
  return results((await loadElection(actor, electionId)).election, "admin");
}
export async function getAdminAnalytics(actor: Actor, electionId: string) {
  return analytics((await loadElection(actor, electionId)).election, "admin");
}
export async function getPublicResults(slug: string) {
  const e = await findByResultsSlug(slug);
  if (!e) throw notFound("That results link");
  return results(e, "public");
}
export async function getPublicAnalytics(slug: string) {
  const e = await findByResultsSlug(slug);
  if (!e) throw notFound("That results link");
  return analytics(e, "public");
}

// ───────────────────────── downloadable report ─────────────────────────

const METHOD = "Plurality: each selected candidate receives one vote and the candidates with the most votes fill the seats. Ties are reported, never broken silently.";
const LIMITS = "These figures are a software tally, not a certified result. This system is not certified for regulated or statutory elections.";

/** Neutralise spreadsheet formula injection and quote CSV cells. */
export function csvCell(v: string | number | null): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function buildReport(actor: Actor, electionId: string, format: "json" | "csv") {
  const { election: e } = await loadElection(actor, electionId);
  if (!resultsVisible(e, "admin")) throw new AppError("RESULTS_NOT_AVAILABLE", "Results can be downloaded once voting has closed.");
  const tally = await computeTally(e.id);
  const withAnalytics = analyticsVisible(e, "admin") ? await computeAnalytics(e, tally, "admin") : null;
  const generatedAt = now();
  await audit(db, { organizationId: e.organizationId, electionId, actorId: actor.id, action: "report.downloaded", targetType: "Election", targetId: electionId, metadata: { format } });
  const stamp = generatedAt.toISOString().slice(0, 10);
  const slug = e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "election";

  if (format === "json") {
    return { filename: `${slug}-results-${stamp}.json`, contentType: "application/json; charset=utf-8", body: JSON.stringify({ election: metaOf(e), generatedAt, countingMethod: METHOD, notice: LIMITS, ballots: tally.ballots, positions: tally.positions, analytics: withAnalytics }, null, 2) };
  }
  const head = ["position", "seats", "candidate", "votes", "share_of_ballots", "position_outcome", "position_abstentions", "ballots_cast"];
  const lines = [head.join(",")];
  for (const p of tally.positions) {
    for (const c of p.candidates) {
      const won = (p.outcome.winners as string[]).includes(c.id) ? "winner" : (p.outcome.tied as string[]).includes(c.id) ? "tied" : "";
      lines.push([p.title, p.seats, c.name, c.votes, c.shareOfBallots.toFixed(4), won ? `${p.outcome.status}:${won}` : p.outcome.status, p.abstentions, tally.ballots].map(csvCell).join(","));
    }
  }
  return { filename: `${slug}-results-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: lines.join("\r\n") + "\r\n" };
}

import { FREEZE_LEAD_MS } from "@/server/clock";

/**
 * Pure business rules (no I/O) so they can be tested exhaustively and reused by API, pages and jobs.
 */

export type Status = "DRAFT" | "SCHEDULED" | "OPEN" | "CLOSED" | "PUBLISHED";
export type Action = "schedule" | "unschedule" | "open" | "close" | "publish";

export const MIN_DURATION_MS = 10 * 60_000;
export const MAX_DURATION_MS = 90 * 24 * 3_600_000;

/** Allowed lifecycle moves. Everything else is rejected on the server. */
export const TRANSITIONS: Record<Action, { from: Status[]; to: Status }> = {
  schedule: { from: ["DRAFT"], to: "SCHEDULED" },
  unschedule: { from: ["SCHEDULED"], to: "DRAFT" },
  open: { from: ["DRAFT", "SCHEDULED"], to: "OPEN" },
  close: { from: ["OPEN"], to: "CLOSED" },
  publish: { from: ["CLOSED"], to: "PUBLISHED" },
};

type FreezeFacts = { status: Status; rosterFrozenAt: Date | null; rosterFreezeAt: Date | null };

/** The roster is frozen once the freeze instant has passed, or voting has begun, or it was frozen explicitly. */
export function isRosterFrozen(e: FreezeFacts, at: Date): boolean {
  return (
    e.rosterFrozenAt !== null ||
    e.status === "OPEN" ||
    e.status === "CLOSED" ||
    e.status === "PUBLISHED" ||
    (e.rosterFreezeAt !== null && at >= e.rosterFreezeAt)
  );
}

export function isBallotEditable(e: { status: Status; startsAt: Date | null }, at: Date): boolean {
  return (e.status === "DRAFT" || e.status === "SCHEDULED") && !(e.startsAt && at >= e.startsAt);
}

export type ScheduleCheck = {
  startsAt: Date | null;
  endsAt: Date | null;
  now: Date;
  restricted: boolean;
  voterCount: number;
};

/** Human-readable problems with the voting window. Empty array means the window is acceptable. */
export function scheduleProblems(c: ScheduleCheck): string[] {
  const out: string[] = [];
  if (!c.startsAt) out.push("Choose when voting starts.");
  if (!c.endsAt) out.push("Choose when voting ends.");
  if (!c.startsAt || !c.endsAt) return out;
  if (c.startsAt.getTime() <= c.now.getTime() + 60_000) out.push("Voting must start in the future.");
  const len = c.endsAt.getTime() - c.startsAt.getTime();
  if (len < MIN_DURATION_MS) out.push("Voting must stay open for at least 10 minutes.");
  if (len > MAX_DURATION_MS) out.push("Voting can stay open for at most 90 days.");
  // Starting inside the 24h freeze window freezes the roster immediately; never allow that on an empty roster.
  if (c.restricted && c.voterCount === 0 && c.startsAt.getTime() - FREEZE_LEAD_MS <= c.now.getTime()) {
    out.push("The roster freezes 24 hours before voting starts. Import your voters first, or start voting at least 24 hours from now.");
  }
  return out;
}

export type PositionFacts = {
  id: string;
  title: string;
  maxSelections: number;
  seats: number;
  allowAbstain: boolean;
  candidates: { id: string; name: string }[];
};

export type BallotProblem = { positionId: string | null; message: string };

export function ballotProblems(positions: PositionFacts[]): BallotProblem[] {
  const out: BallotProblem[] = [];
  if (positions.length === 0) out.push({ positionId: null, message: "Add at least one position." });
  for (const p of positions) {
    const n = p.candidates.length;
    if (n === 0) out.push({ positionId: p.id, message: `“${p.title}” needs at least one candidate or option.` });
    if (p.maxSelections > Math.max(n, 1)) out.push({ positionId: p.id, message: `“${p.title}” lets voters pick more choices than it has candidates.` });
    if (p.seats > Math.max(n, 1)) out.push({ positionId: p.id, message: `“${p.title}” fills more seats than it has candidates.` });
    const names = p.candidates.map((c) => c.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) out.push({ positionId: p.id, message: `“${p.title}” has two candidates with the same name.` });
  }
  return out;
}

export type Audience = "admin" | "public";
export type Disclosure = "LIVE" | "AFTER_CLOSE";

/**
 * The single rule that decides whether tallies may be shown.
 *   public: LIVE → while voting is open and after; AFTER_CLOSE → only once the owner has published
 *   admin:  LIVE → while voting is open and after; AFTER_CLOSE → once voting has closed (to review before publishing)
 */
export function resultsVisible(e: { status: Status; resultsDisclosure: Disclosure }, audience: Audience): boolean {
  const live = e.resultsDisclosure === "LIVE";
  if (audience === "public") return live ? e.status === "OPEN" || e.status === "CLOSED" || e.status === "PUBLISHED" : e.status === "PUBLISHED";
  return live ? e.status === "OPEN" || e.status === "CLOSED" || e.status === "PUBLISHED" : e.status === "CLOSED" || e.status === "PUBLISHED";
}

/** Analytics (turnout curve, group turnout, margins) are post-election only, under the same disclosure gate. */
export function analyticsVisible(e: { status: Status; resultsDisclosure: Disclosure }, audience: Audience): boolean {
  return (e.status === "CLOSED" || e.status === "PUBLISHED") && resultsVisible(e, audience);
}

export function whyHidden(e: { status: Status }): "not_started" | "voting_open" | "awaiting_publication" {
  if (e.status === "DRAFT" || e.status === "SCHEDULED") return "not_started";
  if (e.status === "OPEN") return "voting_open";
  return "awaiting_publication";
}

// ───────────── Ballot selection validation ─────────────

export type SelectionInput = { positionId: string; candidateIds: string[] };
export type SelectionRow = { positionId: string; candidateId: string | null };

/**
 * Validates a voter's answers against the frozen ballot and normalises them to rows.
 * Every position must be answered (an empty list means "abstain" and is only allowed when the
 * position allows it). Returns an error message instead of throwing so callers choose the error type.
 */
export function validateSelections(positions: { id: string; maxSelections: number; allowAbstain: boolean; candidates: { id: string }[] }[], input: SelectionInput[]): { rows: SelectionRow[] } | { error: string } {
  const byPos = new Map<string, string[]>();
  for (const s of input) {
    if (byPos.has(s.positionId)) return { error: "A position was answered more than once." };
    byPos.set(s.positionId, s.candidateIds);
  }
  const known = new Set(positions.map((p) => p.id));
  for (const id of byPos.keys()) if (!known.has(id)) return { error: "The ballot contains a position that doesn't exist." };

  const rows: SelectionRow[] = [];
  for (const p of positions) {
    const picked = byPos.get(p.id);
    if (!picked) return { error: "Every position needs an answer." };
    if (new Set(picked).size !== picked.length) return { error: "A candidate was selected twice." };
    const valid = new Set(p.candidates.map((c) => c.id));
    if (picked.some((id) => !valid.has(id))) return { error: "The ballot contains a candidate that doesn't exist." };
    if (picked.length > p.maxSelections) return { error: `Too many choices selected (maximum ${p.maxSelections}).` };
    if (picked.length === 0) {
      if (!p.allowAbstain) return { error: "A choice is required for every position that doesn't allow abstaining." };
      rows.push({ positionId: p.id, candidateId: null });
    } else {
      for (const id of picked) rows.push({ positionId: p.id, candidateId: id });
    }
  }
  return { rows };
}

// ───────────── Counting method and ties ─────────────

export type TallyCandidate = { id: string; name: string; votes: number };

export type PositionOutcome =
  | { status: "no_votes"; winners: []; tied: []; seatsOpen: number }
  | { status: "decided"; winners: string[]; tied: []; seatsOpen: number }
  | { status: "tie"; winners: string[]; tied: string[]; seatsOpen: number };

/**
 * Counting method: plurality. Each selected candidate receives one vote; the `seats` candidates with
 * the most votes win. Candidates with zero votes never win. Ties are NEVER broken silently: if the
 * candidates at the cutoff are tied for more seats than remain, none of the tied candidates is
 * declared a winner and the position is reported as a tie (the election's tie rule decides the wording:
 * "report tie" vs "runoff required").
 */
export function decide(candidates: TallyCandidate[], seats: number): PositionOutcome {
  const sorted = [...candidates].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  const contenders = sorted.filter((c) => c.votes > 0);
  if (contenders.length === 0) return { status: "no_votes", winners: [], tied: [], seatsOpen: seats };
  if (contenders.length <= seats) return { status: "decided", winners: contenders.map((c) => c.id), tied: [], seatsOpen: seats - contenders.length };
  const cutoff = contenders[seats - 1]!.votes;
  const above = contenders.filter((c) => c.votes > cutoff);
  const atCutoff = contenders.filter((c) => c.votes === cutoff);
  if (above.length + atCutoff.length <= seats) {
    return { status: "decided", winners: [...above, ...atCutoff].map((c) => c.id), tied: [], seatsOpen: seats - above.length - atCutoff.length };
  }
  return { status: "tie", winners: above.map((c) => c.id), tied: atCutoff.map((c) => c.id), seatsOpen: seats - above.length };
}

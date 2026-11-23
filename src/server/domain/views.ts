import "server-only";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { isRosterFrozen, isBallotEditable, ballotProblems } from "@/server/domain/rules";
import { now } from "@/server/clock";
import { loadElection, type Actor } from "@/server/domain/election";
import { getBallot } from "@/server/domain/ballot-config";
import { signedImageUrl } from "@/server/domain/uploads";
import { parseFields } from "@/server/domain/verification";

/** Read models for the administrator screens. Pure reads: they never change state beyond deadline syncing. */

export async function getElectionDetail(actor: Actor, electionId: string) {
  const { election: e, role, organization } = await loadElection(actor, electionId);
  const at = now();
  const [positions, voters, banner, logo] = await Promise.all([
    getBallot(e.id),
    e.eligibilityMode === "RESTRICTED" ? db.eligibleVoter.count({ where: { electionId: e.id } }) : Promise.resolve(0),
    signedImageUrl(e.bannerUploadId, e.id),
    signedImageUrl(e.logoUploadId, e.id),
  ]);
  const problems = ballotProblems(positions).map((p) => p.message);
  if (e.eligibilityMode === "RESTRICTED" && voters === 0) problems.push("Import at least one eligible voter, or switch to open access.");
  const base = env().APP_URL.replace(/\/$/, "");
  return {
    id: e.id,
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    role,
    title: e.title, description: e.description, timezone: e.timezone,
    status: e.status, restricted: e.eligibilityMode === "RESTRICTED",
    fields: parseFields(e.verificationFields),
    startsAt: e.startsAt, endsAt: e.endsAt, openedAt: e.openedAt, closedAt: e.closedAt, publishedAt: e.publishedAt,
    rosterFreezeAt: e.rosterFreezeAt, rosterFrozen: isRosterFrozen(e, at), ballotEditable: isBallotEditable(e, at),
    resultsDisclosure: e.resultsDisclosure, autoPublish: e.autoPublish, tieRule: e.tieRule, credentialTtlSeconds: e.credentialTtlSeconds,
    voters, problems, ready: problems.length === 0,
    bannerUrl: banner, logoUrl: logo,
    links: { vote: `${base}/v/${e.voterSlug}`, results: `${base}/r/${e.resultsSlug}` },
    positions: await Promise.all(positions.map(async (p) => ({
      id: p.id, title: p.title, description: p.description, maxSelections: p.maxSelections, seats: p.seats, allowAbstain: p.allowAbstain,
      candidates: await Promise.all(p.candidates.map(async (c) => ({ id: c.id, name: c.name, bio: c.bio, imageUrl: await signedImageUrl(c.imageUploadId, e.id) }))),
    }))),
  };
}
export type ElectionDetail = Awaited<ReturnType<typeof getElectionDetail>>;

export async function listAudit(actor: Actor, electionId: string, opts: { cursor?: string; take?: number } = {}) {
  await loadElection(actor, electionId);
  const take = Math.min(opts.take ?? 50, 100);
  const rows = await db.auditEvent.findMany({
    where: { electionId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const actors = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } });
  const names = new Map(actors.map((a) => [a.id, a.name]));
  return {
    events: rows.slice(0, take).map((r) => ({ id: r.id, action: r.action, actor: r.actorId ? names.get(r.actorId) ?? "Former member" : "System", targetType: r.targetType, metadata: r.metadata as Record<string, string | number | boolean | null> | null, at: r.createdAt })),
    nextCursor: rows.length > take ? rows[take - 1]!.id : null,
  };
}

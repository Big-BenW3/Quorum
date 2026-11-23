import "server-only";
import { db } from "@/server/db";
import { AppError, forbidden, notFound } from "@/server/errors";
import type { MemberRole } from "@/generated/prisma/enums";

/**
 * Tenant authorization. The rule that matters: access to an organization, election, position,
 * candidate or import is derived ONLY from the signed-in user's memberships, in the same query that
 * loads the object. A client-supplied organization id is never trusted as proof of access.
 * Objects outside the caller's tenants answer 404 (not 403) so ids cannot be probed.
 */

const RANK: Record<MemberRole, number> = { ADMIN: 1, OWNER: 2 };
export const atLeast = (role: MemberRole, min: MemberRole) => RANK[role] >= RANK[min];

export function requireRole(role: MemberRole, min: MemberRole) {
  if (!atLeast(role, min)) throw forbidden(min === "OWNER" ? "Only an organization owner can do that." : undefined);
}

export function unauthenticated(): AppError {
  return new AppError("UNAUTHENTICATED", "Sign in to continue.");
}

export async function requireOrganization(userId: string, organizationId: string, min: MemberRole = "ADMIN") {
  const m = await db.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { organization: true },
  });
  if (!m) throw notFound("That organization");
  requireRole(m.role, min);
  return { organization: m.organization, role: m.role };
}

export async function requireOrganizationBySlug(userId: string, slug: string, min: MemberRole = "ADMIN") {
  const org = await db.organization.findUnique({ where: { slug } });
  if (!org) throw notFound("That organization");
  return requireOrganization(userId, org.id, min);
}

/** Load an election the caller may administer; the tenant check is part of the WHERE clause. */
export async function requireElection(userId: string, electionId: string, min: MemberRole = "ADMIN") {
  const election = await db.election.findFirst({
    where: { id: electionId, organization: { memberships: { some: { userId } } } },
    include: { organization: { include: { memberships: { where: { userId }, select: { role: true } } } } },
  });
  if (!election) throw notFound("That election");
  const role = election.organization.memberships[0]!.role;
  requireRole(role, min);
  return { election, role, organization: election.organization };
}

export async function requirePosition(userId: string, positionId: string, min: MemberRole = "ADMIN") {
  const position = await db.position.findFirst({
    where: { id: positionId, election: { organization: { memberships: { some: { userId } } } } },
  });
  if (!position) throw notFound("That position");
  const ctx = await requireElection(userId, position.electionId, min);
  return { position, ...ctx };
}

export async function requireCandidate(userId: string, candidateId: string, min: MemberRole = "ADMIN") {
  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, position: { election: { organization: { memberships: { some: { userId } } } } } },
    include: { position: true },
  });
  if (!candidate) throw notFound("That candidate");
  const ctx = await requireElection(userId, candidate.position.electionId, min);
  return { candidate, position: candidate.position, ...ctx };
}

export async function requireImport(userId: string, electionId: string, importId: string, min: MemberRole = "ADMIN") {
  const ctx = await requireElection(userId, electionId, min);
  const imp = await db.rosterImport.findFirst({ where: { id: importId, electionId } });
  if (!imp) throw notFound("That import");
  return { import: imp, ...ctx };
}

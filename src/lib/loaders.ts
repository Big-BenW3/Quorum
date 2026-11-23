import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";
import { getElectionDetail } from "@/server/domain/views";
import { getOrganization } from "@/server/domain/org";

/** Per-request cached loaders for pages. Missing or foreign objects become a 404, never a hint that they exist. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
}
export const loadElectionDetail = cache((userId: string, electionId: string) => guard(() => getElectionDetail({ id: userId }, electionId)));
export const loadOrganization = cache((userId: string, orgId: string) => guard(() => getOrganization({ id: userId }, orgId)));
import { getImport } from "@/server/domain/roster";
export const loadImport = cache((userId: string, electionId: string, importId: string) => guard(() => getImport({ id: userId }, electionId, importId)));

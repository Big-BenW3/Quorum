import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { env } from "@/server/env";
import { now } from "@/server/clock";
import { logger } from "@/server/log";
import { syncElection } from "@/server/domain/election";
import { purgeStaleImports } from "@/server/domain/roster";
import { deleteUploadObject } from "@/server/domain/uploads";

/**
 * Housekeeping, run by a daily cron (vercel.json) and safe to run at any time, any number of times.
 *
 * Correctness never depends on this job: election deadlines are applied on every read and write
 * (syncElection), so an election closes on time even if the cron never fires. The sweeper only
 *   - applies due transitions for elections nobody has looked at (so auto-publish and freeze audit
 *     events still happen),
 *   - deletes data that has outlived its purpose (credentials, raw roster files, staged rows,
 *     expired upload slots, old rate-limit counters),
 *   - recovers parse jobs that died mid-way.
 * Each step is isolated: one failing step does not stop the others.
 */

const HOUR = 3_600_000;

export type SweepReport = Record<string, number | string>;

export async function runSweep(): Promise<SweepReport> {
  const at = now();
  const report: SweepReport = {};
  const step = async (name: string, fn: () => Promise<number>) => {
    try { report[name] = await fn(); }
    catch (e) { report[name] = "failed"; logger.error("sweep.step_failed", { step: name, name2: e instanceof Error ? e.name : "unknown" }); }
  };

  await step("electionsSynced", async () => {
    const due = await db.election.findMany({
      where: { OR: [
        { status: "SCHEDULED", startsAt: { lte: at } },
        { status: "OPEN", endsAt: { lte: at } },
        { status: { in: ["DRAFT", "SCHEDULED"] }, rosterFrozenAt: null, rosterFreezeAt: { lte: at } },
      ] },
      select: { id: true }, take: 200,
    });
    for (const e of due) await syncElection(e.id);
    return due.length;
  });

  await step("recoveredParseJobs", async () => {
    const r = await db.rosterImport.updateMany({ where: { status: "PARSING", parseStartedAt: { lt: new Date(at.getTime() - 15 * 60_000) } }, data: { status: "FAILED", errorCode: "STUCK" } });
    return r.count;
  });

  await step("staleImportsPurged", () => purgeStaleImports());

  await step("uploadsDeleted", async () => {
    // Expired upload slots, and raw roster files whose import has been scrubbed.
    const rows = await db.upload.findMany({
      where: { status: { in: ["PENDING", "UPLOADED", "REJECTED"] }, OR: [{ expiresAt: { lt: at }, status: { not: "UPLOADED" } }, { kind: "ROSTER", imports: { some: { purgedAt: { not: null } } } }] },
      select: { id: true }, take: 200,
    });
    for (const u of rows) await deleteUploadObject(u.id);
    return rows.length;
  });

  await step("credentialsPurged", async () => {
    const cutoff = new Date(at.getTime() - env().CREDENTIAL_RETENTION_HOURS * HOUR);
    // Consumed credentials are kept for open-access elections only: there they are the sole source of the
    // turnout-over-time chart and carry no identity. For restricted elections the same hour lives on the
    // attendance record, so the credential row has no remaining purpose.
    const r = await db.votingCredential.deleteMany({
      where: { OR: [
        { consumedAt: null, expiresAt: { lt: cutoff } },
        { revokedAt: { lt: cutoff } },
        { consumedAt: { lt: cutoff }, election: { eligibilityMode: "RESTRICTED" } },
      ] },
    });
    return r.count;
  });

  await step("expiredAuthRowsDeleted", async () => {
    // Sessions and email/password-reset tokens past their expiry are already unusable; this only removes the rows.
    const [sessions, tokens] = await Promise.all([
      db.session.deleteMany({ where: { expiresAt: { lt: at } } }),
      db.verification.deleteMany({ where: { expiresAt: { lt: at } } }),
    ]);
    return sessions.count + tokens.count;
  });

  await step("rateLimitBucketsDeleted", async () => {
    const r = await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: Math.floor(at.getTime() / 1000) - 2 * 86_400 } } });
    return r.count;
  });

  try { await audit(db, { organizationId: "system", action: "system.sweep", metadata: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v])) }); }
  catch { /* the audit row is informational */ }
  return report;
}

import { z } from "zod";
import { verifyQueueRequest, runJob } from "@/server/adapters/jobs";
import "@/server/domain/roster"; // registers the "roster.parse" handler
import { AppError } from "@/server/errors";
import { logger } from "@/server/log";

/**
 * QStash delivery endpoint. Authenticated by the vendor's request signature over the exact body and URL.
 * Handlers are idempotent (status compare-and-swap), so a redelivered message is harmless.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const body = z.strictObject({ name: z.literal("roster.parse"), payload: z.strictObject({ importId: z.string().min(1).max(64) }) });
const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 10_000 || !(await verifyQueueRequest(req, raw))) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Not authorized." } }, { status: 401, headers: noStore });
  let parsed: z.infer<typeof body>;
  try { parsed = body.parse(JSON.parse(raw)); } catch { return Response.json({ error: { code: "VALIDATION_FAILED", message: "Invalid job." } }, { status: 422, headers: noStore }); }
  try {
    await runJob(parsed.name, parsed.payload);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (e) {
    // Known application failures are recorded on the import; only unexpected errors ask the queue to retry.
    if (e instanceof AppError) return Response.json({ ok: false, code: e.code }, { headers: noStore });
    logger.error("job.failed", { name: e instanceof Error ? e.name : "unknown" });
    return Response.json({ error: { code: "INTERNAL", message: "Job failed." } }, { status: 500, headers: noStore });
  }
}

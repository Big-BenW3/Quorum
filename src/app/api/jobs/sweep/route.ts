import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto/keys";
import { runSweep } from "@/server/domain/sweep";
import { logger } from "@/server/log";

/** Called by the scheduler (vercel.json cron sends GET with `Authorization: Bearer $CRON_SECRET`). */
export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(req: Request) {
  const secret = env().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  // Fails closed: with no CRON_SECRET configured nobody can run it over HTTP.
  if (!secret || !given || !safeEqual(given, secret)) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Not authorized." } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json({ ok: true, report: await runSweep() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    logger.error("sweep.failed", { name: e instanceof Error ? e.name : "unknown" });
    return Response.json({ error: { code: "INTERNAL", message: "Sweep failed." } }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
export const GET = handle;
export const POST = handle;

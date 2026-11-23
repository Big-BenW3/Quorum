import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";
import { clientIp, ipKey } from "@/server/http";
import { enforceLimit } from "@/server/adapters/ratelimit";
import { AppError } from "@/server/errors";

/**
 * Better Auth owns sign-in, sign-up, sessions and password handling. We only add a rate limit in front of
 * the POST endpoints (credential stuffing) and return our standard error shape for throttling.
 */
const handler = () => toNextJsHandler(getAuth());

export const GET = (req: Request) => handler().GET(req);

export async function POST(req: Request) {
  try {
    await enforceLimit(`auth:${ipKey(clientIp(req))}`, { limit: 20, windowSec: 600 }, "Too many sign-in attempts. Wait a few minutes and try again.");
  } catch (e) {
    if (e instanceof AppError) {
      return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: { "Cache-Control": "no-store", ...(e.details?.retryAfterSec ? { "Retry-After": String(e.details.retryAfterSec) } : {}) } });
    }
    throw e;
  }
  return handler().POST(req);
}

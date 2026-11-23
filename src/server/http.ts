import "server-only";
import { z } from "zod";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { logger } from "@/server/log";
import { hmacHex } from "@/server/crypto/keys";
import { enforceLimit } from "@/server/adapters/ratelimit";
import { getSessionUser, type SessionUser } from "@/server/auth";
import { unauthenticated } from "@/server/authz";

/**
 * One wrapper for every Route Handler. It applies, in order:
 *   request id → origin (CSRF) check → rate limits → authentication → body/query validation → handler
 * and converts every failure into the same error shape:
 *   { "error": { "code": "...", "message": "...", "requestId": "...", "fields"?: { "path": "message" } } }
 * Request bodies are never logged.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_MAX_BODY = 256 * 1024;

export type RouteParams = Record<string, string>;
export type LimitSpec = { name: string; limit: number; windowSec: number; by?: "ip" | "user" };

type Opt = z.ZodType | undefined;
type Infer<T extends Opt> = T extends z.ZodType ? z.infer<T> : undefined;

export type RouteContext<B extends Opt, Q extends Opt, A extends "user" | "none"> = {
  req: Request;
  params: RouteParams;
  body: Infer<B>;
  query: Infer<Q>;
  user: A extends "user" ? SessionUser : null;
  ip: string;
  requestId: string;
};

export type RouteOptions<B extends Opt, Q extends Opt, A extends "user" | "none"> = {
  auth: A;
  body?: B;
  query?: Q;
  /** A function defers reading configuration until a request arrives, so the module can load (and build) without runtime env. */
  limits?: LimitSpec[] | (() => LimitSpec[]);
  /** Skip the browser-origin check (cron/webhook endpoints that authenticate with a secret instead). */
  skipOriginCheck?: boolean;
  maxBodyBytes?: number;
};

export function clientIp(req: Request): string {
  const e = env();
  const trust = e.TRUST_PROXY_HEADERS ?? Boolean(process.env.VERCEL);
  if (!trust) return "direct";
  const raw = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  return raw.trim().slice(0, 64);
}

/** Rate-limit key material: keyed hash of the IP, rotated daily so stored keys cannot be linked across days. */
export function ipKey(ip: string): string {
  return hmacHex("ip", ip, new Date().toISOString().slice(0, 10)).slice(0, 32);
}

export function allowedOrigins(): Set<string> {
  const e = env();
  return new Set([new URL(e.APP_URL).origin, ...(e.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])]);
}

/** CSRF defence for cookie-authenticated, state-changing requests: require a same-site browser origin. */
export function assertSameOrigin(req: Request) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (origin) {
    if (!allowedOrigins().has(origin)) throw new AppError("BAD_ORIGIN", "This request came from an unexpected origin.");
    return;
  }
  if (site === "same-origin") return;
  throw new AppError("BAD_ORIGIN", "This request is missing a trusted origin.");
}

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0", ...init.headers },
  });
}

function errorResponse(e: unknown, requestId: string, route: string): Response {
  if (e instanceof AppError) {
    const headers: Record<string, string> = { "X-Request-Id": requestId };
    if (e.code === "RATE_LIMITED" && e.details?.retryAfterSec) headers["Retry-After"] = String(e.details.retryAfterSec);
    if (e.status >= 500) logger.error("route.error", { route, requestId, code: e.code });
    return json({ error: { code: e.code, message: e.message, requestId, ...(e.details?.fields ? { fields: e.details.fields } : {}) } }, { status: e.status, headers });
  }
  if (e instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
    return json({ error: { code: "VALIDATION_FAILED", message: "Some fields need attention.", requestId, fields } }, { status: 422, headers: { "X-Request-Id": requestId } });
  }
  // Unknown failure: log type only (messages from drivers can carry values), answer generically.
  logger.error("route.unhandled", { route, requestId, name: e instanceof Error ? e.name : typeof e, code: (e as { code?: string })?.code });
  return json({ error: { code: "INTERNAL", message: "Something went wrong on our side. Try again in a moment.", requestId } }, { status: 500, headers: { "X-Request-Id": requestId } });
}

async function readJson(req: Request, max: number): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Send the request as application/json.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) throw new AppError("PAYLOAD_TOO_LARGE", "That request is too large.");
  const text = await req.text();
  if (text.length > max) throw new AppError("PAYLOAD_TOO_LARGE", "That request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", "The request body isn't valid JSON.");
  }
}

export function route<B extends Opt = undefined, Q extends Opt = undefined, A extends "user" | "none" = "user">(
  name: string,
  opts: RouteOptions<B, Q, A>,
  handler: (c: RouteContext<B, Q, A>) => Promise<unknown>,
) {
  return async (req: Request, ctx?: { params?: Promise<RouteParams> }): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      if (!opts.skipOriginCheck) assertSameOrigin(req);
      const ip = clientIp(req);
      const ipk = ipKey(ip);

      let user: SessionUser | null = null;
      if (opts.auth === "user") {
        user = await getSessionUser(req.headers);
        if (!user) throw unauthenticated();
      }
      for (const l of (typeof opts.limits === "function" ? opts.limits() : opts.limits) ?? []) {
        const scope = l.by === "user" && user ? `u:${user.id}` : `ip:${ipk}`;
        await enforceLimit(`${l.name}:${scope}`, { limit: l.limit, windowSec: l.windowSec });
      }

      const params = (await ctx?.params) ?? {};
      const url = new URL(req.url);
      const query = opts.query ? opts.query.parse(Object.fromEntries(url.searchParams)) : undefined;
      const body = opts.body ? opts.body.parse(await readJson(req, opts.maxBodyBytes ?? DEFAULT_MAX_BODY)) : undefined;

      const out = await handler({ req, params, body: body as Infer<B>, query: query as Infer<Q>, user: user as RouteContext<B, Q, A>["user"], ip: ipk, requestId });
      if (out instanceof Response) {
        out.headers.set("X-Request-Id", requestId);
        return out;
      }
      return json(out ?? { ok: true }, { headers: { "X-Request-Id": requestId } });
    } catch (e) {
      return errorResponse(e, requestId, name);
    }
  };
}

export const created = (data: unknown) => json(data, { status: 201 });

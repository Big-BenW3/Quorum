import { env, isProduction } from "@/server/env";
import { getLocalStorage, verifyLocalUrl } from "@/server/adapters/storage";
import { AppError } from "@/server/errors";
import { logger } from "@/server/log";

/**
 * Development-only stand-in for S3 presigned URLs. Authorization is the HMAC signature inside the URL
 * (operation, key, content type, expiry and size are all signed), not a session. It refuses to run in
 * production unless explicitly allowed, and never overwrites an existing object.
 */
export const runtime = "nodejs";

const fail = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function enabled(): Response | null {
  if (env().STORAGE_DRIVER !== "local") return fail(404, "Not found.");
  if (isProduction() && !env().ALLOW_LOCAL_STORAGE_IN_PRODUCTION) return fail(404, "Not found.");
  return null;
}

export async function PUT(req: Request) {
  const off = enabled(); if (off) return off;
  const p = verifyLocalUrl(new URL(req.url).searchParams, "put");
  if (!p) return fail(403, "This upload link is invalid or has expired.");
  if ((req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() !== p.ct.toLowerCase()) return fail(415, "The file type doesn't match the upload link.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (!p.size || declared > p.size) return fail(413, "That file is larger than the upload link allows.");
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > p.size) return fail(413, "That file is larger than the upload link allows.");
  try {
    await getLocalStorage().write(p.key, body);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return fail(409, "That file was already uploaded.");
    logger.error("storage.local_write_failed", { name: e instanceof Error ? e.name : "unknown" });
    return fail(500, "We couldn't store that file.");
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  const off = enabled(); if (off) return off;
  const p = verifyLocalUrl(new URL(req.url).searchParams, "get");
  if (!p) return fail(403, "This link is invalid or has expired.");
  try {
    const bytes = await getLocalStorage().read(p.key, env().MAX_IMAGE_BYTES);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": p.ct, "Content-Disposition": "inline", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (e) {
    if (e instanceof AppError) throw e;
    return fail(404, "Not found.");
  }
}

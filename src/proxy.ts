import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a nonce. Scripts run only if they carry the nonce Next.js
 * injects (and 'strict-dynamic' lets those scripts load their chunks). No inline script, no eval in production.
 * Inline style *attributes* are allowed (they can't run code; charts use them for bar widths).
 */
export function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  // Signed URLs use either path style (https://endpoint/bucket/key) or virtual-hosted style (https://bucket.endpoint/key),
  // so allow the endpoint host and its subdomains. Without an endpoint the SDK talks to AWS.
  const storage = (() => {
    try {
      if (!process.env.S3_ENDPOINT) return "https://*.amazonaws.com";
      const { origin, host } = new URL(process.env.S3_ENDPOINT);
      return `${origin} https://*.${host}`;
    } catch { return "https://*.amazonaws.com"; }
  })();
  const media = process.env.STORAGE_DRIVER === "s3" ? storage : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ` 'nonce-${nonce}'`}`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${media}`.trim(),
    "font-src 'self'",
    `connect-src 'self' ${media}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};

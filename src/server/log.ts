import "server-only";

/**
 * Structured logger with key-based redaction. Route code never logs request bodies; this is the
 * second line of defence if a developer passes one by mistake.
 */
const SENSITIVE = /token|secret|password|authorization|cookie|selection|payload|credential|pin|lookup|hmac|signature|apikey|api_key|label|email|ballot|candidate|answer|value/i;

function redact(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (depth > 3) return "[truncated]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(val, depth + 1);
    return out;
  }
  return String(v);
}

type Level = "debug" | "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" && !process.env.QUORUM_LOG_IN_TESTS) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const logger = {
  info: (e: string, f?: Record<string, unknown>) => log("info", e, f),
  warn: (e: string, f?: Record<string, unknown>) => log("warn", e, f),
  error: (e: string, f?: Record<string, unknown>) => log("error", e, f),
};

export { redact as redactForTests };

import "server-only";
import { z } from "zod";

/**
 * Server-only configuration. Everything here is validated once, lazily, and fails closed:
 * a missing secret never degrades to a weaker default in production.
 * Nothing in this file is ever exposed to the browser (no NEXT_PUBLIC_ variables are read).
 */

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const PLACEHOLDER = /(change[-_ ]?me|replace[-_ ]?me|placeholder|example|your[-_ ]|xxxx|secret$)/i;

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_NAME: z.string().min(1).max(40).default("Quorum"),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    ALLOW_SQLITE_IN_PRODUCTION: bool.default(false),

    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    APP_SECRET: z.string().min(32, "must be at least 32 characters"),
    CRON_SECRET: z.string().min(16).optional(),
    TRUST_PROXY_HEADERS: bool.optional(),
    /** Extra browser origins allowed to make state-changing requests (comma separated). */
    ALLOWED_ORIGINS: z.string().optional(),

    MAIL_DRIVER: z.enum(["none", "console", "resend"]).default("none"),
    MAIL_FROM: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),

    STORAGE_DRIVER: z.enum(["none", "local", "s3"]).default("none"),
    ALLOW_LOCAL_STORAGE_IN_PRODUCTION: bool.default(false),
    STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(false),

    RATE_LIMIT_DRIVER: z.enum(["none", "memory", "database"]).default("database"),
    JOB_DRIVER: z.enum(["inline", "qstash"]).default("inline"),
    QSTASH_TOKEN: z.string().optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
    QSTASH_NEXT_SIGNING_KEY: z.string().optional(),

    OCR_DRIVER: z.enum(["none", "http"]).default("none"),
    OCR_ENDPOINT_URL: z.url().optional(),
    OCR_API_KEY: z.string().optional(),
    OCR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),

    MAX_ROSTER_BYTES: z.coerce.number().int().min(1024).max(25_000_000).default(5_000_000),
    MAX_ROSTER_ROWS: z.coerce.number().int().min(1).max(100_000).default(20_000),
    MAX_IMAGE_BYTES: z.coerce.number().int().min(1024).max(10_000_000).default(2_000_000),
    INLINE_PARSE_MAX_ROWS: z.coerce.number().int().min(1).max(50_000).default(5_000),

    VERIFY_PER_IP_PER_10MIN: z.coerce.number().int().min(1).default(30),
    VERIFY_FAILS_PER_IDENTITY_PER_15MIN: z.coerce.number().int().min(1).default(6),
    SUBMIT_PER_IP_PER_10MIN: z.coerce.number().int().min(1).default(30),
    OPEN_ISSUE_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(10),
    CREDENTIAL_RETENTION_HOURS: z.coerce.number().int().min(1).default(24),
    RAW_UPLOAD_RETENTION_HOURS: z.coerce.number().int().min(0).default(24),
  })
  .superRefine((e, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const prod = e.NODE_ENV === "production";
    if (prod && PLACEHOLDER.test(e.BETTER_AUTH_SECRET)) add("BETTER_AUTH_SECRET", "looks like a placeholder");
    if (prod && PLACEHOLDER.test(e.APP_SECRET)) add("APP_SECRET", "looks like a placeholder");
    if (e.BETTER_AUTH_SECRET === e.APP_SECRET) add("APP_SECRET", "must differ from BETTER_AUTH_SECRET");
    if (prod && !e.CRON_SECRET) add("CRON_SECRET", "is required in production (protects /api/jobs/*)");
    if (prod && e.DATABASE_URL.startsWith("file:") && !e.ALLOW_SQLITE_IN_PRODUCTION)
      add("DATABASE_URL", "SQLite files are not durable on serverless hosts; use Postgres (see docs/deployment.md)");
    if (prod && e.STORAGE_DRIVER === "local" && !e.ALLOW_LOCAL_STORAGE_IN_PRODUCTION)
      add("STORAGE_DRIVER", "local disk storage is development-only; use s3");
    if (prod && e.RATE_LIMIT_DRIVER === "memory") add("RATE_LIMIT_DRIVER", "memory limiter is not shared across serverless instances");
    if (e.STORAGE_DRIVER === "s3") {
      for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) if (!e[k]) add(k, "is required when STORAGE_DRIVER=s3");
    }
    if (e.OCR_DRIVER === "http") {
      if (!e.OCR_ENDPOINT_URL) add("OCR_ENDPOINT_URL", "is required when OCR_DRIVER=http");
      if (!e.OCR_API_KEY) add("OCR_API_KEY", "is required when OCR_DRIVER=http");
    }
    if (e.JOB_DRIVER === "qstash") {
      for (const k of ["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"] as const) if (!e[k]) add(k, "is required when JOB_DRIVER=qstash");
    }
    if (e.MAIL_DRIVER === "resend" && (!e.RESEND_API_KEY || !e.MAIL_FROM)) add("RESEND_API_KEY", "and MAIL_FROM are required when MAIL_DRIVER=resend");
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid server configuration:\n - ${problems.join("\n - ")}\nSee .env.example and docs/deployment.md.`);
    this.name = "EnvError";
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Report variable names and reasons only, never the supplied values.
    throw new EnvError(parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`));
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test hook. */
export function resetEnvForTests() {
  cached = undefined;
}

export function isProduction() {
  return env().NODE_ENV === "production";
}

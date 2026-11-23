import "server-only";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { logger } from "@/server/log";

/**
 * Background work without a long-lived process.
 *
 *   inline  – default. Runs the job inside the request. Safe only for small workloads; callers check
 *             `canRunInline` and report the limitation clearly instead of timing out.
 *   qstash  – durable queue (Upstash QStash). The job is delivered to POST /api/jobs/run with a
 *             verified signature, retried by QStash, and is idempotent by construction (state machine
 *             compare-and-swap in the handler), so redelivery never duplicates roster rows.
 */

export type JobName = "roster.parse";
export type JobPayload = { importId: string };
type Handler = (payload: JobPayload) => Promise<void>;

const handlers = new Map<JobName, Handler>();
export function registerJob(name: JobName, fn: Handler) { handlers.set(name, fn); }
export async function runJob(name: JobName, payload: JobPayload) {
  const h = handlers.get(name);
  if (!h) throw new AppError("INTERNAL", "Unknown job.");
  await h(payload);
}

export type EnqueueResult = { mode: "inline" | "queued" };
export interface JobQueue {
  readonly durable: boolean;
  enqueue(name: JobName, payload: JobPayload, idempotencyKey: string): Promise<EnqueueResult>;
}

class InlineQueue implements JobQueue {
  readonly durable = false;
  async enqueue(name: JobName, payload: JobPayload): Promise<EnqueueResult> {
    await runJob(name, payload);
    return { mode: "inline" };
  }
}

class QStashQueue implements JobQueue {
  readonly durable = true;
  async enqueue(name: JobName, payload: JobPayload, idempotencyKey: string): Promise<EnqueueResult> {
    const e = env();
    const dest = `${e.APP_URL.replace(/\/$/, "")}/api/jobs/run`;
    const res = await fetch(`https://qstash.upstash.io/v2/publish/${dest}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.QSTASH_TOKEN}`, "Content-Type": "application/json", "Upstash-Deduplication-Id": idempotencyKey, "Upstash-Retries": "3" },
      body: JSON.stringify({ name, payload }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.error("jobs.enqueue_failed", { status: res.status });
      throw new AppError("PROVIDER_FAILED", "We couldn't queue that job. Try again in a moment.");
    }
    return { mode: "queued" };
  }
}

/** Verifies a QStash delivery. Uses the vendor SDK's Receiver so we do not hand-roll signature checks. */
export async function verifyQueueRequest(req: Request, rawBody: string): Promise<boolean> {
  const e = env();
  if (e.JOB_DRIVER !== "qstash") return false;
  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;
  const { Receiver } = await import("@upstash/qstash");
  const receiver = new Receiver({ currentSigningKey: e.QSTASH_CURRENT_SIGNING_KEY!, nextSigningKey: e.QSTASH_NEXT_SIGNING_KEY! });
  try {
    return await receiver.verify({ signature, body: rawBody, url: `${e.APP_URL.replace(/\/$/, "")}/api/jobs/run` });
  } catch {
    return false;
  }
}

let instance: JobQueue | undefined;
export function getJobQueue(): JobQueue {
  instance ??= env().JOB_DRIVER === "qstash" ? new QStashQueue() : new InlineQueue();
  return instance;
}
export function setJobQueueForTests(q: JobQueue | undefined) { instance = q; }

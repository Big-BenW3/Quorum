import "server-only";
import { env, isProduction } from "@/server/env";
import { configError, AppError } from "@/server/errors";
import { logger } from "@/server/log";

/**
 * Transactional mail (email verification, password reset). Optional: with MAIL_DRIVER=none those
 * features are simply unavailable and the UI says so; nothing pretends to have been sent.
 */
export type Mail = { to: string; subject: string; text: string; idempotencyKey?: string };

export function mailIsConfigured() {
  return env().MAIL_DRIVER !== "none";
}

export async function sendMail(mail: Mail): Promise<void> {
  const e = env();
  if (e.MAIL_DRIVER === "none") throw configError("Email is not configured on this server.");
  if (e.MAIL_DRIVER === "console") {
    if (isProduction()) throw configError("The console mail driver is not allowed in production.");
    // Development convenience: prints the message (including any link) to the server console.
    console.log(`\n[mail:console] to=${mail.to}\nsubject=${mail.subject}\n${mail.text}\n`);
    return;
  }
  // Resend REST API. Bounded retries on 5xx/timeouts, idempotency key so retries never double-send.
  const key = mail.idempotencyKey ?? crypto.randomUUID();
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ from: e.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;
      lastStatus = res.status;
      if (res.status < 500 && res.status !== 429) break;
    } catch {
      lastStatus = 0;
    }
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
  }
  logger.error("mail.failed", { status: lastStatus });
  throw new AppError("PROVIDER_FAILED", "We couldn't send that email. Please try again shortly.");
}

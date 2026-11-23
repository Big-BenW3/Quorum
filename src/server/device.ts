import "server-only";
import { randomToken } from "@/server/crypto/keys";
import { isProduction } from "@/server/env";

/**
 * Browser identifier for open-access elections only. It is a random value with no link to a person; the
 * database stores only a keyed hash of it per election. It is a weak, best-effort guard (clear your cookies
 * and you are a new browser), and the UI and docs say so.
 */
const NAME = "quorum_device";
const VALID = /^[A-Za-z0-9_-]{32,64}$/;

export function deviceCookie(req: Request): { id: string; setCookie: string | null } {
  const header = req.headers.get("cookie") ?? "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${NAME}=`));
  const existing = match?.slice(NAME.length + 1);
  if (existing && VALID.test(existing)) return { id: existing, setCookie: null };
  const id = randomToken(32);
  return { id, setCookie: `${NAME}=${id}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; SameSite=Lax${isProduction() ? "; Secure" : ""}` };
}

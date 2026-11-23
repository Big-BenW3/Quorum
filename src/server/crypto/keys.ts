import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/**
 * Cryptography here is limited to standard primitives from node:crypto, used in the textbook way:
 *   - HKDF-SHA256 to derive independent subkeys from APP_SECRET (domain separation by purpose)
 *   - HMAC-SHA256 for keyed lookups and token hashes
 *   - AES-256-GCM (random 96-bit IV, AAD-bound) for the few values we must be able to read back
 * There is no custom cipher, no custom MAC and no homemade voting protocol.
 */

export type Purpose =
  | "roster-lookup"
  | "roster-primary"
  | "credential-token"
  | "invite-token"
  | "seal"
  | "storage-url"
  | "device"
  | "ip";

const cache = new Map<string, Buffer>();

function subkey(purpose: Purpose): Buffer {
  const hit = cache.get(purpose);
  if (hit) return hit;
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(env().APP_SECRET, "utf8"), Buffer.from("quorum/v1/salt"), Buffer.from(`quorum/v1/${purpose}`), 32));
  cache.set(purpose, key);
  return key;
}

export function resetKeyCacheForTests() {
  cache.clear();
}

/** Length-prefixed encoding: ("ab","c") and ("a","bc") can never collide. */
function encode(parts: string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const b = Buffer.from(p, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    chunks.push(len, b);
  }
  return Buffer.concat(chunks);
}

export function hmacHex(purpose: Purpose, ...parts: string[]): string {
  return createHmac("sha256", subkey(purpose)).update(encode(parts)).digest("hex");
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM envelope: v1.<iv>.<ciphertext>.<tag>, bound to `context` as additional authenticated data. */
export function seal(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey("seal"), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function open(envelope: string, context: string): string {
  const [v, iv, ct, tag] = envelope.split(".");
  if (v !== "v1" || !iv || !ct || !tag) throw new Error("Unsupported envelope");
  const decipher = createDecipheriv("aes-256-gcm", subkey("seal"), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** HMAC over a signed-URL style payload (used by the local storage adapter). */
export function signPayload(payload: string): string {
  return createHmac("sha256", subkey("storage-url")).update(payload).digest("base64url");
}

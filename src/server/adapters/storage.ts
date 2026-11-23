import "server-only";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { env, isProduction } from "@/server/env";
import { configError } from "@/server/errors";
import { safeEqual, signPayload } from "@/server/crypto/keys";

/**
 * Private object storage behind one interface. Objects are never public: uploads go to short-lived
 * signed PUT targets, reads happen server-side or through short-lived signed GET URLs.
 *
 *   local  – development only. Files live under STORAGE_LOCAL_DIR and are served by /api/storage/local
 *            after verifying an HMAC-signed, expiring URL. Refused in production (no durable disk on Vercel).
 *   s3     – any S3-compatible service (AWS S3, Cloudflare R2, Supabase Storage S3 endpoint, MinIO).
 *   none   – default. Upload features answer 503 instead of pretending to work.
 */

export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: Date };

export interface StorageAdapter {
  readonly name: string;
  createUploadTarget(i: { key: string; contentType: string; size: number; expiresInSec: number }): Promise<UploadTarget>;
  stat(key: string): Promise<{ size: number } | null>;
  /** Reads at most maxBytes; throws if the object is larger. */
  read(key: string, maxBytes: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
  createReadUrl(i: { key: string; contentType: string; expiresInSec: number }): Promise<string>;
}

export const KEY_PATTERN = /^uploads\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{8,64}$/;
export function assertKey(key: string) {
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
}

// ───────────── local (development) ─────────────

export type LocalOp = "put" | "get";
export type LocalParams = { op: LocalOp; key: string; ct: string; exp: number; size?: number };

function localPayload(p: LocalParams) {
  return [p.op, p.key, p.ct, String(p.exp), String(p.size ?? "")].join("|");
}
export function signLocalUrl(p: LocalParams): string {
  const q = new URLSearchParams({ op: p.op, key: p.key, ct: p.ct, exp: String(p.exp), ...(p.size !== undefined ? { size: String(p.size) } : {}), sig: signPayload(localPayload(p)) });
  return `${env().APP_URL.replace(/\/$/, "")}/api/storage/local?${q.toString()}`;
}
export function verifyLocalUrl(searchParams: URLSearchParams, expectedOp: LocalOp, nowMs = Date.now()): LocalParams | null {
  const op = searchParams.get("op");
  const key = searchParams.get("key") ?? "";
  const ct = searchParams.get("ct") ?? "";
  const exp = Number(searchParams.get("exp"));
  const sizeRaw = searchParams.get("size");
  const sig = searchParams.get("sig") ?? "";
  if (op !== expectedOp || !KEY_PATTERN.test(key) || !Number.isFinite(exp) || exp * 1000 < nowMs) return null;
  const p: LocalParams = { op: expectedOp, key, ct, exp, ...(sizeRaw !== null ? { size: Number(sizeRaw) } : {}) };
  return safeEqual(sig, signPayload(localPayload(p))) ? p : null;
}

class LocalStorage implements StorageAdapter {
  readonly name = "local";
  private base = resolve(/*turbopackIgnore: true*/ process.cwd(), env().STORAGE_LOCAL_DIR);
  private pathFor(key: string) {
    assertKey(key);
    const p = resolve(join(this.base, key));
    if (!p.startsWith(this.base + sep)) throw new Error("Path escape");
    return p;
  }
  async createUploadTarget({ key, contentType, size, expiresInSec }: { key: string; contentType: string; size: number; expiresInSec: number }) {
    const exp = Math.floor(Date.now() / 1000) + expiresInSec;
    return { url: signLocalUrl({ op: "put", key, ct: contentType, exp, size }), method: "PUT" as const, headers: { "Content-Type": contentType }, expiresAt: new Date(exp * 1000) };
  }
  async stat(key: string) {
    try { return { size: (await stat(this.pathFor(key))).size }; } catch { return null; }
  }
  async read(key: string, maxBytes: number) {
    const s = await this.stat(key);
    if (!s) throw new Error("Object not found");
    if (s.size > maxBytes) throw new Error("Object too large");
    return readFile(this.pathFor(key));
  }
  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
  async createReadUrl({ key, contentType, expiresInSec }: { key: string; contentType: string; expiresInSec: number }) {
    return signLocalUrl({ op: "get", key, ct: contentType, exp: Math.floor(Date.now() / 1000) + expiresInSec });
  }
  /** Called by the local upload route after the signature has been verified. Refuses to overwrite. */
  async write(key: string, bytes: Buffer) {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes, { flag: "wx", mode: 0o600 });
  }
}

// ───────────── S3-compatible ─────────────

class S3Storage implements StorageAdapter {
  readonly name = "s3";
  private clientPromise = (async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const e = env();
    return new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  })();
  private bucket = env().S3_BUCKET!;

  async createUploadTarget({ key, contentType, size, expiresInSec }: { key: string; contentType: string; size: number; expiresInSec: number }) {
    assertKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    // The exact size and type are part of the signature, so a client cannot upload something else.
    const url = await getSignedUrl(await this.clientPromise, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }), {
      expiresIn: expiresInSec,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return { url, method: "PUT" as const, headers: { "Content-Type": contentType }, expiresAt: new Date(Date.now() + expiresInSec * 1000) };
  }
  async stat(key: string) {
    assertKey(key);
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const r = await (await this.clientPromise).send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0) };
    } catch { return null; }
  }
  async read(key: string, maxBytes: number) {
    assertKey(key);
    const s = await this.stat(key);
    if (!s) throw new Error("Object not found");
    if (s.size > maxBytes) throw new Error("Object too large");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const r = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string) {
    assertKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async createReadUrl({ key, contentType, expiresInSec }: { key: string; contentType: string; expiresInSec: number }) {
    assertKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(await this.clientPromise, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: "inline" }), { expiresIn: expiresInSec });
  }
}

class UnconfiguredStorage implements StorageAdapter {
  readonly name = "none";
  private fail(): never { throw configError("File storage isn't configured on this server. Set STORAGE_DRIVER (see docs/deployment.md)."); }
  createUploadTarget(): Promise<UploadTarget> { return this.fail(); }
  stat(): Promise<{ size: number } | null> { return this.fail(); }
  read(): Promise<Buffer> { return this.fail(); }
  delete(): Promise<void> { return this.fail(); }
  createReadUrl(): Promise<string> { return this.fail(); }
}

let instance: StorageAdapter | undefined;
export function getStorage(): StorageAdapter {
  if (instance) return instance;
  const driver = env().STORAGE_DRIVER;
  if (driver === "local" && isProduction() && !env().ALLOW_LOCAL_STORAGE_IN_PRODUCTION) throw configError("Local disk storage is not allowed in production.");
  instance = driver === "local" ? new LocalStorage() : driver === "s3" ? new S3Storage() : new UnconfiguredStorage();
  return instance;
}
export function setStorageForTests(s: StorageAdapter | undefined) { instance = s; }
export function getLocalStorage(): LocalStorage {
  const s = getStorage();
  if (!(s instanceof LocalStorage)) throw configError("Local storage is not enabled.");
  return s;
}

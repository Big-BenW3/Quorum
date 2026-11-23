import "server-only";
import { z } from "zod";
import type { LimitSpec } from "@/server/http";
import { env } from "@/server/env";

/** Shared pieces for Route Handlers: rate-limit presets and common query schemas. */
export const ADMIN_READ: LimitSpec[] = [{ name: "admin-read", limit: 300, windowSec: 60, by: "user" }];
export const ADMIN_WRITE: LimitSpec[] = [{ name: "admin-write", limit: 120, windowSec: 60, by: "user" }];
export const ADMIN_HEAVY: LimitSpec[] = [{ name: "admin-heavy", limit: 20, windowSec: 60, by: "user" }];
export const PUBLIC_READ: LimitSpec[] = [{ name: "public-read", limit: 120, windowSec: 60 }];
export const verifyLimit = (): LimitSpec[] => [{ name: "verify", limit: env().VERIFY_PER_IP_PER_10MIN, windowSec: 600 }];
export const submitLimit = (): LimitSpec[] => [{ name: "submit", limit: env().SUBMIT_PER_IP_PER_10MIN, windowSec: 600 }];

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(5000).default(1),
  q: z.string().trim().max(100).optional(),
});

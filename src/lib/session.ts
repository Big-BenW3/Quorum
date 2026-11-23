import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";

export async function currentUser() {
  return getSessionUser(await headers());
}
/** For pages: send signed-out visitors to sign-in and bring them back afterwards. */
export async function requireUser(next?: string) {
  const user = await currentUser();
  if (!user) redirect(`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return user;
}
/** Only same-site relative paths are accepted as redirect targets. */
export const safeNext = (n: string | string[] | undefined) => (typeof n === "string" && /^\/(?!\/)[A-Za-z0-9/_\-?=&%.]*$/.test(n) ? n : "/app");

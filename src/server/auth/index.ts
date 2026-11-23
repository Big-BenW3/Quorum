import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import { env, isProduction } from "@/server/env";
import { mailIsConfigured, sendMail } from "@/server/adapters/mailer";

/**
 * Authentication is delegated to Better Auth (maintained library): password hashing (scrypt),
 * session tokens, cookie handling and origin checks are all theirs; we implement none of it.
 * Everything auth-related is reachable only through this module so the provider can be swapped.
 */

function build() {
  const e = env();
  const origins = [new URL(e.APP_URL).origin, ...(e.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])];
  return betterAuth({
    appName: e.APP_NAME,
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: origins,
    database: prismaAdapter(db, { provider: e.DATABASE_URL.startsWith("file:") ? "sqlite" : "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: e.MAIL_DRIVER === "resend",
      sendResetPassword: mailIsConfigured()
        ? async ({ user, url }) => sendMail({ to: user.email, subject: `Reset your ${e.APP_NAME} password`, text: `Use this link to choose a new password. It expires in one hour.\n\n${url}\n\nIf you didn't ask for this, ignore this email.` })
        : undefined,
    },
    emailVerification: mailIsConfigured()
      ? {
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          sendVerificationEmail: async ({ user, url }) => sendMail({ to: user.email, subject: `Confirm your ${e.APP_NAME} email`, text: `Confirm your email address:\n\n${url}` }),
        }
      : undefined,
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    advanced: {
      cookiePrefix: "quorum",
      useSecureCookies: isProduction(),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof build>;
let instance: Auth | undefined;
export function getAuth(): Auth {
  instance ??= build();
  return instance;
}

export type SessionUser = { id: string; email: string; name: string };

export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const s = await getAuth().api.getSession({ headers });
  return s ? { id: s.user.id, email: s.user.email, name: s.user.name } : null;
}

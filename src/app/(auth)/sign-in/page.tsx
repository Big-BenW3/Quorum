import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { currentUser, safeNext } from "@/lib/session";
import { mailIsConfigured } from "@/server/adapters/mailer";

export const metadata: Metadata = { title: "Sign in" };
export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return <AuthForm mode="sign-in" next={next} canReset={mailIsConfigured()} />;
}

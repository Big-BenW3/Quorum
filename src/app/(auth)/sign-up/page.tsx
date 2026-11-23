import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { currentUser, safeNext } from "@/lib/session";

export const metadata: Metadata = { title: "Create account" };
export default async function SignUp({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return <AuthForm mode="sign-up" next={next} canReset={false} />;
}

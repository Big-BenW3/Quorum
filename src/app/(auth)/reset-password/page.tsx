import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "@/components/auth/reset-forms";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Choose a new password" };
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token;
  if (!token) return <Notice tone="danger" title="This link isn't valid">Request a new one from the <Link className="underline underline-offset-4" href="/forgot-password">reset page</Link>.</Notice>;
  return <ResetForm token={token} />;
}

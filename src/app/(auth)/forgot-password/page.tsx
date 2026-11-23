import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "@/components/auth/reset-forms";
import { Notice } from "@/components/ui/misc";
import { mailIsConfigured } from "@/server/adapters/mailer";

export const metadata: Metadata = { title: "Reset password" };
export default function Forgot() {
  if (!mailIsConfigured()) {
    return (
      <div className="q-rise space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Can&apos;t sign in?</h1>
        <Notice tone="info" title="Email isn't set up on this server">Password reset works by email, so it isn&apos;t available here. Ask whoever runs this server to reset your password, or <Link className="underline underline-offset-4" href="/sign-up">create a new account</Link>.</Notice>
        <p className="text-sm text-muted-fg"><Link className="hover:text-fg" href="/sign-in">Back to sign in</Link></p>
      </div>
    );
  }
  return <ForgotForm />;
}

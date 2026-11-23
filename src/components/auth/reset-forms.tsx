"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";

export function ForgotForm() {
  const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setBusy(false);
    // Same answer whether or not the address has an account, so this form can't be used to find out who does.
    if (res.error && res.error.status === 429) setError(res.error.message ?? "Too many attempts."); else setSent(true);
  }
  if (sent) return <Notice tone="good" title="Check your email">If that address has an account, a reset link is on its way. It expires in an hour.</Notice>;
  return (
    <form onSubmit={submit} noValidate className="q-rise space-y-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1><p className="mt-1.5 text-sm text-muted-fg">Enter your email and we&apos;ll send you a link.</p></div>
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
      <Button type="submit" size="lg" loading={busy} className="w-full">Send reset link</Button>
      <p className="text-sm text-muted-fg"><Link className="hover:text-fg" href="/sign-in">Back to sign in</Link></p>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const pw = String(new FormData(e.currentTarget).get("password") ?? "");
    if (pw.length < 10) { setError("Use at least 10 characters."); return; }
    setBusy(true); setError(null);
    const res = await authClient.resetPassword({ newPassword: pw, token });
    setBusy(false);
    if (res.error) { setError("That link has expired or was already used. Request a new one."); return; }
    router.replace("/sign-in");
  }
  return (
    <form onSubmit={submit} noValidate className="q-rise space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="New password" hint="At least 10 characters.">{(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required />}</Field>
      <Button type="submit" size="lg" loading={busy} className="w-full">Save password</Button>
    </form>
  );
}

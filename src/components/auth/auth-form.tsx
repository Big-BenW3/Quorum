"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";

type Mode = "sign-in" | "sign-up";

export function AuthForm({ mode, next, canReset }: { mode: Mode; next: string; canReset: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const up = mode === "sign-up";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim(); const password = String(f.get("password") ?? ""); const name = String(f.get("name") ?? "").trim();
    const problems: Record<string, string> = {};
    if (up && name.length < 2) problems.name = "Enter your name.";
    if (!/^\S+@\S+\.\S+$/.test(email)) problems.email = "Enter a valid email address.";
    if (!password) problems.password = "Enter your password.";
    else if (up && password.length < 10) problems.password = "Use at least 10 characters.";
    setFields(problems); setError(null);
    if (Object.keys(problems).length) return;
    setBusy(true);
    const res = up ? await authClient.signUp.email({ name, email, password }) : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      setError(up ? res.error.message ?? "We couldn't create that account." : res.error.status === 429 ? res.error.message ?? "Too many attempts. Wait a few minutes." : "That email and password don't match. Check them and try again.");
      return;
    }
    if (up && !(res.data as { token?: string | null } | null)?.token) { setConfirm(true); return; }
    router.replace(next); router.refresh();
  }

  if (confirm) {
    return <Notice tone="good" title="Check your email">We sent a link to confirm your address. Open it, then <Link className="underline underline-offset-4" href="/sign-in">sign in</Link>.</Notice>;
  }
  return (
    <div className="q-rise">
      <h1 className="text-2xl font-semibold tracking-tight">{up ? "Create your account" : "Sign in"}</h1>
      <p className="mt-1.5 text-sm text-muted-fg">{up ? "You'll set up your organization next." : "Welcome back."}</p>
      <form onSubmit={submit} noValidate className="mt-7 space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        {up && <Field label="Your name" error={fields.name}>{(p) => <Input {...p} name="name" autoComplete="name" required />}</Field>}
        <Field label="Email" error={fields.email}>{(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" required />}</Field>
        <Field label="Password" error={fields.password} hint={up ? "At least 10 characters." : undefined}>{(p) => <Input {...p} name="password" type="password" autoComplete={up ? "new-password" : "current-password"} required />}</Field>
        <Button type="submit" size="lg" loading={busy} className="w-full">{up ? "Create account" : "Sign in"}</Button>
      </form>
      <div className="mt-6 flex items-center justify-between text-sm text-muted-fg">
        {up
          ? <p>Already have an account? <Link className="text-fg underline underline-offset-4" href={`/sign-in${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link></p>
          : <p>New here? <Link className="text-fg underline underline-offset-4" href={`/sign-up${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link></p>}
        {!up && <Link className="hover:text-fg" href="/forgot-password">{canReset ? "Forgot password?" : "Can't sign in?"}</Link>}
      </div>
    </div>
  );
}

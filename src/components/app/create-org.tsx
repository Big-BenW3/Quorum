"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";

export function CreateOrgForm({ first }: { first?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [fields, setFields] = useState<Record<string, string>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null); setFields({});
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    try {
      const { organization } = await api<{ organization: { id: string } }>("POST", "/api/orgs", { name });
      router.push(`/app/orgs/${organization.id}`); router.refresh();
    } catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.fields) setFields(err.fields); setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && !fields.name && <Notice tone="danger">{error}</Notice>}
      <Field label="Organization name" error={fields.name} hint={first ? "Your club, union, society or association. Voters will see this name." : undefined}>
        {(p) => <Input {...p} name="name" placeholder="e.g. Riverside Rowing Club" required minLength={2} maxLength={80} autoFocus />}
      </Field>
      <Button type="submit" loading={busy}>Create organization</Button>
    </form>
  );
}

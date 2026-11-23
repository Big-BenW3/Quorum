"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, Notice } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/dialog";
import { CopyField } from "@/components/ui/copy-field";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";

type Member = { userId: string; name: string; email: string; role: string; you: boolean };
type Invite = { id: string; email: string | null; role: string; expiresAt: Date };

export function MembersPanel({ orgId, orgName, isOwner, members, invites }: { orgId: string; orgName: string; isOwner: boolean; members: Member[]; invites: Invite[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = String(fd.get("email") ?? "").trim();
    setBusy(true); setError(null); setFields({}); setLink(null);
    try {
      const r = await api<{ link: string; emailed: boolean }>("POST", `/api/orgs/${orgId}/invites`, { ...(email ? { email } : {}), role: String(fd.get("role") ?? "ADMIN") });
      setLink({ url: r.link, emailed: r.emailed });
      form.reset(); router.refresh();
    } catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.fields) setFields(err.fields); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    try { await api("DELETE", `/api/orgs/${orgId}/invites/${id}`); toast.success("Invitation revoked"); router.refresh(); }
    catch (err) { toast.error(errorMessage(err)); }
  }

  return (
    <div className="space-y-8">
      {isOwner && (
        <Card>
          <CardHeader title="Invite a co-organizer" description="They sign in with their own account. Admins can run elections; owners can also publish results and manage members." />
          <CardBody>
            <form onSubmit={invite} noValidate className="grid gap-4 sm:grid-cols-[1fr_160px_auto] sm:items-end">
              <Field label="Email" optional error={fields.email} hint="Optional. If email isn’t set up, you copy the link yourself.">{(p) => <Input {...p} name="email" type="email" placeholder="name@example.org" autoComplete="off" />}</Field>
              <Field label="Role" error={fields.role}>{(p) => <Select {...p} name="role" defaultValue="ADMIN"><option value="ADMIN">Admin</option><option value="OWNER">Owner</option></Select>}</Field>
              <Button type="submit" loading={busy} className="sm:mb-[22px]">Create invitation</Button>
            </form>
            {error && !Object.keys(fields).length && <Notice tone="danger" className="mt-4">{error}</Notice>}
            {link && (
              <div className="q-pop mt-5 space-y-3">
                <Notice tone="good" title={link.emailed ? "Invitation emailed" : "Invitation ready"}>The link works once and expires in 7 days. We don’t store it, so copy it now{link.emailed ? " if you also want to send it yourself" : ""}.</Notice>
                <CopyField label="Invitation link" value={link.url} />
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="members-h">
        <h2 id="members-h" className="mb-3 text-lg font-semibold tracking-tight">Members</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.name}{m.you && <span className="ml-2 text-sm font-normal text-muted-fg">You</span>}</p>
                <p className="truncate text-sm text-muted-fg">{m.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={m.role === "OWNER" ? "accent" : "neutral"}>{m.role === "OWNER" ? "Owner" : "Admin"}</Badge>
                {(isOwner || m.you) && <Button variant="ghost" size="sm" onClick={() => setRemoving(m)}>{m.you ? "Leave" : "Remove"}</Button>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {isOwner && invites.length > 0 && (
        <section aria-labelledby="pending-h">
          <h2 id="pending-h" className="mb-3 text-lg font-semibold tracking-tight">Pending invitations</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div><p className="font-medium">{i.email ?? "Link invitation"}</p><p className="text-sm text-muted-fg">{i.role === "OWNER" ? "Owner" : "Admin"} · expires {formatDateTime(i.expiresAt)}</p></div>
                <Button variant="ghost" size="sm" onClick={() => revoke(i.id)}>Revoke</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={!!removing} onClose={() => setRemoving(null)} tone="danger"
        title={removing?.you ? `Leave ${orgName}?` : `Remove ${removing?.name}?`}
        description={removing?.you ? "You’ll lose access to this organization’s elections." : "They’ll lose access to this organization’s elections immediately. Past audit entries keep their name."}
        confirmLabel={removing?.you ? "Leave organization" : "Remove member"}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api("DELETE", `/api/orgs/${orgId}/members/${removing.userId}`);
            toast.success(removing.you ? "You left the organization" : "Member removed");
            setRemoving(null);
            if (removing.you) { router.replace("/app"); } 
            router.refresh();
          } catch (err) { toast.error(errorMessage(err)); setRemoving(null); }
        }}
      />
    </div>
  );
}

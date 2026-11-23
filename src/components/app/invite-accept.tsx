"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";

export function InviteAccept({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      {error && <Notice tone="danger">{error}</Notice>}
      <p className="text-sm text-muted-fg">You’re signed in as <span className="font-medium text-fg">{email}</span>. Accepting adds you to the organization with this account.</p>
      <Button size="lg" loading={busy} className="w-full" onClick={async () => {
        setBusy(true); setError(null);
        try { const r = await api<{ organizationId: string }>("POST", "/api/invites/accept", { token }); router.push(`/app/orgs/${r.organizationId}`); router.refresh(); }
        catch (e) { setError(errorMessage(e)); setBusy(false); }
      }}>Accept invitation</Button>
    </div>
  );
}

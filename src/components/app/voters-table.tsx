"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

type Voter = { id: string; label: string; group: string | null; addedAt: Date };

export function VotersTable({ electionId, rows, frozen, timezone }: { electionId: string; rows: Voter[]; frozen: boolean; timezone: string }) {
  const router = useRouter(); const toast = useToast();
  const [target, setTarget] = useState<Voter | null>(null);
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-muted-fg">
            <tr><th scope="col" className="px-5 py-2.5 font-medium">Voter</th><th scope="col" className="hidden px-5 py-2.5 font-medium sm:table-cell">Group</th><th scope="col" className="hidden px-5 py-2.5 font-medium md:table-cell">Added</th><th scope="col" className="w-24 px-5 py-2.5"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((v) => (
              <tr key={v.id}>
                <td className="px-5 py-3 font-medium">{v.label}</td>
                <td className="hidden px-5 py-3 text-muted-fg sm:table-cell">{v.group ?? "–"}</td>
                <td className="hidden px-5 py-3 text-muted-fg md:table-cell">{formatDate(v.addedAt, timezone)}</td>
                <td className="px-5 py-2 text-right"><Button variant="ghost" size="sm" disabled={frozen} onClick={() => setTarget(v)} aria-label={`Remove ${v.label}`}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} tone="danger" confirmLabel="Remove voter" title={`Remove ${target?.label}?`}
        description="They won’t be able to verify or vote. If they have already voted, their ballot stays counted."
        onConfirm={async () => {
          if (!target) return;
          try { await api("DELETE", `/api/elections/${electionId}/voters/${target.id}`); toast.success("Voter removed"); router.refresh(); }
          catch (e) { toast.error(errorMessage(e)); }
          setTarget(null);
        }} />
    </>
  );
}

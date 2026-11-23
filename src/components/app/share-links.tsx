"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/dialog";
import { CopyField } from "@/components/ui/copy-field";
import { useToast } from "@/components/ui/toast";

export function ShareLinks({ electionId, vote, results, canRotate, locked, resultsNote }: { electionId: string; vote: string; results: string; canRotate: boolean; locked: boolean; resultsNote: string }) {
  const router = useRouter();
  const toast = useToast();
  const [which, setWhich] = useState<null | "voter" | "results">(null);
  return (
    <Card>
      <CardHeader title="Links" description="Anyone with a link can open that page, so share each one only with the people it’s for." />
      <CardBody className="space-y-5">
        <div><CopyField label="Voting link" value={vote} /><p className="mt-1.5 text-sm text-muted-fg">Send this to voters.</p></div>
        <div><CopyField label="Results link" value={results} /><p className="mt-1.5 text-sm text-muted-fg">{resultsNote}</p></div>
        {canRotate && !locked && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="ghost" size="sm" onClick={() => setWhich("voter")}>Replace voting link</Button>
            <Button variant="ghost" size="sm" onClick={() => setWhich("results")}>Replace results link</Button>
          </div>
        )}
      </CardBody>
      <ConfirmDialog open={!!which} onClose={() => setWhich(null)} tone="danger" confirmLabel="Replace link"
        title={which === "voter" ? "Replace the voting link?" : "Replace the results link?"}
        description="The old link stops working immediately. Anyone you already sent it to will need the new one."
        onConfirm={async () => {
          try { await api("POST", `/api/elections/${electionId}/rotate-links`, { which }); toast.success("Link replaced"); setWhich(null); router.refresh(); }
          catch (e) { toast.error(errorMessage(e)); setWhich(null); }
        }} />
    </Card>
  );
}

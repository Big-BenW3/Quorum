import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/session";
import { loadElectionDetail } from "@/lib/loaders";
import { getAdminResults } from "@/server/domain/results";
import { ResultsView } from "@/components/results/results-view";
import { Locked } from "@/components/results/locked";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsPage({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params;
  const user = await requireUser(`/app/elections/${electionId}/results`);
  const e = await loadElectionDetail(user.id, electionId);
  const r = await getAdminResults(user, electionId);
  return (
    <div className="mx-auto max-w-3xl">
      {r.available ? (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-prose text-sm text-muted-fg">{e.status === "PUBLISHED" ? "These results are public." : e.status === "CLOSED" ? "Only organizers can see this until the results are published." : "Only organizers can see these live totals."}</p>
            <div className="flex gap-2">
              <LinkButton href={`/api/elections/${electionId}/report?format=csv`} variant="secondary" size="sm" prefetch={false}><Download className="size-4" />CSV</LinkButton>
              <LinkButton href={`/api/elections/${electionId}/report?format=json`} variant="secondary" size="sm" prefetch={false}><Download className="size-4" />JSON</LinkButton>
            </div>
          </div>
          <ResultsView payload={r} />
        </>
      ) : <Locked reason={r.reason} audience="admin" what="results" />}
    </div>
  );
}

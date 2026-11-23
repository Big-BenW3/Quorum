import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { loadElectionDetail, loadImport } from "@/lib/loaders";
import { ImportWorkspace } from "@/components/app/import-workspace";

export const metadata: Metadata = { title: "Review voters" };

export default async function ImportReviewPage({ params }: { params: Promise<{ electionId: string; importId: string }> }) {
  const { electionId, importId } = await params;
  const user = await requireUser(`/app/elections/${electionId}/voters/imports/${importId}`);
  const [e, imp] = await Promise.all([loadElectionDetail(user.id, electionId), loadImport(user.id, electionId, importId)]);
  return (
    <div className="mx-auto max-w-5xl">
      <ImportWorkspace electionId={e.id} initial={imp} fields={e.fields} frozen={e.rosterFrozen} />
    </div>
  );
}

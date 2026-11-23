import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { loadElectionDetail } from "@/lib/loaders";
import { env } from "@/server/env";
import { BallotEditor } from "@/components/app/ballot-editor";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Ballot" };

export default async function BallotPage({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params;
  const user = await requireUser(`/app/elections/${electionId}/ballot`);
  const e = await loadElectionDetail(user.id, electionId);
  return (
    <div className="mx-auto max-w-3xl">
      <BallotEditor electionId={e.id} positions={e.positions} editable={e.ballotEditable} maxImageBytes={env().MAX_IMAGE_BYTES} />
      {e.ballotEditable && e.problems.length > 0 && e.positions.length > 0 && (
        <Notice tone="warn" title="Still to fix" className="mt-6"><ul className="list-disc space-y-1 pl-4">{e.problems.filter((m) => !m.startsWith("Import")).map((m) => <li key={m}>{m}</li>)}</ul></Notice>
      )}
    </div>
  );
}

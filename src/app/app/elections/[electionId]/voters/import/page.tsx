import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { loadElectionDetail } from "@/lib/loaders";
import { ImportStart } from "@/components/app/import-start";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Add voters" };

export default async function ImportPage({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params;
  const user = await requireUser(`/app/elections/${electionId}/voters/import`);
  const e = await loadElectionDetail(user.id, electionId);
  if (!e.restricted) redirect(`/app/elections/${electionId}/voters`);
  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-2 text-sm text-muted-fg"><Link href={`/app/elections/${electionId}/voters`} className="hover:text-fg">Voters</Link></p>
      <h2 className="mb-2 text-2xl font-semibold tracking-tight">Add voters</h2>
      <p className="mb-8 max-w-prose text-[15px] leading-6 text-muted-fg">Voters will prove who they are with: <strong className="font-medium text-fg">{e.fields.map((f) => f.label).join(", ")}</strong>. Your file needs a column for each.</p>
      {e.rosterFrozen ? <Notice tone="warn" title="The voter list is locked">It locked 24 hours before voting starts, so voters can’t be added now.</Notice> : <ImportStart electionId={e.id} fields={e.fields} />}
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/session";
import { loadElectionDetail } from "@/lib/loaders";
import { ElectionNav } from "@/components/app/election-nav";
import { StatusBadge } from "@/components/app/status-badge";

export default async function ElectionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ electionId: string }> }) {
  const { electionId } = await params;
  const user = await requireUser(`/app/elections/${electionId}`);
  const e = await loadElectionDetail(user.id, electionId);
  return (
    <>
      <header className="mb-6">
        <p className="mb-2 text-sm text-muted-fg"><Link href={`/app/orgs/${e.organization.id}`} className="hover:text-fg">{e.organization.name}</Link></p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{e.title}</h1>
          <StatusBadge status={e.status} />
        </div>
      </header>
      <ElectionNav electionId={electionId} restricted={e.restricted} />
      {children}
    </>
  );
}

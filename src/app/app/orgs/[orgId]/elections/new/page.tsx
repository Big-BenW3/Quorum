import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { loadOrganization } from "@/lib/loaders";
import { NewElectionForm } from "@/components/app/new-election-form";

export const metadata: Metadata = { title: "New election" };

export default async function NewElectionPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser(`/app/orgs/${orgId}/elections/new`);
  const d = await loadOrganization(user.id, orgId);
  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-2 text-sm text-muted-fg"><Link href={`/app/orgs/${orgId}`} className="hover:text-fg">{d.organization.name}</Link></p>
      <h1 className="mb-8 text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">New election</h1>
      <NewElectionForm orgId={orgId} />
    </div>
  );
}

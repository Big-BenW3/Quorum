import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Vote } from "lucide-react";
import { requireUser } from "@/lib/session";
import { loadOrganization } from "@/lib/loaders";
import { MembersPanel } from "@/components/app/members-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { formatDateTime, num } from "@/lib/format";

export const metadata: Metadata = { title: "Organization" };

export default async function OrgPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { orgId } = await params;
  const { tab } = await searchParams;
  const user = await requireUser(`/app/orgs/${orgId}`);
  const d = await loadOrganization(user.id, orgId);
  const active = tab === "members" ? "members" : "elections";
  const tabs = [{ id: "elections", label: "Elections", href: `/app/orgs/${orgId}` }, { id: "members", label: `Members`, href: `/app/orgs/${orgId}?tab=members` }];
  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/app" className="hover:text-fg">Dashboard</Link>}
        title={d.organization.name}
        actions={<LinkButton href={`/app/orgs/${orgId}/elections/new`}><Plus className="size-4" />New election</LinkButton>}
      />
      <nav aria-label="Organization sections" className="mb-8 flex gap-6 border-b border-border">
        {tabs.map((t) => (
          <Link key={t.id} href={t.href} aria-current={active === t.id ? "page" : undefined}
            className={cn("-mb-px border-b-2 pb-3 text-sm font-medium transition-colors", active === t.id ? "border-fg text-fg" : "border-transparent text-muted-fg hover:text-fg")}>{t.label}</Link>
        ))}
      </nav>
      {active === "members" ? (
        <MembersPanel orgId={orgId} orgName={d.organization.name} isOwner={d.role === "OWNER"} members={d.members} invites={d.invites} />
      ) : d.elections.length === 0 ? (
        <EmptyState icon={<Vote className="size-5" />} title="No elections yet" action={<LinkButton href={`/app/orgs/${orgId}/elections/new`} size="sm">Create an election</LinkButton>}>A ballot, a voter list and a schedule are all it takes.</EmptyState>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {d.elections.map((e) => (
            <li key={e.id}>
              <Link href={`/app/elections/${e.id}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4 transition-colors hover:bg-muted/60">
                <div className="min-w-0"><p className="truncate font-medium">{e.title}</p><p className="mt-0.5 text-sm text-muted-fg">{e.startsAt ? `Starts ${formatDateTime(e.startsAt)}` : "No dates set"}{e.restricted ? ` · ${num(e.voters)} voters` : " · Open access"}{e.ballots > 0 ? ` · ${num(e.ballots)} ballots` : ""}</p></div>
                <StatusBadge status={e.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

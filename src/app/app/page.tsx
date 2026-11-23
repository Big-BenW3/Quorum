import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Vote } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getOrganization, listOrganizations } from "@/server/domain/org";
import { CreateOrgForm } from "@/components/app/create-org";
import { StatusBadge } from "@/components/app/status-badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui/misc";
import { formatDateTime, num } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser("/app");
  const orgs = await listOrganizations(user);
  if (orgs.length === 0) {
    return (
      <div className="mx-auto max-w-md pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Set up your organization</h1>
        <p className="mt-2 text-[15px] leading-6 text-muted-fg">Elections belong to an organization, so you can invite co-organizers later.</p>
        <Card className="mt-8"><CardBody><CreateOrgForm first /></CardBody></Card>
      </div>
    );
  }
  const details = await Promise.all(orgs.map((o) => getOrganization(user, o.id)));
  return (
    <>
      <PageHeader title="Elections" description="Everything you and your co-organizers are running." />
      <div className="space-y-12">
        {details.map((d) => (
          <section key={d.organization.id} aria-labelledby={`o-${d.organization.id}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 id={`o-${d.organization.id}`} className="text-lg font-semibold tracking-tight"><Link href={`/app/orgs/${d.organization.id}`} className="hover:underline underline-offset-4">{d.organization.name}</Link></h2>
              <div className="flex gap-2">
                <LinkButton href={`/app/orgs/${d.organization.id}?tab=members`} variant="ghost" size="sm">Members ({d.members.length})</LinkButton>
                <LinkButton href={`/app/orgs/${d.organization.id}/elections/new`} variant="secondary" size="sm"><Plus className="size-4" />New election</LinkButton>
              </div>
            </div>
            {d.elections.length === 0 ? (
              <EmptyState icon={<Vote className="size-5" />} title="No elections yet" action={<LinkButton href={`/app/orgs/${d.organization.id}/elections/new`} size="sm">Create the first one</LinkButton>}>Set up a ballot and a voter list, then open voting.</EmptyState>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {d.elections.map((e) => (
                  <li key={e.id}>
                    <Link href={`/app/elections/${e.id}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4 transition-colors hover:bg-muted/60">
                      <div className="min-w-0"><p className="truncate font-medium">{e.title}</p><p className="mt-0.5 text-sm text-muted-fg">{e.startsAt ? `Starts ${formatDateTime(e.startsAt)}` : "No dates set"}{e.restricted ? ` · ${num(e.voters)} voters` : " · Open to anyone with the link"}</p></div>
                      <StatusBadge status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <p className="text-sm text-muted-fg">Need another organization? <Link className="underline underline-offset-4 hover:text-fg" href="/app/orgs/new">Create one</Link>.</p>
      </div>
    </>
  );
}

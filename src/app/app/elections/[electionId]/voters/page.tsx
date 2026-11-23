import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { requireUser } from "@/lib/session";
import { loadElectionDetail } from "@/lib/loaders";
import { listImports, listVoters } from "@/server/domain/roster";
import { VotersTable } from "@/components/app/voters-table";
import { Badge, EmptyState, Notice } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { formatDateTime, num } from "@/lib/format";

export const metadata: Metadata = { title: "Voters" };
const OPEN_STATES = ["AWAITING_UPLOAD", "UPLOADED", "PARSING", "NEEDS_REVIEW", "FAILED", "CONFIRMING"];
const IMPORT_LABEL: Record<string, string> = { AWAITING_UPLOAD: "Upload not finished", UPLOADED: "Uploaded", PARSING: "Reading file", NEEDS_REVIEW: "Ready to review", FAILED: "Couldn’t read", CONFIRMING: "Importing", IMPORTED: "Imported", REJECTED: "Discarded" };

export default async function VotersPage({ params, searchParams }: { params: Promise<{ electionId: string }>; searchParams: Promise<{ page?: string; q?: string }> }) {
  const { electionId } = await params;
  const { page, q } = await searchParams;
  const user = await requireUser(`/app/elections/${electionId}/voters`);
  const e = await loadElectionDetail(user.id, electionId);
  if (!e.restricted) {
    return <EmptyState icon={<Users className="size-5" />} title="This election is open to anyone with the link" action={<LinkButton href={`/app/elections/${electionId}/settings`} variant="secondary" size="sm">Change who can vote</LinkButton>}>Open elections have no voter list. Switch to “only people on my list” in Settings if you want to import one.</EmptyState>;
  }
  const pageNo = Math.max(1, Math.min(5000, Number(page) || 1));
  const [list, imports] = await Promise.all([listVoters(user, electionId, { page: pageNo, q }), listImports(user, electionId)]);
  const pending = imports.filter((i) => OPEN_STATES.includes(i.status));
  const history = imports.filter((i) => !OPEN_STATES.includes(i.status)).slice(0, 5);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const href = (p: number) => `/app/elections/${electionId}/voters?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{num(list.total)} {list.total === 1 ? "voter" : "voters"}{q ? " match your search" : ""}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-fg">Voters are shown by name, or by a masked email if no name was given. The details they verify with are stored only as keyed hashes, so we can’t show them back.</p>
        </div>
        {!list.frozen && <LinkButton href={`/app/elections/${electionId}/voters/import`}>Add voters</LinkButton>}
      </div>

      {list.frozen && <Notice tone="info" title="The voter list is locked">It locks 24 hours before voting starts, so nobody can be added or removed while people are preparing to vote.</Notice>}

      {pending.length > 0 && (
        <section aria-labelledby="pend-h" className="space-y-3">
          <h3 id="pend-h" className="text-[15px] font-semibold">In progress</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {pending.map((i) => (
              <li key={i.id}><Link href={`/app/elections/${electionId}/voters/imports/${i.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-muted/60"><span className="min-w-0 truncate font-medium">{i.originalName}</span><Badge tone={i.status === "FAILED" ? "danger" : "accent"}>{IMPORT_LABEL[i.status]}</Badge></Link></li>
            ))}
          </ul>
        </section>
      )}

      {list.total === 0 && !q ? (
        <EmptyState icon={<Users className="size-5" />} title="No voters yet" action={!list.frozen ? <LinkButton href={`/app/elections/${electionId}/voters/import`} size="sm">Add your voter list</LinkButton> : undefined}>Upload a CSV, or paste or type the people who are allowed to vote.</EmptyState>
      ) : (
        <div className="space-y-4">
          <form action={`/app/elections/${electionId}/voters`} className="flex max-w-sm gap-2" role="search">
            <input name="q" defaultValue={q} placeholder="Search by name or group" aria-label="Search voters" className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm" />
            <button className="h-9 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted">Search</button>
          </form>
          {list.rows.length === 0 ? <p className="text-sm text-muted-fg">No voters match “{q}”.</p> : <VotersTable electionId={electionId} rows={list.rows} frozen={list.frozen} timezone={e.timezone} />}
          {pages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
              <span className="text-muted-fg">Page {pageNo} of {pages}</span>
              <div className="flex gap-2">
                {pageNo > 1 && <LinkButton href={href(pageNo - 1)} variant="secondary" size="sm">Previous</LinkButton>}
                {pageNo < pages && <LinkButton href={href(pageNo + 1)} variant="secondary" size="sm">Next</LinkButton>}
              </div>
            </nav>
          )}
        </div>
      )}

      {history.length > 0 && (
        <section aria-labelledby="hist-h" className="space-y-3">
          <h3 id="hist-h" className="text-[15px] font-semibold">Earlier imports</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-sm">
            {history.map((i) => <li key={i.id} className="flex items-center justify-between gap-4 px-5 py-3"><span className="min-w-0 truncate">{i.originalName}</span><span className="shrink-0 text-muted-fg">{IMPORT_LABEL[i.status]}{i.status === "IMPORTED" && i.stats?.imported !== undefined ? ` · ${num(i.stats.imported)} added` : ""} · {formatDateTime(i.createdAt, e.timezone)}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

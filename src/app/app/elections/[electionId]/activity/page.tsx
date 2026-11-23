import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { loadElectionDetail } from "@/lib/loaders";
import { listAudit } from "@/server/domain/views";
import { EmptyState } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Activity" };

const LABEL: Record<string, string> = {
  "election.created": "Created the election", "election.updated": "Changed settings", "election.rescheduled": "Changed the schedule", "election.scheduled": "Scheduled voting", "election.unscheduled": "Moved back to draft",
  "election.opened": "Opened voting", "election.closed": "Closed voting", "election.extended": "Extended voting", "election.published": "Published results", "election.deleted": "Deleted the election", "election.links_rotated": "Replaced a link",
  "ballot.position_added": "Added a position", "ballot.position_updated": "Edited a position", "ballot.position_removed": "Removed a position",
  "ballot.candidate_added": "Added a candidate", "ballot.candidate_updated": "Edited a candidate", "ballot.candidate_removed": "Removed a candidate", "ballot.candidate_text_corrected": "Fixed a typo",
  "roster.upload_requested": "Started a voter upload", "roster.upload_finalized": "Uploaded a voter file", "roster.parse_started": "Started reading the file", "roster.parse_completed": "Finished reading the file", "roster.parse_failed": "Couldn’t read the file",
  "roster.mapping_saved": "Matched columns", "roster.row_corrected": "Corrected a row", "roster.row_resolved": "Made a decision on a row", "roster.import_confirmed": "Added voters", "roster.import_rejected": "Discarded an import",
  "roster.voter_removed": "Removed a voter", "roster.frozen": "Locked the voter list", "report.downloaded": "Downloaded a report", "member.invited": "Invited a co-organizer", "member.joined": "Joined", "member.removed": "Removed a member",
  "system.sweep": "Routine cleanup",
};
const humanize = (a: string) => LABEL[a] ?? a.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());

function detail(a: string, m: Record<string, string | number | boolean | null> | null): string {
  if (!m) return "";
  if (a === "ballot.candidate_text_corrected" && m.reason) return `Reason: ${m.reason}`;
  if (a === "roster.import_confirmed") return `${m.imported ?? 0} added, ${m.skipped ?? 0} left out`;
  if (a === "report.downloaded") return String(m.format ?? "").toUpperCase();
  if (a === "election.links_rotated") return m.which === "both" ? "Voting and results links" : `${m.which} link`;
  if (a === "roster.frozen") return m.reason === "freeze_time_reached" ? "24 hours before opening" : "Voting starts within 24 hours";
  return "";
}

export default async function ActivityPage({ params, searchParams }: { params: Promise<{ electionId: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const { electionId } = await params; const { cursor } = await searchParams;
  const user = await requireUser(`/app/elections/${electionId}/activity`);
  const e = await loadElectionDetail(user.id, electionId);
  const log = await listAudit(user, electionId, { cursor, take: 40 });
  if (log.events.length === 0) return <EmptyState title="No activity yet">Everything organizers do on this election is recorded here.</EmptyState>;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p className="max-w-prose text-sm text-muted-fg">A record of what organizers did, newest first. It can’t be edited or deleted from the app. Voting itself is deliberately not logged here, so a vote can never be tied to a time or a person.</p>
      <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {log.events.map((ev) => (
          <li key={ev.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3.5">
            <div className="min-w-0"><p className="font-medium">{humanize(ev.action)}</p><p className="text-sm text-muted-fg">{ev.actor}{detail(ev.action, ev.metadata) ? ` · ${detail(ev.action, ev.metadata)}` : ""}</p></div>
            <time dateTime={new Date(ev.at).toISOString()} className="shrink-0 text-sm tabular-nums text-muted-fg">{formatDateTime(ev.at, e.timezone)}</time>
          </li>
        ))}
      </ol>
      {log.nextCursor && <LinkButton href={`/app/elections/${electionId}/activity?cursor=${log.nextCursor}`} variant="secondary" size="sm">Older activity</LinkButton>}
    </div>
  );
}

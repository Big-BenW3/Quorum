import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { loadElectionDetail } from "@/lib/loaders";
import { LifecyclePanel } from "@/components/app/lifecycle-panel";
import { ShareLinks } from "@/components/app/share-links";
import { Card, CardBody, DescriptionList } from "@/components/ui/misc";
import { plural } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

export default async function Overview({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params;
  const user = await requireUser(`/app/elections/${electionId}`);
  const e = await loadElectionDetail(user.id, electionId);
  const candidates = e.positions.reduce((n, p) => n + p.candidates.length, 0);
  const resultsNote = e.resultsDisclosure === "LIVE"
    ? "Shows live results while voting is open, and analytics after it closes."
    : "Shows nothing until you publish. Then it shows results and analytics.";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <LifecyclePanel
          id={e.id} status={e.status} timezone={e.timezone} startsAt={e.startsAt} endsAt={e.endsAt} openedAt={e.openedAt} closedAt={e.closedAt} publishedAt={e.publishedAt}
          rosterFreezeAt={e.rosterFreezeAt} rosterFrozen={e.rosterFrozen} ready={e.ready} problems={e.problems} role={e.role} restricted={e.restricted}
          autoPublish={e.autoPublish} resultsDisclosure={e.resultsDisclosure} publicResultsUrl={e.links.results}
        />
        <Card>
          <CardBody>
            <h2 className="mb-4 text-[15px] font-semibold tracking-tight">Summary</h2>
            <DescriptionList items={[
              { label: "Who can vote", value: e.restricted ? `${plural(e.voters, "person", "people")} on your list` : "Anyone with the voting link" },
              ...(e.restricted ? [{ label: "Voters prove who they are with", value: e.fields.map((f) => f.label).join(", ") }] : []),
              { label: "Ballot", value: `${plural(e.positions.length, "position")}, ${plural(candidates, "candidate")}` },
              { label: "Results are shown", value: e.resultsDisclosure === "LIVE" ? "Live while voting is open" : "After voting closes" },
              { label: "Time zone", value: e.timezone.replace(/_/g, " ") },
            ]} />
          </CardBody>
        </Card>
      </div>
      <ShareLinks electionId={e.id} vote={e.links.vote} results={e.links.results} canRotate={e.role === "OWNER"} locked={e.status === "CLOSED" || e.status === "PUBLISHED"} resultsNote={resultsNote} />
    </div>
  );
}

import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { loadElectionDetail } from "@/lib/loaders";
import { getTurnout } from "@/server/domain/turnout";
import { TurnoutBoard } from "@/components/app/turnout-board";
import { EmptyState } from "@/components/ui/misc";
import { Activity } from "lucide-react";

export const metadata: Metadata = { title: "Turnout" };

export default async function TurnoutPage({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params;
  const user = await requireUser(`/app/elections/${electionId}/turnout`);
  const e = await loadElectionDetail(user.id, electionId);
  if (e.status === "DRAFT" || e.status === "SCHEDULED") {
    return <EmptyState icon={<Activity className="size-5" />} title="Turnout starts when voting opens">Once the first person votes, you’ll see turnout, a live chart and who has yet to vote.</EmptyState>;
  }
  const t = await getTurnout(user, electionId);
  return <TurnoutBoard electionId={electionId} initial={JSON.parse(JSON.stringify(t))} timezone={e.timezone} />;
}

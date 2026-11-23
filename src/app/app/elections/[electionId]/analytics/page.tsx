import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { getAdminAnalytics } from "@/server/domain/results";
import { AnalyticsView } from "@/components/results/analytics-view";
import { Locked } from "@/components/results/locked";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params;
  const user = await requireUser(`/app/elections/${electionId}/analytics`);
  const r = await getAdminAnalytics(user, electionId);
  return r.available ? <AnalyticsView payload={r} /> : (
    <Locked reason={r.reason} audience="admin" what="analytics">
      {r.reason === "voting_open" && <LinkButton href={`/app/elections/${electionId}/turnout`} variant="secondary" size="sm">Watch live turnout</LinkButton>}
    </Locked>
  );
}

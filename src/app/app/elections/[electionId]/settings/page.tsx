import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { loadElectionDetail } from "@/lib/loaders";
import { SettingsForm } from "@/components/app/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params;
  const user = await requireUser(`/app/elections/${electionId}/settings`);
  const e = await loadElectionDetail(user.id, electionId);
  return (
    <div className="mx-auto max-w-2xl">
      <SettingsForm
        key={`${e.title}|${e.startsAt?.getTime()}|${e.endsAt?.getTime()}|${e.timezone}|${e.resultsDisclosure}|${e.autoPublish}|${e.tieRule}|${e.credentialTtlSeconds}|${e.restricted}|${JSON.stringify(e.fields)}|${e.description}`}
        editable={e.status === "DRAFT" || e.status === "SCHEDULED"}
        e={{ id: e.id, title: e.title, description: e.description, timezone: e.timezone, startsAt: e.startsAt, endsAt: e.endsAt, restricted: e.restricted, fields: e.fields, voters: e.voters, rosterFrozen: e.rosterFrozen, resultsDisclosure: e.resultsDisclosure, autoPublish: e.autoPublish, tieRule: e.tieRule, credentialTtlSeconds: e.credentialTtlSeconds, role: e.role, status: e.status }}
      />
    </div>
  );
}

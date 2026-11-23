import { Badge, type Tone } from "@/components/ui/misc";

const map: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "accent" },
  OPEN: { label: "Voting open", tone: "good" },
  CLOSED: { label: "Closed", tone: "warn" },
  PUBLISHED: { label: "Published", tone: "neutral" },
};
export function StatusBadge({ status }: { status: string }) {
  const s = map[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

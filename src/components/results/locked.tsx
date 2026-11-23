import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { Hidden } from "@/server/domain/results";
import { Card, CardBody } from "@/components/ui/misc";

const PUBLIC: Record<Hidden["reason"], string> = {
  not_started: "Voting hasn’t started yet.",
  voting_open: "Voting is still open. Results are shown once it closes.",
  awaiting_publication: "Voting has closed. The organizers haven’t published the results yet.",
};
const ADMIN: Record<Hidden["reason"], string> = {
  not_started: "Nothing to show yet. This fills in once voting opens.",
  voting_open: "Results are hidden while voting is open, as you chose in Settings. They unlock when voting closes.",
  awaiting_publication: "These aren’t available yet.",
};

export function Locked({ reason, audience, what, children }: { reason: Hidden["reason"]; audience: "admin" | "public"; what: "results" | "analytics"; children?: ReactNode }) {
  return (
    <Card><CardBody className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-fg" aria-hidden><Lock className="size-5" /></span>
      <h2 className="text-lg font-semibold tracking-tight">{what === "analytics" ? "Analytics aren’t available yet" : "Results aren’t available yet"}</h2>
      <p className="max-w-md text-[15px] leading-6 text-muted-fg">{audience === "public" ? PUBLIC[reason] : ADMIN[reason]}{what === "analytics" && audience === "admin" && reason !== "not_started" ? " Analytics are shown after voting ends." : ""}</p>
      {children}
    </CardBody></Card>
  );
}

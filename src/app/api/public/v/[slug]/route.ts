import { route } from "@/server/http";
import { PUBLIC_READ } from "@/server/routes";
import { getVoterElection } from "@/server/domain/voting";

export const GET = route("public.voter_info", { auth: "none", limits: PUBLIC_READ }, ({ params }) => getVoterElection(params.slug!));

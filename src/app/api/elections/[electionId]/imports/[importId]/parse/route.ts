import { route } from "@/server/http";
import { ADMIN_HEAVY } from "@/server/routes";
import { startParse } from "@/server/domain/roster";

export const maxDuration = 60;
export const POST = route("imports.parse", { auth: "user", limits: ADMIN_HEAVY }, ({ user, params }) => startParse(user, params.electionId!, params.importId!));

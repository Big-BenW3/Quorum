import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { removeVoter } from "@/server/domain/roster";

export const DELETE = route("voters.remove", { auth: "user", limits: ADMIN_WRITE }, async ({ user, params }) => { await removeVoter(user, params.electionId!, params.voterId!); });

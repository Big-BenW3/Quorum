import { route } from "@/server/http";
import { ADMIN_READ } from "@/server/routes";
import { getTurnout } from "@/server/domain/turnout";

export const GET = route("turnout.get", { auth: "user", limits: ADMIN_READ }, ({ user, params }) => getTurnout(user, params.electionId!));

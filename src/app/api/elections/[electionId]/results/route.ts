import { route } from "@/server/http";
import { ADMIN_READ } from "@/server/routes";
import { getAdminResults } from "@/server/domain/results";

export const GET = route("results.admin", { auth: "user", limits: ADMIN_READ }, ({ user, params }) => getAdminResults(user, params.electionId!));

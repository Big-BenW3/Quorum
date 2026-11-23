import { route } from "@/server/http";
import { ADMIN_READ } from "@/server/routes";
import { getAdminAnalytics } from "@/server/domain/results";

export const GET = route("analytics.admin", { auth: "user", limits: ADMIN_READ }, ({ user, params }) => getAdminAnalytics(user, params.electionId!));

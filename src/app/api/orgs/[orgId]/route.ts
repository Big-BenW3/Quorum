import { route } from "@/server/http";
import { ADMIN_READ } from "@/server/routes";
import { getOrganization } from "@/server/domain/org";

export const GET = route("orgs.get", { auth: "user", limits: ADMIN_READ }, ({ user, params }) => getOrganization(user, params.orgId!));

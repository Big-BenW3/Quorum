import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { removeMember } from "@/server/domain/org";

export const DELETE = route("members.remove", { auth: "user", limits: ADMIN_WRITE }, async ({ user, params }) => { await removeMember(user, params.orgId!, params.userId!); });

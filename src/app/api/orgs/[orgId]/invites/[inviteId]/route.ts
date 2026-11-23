import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { revokeInvite } from "@/server/domain/org";

export const DELETE = route("invites.revoke", { auth: "user", limits: ADMIN_WRITE }, async ({ user, params }) => { await revokeInvite(user, params.orgId!, params.inviteId!); });

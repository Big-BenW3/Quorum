import { route, created } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { createInvite, inviteInput } from "@/server/domain/org";

export const POST = route("invites.create", { auth: "user", body: inviteInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => created(await createInvite(user, params.orgId!, body)));

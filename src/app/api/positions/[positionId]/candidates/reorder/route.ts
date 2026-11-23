import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { orderInput, reorderCandidates } from "@/server/domain/ballot-config";

export const POST = route("candidates.reorder", { auth: "user", body: orderInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => { await reorderCandidates(user, params.positionId!, body.ids); });

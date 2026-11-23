import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { orderInput, reorderPositions } from "@/server/domain/ballot-config";

export const POST = route("positions.reorder", { auth: "user", body: orderInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => { await reorderPositions(user, params.electionId!, body.ids); });

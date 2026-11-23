import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { positionUpdateInput, removePosition, updatePosition } from "@/server/domain/ballot-config";

export const PATCH = route("positions.update", { auth: "user", body: positionUpdateInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => ({ position: await updatePosition(user, params.positionId!, body) }));
export const DELETE = route("positions.remove", { auth: "user", limits: ADMIN_WRITE }, async ({ user, params }) => { await removePosition(user, params.positionId!); });

import { route, created } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { addPosition, positionCreateInput } from "@/server/domain/ballot-config";

export const POST = route("positions.create", { auth: "user", body: positionCreateInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => created({ position: await addPosition(user, params.electionId!, body) }));

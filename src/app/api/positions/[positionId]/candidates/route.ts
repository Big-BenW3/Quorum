import { route, created } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { addCandidate, candidateCreateInput } from "@/server/domain/ballot-config";

export const POST = route("candidates.create", { auth: "user", body: candidateCreateInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => created({ candidate: await addCandidate(user, params.positionId!, body) }));

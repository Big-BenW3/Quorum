import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { candidateUpdateInput, removeCandidate, updateCandidate } from "@/server/domain/ballot-config";

export const PATCH = route("candidates.update", { auth: "user", body: candidateUpdateInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => ({ candidate: await updateCandidate(user, params.candidateId!, body) }));
export const DELETE = route("candidates.remove", { auth: "user", limits: ADMIN_WRITE }, async ({ user, params }) => { await removeCandidate(user, params.candidateId!); });

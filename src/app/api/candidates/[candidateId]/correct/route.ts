import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { correctCandidateText, correctionInput } from "@/server/domain/ballot-config";

/** The one audited exception to "the ballot is locked once voting starts": fixing a typo in a name or bio. */
export const POST = route("candidates.correct", { auth: "user", body: correctionInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => ({ candidate: await correctCandidateText(user, params.candidateId!, body) }));

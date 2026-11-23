import { route } from "@/server/http";
import { submitLimit } from "@/server/routes";
import { submitBallot, submitInput } from "@/server/domain/voting";
import { deviceCookie } from "@/server/device";

export const POST = route("public.submit", { auth: "none", body: submitInput, limits: submitLimit }, async ({ req, params, body }) =>
  submitBallot({ slug: params.slug!, credential: body.credential, selections: body.selections, deviceId: deviceCookie(req).id }));

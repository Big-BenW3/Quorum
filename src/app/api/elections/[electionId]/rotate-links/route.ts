import { z } from "zod";
import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { rotateLinks } from "@/server/domain/election";
import { getElectionDetail } from "@/server/domain/views";

export const POST = route("elections.rotate_links", { auth: "user", body: z.strictObject({ which: z.enum(["voter", "results", "both"]) }), limits: ADMIN_WRITE }, async ({ user, params, body }) => {
  await rotateLinks(user, params.electionId!, body.which);
  return getElectionDetail(user, params.electionId!);
});

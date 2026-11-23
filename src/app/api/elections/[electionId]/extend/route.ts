import { z } from "zod";
import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { extendVoting } from "@/server/domain/election";
import { getElectionDetail } from "@/server/domain/views";

const body = z.strictObject({ endsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)) });
export const POST = route("elections.extend", { auth: "user", body, limits: ADMIN_WRITE }, async ({ user, params, body }) => {
  await extendVoting(user, params.electionId!, body.endsAt);
  return getElectionDetail(user, params.electionId!);
});

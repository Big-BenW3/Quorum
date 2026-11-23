import { z } from "zod";
import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { transitionElection } from "@/server/domain/election";
import { getElectionDetail } from "@/server/domain/views";

const body = z.strictObject({ action: z.enum(["schedule", "unschedule", "open", "close", "publish"]), endsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)).optional() });
export const POST = route("elections.transition", { auth: "user", body, limits: ADMIN_WRITE }, async ({ user, params, body }) => {
  await transitionElection(user, params.electionId!, body.action, { endsAt: body.endsAt });
  return getElectionDetail(user, params.electionId!);
});

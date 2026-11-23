import { route, created } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { createElection, createElectionInput } from "@/server/domain/election";

export const POST = route("elections.create", { auth: "user", body: createElectionInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => {
  const e = await createElection(user, params.orgId!, body);
  return created({ election: { id: e.id, title: e.title, status: e.status } });
});

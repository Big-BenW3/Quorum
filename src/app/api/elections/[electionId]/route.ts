import { route } from "@/server/http";
import { ADMIN_READ, ADMIN_WRITE } from "@/server/routes";
import { deleteDraftElection, updateElection, updateElectionInput } from "@/server/domain/election";
import { getElectionDetail } from "@/server/domain/views";
import { deleteUploadObject } from "@/server/domain/uploads";

export const GET = route("elections.get", { auth: "user", limits: ADMIN_READ }, ({ user, params }) => getElectionDetail(user, params.electionId!));
export const PATCH = route("elections.update", { auth: "user", body: updateElectionInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => {
  await updateElection(user, params.electionId!, body);
  return getElectionDetail(user, params.electionId!);
});
export const DELETE = route("elections.delete", { auth: "user", limits: ADMIN_WRITE }, async ({ user, params }) => {
  const { uploadIds } = await deleteDraftElection(user, params.electionId!);
  // Best effort: if the storage provider fails, the error is logged and the private, unreferenced object stays in the bucket.
  for (const id of uploadIds) await deleteUploadObject(id);
});

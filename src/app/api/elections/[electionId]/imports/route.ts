import { route, created } from "@/server/http";
import { ADMIN_READ, ADMIN_WRITE } from "@/server/routes";
import { listImports, requestRosterUpload, rosterUploadInput } from "@/server/domain/roster";

export const GET = route("imports.list", { auth: "user", limits: ADMIN_READ }, async ({ user, params }) => ({ imports: await listImports(user, params.electionId!) }));
export const POST = route("imports.request", { auth: "user", body: rosterUploadInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => created(await requestRosterUpload(user, params.electionId!, body)));

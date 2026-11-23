import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { finalizeRosterUpload } from "@/server/domain/roster";

export const POST = route("imports.finalize", { auth: "user", limits: ADMIN_WRITE }, ({ user, params }) => finalizeRosterUpload(user, params.electionId!, params.importId!));

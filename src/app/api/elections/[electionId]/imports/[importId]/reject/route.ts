import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { rejectImport } from "@/server/domain/roster";

export const POST = route("imports.reject", { auth: "user", limits: ADMIN_WRITE }, ({ user, params }) => rejectImport(user, params.electionId!, params.importId!));

import { route } from "@/server/http";
import { ADMIN_HEAVY } from "@/server/routes";
import { confirmImport } from "@/server/domain/roster";

export const maxDuration = 60;
export const POST = route("imports.confirm", { auth: "user", limits: ADMIN_HEAVY }, ({ user, params }) => confirmImport(user, params.electionId!, params.importId!));

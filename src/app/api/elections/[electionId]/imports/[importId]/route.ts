import { route } from "@/server/http";
import { ADMIN_READ } from "@/server/routes";
import { getImport } from "@/server/domain/roster";

export const GET = route("imports.get", { auth: "user", limits: ADMIN_READ }, ({ user, params }) => getImport(user, params.electionId!, params.importId!));

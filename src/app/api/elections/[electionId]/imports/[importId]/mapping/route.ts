import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { mappingInput, saveMapping } from "@/server/domain/roster";

export const PUT = route("imports.mapping", { auth: "user", body: mappingInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => ({ stats: await saveMapping(user, params.electionId!, params.importId!, body.mapping) }));

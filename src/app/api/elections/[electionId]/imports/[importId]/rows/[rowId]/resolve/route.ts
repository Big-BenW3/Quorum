import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { resolveRow, rowResolveInput } from "@/server/domain/roster";

export const POST = route("imports.resolve_row", { auth: "user", body: rowResolveInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => ({ stats: await resolveRow(user, params.electionId!, params.importId!, params.rowId!, body.action) }));

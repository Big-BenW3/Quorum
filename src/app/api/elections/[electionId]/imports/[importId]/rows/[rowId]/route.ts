import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { correctRow, rowCorrectionInput } from "@/server/domain/roster";

export const PATCH = route("imports.correct_row", { auth: "user", body: rowCorrectionInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => ({ stats: await correctRow(user, params.electionId!, params.importId!, params.rowId!, body.cells) }));

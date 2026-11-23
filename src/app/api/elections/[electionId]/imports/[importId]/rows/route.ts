import { z } from "zod";
import { route, created } from "@/server/http";
import { ADMIN_READ, ADMIN_WRITE } from "@/server/routes";
import { addRow, addRowInput, listImportRows } from "@/server/domain/roster";

const query = z.object({
  page: z.coerce.number().int().min(1).max(5000).default(1),
  status: z.enum(["OK", "WARNING", "ERROR", "DUPLICATE", "AMBIGUOUS", "SKIPPED"]).optional(),
});
export const GET = route("imports.rows", { auth: "user", query, limits: ADMIN_READ }, ({ user, params, query }) => listImportRows(user, params.electionId!, params.importId!, query));
export const POST = route("imports.add_row", { auth: "user", body: addRowInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => created({ stats: await addRow(user, params.electionId!, params.importId!, body.cells) }));

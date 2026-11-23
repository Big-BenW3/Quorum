import { z } from "zod";
import { route, created } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { createManualImport } from "@/server/domain/roster";

// Pasted CSV can be large, but stays well under the roster file limit.
export const POST = route("imports.manual", { auth: "user", body: z.strictObject({ csv: z.string().max(1_000_000).optional() }), maxBodyBytes: 1_100_000, limits: ADMIN_WRITE }, async ({ user, params, body }) => created(await createManualImport(user, params.electionId!, body)));

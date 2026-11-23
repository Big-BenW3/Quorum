import { z } from "zod";
import { route } from "@/server/http";
import { ADMIN_READ } from "@/server/routes";
import { listAudit } from "@/server/domain/views";

export const GET = route("audit.list", { auth: "user", query: z.object({ cursor: z.string().max(64).optional() }), limits: ADMIN_READ }, ({ user, params, query }) => listAudit(user, params.electionId!, query));

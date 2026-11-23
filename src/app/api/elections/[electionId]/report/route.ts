import { z } from "zod";
import { route } from "@/server/http";
import { ADMIN_HEAVY } from "@/server/routes";
import { buildReport } from "@/server/domain/results";

export const GET = route("report.download", { auth: "user", query: z.object({ format: z.enum(["csv", "json"]).default("csv") }), limits: ADMIN_HEAVY }, async ({ user, params, query }) => {
  const r = await buildReport(user, params.electionId!, query.format);
  return new Response(r.body, { headers: { "Content-Type": r.contentType, "Content-Disposition": `attachment; filename="${r.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
});

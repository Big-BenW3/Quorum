import { z } from "zod";
import { route } from "@/server/http";
import { ADMIN_READ, pageQuery } from "@/server/routes";
import { rollCall } from "@/server/domain/turnout";

const query = pageQuery.extend({ state: z.enum(["NOT_VOTED", "VERIFIED", "VOTED"]).optional() });
export const GET = route("rollcall.list", { auth: "user", query, limits: ADMIN_READ }, ({ user, params, query }) => rollCall(user, params.electionId!, query));

import { route } from "@/server/http";
import { ADMIN_READ, pageQuery } from "@/server/routes";
import { listVoters } from "@/server/domain/roster";

export const GET = route("voters.list", { auth: "user", query: pageQuery, limits: ADMIN_READ }, ({ user, params, query }) => listVoters(user, params.electionId!, query));

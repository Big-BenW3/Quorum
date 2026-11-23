import { route, created } from "@/server/http";
import { ADMIN_READ, ADMIN_WRITE } from "@/server/routes";
import { createOrgInput, createOrganization, listOrganizations } from "@/server/domain/org";

export const GET = route("orgs.list", { auth: "user", limits: ADMIN_READ }, async ({ user }) => ({ organizations: await listOrganizations(user) }));
export const POST = route("orgs.create", { auth: "user", body: createOrgInput, limits: ADMIN_WRITE }, async ({ user, body }) => created({ organization: await createOrganization(user, body) }));

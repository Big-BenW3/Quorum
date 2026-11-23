import { z } from "zod";
import { route } from "@/server/http";
import { acceptInvite } from "@/server/domain/org";

export const POST = route(
  "invites.accept",
  { auth: "user", body: z.strictObject({ token: z.string().min(20).max(100) }), limits: [{ name: "invite-accept", limit: 20, windowSec: 600 }] },
  ({ user, body }) => acceptInvite(user, body.token),
);

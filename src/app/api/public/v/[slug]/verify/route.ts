import { route, json } from "@/server/http";
import { verifyLimit } from "@/server/routes";
import { findByVoterSlug } from "@/server/domain/election";
import { verifyInput, verifyVoter } from "@/server/domain/voting";
import { deviceCookie } from "@/server/device";

export const POST = route("public.verify", { auth: "none", body: verifyInput, limits: verifyLimit }, async ({ req, params, body }) => {
  const e = await findByVoterSlug(params.slug!);
  // A device cookie exists only for open-access elections, where it is the (weak) one-ballot-per-browser guard.
  const device = e?.eligibilityMode === "OPEN" ? deviceCookie(req) : { id: null, setCookie: null };
  const issued = await verifyVoter({ slug: params.slug!, values: body.values, deviceId: device.id });
  return json(issued, { headers: device.setCookie ? { "Set-Cookie": device.setCookie } : {} });
});

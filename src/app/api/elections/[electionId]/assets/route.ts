import { route, created } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { assetRequestInput, requestAssetUpload } from "@/server/domain/uploads";

export const POST = route("assets.request", { auth: "user", body: assetRequestInput, limits: ADMIN_WRITE }, async ({ user, params, body }) => created(await requestAssetUpload(user, params.electionId!, body)));

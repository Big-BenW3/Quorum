import { route } from "@/server/http";
import { ADMIN_WRITE } from "@/server/routes";
import { finalizeAssetUpload } from "@/server/domain/uploads";

export const POST = route("assets.finalize", { auth: "user", limits: ADMIN_WRITE }, ({ user, params }) => finalizeAssetUpload(user, params.electionId!, params.uploadId!));

import { route } from "@/server/http";
import { PUBLIC_READ } from "@/server/routes";
import { getPublicAnalytics } from "@/server/domain/results";

export const GET = route("public.analytics", { auth: "none", limits: PUBLIC_READ }, ({ params }) => getPublicAnalytics(params.slug!));

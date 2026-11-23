import { route } from "@/server/http";
import { PUBLIC_READ } from "@/server/routes";
import { getPublicResults } from "@/server/domain/results";

export const GET = route("public.results", { auth: "none", limits: PUBLIC_READ }, ({ params }) => getPublicResults(params.slug!));

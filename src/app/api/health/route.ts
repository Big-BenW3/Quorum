/** Liveness only. Deliberately reveals nothing about configuration, versions or data. */
export const dynamic = "force-dynamic";
export const GET = () => Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });

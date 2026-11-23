import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { InviteAccept } from "@/components/app/invite-accept";

export const metadata: Metadata = { title: "Join an organization", robots: { index: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser(`/invite/${token}`);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">You’ve been invited</h1>
      <p className="mb-8 mt-2 text-[15px] leading-6 text-muted-fg">Join an organization to help run its elections.</p>
      <InviteAccept token={token} email={user.email} />
    </>
  );
}

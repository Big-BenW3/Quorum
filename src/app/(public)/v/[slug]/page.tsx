import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getVoterElection } from "@/server/domain/voting";
import { AppError } from "@/server/errors";
import { VoterFlow } from "@/components/voter/voter-flow";

export const dynamic = "force-dynamic";
// The link itself is the credential to open this page: keep it out of search indexes and Referer headers.
export const metadata: Metadata = { title: "Vote", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function VotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let info;
  try { info = await getVoterElection(slug); }
  catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  return <VoterFlow slug={slug} info={info} />;
}

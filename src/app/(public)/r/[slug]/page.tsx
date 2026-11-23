import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicAnalytics, getPublicResults } from "@/server/domain/results";
import { AppError } from "@/server/errors";
import { ResultsView } from "@/components/results/results-view";
import { AnalyticsView } from "@/components/results/analytics-view";
import { Locked } from "@/components/results/locked";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Results", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PublicResults({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let results, analytics;
  try { [results, analytics] = await Promise.all([getPublicResults(slug), getPublicAnalytics(slug)]); }
  catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const el = results.election;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{el.title}</h1>
        {results.available && <p className="mt-2 text-sm text-muted-fg">{el.status === "OPEN" ? "Live totals. Voting is still open." : el.closedAt ? `Voting closed ${formatDateTime(el.closedAt, el.timezone)}.` : ""}</p>}
      </header>
      {!results.available ? <Locked reason={results.reason} audience="public" what="results" /> : (
        <div className="space-y-14">
          <section aria-labelledby="res-h"><h2 id="res-h" className="mb-5 text-lg font-semibold tracking-tight">Results</h2><ResultsView payload={results} /></section>
          {analytics.available && <section aria-labelledby="ana-h"><h2 id="ana-h" className="mb-5 text-lg font-semibold tracking-tight">Turnout and analytics</h2><AnalyticsView payload={analytics} /></section>}
        </div>
      )}
    </div>
  );
}

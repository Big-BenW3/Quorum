import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center px-5"><Wordmark /></header>
      <main id="main" className="flex flex-1 items-center justify-center px-5 pb-24">
        <div className="max-w-sm text-center">
          <h1 className="text-2xl font-semibold tracking-tight">We can’t find that page</h1>
          <p className="mt-3 text-[15px] leading-6 text-muted-fg">The link may be wrong, replaced by the organizers, or from an election that no longer exists. Check it and try again.</p>
          <Link href="/" className="mt-6 inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted">Go to the home page</Link>
        </div>
      </main>
    </div>
  );
}

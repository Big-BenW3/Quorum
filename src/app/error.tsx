"use client";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("ui.error", error.digest ?? "no-digest"); }, [error]);
  return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <div className="max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-3 text-[15px] leading-6 text-muted-fg">That didn’t work, and it’s not something you did. Your data is safe. Try again, and if it keeps happening, tell the organizers{error.digest ? ` and quote ${error.digest}` : ""}.</p>
        <button onClick={reset} className="mt-6 inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted">Try again</button>
      </div>
    </div>
  );
}

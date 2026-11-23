"use client";

/** Last-resort boundary: renders without the app's providers or styles, so it stays plain on purpose. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", minHeight: "100dvh", placeItems: "center", margin: 0, padding: 24 }}>
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#666", lineHeight: 1.6 }}>Try again in a moment.</p>
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}

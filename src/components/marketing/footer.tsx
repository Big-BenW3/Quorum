import Link from "next/link";
import { Wordmark } from "@/components/brand";

export function SiteFooter() {
  return (
    <footer className="relative mt-32 overflow-hidden border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-6 pt-14 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-sm leading-6 text-muted-fg">Self-service elections for clubs, unions, associations and student bodies. Not certified for statutory or regulated elections.</p>
        </div>
        <nav aria-label="Product" className="text-sm">
          <p className="font-medium">Product</p>
          <ul className="mt-3 space-y-2 text-muted-fg">
            <li><Link className="hover:text-fg" href="/#how">How it works</Link></li>
            <li><Link className="hover:text-fg" href="/#principles">Principles</Link></li>
            <li><Link className="hover:text-fg" href="/sign-up">Create an account</Link></li>
          </ul>
        </nav>
        <nav aria-label="Trust" className="text-sm">
          <p className="font-medium">Trust</p>
          <ul className="mt-3 space-y-2 text-muted-fg">
            <li><Link className="hover:text-fg" href="/security">Security &amp; privacy limits</Link></li>
            <li><Link className="hover:text-fg" href="/sign-in">Sign in</Link></li>
          </ul>
        </nav>
      </div>
      {/* Oversized wordmark, cropped by the page edge. Decorative: hidden from assistive tech. */}
      <div aria-hidden className="pointer-events-none select-none px-5">
        <p className="mx-auto max-w-6xl translate-y-[22%] text-[clamp(7rem,26vw,22rem)] font-semibold leading-[.8] tracking-[-0.06em] text-muted">Quorum</p>
      </div>
    </footer>
  );
}

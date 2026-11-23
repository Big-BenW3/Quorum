import Link from "next/link";
import { cn } from "@/lib/cn";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M9.5 16.5l4.3 4.3L22.5 11.5" fill="none" stroke="var(--primary-fg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <Mark /><span className="text-[17px]">Quorum</span>
    </Link>
  );
}

import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { LinkButton } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme";
import { currentUser } from "@/lib/session";

const links = [
  { href: "/#how", label: "How it works" },
  { href: "/#principles", label: "Principles" },
  { href: "/security", label: "Security & limits" },
];

export async function SiteHeader() {
  const user = await currentUser().catch(() => null);
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5">
        <Wordmark />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((l) => <Link key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm text-muted-fg transition-colors hover:text-fg">{l.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <LinkButton href="/app" size="md">Open dashboard</LinkButton>
          ) : (
            <>
              <LinkButton href="/sign-in" variant="ghost" className="hidden sm:inline-flex">Sign in</LinkButton>
              <LinkButton href="/sign-up">Get started</LinkButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

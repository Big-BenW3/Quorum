import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/ui/theme";
import { UserMenu } from "@/components/app/user-menu";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/app");
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Wordmark href="/app" />
          <div className="flex items-center gap-1.5"><ThemeToggle /><UserMenu name={user.name} email={user.email} /></div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-5 py-10">{children}</main>
    </div>
  );
}

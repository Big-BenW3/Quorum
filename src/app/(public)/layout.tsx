import { Mark } from "@/components/brand";
import { ThemeToggle } from "@/components/ui/theme";

/** Voters and result readers get a quiet, focused frame: no app navigation, nothing to get lost in. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between px-5"><span className="flex items-center gap-2.5 text-sm text-muted-fg"><Mark className="size-6" />Quorum</span><ThemeToggle /></header>
      <main id="main" className="flex-1 px-5 pb-20 pt-6 sm:pt-12">{children}</main>
      <footer className="px-5 pb-6 text-center text-sm text-muted-fg">Votes are counted by software and the result is not certified for statutory or regulated elections.</footer>
    </div>
  );
}

import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/ui/theme";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between px-5"><Wordmark /><ThemeToggle /></header>
      <main id="main" className="flex flex-1 items-start justify-center px-5 pb-20 pt-10 sm:pt-20">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="px-5 pb-6 text-center text-sm text-muted-fg">
        <Link href="/security" className="hover:text-fg">Security &amp; limits</Link>
      </footer>
    </div>
  );
}

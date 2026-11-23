"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function ElectionNav({ electionId, restricted }: { electionId: string; restricted: boolean }) {
  const path = usePathname();
  const base = `/app/elections/${electionId}`;
  const items = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/ballot`, label: "Ballot" },
    ...(restricted ? [{ href: `${base}/voters`, label: "Voters" }] : []),
    { href: `${base}/settings`, label: "Settings" },
    { href: `${base}/turnout`, label: "Turnout" },
    { href: `${base}/results`, label: "Results" },
    { href: `${base}/analytics`, label: "Analytics" },
    { href: `${base}/activity`, label: "Activity" },
  ];
  return (
    <nav aria-label="Election sections" className="-mx-5 mb-8 overflow-x-auto border-b border-border px-5 [scrollbar-width:none]">
      <ul className="flex min-w-max gap-6">
        {items.map((i) => {
          const active = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={active ? "page" : undefined}
                className={cn("-mb-px block border-b-2 pb-3 text-sm font-medium transition-colors", active ? "border-fg text-fg" : "border-transparent text-muted-fg hover:text-fg")}>{i.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

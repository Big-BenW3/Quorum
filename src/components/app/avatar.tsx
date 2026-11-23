import { cn } from "@/lib/cn";

export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className={cn("size-10 shrink-0 rounded-full border border-border object-cover", className)} />
    : <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-fg", className)}>{initials}</span>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="grid size-9 place-items-center rounded-full border border-border bg-card text-xs font-semibold transition-colors hover:bg-muted" aria-label="Account menu">{initials}</button>
      {open && (
        <div role="menu" className="q-pop absolute right-0 top-11 z-40 w-64 rounded-lg border border-border bg-card p-1.5 shadow-lg">
          <div className="px-2.5 py-2"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-sm text-muted-fg">{email}</p></div>
          <div className="my-1 h-px bg-border" />
          <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
            onClick={async () => { await authClient.signOut(); router.replace("/"); router.refresh(); }}><LogOut className="size-4 text-muted-fg" />Sign out</button>
        </div>
      )}
    </div>
  );
}

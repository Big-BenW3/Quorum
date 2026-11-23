"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

/** Light / dark. Stored in a cookie so the server renders the right class and nothing flashes. */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button type="button" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} className={cn("inline-flex size-9 items-center justify-center rounded-md text-muted-fg transition-colors hover:bg-muted hover:text-fg", className)}
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        document.cookie = `theme=${next ? "dark" : "light"}; Path=/; Max-Age=31536000; SameSite=Lax`;
        setDark(next);
      }}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

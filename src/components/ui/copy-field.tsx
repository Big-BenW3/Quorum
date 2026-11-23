"use client";
import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const input = useRef<HTMLInputElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied"); setTimeout(() => setState("idle"), 1800);
    } catch {
      // Clipboard blocked (permissions or an insecure page): select the link so Ctrl/⌘+C works, and say so.
      input.current?.focus(); input.current?.select();
      setState("manual"); setTimeout(() => setState("idle"), 4000);
    }
  }
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <input ref={input} readOnly aria-label={label} value={value} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-muted px-3 font-mono text-[13px] text-fg" />
        <Button variant="secondary" size="md" onClick={copy}>
          {state === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />}{state === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="sr-only" role="status">{state === "copied" ? `${label} copied` : state === "manual" ? "Selected. Press Ctrl or Command C to copy." : ""}</p>
      {state === "manual" && <p className="mt-1.5 text-sm text-muted-fg" aria-hidden>Selected. Press Ctrl+C (or ⌘C) to copy.</p>}
    </div>
  );
}

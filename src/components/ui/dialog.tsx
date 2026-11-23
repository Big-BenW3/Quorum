"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/cn";

/** Native <dialog>: focus trap, Escape and inert background come from the browser. */
export function Dialog({ open, onClose, title, description, children, className, locked }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; className?: string; /** While true (a request is running) the dialog can't be dismissed. */ locked?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { if (locked) e.preventDefault(); }} onClick={(e) => { if (e.target === ref.current && !locked) onClose(); }}
      className={cn("q-dialog m-auto w-[min(92vw,30rem)] rounded-xl border border-border bg-card p-0 text-fg shadow-xl backdrop:bg-black/40", className)} aria-labelledby="dlg-title">
      {open && (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="dlg-title" className="text-lg font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-1.5 text-sm leading-6 text-muted-fg">{description}</p>}
            </div>
            <button type="button" onClick={onClose} disabled={locked} className="-m-1 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg disabled:pointer-events-none disabled:opacity-40" aria-label="Close"><X className="size-4" /></button>
          </div>
          <div className="mt-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** For actions that can't be undone. `confirmText` makes the person type a word first. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, tone = "primary", confirmText, children }: {
  open: boolean; onClose: () => void; onConfirm: () => Promise<void> | void; title: string; description: ReactNode; confirmLabel: string; tone?: "primary" | "danger"; confirmText?: string; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  useEffect(() => { if (!open) { setTyped(""); setBusy(false); } }, [open]);
  const ok = !confirmText || typed.trim().toLowerCase() === confirmText.toLowerCase();
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} locked={busy}>
      {children}
      {confirmText && (
        <div className="mb-5 space-y-1.5">
          <label className="text-sm font-medium" htmlFor="confirm-text">Type <span className="font-mono">{confirmText}</span> to continue</label>
          <Input id="confirm-text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} disabled={!ok} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

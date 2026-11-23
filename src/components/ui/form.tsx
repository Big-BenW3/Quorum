"use client";
import { forwardRef, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const control = "w-full rounded-md border border-input bg-card px-3 text-[15px] text-fg placeholder:text-muted-fg/70 transition-colors hover:border-muted-fg/50 focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export function Field({ label, hint, error, children, className, optional }: { label: string; hint?: ReactNode; error?: string; children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode; className?: string; optional?: boolean }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const desc = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  // After a failed submit, move focus to the first field with a problem so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (!error) return;
    const el = box.current; if (!el) return;
    const first = el.closest("form")?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (first && el.contains(first)) first.focus({ preventScroll: false });
  }, [error]);
  return (
    <div ref={box} className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-muted-fg">Optional</span>}
      </label>
      {children({ id, "aria-describedby": desc, "aria-invalid": error ? true : undefined })}
      {error ? <p id={`${id}-e`} className="text-sm text-danger">{error}</p> : hint ? <p id={`${id}-h`} className="text-sm text-muted-fg">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-24 py-2 leading-6", className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return <select ref={ref} className={cn(control, "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b6b73' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")]", className)} {...p}>{children}</select>;
});

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {description && <p className="mt-0.5 text-sm text-muted-fg">{description}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-fg" : "bg-input")}>
        <span className={cn("absolute left-0.5 top-0.5 size-4 rounded-full bg-card transition-transform", checked && "translate-x-4")} />
      </button>
    </div>
  );
}

/** A radio presented as a selectable card. Native radio underneath, so keyboard and screen readers just work. */
export function ChoiceCard({ name, value, checked, onChange, title, description, disabled }: { name: string; value: string; checked: boolean; onChange: (v: string) => void; title: string; description: string; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent", checked ? "border-fg bg-muted/60" : "border-border hover:border-muted-fg/50", disabled && "cursor-not-allowed opacity-60")}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} className="mt-1 size-4 accent-[var(--fg)]" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-fg">{description}</span>
      </span>
    </label>
  );
}

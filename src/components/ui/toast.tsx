"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";

type Toast = { id: number; tone: "good" | "danger"; message: string };
const Ctx = createContext<{ success: (m: string) => void; error: (m: string) => void }>({ success: () => {}, error: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, tone, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "danger" ? 8000 : 4000);
  }, []);
  const value = useMemo(() => ({ success: (m: string) => push("good", m), error: (m: string) => push("danger", m) }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "danger" ? "alert" : "status"} className="q-rise pointer-events-auto flex max-w-md items-start gap-2.5 rounded-lg border border-border bg-card px-3.5 py-3 text-sm shadow-lg">
            {t.tone === "good" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />}
            <span className="leading-5">{t.message}</span>
            <button type="button" aria-label="Dismiss" className="-mr-1 ml-1 rounded p-0.5 text-muted-fg hover:text-fg" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}><X className="size-3.5" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

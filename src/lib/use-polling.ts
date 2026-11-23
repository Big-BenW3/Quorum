"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * Bounded polling (Vercel can't host WebSockets). Pauses while the tab is hidden, backs off on errors,
 * and always goes through the normal gated endpoint, so a hidden result can't leak through here.
 */
export function usePolling<T>(url: string | null, opts: { intervalMs?: number; initial?: T } = {}) {
  const { intervalMs = 15_000, initial } = opts;
  const [data, setData] = useState<T | undefined>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial === undefined);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const next = await api<T>("GET", url);
      setData(next); setError(null); failures.current = 0;
    } catch (e) {
      failures.current += 1;
      setError(e instanceof Error ? e.message : "Couldn't refresh.");
    } finally { setLoading(false); }
  }, [url]);

  useEffect(() => {
    live.current = true;
    const tick = async () => {
      if (!live.current) return;
      if (document.visibilityState === "visible") await load();
      if (!live.current) return;
      timer.current = setTimeout(tick, Math.min(intervalMs * 2 ** Math.min(failures.current, 3), 120_000));
    };
    if (initial === undefined) void load();
    timer.current = setTimeout(tick, intervalMs);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live.current = false; if (timer.current) clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, intervalMs, initial]);

  return { data, error, loading, refresh: load };
}

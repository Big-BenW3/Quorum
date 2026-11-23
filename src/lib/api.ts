/** Browser-side API client. Every failure becomes an ApiError with the server's code, message and field errors. */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public fields?: Record<string, string>, public requestId?: string) {
    super(message);
  }
}

export async function api<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method, signal, credentials: "same-origin", cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("NETWORK", "We couldn't reach the server. Check your connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; fields?: Record<string, string>; requestId?: string } } | null)?.error;
    throw new ApiError(e?.code ?? "ERROR", e?.message ?? "Something went wrong. Try again in a moment.", res.status, e?.fields, e?.requestId);
  }
  return data as T;
}

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again in a moment.");

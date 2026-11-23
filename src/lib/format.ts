/** Formatting helpers. Dates are stored as instants and always displayed in the election's own time zone. */
const safeZone = (tz?: string | null) => { try { if (tz) { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } } catch { /* fall through */ } return "UTC"; };

export function formatDateTime(d: Date | string | null | undefined, tz?: string | null): string {
  if (!d) return "Not set";
  const zone = safeZone(tz);
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(new Date(d));
}
export function formatDate(d: Date | string | null | undefined, tz?: string | null): string {
  if (!d) return "Not set";
  return new Intl.DateTimeFormat("en-GB", { timeZone: safeZone(tz), day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
}
export function formatHour(d: Date | string, tz?: string | null, withDay = false): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: safeZone(tz), ...(withDay ? { day: "numeric", month: "short" } : {}), hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
}
export const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "–" : `${(n * 100).toFixed(digits)}%`);
export const num = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-GB"));
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

export function duration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 6) / 10;
  if (h < 48) return `${h} hr`;
  return `${Math.round(h / 24)} days`;
}

/** `datetime-local` value (YYYY-MM-DDTHH:mm) for an instant, expressed in a time zone. */
export function toLocalInput(d: Date | string | null | undefined, tz: string): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: safeZone(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
  return parts.replace(" ", "T");
}
/** Inverse of toLocalInput: interpret a wall-clock value in `tz` and return the ISO instant. */
export function fromLocalInput(value: string, tz: string): string | null {
  if (!value) return null;
  const [datePart, timePart = "00:00"] = value.split("T");
  const [y, mo, d] = datePart!.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  if (!y || !mo || !d) return null;
  const guess = Date.UTC(y, mo - 1, d, h ?? 0, mi ?? 0);
  // Find the offset of `tz` at that instant, then correct (two passes handle DST edges).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const shown = toLocalInput(new Date(t), tz);
    const [sd, st = "00:00"] = shown.split("T");
    const [sy, sm, sdd] = sd!.split("-").map(Number);
    const [sh, smi] = st.split(":").map(Number);
    const diff = Date.UTC(sy!, sm! - 1, sdd!, sh!, smi!) - guess;
    t = guess - diff;
  }
  return new Date(t).toISOString();
}
export const TIMEZONES = (() => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; } })();

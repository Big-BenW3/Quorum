/**
 * Single source of "now". Deadlines (roster freeze, open, close) are evaluated against this at every
 * relevant read and write, so correctness never depends on a cron firing on time. Tests replace it
 * to exercise boundaries precisely.
 */
let override: (() => Date) | null = null;

export const now = (): Date => (override ? override() : new Date());

export function setClockForTests(fn: (() => Date) | null) {
  override = fn;
}

export const HOUR_MS = 3_600_000;
export const FREEZE_LEAD_MS = 24 * HOUR_MS;

/** Truncate to the start of the hour. Used wherever we deliberately coarsen timestamps. */
export function truncateToHour(d: Date): Date {
  return new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS);
}

export function freezeTimeFor(startsAt: Date): Date {
  return new Date(startsAt.getTime() - FREEZE_LEAD_MS);
}

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function chinaDateString(date: Date = new Date()): string {
  return new Date(date.getTime() + CHINA_OFFSET_MS).toISOString().slice(0, 10);
}

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function resolveHistoryDate(
  requested: string | undefined,
  now: Date = new Date(),
): string {
  const today = chinaDateString(now);
  if (!requested) return today;
  if (!isValidDateString(requested)) {
    throw new Error('invalid_date');
  }
  const todayStart = Date.parse(`${today}T00:00:00.000Z`);
  const targetStart = Date.parse(`${requested}T00:00:00.000Z`);
  const diffDays = Math.round((todayStart - targetStart) / 86_400_000);
  if (diffDays < 0 || diffDays > 29) {
    throw new Error('date_out_of_range');
  }
  return requested;
}

export function isoTimestamp(now: Date = new Date()): string {
  return now.toISOString();
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function elapsedMs(startedAt: number, endedAt: number = Date.now()): number {
  return Math.max(0, Math.round(endedAt - startedAt));
}

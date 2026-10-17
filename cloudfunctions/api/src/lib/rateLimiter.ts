import type { RateLimiter } from '../domain/types';

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, number>();

  allow(ownerOpenId: string, action: string, minimumIntervalMs: number): boolean {
    const key = `${action}:${ownerOpenId}`;
    const now = Date.now();
    const last = this.buckets.get(key) ?? 0;
    if (now - last < minimumIntervalMs) return false;
    this.buckets.set(key, now);
    if (this.buckets.size > 5000) {
      const cutoff = now - 10 * 60_000;
      for (const [entryKey, timestamp] of this.buckets) {
        if (timestamp < cutoff) this.buckets.delete(entryKey);
      }
    }
    return true;
  }
}

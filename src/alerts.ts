import { remainingPercent, type Reading } from "./domain";

/** Alert only on an observed crossing, never on startup or an unknown value. */
export class LowUsageAlerts {
  private account: string | null = null;
  private previous = new Map<string, number>();
  observe(reading: Reading): string[] {
    if (this.account !== reading.accountRef) {
      this.previous.clear();
      this.account = reading.accountRef;
    }
    const crossed: string[] = [];
    const present = new Set(reading.quotas.map((q) => q.poolId));
    for (const key of this.previous.keys())
      if (!present.has(key)) this.previous.delete(key);
    for (const quota of reading.quotas) {
      const remaining = remainingPercent(quota.used);
      if (remaining === null) continue;
      const before = this.previous.get(quota.poolId);
      if (before !== undefined && before > 10 && remaining <= 10)
        crossed.push(quota.poolId);
      this.previous.set(quota.poolId, remaining);
    }
    return crossed;
  }
  clear() {
    this.previous.clear();
    this.account = null;
  }
}

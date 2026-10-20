import { describe, it, expect } from "vitest";
import { LowUsageAlerts } from "./alerts";
import type { Reading } from "./domain";
const reading = (used: number | null, accountRef = "a"): Reading => ({
  accountRef,
  accountLabel: "fixture",
  planLabel: null,
  fetchedAt: 1,
  sourceKind: "codex_app_server",
  quotas: [
    {
      poolId: "weekly",
      poolLabel: "Weekly",
      used,
      remaining: null,
      windowDuration: 604800,
      resetsAt: null,
    },
  ],
});
describe("low usage notifications", () => {
  it("alerts once per observed crossing and rearms only after recovery", () => {
    const alerts = new LowUsageAlerts();
    expect(alerts.observe(reading(89))).toEqual([]);
    expect(alerts.observe(reading(90))).toEqual(["weekly"]);
    expect(alerts.observe(reading(95))).toEqual([]);
    expect(alerts.observe(reading(100))).toEqual([]);
    expect(alerts.observe(reading(10))).toEqual([]);
    expect(alerts.observe(reading(91))).toEqual(["weekly"]);
  });
  it("never infers a crossing from startup, unknown values, or account changes", () => {
    const alerts = new LowUsageAlerts();
    expect(alerts.observe(reading(95))).toEqual([]);
    expect(alerts.observe(reading(null))).toEqual([]);
    expect(alerts.observe(reading(98))).toEqual([]);
    expect(alerts.observe(reading(50))).toEqual([]);
    expect(alerts.observe(reading(99, "other"))).toEqual([]);
    alerts.clear();
    expect(alerts.observe(reading(95))).toEqual([]);
  });
});

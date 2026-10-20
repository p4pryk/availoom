import { describe, expect, it } from "vitest";
import {
  remainingPercent,
  visibleProviders,
  readingAge,
  stripPools,
  compactWindow,
  resetLabel,
  freshness,
  toSnapshots,
  durationLabel,
  percentLabel,
} from "./domain";
function fixtureSnapshots(now: number) {
  return toSnapshots({
    accountRef: "fixture",
    accountLabel: "fixture",
    planLabel: null,
    fetchedAt: now / 1000,
    sourceKind: "codex_app_server",
    quotas: [18000, 604800].map((duration, i) => ({
      poolId: `fixture-${i}`,
      poolLabel: "Test pool",
      used: 28,
      remaining: 72,
      windowDuration: duration,
      resetsAt: null,
    })),
  });
}
describe("quota integrity", () => {
  it("keeps absent and invalid values unknown, preserves real zero", () => {
    for (const value of [null, undefined, "0", NaN, Infinity, -1, 101])
      expect(remainingPercent(value)).toBeNull();
    expect(remainingPercent(100)).toBe(0);
    expect(remainingPercent(0)).toBe(100);
  });
  it("never confirms resets from the clock", () => {
    expect(
      resetLabel("2026-10-18T12:00:00Z", Date.parse("2026-10-18T12:01:00Z")),
    ).toContain("confirmation");
    expect(resetLabel(null, Date.now())).toContain("unknown");
  });
  it("ages cached readings without changing quota values", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    const s = fixtureSnapshots(now)[0];
    expect(freshness(s, now)).toBe("fresh");
    expect(freshness(s, now + 21 * 60000)).toBe("stale");
    expect(s.remaining).toBe(72);
    expect(freshness({ ...s, fetchedAt: null }, now)).toBe("unknown");
  });
  it("marks a passed reset stale even when the reading is recent", () => {
    const now = Date.now();
    const s = fixtureSnapshots(now)[0];
    expect(
      freshness({ ...s, resetsAt: new Date(now - 1).toISOString() }, now),
    ).toBe("stale");
    expect(s.remaining).toBe(72);
  });
  it("does not label a nonstandard window as five hours or a week", () => {
    expect(durationLabel(900)).toBe("15 min");
    expect(durationLabel(null)).toBe("Unknown window");
    expect(durationLabel(604800)).toBe("Week");
  });
  it("keeps unknown numbers and missing source observation time empty", () => {
    const [s] = toSnapshots({
      accountRef: "fictional",
      accountLabel: "fixture",
      planLabel: null,
      fetchedAt: 1792324800,
      sourceKind: "codex_app_server",
      quotas: [
        {
          poolId: "p",
          poolLabel: "p",
          used: null,
          remaining: null,
          windowDuration: null,
          resetsAt: null,
        },
      ],
    });
    expect(s.remaining).toBeNull();
    expect(s.observedAt).toBeNull();
    expect(s.limit).toBeNull();
    expect(s.accuracy).toBe("unknown");
    expect(percentLabel(s.remaining)).toBe("—");
  });
  it("uses UTC instants across the autumn DST transition", () => {
    const before = Date.parse("2026-10-25T00:45:00Z");
    expect(resetLabel("2026-10-25T01:15:00Z", before)).toBe("In 30 min");
  });
  it("does not claim freshness after an invalid date or clock rollback", () => {
    const now = Date.now(),
      s = fixtureSnapshots(now)[0];
    expect(freshness({ ...s, fetchedAt: "invalid" }, now)).toBe("unknown");
    expect(freshness(s, now - 120000)).toBe("unknown");
  });
});

describe("adaptive strip pools", () => {
  const fixtures = fixtureSnapshots(Date.now()).filter(
    (q) => q.provider === "Codex",
  );
  it("never creates an absent five-hour or weekly window", () => {
    expect(stripPools([])).toEqual([]);
    expect(stripPools([fixtures[1]])).toEqual([fixtures[1]]);
    expect(stripPools([fixtures[0]])).toEqual([fixtures[0]]);
  });
  it("keeps both real windows, with the shorter window first", () => {
    expect(
      stripPools([...fixtures].reverse()).map((q) => q.windowDuration),
    ).toEqual([18000, 604800]);
    expect(compactWindow(18000)).toBe("5h");
    expect(compactWindow(604800)).toBe("7d");
    expect(compactWindow(900)).toBe("15m");
    expect(compactWindow(null)).toBe("?");
  });
  it("keeps a selected model pool and a second duration without mutating input", () => {
    const extra = { ...fixtures[1], poolId: "model-weekly", remaining: null };
    const qs = [...fixtures, extra];
    expect(stripPools(qs, extra.poolId).map((q) => q.poolId)).toEqual([
      fixtures[0].poolId,
      extra.poolId,
    ]);
    expect(qs).toHaveLength(3);
    expect(stripPools(qs, extra.poolId)[1].remaining).toBeNull();
  });
});

describe("everyday presentation", () => {
  it("keeps at least one service even with an old or invalid preference", () => {
    expect(visibleProviders(["Claude", "Gemini", "Grok"])).toEqual(["Codex"]);
    expect(visibleProviders(["Codex", "Claude", "Gemini", "Grok"])).toEqual([
      "Codex",
    ]);
  });
  it("handles clock changes and relative reading times", () => {
    const now = Date.now();
    expect(readingAge(new Date(now).toISOString(), now)).toBe(
      "Updated just now",
    );
    expect(readingAge(new Date(now - 120000).toISOString(), now)).toBe(
      "Updated 2 min ago",
    );
    expect(readingAge(new Date(now + 120000).toISOString(), now)).toBe(
      "Reading time unavailable",
    );
    expect(readingAge("invalid", now)).toBe("Reading time unavailable");
  });
});

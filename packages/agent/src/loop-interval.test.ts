import { describe, it, expect } from "vitest";
import {
  resolveLoopIntervalMs,
  isQuotaRiskyCadence,
  QUOTA_SAFE_INTERVAL_MS,
  DEMO_MAX_INTERVAL_MS,
} from "./loop-interval.js";

describe("resolveLoopIntervalMs", () => {
  it("uses the quota-safe 15-min default verbatim in online mode", () => {
    expect(resolveLoopIntervalMs(false, QUOTA_SAFE_INTERVAL_MS)).toBe(900_000);
  });

  it("honours an explicit online cadence verbatim (operator's choice)", () => {
    expect(resolveLoopIntervalMs(false, 30_000)).toBe(30_000);
  });

  it("caps the slow online default to a lively cadence in offline demo", () => {
    // Offline demo makes no network calls — never inherit the 15-min default.
    expect(resolveLoopIntervalMs(true, QUOTA_SAFE_INTERVAL_MS)).toBe(
      DEMO_MAX_INTERVAL_MS
    );
  });

  it("respects a faster explicit interval in offline demo", () => {
    expect(resolveLoopIntervalMs(true, 5_000)).toBe(5_000);
  });
});

describe("isQuotaRiskyCadence", () => {
  it("flags a fast ONLINE cadence as quota-risky", () => {
    expect(isQuotaRiskyCadence(false, 30_000)).toBe(true);
  });

  it("does not flag the quota-safe online default", () => {
    expect(isQuotaRiskyCadence(false, QUOTA_SAFE_INTERVAL_MS)).toBe(false);
  });

  it("never flags offline demo (no network reads)", () => {
    expect(isQuotaRiskyCadence(true, 1_000)).toBe(false);
  });
});

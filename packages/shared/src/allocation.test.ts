import { describe, it, expect } from "vitest";
import { driftBps, allocationSanityCheck } from "./allocation.js";
import type { AllocationMap } from "./types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EQUAL: AllocationMap = [
  { assetId: 0, bps: 2000 },
  { assetId: 1, bps: 2000 },
  { assetId: 2, bps: 2000 },
  { assetId: 3, bps: 2000 },
  { assetId: 4, bps: 2000 },
];

const SHIFTED: AllocationMap = [
  { assetId: 0, bps: 3000 }, // +1000 from EQUAL
  { assetId: 1, bps: 2000 },
  { assetId: 2, bps: 2000 },
  { assetId: 3, bps: 2000 },
  { assetId: 4, bps: 1000 }, // -1000 from EQUAL
];

// ── driftBps ─────────────────────────────────────────────────────────────────

describe("driftBps", () => {
  it("returns 0 for identical allocations", () => {
    expect(driftBps(EQUAL, EQUAL)).toBe(0);
  });

  it("returns max absolute per-asset difference", () => {
    // asset 0: |2000 - 3000| = 1000, asset 4: |2000 - 1000| = 1000 → max = 1000
    expect(driftBps(EQUAL, SHIFTED)).toBe(1000);
  });

  it("treats a missing asset as 0 bps", () => {
    const partial: AllocationMap = [
      { assetId: 0, bps: 5000 },
      { assetId: 1, bps: 5000 },
    ];
    const other: AllocationMap = [{ assetId: 0, bps: 2000 }];
    // asset 0: |5000 - 2000| = 3000, asset 1: |5000 - 0| = 5000
    expect(driftBps(partial, other)).toBe(5000);
  });

  it("returns 0 for two empty allocations", () => {
    expect(driftBps([], [])).toBe(0);
  });
});

// ── allocationSanityCheck ────────────────────────────────────────────────────

describe("allocationSanityCheck", () => {
  it("accepts a valid 5-slot allocation summing to 10000", () => {
    const result = allocationSanityCheck(EQUAL);
    expect(result.ok).toBe(true);
  });

  it("rejects when fewer than 5 slots are present", () => {
    const result = allocationSanityCheck([
      { assetId: 0, bps: 5000 },
      { assetId: 1, bps: 5000 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/5 asset slots/);
  });

  it("rejects when more than 5 slots are present", () => {
    const tooMany: AllocationMap = [
      { assetId: 0, bps: 2000 },
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 1000 },
      { assetId: 4, bps: 1000 }, // duplicate but length > 5
    ];
    const result = allocationSanityCheck(tooMany);
    expect(result.ok).toBe(false);
  });

  it("rejects when sum != 10000", () => {
    const badSum: AllocationMap = [
      { assetId: 0, bps: 2000 },
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 1999 }, // 9999 total
    ];
    const result = allocationSanityCheck(badSum);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/9999 bps/);
  });

  it("rejects when a single asset exceeds maxAssetWeightBps", () => {
    const overweight: AllocationMap = [
      { assetId: 0, bps: 7000 }, // > 6000 default cap
      { assetId: 1, bps: 1000 },
      { assetId: 2, bps: 1000 },
      { assetId: 3, bps: 500 },
      { assetId: 4, bps: 500 },
    ];
    const result = allocationSanityCheck(overweight);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exceeds max/);
  });

  it("accepts when an asset weight exactly equals maxAssetWeightBps", () => {
    const exact: AllocationMap = [
      { assetId: 0, bps: 6000 }, // exactly at cap
      { assetId: 1, bps: 1000 },
      { assetId: 2, bps: 1000 },
      { assetId: 3, bps: 1000 },
      { assetId: 4, bps: 1000 },
    ];
    const result = allocationSanityCheck(exact);
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate assetIds", () => {
    const dupes: AllocationMap = [
      { assetId: 0, bps: 2000 },
      { assetId: 0, bps: 2000 }, // duplicate
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 2000 },
    ];
    const result = allocationSanityCheck(dupes);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Duplicate assetId/);
  });

  it("rejects invalid assetId out of range", () => {
    const invalid: AllocationMap = [
      { assetId: 5, bps: 2000 }, // > 4
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 2000 },
    ];
    const result = allocationSanityCheck(invalid);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Invalid assetId/);
  });

  it("respects a custom maxAssetWeightBps parameter", () => {
    const custom: AllocationMap = [
      { assetId: 0, bps: 7000 },
      { assetId: 1, bps: 1000 },
      { assetId: 2, bps: 800 },
      { assetId: 3, bps: 600 },
      { assetId: 4, bps: 600 },
    ];
    expect(allocationSanityCheck(custom, 7000).ok).toBe(true);
    expect(allocationSanityCheck(custom, 6999).ok).toBe(false);
  });
});

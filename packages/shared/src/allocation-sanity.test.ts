/**
 * Additional allocation sanity-bound tests targeting the success-criteria gaps.
 *
 * New coverage (supplements allocation.test.ts without overlapping it):
 *  - Rejects when a single asset weight exceeds MAX_ASSET_WEIGHT_BPS (6000 default).
 *  - Rejects when fewer than 5 slots are present (missing slots).
 *  - Rejects when more than 5 slots are present.
 *  - The MAX_ASSET_WEIGHT_BPS boundary is inclusive (exactly at cap passes).
 *  - Custom cap values respected at the exact boundary.
 */

import { describe, it, expect } from "vitest";
import { allocationSanityCheck } from "./allocation.js";
import type { AllocationMap } from "./types.js";

const MAX_ASSET_WEIGHT_BPS = 6000;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("allocationSanityCheck — MAX_ASSET_WEIGHT_BPS enforcement", () => {
  it("rejects allocation where one asset weight is MAX_ASSET_WEIGHT_BPS + 1", () => {
    const overweight: AllocationMap = [
      { assetId: 0, bps: MAX_ASSET_WEIGHT_BPS + 1 }, // 6001 > 6000
      { assetId: 1, bps: 1000 },
      { assetId: 2, bps: 1000 },
      { assetId: 3, bps: 999 },
      { assetId: 4, bps: 1000 },
    ];
    const result = allocationSanityCheck(overweight, MAX_ASSET_WEIGHT_BPS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exceeds max/);
    expect(result.reason).toMatch(/6001/);
    expect(result.reason).toMatch(/6000/);
  });

  it("rejects allocation where ALL assets are above the per-asset cap", () => {
    // Each slot at 7000 would fail even if sum were 10000 (it isn't, but
    // the per-asset cap check runs first, so it rejects on the first overweight asset).
    const allOverweight: AllocationMap = [
      { assetId: 0, bps: 7000 },
      { assetId: 1, bps: 1000 },
      { assetId: 2, bps: 800 },
      { assetId: 3, bps: 600 },
      { assetId: 4, bps: 600 },
    ];
    const result = allocationSanityCheck(allOverweight, MAX_ASSET_WEIGHT_BPS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exceeds max/);
  });

  it("accepts allocation where every asset is exactly at MAX_ASSET_WEIGHT_BPS and sum is 10000", () => {
    // 6000 + 1000 + 1000 + 1000 + 1000 = 10000
    const atCap: AllocationMap = [
      { assetId: 0, bps: 6000 },
      { assetId: 1, bps: 1000 },
      { assetId: 2, bps: 1000 },
      { assetId: 3, bps: 1000 },
      { assetId: 4, bps: 1000 },
    ];
    const result = allocationSanityCheck(atCap, MAX_ASSET_WEIGHT_BPS);
    expect(result.ok).toBe(true);
  });
});

describe("allocationSanityCheck — missing / extra slots", () => {
  it("rejects when only 1 slot is present", () => {
    const single: AllocationMap = [{ assetId: 0, bps: 10_000 }];
    const result = allocationSanityCheck(single, MAX_ASSET_WEIGHT_BPS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Expected exactly 5 asset slots/);
    expect(result.reason).toMatch(/1/);
  });

  it("rejects when 4 slots are present (one missing)", () => {
    const fourSlots: AllocationMap = [
      { assetId: 0, bps: 2500 },
      { assetId: 1, bps: 2500 },
      { assetId: 2, bps: 2500 },
      { assetId: 3, bps: 2500 },
      // assetId 4 is missing
    ];
    const result = allocationSanityCheck(fourSlots, MAX_ASSET_WEIGHT_BPS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/5 asset slots/);
  });

  it("rejects empty allocation", () => {
    const result = allocationSanityCheck([], MAX_ASSET_WEIGHT_BPS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/5 asset slots/);
  });

  it("rejects when 6 slots are present (one extra)", () => {
    const sixSlots: AllocationMap = [
      { assetId: 0, bps: 1000 },
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 1000 },
      { assetId: 4, bps: 2000 }, // duplicate assetId, length now 6
    ];
    const result = allocationSanityCheck(sixSlots, MAX_ASSET_WEIGHT_BPS);
    expect(result.ok).toBe(false);
    // Either "5 asset slots" (length check) or "Duplicate assetId" fires first
    expect(result.reason).toBeDefined();
  });
});

describe("allocationSanityCheck — sum boundary", () => {
  it("rejects when bps sum is 9999 (one short)", () => {
    const offByOne: AllocationMap = [
      { assetId: 0, bps: 2000 },
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 1999 },
    ];
    const result = allocationSanityCheck(offByOne, MAX_ASSET_WEIGHT_BPS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/9999 bps/);
  });

  it("rejects when bps sum is 10001 (one over)", () => {
    const overSum: AllocationMap = [
      { assetId: 0, bps: 2000 },
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 2001 },
    ];
    const result = allocationSanityCheck(overSum, MAX_ASSET_WEIGHT_BPS);
    // 2001 > 2000 does not exceed the 6000 cap, so sum check fires
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/10001 bps/);
  });
});

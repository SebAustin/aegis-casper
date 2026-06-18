/**
 * Allocation math helpers.
 *
 * - driftBps: max absolute per-asset bps difference between two allocation maps
 * - allocationSanityCheck: gate before on-chain submission
 */

import type { AllocationMap } from "./types.js";

const TOTAL_BPS = 10_000;

/**
 * Compute drift between two allocation maps.
 *
 * Drift = max absolute per-asset difference in basis points.
 * Assets present in one map but absent in the other contribute their full bps.
 *
 * @returns An integer number of basis points (0..10_000).
 */
export function driftBps(current: AllocationMap, recommended: AllocationMap): number {
  const currentMap = new Map(current.map((e) => [e.assetId, e.bps]));
  const recommendedMap = new Map(recommended.map((e) => [e.assetId, e.bps]));

  const allIds = new Set([...currentMap.keys(), ...recommendedMap.keys()]);
  let maxDrift = 0;

  for (const id of allIds) {
    const c = currentMap.get(id) ?? 0;
    const r = recommendedMap.get(id) ?? 0;
    const diff = Math.abs(c - r);
    if (diff > maxDrift) {
      maxDrift = diff;
    }
  }

  return maxDrift;
}

/** Result of an allocation sanity check. */
export interface SanityCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate an allocation map before accepting it for on-chain submission.
 *
 * Rules (see PLAN.md §2.4 GATES):
 * 1. Exactly 5 asset slots present.
 * 2. Each slot's bps ≤ maxAssetWeightBps (default 6000).
 * 3. All assetId values are distinct integers in [0, 4].
 * 4. Sum of all bps === 10_000.
 *
 * @param allocation   The map to validate.
 * @param maxAssetWeightBps  Per-asset cap (default 6000 = 60%).
 */
export function allocationSanityCheck(
  allocation: AllocationMap,
  maxAssetWeightBps = 6000
): SanityCheckResult {
  if (allocation.length !== 5) {
    return {
      ok: false,
      reason: `Expected exactly 5 asset slots, got ${allocation.length}`,
    };
  }

  const seenIds = new Set<number>();

  for (const entry of allocation) {
    if (!Number.isInteger(entry.assetId) || entry.assetId < 0 || entry.assetId > 4) {
      return {
        ok: false,
        reason: `Invalid assetId ${entry.assetId}: must be integer 0..4`,
      };
    }

    if (seenIds.has(entry.assetId)) {
      return {
        ok: false,
        reason: `Duplicate assetId ${entry.assetId} in allocation`,
      };
    }
    seenIds.add(entry.assetId);

    if (!Number.isInteger(entry.bps) || entry.bps < 0) {
      return {
        ok: false,
        reason: `Invalid bps ${entry.bps} for assetId ${entry.assetId}: must be non-negative integer`,
      };
    }

    if (entry.bps > maxAssetWeightBps) {
      return {
        ok: false,
        reason: `AssetId ${entry.assetId} weight ${entry.bps} bps exceeds max ${maxAssetWeightBps} bps`,
      };
    }
  }

  const sum = allocation.reduce((acc, e) => acc + e.bps, 0);
  if (sum !== TOTAL_BPS) {
    return {
      ok: false,
      reason: `Allocation sums to ${sum} bps, expected ${TOTAL_BPS}`,
    };
  }

  return { ok: true };
}

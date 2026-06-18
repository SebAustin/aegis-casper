/**
 * Reputation delta computation (A-008).
 *
 * Formula: +1 if the agent's predicted top-yield asset (highest bps)
 * outperforms the portfolio average yield in the next epoch; -1 otherwise.
 */

import { createHash } from "node:crypto";
import type { DecisionLogEntry, RwaAsset } from "@aegis/shared";

/**
 * Compute the reputation delta for a set of prior decision log entries
 * compared to realised yields in the next epoch.
 *
 * @param decisions    Prior DecisionLogEntry records (acted ones only).
 * @param nextEpochAssets  Realised asset yields in the following epoch.
 * @returns delta (+1 or -1) and a SHA-256 rationale hash of the decisions.
 */
export function computeReputationDelta(
  decisions: DecisionLogEntry[],
  nextEpochAssets: RwaAsset[]
): { delta: number; rationaleHash: Buffer } {
  const rationaleHash = hashDecisions(decisions);

  if (decisions.length === 0 || nextEpochAssets.length === 0) {
    return { delta: 0, rationaleHash };
  }

  // Average yield (apyBps) across all assets in the next epoch
  const avgApy =
    nextEpochAssets.reduce((sum, a) => sum + a.apyBps, 0) /
    nextEpochAssets.length;

  // Count how many acted decisions predicted the highest-bps asset outperforming
  let correct = 0;
  let total = 0;

  for (const decision of decisions) {
    if (!decision.acted) continue;

    // Top predicted asset = highest bps in recommended allocation
    const topAssetId = decision.recommendedAllocation.reduce(
      (best, entry) => (entry.bps > best.bps ? entry : best),
      decision.recommendedAllocation[0]!
    ).assetId;

    const realised = nextEpochAssets.find((a) => a.assetId === topAssetId);
    if (realised && realised.apyBps > avgApy) {
      correct++;
    }
    total++;
  }

  if (total === 0) return { delta: 0, rationaleHash };

  const delta = correct > total / 2 ? 1 : -1;
  return { delta, rationaleHash };
}

/**
 * SHA-256 hash of the canonical JSON representation of decision log entries.
 * Used as `rationale_hash` in the `update_reputation` on-chain call (FR-A-07).
 */
export function hashDecisions(decisions: DecisionLogEntry[]): Buffer {
  const canonical = JSON.stringify(
    decisions.map((d) => ({
      iteration: d.iteration,
      timestamp: d.timestamp,
      promptHash: d.promptHash,
      recommendedAllocation: d.recommendedAllocation,
      confidence: d.confidence,
      rationale: d.rationale,
      acted: d.acted,
      txHash: d.txHash,
    }))
  );
  return createHash("sha256").update(canonical).digest();
}

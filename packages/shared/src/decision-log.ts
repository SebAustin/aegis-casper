/**
 * Decision log normalization — ensures every row written to or read from
 * logs/decisions.jsonl satisfies decisionLogEntrySchema.
 */

import { createHash } from "node:crypto";
import type { DecisionLogEntry } from "./types.js";
import { defaultVaultAllocation } from "./casper-rpc-read.js";
import { decisionLogEntrySchema } from "./schemas.js";

function skipFallbackHash(label: string, iteration: number, skipReason: string | null): string {
  return createHash("sha256")
    .update(`${label}:${iteration}:${skipReason ?? ""}`)
    .digest("hex");
}

function hasValidAllocation(
  allocation: DecisionLogEntry["recommendedAllocation"] | undefined
): allocation is DecisionLogEntry["recommendedAllocation"] {
  return Array.isArray(allocation) && allocation.length === 5;
}

/**
 * Fill missing required fields so legacy or partial agent rows parse cleanly.
 */
export function normalizeDecisionLogEntry(
  raw: Partial<DecisionLogEntry> & Pick<DecisionLogEntry, "iteration">
): DecisionLogEntry {
  const skipReason = raw.skipReason ?? null;
  const iteration = raw.iteration;
  const timestamp =
    typeof raw.timestamp === "number" && raw.timestamp > 0
      ? raw.timestamp
      : Date.now();

  return {
    iteration,
    timestamp,
    promptHash:
      raw.promptHash && raw.promptHash.length > 0
        ? raw.promptHash
        : skipFallbackHash("prompt", iteration, skipReason),
    oracleSnapshotHash:
      raw.oracleSnapshotHash && raw.oracleSnapshotHash.length > 0
        ? raw.oracleSnapshotHash
        : skipFallbackHash("oracle", iteration, skipReason),
    recommendedAllocation: hasValidAllocation(raw.recommendedAllocation)
      ? raw.recommendedAllocation
      : defaultVaultAllocation(),
    confidence:
      typeof raw.confidence === "number" && raw.confidence >= 0
        ? Math.min(100, raw.confidence)
        : 0,
    rationale: (raw.rationale ?? "").slice(0, 500),
    acted: raw.acted ?? false,
    txHash: raw.txHash ?? null,
    skipReason,
  };
}

/**
 * Parse a JSONL line into a validated DecisionLogEntry, coercing legacy rows.
 */
export function parseDecisionLogLine(line: unknown): DecisionLogEntry | null {
  const strict = decisionLogEntrySchema.safeParse(line);
  if (strict.success) {
    return strict.data as DecisionLogEntry;
  }

  if (line === null || typeof line !== "object") {
    return null;
  }

  const partial = line as Partial<DecisionLogEntry>;
  if (typeof partial.iteration !== "number") {
    return null;
  }

  const normalized = normalizeDecisionLogEntry({
    ...partial,
    iteration: partial.iteration,
  });
  const retry = decisionLogEntrySchema.safeParse(normalized);
  return retry.success ? (retry.data as DecisionLogEntry) : null;
}

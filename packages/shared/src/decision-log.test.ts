import { describe, expect, it } from "vitest";
import {
  normalizeDecisionLogEntry,
  parseDecisionLogLine,
} from "./decision-log.js";
import { decisionLogEntrySchema } from "./schemas.js";

describe("normalizeDecisionLogEntry", () => {
  it("fills empty hashes and allocation for iteration_error rows", () => {
    const normalized = normalizeDecisionLogEntry({
      iteration: 3,
      timestamp: 1_700_000_000_000,
      promptHash: "",
      oracleSnapshotHash: "",
      recommendedAllocation: [],
      confidence: 0,
      rationale: "",
      acted: false,
      txHash: null,
      skipReason: "iteration_error: Code: 429",
    });

    const result = decisionLogEntrySchema.safeParse(normalized);
    expect(result.success).toBe(true);
    expect(normalized.promptHash.length).toBeGreaterThan(0);
    expect(normalized.oracleSnapshotHash.length).toBeGreaterThan(0);
    expect(normalized.recommendedAllocation).toHaveLength(5);
  });

  it("preserves valid fields from complete entries", () => {
    const allocation = [
      { assetId: 0, bps: 3000 },
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 1000 },
    ];
    const normalized = normalizeDecisionLogEntry({
      iteration: 1,
      timestamp: Date.now(),
      promptHash: "abc",
      oracleSnapshotHash: "def",
      recommendedAllocation: allocation,
      confidence: 75,
      rationale: "test",
      acted: false,
      txHash: null,
      skipReason: "rpc_rate_limited",
    });

    expect(normalized.promptHash).toBe("abc");
    expect(normalized.recommendedAllocation).toEqual(allocation);
    expect(normalized.confidence).toBe(75);
  });
});

describe("parseDecisionLogLine", () => {
  it("coerces legacy partial JSON objects", () => {
    const entry = parseDecisionLogLine({
      iteration: 2,
      timestamp: Date.now(),
      acted: false,
      skipReason: "prior_iteration_running",
    });
    expect(entry).not.toBeNull();
    expect(entry!.recommendedAllocation).toHaveLength(5);
  });

  it("returns null for non-objects", () => {
    expect(parseDecisionLogLine("bad")).toBeNull();
  });
});

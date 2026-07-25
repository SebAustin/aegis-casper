import { describe, expect, it } from "vitest";
import { buildDemoDecisionFeed, generateDemoDecision } from "./demo-decision.js";
import { allocationSanityCheck } from "./allocation.js";
import { decisionLogEntrySchema } from "./schemas.js";

describe("generateDemoDecision", () => {
  it("returns a valid 5-slot allocation summing to 10_000 bps", () => {
    const decision = generateDemoDecision({ now: 1_700_000_000_000, random: () => 0.1 });
    expect(decision.recommendedAllocation).toHaveLength(5);
    const sum = decision.recommendedAllocation.reduce((acc, e) => acc + e.bps, 0);
    expect(sum).toBe(10_000);
    expect(allocationSanityCheck(decision.recommendedAllocation).ok).toBe(true);
  });

  it("passes the full DecisionLogEntry schema", () => {
    const decision = generateDemoDecision({ now: Date.now(), random: () => 0.5 });
    const result = decisionLogEntrySchema.safeParse(decision);
    expect(result.success).toBe(true);
  });

  it("marks acted decisions with a demo-reallocate txHash and no skipReason", () => {
    // random() < 0.6 threshold on both draws → acted branch.
    const decision = generateDemoDecision({ now: 1_700_000_000_000, random: () => 0.05 });
    expect(decision.acted).toBe(true);
    expect(decision.txHash).toMatch(/^demo-reallocate-/);
    expect(decision.skipReason).toBeNull();
  });

  it("marks skipped decisions with a plausible skipReason and null txHash", () => {
    // random() >= 0.6 on the acted draw → skip branch.
    const decision = generateDemoDecision({ now: 1_700_000_000_000, random: () => 0.95 });
    expect(decision.acted).toBe(false);
    expect(decision.txHash).toBeNull();
    expect(decision.skipReason).not.toBeNull();
  });

  it("varies confidence within the documented 60..90 demo range", () => {
    for (let i = 0; i < 20; i++) {
      const decision = generateDemoDecision({ now: Date.now() + i, random: () => (i % 10) / 10 });
      expect(decision.confidence).toBeGreaterThanOrEqual(60);
      expect(decision.confidence).toBeLessThanOrEqual(90);
    }
  });
});

describe("buildDemoDecisionFeed", () => {
  it("returns ~6 valid entries spread over the last 30 minutes, newest first", () => {
    const now = 1_700_000_000_000;
    const entries = buildDemoDecisionFeed(now, 6);
    expect(entries).toHaveLength(6);

    for (const entry of entries) {
      expect(decisionLogEntrySchema.safeParse(entry).success).toBe(true);
      expect(allocationSanityCheck(entry.recommendedAllocation).ok).toBe(true);
      expect(entry.confidence).toBeGreaterThanOrEqual(60);
      expect(entry.confidence).toBeLessThanOrEqual(90);
    }

    // Newest first.
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.timestamp).toBeLessThan(entries[i - 1]!.timestamp);
    }

    const oldest = entries[entries.length - 1]!;
    expect(now - oldest.timestamp).toBeLessThanOrEqual(30 * 60_000);

    const actedEntries = entries.filter((e) => e.acted);
    const skippedEntries = entries.filter((e) => !e.acted);
    expect(actedEntries.length).toBeGreaterThan(0);
    expect(skippedEntries.length).toBeGreaterThan(0);
    for (const entry of actedEntries) {
      expect(entry.txHash).toMatch(/^demo-reallocate-/);
    }
    for (const entry of skippedEntries) {
      expect(entry.skipReason).not.toBeNull();
    }
  });
});

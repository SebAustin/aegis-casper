import { describe, it, expect } from "vitest";
import {
  llmDecisionSchema,
  allocationMapSchema,
  rwaOracleDataSchema,
  paymentPayloadSchema,
  decisionLogEntrySchema,
} from "./schemas.js";

const VALID_ALLOCATION = [
  { assetId: 0, bps: 2000 },
  { assetId: 1, bps: 2000 },
  { assetId: 2, bps: 2000 },
  { assetId: 3, bps: 2000 },
  { assetId: 4, bps: 2000 },
];

// ── allocationMapSchema ───────────────────────────────────────────────────────

describe("allocationMapSchema", () => {
  it("parses a valid 5-slot allocation", () => {
    const result = allocationMapSchema.safeParse(VALID_ALLOCATION);
    expect(result.success).toBe(true);
  });

  it("rejects when length != 5", () => {
    const result = allocationMapSchema.safeParse(VALID_ALLOCATION.slice(0, 3));
    expect(result.success).toBe(false);
  });

  it("rejects bps > 10000", () => {
    const bad = [...VALID_ALLOCATION];
    bad[0] = { assetId: 0, bps: 10001 };
    const result = allocationMapSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ── llmDecisionSchema ─────────────────────────────────────────────────────────

describe("llmDecisionSchema", () => {
  it("parses valid LLM output", () => {
    const input = {
      allocation: VALID_ALLOCATION,
      confidence: 75,
      rationale: "T-bills offer the best risk-adjusted yield this epoch.",
    };
    const result = llmDecisionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects confidence > 100", () => {
    const result = llmDecisionSchema.safeParse({
      allocation: VALID_ALLOCATION,
      confidence: 101,
      rationale: "ok",
    });
    expect(result.success).toBe(false);
  });

  it("rejects rationale > 500 chars", () => {
    const result = llmDecisionSchema.safeParse({
      allocation: VALID_ALLOCATION,
      confidence: 80,
      rationale: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing allocation field", () => {
    const result = llmDecisionSchema.safeParse({
      confidence: 80,
      rationale: "ok",
    });
    expect(result.success).toBe(false);
  });
});

// ── paymentPayloadSchema ──────────────────────────────────────────────────────

describe("paymentPayloadSchema", () => {
  const VALID_PAYLOAD = {
    scheme: "x402-casper",
    network: "casper-testnet",
    amountMotes: "1000000",
    asset: "CSPR",
    recipient: "oracle-payee-hash",
    payer: "agent-hash",
    nonce: "550e8400-e29b-41d4-a716-446655440000",
    expiryUnix: Math.floor(Date.now() / 1000) + 300,
    signature: "abcdef01234567890",
  };

  it("parses a valid payload with string amountMotes", () => {
    const result = paymentPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.amountMotes).toBe("bigint");
      expect(result.data.amountMotes).toBe(BigInt(1_000_000));
    }
  });

  it("rejects when nonce is not a UUID", () => {
    const result = paymentPayloadSchema.safeParse({
      ...VALID_PAYLOAD,
      nonce: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when expiryUnix is 0", () => {
    const result = paymentPayloadSchema.safeParse({
      ...VALID_PAYLOAD,
      expiryUnix: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ── rwaOracleDataSchema ───────────────────────────────────────────────────────

describe("rwaOracleDataSchema", () => {
  const ASSETS = Array.from({ length: 5 }, (_, i) => ({
    assetId: i,
    name: `Asset ${i}`,
    apyBps: 500 + i * 100,
    riskScore: 30 + i * 5,
    liquidityScore: 70 - i * 5,
    dataFreshnessMs: Date.now(),
  }));

  it("parses valid oracle data", () => {
    const input = {
      timestamp: Date.now(),
      oracleVersion: "1.0.0",
      paymentReceipt: {
        paymentHash: "hash123",
        facilitator: "mock",
        amountMotes: "1000000",
        payerAccountHash: "payer-hash",
        expiry: Math.floor(Date.now() / 1000) + 300,
        confirmedAt: Math.floor(Date.now() / 1000),
      },
      assets: ASSETS,
    };
    const result = rwaOracleDataSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects when assets length != 5", () => {
    const input = {
      timestamp: Date.now(),
      oracleVersion: "1.0.0",
      paymentReceipt: {
        paymentHash: "hash123",
        facilitator: "mock",
        amountMotes: "1000000",
        payerAccountHash: "payer-hash",
        expiry: 9999999999,
        confirmedAt: 1000,
      },
      assets: ASSETS.slice(0, 3),
    };
    const result = rwaOracleDataSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

// ── decisionLogEntrySchema ────────────────────────────────────────────────────

describe("decisionLogEntrySchema", () => {
  it("parses a valid decision log entry", () => {
    const entry = {
      iteration: 1,
      timestamp: Date.now(),
      promptHash: "abc123",
      oracleSnapshotHash: "def456",
      recommendedAllocation: VALID_ALLOCATION,
      confidence: 82,
      rationale: "Optimal allocation given current yields.",
      acted: true,
      txHash: "deploy-hash-xyz",
      skipReason: null,
    };
    const result = decisionLogEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("parses a skipped entry with null txHash", () => {
    const entry = {
      iteration: 2,
      timestamp: Date.now(),
      promptHash: "abc",
      oracleSnapshotHash: "def",
      recommendedAllocation: VALID_ALLOCATION,
      confidence: 40,
      rationale: "Low confidence, skipping.",
      acted: false,
      txHash: null,
      skipReason: "confidence_below_threshold",
    };
    const result = decisionLogEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });
});

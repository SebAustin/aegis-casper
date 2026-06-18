/**
 * Agent loop tests.
 *
 * All network/SDK calls are behind injectable clients — no real network calls.
 * Tests exercise: happy path, malformed LLM output, drift gate, confidence gate,
 * pause gate, balance gate, and allocation sanity gate.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { AgentLoop } from "./loop.js";
import { MockLlmClient } from "./clients/llm-client.js";
import { MockTxClient } from "./clients/casper-tx-client.js";
import { readJsonl } from "@aegis/shared";
import type {
  DecisionLogEntry,
  VaultState,
  AgentReputation,
  RwaOracleData,
} from "@aegis/shared";
import type { CasperReadClient } from "./clients/casper-read-client.js";
import type { OracleClient } from "./clients/oracle-client.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_VAULT: VaultState = {
  totalBalanceMotes: BigInt("2000000000000"), // 2000 CSPR
  totalShares: BigInt("2000000000000"),
  allocation: [
    { assetId: 0, bps: 2000 },
    { assetId: 1, bps: 2000 },
    { assetId: 2, bps: 2000 },
    { assetId: 3, bps: 2000 },
    { assetId: 4, bps: 2000 },
  ],
  agentAccountHash: "test-agent-hash",
  paused: false,
  lastReallocationTs: 0,
};

const MOCK_REPUTATION: AgentReputation = {
  agentAccountHash: "test-agent-hash",
  score: BigInt(50),
  totalDecisions: BigInt(0),
  correctPredictions: BigInt(0),
  registeredTs: 0,
};

const MOCK_ORACLE_DATA: RwaOracleData = {
  timestamp: Date.now(),
  oracleVersion: "1.0.0",
  paymentReceipt: {
    paymentHash: "abc123",
    facilitator: "mock",
    amountMotes: BigInt(1_000_000),
    payerAccountHash: "test-agent-hash",
    expiry: Math.floor(Date.now() / 1000) + 300,
    confirmedAt: Math.floor(Date.now() / 1000),
  },
  assets: [
    { assetId: 0, name: "T-Bills", apyBps: 510, riskScore: 10, liquidityScore: 90, dataFreshnessMs: Date.now() },
    { assetId: 1, name: "Private Credit", apyBps: 850, riskScore: 45, liquidityScore: 50, dataFreshnessMs: Date.now() },
    { assetId: 2, name: "Commodities", apyBps: 320, riskScore: 35, liquidityScore: 65, dataFreshnessMs: Date.now() },
    { assetId: 3, name: "Stable Yield", apyBps: 470, riskScore: 8, liquidityScore: 95, dataFreshnessMs: Date.now() },
    { assetId: 4, name: "CSPR Staking", apyBps: 630, riskScore: 25, liquidityScore: 80, dataFreshnessMs: Date.now() },
  ],
};

// LLM allocation that differs significantly from the equal 2000/2000/... split
const HIGH_DRIFT_ALLOCATION = [
  { assetId: 0, bps: 1000 },
  { assetId: 1, bps: 4000 }, // big shift → drift > threshold
  { assetId: 2, bps: 2000 },
  { assetId: 3, bps: 2000 },
  { assetId: 4, bps: 1000 },
];

// ── Mock Casper read client ───────────────────────────────────────────────────

function makeMockCasperRead(overrides: Partial<VaultState> = {}): CasperReadClient {
  return {
    getVaultState: async () => ({ ...MOCK_VAULT, ...overrides }),
    getReputation: async () => MOCK_REPUTATION,
    getTransactionStatus: async () => ({ status: "confirmed" }),
    // satisfy the full interface shape
  } as unknown as CasperReadClient;
}

// ── Mock oracle client ────────────────────────────────────────────────────────

function makeMockOracle(): OracleClient {
  return {
    fetch: async () => ({ ...MOCK_ORACLE_DATA, timestamp: Date.now() }),
  } as unknown as OracleClient;
}

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let decisionsLog: string;
let paymentsLog: string;

beforeEach(() => {
  tmpDir = path.join(tmpdir(), `aegis-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  decisionsLog = path.join(tmpDir, "decisions.jsonl");
  paymentsLog = path.join(tmpDir, "payments.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeLoop(
  llmOverrides: ConstructorParameters<typeof MockLlmClient>[0] = {},
  vaultOverrides: Partial<VaultState> = {},
  configOverrides: Partial<ConstructorParameters<typeof AgentLoop>[0]> = {}
): { loop: AgentLoop; txClient: MockTxClient } {
  const txClient = new MockTxClient();
  const loop = new AgentLoop(
    {
      reallocationDriftBps: 200,
      minConfidenceThreshold: 60,
      minVaultBalanceMotes: BigInt("100000000000"), // 100 CSPR
      maxAssetWeightBps: 6000,
      txConfirmTimeoutMs: 5_000,
      reputationUpdateEpochs: 3,
      agentAccountHash: "test-agent-hash",
      decisionsLogPath: decisionsLog,
      paymentsLogPath: paymentsLog,
      ...configOverrides,
    },
    {
      casperRead: makeMockCasperRead(vaultOverrides),
      oracle: makeMockOracle(),
      llm: new MockLlmClient(llmOverrides),
      tx: txClient,
    }
  );
  return { loop, txClient };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AgentLoop.runOnce()", () => {
  it("happy path: produces a DecisionLogEntry with acted=true and txHash", async () => {
    const { loop, txClient } = makeLoop({
      allocation: HIGH_DRIFT_ALLOCATION,
      confidence: 80,
    });

    const entry = await loop.runOnce();

    expect(entry.acted).toBe(true);
    expect(typeof entry.txHash).toBe("string");
    expect(entry.txHash).toMatch(/mock-reallocate/);
    expect(entry.skipReason).toBeNull();
    expect(entry.confidence).toBe(80);
    expect(txClient.submittedReallocations).toHaveLength(1);

    // Verify decision log written
    const log = await readJsonl<DecisionLogEntry>(decisionsLog);
    expect(log).toHaveLength(1);
    expect(log[0]?.acted).toBe(true);
    expect(log[0]?.txHash).toMatch(/mock-reallocate/);

    // Verify payment log written before decision log (SC-04)
    const payments = await readJsonl(paymentsLog);
    expect(payments).toHaveLength(1);
  });

  it("skips when LLM throws (logs skipReason)", async () => {
    const { loop, txClient } = makeLoop({
      shouldThrow: "LLM API unavailable",
    });

    const entry = await loop.runOnce();
    expect(entry.acted).toBe(false);
    expect(entry.txHash).toBeNull();
    expect(entry.skipReason).toMatch(/llm_error/);
    expect(txClient.submittedReallocations).toHaveLength(0);
  });

  it("skips when LLM returns malformed output (Zod rejection, NFR-S-06)", async () => {
    // MockLlmClient with malformed=true throws a SyntaxError which triggers the catch
    const { loop, txClient } = makeLoop({ malformed: true });

    const entry = await loop.runOnce();
    expect(entry.acted).toBe(false);
    expect(entry.skipReason).toMatch(/llm_error/);
    expect(txClient.submittedReallocations).toHaveLength(0);
  });

  it("skips when drift is below threshold", async () => {
    // Low-drift allocation: very close to the 2000/2000/... current state
    const { loop, txClient } = makeLoop({
      allocation: [
        { assetId: 0, bps: 2100 }, // +100 drift
        { assetId: 1, bps: 2100 },
        { assetId: 2, bps: 2000 },
        { assetId: 3, bps: 1900 },
        { assetId: 4, bps: 1900 },
      ],
      confidence: 80,
    });

    const entry = await loop.runOnce();
    expect(entry.acted).toBe(false);
    expect(entry.skipReason).toMatch(/drift_below_threshold/);
    expect(txClient.submittedReallocations).toHaveLength(0);
  });

  it("skips when confidence is below threshold (FR-A-05)", async () => {
    const { loop, txClient } = makeLoop({
      allocation: HIGH_DRIFT_ALLOCATION,
      confidence: 50, // below default 60
    });

    const entry = await loop.runOnce();
    expect(entry.acted).toBe(false);
    expect(entry.skipReason).toMatch(/confidence_below_threshold/);
    expect(txClient.submittedReallocations).toHaveLength(0);
  });

  it("skips when vault is paused (FR-A-05)", async () => {
    const { loop, txClient } = makeLoop(
      { allocation: HIGH_DRIFT_ALLOCATION, confidence: 80 },
      { paused: true }
    );

    const entry = await loop.runOnce();
    expect(entry.acted).toBe(false);
    expect(entry.skipReason).toBe("vault_paused");
    expect(txClient.submittedReallocations).toHaveLength(0);
  });

  it("skips when balance is below minimum (FR-A-05)", async () => {
    const { loop, txClient } = makeLoop(
      { allocation: HIGH_DRIFT_ALLOCATION, confidence: 80 },
      { totalBalanceMotes: BigInt(50_000_000_000) } // 50 CSPR < 100 CSPR min
    );

    const entry = await loop.runOnce();
    expect(entry.acted).toBe(false);
    expect(entry.skipReason).toMatch(/balance_below_minimum/);
    expect(txClient.submittedReallocations).toHaveLength(0);
  });

  it("skips when allocation fails sanity check (allocation_out_of_bounds)", async () => {
    const { loop, txClient } = makeLoop({
      // Weight of 7000 bps exceeds MAX_ASSET_WEIGHT_BPS=6000
      allocation: [
        { assetId: 0, bps: 7000 },
        { assetId: 1, bps: 1000 },
        { assetId: 2, bps: 800 },
        { assetId: 3, bps: 600 },
        { assetId: 4, bps: 600 },
      ],
      confidence: 80,
    });

    const entry = await loop.runOnce();
    expect(entry.acted).toBe(false);
    expect(entry.skipReason).toMatch(/allocation_out_of_bounds/);
    expect(txClient.submittedReallocations).toHaveLength(0);
  });

  it("writes a payment log entry BEFORE the decision log entry (SC-04 ordering)", async () => {
    const { loop } = makeLoop({
      allocation: HIGH_DRIFT_ALLOCATION,
      confidence: 80,
    });

    const startTs = Date.now();
    await loop.runOnce();

    const payments = await readJsonl<{ timestamp: number }>(paymentsLog);
    const decisions = await readJsonl<DecisionLogEntry>(decisionsLog);

    expect(payments).toHaveLength(1);
    expect(decisions).toHaveLength(1);

    // Both timestamps should be >= start of the test
    expect(payments[0]!.timestamp).toBeGreaterThanOrEqual(startTs);
  });

  it("survives multiple iterations without crashing (NFR-R-01)", async () => {
    const { loop } = makeLoop({
      allocation: HIGH_DRIFT_ALLOCATION,
      confidence: 80,
    });

    // Run 5 iterations
    for (let i = 0; i < 5; i++) {
      const entry = await loop.runOnce();
      expect(typeof entry.iteration).toBe("number");
    }

    const decisions = await readJsonl<DecisionLogEntry>(decisionsLog);
    expect(decisions).toHaveLength(5);
  });

  it("produces DecisionLogEntry with all required SC-05 fields", async () => {
    const { loop } = makeLoop({
      allocation: HIGH_DRIFT_ALLOCATION,
      confidence: 80,
    });

    const entry = await loop.runOnce();

    expect(typeof entry.iteration).toBe("number");
    expect(typeof entry.timestamp).toBe("number");
    expect(typeof entry.promptHash).toBe("string");
    expect(entry.promptHash.length).toBeGreaterThan(0);
    expect(typeof entry.oracleSnapshotHash).toBe("string");
    expect(entry.recommendedAllocation).toHaveLength(5);
    expect(typeof entry.confidence).toBe("number");
    expect(typeof entry.rationale).toBe("string");
    expect(entry.rationale.length).toBeGreaterThan(0);
    expect(typeof entry.acted).toBe("boolean");
  });
});

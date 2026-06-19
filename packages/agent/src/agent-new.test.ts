/**
 * Additional agent loop tests covering gaps identified in the CI/CD review.
 *
 * New coverage:
 *  1. Reputation epoch path — computes a delta and calls submitUpdateReputation
 *     via the mock Casper client (SC-06, FR-A-07).
 *  2. Loop-overlap guard — a tick fired while a prior iteration is still
 *     "running" is skipped without submitting any transaction (RISK-14).
 *  3. Malformed LLM output never produces an on-chain submit (NFR-S-06).
 *     This test exercises the Zod validation path by returning structurally
 *     invalid data from the mock LLM rather than throwing.
 *
 * All network/SDK calls are behind injectable mocks — no real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { AgentLoop } from "./loop.js";
import { MockTxClient } from "./clients/casper-tx-client.js";
import type {
  VaultState,
  AgentReputation,
  RwaOracleData,
  LlmClient,
  LlmDecision,
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

// Allocation with enough drift to trigger ACT (> 200 bps threshold)
const HIGH_DRIFT_ALLOCATION = [
  { assetId: 0, bps: 1000 },
  { assetId: 1, bps: 4000 },
  { assetId: 2, bps: 2000 },
  { assetId: 3, bps: 2000 },
  { assetId: 4, bps: 1000 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockCasperRead(overrides: Partial<VaultState> = {}): CasperReadClient {
  return {
    getVaultState: async () => ({ ...MOCK_VAULT, ...overrides }),
    getReputation: async () => MOCK_REPUTATION,
    getTransactionStatus: async () => ({ status: "confirmed" as const }),
  } as unknown as CasperReadClient;
}

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
  tmpDir = path.join(tmpdir(), `aegis-new-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  decisionsLog = path.join(tmpDir, "decisions.jsonl");
  paymentsLog = path.join(tmpDir, "payments.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Poll a predicate until true or the timeout elapses (robust under load). */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function makeBaseConfig(overrides: Record<string, unknown> = {}) {
  return {
    reallocationDriftBps: 200,
    minConfidenceThreshold: 60,
    minVaultBalanceMotes: BigInt("100000000000"),
    maxAssetWeightBps: 6000,
    txConfirmTimeoutMs: 5_000,
    reputationUpdateEpochs: 3,
    agentAccountHash: "test-agent-hash",
    decisionsLogPath: decisionsLog,
    paymentsLogPath: paymentsLog,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AgentLoop — reputation epoch (SC-06, FR-A-07)", () => {
  it("calls submitUpdateReputation with a non-zero delta after N acted epochs", async () => {
    const txClient = new MockTxClient();
    // reputationUpdateEpochs=1 means every iteration checks the reputation path
    const loop = new AgentLoop(
      makeBaseConfig({ reputationUpdateEpochs: 1 }),
      {
        casperRead: makeMockCasperRead(),
        oracle: makeMockOracle(),
        llm: {
          async decide(): Promise<LlmDecision> {
            return {
              allocation: HIGH_DRIFT_ALLOCATION,
              confidence: 80,
              rationale: "Mock: high drift allocation for reputation test.",
            };
          },
        } satisfies LlmClient,
        tx: txClient,
      }
    );

    // Run one iteration so there is ≥1 acted decision in the log
    const entry = await loop.runOnce();
    expect(entry.acted).toBe(true);

    // The reputation epoch fires asynchronously in the same tick.
    // Give the microtask/event-loop time to complete the background async call.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // The reputation path should have submitted update_reputation with a non-zero delta
    expect(txClient.submittedReputationUpdates.length).toBeGreaterThanOrEqual(1);
    const repUpdate = txClient.submittedReputationUpdates[0];
    expect(repUpdate).toBeDefined();
    expect(repUpdate!.agentAccountHash).toBe("test-agent-hash");
    // delta must be +1 or -1 (never 0 when decisions are present per computeReputationDelta)
    expect(Math.abs(repUpdate!.delta)).toBe(1);
    // rationaleHash must be a 32-byte Buffer
    expect(Buffer.isBuffer(repUpdate!.rationaleHash)).toBe(true);
    expect(repUpdate!.rationaleHash.byteLength).toBe(32);
  });
});

describe("AgentLoop — loop-overlap guard (RISK-14)", () => {
  it("skips a tick when a prior iteration is still running", async () => {
    let resolvePrior!: () => void;
    const priorIterationHeld = new Promise<void>((resolve) => {
      resolvePrior = resolve;
    });

    // LLM client that stalls the FIRST decide() until we release the lock, then
    // resolves instantly for any subsequent call — simulates a slow iteration.
    let decideCalls = 0;
    const stallingLlm: LlmClient = {
      async decide(): Promise<LlmDecision> {
        decideCalls += 1;
        if (decideCalls === 1) await priorIterationHeld;
        return {
          allocation: HIGH_DRIFT_ALLOCATION,
          confidence: 80,
          rationale: "Stalling LLM for overlap test.",
        };
      },
    };

    const txClient = new MockTxClient();
    const loop = new AgentLoop(makeBaseConfig(), {
      casperRead: makeMockCasperRead(),
      oracle: makeMockOracle(),
      llm: stallingLlm,
      tx: txClient,
    });

    // Capture stdout to verify the skip message.
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });

    // Drive the overlap guard purely through the loop's own tick mechanism:
    // start() fires tick #1 immediately, which sets running=true and stalls at
    // the LLM. Every subsequent interval tick must hit the running guard and skip.
    loop.start(10);

    // Poll (not fixed-sleep) until at least one tick has been skipped — robust
    // under concurrent test load.
    await waitFor(
      () => output.some((l) => l.includes("prior_iteration_running")),
      2000
    );

    // Stop the loop FIRST so no further ticks are scheduled, then release the
    // stalled first iteration. This makes the count deterministic: only the
    // single in-flight (non-skipped) iteration can complete and submit.
    loop.stop();
    resolvePrior();
    await waitFor(() => txClient.submittedReallocations.length >= 1, 2000);

    // Allow any in-flight skipped tick to unwind before teardown removes tmpDir.
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    vi.restoreAllMocks();

    const skipMessages = output.filter((line) =>
      line.includes("prior_iteration_running")
    );
    expect(skipMessages.length).toBeGreaterThanOrEqual(1);

    // Exactly one reallocate: only the first (non-skipped) iteration acted.
    expect(txClient.submittedReallocations).toHaveLength(1);
  });
});

describe("AgentLoop — malformed LLM output never submits on-chain (NFR-S-06)", () => {
  it("does not submit a transaction when LLM returns structurally invalid JSON allocation", async () => {
    // This LLM returns data that passes JSON.parse but fails Zod validation:
    // allocation has only 3 entries instead of 5 required.
    const zodFailingLlm: LlmClient = {
      async decide(): Promise<LlmDecision> {
        // Return an object that Zod will reject: allocation has only 3 entries
        return {
          allocation: [
            { assetId: 0, bps: 3334 },
            { assetId: 1, bps: 3333 },
            { assetId: 2, bps: 3333 },
            // Missing assetId 3 and 4 — Zod allocationMapSchema requires exactly 5
          ] as never,
          confidence: 85,
          rationale: "Truncated allocation — should fail Zod.",
        };
      },
    };

    const txClient = new MockTxClient();
    const loop = new AgentLoop(makeBaseConfig(), {
      casperRead: makeMockCasperRead(),
      oracle: makeMockOracle(),
      llm: zodFailingLlm,
      tx: txClient,
    });

    const entry = await loop.runOnce();

    // Must be skipped — never reaches ACT
    expect(entry.acted).toBe(false);
    expect(entry.txHash).toBeNull();
    // Zod validation rejects the allocation and the skip reason must reflect it
    expect(entry.skipReason).toMatch(/llm_invalid_output/);
    // The tx client must not have been called
    expect(txClient.submittedReallocations).toHaveLength(0);
  });

  it("does not submit when LLM returns confidence > 100 (schema violation)", async () => {
    const outOfBoundsConfidenceLlm: LlmClient = {
      async decide(): Promise<LlmDecision> {
        return {
          allocation: HIGH_DRIFT_ALLOCATION,
          confidence: 150, // > 100: fails Zod
          rationale: "Out-of-bounds confidence.",
        };
      },
    };

    const txClient = new MockTxClient();
    const loop = new AgentLoop(makeBaseConfig(), {
      casperRead: makeMockCasperRead(),
      oracle: makeMockOracle(),
      llm: outOfBoundsConfidenceLlm,
      tx: txClient,
    });

    const entry = await loop.runOnce();

    expect(entry.acted).toBe(false);
    expect(entry.txHash).toBeNull();
    expect(entry.skipReason).toMatch(/llm_invalid_output/);
    expect(txClient.submittedReallocations).toHaveLength(0);
  });

  it("does not submit when LLM returns allocation summing to != 10000 (sanity bound)", async () => {
    // Allocation passes Zod (5 entries, each in range) but fails allocationSanityCheck
    // because the bps don't sum to 10000.
    const badSumLlm: LlmClient = {
      async decide(): Promise<LlmDecision> {
        return {
          allocation: [
            { assetId: 0, bps: 2000 },
            { assetId: 1, bps: 2000 },
            { assetId: 2, bps: 2000 },
            { assetId: 3, bps: 2000 },
            { assetId: 4, bps: 1999 }, // sum = 9999, not 10000
          ],
          confidence: 85,
          rationale: "Bad sum allocation.",
        };
      },
    };

    const txClient = new MockTxClient();
    const loop = new AgentLoop(makeBaseConfig(), {
      casperRead: makeMockCasperRead(),
      oracle: makeMockOracle(),
      llm: badSumLlm,
      tx: txClient,
    });

    const entry = await loop.runOnce();

    expect(entry.acted).toBe(false);
    expect(entry.txHash).toBeNull();
    expect(entry.skipReason).toMatch(/allocation_out_of_bounds/);
    expect(txClient.submittedReallocations).toHaveLength(0);
  });
});

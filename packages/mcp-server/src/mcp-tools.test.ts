/**
 * MCP server tool registration and invocation tests.
 *
 * New coverage (supplements mcp-server.test.ts):
 *  1. All 6 required tools are registered and returned by ListTools (SC-07, FR-M-02).
 *  2. submit_reallocation dry-run returns without signing or calling the tx client
 *     (SC-07 dry-run smoke-test path).
 *  3. Each of the 6 tool handler functions can be invoked with valid args and returns
 *     a serialisable result (no network calls — all mocked).
 *
 * The MCP SDK's Server class exposes registered handlers via the internal request
 * mechanism. We invoke the ListTools handler directly to verify all 6 tool names.
 */

import { describe, it, expect } from "vitest";
import { createMcpServer } from "./mcp-server.js";
import {
  handleGetVaultState,
  handleGetAgentReputation,
  handleSubmitReallocation,
  handleFetchRwaOracleData,
  handleGetDecisionLog,
  handleGetTransactionStatus,
  type ToolContext,
} from "./tools.js";
import type { CasperReadClient } from "@aegis/agent";
import type { OracleClient } from "@aegis/agent";
import type { TxClient } from "@aegis/agent";
import type { VaultState, AgentReputation, RwaOracleData } from "@aegis/shared";
import { tmpdir } from "node:os";
import path from "node:path";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_VAULT: VaultState = {
  totalBalanceMotes: BigInt("1000000000000"),
  totalShares: BigInt("1000000000000"),
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

const MOCK_ORACLE: RwaOracleData = {
  timestamp: Date.now(),
  oracleVersion: "1.0.0",
  paymentReceipt: {
    paymentHash: "hash123",
    facilitator: "mock",
    amountMotes: BigInt(1_000_000),
    payerAccountHash: "test-agent-hash",
    expiry: Math.floor(Date.now() / 1000) + 300,
    confirmedAt: Math.floor(Date.now() / 1000),
  },
  assets: Array.from({ length: 5 }, (_, i) => ({
    assetId: i,
    name: `Asset ${i}`,
    apyBps: 500 + i * 100,
    riskScore: 30,
    liquidityScore: 70,
    dataFreshnessMs: Date.now(),
  })),
};

// ── Mock TxClient that tracks calls ──────────────────────────────────────────

class TrackingTxClient implements TxClient {
  public submitReallocationCalls = 0;
  public submitReputationCalls = 0;

  async submitReallocate() {
    this.submitReallocationCalls++;
    return { txHash: "mock-tx-hash" };
  }

  async submitUpdateReputation() {
    this.submitReputationCalls++;
    return { txHash: "mock-rep-hash" };
  }

  async getTransactionStatus(_txHash: string) {
    return { status: "confirmed" as const };
  }
}

function makeContext(txOverride?: TxClient): ToolContext {
  const casperRead: CasperReadClient = {
    getVaultState: async () => MOCK_VAULT,
    getReputation: async () => MOCK_REPUTATION,
    getTransactionStatus: async () => ({ status: "confirmed" as const }),
  } as unknown as CasperReadClient;

  const oracle: OracleClient = {
    fetch: async () => MOCK_ORACLE,
  } as unknown as OracleClient;

  const tx: TxClient = txOverride ?? {
    submitReallocate: async () => ({ txHash: "mock-tx-hash" }),
    submitUpdateReputation: async () => ({ txHash: "mock-rep-hash" }),
    getTransactionStatus: async () => ({ status: "confirmed" as const }),
  };

  return {
    casperRead,
    oracle,
    tx,
    decisionsLogPath: path.join(tmpdir(), `aegis-mcp-tools-test-${Date.now()}.jsonl`),
    agentAccountHash: "test-agent-hash",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MCP server — all 6 tools registered (SC-07, FR-M-02)", () => {
  const REQUIRED_TOOLS = [
    "get_vault_state",
    "get_agent_reputation",
    "submit_reallocation",
    "fetch_rwa_oracle_data",
    "get_decision_log",
    "get_transaction_status",
  ] as const;

  it("createMcpServer registers exactly 6 tools including all required names", async () => {
    const ctx = makeContext();
    const server = createMcpServer(ctx);

    // Use InMemoryTransport to connect a Client to the Server and call ListTools.
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Connect the server
    await server.connect(serverTransport);

    // Connect a client
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    // Call ListTools via the client
    const response = await client.listTools();

    const toolNames = response.tools.map((t) => t.name);

    // Verify count and all required names
    expect(toolNames).toHaveLength(6);
    for (const required of REQUIRED_TOOLS) {
      expect(toolNames).toContain(required);
    }

    await client.close();
  });
});

describe("MCP server — submit_reallocation dry-run never calls tx client", () => {
  it("returns dry_run status and does not call submitReallocate", async () => {
    const txClient = new TrackingTxClient();
    const ctx = makeContext(txClient);

    const result = await handleSubmitReallocation(ctx, {
      allocation: [
        { assetId: 0, bps: 2000 },
        { assetId: 1, bps: 2000 },
        { assetId: 2, bps: 2000 },
        { assetId: 3, bps: 2000 },
        { assetId: 4, bps: 2000 },
      ],
      dry_run: true,
    });

    const r = result as Record<string, unknown>;
    expect(r.status).toBe("dry_run");
    expect(r.tx_hash).toBeNull();

    // The tx client must not have been invoked
    expect(txClient.submitReallocationCalls).toBe(0);
  });

  it("returns submitted status and calls submitReallocate when dry_run is false", async () => {
    const txClient = new TrackingTxClient();
    const ctx = makeContext(txClient);

    const result = await handleSubmitReallocation(ctx, {
      allocation: [
        { assetId: 0, bps: 2000 },
        { assetId: 1, bps: 2000 },
        { assetId: 2, bps: 2000 },
        { assetId: 3, bps: 2000 },
        { assetId: 4, bps: 2000 },
      ],
      dry_run: false,
    });

    const r = result as Record<string, unknown>;
    expect(r.status).toBe("submitted");
    expect(typeof r.tx_hash).toBe("string");
    expect(txClient.submitReallocationCalls).toBe(1);
  });
});

describe("MCP server — all 6 tool handlers return serialisable data", () => {
  it("handleGetVaultState serialises BigInt fields as strings", async () => {
    const ctx = makeContext();
    const result = await handleGetVaultState(ctx);
    const r = result as Record<string, unknown>;
    expect(typeof r.totalBalanceMotes).toBe("string");
    expect(typeof r.totalShares).toBe("string");
    expect(Array.isArray(r.allocation)).toBe(true);
    expect((r.allocation as unknown[]).length).toBe(5);
    expect(typeof r.paused).toBe("boolean");
  });

  it("handleGetAgentReputation serialises BigInt fields as strings", async () => {
    const ctx = makeContext();
    const result = await handleGetAgentReputation(ctx, {
      agent_account_hash: "test-agent-hash",
    });
    const r = result as Record<string, unknown>;
    expect(typeof r.score).toBe("string");
    expect(typeof r.totalDecisions).toBe("string");
    expect(typeof r.correctPredictions).toBe("string");
    expect(r.agentAccountHash).toBe("test-agent-hash");
  });

  it("handleFetchRwaOracleData returns 5 assets with serialisable amountMotes", async () => {
    const ctx = makeContext();
    const result = await handleFetchRwaOracleData(ctx);
    const r = result as Record<string, unknown>;
    expect(Array.isArray(r.assets)).toBe(true);
    expect((r.assets as unknown[]).length).toBe(5);
    const receipt = r.paymentReceipt as Record<string, unknown>;
    // amountMotes must be serialised as string (BigInt JSON safety)
    expect(typeof receipt.amountMotes).toBe("string");
  });

  it("handleGetDecisionLog returns an array (empty for non-existent file)", async () => {
    const ctx = makeContext();
    ctx.decisionsLogPath = path.join(
      tmpdir(),
      `no-such-decisions-${Date.now()}.jsonl`
    );
    const result = await handleGetDecisionLog(ctx, { limit: 5 });
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBe(0);
  });

  it("handleGetTransactionStatus returns tx_hash and status fields", async () => {
    const ctx = makeContext();
    const result = await handleGetTransactionStatus(ctx, {
      tx_hash: "test-tx-hash-abc",
    });
    const r = result as Record<string, unknown>;
    expect(r.tx_hash).toBe("test-tx-hash-abc");
    expect(typeof r.status).toBe("string");
    expect(["pending", "confirmed", "failed"]).toContain(r.status);
  });
});

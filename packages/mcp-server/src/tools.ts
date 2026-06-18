/**
 * MCP tool handler implementations.
 *
 * Each handler is a plain async function that accepts validated args and
 * returns a plain serialisable value. The server wires these into MCP tool
 * registrations. Handlers are framework-agnostic so they can be wrapped
 * behind an alternative MCP host if required (A-015).
 *
 * Tool list (FR-M-02):
 *   get_vault_state, get_agent_reputation, submit_reallocation,
 *   fetch_rwa_oracle_data, get_decision_log, get_transaction_status
 */

import { readJsonl } from "@aegis/shared";
import type { DecisionLogEntry, AllocationMap } from "@aegis/shared";
import type { CasperReadClient } from "@aegis/agent";
import type { OracleClient } from "@aegis/agent";
import type { TxClient } from "@aegis/agent";

// ── Context passed to all handlers ────────────────────────────────────────────

export interface ToolContext {
  casperRead: CasperReadClient;
  oracle: OracleClient;
  tx: TxClient;
  decisionsLogPath: string;
  agentAccountHash: string;
}

// ── Tool implementations ──────────────────────────────────────────────────────

/**
 * get_vault_state — query live vault state from testnet (FR-M-02).
 */
export async function handleGetVaultState(ctx: ToolContext): Promise<unknown> {
  const state = await ctx.casperRead.getVaultState();
  return {
    totalBalanceMotes: state.totalBalanceMotes.toString(),
    totalShares: state.totalShares.toString(),
    allocation: state.allocation,
    agentAccountHash: state.agentAccountHash,
    paused: state.paused,
    lastReallocationTs: state.lastReallocationTs,
  };
}

/**
 * get_agent_reputation — query agent reputation from registry.
 */
export async function handleGetAgentReputation(
  ctx: ToolContext,
  args: { agent_account_hash: string }
): Promise<unknown> {
  const rep = await ctx.casperRead.getReputation(args.agent_account_hash);
  return {
    agentAccountHash: rep.agentAccountHash,
    score: rep.score.toString(),
    totalDecisions: rep.totalDecisions.toString(),
    correctPredictions: rep.correctPredictions.toString(),
    registeredTs: rep.registeredTs,
  };
}

/**
 * submit_reallocation — sign and submit a reallocate transaction.
 *
 * Accepts an optional `dry_run` flag for smoke-testing without a live tx (SC-07).
 */
export async function handleSubmitReallocation(
  ctx: ToolContext,
  args: {
    allocation: AllocationMap;
    dry_run?: boolean;
  }
): Promise<unknown> {
  if (args.dry_run === true) {
    return {
      tx_hash: null,
      status: "dry_run",
      message: "Dry run — no transaction submitted",
      allocation: args.allocation,
    };
  }

  const result = await ctx.tx.submitReallocate(args.allocation);
  return {
    tx_hash: result.txHash,
    status: "submitted",
  };
}

/**
 * fetch_rwa_oracle_data — fetch RWA yield data via x402.
 */
export async function handleFetchRwaOracleData(ctx: ToolContext): Promise<unknown> {
  const data = await ctx.oracle.fetch();
  return {
    timestamp: data.timestamp,
    oracleVersion: data.oracleVersion,
    paymentReceipt: {
      ...data.paymentReceipt,
      amountMotes: data.paymentReceipt.amountMotes.toString(),
    },
    assets: data.assets,
  };
}

/**
 * get_decision_log — read the last N agent decisions from decisions.jsonl.
 */
export async function handleGetDecisionLog(
  ctx: ToolContext,
  args: { limit?: number }
): Promise<unknown> {
  const limit = Math.min(args.limit ?? 20, 100);
  const entries = await readJsonl<DecisionLogEntry>(ctx.decisionsLogPath, limit);
  return entries;
}

/**
 * get_transaction_status — query a deploy/tx hash on testnet.
 */
export async function handleGetTransactionStatus(
  ctx: ToolContext,
  args: { tx_hash: string }
): Promise<unknown> {
  const status = await ctx.tx.getTransactionStatus(args.tx_hash);
  return {
    tx_hash: args.tx_hash,
    ...status,
  };
}

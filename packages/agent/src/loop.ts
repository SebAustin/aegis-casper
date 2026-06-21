/**
 * Aegis autonomous agent loop.
 *
 * State machine: IDLE → PERCEIVE → DECIDE → (GATE) → ACT → LOG → REPUTATION? → IDLE
 *
 * Key behaviours:
 * - Loop-overlap guard: skips a tick if the prior iteration is still running (RISK-14)
 * - Non-blocking ACT: submits tx, logs hash immediately, confirms in background
 * - Zod gate: validates LLM output before any on-chain action (NFR-S-06)
 * - Allocation sanity bound: 5 slots, each ≤ MAX_ASSET_WEIGHT_BPS, sum==10000
 * - Graceful error handling: log and continue on any single-iteration failure (NFR-R-01)
 *
 * Dependency injection: all external clients are passed in so tests can supply mocks
 * without hitting the network.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendJsonl,
  readJsonl,
  allocationSanityCheck,
  buildDemoOracleSnapshot,
  driftBps,
  llmDecisionSchema,
  normalizeDecisionLogEntry,
} from "@aegis/shared";
import type {
  DecisionLogEntry,
  LlmClient,
} from "@aegis/shared";
import type { CasperReadClient } from "./clients/casper-read-client.js";
import type { OracleClient } from "./clients/oracle-client.js";
import type { TxClient } from "./clients/casper-tx-client.js";
import { computeReputationDelta } from "./reputation.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  reallocationDriftBps: number;
  minConfidenceThreshold: number;
  minVaultBalanceMotes: bigint;
  maxAssetWeightBps: number;
  txConfirmTimeoutMs: number;
  reputationUpdateEpochs: number;
  reputationSeedScore: bigint;
  agentAccountHash: string;
  decisionsLogPath: string;
  paymentsLogPath: string;
  /**
   * Self-contained offline demo (env AGENT_OFFLINE_DEMO). When true the loop
   * never enters the RPC rate-limit cooldown and bypasses the
   * "don't act on placeholder reads" gate, so the full cycle completes locally
   * against the injected mock tx client. The production default (false)
   * preserves the verified safety behaviour exactly.
   */
  offlineDemo?: boolean;
}

export interface AgentClients {
  casperRead: CasperReadClient;
  oracle: OracleClient;
  llm: LlmClient;
  tx: TxClient;
}

// ── Agent loop ────────────────────────────────────────────────────────────────

export class AgentLoop {
  private iteration = 0;
  private running = false;
  private rateLimitedUntil = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: AgentConfig,
    private readonly clients: AgentClients
  ) {}

  /** True while the loop is in post-429 cooldown (no on-chain act). */
  isInRpcCooldown(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  /** Milliseconds remaining in RPC cooldown, or 0. */
  getRpcCooldownRemainingMs(): number {
    return Math.max(0, this.rateLimitedUntil - Date.now());
  }

  /** True while a single iteration (perceive → act) is in flight. */
  isIterationRunning(): boolean {
    return this.running;
  }

  /**
   * Start the continuous loop at the given interval.
   */
  start(intervalMs: number): void {
    if (this.intervalHandle !== null) {
      throw new Error("AgentLoop.start() called while already running");
    }

    this.intervalHandle = setInterval(() => {
      void this.tick();
    }, intervalMs);

    // Kick off immediately
    void this.tick();
  }

  /**
   * Stop the loop (drains the current iteration first).
   */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Run a single iteration (exposed for dashboard "Trigger" + MCP tool).
   */
  async runOnce(): Promise<DecisionLogEntry> {
    if (this.running) {
      return {
        iteration: this.iteration,
        timestamp: Date.now(),
        promptHash: "",
        oracleSnapshotHash: "",
        recommendedAllocation: [],
        confidence: 0,
        rationale: "",
        acted: false,
        txHash: null,
        skipReason: "prior_iteration_running",
      };
    }
    if (!this.config.offlineDemo && Date.now() < this.rateLimitedUntil) {
      return {
        iteration: this.iteration,
        timestamp: Date.now(),
        promptHash: "",
        oracleSnapshotHash: "",
        recommendedAllocation: [],
        confidence: 0,
        rationale: "",
        acted: false,
        txHash: null,
        skipReason: "rpc_rate_limited: wait before retrying",
      };
    }
    return this.iterate();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    // Loop-overlap guard (RISK-14)
    if (this.running) {
      process.stdout.write(
        JSON.stringify({
          level: "warn",
          service: "agent",
          iteration: this.iteration,
          msg: "Tick skipped — prior iteration still running",
          skipReason: "prior_iteration_running",
        }) + "\n"
      );
      return;
    }

    if (!this.config.offlineDemo && Date.now() < this.rateLimitedUntil) {
      process.stdout.write(
        JSON.stringify({
          level: "warn",
          service: "agent",
          iteration: this.iteration,
          msg: "Tick skipped — CSPR.cloud RPC rate limit cooldown",
          skipReason: "rpc_rate_limited",
        }) + "\n"
      );
      return;
    }

    try {
      await this.iterate();
    } catch (err) {
      // Top-level catch: loop must never crash (FR-A-06)
      process.stdout.write(
        JSON.stringify({
          level: "error",
          service: "agent",
          iteration: this.iteration,
          msg: "Unhandled error in tick",
          error: String(err),
        }) + "\n"
      );
    }
  }

  private async iterate(): Promise<DecisionLogEntry> {
    this.running = true;
    const iterStart = Date.now();
    this.iteration++;
    const iter = this.iteration;

    process.stdout.write(
      JSON.stringify({
        level: "info",
        service: "agent",
        iteration: iter,
        phase: "perceive",
        msg: "Starting iteration",
      }) + "\n"
    );

    let entry: DecisionLogEntry = {
      iteration: iter,
      timestamp: iterStart,
      promptHash: "",
      oracleSnapshotHash: "",
      recommendedAllocation: [],
      confidence: 0,
      rationale: "",
      acted: false,
      txHash: null,
      skipReason: null,
    };

    try {
      entry = await this.perceiveDecideAct(iter, iterStart, entry);
    } catch (err) {
      entry = {
        ...entry,
        acted: false,
        txHash: null,
        skipReason: `iteration_error: ${String(err)}`,
      };
      if (String(err).includes("429")) {
        this.rateLimitedUntil = Date.now() + 90_000;
      }
      process.stdout.write(
        JSON.stringify({
          level: "error",
          service: "agent",
          iteration: iter,
          phase: "error",
          error: String(err),
          duration_ms: Date.now() - iterStart,
        }) + "\n"
      );
    } finally {
      this.running = false;
    }

    // Log the decision entry (always, even on skip/error)
    await appendJsonl(
      this.config.decisionsLogPath,
      normalizeDecisionLogEntry(entry)
    );

    process.stdout.write(
      JSON.stringify({
        level: "info",
        service: "agent",
        iteration: iter,
        phase: "complete",
        acted: entry.acted,
        skipReason: entry.skipReason,
        duration_ms: Date.now() - iterStart,
      }) + "\n"
    );

    // Reputation epoch check (FR-A-07)
    if (iter % this.config.reputationUpdateEpochs === 0) {
      void this.runReputationEpoch(iter);
    }

    return entry;
  }

  private async perceiveDecideAct(
    iter: number,
    iterStart: number,
    baseEntry: DecisionLogEntry
  ): Promise<DecisionLogEntry> {
    // ── PERCEIVE ────────────────────────────────────────────────────────────

    const vaultState = await this.clients.casperRead.getVaultState();
    const reputation = await this.clients.casperRead.getReputation(
      this.config.agentAccountHash,
      this.config.reputationSeedScore
    );

    let oracleUnavailable = false;
    let oracleData;
    try {
      oracleData = await this.clients.oracle.fetch();
    } catch (err) {
      oracleUnavailable = true;
      process.stderr.write(
        `[agent/oracle] fetch failed (${String(err)}) — using demo snapshot\n`
      );
      oracleData = buildDemoOracleSnapshot(this.config.agentAccountHash);
    }

    // Log payment receipt to payments.jsonl BEFORE decision entry (SC-04)
    if (!oracleUnavailable) {
      await appendJsonl(this.config.paymentsLogPath, {
        timestamp: Date.now(),
        iteration: iter,
        receipt: oracleData.paymentReceipt,
        callerAccountHash: this.config.agentAccountHash,
      });
    }

    const oracleSnapshotHash = hashObject(oracleData.assets);

    process.stdout.write(
      JSON.stringify({
        level: "info",
        service: "agent",
        iteration: iter,
        phase: "decide",
        msg: "Perceive complete, starting decide",
      }) + "\n"
    );

    // ── DECIDE ──────────────────────────────────────────────────────────────

    const decisionContext = { vaultState, oracleData, reputation, iteration: iter };
    const promptHash = hashObject(decisionContext);

    let llmDecision;
    try {
      llmDecision = await this.clients.llm.decide(decisionContext);
    } catch (firstErr) {
      // Corrective retry on LLM failure (RISK-04)
      process.stdout.write(
        JSON.stringify({
          level: "warn",
          service: "agent",
          iteration: iter,
          phase: "decide",
          msg: "LLM error on first attempt, retrying",
          error: String(firstErr),
        }) + "\n"
      );
      try {
        llmDecision = await this.clients.llm.decide(decisionContext);
      } catch (secondErr) {
        return {
          ...baseEntry,
          timestamp: iterStart,
          promptHash,
          oracleSnapshotHash,
          skipReason: `llm_error: ${String(secondErr)}`,
        };
      }
    }

    // Zod-validate the LLM output (NFR-S-06)
    const zodResult = llmDecisionSchema.safeParse(llmDecision);
    if (!zodResult.success) {
      return {
        ...baseEntry,
        timestamp: iterStart,
        promptHash,
        oracleSnapshotHash,
        skipReason: `llm_invalid_output: ${zodResult.error.message}`,
      };
    }

    const { allocation: recommended, confidence, rationale } = zodResult.data;

    const partialEntry: DecisionLogEntry = {
      ...baseEntry,
      timestamp: iterStart,
      promptHash,
      oracleSnapshotHash,
      recommendedAllocation: recommended,
      confidence,
      rationale: rationale.slice(0, 500),
    };

    // ── GATES ───────────────────────────────────────────────────────────────

    // Gate 1: Allocation sanity bound (must run before drift, PLAN §2.4)
    const sanity = allocationSanityCheck(recommended, this.config.maxAssetWeightBps);
    if (!sanity.ok) {
      return {
        ...partialEntry,
        skipReason: `allocation_out_of_bounds: ${sanity.reason}`,
      };
    }

    // Gate 2: Vault paused
    if (vaultState.paused) {
      return { ...partialEntry, skipReason: "vault_paused" };
    }

    // Gate 3: Balance below minimum
    if (vaultState.totalBalanceMotes < this.config.minVaultBalanceMotes) {
      return {
        ...partialEntry,
        skipReason: `balance_below_minimum: ${vaultState.totalBalanceMotes} < ${this.config.minVaultBalanceMotes}`,
      };
    }

    // Gate 4: Confidence below threshold
    if (confidence < this.config.minConfidenceThreshold) {
      return {
        ...partialEntry,
        skipReason: `confidence_below_threshold: ${confidence} < ${this.config.minConfidenceThreshold}`,
      };
    }

    // Gate 5: Drift threshold
    const drift = driftBps(vaultState.allocation, recommended);
    if (drift <= this.config.reallocationDriftBps) {
      return {
        ...partialEntry,
        skipReason: `drift_below_threshold: ${drift} <= ${this.config.reallocationDriftBps}`,
      };
    }

    // Gate 6: Live oracle required before on-chain act.
    // In offline-demo mode the deterministic demo oracle snapshot is the
    // intended data source, so a missing live oracle does not block the act.
    if (!this.config.offlineDemo && oracleUnavailable) {
      return { ...partialEntry, skipReason: "oracle_unavailable" };
    }

    // Gate 7: RPC rate limit — skip on-chain act to avoid retry storms and to
    // never submit a real reallocation computed from placeholder reads.
    // In offline-demo mode there are no live reads (placeholder by design) and
    // the tx client is a mock, so this safety gate is intentionally bypassed.
    const perceiveRateLimited = this.clients.casperRead.consumePerceiveRateLimited();
    if (!this.config.offlineDemo && perceiveRateLimited) {
      this.rateLimitedUntil = Date.now() + 90_000;
      return { ...partialEntry, skipReason: "rpc_rate_limited" };
    }

    // ── ACT (non-blocking confirmation, PLAN §2.4) ───────────────────────────

    process.stdout.write(
      JSON.stringify({
        level: "info",
        service: "agent",
        iteration: iter,
        phase: "act",
        msg: "All gates passed, submitting reallocate",
        drift,
      }) + "\n"
    );

    const txResult = await this.clients.tx.submitReallocate(recommended);
    const finalEntry: DecisionLogEntry = {
      ...partialEntry,
      acted: true,
      txHash: txResult.txHash,
    };

    // Background confirmation (non-blocking, RISK-14)
    void this.confirmInBackground(
      txResult.txHash,
      iter,
      this.config.txConfirmTimeoutMs
    );

    return finalEntry;
  }

  private async confirmInBackground(
    txHash: string,
    iter: number,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 10_000;

    while (Date.now() < deadline) {
      await sleep(pollInterval);
      const status = await this.clients.tx.getTransactionStatus(txHash).catch(() => ({
        status: "pending" as const,
      }));

      if (status.status === "confirmed") {
        process.stdout.write(
          JSON.stringify({
            level: "info",
            service: "agent",
            iteration: iter,
            phase: "confirm",
            txHash,
            status: "confirmed",
          }) + "\n"
        );
        return;
      }

      if (status.status === "failed") {
        process.stdout.write(
          JSON.stringify({
            level: "error",
            service: "agent",
            iteration: iter,
            phase: "confirm",
            txHash,
            status: "failed",
          }) + "\n"
        );
        return;
      }
    }

    process.stdout.write(
      JSON.stringify({
        level: "warn",
        service: "agent",
        iteration: iter,
        phase: "confirm",
        txHash,
        status: "timeout",
        timeoutMs,
      }) + "\n"
    );
  }

  private async runReputationEpoch(iter: number): Promise<void> {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        service: "agent",
        iteration: iter,
        phase: "reputation",
        msg: "Computing reputation epoch",
      }) + "\n"
    );

    try {
      // Read last N acted decisions
      const allDecisions = await readJsonl<DecisionLogEntry>(
        this.config.decisionsLogPath,
        this.config.reputationUpdateEpochs * 3
      );
      const acteDecisions = allDecisions.filter((d) => d.acted);

      // Fetch current oracle data for next-epoch yield comparison
      const currentOracle = await this.clients.oracle.fetch().catch(() => null);

      if (!currentOracle || acteDecisions.length === 0) {
        process.stdout.write(
          JSON.stringify({
            level: "warn",
            service: "agent",
            iteration: iter,
            phase: "reputation",
            msg: "Skipping reputation epoch — no acted decisions or oracle unavailable",
          }) + "\n"
        );
        return;
      }

      const { delta, rationaleHash } = computeReputationDelta(
        acteDecisions,
        currentOracle.assets
      );

      if (delta === 0) {
        process.stdout.write(
          JSON.stringify({
            level: "info",
            service: "agent",
            iteration: iter,
            phase: "reputation",
            msg: "Reputation delta is 0, skipping submission",
          }) + "\n"
        );
        return;
      }

      // Background submit (async, non-blocking — RISK-07)
      void this.clients.tx
        .submitUpdateReputation(this.config.agentAccountHash, delta, rationaleHash)
        .then((result) => {
          process.stdout.write(
            JSON.stringify({
              level: "info",
              service: "agent",
              iteration: iter,
              phase: "reputation",
              msg: "Reputation update submitted",
              delta,
              txHash: result.txHash,
            }) + "\n"
          );
        })
        .catch((err) => {
          process.stdout.write(
            JSON.stringify({
              level: "error",
              service: "agent",
              iteration: iter,
              phase: "reputation",
              msg: "Reputation update failed",
              error: String(err),
            }) + "\n"
          );
        });
    } catch (err) {
      process.stdout.write(
        JSON.stringify({
          level: "error",
          service: "agent",
          iteration: iter,
          phase: "reputation",
          error: String(err),
        }) + "\n"
      );
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashObject(obj: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(obj, bigIntReplacer))
    .digest("hex");
}

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Resolve default log paths relative to repo root ──────────────────────────

function repoRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // dist/loop.js → packages/agent → repo root
  return path.resolve(__dirname, "../../..");
}

export function defaultDecisionsLogPath(): string {
  return path.join(repoRoot(), "logs", "decisions.jsonl");
}

export function defaultPaymentsLogPath(): string {
  return path.join(repoRoot(), "logs", "payments.jsonl");
}

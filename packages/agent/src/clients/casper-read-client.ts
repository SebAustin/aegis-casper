/**
 * CasperReadClient — reads vault and registry state from CSPR.cloud REST API.
 *
 * Implements a simple 10-second TTL cache to avoid rate limits (RISK-03).
 * Tolerates offline conditions with clear error messages.
 *
 * VaultClient.getState() and RegistryClient.getReputation() are the two
 * main read paths used by the perceive phase of the agent loop.
 */

import type { VaultState, AgentReputation, AllocationMap } from "@aegis/shared";
import {
  createCasperRpcClient,
  isRateLimitError,
  readReputationFromRpc,
  readVaultStateFromRpc,
  withRpcRetry,
} from "@aegis/shared";
import { csprCloudAuthHeaders, stripHashPrefix } from "@aegis/shared";

// ── Types matching CSPR.cloud REST response shapes ────────────────────────────

interface CsprCloudNamedKey {
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

// ── CasperReadClient ──────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CasperReadClient {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly TTL_MS = 30_000;
  private perceiveRateLimited = false;

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string | undefined,
    private readonly vaultContractHash: string | undefined,
    private readonly registryContractHash: string | undefined,
    private readonly nodeRpcUrl: string = "https://node.testnet.cspr.cloud/rpc",
    private readonly agentAccountHash: string = "",
    /** Offline demo: skip all network reads, return seeded placeholder state. */
    private readonly offlineDemo: boolean = false
  ) {}

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async fetchJson<T>(path: string): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...csprCloudAuthHeaders(this.apiKey),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`CSPR.cloud ${path} → HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value as T;
    }
    this.cache.delete(key);
    return undefined;
  }

  private setCached<T>(key: string, value: T): void {
    this.cache.set(key, { value, expiresAt: Date.now() + this.TTL_MS });
  }

  /** True when the last perceive-phase RPC read hit HTTP 429. */
  consumePerceiveRateLimited(): boolean {
    const flag = this.perceiveRateLimited;
    this.perceiveRateLimited = false;
    return flag;
  }

  // ── Vault state ─────────────────────────────────────────────────────────────

  /**
   * Query current vault state.
   * Returns a placeholder / offline-safe VaultState if the contract hash is
   * not configured or CSPR.cloud is unreachable.
   */
  async getVaultState(): Promise<VaultState> {
    if (this.offlineDemo) {
      // No network call, no quota burn, no rate-limit flag — seeded state.
      return placeholderVaultState();
    }

    const cacheKey = `vault:${this.vaultContractHash}`;
    const cached = this.getCached<VaultState>(cacheKey);
    if (cached) return cached;

    if (!this.vaultContractHash) {
      process.stderr.write(
        "[agent/casper-read] VAULT_CONTRACT_HASH not set — using placeholder state\n"
      );
      return placeholderVaultState();
    }

    try {
      const rpc = await createCasperRpcClient({
        nodeRpcUrl: this.nodeRpcUrl,
        apiKey: this.apiKey,
      });
      const state = await readVaultStateFromRpc(
        rpc,
        this.vaultContractHash,
        this.agentAccountHash,
        { readPolicy: "fast-fail" }
      );
      this.setCached(cacheKey, state);
      return state;
    } catch (rpcErr) {
      if (isRateLimitError(rpcErr)) {
        this.perceiveRateLimited = true;
        process.stderr.write(
          `[agent/casper-read] getVaultState rate limited — using placeholder\n`
        );
        return placeholderVaultState();
      }
      try {
        const data = await this.fetchJson<{ data: { named_keys: CsprCloudNamedKey[] } }>(
          `/contracts/${stripHashPrefix(this.vaultContractHash)}`
        );
        const state = parseVaultState(data.data.named_keys);
        this.setCached(cacheKey, state);
        return state;
      } catch (err) {
        process.stderr.write(
          `[agent/casper-read] getVaultState error: ${String(rpcErr)} / ${String(err)} — using placeholder\n`
        );
        return placeholderVaultState();
      }
    }
  }

  // ── Registry / reputation ────────────────────────────────────────────────────

  /**
   * Query agent reputation from the registry contract.
   */
  async getReputation(
    agentAccountHash: string,
    fallbackScore: bigint = 50n
  ): Promise<AgentReputation> {
    if (this.offlineDemo) {
      return placeholderReputation(agentAccountHash, fallbackScore);
    }

    const cacheKey = `rep:${agentAccountHash}`;
    const cached = this.getCached<AgentReputation>(cacheKey);
    if (cached) return cached;

    if (!this.registryContractHash) {
      process.stderr.write(
        "[agent/casper-read] REGISTRY_CONTRACT_HASH not set — using placeholder reputation\n"
      );
      return placeholderReputation(agentAccountHash, fallbackScore);
    }

    try {
      const rpc = await createCasperRpcClient({
        nodeRpcUrl: this.nodeRpcUrl,
        apiKey: this.apiKey,
      });
      const rep = await readReputationFromRpc(
        rpc,
        this.registryContractHash,
        agentAccountHash,
        { readPolicy: "fast-fail" }
      );
      if (rep) {
        this.setCached(cacheKey, rep);
        return rep;
      }
    } catch (rpcErr) {
      if (isRateLimitError(rpcErr)) {
        this.perceiveRateLimited = true;
        process.stderr.write(
          `[agent/casper-read] getReputation rate limited — using seed fallback\n`
        );
        return placeholderReputation(agentAccountHash, fallbackScore);
      }
      process.stderr.write(
        `[agent/casper-read] getReputation RPC error: ${String(rpcErr)}\n`
      );
    }

    try {
      const data = await this.fetchJson<{ data: { named_keys: CsprCloudNamedKey[] } }>(
        `/contracts/${stripHashPrefix(this.registryContractHash)}`
      );
      const rep = parseReputation(data.data.named_keys, agentAccountHash);
      this.setCached(cacheKey, rep);
      return rep;
    } catch (err) {
      process.stderr.write(
        `[agent/casper-read] getReputation error: ${String(err)} — using seed fallback\n`
      );
      return placeholderReputation(agentAccountHash, fallbackScore);
    }
  }

  // ── Transaction status ────────────────────────────────────────────────────

  /**
   * Query a transaction/deploy hash for its confirmation status.
   */
  async getTransactionStatus(txHash: string): Promise<{
    status: "pending" | "confirmed" | "failed";
    blockHeight?: number;
    timestamp?: number;
  }> {
    try {
      const sdkMod = (await import("casper-js-sdk")) as {
        HttpHandler: new (url: string) => { setCustomHeaders?(h: Record<string, string>): void };
        RpcClient: new (handler: unknown) => {
          getTransactionByTransactionHash(hash: string): Promise<{
            executionInfo?: {
              executionResult?: { isSuccess?: () => boolean; isFailure?: () => boolean };
              blockHeight?: number;
            };
          }>;
        };
        default?: unknown;
      };
      const sdk = (sdkMod.default ?? sdkMod) as typeof sdkMod;
      const handler = new sdk.HttpHandler(this.nodeRpcUrl);
      if (this.apiKey && handler.setCustomHeaders) {
        handler.setCustomHeaders({ Authorization: this.apiKey });
      }
      const rpc = new sdk.RpcClient(handler);
      const info = await withRpcRetry(() =>
        rpc.getTransactionByTransactionHash(txHash.replace(/^0x/, ""))
      );
      const result = info.executionInfo?.executionResult;
      if (result?.isFailure?.()) {
        return { status: "failed", blockHeight: info.executionInfo?.blockHeight };
      }
      if (result?.isSuccess?.()) {
        return {
          status: "confirmed",
          blockHeight: info.executionInfo?.blockHeight,
        };
      }
      return { status: "pending" };
    } catch {
      return { status: "pending" };
    }
  }
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseVaultState(namedKeys: CsprCloudNamedKey[]): VaultState {
  const get = (name: string) => namedKeys.find((k) => k.key === name)?.value;

  const allocationRaw = get("allocation_bps") ?? {};
  const allocation: AllocationMap = Object.entries(
    allocationRaw as Record<string, number>
  ).map(([id, bps]) => ({ assetId: Number(id), bps: Number(bps) }));

  // Pad to 5 entries if contract returns fewer (initialisation race)
  while (allocation.length < 5) {
    const missing = allocation.length;
    allocation.push({ assetId: missing, bps: 0 });
  }

  return {
    totalBalanceMotes: BigInt(String(get("total_balance_motes") ?? "0")),
    totalShares: BigInt(String(get("total_shares") ?? "0")),
    allocation,
    agentAccountHash: String(get("agent") ?? ""),
    paused: Boolean(get("paused") ?? false),
    lastReallocationTs: Number(get("last_reallocation_ts") ?? 0),
  };
}

function parseReputation(
  namedKeys: CsprCloudNamedKey[],
  agentAccountHash: string
): AgentReputation {
  const get = (name: string) => namedKeys.find((k) => k.key === name)?.value;

  return {
    agentAccountHash,
    score: BigInt(String(get("score") ?? "50")),
    totalDecisions: BigInt(String(get("total_decisions") ?? "0")),
    correctPredictions: BigInt(String(get("correct_predictions") ?? "0")),
    registeredTs: Number(get("registered_ts") ?? 0),
  };
}

// ── Placeholders (offline / unconfigured) ─────────────────────────────────────

function placeholderVaultState(): VaultState {
  return {
    totalBalanceMotes: BigInt("1000000000000"), // 1000 CSPR
    totalShares: BigInt("1000000000000"),
    allocation: [
      { assetId: 0, bps: 2000 },
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 2000 },
    ],
    agentAccountHash: "placeholder-agent-account-hash",
    paused: false,
    lastReallocationTs: 0,
  };
}

function placeholderReputation(
  agentAccountHash: string,
  score: bigint = 50n
): AgentReputation {
  return {
    agentAccountHash,
    score,
    totalDecisions: BigInt(0),
    correctPredictions: BigInt(0),
    registeredTs: 0,
  };
}

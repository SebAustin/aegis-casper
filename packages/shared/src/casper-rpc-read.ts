/**
 * On-chain vault reads via Casper node JSON-RPC (CSPR.cloud node proxy).
 *
 * CSPR.cloud REST `/contracts/{hash}` often 404s for Odra package hashes — the
 * indexer does not expose named keys. RPC `query_global_state` on the installed
 * contract instance is authoritative for purse balance and share supply.
 */

import blake from "blakejs";
import type { AgentReputation, AllocationMap, VaultState } from "./types.js";
import { stripHashPrefix, toContractStateKey } from "./cspr-cloud.js";
import { withRpcCall, type RpcReadPolicy } from "./casper-rpc-retry.js";

export interface RpcReadOptions {
  readPolicy?: RpcReadPolicy;
}

export interface CasperRpcConfig {
  nodeRpcUrl: string;
  apiKey?: string;
}

/** Minimal RpcClient surface used by this module (injectable in tests). */
export interface CasperRpcReader {
  queryLatestGlobalState(
    key: string,
    path: string[]
  ): Promise<{ rawJSON?: { stored_value?: Record<string, unknown> } }>;
  queryLatestBalance(identifier: unknown): Promise<{
    balance?: { toJSON?: () => string };
  }>;
}

export interface CasperRpcDictionaryReader extends CasperRpcReader {
  getDictionaryItem(
    stateRootHash: string | null,
    dictionaryUref: string,
    itemKey: string
  ): Promise<{ rawJSON?: { stored_value?: Record<string, unknown> } }>;
}

type CasperSdkModule = {
  HttpHandler: new (url: string) => {
    setCustomHeaders?(headers: Record<string, string>): void;
  };
  RpcClient: new (handler: unknown) => CasperRpcDictionaryReader;
  URef: { fromString(source: string): unknown };
  PurseIdentifier: { fromUref(uref: unknown): unknown };
  Key: { newKey(source: string): { bytes(): Uint8Array } };
};

async function loadCasperSdk(): Promise<CasperSdkModule> {
  const mod = (await import("casper-js-sdk")) as CasperSdkModule & {
    default?: CasperSdkModule;
  };
  return mod.default ?? mod;
}

/** Build an authenticated JSON-RPC client for CSPR.cloud or a self-hosted node. */
export async function createCasperRpcClient(
  config: CasperRpcConfig
): Promise<CasperRpcDictionaryReader> {
  const sdk = await loadCasperSdk();
  const handler = new sdk.HttpHandler(config.nodeRpcUrl);
  const key = config.apiKey;
  if (key && !key.startsWith("replace-with") && handler.setCustomHeaders) {
    handler.setCustomHeaders({ Authorization: key });
  }
  return new sdk.RpcClient(handler);
}

/** Registry `profiles` mapping field index in Odra storage layout. */
const REGISTRY_PROFILES_FIELD_INDEX = 1;

/** Odra `state` dictionary named key (see odra-casper-wasm-env `STATE_KEY`). */
const ODRA_STATE_NAMED_KEY = "state";

function normalizeAccountHash(accountHash: string): string {
  return accountHash.startsWith("account-hash-")
    ? accountHash
    : `account-hash-${accountHash.replace(/^0x/, "")}`;
}

/** Mirrors Odra `ContractEnv::index_bytes` for short module paths. */
export function odraIndexBytes(path: number[]): Buffer {
  if (path.every((idx) => idx <= 15)) {
    const packed = path.reduce((acc, idx) => (acc << 4) + idx, 0);
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(packed);
    return buf;
  }
  return Buffer.concat([Buffer.from([0xff, path.length]), Buffer.from(path)]);
}

/** Mirrors Odra `ContractEnv::current_key` dictionary item key (ASCII hex). */
export function odraDictionaryItemKey(path: number[], mappingData: Buffer): string {
  const preimage = Buffer.concat([odraIndexBytes(path), mappingData]);
  const digest = Buffer.from(blake.blake2b(preimage, undefined, 32));
  return digest.toString("hex");
}

function parseAgentProfileValue(
  stored: Record<string, unknown> | undefined,
  agentAccountHash: string
): AgentReputation | null {
  if (!stored) return null;

  const cl = stored["CLValue"] as
    | {
        parsed?: unknown;
        bytes?: string;
        cl_type?: { Tuple?: { elements?: unknown[] } };
      }
    | undefined;

  if (!cl) return null;

  const parsed = cl.parsed;
  if (Array.isArray(parsed) && parsed.length >= 4) {
    return {
      agentAccountHash,
      score: BigInt(String(parsed[0] ?? 0)),
      totalDecisions: BigInt(String(parsed[1] ?? 0)),
      correctPredictions: BigInt(String(parsed[2] ?? 0)),
      registeredTs: Number(parsed[3] ?? 0),
    };
  }

  if (parsed && typeof parsed === "object") {
    const row = parsed as Record<string, unknown>;
    if ("score" in row) {
      return {
        agentAccountHash,
        score: BigInt(String(row["score"] ?? 0)),
        totalDecisions: BigInt(String(row["total_decisions"] ?? row["totalDecisions"] ?? 0)),
        correctPredictions: BigInt(String(row["total_correct"] ?? row["totalCorrect"] ?? 0)),
        registeredTs: Number(row["registered_at"] ?? row["registeredAt"] ?? 0),
      };
    }
  }

  if (typeof cl.bytes === "string" && cl.bytes.length >= 64) {
    const raw = Buffer.from(cl.bytes, "hex");
    if (raw.length >= 32) {
      return {
        agentAccountHash,
        score: raw.readBigUInt64LE(0),
        totalDecisions: raw.readBigUInt64LE(8),
        correctPredictions: raw.readBigUInt64LE(16),
        registeredTs: Number(raw.readBigUInt64LE(24)),
      };
    }
  }

  return null;
}

/**
 * Read agent reputation from the Odra registry `profiles` mapping via the
 * contract `state` dictionary (same layout Odra uses on-chain).
 */
export async function readReputationFromRpc(
  rpc: CasperRpcDictionaryReader,
  registryPackageHash: string,
  agentAccountHash: string,
  options: RpcReadOptions = {}
): Promise<AgentReputation | null> {
  const readPolicy = options.readPolicy ?? "retry";
  const sdk = await loadCasperSdk();
  const instanceKey = await withRpcCall(
    () => resolveContractInstanceKey(rpc, registryPackageHash, readPolicy),
    readPolicy
  );
  const contractGs = await withRpcCall(
    () => rpc.queryLatestGlobalState(instanceKey, []),
    readPolicy
  );

  const stateUref = namedKeyUref(contractGs, ODRA_STATE_NAMED_KEY);
  if (!stateUref) return null;

  const agentKey = sdk.Key.newKey(normalizeAccountHash(agentAccountHash));
  const mappingData = Buffer.from(agentKey.bytes());
  const itemKey = odraDictionaryItemKey(
    [REGISTRY_PROFILES_FIELD_INDEX],
    mappingData
  );

  const dictGs = await withRpcCall(
    () => rpc.getDictionaryItem(null, stateUref, itemKey),
    readPolicy
  );

  return parseAgentProfileValue(dictGs.rawJSON?.stored_value, agentAccountHash);
}

/** Default equal-weight allocation when Odra state vars are not readable off-chain. */
export function defaultVaultAllocation(): AllocationMap {
  return [
    { assetId: 0, bps: 2000 },
    { assetId: 1, bps: 2000 },
    { assetId: 2, bps: 2000 },
    { assetId: 3, bps: 2000 },
    { assetId: 4, bps: 2000 },
  ];
}

/**
 * Resolve the latest contract-instance global-state key (`hash-<hex>`) from an
 * Odra package hash (`hash-<hex>` stored in VAULT_CONTRACT_HASH).
 */
export async function resolveContractInstanceKey(
  rpc: CasperRpcReader,
  packageHash: string,
  readPolicy: RpcReadPolicy = "retry"
): Promise<string> {
  const gs = await withRpcCall(
    () => rpc.queryLatestGlobalState(toContractStateKey(packageHash), []),
    readPolicy
  );
  const pkg = gs.rawJSON?.stored_value?.["ContractPackage"] as
    | { versions?: Array<{ contract_hash?: string }> }
    | undefined;
  const versions = pkg?.versions ?? [];
  if (versions.length === 0) {
    throw new Error("Contract package has no installed versions");
  }
  const latest = versions[versions.length - 1];
  const contractHash = latest?.contract_hash;
  if (!contractHash || typeof contractHash !== "string") {
    throw new Error("Contract package version missing contract_hash");
  }
  return contractHash.startsWith("hash-")
    ? contractHash
    : `hash-${stripHashPrefix(contractHash)}`;
}

function namedKeyUref(
  contractGs: { rawJSON?: { stored_value?: Record<string, unknown> } },
  name: string
): string | undefined {
  const contract = contractGs.rawJSON?.stored_value?.["Contract"] as
    | { named_keys?: Array<{ name?: string; key?: string }> }
    | undefined;
  return contract?.named_keys?.find((nk) => nk.name === name)?.key;
}

function parseClValueBigInt(
  gs: { rawJSON?: { stored_value?: Record<string, unknown> } }
): bigint {
  const cl = gs.rawJSON?.stored_value?.["CLValue"] as
    | { parsed?: string | number | null; bytes?: string }
    | undefined;
  if (cl?.parsed !== undefined && cl.parsed !== null && cl.parsed !== "") {
    return BigInt(String(cl.parsed));
  }
  return 0n;
}

/**
 * Read vault balance + shares from chain via RPC named keys on the contract
 * instance (`__contract_main_purse`, `total_supply`).
 */
export async function readVaultStateFromRpc(
  rpc: CasperRpcReader,
  packageHash: string,
  agentAccountHash: string,
  options: RpcReadOptions = {}
): Promise<VaultState> {
  const readPolicy = options.readPolicy ?? "retry";
  const sdk = await loadCasperSdk();
  const instanceKey = await resolveContractInstanceKey(rpc, packageHash, readPolicy);
  const contractGs = await withRpcCall(
    () => rpc.queryLatestGlobalState(instanceKey, []),
    readPolicy
  );

  let totalBalanceMotes = 0n;
  const mainPurseKey = namedKeyUref(contractGs, "__contract_main_purse");
  if (mainPurseKey) {
    const uref = sdk.URef.fromString(mainPurseKey);
    const bal = await withRpcCall(
      () => rpc.queryLatestBalance(sdk.PurseIdentifier.fromUref(uref)),
      readPolicy
    );
    totalBalanceMotes = BigInt(bal.balance?.toJSON?.() ?? "0");
  }

  let totalShares = 0n;
  const totalSupplyKey = namedKeyUref(contractGs, "total_supply");
  if (totalSupplyKey) {
    const supplyGs = await withRpcCall(
      () => rpc.queryLatestGlobalState(totalSupplyKey, []),
      readPolicy
    );
    totalShares = parseClValueBigInt(supplyGs);
  }

  return {
    totalBalanceMotes,
    totalShares,
    allocation: defaultVaultAllocation(),
    agentAccountHash,
    paused: false,
    lastReallocationTs: 0,
  };
}

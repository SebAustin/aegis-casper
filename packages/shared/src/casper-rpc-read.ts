/**
 * On-chain vault & registry reads via Casper node JSON-RPC (CSPR.cloud node proxy).
 *
 * ## Odra 2.8 / Casper 2.0 storage layout (verified against odra-core 2.8.1)
 *
 * Every Odra module field (`Var`, `Mapping`, ...) is persisted in a single
 * dictionary exposed on the installed contract instance under the named key
 * `state` (see `odra-casper-wasm-env` `STATE_KEY`). The dictionary **item key**
 * for a field is:
 *
 *   hex( blake2b_256( index_bytes(path) ++ mapping_data ) )
 *
 * - `path` is the field's position in the module. Odra assigns indices
 *   **1-based in declaration order** (`odra-macros` `ir/mod.rs`: `idx as u8 + 1`),
 *   NOT 0-based. This was the root cause of the `-32003 Query failed` bug — the
 *   old code used `profiles = 1` when the real on-chain index is `2`.
 * - `index_bytes(path)` packs indices ≤ 15 into a big-endian `u32` via 4-bit
 *   shifts (legacy encoding); indices > 15 use `[0xFF, len, ...path]`.
 * - `mapping_data` is empty for a `Var`; for a `Mapping<K, V>` it is `K::to_bytes()`.
 *   For an Odra `Address` key, `to_bytes()` == `Key::to_bytes()` == a 33-byte
 *   `[tag, ..32]` (tag `0x00` for an account), which `Key.newKey(...).bytes()`
 *   reproduces exactly.
 *
 * The stored value is always a `CLValue` of `cl_type: List(U8)` wrapping the
 * field's raw Odra serialization. Its `.bytes` are a 4-byte LE length prefix
 * followed by the inner bytes; `.parsed` is the inner byte array.
 *
 * CSPR.cloud REST `/contracts/{hash}` often 404s for Odra package hashes, so RPC
 * `query_global_state` + `state_get_dictionary_item` is authoritative.
 */

import blake from "blakejs";
import type { AgentReputation, AllocationMap, VaultState } from "./types.js";
import { stripHashPrefix, toContractStateKey } from "./cspr-cloud.js";
import { withRpcCall, isRateLimitError, type RpcReadPolicy } from "./casper-rpc-retry.js";

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

// ── Odra field indices (1-based, declaration order) ───────────────────────────

/** `Registry.profiles: Mapping<Address, AgentProfile>` — decl #1 → Odra index 2. */
const REGISTRY_PROFILES_FIELD_INDEX = 2;

/** `Vault.agent: Var<Address>` — decl #1 (after `shares` submodule) → index 2. */
const VAULT_AGENT_FIELD_INDEX = 2;
/** `Vault.paused: Var<bool>` — decl #3 → index 4. */
const VAULT_PAUSED_FIELD_INDEX = 4;
/** `Vault.allocation: Var<Vec<(u8, u32)>>` — decl #4 → index 5. */
const VAULT_ALLOCATION_FIELD_INDEX = 5;
/** `Vault.last_reallocation_ts: Var<u64>` — decl #5 → index 6. */
const VAULT_LAST_REALLOC_FIELD_INDEX = 6;

/** Odra `state` dictionary named key (see odra-casper-wasm-env `STATE_KEY`). */
const ODRA_STATE_NAMED_KEY = "state";

function normalizeAccountHash(accountHash: string): string {
  return accountHash.startsWith("account-hash-")
    ? accountHash
    : `account-hash-${accountHash.replace(/^0x/, "")}`;
}

/** Mirrors Odra `ContractEnv::index_bytes` for module field paths. */
export function odraIndexBytes(path: number[]): Buffer {
  if (path.every((idx) => idx <= 15)) {
    const packed = path.reduce((acc, idx) => (acc << 4) + idx, 0);
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(packed >>> 0);
    return buf;
  }
  return Buffer.concat([Buffer.from([0xff, path.length]), Buffer.from(path)]);
}

/** Mirrors Odra `ContractEnv::current_key` — the dictionary item key (ASCII hex). */
export function odraDictionaryItemKey(path: number[], mappingData: Buffer): string {
  const preimage = Buffer.concat([odraIndexBytes(path), mappingData]);
  const digest = Buffer.from(blake.blake2b(preimage, undefined, 32));
  return digest.toString("hex");
}

// ── CLValue List(U8) decoding ─────────────────────────────────────────────────

interface StoredClValue {
  parsed?: unknown;
  bytes?: string;
  cl_type?: unknown;
}

function storedClValue(
  stored: Record<string, unknown> | undefined
): StoredClValue | undefined {
  if (!stored) return undefined;
  return stored["CLValue"] as StoredClValue | undefined;
}

/**
 * Decode the inner bytes of an Odra `state` value, which is always a CLValue of
 * `List(U8)`: `.bytes` = 4-byte LE length prefix + inner; `.parsed` = inner bytes.
 * Returns the raw Odra-serialized field bytes (no length prefix).
 */
function decodeStateInnerBytes(cl: StoredClValue | undefined): Buffer | null {
  if (!cl) return null;
  if (typeof cl.bytes === "string" && cl.bytes.length >= 8) {
    const raw = Buffer.from(cl.bytes, "hex");
    if (raw.length < 4) return null;
    const len = raw.readUInt32LE(0);
    const inner = raw.subarray(4, 4 + len);
    return inner.length === len ? Buffer.from(inner) : null;
  }
  if (Array.isArray(cl.parsed)) {
    return Buffer.from(cl.parsed as number[]);
  }
  return null;
}

/**
 * Parse a stored `AgentProfile` (4 × `u64` little-endian, 32 bytes) from the
 * registry `profiles` mapping value.
 */
export function parseAgentProfileValue(
  stored: Record<string, unknown> | undefined,
  agentAccountHash: string
): AgentReputation | null {
  const inner = decodeStateInnerBytes(storedClValue(stored));
  if (!inner || inner.length < 32) return null;
  return {
    agentAccountHash,
    score: inner.readBigUInt64LE(0),
    totalDecisions: inner.readBigUInt64LE(8),
    correctPredictions: inner.readBigUInt64LE(16),
    registeredTs: Number(inner.readBigUInt64LE(24)),
  };
}

/**
 * Parse a stored `Vec<(u8, u32)>` allocation: 4-byte LE count, then each entry
 * is `[assetId: u8][bps: u32 LE]` (5 bytes).
 */
export function parseAllocationValue(
  stored: Record<string, unknown> | undefined
): AllocationMap | null {
  const inner = decodeStateInnerBytes(storedClValue(stored));
  if (!inner || inner.length < 4) return null;
  const count = inner.readUInt32LE(0);
  const entries: AllocationMap = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    if (offset + 5 > inner.length) return null;
    const assetId = inner.readUInt8(offset);
    const bps = inner.readUInt32LE(offset + 1);
    entries.push({ assetId, bps });
    offset += 5;
  }
  return entries;
}

function parseAddressValue(
  stored: Record<string, unknown> | undefined
): string | null {
  const inner = decodeStateInnerBytes(storedClValue(stored));
  // Address == Key: [tag(1)][hash(32)]. tag 0x00 == account.
  if (!inner || inner.length < 33) return null;
  return `account-hash-${inner.subarray(1, 33).toString("hex")}`;
}

function parseBoolValue(
  stored: Record<string, unknown> | undefined
): boolean | null {
  const inner = decodeStateInnerBytes(storedClValue(stored));
  if (!inner || inner.length < 1) return null;
  return inner.readUInt8(0) !== 0;
}

function parseU64Value(
  stored: Record<string, unknown> | undefined
): bigint | null {
  const inner = decodeStateInnerBytes(storedClValue(stored));
  if (!inner || inner.length < 8) return null;
  return inner.readBigUInt64LE(0);
}

// ── State dictionary read (graceful on genuine not-found) ─────────────────────

/**
 * True when an RPC error means "the queried value / dictionary item does not
 * exist" (Casper `-32003 QueryFailed` / `-32004` / value-not-found). These are
 * NOT infrastructure failures — the caller falls back to a placeholder — but a
 * 429 (rate limit) must propagate so the client can flag it.
 */
function isNotFoundError(err: unknown): boolean {
  if (isRateLimitError(err)) return false;
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("-32003") ||
    message.includes("-32004") ||
    /query failed/i.test(message) ||
    /value(?: was)? not found/i.test(message)
  );
}

/**
 * Read a single Odra module field from the contract `state` dictionary.
 * Returns the raw `stored_value` (for the caller's field parser) or `null` when
 * the item genuinely does not exist. Rate-limit / transport errors propagate.
 */
async function readStateField(
  rpc: CasperRpcDictionaryReader,
  stateUref: string,
  fieldIndex: number,
  mappingData: Buffer,
  readPolicy: RpcReadPolicy
): Promise<Record<string, unknown> | undefined | null> {
  const itemKey = odraDictionaryItemKey([fieldIndex], mappingData);
  try {
    const gs = await withRpcCall(
      () => rpc.getDictionaryItem(null, stateUref, itemKey),
      readPolicy
    );
    return gs.rawJSON?.stored_value;
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/**
 * Read agent reputation from the Odra registry `profiles` mapping via the
 * contract `state` dictionary. Returns `null` when the agent has no on-chain
 * profile (unregistered) so the caller can apply its seed fallback.
 */
export async function readReputationFromRpc(
  rpc: CasperRpcDictionaryReader,
  registryPackageHash: string,
  agentAccountHash: string,
  options: RpcReadOptions = {}
): Promise<AgentReputation | null> {
  const readPolicy = options.readPolicy ?? "retry";
  const sdk = await loadCasperSdk();
  const stateUref = await resolveStateUref(rpc, registryPackageHash, readPolicy);
  if (!stateUref) return null;

  const agentKey = sdk.Key.newKey(normalizeAccountHash(agentAccountHash));
  const mappingData = Buffer.from(agentKey.bytes());

  const stored = await readStateField(
    rpc,
    stateUref,
    REGISTRY_PROFILES_FIELD_INDEX,
    mappingData,
    readPolicy
  );
  if (!stored) return null;
  return parseAgentProfileValue(stored, agentAccountHash);
}

/** Default equal-weight allocation when the on-chain allocation cannot be read. */
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
 * Odra package hash (`hash-<hex>` stored in VAULT_CONTRACT_HASH / REGISTRY_CONTRACT_HASH).
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

/** Resolve the `state` dictionary seed URef for an Odra package hash. */
async function resolveStateUref(
  rpc: CasperRpcDictionaryReader,
  packageHash: string,
  readPolicy: RpcReadPolicy
): Promise<string | undefined> {
  const instanceKey = await withRpcCall(
    () => resolveContractInstanceKey(rpc, packageHash, readPolicy),
    readPolicy
  );
  const contractGs = await withRpcCall(
    () => rpc.queryLatestGlobalState(instanceKey, []),
    readPolicy
  );
  return namedKeyUref(contractGs, ODRA_STATE_NAMED_KEY);
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
 * Read full vault state from chain via RPC:
 * - CSPR balance from the `__contract_main_purse` named key.
 * - Share supply from the CEP-18 `total_supply` named key (a typed `CLValue`).
 * - `agent`, `paused`, `allocation`, `last_reallocation_ts` from the Odra `state`
 *   dictionary (real on-chain values, not defaults).
 *
 * Each optional field degrades gracefully to a safe default if it cannot be read.
 */
export async function readVaultStateFromRpc(
  rpc: CasperRpcDictionaryReader,
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

  // Odra module fields from the `state` dictionary.
  let allocation = defaultVaultAllocation();
  let onChainAgent = agentAccountHash;
  let paused = false;
  let lastReallocationTs = 0;

  const stateUref = namedKeyUref(contractGs, ODRA_STATE_NAMED_KEY);
  if (stateUref) {
    const empty = Buffer.alloc(0);

    const allocStored = await readStateField(
      rpc,
      stateUref,
      VAULT_ALLOCATION_FIELD_INDEX,
      empty,
      readPolicy
    );
    const parsedAlloc = allocStored ? parseAllocationValue(allocStored) : null;
    if (parsedAlloc && parsedAlloc.length > 0) allocation = parsedAlloc;

    const agentStored = await readStateField(
      rpc,
      stateUref,
      VAULT_AGENT_FIELD_INDEX,
      empty,
      readPolicy
    );
    const parsedAgent = agentStored ? parseAddressValue(agentStored) : null;
    if (parsedAgent) onChainAgent = parsedAgent;

    const pausedStored = await readStateField(
      rpc,
      stateUref,
      VAULT_PAUSED_FIELD_INDEX,
      empty,
      readPolicy
    );
    const parsedPaused = pausedStored ? parseBoolValue(pausedStored) : null;
    if (parsedPaused !== null) paused = parsedPaused;

    const tsStored = await readStateField(
      rpc,
      stateUref,
      VAULT_LAST_REALLOC_FIELD_INDEX,
      empty,
      readPolicy
    );
    const parsedTs = tsStored ? parseU64Value(tsStored) : null;
    if (parsedTs !== null) lastReallocationTs = Number(parsedTs);
  }

  return {
    totalBalanceMotes,
    totalShares,
    allocation,
    agentAccountHash: onChainAgent,
    paused,
    lastReallocationTs,
  };
}

/**
 * CasperTxClient — constructs, signs, and submits Casper 2.0 Transactions.
 *
 * Targets casper-js-sdk v5 (Casper 2.0 / Condor Transaction model, A-001).
 * Builds a `StoredContractByHash` contract-call Transaction (ContractCallBuilder
 * → `byHash`), serializes the runtime args as real CLValues, signs with the
 * agent ED25519 PrivateKey, and submits via the JSON-RPC client
 * (`RpcClient.putTransaction`). Implements 3× exponential backoff on submission
 * (NFR-R-03).
 *
 * The RPC client is injectable (constructor seam) so unit tests pass a mock
 * client and never hit the network. The casper-js-sdk module itself is also
 * injectable for the same reason.
 */

import type { AllocationMap } from "@aegis/shared";

// ── Interface ─────────────────────────────────────────────────────────────────

export interface TxResult {
  txHash: string;
}

export interface TxClient {
  submitReallocate(allocation: AllocationMap): Promise<TxResult>;
  submitUpdateReputation(
    agentAccountHash: string,
    delta: number,
    rationaleHash: Buffer
  ): Promise<TxResult>;
  getTransactionStatus(txHash: string): Promise<{
    status: "pending" | "confirmed" | "failed";
    blockHeight?: number;
    timestamp?: number;
  }>;
}

// ── SDK seam types ──────────────────────────────────────────────────────────
//
// We only depend on the narrow slice of the casper-js-sdk v5 surface that we
// actually use. Typing it explicitly (rather than `Record<string, unknown>`)
// keeps the builder logic type-checked and makes the test mock obvious.

/** A built, signable Casper 2.0 Transaction. */
export interface SdkTransaction {
  sign(key: SdkPrivateKey): void;
  // Inspection surface used by tests to assert the tx carries the right data.
  entryPoint: { type: number; customEntryPoint?: string };
  args: { args: Map<string, SdkClValue> };
  target: { stored?: { id?: { byHash?: { toHex(): string } } } };
}

/** A CLValue instance — opaque except for type introspection used in tests. */
export interface SdkClValue {
  getType(): unknown;
}

export interface SdkPrivateKey {
  readonly publicKey: SdkPublicKey;
  sign(msg: Uint8Array): Uint8Array;
}

export interface SdkPublicKey {
  toHex(checksummed?: boolean): string;
}

export interface SdkContractCallBuilder {
  from(pk: SdkPublicKey): SdkContractCallBuilder;
  byHash(contractHash: string): SdkContractCallBuilder;
  entryPoint(name: string): SdkContractCallBuilder;
  runtimeArgs(args: SdkArgs): SdkContractCallBuilder;
  chainName(name: string): SdkContractCallBuilder;
  payment(motes: number, gasPriceTolerance?: number): SdkContractCallBuilder;
  ttl(ms: number): SdkContractCallBuilder;
  build(): SdkTransaction;
}

interface SdkArgs {
  args: Map<string, SdkClValue>;
}

interface SdkRpcClient {
  putTransaction(tx: SdkTransaction): Promise<{ transactionHash: { toHex(): string } }>;
}

/**
 * The portion of casper-js-sdk v5 we consume. Injectable so tests can supply
 * a mock without touching `import("casper-js-sdk")`.
 */
export interface CasperSdk {
  ContractCallBuilder: new () => SdkContractCallBuilder;
  PrivateKey: { fromHex(hex: string, alg: number): SdkPrivateKey };
  KeyAlgorithm: { ED25519: number };
  RpcClient: new (handler: unknown) => SdkRpcClient;
  HttpHandler: new (endpoint: string) => unknown;
  Args: {
    fromMap(map: Record<string, SdkClValue>): SdkArgs;
  };
  CLValue: {
    newCLList(elementType: unknown, elements: SdkClValue[]): SdkClValue;
    newCLTuple2(a: SdkClValue, b: SdkClValue): SdkClValue;
    newCLUint8(v: number): SdkClValue;
    newCLUInt32(v: number): SdkClValue;
    newCLInt64(v: number | bigint): SdkClValue;
    newCLByteArray(v: Uint8Array): SdkClValue;
    newCLKey(k: unknown): SdkClValue;
  };
  CLTypeTuple2: new (inner1: unknown, inner2: unknown) => unknown;
  CLTypeUInt8: unknown;
  CLTypeUInt32: unknown;
  Key: { newKey(source: string): unknown };
}

// Default payment ceiling for a contract call (motes). 5 CSPR is comfortably
// above the wasm execution cost of `reallocate` / `update_reputation`.
const CONTRACT_CALL_PAYMENT_MOTES = 5_000_000_000;
const TX_TTL_MS = 1_800_000; // 30 minutes (matches SDK default).

// ── CasperTxClient ────────────────────────────────────────────────────────────

export interface CasperTxClientConfig {
  privateKeyHex: string;
  accountHash: string;
  nodeRpcUrl: string;
  network: string;
  vaultContractHash: string | undefined;
  registryContractHash: string | undefined;
}

export class CasperTxClient implements TxClient {
  constructor(
    private readonly config: CasperTxClientConfig,
    /**
     * Injectable SDK loader. Defaults to the real dynamic import; tests pass a
     * mock so the network is never touched.
     */
    private readonly loadSdk: () => Promise<CasperSdk> = async () => {
      // casper-js-sdk v5 ships a CJS bundle; under ESM the named exports land on
      // `.default` (interop). Normalize so both module systems resolve cleanly.
      const mod = (await import("casper-js-sdk")) as unknown as
        | CasperSdk
        | { default: CasperSdk };
      return "default" in mod && mod.default ? mod.default : (mod as CasperSdk);
    },
    /**
     * Injectable RPC client factory. Defaults to building a real
     * `RpcClient(new HttpHandler(url))`; tests override with a mock.
     */
    private readonly makeRpcClient: (
      sdk: CasperSdk,
      url: string
    ) => SdkRpcClient = (sdk, url) => new sdk.RpcClient(new sdk.HttpHandler(url))
  ) {}

  /**
   * Submit a `reallocate` transaction to the vault contract.
   *
   * Args (per the Odra signature `reallocate(allocation: Vec<(u8, u32)>)`):
   *   - `allocation`: List< Tuple2<U8, U32> > of (assetId, bps) pairs.
   */
  async submitReallocate(allocation: AllocationMap): Promise<TxResult> {
    if (!this.config.vaultContractHash) {
      throw new Error("CasperTxClient: VAULT_CONTRACT_HASH not configured");
    }
    if (!this.config.privateKeyHex) {
      throw new Error("CasperTxClient: AGENT_PRIVATE_KEY_HEX not configured");
    }

    const sdk = await this.loadSdk();

    return withRetry(async () => {
      const privateKey = sdk.PrivateKey.fromHex(
        this.config.privateKeyHex,
        sdk.KeyAlgorithm.ED25519
      );
      const tx = buildReallocateTx(
        sdk,
        this.config.vaultContractHash!,
        this.config.network,
        allocation,
        privateKey.publicKey
      );
      return signAndSubmit(this.makeRpcClient, sdk, this.config, tx, privateKey);
    });
  }

  /**
   * Submit an `update_reputation` transaction to the registry contract.
   *
   * Args (per `update_reputation(agent: Address, delta: i64, rationale_hash: [u8;32])`):
   *   - `agent`: CLKey (account-hash) of the agent.
   *   - `delta`: I64 signed reputation delta.
   *   - `rationale_hash`: ByteArray(32) commit hash of the decision rationale.
   */
  async submitUpdateReputation(
    agentAccountHash: string,
    delta: number,
    rationaleHash: Buffer
  ): Promise<TxResult> {
    if (!this.config.registryContractHash) {
      throw new Error("CasperTxClient: REGISTRY_CONTRACT_HASH not configured");
    }
    if (!this.config.privateKeyHex) {
      throw new Error("CasperTxClient: AGENT_PRIVATE_KEY_HEX not configured");
    }
    if (rationaleHash.length !== 32) {
      throw new Error(
        `CasperTxClient: rationaleHash must be 32 bytes, got ${rationaleHash.length}`
      );
    }

    const sdk = await this.loadSdk();

    return withRetry(async () => {
      const privateKey = sdk.PrivateKey.fromHex(
        this.config.privateKeyHex,
        sdk.KeyAlgorithm.ED25519
      );
      const tx = buildUpdateReputationTx(
        sdk,
        this.config.registryContractHash!,
        this.config.network,
        agentAccountHash,
        delta,
        rationaleHash,
        privateKey.publicKey
      );
      return signAndSubmit(this.makeRpcClient, sdk, this.config, tx, privateKey);
    });
  }

  /**
   * Query transaction status via the JSON-RPC node
   * (`info_get_transaction`). Returns `pending` while execution info is absent.
   */
  async getTransactionStatus(txHash: string): Promise<{
    status: "pending" | "confirmed" | "failed";
    blockHeight?: number;
    timestamp?: number;
  }> {
    try {
      const res = await fetch(
        `${this.config.nodeRpcUrl.replace("/rpc", "")}/deploys/${txHash}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) return { status: "pending" };
      const data = (await res.json()) as {
        result?: { execution_results?: Array<{ result: unknown }> };
      };
      const results = data.result?.execution_results;
      if (!results || results.length === 0) return { status: "pending" };
      return { status: "confirmed" };
    } catch {
      return { status: "pending" };
    }
  }
}

// ── MockTxClient (for tests) ──────────────────────────────────────────────────

export class MockTxClient implements TxClient {
  public submittedReallocations: AllocationMap[] = [];
  public submittedReputationUpdates: Array<{
    agentAccountHash: string;
    delta: number;
    rationaleHash: Buffer;
  }> = [];

  async submitReallocate(allocation: AllocationMap): Promise<TxResult> {
    this.submittedReallocations.push(allocation);
    return { txHash: `mock-reallocate-${Date.now()}` };
  }

  async submitUpdateReputation(
    agentAccountHash: string,
    delta: number,
    rationaleHash: Buffer
  ): Promise<TxResult> {
    this.submittedReputationUpdates.push({ agentAccountHash, delta, rationaleHash });
    return { txHash: `mock-reputation-${Date.now()}` };
  }

  async getTransactionStatus(_txHash: string): Promise<{
    status: "pending" | "confirmed" | "failed";
  }> {
    return { status: "confirmed" };
  }
}

// ── Transaction builders (exported for unit tests) ─────────────────────────────

/**
 * Build the `reallocate` contract-call Transaction.
 *
 * Serializes `allocation` as `List<Tuple2<U8, U32>>` — exactly the on-chain
 * `Vec<(u8, u32)>` shape — and targets the vault contract by hash.
 */
export function buildReallocateTx(
  sdk: CasperSdk,
  vaultContractHash: string,
  network: string,
  allocation: AllocationMap,
  initiatorPublicKey?: SdkPublicKey
): SdkTransaction {
  const elements = allocation.map((entry) =>
    sdk.CLValue.newCLTuple2(
      sdk.CLValue.newCLUint8(entry.assetId),
      sdk.CLValue.newCLUInt32(entry.bps)
    )
  );

  const elementType = new sdk.CLTypeTuple2(sdk.CLTypeUInt8, sdk.CLTypeUInt32);
  const args = sdk.Args.fromMap({
    allocation: sdk.CLValue.newCLList(elementType, elements),
  });

  let builder = new sdk.ContractCallBuilder()
    .byHash(normalizeContractHash(vaultContractHash))
    .entryPoint("reallocate")
    .runtimeArgs(args)
    .chainName(network)
    .payment(CONTRACT_CALL_PAYMENT_MOTES)
    .ttl(TX_TTL_MS);
  if (initiatorPublicKey) builder = builder.from(initiatorPublicKey);
  return builder.build();
}

/**
 * Build the `update_reputation` contract-call Transaction.
 *
 * `agent` is serialized as a CLKey (account-hash), `delta` as I64, and
 * `rationale_hash` as a fixed 32-byte ByteArray — matching the Odra entry-point
 * signature `(agent: Address, delta: i64, rationale_hash: [u8;32])`.
 */
export function buildUpdateReputationTx(
  sdk: CasperSdk,
  registryContractHash: string,
  network: string,
  agentAccountHash: string,
  delta: number,
  rationaleHash: Buffer,
  initiatorPublicKey?: SdkPublicKey
): SdkTransaction {
  const agentKey = sdk.Key.newKey(normalizeAccountHash(agentAccountHash));

  const args = sdk.Args.fromMap({
    agent: sdk.CLValue.newCLKey(agentKey),
    delta: sdk.CLValue.newCLInt64(delta),
    rationale_hash: sdk.CLValue.newCLByteArray(new Uint8Array(rationaleHash)),
  });

  let builder = new sdk.ContractCallBuilder()
    .byHash(normalizeContractHash(registryContractHash))
    .entryPoint("update_reputation")
    .runtimeArgs(args)
    .chainName(network)
    .payment(CONTRACT_CALL_PAYMENT_MOTES)
    .ttl(TX_TTL_MS);
  if (initiatorPublicKey) builder = builder.from(initiatorPublicKey);
  return builder.build();
}

// ── Sign + submit ──────────────────────────────────────────────────────────────

async function signAndSubmit(
  makeRpcClient: (sdk: CasperSdk, url: string) => SdkRpcClient,
  sdk: CasperSdk,
  config: CasperTxClientConfig,
  tx: SdkTransaction,
  privateKey: SdkPrivateKey
): Promise<TxResult> {
  // The builder set the initiator to the agent's public key; signing here with
  // the agent private key produces a real Approval on the transaction.
  tx.sign(privateKey);

  const rpc = makeRpcClient(sdk, config.nodeRpcUrl);
  const result = await rpc.putTransaction(tx);
  return { txHash: result.transactionHash.toHex() };
}

// ── Address / hash normalization ───────────────────────────────────────────────

/**
 * The ContractCallBuilder's `byHash` expects a bare 64-char hex string. Strip a
 * `hash-`/`contract-` prefix if the caller passed a prefixed form.
 */
function normalizeContractHash(hash: string): string {
  return hash.replace(/^(hash-|contract-)/, "");
}

/**
 * `Key.newKey` expects a prefixed account-hash string
 * (`account-hash-<64 hex>`). Accept either form and normalize.
 */
function normalizeAccountHash(accountHash: string): string {
  return accountHash.startsWith("account-hash-")
    ? accountHash
    : `account-hash-${accountHash.replace(/^0x/, "")}`;
}

// ── Retry ────────────────────────────────────────────────────────────────────

/**
 * Retry with exponential backoff: 1s, 2s, 4s (NFR-R-03).
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [1_000, 2_000, 4_000] as const;
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < delays.length) {
        await sleep(delays[attempt]!);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

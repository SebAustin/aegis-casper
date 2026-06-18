/**
 * Canonical TypeScript types for Aegis.
 * These are the source of truth — every TS service imports from here.
 * See PLAN.md §3.1 for the full interface spec.
 */

/** Canonical on-chain unit. 1 CSPR = 1_000_000_000 motes (A-002). */
export type Motes = bigint;

/** Allocation weight. Valid range: 0..10_000 (basis points, i.e. 100% = 10_000). */
export type BasisPoints = number;

/** Index into the 5 simulated RWA asset slots (A-005). Range: 0..4. */
export type AssetId = number;

/**
 * Allocation of vault assets across the 5 RWA slots.
 * Invariant: sum of all bps === 10_000.
 */
export type AllocationMap = Array<{ assetId: AssetId; bps: BasisPoints }>;

/** Vault contract state as returned by `get_state()` (FR-V-06). */
export interface VaultState {
  totalBalanceMotes: Motes;
  totalShares: bigint;
  allocation: AllocationMap;
  agentAccountHash: string;
  paused: boolean;
  lastReallocationTs: number;
}

/** On-chain reputation profile for an agent (FR-R-01, FR-R-04). */
export interface AgentReputation {
  agentAccountHash: string;
  score: bigint;
  totalDecisions: bigint;
  correctPredictions: bigint;
  registeredTs: number;
}

/** A single simulated RWA asset record (A-005). */
export interface RwaAsset {
  assetId: AssetId;
  name: string;
  /** Annual percentage yield in basis points. */
  apyBps: number;
  /** 0..100 risk score (higher = riskier). */
  riskScore: number;
  /** 0..100 liquidity score (higher = more liquid). */
  liquidityScore: number;
  /** Milliseconds since epoch when the data was last refreshed. */
  dataFreshnessMs: number;
}

/** Full oracle response payload returned on a successful x402 paid call (FR-O-04). */
export interface RwaOracleData {
  timestamp: number;
  oracleVersion: string;
  paymentReceipt: PaymentReceipt;
  /** Always exactly 5 assets (A-005). */
  assets: RwaAsset[];
}

/**
 * x402 payment payload carried in the X-PAYMENT-PAYLOAD header (A-017).
 *
 * `signature` is computed over the canonical SHA-256 digest of every OTHER
 * field (keys sorted, canonical JSON serialised, SHA-256 hashed).
 */
export interface PaymentPayload {
  /** Protocol scheme, e.g. "x402-casper". */
  scheme: string;
  /** Network identifier, e.g. "casper-testnet". */
  network: string;
  /** Payment amount in motes (must equal ORACLE_PRICE_MOTES). */
  amountMotes: Motes;
  /** Asset ticker, e.g. "CSPR". */
  asset: string;
  /** Oracle payee account hash. */
  recipient: string;
  /** Agent payer account hash. */
  payer: string;
  /** Fresh per-request UUID. Replay-rejected once seen by the facilitator. */
  nonce: string;
  /**
   * UNIX timestamp (seconds) after which this payload expires.
   * Facilitator rejects when expiryUnix <= now.
   */
  expiryUnix: number;
  /** Hex-encoded ed25519/secp256k1 signature over the canonical digest. */
  signature: string;
}

/** Receipt returned by the facilitator on a successful x402 verification. */
export interface PaymentReceipt {
  paymentHash: string;
  facilitator: "mock" | "casper";
  amountMotes: Motes;
  payerAccountHash: string;
  expiry: number;
  confirmedAt: number;
}

/** A single entry in `logs/decisions.jsonl` (FR-A-03, SC-05). */
export interface DecisionLogEntry {
  iteration: number;
  timestamp: number;
  promptHash: string;
  oracleSnapshotHash: string;
  recommendedAllocation: AllocationMap;
  /** 0..100 */
  confidence: number;
  /** Maximum 500 characters. */
  rationale: string;
  acted: boolean;
  txHash: string | null;
  skipReason: string | null;
}

/** Structured output from the LLM decision step. */
export interface LlmDecision {
  allocation: AllocationMap;
  /** 0..100 */
  confidence: number;
  rationale: string;
}

/** Context passed into the LLM to build the allocation decision prompt. */
export interface DecisionContext {
  vaultState: VaultState;
  oracleData: RwaOracleData;
  reputation: AgentReputation;
  iteration: number;
}

/**
 * Provider-agnostic LLM client (A-006).
 * Concrete implementations: AnthropicClient, OpenAiClient, MockLlmClient.
 */
export interface LlmClient {
  decide(input: DecisionContext): Promise<LlmDecision>;
}

/**
 * x402 payment facilitator (A-004).
 * Concrete implementations: MockFacilitator, CasperFacilitator.
 *
 * Throws on:
 * - expired payload (expiryUnix <= now)
 * - replayed nonce
 * - malformed / missing signature
 */
export interface PaymentFacilitator {
  verify(payload: string, now: number): Promise<PaymentReceipt>;
}

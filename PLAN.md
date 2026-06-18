# Aegis — Project Plan

---

## REQUIREMENTS (written 2026-06-18, input for architecture phase)

### What Aegis Is

Aegis is an autonomous on-chain portfolio manager for Casper Network. It monitors simulated tokenized real-world-asset (RWA) yield data (fetched via an x402 micropayment), reasons over reallocation decisions with an LLM, and autonomously submits reallocation transactions to an Odra-based vault contract on Casper Testnet. Every decision is auditable in a local log. The agent accumulates a verifiable reputation score in a separate on-chain registry contract, updated based on prediction accuracy.

**Core job-to-be-done:** Remove human operators from the rebalancing loop while keeping the decision trail fully auditable on-chain and in structured logs.

---

### Requirements (numbered, testable)

#### Vault Contract (Odra / Rust)
- FR-V-01: Accept CSPR deposits; mint proportional AEGIS CEP-18 shares.
- FR-V-02: Redeem AEGIS shares for proportional CSPR.
- FR-V-03: `reallocate()` callable only by the registered agent account hash; allocation weights must sum to 10,000 bps.
- FR-V-04–V-05: Emit `Reallocated`, `Deposited`, `Withdrawn` events.
- FR-V-06: `get_state()` readable by any caller.
- FR-V-07: Pausable by contract owner.
- FR-V-08: Deployed to Casper Testnet with contract hash in `contracts/deployments/testnet.json`.

#### Reputation Registry Contract (Odra / Rust)
- FR-R-01: Store per-agent profile: score, total decisions, correct predictions, registration timestamp.
- FR-R-02: `register_agent()` callable by contract owner.
- FR-R-03: `update_reputation()` callable by contract owner; applies delta, clamps at zero, emits `ReputationUpdated`.
- FR-R-04: `get_reputation()` readable by any caller.
- FR-R-05: Deployed to Casper Testnet.

#### Autonomous Agent Loop (TypeScript)
- FR-A-01: Configurable interval loop (`AGENT_LOOP_INTERVAL_MS`, default 30s for demo).
- FR-A-02: Perceive — query vault state (CSPR.cloud), fetch oracle data (x402), read reputation.
- FR-A-03: Decide — construct LLM prompt, parse structured JSON allocation + rationale, write to `logs/decisions.jsonl`.
- FR-A-04: Act — if drift > threshold, sign and submit `reallocate` transaction, record tx hash.
- FR-A-05: Skip conditions — vault paused, balance below minimum, LLM confidence below threshold.
- FR-A-06: Graceful error handling — log and skip, never crash the loop.
- FR-A-07: Evaluate prior predictions every N epochs; submit `update_reputation` with SHA-256 rationale hash.

#### MCP Server (TypeScript)
- FR-M-01: Implement MCP 2025-11-25 spec via `@modelcontextprotocol/sdk`.
- FR-M-02: Six tools — `get_vault_state`, `get_agent_reputation`, `submit_reallocation`, `fetch_rwa_oracle_data`, `get_decision_log`, `get_transaction_status`.
- FR-M-03: Four resources — `aegis://vault/state`, `aegis://agent/reputation`, `aegis://decisions/recent`, `aegis://oracle/latest`.
- FR-M-04: Standalone launchable process with structured tool invocation logging.
- FR-M-05: All config via environment variables.

#### x402-Gated Oracle API (TypeScript)
- FR-O-01: Unauthenticated request returns HTTP 402 + payment requirements header.
- FR-O-02: Authenticated request verified via `MockFacilitator` (default) or `CasperFacilitator`; returns yield data on success.
- FR-O-03: Price configurable via `ORACLE_PRICE_MOTES`.
- FR-O-04: Response includes payment receipt + 5 RWA asset records (APY, risk score, liquidity score).
- FR-O-05: Payment log written to `logs/payments.jsonl`.
- FR-O-06: Public `/api/health` endpoint.

#### Wallet and Signing
- FR-W-01–W-02: Dashboard uses CSPR.click SDK for Casper Wallet browser extension connect.
- FR-W-03: Deposit flow constructs + signs + submits transaction; displays tx hash linking to cspr.live.
- FR-W-04: Agent signs with keypair from `AGENT_PRIVATE_KEY_HEX`; key never exposed to UI.

#### Dashboard UI (Next.js / React)
- FR-D-01: Vault overview panel (balance, shares, allocation chart, last reallocation).
- FR-D-02: Agent reputation panel (score, decisions, accuracy %).
- FR-D-03: Decision feed (last 20 decisions with rationale, confidence, tx hash).
- FR-D-04: Oracle data panel (latest yields, payment receipt hash).
- FR-D-05: Deposit and withdraw UI for connected wallet.
- FR-D-06: Polling-based live updates every 15 seconds.
- FR-D-07: "Trigger Agent Run" button for demo.
- FR-D-08: Responsive at 768 / 1024 / 1440px; intentional visual design (not default template).

---

### Non-Goals

| Out of Scope |
|---|
| Mainnet deployment or real funds |
| Real private key custody or production key management |
| Production KYC / AML compliance |
| Cross-chain bridging |
| Real RWA token issuance or legal SPVs |
| Mobile application |
| Persistent relational database (JSONL logs only for MVP) |
| Automated mainnet deploy pipeline |
| Formal security audit |

---

### Success Criteria

| # | Criterion | How to Verify |
|---|---|---|
| SC-01 | Contracts deployed on testnet | Both contract hashes in `testnet.json`; queryable on cspr.live |
| SC-02 | Vault deposit transaction on-chain | tx hash on cspr.live shows `Deposited` event from dashboard |
| SC-03 | Autonomous reallocation on-chain | tx hash on cspr.live shows `Reallocated` event from agent loop; hash in `logs/decisions.jsonl` |
| SC-04 | x402 payment receipt attached to oracle call | `logs/payments.jsonl` entry precedes decision entry; receipt visible in dashboard |
| SC-05 | LLM rationale auditable in log | `logs/decisions.jsonl` has ≥5 entries each with rationale, allocation, confidence, tx hash |
| SC-06 | Reputation score updates on-chain | `update_reputation` tx on cspr.live; registry returns non-zero score |
| SC-07 | MCP tools callable | MCP inspector invokes all 6 tools and returns valid JSON; server log shows invocations |
| SC-08 | Dashboard reflects live state | Allocation chart updates within 15s after on-chain reallocation, no page refresh |
| SC-09 | CSPR.click wallet connect | Casper Wallet user can connect and have deposit tx presented for signing |
| SC-10 | Contract unit tests pass | `cargo test` in `contracts/` passes all tests (deposit, withdraw, reallocate, access control, pause, reputation) |
| SC-11 | Demo video exists | `docs/demo.mp4` or linked URL in README; covers all key flows |
| SC-12 | Open source and documented | Repo public; README has overview, architecture, setup, env vars, deploy steps, demo link |

---

## ARCHITECTURE (written 2026-06-18 by architect; source of truth = REQUIREMENTS section above + ASSUMPTIONS.md)

### 1. System Overview

Aegis is a 5-service + 2-contract system on Casper Testnet. The **autonomous agent** is the
active heart: it runs a `perceive → decide → act` loop, paying for oracle data via x402 and
submitting on-chain transactions to two **Odra contracts** (vault, registry). A **stdio MCP
server** exposes the same on-chain/off-chain surface to any LLM client. A **Next.js dashboard**
gives a human read-only observability plus a wallet-signed deposit/withdraw path. A **shared**
TypeScript package holds the canonical types, Zod schemas, and validated env loader that every
TS service imports — this is the contract that keeps the four TS services in lock-step.

Trust boundaries (least-trusted to most-trusted):
- **External, untrusted:** LLM provider output, CSPR.cloud responses, oracle HTTP responses,
  browser wallet input, MCP tool arguments. All validated with Zod at the boundary before use.
- **Service-internal, trusted-after-validation:** the agent process, oracle process, MCP process.
- **On-chain, authoritative:** vault balance/shares/allocation and agent reputation. The chain
  is the source of truth (A-014); logs are an audit trail, not state.
- **Secret material:** `AGENT_PRIVATE_KEY_HEX`, `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`,
  `CSPR_CLOUD_API_KEY`. Env-only (NFR-S-01), validated at startup, never logged, never sent to
  the browser bundle.

```mermaid
flowchart TB
  subgraph Browser["Browser (untrusted client)"]
    DASH["Dashboard (Next.js 15 / React 19)"]
    WALLET["Casper Wallet ext (via CSPR.click)"]
  end

  subgraph Node["Node.js services (pnpm monorepo)"]
    AGENT["agent: perceive to decide to act loop"]
    ORACLE["oracle: x402-gated RWA API (Express)"]
    MCP["mcp-server: 6 tools / 4 resources (stdio)"]
    SHARED["shared: types, zod, env loader"]
  end

  subgraph Chain["Casper Testnet (authoritative)"]
    VAULT["Vault contract (Odra): deposit/withdraw/reallocate/pause"]
    REG["Registry contract (Odra): register/update/get reputation"]
  end

  subgraph Ext["External providers"]
    LLM["LLM provider (Claude default / OpenAI swap)"]
    CSPRCLOUD["CSPR.cloud REST + node RPC"]
    EXPLORER["cspr.live explorer"]
  end

  DASH -- "deposit/withdraw (signed)" --> WALLET
  WALLET -- "tx" --> CSPRCLOUD
  DASH -- "poll 15s: state, reputation, decisions" --> CSPRCLOUD
  DASH -- "read logs (Next API route)" --> AGENT
  DASH -- "tx link" --> EXPLORER

  AGENT -- "perceive: vault state, reputation" --> CSPRCLOUD
  AGENT -- "perceive: x402 paid GET /api/rwa-yields" --> ORACLE
  AGENT -- "decide: structured prompt" --> LLM
  AGENT -- "act: signed reallocate / update_reputation" --> CSPRCLOUD
  CSPRCLOUD -- "transactions" --> VAULT
  CSPRCLOUD -- "transactions" --> REG

  MCP -- "tools call same clients" --> CSPRCLOUD
  MCP -- "tools call" --> ORACLE

  ORACLE -- "verify payment" --> FAC["PaymentFacilitator (Mock default / Casper live)"]

  SHARED -. "types + zod + env" .-> AGENT
  SHARED -. "" .-> ORACLE
  SHARED -. "" .-> MCP
  SHARED -. "" .-> DASH
```

Trust-boundary crossings worth naming explicitly: (a) **LLM → on-chain** is gated by Zod
validation + an allocation sanity bound + drift/confidence/pause/balance gates (NFR-S-06,
FR-A-05); a malformed, out-of-bound, or low-confidence decision can never become a transaction.
(b) **MCP tool args → signer** — `submit_reallocation` accepts a private key as an argument; this
is a deliberate testnet-only affordance, documented as such, and the key is never logged.

---

### 2. Component Design

#### 2.1 Vault contract (`contracts/src/vault.rs`, Odra 2.x)

Storage (Odra modules):
- `Var<U512>` total_balance_motes — mirror used for share math (actual purse balance is the truth).
- `Cep18` shares — AEGIS share token (Odra CEP-18 submodule), name/symbol/decimals.
- `Var<AccountHash>` agent — the one account allowed to `reallocate` (FR-V-03, NFR-S-02).
- `Var<Address>` owner — admin; can pause and set agent.
- `Var<bool>` paused.
- `Mapping<u8, u16>` allocation_bps — assetId → basis points; invariant: sum == 10_000.
- `Var<u64>` last_reallocation_ts.

Entry points (access control in parens):
- `init(owner, agent, name, symbol)` — constructor.
- `deposit()` payable (any) — accept CSPR purse, mint shares proportional to
  `shares_out = deposit * total_shares / total_balance` (first deposit: 1:1), emit `Deposited`.
- `withdraw(shares: U256)` (any holder) — burn shares, transfer proportional motes, emit `Withdrawn`.
- `reallocate(allocation: Vec<(u8,u16)>)` (agent only) — assert sum==10_000, replace map,
  set ts, emit `Reallocated`. Reverts `Unauthorized` for non-agent (SC-10 test).
- `set_paused(bool)` (owner only); all mutating entry points assert `!paused` (FR-V-07).
- `set_agent(AccountHash)` (owner only) — lets us rotate to the funded testnet agent.
- `get_state() -> VaultState` (any, no signing) — FR-V-06.

Events (Odra `#[odra::event]`): `Deposited`, `Withdrawn`, `Reallocated` — fields per FR-V-04/05.
Re-entrancy: use Odra non-reentrant guard on deposit/withdraw (value transfer paths).

#### 2.2 Registry contract (`contracts/src/registry.rs`, Odra 2.x)

Storage:
- `Mapping<AccountHash, AgentProfile>` profiles (score u64, total_decisions u64,
  correct_predictions u64, registered_ts u64).
- `Var<Address>` owner.

Entry points:
- `init(owner)`.
- `register_agent(agent: AccountHash)` (owner only) — create profile with **score 0** and
  counters at 0, exactly per FR-R-02 (signature unchanged — resolves the FR-R-02 contradiction).
  The demo-gauge seed (A-018) is applied **after** registration as a separate owner-signed
  `update_reputation(agent, +REPUTATION_SEED_SCORE, hash)` call (default seed 50), so FR-R-02's
  contract stays intact and the seed is itself an auditable on-chain reputation transaction.
- `update_reputation(agent, delta: i64, rationale_hash: [u8;32])` (owner only) — apply delta,
  `score = saturating clamp at 0`, increment counters, emit `ReputationUpdated` (FR-R-03, NFR-S-03).
  **Actor model (A-016, resolves SC-06):** the entry point is owner-only for access control
  (NFR-S-03). In the **testnet demo the funded keypair is both owner and the registered agent
  account hash**, so the `update_reputation` transaction simultaneously satisfies NFR-S-03
  (signed by owner) **and** SC-06 (originates from the agent account hash) — no contradiction.
  A production deployment splits the two keys (distinct operator owns the contracts, agent only
  holds `reallocate`); the `update_reputation`/`reallocate` signatures stay stable, only which
  keypair signs changes. The `delta`/`rationale_hash` formula lives in `compute_reputation_delta`
  off-chain (A-008) so the contract interface stays stable.
- `get_reputation(agent) -> AgentReputation` (any) — FR-R-04.

#### 2.3 Oracle (`packages/oracle`, Express)

- `GET /api/health` — public (FR-O-06).
- `GET /api/rwa-yields`:
  1. No `X-PAYMENT-PAYLOAD` → 402 + `X-PAYMENT-REQUIRED` header (amount=`ORACLE_PRICE_MOTES`,
     asset=CSPR, recipient, expiry) (FR-O-01).
  2. With payload → `PaymentFacilitator.verify(payload, now)`; reject expired (`expiry_unix < now`,
     NFR-S-04) and replayed (nonce seen-set). On success return seeded 5-asset payload +
     `payment_receipt`, append to `logs/payments.jsonl` (FR-O-04/05).
- **`X-PAYMENT-PAYLOAD` schema (A-017):** base64-encoded JSON
  `{ scheme, network, amount_motes, asset, recipient, payer, nonce, expiry_unix, signature }`.
  `signature` signs the **canonical digest of every field except `signature`** (keys sorted,
  serialized to canonical JSON, then SHA-256), signed with the payer keypair.
- `PaymentFacilitator` trait (TS interface): `verify(payload, now) -> PaymentReceipt`.
  `MockFacilitator` (default): decode payload, recompute the canonical digest, assert
  `signature` present + well-formed, assert `expiry_unix > now`, assert `nonce` not in the
  in-memory seen-set (then record it) → return synthetic `paymentHash`. This gives replay +
  expiry protection (SC-04, NFR-S-04) with no live dependency. `CasperFacilitator` delegates to
  the live endpoint, chosen by `X402_FACILITATOR` (A-004). Seed data is deterministic with a
  `demo` mode that injects yield shifts (RISK-06 mitigation).

#### 2.4 Agent (`packages/agent`) — perceive→decide→act state machine

States: `IDLE → PERCEIVE → DECIDE → (GATE) → ACT → LOG → REPUTATION? → IDLE`. Each iteration is
wrapped in try/catch; any throw routes to `SKIP(reason)` and the loop continues (FR-A-06, NFR-R-01).

A **loop-overlap guard** wraps the scheduler: a tick that fires while the prior iteration is still
running is skipped and logged (`skipReason: "prior_iteration_running"`). Combined with the
non-blocking ACT confirmation below, this keeps each iteration well under the 30s interval
(NFR-P-03) even when on-chain confirmation takes longer.

- **PERCEIVE:** `VaultClient.getState()` (CSPR.cloud, 10s TTL cache RISK-03), `OracleClient.fetch()`
  (x402 paid GET), `RegistryClient.getReputation()`. The x402 step **constructs and signs** the
  `X-PAYMENT-PAYLOAD` (A-017): assemble `{ scheme, network, amount_motes (=ORACLE_PRICE_MOTES),
  asset, recipient, payer, nonce (fresh UUID), expiry_unix (now + TTL) }`, compute the canonical
  SHA-256 digest, sign it with the agent keypair, attach `signature`, base64-encode, and replay the
  request with the header. The receipt returned is logged to `payments.jsonl` **before** the decision
  entry (SC-04 ordering).
- **DECIDE:** build structured prompt → `LlmClient.decide(prompt)` → Zod-validate the JSON into
  `{ allocation, confidence, rationale }` (NFR-S-06). On Zod failure: one corrective-prompt retry
  (RISK-04), then SKIP. Write `DecisionLogEntry` to `logs/decisions.jsonl` (FR-A-03, SC-05).
- **GATES (FR-A-05):**
  1. **Allocation sanity bound (runs first, before drift):** reject (SKIP + log
     `skipReason: "allocation_out_of_bounds"`) unless all 5 asset slots are present, each weight
     ≤ `MAX_ASSET_WEIGHT_BPS` (default 6000, i.e. no single asset > 60%), and weights sum exactly
     to 10_000. This closes the drift-gate exploit where a degenerate but high-drift allocation
     (e.g. 100% one asset) would otherwise pass straight to ACT.
  2. SKIP if paused | balance < `MIN_VAULT_BALANCE_MOTES` | confidence <
     `MIN_CONFIDENCE_THRESHOLD`.
  3. **Drift gate (fires reallocation only after sanity passes):** ACT only if
     `drift(current, recommended) > REALLOCATION_DRIFT_BPS`. Drift = max absolute per-asset bps
     difference between current and recommended maps.
- **ACT (non-blocking confirmation, reconciles NFR-P-03 vs `TX_CONFIRM_TIMEOUT_MS`):** sign
  `reallocate` with the agent keypair, submit via CSPR.cloud RPC with 3× exponential backoff
  (1s/2s/4s, NFR-R-03). On accepted submission, **immediately** write the tx hash into the log
  entry and return control to the loop. Confirmation is awaited in a **background task** (up to
  `TX_CONFIRM_TIMEOUT_MS` = 60s) that patches the log entry's status when the receipt lands. The
  main iteration therefore never blocks on the 60s confirm window, so it stays < 30s (NFR-P-03).
- **REPUTATION epoch (FR-A-07):** every `REPUTATION_UPDATE_EPOCHS` (default 3), run
  `compute_reputation_delta` over prior decisions vs realized next-epoch yields (A-008), SHA-256
  the relevant log entries as `rationale_hash`, submit `update_reputation` **asynchronously** (same
  background-submit pattern as ACT) so it never blocks the main loop (RISK-07). In the demo this is
  signed by the owner==agent keypair (A-016).

#### 2.5 MCP server (`packages/mcp-server`, stdio transport)

`@modelcontextprotocol/sdk`, MCP 2025-11-25 (FR-M-01). **Custom MCP server (A-015, resolves
OQ-05)** — we read the buildathon rules as permitting a custom server; contingency if the
CSPR.trade MCP server is mandated is to register/wrap our six tool handlers behind it (handlers are
framework-agnostic functions; only the transport layer changes). OQ-05 must be resolved **before
M4**. Reuses the **same clients** as the agent (VaultClient, RegistryClient, OracleClient, TxClient)
— no logic duplication (DRY). All config from env (FR-M-05). Logs every tool call with timestamp to
stdout (FR-M-04). Tool errors return structured MCP error objects, never crash (NFR-R-02). 6 tools +
4 resources exactly per FR-M-02/03.

#### 2.6 Shared (`packages/shared`)

Single source of canonical `types.ts`, `schemas.ts` (Zod), and `env.ts` (Zod-validated loader that
fails fast at startup if a required secret is missing, NFR-S-01). Every TS service imports from here;
this prevents type drift across agent/mcp/oracle/dashboard.

#### 2.7 Dashboard (`apps/dashboard`, Next.js 15 App Router)

Panels: VaultOverview (balance/shares/allocation chart/last reallocation, FR-D-01), Reputation
(score/decisions/accuracy, FR-D-02 — gauge ranged to a demo-appropriate max of 100 so a single-digit
seeded score renders meaningfully, A-018), DecisionFeed (last 20, FR-D-03), Oracle (latest yields +
receipt hash, FR-D-04), Deposit/Withdraw (CSPR.click signing, FR-D-05/W-01..03), "Trigger Agent
Run" button (FR-D-07). Server state via SWR polling every 15s (FR-D-06): on-chain via CSPR.cloud,
logs via a Next API route that reads the JSONL files. CSPR.click connects the wallet; the deposit
flow constructs a tx, requests signature, submits, links to cspr.live, polls confirmation.
CSP header without `unsafe-inline` (NFR-S-05). Visual direction: dark "instrument-panel" editorial,
not default Tailwind (FR-D-08, design-quality rules). The browser bundle never touches secrets.

---

### 3. Key Interfaces

#### 3.1 TypeScript (`packages/shared/src/types.ts`)

```ts
export type Motes = bigint;            // canonical on-chain unit (A-002)
export type BasisPoints = number;      // 0..10_000
export type AssetId = number;          // 0..4 (5 RWA slots, A-005)
export type AllocationMap = Array<{ assetId: AssetId; bps: BasisPoints }>; // sum bps === 10_000

export interface VaultState {
  totalBalanceMotes: Motes;
  totalShares: bigint;
  allocation: AllocationMap;
  agentAccountHash: string;
  paused: boolean;
  lastReallocationTs: number;
}

export interface AgentReputation {
  agentAccountHash: string;
  score: bigint;
  totalDecisions: bigint;
  correctPredictions: bigint;
  registeredTs: number;
}

export interface RwaAsset {
  assetId: AssetId; name: string;
  apyBps: number; riskScore: number;        // 0..100
  liquidityScore: number; dataFreshnessMs: number;
}
export interface RwaOracleData {
  timestamp: number; oracleVersion: string;
  paymentReceipt: PaymentReceipt; assets: RwaAsset[]; // length 5
}

// x402 payment payload carried (base64-encoded JSON) in the X-PAYMENT-PAYLOAD header (A-017).
// `signature` is computed over the canonical SHA-256 digest of all OTHER fields.
export interface PaymentPayload {
  scheme: string;          // e.g. "x402-casper"
  network: string;         // e.g. "casper-testnet"
  amountMotes: Motes;      // === ORACLE_PRICE_MOTES
  asset: string;           // "CSPR"
  recipient: string;       // oracle payee account hash
  payer: string;           // agent account hash
  nonce: string;           // fresh per request; replay-rejected once seen
  expiryUnix: number;      // verify rejects when <= now
  signature: string;       // hex sig over digest of all fields except `signature`
}

export interface PaymentReceipt {
  paymentHash: string; facilitator: 'mock' | 'casper';
  amountMotes: Motes; payerAccountHash: string;
  expiry: number; confirmedAt: number;
}

export interface DecisionLogEntry {
  iteration: number; timestamp: number;
  promptHash: string; oracleSnapshotHash: string;
  recommendedAllocation: AllocationMap;
  confidence: number;                 // 0..100
  rationale: string;                  // <= 500 chars
  acted: boolean; txHash: string | null;
  skipReason: string | null;
}

export interface LlmDecision { allocation: AllocationMap; confidence: number; rationale: string; }
export interface LlmClient { decide(input: DecisionContext): Promise<LlmDecision>; } // Claude|OpenAI

export interface PaymentFacilitator {
  // recompute canonical digest, check signature present, expiryUnix > now, nonce unseen (A-017)
  verify(payload: string, now: number): Promise<PaymentReceipt>; // throws on expired/replay/invalid
}
```

All Zod schemas mirror these in `schemas.ts` and are the validation gate at every external boundary
(LLM output, oracle response, MCP args, CSPR.cloud response).

#### 3.2 Odra entry-point signatures

```rust
// vault.rs
pub fn init(&mut self, owner: Address, agent: AccountHash, name: String, symbol: String);
#[odra(payable)] pub fn deposit(&mut self);
pub fn withdraw(&mut self, shares: U256);
pub fn reallocate(&mut self, allocation: Vec<(u8, u16)>);   // agent-only
pub fn set_paused(&mut self, paused: bool);                  // owner-only
pub fn set_agent(&mut self, agent: AccountHash);             // owner-only
pub fn get_state(&self) -> VaultState;

// registry.rs
pub fn init(&mut self, owner: Address);
pub fn register_agent(&mut self, agent: AccountHash); // owner-only, score 0 (FR-R-02); seed applied via a separate update_reputation call (A-018)
pub fn update_reputation(&mut self, agent: AccountHash, delta: i64, rationale_hash: [u8; 32]); // owner-only
pub fn get_reputation(&self, agent: AccountHash) -> AgentReputation;
```

---

### 4. Data Flow — Three Critical Paths

**A. User deposit (SC-02, SC-09):**
Browser → connect via CSPR.click → user enters amount → dashboard builds `deposit` Transaction
(casper-js-sdk) → CSPR.click requests signature in Casper Wallet → signed tx submitted to
CSPR.cloud RPC → vault mints AEGIS shares, emits `Deposited` → dashboard shows tx hash linked to
cspr.live and polls confirmation → next 15s poll refreshes VaultOverview from on-chain state.
SC-09 specifically requires this run with the **real Casper Wallet extension** (CSPR.click); the
`casper-js-sdk` direct-sign path (A-007a) is dev/CI only and does **not** count for SC-09.

**B. One full autonomous loop that fires a reallocation (SC-03, SC-04, SC-05):**
PERCEIVE: VaultClient.getState (CSPR.cloud) + OracleClient.fetch — **agent constructs+signs the
`X-PAYMENT-PAYLOAD`** (A-017), gets 402 → pays → receipt logged to `payments.jsonl` —
+ RegistryClient.getReputation → DECIDE: LlmClient.decide → Zod-validate → append `DecisionLogEntry`
to `decisions.jsonl` (receipt already precedes it, SC-04 ordering) → GATES: allocation sanity bound
passes → not paused / balance ok / confidence ≥ min → drift > threshold → ACT: sign+submit
`reallocate` with 3× backoff, **write tx hash immediately and return** while a background task awaits
confirmation → vault emits `Reallocated` → dashboard decision feed shows it within one 15s poll
after the confirmed tx is observed (NFR-O-03, SC-08).

**C. Reputation update epoch (SC-06):**
After N epochs, agent reads prior `DecisionLogEntry`s + realized next-epoch oracle yields →
`compute_reputation_delta` (+1/−1, A-008) → SHA-256 the relevant entries → the demo owner==agent
keypair (A-016) submits `update_reputation(agent, delta, rationale_hash)` asynchronously → registry
clamps at 0, emits `ReputationUpdated` → because the signer is the agent account hash, the tx
satisfies SC-06 ("from the agent account hash") while remaining owner-only (NFR-S-03) → dashboard
reputation panel reflects the new score (against the demo-ranged gauge, A-018) on next poll.

---

### 5. Tech Choices With Trade-offs

| Choice | Decision | Trade-off / Alternative rejected |
|---|---|---|
| Contract framework | **Odra 2.x** (placeholder pin `odra = "2.1.0"`, confirm vs scaffold before M1) | Higher-level than raw Casper contract API: less boilerplate, built-in CEP-18 + events + in-memory test backend (SC-10 fast CI). Cost: a framework abstraction layer and version-pin risk (RISK-02). Rejected raw `casper-contract`/`casper-types` macros — more control but far more boilerplate and no in-memory test harness, slowing TDD. |
| MCP server | **Custom server on `@modelcontextprotocol/sdk`, stdio** (A-015) | Custom is permitted per our reading of buildathon rules and is the only way to expose the 6 Aegis tools with our own signing/logging. Contingency: wrap the 6 handlers behind CSPR.trade's MCP if mandated (resolve OQ-05 before M4). stdio matches MCP inspector default (SC-07), zero network/CORS/auth surface. Rejected HTTP/SSE transport — needed only for remote multi-client hosting (federation stretch goal); adds auth + CORS for no MVP benefit. |
| Oracle server | **Express** | Smallest mature HTTP server for a 2-route x402 gate; trivial header/middleware control for 402 flow. Rejected Fastify (marginal perf gain irrelevant at demo scale) and a Next.js route (we want the oracle as an independently runnable, paid service, not coupled to the dashboard). |
| Dashboard | **Next.js 15 App Router + React 19 + Tailwind v4** | Required by design-quality rules; SSR for fast LCP (NFR-P-01), API routes to read local logs without exposing the filesystem to the browser. Cost: heavier than a Vite SPA. Rejected plain Vite SPA — would need a separate tiny server anyway to read logs and set CSP. |
| Monorepo | **pnpm workspaces** | One lockfile, shared `packages/shared` types imported everywhere, single `pnpm dev` (SC-12). Rejected npm/yarn (slower, looser hoisting) and Nx/Turbo (build-graph tooling is overkill for 5 packages). |
| Casper SDK | **casper-js-sdk v5.x (Casper 2.0 / Transaction model)** | v5 is the line that supports the Condor `Transaction` model (A-001). Cost: v5 API differs from v2 examples online. Rejected v2.x — built for the deprecated Deploy model; fallback to `put_deploy` only if a testnet path still requires it (A-001 override). The headless direct-sign path is dev/CI only (A-007a), not an SC-09 substitute. |
| LLM | **Provider-agnostic `LlmClient`** (Claude default, OpenAI swap) | A-006 confirmed. Callers depend only on the interface; swap via `LLM_PROVIDER`. Cost: lowest-common-denominator structured-output handling. Rejected hard-coding the Anthropic SDK in callers. |
| Logs | **Append-only JSONL** (no DB) | A-014; zero infra, audit-grade, easy to diff for SC-04/05. Rejected Postgres for MVP — adds a dependency and migration surface for no demo benefit; documented `DATABASE_URL` override. |

---

### 6. Milestones / Build Order (dependency-ordered, thinnest runnable slice first)

| M | Deliverable | Thin slice / definition of done | Satisfies | Resolution gates |
|---|---|---|---|---|
| **M0** Scaffold | pnpm monorepo, `packages/shared` (types+zod+env), `.env.example`, CI lint/typecheck, README skeleton | `pnpm install && pnpm dev` boots stubs; shared types compile | SC-12 (partial) | — |
| **M1** Contracts + tests | vault + registry in Odra, full unit suite on in-memory backend | `cargo test` green: deposit, withdraw, reallocate, access-control reject, pause, reputation update, clamp-at-zero, seed-score | SC-10 | **OQ-02**: confirm exact Odra semver (placeholder `2.1.0`) against buildathon scaffold before starting M1 |
| **M2** Oracle + x402 | Express oracle, 402 flow, MockFacilitator, signed-payload verify, seeded data, payments.jsonl, health | `curl` 402 then paid 200; payment logged; replay/expiry/bad-sig rejected | SC-04 (mechanism) | **OQ-01**: resolve live `X402_FACILITATOR_URL` before M2; MockFacilitator default means this never blocks the build |
| **M3** Agent loop | perceive→decide→act, signed x402 payload construction, LlmClient, Zod gate, allocation sanity + drift gates, non-blocking ACT + overlap guard, decisions.jsonl, reputation epoch | Loop runs against M1 contracts (in-memory→testnet) producing a `reallocate` + decision log; iteration < 30s | SC-03, SC-05, SC-06, SC-04 (end-to-end) | — |
| **M4** MCP server | 6 tools + 4 resources over stdio reusing M2/M3 clients | MCP inspector invokes all 6 tools → valid JSON | SC-07 | **OQ-05**: confirm custom MCP server accepted (A-015) before M4; else wrap handlers behind CSPR.trade MCP |
| **M5** Dashboard | 4 panels + deposit/withdraw + CSPR.click + 15s polling + trigger button + demo-ranged reputation gauge | Live state visible, allocation updates ≤15s after the confirmed reallocation tx is observed, wallet connect + deposit signing | SC-02, SC-08, SC-09 | — |
| **M6** Deploy prep + docs | gated `deploy:testnet` (ALLOW_TESTNET_DEPLOY), testnet.json, README full, demo video | Contracts on testnet, hashes recorded, README runnable, demo recorded | SC-01, SC-11, SC-12 | — |

Note: M3 develops against the M1 in-memory backend first, then re-points clients at testnet once
M6's gated deploy is run — keeping every milestone runnable without blocking on testnet.

---

### 7. Risk Register

| ID | Risk | Mitigation |
|---|---|---|
| RISK-01 | x402 testnet facilitator unavailable | `MockFacilitator` is default; live is an env swap (A-004). No code path blocks on it. Live `X402_FACILITATOR_URL` (OQ-01) resolves before M2 but does not gate the build. |
| RISK-02 | Odra 2.x breaking changes / testnet incompat | Pin exact semver (placeholder `2.1.0`, confirm vs scaffold before M1 — OQ-02); all CI on in-memory backend; testnet deploy gated/manual (A-010). |
| RISK-03 | CSPR.cloud rate limits at demo cadence | 10s TTL cache in clients; 3× exponential backoff; 10s timeouts (NFR-P-04). |
| RISK-04 | LLM emits invalid allocation JSON | Zod gate + allocation sanity bound + one corrective-prompt retry, then SKIP (FR-A-06). Never reaches chain. |
| RISK-05 | Casper Wallet ext breaks on 2.0 testnet | `casper-js-sdk` direct-sign is a **dev/CI-only** fallback so deposit stays exercisable headlessly (A-007a); it does NOT satisfy SC-09, which still requires a real manual Casper Wallet run. |
| RISK-06 | No reallocation fires during demo | `demo` oracle mode injects yield shifts; `REALLOCATION_DRIFT_BPS=50` for demo (A-011). |
| RISK-07 | Reputation tx >60s confirm | Async/background submit; main loop never blocks on confirmation. |
| RISK-08 | Type drift across 4 TS services | Single `packages/shared` source of types+zod imported everywhere; CI typecheck gate. |
| RISK-09 | Share-math rounding / first-deposit edge | 1:1 first-deposit rule + explicit Odra unit tests for tiny/zero/rounding cases (SC-10). |
| RISK-10 | Agent key leakage to UI or logs | Key env-only, loaded in agent/mcp processes only, redacted from all log lines (NFR-S-01). |
| RISK-11 | Decision/payment log ordering broken (SC-04) | Single writer per file, append-only; receipt written in PERCEIVE before decision in DECIDE. |
| RISK-12 | x402 payload replay / expiry / integrity | Canonical digest + nonce seen-set + `expiry_unix` check in `verify` (A-017, SC-04, NFR-S-04). NOTE: `MockFacilitator` checks the signature is present + well-formed but does not cryptographically verify it against the payer key (testnet mock, no real settlement); `CasperFacilitator` performs full signature verification. |
| RISK-13 | Drift gate accepts degenerate allocation | Allocation sanity bound (5 slots, each ≤ `MAX_ASSET_WEIGHT_BPS`, sum==10_000) runs before drift (§2.4 GATES). |
| RISK-14 | Loop overlap when confirm exceeds interval | Non-blocking ACT (submit + background confirm) + overlap guard skips a tick if prior iteration still running (§2.4, NFR-P-03). |
| RISK-15 | OQ-05 mandates CSPR.trade MCP | Tool handlers are framework-agnostic; wrap behind CSPR.trade MCP if required. Resolve before M4 (A-015). |
| RISK-16 | Reputation gauge renders near-empty (demo scale) | Seed score (`REPUTATION_SEED_SCORE`, default 50) + demo-ranged gauge max 100 (A-018). |

---

### 8. Test Strategy (each SC mapped to verification)

| SC | Verified by |
|---|---|
| SC-01 contracts deployed | Manual gated `deploy:testnet`; assert both hashes in `testnet.json`; cspr.live check |
| SC-02 deposit tx | Playwright drives dashboard deposit (mocked wallet sign in CI); manual real wallet on testnet for `Deposited` event |
| SC-03 autonomous reallocation | Vitest integration: loop against in-memory vault asserts `Reallocated` + log hash; manual testnet for on-chain confirmation |
| SC-04 x402 receipt ordering + integrity | Vitest: oracle 402→sign payload→pay→200; assert `verify` rejects expired/replayed/bad-signature payloads (A-017); assert `payments.jsonl` entry precedes matching `decisions.jsonl` entry |
| SC-05 rationale auditable | Vitest: run ≥5 iterations, assert each `DecisionLogEntry` has all required fields and parses |
| SC-06 reputation on-chain | cargo test (clamp/delta/seed) + Vitest (delta compute) + manual testnet `update_reputation` **signed by the demo owner==agent keypair (A-016)**, asserting the tx originates from the agent account hash and `get_reputation` returns a score above the seed |
| SC-07 MCP tools | `npx @modelcontextprotocol/inspector` against running server: smoke-test **all 6 tools** return valid JSON — `get_vault_state`, `get_agent_reputation`, `fetch_rwa_oracle_data`, `get_decision_log`, `get_transaction_status`, and `submit_reallocation` run in **dry-run/mock mode** (no live tx) for the smoke test (FR-M-02 full coverage); server log shows all invocations |
| SC-08 live dashboard | Playwright: trigger reallocation, wait for the confirmed tx to be observed, then assert allocation chart updates within one poll cycle (≤15s) of that observation with no reload (deterministic wait on confirmed state, not on submission); visual regression at 768/1024/1440 |
| SC-09 wallet connect | **Manual on testnet with the real Casper Wallet extension via CSPR.click** (the only path that satisfies SC-09 — the direct-sign fallback A-007a does not count); Playwright with CSPR.click mocked exercises the connect/balance UI in CI only |
| SC-10 contract unit tests | `cargo test` on Odra in-memory backend — deposit, withdraw, reallocate, access-control reject, pause, reputation update, clamp-at-zero, seed-score |
| SC-11 demo video | Manual: record 3–10 min covering all key flows; link in README |
| SC-12 open source/docs | Manual: clone fresh, `pnpm install && pnpm dev`; README review (overview, diagram, setup, env, deploy, demo) |

Cross-cutting: ≥80% unit coverage on shared, agent, oracle (common/testing.md); CSP + no-secrets-in-bundle
check on dashboard; security-reviewer pass on signing and access-control paths before any commit.

---

## TASK LIST (to be written by planner)

_Pending. Input: Architecture section above._

---

## REVISION LOG

- **2026-06-18 — Round 0 (initial architecture).** First full architecture written by architect
  from REQUIREMENTS + ASSUMPTIONS. Locked decisions: Odra 2.x (pinned) over raw contract API;
  stdio MCP transport over HTTP; Express oracle; Next.js 15 dashboard; pnpm workspaces;
  casper-js-sdk v5.x (Casper 2.0 Transaction model); provider-agnostic `LlmClient`; append-only
  JSONL logs (no DB). Added architectural risks RISK-08..11 (type drift, share-math rounding,
  key leakage, log ordering). Reputation `update_reputation` is owner/admin-signed (NFR-S-03),
  with the agent computing the delta off-chain. Awaiting critic round 1.

- **2026-06-18 — Round 1 (critic pass, 10 defects addressed).** Surgical revisions; requirements
  section untouched. New assumptions A-007a, A-015, A-016, A-017, A-018 added; A-003/A-004 amended
  with resolution gates.
  1. **OQ-05 (MCP) addressed** — added A-015 (custom `@modelcontextprotocol/sdk` stdio server is
     sufficient; contingency = wrap our 6 tools behind CSPR.trade MCP if mandated), RISK-15, an MCP
     row in §5, and a §6 M4 resolution gate "resolve before M4." (§2.5, §5, §6, §7)
  2. **OQ-01/OQ-02 resolution gates** — pinned Odra placeholder `2.1.0` (confirm vs scaffold before
     M1) in A-003/§5/§6/RISK-02; stated live `X402_FACILITATOR_URL` resolves before M2 with
     MockFacilitator as default so neither blocks the build (A-004, §6 M1/M2 gates).
  3. **SC-06 actor contradiction resolved** — A-016: demo keypair is both owner and agent account
     hash, satisfying SC-06 (tx from agent hash) and NFR-S-03 (owner-only) simultaneously;
     documented the production separation-of-duties split (interface stable). Updated §2.2, §4-C,
     and the §8 SC-06 test row.
  4. **x402 client payload specified** — A-017 + §3.1 `PaymentPayload`
     `{ scheme, network, amount_motes, asset, recipient, payer, nonce, expiry_unix, signature }`,
     signing over the canonical digest of all fields except `signature`; agent constructs+signs in
     §2.4 PERCEIVE / §4-B; `MockFacilitator.verify` recomputes digest, checks sig present,
     `expiry_unix > now`, rejects seen nonce (§2.3, RISK-12, SC-04/NFR-S-04).
  5. **Drift gate hardened** — §2.4 GATES now runs an allocation sanity bound first (all 5 slots,
     each ≤ `MAX_ASSET_WEIGHT_BPS`=6000, sum==10_000); drift fires reallocation only after sanity
     passes (RISK-13).
  6. **Loop overlap vs timeouts reconciled** — §2.4 ACT confirmation made async/non-blocking (submit,
     log tx hash immediately, confirm in background) plus an overlap guard skipping a tick if the
     prior iteration is still running; keeps iteration < 30s vs 60s confirm (NFR-P-03, RISK-14).
  7. **SC-08 timing restated** — §8 SC-08 and §4-B now measure "within one poll cycle (≤15s) after
     the dashboard observes the confirmed tx," with a deterministic Playwright wait, not from
     submission.
  8. **RISK-05 vs SC-09 clarified** — A-007a + §4-A + §5 + §8 SC-09 state the casper-js-sdk
     direct-sign path is dev/CI only and does NOT satisfy SC-09, which requires a real manual Casper
     Wallet extension run.
  9. **Reputation scale fixed** — A-018: seed score (`REPUTATION_SEED_SCORE`, default 50) at
     `register_agent` + demo-ranged dashboard gauge max 100; reflected in §2.2/§2.7 and the
     `register_agent(agent, seed_score)` signature (§3.2), RISK-16, SC-10 seed-score test.
  10. **SC-07 widened** — §8 SC-07 now smoke-tests all 6 MCP tools return valid JSON, with mutating
      `submit_reallocation` run in dry-run/mock mode; M4 DoD updated to "all 6 tools."

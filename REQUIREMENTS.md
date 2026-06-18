# Aegis — Requirements Brief

**Project:** Aegis — Autonomous RWA Yield-Routing Agent  
**Event:** Casper Agentic Buildathon 2026 — Qualification Round  
**Date:** 2026-06-18  
**Status:** Approved for architecture

---

## 1. Problem Statement

Tokenized real-world assets (RWAs) — T-bills, private credit, commodities, liquid staking — are proliferating across blockchain networks. As of Q1 2026, on-chain RWA value exceeds $19 billion and is growing rapidly. Investors and protocols face a fragmented, fast-moving yield landscape: yield rates shift continuously, capital allocation requires constant monitoring, and rebalancing is manual, slow, and error-prone.

**Target users:**
1. **DeFi protocols and DAOs** that hold treasury in on-chain vaults and want autonomous, rules-based yield optimization without 24/7 human oversight.
2. **Individual on-chain investors** who want a delegated, auditable portfolio manager that reasons transparently and builds a verifiable track record.
3. **Casper ecosystem builders** who need a reference implementation of the full AI Toolkit stack (Odra + MCP + x402 + CSPR.cloud/click).

**Job-to-be-done:** Continuously monitor available RWA yield instruments, reason over risk/return trade-offs with an LLM, and autonomously reallocate an on-chain vault — while building a tamper-proof reputation for the accuracy of those decisions.

---

## 2. Goals

### 2.1 Primary Goals (MVP)

1. Deploy working Odra smart contracts (vault + reputation registry) on Casper Testnet that produce real, queryable on-chain transactions.
2. Run an autonomous agent loop that perceives chain state and oracle data, reasons with an LLM, and acts by submitting on-chain transactions without human approval.
3. Implement the x402 payment flow: the agent pays per oracle API call, receiving a payment receipt stored alongside the LLM decision log.
4. Expose Casper contract state and agent actions through an MCP server that any LLM client can connect to.
5. Provide a dashboard UI for a human to observe vault state, agent decisions, and reputation score in real time.
6. Satisfy all Casper Buildathon eligibility gates: open-source, README, demo video, working on-chain component.

### 2.2 Stretch Goals (post-MVP, noted for judging narrative)

- Multi-wallet portfolio support (allocate across multiple vaults with different risk profiles).
- On-chain governance: AEGIS token holders vote to override agent allocations.
- Live RWA oracle integration (Centrifuge, rwa.xyz) replacing simulated data.
- Cross-chain vault tracking (Casper + EVM chain via bridge).
- Agent-to-agent reputation queries via MCP federation.

---

## 3. Non-Goals

| Non-Goal | Rationale |
|---|---|
| Mainnet deployment with real funds | Guardrail: testnet only for this buildathon phase |
| Real private key custody or production key management | Out of scope; testnet keypair only |
| Production-grade KYC / AML compliance | Post-launch concern; not a demo blocker |
| Cross-chain bridging or multi-chain vaults | Stretch goal only |
| Real RWA token issuance or legal SPV wrapping | The vault holds CSPR; RWA instruments are simulated |
| Mobile application | Dashboard is web-only |
| Persistent relational database | MVP uses append-only JSONL logs |
| Automated mainnet deploy pipeline | Deploy is always a gated manual step |
| Formal security audit | Post-buildathon |

---

## 4. Functional Requirements

### 4.1 Vault Smart Contract (Odra / Rust / Casper Testnet)

**FR-V-01** The vault contract SHALL accept CSPR deposits from any account and mint proportional `AEGIS` CEP-18 vault shares to the depositor.

**FR-V-02** The vault contract SHALL allow any `AEGIS` share holder to redeem shares for proportional CSPR at any time (withdraw).

**FR-V-03** The vault contract SHALL expose a `reallocate(allocation: Vec<(AssetId, BasisPoints)>)` entry point callable only by the registered agent account hash (access-controlled). Allocation weights MUST sum to 10,000 basis points (100%).

**FR-V-04** The vault contract SHALL emit a `Reallocated` event containing: block timestamp, agent account hash, old allocation map, new allocation map, and total vault balance in motes.

**FR-V-05** The vault contract SHALL emit `Deposited` and `Withdrawn` events with: account hash, amount in motes, shares minted/burned, and block timestamp.

**FR-V-06** The vault contract SHALL expose a `get_state() -> VaultState` named key readable by any caller without signing, returning: total balance in motes, total shares outstanding, current allocation map, and agent account hash.

**FR-V-07** The vault contract SHALL be pausable by the contract owner (emergency stop). No deposits, withdrawals, or reallocations are accepted while paused.

**FR-V-08** The vault contract SHALL be deployed to Casper Testnet and have its contract hash recorded in `contracts/deployments/testnet.json`.

### 4.2 Agent Reputation Registry Contract (Odra / Rust / Casper Testnet)

**FR-R-01** The registry contract SHALL store an agent profile keyed by `AccountHash`, containing: reputation score (`u64`), total decisions recorded (`u64`), total correct predictions (`u64`), and registration timestamp.

**FR-R-02** The registry contract SHALL expose a `register_agent(agent: AccountHash)` entry point callable by the contract owner (admin), creating a new profile with score 0.

**FR-R-03** The registry contract SHALL expose an `update_reputation(agent: AccountHash, delta: i64, rationale_hash: [u8; 32])` entry point callable only by the contract owner. It SHALL apply the delta, clamp score at zero minimum, and emit a `ReputationUpdated` event containing: agent account hash, old score, new score, delta, rationale hash, and block timestamp.

**FR-R-04** The registry contract SHALL expose a `get_reputation(agent: AccountHash) -> AgentReputation` named key readable by any caller.

**FR-R-05** The registry contract SHALL be deployed to Casper Testnet and have its contract hash recorded in `contracts/deployments/testnet.json`.

### 4.3 Autonomous Agent Loop (TypeScript / Node.js)

**FR-A-01** The agent SHALL run a continuous loop on a configurable interval (`AGENT_LOOP_INTERVAL_MS`, default 30,000 ms for demo).

**FR-A-02** On each loop iteration, the agent SHALL **perceive** by:
- Querying current vault state via CSPR.cloud REST API (balance, allocation, shares).
- Fetching RWA yield/risk data from the x402-gated oracle endpoint (FR-O-01 through FR-O-04).
- Reading the agent's current on-chain reputation score from the registry contract.

**FR-A-03** On each loop iteration, the agent SHALL **decide** by:
- Constructing a structured prompt containing current vault state, oracle yield data, reputation context, and risk parameters.
- Invoking the configured LLM (Anthropic Claude) with the prompt.
- Parsing the LLM structured-JSON response into: recommended allocation map, confidence score (0–100), and decision rationale string (max 500 chars).
- Writing the full decision record (timestamp, prompt hash, allocation, confidence, rationale, oracle data snapshot) to `logs/decisions.jsonl`.

**FR-A-04** On each loop iteration, the agent SHALL **act** if the recommended allocation differs from the current allocation by more than the configured drift threshold (`REALLOCATION_DRIFT_BPS`, default 200 basis points):
- Construct and sign a `reallocate` transaction using the agent keypair.
- Submit the transaction to Casper Testnet via CSPR.cloud node RPC.
- Record the deploy/transaction hash in the decision log entry.
- Wait for transaction confirmation (up to `TX_CONFIRM_TIMEOUT_MS`, default 60,000 ms) and log the outcome.

**FR-A-05** The agent SHALL NOT act (skip reallocation) if: the vault is paused, the balance is below `MIN_VAULT_BALANCE_MOTES` (default: 100 CSPR = 100,000,000,000 motes), or the LLM returns a confidence score below `MIN_CONFIDENCE_THRESHOLD` (default: 60).

**FR-A-06** The agent SHALL handle LLM errors, RPC errors, and oracle errors gracefully: log the error with full context, skip the act phase, and continue the loop on the next interval. The loop SHALL NOT crash on a single iteration failure.

**FR-A-07** After a configurable number of epochs (`REPUTATION_UPDATE_EPOCHS`, default: 3 loops), the agent SHALL evaluate previous prediction accuracy and submit an `update_reputation` transaction to the registry contract with the computed delta and a SHA-256 hash of the relevant decision log entries as the `rationale_hash`.

### 4.4 MCP Server (TypeScript / Node.js)

**FR-M-01** The MCP server SHALL implement the MCP 2025-11-25 specification using `@modelcontextprotocol/sdk`.

**FR-M-02** The MCP server SHALL expose the following **Tools** (executable actions):

| Tool Name | Description | Inputs | Returns |
|---|---|---|---|
| `get_vault_state` | Query current vault state from testnet | `vault_contract_hash: string` | `VaultState` JSON |
| `get_agent_reputation` | Query agent reputation from registry | `agent_account_hash: string` | `AgentReputation` JSON |
| `submit_reallocation` | Submit a signed reallocation transaction | `allocation: AllocationMap`, `agent_private_key_hex: string` | `{ tx_hash: string, status: string }` |
| `fetch_rwa_oracle_data` | Fetch yield data via x402-gated oracle | `(none)` | `RwaOracleData` JSON |
| `get_decision_log` | Read last N agent decisions | `limit: number` | `DecisionLogEntry[]` JSON |
| `get_transaction_status` | Query a transaction hash on testnet | `tx_hash: string` | `{ status, block_height, timestamp }` |

**FR-M-03** The MCP server SHALL expose the following **Resources** (read-only context):

| Resource URI | Description |
|---|---|
| `aegis://vault/state` | Live vault state |
| `aegis://agent/reputation` | Agent reputation profile |
| `aegis://decisions/recent` | Last 10 decision log entries |
| `aegis://oracle/latest` | Most recent oracle data snapshot |

**FR-M-04** The MCP server SHALL be launchable as a standalone process (`pnpm --filter mcp-server start`) and SHALL log all tool invocations with timestamps to stdout.

**FR-M-05** The MCP server configuration (contract hashes, RPC endpoint, oracle URL) SHALL be injected via environment variables. No hardcoded values.

### 4.5 x402-Gated Oracle API (TypeScript / Node.js / Express)

**FR-O-01** The oracle server SHALL implement the x402 protocol: respond to unauthenticated GET `/api/rwa-yields` with HTTP 402 and a `X-PAYMENT-REQUIRED` header containing the payment requirements (amount, asset, recipient, expiry).

**FR-O-02** The oracle server SHALL accept a retry request containing a signed x402 payment payload header (`X-PAYMENT-PAYLOAD`), verify it (via `MockFacilitator` or `CasperFacilitator` per `X402_FACILITATOR` env var), and return the yield data payload on success.

**FR-O-03** The oracle server payment SHALL be denominated in CSPR (or mock-CSPR). Price per call: configurable via `ORACLE_PRICE_MOTES` (default: 1,000,000 motes = 0.001 CSPR).

**FR-O-04** On each successful paid call, the oracle server SHALL return a JSON payload containing: `timestamp`, `oracle_version`, `payment_receipt` (containing the payment hash and facilitator confirmation), and `assets[]` (array of 5 asset records: `asset_id`, `name`, `apy_bps`, `risk_score_0_100`, `liquidity_score_0_100`, `data_freshness_ms`).

**FR-O-05** The oracle server SHALL write each successful payment to `logs/payments.jsonl` with the payment receipt, caller address, and timestamp.

**FR-O-06** The oracle server SHALL expose a public GET `/api/health` endpoint (no payment required) returning `{ status: "ok", version, uptime_ms }`.

### 4.6 Wallet and Signing Path

**FR-W-01** The dashboard UI SHALL integrate CSPR.click SDK (`@make-software/cspr-click`) to allow users to connect a Casper Wallet browser extension and sign deposit/withdraw transactions.

**FR-W-02** The dashboard SHALL display a wallet connection button, show the connected account hash (truncated), and show the CSPR balance of the connected account via CSPR.cloud API.

**FR-W-03** The dashboard deposit flow SHALL: prompt the user for a CSPR amount, construct a `deposit` transaction, request signature via CSPR.click, submit to testnet, display the transaction hash as a link to cspr.live testnet explorer, and poll for confirmation status.

**FR-W-04** The agent signing path SHALL use `casper-js-sdk` with the keypair loaded from `AGENT_PRIVATE_KEY_HEX`. The key SHALL NEVER be logged or exposed to the UI.

### 4.7 Dashboard UI (Next.js / React)

**FR-D-01** The dashboard SHALL display a real-time vault overview panel showing: total vault balance (CSPR), total shares outstanding, current allocation (visual pie or bar chart), last reallocation timestamp, and agent account hash.

**FR-D-02** The dashboard SHALL display an agent reputation panel showing: current reputation score, total decisions, total correct predictions, accuracy percentage, and last updated timestamp.

**FR-D-03** The dashboard SHALL display a live decision feed: a chronological list of the last 20 agent decisions, each showing timestamp, recommended allocation, LLM confidence score, rationale snippet, and transaction hash (if a reallocation was submitted).

**FR-D-04** The dashboard SHALL display an oracle data panel showing the most recent RWA yield data (asset name, APY, risk score) alongside the payment receipt hash.

**FR-D-05** The dashboard SHALL allow a connected wallet holder to deposit CSPR into the vault (FR-W-03) and withdraw by redeeming AEGIS shares.

**FR-D-06** The dashboard SHALL update vault state and decision feed by polling CSPR.cloud API and the local agent decision log every 15 seconds. No page refresh required.

**FR-D-07** The dashboard SHALL include a "Trigger Agent Run" button (for demo purposes) that forces an immediate agent loop iteration, bypassing the interval timer.

**FR-D-08** The dashboard SHALL be responsive and function at 1440px (primary demo width), 1024px, and 768px. It SHALL implement a dark or light visual direction (not both are required for MVP) that avoids default Tailwind template appearance (per global design-quality rules).

---

## 5. Non-Functional Requirements

### 5.1 Security

**NFR-S-01** No private keys, seed phrases, or API keys SHALL appear in committed source code, build artifacts, or client-side bundles. All secrets are injected via environment variables and validated at startup.

**NFR-S-02** The vault `reallocate` entry point SHALL be access-controlled to the registered agent `AccountHash` only. Any transaction from an unauthorized account SHALL be rejected with a descriptive error.

**NFR-S-03** The `update_reputation` entry point SHALL be callable only by the contract owner (admin key). The agent does not hold admin privileges.

**NFR-S-04** The oracle server SHALL not accept replayed x402 payment payloads. Payments have an expiry timestamp; the server SHALL reject payloads with `expiry < now`.

**NFR-S-05** The dashboard SHALL configure a Content Security Policy header preventing XSS. `unsafe-inline` scripts are prohibited.

**NFR-S-06** The agent loop SHALL validate all LLM output against a Zod schema before constructing any on-chain transaction. Malformed LLM output SHALL cause a skip (FR-A-06), never an on-chain submission.

### 5.2 Reliability

**NFR-R-01** The agent loop SHALL survive individual iteration failures (FR-A-06). It SHALL not terminate due to a network timeout, LLM error, or oracle refusal.

**NFR-R-02** The MCP server SHALL return structured error responses (MCP error object) for all tool failures. It SHALL NOT crash the process on a tool invocation error.

**NFR-R-03** Transaction submission SHALL include retry logic: up to 3 attempts with exponential backoff (1s, 2s, 4s) before logging a failure and skipping the act phase.

### 5.3 Observability

**NFR-O-01** Every agent loop iteration SHALL produce a structured log line (JSON) containing: iteration number, loop phase (perceive/decide/act/skip), duration_ms, outcome, and any error.

**NFR-O-02** Every x402 payment SHALL produce a log entry in `logs/payments.jsonl` (FR-O-05).

**NFR-O-03** Every reallocation transaction hash SHALL be logged to `logs/decisions.jsonl` and displayed in the dashboard decision feed within one polling cycle (≤15 seconds).

### 5.4 Performance

**NFR-P-01** Dashboard initial page load (LCP) SHALL be under 2.5 seconds on a standard broadband connection (Core Web Vitals target per global performance rules).

**NFR-P-02** Dashboard JavaScript bundle SHALL be under 300 KB gzipped (app page budget per global performance rules).

**NFR-P-03** Each agent loop iteration (perceive + decide + act) SHALL complete within 30 seconds under normal conditions to prevent loop overlap at the 30-second demo interval.

**NFR-P-04** CSPR.cloud API calls SHALL use connection pooling and SHALL timeout after 10 seconds with a logged error.

### 5.5 Cost

**NFR-C-01** All on-chain transactions use Casper Testnet CSPR, which is freely available from the testnet faucet. Zero real monetary cost.

**NFR-C-02** LLM API calls are charged to the team's Anthropic account. Each decision prompt is estimated at ~1,500 input tokens + ~300 output tokens. At 30-second intervals for a 5-minute demo, this is approximately 10 calls, well within free-tier limits.

---

## 6. Measurable Success Criteria

Each criterion maps to something a verifier can check independently.

**SC-01** — Contract deployment  
The vault contract and registry contract are deployed on Casper Testnet. `contracts/deployments/testnet.json` contains both contract hashes. Each hash is queryable on cspr.live testnet explorer and shows a successfully executed deploy/transaction.

**SC-02** — Vault deposit transaction  
A deposit transaction submitted through the dashboard UI produces a real on-chain transaction hash. The hash is queryable on cspr.live testnet explorer and shows: the caller account hash, the vault contract hash as recipient, the deposited mote amount, and a `Deposited` event in the execution result.

**SC-03** — Autonomous reallocation transaction  
The agent loop produces at least one `reallocate` transaction on testnet. The transaction hash is queryable on cspr.live and shows: the agent account hash, the vault contract hash, and a `Reallocated` event containing the new allocation map in the execution result. The hash appears in `logs/decisions.jsonl`.

**SC-04** — x402 payment receipt attached to oracle call  
Every oracle API call in the agent loop has a corresponding entry in `logs/payments.jsonl` containing a payment receipt hash. The receipt precedes the LLM decision record in `logs/decisions.jsonl` for the same iteration. The receipt is visible in the dashboard oracle panel.

**SC-05** — LLM rationale is logged and auditable  
`logs/decisions.jsonl` contains at least 5 entries, each with: timestamp, full LLM rationale string, recommended allocation map, confidence score, oracle data snapshot hash, and transaction hash (if reallocation was submitted). An auditor can read this file and reconstruct exactly why the agent made each decision.

**SC-06** — Reputation score updates on-chain  
At least one `update_reputation` transaction appears on testnet from the agent account hash to the registry contract. The registry's `get_reputation` named key returns a score that **differs from the registration seed by the agent's computed delta** (i.e. a real autonomous epoch update changed it, not just the seed). The `ReputationUpdated` event is visible in the cspr.live transaction execution result.

**SC-07** — MCP server tools callable by an LLM client  
Running `npx @modelcontextprotocol/inspector` against the running MCP server successfully invokes `get_vault_state`, `get_agent_reputation`, and `fetch_rwa_oracle_data` and returns valid JSON responses. The MCP server log shows the invocations.

**SC-08** — Dashboard displays live on-chain state  
The dashboard UI, open in a browser, shows vault balance, current allocation, agent reputation score, and the most recent decision. After an on-chain reallocation (SC-03), the allocation chart updates within 15 seconds without a page refresh.

**SC-09** — CSPR.click wallet connect works  
A user with the Casper Wallet browser extension installed on Casper Testnet can connect their wallet through the dashboard, see their CSPR balance, and have a deposit transaction presented for signing in the wallet extension UI.

**SC-10** — All contract unit tests pass  
Running `cargo test` in the `contracts/` directory executes all Odra unit tests (minimum: deposit, withdraw, reallocate, access control rejection, pause behavior, reputation update, reputation clamp at zero) and all tests pass with no failures.

**SC-11** — Demo video deliverable  
A screen-recorded demo video (minimum 3 minutes, maximum 10 minutes) exists in `docs/demo.mp4` or as a linked URL in `README.md`. It covers: wallet connect, vault deposit, agent loop running, an x402 oracle call, an on-chain reallocation, a reputation score update, and the cspr.live explorer confirmation.

**SC-12** — Open source and documented  
The repository is publicly accessible. `README.md` contains: project overview, architecture diagram, setup instructions, environment variable reference, testnet deploy steps, and a link to the demo video. Any reviewer can clone the repo and run `pnpm install && pnpm dev` to start the development environment.

---

## 7. Key Risks and Open Questions

### 7.1 Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RISK-01 | x402 Casper testnet facilitator not available during build window | Medium | High | MockFacilitator is the default; live facilitator is an optional swap (A-004) |
| RISK-02 | Odra 2.x breaking changes or testnet incompatibility | Low | High | Pin exact Odra version; use Odra in-memory test backend for all CI; gated manual testnet deploy |
| RISK-03 | CSPR.cloud API rate limits block agent loop at demo cadence | Low | Medium | Cache responses with a 10-second TTL; implement exponential backoff |
| RISK-04 | LLM produces invalid allocation JSON, failing Zod validation | Medium | Low | Handled by FR-A-06 (skip and log); add a retry with a corrective prompt |
| RISK-05 | Casper Wallet browser extension breaks with Casper 2.0 testnet | Low | Medium | Test with Casper Wallet SDK directly as fallback signing path |
| RISK-06 | Agent loop produces no reallocation events during demo (all allocations within drift threshold) | Medium | High | Pre-seed oracle data with deliberate yield shifts in the demo seed script; lower `REALLOCATION_DRIFT_BPS` to 50 bps for demo mode |
| RISK-07 | On-chain reputation update transaction takes >60s to confirm on testnet | Low | Medium | Implement async reputation update: submit and confirm in a background goroutine, don't block the main loop |

### 7.2 Open Questions

| ID | Question | Decision Needed By | Owner |
|---|---|---|---|
| OQ-01 | Is there a live x402 Casper facilitator endpoint available on testnet during the buildathon? | Sprint 1 kickoff | Casper team contact |
| OQ-02 | Which Odra version (exact semver) does the buildathon scaffolding target? | Sprint 1 kickoff | Casper dev docs |
| OQ-03 | Does cspr.live testnet explorer index CEP-18 events for the vault share token? | Sprint 2 | Self-verify on testnet |
| OQ-04 | Is there a funded testnet faucet reliably available, and what is the per-day CSPR limit? | Sprint 1 | Casper faucet docs |
| OQ-05 | Does the Casper Buildathon require the submission to use the CSPR.trade MCP server, or is a custom MCP server sufficient? | Pre-submission | Buildathon rules |

---

## 8. Prioritized Scope

### 8.1 MVP — Must-Have for Demo Eligibility

These items are required to satisfy the buildathon eligibility gates and all 12 success criteria.

1. Vault contract (Odra): deposit, withdraw, reallocate, pause — deployed on testnet
2. Registry contract (Odra): register agent, update reputation, get reputation — deployed on testnet
3. Agent loop (TypeScript): perceive, decide, act, log — running against testnet
4. x402 oracle server (TypeScript): MockFacilitator, seeded RWA data, payment log
5. MCP server (TypeScript): 6 tools, 4 resources — connectable by MCP inspector
6. Dashboard UI (Next.js): vault panel, reputation panel, decision feed, oracle panel, deposit/withdraw
7. CSPR.click wallet connect and deposit signing
8. `logs/decisions.jsonl` and `logs/payments.jsonl` with verifiable entries
9. README with setup, architecture diagram, env var reference, testnet deploy steps
10. Demo video script and recording

### 8.2 Stretch — Improves Judging Score if MVP is Complete

1. Live x402 Casper facilitator integration (swap `MockFacilitator`)
2. Agent trigger via MCP tool from external LLM client (not just loop)
3. Vault share (AEGIS) price chart over time in the dashboard
4. Multi-asset risk-weighting in the LLM prompt (beyond raw APY)
5. Reputation leaderboard showing multiple registered agents
6. GitHub Actions CI running contract unit tests and agent unit tests on every push
7. Architecture diagram as interactive Mermaid diagram in README
8. Long-term launch plan section in README (mainnet path, real RWA oracle integration roadmap)

---

*This document was produced by requirements intake on 2026-06-18. All assumptions are recorded in `ASSUMPTIONS.md`. This brief is the input for the architecture and system design phase.*

# Aegis — Assumptions Register

Living log of decisions made under autonomy. Each entry: what was assumed, why, and how to override.

---

## A-000 — Project concept (carried forward from prior session)

**Decision:** Build **Aegis** — an autonomous RWA yield-routing agent on Casper Network with a verifiable on-chain identity and reputation. Fuses buildathon directions #1 (Autonomous Yield-Routing Agents via MCP) and #2 (RWA Oracle Agents with Verifiable On-Chain Identity).

**Why:** Maps cleanly onto all four Casper AI Toolkit pillars (Odra, MCP, x402, CSPR.cloud/click). Produces a clear transaction-producing on-chain component. Covers every final-round judging criterion.

**Override:** If a different concept is preferred, re-run requirements intake with the new concept.

---

## A-001 — Casper 2.0 / Condor transaction model

**Assumed:** All on-chain interactions use the Casper 2.0 Transaction model (not the deprecated Deploy model). Odra 2.x compiles contracts to Wasm targeting the Casper 2.0 runtime.

**Why:** Casper 2.0 (Condor) is feature-complete. The Deploy model is deprecated. The Transaction model is the current standard per Casper documentation.

**Override:** If a specific SDK path on testnet still requires Deploys, use `put_deploy` as a fallback and mark it with a TODO to migrate.

---

## A-002 — CSPR mote denomination

**Assumed:** All on-chain amounts are in motes. 1 CSPR = 1,000,000,000 motes. The vault contract stores and emits amounts in motes. The dashboard converts to CSPR for display only.

**Why:** Canonical on-chain denomination for Casper Network. Not a design choice — a protocol fact.

**Override:** Not overridable.

---

## A-003 — Odra version

**Assumed:** Odra 2.x (latest stable, June 2026) is used. Contracts compile to Wasm and target Casper testnet. CEP-18 module is used for vault share tokens. All CI runs on the Odra in-memory backend, so an incorrect pin is caught at M1 build time, not at testnet.

**RESOLVED at M1 (2026-06-18, OQ-02):** The placeholder `2.1.0` was a guess. The actual current stable Odra 2.x on crates.io is **`2.8.1`** — that is the version that resolves and compiles, and it is the pin now in `contracts/aegis-contracts/Cargo.toml` (`odra`, `odra-modules`, `odra-test`, `odra-build` all at `2.8.1`). The vault uses `odra_modules::cep18_token::Cep18` as a `SubModule` for the `AEGIS` share token (`raw_mint`/`raw_burn`/`balance_of`/`total_supply`). The full unit suite (26 tests) passes on the OdraVM in-memory backend, and both contracts compile to `wasm32-unknown-unknown`.

**Toolchain note:** `odra-macros 2.8.1` uses the unstable `box_patterns` feature, so the contracts require a **nightly** Rust toolchain. `contracts/rust-toolchain.toml` pins `nightly-2026-01-01` (ships the `wasm32-unknown-unknown` target and the LLVM-20 bulk-memory codegen Odra's wasm strip step relies on). `cargo odra build` additionally needs `wasm-opt` (binaryen) and `wasm-strip` (WABT) on PATH for the optimize/strip step.

**Address vs AccountHash:** Odra's schema layer supports `Address` but not a bare `AccountHash` in entry-point args / return types / events / storage keys. The public interface therefore uses Odra's `Address` (`Address::Account(AccountHash)` carries exactly the account hash) wherever the requirements said `AccountHash`. This is the idiomatic Odra equivalent and what casper-js-sdk / CSPR.cloud clients pass; the entry-point signatures are otherwise unchanged.

**Why:** Odra 2.x is the current stable release with testnet deploy tooling. It includes CEP-18, access control, and re-entrancy guard modules out of the box.

**Override:** Pin the `odra` crate version explicitly in `Cargo.toml`. Match any version pinned by the buildathon environment.

---

## A-004 — x402 Casper settlement status

**Assumed:** The Casper AI Toolkit launched x402 on mainnet on June 4 2026. However, testnet facilitator endpoint availability during the build window is unconfirmed. The implementation uses a `PaymentFacilitator` trait with two concrete implementations: `MockFacilitator` (returns synthetic receipt hashes to a local log) and `CasperFacilitator` (calls the live endpoint). The demo runs with `MockFacilitator` unless the live endpoint is confirmed. The live `X402_FACILITATOR_URL` value is an OQ-01 resolution gate due **before M2**; because `MockFacilitator` is the default, neither OQ-01 nor the live endpoint blocks the build.

**Why:** Prevents the demo from being blocked by external infrastructure readiness while preserving a clean swap path.

**Override:** Set `X402_FACILITATOR=live` and `X402_FACILITATOR_URL=<endpoint>` in the environment to activate `CasperFacilitator`. No contract changes required.

---

## A-005 — RWA oracle data is simulated

**Assumed:** The x402-gated oracle API returns seeded simulated RWA yield data across five asset slots: tokenized T-bills (~5.1% APY), tokenized private credit (~8.5% APY), tokenized commodities (~3.2% APY), stable yield (~4.7% APY), and CSPR liquid staking (~6.3% APY). Data refreshes every 60 seconds in demo mode.

**Why:** No live Casper-native RWA oracle exists at buildathon time. Simulated data lets the full agent loop run end-to-end.

**Override:** Implement `RwaOracleClient` against a real feed (e.g., rwa.xyz, Centrifuge, Ondo API) without changing the agent loop or MCP tool signatures.

---

## A-006 — LLM provider

**Assumed (CONFIRMED this session):** The agent uses a **provider-agnostic `LlmClient`** interface.
Default provider is Anthropic Claude (`claude-sonnet`/latest) via the Messages API with structured
JSON output (`ANTHROPIC_API_KEY`); an OpenAI implementation is swappable via `LLM_PROVIDER=openai` +
`OPENAI_API_KEY`. All callers depend only on the `LlmClient` interface, never a concrete SDK.

**Why:** User confirmed provider-agnostic. Avoids lock-in and lets the demo run on whichever key is available.

**Override:** Set `LLM_PROVIDER` (`anthropic` | `openai`) and the matching key.

---

## A-007 — Wallet and signing strategy

**Assumed:**
- Dashboard UI: users sign transactions with the Casper Wallet browser extension via the CSPR.click SDK. The installed package is `@make-software/csprclick-core-client` (the React UI meta-package conflicts with React 19 — see A-WALLET-01).
- Autonomous agent: signs with a testnet-only keypair loaded from `AGENT_PRIVATE_KEY_HEX` environment variable. No mainnet keys. No real funds.
- Both paths use the Casper 2.0 `casper-js-sdk` for transaction construction.
- The `casper-js-sdk` **direct-sign path is dev/CI only** (headless signing for automated tests and demos without a browser). It does **not** satisfy SC-09, which requires a real manual Casper Wallet extension run. See A-007a.

**Why:** CSPR.click unifies all Casper wallets through a single SDK. Agent-side signing requires non-interactive key access.

**Override:** For a fully headless CI demo, disable the browser signing path. For mainnet (post-buildathon), replace `AGENT_PRIVATE_KEY_HEX` with a hardware wallet or MPC signer.

---

## A-007a — Direct-sign fallback scope (resolves RISK-05 vs SC-09)

**Assumed:** The `casper-js-sdk` direct-sign path used in RISK-05 mitigation is strictly a **dev/CI affordance** to keep the deposit flow exercisable headlessly when the Casper Wallet extension is unavailable or broken on a given testnet build. SC-09 is satisfied **only** by a real, manual run with the Casper Wallet browser extension connected via CSPR.click presenting the deposit tx for signing. The fallback is never presented as evidence for SC-09.

**Why:** Conflating the two would let an automated direct-sign run falsely "pass" SC-09, which specifically tests the human-in-the-loop wallet UX.

**Override:** None — this scoping is intentional. The manual wallet run remains a required demo step.

---

## A-WALLET-01 — CSPR.click package resolution (SC-09 connector)

**Assumed / actual outcome:** The real CSPR.click connector (`packages/dashboard/src/components/wallet/csprClickConnector.ts`) is implemented and is the **browser default**, wired in `WalletProvider.tsx`; the mock connector is an explicit env-selected (`NEXT_PUBLIC_USE_MOCK_WALLET=true`) / SSR fallback only.

What actually installed here:
- `@make-software/csprclick-core-client@1.11.0` installs and typechecks cleanly, and is a real dashboard dependency (`packages/dashboard/package.json`). It provides the TypeScript surface for the CSPR.click runtime API (`connect` / `getActivePublicKey` / `send`) and the `Window.csprclick` global augmentation. The connector is typed and built against this real package (type-only import; the package ships declarations + a runtime that the host loads).
- The higher-level React UI meta-package `@make-software/csprclick-ui` (which exposes `<CsprClickProvider>` and would normally bootstrap the hosted runtime script) hard-pins **React 18.3.1** and conflicts with this dashboard's **React 19**. It was therefore **not** installed.

**Consequence (the single gated step):** Because the React provider is not installed, the `window.csprclick` runtime must be bootstrapped by loading the hosted CSPR.click runtime script + calling its `init` (an app-key / client-id from the CSPR.click console). The connector logic (connect / sign / broadcast) is real and correct against the real runtime API; only this one bootstrap call is gated, exactly like the agent's funded-key gating. Without the bootstrap, `getRuntime()` throws a clear "runtime not initialized" error rather than faking a signature.

**Why:** Keeps SC-09 satisfiable by a real Casper Wallet run while not forcing a React-version downgrade for the whole dashboard. Swapping to the full `<CsprClickProvider>` bootstrap (or loading the runtime `<script>`) is an additive change in `WalletProvider.tsx` and does not touch the connector or UI.

**Override:** Pin the dashboard to React 18 and add `@make-software/csprclick-ui` + `@make-software/cspr-click` to use the provider-driven bootstrap instead of the global-driven one.

---

## A-008 — Reputation score formula (initial)

**Assumed:** Reputation delta per epoch: `+1` if the agent's predicted top-yield asset outperforms the portfolio average yield in the next epoch; `-1` otherwise. Score is stored as `u64` on-chain, clamped at zero minimum. The registry contract emits a `ReputationUpdated` event with the old score, new score, and rationale hash.

**Why:** Simple, verifiable, demonstrable within a 5-minute demo. Post-hackathon complexity can be added without changing the registry interface.

**Override:** Replace `compute_reputation_delta` in the registry contract. The `update_reputation(agent: AccountHash, delta: i64, rationale_hash: [u8; 32])` entry point signature stays stable.

---

## A-009 — Technology stack

**Assumed:**
- Smart contracts: Rust + Odra 2.x
- Agent loop + MCP server: TypeScript (Node.js 22 LTS), `@modelcontextprotocol/sdk`
- Dashboard UI: Next.js 15 (App Router) + React 19, Tailwind CSS v4
- x402 oracle server: Node.js / Express (same monorepo, `packages/oracle`)
- Package manager: pnpm workspaces
- Contract testing: Odra test backend (in-memory, no testnet)
- Agent/UI testing: Vitest (unit), Playwright (E2E)
- Explorer: cspr.live testnet

**Why:** TypeScript/Node.js has the best MCP SDK support. Next.js fits the design-quality requirements in the global coding rules. Odra is the required Rust framework.

**Override:** Swap agent backend to Python with `mcp` PyPI package if preferred. MCP server JSON-RPC shape stays identical.

---

## A-010 — Testnet deploy is a gated step

**Assumed:** Actual testnet deployment requires manual execution with a user-provided funded testnet account. CI runs contract unit tests against the Odra in-memory backend only. A `deploy:testnet` script is provided, gated behind `ALLOW_TESTNET_DEPLOY=true`.

**Why:** Safety guardrail preventing accidental mainnet or unintended testnet deploys during iterative development.

**Override:** Set `ALLOW_TESTNET_DEPLOY=true` before running the deploy script.

---

## A-011 — Agent loop cadence for demo

**Assumed:** Agent loop interval is 30 seconds during the demo (`AGENT_LOOP_INTERVAL_MS=30000`). Production default is 15 minutes (900,000 ms).

**Why:** 30-second intervals make reallocation events visible within a 3–5 minute demo video.

**Override:** Set `AGENT_LOOP_INTERVAL_MS` in the environment.

---

## A-012 — Vault asset

**Assumed:** The vault holds CSPR (native token). Vault shares are a CEP-18 token with symbol `AGEIS`. Simulated yield is injected by the agent as periodic mote top-ups to the vault contract from a funded testnet account.

**Why:** Using CSPR avoids bridging real RWA tokens to testnet. Vault mechanics (deposit, withdraw, reallocate) are architecturally identical to a multi-asset vault and demonstrate the concept fully.

**Override:** Replace the vault asset with a CEP-18 stablecoin if a testnet stablecoin is available.

---

## A-013 — Monorepo structure

**Assumed:** Project is organized as a pnpm monorepo:

```
/
├── contracts/          # Rust / Odra — vault + registry
├── packages/
│   ├── agent/          # TypeScript autonomous agent loop
│   ├── mcp-server/     # TypeScript MCP server
│   └── oracle/         # TypeScript x402-gated oracle API
├── apps/
│   └── dashboard/      # Next.js dashboard UI
└── scripts/            # Deploy + seeding scripts
```

**Override:** Flatten to a single-package layout if the team prefers; no functional impact.

---

## A-014 — No persistent database required for MVP

**Assumed:** Agent decision logs and x402 payment receipts are written to local JSON files (`logs/decisions.jsonl`, `logs/payments.jsonl`) for the MVP. On-chain state is the source of truth for vault balances and reputation scores.

**Why:** Eliminates a database dependency for hackathon speed. A production system would use PostgreSQL.

**Override:** Add `DATABASE_URL` env var and implement a Drizzle ORM adapter for persistent storage.

---

## A-015 — MCP server is custom (resolves OQ-05)

**Assumed:** We ship a **custom MCP server built on `@modelcontextprotocol/sdk`** over stdio transport. We read the buildathon rules as permitting a custom MCP server ("custom MCP server is sufficient"), so a custom server satisfies FR-M-01..05 and SC-07.

**Why:** A custom server is the only path that exposes our six Aegis-specific tools and four resources with full control over signing, logging, and reuse of the agent's clients (DRY). Depending on an external CSPR.trade MCP server would block on its availability and tool surface.

**Override / contingency:** If the buildathon mandates the CSPR.trade MCP server, we **register/wrap our six tools behind it** (our tool handlers are framework-agnostic functions; only the transport/registration layer changes). This must be **resolved before M4** so the MCP milestone targets the right host. Confirm with buildathon rules pre-submission (OQ-05 owner).

---

## A-016 — Testnet demo collapses owner and agent into one keypair (resolves SC-06 actor)

**Assumed:** For the **testnet demo only**, the single funded testnet keypair (`AGENT_PRIVATE_KEY_HEX`) is **both** the registry/vault contract owner/operator **and** the registered agent account hash. Therefore `update_reputation` is signed by that keypair, which is simultaneously the owner (satisfying NFR-S-03's owner-only access control) and the agent account hash (satisfying SC-06's "tx from the agent account hash"). The contradiction between SC-06 and owner-only access dissolves because the two actors are the same account in the demo.

**Why:** SC-06 requires the `update_reputation` transaction to originate from the agent account hash, while NFR-S-03 requires owner-only access control. A single demo keypair acting as both admin and agent satisfies both trivially and avoids funding/managing two testnet accounts within the build window.

**Trade-off (separation of duties):** A real deployment MUST split these — a distinct admin/operator key owns the contracts and submits `update_reputation`, while the agent key only holds `reallocate` rights. The on-chain interface is unchanged by the split: `update_reputation(agent: AccountHash, delta: i64, rationale_hash: [u8;32])` and `reallocate(...)` signatures stay stable; only which keypair signs which call changes via `set_agent` / owner config.

**Override:** Set a separate `OPERATOR_PRIVATE_KEY_HEX` (owner/admin) distinct from `AGENT_PRIVATE_KEY_HEX`, register the agent hash via `register_agent`, and route `update_reputation` through the operator signer.

---

## A-017 — x402 payment payload schema and signing

**Assumed:** The `X-PAYMENT-PAYLOAD` header carries a base64-encoded JSON object:
`{ scheme, network, amount_motes, asset, recipient, payer, nonce, expiry_unix, signature }`. The `signature` is an ed25519/secp256k1 signature (matching the payer key algorithm) over the **canonical digest of every field except `signature`** (keys sorted, serialized to canonical JSON, then SHA-256). The agent constructs and signs this with its keypair; `MockFacilitator.verify` recomputes the digest, checks the `signature` field is present and well-formed, checks `expiry_unix > now`, and rejects any previously seen `nonce` (in-memory seen-set). `CasperFacilitator.verify` delegates verification to the live facilitator endpoint.

**Why:** FR-O-01/02 and NFR-S-04 require a verifiable, non-replayable, expiring payment proof. A signed canonical digest with nonce + expiry gives replay and expiry protection (SC-04, NFR-S-04) without coupling the demo to live settlement.

**Override:** When the live x402 spec pins exact field names/encoding, align the schema; `PaymentFacilitator.verify(payload, now)` signature stays stable.

---

## A-018 — Reputation score is demo-scale; dashboard gauge ranged accordingly

**Assumed:** With `±1` delta per epoch (A-008) over ~10 demo calls, the on-chain score stays in single digits. To avoid a near-empty gauge, the registry seeds an initial score (`REPUTATION_SEED_SCORE`, default 50) at `register_agent`, and the dashboard reputation gauge uses a demo-appropriate range (max 100) rather than an arbitrary large ceiling.

**Why:** A raw `u64` score climbing by 1 per epoch renders as visually flat against a large max, undermining SC-08/FR-D-02 readability.

**Override:** Set `REPUTATION_SEED_SCORE=0` for a strict from-zero demo, and/or adjust the gauge max in the dashboard reputation panel config.

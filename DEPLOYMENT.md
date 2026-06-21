# Aegis — Deployment Guide

**Scope:** Casper Testnet buildathon MVP. No mainnet, no real funds.
**Last updated:** 2026-06-18

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [One-Command Demo (Mocks Only)](#2-one-command-demo-mocks-only)
3. [Build: TypeScript Services](#3-build-typescript-services)
4. [Build: Smart Contracts](#4-build-smart-contracts)
5. [GATED: Testnet Deploy](#5-gated-testnet-deploy)
6. [Start Services Individually](#6-start-services-individually)
7. [Demo Seed and Recording Sequence](#7-demo-seed-and-recording-sequence)
8. [Environment Variable Reference](#8-environment-variable-reference)
9. [Health Checks and Smoke Tests](#9-health-checks-and-smoke-tests)
10. [Rollback and Teardown](#10-rollback-and-teardown)
11. [Production-Hardening Checklist](#11-production-hardening-checklist)

---

## 1. Prerequisites

### Runtime (required for all paths including the mock demo)

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 LTS | https://nodejs.org or `nvm install 22` |
| pnpm | 9.x | `npm install -g pnpm@9` |
| Docker (optional) | 24+ | https://docs.docker.com/get-docker/ |

### Contract toolchain (required only to rebuild contracts or run `deploy:testnet`)

| Tool | Notes |
|---|---|
| Rust nightly-2026-01-01 | Pinned in `contracts/rust-toolchain.toml`. Install via `rustup` — see below. |
| `wasm32-unknown-unknown` target | Added by `rust-toolchain.toml` automatically |
| cargo-odra | `cargo install cargo-odra` |
| wasm-opt (binaryen) | `brew install binaryen` (macOS) or `apt install binaryen` |
| wasm-strip (WABT) | `brew install wabt` (macOS) or `apt install wabt` |

Install Rust nightly toolchain:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup toolchain install nightly-2026-01-01
rustup target add wasm32-unknown-unknown --toolchain nightly-2026-01-01
```

`cargo odra build` reads `contracts/rust-toolchain.toml` and uses the pinned nightly automatically.

### Testnet credentials (required only for `deploy:testnet`)

You must supply both of these yourself — they are never committed:

- **Funded Casper testnet account.** Get free testnet CSPR from the faucet at https://testnet.cspr.live/tools/faucet. Each Odra contract install defaults to **600 CSPR** payment (`INSTALL_PAYMENT_MOTES`). Two installs plus seeding calls require **at least ~1,215 CSPR** before running `pnpm deploy:testnet`. If you see `Out of gas error`, try raising `INSTALL_PAYMENT_MOTES` in small steps (e.g. 700–800 CSPR); amounts above ~1,000 CSPR may be rejected as invalid on some testnet lanes.
- **CSPR.cloud API key.** Register at https://cspr.cloud, create an API key for the testnet environment, and set it as `CSPR_CLOUD_API_KEY`.

---

## 2. One-Command Demo (Mocks Only)

**No keys, no funds, no testnet needed.** The full loop runs with `MockFacilitator` for x402 and `MockLlmClient` when no LLM key is present, writing to `logs/decisions.jsonl` and `logs/payments.jsonl`.

### Docker Compose (recommended)

```bash
# Copy the example env and leave all values as placeholders
cp .env.docker .env.docker.local

# Bring up oracle + agent + mcp-server + dashboard
docker compose up

# Dashboard is at http://localhost:3000
# Oracle health: http://localhost:4021/api/health
```

All four services start, the agent loop fires every 30 seconds, and reallocation events appear in the dashboard decision feed within one polling cycle.

To also seed the oracle with deliberate yield shifts before starting (RISK-06 mitigation):
```bash
docker compose up oracle
node scripts/demo.mjs
docker compose up agent mcp-server dashboard
```

### Without Docker

```bash
# Install dependencies
pnpm install

# Build all TypeScript packages
pnpm build

# Copy env and leave defaults (all mocks)
cp .env.example .env
# Edit .env if you want a real LLM key or testnet credentials

# In separate terminals:
pnpm oracle          # http://localhost:4021
pnpm agent           # connects to oracle on 4021
pnpm mcp             # stdio MCP server
pnpm dev             # dashboard on http://localhost:3000
```

---

## 3. Build: TypeScript Services

```bash
# From repo root
pnpm install
pnpm build          # builds shared → oracle → agent → mcp-server → dashboard
```

Build order is enforced by pnpm workspace dependencies (`@aegis/shared` is built first because all other packages depend on it).

Run tests:
```bash
pnpm test           # all 178 tests across all packages
```

---

## 4. Build: Smart Contracts

The compiled WASM artifacts are already present in `contracts/target/` if you have run `cargo odra build` previously. The deploy script accepts both the Odra output path (`contracts/wasm/`) and the raw cargo target path as a fallback.

To rebuild from source:
```bash
cd contracts
cargo test          # runs all 29 Odra in-memory unit tests (SC-10)
cargo odra build    # produces contracts/wasm/Vault.wasm + Registry.wasm
```

`cargo odra build` requires `wasm-opt` and `wasm-strip` on PATH. It uses the pinned nightly-2026-01-01 toolchain from `rust-toolchain.toml`.

The WASM artifacts are **not committed** to the repo. They must be built locally before running `deploy:testnet`.

---

## 5. GATED: Testnet Deploy

**This section requires real CSPR testnet funds and a funded account key. No mock substitutes.**

### Step 1 — Set required environment variables

```bash
export ALLOW_TESTNET_DEPLOY=true
export AGENT_PRIVATE_KEY_HEX=<your-funded-testnet-ed25519-secret-key-hex>
export AGENT_ACCOUNT_HASH=<your-account-hash-corresponding-to-the-key>
export CSPR_CLOUD_API_KEY=<your-cspr-cloud-api-key>

# Optional overrides (defaults are shown)
export CASPER_NETWORK=casper-test
export CASPER_NODE_RPC_URL=https://node.testnet.cspr.cloud/rpc
export REPUTATION_SEED_SCORE=50
```

The script hard-fails if `ALLOW_TESTNET_DEPLOY` is not `true` or if the key is a placeholder.

### Step 2 — Build contracts (if not already built)

```bash
cd contracts && cargo odra build && cd ..
```

### Step 3 — Run the deploy

```bash
pnpm deploy:testnet
```

The script performs, in order:
1. Installs `Vault.wasm` to testnet via `SessionBuilder.installOrUpgrade` (default 600 CSPR payment; override with `INSTALL_PAYMENT_MOTES`).
2. Waits up to 3 minutes for on-chain execution.
3. Installs `Registry.wasm` the same way.
4. Reads both `vault_package_hash` and `registry_package_hash` from the deployer's named keys.
5. Writes all hashes and tx hashes to `contracts/deployments/testnet.json`.
6. Calls `register_agent` on the registry contract.
7. Calls `update_reputation` with the seed score (A-018) and a deterministic rationale hash.

### Step 4 — Export contract hashes

After the deploy completes, `contracts/deployments/testnet.json` will contain:

```json
{
  "vault_contract_hash": "hash-<hex>",
  "registry_contract_hash": "hash-<hex>",
  "vault_deploy_hash": "<hex>",
  "registry_deploy_hash": "<hex>",
  "network": "casper-test",
  "deployed_at": "2026-06-18T..."
}
```

Copy the contract hashes into your `.env`:
```bash
export VAULT_CONTRACT_HASH=$(node -e "import('./contracts/deployments/testnet.json', {assert:{type:'json'}}).then(m=>console.log(m.default.vault_contract_hash))")
export REGISTRY_CONTRACT_HASH=$(node -e "import('./contracts/deployments/testnet.json', {assert:{type:'json'}}).then(m=>console.log(m.default.registry_contract_hash))")
```

Or set them manually in `.env`:
```
VAULT_CONTRACT_HASH=hash-<value from testnet.json>
REGISTRY_CONTRACT_HASH=hash-<value from testnet.json>
```

### Step 5 — Verify on cspr.live

Each deploy hash from `testnet.json` is queryable at:
```
https://testnet.cspr.live/deploy/<vault_deploy_hash>
```

Verify:
- Execution result shows `Success`
- Named keys show `vault_package_hash` and `registry_package_hash`
- The `Deposited` / `Reallocated` / `ReputationUpdated` event schemas are visible in the execution result of the seeding call

---

## 6. Start Services Individually

After building (`pnpm build`) and setting env vars:

### Oracle (x402-gated RWA data — port 4021)
```bash
pnpm oracle
# or
pnpm --filter @aegis/oracle start
```

Health check: `curl http://localhost:4021/api/health`
Expected: `{"status":"ok","version":"0.1.0","uptime_ms":<n>}`

### Agent loop
```bash
pnpm agent
# or
pnpm --filter @aegis/agent start
```

Requires `AGENT_ACCOUNT_HASH` at minimum. Without `AGENT_PRIVATE_KEY_HEX`, runs in mock-sign mode (log shows a warning). Without an LLM key, uses `MockLlmClient`.

Logs structured JSON to stdout. Decision log: `logs/decisions.jsonl`. Payment log: `logs/payments.jsonl`.

### MCP server (stdio)
```bash
pnpm mcp
# or
pnpm --filter @aegis/mcp-server start
```

Speaks MCP 2025-11-25 over stdio. Test with MCP Inspector:
```bash
npx @modelcontextprotocol/inspector node packages/mcp-server/dist/server.js
```

### Dashboard (Next.js — port 3000)
```bash
pnpm dev             # development mode with hot reload
# or, for production:
pnpm --filter @aegis/dashboard build
pnpm --filter @aegis/dashboard start
```

Open http://localhost:3000.

---

## 7. Demo Seed and Recording Sequence

### Seed the oracle with deliberate yield shifts

Run before starting the agent to guarantee reallocation fires within the first two loop iterations (RISK-06 mitigation):

```bash
node scripts/demo.mjs
```

The demo script:
1. Sets `REALLOCATION_DRIFT_BPS=50` and `AGENT_LOOP_INTERVAL_MS=30000` for demo sensitivity.
2. Calls the oracle 3 times and logs receipts to `logs/payments.jsonl` so the oracle panel has pre-populated data.
3. Writes 3 synthetic decision log entries to `logs/decisions.jsonl` so the decision feed is non-empty on first dashboard load (SC-05 pre-warm).
4. Prints the expected yield deltas that will trigger reallocation on the first live loop iteration.

After seeding, start services in order: oracle, then agent, then dashboard.

### Demo recording sequence (covers SC-02 through SC-08)

Use this sequence for the demo video. Each step maps to a success criterion.

**Step 1 — Wallet connect (SC-09)**
1. Open http://localhost:3000 in a browser with Casper Wallet extension installed on testnet.
2. Click "Connect Wallet" in the header.
3. The CSPR.click connector presents the extension dialog.
4. Approve the connection. The header shows your truncated account hash and CSPR balance.

Note: The CSPR.click runtime bootstrap requires the app-key from the CSPR.click console. See `ASSUMPTIONS.md` A-WALLET-01 for the exact bootstrap step. Without it, the connector throws "runtime not initialized". Set `NEXT_PUBLIC_USE_MOCK_WALLET=true` to use the mock connector for headless demos.

**Step 2 — Vault deposit (SC-02)**
1. Click "Deposit" in the vault overview panel.
2. Enter an amount (e.g. 10 CSPR).
3. The DepositWithdrawModal constructs the `deposit` transaction and sends it to the wallet extension for signing.
4. Approve in the wallet extension.
5. The dashboard displays the transaction hash as a link to `https://testnet.cspr.live/deploy/<hash>`.
6. After 1-2 polling cycles (15s each), the vault balance updates.

**Step 3 — Agent run with x402 oracle call (SC-04)**
1. Click "Trigger Agent Run" in the dashboard header.
2. The dashboard `POST /api/trigger` endpoint fires the agent's immediate loop.
3. The agent calls the oracle: the oracle returns HTTP 402, the agent constructs an x402 payment payload and retries, the oracle verifies and returns yield data.
4. The oracle panel updates with the most recent asset APYs and payment receipt hash.
5. `logs/payments.jsonl` gains a new entry (SC-04).

**Step 4 — Reallocation (SC-03)**
The agent's LLM receives the oracle yield data, reasons over the allocation, and if the recommended allocation differs from current by more than `REALLOCATION_DRIFT_BPS` (set to 50 in demo mode):
1. The agent constructs and signs a `reallocate` transaction.
2. The transaction hash appears in `logs/decisions.jsonl` and the decision feed panel.
3. In the testnet deploy path, the transaction is visible at `https://testnet.cspr.live/deploy/<hash>` with a `Reallocated` event.
4. The allocation bar chart updates within the next polling cycle (SC-08).

**Step 5 — LLM rationale audit (SC-05)**
Show the decision feed panel: each entry displays timestamp, LLM confidence score, rationale snippet, and transaction hash. Open `logs/decisions.jsonl` in a terminal to show the full structured log.

**Step 6 — Reputation update (SC-06)**
After `REPUTATION_UPDATE_EPOCHS` loop iterations (default 3, approximately 90 seconds at 30s interval):
1. The agent computes the reputation delta based on prediction accuracy.
2. Calls `update_reputation` on the registry contract.
3. The reputation panel updates score, total decisions, and accuracy percentage.
4. In the testnet path, the tx is on-chain with a `ReputationUpdated` event.

**Step 7 — MCP inspector (SC-07)**
In a separate terminal:
```bash
npx @modelcontextprotocol/inspector node packages/mcp-server/dist/server.js
```
Invoke `get_vault_state`, `get_agent_reputation`, and `fetch_rwa_oracle_data` from the inspector. The MCP server log shows each invocation with timestamp.

---

## 8. Environment Variable Reference

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CASPER_NETWORK` | No | `casper-test` | Network identifier passed to SDK |
| `CASPER_NODE_RPC_URL` | No | `https://node.testnet.cspr.cloud/rpc` | CSPR.cloud node URL |
| `CSPR_CLOUD_API_URL` | No | `https://api.testnet.cspr.cloud` | CSPR.cloud REST API base |
| `CSPR_CLOUD_API_KEY` | No* | — | Required for cspr.cloud-hosted nodes; omit for public nodes |
| `VAULT_CONTRACT_HASH` | No* | — | Written by `deploy:testnet`. Required for on-chain reads. |
| `REGISTRY_CONTRACT_HASH` | No* | — | Written by `deploy:testnet`. Required for on-chain reads. |
| `AGENT_PRIVATE_KEY_HEX` | No* | — | Ed25519 testnet secret key hex. Without this, agent runs mock-sign mode. |
| `AGENT_ACCOUNT_HASH` | Yes (agent) | — | Account hash matching the private key. Required to start the agent. |
| `LLM_PROVIDER` | No | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | No* | — | Required for real LLM decisions. Without it, `MockLlmClient` is used. |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-4-6` | Anthropic model ID |
| `OPENAI_API_KEY` | No* | — | Required when `LLM_PROVIDER=openai` |
| `OPENAI_MODEL` | No | `gpt-4o` | OpenAI model ID |
| `ORACLE_PORT` | No | `4021` | Oracle Express server port |
| `ORACLE_URL` | No | `http://localhost:4021` | URL the agent uses to reach the oracle |
| `ORACLE_PRICE_MOTES` | No | `1000000` | 0.001 CSPR per oracle call |
| `X402_FACILITATOR` | No | `mock` | `mock` (no crypto verification) or `live` (CasperFacilitator) |
| `X402_FACILITATOR_URL` | No* | — | Required when `X402_FACILITATOR=live` |
| `AGENT_LOOP_INTERVAL_MS` | No | `30000` | 30s for demo; 900000 for production |
| `REALLOCATION_DRIFT_BPS` | No | `200` | Set to `50` for demo to guarantee reallocation fires |
| `MIN_CONFIDENCE_THRESHOLD` | No | `60` | LLM confidence below this skips reallocation |
| `MIN_VAULT_BALANCE_MOTES` | No | `100000000000` | 100 CSPR minimum; below this skips reallocation |
| `MAX_ASSET_WEIGHT_BPS` | No | `6000` | Per-asset concentration cap (60%) |
| `TX_CONFIRM_TIMEOUT_MS` | No | `60000` | Wait up to 60s for tx confirmation |
| `REPUTATION_UPDATE_EPOCHS` | No | `3` | Loop iterations between reputation updates |
| `REPUTATION_SEED_SCORE` | No | `50` | Initial on-chain score set during `deploy:testnet` |
| `ALLOW_TESTNET_DEPLOY` | No | `false` | Must be `true` to run `deploy:testnet` |
| `NEXT_PUBLIC_ORACLE_URL` | No | `http://localhost:4021` | Dashboard CSP connect-src + oracle API route |
| `NEXT_PUBLIC_CSPR_CLOUD_API_URL` | No | `https://api.testnet.cspr.cloud` | Dashboard CSP connect-src |
| `NEXT_PUBLIC_VAULT_CONTRACT_HASH` | No* | — | Dashboard deposit/withdraw modal |
| `NEXT_PUBLIC_CASPER_NETWORK` | No | `casper-test` | Dashboard transaction construction |
| `NEXT_PUBLIC_CASPER_EXPLORER_TX_BASE` | No | `https://testnet.cspr.live/deploy` | Explorer link base |
| `NEXT_PUBLIC_USE_MOCK_WALLET` | No | `false` | Set to `true` for headless demo without Casper Wallet extension |

Variables marked `No*` are optional but required for specific features. The system starts and the demo runs without them using mocks.

---

## 9. Health Checks and Smoke Tests

### Oracle

```bash
curl http://localhost:4021/api/health
# Expected: {"status":"ok","version":"0.1.0","uptime_ms":<n>}
```

### Dashboard

```bash
curl http://localhost:3000/api/health
# Expected: HTTP 200 with basic status, or check http://localhost:3000 in browser
```

### Agent (verify logs are written)

```bash
tail -f logs/decisions.jsonl
# Should show JSON log entries every 30 seconds in demo mode
```

### MCP server (verify tool invocations)

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node packages/mcp-server/dist/server.js
# Expected: list of 6 tools including get_vault_state, fetch_rwa_oracle_data, etc.
```

### Contract unit tests

```bash
cd contracts && cargo test
# Expected: 29 tests pass, 0 failures
```

### Full TypeScript test suite

```bash
pnpm test
# Expected: 178 tests pass across all packages
```

---

## 10. Rollback and Teardown

### Docker Compose teardown

```bash
docker compose down
docker compose down -v   # also removes named volumes
```

### Log cleanup

```bash
rm -f logs/decisions.jsonl logs/payments.jsonl
touch logs/decisions.jsonl logs/payments.jsonl
```

### Contract re-deploy (testnet only)

There is no on-chain rollback for the vault or registry contracts once deployed. To reset:
1. Re-run `deploy:testnet` with `ALLOW_TESTNET_DEPLOY=true`. The script uses `odra_cfg_allow_key_override=true` and `odra_cfg_is_upgradable=true`, so it overwrites the existing package hash under the same named key.
2. Update `VAULT_CONTRACT_HASH` and `REGISTRY_CONTRACT_HASH` in `.env` to the new hashes from `testnet.json`.
3. Vault state (balances, shares, allocations) is reset with the new contract. Reputation in the registry is also reset.

Any testnet CSPR used for installs is consumed (gas fees). Request more from the faucet if needed.

### Kill all services

```bash
pkill -f "node dist/server.js"   # oracle + mcp-server
pkill -f "node dist/run.js"      # agent
pkill -f "next"                  # dashboard dev server
```

---

## 11. Production-Hardening Checklist

The following are explicitly scoped to mainnet readiness, not buildathon demo. Items marked with a SECURITY.md reference are tracked findings.

### Completed (buildathon demo level)

- [x] No secrets committed; only `.env.example` placeholders in VCS
- [x] Agent private key never logged or bundled into client
- [x] Nonce-based CSP for scripts; no `unsafe-inline` on `script-src`
- [x] Vault pause mechanism deployed and tested
- [x] Agent loop survives individual iteration failures (NFR-R-01)
- [x] All LLM output Zod-validated before on-chain submission (NFR-S-06)
- [x] Replay protection: x402 nonce seen-set + expiry check (NFR-S-04)
- [x] `reallocate` access-controlled to registered agent account hash (NFR-S-02)
- [x] `update_reputation` access-controlled to contract owner (NFR-S-03)

### Required before any "live" x402 claim (SEC-03)

- [ ] Implement real ed25519/secp256k1 signing in `run.ts` — replace `mockSign` constant with actual key signing
- [ ] Implement cryptographic verification in `CasperFacilitator.verify` — check signature over canonical payload digest
- [ ] Verify `recipient` and `amountMotes` match server expectations in facilitator

### Required before mainnet (HIGH)

- [ ] **SEC-01** — Capture deposits into a named contract purse; assert purse balance on withdraw
- [ ] **SEC-02** — Mitigate first-depositor share inflation (dead shares, virtual offset, or minimum first deposit)
- [ ] **SEC-06** — Split owner/operator key from agent key; reputation scored by independent operator, not self-attested agent

### Should fix for any extended use (MEDIUM)

- [ ] **SEC-05** — Strip/escape oracle asset `name` field before including in LLM prompt; treat oracle text as untrusted
- [ ] **SEC-07** — Authenticate `POST /api/trigger` with a shared-secret header; rate-limit to 1 trigger / 10s; bind agent trigger port to localhost
- [ ] **SEC-08** — Upgrade vitest, vite, and Next.js (postcss) to clear dev-dep CVEs: `pnpm up -r vitest vite`
- [ ] **SEC-11** — Zod-validate CSPR.cloud RPC responses; on parse failure, skip the act phase instead of returning optimistic placeholder state

### Defense-in-depth (LOW)

- [ ] **SEC-10** — Enforce per-asset bps cap and slot count on-chain in `reallocate`, mirroring the off-chain `allocationSanityCheck`
- [ ] **SEC-09** — Gate MCP `submit_reallocation` behind `dry_run` by default when server is exposed beyond a trusted local client
- [ ] Add `logs/` to `.gitignore` and untrack `logs/payments.jsonl` (SEC-04 — `git rm --cached logs/payments.jsonl && echo 'logs/' >> .gitignore`)
- [ ] **SEC-12** — Move dashboard to hashed `style-src` if Tailwind v4 supports it at build time

---

## Gated Production-Deploy Command Sequence

These are the exact commands to run for a testnet deploy. Do not run without reading Section 5.

```bash
# 1. Set the gate and credentials (user supplies these — never commit)
export ALLOW_TESTNET_DEPLOY=true
export AGENT_PRIVATE_KEY_HEX=<funded-testnet-ed25519-key-hex>
export AGENT_ACCOUNT_HASH=<account-hash>
export CSPR_CLOUD_API_KEY=<cspr-cloud-key>

# 2. Build contracts
cd contracts && cargo odra build && cd ..

# 3. Build TypeScript (from repo root)
pnpm install && pnpm build

# 4. Deploy (REAL ON-CHAIN WRITES — costs ~600 CSPR in testnet gas)
pnpm deploy:testnet

# 5. Copy hashes from contracts/deployments/testnet.json into .env
# then start services
pnpm oracle &
pnpm agent &
pnpm --filter @aegis/dashboard build && pnpm --filter @aegis/dashboard start
```

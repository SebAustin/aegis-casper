# Aegis — Security Audit & Threat Model

**Scope:** Aegis autonomous RWA yield-routing agent (Casper Testnet buildathon MVP).
**Method:** STRIDE threat model (`threat-model` skill) + on-chain review (`smart-contract-audit` skill), dependency scan, secret scan, prompt-injection / tool-scope review.
**Date:** 2026-06-18  ·  **Auditor role:** application security engineer
**Bounding context:** Testnet only, no real funds. `MockFacilitator` is the x402 default. RWA data is simulated. Agent == owner in the demo (A-016). Targets NFR-S-01..06.

> **Disclaimer:** This is a buildathon-stage review, not a formal audit (a formal audit is an explicit Non-Goal in REQUIREMENTS.md §3). Findings are scoped to "is this solid for a testnet demo, and what blocks a mainnet path."

---

## 1. System Decomposition

### Components & trust boundaries

| Boundary | Crosses | Trust direction | Sensitive data on the wire |
|---|---|---|---|
| User ↔ Dashboard (Next.js) | HTTP/HTTPS, browser | Untrusted client → server | None (read-only panels; deposit amount) |
| Dashboard ↔ Wallet (CSPR.click / Casper Wallet) | Browser extension | User-controlled signing | User signs own deposit/withdraw |
| Dashboard API routes ↔ Agent trigger / Oracle | server-side `fetch` | Server → internal services | none (trigger carries no body) |
| Agent ↔ LLM (Anthropic/OpenAI) | HTTPS + API key | Agent trusts LLM *text* | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (secret) |
| Agent ↔ Oracle (x402) | HTTP + signed payload | Mutual (payment proof) | x402 payload (signature, nonce, payer) |
| Agent ↔ Chain (casper-js-sdk → node RPC) | RPC | Agent holds signing key | `AGENT_PRIVATE_KEY_HEX` (secret) |
| MCP server ↔ MCP client (LLM) | stdio | Client invokes tools | tool args; `ctx.tx` holds the agent key |
| Oracle ↔ Facilitator | trait call (mock) / HTTPS (live) | verification | payment payload |

### Data stores
- **On-chain (source of truth):** vault balance/shares/allocation; registry reputation. Casper Testnet.
- **`logs/decisions.jsonl`, `logs/payments.jsonl`:** append-only audit logs (A-014). **Currently git-tracked** — see SEC-04.
- **Env (`.env`, `.env.local`):** secrets, gitignored. Only `.env.example` placeholders committed.

### Sensitive data
`AGENT_PRIVATE_KEY_HEX` (testnet signing key), `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, `CSPR_CLOUD_API_KEY`. None may reach the client bundle (NFR-S-01 / FR-W-04).

---

## 2. Findings Table

Severity blocks: **CRITICAL/HIGH must be addressed before this is "solid"**. Many are explicitly testnet-demo trade-offs already recorded in ASSUMPTIONS — flagged as such but still listed so the mainnet path is unambiguous.

| ID | Threat | STRIDE | Severity | Location | Impact | Remediation | Status |
|----|--------|--------|----------|----------|--------|-------------|--------|
| SEC-01 | Vault `deposit` updates the share/balance mirror from `attached_value()` but there is **no purse-capture of the attached motes**, and `withdraw` calls `transfer_tokens(&caller, motes_out)` against the contract's main purse with **no check that the purse actually holds that balance**. Share math trusts a `Var<U512>` mirror, not the real purse. | Tampering / EoP | **HIGH** | `vault.rs` `deposit` L164-211, `withdraw` L217-261 | If attached CSPR is not actually held in a contract purse, withdrawals can fail at runtime or (worse) the mirror diverges from real funds. On a real vault this is a fund-accounting bug. | Capture `attached_value()` into a named contract purse on deposit; on withdraw transfer **from that purse** and assert purse balance ≥ motes_out. Add an Odra integration test that asserts real purse balance equals the mirror. | recommended |
| SEC-02 | **First-depositor share-inflation / donation** vulnerability is not mitigated. First deposit mints 1:1 (`deposit.rs` L178-181); a 1-mote first deposit mints 1 share (test `tiny_first_deposit_one_mote_mints_one_share`). An attacker can then directly top up the vault purse (A-012 explicitly tops the vault up out-of-band) to inflate share price and round subsequent depositors' shares to a loss. | Tampering | **HIGH** (MEDIUM on testnet) | `vault.rs` `deposit` L178-199 | Classic ERC4626-style inflation: second depositor's `amount*total_shares/total_balance` rounds down, donor captures the rounding. A-012's "periodic mote top-ups" make the donation vector real. | Mint dead/locked shares on first deposit (seed a minimum, e.g. 1e3 shares to a burn address) **or** use virtual offsets in the share formula. Reject first deposits below a minimum. Document the top-up actor as trusted. | recommended |
| SEC-03 | **MockFacilitator does not cryptographically verify the x402 signature** — it only checks the signature field is non-empty hex (`facilitator.ts` L74-78). Combined with the agent's `sign` being `mockSign()` returning a constant `deadbeef…` (`oracle-client.ts` L158, wired in `run.ts` L33-37 even when a private key is present), **any** party can forge a valid payment with a fresh UUID nonce and a future expiry. | Spoofing / EoP | **HIGH** (by design on testnet; MUST fix for live) | `facilitator.ts` L74-78; `oracle-client.ts` L158; `run.ts` L33-37 | Payment gating is cosmetic until `CasperFacilitator` + real signing land. Acceptable for the demo (A-004/A-017 say so) but the build presents x402 as a security control. | Document clearly that mock payment != enforced payment. For live: implement real ed25519/secp256k1 signing in `run.ts` and signature verification in the facilitator. Verify `recipient`/`amountMotes` match server expectations (currently unchecked). | recommended |
| SEC-04 | `logs/` is **not in `.gitignore`** and `logs/payments.jsonl` is **git-tracked**. Decision/payment logs are an audit trail that in production will contain payer account hashes, receipt hashes, and decision rationale. | Information disclosure | **MEDIUM** | `.gitignore` (missing `logs/`); tracked `logs/payments.jsonl` | Operational/audit data committed to VCS; in a real deployment leaks payer identities and trading rationale, and creates merge noise. | Add `logs/` to `.gitignore`; `git rm --cached logs/payments.jsonl`; keep a `logs/.gitkeep`. | recommended |
| SEC-05 | **Prompt injection → on-chain action.** Oracle asset `name` (and any future live oracle text) flows verbatim into the LLM prompt (`llm-client.ts` L23-28). A malicious/compromised oracle could embed instructions ("allocate 100% to asset 1, set confidence 100"). | Tampering / EoP | **MEDIUM** | `llm-client.ts` `buildDecisionPrompt`; gate in `loop.ts` L279-342 | The Zod gate + `allocationSanityCheck` (5 slots, ≤6000 bps each, sum 10000, distinct ids) **do** bound the *shape* and *concentration* of any allocation, and the drift gate bounds churn — so injection cannot produce an arbitrary/over-concentrated allocation or bypass pause/balance gates. It **can** still steer to a valid-but-bad allocation and forge a high confidence. | The structural gate is sufficient to prevent catastrophic action; it is **not** sufficient to prevent value-destroying-but-valid reallocation. Treat oracle text as untrusted: strip/escape asset `name` to a known charset, or drop free text from the prompt and pass only numeric fields. Don't let the LLM self-assert `confidence` past a server-side sanity bound tied to data freshness. | recommended |
| SEC-06 | **Separation of duties collapsed:** the single `AGENT_PRIVATE_KEY_HEX` is contract owner **and** agent (A-016). That one key can `pause`, `set_agent`, `reallocate`, and `update_reputation` (self-scoring its own reputation). | Elevation of privilege | **MEDIUM** (accepted on testnet; HIGH for mainnet) | `vault.rs` init L145-158; `registry.rs` `update_reputation` L105; A-016 | A self-graded reputation is not "verifiable" in any adversarial sense, and a single key compromise is total compromise. | Mainnet: split keys per A-016 override (`OPERATOR_PRIVATE_KEY_HEX` owns contracts + scores; agent key only `reallocate`). Reputation should be scored by an independent operator/oracle, not the agent. | recommended |
| SEC-07 | **Trigger endpoint has no auth / rate limit.** `POST /api/trigger` (`trigger/route.ts`) forwards to `AGENT_TRIGGER_URL` with no authentication, CSRF token, or rate limit. The agent's `/trigger` listener (port 4022) is similarly unauthenticated. | DoS / Spoofing | **MEDIUM** | `dashboard/src/app/api/trigger/route.ts`; agent trigger server | Anyone who can reach the dashboard origin (or the agent port directly) can force unbounded agent iterations → LLM spend, oracle calls, and tx submission cadence. | Add a shared-secret header or same-origin/CSRF check on the trigger route; rate-limit (e.g. 1 trigger / 10s). Bind the agent trigger port to localhost only. | recommended |
| SEC-08 | **Dev-dependency CVEs:** `pnpm audit` → 1 critical + 1 high + 4 moderate, all in the test toolchain (`vitest` <3.2.6, `vite` <=6.4.2 fs.deny bypass + UI arbitrary file read, `esbuild`, `postcss` <8.5.10 XSS). None in production runtime path. | Info disclosure / various | **MEDIUM** | root `vitest`/`vite`; `dashboard > next > postcss` | Critical/high are dev-only (Vitest UI server, Vite dev server on Windows) — not shipped. PostCSS XSS only triggers on attacker-controlled CSS at build. | `pnpm up -r vitest@latest vite@latest`; bump Next.js to pull `postcss>=8.5.10`. Re-run `pnpm audit`. Don't expose the Vitest UI / Vite dev server on a public interface. | recommended |
| SEC-09 | **Spec/impl divergence on MCP `submit_reallocation`.** REQUIREMENTS FR-M-02 specifies the tool takes `agent_private_key_hex: string` as an input. The **implementation does NOT** — it signs with the server-held `ctx.tx` and only accepts `allocation` + `dry_run` (`tools.ts` L69-90, `mcp-server.ts` L78-104). This is the **safer** design; the requirement as written is the vulnerability. | (avoided) EoP | **LOW (note)** | `mcp-server.ts`, `tools.ts`; FR-M-02 | Had the spec been followed, every MCP client would handle a raw private key over the tool channel (logged, cached, exfiltratable). The code correctly avoids this. `sanitizeArgs` (L365-371) even strips the now-nonexistent key field defensively. | Keep the current design. Update FR-M-02 to remove `agent_private_key_hex`. Note: the MCP server exposes a *side-effectful, unauthenticated* `submit_reallocation` to any stdio client — gate behind `dry_run` default or an allow flag if the server is ever exposed beyond a trusted local client. | recommended (doc) |
| SEC-10 | **No on-chain validation of allocation `bps` upper bound or asset-id range** in `reallocate`. The contract only checks the sum == 10_000 (`vault.rs` L269-274). The 5-slot / ≤6000-bps / distinct-id caps live **only** off-chain in `allocationSanityCheck`. | Tampering | **LOW** (testnet) | `vault.rs` `reallocate` L265-289 | A direct caller (the agent key, or a future second agent) can set `[(0,10000)]` — single-asset 100% concentration — bypassing the off-chain concentration cap entirely. Sum check passes. | Enforce per-asset max bps and expected slot count on-chain in `reallocate`, mirroring the off-chain sanity bound. Defense in depth: the chain is the trust boundary, not the agent. | recommended |
| SEC-11 | **CSPR.cloud read client trusts named-key JSON unschematized** (`casper-read-client.ts` L178-214 use `value: any`, `BigInt(String(...))`). Malformed/hostile RPC data is parsed without a Zod gate; failures silently fall back to optimistic `placeholderVaultState()` (balance 1000 CSPR, not paused). | Tampering | **LOW** | `casper-read-client.ts` L84-141, 178-214 | A compromised/misbehaving CSPR.cloud could feed `paused:false` + healthy balance, defeating the pause/min-balance gates in the loop. Fallback masks outages as healthy state. | Zod-validate the parsed `VaultState`/`AgentReputation`; on parse failure, **skip the act phase** rather than substituting an optimistic placeholder. | recommended |
| SEC-12 | **`style-src 'unsafe-inline'`** retained in dashboard CSP. | EoP (XSS) | **LOW** (accepted) | `middleware.ts` L33 | Weakens CSS-injection defense; scripts are correctly nonce-gated (no `unsafe-inline` on `script-src`), so XSS risk is low. Documented trade-off for Tailwind v4. | Acceptable per NFR-S-05 (scripts only). Move to hashed styles for production if feasible. | accepted |

---

## 3. STRIDE Matrix (by data flow)

| Flow | Spoofing | Tampering | Repudiation | Info disclosure | DoS | Elevation |
|------|----------|-----------|-------------|-----------------|-----|-----------|
| User ↔ Dashboard | Wallet sig (CSPR.click) — OK | React auto-escapes; no `dangerouslySetInnerHTML` (verified) | client actions logged on-chain | no secrets in client (NEXT_PUBLIC vars are non-secret — verified) | no rate limit on trigger (SEC-07) | render-gating only; chain enforces |
| Agent ↔ LLM | API key auth | **prompt injection (SEC-05)** | decisions.jsonl audit | API key server-only (OK) | retry x1 on LLM err, loop survives (NFR-R-01 OK) | gate prevents arbitrary alloc; valid-bad possible (SEC-05) |
| Agent ↔ Oracle | **mock sig unverified (SEC-03)** | payload Zod-validated; **recipient/amount unchecked** | payments.jsonl audit | payload has payer hash | oracle 10s timeout (OK) | replay blocked (nonce set), expiry checked (NFR-S-04 OK) |
| Agent ↔ Chain | key signs (testnet) | on-chain math checked (`checked_mul/div`) | tx hash logged (SC-03) | **key never logged (verified)** | 3x backoff (NFR-R-03 OK); stub on SDK-missing | **owner==agent (SEC-06)**; weak on-chain alloc bounds (SEC-10) |
| MCP ↔ Client | no client auth | args Zod-validated | stderr invocation log (FR-M-04) | `sanitizeArgs` strips key field | per-tool try/catch, no crash (NFR-R-02 OK) | unauth side-effectful `submit_reallocation` (SEC-09) |
| Dashboard API ↔ internal | none | — | — | error msgs generic | **trigger unauth (SEC-07)** | — |

---

## 4. Smart Contract Audit

### vault.rs

- **Access control (NFR-S-02):** `reallocate` correctly gated by `assert_agent` (L267, L347-352); `pause`/`unpause`/`set_agent` gated by `assert_owner` (L340-345). Negative tests present (`reallocate_rejects_non_agent_caller`, `set_agent_rejects_non_owner`, `pause_rejects_non_owner`). **PASS.**
- **CEI / reentrancy:** `withdraw` (L217-261) follows checks → effects (`raw_burn`, decrement mirror) → single interaction (`transfer_tokens`). Order is correct CEI. **Residual risk SEC-01:** transfer is against the contract purse, not a captured deposit purse; deposit never captures `attached_value()` into a purse. This is the most important contract gap.
- **Share math / rounding:** `deposit` 1:1 first mint then `amount*total_shares/total_balance` with `checked_mul`/`checked_div` and `MathError` on overflow (L178-199). `withdraw` `shares*total_balance/total_shares` (L240-243). Rounding is floor (favours the vault on withdraw — correct direction) but **first-deposit inflation is unmitigated (SEC-02)**.
- **Arithmetic:** U512↔U256 conversions via `to_u256()/to_u512()` with `unwrap_or_revert_with(MathError)`. `reallocate` sum uses `saturating_add` (L271) — a maliciously huge bps could saturate and still != 10_000, so it reverts; safe. No unchecked overflow found.
- **Pause (FR-V-07):** `assert_not_paused` on deposit/withdraw/reallocate; `pause_blocks_deposit_withdraw_reallocate` test confirms. **PASS.**
- **Event integrity (FR-V-04/05):** `Deposited`/`Withdrawn`/`Reallocated` emitted after effects with correct fields. `Reallocated` reads `self.agent` for the actor (L283). **PASS.**
- **On-chain allocation bounds (SEC-10):** only sum==10_000 enforced; per-asset cap and slot count are off-chain only. Recommend mirroring on-chain.

### registry.rs

- **Access control (NFR-S-03):** `register_agent` and `update_reputation` both `assert_owner` (L85, L106, L157-162). Negative tests present. **PASS.**
- **Score clamp / i64 edge (FR-R-03):** `update_reputation` handles negative deltas via `(delta as i128).unsigned_abs()` then `saturating_sub` — **correctly avoids the `i64::MIN` negation panic** (L116-122), with an explicit `update_reputation_handles_i64_min_without_panic` test. Positive uses `saturating_add`. Clamp-at-zero tested. **PASS — well done.**
- **Membership:** separate `registered` mapping distinguishes "score 0, registered" from absent; double-register and unregistered paths revert. **PASS.**
- **Residual:** SEC-06 — the same demo key is owner and scored agent, so reputation is self-attested.

### Off-chain signing / keys (smart-contract-audit checklist)
- **No private keys/seeds in code or committed env** — scan clean; only placeholders in `.env.example` and a constant `deadbeef…` *mock* signature/account-hash in test/mock paths (`oracle-client.ts` L158, `mockConnector.ts` L24). **PASS.**
- **Key never logged:** `sanitizeArgs` (mcp-server) and structured logs never emit `AGENT_PRIVATE_KEY_HEX`. **PASS (NFR-S-01/FR-W-04).**
- **Network pinned to testnet:** `CASPER_NETWORK=casper-test`, deploy gated behind `ALLOW_TESTNET_DEPLOY` (A-010). **PASS.**
- **Real signing not yet wired:** `run.ts` uses `mockSign` even when a key is present, and `casper-tx-client` falls back to stub hashes — so SC-03 on-chain reallocation is **not actually exercised** by this code path as-is. Flagged for the builder (functional gap with security relevance: nonce/chainId handling is unimplemented, SEC-03).

---

## 5. Secret Handling — Result

- `.env` / `.env.local` gitignored (`.gitignore` L3-4). Only `.env.example` and `dashboard/.env.local.example` committed, placeholders only. **PASS (NFR-S-01).**
- Secret scan (sk-*, AKIA*, BEGIN keys, 40+/64-hex literals) → **no real secrets committed.** Only mock/test constants.
- `NEXT_PUBLIC_*` usage reviewed: oracle URL, CSPR.cloud URL, explorer base, vault hash — **all non-secret.** Agent key and LLM key are server-only, never `NEXT_PUBLIC_`. **PASS.**
- `deployments/testnet.json` — empty placeholders, no secrets. OK.

---

## 6. Dependency Scan — `pnpm audit`

**6 vulnerabilities: 1 critical, 1 high, 4 moderate — all in the dev/test toolchain, none in production runtime.**

| Severity | Package | Range | Path | Notes |
|---|---|---|---|---|
| critical | vitest | <3.2.6 | root `vitest@2.1.9` | Vitest UI server arbitrary file read — only if UI server exposed |
| high | vite | <=6.4.2 | via vitest | `server.fs.deny` bypass (Windows) — dev server only |
| moderate | vite/esbuild | — | via vitest | dev server request leak |
| moderate | postcss | <8.5.10 | dashboard > next > postcss@8.4.31 | CSS-stringify XSS at build only |
| moderate | launch-editor (vite) | — | via vitest | Windows NTLM disclosure |

**Action:** `pnpm up -r vitest vite` and bump Next.js to pull patched PostCSS. Not a runtime/demo blocker.

---

## 7. Remediation Applied Now

Per task scope ("don't fix code yourself; report precisely enough that the builder/web3-engineer can"), **no source or repo files were modified**. SEC-04 is the only one-line, behavior-safe fix and is ready to apply verbatim:

```
echo 'logs/' >> .gitignore
git rm --cached logs/payments.jsonl
touch logs/.gitkeep
```

All remaining findings require code changes the builder/web3-engineer should own (contract purse semantics, x402 signature verification, on-chain bounds).

---

## 8. Prioritized Remediation List

**Blockers for "solid" (HIGH):**
1. **SEC-01** — Capture deposits into a real contract purse; withdraw from it with a balance assertion. Add purse↔mirror integration test.
2. **SEC-02** — Mitigate first-depositor share inflation (dead shares / virtual offset / min first deposit).
3. **SEC-03** — Before any "live" claim, implement real x402 signing + cryptographic verification and check recipient/amount. Until then, label payment gating as non-enforcing.

**Should fix before extended use (MEDIUM):**
4. SEC-06 — Split owner/agent keys; score reputation from an independent actor (mainnet path).
5. SEC-05 — Treat oracle text as untrusted in the prompt; cap LLM-self-asserted confidence.
6. SEC-07 — Auth + rate-limit the trigger route and bind agent trigger to localhost.
7. SEC-08 — Upgrade vitest/vite/postcss; re-run audit.

**Defense-in-depth (LOW):**
8. SEC-10 — Enforce per-asset bps cap + slot count on-chain in `reallocate`.
9. SEC-11 — Zod-validate CSPR.cloud reads; skip-act (not optimistic placeholder) on parse failure.
10. SEC-09 — Update FR-M-02 spec to drop `agent_private_key_hex`; gate MCP `submit_reallocation`.
11. SEC-12 — Move to hashed `style-src` for production if feasible.

---

## 9. Residual Trust Assumptions

- **Admin/agent key (A-016):** single testnet key is owner + agent + reputation subject. Total compromise on key loss; reputation is self-attested.
- **Oracle:** simulated, single-source, no on-chain price proof (smart-contract-audit oracle class). LLM trusts oracle numbers and text.
- **x402 payment:** mock, unenforced (SEC-03).
- **Casper signing path:** stubbed (`mockSign` / stub tx hashes) — on-chain actions not exercised by current code.
- **No formal audit** (Non-Goal). This review does not cover Odra/CEP-18 submodule internals or the Casper runtime.

## 10. Hardening Checklist
- [x] `.env` gitignored; no secrets committed
- [ ] Logs untracked (`logs/` gitignored) — SEC-04, one-line fix ready in §7
- [x] Key never logged; not in client bundle
- [x] Nonce-based CSP for scripts; no `dangerouslySetInnerHTML`
- [ ] Deposits captured in contract purse; withdraw asserts purse balance (SEC-01)
- [ ] First-deposit inflation mitigated (SEC-02)
- [ ] Real x402 signing + verification for live mode (SEC-03)
- [ ] Owner/agent key separation for mainnet (SEC-06)
- [ ] Oracle text sanitized before LLM prompt (SEC-05)
- [ ] Trigger route authenticated + rate-limited (SEC-07)
- [ ] On-chain per-asset allocation bounds (SEC-10)
- [ ] Dev deps upgraded (SEC-08)

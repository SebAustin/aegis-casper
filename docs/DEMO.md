# Aegis — Demo Video Script (SC-11)

**Target runtime:** 3–5 minutes
**Format:** Screen recording with narration
**Success criterion:** SC-11 (demo video covering the full autonomous agent lifecycle)

---

## Opening Frame (~10 seconds)

Open on the system architecture diagram as a title card while the narration sets up the project. It shows, at a glance, all four Casper AI Toolkit pillars the demo will exercise (Odra · MCP · x402 · CSPR.cloud/click).

![Aegis system architecture](architecture-diagram.svg)

**Narration cue:** "Aegis is an autonomous agent that manages a tokenized real-world-asset yield vault on Casper — it pays for data with x402, reasons with an LLM, and signs its own on-chain transactions."

> Use `docs/architecture-diagram.png` (2080×1520) for the recording overlay if your editor prefers a raster asset.

---

## Prerequisites

### Local-only beats (no testnet key needed)

Beats 1, 3, 4, 5, 6 can be recorded entirely with mocks: `MockFacilitator` for x402, `MockLlmClient` or a real LLM key for decisions, and `NEXT_PUBLIC_USE_MOCK_WALLET=true` for the wallet connect panel. No CSPR, no testnet account.

### Testnet beats (funded key required)

Beats 2 (real vault deposit with tx hash) and the on-chain reallocation variant of Beat 5 (real tx hash on cspr.live) require:

- A funded Casper Testnet account (get CSPR from https://testnet.cspr.live/tools/faucet).
- Contracts already deployed: `pnpm deploy:testnet` completed, `VAULT_CONTRACT_HASH` and `REGISTRY_CONTRACT_HASH` set in `.env`.
- The Casper Wallet browser extension installed and connected to the testnet account.
- `NEXT_PUBLIC_USE_MOCK_WALLET` **not** set (or set to `false`).

For a self-contained demo without testnet access, run all beats in mock mode and note in the narration that Beat 2 and the cspr.live explorer confirmation (Beat 7) require the funded-key path.

---

## Setup (before recording)

```bash
# 1. Seed logs so panels are pre-populated on first load
node scripts/demo.mjs

# 2. Start oracle (terminal 1)
pnpm oracle

# 3. Start agent with demo sensitivity (terminal 2)
REALLOCATION_DRIFT_BPS=50 AGENT_LOOP_INTERVAL_MS=30000 pnpm agent

# 4. Start MCP server (terminal 3 — keep minimised, bring up for Beat 6)
pnpm mcp

# 5. Start dashboard (terminal 4)
pnpm dev
```

Open http://localhost:3000 in Chrome with the Casper Wallet extension installed (testnet mode) or `NEXT_PUBLIC_USE_MOCK_WALLET=true` for the mock path.

Set your recording resolution to 1920x1080. Position the browser so all five dashboard panels are visible without scrolling.

---

## Beat 1 — Wallet Connect (~30 seconds)

**What to show:** The dashboard header, the "Connect Wallet" button, the CSPR.click connector dialog.

**Steps:**

1. Open http://localhost:3000. The dashboard loads showing all five panels in their initial state.
2. Click "Connect Wallet" in the header.
3. **Testnet path:** The Casper Wallet extension popup appears. Select the testnet account. Click "Connect". The header updates to show the truncated account hash and CSPR balance.
4. **Mock path:** With `NEXT_PUBLIC_USE_MOCK_WALLET=true`, the connector resolves immediately with a placeholder account hash. Note for camera: the header shows a mock hash — state this in narration.

**Camera/screen direction:** Stay on the full dashboard. Zoom gently into the header after connect to show the account hash.

**Narration cue:** "Aegis uses CSPR.click — the standard Casper wallet connector — to sign deposit and withdraw transactions from the browser without ever touching the private key server-side."

---

## Beat 2 — Vault Deposit (~45 seconds)

**Testnet path only** (requires funded account and deployed contracts).

**Steps:**

1. Click "Deposit" in the Vault Overview panel.
2. Enter `10` in the amount field (10 CSPR).
3. Click "Confirm Deposit". The dashboard constructs a `deposit()` transaction via `casper-js-sdk` v5 and sends it to the Casper Wallet extension for signing.
4. The extension popup shows the transaction details. Click "Sign & Submit".
5. The dashboard immediately shows the transaction hash as a link: `https://testnet.cspr.live/deploy/<hash>`.
6. Wait one polling cycle (up to 15 seconds). The Vault Overview balance updates.

**Camera/screen direction:** Show the deposit modal, then the wallet extension popup, then the transaction hash link in the dashboard.

**Mock path alternative:** Skip this beat or narrate: "In a funded testnet deploy, clicking Deposit here would trigger a real on-chain `deposit()` call minting AEGIS shares proportional to the deposited amount."

**Narration cue:** "The vault contract mints AEGIS CEP-18 shares proportional to the deposit — the first depositor receives shares 1:1 with motes."

---

## Beat 3 — Agent Loop Running: Perceive → Decide (~45 seconds)

**Runs fully locally with mocks.**

Optionally picture-in-picture the loop diagram in a corner while the live logs scroll, so viewers map each log line to a loop phase.

![Aegis autonomous agent loop](agent-loop-diagram.svg)

**Steps:**

1. Click "Trigger Agent Run" in the dashboard header.
2. The dashboard `POST /api/trigger` fires; watch the terminal running the agent for the log line `[loop] iteration N — perceiving`.
3. The oracle panel updates within 2–3 seconds showing the five RWA asset APYs (T-bills ~5.1%, private credit ~8.5%, commodities ~3.2%, stable yield ~4.7%, CSPR liquid staking ~6.3%) and a payment receipt hash.
4. The decision feed panel gains a new entry: timestamp, confidence score, rationale snippet.

**Camera/screen direction:** Split view — browser left, agent terminal right. Show both updating in real time. Zoom into the oracle panel after the yield data appears.

**Narration cue:** "Every 30 seconds the agent calls our x402-gated oracle. The oracle returns HTTP 402 first — the agent constructs a signed payment payload, retries, and the oracle verifies it before releasing yield data."

---

## Beat 4 — x402 Oracle Call + Receipt (~30 seconds)

**Runs fully locally with mocks.**

**Steps:**

1. Immediately after Beat 3, open `logs/payments.jsonl` in a terminal:
   ```bash
   tail -n 1 logs/payments.jsonl | python3 -m json.tool
   ```
2. Show the payment receipt: `paymentHash`, `facilitator: "mock"`, `amountMotes`, `payer`, `expiryUnix`.
3. Scroll back to the dashboard Oracle/x402 Panel and show the same receipt hash displayed in the UI.

**Camera/screen direction:** Terminal with the pretty-printed JSON receipt on the left; browser oracle panel on the right.

**Narration cue:** "The payment receipt is appended to `logs/payments.jsonl` before every decision entry — creating a tamper-evident audit trail of every oracle access the agent paid for."

---

## Beat 5 — On-Chain Reallocation + Tx Hash (~45 seconds)

**Local path (mock):** The reallocation decision is logged and a stub tx hash is written to `decisions.jsonl`. Show the decision feed entry.

**Testnet path (real tx):** With `AGENT_PRIVATE_KEY_HEX` set and contracts deployed, the agent submits a real `reallocate()` transaction. The decision feed entry contains a real 64-character hex tx hash.

**Steps:**

1. Wait for the decision feed to show a new entry with `acted: true`. If the agent just ran (Beat 3), this may already be visible; otherwise wait for the next 30-second tick or trigger again.
2. Click the tx hash link in the decision feed panel.
   - **Testnet:** Opens `https://testnet.cspr.live/deploy/<hash>`. Stay here for Beat 7.
   - **Mock:** No live link — narrate that a real deploy would show the transaction here.
3. Show the allocation bar chart updating to the new weights.

**Camera/screen direction:** Decision feed entry centre-screen. Zoom into the tx hash. In testnet path, transition to the cspr.live tab.

**Narration cue:** "The agent constructs a `reallocate()` transaction, signs it with the agent keypair using casper-js-sdk v5, and submits it with three-attempt exponential backoff. The tx hash is written to the audit log immediately — confirmation happens asynchronously."

---

## Beat 6 — Reputation Update (~30 seconds)

**Runs fully locally with mocks** (reputation delta computed from `decisions.jsonl`, submitted as stub in mock mode).

**Steps:**

Every 3 loop iterations (`REPUTATION_UPDATE_EPOCHS=3`, approximately 90 seconds at the 30-second interval), the agent calls `update_reputation`. If the demo is running live, wait for iteration 3 or pre-warm with `node scripts/demo.mjs` (which writes 3 synthetic entries).

1. Watch the Reputation panel in the dashboard. After the reputation update tick:
   - Score changes (e.g., 50 → 51).
   - "Total Decisions" counter increments.
   - Accuracy percentage updates.
2. In the agent terminal, show the log line: `[reputation] submitting update_reputation delta=+1`.

**Camera/screen direction:** Reputation panel full-screen. Show before and after values.

**Narration cue:** "Every three epochs, the agent evaluates its own prediction accuracy — comparing the allocation it recommended against what actually yielded the most — and writes a SHA-256 hash of the relevant log entries as a verifiable rationale on-chain."

---

## Beat 7 — cspr.live Testnet Explorer Confirmation (~30 seconds)

**Testnet path only.**

**Steps:**

1. On the cspr.live tab opened in Beat 5, show:
   - Execution result: `Success`
   - Contract hash matching `VAULT_CONTRACT_HASH`
   - The `Reallocated` event in the execution results section, showing the new allocation bps values.
2. Navigate to the reputation registry tx (from the reputation update in Beat 6 if testnet). Show the `ReputationUpdated` event.

**Mock path alternative:** Show a screenshot or skip this beat with narration: "In the funded testnet deploy, each reallocation and reputation update lands here — fully verifiable on the public testnet explorer."

**Camera/screen direction:** cspr.live tab full-screen. Zoom into the `Reallocated` event fields.

**Narration cue:** "Every action Aegis takes is on-chain. Anyone can verify the agent's behaviour — reallocation weights, reputation score, rationale hash — without trusting the agent operator."

---

## Beat 8 — MCP Inspector (Optional, ~30 seconds)

**Runs fully locally.**

```bash
npx @modelcontextprotocol/inspector node packages/mcp-server/dist/server.js
```

1. In the inspector, call `get_vault_state`. Show the live vault state JSON.
2. Call `get_agent_reputation`. Show the reputation profile.
3. Call `fetch_rwa_oracle_data`. Show the 402 → pay → 200 flow completing.

**Camera/screen direction:** MCP Inspector UI in browser. Show the tool call and response.

**Narration cue:** "The same capabilities the agent uses are exposed over MCP — any LLM with MCP support, including Claude Desktop, can introspect vault state, read the decision log, and trigger reallocations directly."

---

## Closing Frame (~15 seconds)

Return to the full dashboard view showing all five panels populated with live data.

**Narration cue:** "Aegis — autonomous on-chain yield routing for Casper Network. Every perceive, decide, and act step is logged, gated, and auditable. No human in the loop required."

End on the social card (`docs/social-card.png`) holding the title, tagline, and repo URL for the final ~3 seconds.

---

## Appendix: Mock vs Testnet Beat Summary

| Beat | Description | Mock (no keys) | Testnet (funded key) |
|---|---|---|---|
| 1 | Wallet connect | Mock connector, placeholder hash | Real Casper Wallet extension |
| 2 | Vault deposit | Skip or narrate | Real `deposit()` tx, cspr.live link |
| 3 | Agent perceive→decide | MockLlmClient or real LLM key | Same |
| 4 | x402 receipt | MockFacilitator receipt | Same |
| 5 | Reallocation tx | Stub hash in log | Real `reallocate()` tx on cspr.live |
| 6 | Reputation update | Stub hash in log | Real `update_reputation()` tx |
| 7 | cspr.live confirmation | Skip or screenshot | Live explorer showing events |
| 8 | MCP Inspector | Full local | Same |

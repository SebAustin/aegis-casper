# Aegis — DoraHacks BUIDL submission

Ready-to-paste content for each form field. Casper Agentic Buildathon 2026.

---

## Project name
```
Aegis
```
(If a subtitle is allowed: **Aegis — Autonomous RWA Yield Agent on Casper**)

---

## Logo
`docs/brand/logo-480.png` — 480×480 PNG, ~39 KB (under the 2 MB limit). Upload this file.

---

## Tagline (one-liner)
```
A self-driving portfolio manager for tokenized real-world-asset yield — an autonomous AI agent that reasons, pays, and signs its own transactions on Casper.
```

---

## Vision — the problem this project solves (≤256 chars for the form)
```
Aegis is an autonomous AI agent for tokenized real-world-asset (RWA) yield on Casper. It pays for data via x402, reasons with an LLM, signs its own on-chain reallocations, and earns a verifiable on-chain reputation for every decision it makes.
```
(243 characters — fits the 256 limit.)

### Longer vision (for a description/details field if present)
```
Tokenized real-world assets (T-bills, private credit, commodities, liquid staking) now exceed $19B on-chain, but their yields shift constantly and rebalancing is manual, slow, and needs 24/7 oversight. Treasuries and individual investors either overpay for active managers or leave capital idle in a suboptimal allocation.

Aegis turns a passive wallet into an autonomous, auditable portfolio manager. Every cycle it pays an oracle for fresh RWA yield data via x402 micropayments, reasons over the risk/return trade-offs with an LLM, and — when the drift is worth it — signs and submits a reallocation transaction to an on-chain vault on Casper. Crucially, it is accountable: every decision is logged with its rationale, and the agent accrues a tamper-proof on-chain reputation score for the accuracy of its calls, so you can trust an agent by its verifiable track record rather than its promises.

Aegis is a reference implementation of the full Casper AI Toolkit — Odra smart contracts, an MCP server, x402 payments, and CSPR.cloud/CSPR.click — showing how autonomous agents can safely manage capital on-chain.
```

---

## Category
```
Crypto / web3
```
Rationale: Aegis is a DeFi/RWA dApp deployed on Casper (Odra smart contracts, on-chain vault + reputation). The separate "Is this an AI agent?" field below captures its agentic nature. (If the form allows a secondary tag, add **AI / Robotics**.)

---

## Is this BUIDL an AI agent?
```
Yes
```
Aegis is a fully autonomous agent running a perceive → decide → act loop: it perceives on-chain + oracle state, decides via an LLM (provider-agnostic — Claude/OpenAI), and acts by signing and submitting real Casper transactions — with safety gates (Zod-validated output, drift/confidence thresholds) so it never submits on malformed or stale data.

---

## GitHub
```
https://github.com/SebAustin/aegis-casper
```
Public, open-source, MIT. Includes contracts, agent, MCP server, x402 oracle, Next.js dashboard, 213 passing tests, architecture diagrams, and full docs.

---

## Project website
```
https://dashboard-zeta-three-71.vercel.app
```
Live Vercel deploy of the Aegis cockpit dashboard (public/demo mode — no secrets, mock wallet, demo-fallback data, links to the July testnet contracts on cspr.live). Verified HTTP 200; all panels + API routes render.

---

## Demo video (YouTube)
```
Upload docs/brand/aegis-demo.mp4 to YouTube, then paste the watch URL here.
```
A ready-to-upload **64s 1080p trailer** is at `docs/brand/aegis-demo.mp4` (H.264, 5.4 MB): logo → the $19B RWA problem → the perceive→decide→act loop → architecture (Odra·MCP·x402·CSPR.cloud) → proof (live on testnet, 30+ on-chain decisions, 213 tests, 0 HIGH) → repo close. It's a motion-graphics trailer, not a live-app walkthrough — for a full app walkthrough, the shot-by-shot script is in `docs/DEMO.md` (record with `AGENT_OFFLINE_DEMO=true`, no keys needed).

---

## Longer description (if the form has a description/details field)
```
Aegis is an autonomous RWA yield-routing agent on the Casper Network.

WHAT IT DOES
- An AI agent runs a continuous perceive → decide → act loop.
- PERCEIVE: reads the on-chain vault + its own reputation via CSPR.cloud, and pays an x402 micropayment to fetch tokenized-RWA yield/risk data.
- DECIDE: an LLM proposes an allocation with a confidence score and a written rationale; output is schema-validated so malformed responses can never reach the chain.
- ACT: if the allocation drift clears a threshold, the agent signs and submits a `reallocate` transaction to an Odra vault contract on Casper Testnet. Every N epochs it writes an `update_reputation` transaction scoring its own past accuracy.

WHY IT MATTERS
Autonomous capital management only works if it's trustable. Aegis makes every decision auditable (full rationale + payment receipt logged) and every agent accountable (on-chain reputation), so agents earn trust by verifiable track record.

CASPER AI TOOLKIT COVERAGE
- Odra — two Rust smart contracts (vault with CEP-18 shares + reallocate/pause; reputation registry), deployed on Casper Testnet, 29 unit tests.
- MCP — a Model Context Protocol server (6 tools, 4 resources) exposing the vault/agent to any LLM client.
- x402 — HTTP-native micropayments; the agent pays per oracle call with a verifiable payment payload.
- CSPR.cloud / CSPR.click — authenticated RPC reads and browser wallet signing.

STATUS
Contracts deployed to Casper Testnet (transaction-producing); agent has 30+ real on-chain decisions recorded. 213 automated tests, 0 HIGH security findings. Self-contained local demo mode (no keys/quota needed) via AGENT_OFFLINE_DEMO.
```

---

## Casper Testnet references (for judges / eligibility)
- Network: `casper-test`
- Vault contract: `hash-b97706ec6dc5d395a395d6d4a37c449c2421871d40e35acebb3c733ba890ac69`
- Registry contract: `hash-7c93ab751f874234e1e2048b495b8dc26e81ab5c60621bb771139e988bc6f41f`
- Explorer: view either hash on https://testnet.cspr.live

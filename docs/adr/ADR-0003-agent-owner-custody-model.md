# ADR-0003 — Agent == Owner Custody Model on Testnet (A-016)

**Status:** Accepted (testnet demo only)
**Date:** 2026-06-18
**Deciders:** Architecture team

---

## Context

The Aegis vault and registry contracts enforce role-based access control:

- `reallocate()` — callable only by the registered **agent** `Address`.
- `set_paused()`, `set_agent()`, `register_agent()`, `update_reputation()` — callable only by the contract **owner** `Address`.

In a production deployment these should be two separate keypairs held by two separate parties:
- The **owner** keypair is held by the protocol operator; it controls contract administration and reputation scoring.
- The **agent** keypair is held by the autonomous agent process; it has only `reallocate` rights.

Splitting these roles requires managing two funded testnet accounts, two separate key-rotation flows, and explicit documentation of the trust boundary between them. For the buildathon demo, this is unnecessary overhead.

Additionally, `update_reputation` is called by the agent process itself (because it evaluates its own prediction accuracy and submits the delta). In production, self-attested reputation is a security concern (SEC-06): the agent could inflate its own score. The correct model is for an independent operator to verify predictions off-chain and submit the delta.

---

## Decision

For the testnet demo (assumption A-016): use a **single keypair** for both the contract owner and the registered agent. The `AGENT_PRIVATE_KEY_HEX` account hash is set as both `owner` (at deploy time) and `agent` (in the `register_agent` call).

The deploy script (`scripts/deploy-testnet.mjs`) sets up this dual-role account explicitly. The distinction is documented in `ARCHITECTURE.md` section 2.1 and flagged as `A-016` in `ASSUMPTIONS.md`.

The `ALLOW_TESTNET_DEPLOY=true` environment gate ensures this simplified custody model is only ever applied in a testnet context.

---

## Consequences

**Positive:**
- Single funded testnet account required — simplifies buildathon demo setup.
- Reputation update flow (`update_reputation`) works end-to-end without a separate operator key.
- Both `reallocate` and `register_agent`/`update_reputation` success criteria (SC-03, SC-06) are satisfied with one keypair.

**Negative / trade-offs:**
- Self-attested reputation: the agent scores its own prediction accuracy. The registry contract enforces the `owner-only` guard, so the agent *is* the owner in this setup — the guard is not a meaningful separation.
- If the agent key is compromised, the attacker controls both reallocate rights and owner-level contract administration.

**Production separation-of-duties path (Phase 1 mainnet):**
1. Deploy contracts with a dedicated **owner** key (hardware wallet or multisig).
2. Register the **agent** key via `register_agent` from the owner account.
3. Give the agent process only `AGENT_PRIVATE_KEY_HEX` (agent key only — cannot call `update_reputation` or `set_agent`).
4. Run an independent **operator** process that reads `logs/decisions.jsonl`, verifies prediction accuracy, and submits `update_reputation` using the owner key.

This path requires no contract changes — only key rotation and an operator process. The contract access control is already correctly structured for it.

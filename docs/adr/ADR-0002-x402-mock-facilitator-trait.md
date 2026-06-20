# ADR-0002 — x402 MockFacilitator Behind a Trait with Live Swap

**Status:** Accepted
**Date:** 2026-06-18
**Deciders:** Architecture team

---

## Context

Aegis requires every oracle API call to be gated behind an x402 micropayment. The x402 protocol requires a `PaymentFacilitator` that verifies a signed `PaymentPayload` before releasing oracle data.

Two verification modes are needed:

1. **Demo / CI mode** — no real CSPR transfer; verification confirms structural validity (nonce, expiry) without cryptographic signature checking. Allows the full agent loop to run without testnet funds or a live x402 endpoint.
2. **Live mode** — cryptographic verification delegated to a real Casper x402 facilitator endpoint.

The challenge: both modes must satisfy the same oracle route handler without any `if mock` branching inside the route. The oracle server should not know or care which facilitator is active.

At buildathon time, a stable production `CasperFacilitator` endpoint is not guaranteed to be available on testnet. The demo must be independently runnable.

---

## Decision

Define `PaymentFacilitator` as an interface in `@aegis/shared/src/types.ts`:

```typescript
interface PaymentFacilitator {
  verify(payload: string, now: number): Promise<PaymentReceipt>;
}
```

Provide two concrete implementations in `packages/oracle/src/facilitator.ts`:

- `MockFacilitator` — checks: `signature` field present and non-empty, `expiryUnix > now`, nonce not in in-memory seen-set. Does not verify the cryptographic signature.
- `CasperFacilitator` — delegates to the live endpoint at `X402_FACILITATOR_URL`; performs real ed25519/secp256k1 signature verification.

The active implementation is selected at oracle startup via `X402_FACILITATOR` env var (`mock` or `live`). The oracle route handler receives the facilitator as a constructor argument — it is never imported directly.

Switching to live verification requires only two env changes: `X402_FACILITATOR=live` and `X402_FACILITATOR_URL=<endpoint>`. No code changes.

---

## Consequences

**Positive:**
- Full agent loop, x402 flow, and audit log pipeline work in mock mode with no external dependencies.
- Oracle route handler is agnostic to verification mode; easy to unit-test with a mock injected.
- Live swap is a configuration change, not a code change — minimises mainnet migration risk.
- Replay protection (nonce seen-set + expiry) is present even in mock mode.

**Negative / trade-offs:**
- `MockFacilitator` does not cryptographically verify signatures. The payment is a functional simulation, not a real transfer. This is accurately documented as SEC-03 in `SECURITY.md`.
- The in-memory nonce seen-set is not persisted. A process restart resets replay protection in mock mode. For the demo this is acceptable; for a live service the seen-set must be externalised (Redis or on-chain).

**Mainnet path:** swap to `X402_FACILITATOR=live` once a stable Casper x402 facilitator endpoint is available. Implement real `ed25519`/`secp256k1` signing in `CasperTxClient` to generate verifiable payment payloads (currently uses `mockSign` — SEC-03).

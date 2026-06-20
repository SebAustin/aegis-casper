# ADR-0001 — Odra 2.x + Casper 2.0 Transaction Model

**Status:** Accepted
**Date:** 2026-06-18
**Deciders:** Architecture team

---

## Context

Aegis requires two on-chain contracts (vault and reputation registry) running on Casper Testnet. Casper has two major contract development paths:

1. **Raw `casper-contract` + `casper-types` macros** — low-level, full control, targets both the legacy Deploy model and the Casper 2.0 Transaction model.
2. **Odra framework** — higher-level abstraction over Casper contract APIs; includes CEP-18 (fungible token standard), event macros, access control helpers, and critically, an **in-memory test backend** that runs contract logic without a live node.

Casper 2.0 (Condor) introduced a new `Transaction` model that supersedes the deprecated `Deploy` model. The `casper-js-sdk` v5.x is the TypeScript SDK targeting the Transaction model. v2.x targets the deprecated Deploy model.

The buildathon requires:
- Vault CEP-18 share token (AEGIS)
- Access-controlled `reallocate` entry point
- Event emission (`Deposited`, `Withdrawn`, `Reallocated`, `ReputationUpdated`)
- A fast unit test suite that can run in CI without a live testnet node

**Resolved dependency (OQ-02):** The placeholder Odra version `2.1.0` was a guess. The actual current stable version is `2.8.1` — the version that resolves and compiles on crates.io. Pinned in `contracts/aegis-contracts/Cargo.toml`.

**Toolchain constraint:** `odra-macros 2.8.1` uses the unstable `box_patterns` feature, requiring a **nightly** Rust toolchain. `contracts/rust-toolchain.toml` pins `nightly-2026-01-01`.

---

## Decision

Use **Odra 2.8.1** for both contracts, compiled to `wasm32-unknown-unknown` targeting the Casper 2.0 Transaction model. Use `casper-js-sdk` v5.x for all TypeScript transaction construction.

Specific choices:

- `odra_modules::cep18_token::Cep18` as a `SubModule` for the AEGIS share token (provides `raw_mint`, `raw_burn`, `balance_of`, `total_supply`).
- Odra's `Address` type (which wraps `AccountHash`) in all entry-point signatures and storage keys — Odra's schema layer does not support bare `AccountHash`.
- `odra-test` backend for all CI contract tests (in-memory, no node required).
- `cargo odra build` for Wasm compilation (requires `wasm-opt` and `wasm-strip` on PATH).
- Nightly Rust toolchain pinned via `rust-toolchain.toml`.

---

## Consequences

**Positive:**
- CEP-18, event macros, and access control helpers reduce boilerplate significantly.
- In-memory test backend enables fast TDD and CI without testnet dependency.
- 29 contract unit tests run in seconds with `cargo test`.

**Negative / trade-offs:**
- Requires nightly Rust — not stable. If `odra-macros` stabilises the feature in a future release, the toolchain pin can be lifted.
- Framework abstraction layer: bugs or breaking changes in Odra affect both contracts. Mitigated by pinning the exact semver.
- `cargo odra build` is an additional tool (`wasm-opt`, `wasm-strip`) needed only for the Wasm compile step; `cargo test` does not require these.

**Open risks:**
- RISK-02: Odra breaking changes or testnet incompatibility. Mitigation: exact semver pin; CI on in-memory backend; gated manual testnet deploy.
- If the `wasm32-unknown-unknown` target support changes in nightly, the toolchain pin may need updating before the contract can be recompiled to Wasm.

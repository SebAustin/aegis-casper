# Aegis Contracts

Two [Odra](https://odra.dev) (Rust) smart contracts for the Aegis autonomous
RWA yield-routing agent on Casper:

- **`vault`** — a CSPR vault that mints proportional `AEGIS` CEP-18 shares on
  deposit, redeems them on withdraw, and exposes an agent-only `reallocate`
  entry point.
- **`registry`** — an owner-controlled agent reputation registry.

| | |
|---|---|
| **Odra version** | `2.8.1` (pinned in `aegis-contracts/Cargo.toml`) |
| **Toolchain** | `nightly-2026-01-01` (pinned in `rust-toolchain.toml`) |
| **Backend (CI/tests)** | OdraVM in-memory — no node, no testnet |
| **Targets** | host (tests) + `wasm32-unknown-unknown` (deploy artifacts) |

> **Odra version note (A-003 / OQ-02):** The plan placeholder was `2.1.0`. The
> actual current stable Odra 2.x on crates.io is **`2.8.1`**, which is what
> resolves and compiles; the pin has been updated accordingly. `odra-macros`
> `2.8.1` uses the unstable `box_patterns` feature, so a **nightly** toolchain is
> required — `rust-toolchain.toml` pins `nightly-2026-01-01` (ships the wasm32
> target and the LLVM-20 bulk-memory codegen Odra's wasm strip step expects).

## Layout

```
contracts/
├── Cargo.toml                 # workspace
├── Odra.toml                  # registers Vault + Registry contracts
├── rust-toolchain.toml        # nightly pin
├── aegis-contracts/
│   ├── Cargo.toml             # odra 2.8.1, build bins per contract
│   ├── build.rs               # odra_build::build()
│   └── src/
│       ├── lib.rs
│       ├── vault.rs           # Vault contract + unit tests
│       ├── registry.rs        # Registry contract + unit tests
│       └── bin/               # wasm/schema build entrypoints
└── deployments/
    └── testnet.json           # filled by the (gated) deploy script
```

## Build & Test

```bash
# Run the full unit suite on the OdraVM in-memory backend (SC-10).
cargo test
# or, equivalently, via the Odra CLI:
cargo odra test

# Lint / format.
cargo clippy --all-targets
cargo fmt

# Build deploy-ready wasm. `cargo odra build` additionally runs wasm-opt +
# wasm-strip, so install the WABT / binaryen tools first:
#   brew install wabt binaryen      # macOS
cargo odra build

# Without wasm-opt/wasm-strip installed you can still produce the raw wasm:
ODRA_MODULE=Vault    cargo build --release --target wasm32-unknown-unknown --bin vault_build_contract
ODRA_MODULE=Registry cargo build --release --target wasm32-unknown-unknown --bin registry_build_contract
# artifacts: target/wasm32-unknown-unknown/release/{vault,registry}_build_contract.wasm
```

Deployment is a separate, gated manual step (A-010, `ALLOW_TESTNET_DEPLOY=true`)
and is **not** performed here. The deploy script records the resulting hashes in
`deployments/testnet.json`.

## Entry-point reference

> **Account type note:** the requirements describe the agent/owner as an
> `AccountHash`. Odra's schema layer (entry-point args, return types, events,
> storage keys) supports `Address` but not a bare `AccountHash`. We therefore use
> Odra's `Address` (an `Address::Account(AccountHash)` carries exactly the account
> hash) throughout the public interface. This is the idiomatic Odra equivalent and
> what CSPR.cloud / casper-js-sdk clients pass. Signatures are otherwise unchanged.

### Vault (`vault.rs`)

| Entry point | Access | Description |
|---|---|---|
| `init(owner: Address)` | constructor | Sets owner; agent defaults to owner (A-016); creates the `AEGIS` CEP-18 share token (0 supply). |
| `deposit()` *(payable)* | any | Mints `AEGIS` shares for attached CSPR. First deposit 1:1; later `amount * total_shares / total_balance` (RISK-09). Emits `Deposited`. |
| `withdraw(shares: U256)` | any holder | Burns shares, returns `shares * total_balance / total_shares` motes (CEI + single transfer). Emits `Withdrawn`. |
| `reallocate(allocation: Vec<(u8, u32)>)` | **agent only** | Replaces allocation; weights must sum to exactly `10_000` bps else reverts `InvalidAllocationSum`. Emits `Reallocated`. |
| `pause()` / `unpause()` | **owner only** | Emergency stop. While paused, deposit/withdraw/reallocate revert `Paused`. |
| `set_agent(agent: Address)` | **owner only** | Rotates the agent address. |
| `get_state() -> VaultState` | any (read) | `{ total_balance_motes, total_shares, allocation, agent, paused, last_reallocation_ts }`. |
| `shares_of(addr) -> U256`, `total_shares() -> U256` | any (read) | Convenience readers. |

Events: `Deposited{account, amount_motes, shares_minted, timestamp}`,
`Withdrawn{account, amount_motes, shares_burned, timestamp}`,
`Reallocated{agent, old_allocation, new_allocation, total_balance_motes, timestamp}`.

Errors: `NotAgent`, `NotOwner`, `Paused`, `InvalidAllocationSum`, `ZeroDeposit`,
`ZeroWithdraw`, `InsufficientShares`, `MathError`.

> **Allocation weight type:** the task spec asks for `Vec<(u8, u32)>` (vs PLAN
> §3.2's `Vec<(u8, u16)>`); we follow the task and use `u32` bps.

### Registry (`registry.rs`)

| Entry point | Access | Description |
|---|---|---|
| `init(owner: Address)` | constructor | Sets the admin/owner. |
| `register_agent(agent: Address)` | **owner only** | Creates a profile with **score 0** (FR-R-02). No seed param — the demo seed (A-018) is a separate `update_reputation(+50)` call. Reverts `AlreadyRegistered`. |
| `update_reputation(agent: Address, delta: i64, rationale_hash: [u8;32])` | **owner only** | Applies delta (saturating, clamped at 0), bumps `total_decisions`, bumps `total_correct` when delta > 0. Emits `ReputationUpdated`. Reverts `NotRegistered`. |
| `get_reputation(agent: Address) -> AgentProfile` | any (read) | `{ score, total_decisions, total_correct, registered_at }`. Reverts `NotRegistered`. |
| `is_registered(agent) -> bool` | any (read) | Convenience reader. |

Event: `ReputationUpdated{agent, old_score, new_score, delta, rationale_hash, timestamp}`.
Errors: `NotOwner`, `AlreadyRegistered`, `NotRegistered`.

## Test coverage (SC-10)

`cargo test` runs 26 tests on the OdraVM backend:

- **Vault:** init state; first-deposit 1:1 math; proportional second deposit;
  1-mote edge case; zero-deposit revert; proportional withdraw; zero/over-balance
  withdraw reverts; reallocate happy path + event; reallocate rejects non-agent
  (access control) and weights ≠ 10_000; agent rotation; owner-only `set_agent`;
  pause blocks deposit/withdraw/reallocate + unpause restores; owner-only pause.
- **Registry:** register (score 0); owner-only + double-registration rejects;
  positive/negative delta with counter bumps; clamp-at-zero; `i64::MIN` no-panic;
  owner-only + unregistered rejects; `get_reputation` revert; event emission.

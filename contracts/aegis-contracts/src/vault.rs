//! # Aegis Vault contract
//!
//! A CSPR vault that issues `AEGIS` CEP-18 shares. Funds flow:
//!
//! - **deposit** (payable, any caller): CSPR is attached to the call; the vault
//!   mints `AEGIS` shares proportional to the caller's contribution and mirrors
//!   the new total in `total_balance_motes`.
//! - **withdraw** (any share holder): shares are burned and the proportional CSPR
//!   is transferred back to the caller (pull-of-own-funds; checks-effects then a
//!   single value transfer, guarded against re-entrancy).
//! - **reallocate** (agent only): replaces the basis-point allocation map; weights
//!   must sum to exactly 10_000 bps.
//!
//! Privilege boundaries:
//! - `owner` (set at `init`) may `set_agent`, `pause` and `unpause`.
//! - `agent` (an account `Address`, rotatable by the owner) is the only caller
//!   allowed to `reallocate` (NFR-S-02 / FR-V-03).
//!
//! Share math (RISK-09): the first deposit into an empty vault mints shares 1:1
//! with motes; every subsequent deposit mints `deposit * total_shares /
//! total_balance`. Withdrawals pay out `shares * total_balance / total_shares`.

use odra::casper_types::{U256, U512};
use odra::prelude::*;
use odra::uints::{ToU256, ToU512};
use odra_modules::cep18_token::Cep18;

/// Total basis points representing 100% of an allocation.
const TOTAL_BPS: u32 = 10_000;

/// Errors returned by the vault contract. Discriminants are namespaced away from
/// the CEP-18 module errors (60001..) to keep revert reasons unambiguous.
#[odra::odra_error]
pub enum VaultError {
    /// Caller is not the registered agent account hash (FR-V-03 / NFR-S-02).
    NotAgent = 10_001,
    /// Caller is not the contract owner.
    NotOwner = 10_002,
    /// A mutating entry point was called while the vault is paused (FR-V-07).
    Paused = 10_003,
    /// Allocation weights did not sum to exactly 10_000 bps (FR-V-03).
    InvalidAllocationSum = 10_004,
    /// A deposit was made with zero attached motes.
    ZeroDeposit = 10_005,
    /// A withdrawal requested zero shares.
    ZeroWithdraw = 10_006,
    /// The caller tried to burn more shares than they hold, or the vault holds no
    /// shares at all.
    InsufficientShares = 10_007,
    /// Internal share-math invariant broken (e.g. total shares is zero while a
    /// balance exists). Should be unreachable.
    MathError = 10_008,
}

/// Read-only snapshot of the vault returned by [`Vault::get_state`] (FR-V-06).
#[odra::odra_type]
pub struct VaultState {
    /// Total CSPR held by the vault, in motes (A-002).
    pub total_balance_motes: U512,
    /// Total `AEGIS` shares outstanding.
    pub total_shares: U256,
    /// Current allocation as `(asset_id, basis_points)` pairs; weights sum to 10_000.
    pub allocation: Vec<(u8, u32)>,
    /// The account address allowed to call `reallocate`.
    pub agent: Address,
    /// Whether the vault is paused.
    pub paused: bool,
    /// Block time (ms) of the last successful reallocation, or 0 if never.
    pub last_reallocation_ts: u64,
}

/// Emitted on a successful deposit (FR-V-05).
#[odra::event]
pub struct Deposited {
    /// Depositor address.
    pub account: Address,
    /// CSPR amount deposited, in motes.
    pub amount_motes: U512,
    /// `AEGIS` shares minted to the depositor.
    pub shares_minted: U256,
    /// Block time in milliseconds.
    pub timestamp: u64,
}

/// Emitted on a successful withdrawal (FR-V-05).
#[odra::event]
pub struct Withdrawn {
    /// Withdrawing address.
    pub account: Address,
    /// CSPR amount returned, in motes.
    pub amount_motes: U512,
    /// `AEGIS` shares burned.
    pub shares_burned: U256,
    /// Block time in milliseconds.
    pub timestamp: u64,
}

/// Emitted on a successful reallocation (FR-V-04).
#[odra::event]
pub struct Reallocated {
    /// The agent account address that triggered the reallocation.
    pub agent: Address,
    /// Allocation prior to this call.
    pub old_allocation: Vec<(u8, u32)>,
    /// Allocation after this call (weights sum to 10_000).
    pub new_allocation: Vec<(u8, u32)>,
    /// Total vault balance in motes at reallocation time.
    pub total_balance_motes: U512,
    /// Block time in milliseconds.
    pub timestamp: u64,
}

/// The Aegis vault contract.
#[odra::module(
    events = [Deposited, Withdrawn, Reallocated],
    errors = VaultError
)]
pub struct Vault {
    /// `AEGIS` CEP-18 share token (mint on deposit, burn on withdraw).
    shares: SubModule<Cep18>,
    /// Mirror of the vault's CSPR balance used for share math. The contract purse
    /// balance is the ultimate truth on-chain; this mirror keeps the math cheap
    /// and is updated in lock-step with every deposit/withdraw.
    total_balance_motes: Var<U512>,
    /// The single account address permitted to call `reallocate`.
    agent: Var<Address>,
    /// Admin address; may pause/unpause and rotate the agent.
    owner: Var<Address>,
    /// Emergency stop flag (FR-V-07).
    paused: Var<bool>,
    /// Current allocation as `(asset_id, bps)` pairs; invariant: bps sum == 10_000.
    allocation: Var<Vec<(u8, u32)>>,
    /// Block time (ms) of the last reallocation.
    last_reallocation_ts: Var<u64>,
}

#[odra::module]
impl Vault {
    /// Initializes the vault.
    ///
    /// `owner` is the admin address (can pause/unpause and rotate the agent). The
    /// agent defaults to `owner` so a single demo keypair can act as both operator
    /// and agent (A-016); rotate it later with [`Vault::set_agent`].
    /// The `AEGIS` share token is created with zero initial supply.
    pub fn init(&mut self, owner: Address) {
        self.owner.set(owner);
        self.agent.set(owner);
        self.paused.set(false);
        self.total_balance_motes.set(U512::zero());
        self.last_reallocation_ts.set(0);
        self.allocation.set(Vec::new());
        self.shares.init(
            string::String::from("AEGIS"),
            string::String::from("Aegis Vault Share"),
            9,
            U256::zero(),
        );
    }

    /// Deposits CSPR and mints proportional `AEGIS` shares to the caller (FR-V-01).
    ///
    /// First deposit into an empty vault mints shares 1:1 with motes; subsequent
    /// deposits mint `deposit * total_shares / total_balance` (RISK-09).
    #[odra(payable)]
    pub fn deposit(&mut self) {
        self.assert_not_paused();

        let caller = self.env().caller();
        let amount = self.env().attached_value();
        if amount.is_zero() {
            self.env().revert(VaultError::ZeroDeposit);
        }

        let total_balance = self.total_balance_motes.get_or_default();
        let total_shares = self.shares.total_supply();

        // Compute shares to mint. First deposit (no shares yet) is 1:1.
        let shares_out: U256 = if total_shares.is_zero() || total_balance.is_zero() {
            amount
                .to_u256()
                .unwrap_or_revert_with(self, VaultError::MathError)
        } else {
            // shares_out = amount * total_shares / total_balance
            let amount_u256 = amount
                .to_u256()
                .unwrap_or_revert_with(self, VaultError::MathError);
            let total_balance_u256 = total_balance
                .to_u256()
                .unwrap_or_revert_with(self, VaultError::MathError);
            amount_u256
                .checked_mul(total_shares)
                .and_then(|v| v.checked_div(total_balance_u256))
                .unwrap_or_revert_with(self, VaultError::MathError)
        };

        if shares_out.is_zero() {
            // Deposit too small to mint a single share against the current ratio.
            self.env().revert(VaultError::ZeroDeposit);
        }

        // Effects before any further interaction.
        self.total_balance_motes.set(total_balance + amount);
        self.shares.raw_mint(&caller, &shares_out);

        self.env().emit_event(Deposited {
            account: caller,
            amount_motes: amount,
            shares_minted: shares_out,
            timestamp: self.env().get_block_time(),
        });
    }

    /// Burns `shares` from the caller and returns the proportional CSPR (FR-V-02).
    ///
    /// Follows checks-effects-interactions: balances are updated before the single
    /// outbound value transfer.
    pub fn withdraw(&mut self, shares: U256) {
        self.assert_not_paused();

        if shares.is_zero() {
            self.env().revert(VaultError::ZeroWithdraw);
        }

        let caller = self.env().caller();
        let caller_shares = self.shares.balance_of(&caller);
        if shares > caller_shares {
            self.env().revert(VaultError::InsufficientShares);
        }

        let total_shares = self.shares.total_supply();
        if total_shares.is_zero() {
            self.env().revert(VaultError::InsufficientShares);
        }

        let total_balance = self.total_balance_motes.get_or_default();
        // motes_out = shares * total_balance / total_shares
        let total_balance_u256 = total_balance
            .to_u256()
            .unwrap_or_revert_with(self, VaultError::MathError);
        let motes_out_u256 = shares
            .checked_mul(total_balance_u256)
            .and_then(|v| v.checked_div(total_shares))
            .unwrap_or_revert_with(self, VaultError::MathError);
        let motes_out = motes_out_u256.to_u512();

        // Effects: burn shares and decrement the balance mirror first.
        self.shares.raw_burn(&caller, &shares);
        self.total_balance_motes.set(total_balance - motes_out);

        // Interaction: single outbound transfer of the caller's own funds.
        if !motes_out.is_zero() {
            self.env().transfer_tokens(&caller, &motes_out);
        }

        self.env().emit_event(Withdrawn {
            account: caller,
            amount_motes: motes_out,
            shares_burned: shares,
            timestamp: self.env().get_block_time(),
        });
    }

    /// Replaces the allocation map (FR-V-03). Agent-only; weights must sum to
    /// exactly 10_000 basis points.
    pub fn reallocate(&mut self, allocation: Vec<(u8, u32)>) {
        self.assert_not_paused();
        self.assert_agent();

        let sum: u32 = allocation
            .iter()
            .fold(0u32, |acc, (_, bps)| acc.saturating_add(*bps));
        if sum != TOTAL_BPS {
            self.env().revert(VaultError::InvalidAllocationSum);
        }

        let old_allocation = self.allocation.get_or_default();
        let now = self.env().get_block_time();

        self.allocation.set(allocation.clone());
        self.last_reallocation_ts.set(now);

        self.env().emit_event(Reallocated {
            agent: self.agent.get().unwrap_or_revert(self),
            old_allocation,
            new_allocation: allocation,
            total_balance_motes: self.total_balance_motes.get_or_default(),
            timestamp: now,
        });
    }

    /// Pauses the vault (owner-only). While paused, deposit/withdraw/reallocate
    /// all revert (FR-V-07).
    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused.set(true);
    }

    /// Unpauses the vault (owner-only).
    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused.set(false);
    }

    /// Rotates the agent account address (owner-only).
    pub fn set_agent(&mut self, agent: Address) {
        self.assert_owner();
        self.agent.set(agent);
    }

    /// Returns a read-only snapshot of the vault (FR-V-06). Callable by anyone.
    pub fn get_state(&self) -> VaultState {
        VaultState {
            total_balance_motes: self.total_balance_motes.get_or_default(),
            total_shares: self.shares.total_supply(),
            allocation: self.allocation.get_or_default(),
            agent: self.agent.get().unwrap_or_revert(self),
            paused: self.paused.get_or_default(),
            last_reallocation_ts: self.last_reallocation_ts.get_or_default(),
        }
    }

    /// `AEGIS` share balance of `address` (convenience reader for clients/tests).
    pub fn shares_of(&self, address: &Address) -> U256 {
        self.shares.balance_of(address)
    }

    /// Total `AEGIS` shares outstanding (convenience reader).
    pub fn total_shares(&self) -> U256 {
        self.shares.total_supply()
    }
}

impl Vault {
    fn assert_not_paused(&self) {
        if self.paused.get_or_default() {
            self.env().revert(VaultError::Paused);
        }
    }

    fn assert_owner(&self) {
        let owner = self.owner.get().unwrap_or_revert(self);
        if self.env().caller() != owner {
            self.env().revert(VaultError::NotOwner);
        }
    }

    fn assert_agent(&self) {
        let agent = self.agent.get().unwrap_or_revert(self);
        if self.env().caller() != agent {
            self.env().revert(VaultError::NotAgent);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostEnv, HostRef};

    // 1 CSPR in motes (A-002).
    const CSPR: u64 = 1_000_000_000;

    fn owner_address(env: &HostEnv) -> Address {
        env.get_account(0)
    }

    fn setup() -> (HostEnv, VaultHostRef) {
        let env = odra_test::env();
        let owner = env.get_account(0);
        let vault = Vault::deploy(&env, VaultInitArgs { owner });
        (env, vault)
    }

    /// A valid 5-slot allocation summing to exactly 10_000 bps.
    fn valid_allocation() -> Vec<(u8, u32)> {
        vec![(0, 2000), (1, 2000), (2, 2000), (3, 2000), (4, 2000)]
    }

    #[test]
    fn init_sets_owner_agent_and_zero_state() {
        let (env, vault) = setup();
        let state = vault.get_state();
        assert_eq!(state.total_balance_motes, U512::zero());
        assert_eq!(state.total_shares, U256::zero());
        assert!(state.allocation.is_empty());
        assert!(!state.paused);
        assert_eq!(state.last_reallocation_ts, 0);
        // Agent defaults to the owner's address (A-016).
        assert_eq!(state.agent, owner_address(&env));
    }

    #[test]
    fn first_deposit_mints_one_to_one() {
        let (env, vault) = setup();
        let owner = env.get_account(0);

        vault.with_tokens(U512::from(100 * CSPR)).deposit();

        assert_eq!(vault.total_shares(), U256::from(100 * CSPR));
        assert_eq!(vault.shares_of(&owner), U256::from(100 * CSPR));
        let state = vault.get_state();
        assert_eq!(state.total_balance_motes, U512::from(100 * CSPR));
    }

    #[test]
    fn second_deposit_mints_proportional_shares() {
        let (env, vault) = setup();
        let alice = env.get_account(1);
        let bob = env.get_account(2);

        // Alice deposits 100 CSPR -> 100 CSPR shares (1:1 first deposit).
        env.set_caller(alice);
        vault.with_tokens(U512::from(100 * CSPR)).deposit();
        assert_eq!(vault.shares_of(&alice), U256::from(100 * CSPR));

        // Bob deposits 50 CSPR. shares = 50 * 100 / 100 = 50 CSPR-equivalent.
        env.set_caller(bob);
        vault.with_tokens(U512::from(50 * CSPR)).deposit();
        assert_eq!(vault.shares_of(&bob), U256::from(50 * CSPR));

        assert_eq!(vault.total_shares(), U256::from(150 * CSPR));
        assert_eq!(
            vault.get_state().total_balance_motes,
            U512::from(150 * CSPR)
        );
    }

    #[test]
    fn tiny_first_deposit_one_mote_mints_one_share() {
        let (_env, vault) = setup();
        vault.with_tokens(U512::one()).deposit();
        assert_eq!(vault.total_shares(), U256::one());
    }

    #[test]
    fn zero_deposit_reverts() {
        let (_env, vault) = setup();
        let result = vault.with_tokens(U512::zero()).try_deposit();
        assert_eq!(result, Err(VaultError::ZeroDeposit.into()));
    }

    #[test]
    fn withdraw_returns_proportional_cspr_and_burns_shares() {
        let (env, mut vault) = setup();
        let alice = env.get_account(1);

        env.set_caller(alice);
        vault.with_tokens(U512::from(100 * CSPR)).deposit();

        // Withdraw half the shares.
        let half = U256::from(50 * CSPR);
        let balance_before = env.balance_of(&alice);
        vault.withdraw(half);

        assert_eq!(vault.shares_of(&alice), U256::from(50 * CSPR));
        assert_eq!(vault.total_shares(), U256::from(50 * CSPR));
        assert_eq!(vault.get_state().total_balance_motes, U512::from(50 * CSPR));
        // Alice received ~50 CSPR back (her account balance grew).
        assert!(env.balance_of(&alice) > balance_before);
    }

    #[test]
    fn withdraw_zero_reverts() {
        let (_env, mut vault) = setup();
        vault.with_tokens(U512::from(10 * CSPR)).deposit();
        let result = vault.try_withdraw(U256::zero());
        assert_eq!(result, Err(VaultError::ZeroWithdraw.into()));
    }

    #[test]
    fn withdraw_more_than_held_reverts() {
        let (env, mut vault) = setup();
        let alice = env.get_account(1);
        env.set_caller(alice);
        vault.with_tokens(U512::from(10 * CSPR)).deposit();

        let result = vault.try_withdraw(U256::from(20 * CSPR));
        assert_eq!(result, Err(VaultError::InsufficientShares.into()));
    }

    #[test]
    fn reallocate_happy_path_updates_state_and_emits_event() {
        let (env, mut vault) = setup();
        vault.with_tokens(U512::from(100 * CSPR)).deposit();

        let alloc = valid_allocation();
        vault.reallocate(alloc.clone());

        let state = vault.get_state();
        assert_eq!(state.allocation, alloc);
        // The Reallocated event carries the new allocation map (FR-V-04).
        assert!(env.emitted(&vault, "Reallocated"));
    }

    #[test]
    fn reallocate_rejects_non_agent_caller() {
        let (env, mut vault) = setup();
        // Account 1 is NOT the agent (agent == owner == account 0).
        let mallory = env.get_account(1);
        env.set_caller(mallory);

        let result = vault.try_reallocate(valid_allocation());
        assert_eq!(result, Err(VaultError::NotAgent.into()));
    }

    #[test]
    fn reallocate_rejects_weights_not_summing_to_10000() {
        let (_env, mut vault) = setup();
        // Sums to 9_999.
        let bad = vec![(0, 5000), (1, 4999)];
        let result = vault.try_reallocate(bad);
        assert_eq!(result, Err(VaultError::InvalidAllocationSum.into()));
    }

    #[test]
    fn set_agent_allows_rotated_agent_and_blocks_old() {
        let (env, mut vault) = setup();
        let new_agent = env.get_account(3);

        // Owner rotates the agent to account 3.
        vault.set_agent(new_agent);

        // Old agent (owner, account 0) can no longer reallocate.
        let result = vault.try_reallocate(valid_allocation());
        assert_eq!(result, Err(VaultError::NotAgent.into()));

        // New agent can.
        env.set_caller(new_agent);
        assert!(vault.try_reallocate(valid_allocation()).is_ok());
    }

    #[test]
    fn set_agent_rejects_non_owner() {
        let (env, mut vault) = setup();
        let mallory = env.get_account(1);
        env.set_caller(mallory);
        let result = vault.try_set_agent(mallory);
        assert_eq!(result, Err(VaultError::NotOwner.into()));
    }

    #[test]
    fn pause_blocks_deposit_withdraw_reallocate() {
        let (env, mut vault) = setup();
        // Seed a balance while unpaused.
        vault.with_tokens(U512::from(100 * CSPR)).deposit();

        // Owner pauses.
        vault.pause();
        assert!(vault.get_state().paused);

        // Deposit blocked.
        assert_eq!(
            vault.with_tokens(U512::from(10 * CSPR)).try_deposit(),
            Err(VaultError::Paused.into())
        );
        // Withdraw blocked.
        assert_eq!(
            vault.try_withdraw(U256::from(10 * CSPR)),
            Err(VaultError::Paused.into())
        );
        // Reallocate blocked (even for the agent).
        env.set_caller(env.get_account(0));
        assert_eq!(
            vault.try_reallocate(valid_allocation()),
            Err(VaultError::Paused.into())
        );

        // Unpause restores deposit.
        vault.unpause();
        assert!(!vault.get_state().paused);
        assert!(vault
            .with_tokens(U512::from(10 * CSPR))
            .try_deposit()
            .is_ok());
    }

    #[test]
    fn pause_rejects_non_owner() {
        let (env, mut vault) = setup();
        let mallory = env.get_account(1);
        env.set_caller(mallory);
        assert_eq!(vault.try_pause(), Err(VaultError::NotOwner.into()));
    }
}

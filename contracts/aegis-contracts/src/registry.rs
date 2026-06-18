//! # Aegis reputation Registry contract
//!
//! Stores a reputation profile per agent account hash (FR-R-01):
//! - `score` (`u64`) — clamped at a minimum of 0 (FR-R-03 / NFR-S-03).
//! - `total_decisions` (`u64`) — incremented on every reputation update.
//! - `total_correct` (`u64`) — incremented when the applied delta is positive.
//! - `registered_at` (`u64`) — block time (ms) at registration.
//!
//! Privilege boundaries: `register_agent` and `update_reputation` are owner-only.
//! `register_agent` creates a profile with **score 0** (FR-R-02) and does NOT take
//! a seed argument; the demo seed (A-018) is applied afterwards by the deploy/seed
//! script via a separate owner-signed `update_reputation(+50)` call, keeping the
//! seed itself an auditable on-chain reputation transaction.

use odra::prelude::*;

/// Errors returned by the registry contract.
#[odra::odra_error]
pub enum RegistryError {
    /// Caller is not the contract owner (NFR-S-03).
    NotOwner = 20_001,
    /// The agent is already registered.
    AlreadyRegistered = 20_002,
    /// The agent has not been registered.
    NotRegistered = 20_003,
}

/// Stored reputation profile for an agent (FR-R-01).
#[odra::odra_type]
pub struct AgentProfile {
    /// Current reputation score, clamped at a minimum of 0.
    pub score: u64,
    /// Total number of reputation updates applied.
    pub total_decisions: u64,
    /// Number of updates that were positive (correct predictions).
    pub total_correct: u64,
    /// Block time (ms) at which the agent was registered.
    pub registered_at: u64,
}

/// Emitted on every reputation update (FR-R-03).
#[odra::event]
pub struct ReputationUpdated {
    /// The agent whose reputation changed.
    pub agent: Address,
    /// Score before this update.
    pub old_score: u64,
    /// Score after this update (clamped at 0).
    pub new_score: u64,
    /// The signed delta requested by the owner.
    pub delta: i64,
    /// SHA-256 hash of the decision-log entries justifying the update (A-008).
    pub rationale_hash: [u8; 32],
    /// Block time in milliseconds.
    pub timestamp: u64,
}

/// The Aegis reputation registry contract.
#[odra::module(
    events = [ReputationUpdated],
    errors = RegistryError
)]
pub struct Registry {
    /// Admin address; only the owner may register agents and update reputation.
    owner: Var<Address>,
    /// Profiles keyed by agent account address.
    profiles: Mapping<Address, AgentProfile>,
    /// Membership flag so we can distinguish "score 0, registered" from "absent".
    registered: Mapping<Address, bool>,
}

#[odra::module]
impl Registry {
    /// Initializes the registry with an `owner` (admin) address.
    pub fn init(&mut self, owner: Address) {
        self.owner.set(owner);
    }

    /// Registers a new agent with score 0 (FR-R-02). Owner-only.
    ///
    /// Deliberately takes no seed argument: the demo seed (A-018) is applied
    /// afterwards via a separate `update_reputation(agent, +50, hash)` call so the
    /// seed is itself an auditable on-chain reputation transaction.
    pub fn register_agent(&mut self, agent: Address) {
        self.assert_owner();
        if self.registered.get(&agent).unwrap_or(false) {
            self.env().revert(RegistryError::AlreadyRegistered);
        }

        self.profiles.set(
            &agent,
            AgentProfile {
                score: 0,
                total_decisions: 0,
                total_correct: 0,
                registered_at: self.env().get_block_time(),
            },
        );
        self.registered.set(&agent, true);
    }

    /// Applies `delta` to the agent's score, saturating-clamped at a minimum of 0,
    /// bumps the decision counters, and emits [`ReputationUpdated`] (FR-R-03).
    /// Owner-only (NFR-S-03).
    pub fn update_reputation(&mut self, agent: Address, delta: i64, rationale_hash: [u8; 32]) {
        self.assert_owner();
        if !self.registered.get(&agent).unwrap_or(false) {
            self.env().revert(RegistryError::NotRegistered);
        }

        let mut profile = self.profiles.get(&agent).unwrap_or_revert(self);
        let old_score = profile.score;

        // Apply the delta, clamping at zero. Adding a positive delta saturates at
        // u64::MAX; subtracting more than the current score clamps to 0.
        let new_score = if delta >= 0 {
            old_score.saturating_add(delta as u64)
        } else {
            // delta < 0: magnitude is -delta. Guard against i64::MIN overflow on negation.
            let magnitude = (delta as i128).unsigned_abs() as u64;
            old_score.saturating_sub(magnitude)
        };

        profile.score = new_score;
        profile.total_decisions = profile.total_decisions.saturating_add(1);
        if delta > 0 {
            profile.total_correct = profile.total_correct.saturating_add(1);
        }
        self.profiles.set(&agent, profile);

        self.env().emit_event(ReputationUpdated {
            agent,
            old_score,
            new_score,
            delta,
            rationale_hash,
            timestamp: self.env().get_block_time(),
        });
    }

    /// Returns the agent's reputation profile (FR-R-04). Callable by anyone.
    /// Reverts if the agent is not registered.
    pub fn get_reputation(&self, agent: Address) -> AgentProfile {
        if !self.registered.get(&agent).unwrap_or(false) {
            self.env().revert(RegistryError::NotRegistered);
        }
        self.profiles.get(&agent).unwrap_or_revert(self)
    }

    /// Whether `agent` has been registered (convenience reader).
    pub fn is_registered(&self, agent: Address) -> bool {
        self.registered.get(&agent).unwrap_or(false)
    }
}

impl Registry {
    fn assert_owner(&self) {
        let owner = self.owner.get().unwrap_or_revert(self);
        if self.env().caller() != owner {
            self.env().revert(RegistryError::NotOwner);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostEnv};

    fn setup() -> (HostEnv, RegistryHostRef, Address) {
        let env = odra_test::env();
        let owner = env.get_account(0);
        let registry = Registry::deploy(&env, RegistryInitArgs { owner });
        // The registered agent is a distinct account from the owner here, but in
        // the testnet demo they collapse into one keypair (A-016).
        let agent = env.get_account(1);
        (env, registry, agent)
    }

    #[test]
    fn register_agent_creates_zero_score_profile() {
        let (_env, mut registry, agent) = setup();
        registry.register_agent(agent);

        assert!(registry.is_registered(agent));
        let profile = registry.get_reputation(agent);
        assert_eq!(profile.score, 0);
        assert_eq!(profile.total_decisions, 0);
        assert_eq!(profile.total_correct, 0);
    }

    #[test]
    fn register_agent_rejects_non_owner() {
        let (env, mut registry, agent) = setup();
        env.set_caller(env.get_account(2));
        let result = registry.try_register_agent(agent);
        assert_eq!(result, Err(RegistryError::NotOwner.into()));
    }

    #[test]
    fn register_agent_rejects_double_registration() {
        let (_env, mut registry, agent) = setup();
        registry.register_agent(agent);
        let result = registry.try_register_agent(agent);
        assert_eq!(result, Err(RegistryError::AlreadyRegistered.into()));
    }

    #[test]
    fn update_reputation_applies_positive_delta_and_bumps_counters() {
        let (_env, mut registry, agent) = setup();
        registry.register_agent(agent);

        // Seed +50 (A-018 demo seed applied as a separate update).
        registry.update_reputation(agent, 50, [0u8; 32]);
        let p = registry.get_reputation(agent);
        assert_eq!(p.score, 50);
        assert_eq!(p.total_decisions, 1);
        assert_eq!(p.total_correct, 1);

        // +1 epoch update.
        registry.update_reputation(agent, 1, [1u8; 32]);
        let p = registry.get_reputation(agent);
        assert_eq!(p.score, 51);
        assert_eq!(p.total_decisions, 2);
        assert_eq!(p.total_correct, 2);
    }

    #[test]
    fn update_reputation_negative_delta_decrements_without_correct_bump() {
        let (_env, mut registry, agent) = setup();
        registry.register_agent(agent);
        registry.update_reputation(agent, 10, [0u8; 32]);

        registry.update_reputation(agent, -3, [2u8; 32]);
        let p = registry.get_reputation(agent);
        assert_eq!(p.score, 7);
        assert_eq!(p.total_decisions, 2);
        // total_correct only counts positive deltas.
        assert_eq!(p.total_correct, 1);
    }

    #[test]
    fn update_reputation_clamps_at_zero() {
        let (_env, mut registry, agent) = setup();
        registry.register_agent(agent);
        registry.update_reputation(agent, 5, [0u8; 32]);

        // Subtract more than the current score: clamps to 0, never underflows.
        registry.update_reputation(agent, -100, [3u8; 32]);
        let p = registry.get_reputation(agent);
        assert_eq!(p.score, 0);
        assert_eq!(p.total_decisions, 2);
    }

    #[test]
    fn update_reputation_handles_i64_min_without_panic() {
        let (_env, mut registry, agent) = setup();
        registry.register_agent(agent);
        registry.update_reputation(agent, 5, [0u8; 32]);
        // i64::MIN magnitude must not overflow on negation; score clamps to 0.
        registry.update_reputation(agent, i64::MIN, [4u8; 32]);
        assert_eq!(registry.get_reputation(agent).score, 0);
    }

    #[test]
    fn update_reputation_rejects_non_owner() {
        let (env, mut registry, agent) = setup();
        registry.register_agent(agent);
        env.set_caller(env.get_account(2));
        let result = registry.try_update_reputation(agent, 1, [0u8; 32]);
        assert_eq!(result, Err(RegistryError::NotOwner.into()));
    }

    #[test]
    fn update_reputation_rejects_unregistered_agent() {
        let (_env, mut registry, agent) = setup();
        let result = registry.try_update_reputation(agent, 1, [0u8; 32]);
        assert_eq!(result, Err(RegistryError::NotRegistered.into()));
    }

    #[test]
    fn get_reputation_reverts_for_unregistered_agent() {
        let (_env, registry, agent) = setup();
        let result = registry.try_get_reputation(agent);
        assert_eq!(result, Err(RegistryError::NotRegistered.into()));
    }

    #[test]
    fn emits_reputation_updated_event() {
        let (env, mut registry, agent) = setup();
        registry.register_agent(agent);
        registry.update_reputation(agent, 50, [7u8; 32]);

        // The ReputationUpdated event was emitted by the update call.
        assert!(env.emitted(&registry, "ReputationUpdated"));
    }
}

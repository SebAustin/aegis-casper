//! # Aegis contracts
//!
//! Two Odra contracts powering the Aegis autonomous RWA yield-routing agent on
//! Casper:
//!
//! - [`vault`] — CSPR vault that mints proportional `AEGIS` CEP-18 shares on
//!   deposit, redeems them on withdraw, and exposes an agent-only `reallocate`
//!   entry point guarded by a stored agent account hash.
//! - [`registry`] — owner-controlled agent reputation registry storing a score,
//!   decision counters and a registration timestamp per agent.
//!
//! Money flow and privilege boundaries are deliberately explicit: deposits and
//! withdrawals follow checks-effects-interactions with a re-entrancy guard on the
//! value-transfer path; mutating admin entry points are owner-only; `reallocate`
//! is agent-only. See the crate `README.md` for the full entry-point reference.
#![cfg_attr(not(test), no_std)]

extern crate alloc;

pub mod registry;
pub mod vault;

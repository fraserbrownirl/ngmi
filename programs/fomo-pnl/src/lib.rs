//! Simple Binary Prediction Market Program for Solana
//!
//! THIS PROGRAM IS FOR EDUCATIONAL PURPOSES ONLY. IT IS UNAUDITED AND
//! SHOULD NOT BE USED IN PRODUCTION. THE AUTHORS ARE NOT RESPONSIBLE FOR
//! ANY DAMAGES OR LOSSES THAT MAY RESULT FROM ITS USE.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6nPzFvBm1Eezmoa82w82XX3L6qNy1StVXDMf7QnF8zv");

#[program]
pub mod fomo_pnl {
    use super::*;

    /// Initialize the prediction market program
    pub fn initialize(
        ctx: Context<Initialize>,
        fee_recipient: Pubkey,
        max_fee_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, fee_recipient, max_fee_bps)
    }

    /// Update the global configuration (admin only)
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        fee_recipient: Pubkey,
        max_fee_bps: u16,
    ) -> Result<()> {
        instructions::update_config::handler(ctx, fee_recipient, max_fee_bps)
    }

    /// Pause the contract (admin only)
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::pause_handler(ctx)
    }

    /// Unpause the contract (admin only)
    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::unpause_handler(ctx)
    }

    /// Create a new prediction market
    pub fn create_market(
        ctx: Context<CreateMarket>,
        question: String,
        resolution_time: i64,
        fee_amount: u64,
    ) -> Result<()> {
        instructions::create_market::handler(ctx, question, resolution_time, fee_amount)
    }

    /// Place a bet on a market
    pub fn place_bet(
        ctx: Context<PlaceBet>,
        market_id: u64,
        outcome: Outcome,
        amount: u64,
    ) -> Result<()> {
        instructions::place_bet::handler(ctx, market_id, outcome, amount)
    }

    /// Resolve a market (admin only)
    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        market_id: u64,
        winning_outcome: Outcome,
    ) -> Result<()> {
        instructions::resolve_market::handler(ctx, market_id, winning_outcome)
    }

    /// Cancel a market (admin only)
    pub fn cancel_market(ctx: Context<CancelMarket>, market_id: u64) -> Result<()> {
        instructions::cancel_market::handler(ctx, market_id)
    }

    /// Claim winnings from a resolved or cancelled market
    pub fn claim_winnings(ctx: Context<ClaimWinnings>, market_id: u64) -> Result<()> {
        instructions::claim_winnings::handler(ctx, market_id)
    }
}

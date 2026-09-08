use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod settle;
pub mod state;

use instructions::*;

declare_id!("CnJCzEEpfxtDWex5rA5c1H5A5YZQPqSG2LjnhxwRLMQM");

#[program]
pub mod fomo_pnl {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee_recipient: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, fee_recipient)
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        fomo_user_id: [u8; 16],
        threshold_usd: i64,
        resolution_time: i64,
        start_pnl_usd: i64,
        fee_amount: u64,
        settle_kind: u8,
    ) -> Result<()> {
        instructions::create_market::handler(
            ctx,
            fomo_user_id,
            threshold_usd,
            resolution_time,
            start_pnl_usd,
            fee_amount,
            settle_kind,
        )
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        market_id: u64,
        outcome: state::Outcome,
        amount: u64,
    ) -> Result<()> {
        instructions::place_bet::handler(ctx, market_id, outcome, amount)
    }

    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        market_id: u64,
        end_pnl_usd: i64,
        captured_at: i64,
    ) -> Result<()> {
        instructions::resolve_market::handler(ctx, market_id, end_pnl_usd, captured_at)
    }

    pub fn cancel_market(ctx: Context<CancelMarket>, market_id: u64) -> Result<()> {
        instructions::cancel_market::handler(ctx, market_id)
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>, market_id: u64) -> Result<()> {
        instructions::claim_winnings::handler(ctx, market_id)
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::pause_handler(ctx)
    }

    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::unpause_handler(ctx)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, fee_recipient: Pubkey) -> Result<()> {
        instructions::update_config::handler(ctx, fee_recipient)
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::transfer_admin::handler(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::transfer_admin::accept_handler(ctx)
    }

    pub fn set_resolver(ctx: Context<SetResolver>, resolver: Pubkey) -> Result<()> {
        instructions::set_resolver::handler(ctx, resolver)
    }

    pub fn init_rake(
        ctx: Context<InitRake>,
        owner: Pubkey,
        founder: Pubkey,
        rake_bps: u16,
        burn_bps: u16,
        agent_bps: u16,
        creator_bps: u16,
    ) -> Result<()> {
        instructions::init_rake::handler(ctx, owner, founder, rake_bps, burn_bps, agent_bps, creator_bps)
    }

    pub fn set_rake(
        ctx: Context<SetRake>,
        rake_bps: u16,
        burn_bps: u16,
        agent_bps: u16,
        creator_bps: u16,
    ) -> Result<()> {
        instructions::set_rake::handler(ctx, rake_bps, burn_bps, agent_bps, creator_bps)
    }

    pub fn transfer_rake_owner(ctx: Context<TransferRakeOwner>, new_owner: Pubkey) -> Result<()> {
        instructions::transfer_rake_owner::handler(ctx, new_owner)
    }

    pub fn accept_rake_owner(ctx: Context<AcceptRakeOwner>) -> Result<()> {
        instructions::transfer_rake_owner::accept_handler(ctx)
    }

    pub fn set_founder(ctx: Context<SetFounder>, new_founder: Pubkey) -> Result<()> {
        instructions::set_founder::handler(ctx, new_founder)
    }
}

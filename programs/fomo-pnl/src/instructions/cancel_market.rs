use anchor_lang::prelude::*;

use crate::error::PredictionMarketError;
use crate::state::{Config, Market, MarketState};

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CancelMarket<'info> {
    #[account(constraint = resolver.key() == config.resolver @ PredictionMarketError::InvalidResolver)]
    pub resolver: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [Market::SEED, market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.state == MarketState::Active @ PredictionMarketError::MarketAlreadyFinalized
    )]
    pub market: Account<'info, Market>,
}

pub fn handler(ctx: Context<CancelMarket>, _market_id: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= market.resolution_time,
        PredictionMarketError::MarketNotExpired
    );
    market.state = MarketState::Cancelled;
    Ok(())
}

use anchor_lang::prelude::*;

use crate::error::PredictionMarketError;
use crate::state::{Config, Market, MarketState, Outcome};

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ResolveMarket<'info> {
    #[account(
        constraint = admin.key() == config.admin @ PredictionMarketError::InvalidAdmin
    )]
    pub admin: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [Market::SEED, market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.state == MarketState::Active @ PredictionMarketError::MarketAlreadyFinalized
    )]
    pub market: Account<'info, Market>,
}

pub fn handler(
    ctx: Context<ResolveMarket>,
    _market_id: u64,
    winning_outcome: Outcome,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    // Validations
    require!(
        clock.unix_timestamp >= market.resolution_time,
        PredictionMarketError::MarketNotExpired
    );
    require!(
        winning_outcome == Outcome::Yes || winning_outcome == Outcome::No,
        PredictionMarketError::InvalidOutcome
    );

    // Check for opposition
    require!(
        market.yes_pool > 0 && market.no_pool > 0,
        PredictionMarketError::NoOpposition
    );

    // Resolve market
    market.state = MarketState::Resolved;
    market.winning_outcome = winning_outcome;

    msg!("Market resolved");
    msg!("Market ID: {}", market.id);
    msg!("Winning Outcome: {:?}", winning_outcome);
    msg!("YES Pool: {}", market.yes_pool);
    msg!("NO Pool: {}", market.no_pool);

    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

use crate::constants::{
    resolution_in_window, FOUNDER_BPS, SETTLE_CLOSE_AT_T, SETTLE_FIRST_PRINT,
};
use crate::error::PredictionMarketError;
use crate::state::{Config, Market, MarketState, Outcome, Rake};

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump,
        constraint = !config.paused @ PredictionMarketError::Paused
    )]
    pub config: Account<'info, Config>,

    #[account(seeds = [Rake::SEED], bump = rake.bump)]
    pub rake: Account<'info, Rake>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [Market::SEED, (config.market_counter + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = creator,
        seeds = [Market::VAULT_SEED, (config.market_counter + 1).to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = market
    )]
    pub market_vault: Account<'info, TokenAccount>,

    #[account(constraint = token_mint.key() == config.token_mint)]
    pub token_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = creator
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(mut, token::mint = token_mint)]
    pub fee_recipient_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateMarket>,
    fomo_user_id: [u8; 16],
    threshold_usd: i64,
    resolution_time: i64,
    start_pnl_usd: i64,
    fee_amount: u64,
    settle_kind: u8,
) -> Result<()> {
    require!(fomo_user_id != [0u8; 16], PredictionMarketError::InvalidFomoUserId);
    require!(
        settle_kind == SETTLE_CLOSE_AT_T || settle_kind == SETTLE_FIRST_PRINT,
        PredictionMarketError::InvalidSettleKind
    );
    require!(
        start_pnl_usd < threshold_usd,
        PredictionMarketError::AlreadyAboveThreshold
    );

    let clock = Clock::get()?;
    require!(
        resolution_in_window(clock.unix_timestamp, resolution_time),
        PredictionMarketError::InvalidResolutionTime
    );

    if fee_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.creator_token_account.to_account_info(),
            to: ctx.accounts.fee_recipient_token_account.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            fee_amount,
        )?;
    }

    let config = &mut ctx.accounts.config;
    config.market_counter = config
        .market_counter
        .checked_add(1)
        .ok_or(PredictionMarketError::Overflow)?;

    let market = &mut ctx.accounts.market;
    market.market_id = config.market_counter;
    market.creator = ctx.accounts.creator.key();
    market.fomo_user_id = fomo_user_id;
    market.window = settle_kind;
    market.threshold_usd = threshold_usd;
    market.resolution_time = resolution_time;
    market.start_pnl_usd = start_pnl_usd;
    market.created_at = clock.unix_timestamp;
    market.end_pnl_usd = 0;
    market.captured_at = 0;
    market.state = MarketState::Active;
    market.winning_outcome = Outcome::None;
    market.yes_pool = 0;
    market.no_pool = 0;
    market.fee_amount = fee_amount;
    market.rake_bps = ctx.accounts.rake.rake_bps;
    market.burn_bps = ctx.accounts.rake.burn_bps;
    market.agent_bps = ctx.accounts.rake.agent_bps;
    market.creator_bps = ctx.accounts.rake.creator_bps;
    market.founder_bps = FOUNDER_BPS;
    market.rake_total = 0;
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.market_vault;
    Ok(())
}

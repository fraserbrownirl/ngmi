use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

use crate::error::PredictionMarketError;
use crate::state::{Config, Market, MarketState, Outcome, UserPosition};

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump,
        constraint = !config.paused @ PredictionMarketError::Paused
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [Market::SEED, market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.state == MarketState::Active @ PredictionMarketError::MarketNotActive
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [Market::VAULT_SEED, market_id.to_le_bytes().as_ref()],
        bump = market.vault_bump
    )]
    pub market_vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = bettor,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [UserPosition::SEED, market_id.to_le_bytes().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    /// Bettor's token account
    #[account(
        mut,
        token::mint = config.token_mint,
        token::authority = bettor
    )]
    pub bettor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<PlaceBet>,
    market_id: u64,
    outcome: Outcome,
    amount: u64,
) -> Result<()> {
    // Validations
    require!(amount > 0, PredictionMarketError::ZeroAmount);
    require!(
        outcome == Outcome::Yes || outcome == Outcome::No,
        PredictionMarketError::InvalidOutcome
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < ctx.accounts.market.resolution_time,
        PredictionMarketError::MarketExpired
    );

    // Transfer tokens to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.bettor_token_account.to_account_info(),
        to: ctx.accounts.market_vault.to_account_info(),
        authority: ctx.accounts.bettor.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    transfer(cpi_ctx, amount)?;

    // Update market pools
    let market = &mut ctx.accounts.market;
    if outcome == Outcome::Yes {
        market.yes_pool = market
            .yes_pool
            .checked_add(amount)
            .ok_or(PredictionMarketError::Overflow)?;
    } else {
        market.no_pool = market
            .no_pool
            .checked_add(amount)
            .ok_or(PredictionMarketError::Overflow)?;
    }

    // Update user position
    let position = &mut ctx.accounts.user_position;
    if position.market_id == 0 {
        // New position
        position.market_id = market_id;
        position.user = ctx.accounts.bettor.key();
        position.yes_bet = 0;
        position.no_bet = 0;
        position.claimed = false;
        position.bump = ctx.bumps.user_position;
    }

    if outcome == Outcome::Yes {
        position.yes_bet = position
            .yes_bet
            .checked_add(amount)
            .ok_or(PredictionMarketError::Overflow)?;
    } else {
        position.no_bet = position
            .no_bet
            .checked_add(amount)
            .ok_or(PredictionMarketError::Overflow)?;
    }

    msg!("Bet placed");
    msg!("Market ID: {}", market_id);
    msg!("Outcome: {:?}", outcome);
    msg!("Amount: {}", amount);
    msg!("YES Pool: {}", market.yes_pool);
    msg!("NO Pool: {}", market.no_pool);

    Ok(())
}

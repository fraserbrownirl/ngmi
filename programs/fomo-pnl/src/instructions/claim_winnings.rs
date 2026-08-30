use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

use crate::error::PredictionMarketError;
use crate::state::{Market, MarketState, Outcome, UserPosition};

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [Market::SEED, market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.state != MarketState::Active @ PredictionMarketError::MarketNotFinalized
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [Market::VAULT_SEED, market_id.to_le_bytes().as_ref()],
        bump = market.vault_bump
    )]
    pub market_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [UserPosition::SEED, market_id.to_le_bytes().as_ref(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.user == user.key() @ PredictionMarketError::InvalidAdmin,
        constraint = !user_position.claimed @ PredictionMarketError::AlreadyClaimed
    )]
    pub user_position: Account<'info, UserPosition>,

    /// User's token account
    #[account(
        mut,
        token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimWinnings>, market_id: u64) -> Result<()> {
    let market = &ctx.accounts.market;
    let position = &ctx.accounts.user_position;

    // Check user has a position
    require!(
        position.yes_bet > 0 || position.no_bet > 0,
        PredictionMarketError::NoPosition
    );

    // Calculate payout
    let payout: u64;

    if market.state == MarketState::Resolved {
        if market.winning_outcome == Outcome::Yes && position.yes_bet > 0 {
            // User bet on YES and YES won
            let winning_pool = market.yes_pool;
            let losing_pool = market.no_pool;
            // payout = user_bet + (user_bet * losing_pool) / winning_pool
            let share = (position.yes_bet as u128)
                .checked_mul(losing_pool as u128)
                .ok_or(PredictionMarketError::Overflow)?
                .checked_div(winning_pool as u128)
                .ok_or(PredictionMarketError::Overflow)?;
            payout = position
                .yes_bet
                .checked_add(share as u64)
                .ok_or(PredictionMarketError::Overflow)?;
        } else if market.winning_outcome == Outcome::No && position.no_bet > 0 {
            // User bet on NO and NO won
            let winning_pool = market.no_pool;
            let losing_pool = market.yes_pool;
            let share = (position.no_bet as u128)
                .checked_mul(losing_pool as u128)
                .ok_or(PredictionMarketError::Overflow)?
                .checked_div(winning_pool as u128)
                .ok_or(PredictionMarketError::Overflow)?;
            payout = position
                .no_bet
                .checked_add(share as u64)
                .ok_or(PredictionMarketError::Overflow)?;
        } else {
            // User bet on losing side
            payout = 0;
        }
    } else {
        // Cancelled - full refund
        payout = position
            .yes_bet
            .checked_add(position.no_bet)
            .ok_or(PredictionMarketError::Overflow)?;
    }

    // Mark as claimed
    ctx.accounts.user_position.claimed = true;

    // Transfer payout if any
    if payout > 0 {
        let market_id_bytes = market_id.to_le_bytes();
        let seeds = &[Market::SEED, market_id_bytes.as_ref(), &[market.bump]];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.market_vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.market.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        transfer(cpi_ctx, payout)?;
    }

    msg!("Winnings claimed");
    msg!("Market ID: {}", market_id);
    msg!("User: {}", ctx.accounts.user.key());
    msg!("Payout: {}", payout);

    Ok(())
}

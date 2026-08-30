use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

use crate::constants::MAX_QUESTION_LENGTH;
use crate::error::PredictionMarketError;
use crate::state::{Config, Market, MarketState, Outcome};

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

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [Market::SEED, (config.market_counter + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,

    /// Market vault for holding tokens
    #[account(
        init,
        payer = creator,
        seeds = [Market::VAULT_SEED, (config.market_counter + 1).to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = market
    )]
    pub market_vault: Account<'info, TokenAccount>,

    /// Token mint
    #[account(
        constraint = token_mint.key() == config.token_mint
    )]
    pub token_mint: Account<'info, anchor_spl::token::Mint>,

    /// Creator's token account (for fee payment)
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = creator
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// Fee recipient's token account
    #[account(
        mut,
        token::mint = token_mint
    )]
    pub fee_recipient_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateMarket>,
    question: String,
    resolution_time: i64,
    fee_amount: u64,
) -> Result<()> {
    // Validations
    require!(!question.is_empty(), PredictionMarketError::EmptyQuestion);
    require!(
        question.len() <= MAX_QUESTION_LENGTH,
        PredictionMarketError::QuestionTooLong
    );

    let clock = Clock::get()?;
    require!(
        resolution_time > clock.unix_timestamp,
        PredictionMarketError::InvalidResolutionTime
    );

    // Transfer fee if applicable
    if fee_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.creator_token_account.to_account_info(),
            to: ctx.accounts.fee_recipient_token_account.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer(cpi_ctx, fee_amount)?;
    }

    // Increment market counter
    let config = &mut ctx.accounts.config;
    config.market_counter = config
        .market_counter
        .checked_add(1)
        .ok_or(PredictionMarketError::Overflow)?;

    // Create market
    let market = &mut ctx.accounts.market;
    market.id = config.market_counter;
    market.question = question;
    market.resolution_time = resolution_time;
    market.state = MarketState::Active;
    market.winning_outcome = Outcome::None;
    market.yes_pool = 0;
    market.no_pool = 0;
    market.creation_fee = fee_amount;
    market.creator = ctx.accounts.creator.key();
    market.created_at = clock.unix_timestamp;
    market.config_fee_recipient = config.fee_recipient;
    market.config_max_fee_bps = config.max_fee_bps;
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.market_vault;

    msg!("Market created");
    msg!("Market ID: {}", market.id);
    msg!("Question: {}", market.question);
    msg!("Resolution Time: {}", market.resolution_time);

    Ok(())
}

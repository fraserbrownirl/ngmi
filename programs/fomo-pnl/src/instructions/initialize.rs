use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::constants::MAX_FEE_LIMIT;
use crate::error::PredictionMarketError;
use crate::state::Config;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [Config::SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    /// The SPL token mint for betting
    pub token_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, fee_recipient: Pubkey, max_fee_bps: u16) -> Result<()> {
    require!(
        max_fee_bps <= MAX_FEE_LIMIT,
        PredictionMarketError::InvalidFee
    );

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.fee_recipient = fee_recipient;
    config.token_mint = ctx.accounts.token_mint.key();
    config.token_decimals = ctx.accounts.token_mint.decimals;
    config.max_fee_bps = max_fee_bps;
    config.market_counter = 0;
    config.paused = false;
    config.bump = ctx.bumps.config;

    msg!("Prediction Market initialized");
    msg!("Admin: {}", config.admin);
    msg!("Token Mint: {}", config.token_mint);
    msg!("Max Fee BPS: {}", config.max_fee_bps);

    Ok(())
}

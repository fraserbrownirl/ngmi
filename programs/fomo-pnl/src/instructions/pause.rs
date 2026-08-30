use anchor_lang::prelude::*;

use crate::error::PredictionMarketError;
use crate::state::Config;

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(
        constraint = admin.key() == config.admin @ PredictionMarketError::InvalidAdmin
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
}

pub fn pause_handler(ctx: Context<Pause>) -> Result<()> {
    require!(!ctx.accounts.config.paused, PredictionMarketError::Paused);

    ctx.accounts.config.paused = true;
    msg!("Contract paused");

    Ok(())
}

pub fn unpause_handler(ctx: Context<Pause>) -> Result<()> {
    require!(ctx.accounts.config.paused, PredictionMarketError::NotPaused);

    ctx.accounts.config.paused = false;
    msg!("Contract unpaused");

    Ok(())
}

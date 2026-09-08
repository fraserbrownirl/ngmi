use anchor_lang::prelude::*;

use crate::error::PredictionMarketError;
use crate::state::Config;

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(constraint = admin.key() == config.admin @ PredictionMarketError::InvalidAdmin)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    require!(
        new_admin != Pubkey::default(),
        PredictionMarketError::InvalidAdmin
    );
    require!(
        new_admin != ctx.accounts.config.admin,
        PredictionMarketError::InvalidAdmin
    );
    ctx.accounts.config.pending_admin = new_admin;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(
        constraint = pending.key() == config.pending_admin @ PredictionMarketError::InvalidAdmin,
        constraint = config.pending_admin != Pubkey::default() @ PredictionMarketError::InvalidAdmin
    )]
    pub pending: Signer<'info>,

    #[account(mut, seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn accept_handler(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = config.pending_admin;
    config.pending_admin = Pubkey::default();
    Ok(())
}

use anchor_lang::prelude::*;

use crate::error::PredictionMarketError;
use crate::state::Config;

#[derive(Accounts)]
pub struct SetResolver<'info> {
    #[account(constraint = admin.key() == config.admin @ PredictionMarketError::InvalidAdmin)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<SetResolver>, resolver: Pubkey) -> Result<()> {
    require!(
        resolver != Pubkey::default(),
        PredictionMarketError::InvalidResolver
    );
    ctx.accounts.config.resolver = resolver;
    Ok(())
}

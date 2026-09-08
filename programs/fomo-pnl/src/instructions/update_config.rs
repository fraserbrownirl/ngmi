use anchor_lang::prelude::*;

use crate::error::PredictionMarketError;
use crate::state::Config;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(constraint = admin.key() == config.admin @ PredictionMarketError::InvalidAdmin)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<UpdateConfig>, fee_recipient: Pubkey) -> Result<()> {
    ctx.accounts.config.fee_recipient = fee_recipient;
    Ok(())
}

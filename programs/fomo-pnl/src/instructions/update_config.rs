use anchor_lang::prelude::*;

use crate::constants::MAX_FEE_LIMIT;
use crate::error::PredictionMarketError;
use crate::state::Config;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
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

pub fn handler(ctx: Context<UpdateConfig>, fee_recipient: Pubkey, max_fee_bps: u16) -> Result<()> {
    require!(
        max_fee_bps <= MAX_FEE_LIMIT,
        PredictionMarketError::InvalidFee
    );

    let config = &mut ctx.accounts.config;
    config.fee_recipient = fee_recipient;
    config.max_fee_bps = max_fee_bps;

    msg!("Config updated");
    msg!("Fee Recipient: {}", config.fee_recipient);
    msg!("Max Fee BPS: {}", config.max_fee_bps);

    Ok(())
}

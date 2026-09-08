use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

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

    pub token_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, fee_recipient: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.resolver = ctx.accounts.admin.key();
    config.pending_admin = Pubkey::default();
    config.fee_recipient = fee_recipient;
    config.token_mint = ctx.accounts.token_mint.key();
    config.token_decimals = ctx.accounts.token_mint.decimals;
    config.market_counter = 0;
    config.paused = false;
    config.bump = ctx.bumps.config;
    Ok(())
}

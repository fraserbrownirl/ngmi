use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

use crate::error::PredictionMarketError;
use crate::settle::validate_rake;
use crate::state::{Config, Rake};

#[derive(Accounts)]
pub struct InitRake<'info> {
    #[account(
        mut,
        constraint = admin.key() == config.admin @ PredictionMarketError::InvalidAdmin
    )]
    pub admin: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = admin,
        space = 8 + Rake::INIT_SPACE,
        seeds = [Rake::SEED],
        bump
    )]
    pub rake: Account<'info, Rake>,

    #[account(constraint = token_mint.key() == config.token_mint)]
    pub token_mint: Account<'info, Mint>,

    #[account(token::mint = token_mint)]
    pub burn_treasury: Account<'info, TokenAccount>,

    #[account(
        token::mint = token_mint,
        constraint = agent_treasury.key() != burn_treasury.key() @ PredictionMarketError::InvalidTokenAccount
    )]
    pub agent_treasury: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitRake>,
    owner: Pubkey,
    founder: Pubkey,
    rake_bps: u16,
    burn_bps: u16,
    agent_bps: u16,
    creator_bps: u16,
) -> Result<()> {
    require!(owner != Pubkey::default(), PredictionMarketError::InvalidRakeOwner);
    require!(founder != Pubkey::default(), PredictionMarketError::InvalidFounder);
    validate_rake(rake_bps, burn_bps, agent_bps, creator_bps)
        .map_err(|e| error!(e))?;

    let rake = &mut ctx.accounts.rake;
    rake.owner = owner;
    rake.pending_owner = Pubkey::default();
    rake.founder = founder;
    rake.burn_treasury = ctx.accounts.burn_treasury.key();
    rake.agent_treasury = ctx.accounts.agent_treasury.key();
    rake.rake_bps = rake_bps;
    rake.burn_bps = burn_bps;
    rake.agent_bps = agent_bps;
    rake.creator_bps = creator_bps;
    rake.bump = ctx.bumps.rake;
    Ok(())
}

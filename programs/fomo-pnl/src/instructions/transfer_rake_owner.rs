use anchor_lang::prelude::*;

use crate::error::PredictionMarketError;
use crate::state::Rake;

#[derive(Accounts)]
pub struct TransferRakeOwner<'info> {
    #[account(constraint = owner.key() == rake.owner @ PredictionMarketError::InvalidRakeOwner)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [Rake::SEED], bump = rake.bump)]
    pub rake: Account<'info, Rake>,
}

pub fn handler(ctx: Context<TransferRakeOwner>, new_owner: Pubkey) -> Result<()> {
    require!(new_owner != Pubkey::default(), PredictionMarketError::InvalidRakeOwner);
    require!(new_owner != ctx.accounts.rake.owner, PredictionMarketError::InvalidRakeOwner);
    ctx.accounts.rake.pending_owner = new_owner;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptRakeOwner<'info> {
    #[account(
        constraint = pending.key() == rake.pending_owner @ PredictionMarketError::InvalidRakeOwner,
        constraint = rake.pending_owner != Pubkey::default() @ PredictionMarketError::InvalidRakeOwner
    )]
    pub pending: Signer<'info>,

    #[account(mut, seeds = [Rake::SEED], bump = rake.bump)]
    pub rake: Account<'info, Rake>,
}

pub fn accept_handler(ctx: Context<AcceptRakeOwner>) -> Result<()> {
    let rake = &mut ctx.accounts.rake;
    rake.owner = rake.pending_owner;
    rake.pending_owner = Pubkey::default();
    Ok(())
}

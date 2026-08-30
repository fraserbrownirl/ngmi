use anchor_lang::prelude::*;

use crate::error::PredictionMarketError;
use crate::state::Rake;

#[derive(Accounts)]
pub struct SetFounder<'info> {
    #[account(constraint = founder.key() == rake.founder @ PredictionMarketError::InvalidFounder)]
    pub founder: Signer<'info>,

    #[account(mut, seeds = [Rake::SEED], bump = rake.bump)]
    pub rake: Account<'info, Rake>,
}

pub fn handler(ctx: Context<SetFounder>, new_founder: Pubkey) -> Result<()> {
    require!(new_founder != Pubkey::default(), PredictionMarketError::InvalidFounder);
    ctx.accounts.rake.founder = new_founder;
    Ok(())
}

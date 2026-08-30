use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Rake {
    pub owner: Pubkey,
    /// `Pubkey::default()` means no pending transfer.
    pub pending_owner: Pubkey,
    pub founder: Pubkey,
    pub burn_treasury: Pubkey,
    pub agent_treasury: Pubkey,
    pub rake_bps: u16,
    pub burn_bps: u16,
    pub agent_bps: u16,
    pub creator_bps: u16,
    pub bump: u8,
}

impl Rake {
    pub const SEED: &'static [u8] = b"rake";
}

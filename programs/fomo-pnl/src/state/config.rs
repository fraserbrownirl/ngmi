use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub resolver: Pubkey,
    /// Pending admin set by transfer_admin; accept_admin rotates it in.
    pub pending_admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub token_mint: Pubkey,
    pub token_decimals: u8,
    pub market_counter: u64,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = b"config";
}

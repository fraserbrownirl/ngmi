use anchor_lang::prelude::*;

/// User position in a market
#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    /// Market ID
    pub market_id: u64,
    /// User pubkey
    pub user: Pubkey,
    /// Amount bet on YES
    pub yes_bet: u64,
    /// Amount bet on NO
    pub no_bet: u64,
    /// Has user claimed
    pub claimed: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl UserPosition {
    pub const SEED: &'static [u8] = b"position";
}

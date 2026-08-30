use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub market_id: u64,
    pub user: Pubkey,
    pub yes_bet: u64,
    pub no_bet: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl UserPosition {
    pub const SEED: &'static [u8] = b"position";
}

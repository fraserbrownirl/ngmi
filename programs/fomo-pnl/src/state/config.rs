use anchor_lang::prelude::*;

/// Global configuration account for the prediction market
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Admin authority
    pub admin: Pubkey,
    /// Fee recipient
    pub fee_recipient: Pubkey,
    /// SPL token mint for betting
    pub token_mint: Pubkey,
    /// Token decimals
    pub token_decimals: u8,
    /// Max fee percentage in basis points (100 = 1%)
    pub max_fee_bps: u16,
    /// Total markets created
    pub market_counter: u64,
    /// Paused flag
    pub paused: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = b"config";
}

use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketState {
    Active,
    Resolved,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Outcome {
    None,
    Yes,
    No,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub market_id: u64,
    pub creator: Pubkey,
    pub fomo_user_id: [u8; 16],
    /// 0 = close-at-T, 1 = first print over the mark. FomoScan window is always `all`.
    pub window: u8,
    pub threshold_usd: i64,
    pub resolution_time: i64,
    pub start_pnl_usd: i64,
    pub created_at: i64,
    pub end_pnl_usd: i64,
    pub captured_at: i64,
    pub state: MarketState,
    pub winning_outcome: Outcome,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub fee_amount: u64,
    /// Snapshotted at create. Later `set_rake` does not rewrite open pots.
    pub rake_bps: u16,
    pub burn_bps: u16,
    pub agent_bps: u16,
    pub creator_bps: u16,
    pub founder_bps: u16,
    /// Written at resolve. Sum of the four floor slices.
    pub rake_total: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Market {
    pub const SEED: &'static [u8] = b"market";
    pub const VAULT_SEED: &'static [u8] = b"vault";
}

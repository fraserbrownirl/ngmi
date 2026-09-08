use anchor_lang::prelude::*;

#[error_code]
pub enum PredictionMarketError {
    #[msg("Invalid admin")]
    InvalidAdmin,
    #[msg("Invalid resolver")]
    InvalidResolver,
    #[msg("Invalid fee")]
    InvalidFee,
    #[msg("Invalid rake owner")]
    InvalidRakeOwner,
    #[msg("Invalid founder")]
    InvalidFounder,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Paused")]
    Paused,
    #[msg("Not paused")]
    NotPaused,
    #[msg("Invalid resolution time")]
    InvalidResolutionTime,
    #[msg("Start PnL already meets or exceeds threshold")]
    AlreadyAboveThreshold,
    #[msg("Invalid outcome")]
    InvalidOutcome,
    #[msg("Invalid FOMO user id")]
    InvalidFomoUserId,
    #[msg("Market not found")]
    MarketNotFound,
    #[msg("Market is not active")]
    MarketNotActive,
    #[msg("Market is not resolved")]
    MarketNotResolved,
    #[msg("Market is not finalized")]
    MarketNotFinalized,
    #[msg("Market already finalized")]
    MarketAlreadyFinalized,
    #[msg("Resolution time has not been reached")]
    MarketNotExpired,
    #[msg("Betting window has closed")]
    MarketExpired,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("No position")]
    NoPosition,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Zero amount")]
    ZeroAmount,
    #[msg("Invalid settle kind")]
    InvalidSettleKind,
    #[msg("Invalid position owner")]
    InvalidOwner,
    #[msg("Captured timestamp outside market window")]
    InvalidCapturedAt,
}

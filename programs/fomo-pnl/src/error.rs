use anchor_lang::prelude::*;

#[error_code]
pub enum PredictionMarketError {
    #[msg("Contract is paused")]
    Paused,
    #[msg("Contract is not paused")]
    NotPaused,
    #[msg("Invalid admin")]
    InvalidAdmin,
    #[msg("Invalid fee percentage")]
    InvalidFee,
    #[msg("Invalid resolution time")]
    InvalidResolutionTime,
    #[msg("Empty question")]
    EmptyQuestion,
    #[msg("Question too long")]
    QuestionTooLong,
    #[msg("Market not found")]
    MarketNotFound,
    #[msg("Market not active")]
    MarketNotActive,
    #[msg("Market already finalized")]
    MarketAlreadyFinalized,
    #[msg("Market not finalized")]
    MarketNotFinalized,
    #[msg("Market expired")]
    MarketExpired,
    #[msg("Market not expired")]
    MarketNotExpired,
    #[msg("Invalid outcome")]
    InvalidOutcome,
    #[msg("No opposition in market")]
    NoOpposition,
    #[msg("Zero amount")]
    ZeroAmount,
    #[msg("No position")]
    NoPosition,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Overflow error")]
    Overflow,
}

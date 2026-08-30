pub mod cancel_market;
pub mod claim_winnings;
pub mod create_market;
pub mod initialize;
pub mod pause;
pub mod place_bet;
pub mod resolve_market;
pub mod update_config;

// Re-export everything - the `handler` functions conflict but we access them via full paths
#[allow(ambiguous_glob_reexports)]
pub use cancel_market::*;
#[allow(ambiguous_glob_reexports)]
pub use claim_winnings::*;
#[allow(ambiguous_glob_reexports)]
pub use create_market::*;
#[allow(ambiguous_glob_reexports)]
pub use initialize::*;
#[allow(ambiguous_glob_reexports)]
pub use pause::*;
#[allow(ambiguous_glob_reexports)]
pub use place_bet::*;
#[allow(ambiguous_glob_reexports)]
pub use resolve_market::*;
#[allow(ambiguous_glob_reexports)]
pub use update_config::*;

use crate::constants::{FOUNDER_BPS, MAX_FEE_LIMIT};
use crate::error::PredictionMarketError;
use crate::state::Outcome;

/// Floor `amount * bps / 10_000`.
pub fn bps_of(amount: u64, bps: u16) -> Result<u64, PredictionMarketError> {
    (amount as u128)
        .checked_mul(bps as u128)
        .and_then(|v| v.checked_div(10_000))
        .map(|v| v as u64)
        .ok_or(PredictionMarketError::Overflow)
}

pub fn validate_rake(
    rake_bps: u16,
    burn_bps: u16,
    agent_bps: u16,
    creator_bps: u16,
) -> Result<(), PredictionMarketError> {
    if rake_bps < FOUNDER_BPS || rake_bps > MAX_FEE_LIMIT {
        return Err(PredictionMarketError::InvalidFee);
    }
    let sum = FOUNDER_BPS as u32 + burn_bps as u32 + agent_bps as u32 + creator_bps as u32;
    if sum != rake_bps as u32 {
        return Err(PredictionMarketError::InvalidFee);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RakeSplit {
    pub founder: u64,
    pub burn: u64,
    pub agent: u64,
    pub creator: u64,
}

impl RakeSplit {
    pub fn total(self) -> Result<u64, PredictionMarketError> {
        self.founder
            .checked_add(self.burn)
            .and_then(|v| v.checked_add(self.agent))
            .and_then(|v| v.checked_add(self.creator))
            .ok_or(PredictionMarketError::Overflow)
    }
}

pub fn rake_split(
    losing_pool: u64,
    founder_bps: u16,
    burn_bps: u16,
    agent_bps: u16,
    creator_bps: u16,
) -> Result<RakeSplit, PredictionMarketError> {
    Ok(RakeSplit {
        founder: bps_of(losing_pool, founder_bps)?,
        burn: bps_of(losing_pool, burn_bps)?,
        agent: bps_of(losing_pool, agent_bps)?,
        creator: bps_of(losing_pool, creator_bps)?,
    })
}

pub fn rake_total(
    losing_pool: u64,
    founder_bps: u16,
    burn_bps: u16,
    agent_bps: u16,
    creator_bps: u16,
) -> Result<u64, PredictionMarketError> {
    rake_split(losing_pool, founder_bps, burn_bps, agent_bps, creator_bps)?.total()
}

/// YES iff end PnL meets or exceeds the locked threshold. Shared with EVM.
pub fn winning_outcome(end_pnl_usd: i64, threshold_usd: i64) -> Outcome {
    if end_pnl_usd >= threshold_usd {
        Outcome::Yes
    } else {
        Outcome::No
    }
}

/// Close-at-T waits for the deadline. First-print may resolve as soon as the posted PnL is over.
pub fn can_resolve_now(
    now: i64,
    resolution_time: i64,
    settle_kind: u8,
    end_pnl_usd: i64,
    threshold_usd: i64,
) -> bool {
    now >= resolution_time
        || (settle_kind == crate::constants::SETTLE_FIRST_PRINT && end_pnl_usd >= threshold_usd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equality_is_yes() {
        assert_eq!(winning_outcome(100_000_000, 100_000_000), Outcome::Yes);
    }

    #[test]
    fn below_is_no() {
        assert_eq!(winning_outcome(99_999_999, 100_000_000), Outcome::No);
    }

    #[test]
    fn above_is_yes() {
        assert_eq!(winning_outcome(101, 100), Outcome::Yes);
    }

    #[test]
    fn first_print_may_resolve_before_t() {
        use crate::constants::{SETTLE_CLOSE_AT_T, SETTLE_FIRST_PRINT};
        assert!(can_resolve_now(5, 10, SETTLE_FIRST_PRINT, 100, 100));
        assert!(!can_resolve_now(5, 10, SETTLE_FIRST_PRINT, 99, 100));
        assert!(!can_resolve_now(5, 10, SETTLE_CLOSE_AT_T, 200, 100));
        assert!(can_resolve_now(10, 10, SETTLE_CLOSE_AT_T, 50, 100));
    }
}

#[cfg(test)]
mod rake_tests {
    use super::*;
    use crate::constants::FOUNDER_BPS;

    #[test]
    fn five_percent_split_on_400() {
        assert!(validate_rake(500, 300, 100, 50).is_ok());
        assert_eq!(bps_of(400_000_000, 500).unwrap(), 20_000_000);
        assert_eq!(bps_of(400_000_000, FOUNDER_BPS).unwrap(), 2_000_000);
        assert_eq!(bps_of(400_000_000, 300).unwrap(), 12_000_000);
        assert_eq!(bps_of(400_000_000, 100).unwrap(), 4_000_000);
        assert_eq!(bps_of(400_000_000, 50).unwrap(), 2_000_000);
        assert_eq!(rake_total(400_000_000, 50, 300, 100, 50).unwrap(), 20_000_000);
    }

    #[test]
    fn rejects_below_founder_floor() {
        assert!(validate_rake(49, 0, 0, 0).is_err());
        assert!(validate_rake(500, 400, 100, 50).is_err());
        assert!(validate_rake(1001, 800, 100, 51).is_err());
    }
}

#[cfg(test)]
mod window_tests {
    use crate::constants::{resolution_in_window, MAX_RESOLUTION_WINDOW_SECS};

    #[test]
    fn two_days_ok() {
        let now = 1_700_000_000;
        assert!(resolution_in_window(now, now + 1));
        assert!(resolution_in_window(now, now + MAX_RESOLUTION_WINDOW_SECS));
        assert!(!resolution_in_window(now, now));
        assert!(!resolution_in_window(now, now + MAX_RESOLUTION_WINDOW_SECS + 1));
    }
}

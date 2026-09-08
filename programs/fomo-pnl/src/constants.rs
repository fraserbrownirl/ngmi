pub const MAX_FEE_LIMIT: u16 = 1000;
/// Immutable founder slice of the losing pool. Not an instruction argument.
pub const FOUNDER_BPS: u16 = 50;
/// FomoScan `window=all`. Also the on-chain close-at-T settle kind.
pub const WINDOW_ALL: u8 = 0;
pub const SETTLE_CLOSE_AT_T: u8 = 0;
/// First board print over the mark settles YES before T.
pub const SETTLE_FIRST_PRINT: u8 = 1;
/// Longest a new pot may run. Keeps the handle on the live board.
pub const MAX_RESOLUTION_WINDOW_SECS: i64 = 3 * 24 * 60 * 60;
/// Tolerance (seconds) for resolver-supplied captured_at ahead of chain time.
pub const MAX_CAPTURE_SKEW_SECS: i64 = 300;

pub fn resolution_in_window(now: i64, resolution_time: i64) -> bool {
    resolution_time > now
        && resolution_time
            <= now
                .checked_add(MAX_RESOLUTION_WINDOW_SECS)
                .unwrap_or(i64::MAX)
}

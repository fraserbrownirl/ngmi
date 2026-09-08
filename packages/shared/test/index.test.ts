import { describe, it, expect } from "vitest";
import {
  bpsOf,
  canCreate,
  canOpenByRank,
  canOpenByTime,
  CREATE_MAX_RANK,
  DEFAULT_RAKE_BPS,
  FOUNDER_BPS,
  isFirstPrint,
  isYes,
  MAX_RESOLUTION_SECS,
  SETTLE_FIRST_PRINT,
  fomoUserIdToBytes,
  bytesToFomoUserId,
  rakeAmount,
  sendWithRetry,
  usdToMicro,
  validateRake,
  winnerPayoutAfterRake,
} from "../src/index.ts";

describe("shared schema", () => {
  it("create requires start below threshold", () => {
    expect(canCreate(99n, 100n)).toBe(true);
    expect(canCreate(100n, 100n)).toBe(false);
  });

  it("first-print kind is 1", () => {
    expect(isFirstPrint(SETTLE_FIRST_PRINT)).toBe(true);
    expect(isFirstPrint(0)).toBe(false);
  });

  it("equality is YES", () => {
    expect(isYes(100n, 100n)).toBe(true);
    expect(isYes(99n, 100n)).toBe(false);
  });

  it("roundtrips fomo user ids", () => {
    const id = "aefe2ddd-c580-5245-a2f5-e4ed62f7ef10";
    expect(bytesToFomoUserId(fomoUserIdToBytes(id))).toBe(id);
  });

  it("scales usd at 6 decimals", () => {
    expect(usdToMicro(100.5)).toBe(100_500_000n);
  });

  it("opens only on rank 1–25", () => {
    expect(canOpenByRank(1)).toBe(true);
    expect(canOpenByRank(CREATE_MAX_RANK)).toBe(true);
    expect(canOpenByRank(26)).toBe(false);
    expect(canOpenByRank(0)).toBe(false);
  });

  it("caps T at three days", () => {
    const now = 1_700_000_000;
    expect(canOpenByTime(now + 1, now)).toBe(true);
    expect(canOpenByTime(now + MAX_RESOLUTION_SECS, now)).toBe(true);
    expect(canOpenByTime(now, now)).toBe(false);
    expect(canOpenByTime(now + MAX_RESOLUTION_SECS + 1, now)).toBe(false);
  });

  it("rake is 5% of the losing pool in four slices", () => {
    expect(validateRake(DEFAULT_RAKE_BPS, 300, 100, 50)).toBe(true);
    expect(validateRake(49, 0, 0, 0)).toBe(false);
    expect(validateRake(500, 400, 100, 50)).toBe(false);
    expect(bpsOf(100_000_000, DEFAULT_RAKE_BPS)).toBe(5_000_000);
    expect(rakeAmount(100_000_000)).toBe(5_000_000);
    expect(bpsOf(100_000_000, FOUNDER_BPS)).toBe(500_000);
    expect(winnerPayoutAfterRake(200_000_000, 400_000_000, 100_000_000, 5_000_000)).toBe(
      247_500_000,
    );
  });
});

describe("sendWithRetry", () => {
  it("returns the first success without retrying", async () => {
    let calls = 0;
    const out = await sendWithRetry(async () => {
      calls += 1;
      return "ok";
    });
    expect(out).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries throttle errors then succeeds", async () => {
    let calls = 0;
    const out = await sendWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("429 Too Many Requests");
        return "ok";
      },
      { backoffMs: 1 },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry non-throttle errors", async () => {
    let calls = 0;
    await expect(
      sendWithRetry(
        async () => {
          calls += 1;
          throw new Error("TransactionExpiredBlockheightExceeded");
        },
        { backoffMs: 1 },
      ),
    ).rejects.toThrow("TransactionExpiredBlockheightExceeded");
    expect(calls).toBe(1);
  });

  it("gives up after the attempt cap", async () => {
    let calls = 0;
    await expect(
      sendWithRetry(
        async () => {
          calls += 1;
          throw new Error("429");
        },
        { attempts: 3, backoffMs: 1 },
      ),
    ).rejects.toThrow("429");
    expect(calls).toBe(3);
  });
});

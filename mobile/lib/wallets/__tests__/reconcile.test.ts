// lib/wallets/__tests__/reconcile.test.ts — the arithmetic behind cash
// reconciliation (m1c Task 5 rule 5; docs/04-features/02-wallets.md §cash
// Wallet reconciliation).
//
// Three ways to get this wrong, and each one is a different flavour of lying to
// the user about their own money:
//
//   THE TOTAL INSTEAD OF THE DIFFERENCE. Recording ₱500 when the ledger already
//   says ₱600 and the pocket says ₱500 would leave the wallet at ₱100 or
//   ₱1,100 depending on direction. This is the single worst arithmetic error
//   available here, and it is the easy one to write.
//
//   THE WRONG SIGN. Missing cash is money that WAS spent; recording it as
//   income turns a shortfall into a windfall and every spend total with it.
//
//   A ZERO ROW. `CHECK (amount > 0)` in 001_core.sql would reject it anyway, but
//   the real cost is a ledger littered with "₱0.00 Cash reconciliation" entries
//   that say nothing happened, at length.
import { cashAdjustment } from "../reconcile";

describe("cashAdjustment", () => {
  test("a shortfall is recorded as an `out` for the DIFFERENCE", () => {
    // Ledger says ₱600, pocket holds ₱500 → ₱100 left without a notification.
    expect(cashAdjustment(60_000, 50_000)).toEqual({ direction: "out", amount: 10_000 });
  });

  test("a surplus is recorded as an `in` for the DIFFERENCE", () => {
    expect(cashAdjustment(50_000, 60_000)).toEqual({ direction: "in", amount: 10_000 });
  });

  test("the amount is never the physical total", () => {
    const adjustment = cashAdjustment(60_000, 50_000);

    expect(adjustment?.amount).not.toBe(50_000);
    expect(adjustment?.amount).not.toBe(60_000);
  });

  test("exactly equal writes nothing at all", () => {
    expect(cashAdjustment(50_000, 50_000)).toBeNull();
  });

  test("agreement at zero is still agreement", () => {
    // A drained cash wallet the user confirms is empty. `0 - 0` is falsy, so a
    // truthiness check on the difference would be right here by accident and
    // wrong on every other case; a truthiness check on the BALANCES would be
    // wrong here.
    expect(cashAdjustment(0, 0)).toBeNull();
  });

  test("a wallet the ledger thinks is empty but is not", () => {
    expect(cashAdjustment(0, 25_000)).toEqual({ direction: "in", amount: 25_000 });
  });

  test("emptying a wallet the ledger still counts", () => {
    expect(cashAdjustment(25_000, 0)).toEqual({ direction: "out", amount: 25_000 });
  });

  test("a one-centavo gap is still a real gap", () => {
    // No tolerance here on purpose. Drift tolerance is a NOTIFICATION-quality
    // question (docs/04 §14 open question 1, ruleset-tunable); a user who typed
    // a figure has stated a fact, and rounding it away would make the wallet
    // disagree with the number they just entered.
    expect(cashAdjustment(10_001, 10_000)).toEqual({ direction: "out", amount: 1 });
  });

  test("the amount is always positive, whichever way the gap runs", () => {
    // The schema's `CHECK (amount > 0)` rejects a negative outright, so a bare
    // `physical - recorded` handed to the committer fails half the time.
    expect(cashAdjustment(60_000, 50_000)?.amount).toBeGreaterThan(0);
    expect(cashAdjustment(50_000, 60_000)?.amount).toBeGreaterThan(0);
  });
});

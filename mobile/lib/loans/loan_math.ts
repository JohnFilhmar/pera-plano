// lib/loans/loan_math.ts — installment schedules, to the centavo (m2b Task 6;
// docs/04-features/06-loans.md rules 1-4, 11).
//
// PURE. No clock, no database. A schedule is a function of its terms, so every
// case — a February month end, a leap year, a zero-rate family loan, a daily
// 5-6 collector — is an ordinary fixture.
//
// EVERY SCHEDULE BALANCES EXACTLY. The principal column sums to the principal
// and the final balance is zero, always, because the last row ABSORBS the
// accumulated rounding drift. A schedule that ends ₱0.03 short is a bug the
// user notices, cannot explain, and reasonably reads as the app losing money.
//
// TWO SCHEDULE SHAPES, AND ONLY ONE OF THEM HAS INTEREST:
//   `buildAmortizationSchedule` splits each payment into principal and
//   interest on a declining balance (spec rule 1's "amortized").
//   `buildFlatSchedule` splits nothing. Spec rule 4 forbids the app from
//   deriving or displaying an interest rate for 5-6 lending — the interest is
//   already inside the stated installment, and re-deriving it would be the app
//   inventing a number the lender never quoted.
import { addDaysIso, addMonthsClampedIso } from "@/lib/dates";
import type { Centavos, Installment, Loan } from "@/types/domain";

export type ScheduleRow = {
  /** 1-based — the way an installment is spoken about ("the third payment"). */
  index: number;
  dueDate: string;
  payment: Centavos;
  principal: Centavos;
  interest: Centavos;
  balanceAfter: Centavos;
};

/** Nearest centavo, half away from zero. */
function roundCentavos(value: number): Centavos {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * The level installment for an amortized loan (rule 1):
 *
 *     payment = principal × i × (1 + i)^n / ((1 + i)^n − 1)
 *
 * with `i = annualRatePercent / 100 / 12` and `n = termMonths`.
 *
 * ZERO INTEREST IS NOT AN EDGE CASE HERE. At `i = 0` the denominator is zero
 * and the formula yields `NaN`; family lending at no interest is most of the
 * informal borrowing this app will see, so the fallback to `principal / n` is
 * the common path, not a guard.
 */
export function monthlyPayment(
  principal: Centavos,
  annualRatePercent: number,
  termMonths: number,
): Centavos {
  if (termMonths <= 0) return 0;

  const monthlyRate = annualRatePercent / 100 / 12;
  if (monthlyRate === 0) return roundCentavos(principal / termMonths);

  const growth = Math.pow(1 + monthlyRate, termMonths);
  return roundCentavos((principal * monthlyRate * growth) / (growth - 1));
}

/**
 * A declining-balance schedule (spec rule 1's "amortized").
 *
 * THE FINAL ROW IS COMPUTED FROM THE REMAINING BALANCE, not from the level
 * payment. Each row rounds its interest to the centavo, so twelve roundings
 * accumulate a drift of a few centavos; letting the last row pay off exactly
 * whatever is left absorbs all of it at once. That is rule 2, and it is why
 * both the principal sum and the closing balance are exact rather than nearly
 * right.
 *
 * Due dates advance by CALENDAR month with a month-end clamp measured against
 * the ORIGINAL day (rule 3): a loan due the 31st is due the 28th in February
 * and the 31st again in March. An unclamped `setMonth` turns January 31 into
 * March 3 and the schedule silently skips a month.
 */
export function buildAmortizationSchedule(
  principal: Centavos,
  annualRatePercent: number,
  termMonths: number,
  firstDueDate: string,
): ScheduleRow[] {
  if (termMonths <= 0) return [];

  const monthlyRate = annualRatePercent / 100 / 12;
  const payment = monthlyPayment(principal, annualRatePercent, termMonths);

  const rows: ScheduleRow[] = [];
  let balance = principal;

  for (let index = 1; index <= termMonths; index++) {
    const interest = roundCentavos(balance * monthlyRate);
    const isFinal = index === termMonths;
    // The last row clears the balance outright; every other row pays the level
    // installment less that month's interest.
    const principalPortion = isFinal ? balance : Math.min(payment - interest, balance);

    balance -= principalPortion;

    rows.push({
      index,
      // Clamped from the ORIGINAL first due date rather than from the previous
      // row, so a month-end schedule does not walk backwards over a year.
      dueDate: addMonthsClampedIso(firstDueDate, index - 1),
      payment: principalPortion + interest,
      principal: principalPortion,
      interest,
      balanceAfter: balance,
    });
  }

  return rows;
}

/**
 * Equal installments at a fixed interval (spec rule 1's "flat", rule 4's 5-6).
 *
 * EVERY PESO IS PRINCIPAL. There is no rate to split by — the lender stated a
 * total repayable, and the app deriving an implied rate from it is exactly what
 * spec rule 4 forbids ("The app never derives or displays an interest rate for
 * it"). The balance therefore walks down from `installmentAmount × installments`,
 * which is the figure the collector actually named.
 */
export function buildFlatSchedule(
  installmentAmount: Centavos,
  installments: number,
  firstDueDate: string,
  intervalDays: number,
): ScheduleRow[] {
  if (installments <= 0) return [];

  const total = installmentAmount * installments;
  const rows: ScheduleRow[] = [];
  let balance = total;

  for (let index = 1; index <= installments; index++) {
    balance -= installmentAmount;
    rows.push({
      index,
      dueDate: addDaysIso(firstDueDate, (index - 1) * intervalDays),
      payment: installmentAmount,
      principal: installmentAmount,
      interest: 0,
      balanceAfter: balance,
    });
  }

  return rows;
}

/**
 * The part of one installment that comes off the BALANCE.
 *
 * Amortized rows carry a `principalPortion`; flat rows carry none because rule
 * 4 leaves 5-6 with no interest to split off ("EVERY PESO IS PRINCIPAL", see
 * `buildFlatSchedule`). The `??` is therefore the whole difference between the
 * spec's two scheduled kinds, written once — and it is the same fold
 * `app/(tabs)/plan/loans/[id].tsx` already makes for the schedule table's
 * balance column, so the headline balance and that column cannot disagree.
 *
 * THE BALANCE ITSELF STILL COUNTS DOWN FROM `Loan.principal`, not from a sum
 * over these. Rule 2 wants a flat loan's total repayable and an amortized
 * loan's principal, and `principal` IS BOTH ALREADY: `loan_form.tsx` stores
 * `installment * count` for a flat loan (its own comment cites rule 2), and
 * `buildAmortizationSchedule` guarantees the principal column sums to the
 * principal. Summing the schedule instead would look equivalent and is not —
 * nothing makes a stored schedule describe the whole loan, and a partial one
 * would silently shrink the balance to whatever rows happen to be there.
 */
function balancePortionOf(installment: Installment): Centavos {
  return installment.principalPortion ?? installment.amountDue;
}

/**
 * How much of what has been paid comes off the balance.
 *
 * WHY THIS IS NOT SIMPLY THE TOTAL PAID. An amortized installment is principal
 * PLUS interest, and the balance it pays down is denominated in principal
 * alone. Subtracting the whole installment from a principal balance is how a
 * ₱50,000 loan repaid at ₱4,442.44 a month reads as settled after eleven and a
 * bit payments while a twelfth installment is still owed. For flat and
 * free-form loans every peso is principal (rule 4), so this returns the total
 * unchanged and nothing about those two kinds moves.
 *
 * INTEREST FIRST WITHIN A PART-PAID INSTALLMENT, which is how a lender applies
 * one, and it keeps the reduction inside `[0, principalPortion]` so a partial
 * payment can never clear more principal than the row it landed on holds.
 *
 * ANYTHING BEYOND THE LAST INSTALLMENT COUNTS IN FULL (rule 11: "an
 * overpayment applies the excess to the balance"). Without that tail a loan
 * whose lender added a late fee (rule 20) could be paid off and still never
 * reach zero.
 */
export function principalApplied(
  schedule: Installment[] | null,
  totalPaid: Centavos,
): Centavos {
  if (schedule === null || schedule.length === 0) return Math.max(0, totalPaid);

  // Date order, not array order — the same reason `nextDue` sorts below.
  const ordered = [...schedule].sort((a: Installment, b: Installment) =>
    a.dueDate.localeCompare(b.dueDate),
  );

  let covered = totalPaid;
  let applied = 0;

  for (const installment of ordered) {
    if (covered <= 0) break;

    const principalPortion = balancePortionOf(installment);
    if (covered >= installment.amountDue) {
      applied += principalPortion;
      covered -= installment.amountDue;
      continue;
    }

    const interestPortion = installment.amountDue - principalPortion;
    applied += Math.max(0, Math.min(principalPortion, covered - interestPortion));
    covered = 0;
  }

  return applied + Math.max(0, covered);
}

/**
 * The next installment still owed, or `null` when there is nothing to be due.
 *
 * TAKES THE TOTAL PAID, NOT THE PAYMENT ROWS. The m2b plan's signature is
 * `nextDue(loan, payments: LoanPayment[], now)`, and neither of those extra
 * arguments can do its job: `LoanPayment` has no amount (001_core.sql's
 * `loan_payments` has no such column — the amount lives on the linked ledger
 * transaction), and "the earliest unpaid row" does not depend on the current
 * time at all. `loans_repo.outstandingBalance` is where the total comes from.
 *
 * A PARTIAL PAYMENT DOES NOT ADVANCE THE DATE (spec rule 11): the row it
 * partially covered is still the next one due, for the remainder. Advancing
 * would report September settled while ₱2,442.44 of it was not.
 */
export function nextDue(
  loan: Loan,
  totalPaid: Centavos,
): { dueDate: string; amount: Centavos } | null {
  const schedule = loan.schedule;
  // Free-form: no schedule, and `nextDueDate`/`nextDueAmount` are the user's to
  // manage (spec rule 1). Inventing one would put a reminder on a promise
  // nobody made.
  if (schedule === null || schedule.length === 0) return null;

  // Date order, not array order — the schedule round-trips through JSON and a
  // hand-edited loan could hold it shuffled. A reminder for a date already past
  // is worse than none.
  const ordered = [...schedule].sort((a: Installment, b: Installment) =>
    a.dueDate.localeCompare(b.dueDate),
  );

  let covered = totalPaid;
  for (const installment of ordered) {
    if (covered >= installment.amountDue) {
      covered -= installment.amountDue;
      continue;
    }
    return { dueDate: installment.dueDate, amount: installment.amountDue - covered };
  }

  // Every installment is covered.
  return null;
}

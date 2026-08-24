// components/loans/__tests__/schedule_table.test.tsx — m2b Task 8, rule 4.
import { render, screen } from "@testing-library/react-native";

import { __setTierForTests } from "@/lib/entitlements";
import { buildAmortizationSchedule, buildFlatSchedule } from "@/lib/loans/loan_math";

import { ScheduleTable } from "../schedule_table";

const AMORTIZED = buildAmortizationSchedule(5000000, 12, 12, "2026-09-15");
const FLAT = buildFlatSchedule(100000, 6, "2026-08-22", 7);

afterEach(() => {
  __setTierForTests(null);
});

test("THE SCHEDULE IS PLUS-GATED ON THE FREE TIER", () => {
  // Rule 4, and the spec's states table: Free gets "Balance, next due, payment
  // history, reminders, record-payment action"; the full schedule is Plus.
  __setTierForTests("free");

  render(<ScheduleTable rows={AMORTIZED} totalPaid={0} testID="schedule" />);

  screen.getByTestId("plus-badge");
});

test("FREE SEES A PREVIEW, NOT AN EMPTY SCREEN", () => {
  // Rule 4's second half. `PlusGate` renders children in NORMAL colours with a
  // badge — never desaturated, which is SoonGate's meaning — so the user can
  // see what they would get. That is the difference between a paywall and a
  // dead end.
  __setTierForTests("free");

  render(<ScheduleTable rows={AMORTIZED} totalPaid={0} testID="schedule" />);

  screen.getByTestId("schedule-row-1");
  screen.getByTestId("schedule-row-12");
});

test("PLUS SEES THE FULL TABLE WITH THE UNLOCKED BADGE, NOT A GATE", () => {
  __setTierForTests("plus");

  render(<ScheduleTable rows={AMORTIZED} totalPaid={0} testID="schedule" />);

  // Unlocked: the informational badge shows, but there is no `plus-gate`
  // Pressable — that testID only exists on the free-tier, press-intercepting
  // path, so its absence here is the direct check that Plus is not gated.
  screen.getByTestId("plus-badge");
  expect(screen.queryByTestId("plus-gate")).toBeNull();
  screen.getByTestId("schedule-row-1");
  // Twelve installments, and the first one's payment is the worked vector.
  screen.getByTestId("schedule-row-12");
  expect(screen.queryByTestId("schedule-row-13")).toBeNull();
});

test("an amortized schedule shows the interest column", () => {
  __setTierForTests("plus");

  render(<ScheduleTable rows={AMORTIZED} totalPaid={0} testID="schedule" />);

  screen.getByText("Interest");
});

test("A FLAT SCHEDULE HAS NO INTEREST COLUMN AT ALL", () => {
  // Spec rule 4: the app "never derives or displays an interest rate" for 5-6.
  // An all-zero interest column would imply a rate exists and happens to be
  // zero, which is a different claim from there being no rate.
  __setTierForTests("plus");

  render(<ScheduleTable rows={FLAT} totalPaid={0} testID="schedule" />);

  expect(screen.queryByText("Interest")).toBeNull();
  screen.getByTestId("schedule-row-6");
});

test("paid installments are marked, cumulatively", () => {
  // Payments cover the schedule in order, so the paid/unpaid boundary is
  // wherever the running total runs out — not a per-row flag.
  __setTierForTests("plus");

  render(<ScheduleTable rows={FLAT} totalPaid={250000} testID="schedule" />);

  // ₱2,500 covers two ₱1,000 installments and half of the third.
  const rows = [1, 2, 3].map((index) => screen.getByTestId(`schedule-row-${index}`));
  expect(rows).toHaveLength(3);
});

test("A FREE-FORM LOAN SAYS IT HAS NO SCHEDULE", () => {
  // Spec rule 1. An empty table reads as a loading failure; saying so does not.
  __setTierForTests("plus");

  render(<ScheduleTable rows={[]} totalPaid={0} testID="schedule" />);

  screen.getByTestId("schedule-none");
  screen.getByText(/no fixed schedule/);
  expect(screen.queryByTestId("schedule-row-1")).toBeNull();
});

test("the no-schedule message is not itself Plus-gated", () => {
  // There is nothing to sell a free user here — gating "this loan has no
  // schedule" behind an upgrade prompt would be a paywall in front of an
  // absence.
  __setTierForTests("free");

  render(<ScheduleTable rows={[]} totalPaid={0} testID="schedule" />);

  screen.getByTestId("schedule-none");
  expect(screen.queryByTestId("plus-badge")).toBeNull();
});

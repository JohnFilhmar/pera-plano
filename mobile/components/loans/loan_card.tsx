// components/loans/loan_card.tsx — m2b Task 8, rule 2.
//
// Counterparty, outstanding balance, and a next-due chip. Presentational: the
// overdue verdict arrives from `listLoanStatuses`, which compares in local
// calendar days — a card that re-derived it would disagree with the list it
// sits in at exactly midnight.
//
// RESTYLED (mobile-ui-revamp Part 3 Task 4b): a glyph disc, a progress bar
// (paid share of principal), and — for a scheduled loan — a paid-of-total
// line. THE EXISTING "Next: ₱X" LINE IS UNCHANGED, DELIBERATELY:
// `loan_card.test.tsx`'s "the next payment amount is shown alongside the
// balance" asserts that exact string. The board additionally wants "Next:
// <date> with N% paid", which is a genuinely different fact (the DATE, not
// the amount) — added as its own caption below the bar rather than rewriting
// the tested line, worded "Due …" rather than "Next: …" so the two do not
// read as a contradiction sitting a few lines apart.
//
// THE OVERDUE BANNER REUSES CHIP'S OWN SOFT-DANGER ARITHMETIC RATHER THAN
// RENDERING A `<Chip>`. A banner is a full-width, multi-word sentence;
// `Chip`'s `rounded-full` pill shape is built for a short label and looks
// wrong stretched over two lines. `softBackground` + `palette.danger` is the
// exact computation `components/ui/chip.tsx` performs for `tone="danger"
// fill="soft"` — mirrored here rather than duplicated as a second, possibly
// drifting formula, and inked with `danger-ink`/`danger-ink-dark` for the
// same AA reason chip.tsx's own SOFT_INK table exists.
import { useColorScheme } from "nativewind";
import { HandCoins } from "lucide-react-native";
import { Text, View } from "react-native";

import { AmountText, formatCentavos } from "@/components/ui/amount_text";
import { registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { ChipTone } from "@/components/ui/chip";
import { palette } from "@/constants/colors";
import { parseDateIso, startOfLocalDay } from "@/lib/dates";
import { formatDate } from "@/lib/datetime";
import type { LoanStatus } from "@/lib/loans/loans_service";
import { softBackground } from "@/lib/ui/contrast";

const LoanGlyph = registerIcon(HandCoins);

/** The same 0.14 `components/ui/chip.tsx`'s `SOFT_ALPHA` uses — one value for
 * every soft surface in the app, so two of them sitting near each other never
 * read as a rendering bug. */
const BANNER_SOFT_ALPHA = 0.14;

export type LoanCardProps = {
  status: LoanStatus;
  /** Local instant, for the "due in 3d" countdown. */
  now: number;
  testID?: string;
};

const DAY_MS = 86_400_000;

/** Rule 2's chip: `due in 3d`, `due today`, `overdue`. */
function dueChip(status: LoanStatus, now: number): { label: string; tone: ChipTone } | null {
  if (status.outstanding <= 0) return { label: "Settled", tone: "brand" };
  if (status.nextDue === null) return null;
  if (status.overdue) return { label: "Overdue", tone: "danger" };

  const days = Math.round(
    (startOfLocalDay(parseDateIso(status.nextDue.dueDate).getTime()) - startOfLocalDay(now)) /
      DAY_MS,
  );

  // `warn`, not `danger`, for a due date that has not passed. Red is reserved
  // for something already wrong — spending it on "due in 3 days" leaves nothing
  // louder to say when the payment is actually late.
  if (days === 0) return { label: "Due today", tone: "warn" };
  return { label: `Due in ${days}d`, tone: days <= 3 ? "warn" : "neutral" };
}

/** Chip's own `fill` half of the due-chip pairing — `due_chip.tsx`'s exact
 * three (neutral/outline, warn/soft, danger/soft), reused here so a loan's
 * due state and a bill's read the same. */
const DUE_FILL: Record<ChipTone, "outline" | "soft"> = {
  neutral: "outline",
  warn: "soft",
  danger: "soft",
  brand: "soft",
  soon: "soft",
};

export function LoanCard({ status, now, testID }: LoanCardProps) {
  const { colorScheme } = useColorScheme();
  const chip = dueChip(status, now);
  const { loan, outstanding } = status;

  // Amount paid so far, as a share of what was borrowed — the same idea
  // `LimitCard`'s bar states, guarded the same way: `principal` is a positive
  // CHECK constraint in 001_core.sql, but guarding rather than assuming keeps
  // this file honest about that being an invariant of the DATA, not of the
  // arithmetic here.
  const paid = Math.max(0, loan.principal - outstanding);
  const ratio = loan.principal > 0 ? paid / loan.principal : 0;
  const percentPaid = Math.round(Math.min(1, Math.max(0, ratio)) * 100);

  const schedule = loan.schedule ?? [];
  const perInstallment = schedule[0]?.amountDue ?? status.nextDue?.amount ?? null;

  return (
    <Card testID={testID}>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 flex-row items-start gap-3 pr-3">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft-dark">
            <LoanGlyph size={20} className="text-brand dark:text-brand-dark" />
          </View>
          <View className="flex-1">
            <Text className="font-semibold text-fg dark:text-fg-dark">{loan.counterparty}</Text>
            {/* "N mos · N paid · ₱X/mo" (task-4b board), worded cadence-
                agnostically: `schedule`'s interval is not always monthly (a
                flat loan can be weekly — `loan_form.tsx`'s own "Days between
                payments" field), and this card has no cadence label to
                borrow, so it counts installments rather than claiming a unit
                the data does not carry. Free-form loans have no schedule at
                all (spec rule 1) and render no line here, same as before. */}
            {schedule.length === 0 || perInstallment === null ? null : (
              <Text className="mt-0.5 text-secondary text-fg-2 dark:text-fg-2-dark">
                {`${status.paidCount} of ${schedule.length} paid · ${formatCentavos(perInstallment)} each`}
              </Text>
            )}
            {chip === null ? null : (
              <View className="mt-2 flex-row">
                <Chip
                  testID={testID === undefined ? undefined : `${testID}-due`}
                  label={chip.label}
                  tone={chip.tone}
                  fill={DUE_FILL[chip.tone]}
                />
              </View>
            )}
          </View>
        </View>

        <View className="items-end">
          <AmountText
            testID={testID === undefined ? undefined : `${testID}-outstanding`}
            amount={status.outstanding}
            size="lg"
          />
          {status.nextDue === null || status.outstanding <= 0 ? null : (
            <Text className="mt-1 text-xs text-fg-2 dark:text-fg-2-dark">
              {`Next: ${formatCentavos(status.nextDue.amount)}`}
            </Text>
          )}
        </View>
      </View>

      {status.outstanding > 0 ? (
        <>
          <View
            testID={testID === undefined ? undefined : `${testID}-progress`}
            className="mt-3 h-2 overflow-hidden rounded-full bg-brand-soft dark:bg-brand-soft-dark"
          >
            <View
              testID={testID === undefined ? undefined : `${testID}-progress-fill`}
              className="h-2 rounded-full bg-brand dark:bg-brand-dark"
              style={{ width: `${percentPaid}%` }}
            />
          </View>
          {/* "Next: <date> with N% paid" (task-4b board) — the DATE, which
              the existing "Next: ₱X" line above does not carry. Worded "Due
              …" rather than "Next: …" so the two captions do not read as
              disagreeing about what "next" means a few lines apart. */}
          {status.nextDue === null ? null : (
            <Text className="mt-2 text-fg-2 dark:text-fg-2-dark">
              {`Due ${formatDate(parseDateIso(status.nextDue.dueDate).getTime())} · ${percentPaid}% paid`}
            </Text>
          )}
        </>
      ) : null}

      {/* An overdue promise, called out — see this file's header on why this
          is a hand-mirrored soft-danger surface rather than a stretched
          `Chip`. */}
      {status.overdue ? (
        <View
          testID={testID === undefined ? undefined : `${testID}-overdue-banner`}
          className="mt-3 rounded-xl p-3"
          style={{
            backgroundColor: softBackground(
              colorScheme === "dark" ? palette["danger-dark"] : palette.danger,
              BANNER_SOFT_ALPHA,
            ),
          }}
        >
          <Text className="font-semibold text-danger-ink dark:text-danger-ink-dark">
            Overdue promise
          </Text>
          <Text className="mt-0.5 text-danger-ink dark:text-danger-ink-dark">
            {`Record a payment when you can — ${loan.counterparty} is waiting on this one.`}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

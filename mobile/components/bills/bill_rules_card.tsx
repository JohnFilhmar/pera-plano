// components/bills/bill_rules_card.tsx — the bill detail's rule rows (GAP-085).
//
// docs/04-features/07-bills.md's Bill-detail cell lists six things. Two of them
// (amount and its type, payment history) the screen already drew; three did not
// exist anywhere in the app — "due rule in plain words", "reminder schedule",
// "auto-match rule summary" — and rule 3's "the UNADJUSTED date is still shown
// in the bill detail for transparency" was the fourth. This card is those four.
//
// WHY IT MATTERS THAT THEY WERE MISSING: every one of them is a setting the
// user makes once, at creation, and then never sees again. A reminder schedule
// nobody can read back is indistinguishable from reminders that are not firing,
// and an auto-match rule nobody can read back is why "the app marked the wrong
// bill paid" has no self-service answer.
//
// PRESENTATIONAL, with the words in `lib/bills/rule_summary.ts`, for the same
// reason `estimate_text.tsx` keeps `estimateLabel` beside the component: the
// sentences are testable without a renderer, and the screen and any future
// surface phrase a due rule identically.
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import type { AmountEstimate } from "@/lib/bills/amount_estimator";
import { unadjustedOccurrence } from "@/lib/bills/due_rules";
import { autoMatchFacts, dueRuleLabel, reminderScheduleLabel } from "@/lib/bills/rule_summary";
import { parseDateIso } from "@/lib/dates";
import { formatDate } from "@/lib/datetime";
import type { Bill, IsoDate } from "@/types/domain";

export type BillRulesCardProps = {
  bill: Bill;
  /** This bill's current estimate — rule 14's tolerance is a share of it. */
  estimate: AmountEstimate;
  /** The ADJUSTED due date of the cycle this screen is scoped to. */
  dueDate: IsoDate;
  testID?: string;
};

function Row({
  label,
  value,
  valueTestID,
  children,
}: {
  label: string;
  value: string;
  valueTestID: string;
  children?: ReactNode;
}) {
  return (
    <View className="gap-0.5">
      <Text className="text-xs font-medium text-fg-2 dark:text-fg-2-dark">{label}</Text>
      <Text testID={valueTestID} className="text-fg dark:text-fg-dark">
        {value}
      </Text>
      {children}
    </View>
  );
}

function AutoMatchRow({
  bill,
  estimate,
  dueDate,
}: {
  bill: Bill;
  estimate: AmountEstimate;
  dueDate: IsoDate;
}) {
  const facts = autoMatchFacts(bill, estimate, dueDate);

  if (!facts.enabled) {
    return (
      <Row
        label="Automatic matching"
        value="Off — you decide which payment settles this bill."
        valueTestID="bill-rule-automatch"
      />
    );
  }

  // Rule 13's three parts, in its own order: "merchant keyword set + amount
  // tolerance + date window". The tolerance is ROUNDED FOR DISPLAY ONLY — the
  // matcher compares against the unrounded figure, and a sub-centavo difference
  // has no way to change a verdict about whole centavos.
  const looksFor =
    facts.merchantPattern.trim().length > 0
      ? `Looks for "${facts.merchantPattern}" in what you spend.`
      : "Looks for this bill's name in what you spend.";
  const tolerance = `Amounts within ${formatCentavos(
    Math.round(facts.toleranceCentavos),
  )} of the expected figure.`;
  const window = `From ${facts.opensDaysBefore} days before the due date to ${facts.closesDaysAfter} days after — ${facts.overdueClosesDaysAfter} days once it is overdue.`;

  return (
    <Row label="Automatic matching" value={looksFor} valueTestID="bill-rule-automatch">
      <Text testID="bill-rule-tolerance" className="text-xs text-fg-2 dark:text-fg-2-dark">
        {tolerance}
      </Text>
      <Text testID="bill-rule-window" className="text-xs text-fg-2 dark:text-fg-2-dark">
        {window}
      </Text>
      {/* Rule 13's ladder, which is otherwise invisible: the user has no way to
          know whether the next match will ask or just happen. Rule 8's escape
          hatch is named too, because the one month it fires — aircon season
          Meralco — is the month a silent match would be most alarming. */}
      <Text testID="bill-rule-ladder" className="text-xs text-fg-2 dark:text-fg-2-dark">
        {facts.silent
          ? "Matches are marked paid for you now, with an undo here — unless the amount jumps by more than 30%."
          : facts.confirmationsLeft === 1
            ? "You confirm each match. One more confirmation and they happen on their own."
            : `You confirm each match. ${facts.confirmationsLeft} more confirmations and they happen on their own.`}
      </Text>
      {facts.excludedKeywords.length > 0 ? (
        <Text testID="bill-rule-excluded" className="text-xs text-fg-2 dark:text-fg-2-dark">
          {`Never offered again: ${facts.excludedKeywords.join(", ")}.`}
        </Text>
      ) : null}
    </Row>
  );
}

export function BillRulesCard({ bill, estimate, dueDate, testID }: BillRulesCardProps) {
  const unadjusted = unadjustedOccurrence(bill.dueRule, dueDate);

  return (
    <Card testID={testID}>
      <View className="gap-3">
        <Row label="Due" value={dueRuleLabel(bill.dueRule)} valueTestID="bill-rule-due">
          {/* Rule 3's transparency line, and ONLY when the shift really moved
              this occurrence. Printing "originally the 20th" on a cycle due the
              20th is noise that teaches the user to stop reading the row. */}
          {unadjusted === dueDate ? null : (
            <Text testID="bill-rule-shift" className="text-xs text-fg-2 dark:text-fg-2-dark">
              {`This one fell on a weekend: ${formatDate(
                parseDateIso(unadjusted).getTime(),
              )} moved to ${formatDate(parseDateIso(dueDate).getTime())}.`}
            </Text>
          )}
        </Row>

        <Row
          label="Reminders"
          value={reminderScheduleLabel(bill.reminderOffsets)}
          valueTestID="bill-rule-reminders"
        />

        <AutoMatchRow bill={bill} estimate={estimate} dueDate={dueDate} />
      </View>
    </Card>
  );
}

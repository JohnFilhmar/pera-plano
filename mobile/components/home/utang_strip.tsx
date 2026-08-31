// components/home/utang_strip.tsx — owner request, 2026-08-31.
//
// What the user still owes, on Home.
//
// WHY THIS IS NOT PART OF "COMING UP". `upcoming_bills_strip.tsx`'s own header
// states its job: it names "the bills already subtracted from the hero
// number". Safe-to-Spend's bills term comes from `unresolvedBills`, which
// reads bill CYCLES only (lib/safe_to_spend_service.ts) — a loan has never
// been in it. Folding utang rows into that strip would list money the hero
// never deducted, immediately below the hero, which is the same species of
// quiet contradiction as the set-aside bug this section shipped alongside.
// Its own heading makes the boundary legible: these are debts, not this
// period's committed spending.
//
// IT REUSES `LoanCard` RATHER THAN DRAWING A ROW. The Utang tab already has a
// presentation for a loan — counterparty, outstanding, due chip, overdue
// banner, paid share — and its comments are explicit that the overdue verdict
// must come from `listLoanStatuses` rather than being re-derived per screen. A
// second, simpler card here would be a second thing to keep in step, and the
// two would disagree the first time either changed.
import { Pressable, Text, View } from "react-native";

import { LoanCard } from "@/components/loans/loan_card";
import { formatCentavos } from "@/components/ui/amount_text";
import { SectionHeader } from "@/components/ui/section_header";
import type { LoanStatus } from "@/lib/loans/loans_service";

export type UtangStripProps = {
  /** Every loan, both directions — this component does its own filtering. */
  statuses: LoanStatus[] | undefined;
  /** Local instant, forwarded to `LoanCard` for its "due in 3d" countdown. */
  now: number;
  onOpen: (loanId: string) => void;
  onSeeAll: () => void;
  /** How many rows before the strip stops being a strip. */
  limit?: number;
  testID?: string;
};

/**
 * Overdue first, then soonest due, then the undated.
 *
 * Free-form utang (no schedule and no hand-set due date) sorts LAST rather
 * than being dropped: money owed with no agreed date is still owed, and it is
 * the case most likely to be forgotten. It simply has no urgency to rank on.
 */
function byUrgency(a: LoanStatus, b: LoanStatus): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.nextDue === null || b.nextDue === null) {
    if (a.nextDue === b.nextDue) return 0;
    return a.nextDue === null ? 1 : -1;
  }
  // `IsoDate` is zero-padded 'YYYY-MM-DD', so string order is calendar order —
  // the same comparison lib/reports/aggregate.ts's `inRange` relies on.
  return a.nextDue.dueDate < b.nextDue.dueDate ? -1 : a.nextDue.dueDate > b.nextDue.dueDate ? 1 : 0;
}

export function UtangStrip({
  statuses,
  now,
  onOpen,
  onSeeAll,
  limit = 3,
  testID,
}: UtangStripProps) {
  // `outstanding > 0` as well as the direction filter. `listLoans` keeps
  // SETTLED loans visible by default — deliberately, for the Utang tab's own
  // list — but a Home summary line reading "₱0.00 left" is noise on the one
  // screen that exists to show what needs attention.
  const owed = (statuses ?? []).filter(
    (status) => status.loan.direction === "i-owe" && status.outstanding > 0,
  );
  if (owed.length === 0) return null;

  const ordered = [...owed].sort(byUrgency);
  const rows = ordered.slice(0, limit);
  const total = owed.reduce((sum, status) => sum + status.outstanding, 0);

  return (
    <View testID={testID ?? "home-utang"} className="gap-3">
      {/* "Utang", matching the Plan tab's own segment label rather than
          "Loans" — one word for one concept across the app. The action only
          appears when rows are actually hidden; a "See all" over a complete
          list is a promise of more that is not there. */}
      <SectionHeader
        title="Utang"
        action={owed.length > rows.length ? { label: "See all", onPress: onSeeAll } : undefined}
      />

      <View className="px-4">
        <Text testID="home-utang-total" className="text-secondary text-fg-2 dark:text-fg-2-dark">
          {`${formatCentavos(total)} still to pay`}
        </Text>
      </View>

      {rows.map((status) => (
        <Pressable
          key={status.loan.id}
          testID={`utang-row-${status.loan.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${status.loan.counterparty}, ${formatCentavos(status.outstanding)} outstanding`}
          onPress={() => onOpen(status.loan.id)}
        >
          <LoanCard status={status} now={now} />
        </Pressable>
      ))}
    </View>
  );
}

// components/bills/bill_row.tsx — m2c Task 5, rules 1-3.
//
// One occurrence of one bill: name, what it will cost, when it is due. The row
// is per CYCLE rather than per bill, because rule 25 has two cycles of the same
// bill open at once and each is resolved independently — a per-bill row could
// not show February overdue while March is upcoming.
//
// RESTYLED (mobile-ui-revamp Part 3 Task 4b): a glyph disc, matching the disc
// `limit_card.tsx` and `loan_card.tsx` both carry now — a generic mark, not
// one resolved from a category or provider, for the same reason those two
// give (no per-icon-name-to-lucide-component resolver exists in this
// codebase; see `limit_card.tsx`'s header for the fuller account).
import { FileText } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { DueChip, dueChipFor } from "@/components/bills/due_chip";
import { estimateLabel, EstimateText } from "@/components/bills/estimate_text";
import { registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { BillStatus } from "@/lib/bills/bills_service";
import { parseDateIso } from "@/lib/dates";
import { formatDate } from "@/lib/datetime";

const BillGlyph = registerIcon(FileText);

export type BillRowProps = {
  status: BillStatus;
  onPress?: () => void;
  testID?: string;
};

/**
 * TalkBack has nothing to read off a bare row (F5) — this states what the
 * card beside it draws: the bill's name, its amount, and the same due-state
 * word `DueChip` renders, both imported (`estimateLabel`, `dueChipFor`)
 * rather than re-derived so the row and the chip it wraps can never
 * disagree about which one this is.
 */
function billRowAccessibilityLabel(status: BillStatus): string {
  const amount = estimateLabel(status.estimate);
  const due = dueChipFor(status.state, status.daysUntil).label;
  return `${status.bill.name}, ${amount}, ${due}`;
}

export function BillRow({ status, onPress, testID }: BillRowProps) {
  const body = (
    <Card>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 flex-row items-start gap-3 pr-3">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft-dark">
            <BillGlyph size={20} className="text-brand dark:text-brand-dark" />
          </View>
          <View className="flex-1">
            <Text className="font-semibold text-fg dark:text-fg-dark">{status.bill.name}</Text>
            <Text className="mt-0.5 text-xs text-fg-2 dark:text-fg-2-dark">
              {formatDate(parseDateIso(status.dueDate).getTime())}
            </Text>
          </View>
        </View>
        <View className="items-end gap-2">
          <EstimateText
            testID={testID === undefined ? undefined : `${testID}-amount`}
            estimate={status.estimate}
            className="text-fg dark:text-fg-dark"
          />
          <DueChip
            testID={testID === undefined ? undefined : `${testID}-chip`}
            state={status.state}
            daysUntil={status.daysUntil}
          />
        </View>
      </View>
    </Card>
  );

  if (onPress === undefined) return <View testID={testID}>{body}</View>;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={billRowAccessibilityLabel(status)}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

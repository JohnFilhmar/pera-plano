// components/bills/bill_row.tsx — m2c Task 5, rules 1-3.
//
// One occurrence of one bill: name, what it will cost, when it is due. The row
// is per CYCLE rather than per bill, because rule 25 has two cycles of the same
// bill open at once and each is resolved independently — a per-bill row could
// not show February overdue while March is upcoming.
import { Pressable, Text, View } from "react-native";

import { DueChip } from "@/components/bills/due_chip";
import { EstimateText } from "@/components/bills/estimate_text";
import { Card } from "@/components/ui/card";
import type { BillStatus } from "@/lib/bills/bills_service";
import { parseDateIso } from "@/lib/dates";
import { formatDate } from "@/lib/datetime";

export type BillRowProps = {
  status: BillStatus;
  onPress?: () => void;
  testID?: string;
};

export function BillRow({ status, onPress, testID }: BillRowProps) {
  const body = (
    <Card>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-semibold text-fg dark:text-fg-dark">{status.bill.name}</Text>
          <Text className="mt-0.5 text-xs text-fg-2 dark:text-fg-2-dark">
            {formatDate(parseDateIso(status.dueDate).getTime())}
          </Text>
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
    <Pressable testID={testID} onPress={onPress}>
      {body}
    </Pressable>
  );
}

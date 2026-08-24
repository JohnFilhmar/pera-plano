// components/home/upcoming_bills_strip.tsx — M3 Part 2 Task 4.
//
// The bills already subtracted from the hero number, named. Without this the
// user sees a figure reduced by ₱3,999 and no indication of what took it —
// which is the same complaint as a bank statement with no descriptions.
//
// OVERDUE FIRST, and marked. It is the one row where the user can still act.
import { Pressable, Text, View } from "react-native";

import { DueChip } from "@/components/bills/due_chip";
import { AmountText } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section_header";
import type { BillStatus } from "@/lib/bills/bills_service";

export type UpcomingBillsStripProps = {
  statuses: BillStatus[] | undefined;
  onOpen: (billId: string, dueDate: string) => void;
  /** How many rows to show before the strip stops being a strip. */
  limit?: number;
  testID?: string;
};

export function UpcomingBillsStrip({
  statuses,
  onOpen,
  limit = 3,
  testID,
}: UpcomingBillsStripProps) {
  const unresolved = (statuses ?? []).filter(
    (status) =>
      status.state === "overdue" || status.state === "due_today" || status.state === "upcoming",
  );
  if (unresolved.length === 0) return null;

  // Already ordered oldest-first by `listBillStatuses`, which puts overdue at
  // the top for free — the same ordering the Bills tab uses, so the two screens
  // never disagree about what is most urgent.
  const rows = unresolved.slice(0, limit);

  return (
    <View testID={testID ?? "upcoming-bills"} className="gap-3">
      <SectionHeader title="Coming up" />
      {rows.map((status) => (
        <Pressable
          key={`${status.bill.id}|${status.dueDate}`}
          testID={`upcoming-bill-${status.bill.id}`}
          accessibilityRole="button"
          onPress={() => onOpen(status.bill.id, status.dueDate)}
        >
          <Card>
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="font-semibold text-fg dark:text-fg-dark">{status.bill.name}</Text>
                <View className="mt-1 flex-row">
                  <DueChip state={status.state} daysUntil={status.daysUntil} />
                </View>
              </View>
              <AmountText amount={status.estimate.amount} />
            </View>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

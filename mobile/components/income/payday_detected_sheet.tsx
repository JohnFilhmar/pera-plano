// components/income/payday_detected_sheet.tsx — m2-part2 Task 13, rule 5.
//
// Shown by the app shell when `income:payday` fires while the app is
// foregrounded (Task 14 wires it). It summarises the payday and then gets out
// of the way: goals auto-allocation is built in the goals plan, which
// SUBSCRIBES TO THE SAME EVENT rather than being called from here. That is the
// whole reason the service publishes an event instead of calling goals
// directly — this sheet does not know goals exist, and does not need to.
//
// IT IS NOT A NOTIFICATION. The lock-screen copy rules (docs/12 §7a) govern
// what the system tray may show; this renders inside an app the user has
// already unlocked, so the amount is fine here.
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/datetime";
import type { AppEventMap } from "@/lib/events/app_events";

export type PaydayDetectedSheetProps = {
  /** The event payload, or `null` when no payday is being announced. */
  payday: AppEventMap["income:payday"] | null;
  walletName?: string;
  onDismiss: () => void;
};

export function PaydayDetectedSheet({ payday, walletName, onDismiss }: PaydayDetectedSheetProps) {
  return (
    <BottomSheet visible={payday !== null} onDismiss={onDismiss} title="Payday">
      {payday === null ? null : (
        <View testID="payday-sheet" className="gap-3">
          <AmountText testID="payday-amount" amount={payday.amount} direction="in" size="hero" />
          <Text className="text-fg-2 dark:text-fg-2-dark">
            {walletName === undefined
              ? `Received ${formatDate(payday.occurredAt)}.`
              : `Landed in ${walletName} on ${formatDate(payday.occurredAt)}.`}
          </Text>
          <Button title="Nice" onPress={onDismiss} testID="payday-dismiss" />
        </View>
      )}
    </BottomSheet>
  );
}

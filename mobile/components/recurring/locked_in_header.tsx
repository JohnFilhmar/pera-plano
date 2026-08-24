// components/recurring/locked_in_header.tsx — M3 Part 2 Task 6.
//
// The whole point of the feature, per the brief: one figure, "₱X a month
// locked in" — the money that leaves every month whether or not the user
// thinks about it. `monthlyTotal` is `monthlyLockedIn(patterns)`
// (lib/recurring/recurring_service.ts), computed by the SCREEN and handed in
// as a prop — this component draws it, it does not derive it (hooks/queries's
// own house rule: a component that needs money summed does it where it is
// visible, not hidden inside a hook or a card).
import { Text } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import type { Centavos } from "@/types/domain";

export type LockedInHeaderProps = {
  monthlyTotal: Centavos;
  testID?: string;
};

export function LockedInHeader({ monthlyTotal, testID }: LockedInHeaderProps) {
  return (
    <Card testID={testID}>
      <Text className="text-fg-2 dark:text-fg-2-dark">Locked in every month</Text>
      <AmountText
        testID={testID === undefined ? undefined : `${testID}-amount`}
        amount={monthlyTotal}
        size="lg"
      />
    </Card>
  );
}

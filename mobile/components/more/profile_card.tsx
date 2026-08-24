// components/more/profile_card.tsx — the card at the top of More.
//
// The design draws "Ana Reyes · Free plan · [Go Plus]". None of those three
// things is true here: there is no account and therefore no name, the tier is
// not Free (lib/entitlements.ts pins MVP_TIER to "plus"), and there is nothing
// to upgrade to while Plus is blocked on a PIC entity, a DPO and NPC
// registration (docs/09-v2-backlog.md's monetization-entity item). So the
// card says the true version of the same three things: the paper-plane mark,
// a fixed "Beta User" tag, and what that tag means.
//
// NO DATE. Nothing records when this install happened, and an install date
// cannot be reconstructed after the fact — docs/09-v2-backlog.md item 2.12
// defers that entire question (a "beta cohort") to Google account linking. A
// "beta tester since March" line here would be inventing data this app does
// not have.
import { Text, View } from "react-native";

import { BETA_USER_LABEL } from "@/components/home/greeting_header";
import { BrandMark } from "@/components/ui/brand_mark";
import { Card } from "@/components/ui/card";

// ONE declaration of the status tag. `BETA_USER_LABEL` itself already lives in
// greeting_header.tsx and is imported rather than redeclared here, for the
// same reason: two independent copies of a user-facing string is how "Beta
// User" and "Beta user" end up on adjacent screens.
export const BETA_STATUS_LABEL = "Beta tester · everything unlocked";

export type ProfileCardProps = {
  testID?: string;
};

export function ProfileCard({ testID }: ProfileCardProps) {
  return (
    <View testID={testID}>
      <Card>
        <View className="flex-row items-center gap-3">
          <BrandMark size={40} />
          <View className="flex-1">
            <Text className="text-section font-bold text-fg dark:text-fg-dark">
              {BETA_USER_LABEL}
            </Text>
            <Text className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
              {BETA_STATUS_LABEL}
            </Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

// components/ui/empty_state.tsx — m1c plan Task 2.
//
// Empty is the first thing a new user sees on almost every screen, and in this
// app one empty state ("All caught up" on the Review Queue) is a reward rather
// than a void. Both cases get the brand mark, a plain-English reason, and — if
// there is something to do about it — one action.
import { Send } from "lucide-react-native";
import { Text, View } from "react-native";

import { Button, registerIcon } from "./button";
import type { IconComponent } from "./button";

export type EmptyStateProps = {
  /** Defaults to the paper-airplane brand mark (docs/11 DESIGN LANGUAGE). */
  icon?: IconComponent;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
  testID?: string;
};

export function EmptyState({
  icon = Send,
  title,
  body,
  action,
  testID,
}: EmptyStateProps) {
  const Icon = registerIcon(icon);

  return (
    <View testID={testID} className="items-center gap-3 px-8 py-12">
      {/* Soft-mint disc, brand-green glyph — inviting, never the grey of a
          dormant "Soon" feature. An empty list is not a disabled one. */}
      <View className="rounded-full bg-brand-soft p-4 dark:bg-brand-soft-dark">
        <Icon size={32} className="text-brand dark:text-brand-dark" />
      </View>
      <Text className="text-center text-title font-bold text-fg dark:text-fg-dark">
        {title}
      </Text>
      <Text className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">{body}</Text>
      {action ? (
        <View className="mt-2">
          <Button
            testID="empty-state-action"
            title={action.label}
            onPress={action.onPress}
          />
        </View>
      ) : null}
    </View>
  );
}

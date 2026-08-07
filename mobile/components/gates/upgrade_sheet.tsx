import { Pressable, Text, View } from "react-native";

/**
 * Capabilities PlusGate can gate — one entry per Plus-depth row in the tier
 * matrix (docs/05-monetization.md §2) that a gate actually surfaces today.
 */
export type PlusCapability =
  | "csv_export"
  | "recurring"
  | "backup"
  | "projection"
  | "amortization";

// Free-vs-Plus comparison rows, verbatim from the canonical tier matrix
// (docs/05-monetization.md §2) — one row per capability PlusGate can show.
const CAPABILITY_COPY: Record<
  PlusCapability,
  { label: string; free: string; plus: string }
> = {
  csv_export: { label: "Export", free: "—", plus: "CSV (PDF later)" },
  recurring: {
    label: "Recurring/subscription detection",
    free: "—",
    plus: "✓",
  },
  backup: {
    label: "Cloud backup / multi-device sync",
    free: "—",
    plus: "✓",
  },
  projection: {
    label: "Safe-to-Spend",
    free: "Today only",
    plus: "Projected to end of period",
  },
  amortization: {
    label: "Loans",
    free: "1, basic tracking (balance + next due)",
    plus: "Unlimited + full amortization schedule",
  },
};

/**
 * The shared bottom sheet PlusGate opens on press (docs/11-mobile-app-design-
 * prompt.md "TWO GATING STATES", state 2). Shows the Free-vs-Plus row for the
 * capability that triggered it and an upgrade button — inert in MVP, per
 * docs/05-monetization.md §1 ("Gating is defined now but enforced later").
 */
export function UpgradeSheet({
  visible,
  onClose,
  capability,
}: {
  visible: boolean;
  onClose: () => void;
  capability: PlusCapability;
}) {
  if (!visible) return null;

  const row = CAPABILITY_COPY[capability];

  return (
    <View
      testID="upgrade-sheet"
      className="rounded-t-2xl bg-surface p-4 dark:bg-surface-dark"
    >
      <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
        PeraPlano Plus
      </Text>
      <Text className="mt-3 font-medium text-fg dark:text-fg-dark">
        {row.label}
      </Text>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-fg-2 dark:text-fg-2-dark">Free: {row.free}</Text>
        <Text className="text-brand dark:text-brand-dark">
          Plus: {row.plus}
        </Text>
      </View>
      <Pressable
        testID="upgrade-button"
        disabled
        accessibilityRole="button"
        accessibilityLabel="Upgrade to Plus — coming soon"
        className="mt-4 rounded-lg bg-brand px-4 py-3 opacity-60 dark:bg-brand-dark"
      >
        <Text className="text-center font-semibold text-surface dark:text-surface-dark">
          Upgrade to Plus
        </Text>
      </Pressable>
      <Text className="mt-2 text-center text-xs text-fg-2 dark:text-fg-2-dark">
        Billing isn't live yet — pricing coming soon.
      </Text>
      <Pressable
        testID="upgrade-sheet-close"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="mt-3"
      >
        <Text className="text-center text-fg-2 dark:text-fg-2-dark">
          Not now
        </Text>
      </Pressable>
    </View>
  );
}

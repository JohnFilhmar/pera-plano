import { Pressable, Text, View } from "react-native";
import { Send } from "lucide-react-native";
import { cssInterop } from "nativewind";

// Lucide icons ship as plain SVG components and ignore `className` until they
// are registered with cssInterop; `nativeStyleToProp` routes the resolved
// `color` style back onto the `color` prop lucide actually reads — same
// pattern as components/gates/plus_gate.tsx's Lock registration.
cssInterop(Send, {
  className: { target: "style", nativeStyleToProp: { color: true } },
});

/**
 * Capabilities PlusGate can gate — one entry per Plus-depth row in the tier
 * matrix (docs/05-monetization.md §2) that a gate actually surfaces today.
 */
export type PlusCapability =
  | "wallets"
  | "csv_export"
  | "recurring"
  | "backup"
  | "projection"
  | "amortization"
  | "goals"
  | "reports";

/**
 * NO COUNTS IN THIS TABLE, DELIBERATELY.
 *
 * `lib/entitlements.ts` caps the free tier at 3 wallets, 1 active limit, 1
 * goal and 1 loan — verbatim from the canonical tier matrix,
 * docs/05-monetization.md §2, whose numbers agree with the code everywhere.
 * The DESIGN's Free-vs-Plus board (docs/pera-plano-mobile/PeraPlano Mobile
 * UI.dc.html) instead reads "Limits & goals — 3 each". Wallets agree at 3;
 * limits and goals disagree by 3x, and nobody has decided which is right.
 *
 * Checked 2026-08-23: this specific 1-vs-3 conflict is NOT YET its own open
 * question in docs/08-risks-and-open-questions.md — that file's own §3.4
 * tier-matrix reference table still lists 1 for both Limits and Goals, i.e.
 * it currently agrees with the code, not with the design board. Someone
 * should add the conflict there before the pricing launch (§3.4 already logs
 * #16 Pricing and #17 Enforcement-flip timing as siblings); this comment
 * documents the discrepancy but is not a substitute for that entry.
 *
 * Publishing either number advertises a plan the app may not honour — to an
 * audience that was promised permanent Plus. So the table states the SHAPE of
 * each capability and no quantity, which is true under both readings.
 */
const CAPABILITY_COPY: Record<
  PlusCapability,
  { label: string; free: string; plus: string }
> = {
  wallets: { label: "Auto-tracked wallets", free: "A few", plus: "Unlimited" },
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
  goals: {
    label: "Goals",
    free: "Progress tracking",
    plus: "Unlimited + payday auto-allocate",
  },
  amortization: {
    label: "Loans",
    free: "Balance + next due",
    plus: "Unlimited + full amortization schedule",
  },
  reports: {
    label: "Reports",
    free: "Basic monthly",
    plus: "Full + trends + custom range",
  },
};

/**
 * The shared bottom sheet PlusGate opens on press (docs/11-mobile-app-design-
 * prompt.md "TWO GATING STATES", state 2), restyled to the design's
 * Free-vs-Plus board (R3). Shows every capability row rather than only the
 * one that triggered the sheet — deciding a user "only" wants the row that
 * gated them was never actually true, and this sheet is the one place in the
 * app that answers "what do I get" in full. The row matching `capability` is
 * tinted so it is still easy to find inside the full table.
 *
 * NO PRICE, NO TRIAL CTA. The design draws a Yearly/Monthly price pair and a
 * "Start 14-day free trial" button below the table; both are deleted here,
 * not merely disabled — a disabled price is still a published price, and
 * Plus is blocked on real-world prerequisites that do not exist yet,
 * including a registered Data Protection Officer and NPC registration
 * (docs/08-risks-and-open-questions.md §3.1 #1), so there is no honest price
 * or trial date to show.
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

  const rows = Object.entries(CAPABILITY_COPY) as Array<
    [PlusCapability, (typeof CAPABILITY_COPY)[PlusCapability]]
  >;

  return (
    <View
      testID="upgrade-sheet"
      className="rounded-t-2xl bg-surface p-4 dark:bg-surface-dark"
    >
      <Text className="text-micro font-bold text-fg-2 dark:text-fg-2-dark">
        PeraPlano Plus
      </Text>

      <View className="items-center px-2 pt-3">
        <View className="h-[52px] w-[52px] items-center justify-center rounded-2xl bg-brand dark:bg-brand-dark">
          <Send size={24} className="text-on-brand dark:text-on-brand-dark" />
        </View>
        <Text className="mt-3 text-center text-title font-extrabold text-fg dark:text-fg-dark">
          Everything's unlocked
        </Text>
        <Text className="mt-1.5 text-center text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
          Free for beta testers, forever. Plus is for people juggling more wallets and utang.
        </Text>
      </View>

      <View className="mt-4 overflow-hidden rounded-2xl border border-line dark:border-line-dark">
        {rows.map(([key, row], index) => (
          <View
            key={key}
            testID={`upgrade-row-${key}`}
            // The row for the capability that actually opened this sheet gets
            // a `chip` tint so a user can still find "why am I seeing this"
            // inside the full table, without the other seven rows being
            // hidden the way a single-row sheet used to hide them.
            className={[
              "px-3.5 py-2.5",
              index === rows.length - 1 ? "" : "border-b border-line dark:border-line-dark",
              key === capability ? "bg-chip dark:bg-chip-dark" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <Text className="text-row font-semibold text-fg dark:text-fg-dark">
              {row.label}
            </Text>
            <Text className="mt-0.5 text-secondary text-fg-2 dark:text-fg-2-dark">
              Free: {row.free}
            </Text>
            <Text className="text-secondary font-semibold text-brand dark:text-brand-dark">
              Plus: {row.plus}
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        testID="upgrade-sheet-close"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="mt-4"
      >
        <Text className="text-center text-fg-2 dark:text-fg-2-dark">
          Not now
        </Text>
      </Pressable>
    </View>
  );
}

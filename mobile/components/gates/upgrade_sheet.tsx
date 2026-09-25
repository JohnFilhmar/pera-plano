import { Pressable, Text, View } from "react-native";
import { Send } from "lucide-react-native";
import { cssInterop } from "nativewind";

import { ISOLATED_LINK_HIT_SLOP } from "@/lib/ui/hit_slop";

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
  | "reports"
  | "assistant_levels";

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
 * Logged 2026-08-23 as its own entry in docs/08-risks-and-open-questions.md —
 * "Free-tier counts disagree between the code and the design handoff",
 * appended to §3.4 after #16 Pricing, #17 Enforcement-flip timing and #18
 * Downgrade mechanics. That entry, not this comment, is where the
 * resolution belongs once someone settles it.
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
    // "Utang", not "Loans" (mobile-ui-revamp Part 2 Task 7): the Plan tab's
    // segment carries the same rename, and this sheet's whole premise is
    // showing every capability in the user's own words.
    label: "Utang",
    free: "Balance + next due",
    plus: "Unlimited + full amortization schedule",
  },
  reports: {
    label: "Reports",
    free: "Basic monthly",
    plus: "Full + trends + custom range",
  },
  assistant_levels: {
    // Assistant levels spec §6: the free levels stay free because everything
    // that reads the user's records is in them; the Plus levels add general
    // knowledge. No level numbers here, matching this table's own "NO COUNTS"
    // rule above: the sheet renders every row together regardless of which
    // capability opened it, so a digit here would show up next to `wallets`,
    // `goals` and `amortization`'s deliberately count-free copy too.
    label: "Assistant answer levels",
    free: "Records only",
    plus: "Records, plus general knowledge",
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

      {/* Touch target (design F1 sweep): `mt-4` is margin only — no padding,
          no size guarantee on the unstyled Text below it, no sibling
          Pressable within slop distance (the rows above it are plain,
          non-interactive Views). */}
      <Pressable
        testID="upgrade-sheet-close"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="mt-4"
        hitSlop={ISOLATED_LINK_HIT_SLOP}
      >
        <Text className="text-center text-fg-2 dark:text-fg-2-dark">
          Not now
        </Text>
      </Pressable>
    </View>
  );
}

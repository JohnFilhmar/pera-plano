// components/limits/limit_card.tsx — one limit, one card (m2 Task 8;
// docs/04-features/03-limits.md "UX states & flows").
//
// PRESENTATIONAL. It renders the state it is handed and computes no thresholds
// of its own — `uiState` arrives from `getLimitStatuses`, which is where the
// 50/80/100 boundaries live and are tested. A card that recomputed them would
// be a second opinion about whether the user is over their limit, and the two
// would disagree the first time a boundary moved.
//
// Colour comes from the palette tokens only (interface contract §2). `danger`
// is reserved for the over state: an ordinary purchase inside a limit is not an
// error, and colouring the bar red before the user has done anything wrong
// teaches them to ignore the one colour that means something.
//
// RESTYLED (mobile-ui-revamp Part 3 Task 4b): a glyph disc on the left, and
// "spend over cap" on the right of the header row. THE GLYPH IS GENERIC, not
// resolved per category — `components/transactions/transaction_row.tsx`
// already made this call and its own header names the reason: `Category.icon`
// is a lucide icon name held as a plain string, and nothing in this codebase
// maps an arbitrary icon-name string back to a lucide component. Inventing
// that mapping here, in a restyle task, is exactly what this project's briefs
// keep warning against; a generic mark is honest about what the app actually
// knows about a limit (a cap, not a category glyph). `name` is unchanged and
// still carries the scope word — `limitDisplayName` already renders "Monthly
// limit · Kainan" — so a second, separate "scope" prop was not added: doing so
// would have required a matching change in components/plan/limits_panel.tsx,
// which mobile-ui-revamp Part 2 marked done and out of this task's reach.
import { Wallet as WalletGlyphIcon } from "lucide-react-native";
import { Text, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { LimitUiState } from "@/types/control";
import type { Centavos } from "@/types/domain";

const LimitGlyph = registerIcon(WalletGlyphIcon);

export type LimitCardProps = {
  /** What this limit caps — a category, a wallet, or its scope. */
  name: string;
  spend: Centavos;
  /** `null` when paused or inactive: there is no figure to show. */
  effectiveLimit: Centavos | null;
  daysLeft: number;
  uiState: LimitUiState;
  testID?: string;
};

/** "1 day" / "9 days". The plan hardcodes the plural and renders "1 days". */
function dayPhrase(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The bar's fill colour. Tracks `uiState` rather than a ratio, so the bar and
 * the sentence beneath it can never describe different states.
 */
const FILL_CLASS: Record<LimitUiState, string> = {
  on_track: "bg-brand dark:bg-brand-dark",
  caution: "bg-warn dark:bg-warn-dark",
  warning: "bg-warn dark:bg-warn-dark",
  over: "bg-danger dark:bg-danger-dark",
  paused: "bg-fg-2 dark:bg-fg-2-dark",
  inactive: "bg-fg-2 dark:bg-fg-2-dark",
};

export function LimitCard({
  name,
  spend,
  effectiveLimit,
  daysLeft,
  uiState,
  testID,
}: LimitCardProps) {
  const measuring = uiState !== "paused" && uiState !== "inactive" && effectiveLimit !== null;

  // Guarded rather than assumed positive: `floorToPeso` can round a tiny
  // percentage of a small income down to zero, and `spend / 0` is Infinity.
  const ratio = measuring && effectiveLimit > 0 ? spend / effectiveLimit : 0;

  return (
    // Dimming lives on a WRAPPER, not on the Card. `Card` takes no className by
    // design — it owns the app's radius, padding and elevation rhythm, and
    // adding a style hole for one caller is how that rhythm stops being shared.
    <View className={uiState === "inactive" ? "opacity-60" : undefined}>
      <Card testID={testID}>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 flex-row items-center gap-3 pr-3">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft-dark">
              <LimitGlyph size={20} className="text-brand dark:text-brand-dark" />
            </View>
            <Text numberOfLines={1} className="flex-1 font-semibold text-fg dark:text-fg-dark">
              {name}
            </Text>
          </View>
          {uiState === "inactive" ? (
            <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Inactive</Text>
          ) : measuring ? (
            // "Amount over cap on the right" (task-4b board). The full
            // sentence below the bar ("₱X left, N days to go" / "Over by ₱X")
            // is untouched — components/limits/__tests__/limit_card.test.tsx
            // asserts those strings exactly, so this is an ADDITION, not a
            // replacement of the tested caption.
            <Text
              testID={testID === undefined ? undefined : `${testID}-cap`}
              numberOfLines={1}
              className="text-row font-semibold text-fg dark:text-fg-dark"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {`${formatCentavos(spend)} / ${formatCentavos(effectiveLimit ?? 0)}`}
            </Text>
          ) : null}
        </View>

        {uiState === "paused" ? (
          // The spec's own string. No amount and no bar: rule 12 says income is
          // never silently treated as ₱0.00, and a bar at 0% says exactly that.
          <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
            Paused — declare your income to activate
          </Text>
        ) : null}

        {measuring ? (
          <>
            <View
              testID={testID === undefined ? undefined : `${testID}-progress`}
              className="mt-3 h-2 overflow-hidden rounded-full bg-brand-soft dark:bg-brand-soft-dark"
            >
              <View
                testID={testID === undefined ? undefined : `${testID}-progress-fill`}
                className={`h-2 rounded-full ${FILL_CLASS[uiState]}`}
                // Clamped, or a 300%-spent limit renders a bar three times the
                // card's width and pushes the layout apart.
                style={{ width: `${Math.min(100, ratio * 100)}%` }}
              />
            </View>
            <Text className="mt-2 text-fg-2 dark:text-fg-2-dark">
              {/*
                Keyed on the ACTUAL overage, not on `uiState`. `over` starts at
                exactly 100% (rule 19 fires at-or-above), where the overage is
                zero — so branching on the state, as the m2 plan does, prints
                "Over by ₱0.00" to a user who has spent their limit precisely.
              */}
              {spend > effectiveLimit
                ? `Over by ${formatCentavos(spend - effectiveLimit)}`
                : `${formatCentavos(effectiveLimit - spend)} left, ${dayPhrase(daysLeft)} to go`}
            </Text>
          </>
        ) : null}
      </Card>
    </View>
  );
}

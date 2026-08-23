// components/home/safe_to_spend_hero.tsx — mobile-ui-revamp Part 2 Task 2.
//
// The largest element on the screen, showing ONE number. Everything else on
// Home is context for it.
//
// THE INK IS NOT UNIFORM ACROSS THE THREE FILLS, and the reason is arithmetic
// rather than taste.
//
//   white on `brand`  #15803D -> 5.02:1  AA
//   white on `danger` #DC2626 -> 4.83:1  AA
//   white on `warn`   #D97706 -> 3.20:1  FAILS AA at every size below 24sp
//   `fg`  on `warn`   #D97706 -> 5.30:1  AA
//
// So the amber hero takes dark ink. `components/ui/chip.tsx` already documents
// exactly this exception for amber chips ("legible on a designer's monitor,
// not on a phone outdoors"), and the hero is the single largest amber surface
// in the app.
//
// Dark mode needs no exception: all three dark fills are bright, so all three
// take `on-brand-dark` — brand-dark 7.79:1, danger-dark 6.42:1, warn-dark
// 10.63:1, every figure already recomputed in constants/colors.ts.
//
// THE HERO FIGURE RENDERS `formatCentavos` DIRECTLY ON THE TONED `<Text>`,
// NEVER THROUGH A NESTED `<AmountText>`. This is the same regression
// `components/ui/stat_tile.tsx` documents and guards: `AmountText` always sets
// its OWN colour class internally (`text-fg` with no `direction` prop, which
// is exactly what the hero would pass) and exposes no prop to override it, so
// wrapping it in a toned ancestor — a `<View className={inkClass}>`, in an
// earlier draft of this file — compiles, renders a plausible-looking number,
// and passes a test that only reads the ancestor's own `className`, while the
// glyphs themselves stay `AmountText`'s default ink on every fill: correct by
// coincidence on `tight` (whose ink token happens to equal `AmountText`'s
// default `text-fg`), wrong on `healthy` and `over`, which need white and get
// dark ink instead. `result.perDay` is already floored at zero by the engine
// (lib/safe_to_spend.ts rule 9), so calling `formatCentavos` — the same
// formatter `AmountText` calls — straight on this component's own `<Text>` is
// safe and is what lets the ink class actually reach the digits.
import { Eye, EyeOff, Pause } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { registerIcon } from "@/components/ui/button";
import { MiniBars } from "@/components/ui/mini_bars";
import type { SafeToSpendResult, SafeToSpendState } from "@/lib/safe_to_spend";

export type SafeToSpendHeroProps = {
  result: SafeToSpendResult;
  scopeLabel: string | null;
  dailySeries: readonly number[];
  /** Weekday label for the oldest bar. Task 3 computes it; never hardcode "Mon". */
  startLabel: string;
  /** Weekday label for today's bar. Task 3 computes it; never hardcode "Sun". */
  endLabel: string;
  paused: boolean;
  amountsHidden: boolean;
  onToggleAmounts: () => void;
  onSetLimit: () => void;
  onOpenReviewQueue: () => void;
  testID?: string;
};

export type FilledState = Exclude<SafeToSpendState, "no_limit">;

export const FILL_CLASS: Record<FilledState, string> = {
  healthy: "bg-brand dark:bg-brand-dark",
  tight: "bg-warn dark:bg-warn-dark",
  over: "bg-danger dark:bg-danger-dark",
};

const INK_CLASS: Record<FilledState, string> = {
  healthy: "text-on-brand dark:text-on-brand-dark",
  tight: "text-fg dark:text-on-brand-dark",
  over: "text-on-brand dark:text-on-brand-dark",
};

// NOT dimmed — this equals INK_CLASS byte-for-byte, and that is deliberate,
// not a leftover from a merge. The previously shipped version applied
// Tailwind's `/80` opacity to these same tokens, composited straight over
// FILL_CLASS (nothing sits between this <Text> and the fill). Recomputed
// with lib/ui/contrast.ts's own algorithm rather than eyeballing:
//
//   on-brand/80 on brand  (healthy, light) -> 3.82:1  FAILS AA (4.5:1)
//   fg/80       on warn   (tight,   light) -> 4.07:1  FAILS AA
//   on-brand/80 on danger (over,    light) -> 3.53:1  FAILS AA
//
// `over`'s FULL-STRENGTH ratio is only 4.83:1 — so little headroom above the
// 4.5 floor that even a 95% opacity (a 5% reduction) drops it to 4.47:1 and
// still fails. There is no single opacity below 100% that clears AA for all
// three states at once, so no opacity value fixes this, only removing it does.
// `brand-ink`/`danger-ink`/`warn-ink` (constants/colors.ts) do not fit either
// — they are tuned for ink on that hue's own SOFT TINT over `bg`, never a
// solid fill (that file's own header says so); measured directly on these
// solid fills they land at 1.4-2.2:1, worse than the bug they'd "fix".
// Full-strength `on-brand`/`fg`/`on-brand-dark` — already-existing tokens,
// already used by INK_CLASS two lines up — is the only option that clears AA
// on every state in both colour schemes, which is why this map now equals
// INK_CLASS's values. Kept as its own named map (not merged into INK_CLASS)
// because it names a distinct ROLE — secondary/caption ink vs. the headline
// figure's ink — even though the two resolve identically today; a future
// palette change could reopen headroom for one without touching the other.
// DO NOT reintroduce a `/NN` opacity modifier here — see the contrast block
// in components/home/__tests__/safe_to_spend_hero.test.tsx, which pins
// exactly this. That test reads this map (exported for that reason) rather
// than a copy of its values, so reverting this constant fails the test
// directly instead of relying on someone remembering to update a duplicate.
export const MUTED_INK_CLASS: Record<FilledState, string> = {
  healthy: "text-on-brand dark:text-on-brand-dark",
  tight: "text-fg dark:text-on-brand-dark",
  over: "text-on-brand dark:text-on-brand-dark",
};

const BAR_CLASS: Record<FilledState, string> = {
  healthy: "bg-on-brand/40 dark:bg-on-brand-dark/40",
  tight: "bg-fg/30 dark:bg-on-brand-dark/40",
  over: "bg-on-brand/40 dark:bg-on-brand-dark/40",
};

/** Five bullets, not the real figure — the whole point of the toggle. */
const HIDDEN_AMOUNT = "₱•••••";

export function SafeToSpendHero({
  result,
  scopeLabel,
  dailySeries,
  startLabel,
  endLabel,
  paused,
  amountsHidden,
  onToggleAmounts,
  onSetLimit,
  onOpenReviewQueue,
  testID,
}: SafeToSpendHeroProps) {
  const EyeIcon = registerIcon(amountsHidden ? EyeOff : Eye);
  const PauseIcon = registerIcon(Pause);

  if (result.state === "no_limit") {
    return (
      <View
        testID={testID ?? "sts-hero"}
        className="items-center gap-3 rounded-2xl bg-surface px-6 py-8 shadow-sm dark:border dark:border-line-dark dark:bg-surface-dark"
      >
        <Text className="text-center text-title font-bold text-fg dark:text-fg-dark">
          Set a limit to see what's safe to spend
        </Text>
        <Text className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">
          Tell PeraPlano what you want to keep under, and it will do the arithmetic every day.
        </Text>
        <Pressable
          testID="sts-set-limit"
          accessibilityRole="button"
          onPress={onSetLimit}
          className="min-h-[44px] justify-center rounded-full bg-brand px-5 dark:bg-brand-dark"
        >
          <Text className="text-body font-semibold text-on-brand dark:text-on-brand-dark">
            Set a limit
          </Text>
        </Pressable>
      </View>
    );
  }

  const state = result.state;

  // A paused hero is NOT a fourth colour. The listener being down says nothing
  // about whether the user is under or over — it says the number is old. So the
  // card drops to plain surface and the figure greys, rather than turning a
  // colour that would assert a spending verdict the app cannot currently make.
  const containerClass = paused
    ? "gap-3 rounded-2xl bg-surface p-5 shadow-sm dark:border dark:border-line-dark dark:bg-surface-dark"
    : `gap-3 rounded-2xl p-5 ${FILL_CLASS[state]}`;

  const inkClass = paused ? "text-fg-2 dark:text-fg-2-dark" : INK_CLASS[state];
  const mutedInkClass = paused ? "text-fg-2 dark:text-fg-2-dark" : MUTED_INK_CLASS[state];
  const barClass = paused ? "bg-line dark:bg-line-dark" : BAR_CLASS[state];

  return (
    <View testID={testID ?? "sts-hero"} className={containerClass}>
      <View className="flex-row items-center justify-between">
        <Text className={`text-micro font-semibold ${mutedInkClass}`}>
          {paused ? "Safe to spend today · stale" : "Safe to spend today"}
        </Text>
        {paused ? (
          <View
            testID="sts-paused-chip"
            className="flex-row items-center gap-1 rounded-full bg-chip px-2 py-0.5 dark:bg-chip-dark"
          >
            <PauseIcon size={10} className="text-fg-2 dark:text-fg-2-dark" />
            <Text className="text-badge font-bold text-fg-2 dark:text-fg-2-dark">PAUSED</Text>
          </View>
        ) : (
          <Pressable
            testID="sts-eye"
            onPress={onToggleAmounts}
            accessibilityRole="button"
            accessibilityLabel={amountsHidden ? "Show amounts" : "Hide amounts"}
            hitSlop={12}
          >
            <EyeIcon size={16} className={mutedInkClass} />
          </Pressable>
        )}
      </View>

      <Text
        testID="sts-amount"
        className={`text-hero font-extrabold ${inkClass}`}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {amountsHidden ? HIDDEN_AMOUNT : formatCentavos(result.perDay)}
      </Text>

      {result.state === "over" ? (
        // `fontVariant: tabular-nums` — copied from `AmountText`, which this
        // Text no longer nests. Lost in the first pass at this fix (review
        // caught it): this figure re-renders on every ledger commit while the
        // user is over, the identical jitter `sts-amount` two lines above is
        // protected from, for the identical reason amount_text.tsx gives.
        <Text
          testID="sts-over-by"
          className={`text-secondary font-medium ${mutedInkClass}`}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {`You're ${amountsHidden ? HIDDEN_AMOUNT : formatCentavos(result.overBy)} over for this period`}
        </Text>
      ) : null}

      {scopeLabel === null ? null : (
        <Text testID="sts-caption" className={`text-secondary font-medium ${mutedInkClass}`}>
          {result.drivingFilterLabel === null
            ? `from your ${scopeLabel} limit`
            : `from your ${result.drivingFilterLabel} limit`}
        </Text>
      )}

      {dailySeries.length === 0 ? null : (
        <MiniBars
          testID="sts-bars"
          values={dailySeries}
          barClassName={barClass}
          labelClassName={mutedInkClass}
          startLabel={startLabel}
          endLabel={endLabel}
        />
      )}

      {result.reviewQueueCount > 0 ? (
        <Pressable testID="sts-review-note" accessibilityRole="button" onPress={onOpenReviewQueue}>
          <Text className={`text-secondary font-medium underline ${mutedInkClass}`}>
            {result.reviewQueueCount === 1
              ? "1 item awaiting review isn't counted yet"
              : `${result.reviewQueueCount} items awaiting review aren't counted yet`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

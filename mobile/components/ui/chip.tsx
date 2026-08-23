// components/ui/chip.tsx — m1c plan Task 2.
//
// One chip, five tones. Category chips in the ledger, matcher chips on a wallet
// ("Catches: GCash"), due chips on bills, and the "Soon" chip SoonGate renders
// are all this component — which is the point: a second hand-rolled pill is how
// two different greys end up meaning two different things.
import { Pressable, Text, View } from "react-native";
import { useColorScheme } from "nativewind";

import { palette } from "@/constants/colors";
import { softBackground } from "@/lib/ui/contrast";

export type ChipTone = "neutral" | "brand" | "warn" | "danger" | "soon";

export type ChipFill = "solid" | "soft" | "outline";

/**
 * The design's soft chips sit at 12-14% (`rgba(217,119,6,.14)` for "due
 * today", `rgba(220,38,38,.12)` for "overdue 2d"). One value is used for all
 * of them rather than per-tone, because a chip row with two different alphas
 * reads as a rendering bug. 0.14 is the higher of the two, chosen so the
 * chip is still visible against `surface` white.
 */
export const SOFT_ALPHA = 0.14;

/**
 * Brings the Pressable branch's effective touch target toward 44x44 — the
 * "smallest reliably tappable target" `components/ui/list_row.tsx` documents
 * — without touching the painted pill at all: `hitSlop` only widens the
 * responder region, it never changes what is drawn.
 *
 * ASYMMETRIC ON PURPOSE (fix round 1, review of commit 387bcd6). The first
 * version was a uniform 12px on every edge, and that was wrong: every chip
 * row in this app wraps its chips in `gap-2` (8px) — verified directly
 * against `limit_form.tsx`, `due_rule_picker.tsx`, `filter_bar.tsx`,
 * `income_form.tsx`, `goal_form.tsx`, `income_quick_form.tsx`,
 * `quick_wallet_list.tsx` and `captured_list.tsx`, not assumed — so 12px of
 * horizontal slop reached 12 - 8 = 4px INTO the next chip's own painted
 * pill. Two adjacent Pressables' responder regions overlapped, and a mis-tap
 * there silently applies the WRONG filter or picker value. React Native's
 * own `hitSlop` docs warn about exactly this, and it is a strictly worse
 * failure than a slightly-small target: a user who misses a target notices
 * and taps again, a user who hits the wrong chip does not.
 *
 * THE VERTICAL MATH (this axis was never the problem, so it keeps the full
 * original value). `containerClass`'s `py-1` (4px top + 4px bottom) around
 * `text-micro`'s 14px line-height (`tailwind.config.ts`'s `fontSize.micro`)
 * paints a SOLID/SOFT pill 22px tall; the OUTLINE variant adds its `border`
 * utility's default 1px top + 1px bottom (no width override in
 * tailwind.config.ts), painting 24px tall. 12px top and bottom clears 44 in
 * BOTH cases: 22 + 12 + 12 = 46, 24 + 12 + 12 = 48.
 *
 * THE HORIZONTAL MATH: capped at HALF the row gap (8px / 2 = 4px), not
 * matched to the vertical value, so two neighbouring chips' hit regions meet
 * exactly at the middle of the gap and never overlap into each other's pill
 * (4 + 4 = 8 = the full gap).
 *
 * THE TRADE-OFF THIS DOES NOT SOLVE, STATED RATHER THAN LEFT FOR THE NEXT
 * READER TO REDISCOVER: a chip with a very short label (a "3x" count badge,
 * say) still paints narrower than 44px, and 4px of horizontal slop does not
 * close that gap. Left as-is deliberately — widening it back would
 * reintroduce the overlap this fix exists to remove, and a small miss a
 * user notices and retries beats a silent wrong-chip tap every time.
 *
 * `components/home/safe_to_spend_hero.tsx`'s eye toggle still sets a
 * uniform `hitSlop={12}` — safe there because that control has no sibling
 * within 24px, unlike every real chip row this file actually renders into.
 */
const CHIP_HIT_SLOP = { top: 12, bottom: 12, left: 4, right: 4 };

const SOFT_TINT: Partial<Record<ChipTone, { light: string; dark: string }>> = {
  brand: { light: palette.brand, dark: palette["brand-dark"] },
  warn: { light: palette.warn, dark: palette["warn-dark"] },
  danger: { light: palette.danger, dark: palette["danger-dark"] },
};

// Every tone here maps to its own `-ink` token, never the base tone itself —
// see constants/colors.ts on `brand-ink` / `danger-ink` / `warn-ink` for why:
// the base tones fail WCAG AA as ink on their own soft tint, in all three
// cases, not just `warn`. components/ui/__tests__/chip_contrast.test.ts is
// what guards this from regressing silently.
const SOFT_INK: Partial<Record<ChipTone, string>> = {
  brand: "text-brand-ink dark:text-brand-ink-dark",
  warn: "text-warn-ink dark:text-warn-ink-dark",
  danger: "text-danger-ink dark:text-danger-ink-dark",
};

export type ChipProps = {
  label: string;
  tone?: ChipTone;
  fill?: ChipFill;
  onPress?: () => void;
  /**
   * Drives `accessibilityState={{ selected }}` on the Pressable branch — the
   * only way a screen-reader user can tell a chosen chip (a filter pill, a
   * cadence or due-rule pick, a segment-style chooser) from an unchosen one,
   * since the two are otherwise distinguished purely by fill and colour.
   *
   * ONLY MEANINGFUL TOGETHER WITH `onPress`. A chip with no `onPress` renders
   * a plain `View` (see the `if (!onPress)` branch below), which this prop
   * never reaches — so passing `selected` on a label chip is not an error,
   * it is simply inert: read here, attached nowhere. Nothing throws.
   *
   * UNDEFINED BY DEFAULT, and that is the invariant this prop makes: every
   * call site that does not pass `selected` renders byte-for-byte what it did
   * before this prop existed. React Native's `Pressable` already normalizes
   * `accessibilityState` on the underlying host node to a fixed five-key
   * shape (`busy`/`checked`/`disabled`/`expanded`/`selected`, each
   * `undefined` unless supplied) regardless of whether a caller passes the
   * prop at all — confirmed empirically in chip.test.tsx against the
   * pre-`selected` component — so `selected: undefined` here reads exactly as
   * `undefined` always did. The same invariant
   * `components/ui/numeric_field.tsx`'s `size` prop states about its own
   * default, and deliberately not a count of who opts in: a count is exactly
   * the kind of number the next new selectable chip quietly invalidates.
   */
  selected?: boolean;
  testID?: string;
};

/**
 * Tone → background, contract §2 tokens only.
 *
 * `soon` is byte-for-byte the grey `components/gates/soon_gate.tsx` shipped
 * first, and SoonGate now renders this component so the two cannot drift apart.
 * docs/11 "TWO GATING STATES" makes grey and brand green mean opposite things —
 * grey is "designed, not built yet", brand green is "built, needs Plus" — so a
 * chip that picks the wrong one makes a promise the app will not keep.
 *
 * `neutral` is the only unfilled tone. That is deliberate: it leaves *solid
 * grey* reserved for `soon` alone, so a category chip can never be mistaken for
 * a dormant feature at a glance.
 */
const TONE_BG: Record<ChipTone, string> = {
  neutral: "bg-bg dark:bg-bg-dark",
  brand: "bg-brand dark:bg-brand-dark",
  warn: "bg-warn dark:bg-warn-dark",
  danger: "bg-danger dark:bg-danger-dark",
  soon: "bg-fg-2 dark:bg-fg-2-dark",
};

/**
 * Filled tones ink with `on-brand`/`on-brand-dark` — the token for ink ON A
 * FILLED CONTROL — never `surface`/`surface-dark`, which means "a page/card
 * BACKGROUND". See constants/colors.ts's ON-BRAND FOREGROUND block for the
 * full reasoning: `on-brand` happens to equal `surface` BY VALUE today
 * (#FFFFFF light, #111A16 dark), so borrowing `surface` here rendered
 * correctly by coincidence, not by design — `button.tsx`, `review_badge.tsx`,
 * `fab.tsx` and `segmented_control.tsx` all name the relationship instead of
 * borrowing it, and this file should not be the one place that states the
 * opposite rule.
 *
 * Contrast against 12px semibold text clears WCAG AA (4.5:1) on every filled
 * tone: brand 5.02, danger 4.83, soon 5.44 in light; brand 7.79, danger 6.42,
 * soon 7.74 in dark. `soon` fills with `fg-2`/`fg-2-dark`, not `brand`/
 * `danger`, so its pairing is measured separately here rather than reusing
 * the brand/danger figures `colors.ts` already cites.
 *
 * `warn` is the exception and takes dark ink in BOTH themes. Amber is the one
 * token bright enough that white sits at 3.2:1 against it — legible on a
 * designer's monitor, not on a phone outdoors, which is exactly where a
 * "due today" chip has to be read.
 */
const TONE_TEXT: Record<ChipTone, string> = {
  neutral: "text-fg-2 dark:text-fg-2-dark",
  brand: "text-on-brand dark:text-on-brand-dark",
  warn: "text-fg dark:text-surface-dark",
  danger: "text-on-brand dark:text-on-brand-dark",
  soon: "text-on-brand dark:text-on-brand-dark",
};

export function Chip({
  label,
  tone = "neutral",
  fill = "solid",
  onPress,
  selected,
  testID,
}: ChipProps) {
  // NativeWind cannot express a translucent `dark:` background through
  // `className` — there is no utility class for "this token at 14% alpha",
  // so the tint has to be picked in JS and painted with an inline `style`
  // instead. That needs to know the resolved colour scheme.
  //
  // `useTheme()` (contexts/theme_context.tsx) would be the obvious source,
  // but it throws outside a mounted `ThemeProvider`, and `Chip` is rendered
  // by `SoonGate`, `PlusGate` and most of this app's own component tests
  // with no provider anywhere above them — that would turn this styling
  // change into a crash on every one of them. NativeWind's own hook reads
  // the same value one layer lower and needs no provider: theme_context.tsx
  // already drives NativeWind's `colorScheme.set()` from the preference, so
  // this hook is the source `useTheme` itself feeds.
  const { colorScheme } = useColorScheme();

  // `soon` is deliberately exempt. SoonGate renders this component, and the
  // grey-versus-green contract (docs/11 "TWO GATING STATES") is what tells a
  // user "not built yet" apart from "built, needs Plus". A soft `soon` chip
  // would blur the two.
  //
  // `neutral` + `soft` is coerced the same way, for a different reason:
  // `neutral` is the only tone with no entry in `SOFT_TINT` or `SOFT_INK`
  // (it is deliberately the one unfilled tone — see TONE_BG below), so a
  // soft `neutral` chip paints no background and no border. Label on
  // nothing. A type-level fix (narrowing `tone`/`fill` to a discriminated
  // pair) was rejected here: `goal_card.tsx` assigns a plain `ChipTone`
  // variable to `tone` from a lookup table, which a discriminant on that
  // prop would break for a combination that call site never actually hits —
  // real churn to close a hole nothing exercises. Coercing at runtime closes
  // it without that cost.
  const effectiveFill: ChipFill =
    tone === "soon" || (tone === "neutral" && fill === "soft") ? "solid" : fill;
  const tint = effectiveFill === "soft" ? SOFT_TINT[tone] : undefined;
  const tintHex = tint === undefined ? undefined : (colorScheme === "dark" ? tint.dark : tint.light);

  const containerClass =
    effectiveFill === "outline"
      ? "rounded-full border border-line bg-chip px-2.5 py-1 dark:border-line-dark dark:bg-chip-dark"
      : effectiveFill === "soft"
        ? "rounded-full px-2.5 py-1"
        : `rounded-full px-2.5 py-1 ${TONE_BG[tone]}`;

  const labelClass =
    effectiveFill === "solid"
      ? TONE_TEXT[tone]
      : effectiveFill === "outline"
        ? "text-fg-2 dark:text-fg-2-dark"
        : (SOFT_INK[tone] ?? "text-fg-2 dark:text-fg-2-dark");

  const style = tintHex === undefined ? undefined : { backgroundColor: softBackground(tintHex, SOFT_ALPHA) };

  const body = (
    <Text
      testID={testID === undefined ? undefined : `${testID}-label`}
      className={`text-micro font-semibold ${labelClass}`}
    >
      {label}
    </Text>
  );

  // A chip with no handler stays a plain View rather than a disabled Pressable:
  // a Pressable still announces itself to TalkBack as something to activate,
  // and most chips in the app are labels, not controls.
  if (!onPress) {
    return (
      <View testID={testID} className={containerClass} style={style}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // React Native's `Pressable` normalizes `accessibilityState` on the
      // underlying host node to a fixed five-key shape (`busy`/`checked`/
      // `disabled`/`expanded`/`selected`, each `undefined` unless supplied)
      // regardless of whether a caller passes this prop at all — confirmed
      // empirically in chip.test.tsx against the pre-`selected` component.
      // So `{ selected }` here reads exactly as it always has, for every
      // call site that leaves `selected` undefined. See `ChipProps.selected`
      // for the full invariant.
      accessibilityState={{ selected }}
      hitSlop={CHIP_HIT_SLOP}
      className={containerClass}
      style={style}
    >
      {body}
    </Pressable>
  );
}

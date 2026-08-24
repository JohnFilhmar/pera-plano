// components/ui/amount_text.tsx — m1c plan Task 1.
//
// THE ONLY MONEY FORMATTER IN THE APP. Global Constraints: "integer centavos in
// state and props; format to ₱1,234.56 only in AmountText. Never format money
// anywhere else." Every amount a user ever reads comes through here, so a bug
// in this file is a bug on every screen at once.
//
// THIS FILE OWNS ONLY THE OUTWARD DIRECTION — centavos to a string a user
// reads. `lib/money/peso_input.ts` owns the way in, keystrokes to centavos;
// numeric-input-system Task 15 retired this file's own `centavosFromDigits`
// once every field that used to call it moved onto that module's keypad.
import { Text } from "react-native";

import type { Centavos } from "@/types/domain";

export type AmountSize = "sm" | "md" | "lg" | "hero";

export type AmountTextProps = {
  amount: Centavos;
  direction?: "in" | "out";
  size?: AmountSize;
  /** Defaults to true when a direction is given; a bare balance never signs. */
  showSign?: boolean;
  /** Transfer legs render muted — they are excluded from every spend total. */
  muted?: boolean;
  testID?: string;
};

/**
 * U+2212 MINUS SIGN, deliberately not a hyphen-minus.
 *
 * A hyphen is narrower than a digit in most faces, so a right-aligned column of
 * amounts — which is where amounts always live — visibly wobbles between rows
 * that have one and rows that do not. The true minus is digit-width by design.
 */
const MINUS = "−";

/**
 * `123456` → `"₱1,234.56"`.
 *
 * Always two decimals, always grouped, always the peso mark. A negative signs
 * the WHOLE figure (`-₱1,234.56`), never the digits after the mark: `₱-1,234.56`
 * reads as a currency called "₱-" and breaks the alignment described above.
 *
 * NOTE — `lib/alerts/alert_copy.ts` keeps its own private `formatPeso`, which
 * rounds to whole pesos (`₱8,400`) for notification copy, per
 * docs/12-encryption-and-app-lock.md §7a's canonical examples. That is not a
 * duplicate of this function and must not be unified with it: this one is the
 * ledger, and a ledger that rounds is simply wrong.
 */
export function formatCentavos(amount: Centavos): string {
  const negative = amount < 0;
  const absolute = Math.abs(amount);

  // Split before formatting rather than dividing by 100: the integer and the
  // fraction are two integers here, and the moment this becomes a float the
  // 12.10 * 100 === 1209.9999 class of bug is back — the same one amount.ts
  // exists to avoid on the parsing side.
  const pesos = Math.trunc(absolute / 100);
  const centavos = absolute % 100;

  const grouped = pesos.toLocaleString("en-US");
  const fraction = String(centavos).padStart(2, "0");

  return `${negative ? "-" : ""}₱${grouped}.${fraction}`;
}

/**
 * `hero` is the safe-to-spend figure: 40sp, 800 weight, tabular. Tabular
 * figures matter here specifically — the number re-renders as transactions
 * land, and proportional digits make it jitter sideways while the user is
 * reading it.
 */
const SIZE_CLASS: Record<AmountSize, string> = {
  sm: "text-secondary",
  md: "text-body",
  lg: "text-title font-semibold",
  hero: "text-hero font-extrabold",
};

/**
 * Direction colours, contract §2 tokens only.
 *
 * `out` is `fg`, NOT `danger`. Ordinary spending is not an error state, and
 * colouring every purchase red teaches the user to ignore the one colour the
 * app needs for things that genuinely are wrong.
 */
function colorClass(direction: "in" | "out" | undefined, muted: boolean): string {
  if (muted) return "text-fg-2 dark:text-fg-2-dark";
  if (direction === "in") return "text-brand dark:text-brand-dark";
  return "text-fg dark:text-fg-dark";
}

function signFor(direction: "in" | "out" | undefined, showSign: boolean): string {
  if (!showSign || direction === undefined) return "";
  return direction === "in" ? "+" : MINUS;
}

export function AmountText({
  amount,
  direction,
  size = "md",
  showSign,
  muted = false,
  testID,
}: AmountTextProps) {
  const signed = showSign ?? direction !== undefined;

  return (
    <Text
      testID={testID}
      className={`${SIZE_CLASS[size]} ${colorClass(direction, muted)}`}
      // Tabular figures at every size, not only `hero` — a balance in a
      // `ListRow`'s `right` slot re-renders on the same feed as the hero
      // number and must not jitter either.
      style={{ fontVariant: ["tabular-nums"] }}
      // The formatted string is one token to a screen reader; splitting the
      // sign into its own element would read the amount as two fragments.
      accessibilityLabel={`${signFor(direction, signed)}${formatCentavos(amount)}`}
    >
      {`${signFor(direction, signed)}${formatCentavos(amount)}`}
    </Text>
  );
}

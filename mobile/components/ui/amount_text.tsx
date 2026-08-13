// components/ui/amount_text.tsx — m1c plan Task 1.
//
// THE ONLY MONEY FORMATTER IN THE APP. Global Constraints: "integer centavos in
// state and props; format to ₱1,234.56 only in AmountText. Never format money
// anywhere else." Every amount a user ever reads comes through here, so a bug
// in this file is a bug on every screen at once.
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
 * The safe ceiling for a typed amount: ₱90,071,992,547,409.91.
 *
 * Past `Number.MAX_SAFE_INTEGER` integer arithmetic silently stops being exact,
 * which in a money app means a balance that does not add up and nothing that
 * throws. Clamping is not a real product limit — it is the point past which the
 * user is leaning on the keypad, and the app must still hold a number it can do
 * arithmetic with.
 */
const MAX_SAFE_CENTAVOS = Number.MAX_SAFE_INTEGER;

/**
 * Keystrokes → centavos. The inverse of `formatCentavos`, and it lives beside it
 * so the two cannot drift apart.
 *
 * BUILT FROM THE DIGITS, NEVER PARSED BACK FROM A FORMATTED STRING. Typing
 * `1`,`2`,`3`,`4` yields `1234` centavos, displayed as `₱12.34` — the same rule
 * m1c Task 8's numpad states, because the alternative
 * (`Number("12.34") * 100 === 1233.9999...`) is the float bug `lib/ingest/
 * amount.ts` exists to avoid, arriving from the other direction.
 *
 * Non-digits are DROPPED rather than rejected: some Android keyboards emit a
 * decimal separator on a numeric keypad, and a field that refused the keystroke
 * would look broken to the one user in ten whose keyboard does it.
 */
export function centavosFromDigits(text: string): Centavos {
  const digits = text.replace(/\D/gu, "");
  if (digits === "") return 0;

  // Trimmed before Number() rather than clamped after: a 30-digit string is
  // already beyond exact representation by the time it becomes a Number, so
  // `Math.min` on the result would be comparing two approximations.
  const trimmed = digits.replace(/^0+/u, "").slice(0, String(MAX_SAFE_CENTAVOS).length - 1);
  return trimmed === "" ? 0 : Number(trimmed);
}

const SIZE_CLASS: Record<AmountSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl font-semibold",
  // The Safe-to-Spend number on Home (rule 4) — must stay legible very large.
  hero: "text-5xl font-bold",
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
      // The formatted string is one token to a screen reader; splitting the
      // sign into its own element would read the amount as two fragments.
      accessibilityLabel={`${signFor(direction, signed)}${formatCentavos(amount)}`}
    >
      {`${signFor(direction, signed)}${formatCentavos(amount)}`}
    </Text>
  );
}

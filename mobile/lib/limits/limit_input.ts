// lib/limits/limit_input.ts — keystrokes to a `Limit.value` (m2 Task 8).
//
// Its own module rather than a helper inside the create screen, for the reason
// `lib/wallets/summary.ts` is not inside `app/(tabs)/wallets.tsx`: this is
// arithmetic on money, it has exactly one correct answer, and it needs to be
// testable without rendering anything. The screen lays out; this converts.
import type { Limit } from "@/types/domain";

/**
 * `"12.5"` → `1250`. A typed percentage in `Limit.value`'s encoding.
 *
 * `Limit.value` for `basis: "percent-of-income"` is "percent × 100 as an
 * integer (12.5% -> 1250). Kept integer so nothing money-adjacent is a float"
 * (types/domain.ts). THE m2 PLAN'S CREATE SCREEN DOES
 * `Math.round(Number(percent))`, which stores 20 for 20% — a hundredth of the
 * intended limit, on a path where nothing throws and the only symptom is a
 * user's ₱7,400 cap silently behaving like ₱74.
 *
 * BUILT FROM THE DIGITS, NEVER `Number(text) * 100`. That multiply is inexact
 * for exactly the inputs a person types: `12.5 * 100` is fine but `1.15 * 100`
 * is `114.99999999999999`, and `Math.round` hides the class of bug rather than
 * removing it. Same reasoning as `centavosFromDigits` in
 * components/ui/amount_text.tsx, which this deliberately mirrors.
 *
 * Extra decimal places are TRUNCATED, not rounded: "12.567" is 12.56%, because
 * rounding up would hand the user a larger limit than they typed, and limits
 * round conservatively everywhere else (rule 10).
 */
export function percentToValue(text: string): Limit["value"] {
  const cleaned = text.replace(/[^\d.]/gu, "");
  if (cleaned === "") return 0;

  const [whole = "", fraction = ""] = cleaned.split(".");
  const hundredths = `${fraction}00`.slice(0, 2);
  const digits = `${whole === "" ? "0" : whole}${hundredths}`;

  // A 20-digit entry is past exact integer representation before it is a
  // Number at all, so it is trimmed rather than clamped afterwards.
  const trimmed = digits.replace(/^0+(?=\d)/u, "").slice(0, 15);
  return Number(trimmed);
}

/** `1250` → `"12.5"`. The inverse, for an edit form's initial value. */
export function valueToPercent(value: Limit["value"]): string {
  const whole = Math.trunc(value / 100);
  const hundredths = Math.abs(value % 100);
  if (hundredths === 0) return String(whole);
  return `${whole}.${String(hundredths).padStart(2, "0").replace(/0$/u, "")}`;
}

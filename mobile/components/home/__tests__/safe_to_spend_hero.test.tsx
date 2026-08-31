// components/home/__tests__/safe_to_spend_hero.test.tsx — mobile-ui-revamp
// Part 2 Task 2.
//
// The one number, in its four states, on three different fills. What can go
// wrong here is not arithmetic — that is lib/safe_to_spend.ts's own suite —
// but presentation: the wrong ink on a fill, a hardcoded weekday, or a hero
// that stops offering the review-queue disclosure it always had.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { FILL_CLASS, MUTED_INK_CLASS, SafeToSpendHero } from "../safe_to_spend_hero";
import { palette } from "@/constants/colors";
import { contrastRatio } from "@/lib/ui/contrast";
import type { SafeToSpendResult } from "@/lib/safe_to_spend";

function result(over: Partial<SafeToSpendResult> = {}): SafeToSpendResult {
  return {
    state: "healthy",
    perDay: 41200,
    headroom: 1_200_000,
    billsTerm: 0,
    contributionsTerm: 0,
    daysRemaining: 20,
    overBy: 0,
    drivingLimitId: "limit-1",
    drivingFilterLabel: null,
    periodEnd: "2026-08-31",
    reviewQueueCount: 0,
    ...over,
  };
}

const BASE = {
  scopeLabel: "monthly",
  dailySeries: [1000, 2000, 1500, 3000, 2200, 1800, 4000] as const,
  startLabel: "Mon",
  endLabel: "Sun",
  paused: false,
  amountsHidden: false,
  onToggleAmounts: () => {},
  onSetLimit: () => {},
  onOpenReviewQueue: () => {},
};

/**
 * Token-exact, not substring. `INK_CLASS.tight` is `"text-fg
 * dark:text-on-brand-dark"` — a plain `string.includes("text-on-brand")`
 * check is TRUE for that string, because "text-on-brand" is a literal
 * substring of "dark:text-on-brand-dark". A `.not.toContain("text-on-brand")`
 * assertion against the raw string would therefore fail on the one state it
 * exists to prove correct. Splitting into tokens and letting Jest's array
 * `toContain` do exact-element matching is what makes that assertion (below,
 * in the "tight" test) actually test what it claims to.
 */
function classesOf(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

test("healthy fills with brand and inks white", () => {
  render(<SafeToSpendHero {...BASE} result={result()} />);
  expect(classesOf("sts-hero")).toContain("bg-brand");
  expect(classesOf("sts-amount")).toContain("text-on-brand");
});

test("tight fills with warn and inks DARK — white on amber is 3.2:1 and fails AA", () => {
  render(<SafeToSpendHero {...BASE} result={result({ state: "tight" })} />);
  expect(classesOf("sts-hero")).toContain("bg-warn");
  expect(classesOf("sts-amount")).toContain("text-fg");
  expect(classesOf("sts-amount")).not.toContain("text-on-brand");
});

test("over fills with danger and inks white", () => {
  render(<SafeToSpendHero {...BASE} result={result({ state: "over", overBy: 31200 })} />);
  expect(classesOf("sts-hero")).toContain("bg-danger");
  expect(classesOf("sts-amount")).toContain("text-on-brand");
});

test("paused drops the fill entirely and says the number is stale", () => {
  render(<SafeToSpendHero {...BASE} paused result={result()} />);
  expect(classesOf("sts-hero")).toContain("bg-surface");
  expect(classesOf("sts-hero")).not.toContain("bg-brand");
  screen.getByTestId("sts-paused-chip");
});

test("the bar strip renders one bar per day given", () => {
  render(<SafeToSpendHero {...BASE} result={result()} />);
  for (let index = 0; index < 7; index += 1) {
    screen.getByTestId(`sts-bars-bar-${index}`);
  }
});

test("hiding amounts replaces the figure without unmounting the hero", () => {
  render(<SafeToSpendHero {...BASE} amountsHidden result={result()} />);
  expect(screen.getByTestId("sts-amount")).toHaveTextContent("₱•••••");
  expect(screen.queryByText("₱412.00")).toBeNull();
});

test("hiding amounts also masks the over-by figure — no prior test exercised state:over with amountsHidden together, which is how this figure kept leaking", () => {
  render(
    <SafeToSpendHero
      {...BASE}
      amountsHidden
      result={result({ state: "over", overBy: 31200 })}
    />,
  );
  expect(screen.getByTestId("sts-amount")).toHaveTextContent("₱•••••");
  const overBy = screen.getByTestId("sts-over-by");
  expect(overBy).toHaveTextContent("You're ₱••••• over for this period");
  expect(screen.queryByText(/₱412\.00/)).toBeNull();
  expect(screen.queryByText(/₱312\.00/)).toBeNull();
});

test("the eye toggle reports a press", () => {
  const onToggleAmounts = jest.fn();
  render(<SafeToSpendHero {...BASE} onToggleAmounts={onToggleAmounts} result={result()} />);
  fireEvent.press(screen.getByTestId("sts-eye"));
  expect(onToggleAmounts).toHaveBeenCalledTimes(1);
});

test("no_limit still offers the set-a-limit route and draws no bars", () => {
  render(<SafeToSpendHero {...BASE} result={result({ state: "no_limit" })} />);
  screen.getByTestId("sts-set-limit");
  expect(screen.queryByTestId("sts-bars-bar-0")).toBeNull();
});

test("the review-queue disclosure survives the restyle", () => {
  render(<SafeToSpendHero {...BASE} result={result({ reviewQueueCount: 3 })} />);
  screen.getByTestId("sts-review-note");
});

// ---------------------------------------------------------------------------
// The StatTile-style ink regression, guarded structurally
// ---------------------------------------------------------------------------
test("the amount is a direct string on the toned Text, not a nested element that could silently eat the ink", () => {
  // components/ui/stat_tile.tsx documents the shape of this bug: nesting
  // AmountText (which always sets its own colour) inside a toned wrapper
  // compiles, looks plausible, and passes a test that only reads the
  // wrapper's own className. Asserting the child is a plain STRING — not a
  // React element — is the one check that would actually break if this ever
  // regressed back to a nested <AmountText>.
  render(<SafeToSpendHero {...BASE} result={result({ state: "over", overBy: 31200 })} />);
  const amount = screen.getByTestId("sts-amount");
  expect(typeof amount.props.children).toBe("string");
  expect(amount.props.children).toBe("₱412.00");
});

// ---------------------------------------------------------------------------
// MUTED_INK_CLASS clears WCAG AA — measured, not eyeballed (branch review F2)
// ---------------------------------------------------------------------------
// Same method components/ui/__tests__/chip_contrast.test.ts already uses for
// the soft-chip ink tokens: recompute the actually-composited colour with
// lib/ui/contrast.ts's own algorithm and assert the ratio, so a palette or
// opacity change fails a test instead of shipping unmeasured.
//
// Unlike chip_contrast.test.ts (which re-derives its ink/tint pair from
// `palette` alone, since chip.tsx's TONE_TEXT map isn't exported), this block
// reads `FILL_CLASS`/`MUTED_INK_CLASS` directly off the component. That is
// the difference between "these specific colours are AA-safe" and "the
// colours this component actually ships are AA-safe" — only the latter fails
// if someone reintroduces a `/NN` opacity modifier on MUTED_INK_CLASS.

const AA = 4.5;

/**
 * Alpha-blend `tokenHex` at `alpha` straight over `backdropHex` — what a
 * `/NN`-opacity Tailwind class actually paints when nothing sits between the
 * Text and its background. Same composite math chip_contrast.test.ts uses.
 */
function composite(tokenHex: string, alpha: number, backdropHex: string): string {
  const parse = (hex: string) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const [tr, tg, tb] = parse(tokenHex);
  const [br, bg, bb] = parse(backdropHex);
  const mix = (t: number, b: number) => Math.round(t * alpha + b * (1 - alpha));
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(mix(tr, br))}${hex(mix(tg, bg))}${hex(mix(tb, bb))}`;
}

type ParsedToken = { name: string; alpha: number };

/**
 * Every entry in `FILL_CLASS`/`MUTED_INK_CLASS` is exactly two
 * space-separated classes: the light one, then its `dark:`-prefixed sibling
 * — e.g. `"text-on-brand/80 dark:text-on-brand-dark/80"`. Splits that literal
 * shape into the palette key and opacity (default 100) each side names, so
 * the test reads whatever the component actually exports instead of a
 * hand-copied duplicate of it.
 */
function parseLightDark(raw: string, stylePrefix: "text" | "bg"): { light: ParsedToken; dark: ParsedToken } {
  const [lightRaw, darkRaw] = raw.split(/\s+/).filter(Boolean);
  const parseOne = (token: string): ParsedToken => {
    const body = token.startsWith("dark:") ? token.slice("dark:".length) : token;
    const withoutStyle = body.slice(`${stylePrefix}-`.length);
    const [name, alphaPct] = withoutStyle.split("/");
    return { name, alpha: alphaPct === undefined ? 1 : Number(alphaPct) / 100 };
  };
  return { light: parseOne(lightRaw), dark: parseOne(darkRaw) };
}

function resolveHex(tokenName: string): string {
  const hex = (palette as Record<string, string>)[tokenName];
  if (hex === undefined) {
    throw new Error(`no palette token named "${tokenName}"`);
  }
  return hex;
}

/** The colour a viewer's eye actually sees: ink composited over its fill. */
function paintedInk(ink: ParsedToken, fillHex: string): string {
  const inkHex = resolveHex(ink.name);
  return ink.alpha >= 1 ? inkHex : composite(inkHex, ink.alpha, fillHex);
}

test.each(["healthy", "tight", "over"] as const)(
  "MUTED_INK_CLASS.%s, as actually exported by safe_to_spend_hero.tsx, clears AA in light and dark",
  (state) => {
    const fill = parseLightDark(FILL_CLASS[state], "bg");
    const ink = parseLightDark(MUTED_INK_CLASS[state], "text");

    const lightFillHex = resolveHex(fill.light.name);
    expect(contrastRatio(paintedInk(ink.light, lightFillHex), lightFillHex)).toBeGreaterThanOrEqual(
      AA,
    );

    const darkFillHex = resolveHex(fill.dark.name);
    expect(contrastRatio(paintedInk(ink.dark, darkFillHex), darkFillHex)).toBeGreaterThanOrEqual(AA);
  },
);

test("the /80 opacity this file used to ship fails AA on every light-mode state — why MUTED_INK_CLASS is full-strength, not dimmed", () => {
  expect(
    contrastRatio(composite(palette["on-brand"], 0.8, palette.brand), palette.brand),
  ).toBeLessThan(AA);
  expect(contrastRatio(composite(palette.fg, 0.8, palette.warn), palette.warn)).toBeLessThan(AA);
  expect(
    contrastRatio(composite(palette["on-brand"], 0.8, palette.danger), palette.danger),
  ).toBeLessThan(AA);
});

test("over/light has almost no headroom — even a 95% opacity (a 5% reduction) still fails AA", () => {
  const ratio = contrastRatio(composite(palette["on-brand"], 0.95, palette.danger), palette.danger);
  expect(ratio).toBeLessThan(AA);
});

// ---------------------------------------------------------------------------
// The set-aside disclosure — owner's 2026-08-31 report.
//
// The reported screen said "You're ₱2,220.00 over for this period / from your
// 8 categories limit" directly above a limits list reading "Daily limit · 8
// categories  ₱0.00 / ₱280.00 · ₱280.00 left". BOTH WERE TRUE. Today was a
// kinsenas payday and a ₱2,500 scheduled goal contribution was deducted from a
// ₱280 daily headroom: 280 − 2500 = −2220, which is exactly what rules 7 and
// 15 prescribe for a daily scope.
//
// What was missing is the sentence that makes those two figures legible
// together. Key flows rule 2: the caption shows "the amounts deducted for
// Bills and Goal contributions". The hero computed `billsTerm` and
// `contributionsTerm`, carried them on the result, and rendered neither — so on
// any day a bill or a contribution drove the number, the screen contradicted
// the limits list beneath it with no way to resolve the contradiction.
// ---------------------------------------------------------------------------

test("REPORTED SCREEN: an overage driven purely by a goal contribution says so", () => {
  render(
    <SafeToSpendHero
      {...BASE}
      scopeLabel="daily"
      result={result({
        state: "over",
        perDay: 0,
        headroom: 28000,
        contributionsTerm: 250000,
        daysRemaining: 1,
        overBy: 222000,
        drivingFilterLabel: "8 categories",
      })}
    />,
  );

  // The overage line and the limit attribution are unchanged.
  expect(screen.getByTestId("sts-over-by")).toHaveTextContent(/₱2,220.00 over/);

  // The new line. Without it, ₱280.00 of headroom and ₱2,220.00 of overage sit
  // on one screen with nothing connecting them.
  expect(screen.getByTestId("sts-set-aside")).toHaveTextContent(
    "₱2,500.00 to goals is already set aside",
  );
});

test("bills and contributions are named separately when both are deducted", () => {
  render(
    <SafeToSpendHero
      {...BASE}
      result={result({
        state: "over",
        perDay: 0,
        billsTerm: 399900,
        contributionsTerm: 100000,
        overBy: 50000,
      })}
    />,
  );

  // The spec's own worked phrasing (key flows rule 2).
  expect(screen.getByTestId("sts-set-aside")).toHaveTextContent(
    "₱3,999.00 in bills and ₱1,000.00 to goals are already set aside",
  );
});

test("the line names only the term that is actually non-zero", () => {
  render(
    <SafeToSpendHero
      {...BASE}
      result={result({ state: "tight", billsTerm: 399900, contributionsTerm: 0 })}
    />,
  );

  const line = screen.getByTestId("sts-set-aside");
  expect(line).toHaveTextContent("₱3,999.00 in bills is already set aside");
  expect(line).not.toHaveTextContent(/goals/);
});

test("nothing set aside renders no line at all — not a '₱0.00 set aside'", () => {
  render(<SafeToSpendHero {...BASE} result={result()} />);
  expect(screen.queryByTestId("sts-set-aside")).toBeNull();
});

test("the set-aside figures hide with the rest of the amounts", () => {
  // The eye toggle exists so a user can open the app in public. A line that
  // kept printing ₱2,500.00 while every other figure was masked would leak
  // exactly what the toggle is for.
  render(
    <SafeToSpendHero
      {...BASE}
      amountsHidden
      result={result({ state: "over", perDay: 0, contributionsTerm: 250000, overBy: 222000 })}
    />,
  );

  const line = screen.getByTestId("sts-set-aside");
  expect(line).not.toHaveTextContent("2,500");
  expect(line).toHaveTextContent(/set aside/);
});

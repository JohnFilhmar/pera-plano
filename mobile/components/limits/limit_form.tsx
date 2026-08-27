// components/limits/limit_form.tsx — the Limit editor, extracted from
// app/(tabs)/plan/limits/new.tsx so CREATE and EDIT are the same form.
//
// WHY EXTRACT RATHER THAN COPY. The owner's report is that limits "should still
// be modifiable"; the create screen already had every control an edit needs.
// A second hand-written copy on the edit route is how the two drift — one
// gaining the percent-of-income guard, the other keeping the old rollover copy
// — and a limit edited on a screen that disagrees with the one it was created
// on is a bug the user has no way to explain.
//
// PERCENT IS ENTERED AS A PERCENTAGE AND STORED AS PERCENT × 100, carried over
// from the create screen verbatim. `Limit.value` is "percent × 100 as an
// integer (12.5% -> 1250)" per types/domain.ts — kept integer so nothing
// money-adjacent is a float. The m2 plan's own snippet does
// `Math.round(Number(percent))`, which stores 20 for 20% and makes every
// percent-of-income limit a hundredth of its real size, with nothing throwing.
// The peso field has the same hazard from the other direction, which is why it
// goes through `centavosFrom` rather than `Number(x) * 100`
// (`12.34 * 100 === 1233.9999...`).
//
// RESTYLED to the "Create limit · with hindsight preview" board
// (mobile-ui-revamp Part 3 Task 4b). CREATE and EDIT share every control below
// — the board is drawn for create, but an edit that could no longer touch a
// limit's category/wallet scope after this file grew that capability would be
// a regression, not a restyle, so both routes get it.
//
// THE HERO FIGURE IS `NumericField size="hero"` ITSELF, not a decorative
// duplicate — `numeric_field.tsx`'s own header records the exact bug that
// shipped first (a big number that did nothing when pressed, sitting over the
// small real control). `limit-amount-preview` stays alongside it regardless:
// the live field shows `formatPesoInput` ("₱8,000" mid-type, no trailing
// zeros), and `limit_routes.test.tsx` asserts the CENTAVOS-precise
// `formatCentavos` string ("₱8,000.00") separately — the two are genuinely
// different strings for the same amount, not one control drawn twice.
//
// THE PERCENT FIELD SHOWS WHAT THE PERCENTAGE COMES TO (2026-08-26), the same
// live sentence the onboarding first-Limit step has always had. "20%" on its
// own is not a limit a person can judge; "₱6,000.00 every month is about
// ₱197.26 a day" is. Both screens render components/limits/limit_preview.tsx
// rather than each computing it, so the figure quoted here and the figure the
// engine later enforces come from the same `baseFor`/`dailyRateOf` pair. The
// fixed branch keeps its own centavos-exact `limit-amount-preview` line (see
// below) — that one restates what was keyed, this one resolves what was keyed
// against income, and they are different questions.
//
// "Warn me at" IS INFORMATIONAL, NOT A PICKER. The design board describes all
// three ListRows as "each opening its existing picker", but
// `types/domain.ts`'s `LimitThreshold = 50 | 80 | 100` is a fixed union —
// nothing in this codebase lets a user configure a warning threshold, so
// there is no picker for this row to open. Per the brief's own instruction for
// the (also-missing) hindsight preview — "don't invent a query in a restyle
// task" — this row states the fixed rule and takes no `onPress`, rather than
// wiring up a sheet that would save a value nothing reads.
import { useState } from "react";
import { Text, View } from "react-native";

import { LimitPreview } from "@/components/limits/limit_preview";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatCentavos } from "@/components/ui/amount_text";
import { ListRow } from "@/components/ui/list_row";
import { NumericField } from "@/components/ui/numeric_field";
import { SegmentedControl } from "@/components/ui/segmented_control";
import { Switch } from "@/components/ui/switch";
import { percentToValue, valueToPercent } from "@/lib/limits/limit_input";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import type {
  Category,
  Centavos,
  Limit,
  LimitBasis,
  LimitScope,
  Wallet,
} from "@/types/domain";

const SCOPES: readonly LimitScope[] = ["daily", "weekly", "monthly", "annual"];

export const SCOPE_LABEL: Record<LimitScope, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual",
};

// NOT `as const` — that assertion only applies to a literal expression, and
// `.map()`'s result is not one (TS1355). Unneeded regardless: `SCOPES`'s own
// element type is already the closed `LimitScope` union, not `string`, so the
// callback parameter — and everything derived from it — stays that narrow
// union through plain inference, which is what `SegmentedControl`'s `T` needs.
const SCOPE_SEGMENTS = SCOPES.map((scope) => ({ value: scope, label: SCOPE_LABEL[scope] }));

/**
 * A presentation-only union, mapped to/from the real `LimitBasis` at the two
 * points below. "percent" reads better as a segment label than
 * "percent-of-income" AND keeps `SegmentedControl`'s auto-generated child
 * testID at `limit-basis-percent` — the id this screen shipped with before
 * `SegmentedControl` existed, and nothing outside this file may rename it
 * (Global Constraints). Nothing outside this file ever sees "percent" as a
 * `LimitBasis` — `LimitBasis` itself is untouched.
 */
type BasisSegment = "fixed" | "percent";
const BASIS_SEGMENTS = [
  { value: "fixed", label: "Amount ₱" },
  { value: "percent", label: "% of income" },
] as const satisfies ReadonlyArray<{ value: BasisSegment; label: string }>;

/** Quick-fill chips beneath the hero figure — ₱1,000 / ₱3,000 / ₱5,000. */
const PESO_PRESETS: readonly number[] = [100000, 300000, 500000];
/** Quick-fill chips for the percent-of-income figure — 10% / 20% / 30%. */
const PERCENT_PRESETS: readonly number[] = [1000, 2000, 3000];

export type LimitFormValues = {
  scope: LimitScope;
  basis: LimitBasis;
  /** Centavos for `fixed`; percent × 100 for `percent-of-income`. */
  value: number;
  rollover: boolean;
  /** `null` means "everything" — every category counts (limits_repo.ts). */
  categoryFilter: string[] | null;
  /** `null` means every wallet counts. */
  walletFilter: string[] | null;
};

export type LimitFormProps = {
  onSubmit: (values: LimitFormValues) => void;
  /** True when the app knows a monthly-equivalent income it can multiply. */
  incomeUsable: boolean;
  /**
   * The income figure itself, for the percent preview below. Separate from
   * `incomeUsable` rather than replacing it: the routes have carried that
   * boolean since m2 Task 8 and `null` is not the only way a percent basis can
   * be unusable. `null` simply means no sentence is drawn.
   */
  monthlyIncome?: Centavos | null;
  /** Opens the income flow from the percent-of-income guard. */
  onDeclareIncome: () => void;
  busy?: boolean;
  initial?: Partial<LimitFormValues>;
  submitLabel?: string;
  testID?: string;
  /**
   * "What are you capping?" chip row. Top-level categories only — a
   * subcategory already counts toward its parent's filter
   * (`lib/limits/limit_engine.ts`'s `expandCategoryIds`), so listing every
   * leaf here would just be noise. Presentational (Global Constraints: no
   * repository import inside a component) — the two routes below own
   * `useCategories()`.
   */
  categories?: Category[];
  /** "Wallets counted" picker's rows. The routes own `useWallets()`. */
  wallets?: Wallet[];
};

/** Step 2's field rhythm: the label that sits above every control below. */
function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">{children}</Text>
  );
}

/**
 * The form's own text seed for whichever field the basis uses.
 *
 * SPLIT BY BASIS BECAUSE THE UNITS ARE NOT THE SAME. `value` is centavos under
 * `fixed` and percent × 100 under `percent-of-income`, so one shared
 * `String(value)` would seed an 8,000-peso limit as "800000" AND a 20% limit as
 * "2000". Each goes through the converter that owns its unit.
 */
function seedFor(basis: LimitBasis, value: number | undefined): { peso: string; percent: string } {
  if (value === undefined) return { peso: "", percent: "" };
  return basis === "fixed"
    ? { peso: pesoInputFrom(value), percent: "" }
    : { peso: "", percent: valueToPercent(value) };
}

export function LimitForm({
  onSubmit,
  incomeUsable,
  monthlyIncome = null,
  onDeclareIncome,
  busy = false,
  initial,
  submitLabel = "Save",
  testID = "limit-form",
  categories = [],
  wallets = [],
}: LimitFormProps) {
  const [scope, setScope] = useState<LimitScope>(initial?.scope ?? "monthly");
  const [basis, setBasis] = useState<LimitBasis>(initial?.basis ?? "fixed");
  const seed = seedFor(initial?.basis ?? "fixed", initial?.value);
  const [pesoText, setPesoText] = useState(seed.peso);
  const [percentText, setPercentText] = useState(seed.percent);
  const [rollover, setRollover] = useState(initial?.rollover ?? false);
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(
    initial?.categoryFilter ?? null,
  );
  const [walletFilter, setWalletFilter] = useState<string[] | null>(initial?.walletFilter ?? null);
  const [resetsSheetOpen, setResetsSheetOpen] = useState(false);
  const [walletsSheetOpen, setWalletsSheetOpen] = useState(false);

  const percentBlocked = basis === "percent-of-income" && !incomeUsable;
  const value = basis === "fixed" ? centavosFrom(pesoText) : percentToValue(percentText);
  // `value > 0` is 001_core.sql's own CHECK. Blocking here turns a database
  // constraint violation into a disabled button.
  const canSave = !percentBlocked && value > 0 && !busy;

  const topLevelCategories = categories.filter((category) => category.parentId === null);
  const activeWallets = wallets.filter((wallet) => !wallet.isArchived);

  function toggleCategory(id: string): void {
    setCategoryFilter((current) => {
      const selected = current ?? [];
      const next = selected.includes(id)
        ? selected.filter((existing) => existing !== id)
        : [...selected, id];
      return next.length === 0 ? null : next;
    });
  }

  function toggleWallet(id: string): void {
    setWalletFilter((current) => {
      const selected = current ?? [];
      const next = selected.includes(id)
        ? selected.filter((existing) => existing !== id)
        : [...selected, id];
      return next.length === 0 ? null : next;
    });
  }

  return (
    <View testID={testID} className="gap-6 bg-bg px-4 pt-4 dark:bg-bg-dark">
      <View className="gap-2">
        <FieldLabel>What are you capping?</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          <Chip
            testID="limit-category-everything"
            label="Everything"
            fill={categoryFilter === null ? "solid" : "outline"}
            selected={categoryFilter === null}
            onPress={() => setCategoryFilter(null)}
          />
          {topLevelCategories.map((category) => (
            <Chip
              key={category.id}
              testID={`limit-category-${category.id}`}
              label={category.name}
              fill={(categoryFilter ?? []).includes(category.id) ? "solid" : "outline"}
              selected={(categoryFilter ?? []).includes(category.id)}
              onPress={() => toggleCategory(category.id)}
            />
          ))}
        </View>
      </View>

      <Card>
        <FieldLabel>Amount</FieldLabel>
        <View className="mt-2">
          <SegmentedControl
            testID="limit-basis"
            segments={BASIS_SEGMENTS}
            value={basis === "fixed" ? "fixed" : "percent"}
            onChange={(next) => setBasis(next === "fixed" ? "fixed" : "percent-of-income")}
          />
        </View>

        {basis === "fixed" ? (
          <>
            <View className="mt-4">
              <NumericField
                testID="limit-amount"
                label="Limit amount"
                mode="peso"
                placeholder="₱0"
                value={pesoText}
                onChangeText={setPesoText}
                size="hero"
              />
            </View>
            {/* The field itself shows what has been KEYED (₱8,000 while
                typing); this line states the same figure the way the row will
                be stored, centavos and all, before the user commits to it. */}
            <Text
              testID="limit-amount-preview"
              className="mt-2 text-center text-fg-2 dark:text-fg-2-dark"
            >
              {formatCentavos(centavosFrom(pesoText))}
            </Text>
            <View className="mt-3 flex-row flex-wrap justify-center gap-2">
              {PESO_PRESETS.map((preset) => (
                <Chip
                  key={preset}
                  testID={`limit-amount-preset-${preset}`}
                  label={formatCentavos(preset)}
                  fill="outline"
                  onPress={() => setPesoText(pesoInputFrom(preset))}
                />
              ))}
            </View>
          </>
        ) : (
          <>
            <View className="mt-4">
              {/* `rate`, not `peso`: a percent is not money, so the panel's
                  read-out suffixes a % instead of prefixing a ₱ and grouping. */}
              <NumericField
                testID="limit-percent"
                label="Percent of income"
                mode="rate"
                placeholder="0%"
                value={percentText}
                onChangeText={setPercentText}
                size="hero"
              />
            </View>
            <View className="mt-3 flex-row flex-wrap justify-center gap-2">
              {PERCENT_PRESETS.map((preset) => (
                <Chip
                  key={preset}
                  testID={`limit-percent-preset-${preset}`}
                  label={`${valueToPercent(preset)}%`}
                  fill="outline"
                  onPress={() => setPercentText(valueToPercent(preset))}
                />
              ))}
            </View>
            {/* Only when there is an income to resolve against — the blocked
                card just below is what the other case gets, and drawing
                "₱0.00 every month" beside it would contradict it. */}
            {percentBlocked || monthlyIncome === null ? null : (
              <LimitPreview
                testID="limit-percent-preview"
                basis={basis}
                value={value}
                scope={scope}
                monthlyIncome={monthlyIncome}
                className="mt-2 text-center text-fg-2 dark:text-fg-2-dark"
              />
            )}
          </>
        )}

        {percentBlocked ? (
          <Card variant="flat">
            <Text testID="limit-percent-blocked" className="text-fg dark:text-fg-dark">
              Percent-of-income needs to know what you earn. Set your income now, or use a fixed
              amount instead — you can change this limit later either way.
            </Text>
            {/* Spec step 3 offers exactly two ways out: "declare income now
                (opens the income flow) or switch to fixed". Both are here. */}
            <View className="mt-3">
              <Button
                title="Set my income"
                variant="secondary"
                testID="limit-declare-income"
                onPress={onDeclareIncome}
              />
            </View>
          </Card>
        ) : null}
      </Card>

      <View className="gap-3 rounded-xl bg-chip dark:bg-chip-dark">
        <ListRow
          testID="limit-resets-row"
          title="Resets"
          subtitle={SCOPE_LABEL[scope]}
          onPress={() => setResetsSheetOpen(true)}
        />
        <ListRow
          testID="limit-wallets-row"
          title="Wallets counted"
          subtitle={
            walletFilter === null
              ? "All wallets"
              : `${walletFilter.length} wallet${walletFilter.length === 1 ? "" : "s"}`
          }
          onPress={() => setWalletsSheetOpen(true)}
        />
        {/* Informational, not a picker — see this file's header. */}
        <ListRow
          testID="limit-warn-row"
          title="Warn me at"
          subtitle="50%, 80% and 100% of your limit"
        />
      </View>

      <BottomSheet
        visible={resetsSheetOpen}
        onDismiss={() => setResetsSheetOpen(false)}
        title="Resets"
      >
        <View testID="limit-resets-sheet">
          <SegmentedControl
            testID="limit-scope"
            segments={SCOPE_SEGMENTS}
            value={scope}
            onChange={(next) => {
              setScope(next);
              setResetsSheetOpen(false);
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={walletsSheetOpen}
        onDismiss={() => setWalletsSheetOpen(false)}
        title="Wallets counted"
      >
        <View testID="limit-wallets-sheet" className="gap-1">
          <ListRow
            testID="limit-wallet-all"
            title="All wallets"
            onPress={() => setWalletFilter(null)}
            right={
              <Chip label={walletFilter === null ? "Counted" : "All"} tone="brand" fill="soft" />
            }
          />
          {activeWallets.map((wallet) => {
            const counted = (walletFilter ?? []).includes(wallet.id);
            return (
              <ListRow
                key={wallet.id}
                testID={`limit-wallet-${wallet.id}`}
                title={wallet.name}
                onPress={() => toggleWallet(wallet.id)}
                right={
                  <Chip
                    label={counted ? "Counted" : "Not counted"}
                    tone={counted ? "brand" : "neutral"}
                    fill={counted ? "soft" : "outline"}
                  />
                }
              />
            );
          })}
        </View>
      </BottomSheet>

      <ListRow
        testID="limit-rollover-row"
        title="Rollover"
        // Spec step 5 asks for "a one-line explanation of the rollover rule".
        // Both halves matter: it carries forward, and it never stacks (rules
        // 14-16).
        subtitle="Unused headroom carries into the next period, never stacking"
        // 60 characters beside a bare Switch, no left icon, not Card-wrapped
        // — branch-review-correctness.md F2's defect class, missed on this
        // row too. `Math.ceil(60 / 22)`; see app/(tabs)/more/index.tsx's
        // header for where the 22 chars/line comes from.
        subtitleLines={3}
        right={
          <Switch
            testID="limit-rollover"
            value={rollover}
            onValueChange={setRollover}
            // branch-review-design.md F4: this Switch had no accessibility
            // props at all, unlike its two restyled siblings in the same
            // diff (components/privacy/capture_toggle.tsx's
            // capture-toggle-switch, components/privacy/
            // provider_switch_list.tsx's provider-switch-*) — matching
            // their exact pattern, not inventing a new one.
            accessibilityRole="switch"
            accessibilityLabel="Rollover"
            accessibilityState={{ checked: rollover }}
          />
        }
      />

      <Button
        title={submitLabel}
        testID="limit-save"
        size="lg"
        onPress={() =>
          canSave && onSubmit({ scope, basis, value, rollover, categoryFilter, walletFilter })
        }
        disabled={!canSave}
        loading={busy}
      />
    </View>
  );
}

/** Seeds this form from a stored limit. */
export function limitFormInitialFrom(limit: Limit): Partial<LimitFormValues> {
  return {
    scope: limit.scope,
    basis: limit.basis,
    value: limit.value,
    rollover: limit.rollover,
    categoryFilter: limit.categoryFilter,
    walletFilter: limit.walletFilter,
  };
}

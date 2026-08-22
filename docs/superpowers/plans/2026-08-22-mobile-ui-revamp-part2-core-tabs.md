# Mobile UI Revamp — Part 2: Core Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Home, Transactions, Wallets and Plan to the design, using only the atoms Part 1 built.

**Architecture:** One tab per commit. Plan is the only structural change — it becomes a segmented host over four extracted panels, while its four routes stay alive so deep links and Android back keep working. Everything else is composition and class strings over data the app already computes, with one new query (`useDailySpend`).

**Tech Stack:** Expo 54 · React Native 0.81.5 · expo-router 6 · NativeWind 4.2.6 · Tailwind 3.4.19 · TanStack Query 5 · op-sqlite · lucide-react-native · jest-expo + @testing-library/react-native

**Spec:** `docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md`

**Prerequisite:** Part 1 is merged. `Chip` has `fill`, and `SegmentedControl`, `ProviderBadge`, `StatTile`, `MiniBars`, `ShareBar` and `Fab` all exist.

## Global Constraints

Everything in Part 1's Global Constraints still applies. Additionally:

- **No feature changes.** Every number on screen is already computed somewhere in the app. This part re-presents them; it does not invent new domain logic.
- **`SafeToSpendState` is `"healthy" | "tight" | "over" | "no_limit"`.** The design's fourth board, "tracking interrupted", is not a fifth state — it is the listener being down, which `useListenerHealth()` reports and `TrackingBanner` already renders. The hero receives it as a separate `paused` boolean.
- **Hero ink is not uniform, and this is load-bearing.** White clears AA on `brand` (5.02:1) and `danger` (4.83:1). On `warn` `#D97706` white reaches only **3.2:1**. The amber hero therefore takes dark ink — `fg` on `warn` measures **5.30:1**. This is the same exception `components/ui/chip.tsx` already documents for amber. In dark mode all three fills take `on-brand-dark` (brand-dark 7.79:1, danger-dark 6.42:1, warn-dark 10.63:1).
- **Wallet type grouping stays.** The design's Wallets board shows a flat list, but its sample data has exactly one wallet per type, so a grouped list and a flat list render identically there. `groupWalletsByType` and the archived-group rule are existing documented behaviour; this plan reads the board as "not showing grouping" rather than "removing it". **If the owner wants a genuinely flat list, that is a one-line change in Task 5 and should be raised before it lands.**
- **Transactions already has a floating add button** (`transactions-add`, a `Button` at `absolute bottom-6 right-6`). Task 4 swaps it for `Fab`; it is not new. Home has none — that one is new.

## How to read the restyle tasks

Tasks 1, 2, 3, 6 and 7 give full code, because they create components, add a query, or change navigation.

Tasks 4, 4b, 5 and 5b do not. They restyle existing files whose current contents this plan's author did not read line by line, and invented JSX for them would look right while silently dropping a `testID`, an accessibility label, or a branch that a comment in the file explains. Those tasks specify the **target composition** exactly — which component, which tone, which token, which `testID`s are load-bearing — and each begins by reading the file.

If a step names a class string you cannot find, the file has moved on since this plan was written. Follow the file, not the plan, and say so in the commit message.

---

### Task 1: `useDailySpend(7)`

**Files:**
- Modify: `mobile/lib/db/repos/transactions_repo.ts`
- Create: `mobile/hooks/queries/use_daily_spend.ts`
- Modify: `mobile/constants/query_keys.ts`
- Create: `mobile/lib/db/repos/__tests__/daily_spend.test.ts`

**Interfaces:**
- Consumes: the existing `getDb()` / `db.getAllAsync` pattern in `transactions_repo.ts`.
- Produces:
  - `dailySpend(args: { days: number; endingOn: string }): Promise<number[]>` in `transactions_repo.ts` — returns exactly `days` entries, oldest first, in centavos.
  - `useDailySpend(days: number)` in `hooks/queries/use_daily_spend.ts`.
  - `queryKeys.transactions.dailySpend(days: number)`.

**Why this exists.** `app/(tabs)/index.tsx:47` calls `useTransactions({})` unfiltered, and it does so only to test `transactions.length === 0` for the empty state. Feeding the hero's seven bars from that list would re-read the entire ledger on every focus. Aggregating in SQL returns seven rows whatever the history size.

- [ ] **Step 1: Write the failing test**

Create `mobile/lib/db/repos/__tests__/daily_spend.test.ts`. Follow the existing setup in `mobile/lib/db/repos/__tests__/` — read one neighbouring test file first and reuse its database bootstrap verbatim rather than writing a new one.

```ts
import { dailySpend, insertTransaction } from "../transactions_repo";
// plus whatever the neighbouring repo tests import to open a test database

test("returns exactly `days` buckets even when the ledger is empty", async () => {
  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series).toHaveLength(7);
  expect(series.every((value) => value === 0)).toBe(true);
});

test("buckets are oldest first", async () => {
  await insertTransaction(makeOutflow({ amount: 10000, occurredAt: "2026-08-16T09:00:00.000Z" }));
  await insertTransaction(makeOutflow({ amount: 50000, occurredAt: "2026-08-22T09:00:00.000Z" }));

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series[0]).toBe(10000);
  expect(series[6]).toBe(50000);
});

test("a day with several transactions sums them", async () => {
  await insertTransaction(makeOutflow({ amount: 10000, occurredAt: "2026-08-22T09:00:00.000Z" }));
  await insertTransaction(makeOutflow({ amount: 2500, occurredAt: "2026-08-22T18:00:00.000Z" }));

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series[6]).toBe(12500);
});

test("inflows are not spending and never appear in the series", async () => {
  await insertTransaction(makeInflow({ amount: 925000, occurredAt: "2026-08-22T09:00:00.000Z" }));

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series[6]).toBe(0);
});

test("transfers between the user's own wallets are not spending", async () => {
  await insertTransaction(makeTransferOut({ amount: 200000, occurredAt: "2026-08-22T09:00:00.000Z" }));

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series[6]).toBe(0);
});

test("anything older than the window is excluded", async () => {
  await insertTransaction(makeOutflow({ amount: 99900, occurredAt: "2026-07-01T09:00:00.000Z" }));

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series.every((value) => value === 0)).toBe(true);
});
```

Define `makeOutflow`, `makeInflow` and `makeTransferOut` as local helpers in this file, built from the `NewTransaction` shape `insertTransaction` already takes — read its signature in `transactions_repo.ts` and mirror it exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- daily_spend`
Expected: FAIL — `dailySpend` is not exported.

- [ ] **Step 3: Implement `dailySpend`**

Add to `mobile/lib/db/repos/transactions_repo.ts`, directly beneath `sumSpend`:

```ts
/**
 * Daily outflow totals for the Home hero's seven-bar strip, oldest first,
 * always exactly `days` long.
 *
 * AGGREGATES IN SQL RATHER THAN IN JS, and that is the entire point of the
 * function. Home already held an unfiltered `useTransactions({})` and could
 * have summed it in memory — but that list grows with the user's history and
 * is re-read on every focus, to draw seven small bars. This returns seven rows
 * on a ledger of seven transactions and seven rows on a ledger of seven
 * thousand.
 *
 * WHAT COUNTS AS SPENDING here is the same rule `sumSpend` uses: outflows only,
 * transfer legs excluded (invariant I2 — moving your own money between your own
 * wallets is not spending, and counting it would double-count every top-up).
 *
 * NOT CLAMPED to the tier's history floor. Seven days is inside every window
 * the tier matrix defines, so clamping would be arithmetic with no effect and
 * one more thing to get wrong.
 */
export async function dailySpend(args: { days: number; endingOn: string }): Promise<number[]> {
  const db = await getDb();

  // `endingOn` is a local YYYY-MM-DD date, and `occurred_at` is stored UTC.
  // SQLite's `date()` with 'localtime' converts each row to the device's day
  // before grouping, so a 23:40 purchase lands on the day the user made it
  // rather than the following UTC one.
  const rows = await db.getAllAsync<{ day: string; total: number }>(
    `SELECT date(occurred_at, 'localtime') AS day, COALESCE(SUM(amount), 0) AS total
       FROM transactions
      WHERE direction = 'out'
        AND is_transfer = 0
        AND date(occurred_at, 'localtime') > date(?, ?)
        AND date(occurred_at, 'localtime') <= date(?)
      GROUP BY day`,
    [args.endingOn, `-${args.days} days`, args.endingOn],
  );

  const byDay = new Map(rows.map((row) => [row.day, row.total]));

  const series: number[] = [];
  for (let offset = args.days - 1; offset >= 0; offset -= 1) {
    const day = new Date(`${args.endingOn}T00:00:00`);
    day.setDate(day.getDate() - offset);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    series.push(byDay.get(key) ?? 0);
  }
  return series;
}
```

**Verify the column names against the schema before running.** `is_transfer` and `direction` are the names used by `sumSpend` in this same file — read that function and match it exactly. If it expresses "not a transfer" differently, use its expression, not this one.

- [ ] **Step 4: Add the query key**

In `mobile/constants/query_keys.ts`, inside the `transactions` block:

```ts
    dailySpend: (days: number) => ["transactions", "daily_spend", days] as const,
```

- [ ] **Step 5: Add the hook**

Create `mobile/hooks/queries/use_daily_spend.ts`:

```ts
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { dailySpend } from "@/lib/db/repos/transactions_repo";

/** Today as a local YYYY-MM-DD, which is the day boundary the user lives in. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function useDailySpend(days: number) {
  return useQuery({
    queryKey: queryKeys.transactions.dailySpend(days),
    queryFn: () => dailySpend({ days, endingOn: today() }),
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- daily_spend` then `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/db/repos/transactions_repo.ts mobile/lib/db/repos/__tests__/daily_spend.test.ts mobile/hooks/queries/use_daily_spend.ts mobile/constants/query_keys.ts
git commit -m "feat(home): aggregate daily spend in SQL for the hero bar strip"
```

---

### Task 2: The Home hero becomes a card

**Files:**
- Modify: `mobile/components/home/safe_to_spend_hero.tsx`
- Create: `mobile/components/home/__tests__/safe_to_spend_hero.test.tsx`

**Interfaces:**
- Consumes: `MiniBars`, `AmountText`, `Chip` (Part 1).
- Produces:

```ts
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
```

Task 3 supplies all six new props from `app/(tabs)/index.tsx`.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/home/__tests__/safe_to_spend_hero.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { SafeToSpendHero } from "../safe_to_spend_hero";
import type { SafeToSpendResult } from "@/lib/safe_to_spend";

function result(over: Partial<SafeToSpendResult> = {}): SafeToSpendResult {
  return {
    state: "healthy",
    perDay: 41200,
    overBy: 0,
    drivingLimitId: "limit-1",
    drivingFilterLabel: null,
    reviewQueueCount: 0,
    ...over,
  } as SafeToSpendResult;
}

const BASE = {
  scopeLabel: "monthly",
  dailySeries: [1000, 2000, 1500, 3000, 2200, 1800, 4000] as const,
  paused: false,
  amountsHidden: false,
  onToggleAmounts: () => {},
  onSetLimit: () => {},
  onOpenReviewQueue: () => {},
};

function classesOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? "");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- safe_to_spend_hero`
Expected: FAIL — the hero takes no `dailySeries`, and `sts-hero` has no `bg-brand`.

- [ ] **Step 3: Implement**

Rewrite `mobile/components/home/safe_to_spend_hero.tsx`. Keep the existing `no_limit` branch's copy and its `sts-set-limit` testID exactly; only its classes change.

```tsx
import { Eye, EyeOff, Pause } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { MiniBars } from "@/components/ui/mini_bars";
import { registerIcon } from "@/components/ui/button";
import type { SafeToSpendResult, SafeToSpendState } from "@/lib/safe_to_spend";

export type SafeToSpendHeroProps = {
  result: SafeToSpendResult;
  scopeLabel: string | null;
  dailySeries: readonly number[];
  paused: boolean;
  amountsHidden: boolean;
  onToggleAmounts: () => void;
  onSetLimit: () => void;
  onOpenReviewQueue: () => void;
  testID?: string;
};

type FilledState = Exclude<SafeToSpendState, "no_limit">;

/**
 * THE INK IS NOT UNIFORM ACROSS THE THREE FILLS, and the reason is arithmetic
 * rather than taste.
 *
 *   white on `brand`  #15803D -> 5.02:1  AA
 *   white on `danger` #DC2626 -> 4.83:1  AA
 *   white on `warn`   #D97706 -> 3.20:1  FAILS AA at every size below 24sp
 *   `fg`  on `warn`   #D97706 -> 5.30:1  AA
 *
 * So the amber hero takes dark ink. `components/ui/chip.tsx` already documents
 * exactly this exception for amber chips ("legible on a designer's monitor,
 * not on a phone outdoors"), and the hero is the single largest amber surface
 * in the app.
 *
 * Dark mode needs no exception: all three dark fills are bright, so all three
 * take `on-brand-dark` — brand-dark 7.79:1, danger-dark 6.42:1, warn-dark
 * 10.63:1, every figure already recomputed in constants/colors.ts.
 */
const FILL_CLASS: Record<FilledState, string> = {
  healthy: "bg-brand dark:bg-brand-dark",
  tight: "bg-warn dark:bg-warn-dark",
  over: "bg-danger dark:bg-danger-dark",
};

const INK_CLASS: Record<FilledState, string> = {
  healthy: "text-on-brand dark:text-on-brand-dark",
  tight: "text-fg dark:text-on-brand-dark",
  over: "text-on-brand dark:text-on-brand-dark",
};

const MUTED_INK_CLASS: Record<FilledState, string> = {
  healthy: "text-on-brand/80 dark:text-on-brand-dark/80",
  tight: "text-fg/80 dark:text-on-brand-dark/80",
  over: "text-on-brand/80 dark:text-on-brand-dark/80",
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

      <View testID="sts-amount" className={inkClass}>
        {amountsHidden ? (
          <Text className={`text-hero font-extrabold ${inkClass}`}>{HIDDEN_AMOUNT}</Text>
        ) : (
          <AmountText amount={result.perDay} size="hero" />
        )}
      </View>

      {result.state === "over" ? (
        <Text testID="sts-over-by" className={`text-secondary font-medium ${mutedInkClass}`}>
          {"You're "}
          <AmountText amount={result.overBy} /> over for this period
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
```

**On the weekday labels:** the design's board hardcodes `Mon` and `Sun`. Do not copy that. The strip is the seven days *ending today*, so a hardcoded pair is correct one day in seven. `startLabel` and `endLabel` are required props for exactly this reason, and Task 3 computes them from `new Date().getDay()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- safe_to_spend_hero`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `app/__tests__/home_screen.test.tsx` FAILS — the hero now requires four props Home does not pass. That is correct; Task 3 fixes it. Do not commit yet.

- [ ] **Step 6: Commit with Task 3**

This task and Task 3 land as one commit, because the hero's new required props make Home uncompilable in between.

---

### Task 3: Home — header, tiles, FAB, real weekday labels

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/components/home/greeting_header.tsx`
- Create: `mobile/components/home/__tests__/greeting_header.test.tsx`
- Modify: `mobile/app/__tests__/home_screen.test.tsx`

**Interfaces:**
- Consumes: `useDailySpend` (Task 1), the hero's new props (Task 2), `StatTile`, `Fab` (Part 1).
- Produces: `<GreetingHeader periodLabel={string} testID?: string />`.

**"Beta User" is a fixed string.** There is no name field, no account, no third-party auth. Spec §6.2 and §6.3 — nothing is persisted, and the cohort question is deferred to Google account linking.

- [ ] **Step 1: Write the failing header test**

Create `mobile/components/home/__tests__/greeting_header.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { GreetingHeader } from "../greeting_header";

test("greets the beta user by their tag, not by a name", () => {
  render(<GreetingHeader testID="h" periodLabel="Kinsenas period · 8 days left" />);
  screen.getByText("Kumusta, Beta User");
});

test("shows the period line underneath", () => {
  render(<GreetingHeader testID="h" periodLabel="Kinsenas period · 8 days left" />);
  screen.getByText("Kinsenas period · 8 days left");
});

test("there is no notification bell — Home has no alerts route", () => {
  render(<GreetingHeader testID="h" periodLabel="Monthly period" />);
  expect(screen.queryByTestId("h-bell")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- greeting_header`
Expected: FAIL — `Cannot find module '../greeting_header'`.

- [ ] **Step 3: Implement the header**

Create `mobile/components/home/greeting_header.tsx`:

```tsx
// components/home/greeting_header.tsx — the two-line header above the Home hero.
//
// "Beta User" IS A FIXED STRING, AND DELIBERATELY SO. The app has no account,
// no third-party auth, and no name field — everything lives on the phone. The
// design draws a personal greeting; this is the version of it that does not
// require collecting anything. It also reads as a tag rather than a
// placeholder, which is the point: early testers keep it.
//
// Nothing behind it is persisted. No install date, no cohort id. That work is
// deferred to Google account linking (revamp spec §6.3), and an install date
// cannot be reconstructed retroactively, so do not add a "member since" line
// here on the assumption that the data exists.
import { Text, View } from "react-native";

import { BrandMark } from "@/components/ui/brand_mark";

export const BETA_USER_LABEL = "Beta User";

export type GreetingHeaderProps = {
  periodLabel: string;
  testID?: string;
};

export function GreetingHeader({ periodLabel, testID }: GreetingHeaderProps) {
  return (
    <View testID={testID} className="flex-row items-center gap-3">
      <BrandMark size={36} />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-section font-bold text-fg dark:text-fg-dark">
          {`Kumusta, ${BETA_USER_LABEL}`}
        </Text>
        <Text numberOfLines={1} className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
          {periodLabel}
        </Text>
      </View>
    </View>
  );
}
```

Check `components/ui/brand_mark.tsx`'s actual prop name before using `size` — if it differs, use its real prop rather than adding one.

- [ ] **Step 4: Wire Home**

In `mobile/app/(tabs)/index.tsx`:

Add imports:

```tsx
import { useDailySpend } from "@/hooks/queries/use_daily_spend";
import { useGoals } from "@/hooks/queries/use_goals";
import { GreetingHeader } from "@/components/home/greeting_header";
import { StatTile } from "@/components/ui/stat_tile";
import { Fab } from "@/components/ui/fab";
import { totalActiveBalance } from "@/lib/wallets/summary";
import { useWallets } from "@/hooks/queries/use_wallets";
```

Add state and queries inside `HomeScreen`:

```tsx
  const [amountsHidden, setAmountsHidden] = useState(false);
  const { data: dailySeries } = useDailySpend(7);
  const { data: wallets } = useWallets();
  const { data: goals } = useGoals();
```

**Replace the unfiltered ledger read.** `useTransactions({})` is currently used only for `transactions.length === 0`. Change that call to `useTransactions({ limit: 1 })` if `TxFilter` supports a limit; if it does not, keep `useTransactions({})` **and open a follow-up** rather than inventing a filter field — the hero's bars no longer depend on it either way, which was the expensive part.

Add the weekday labels, replacing the hero's hardcoded `Mon`/`Sun`:

```tsx
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  const todayIndex = new Date().getDay();
  // The strip is the seven days ENDING today, so the first label is six days
  // back. Hardcoding "Mon" and "Sun" is only right one day in seven.
  const seriesStartLabel = WEEKDAYS[(todayIndex + 1) % 7];
  const seriesEndLabel = WEEKDAYS[todayIndex];
```

Pass them through by adding `startLabel` and `endLabel` to `SafeToSpendHeroProps` and forwarding them to `MiniBars` in place of the hardcoded strings.

Compute paused and the period label:

```tsx
  const paused =
    health !== undefined &&
    (health.granted === false || !health.serviceConnected || !health.captureEnabled);

  const periodLabel = drivingScope === undefined ? "No limit set" : `${SCOPE_LABEL[drivingScope]} period`;
```

Render the header first inside the `ScrollView`, then the hero with its new props, then the tile row after the hero:

```tsx
      <GreetingHeader testID="home-greeting" periodLabel={periodLabel} />

      <SafeToSpendHero
        result={result}
        scopeLabel={drivingScope === undefined ? null : SCOPE_LABEL[drivingScope]}
        dailySeries={dailySeries ?? []}
        startLabel={seriesStartLabel}
        endLabel={seriesEndLabel}
        paused={paused}
        amountsHidden={amountsHidden}
        onToggleAmounts={() => setAmountsHidden((hidden) => !hidden)}
        onSetLimit={() => router.push("/plan/limits/new")}
        onOpenReviewQueue={() => router.push("/review")}
      />

      <View testID="home-stat-tiles" className="flex-row gap-3">
        <StatTile testID="home-stat-balance" label="Balance" amount={totalActiveBalance(wallets ?? [])} />
        <StatTile
          testID="home-stat-spent"
          label="Spent so far"
          amount={result.state === "no_limit" ? 0 : result.spentThisPeriod}
          tone={result.state === "over" ? "danger" : result.state === "tight" ? "warn" : "neutral"}
        />
        <StatTile
          testID="home-stat-saved"
          label="Saved"
          amount={(goals ?? []).reduce((sum, goal) => sum + goal.currentAmount, 0)}
          tone="brand"
        />
      </View>
```

**Check `result.spentThisPeriod` and `goal.currentAmount` against their real types before writing them.** Read `lib/safe_to_spend.ts` and `types/domain.ts`; if the fields are named differently, use the real names. If `SafeToSpendResult` carries no period-spend figure at all, derive Spent so far from `useLimitStatuses()` — the driving limit's status already holds it — rather than adding a field to the result type.

Wrap the screen so the FAB can float, replacing the current bare `ScrollView` return:

```tsx
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView testID="home" contentContainerClassName="gap-5 p-4">
        {/* ...everything above, unchanged in order... */}
        <View className="h-20" />
      </ScrollView>
      <View className="absolute bottom-6 right-6">
        <Fab
          testID="home-add"
          onPress={() => router.push("/transaction/new")}
          accessibilityLabel="Add a transaction"
        />
      </View>
    </View>
```

- [ ] **Step 5: Update the Home screen test**

In `mobile/app/__tests__/home_screen.test.tsx`, add:

```tsx
test("Home greets the beta user and names the period", () => {
  // ...existing render helper...
  screen.getByText("Kumusta, Beta User");
});

test("Home shows the three stat tiles", () => {
  screen.getByTestId("home-stat-balance");
  screen.getByTestId("home-stat-spent");
  screen.getByTestId("home-stat-saved");
});

test("Home has a floating add button that opens manual entry", () => {
  fireEvent.press(screen.getByTestId("home-add"));
  expect(mockPush).toHaveBeenCalledWith("/transaction/new");
});

test("the weekday labels end on today, not on a hardcoded Sunday", () => {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  screen.getByText(weekdays[new Date().getDay()]);
});
```

Every existing assertion in this file must still pass. If one fails, the restyle changed behaviour it should not have — fix the screen, not the test.

- [ ] **Step 6: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean, including `home_screen.test.tsx`.

- [ ] **Step 7: Build to the A54**

Run: `npm run android`

Confirm in both themes:
1. All four hero states. Force them by editing a limit's amount — healthy, then over 80%, then over 100%. Revoke notification access to see paused.
2. **Read the amber hero outdoors or at minimum brightness.** It is the one state whose ink rule was derived rather than drawn.
3. The eye toggle hides and restores the figure without the card resizing.
4. The FAB clears the tab bar and does not cover the last bills card.

- [ ] **Step 8: Commit**

```bash
git add mobile/components/home/ mobile/app/\(tabs\)/index.tsx mobile/app/__tests__/home_screen.test.tsx
git commit -m "feat(home): state-filled hero with a bar strip, greeting, stat tiles and a fab"
```

---

### Task 4: Transactions

**Files:**
- Modify: `mobile/components/transactions/filter_bar.tsx`
- Modify: `mobile/components/transactions/transaction_row.tsx`
- Modify: `mobile/components/review/review_queue_entry.tsx`
- Modify: `mobile/app/(tabs)/transactions.tsx`
- Modify: `mobile/app/__tests__/transactions_screen.test.tsx`

**Interfaces:**
- Consumes: `Chip` with `fill="soft"`, `Fab`, `ProviderBadge` (Part 1).
- Produces: no new exports. `FilterBar` keeps its current props exactly.

- [ ] **Step 1: Write the failing test**

Add to `mobile/app/__tests__/transactions_screen.test.tsx`:

```tsx
test("the filter row is chips, and All is selected by default", () => {
  // ...existing render helper...
  expect(String(screen.getByTestId("filter-chip-all").props.accessibilityState)).toContain("selected");
});

test("the review chip shows the open count and opens the queue", () => {
  fireEvent.press(screen.getByTestId("filter-chip-review"));
  expect(mockPush).toHaveBeenCalledWith("/review");
});

test("the add button is the fab, not a labelled button", () => {
  screen.getByTestId("transactions-add");
  expect(screen.queryByText("Add")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- transactions_screen`
Expected: FAIL — no `filter-chip-all`, and the "Add" text is still rendered.

- [ ] **Step 3: Restyle `filter_bar.tsx`**

Read the file first. Keep `FilterBarProps` byte-for-byte — Task 4 changes presentation only. Replace whatever the current controls are with a horizontally scrolling `Chip` row:

- `All` — `tone="brand"`, `fill="solid"` when `Object.keys(value).length === 0`, otherwise `tone="neutral" fill="outline"`. `testID="filter-chip-all"`.
- `Review N` — rendered only when the open count is above zero. `tone="danger" fill="soft"`. `testID="filter-chip-review"`. Pressing it routes to `/review`; it is a shortcut, not a filter, and must not mutate `value`.
- One chip per wallet, `ProviderBadge` as its leading glyph, `tone="neutral"`, `fill` `"solid"` when selected and `"outline"` otherwise. `testID={`filter-chip-wallet-${wallet.id}`}`.
- One chip per category, same selected rule. `testID={`filter-chip-category-${category.id}`}`.

Keep the search input above the chip row, restyled to `bg-chip dark:bg-chip-dark rounded-full px-4 min-h-[44px]` with a lucide `Search` glyph at 16dp in `text-fg-2`.

`FilterBar` needs the open review count to render its chip. It already receives `wallets` and `categories`; add `reviewCount?: number` to its props and pass `useReviewCount()`'s data down from the screen — do **not** call the hook inside `FilterBar`, because `transactions.tsx` already holds it and two subscriptions to one count is one too many.

- [ ] **Step 4: Restyle `transaction_row.tsx`**

Read the file first. The design's row is: category-icon medallion (28dp, `bg-chip` disc, lucide glyph in `text-fg-2`), title at `text-row font-semibold`, subtitle `Category · Wallet · HH:mm` at `text-secondary font-medium text-fg-2`, amount right-aligned via `AmountText size="md"`. A row awaiting review carries a `Chip label="CHECK" tone="warn" fill="soft"` beside its title.

Preserve every existing `testID` and every existing accessibility label.

- [ ] **Step 5: Restyle `review_queue_entry.tsx` as the design's banner**

The design draws it as a full-width soft-brand banner reading "N need a quick check" with a chevron. Change classes to `flex-row items-center gap-2 rounded-xl bg-brand-soft px-4 py-3 dark:bg-brand-soft-dark`, text `text-row font-semibold text-brand dark:text-brand-dark`, and add a `ChevronRight` at 16dp. Keep the component's existing props, `testID` and press behaviour.

- [ ] **Step 6: Swap the button for the fab**

In `mobile/app/(tabs)/transactions.tsx`, replace the `Button` import with `Fab` and the floating block with:

```tsx
      <View className="absolute bottom-6 right-6">
        <Fab
          testID="transactions-add"
          onPress={() => router.push("/transaction/new")}
          accessibilityLabel="Add a transaction"
        />
      </View>
```

Keep the comment above it about manual entry's one durable entry point — it is still true and still the reason the block exists.

Pass the review count into `FilterBar`:

```tsx
        <FilterBar
          value={filter}
          onChange={setFilter}
          search={search}
          onSearchChange={setSearch}
          wallets={wallets}
          categories={categories}
          reviewCount={reviewCount}
          onOpenReview={() => router.push("/review")}
        />
```

- [ ] **Step 7: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add mobile/components/transactions/ mobile/components/review/review_queue_entry.tsx mobile/app/\(tabs\)/transactions.tsx mobile/app/__tests__/transactions_screen.test.tsx
git commit -m "feat(transactions): chip filters, richer rows and the shared fab"
```

---

### Task 4b: Transaction detail, manual entry and the review queue

**Files:**
- Modify: `mobile/app/transaction/[id].tsx`
- Modify: `mobile/app/transaction/new.tsx`
- Modify: `mobile/app/review/index.tsx`
- Modify: `mobile/components/review/review_card.tsx`
- Modify: `mobile/components/review/confidence_meter.tsx`
- Modify: `mobile/components/transactions/manual_entry_form.tsx`
- Modify: `mobile/components/transactions/why_recorded_panel.tsx`
- Modify: `mobile/app/__tests__/transaction_detail.test.tsx`
- Modify: `mobile/app/__tests__/transaction_new.test.tsx`
- Modify: `mobile/app/__tests__/review_queue.test.tsx`

**Interfaces:** no API changes. `SegmentedControl`, `Chip` with `fill="soft"`, `ProviderBadge` from Part 1.

**These are three of the 36 boards** — "Transaction detail · with source text", "Manual entry · cash", and "Review queue" — not incidental screens. Task 4 covered the ledger; this covers everything the ledger pushes to.

- [ ] **Step 1: Read all three screens first**

Run: `sed -n '1,200p' app/transaction/\[id\].tsx` and the same for `app/transaction/new.tsx` and `app/review/index.tsx`.

Note every `testID` before changing anything. `transaction_detail.test.tsx`, `transaction_new.test.tsx` and `review_queue.test.tsx` assert against them and all three must pass unchanged at the end.

- [ ] **Step 2: Transaction detail**

The board's composition, top to bottom:

1. A `Card` header — 56dp `bg-chip` disc with the category glyph, `AmountText size="hero"` beneath it, merchant name at `text-title font-bold`, date and time at `text-secondary text-fg-2`, then a `Chip label="AUTO-CAPTURED · {n}% MATCH" tone="brand" fill="soft"` when the transaction was auto-captured. Render no chip at all for a manual entry rather than a chip reading "manual" — the badge exists to explain a machine decision.
2. A `Card` of `ListRow`s: Category, Wallet (with `ProviderBadge` as `left`), Counts toward, Reference (mono, `text-micro`), Note.
3. The source-notification block: a `flat` `Card` on `bg-chip`, header row reading "Source notification" with the existing `expiry_countdown.tsx` as a `Chip tone="neutral" fill="outline"` on the right, the captured text in `font-mono text-micro`, and the retention sentence beneath.
4. Two `secondary` buttons at the bottom: "Split transaction" and "Mark as transfer", wired to whatever they already call.

Do not render the source block when the transaction has no captured text. An empty "Source notification" panel on a manual entry says the app lost something.

- [ ] **Step 3: Manual entry**

Header becomes an X close plus a "Save" text action. Beneath it a `SegmentedControl` for Expense / Income / Transfer, replacing whatever hand-rolled toggle is there — this is one of the four screens `SegmentedControl` was built for.

The amount becomes the board's large centred figure at `text-hero font-extrabold` with the `₱` at `text-title`, the wallet and date on one `text-secondary` line beneath. Category chips become a wrapped `Chip` row, selected `fill="solid"`, unselected `fill="outline"`. The note field becomes a `bg-chip rounded-xl` input with a leading `Type` glyph.

Keep `numeric_keypad.tsx` and `keypad_host.tsx` exactly as they are — the numeric input system has its own spec (`docs/superpowers/specs/2026-08-19-numeric-input-system-design.md`) and its own tests, including `no_numeric_keyboard.test.ts`. Restyle the key faces only: `bg-surface rounded-xl`, digits at `text-title font-semibold`, and the backspace key on `bg-brand-soft`.

- [ ] **Step 4: Review queue**

Header: back chevron, "Needs review", and an "Accept all" text action on the right if one already exists — do not add one if it does not, because bulk-accepting low-confidence parses is a behaviour change, not a restyle.

Each `review_card.tsx` becomes: a `Card` with a `CircleQuestionMark` glyph disc, merchant and `date · wallet` on the left, amount on the right; the captured text in a `bg-chip` block labelled "CAPTURED TEXT" at `text-badge font-bold text-fg-2`; a "Which category?" line followed by a wrapped `Chip` row where the top suggestion carries its confidence as a trailing percentage; then a full-width primary "Confirm" plus small icon-only edit and delete buttons using `Button` with `iconOnly`.

`confidence_meter.tsx` becomes the percentage inside the top suggestion chip rather than a separate bar.

The transfer-ambiguity case keeps its existing two-button treatment ("It's a transfer" / "Real expense") and gains a `tone="warn" fill="soft"` explanation banner above the buttons.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean, with all three existing test files passing unmodified. If one fails on a `testID`, restore the `testID` — do not edit the test.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/transaction/ mobile/app/review/ mobile/components/review/ mobile/components/transactions/
git commit -m "feat(transactions): restyle detail, manual entry and the review queue"
```

---

### Task 5: Wallets

**Files:**
- Modify: `mobile/app/(tabs)/wallets.tsx`
- Modify: `mobile/components/wallets/wallet_card.tsx`
- Modify: `mobile/app/__tests__/wallets_screen.test.tsx`

**Interfaces:**
- Consumes: `ShareBar`, `ProviderBadge` (Part 1).
- Produces: nothing new exported.

**No wallet cap.** Spec D10. Nothing here renders a "4th wallet" upsell or opens the paywall. The paywall sheet is built in Part 3 and stays untriggered.

- [ ] **Step 1: Write the failing test**

Add to `mobile/app/__tests__/wallets_screen.test.tsx`:

```tsx
test("the total card carries a share bar with one segment per wallet", () => {
  // ...existing render helper with at least two wallets...
  screen.getByTestId("wallets-share");
});

test("a wallet row shows its provider badge", () => {
  screen.getByTestId("wallet-badge-gcash");
});

test("there is no wallet cap upsell during beta", () => {
  expect(screen.queryByText(/4th tracked wallet/i)).toBeNull();
  expect(screen.queryByTestId("plus-gate")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- wallets_screen`
Expected: FAIL — no `wallets-share`.

- [ ] **Step 3: Add the share bar to the total card**

In `mobile/app/(tabs)/wallets.tsx`, inside the existing `wallets-total` `View`, after the `AmountText` and before the credit-balance note:

```tsx
              <ShareBar
                testID="wallets-share"
                shares={wallets
                  .filter((wallet) => !wallet.isArchived && wallet.balance > 0)
                  .map((wallet) => ({
                    id: wallet.id,
                    label: wallet.name,
                    value: wallet.balance,
                    color: providerBadge(wallet.providerKey ?? "").color,
                  }))}
              />
```

Change the total's label from `Total across your wallets` to `Total across {n} wallets`, matching the design, where `n` is the count of non-archived wallets.

**Check the real field names on `Wallet` before writing this.** `isArchived`, `balance` and `providerKey` are the names assumed here; read `types/domain.ts` and use whatever is actually there. A wallet with no provider (Cash) falls through `providerBadge("")` to the grey fallback, which is correct.

- [ ] **Step 4: Add the provider badge to the wallet card**

In `mobile/components/wallets/wallet_card.tsx`, put a `ProviderBadge` at 32dp as the row's leading element:

```tsx
        <ProviderBadge
          testID={`wallet-badge-${wallet.providerKey ?? "cash"}`}
          providerKey={wallet.providerKey ?? ""}
          size={32}
        />
```

Restyle the card body to the design: name at `text-row font-semibold`, a listening line at `text-secondary font-medium text-fg-2` reading `Listening · N txns this period` when the wallet has a provider and `Manual · reconcile weekly` when it does not, balance right-aligned at `text-row font-bold`, and the existing `BalanceMismatchBadge` directly beneath the balance. Keep every existing `testID` and the existing drift and tolerance props.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/\(tabs\)/wallets.tsx mobile/components/wallets/wallet_card.tsx mobile/app/__tests__/wallets_screen.test.tsx
git commit -m "feat(wallets): share bar on the total and provider badges on every row"
```

---

### Task 5b: Wallet detail, wallet form and the cash reconcile sheet

**Files:**
- Modify: `mobile/app/wallet/[id].tsx`
- Modify: `mobile/app/wallet/[id]/edit.tsx`
- Modify: `mobile/app/wallet/new.tsx`
- Modify: `mobile/components/wallets/wallet_form.tsx`
- Modify: `mobile/components/wallets/matcher_chip_list.tsx`
- Modify: `mobile/components/wallets/matcher_picker.tsx`
- Modify: `mobile/components/wallets/cash_reconcile_sheet.tsx`
- Modify: `mobile/components/wallets/balance_correction_sheet.tsx`
- Modify: `mobile/components/wallets/archive_wallet_sheet.tsx`
- Modify: `mobile/app/__tests__/wallet_detail.test.tsx`
- Modify: `mobile/app/__tests__/wallet_routes.test.tsx`

**Interfaces:** no API changes.

**Two more boards** — "Wallet detail · matchers" and "Cash reconcile sheet".

- [ ] **Step 1: Wallet detail**

The balance header becomes a full-bleed `Card` filled with the **provider's** colour from `providerBadge(wallet.providerKey).color`, not a token, with white ink and the provider badge in the top-right. A wallet with no provider (Cash) fills `bg-brand` instead.

**Check the contrast before shipping any provider fill.** `PROVIDER_BADGE` colours were chosen to read at 14dp behind a single white letter, which is a far weaker requirement than a full card of white body text. Use `contrastRatio` from `lib/ui/contrast.ts` (Part 1 Task 2) against `#FFFFFF` for each of the thirteen. **Any provider under 4.5:1 falls back to `bg-brand`** rather than shipping unreadable white on its brand colour. Write the list of fallbacks into the file as a comment with their measured ratios.

Beneath the header: "In this period +₱X / Out −₱Y" on one `text-secondary` row, then a matchers `Card` (header row with an "Edit" text action, the existing `matcher_chip_list.tsx` restyled to `Chip fill="outline"` with a mono label and an X, plus a dashed "+ Add" chip), then a `tone="warn" fill="soft"` hint card for the GSave-split case if that hint already exists, then "Recent activity" with a "See all N" action and the last few rows, then "Adjust balance" and "Archive wallet" as `secondary` buttons.

- [ ] **Step 2: Wallet create and edit**

`wallet_form.tsx` gets the design's field rhythm: label at `text-micro font-semibold text-fg-2` above each control, controls on `bg-chip rounded-xl min-h-[44px]`, and the wallet-type picker as a `SegmentedControl`. The provider picker row shows `ProviderBadge` beside each name.

**No free-plan cap note and no `PlusGate` anywhere in this form.** Spec D10 — the cap does not exist during beta, and `canCreateWallet` already returns `true` for every count while `MVP_TIER` is `"plus"`.

- [ ] **Step 3: The three sheets**

`cash_reconcile_sheet.tsx` is a designed board and gets it exactly: title, the explanatory sentence, a `ListRow` reading "PeraPlano thinks you have" with the amount, a bordered `bg-surface` input labelled "Actual count" with the figure at `text-title font-bold`, a "Difference" row inked `danger` when negative and `brand` when positive, the "Logged as …" explanation at `text-secondary text-fg-2`, then Cancel and "Save count" side by side.

`balance_correction_sheet.tsx` and `archive_wallet_sheet.tsx` follow the same sheet rhythm. `archive_wallet_sheet.tsx` uses the new `outline-destructive` button.

Keep `bottom_sheet.tsx`'s own API unchanged; it was restyled in Part 1 Task 9.

- [ ] **Step 4: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/wallet/ mobile/components/wallets/ mobile/app/__tests__/
git commit -m "feat(wallets): restyle detail, form and the reconcile sheets"
```

---

### Task 6: Extract the four Plan panels

**Files:**
- Create: `mobile/components/plan/limits_panel.tsx`
- Create: `mobile/components/plan/goals_panel.tsx`
- Create: `mobile/components/plan/utang_panel.tsx`
- Create: `mobile/components/plan/bills_panel.tsx`
- Modify: `mobile/app/(tabs)/plan/limits.tsx`
- Modify: `mobile/app/(tabs)/plan/goals.tsx`
- Modify: `mobile/app/(tabs)/plan/loans.tsx`
- Modify: `mobile/app/(tabs)/plan/bills.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LimitsPanel`, `GoalsPanel`, `UtangPanel`, `BillsPanel` — each takes no props and renders exactly what its route rendered before.

**This task changes no behaviour at all.** It is a pure move, done separately so that Task 7's diff shows only the segment host. Every existing Plan test must pass untouched at the end of it.

- [ ] **Step 1: Move each screen body into a panel**

For each of the four, cut the entire component body out of the route file into the new panel file. Example, `limits.tsx`:

```tsx
// components/plan/limits_panel.tsx — the Limits list.
//
// A PANEL, NOT A SCREEN, and the route file is still real. Plan's segmented
// control swaps panels in place without navigating, but `/plan/limits` remains
// a routable screen because detail routes pop back to it and
// components/home/alerts_feed.tsx deep-links to `/plan/limits/[id]`. Deleting
// the route would turn "tap alert -> limit detail -> system back" into a dead
// end (revamp spec R4).
export function LimitsPanel() {
  // ...the exact body that was in app/(tabs)/plan/limits.tsx...
}
```

and the route file becomes:

```tsx
import { LimitsPanel } from "@/components/plan/limits_panel";

export default function LimitsScreen() {
  return <LimitsPanel />;
}
```

Do the same for goals, bills, and loans. **`loans.tsx` renders `UtangPanel`** — the file name stays `loans.tsx` so the route `/plan/loans` is unchanged; only the component name and the user-facing label change in Task 7.

- [ ] **Step 2: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: **every existing test passes with no test file modified.** If any test needed changing, the move was not pure — revert and redo it.

- [ ] **Step 3: Commit**

```bash
git add mobile/components/plan/ mobile/app/\(tabs\)/plan/
git commit -m "refactor(plan): extract the four list screens into panels"
```

---

### Task 7: Plan becomes segmented

**Files:**
- Modify: `mobile/app/(tabs)/plan/index.tsx`
- Modify: `mobile/components/plan/limits_panel.tsx`
- Delete: `mobile/app/__tests__/plan_hub.test.tsx`
- Create: `mobile/app/__tests__/plan_segments.test.tsx`
- Modify: `mobile/app/__tests__/loan_routes.test.tsx`

**Interfaces:**
- Consumes: `SegmentedControl` (Part 1), the four panels (Task 6).
- Produces: nothing exported. `plan-hub` is replaced by `plan-segments` as the screen's `testID` — the one `testID` this revamp does not preserve, because the thing it identified no longer exists.

- [ ] **Step 1: Write the failing test**

Create `mobile/app/__tests__/plan_segments.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import PlanScreen from "../(tabs)/plan/index";
// reuse the provider wrapper the existing plan tests use — read
// app/__tests__/limit_routes.test.tsx and copy its render helper verbatim.

beforeEach(() => mockPush.mockClear());

test("all four segments are present, and Loans is now Utang", () => {
  render(<PlanScreen />);
  screen.getByText("Limits");
  screen.getByText("Goals");
  screen.getByText("Utang");
  screen.getByText("Bills");
  expect(screen.queryByText("Loans")).toBeNull();
});

test("Limits is the segment shown first", () => {
  render(<PlanScreen />);
  expect(screen.getByTestId("plan-segments-limits").props.accessibilityState).toMatchObject({
    selected: true,
  });
});

test("pressing a segment swaps the panel WITHOUT navigating", () => {
  render(<PlanScreen />);
  fireEvent.press(screen.getByTestId("plan-segments-utang"));
  expect(screen.getByTestId("plan-segments-utang").props.accessibilityState).toMatchObject({
    selected: true,
  });
  expect(mockPush).not.toHaveBeenCalled();
});

test("Income is a row inside the Limits panel, not a fifth segment", () => {
  render(<PlanScreen />);
  screen.getByTestId("plan-income-row");
  expect(screen.queryByTestId("plan-segments-income")).toBeNull();
});

test("the income row still routes to the income screen", () => {
  render(<PlanScreen />);
  fireEvent.press(screen.getByTestId("plan-income-row"));
  expect(mockPush).toHaveBeenCalledWith("/plan/income");
});
```

- [ ] **Step 2: Delete the hub test**

```bash
git rm mobile/app/__tests__/plan_hub.test.tsx
```

**Do not patch it.** Lines 104-108 assert `getByText("Loans")` and that `"Income"` is absent; line 79 asserts `push` navigation. All three are now wrong on purpose, and a patched file would keep the shape of a test for a screen that no longer exists.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- plan_segments`
Expected: FAIL — `plan-segments-limits` does not exist.

- [ ] **Step 4: Implement the segment host**

Replace `mobile/app/(tabs)/plan/index.tsx` entirely:

```tsx
// app/(tabs)/plan/index.tsx — Plan's segmented host.
//
// The four lists render INLINE here rather than behind a hub of cards, which
// removes one tap from every plan object. The four route files still exist and
// still render the same panels: detail screens pop back to them and
// components/home/alerts_feed.tsx deep-links into `/plan/limits/[id]` and
// `/plan/bills/[id]`. Pressing a segment is a state change, never a navigation
// (revamp spec R4).
//
// SoonGate is gone from this screen, not forgotten. `constants/shipped_features.ts`
// reports limits, goals, loans and bills all "shipped", so all four gates were
// rendering their children unchanged; a gate that can no longer close is
// indirection with nothing behind it. `SoonGate` itself stays in the codebase —
// Part 3's Shared budgets row is a real user of it.
import { useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";

import { BillsPanel } from "@/components/plan/bills_panel";
import { GoalsPanel } from "@/components/plan/goals_panel";
import { LimitsPanel } from "@/components/plan/limits_panel";
import { UtangPanel } from "@/components/plan/utang_panel";
import { SegmentedControl } from "@/components/ui/segmented_control";

type PlanSegment = "limits" | "goals" | "utang" | "bills";

const SEGMENTS = [
  { value: "limits", label: "Limits" },
  { value: "goals", label: "Goals" },
  // "Utang" is the user-facing word; the route stays `/plan/loans` and the
  // domain type stays `Loan`. Renaming the route would break every deep link
  // already written against it for a copy change.
  { value: "utang", label: "Utang" },
  { value: "bills", label: "Bills" },
] as const satisfies ReadonlyArray<{ value: PlanSegment; label: string }>;

export default function PlanScreen() {
  const [segment, setSegment] = useState<PlanSegment>("limits");

  return (
    <View testID="plan-segments-screen" className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="px-4 pb-2 pt-4">
        <SegmentedControl
          testID="plan-segments"
          segments={SEGMENTS}
          value={segment}
          onChange={setSegment}
        />
      </View>
      <ScrollView contentContainerClassName="pb-8">
        {segment === "limits" ? <LimitsPanel /> : null}
        {segment === "goals" ? <GoalsPanel /> : null}
        {segment === "utang" ? <UtangPanel /> : null}
        {segment === "bills" ? <BillsPanel /> : null}
      </ScrollView>
    </View>
  );
}
```

Each panel currently renders its own `ScrollView`. Remove the inner `ScrollView` from all four panels so they are plain `View`s — nesting scrollers breaks momentum and is the most likely thing to feel wrong on device.

- [ ] **Step 5: Add the income row to the Limits panel**

At the top of `LimitsPanel`'s output, above the gaps and the cards:

```tsx
      <Pressable
        testID="plan-income-row"
        accessibilityRole="button"
        accessibilityLabel="Income"
        onPress={() => router.push("/plan/income")}
        className="mx-4 mb-3"
      >
        <Card>
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-row font-semibold text-fg dark:text-fg-dark">Take-home</Text>
              <Text className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
                Powers %-of-income limits and the period
              </Text>
            </View>
            <ChevronRight size={18} className="text-fg-2 dark:text-fg-2-dark" />
          </View>
        </Card>
      </Pressable>
```

Show the real figure in place of "Take-home" once `useIncomeSummary()` has resolved — read `hooks/queries/use_income_summary.ts` for its shape and render the monthly take-home with `AmountText`. If it has not resolved, render the label alone rather than a zero, because `₱0.00` is a claim about the user's income and `undefined` is not.

**Income lives under Limits, not as a fifth segment**, because a percent-of-income limit reads directly from it — that is the relationship the placement states.

- [ ] **Step 6: Fix the Loans label in the remaining tests**

Run `grep -rn '"Loans"' mobile/app/__tests__ mobile/components` and update every user-facing occurrence to `"Utang"`. Leave the route `/plan/loans`, the `Loan` domain type, `loans_repo.ts`, `use_loans.ts` and every `loan_*` filename alone — this is a copy change, not a rename.

- [ ] **Step 7: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Build to the A54 and verify the back stack**

Run: `npm run android`

This is the one task in Part 2 that can break navigation. Confirm all four:

1. Plan → Utang segment → tap a loan → detail opens.
2. From that detail, press Android **system back** → the Utang list appears, not a blank screen and not a drop out of the tab.
3. Home → tap a limit alert → limit detail → system back → the Limits list appears.
4. Switching segments does not push a history entry: press a segment three times, then system back once, and you should leave Plan rather than walk back through segments.

- [ ] **Step 9: Commit**

```bash
git add mobile/app/\(tabs\)/plan/ mobile/components/plan/ mobile/app/__tests__/
git commit -m "feat(plan): segmented panels, income under limits, Loans becomes Utang"
```

---

## Definition of done for Part 2

- [ ] `npm test` and `npm run typecheck` clean.
- [ ] All four hero states seen on the A54, in both themes, including the amber one at low brightness.
- [ ] The four back-stack checks in Task 7 Step 8 all pass on device.
- [ ] `git log --oneline` shows eight commits (Tasks 2 and 3 share one).
- [ ] Home no longer draws its bar strip from an unfiltered ledger read.
- [ ] Every provider colour used as a full card fill in Task 5b measured against white, with sub-4.5:1 providers falling back to `bg-brand`.
- [ ] Nothing in More, System states, the Plan detail routes, or Onboarding has been touched.

**Boards covered by Part 2 (16 of 36):** Home ×4, Transactions ledger, Review queue, Transaction detail, Manual entry, Wallets list, Wallet detail, Cash reconcile sheet, Plan limits, Plan goals, Plan utang, Plan bills, and the tab bar from the component sheet.

**Not Part 2:** the "Create limit · with hindsight preview" board and every other Plan create/detail/edit route are Part 3 Task 4b. They are independent of the segment host — `plan/limits/new.tsx` is pushed from both the panel and Home's no-limit hero, and neither path changes here.

# PeraPlano Mobile Insight (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the insight + polish layer of the PeraPlano mobile app: Safe-to-Spend (formula, home UI, Plus projection), recurring/subscription detection with promote-to-Bill, Reports with SVG charts and CSV export, Settings & Privacy (pause, transparency, export, wipe, listener health, diagnostics), the full onboarding flow, the server client (parser-rules sync + telemetry), and final polish (alert channels, empty states, manual QA).

**Architecture:** M3 consumes the foundation plan (SQLite schema + repos + entitlements + nav shell), M1 (notification listener module + ingest pipeline + wallets/ledger/review-queue), and M2 (limits, income, goals, loans, bills, alerts) strictly through the interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md`. All money math is pure TypeScript over integer centavos, isolated in `lib/` modules with jest unit tests (the Safe-to-Spend worked-example tests are the centerpiece); screens are thin expo-router views over those modules; DB access goes through repository functions (pinned ones where the contract defines them, new ones defined with full code in this plan where it does not).

**Tech Stack:** Expo SDK ~54 / React Native 0.81 / TypeScript strict · expo-router ~6 · expo-sqlite (via `lib/db`) · NativeWind 4 + palette tokens from `constants/colors.ts` · react-native-svg (charts, no chart lib) · expo-notifications · expo-file-system + expo-sharing (added in this plan) · expo-intent-launcher + expo-crypto (added in this plan) · axios ^1.13 · jest + jest-expo.

## Global Constraints

- **Naming:** snake_case for ALL file and directory names (mobile + server) and ALL database identifiers (tables, columns). TypeScript symbols keep TS idioms: `camelCase` variables and functions, `PascalCase` components and types, `SCREAMING_SNAKE_CASE` constants. This intentionally overrides STACK_BASIS §14's kebab-case filename convention.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). No AI-attribution trailers or footers of any kind.
- **Tests:** mobile = jest + jest-expo (`npx jest --ci`). TDD per plan steps: write failing test, run it, implement, run again, commit. All test commands below run from the repo root as `cd mobile && npx jest <path> --ci`.
- **Currency:** integer **centavos** everywhere (DB, wire, logic). Format to `₱1,234.56` only at display. Type alias `type Centavos = number` (from `mobile/types/domain.ts`, foundation-owned).
- **Time:** epoch milliseconds (`number`) in code and DB; calendar dates as `'YYYY-MM-DD'` strings.
- **IDs:** UUIDv4 strings generated client-side (`expo-crypto` `Crypto.randomUUID()`).
- **Gating:** every tier gate is one Entitlements check at the action/render boundary (`mobile/lib/entitlements.ts`, pinned signatures). Gates keep data, block creation, never delete. Locked previews never show real gated data.
- **Privacy:** raw notification text never leaves the device — excluded from CSV export, export-everything, and telemetry. Telemetry is aggregate counts only.
- **The interface contract is LAW:** exact names, signatures, routes, tables, tokens from `docs/superpowers/plans/2026-08-02-00-interface-contract.md`. This plan may add private internals but never renames or reshapes anything the contract pins.

## Cross-plan integration notes (read before Task 1)

M1/M2 are implemented from parallel plans; the contract pins the seams this plan relies on (tables, repo file locations, pinned repo functions, the notification-listener JS API, `entitlements.ts`, the parser-ruleset JSON shape, the server routes). A few internals are NOT pinned; this plan commits to the following concrete assumptions. If the merged codebase differs, adapt **only the named identifier at the call-site** — every behavior, SQL predicate, and test in this plan stays as written:

1. **Tab shell files** are assumed at `mobile/app/(tabs)/home.tsx`, `transactions.tsx`, `wallets.tsx`, `plan.tsx`, `more.tsx`. If foundation used a directory-per-tab layout (e.g. `(tabs)/home/index.tsx`), apply the same modifications to the tab's index file.
2. **DB accessor:** repos obtain the open database from `mobile/lib/db/database.ts`. This plan imports it as `getDb(): Promise<SQLiteDatabase>` (`import { getDb } from "@/lib/db/database";`). If foundation exported a different name (e.g. `openDatabase`), change the import only.
3. **`app_settings`** is assumed to be a key/value table: `app_settings(key TEXT PRIMARY KEY, value TEXT)`. Task 2 defines `getSetting`/`setSetting` against it.
4. **`parser_rulesets`** is assumed to store one current ruleset row: columns `(id TEXT PRIMARY KEY, version INTEGER, providers_json TEXT, updated_at INTEGER)` with `id = 'current'`, seeded by M1 from `mobile/assets/parser_rules/seed.json`. If M1 stored one row per provider, keep this plan's `getLocalRulesetVersion`/`saveRuleset` semantics (max version compare; full replace on update) and adjust the SQL to M1's columns.
5. **`wallet_matchers`** columns are assumed `(id TEXT PRIMARY KEY, wallet_id TEXT, provider_key TEXT, package_name TEXT, hint TEXT, created_at INTEGER, updated_at INTEGER)`.
6. **`bill_payments`** columns are assumed `(id TEXT PRIMARY KEY, bill_id TEXT, transaction_id TEXT, cycle_date TEXT, status TEXT /* 'paid' | 'skipped' */, paid_at INTEGER)`. Only Task 3 reads it, in one function.
7. **Repo extension functions** defined in this plan (e.g. `listActiveLimitRows`, `getSetting`) live in the foundation-created files under `mobile/lib/db/repos/`. If M2 already defined a function with the same name and shape, reuse it instead of duplicating; if the name is taken with a different shape, suffix the new function with `ForInsight` and update this plan's call-sites.
8. **Provider display names / packages** used in constants are seed data; `mobile/assets/parser_rules/seed.json` (M1) is authoritative for `packageNames` — verify against it at implementation time.

---

### Task 1: Safe-to-Spend engine (pure math + worked ₱ example tests)

**Files:**
- Create: `mobile/lib/period.ts`
- Create: `mobile/lib/safe_to_spend.ts`
- Create: `mobile/utils/money.ts`
- Test: `mobile/lib/__tests__/period.test.ts`
- Test: `mobile/lib/__tests__/safe_to_spend.test.ts`
- Test: `mobile/utils/__tests__/money.test.ts`

**Interfaces:**
- Consumes: `type Centavos = number` from `@/types/domain` (foundation).
- Produces (used by Tasks 2, 4, 5, 8, 9, 10):
  - `period.ts`: `type LimitScope = "daily" | "weekly" | "monthly" | "annual"` · `parseDate(d: string): number` · `formatDate(utcMs: number): string` · `addDays(d: string, n: number): string` · `daysBetweenInclusive(from: string, to: string): number` · `lastDayOfMonth(year: number, month: number): number` · `periodForScope(scope: LimitScope, today: string): { start: string; end: string }`
  - `safe_to_spend.ts`: `type CandidateLimit` · `type UpcomingBill` · `type PlannedContribution` · `type SafeToSpendInput` · `type SafeToSpendResult` · `computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult`
  - `money.ts`: `formatPhp(centavos: number): string`

The canonical formula (docs/04-features/09-safe-to-spend.md): `Safe-to-Spend (today) = (tightest limit headroom − bills due before period end − planned goal contributions in period) ÷ days remaining (incl. today)`, floored at ₱0 with an over-by state; review-queue items excluded (the input simply never includes them — they are not Transactions).

- [ ] **Step 1: Write failing tests for date/period helpers**

`mobile/lib/__tests__/period.test.ts`:

```ts
import {
  addDays, daysBetweenInclusive, lastDayOfMonth, periodForScope,
} from "@/lib/period";

describe("period helpers", () => {
  it("counts days inclusive of both ends (Aug 12–31 = 20)", () => {
    expect(daysBetweenInclusive("2026-08-12", "2026-08-31")).toBe(20);
  });

  it("adds days across month boundaries", () => {
    expect(addDays("2026-08-30", 2)).toBe("2026-09-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows month lengths including leap years", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 8)).toBe(31);
  });

  it("computes monthly period as the calendar month", () => {
    expect(periodForScope("monthly", "2026-08-12")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("computes weekly period Monday through Sunday", () => {
    // 2026-08-12 is a Wednesday; week is Mon 10th – Sun 16th
    expect(periodForScope("weekly", "2026-08-12")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
  });

  it("computes daily period as today only", () => {
    expect(periodForScope("daily", "2026-08-12")).toEqual({ start: "2026-08-12", end: "2026-08-12" });
  });

  it("computes annual period as the calendar year", () => {
    expect(periodForScope("annual", "2026-08-12")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
});
```

- [ ] **Step 2: Run the period tests to verify they fail**

Run: `cd mobile && npx jest lib/__tests__/period.test.ts --ci`
Expected: FAIL — `Cannot find module '@/lib/period'`.

- [ ] **Step 3: Implement `mobile/lib/period.ts`**

```ts
export type LimitScope = "daily" | "weekly" | "monthly" | "annual";

const DAY_MS = 86_400_000;

/** Parse 'YYYY-MM-DD' into epoch ms at UTC midnight (pure calendar math, no TZ drift). */
export function parseDate(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function formatDate(utcMs: number): string {
  const dt = new Date(utcMs);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: string, n: number): string {
  return formatDate(parseDate(d) + n * DAY_MS);
}

/** Days from `from` to `to`, counting both ends. daysBetweenInclusive(x, x) === 1. */
export function daysBetweenInclusive(from: string, to: string): number {
  return Math.floor((parseDate(to) - parseDate(from)) / DAY_MS) + 1;
}

/** month is 1-based. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Scope windows per spec rule 1: daily = today; weekly = Mon–Sun; monthly = calendar month; annual = calendar year. */
export function periodForScope(scope: LimitScope, today: string): { start: string; end: string } {
  const [y, m] = today.split("-").map(Number);
  if (scope === "daily") return { start: today, end: today };
  if (scope === "weekly") {
    const dow = new Date(parseDate(today)).getUTCDay(); // 0 = Sunday
    const sinceMonday = (dow + 6) % 7;
    const start = addDays(today, -sinceMonday);
    return { start, end: addDays(start, 6) };
  }
  if (scope === "monthly") {
    const mm = String(m).padStart(2, "0");
    const last = String(lastDayOfMonth(y, m)).padStart(2, "0");
    return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${last}` };
  }
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}
```

- [ ] **Step 4: Run the period tests to verify they pass**

Run: `cd mobile && npx jest lib/__tests__/period.test.ts --ci`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/period.ts mobile/lib/__tests__/period.test.ts
git commit -m "feat: add calendar period helpers for limit scopes"
```

- [ ] **Step 6: Write the failing Safe-to-Spend worked-example tests**

These tests reproduce the spec's worked ₱ example EXACTLY (docs/04-features/09-safe-to-spend.md §Worked example). All amounts are centavos: ₱15,000.00 = 1_500_000.

`mobile/lib/__tests__/safe_to_spend.test.ts`:

```ts
import {
  computeSafeToSpend,
  type SafeToSpendInput,
} from "@/lib/safe_to_spend";

/** The spec's worked example, August 12 2026. */
function workedExample(): SafeToSpendInput {
  return {
    today: "2026-08-12",
    limits: [
      {
        id: "lim-1",
        scope: "monthly",
        effectiveValue: 1_500_000, // ₱15,000.00 fixed, no filters
        filtered: false,
        filterLabel: null,
        spendInPeriod: 620_000,    // ₱6,200.00 committed spend Aug 1–11
      },
    ],
    unpaidBills: [
      { id: "bill-1", name: "Meralco", amount: 230_000, dueDate: "2026-08-20" }, // ₱2,300.00
      { id: "bill-2", name: "PLDT", amount: 169_900, dueDate: "2026-08-25" },    // ₱1,699.00
    ],
    plannedContributions: [
      { goalId: "goal-1", amount: 100_000, date: "2026-08-15" }, // ₱1,000.00 payday auto-allocation
    ],
    reviewQueueCount: 0,
  };
}

describe("computeSafeToSpend — spec worked example", () => {
  it("displays exactly ₱190.05 on August 12", () => {
    const r = computeSafeToSpend(workedExample());
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.headroom).toBe(880_000);          // 1,500,000 − 620,000 = ₱8,800.00
    expect(r.billsTerm).toBe(399_900);         // ₱2,300.00 + ₱1,699.00 = ₱3,999.00
    expect(r.contributionsTerm).toBe(100_000); // ₱1,000.00
    expect(r.daysRemaining).toBe(20);          // Aug 12–31 inclusive
    expect(r.perDay).toBe(19_005);             // ₱3,801.00 ÷ 20 = ₱190.05
    expect(r.state).toBe("healthy");           // 6,200/15,000 = 41% < 80%
    expect(r.overBy).toBe(0);
    expect(r.drivingLimitId).toBe("lim-1");
    expect(r.periodEnd).toBe("2026-08-31");
  });

  it("over-state variant: spend ₱13,500.00 → ₱0.00, over by ₱3,499.00 (whole-period shortfall)", () => {
    const input = workedExample();
    input.limits[0].spendInPeriod = 1_350_000;
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.state).toBe("over");
    expect(r.perDay).toBe(0);        // floored, never negative
    expect(r.overBy).toBe(349_900);  // |1,500,000−1,350,000 − 399,900 − 100,000| = ₱3,499.00
  });
});

describe("computeSafeToSpend — rules", () => {
  it("returns no_limit when no candidate limits exist", () => {
    const input = workedExample();
    input.limits = [];
    expect(computeSafeToSpend(input).state).toBe("no_limit");
  });

  it("tightest wins: the limit yielding the lowest value drives", () => {
    const input = workedExample();
    input.limits.push({
      id: "lim-2", scope: "monthly", effectiveValue: 900_000,
      filtered: false, filterLabel: null, spendInPeriod: 620_000,
    });
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.drivingLimitId).toBe("lim-2");
  });

  it("ties break toward the shorter scope", () => {
    // Craft two limits that both floor to ₱0 over — identical perDay of 0.
    const input: SafeToSpendInput = {
      today: "2026-08-12",
      limits: [
        { id: "annual", scope: "annual", effectiveValue: 100, filtered: false, filterLabel: null, spendInPeriod: 100 },
        { id: "daily", scope: "daily", effectiveValue: 100, filtered: false, filterLabel: null, spendInPeriod: 100 },
      ],
      unpaidBills: [], plannedContributions: [], reviewQueueCount: 0,
    };
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.drivingLimitId).toBe("daily");
  });

  it("filtered limits never drive when an unfiltered limit exists (rule 3)", () => {
    const input = workedExample();
    input.limits.push({
      id: "lim-food", scope: "monthly", effectiveValue: 100_000,
      filtered: true, filterLabel: "Food & Dining", spendInPeriod: 99_000,
    });
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.drivingLimitId).toBe("lim-1"); // the much-tighter filtered limit is ignored
  });

  it("the tightest filtered limit drives when ONLY filtered limits exist, with its filter label", () => {
    const input = workedExample();
    input.limits = [{
      id: "lim-food", scope: "monthly", effectiveValue: 500_000,
      filtered: true, filterLabel: "Food & Dining", spendInPeriod: 100_000,
    }];
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.drivingLimitId).toBe("lim-food");
    expect(r.filterLabel).toBe("Food & Dining");
  });

  it("overdue unpaid bills (due date already past) keep subtracting until resolved (rule 5a)", () => {
    const input = workedExample();
    input.unpaidBills.push({ id: "bill-3", name: "Water", amount: 50_000, dueDate: "2026-08-05" });
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.billsTerm).toBe(449_900);
    expect(r.perDay).toBe(Math.floor((880_000 - 449_900 - 100_000) / 20));
  });

  it("bills due after the driving period end are excluded", () => {
    const input = workedExample();
    input.unpaidBills.push({ id: "bill-4", name: "Insurance", amount: 999_900, dueDate: "2026-09-05" });
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.billsTerm).toBe(399_900); // unchanged
  });

  it("contributions outside the period are excluded", () => {
    const input = workedExample();
    input.plannedContributions.push({ goalId: "g2", amount: 500_000, date: "2026-09-15" });
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.contributionsTerm).toBe(100_000); // unchanged
  });

  it("daily scope: days remaining = 1, no averaging (rule 7)", () => {
    const input: SafeToSpendInput = {
      today: "2026-08-12",
      limits: [{ id: "d1", scope: "daily", effectiveValue: 50_000, filtered: false, filterLabel: null, spendInPeriod: 10_000 }],
      unpaidBills: [{ id: "b", name: "Same-day", amount: 5_000, dueDate: "2026-08-12" }],
      plannedContributions: [],
      reviewQueueCount: 0,
    };
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.daysRemaining).toBe(1);
    expect(r.perDay).toBe(35_000); // 50,000 − 10,000 − 5,000, no division
  });

  it("tight state at or past 80% consumption of the driving limit", () => {
    const input = workedExample();
    input.limits[0].spendInPeriod = 1_200_000; // exactly 80%
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.state).toBe("tight");
    expect(r.perDay).toBeGreaterThan(0);
  });

  it("passes the review queue count through for the 'not yet counted' caption", () => {
    const input = workedExample();
    input.reviewQueueCount = 3;
    const r = computeSafeToSpend(input);
    if (r.state === "no_limit") throw new Error("expected a driving limit");
    expect(r.reviewQueueCount).toBe(3);
  });
});
```

- [ ] **Step 7: Run the Safe-to-Spend tests to verify they fail**

Run: `cd mobile && npx jest lib/__tests__/safe_to_spend.test.ts --ci`
Expected: FAIL — `Cannot find module '@/lib/safe_to_spend'`.

- [ ] **Step 8: Implement `mobile/lib/safe_to_spend.ts`**

```ts
import type { Centavos } from "@/types/domain";
import { daysBetweenInclusive, periodForScope, type LimitScope } from "@/lib/period";

/** A candidate limit, pre-resolved by the data layer (Task 2):
 *  effectiveValue already includes percent-of-income resolution and rollover carry-in;
 *  spendInPeriod is committed 'out' spend matching the limit's filters, transfer-linked excluded;
 *  percent-of-income limits without a usable IncomeProfile are excluded before this point (rule 10). */
export type CandidateLimit = {
  id: string;
  scope: LimitScope;
  effectiveValue: Centavos;
  filtered: boolean;
  filterLabel: string | null;
  spendInPeriod: Centavos;
};

export type UpcomingBill = { id: string; name: string; amount: Centavos; dueDate: string };
export type PlannedContribution = { goalId: string; amount: Centavos; date: string };

export type SafeToSpendInput = {
  today: string; // 'YYYY-MM-DD' device-local
  limits: CandidateLimit[];
  /** Unpaid bill cycles: overdue-unresolved (dueDate < today) AND upcoming. Paid and skipped cycles never appear. */
  unpaidBills: UpcomingBill[];
  /** Forecast contributionRule allocations + triggered-but-pending contributions. ₱0-equivalent = empty array. */
  plannedContributions: PlannedContribution[];
  reviewQueueCount: number;
};

export type SafeToSpendResult =
  | { state: "no_limit" }
  | {
      state: "healthy" | "tight" | "over";
      perDay: Centavos;          // floored at 0
      overBy: Centavos;          // |numerator| when over, else 0 — whole-period shortfall
      drivingLimitId: string;
      drivingScope: LimitScope;
      filterLabel: string | null;
      headroom: Centavos;
      billsTerm: Centavos;
      contributionsTerm: Centavos;
      daysRemaining: number;
      periodStart: string;
      periodEnd: string;
      reviewQueueCount: number;
    };

const SCOPE_RANK: Record<LimitScope, number> = { daily: 0, weekly: 1, monthly: 2, annual: 3 };

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  let candidates = input.limits;
  if (candidates.length === 0) return { state: "no_limit" };
  // Rule 3: filtered limits do not drive when an unfiltered limit exists.
  if (candidates.some((l) => !l.filtered)) candidates = candidates.filter((l) => !l.filtered);

  const evaluated = candidates.map((limit) => {
    const { start, end } = periodForScope(limit.scope, input.today);
    const headroom = limit.effectiveValue - limit.spendInPeriod;
    // Rule 5: overdue-unresolved bills subtract regardless of due date; upcoming bills up to period end.
    const billsTerm = input.unpaidBills
      .filter((b) => b.dueDate <= end)
      .reduce((sum, b) => sum + b.amount, 0);
    // Rule 6: contributions whose allocation date falls within the period.
    const contributionsTerm = input.plannedContributions
      .filter((c) => c.date >= start && c.date <= end)
      .reduce((sum, c) => sum + c.amount, 0);
    const numerator = headroom - billsTerm - contributionsTerm;
    const daysRemaining = daysBetweenInclusive(input.today, end);
    // Rule 9: floor at zero. Math.floor keeps the display from over-promising by a centavo.
    const perDay = numerator <= 0 ? 0 : Math.floor(numerator / daysRemaining);
    return { limit, start, end, headroom, billsTerm, contributionsTerm, numerator, daysRemaining, perDay };
  });

  // Rule 2: tightest (lowest value) wins; ties break toward the shorter scope.
  evaluated.sort(
    (a, b) => a.perDay - b.perDay || SCOPE_RANK[a.limit.scope] - SCOPE_RANK[b.limit.scope],
  );
  const d = evaluated[0];

  const over = d.numerator <= 0;
  const consumed = d.limit.effectiveValue > 0 ? d.limit.spendInPeriod / d.limit.effectiveValue : 1;
  const state = over ? "over" : consumed >= 0.8 ? "tight" : "healthy";

  return {
    state,
    perDay: d.perDay,
    overBy: over ? -d.numerator : 0,
    drivingLimitId: d.limit.id,
    drivingScope: d.limit.scope,
    filterLabel: d.limit.filterLabel,
    headroom: d.headroom,
    billsTerm: d.billsTerm,
    contributionsTerm: d.contributionsTerm,
    daysRemaining: d.daysRemaining,
    periodStart: d.start,
    periodEnd: d.end,
    reviewQueueCount: input.reviewQueueCount,
  };
}
```

- [ ] **Step 9: Run the Safe-to-Spend tests to verify they pass**

Run: `cd mobile && npx jest lib/__tests__/safe_to_spend.test.ts --ci`
Expected: PASS (14 tests). The worked-example test proves ₱190.05 and the over-by ₱3,499.00 variant to the centavo.

- [ ] **Step 10: Commit**

```bash
git add mobile/lib/safe_to_spend.ts mobile/lib/__tests__/safe_to_spend.test.ts
git commit -m "feat: add safe-to-spend engine reproducing the spec worked example"
```

- [ ] **Step 11: Write failing tests for the peso formatter**

`mobile/utils/__tests__/money.test.ts`:

```ts
import { formatPhp } from "@/utils/money";

describe("formatPhp", () => {
  it("formats centavos as ₱1,234.56", () => {
    expect(formatPhp(123_456)).toBe("₱1,234.56");
  });
  it("formats the worked-example number", () => {
    expect(formatPhp(19_005)).toBe("₱190.05");
  });
  it("groups millions and pads cents", () => {
    expect(formatPhp(123_456_789)).toBe("₱1,234,567.89");
    expect(formatPhp(500)).toBe("₱5.00");
    expect(formatPhp(0)).toBe("₱0.00");
  });
});
```

- [ ] **Step 12: Run to verify failure**

Run: `cd mobile && npx jest utils/__tests__/money.test.ts --ci`
Expected: FAIL — `Cannot find module '@/utils/money'`.

- [ ] **Step 13: Implement `mobile/utils/money.ts`**

```ts
/** Display-only peso formatting. All logic stays in integer centavos. */
export function formatPhp(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(centavos));
  const pesos = Math.floor(abs / 100);
  const grouped = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}₱${grouped}.${cents}`;
}
```

- [ ] **Step 14: Run to verify pass, then commit**

Run: `cd mobile && npx jest utils/__tests__/money.test.ts --ci`
Expected: PASS (3 tests).

```bash
git add mobile/utils/money.ts mobile/utils/__tests__/money.test.ts
git commit -m "feat: add centavos-to-peso display formatter"
```

# Mobile Foundation Part 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue `docs/superpowers/plans/2026-08-02-mobile-foundation.md` (which ends at Task 8) by building the rest of the PeraPlano mobile foundation — the repository layer over the existing SQLite schema, the entitlements layer, the Soon/Plus gating primitives, React Query wiring, and the app shell (root provider tree, entry route, five-tab navigation) — fully test-driven.

**Architecture:** Screens and hooks never touch SQL: every read/write goes through a repository module in `mobile/lib/db/repos/`, which maps snake_case rows to camelCase domain objects via `lib/db/mappers.ts` and generates ids with `lib/ids.ts`. Tier questions are answered in exactly one place (`lib/entitlements.ts`), phased-rollout questions in exactly one place (`constants/shipped_features.ts`), and both are consumed by presentational gate components (`SoonGate`, `PlusGate`) rather than scattered conditionals. The app shell is an expo-router tree whose root layout gates render on fonts + database bootstrap and provides React Query (persisted to AsyncStorage), keyboard, and theme context to every route.

**Tech Stack:** Expo SDK ~54 (RN 0.81, React 19.1, TypeScript ~5.9 strict) · expo-router ~6 (typed routes) · expo-sqlite (via `lib/db`) · NativeWind ^4.2 + tailwindcss ^3.4 · TanStack React Query ~5.90 + `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` · react-native-keyboard-controller (added in this plan) · lucide-react-native · @expo-google-fonts/inter · @react-navigation/native + bottom-tabs ^7 · jest + jest-expo + @testing-library/react-native · better-sqlite3 (dev-only jest sqlite adapter).

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW — exact names, signatures, tables, tokens. A task may add private internals; it may not rename or reshape anything the contract defines.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers (tables, columns). TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** for all money (DB and logic). Format to `₱1,234.56` only at display. `type Centavos = number`.
- **Time:** epoch **milliseconds** (`number`) for timestamps in code and DB; calendar dates as `'YYYY-MM-DD'` strings.
- **IDs:** UUIDv4 strings, generated client-side via `newId()` from `@/lib/ids` (foundation Task 8).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). **No AI-attribution trailer or footer of any kind** (no `Co-Authored-By: Claude`, no "Generated with" line).
- **TDD:** every behavior lands as failing test → run it (see it fail) → minimal implementation → run again (green) → commit. Never write implementation before its failing test.
- **Test commands:** all tests `npx jest --ci`; a single file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`. Both must pass before every commit.
- **Working directory:** all commands run from `mobile/` (i.e. `d:\My Folder\pera-plano\mobile`) unless a step says otherwise.
- **DB access:** feature code never runs DDL and never inlines SQL outside `lib/db/`. Screens/hooks call repos only. (Test files may use raw SQL to set up fixtures.)

### What Tasks 1–8 already delivered (consume, do not redo)

| From | You get |
|---|---|
| Task 1 | Expo scaffold, `npx jest --ci` + `npx tsc --noEmit` green, jest alias `@/*`, `test_support/jest_setup.ts` with AsyncStorage + expo-crypto mocks |
| Task 2 | `constants/colors.ts` → `palette`; `constants/env.ts` → `ENV` |
| Task 3 | `metro.config.js`, `babel.config.js` (inline `.sql` imports, nativewind jsxImportSource), `tailwind.config.ts`, `global.css`, `app.json`, `nativewind-env.d.ts`, `svg.d.ts`, `sql.d.ts` |
| Task 4 | `lib/fonts.ts` → `APP_FONT_FAMILY`, `applyGlobalFont()` |
| Task 5 | `contexts/theme_context.tsx` → `ThemeProvider`, `useTheme()`, `ThemePreference`, `ResolvedTheme` |
| Task 6 | `lib/db/database.ts` → `getDatabase()`, `closeDatabase()`; `lib/db/migrations.ts` → `Migration`, `MIGRATIONS`, `runMigrations()`; `test_support/expo_sqlite_mock.ts` |
| Task 7 | `lib/db/migrations/001_core.sql` (all 19 tables); `test_support/db.ts` → `freshDb()` |
| Task 8 | `types/domain.ts` (all domain types), `lib/ids.ts` → `newId()`, `lib/db/mappers.ts` → row↔domain mappers |

---

### Task 9: `lib/entitlements.ts` — the one place that knows about tiers

**Files:**
- Create: `mobile/lib/entitlements.ts`
- Test: `mobile/lib/__tests__/entitlements.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (contract §7, exact signatures — consumed by Task 11 `transactions_repo`, by m1/m2/m3 gate call-sites):
  ```ts
  export type Tier = "free" | "plus";
  export function getTier(): Tier;                        // MVP: hardcoded "plus"
  export function canCreateWallet(currentCount: number): boolean;   // free: < 3
  export function canCreateLimit(activeCount: number): boolean;     // free: < 1
  export function canCreateGoal(currentCount: number): boolean;     // free: < 1
  export function canCreateLoan(currentCount: number): boolean;     // free: < 1
  export function historyWindowDays(): number | null;     // free: 90, plus: null
  export function hasRecurringDetection(): boolean;       // plus only
  export function hasBackup(): boolean;                   // plus only
  export function hasProjection(): boolean;               // plus only
  export function __setTierForTests(tier: Tier | null): void;  // TEST SEAM ONLY
  ```

**Product rules encoded here (docs/05-monetization.md §2/§3):** caps block creation of *new* records only — they never delete, truncate, or hide-then-discard existing data. "History: 90 days" is a *visibility* window, not a retention window.

**Steps:**

- [ ] Write the failing test `lib/__tests__/entitlements.test.ts`:
  ```ts
  import {
    __setTierForTests,
    canCreateGoal,
    canCreateLimit,
    canCreateLoan,
    canCreateWallet,
    getTier,
    hasBackup,
    hasProjection,
    hasRecurringDetection,
    historyWindowDays,
  } from "../entitlements";

  afterEach(() => {
    __setTierForTests(null);
  });

  test("MVP hardcodes the plus tier", () => {
    expect(getTier()).toBe("plus");
  });

  describe("free tier caps (docs/05-monetization.md §2)", () => {
    beforeEach(() => {
      __setTierForTests("free");
    });

    test("wallets are capped at 3", () => {
      expect(canCreateWallet(0)).toBe(true);
      expect(canCreateWallet(2)).toBe(true);
      expect(canCreateWallet(3)).toBe(false);
      expect(canCreateWallet(9)).toBe(false);
    });

    test("active limits are capped at 1", () => {
      expect(canCreateLimit(0)).toBe(true);
      expect(canCreateLimit(1)).toBe(false);
    });

    test("goals are capped at 1", () => {
      expect(canCreateGoal(0)).toBe(true);
      expect(canCreateGoal(1)).toBe(false);
    });

    test("loans are capped at 1", () => {
      expect(canCreateLoan(0)).toBe(true);
      expect(canCreateLoan(1)).toBe(false);
    });

    test("history is a 90-day visibility window", () => {
      expect(historyWindowDays()).toBe(90);
    });

    test("depth features are off", () => {
      expect(hasRecurringDetection()).toBe(false);
      expect(hasBackup()).toBe(false);
      expect(hasProjection()).toBe(false);
    });
  });

  describe("plus tier", () => {
    beforeEach(() => {
      __setTierForTests("plus");
    });

    test("every creation cap is unlimited", () => {
      expect(canCreateWallet(3)).toBe(true);
      expect(canCreateWallet(999)).toBe(true);
      expect(canCreateLimit(1)).toBe(true);
      expect(canCreateLimit(999)).toBe(true);
      expect(canCreateGoal(1)).toBe(true);
      expect(canCreateGoal(999)).toBe(true);
      expect(canCreateLoan(1)).toBe(true);
      expect(canCreateLoan(999)).toBe(true);
    });

    test("history is unlimited", () => {
      expect(historyWindowDays()).toBeNull();
    });

    test("depth features are on", () => {
      expect(hasRecurringDetection()).toBe(true);
      expect(hasBackup()).toBe(true);
      expect(hasProjection()).toBe(true);
    });
  });

  test("__setTierForTests(null) restores the shipped tier", () => {
    __setTierForTests("free");
    expect(getTier()).toBe("free");
    __setTierForTests(null);
    expect(getTier()).toBe("plus");
  });
  ```
- [ ] Run `npx jest --ci lib/__tests__/entitlements.test.ts` — expected FAILURE: `Cannot find module '../entitlements'`.
- [ ] Create `lib/entitlements.ts`:
  ```ts
  // lib/entitlements.ts — the ONLY place in the app that knows about tiers
  // (interface contract §7; docs/05-monetization.md §4). Gated call-sites ask a
  // question here; nothing else hardcodes tier behavior.
  //
  // Gate principles (docs/05 §3.1), true of every function below:
  //   1. Hitting a cap blocks creating a NEW record — it never deletes data.
  //   2. Existing records keep working fully, including after a downgrade.
  //   3. "History: 90 days" is a VISIBILITY window; nothing is ever purged by it.

  export type Tier = "free" | "plus";

  /** MVP ships everyone on Plus; turning enforcement on is a one-constant change. */
  const MVP_TIER: Tier = "plus";

  // Free-tier caps, straight from the canonical tier matrix (docs/05 §2).
  const FREE_WALLET_CAP = 3;
  const FREE_ACTIVE_LIMIT_CAP = 1;
  const FREE_GOAL_CAP = 1;
  const FREE_LOAN_CAP = 1;
  const FREE_HISTORY_WINDOW_DAYS = 90;

  let tierOverride: Tier | null = null;

  /**
   * TEST SEAM ONLY — lets unit tests exercise both tiers without a billing stack.
   * App code never calls this; production always resolves MVP_TIER. Pass `null`
   * to restore the shipped tier.
   */
  export function __setTierForTests(tier: Tier | null): void {
    tierOverride = tier;
  }

  export function getTier(): Tier {
    return tierOverride ?? MVP_TIER;
  }

  export function canCreateWallet(currentCount: number): boolean {
    return getTier() === "plus" || currentCount < FREE_WALLET_CAP;
  }

  export function canCreateLimit(activeCount: number): boolean {
    return getTier() === "plus" || activeCount < FREE_ACTIVE_LIMIT_CAP;
  }

  export function canCreateGoal(currentCount: number): boolean {
    return getTier() === "plus" || currentCount < FREE_GOAL_CAP;
  }

  export function canCreateLoan(currentCount: number): boolean {
    return getTier() === "plus" || currentCount < FREE_LOAN_CAP;
  }

  /** Days of ledger visible to the user; null = unlimited. Never a retention rule. */
  export function historyWindowDays(): number | null {
    return getTier() === "plus" ? null : FREE_HISTORY_WINDOW_DAYS;
  }

  export function hasRecurringDetection(): boolean {
    return getTier() === "plus";
  }

  export function hasBackup(): boolean {
    return getTier() === "plus";
  }

  /** Safe-to-Spend end-of-period projection (Free sees today only). */
  export function hasProjection(): boolean {
    return getTier() === "plus";
  }
  ```
- [ ] Run `npx jest --ci lib/__tests__/entitlements.test.ts` — expected PASS (10 tests). Run `npx tsc --noEmit` — clean.
- [ ] Commit:
  ```
  git add lib/entitlements.ts lib/__tests__/entitlements.test.ts
  git commit -m "feat(mobile): add entitlements layer with free and plus tier caps"
  ```

---

### Task 10: `wallets_repo.ts`

**Files:**
- Create: `mobile/lib/db/repos/wallets_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/wallets_repo.test.ts`

**Interfaces:**
- Consumes: `getDatabase()` (Task 6), `freshDb()` / `closeDatabase()` (Tasks 6–7), `newId()` (Task 8), `rowToWallet` + `WalletRow` (Task 8), `NewWallet` / `Wallet` (Task 8).
- Produces (contract §3, exact signatures — consumed by m1 wallets UI, m2 goals/loans, m3 reports):
  ```ts
  export function createWallet(input: NewWallet): Promise<Wallet>;
  export function getWallet(id: string): Promise<Wallet | null>;
  export function listWallets(opts?: { includeArchived?: boolean }): Promise<Wallet[]>;
  ```
  `createWallet` enforces Wallet invariant 1 (`name` unique among non-archived Wallets) by throwing; the opening balance from `NewWallet.openingBalance` becomes the wallet's starting `balance` anchor (defaults to 0).

**Steps:**

- [ ] Write the failing test `lib/db/repos/__tests__/wallets_repo.test.ts`:
  ```ts
  import { closeDatabase } from "@/lib/db/database";
  import { createWallet, getWallet, listWallets } from "../wallets_repo";
  import { freshDb } from "@/test_support/db";
  import type { SQLiteDatabase } from "expo-sqlite";

  let db: SQLiteDatabase;

  beforeEach(async () => {
    db = await freshDb();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  test("createWallet persists a wallet with a uuid id and defaults", async () => {
    const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
    expect(wallet.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(wallet.balance).toBe(0);
    expect(wallet.currency).toBe("PHP");
    expect(wallet.isArchived).toBe(false);
    expect(wallet.createdAt).toBe(wallet.updatedAt);

    const row = await db.getFirstAsync<{ name: string; is_archived: number }>(
      "SELECT name, is_archived FROM wallets WHERE id = ?",
      [wallet.id],
    );
    expect(row).toEqual({ name: "GCash", is_archived: 0 });
  });

  test("createWallet uses openingBalance as the balance anchor", async () => {
    const wallet = await createWallet({
      name: "BPI Payroll",
      type: "bank",
      openingBalance: 1234567,
    });
    expect(wallet.balance).toBe(1234567);
    expect((await getWallet(wallet.id))?.balance).toBe(1234567);
  });

  test("createWallet rejects a duplicate name among non-archived wallets", async () => {
    await createWallet({ name: "GCash", type: "e-wallet" });
    await expect(createWallet({ name: "GCash", type: "e-wallet" })).rejects.toThrow(
      /already in use/i,
    );
  });

  test("createWallet allows reusing the name of an archived wallet", async () => {
    const first = await createWallet({ name: "GCash", type: "e-wallet" });
    await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [first.id]);
    const second = await createWallet({ name: "GCash", type: "e-wallet" });
    expect(second.id).not.toBe(first.id);
  });

  test("getWallet returns null for an unknown id", async () => {
    expect(await getWallet("missing")).toBeNull();
  });

  test("listWallets hides archived wallets by default and can include them", async () => {
    const cash = await createWallet({ name: "Cash on hand", type: "cash" });
    const old = await createWallet({ name: "Old bank", type: "bank" });
    await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [old.id]);

    const active = await listWallets();
    expect(active.map((w) => w.id)).toEqual([cash.id]);

    const all = await listWallets({ includeArchived: true });
    expect(all.map((w) => w.id)).toEqual([cash.id, old.id]);
    expect(all[1].isArchived).toBe(true);
  });
  ```
- [ ] Run `npx jest --ci lib/db/repos/__tests__/wallets_repo.test.ts` — expected FAILURE: `Cannot find module '../wallets_repo'`.
- [ ] Create `lib/db/repos/wallets_repo.ts`:
  ```ts
  // lib/db/repos/wallets_repo.ts — the only SQL surface for the Wallet aggregate
  // (interface contract §3). Screens and hooks call these functions, never SQL.
  import { getDatabase } from "@/lib/db/database";
  import { rowToWallet, type WalletRow } from "@/lib/db/mappers";
  import { newId } from "@/lib/ids";
  import type { NewWallet, Wallet } from "@/types/domain";

  /**
   * Creates a Wallet with `openingBalance` (default ₱0.00) as its balance anchor.
   * Throws when the name collides with a non-archived Wallet (Wallet invariant 1).
   */
  export async function createWallet(input: NewWallet): Promise<Wallet> {
    const db = await getDatabase();
    const clash = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM wallets WHERE name = ? AND is_archived = 0",
      [input.name],
    );
    if (clash) {
      throw new Error(`wallet name already in use: ${input.name}`);
    }

    const now = Date.now();
    const wallet: Wallet = {
      id: newId(),
      name: input.name,
      type: input.type,
      balance: input.openingBalance ?? 0,
      currency: "PHP",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.runAsync(
      `INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        wallet.id,
        wallet.name,
        wallet.type,
        wallet.balance,
        wallet.currency,
        wallet.createdAt,
        wallet.updatedAt,
      ],
    );
    return wallet;
  }

  export async function getWallet(id: string): Promise<Wallet | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<WalletRow>("SELECT * FROM wallets WHERE id = ?", [id]);
    return row ? rowToWallet(row) : null;
  }

  /** Active wallets first, archived collapsed below them (docs/06 §3.3). */
  export async function listWallets(opts?: { includeArchived?: boolean }): Promise<Wallet[]> {
    const db = await getDatabase();
    const sql = opts?.includeArchived
      ? "SELECT * FROM wallets ORDER BY is_archived ASC, created_at ASC"
      : "SELECT * FROM wallets WHERE is_archived = 0 ORDER BY created_at ASC";
    const rows = await db.getAllAsync<WalletRow>(sql);
    return rows.map(rowToWallet);
  }
  ```
- [ ] Run `npx jest --ci lib/db/repos/__tests__/wallets_repo.test.ts` — expected PASS (6 tests). Run `npx tsc --noEmit` — clean.
- [ ] Commit:
  ```
  git add lib/db/repos
  git commit -m "feat(mobile): add wallets repository with unique-name invariant"
  ```

---

### Task 11: `transactions_repo.ts` — insert, list, sumSpend

**Files:**
- Create: `mobile/lib/db/repos/transactions_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/transactions_repo.test.ts`

**Interfaces:**
- Consumes: `getDatabase()` (Task 6), `newId()` (Task 8), `rowToTransaction` / `transactionToRow` / `TransactionRow` (Task 8), `NewTransaction` / `Transaction` / `TxFilter` / `Centavos` (Task 8), `historyWindowDays()` + `__setTierForTests()` (Task 9), `createWallet` (Task 10).
- Produces (contract §3, exact signatures):
  ```ts
  export function insertTransaction(tx: NewTransaction): Promise<Transaction>;
  export function listTransactions(filter: TxFilter): Promise<Transaction[]>;
  export function sumSpend(args: {
    from: number; to: number; categoryIds?: string[]; walletIds?: string[];
  }): Promise<Centavos>;
  ```
  Pinned semantics every later plan depends on:
  1. **`insertTransaction` moves the wallet balance** inside one SQL transaction (`in` adds, `out` subtracts). Callers must NOT apply the balance delta again.
  2. **Time windows are `[from, to)`** — `from` inclusive, `to` exclusive — so a period's exclusive end plugs straight into the next period's start.
  3. **`sumSpend` counts `direction = 'out'`, transfer-linked rows excluded** (invariant I2), and clamps its window to the free-tier history floor.
  4. **`listTransactions` is reverse-chronological** and applies the same history floor; `excludeTransferLinked` opts into I2 filtering.

**Steps:**

- [ ] Write the failing test `lib/db/repos/__tests__/transactions_repo.test.ts`:
  ```ts
  import { closeDatabase } from "@/lib/db/database";
  import { __setTierForTests } from "@/lib/entitlements";
  import { createWallet } from "../wallets_repo";
  import { insertTransaction, listTransactions, sumSpend } from "../transactions_repo";
  import { freshDb } from "@/test_support/db";
  import type { SQLiteDatabase } from "expo-sqlite";

  const DAY = 24 * 60 * 60 * 1000;
  const CATEGORY_ID = "cat_food";
  const OTHER_CATEGORY_ID = "cat_transport";

  let db: SQLiteDatabase;
  let walletId: string;

  async function seedCategory(id: string, name: string): Promise<void> {
    await db.runAsync(
      `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
       VALUES (?, ?, NULL, 'circle-help', 1, 0, 0, 0)`,
      [id, name],
    );
  }

  async function linkAsTransfer(outId: string, inId: string): Promise<void> {
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO transfer_links (id, out_transaction_id, in_transaction_id, fee_amount, status, detected_by, confidence, created_at, updated_at)
       VALUES ('tl1', ?, ?, 0, 'active', 'manual', 1.0, ?, ?)`,
      [outId, inId, now, now],
    );
    await db.runAsync("UPDATE transactions SET transfer_link_id = 'tl1' WHERE id IN (?, ?)", [
      outId,
      inId,
    ]);
  }

  beforeEach(async () => {
    db = await freshDb();
    await seedCategory(CATEGORY_ID, "Food & Dining");
    await seedCategory(OTHER_CATEGORY_ID, "Transport");
    walletId = (await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 })).id;
  });

  afterEach(async () => {
    __setTierForTests(null);
    await closeDatabase();
  });

  test("insertTransaction persists the row and returns the domain object", async () => {
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1754060400000,
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.94,
    });

    expect(tx.id).toHaveLength(36);
    expect(tx.merchant).toBe("Jollibee");
    expect(tx.counterparty).toBeNull();
    expect(tx.transferLinkId).toBeNull();
    expect(tx.createdAt).toBe(tx.updatedAt);

    const row = await db.getFirstAsync<{ amount: number; direction: string }>(
      "SELECT amount, direction FROM transactions WHERE id = ?",
      [tx.id],
    );
    expect(row).toEqual({ amount: 15000, direction: "out" });
  });

  test("insertTransaction moves the wallet balance in both directions", async () => {
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1,
      source: "manual",
      confidence: 1,
    });
    let balance = await db.getFirstAsync<{ balance: number }>(
      "SELECT balance FROM wallets WHERE id = ?",
      [walletId],
    );
    expect(balance?.balance).toBe(85000);

    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 5000,
      direction: "in",
      occurredAt: 2,
      source: "manual",
      confidence: 1,
    });
    balance = await db.getFirstAsync<{ balance: number }>(
      "SELECT balance FROM wallets WHERE id = ?",
      [walletId],
    );
    expect(balance?.balance).toBe(90000);
  });

  test("listTransactions returns newest first", async () => {
    const older = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 100,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    const newer = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 200,
      direction: "out",
      occurredAt: 2000,
      source: "manual",
      confidence: 1,
    });
    const list = await listTransactions({});
    expect(list.map((t) => t.id)).toEqual([newer.id, older.id]);
  });

  test("listTransactions filters by wallet, category, direction and [from, to)", async () => {
    const otherWalletId = (await createWallet({ name: "Cash", type: "cash" })).id;
    const a = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 100,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    const b = await insertTransaction({
      walletId,
      categoryId: OTHER_CATEGORY_ID,
      amount: 200,
      direction: "in",
      occurredAt: 2000,
      source: "manual",
      confidence: 1,
    });
    await insertTransaction({
      walletId: otherWalletId,
      categoryId: CATEGORY_ID,
      amount: 300,
      direction: "out",
      occurredAt: 3000,
      source: "manual",
      confidence: 1,
    });

    expect((await listTransactions({ walletId })).map((t) => t.id)).toEqual([b.id, a.id]);
    expect((await listTransactions({ categoryId: CATEGORY_ID })).length).toBe(2);
    expect((await listTransactions({ direction: "in" })).map((t) => t.id)).toEqual([b.id]);
    // `to` is EXCLUSIVE: 2000 is outside [1000, 2000).
    expect((await listTransactions({ from: 1000, to: 2000 })).map((t) => t.id)).toEqual([a.id]);
  });

  test("listTransactions can exclude transfer-linked rows (invariant I2)", async () => {
    const out = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 500,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    const inLeg = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 500,
      direction: "in",
      occurredAt: 1001,
      source: "manual",
      confidence: 1,
    });
    const standalone = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 700,
      direction: "out",
      occurredAt: 1002,
      source: "manual",
      confidence: 1,
    });
    await linkAsTransfer(out.id, inLeg.id);

    expect((await listTransactions({})).length).toBe(3);
    expect((await listTransactions({ excludeTransferLinked: true })).map((t) => t.id)).toEqual([
      standalone.id,
    ]);
  });

  test("sumSpend adds outgoing money only, excluding transfer legs", async () => {
    const out = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 500,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    const inLeg = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 500,
      direction: "in",
      occurredAt: 1001,
      source: "manual",
      confidence: 1,
    });
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 700,
      direction: "out",
      occurredAt: 1002,
      source: "manual",
      confidence: 1,
    });
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 900,
      direction: "in",
      occurredAt: 1003,
      source: "manual",
      confidence: 1,
    });
    await linkAsTransfer(out.id, inLeg.id);

    expect(await sumSpend({ from: 0, to: 2000 })).toBe(700);
  });

  test("sumSpend honours the exclusive upper bound and category/wallet filters", async () => {
    const otherWalletId = (await createWallet({ name: "Cash", type: "cash" })).id;
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 100,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    await insertTransaction({
      walletId,
      categoryId: OTHER_CATEGORY_ID,
      amount: 200,
      direction: "out",
      occurredAt: 1500,
      source: "manual",
      confidence: 1,
    });
    await insertTransaction({
      walletId: otherWalletId,
      categoryId: CATEGORY_ID,
      amount: 400,
      direction: "out",
      occurredAt: 1600,
      source: "manual",
      confidence: 1,
    });
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 800,
      direction: "out",
      occurredAt: 2000,
      source: "manual",
      confidence: 1,
    });

    expect(await sumSpend({ from: 1000, to: 2000 })).toBe(700);
    expect(await sumSpend({ from: 0, to: 3000, categoryIds: [CATEGORY_ID] })).toBe(1300);
    expect(await sumSpend({ from: 0, to: 3000, walletIds: [otherWalletId] })).toBe(400);
    expect(await sumSpend({ from: 0, to: 3000, categoryIds: [] })).toBe(0);
    expect(await sumSpend({ from: 0, to: 1 })).toBe(0);
  });

  test("free tier clamps sumSpend and listTransactions to the 90-day window", async () => {
    const now = Date.now();
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 100,
      direction: "out",
      occurredAt: now - 10 * DAY,
      source: "manual",
      confidence: 1,
    });
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 900,
      direction: "out",
      occurredAt: now - 100 * DAY,
      source: "manual",
      confidence: 1,
    });

    __setTierForTests("plus");
    expect(await sumSpend({ from: 0, to: now + 1000 })).toBe(1000);
    expect((await listTransactions({})).length).toBe(2);

    __setTierForTests("free");
    expect(await sumSpend({ from: 0, to: now + 1000 })).toBe(100);
    expect((await listTransactions({})).length).toBe(1);
  });
  ```
- [ ] Run `npx jest --ci lib/db/repos/__tests__/transactions_repo.test.ts` — expected FAILURE: `Cannot find module '../transactions_repo'`.
- [ ] Create `lib/db/repos/transactions_repo.ts`:
  ```ts
  // lib/db/repos/transactions_repo.ts — the only SQL surface for the ledger
  // (interface contract §3). Windows are [from, to): `from` inclusive, `to` exclusive.
  import { getDatabase } from "@/lib/db/database";
  import { rowToTransaction, transactionToRow, type TransactionRow } from "@/lib/db/mappers";
  import { historyWindowDays } from "@/lib/entitlements";
  import { newId } from "@/lib/ids";
  import type { Centavos, NewTransaction, Transaction, TxFilter } from "@/types/domain";

  const DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * Earliest `occurred_at` the current tier may see, or null when unlimited.
   * A VISIBILITY floor only — nothing is deleted and wallet balances are
   * unaffected (docs/05-monetization.md §2/§3.3).
   */
  function historyFloor(): number | null {
    const days = historyWindowDays();
    return days === null ? null : Date.now() - days * DAY_MS;
  }

  /**
   * Commits a Transaction and moves its Wallet's balance in the same SQL
   * transaction (`in` adds, `out` subtracts). Callers must not re-apply the delta.
   */
  export async function insertTransaction(tx: NewTransaction): Promise<Transaction> {
    const db = await getDatabase();
    const now = Date.now();
    const record: Transaction = {
      id: newId(),
      walletId: tx.walletId,
      categoryId: tx.categoryId,
      amount: tx.amount,
      direction: tx.direction,
      occurredAt: tx.occurredAt,
      merchant: tx.merchant ?? null,
      counterparty: tx.counterparty ?? null,
      referenceNo: tx.referenceNo ?? null,
      source: tx.source,
      confidence: tx.confidence,
      rawNotificationId: tx.rawNotificationId ?? null,
      transferLinkId: tx.transferLinkId ?? null,
      note: tx.note ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const row = transactionToRow(record);

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO transactions (
           id, wallet_id, category_id, amount, direction, occurred_at, merchant,
           counterparty, reference_no, source, confidence, raw_notification_id,
           transfer_link_id, note, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.wallet_id,
          row.category_id,
          row.amount,
          row.direction,
          row.occurred_at,
          row.merchant,
          row.counterparty,
          row.reference_no,
          row.source,
          row.confidence,
          row.raw_notification_id,
          row.transfer_link_id,
          row.note,
          row.created_at,
          row.updated_at,
        ],
      );
      await db.runAsync("UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?", [
        record.direction === "in" ? record.amount : -record.amount,
        now,
        record.walletId,
      ]);
    });

    return record;
  }

  /** Reverse-chronological ledger read, clamped to the tier's history window. */
  export async function listTransactions(filter: TxFilter): Promise<Transaction[]> {
    const db = await getDatabase();
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    const floor = historyFloor();
    const from =
      floor === null ? filter.from : Math.max(filter.from ?? Number.NEGATIVE_INFINITY, floor);
    if (from !== undefined && Number.isFinite(from)) {
      clauses.push("occurred_at >= ?");
      params.push(from);
    }
    if (filter.to !== undefined) {
      clauses.push("occurred_at < ?");
      params.push(filter.to);
    }
    if (filter.walletId) {
      clauses.push("wallet_id = ?");
      params.push(filter.walletId);
    }
    if (filter.categoryId) {
      clauses.push("category_id = ?");
      params.push(filter.categoryId);
    }
    if (filter.direction) {
      clauses.push("direction = ?");
      params.push(filter.direction);
    }
    if (filter.excludeTransferLinked) {
      clauses.push("transfer_link_id IS NULL");
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await db.getAllAsync<TransactionRow>(
      `SELECT * FROM transactions ${where} ORDER BY occurred_at DESC, created_at DESC`,
      params,
    );
    return rows.map(rowToTransaction);
  }

  /**
   * Total money spent in [from, to). Counts `direction = 'out'` only and never
   * counts transfer legs (invariant I2). The window is clamped to the tier's
   * history floor so Free never reports spend it cannot show.
   */
  export async function sumSpend(args: {
    from: number;
    to: number;
    categoryIds?: string[];
    walletIds?: string[];
  }): Promise<Centavos> {
    if (args.categoryIds?.length === 0 || args.walletIds?.length === 0) return 0;

    const db = await getDatabase();
    const floor = historyFloor();
    const from = floor === null ? args.from : Math.max(args.from, floor);

    const clauses = [
      "direction = 'out'",
      "transfer_link_id IS NULL",
      "occurred_at >= ?",
      "occurred_at < ?",
    ];
    const params: (string | number)[] = [from, args.to];

    if (args.categoryIds) {
      clauses.push(`category_id IN (${args.categoryIds.map(() => "?").join(", ")})`);
      params.push(...args.categoryIds);
    }
    if (args.walletIds) {
      clauses.push(`wallet_id IN (${args.walletIds.map(() => "?").join(", ")})`);
      params.push(...args.walletIds);
    }

    const row = await db.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE ${clauses.join(" AND ")}`,
      params,
    );
    return row?.total ?? 0;
  }
  ```
- [ ] Run `npx jest --ci lib/db/repos/__tests__/transactions_repo.test.ts` — expected PASS (8 tests). Run `npx tsc --noEmit` — clean.
- [ ] Commit:
  ```
  git add lib/db/repos
  git commit -m "feat(mobile): add transactions repository with balance moves and tier-aware spend"
  ```

---

> **Density note for the executor.** Tasks 9–11 above spell out every line of test and
> implementation code. Tasks 12 onward use a compact form: exact files, exact interfaces,
> the logic rules that matter, and each test named with what it asserts — but you write the
> test body and the implementation yourself. The TDD order is unchanged and non-negotiable:
> write the named failing test first, run it and watch it fail, implement the minimum, run
> it green, commit. Where a rule below is ambiguous, the interface contract wins, then the
> feature spec named in the task.

---

### Task 12: `categories_repo.ts` + PH default category seed

**Files:**
- Create: `mobile/lib/db/repos/categories_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/categories_repo.test.ts`

**Interfaces:**
- Consumes: `freshDb()` (Task 7), mappers (Task 8), `newId()` (Task 8).
- Produces:
  ```ts
  listCategories(opts?: { includeHidden?: boolean }): Promise<Category[]>
  getCategory(id: string): Promise<Category | null>
  createCategory(input: NewCategory): Promise<Category>
  updateCategory(id: string, patch: Partial<Pick<Category, "name" | "icon" | "parentId">>): Promise<Category>
  hideCategory(id: string): Promise<void>          // system rows: hide, never delete
  deleteCategory(id: string): Promise<void>        // throws on isSystem
  seedDefaultCategories(): Promise<void>           // idempotent
  UNCATEGORIZED_ID: string                         // stable, referenced by the categorizer
  ```

**Rules:**
1. Tree via `parent_id`; `listCategories` returns parents before their children, each group name-ascending.
2. `seedDefaultCategories()` is idempotent — keyed on a stable id per default row, so running it twice leaves the same rows and never duplicates.
3. System rows (`is_system = 1`) cannot be deleted; `deleteCategory` throws `Error("cannot delete a system category")`. `hideCategory` is the supported path.
4. Deleting a non-system parent reassigns its children to that parent's `parentId` (or null) — never orphans a row.
5. Seed set (top level, all `is_system = 1`), from `docs/02-domain-model.md` §5: Food & Dining · Groceries/Palengke · Transport · Load & Data · Bills & Utilities · Rent & Housing · Utang & Loan Payments · Padala/Remittance · Shopping · Health & Pharmacy · Education & Tuition · Entertainment & Subscriptions · Savings & Investments · Fees & Charges · Uncategorized. Uncategorized uses the exported `UNCATEGORIZED_ID`.

- [ ] **Step 1: Write the failing tests** in `categories_repo.test.ts`:
  - `seedDefaultCategories inserts the 15 PH default categories` — count is 15, all `isSystem`.
  - `seedDefaultCategories is idempotent` — run twice, count still 15, ids unchanged.
  - `UNCATEGORIZED_ID resolves to a seeded system category` — `getCategory(UNCATEGORIZED_ID)` is non-null and named "Uncategorized".
  - `createCategory nests under a parent and listCategories orders parents before children`.
  - `deleteCategory throws for a system category`.
  - `hideCategory removes the row from listCategories but includeHidden returns it`.
  - `deleting a parent reparents its children instead of orphaning them`.
- [ ] **Step 2:** Run `npx jest --ci lib/db/repos/__tests__/categories_repo.test.ts` — expected FAIL (module not found).
- [ ] **Step 3:** Implement `categories_repo.ts` to satisfy the rules above.
- [ ] **Step 4:** Run the same command — expected PASS (7 tests). Run `npx tsc --noEmit` — clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/db/repos
  git commit -m "feat(mobile): add categories repository with PH default category seed"
  ```

---

### Task 13: `review_queue_repo.ts`

**Files:**
- Create: `mobile/lib/db/repos/review_queue_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/review_queue_repo.test.ts`

**Interfaces:**
- Produces (contract §3 signatures are LAW — do not rename):
  ```ts
  enqueue(item: NewReviewItem): Promise<ReviewQueueItem>
  listOpen(): Promise<ReviewQueueItem[]>
  resolve(id: string, resolution: ReviewResolution): Promise<void>
  countOpen(): Promise<number>                     // drives the tab badge
  purgeExpired(now: number): Promise<number>       // returns rows removed
  ```
  Both types are already shipped in `mobile/types/domain.ts` (foundation Task 8) and pinned by the
  `review_queue_items` CHECK constraint in `001_core.sql`. Consume them; do not redefine or widen:
  ```ts
  type ReviewKind = "low-confidence" | "unknown-provider" | "ambiguous-transfer" | "possible-duplicate";
  type ReviewResolution = "confirmed" | "dismissed";
  ```
  > **Corrected 2026-08-07.** An earlier draft of this section specified a five-variant tagged
  > `ReviewResolution` carrying `transactionId` / `userRuleId` / `transferLinkId` /
  > `keptTransactionId`. That was over-design and contradicted shipped code: the
  > `review_queue_items` table has no columns for those fields, so they would have been silently
  > dropped on write. The outcome of a triage action is already recorded in the rows the action
  > creates — the Transaction, the UserRule, the TransferLink — which is the single place it
  > belongs. The queue item only records that it is closed, and whether the user confirmed or
  > dismissed. M1c's `resolve_actions.ts` returns the created ids to its caller directly.

**Rules:**
1. `payload_json` stores the stage output verbatim (parsed event, candidate pair, or raw capture ref) — the repo serializes/deserializes, it does not interpret.
2. `listOpen` = `resolved_at IS NULL AND expires_at > now`, oldest first (FIFO triage).
3. `resolve` sets `resolved_at`; resolving an already-resolved id is a no-op, not an error (double-tap safety).
4. `expires_at` defaults to `created_at + 30 days` per the Review Queue hygiene rule in `docs/04-features/08-review-queue.md`.
5. `purgeExpired` deletes rows past `expires_at` that are still unresolved, and returns the count.

- [ ] **Step 1: Write the failing tests:**
  - `enqueue round-trips payload_json through listOpen` (object in, deep-equal object out).
  - `listOpen returns oldest first and excludes resolved rows`.
  - `resolve is idempotent` — calling twice does not throw and leaves one resolved row.
  - `countOpen matches listOpen length`.
  - `expired unresolved items are excluded from listOpen and removed by purgeExpired`.
  - `each ReviewKind round-trips` (parametrized over the four kinds).
- [ ] **Step 2:** Run `npx jest --ci lib/db/repos/__tests__/review_queue_repo.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement `review_queue_repo.ts`.
- [ ] **Step 4:** Run — expected PASS (6 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/db/repos
  git commit -m "feat(mobile): add review queue repository with expiry and idempotent resolve"
  ```

---

### Task 14: `app_settings_repo.ts` — typed key/value settings

**Files:**
- Create: `mobile/lib/db/repos/app_settings_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/app_settings_repo.test.ts`

**Interfaces:**
```ts
type AppSettings = {
  onboarding_complete: boolean;
  capture_enabled: boolean;
  telemetry_enabled: boolean;
  theme_preference: "auto" | "light" | "dark";
  last_parser_ruleset_version: number;
  cash_reconcile_prompt_at: number | null;
};
getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]>   // returns the default when unset
setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>
getAllSettings(): Promise<AppSettings>
resetSettings(): Promise<void>
DEFAULT_SETTINGS: AppSettings   // onboarding_complete false, capture_enabled true, telemetry_enabled true, theme_preference "auto", last_parser_ruleset_version 0, cash_reconcile_prompt_at null
```

**Rules:**
1. One row per key in `app_settings`; values JSON-encoded so booleans and numbers survive the round trip.
2. Reading an unset key returns its `DEFAULT_SETTINGS` value — never null, never throws.
3. `setSetting` upserts.

- [ ] **Step 1: Write the failing tests:** unset key returns its default · set-then-get round-trips each of the six types (boolean, number, string union, null) · `setSetting` twice upserts rather than duplicating · `getAllSettings` merges stored over defaults · `resetSettings` restores every default.
- [ ] **Step 2:** Run `npx jest --ci lib/db/repos/__tests__/app_settings_repo.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement `app_settings_repo.ts`.
- [ ] **Step 4:** Run — expected PASS (5 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/db/repos
  git commit -m "feat(mobile): add typed app settings repository with defaults"
  ```

---

### Task 15: `shipped_features.ts` + `SoonGate` / `PlusGate`

Phased-rollout and paid-tier gating, per `docs/11-mobile-app-design-prompt.md`. These two states must be visually unmistakable: **Soon = grey and dormant, Plus = green and inviting.**

**Files:**
- Create: `mobile/constants/shipped_features.ts`
- Create: `mobile/components/gates/soon_gate.tsx`
- Create: `mobile/components/gates/plus_gate.tsx`
- Create: `mobile/components/gates/upgrade_sheet.tsx`
- Test: `mobile/constants/__tests__/shipped_features.test.ts`
- Test: `mobile/components/gates/__tests__/gates.test.tsx`

**Interfaces:**
```ts
// shipped_features.ts
type FeatureKey =
  | "limits" | "income" | "goals" | "loans" | "bills"
  | "safe_to_spend" | "recurring" | "reports" | "csv_export"
  | "privacy_center" | "listener_health" | "parser_diagnostics";
type ShipState = "shipped" | "soon";
const SHIPPED_FEATURES: Record<FeatureKey, ShipState>;
function isShipped(key: FeatureKey): boolean;
function useShippedFeature(key: FeatureKey): ShipState;

// soon_gate.tsx
<SoonGate feature={FeatureKey}>{children}</SoonGate>
// plus_gate.tsx
<PlusGate capability={"csv_export" | "recurring" | "backup" | "projection" | "amortization"}>{children}</PlusGate>
```

**Rules:**
1. `SHIPPED_FEATURES` is the single per-build rollout switch. **Initialize every one of the twelve keys to `"soon"`** — M1 ships the ledger, wallets and Review Queue, none of which are gated by this map, so at the end of M1 the whole Plan tab and most of the More tab correctly read as Soon. Flipping entries to `"shipped"` is the only change later plans make to this file, and each plan flips exactly the keys it finishes:

   | Plan | Flips to `"shipped"` |
   |---|---|
   | M2 Part 2 (Task 14) | `limits`, `income` |
   | M2b (Task 9) | `goals`, `loans` |
   | M2c (Task 6) | `bills` |
   | M3 Part 2 (Task 7) | `safe_to_spend`, `recurring` |
   | M3b (Task 8) | `reports`, `csv_export`, `privacy_center`, `listener_health`, `parser_diagnostics` |

   All twelve keys are `"shipped"` when M3b completes. A key that no plan flips is a bug in the plan set, not a deliberate omission.
2. `SoonGate` with a `"soon"` feature renders children wrapped so they are: desaturated (`opacity-40`), non-interactive (`pointerEvents="none"`), and captioned with a grey "Soon" chip. Content stays readable — users see the roadmap. With `"shipped"`, it renders children untouched (no wrapper element).
3. `PlusGate` consults `lib/entitlements.ts` (Task 9). On the free tier it renders children plus a brand-green Plus badge with a lock glyph, and intercepts press to open `UpgradeSheet`. On `plus` it renders children untouched.
4. `UpgradeSheet` shows the Free-vs-Plus comparison rows from `docs/05-monetization.md` and an upgrade button that is inert in MVP (billing is post-MVP).
5. Colors come from the contract §2 tokens only: grey chip uses `fg-2`, Plus badge uses `brand`.

- [ ] **Step 1: Write the failing tests:**
  - `shipped_features.test.ts`: every `FeatureKey` has an entry (no missing keys) · `isShipped` agrees with the map.
  - `gates.test.tsx`: SoonGate with a soon feature renders the "Soon" chip and sets `pointerEvents` to `none` · SoonGate with a shipped feature renders children with no chip and no wrapper · PlusGate on free tier renders the Plus badge · PlusGate press on free tier opens the upgrade sheet · PlusGate on plus tier renders children with no badge (mock `getTier`).
- [ ] **Step 2:** Run `npx jest --ci constants/__tests__/shipped_features.test.ts components/gates` — expected FAIL.
- [ ] **Step 3:** Implement the map, hook, and three components.
- [ ] **Step 4:** Run — expected PASS (7 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add constants components/gates
  git commit -m "feat(mobile): add phased rollout map with Soon and Plus gate components"
  ```

---

### Task 16: React Query client + query-key factory

**Files:**
- Create: `mobile/lib/query_client.ts`
- Create: `mobile/constants/query_keys.ts`
- Test: `mobile/lib/__tests__/query_client.test.ts`
- Test: `mobile/constants/__tests__/query_keys.test.ts`
- Modify: `mobile/package.json` (add `@tanstack/react-query`, `@tanstack/react-query-persist-client`, `@tanstack/query-async-storage-persister`)

**Interfaces:**
```ts
// query_client.ts
const queryClient: QueryClient;
const persistOptions: { persister: Persister; maxAge: number; buster: string };
// constants/query_keys.ts
const queryKeys: {
  wallets:      { all: readonly ["wallets"]; list: () => readonly ["wallets","list"]; detail: (id: string) => readonly ["wallets","detail",string] };
  transactions: { all: readonly ["transactions"]; list: (f?: object) => readonly ["transactions","list",object|undefined]; detail: (id: string) => readonly ["transactions","detail",string] };
  reviewQueue:  { all: readonly ["review_queue"]; open: () => readonly ["review_queue","open"]; count: () => readonly ["review_queue","count"] };
  categories:   { all: readonly ["categories"]; list: () => readonly ["categories","list"] };
  limits:       { all: readonly ["limits"]; list: () => readonly ["limits","list"]; detail: (id: string) => readonly ["limits","detail",string] };
  goals:        { all: readonly ["goals"]; list: () => readonly ["goals","list"]; detail: (id: string) => readonly ["goals","detail",string] };
  loans:        { all: readonly ["loans"]; list: () => readonly ["loans","list"]; detail: (id: string) => readonly ["loans","detail",string] };
  bills:        { all: readonly ["bills"]; list: () => readonly ["bills","list"]; detail: (id: string) => readonly ["bills","detail",string] };
  settings:     { all: readonly ["settings"] };
};
```

**Rules (STACK_BASIS §6):** `staleTime` 5 min · `gcTime` 30 min · queries `retry: 3` with exponential backoff · **mutations `retry: 0`** (side effects must never auto-replay) · `refetchOnWindowFocus: false` · `refetchOnReconnect: true`. Persist to AsyncStorage with `maxAge: Infinity` and a `buster` string. No auth-boundary cache reset exists here — this app has no login.

- [ ] **Step 1: Write the failing tests:** default options match every value above (assert each explicitly, especially `mutations.retry === 0`) · `queryKeys.wallets.detail("x")` equals `["wallets","detail","x"]` · every family's `detail`/`list` key starts with its `all` key (parametrized, so invalidating `all` cascades).
- [ ] **Step 2:** Run `npx jest --ci lib/__tests__/query_client.test.ts constants/__tests__/query_keys.test.ts` — expected FAIL.
- [ ] **Step 3:** Install the three packages, then implement both files.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/query_client.ts constants/query_keys.ts package.json package-lock.json
  git commit -m "feat(mobile): add react query client and hierarchical query key factory"
  ```

---

### Task 17: App shell — root layout, entry route, five-tab navigation

**Files:**
- Create: `mobile/app/_layout.tsx`
- Create: `mobile/app/index.tsx`
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/index.tsx` (Home), `transactions.tsx`, `wallets.tsx`, `plan.tsx`, `more.tsx`
- Create: `mobile/lib/bootstrap.ts`
- Test: `mobile/lib/__tests__/bootstrap.test.ts`
- Test: `mobile/app/__tests__/tabs_layout.test.tsx`
- Modify: `mobile/package.json` (add `react-native-keyboard-controller`)

**Interfaces:**
```ts
// lib/bootstrap.ts
async function bootstrapApp(): Promise<{ onboardingComplete: boolean }>;
// runs migrations, seeds default categories, reads app settings — safe to call once at startup
```

**Rules:**
1. Root `_layout.tsx` provider order, outer → inner (STACK_BASIS §16, minus auth/contacts — this app is local-first with no login): `PersistQueryClientProvider` → `KeyboardProvider` → `ThemeProvider` → `Stack`. Render `null` until fonts are loaded AND `bootstrapApp()` has resolved.
2. `Stack` uses `headerShown: false` and `contentStyle.backgroundColor` set to the resolved theme background, so popping a screen never flashes white.
3. `app/index.tsx` redirects to `/(onboarding)` when `onboarding_complete` is false, else to `/(tabs)`. The onboarding route group does not exist until the M3 plan builds it — until then, guard with a `SHIPPED_FEATURES`-style check and fall through to `/(tabs)`, so the app is runnable at the end of this plan.
4. Tab bar: five tabs in this order — Home, Transactions, Wallets, Plan, More — with lucide-react-native icons (`House`, `ReceiptText`, `Wallet`, `Target`, `Ellipsis`), active tint `brand`, inactive `fg-2`, bar background `surface`, all via the contract §2 tokens in both light and dark.
5. Each tab screen is a placeholder rendering its title and the empty state copy from `docs/06-information-architecture.md`. Later plans replace the bodies; the tab registration does not change.

- [ ] **Step 1: Write the failing tests:**
  - `bootstrap.test.ts`: `bootstrapApp` runs migrations then seeds categories (15 rows present afterward) · calling it twice does not duplicate categories · it returns `onboardingComplete: false` on a fresh database.
  - `tabs_layout.test.tsx`: renders exactly five tabs with the expected accessible labels, in order.
- [ ] **Step 2:** Run `npx jest --ci lib/__tests__/bootstrap.test.ts app/__tests__/tabs_layout.test.tsx` — expected FAIL.
- [ ] **Step 3:** Install `react-native-keyboard-controller`, then implement `bootstrap.ts`, the root layout, the entry route, the tabs layout, and the five placeholder screens.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5:** Manually verify the app boots: `npx expo start` and confirm the five tabs render and switch in both light and dark mode.
- [ ] **Step 6: Commit**
  ```
  git add app lib/bootstrap.ts package.json package-lock.json
  git commit -m "feat(mobile): add app shell with root providers, entry route and five tabs"
  ```

---

### Task 18: Foundation green-gate

**Files:** none created — this task proves the foundation is complete and consumable.

- [ ] **Step 1:** Run the full suite: `npx jest --ci`. Expected: PASS, zero failures, zero skipped.
- [ ] **Step 2:** Run `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3:** Verify every contract §3 signature exists with the exact name and shape by grepping the repo files: `createWallet`, `getWallet`, `listWallets`, `insertTransaction`, `listTransactions`, `sumSpend`, `enqueue`, `listOpen`, `resolve`. Any mismatch is a bug in this plan's output — fix it now, before feature plans consume it.
- [ ] **Step 4:** Verify every contract §7 entitlements function exists: `getTier`, `canCreateWallet`, `canCreateLimit`, `canCreateGoal`, `canCreateLoan`, `historyWindowDays`, `hasRecurringDetection`, `hasBackup`, `hasProjection`.
- [ ] **Step 5: Commit** (only if Steps 3–4 required fixes)
  ```
  git add -A
  git commit -m "fix(mobile): align foundation exports with the interface contract"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 9–18 committed; `npx jest --ci` green; `npx tsc --noEmit` clean.
- [ ] Repos exist for wallets, transactions, categories, review queue, and app settings — all with contract §3 names, no SQL outside `lib/db/`.
- [ ] `seedDefaultCategories()` is idempotent and produces the 15 PH defaults; `UNCATEGORIZED_ID` is stable and exported.
- [ ] `lib/entitlements.ts` matches contract §7 exactly and is the ONLY place tier logic lives.
- [ ] `constants/shipped_features.ts` covers all twelve feature keys; `SoonGate` renders grey and non-interactive, `PlusGate` renders green with an upgrade sheet.
- [ ] React Query defaults match STACK_BASIS §6, with `mutations.retry === 0`.
- [ ] The app boots to a five-tab shell in both light and dark mode.
- [ ] Next plans unblocked: `2026-08-02-mobile-ingest-m1a-native-module.md`, then `-m1b-pipeline.md`, then `-m1c-ui.md`.

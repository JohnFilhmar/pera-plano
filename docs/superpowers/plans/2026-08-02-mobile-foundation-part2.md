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

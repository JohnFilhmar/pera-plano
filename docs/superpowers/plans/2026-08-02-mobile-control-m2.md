# PeraPlano Mobile Control (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PeraPlano's control layer — Limits, Income detection, Goals & Savings, Loans, and Bills — as pure TypeScript engines plus repository extensions, Plan-tab UI, and local-notification alerts, consuming the M1 ledger and foundation repos exactly per the interface contract.

**Architecture:** Every feature is a pure, clock-injected engine module under `mobile/lib/<feature>/` (unit-tested with fixed timestamps), a repository file under `mobile/lib/db/repos/` (integration-tested against a real SQLite schema via a better-sqlite3 harness), and expo-router screens under `mobile/app/(tabs)/plan/`. A single ledger-commit event emitted from `transactions_repo.insertTransaction` fans out to limit recomputation, income detection, payday events, goal allocation reconciliation, loan payment matching, and bill matching. All user-facing alerts go through one `expo-notifications` alerts service with two Android channels.

**Tech Stack:** Expo SDK ~54 / React Native 0.81 / TypeScript ~5.9 strict · expo-sqlite (prod) + better-sqlite3 (test harness) · expo-notifications (local alerts/reminders) · expo-router ~6 · NativeWind ^4.2 · TanStack React Query ~5.90 · jest + jest-expo (`npx jest --ci`) · lucide-react-native icons.

## Global Constraints

These apply to EVERY task. Violating any of them is a plan-execution failure.

1. **Interface contract is LAW:** `docs/superpowers/plans/2026-08-02-00-interface-contract.md` pins names, signatures, tables, routes, and tokens. Never rename or reshape anything it defines. Product behavior comes from `docs/04-features/03-limits.md`, `04-income.md`, `05-goals-savings.md`, `06-loans.md`, `07-bills.md`, and `docs/02-domain-model.md`.
2. **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
3. **Currency:** integer **centavos** everywhere (DB, logic, tests). `type Centavos = number` (from `mobile/types/domain.ts`). Format to `₱1,234.56` only at display time.
4. **Time:** epoch milliseconds (`number`) in code and DB; calendar dates as `'YYYY-MM-DD'` strings. Period math uses device-local time (PH is a single time zone).
5. **IDs:** UUIDv4 strings generated client-side.
6. **Clock injection:** No engine or service calls `Date.now()` directly; they take a `now: number` parameter (or a `Clock`). Tests use fixed timestamps built with LOCAL `new Date(y, m, d, hh, mm)` constructors — never `Date.now()`, never UTC string parsing for local-calendar logic.
7. **TDD:** every step is red → green → commit. Test command (run from `mobile/`): `npx jest --ci <path>`. Repo/integration tests that use better-sqlite3 carry a `/** @jest-environment node */` docblock.
8. **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). **NO AI-attribution trailers or footers of any kind.**
9. **No DDL in this plan:** the foundation plan owns `mobile/lib/db/migrations/`. M2 uses repositories only. Where an entity needs auxiliary persisted state with no dedicated column (goal milestones, planned contributions, reminder ids, detection state, archived-bill flags), store JSON in the foundation `app_settings` key/value table via the repos defined here.
10. **Entitlements at call-sites only:** gates use `mobile/lib/entitlements.ts` (`canCreateLimit`, `canCreateGoal`, `canCreateLoan`, `getTier`, `hasRecurringDetection`). MVP hardcodes `plus`, but every gate call-site must exist.
11. **Never delete user data from a gate or a feature:** caps block creation only; deleting a Limit/Goal/Loan/Bill never touches Transactions.

### Schema dependency note (read before Task 3)

Foundation's `migrations/001_core.sql` creates all tables from `docs/02-domain-model.md` (camelCase → snake_case). M2 repos assume these columns (list/struct fields are TEXT columns holding JSON):

- `limits(id, scope, basis, value, category_filter, wallet_filter, rollover, is_active, thresholds_fired, created_at, updated_at)`
- `income_profiles(id, cadence, average_amount, is_manual_override, created_at, updated_at)` · `income_profile_sources(income_profile_id, wallet_id)`
- `goals(id, name, target_amount, target_date, linked_wallet_id, contribution_rule, created_at, updated_at)`
- `loans(id, direction, counterparty, principal, interest_rate, schedule, linked_wallet_id, next_due_date, next_due_amount, created_at, updated_at)`
- `loan_payments(id, loan_id, transaction_id, amount, paid_at, kind, note, created_at)`
- `bills(id, name, amount, amount_mode, due_rule, reminder_offsets, auto_match_rule, category_id, created_at, updated_at)`
- `bill_payments(id, bill_id, due_date, adjusted_due_date, status, transaction_id, amount_paid, resolved_at, created_at, updated_at)`
- `recurring_patterns(id, merchant, amount, period, confidence, acknowledged, bill_id, created_at, updated_at)`
- `user_rules(id, matcher, action, priority, is_enabled, created_from, applied_count, last_applied_at, created_at, updated_at)`
- `app_settings(key, value)` (TEXT key PK, TEXT value)

If a column name differs in the real `001_core.sql`, adapt the SQL inside the repo function only (repos are the single mapping layer). If a column is entirely MISSING, STOP and escalate to the foundation-plan owner — do not add DDL here. The integration-test harness (Task 1) executes the real migration files, so any mismatch surfaces as a failing repo test, not a runtime surprise.

Foundation's `mobile/lib/db/database.ts` exposes the opened expo-sqlite database. The single adaptation point is `mobile/lib/db/db_handle.ts` (Task 1): if foundation's export is not named `getDatabase`, change that one import line — nothing else in M2 touches `database.ts` directly.

---

### Task 1: Shared control-plane infrastructure (clock, ids, money, dates, event bus, DB handle + test harness)

Everything later tasks lean on: clock injection, UUIDs, centavo formatting, local-calendar date helpers, a typed app event bus (ledger commits → control features; payday events → goals), the DB-handle seam, and the better-sqlite3 test harness that runs the real foundation migrations.

**Files:**
- Create: `mobile/lib/clock.ts`, `mobile/lib/ids.ts`, `mobile/lib/money.ts`, `mobile/lib/dates.ts`, `mobile/lib/events/app_events.ts`, `mobile/lib/db/db_handle.ts`, `mobile/test/db_harness.ts`
- Modify: `mobile/package.json` (devDependencies)
- Test: `mobile/lib/__tests__/clock.test.ts`, `mobile/lib/__tests__/money.test.ts`, `mobile/lib/__tests__/dates.test.ts`, `mobile/lib/events/__tests__/app_events.test.ts`, `mobile/test/__tests__/db_harness.test.ts`

**Interfaces:**
- Consumes: `type Centavos = number` from `mobile/types/domain.ts` (foundation); `mobile/lib/db/database.ts` opener (foundation); `mobile/lib/db/migrations/*.sql` (foundation, read-only).
- Produces (all later tasks rely on these exact signatures):
  - `Clock = { now(): number }` · `systemClock: Clock` · `fixedClock(at: number): Clock`
  - `newId(): string` (UUIDv4)
  - `formatCentavos(c: Centavos): string` → `"₱1,234.56"`, negatives `"-₱12.00"`
  - `toDateIso(d: Date): string` · `parseDateIso(iso: string): Date` (local midnight) · `addDaysIso(iso: string, days: number): string` · `addMonthsClampedIso(iso: string, months: number): string` · `lastDayOfMonth(year: number, monthIndex: number): number` · `startOfLocalDay(ms: number): number` · `endOfLocalDay(ms: number): number` (start of next day) · `atLocalTime(iso: string, hour: number, minute: number): number`
  - `onAppEvent<K>(event: K, cb): () => void` · `emitAppEvent<K>(event, payload): Promise<void>` with event map `{ "ledger:committed": { transactionId: string }; "ledger:changed": { transactionId: string }; "income:payday": { transactionId: string; walletId: string; amount: Centavos; occurredAt: number } }`
  - `DbHandle` interface (`runAsync`, `getAllAsync`, `getFirstAsync`, `execAsync`) · `getDbHandle(): Promise<DbHandle>` · `setDbHandleForTests(h: DbHandle | null): void`
  - `createTestDb(): Promise<DbHandle>` (in-memory SQLite with the real schema applied)

**Steps:**

- [ ] Install the test-harness dependency. From `mobile/`:

  ```
  npm i -D better-sqlite3 @types/better-sqlite3
  ```

- [ ] Write failing tests for clock, money, and dates — `mobile/lib/__tests__/clock.test.ts`:

  ```ts
  import { fixedClock, systemClock } from "../clock";

  describe("clock", () => {
    it("fixedClock always returns the injected instant", () => {
      const at = new Date(2026, 5, 15, 12, 0).getTime(); // 2026-06-15 12:00 local
      const clock = fixedClock(at);
      expect(clock.now()).toBe(at);
      expect(clock.now()).toBe(at);
    });

    it("systemClock tracks real time", () => {
      const before = Date.now();
      const v = systemClock.now();
      expect(v).toBeGreaterThanOrEqual(before);
      expect(v).toBeLessThanOrEqual(Date.now());
    });
  });
  ```

  `mobile/lib/__tests__/money.test.ts`:

  ```ts
  import { formatCentavos } from "../money";

  describe("formatCentavos", () => {
    it.each([
      [0, "₱0.00"],
      [5, "₱0.05"],
      [123456, "₱1,234.56"],
      [100000000, "₱1,000,000.00"],
      [-1200, "-₱12.00"],
      [740000, "₱7,400.00"],
    ])("formats %i centavos as %s", (c, expected) => {
      expect(formatCentavos(c)).toBe(expected);
    });
  });
  ```

  `mobile/lib/__tests__/dates.test.ts`:

  ```ts
  import {
    addDaysIso, addMonthsClampedIso, atLocalTime, endOfLocalDay,
    lastDayOfMonth, parseDateIso, startOfLocalDay, toDateIso,
  } from "../dates";

  describe("dates", () => {
    it("round-trips iso through local Date", () => {
      expect(toDateIso(new Date(2026, 0, 31))).toBe("2026-01-31");
      const d = parseDateIso("2026-01-31");
      expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 31]);
      expect(d.getHours()).toBe(0);
    });

    it("adds days across month and year boundaries", () => {
      expect(addDaysIso("2026-01-30", 3)).toBe("2026-02-02");
      expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
      expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    });

    it("clamps month-end when adding months (never skips a month)", () => {
      expect(addMonthsClampedIso("2026-01-31", 1)).toBe("2026-02-28");
      expect(addMonthsClampedIso("2028-01-31", 1)).toBe("2028-02-29"); // leap year
      expect(addMonthsClampedIso("2026-01-31", 2)).toBe("2026-03-31");
      expect(addMonthsClampedIso("2026-10-31", 1)).toBe("2026-11-30");
    });

    it("knows month lengths", () => {
      expect(lastDayOfMonth(2026, 1)).toBe(28);
      expect(lastDayOfMonth(2028, 1)).toBe(29);
      expect(lastDayOfMonth(2026, 3)).toBe(30);
      expect(lastDayOfMonth(2026, 0)).toBe(31);
    });

    it("computes local-day bounds and wall-clock instants", () => {
      const noon = new Date(2026, 7, 2, 12, 34).getTime();
      expect(startOfLocalDay(noon)).toBe(new Date(2026, 7, 2, 0, 0).getTime());
      expect(endOfLocalDay(noon)).toBe(new Date(2026, 7, 3, 0, 0).getTime());
      expect(atLocalTime("2026-08-02", 9, 0)).toBe(new Date(2026, 7, 2, 9, 0).getTime());
    });
  });
  ```

- [ ] Run them (expected: FAIL — modules do not exist):

  ```
  npx jest --ci lib/__tests__/clock.test.ts lib/__tests__/money.test.ts lib/__tests__/dates.test.ts
  ```

- [ ] Implement `mobile/lib/clock.ts`:

  ```ts
  export type Clock = { now(): number };

  export const systemClock: Clock = { now: () => Date.now() };

  export function fixedClock(at: number): Clock {
    return { now: () => at };
  }
  ```

  `mobile/lib/ids.ts`:

  ```ts
  // UUIDv4. Node >= 19 (jest) and Hermes with expo-crypto installed both provide
  // crypto.randomUUID; expo-crypto polyfills it in the app runtime.
  export function newId(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    if (g.crypto?.randomUUID) return g.crypto.randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require("expo-crypto") as { randomUUID(): string }).randomUUID();
  }
  ```

  `mobile/lib/money.ts`:

  ```ts
  import type { Centavos } from "@/types/domain";

  export function formatCentavos(c: Centavos): string {
    const sign = c < 0 ? "-" : "";
    const abs = Math.abs(Math.round(c));
    const pesos = Math.floor(abs / 100);
    const centavos = String(abs % 100).padStart(2, "0");
    const withCommas = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}₱${withCommas}.${centavos}`;
  }
  ```

  `mobile/lib/dates.ts`:

  ```ts
  export function toDateIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  export function parseDateIso(iso: string): Date {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d); // local midnight
  }

  export function addDaysIso(iso: string, days: number): string {
    const d = parseDateIso(iso);
    d.setDate(d.getDate() + days);
    return toDateIso(d);
  }

  export function lastDayOfMonth(year: number, monthIndex: number): number {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  export function addMonthsClampedIso(iso: string, months: number): string {
    const d = parseDateIso(iso);
    const targetMonth = d.getMonth() + months;
    const y = d.getFullYear() + Math.floor(targetMonth / 12);
    const m = ((targetMonth % 12) + 12) % 12;
    const day = Math.min(d.getDate(), lastDayOfMonth(y, m));
    return toDateIso(new Date(y, m, day));
  }

  export function startOfLocalDay(ms: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  export function endOfLocalDay(ms: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }

  export function atLocalTime(iso: string, hour: number, minute: number): number {
    const d = parseDateIso(iso);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute).getTime();
  }
  ```

- [ ] Run again (expected: PASS):

  ```
  npx jest --ci lib/__tests__/clock.test.ts lib/__tests__/money.test.ts lib/__tests__/dates.test.ts
  ```

- [ ] Commit:

  ```
  git add mobile/lib/clock.ts mobile/lib/ids.ts mobile/lib/money.ts mobile/lib/dates.ts mobile/lib/__tests__ mobile/package.json mobile/package-lock.json
  git commit -m "feat(control): clock injection, ids, centavo formatting, local-date helpers"
  ```

- [ ] Write a failing test for the event bus — `mobile/lib/events/__tests__/app_events.test.ts`:

  ```ts
  import { emitAppEvent, onAppEvent } from "../app_events";

  describe("app_events", () => {
    it("delivers payloads to subscribers and supports unsubscribe", async () => {
      const seen: string[] = [];
      const off = onAppEvent("ledger:committed", (p) => {
        seen.push(p.transactionId);
      });
      await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
      off();
      await emitAppEvent("ledger:committed", { transactionId: "tx-2" });
      expect(seen).toEqual(["tx-1"]);
    });

    it("awaits async handlers sequentially so recomputes are deterministic", async () => {
      const order: number[] = [];
      const off1 = onAppEvent("income:payday", async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      });
      const off2 = onAppEvent("income:payday", () => {
        order.push(2);
      });
      await emitAppEvent("income:payday", {
        transactionId: "tx-9", walletId: "w-1", amount: 1850000,
        occurredAt: new Date(2026, 7, 15, 8, 0).getTime(),
      });
      expect(order).toEqual([1, 2]);
      off1(); off2();
    });

    it("one throwing handler does not stop the others", async () => {
      const seen: string[] = [];
      const off1 = onAppEvent("ledger:changed", () => { throw new Error("boom"); });
      const off2 = onAppEvent("ledger:changed", (p) => { seen.push(p.transactionId); });
      await emitAppEvent("ledger:changed", { transactionId: "tx-3" });
      expect(seen).toEqual(["tx-3"]);
      off1(); off2();
    });
  });
  ```

- [ ] Run it (expected: FAIL — module missing): `npx jest --ci lib/events/__tests__/app_events.test.ts`

- [ ] Implement `mobile/lib/events/app_events.ts`:

  ```ts
  import type { Centavos } from "@/types/domain";

  export type AppEventMap = {
    "ledger:committed": { transactionId: string };
    "ledger:changed": { transactionId: string }; // edit/delete/recategorize/transfer-link
    "income:payday": {
      transactionId: string; walletId: string; amount: Centavos; occurredAt: number;
    };
  };

  type Handler<K extends keyof AppEventMap> = (payload: AppEventMap[K]) => void | Promise<void>;

  const registry = new Map<keyof AppEventMap, Set<Handler<never>>>();

  export function onAppEvent<K extends keyof AppEventMap>(event: K, cb: Handler<K>): () => void {
    let set = registry.get(event);
    if (!set) {
      set = new Set();
      registry.set(event, set);
    }
    set.add(cb as Handler<never>);
    return () => set!.delete(cb as Handler<never>);
  }

  export async function emitAppEvent<K extends keyof AppEventMap>(
    event: K, payload: AppEventMap[K],
  ): Promise<void> {
    const set = registry.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        await (cb as Handler<K>)(payload);
      } catch (e) {
        console.warn(`[app_events] handler for ${String(event)} failed:`, e);
      }
    }
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci lib/events/__tests__/app_events.test.ts`

- [ ] Commit:

  ```
  git add mobile/lib/events
  git commit -m "feat(control): typed app event bus for ledger commits and payday events"
  ```

- [ ] Write a failing test for the DB seam + harness — `mobile/test/__tests__/db_harness.test.ts`:

  ```ts
  /** @jest-environment node */
  import { createTestDb } from "../db_harness";
  import { getDbHandle, setDbHandleForTests } from "@/lib/db/db_handle";

  describe("db_harness", () => {
    afterEach(() => setDbHandleForTests(null));

    it("applies the real foundation migrations to an in-memory db", async () => {
      const db = await createTestDb();
      const tables = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      );
      const names = tables.map((t) => t.name);
      for (const required of [
        "wallets", "transactions", "categories", "limits", "income_profiles",
        "income_profile_sources", "goals", "loans", "loan_payments", "bills",
        "bill_payments", "recurring_patterns", "user_rules", "app_settings",
      ]) {
        expect(names).toContain(required);
      }
    });

    it("getDbHandle returns the injected test handle", async () => {
      const db = await createTestDb();
      setDbHandleForTests(db);
      const h = await getDbHandle();
      await h.runAsync("INSERT INTO app_settings (key, value) VALUES (?, ?)", ["k1", "v1"]);
      const row = await h.getFirstAsync<{ value: string }>(
        "SELECT value FROM app_settings WHERE key = ?", ["k1"],
      );
      expect(row?.value).toBe("v1");
    });
  });
  ```

- [ ] Run it (expected: FAIL — modules missing): `npx jest --ci test/__tests__/db_harness.test.ts`

- [ ] Implement `mobile/lib/db/db_handle.ts`:

  ```ts
  // The ONLY module in M2 that touches foundation's database.ts.
  // If foundation's opener has a different exported name, change this import line only.
  import { getDatabase } from "./database";

  export type DbHandle = {
    runAsync(sql: string, params?: unknown[]): Promise<void>;
    getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
    getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
    execAsync(sql: string): Promise<void>;
  };

  let override: DbHandle | null = null;

  export function setDbHandleForTests(h: DbHandle | null): void {
    override = h;
  }

  export async function getDbHandle(): Promise<DbHandle> {
    if (override) return override;
    // expo-sqlite's SQLiteDatabase implements this exact async surface.
    return (await getDatabase()) as unknown as DbHandle;
  }
  ```

  Implement `mobile/test/db_harness.ts`:

  ```ts
  import fs from "fs";
  import path from "path";
  import Database from "better-sqlite3";
  import type { DbHandle } from "@/lib/db/db_handle";

  /** In-memory SQLite with the REAL foundation migrations applied, wrapped in DbHandle. */
  export async function createTestDb(): Promise<DbHandle> {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const dir = path.join(__dirname, "..", "lib", "db", "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    }
    return {
      async runAsync(sql, params = []) { db.prepare(sql).run(...(params as unknown[])); },
      async getAllAsync<T>(sql: string, params: unknown[] = []) {
        return db.prepare(sql).all(...(params as unknown[])) as T[];
      },
      async getFirstAsync<T>(sql: string, params: unknown[] = []) {
        return (db.prepare(sql).get(...(params as unknown[])) ?? null) as T | null;
      },
      async execAsync(sql) { db.exec(sql); },
    };
  }
  ```

- [ ] Run again (expected: PASS — if a required table is missing, STOP per the Schema dependency note): `npx jest --ci test/__tests__/db_harness.test.ts`

- [ ] Commit:

  ```
  git add mobile/lib/db/db_handle.ts mobile/test
  git commit -m "feat(control): db handle seam and better-sqlite3 test harness over real migrations"
  ```

---

### Task 2: Alerts infrastructure — expo-notifications channels + service

One service for every M2 notification: limit threshold alerts (immediate), loan/bill reminders (scheduled). Sets up the two Android notification channels and degrades gracefully when POST_NOTIFICATIONS is denied (specs: limits rule 24, loans rule 15, bills rule 12 — events still surface in-app; only the system notification is lost).

**Files:**
- Create: `mobile/lib/alerts/channels.ts`, `mobile/lib/alerts/alerts_service.ts`
- Test: `mobile/lib/alerts/__tests__/alerts_service.test.ts`

**Interfaces:**
- Consumes: `expo-notifications` (already in the Expo SDK per STACK_BASIS §1; if not yet in `mobile/package.json`, run `npx expo install expo-notifications` in this task).
- Produces:
  - `CHANNEL_LIMITS = "limits"` · `CHANNEL_REMINDERS = "reminders"` (Android channel ids)
  - `ensureNotificationChannels(): Promise<void>`
  - `requestAlertPermission(): Promise<boolean>`
  - `postAlert(input: { channel: "limits" | "reminders"; title: string; body: string; data?: Record<string, unknown> }): Promise<string | null>` — immediate local notification; `null` when permission denied (caller keeps in-app surfaces regardless)
  - `scheduleReminder(input: { channel: "reminders"; title: string; body: string; fireAt: number; data?: Record<string, unknown> }): Promise<string | null>` — returns the OS notification identifier
  - `cancelScheduled(identifier: string): Promise<void>`

**Steps:**

- [ ] Ensure the dependency exists. From `mobile/`:

  ```
  npx expo install expo-notifications
  ```

- [ ] Write the failing test — `mobile/lib/alerts/__tests__/alerts_service.test.ts`:

  ```ts
  const mockNotifications = {
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    scheduleNotificationAsync: jest.fn().mockResolvedValue("os-id-1"),
    cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
    AndroidImportance: { DEFAULT: 3, HIGH: 4 },
    SchedulableTriggerInputTypes: { DATE: "date" },
  };
  jest.mock("expo-notifications", () => mockNotifications);
  jest.mock("react-native", () => ({ Platform: { OS: "android" } }));

  import {
    cancelScheduled, ensureNotificationChannels, postAlert, requestAlertPermission,
    scheduleReminder,
  } from "../alerts_service";
  import { CHANNEL_LIMITS, CHANNEL_REMINDERS } from "../channels";

  describe("alerts_service", () => {
    beforeEach(() => jest.clearAllMocks());

    it("creates both android channels", async () => {
      await ensureNotificationChannels();
      const ids = mockNotifications.setNotificationChannelAsync.mock.calls.map((c) => c[0]);
      expect(ids).toEqual(expect.arrayContaining([CHANNEL_LIMITS, CHANNEL_REMINDERS]));
    });

    it("posts an immediate alert on the requested channel when permission granted", async () => {
      const id = await postAlert({
        channel: "limits", title: "Heads up", body: "80% used", data: { limitId: "l1" },
      });
      expect(id).toBe("os-id-1");
      const call = mockNotifications.scheduleNotificationAsync.mock.calls[0][0];
      expect(call.trigger).toBeNull();
      expect(call.content.title).toBe("Heads up");
      expect(call.content.data).toEqual({ limitId: "l1" });
    });

    it("returns null instead of posting when permission is denied", async () => {
      mockNotifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false });
      const id = await postAlert({ channel: "limits", title: "t", body: "b" });
      expect(id).toBeNull();
      expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it("schedules a dated reminder and can cancel it", async () => {
      const fireAt = new Date(2026, 7, 17, 9, 0).getTime();
      const id = await scheduleReminder({
        channel: "reminders", title: "GLoan due", body: "₱2,450.00 in 3 days", fireAt,
      });
      expect(id).toBe("os-id-1");
      const call = mockNotifications.scheduleNotificationAsync.mock.calls[0][0];
      expect(call.trigger).toEqual({ type: "date", date: new Date(fireAt) });
      await cancelScheduled("os-id-1");
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("os-id-1");
    });

    it("requestAlertPermission returns the OS answer", async () => {
      mockNotifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
      await expect(requestAlertPermission()).resolves.toBe(false);
    });
  });
  ```

- [ ] Run it (expected: FAIL — modules missing): `npx jest --ci lib/alerts/__tests__/alerts_service.test.ts`

- [ ] Implement `mobile/lib/alerts/channels.ts`:

  ```ts
  export const CHANNEL_LIMITS = "limits";
  export const CHANNEL_REMINDERS = "reminders";
  ```

  Implement `mobile/lib/alerts/alerts_service.ts`:

  ```ts
  import * as Notifications from "expo-notifications";
  import { Platform } from "react-native";
  import { CHANNEL_LIMITS, CHANNEL_REMINDERS } from "./channels";

  export async function ensureNotificationChannels(): Promise<void> {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync(CHANNEL_LIMITS, {
      name: "Limit alerts",
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS, {
      name: "Due-date reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  export async function requestAlertPermission(): Promise<boolean> {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  }

  async function hasPermission(): Promise<boolean> {
    return (await Notifications.getPermissionsAsync()).granted;
  }

  export async function postAlert(input: {
    channel: "limits" | "reminders"; title: string; body: string;
    data?: Record<string, unknown>;
  }): Promise<string | null> {
    if (!(await hasPermission())) return null; // in-app surfaces still show; only the system notif is lost
    return Notifications.scheduleNotificationAsync({
      content: {
        title: input.title, body: input.body, data: input.data ?? {},
        ...(Platform.OS === "android" ? { channelId: input.channel } : {}),
      },
      trigger: null,
    });
  }

  export async function scheduleReminder(input: {
    channel: "reminders"; title: string; body: string; fireAt: number;
    data?: Record<string, unknown>;
  }): Promise<string | null> {
    if (!(await hasPermission())) return null;
    return Notifications.scheduleNotificationAsync({
      content: {
        title: input.title, body: input.body, data: input.data ?? {},
        ...(Platform.OS === "android" ? { channelId: input.channel } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(input.fireAt),
      },
    });
  }

  export async function cancelScheduled(identifier: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci lib/alerts/__tests__/alerts_service.test.ts`

- [ ] Commit:

  ```
  git add mobile/lib/alerts mobile/package.json mobile/package-lock.json
  git commit -m "feat(alerts): notification channels and local alert/reminder service"
  ```

---

### Task 3: Limits repository — CRUD + per-period alert state

`limits_repo.ts` maps the `limits` table (snake_case columns ↔ camelCase fields). The `thresholds_fired` TEXT column stores the per-period alert state as JSON — `{ periodStart, base, carryover, fired[], muted, lastSpend }` — which is exactly the state the engine (Tasks 5–7) needs to make thresholds single-fire and rollover non-compounding.

**Files:**
- Create: `mobile/lib/db/repos/limits_repo.ts`, `mobile/types/control.ts`
- Test: `mobile/lib/db/repos/__tests__/limits_repo.test.ts`

**Interfaces:**
- Consumes: `DbHandle`/`getDbHandle`/`setDbHandleForTests` (Task 1), `createTestDb` (Task 1), `newId` (Task 1), `Limit`, `Centavos` from `mobile/types/domain.ts` (foundation; shape is the camelCase mirror of the `limits` columns per docs/02-domain-model.md §3.5 — if foundation's `Limit` type differs in a field name, adapt the mapping row in this repo only).
- Produces:
  - `type LimitScope = "daily" | "weekly" | "monthly" | "annual"` · `type LimitBasis = "fixed" | "percent-of-income"` · `type Threshold = 50 | 80 | 100` (in `mobile/types/control.ts`)
  - `type LimitAlertState = { periodStart: number; base: Centavos; carryover: Centavos; fired: Threshold[]; muted: boolean; lastSpend: Centavos }`
  - `type NewLimit = { scope: LimitScope; basis: LimitBasis; value: number; categoryFilter?: string[] | null; walletFilter?: string[] | null; rollover?: boolean; isActive?: boolean }` (`value` = centavos for `fixed`, whole percent 0–100 for `percent-of-income`)
  - `createLimit(input: NewLimit): Promise<Limit>` · `getLimit(id: string): Promise<Limit | null>` · `listLimits(opts?: { activeOnly?: boolean }): Promise<Limit[]>` · `updateLimit(id: string, patch: Partial<NewLimit>): Promise<Limit>` · `deleteLimit(id: string): Promise<void>`
  - `getLimitAlertState(limitId: string): Promise<LimitAlertState | null>` · `setLimitAlertState(limitId: string, state: LimitAlertState): Promise<void>`

**Steps:**

- [ ] Write the failing test — `mobile/lib/db/repos/__tests__/limits_repo.test.ts`:

  ```ts
  /** @jest-environment node */
  import { createTestDb } from "@/test/db_harness";
  import { setDbHandleForTests } from "@/lib/db/db_handle";
  import {
    createLimit, deleteLimit, getLimit, getLimitAlertState, listLimits,
    setLimitAlertState, updateLimit,
  } from "../limits_repo";

  describe("limits_repo", () => {
    beforeEach(async () => setDbHandleForTests(await createTestDb()));
    afterEach(() => setDbHandleForTests(null));

    it("creates and reads a fixed monthly limit with defaults", async () => {
      const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
      expect(limit.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(limit.scope).toBe("monthly");
      expect(limit.basis).toBe("fixed");
      expect(limit.value).toBe(800000); // ₱8,000.00 in centavos
      expect(limit.categoryFilter).toBeNull();
      expect(limit.walletFilter).toBeNull();
      expect(limit.rollover).toBe(false);
      expect(limit.isActive).toBe(true);
      expect(await getLimit(limit.id)).toEqual(limit);
    });

    it("round-trips filters as JSON arrays", async () => {
      const limit = await createLimit({
        scope: "weekly", basis: "fixed", value: 150000,
        categoryFilter: ["cat-food"], walletFilter: ["w-gcash"], rollover: true,
      });
      const read = await getLimit(limit.id);
      expect(read?.categoryFilter).toEqual(["cat-food"]);
      expect(read?.walletFilter).toEqual(["w-gcash"]);
      expect(read?.rollover).toBe(true);
    });

    it("lists limits, optionally active-only", async () => {
      await createLimit({ scope: "daily", basis: "fixed", value: 50000 });
      const inactive = await createLimit({ scope: "monthly", basis: "fixed", value: 800000, isActive: false });
      expect((await listLimits()).length).toBe(2);
      const active = await listLimits({ activeOnly: true });
      expect(active.length).toBe(1);
      expect(active[0].id).not.toBe(inactive.id);
    });

    it("updates fields and bumps updatedAt", async () => {
      const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
      const updated = await updateLimit(limit.id, { value: 900000, rollover: true });
      expect(updated.value).toBe(900000);
      expect(updated.rollover).toBe(true);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(limit.updatedAt);
    });

    it("deletes a limit", async () => {
      const limit = await createLimit({ scope: "annual", basis: "fixed", value: 12000000 });
      await deleteLimit(limit.id);
      expect(await getLimit(limit.id)).toBeNull();
    });

    it("stores and reads per-period alert state; null before first evaluation", async () => {
      const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
      expect(await getLimitAlertState(limit.id)).toBeNull();
      const state = {
        periodStart: new Date(2026, 7, 1).getTime(), base: 800000, carryover: 300000,
        fired: [50, 80] as (50 | 80 | 100)[], muted: false, lastSpend: 650000,
      };
      await setLimitAlertState(limit.id, state);
      expect(await getLimitAlertState(limit.id)).toEqual(state);
    });
  });
  ```

- [ ] Run it (expected: FAIL — `limits_repo` missing): `npx jest --ci lib/db/repos/__tests__/limits_repo.test.ts`

- [ ] Implement `mobile/types/control.ts`:

  ```ts
  import type { Centavos } from "./domain";

  export type LimitScope = "daily" | "weekly" | "monthly" | "annual";
  export type LimitBasis = "fixed" | "percent-of-income";
  export type Threshold = 50 | 80 | 100;

  export type LimitAlertState = {
    periodStart: number;      // epoch ms, local period start this state belongs to
    base: Centavos;           // peso base snapshotted at period start (limits rule 11)
    carryover: Centavos;      // rollover carryover for this period (limits rule 14)
    fired: Threshold[];       // thresholds fired this period — never re-arm (rule 20)
    muted: boolean;           // "mute for this period" (rule 25)
    lastSpend: Centavos;      // spend at last evaluation; prevSpend for crossing detection
  };
  ```

  Implement `mobile/lib/db/repos/limits_repo.ts`:

  ```ts
  import type { Limit } from "@/types/domain";
  import type { LimitAlertState, LimitBasis, LimitScope } from "@/types/control";
  import { getDbHandle } from "../db_handle";
  import { newId } from "@/lib/ids";

  export type NewLimit = {
    scope: LimitScope; basis: LimitBasis; value: number;
    categoryFilter?: string[] | null; walletFilter?: string[] | null;
    rollover?: boolean; isActive?: boolean;
  };

  type LimitRow = {
    id: string; scope: LimitScope; basis: LimitBasis; value: number;
    category_filter: string | null; wallet_filter: string | null;
    rollover: number; is_active: number; thresholds_fired: string | null;
    created_at: number; updated_at: number;
  };

  function rowToLimit(r: LimitRow): Limit {
    return {
      id: r.id, scope: r.scope, basis: r.basis, value: r.value,
      categoryFilter: r.category_filter ? (JSON.parse(r.category_filter) as string[]) : null,
      walletFilter: r.wallet_filter ? (JSON.parse(r.wallet_filter) as string[]) : null,
      rollover: r.rollover === 1, isActive: r.is_active === 1,
      createdAt: r.created_at, updatedAt: r.updated_at,
    } as Limit;
  }

  export async function createLimit(input: NewLimit): Promise<Limit> {
    const db = await getDbHandle();
    const now = Date.now();
    const id = newId();
    await db.runAsync(
      `INSERT INTO limits (id, scope, basis, value, category_filter, wallet_filter,
                           rollover, is_active, thresholds_fired, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        id, input.scope, input.basis, input.value,
        input.categoryFilter?.length ? JSON.stringify(input.categoryFilter) : null,
        input.walletFilter?.length ? JSON.stringify(input.walletFilter) : null,
        input.rollover ? 1 : 0, input.isActive === false ? 0 : 1, now, now,
      ],
    );
    return (await getLimit(id))!;
  }

  export async function getLimit(id: string): Promise<Limit | null> {
    const db = await getDbHandle();
    const row = await db.getFirstAsync<LimitRow>("SELECT * FROM limits WHERE id = ?", [id]);
    return row ? rowToLimit(row) : null;
  }

  export async function listLimits(opts?: { activeOnly?: boolean }): Promise<Limit[]> {
    const db = await getDbHandle();
    const rows = await db.getAllAsync<LimitRow>(
      opts?.activeOnly
        ? "SELECT * FROM limits WHERE is_active = 1 ORDER BY created_at"
        : "SELECT * FROM limits ORDER BY created_at",
    );
    return rows.map(rowToLimit);
  }

  export async function updateLimit(id: string, patch: Partial<NewLimit>): Promise<Limit> {
    const db = await getDbHandle();
    const current = await getLimit(id);
    if (!current) throw new Error(`limit not found: ${id}`);
    const merged = {
      scope: patch.scope ?? current.scope,
      basis: patch.basis ?? current.basis,
      value: patch.value ?? current.value,
      categoryFilter: patch.categoryFilter !== undefined ? patch.categoryFilter : current.categoryFilter,
      walletFilter: patch.walletFilter !== undefined ? patch.walletFilter : current.walletFilter,
      rollover: patch.rollover ?? current.rollover,
      isActive: patch.isActive ?? current.isActive,
    };
    await db.runAsync(
      `UPDATE limits SET scope=?, basis=?, value=?, category_filter=?, wallet_filter=?,
                         rollover=?, is_active=?, updated_at=? WHERE id=?`,
      [
        merged.scope, merged.basis, merged.value,
        merged.categoryFilter?.length ? JSON.stringify(merged.categoryFilter) : null,
        merged.walletFilter?.length ? JSON.stringify(merged.walletFilter) : null,
        merged.rollover ? 1 : 0, merged.isActive ? 1 : 0, Date.now(), id,
      ],
    );
    return (await getLimit(id))!;
  }

  export async function deleteLimit(id: string): Promise<void> {
    const db = await getDbHandle();
    await db.runAsync("DELETE FROM limits WHERE id = ?", [id]);
  }

  export async function getLimitAlertState(limitId: string): Promise<LimitAlertState | null> {
    const db = await getDbHandle();
    const row = await db.getFirstAsync<{ thresholds_fired: string | null }>(
      "SELECT thresholds_fired FROM limits WHERE id = ?", [limitId],
    );
    if (!row?.thresholds_fired) return null;
    return JSON.parse(row.thresholds_fired) as LimitAlertState;
  }

  export async function setLimitAlertState(limitId: string, state: LimitAlertState): Promise<void> {
    const db = await getDbHandle();
    await db.runAsync(
      "UPDATE limits SET thresholds_fired = ? WHERE id = ?",
      [JSON.stringify(state), limitId],
    );
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci lib/db/repos/__tests__/limits_repo.test.ts`

- [ ] Commit:

  ```
  git add mobile/lib/db/repos/limits_repo.ts mobile/types/control.ts mobile/lib/db/repos/__tests__/limits_repo.test.ts
  git commit -m "feat(limits): limits repository with JSON filters and per-period alert state"
  ```

---

### Task 4: Limit engine — period windows (daily/weekly/monthly/annual)

Pure period math per limits rule 1: daily = local midnight→midnight; weekly = Monday 00:00 → next Monday 00:00; monthly = 1st → 1st; annual = Jan 1 → Jan 1. `end` is EXCLUSIVE (start of the next period) so it plugs straight into `transactions_repo.sumSpend({ from, to })`. Short months (Feb, 30-day) fall out of the calendar anchoring naturally — tests pin them.

**Files:**
- Create: `mobile/lib/limits/limit_engine.ts`
- Test: `mobile/lib/limits/__tests__/limit_engine_period.test.ts`

**Interfaces:**
- Consumes: `LimitScope` (Task 3).
- Produces (Tasks 5–7, 14, and M3's Safe-to-Spend rely on these):
  - `type PeriodWindow = { start: number; end: number; daysTotal: number; daysLeft: number }`
  - `periodWindowFor(scope: LimitScope, at: number): PeriodWindow`
  - `previousPeriodWindow(scope: LimitScope, at: number): PeriodWindow`

**Steps:**

- [ ] Write the failing test — `mobile/lib/limits/__tests__/limit_engine_period.test.ts`:

  ```ts
  import { periodWindowFor, previousPeriodWindow } from "../limit_engine";

  const ms = (y: number, m: number, d: number, hh = 0, mm = 0) =>
    new Date(y, m, d, hh, mm).getTime();

  describe("periodWindowFor", () => {
    it("daily: midnight to midnight, local", () => {
      const w = periodWindowFor("daily", ms(2026, 7, 2, 15, 30)); // Aug 2 2026, 3:30 PM
      expect(w.start).toBe(ms(2026, 7, 2));
      expect(w.end).toBe(ms(2026, 7, 3));
      expect(w.daysTotal).toBe(1);
      expect(w.daysLeft).toBe(1); // partial day counts as a remaining day
    });

    it("weekly: Monday 00:00 through next Monday 00:00", () => {
      // Aug 2 2026 is a Sunday → week is Mon Jul 27 .. Mon Aug 3
      const w = periodWindowFor("weekly", ms(2026, 7, 2, 9, 0));
      expect(w.start).toBe(ms(2026, 6, 27));
      expect(w.end).toBe(ms(2026, 7, 3));
      expect(w.daysTotal).toBe(7);
      expect(w.daysLeft).toBe(1);
      // A Monday belongs to the week it starts
      const mon = periodWindowFor("weekly", ms(2026, 7, 3, 0, 0));
      expect(mon.start).toBe(ms(2026, 7, 3));
      expect(mon.daysLeft).toBe(7);
    });

    it("monthly: 1st through 1st, including short months", () => {
      const aug = periodWindowFor("monthly", ms(2026, 7, 15));
      expect(aug.start).toBe(ms(2026, 7, 1));
      expect(aug.end).toBe(ms(2026, 8, 1));
      expect(aug.daysTotal).toBe(31);
      expect(aug.daysLeft).toBe(17); // Aug 15..31 inclusive
      const feb = periodWindowFor("monthly", ms(2026, 1, 10));
      expect(feb.daysTotal).toBe(28);
      const febLeap = periodWindowFor("monthly", ms(2028, 1, 10));
      expect(febLeap.daysTotal).toBe(29);
    });

    it("annual: Jan 1 through Jan 1", () => {
      const w = periodWindowFor("annual", ms(2026, 7, 2));
      expect(w.start).toBe(ms(2026, 0, 1));
      expect(w.end).toBe(ms(2027, 0, 1));
      expect(w.daysTotal).toBe(365);
      const leap = periodWindowFor("annual", ms(2028, 5, 1));
      expect(leap.daysTotal).toBe(366);
    });
  });

  describe("previousPeriodWindow", () => {
    it("monthly previous from March 31 is the full February window", () => {
      const w = previousPeriodWindow("monthly", ms(2026, 2, 31));
      expect(w.start).toBe(ms(2026, 1, 1));
      expect(w.end).toBe(ms(2026, 2, 1));
      expect(w.daysTotal).toBe(28);
    });

    it("weekly previous crosses a month boundary correctly", () => {
      // current week starts Mon Aug 3 2026 → previous: Mon Jul 27 .. Mon Aug 3
      const w = previousPeriodWindow("weekly", ms(2026, 7, 4));
      expect(w.start).toBe(ms(2026, 6, 27));
      expect(w.end).toBe(ms(2026, 7, 3));
    });

    it("daily previous from March 1 is the last day of February", () => {
      const w = previousPeriodWindow("daily", ms(2026, 2, 1, 8, 0));
      expect(w.start).toBe(ms(2026, 1, 28));
      expect(w.end).toBe(ms(2026, 2, 1));
    });

    it("annual previous from 2026 is all of 2025", () => {
      const w = previousPeriodWindow("annual", ms(2026, 0, 1));
      expect(w.start).toBe(ms(2025, 0, 1));
      expect(w.end).toBe(ms(2026, 0, 1));
    });
  });
  ```

- [ ] Run it (expected: FAIL — `limit_engine` missing): `npx jest --ci lib/limits/__tests__/limit_engine_period.test.ts`

- [ ] Implement the period section of `mobile/lib/limits/limit_engine.ts`:

  ```ts
  import type { LimitScope } from "@/types/control";

  export type PeriodWindow = {
    start: number;      // epoch ms, inclusive
    end: number;        // epoch ms, EXCLUSIVE (start of next period) — feeds sumSpend {from, to}
    daysTotal: number;
    daysLeft: number;   // remaining days including the current partial day
  };

  const DAY_MS = 86_400_000;

  function windowFromDates(startD: Date, endD: Date, at: number): PeriodWindow {
    const start = startD.getTime();
    const end = endD.getTime();
    return {
      start, end,
      daysTotal: Math.round((end - start) / DAY_MS),
      daysLeft: Math.ceil((end - at) / DAY_MS),
    };
  }

  export function periodWindowFor(scope: LimitScope, at: number): PeriodWindow {
    const d = new Date(at);
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    switch (scope) {
      case "daily":
        return windowFromDates(new Date(y, m, day), new Date(y, m, day + 1), at);
      case "weekly": {
        const sinceMonday = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6 (limits rule 1)
        return windowFromDates(
          new Date(y, m, day - sinceMonday), new Date(y, m, day - sinceMonday + 7), at,
        );
      }
      case "monthly":
        return windowFromDates(new Date(y, m, 1), new Date(y, m + 1, 1), at);
      case "annual":
        return windowFromDates(new Date(y, 0, 1), new Date(y + 1, 0, 1), at);
    }
  }

  export function previousPeriodWindow(scope: LimitScope, at: number): PeriodWindow {
    const current = periodWindowFor(scope, at);
    const justBefore = current.start - 1;
    const prev = periodWindowFor(scope, justBefore);
    return { ...prev, daysLeft: 0 };
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci lib/limits/__tests__/limit_engine_period.test.ts`

- [ ] Commit:

  ```
  git add mobile/lib/limits
  git commit -m "feat(limits): period window math for all four scopes with local-time anchoring"
  ```

---

### Task 5: Limit engine — basis resolution and rollover

Two pure pieces of `limit_engine.ts`. **Basis** (limits rules 9–12): fixed → `value` is the peso base; percent-of-income → derive the peso base from monthly-equivalent income M, ROUND DOWN to the whole peso, and return `null` (paused) when M is unknown — income is never silently ₱0.00. **Rollover** (rules 14–17): `carryover(N) = clamp(base(N−1) − spend(N−1), 0, base(N))` — computed from the previous period's BASE (never its effective limit), so carryover can never compound; a breached period contributes zero; there is no negative rollover.

**Files:**
- Modify: `mobile/lib/limits/limit_engine.ts`
- Test: `mobile/lib/limits/__tests__/limit_engine_basis.test.ts`

**Interfaces:**
- Consumes: `LimitScope`, `LimitBasis` (Task 3); `Centavos`.
- Produces:
  - `baseFor(args: { basis: LimitBasis; value: number; scope: LimitScope }, monthlyIncome: Centavos | null): Centavos | null` — `null` means "Paused — income unknown"
  - `carryoverFor(args: { rollover: boolean; prevBase: Centavos; prevSpend: Centavos; base: Centavos }): Centavos`
  - `effectiveLimitFor(base: Centavos, carryover: Centavos): Centavos`

**Steps:**

- [ ] Write the failing test — `mobile/lib/limits/__tests__/limit_engine_basis.test.ts`:

  ```ts
  import { baseFor, carryoverFor, effectiveLimitFor } from "../limit_engine";

  const M = 3_700_000; // ₱37,000.00 monthly-equivalent income, in centavos

  describe("baseFor", () => {
    it("fixed basis: base equals value for every scope", () => {
      for (const scope of ["daily", "weekly", "monthly", "annual"] as const) {
        expect(baseFor({ basis: "fixed", value: 800000, scope }, null)).toBe(800000);
      }
    });

    // Acceptance criterion (limits): M = ₱37,000.00, value = 20 →
    // monthly ₱7,400.00, weekly ₱1,707.00, daily ₱243.00 (round-down verified)
    it.each([
      ["monthly", 740000],   // 37,000 × 20% = ₱7,400.00
      ["annual", 8880000],   // 12M × 20% = ₱88,800.00
      ["weekly", 170700],    // (12M ÷ 52) × 20% = ₱1,707.69… → floor ₱1,707.00
      ["daily", 24300],      // (12M ÷ 365) × 20% = ₱243.28… → floor ₱243.00
    ] as const)("percent basis, %s scope → %i centavos", (scope, expected) => {
      expect(baseFor({ basis: "percent-of-income", value: 20, scope }, M)).toBe(expected);
    });

    it("percent basis with unknown income is PAUSED (null), never ₱0.00", () => {
      expect(baseFor({ basis: "percent-of-income", value: 20, scope: "monthly" }, null)).toBeNull();
    });
  });

  describe("carryoverFor (rule 14: clamp(prevBase − prevSpend, 0, base))", () => {
    const base = 800000; // ₱8,000.00 monthly

    it("carries unused headroom: spend ₱5,000 of ₱8,000 → ₱3,000 carryover", () => {
      expect(carryoverFor({ rollover: true, prevBase: base, prevSpend: 500000, base })).toBe(300000);
      expect(effectiveLimitFor(base, 300000)).toBe(1100000); // July effective ₱11,000.00
    });

    it("caps at one full base: zero spend → carryover = base, effective ₱16,000", () => {
      expect(carryoverFor({ rollover: true, prevBase: base, prevSpend: 0, base })).toBe(800000);
      expect(effectiveLimitFor(base, 800000)).toBe(1600000);
    });

    it("never compounds: carryover derives from prev BASE even after a maxed-out prior period", () => {
      // July had effective ₱16,000 (base 8,000 + carry 8,000) and spend ₱0 —
      // August's carryover is still clamped to prevBase − prevSpend vs base: ₱8,000 max.
      const augustCarry = carryoverFor({ rollover: true, prevBase: base, prevSpend: 0, base });
      expect(augustCarry).toBe(800000); // NOT 1,600,000
    });

    it("a breached period contributes zero (no negative rollover)", () => {
      expect(carryoverFor({ rollover: true, prevBase: base, prevSpend: 900000, base })).toBe(0);
    });

    it("rollover off → always zero", () => {
      expect(carryoverFor({ rollover: false, prevBase: base, prevSpend: 0, base })).toBe(0);
    });

    it("clamps to the CURRENT base when bases differ (percent-of-income drift)", () => {
      // prev base ₱8,000 with ₱1,000 spent → headroom ₱7,000, but current base ₱6,000 → clamp ₱6,000
      expect(carryoverFor({ rollover: true, prevBase: 800000, prevSpend: 100000, base: 600000 })).toBe(600000);
    });
  });
  ```

- [ ] Run it (expected: FAIL — functions missing): `npx jest --ci lib/limits/__tests__/limit_engine_basis.test.ts`

- [ ] Append to `mobile/lib/limits/limit_engine.ts` (keep the Task 4 code; add imports for `Centavos` and `LimitBasis`):

  ```ts
  import type { Centavos } from "@/types/domain";
  import type { LimitBasis } from "@/types/control";

  /** Round DOWN to the nearest whole peso (limits rule 10 — conservative). */
  function floorToPeso(c: number): Centavos {
    return Math.floor(c / 100) * 100;
  }

  /**
   * Peso base for a period. Fixed → value (already centavos).
   * Percent-of-income → derived from monthly-equivalent income M (limits rule 10):
   *   monthly = M × v%, annual = 12M × v%, weekly = (12M ÷ 52) × v%, daily = (12M ÷ 365) × v%.
   * Returns null when the limit is percent-based and M is unknown → "Paused — income unknown"
   * (rule 12). Income is NEVER treated as ₱0.00.
   */
  export function baseFor(
    args: { basis: LimitBasis; value: number; scope: LimitScope },
    monthlyIncome: Centavos | null,
  ): Centavos | null {
    if (args.basis === "fixed") return args.value;
    if (monthlyIncome === null) return null;
    const pct = args.value / 100;
    const annualIncome = 12 * monthlyIncome;
    switch (args.scope) {
      case "monthly": return floorToPeso(monthlyIncome * pct);
      case "annual":  return floorToPeso(annualIncome * pct);
      case "weekly":  return floorToPeso((annualIncome / 52) * pct);
      case "daily":   return floorToPeso((annualIncome / 365) * pct);
    }
  }

  /**
   * Rollover rule 14 — EXACTLY: carryover(N) = clamp(base(N−1) − spend(N−1), 0, base(N)).
   * Uses the previous period's BASE, never its effective limit → non-compounding (rule 16).
   * Breached previous period → 0 (rule 17). Expires after one period by construction.
   */
  export function carryoverFor(args: {
    rollover: boolean; prevBase: Centavos; prevSpend: Centavos; base: Centavos;
  }): Centavos {
    if (!args.rollover) return 0;
    const headroom = args.prevBase - args.prevSpend;
    return Math.max(0, Math.min(headroom, args.base));
  }

  /** effectiveLimit(N) = base(N) + carryover(N) (rule 15). */
  export function effectiveLimitFor(base: Centavos, carryover: Centavos): Centavos {
    return base + carryover;
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci lib/limits/__tests__/limit_engine_basis.test.ts`

- [ ] Commit:

  ```
  git add mobile/lib/limits
  git commit -m "feat(limits): percent-of-income basis with round-down and non-compounding rollover"
  ```

---

### Task 6: Limit engine — threshold evaluation and alert coalescing

Pure alert logic per limits rules 19–23: a threshold fires when spend crosses from below to at-or-above `threshold% × effectiveLimit`; each fires at most once per period; a single commit crossing several thresholds fires only the highest; after 100% has fired, that limit is silent for the rest of the period; one commit tripping several limits coalesces into ONE notification ordered most-severe first. Also the category-filter descendant expansion helper (rule 3).

**Files:**
- Modify: `mobile/lib/limits/limit_engine.ts`
- Test: `mobile/lib/limits/__tests__/limit_engine_thresholds.test.ts`

**Interfaces:**
- Consumes: `Threshold` (Task 3), `formatCentavos` (Task 1).
- Produces:
  - `crossedThreshold(args: { prevSpend: Centavos; newSpend: Centavos; effectiveLimit: Centavos; alreadyFired: Threshold[] }): Threshold | null`
  - `type LimitAlert = { limitId: string; limitName: string; threshold: Threshold; spend: Centavos; effectiveLimit: Centavos; daysLeft: number }`
  - `coalesceAlerts(alerts: LimitAlert[]): LimitAlert[]` (most-severe first)
  - `buildAlertNotification(alerts: LimitAlert[]): { title: string; body: string }` (single or multi-limit summary; copy is illustrative per spec rule 26)
  - `expandCategoryIds(selected: string[], all: { id: string; parentId: string | null }[]): string[]` (selected + all descendants)

**Steps:**

- [ ] Write the failing test — `mobile/lib/limits/__tests__/limit_engine_thresholds.test.ts`:

  ```ts
  import {
    buildAlertNotification, coalesceAlerts, crossedThreshold, expandCategoryIds,
  } from "../limit_engine";
  import type { LimitAlert } from "../limit_engine";

  const LIMIT = 1_000_000; // effective limit ₱10,000.00

  describe("crossedThreshold", () => {
    it("fires 50 when crossing from below 50% to at-or-above", () => {
      expect(crossedThreshold({
        prevSpend: 490000, newSpend: 500000, effectiveLimit: LIMIT, alreadyFired: [],
      })).toBe(50);
    });

    it("does not fire below the threshold or when already at it before the commit", () => {
      expect(crossedThreshold({
        prevSpend: 0, newSpend: 499999, effectiveLimit: LIMIT, alreadyFired: [],
      })).toBeNull();
      expect(crossedThreshold({
        prevSpend: 500000, newSpend: 510000, effectiveLimit: LIMIT, alreadyFired: [50],
      })).toBeNull();
    });

    it("a jump across several thresholds fires only the HIGHEST (rule 21)", () => {
      // 40% → 105% in one ₱6,500 commit: only 100 fires
      expect(crossedThreshold({
        prevSpend: 400000, newSpend: 1050000, effectiveLimit: LIMIT, alreadyFired: [],
      })).toBe(100);
    });

    it("never re-fires a threshold in the same period (rule 20)", () => {
      // 50 fired earlier, spend dipped below 50% via a deletion, crosses again → silence
      expect(crossedThreshold({
        prevSpend: 480000, newSpend: 520000, effectiveLimit: LIMIT, alreadyFired: [50],
      })).toBeNull();
      // but 80 can still fire
      expect(crossedThreshold({
        prevSpend: 520000, newSpend: 800000, effectiveLimit: LIMIT, alreadyFired: [50],
      })).toBe(80);
    });

    it("after 100 has fired the limit is silent for the period (rule 23)", () => {
      expect(crossedThreshold({
        prevSpend: 1050000, newSpend: 1500000, effectiveLimit: LIMIT, alreadyFired: [50, 80, 100],
      })).toBeNull();
    });

    it("raising the effective limit can un-trip visually but never re-notify (rule 20)", () => {
      // spend 520,000 was ≥50% of 1,000,000; limit raised to 1,200,000 → 43%;
      // a later commit crosses 50% again → alreadyFired blocks it
      expect(crossedThreshold({
        prevSpend: 520000, newSpend: 620000, effectiveLimit: 1200000, alreadyFired: [50],
      })).toBeNull();
    });
  });

  describe("coalesceAlerts + buildAlertNotification", () => {
    const mk = (over: Partial<LimitAlert>): LimitAlert => ({
      limitId: "l1", limitName: "Monthly", threshold: 50, spend: 500000,
      effectiveLimit: LIMIT, daysLeft: 9, ...over,
    });

    it("orders most-severe first: threshold desc, then usage ratio desc", () => {
      const out = coalesceAlerts([
        mk({ limitId: "a", threshold: 50, spend: 500000 }),
        mk({ limitId: "b", threshold: 100, spend: 1010000 }),
        mk({ limitId: "c", threshold: 80, spend: 990000 }),
        mk({ limitId: "d", threshold: 80, spend: 800000 }),
      ]);
      expect(out.map((a) => a.limitId)).toEqual(["b", "c", "d", "a"]);
    });

    it("single alert: title names the threshold, body shows remaining and days left", () => {
      const n = buildAlertNotification([
        mk({ limitName: "Food & Dining", threshold: 80, spend: 800000, daysLeft: 9 }),
      ]);
      expect(n.title).toContain("80%");
      expect(n.body).toContain("Food & Dining");
      expect(n.body).toContain("₱2,000.00"); // remaining
      expect(n.body).toContain("9");
    });

    it("multiple alerts coalesce into ONE summary, most severe first (rule 22)", () => {
      const n = buildAlertNotification(coalesceAlerts([
        mk({ limitId: "a", limitName: "Overall", threshold: 80, spend: 850000 }),
        mk({ limitId: "b", limitName: "GCash daily", threshold: 100, spend: 1100000 }),
      ]));
      expect(n.title).toContain("2 limits");
      const gcashIdx = n.body.indexOf("GCash daily");
      const overallIdx = n.body.indexOf("Overall");
      expect(gcashIdx).toBeGreaterThanOrEqual(0);
      expect(overallIdx).toBeGreaterThan(gcashIdx);
    });

    it("breach body states the overage instead of remaining", () => {
      const n = buildAlertNotification([mk({ threshold: 100, spend: 1100000 })]);
      expect(n.body).toContain("Over by ₱1,000.00");
    });
  });

  describe("expandCategoryIds (rule 3: parent includes all descendants)", () => {
    const tree = [
      { id: "food", parentId: null },
      { id: "delivery", parentId: "food" },
      { id: "grabfood", parentId: "delivery" },
      { id: "transport", parentId: null },
    ];

    it("expands nested descendants", () => {
      expect(expandCategoryIds(["food"], tree).sort())
        .toEqual(["delivery", "food", "grabfood"]);
    });

    it("leaf selection stays itself; multiple roots union", () => {
      expect(expandCategoryIds(["grabfood"], tree)).toEqual(["grabfood"]);
      expect(expandCategoryIds(["food", "transport"], tree).sort())
        .toEqual(["delivery", "food", "grabfood", "transport"]);
    });
  });
  ```

- [ ] Run it (expected: FAIL): `npx jest --ci lib/limits/__tests__/limit_engine_thresholds.test.ts`

- [ ] Append to `mobile/lib/limits/limit_engine.ts` (add `import { formatCentavos } from "@/lib/money";` and `import type { Threshold } from "@/types/control";` to the imports):

  ```ts
  const THRESHOLDS_DESC: Threshold[] = [100, 80, 50];

  /**
   * Rules 19–23. Fires the HIGHEST threshold newly crossed by this commit, or null.
   * A fired threshold never re-arms within its period; after 100 fires → silence.
   */
  export function crossedThreshold(args: {
    prevSpend: Centavos; newSpend: Centavos; effectiveLimit: Centavos;
    alreadyFired: Threshold[];
  }): Threshold | null {
    if (args.effectiveLimit <= 0) return null;
    if (args.alreadyFired.includes(100)) return null; // rule 23: one breach alert, then silence
    for (const t of THRESHOLDS_DESC) {
      const mark = (args.effectiveLimit * t) / 100;
      const crossed = args.prevSpend < mark && args.newSpend >= mark;
      if (crossed && !args.alreadyFired.includes(t)) return t;
    }
    return null;
  }

  export type LimitAlert = {
    limitId: string; limitName: string; threshold: Threshold;
    spend: Centavos; effectiveLimit: Centavos; daysLeft: number;
  };

  /** Rule 22: most-severe first — threshold desc, then usage ratio desc. */
  export function coalesceAlerts(alerts: LimitAlert[]): LimitAlert[] {
    return [...alerts].sort((a, b) =>
      b.threshold - a.threshold
      || b.spend / b.effectiveLimit - a.spend / a.effectiveLimit,
    );
  }

  function lineFor(a: LimitAlert): string {
    if (a.threshold === 100) {
      return `${a.limitName}: Over by ${formatCentavos(a.spend - a.effectiveLimit)}`;
    }
    const remaining = a.effectiveLimit - a.spend;
    return `${a.limitName}: ${formatCentavos(remaining)} left, ${a.daysLeft} day(s) to go`;
  }

  /** All copy illustrative (spec rule 26); final copy at implementation review. */
  export function buildAlertNotification(alerts: LimitAlert[]): { title: string; body: string } {
    if (alerts.length === 1) {
      const a = alerts[0];
      const title = a.threshold === 100
        ? `You've hit your ${formatCentavos(a.effectiveLimit)} limit`
        : `Heads up — ${a.threshold}% of your limit used`;
      return { title, body: lineFor(a) };
    }
    return {
      title: `${alerts.length} limits need a look`,
      body: alerts.map(lineFor).join("\n"),
    };
  }

  /** Rule 3: a selected parent category includes all of its descendants. */
  export function expandCategoryIds(
    selected: string[],
    all: { id: string; parentId: string | null }[],
  ): string[] {
    const childrenOf = new Map<string, string[]>();
    for (const c of all) {
      if (c.parentId) {
        const list = childrenOf.get(c.parentId) ?? [];
        list.push(c.id);
        childrenOf.set(c.parentId, list);
      }
    }
    const out = new Set<string>();
    const stack = [...selected];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return [...out];
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci lib/limits/__tests__/limit_engine_thresholds.test.ts`

- [ ] Run the whole limits suite to confirm nothing regressed: `npx jest --ci lib/limits`

- [ ] Commit:

  ```
  git add mobile/lib/limits
  git commit -m "feat(limits): single-fire threshold crossing, coalesced alerts, category expansion"
  ```

---

### Task 7: Limit service — recompute on ledger commit (integration through repos)

Glues engine + repos: on every ledger commit (or recompute trigger), for each active limit — resolve the period window, snapshot/roll the alert state at period boundaries (applying rollover), aggregate spend via the pinned `transactions_repo.sumSpend`, evaluate threshold crossings, and return alerts. Notification posting goes through ONE coalesced `postAlert`. Also the UI-facing `getLimitStatuses` and per-period mute.

**Files:**
- Create: `mobile/lib/limits/limit_service.ts`
- Create (or extend if foundation already created the file — then ADD these functions to it): `mobile/lib/db/repos/categories_repo.ts`
- Test: `mobile/lib/limits/__tests__/limit_service.test.ts`

**Interfaces:**
- Consumes: `sumSpend(args: { from: number; to: number; categoryIds?: string[]; walletIds?: string[] }): Promise<Centavos>` from `mobile/lib/db/repos/transactions_repo.ts` (contract §3 — direction `out`, transfer-linked excluded); Tasks 3–6; `postAlert` (Task 2); `CHANNEL_LIMITS` (Task 2).
- Produces:
  - `listCategoryRefs(): Promise<{ id: string; parentId: string | null }[]>` (categories_repo)
  - `recomputeLimits(args: { now: number; monthlyIncome: Centavos | null }): Promise<LimitAlert[]>`
  - `notifyLimitAlerts(alerts: LimitAlert[]): Promise<void>`
  - `type LimitStatus = { limit: Limit; paused: boolean; base: Centavos | null; carryover: Centavos; effectiveLimit: Centavos | null; spend: Centavos; window: PeriodWindow; uiState: "on_track" | "caution" | "warning" | "over" | "paused" }`
  - `getLimitStatuses(args: { now: number; monthlyIncome: Centavos | null }): Promise<LimitStatus[]>`
  - `muteLimitForPeriod(limitId: string, now: number): Promise<void>`
  - `refreshLimitBase(limitId: string, now: number, monthlyIncome: Centavos | null): Promise<void>` — call-site: manual edits to a limit or to the IncomeProfile (limits rule 11 immediate-recompute exception)

**Steps:**

- [ ] Write the failing integration test — `mobile/lib/limits/__tests__/limit_service.test.ts`. Transactions/wallets/categories are seeded with raw SQL using the contract-pinned `transactions` columns (adapt the two seed helpers only if foundation's wallet/category columns differ):

  ```ts
  /** @jest-environment node */
  jest.mock("@/lib/alerts/alerts_service", () => ({
    postAlert: jest.fn().mockResolvedValue("os-1"),
  }));
  import { createTestDb } from "@/test/db_harness";
  import { setDbHandleForTests, type DbHandle } from "@/lib/db/db_handle";
  import { createLimit, getLimitAlertState, updateLimit } from "@/lib/db/repos/limits_repo";
  import {
    getLimitStatuses, muteLimitForPeriod, notifyLimitAlerts, recomputeLimits,
  } from "../limit_service";
  import { postAlert } from "@/lib/alerts/alerts_service";
  import { newId } from "@/lib/ids";

  const ms = (y: number, m: number, d: number, hh = 12) => new Date(y, m, d, hh).getTime();
  let db: DbHandle;

  async function seedWallet(id: string): Promise<void> {
    await db.runAsync(
      `INSERT INTO wallets (id, name, type, balance, currency, matchers, is_archived, created_at, updated_at)
       VALUES (?, ?, 'e-wallet', 0, 'PHP', '[]', 0, 0, 0)`, [id, `wallet-${id}`]);
  }
  async function seedCategory(id: string, parentId: string | null): Promise<void> {
    await db.runAsync(
      `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
       VALUES (?, ?, ?, 'circle', 0, 0, 0, 0)`, [id, `cat-${id}`, parentId]);
  }
  async function seedTx(args: {
    walletId: string; categoryId: string; amount: number; direction?: "in" | "out";
    occurredAt: number; transferLinkId?: string | null;
  }): Promise<void> {
    await db.runAsync(
      `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at,
         merchant, counterparty, reference_no, source, confidence, raw_notification_id,
         transfer_link_id, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'manual', 1, NULL, ?, NULL, ?, ?)`,
      [newId(), args.walletId, args.categoryId, args.amount, args.direction ?? "out",
       args.occurredAt, args.transferLinkId ?? null, args.occurredAt, args.occurredAt]);
  }

  describe("limit_service", () => {
    beforeEach(async () => {
      db = await createTestDb();
      setDbHandleForTests(db);
      jest.clearAllMocks();
      await seedWallet("w1");
      await seedCategory("food", null);
      await seedCategory("delivery", "food");
      await seedCategory("transport", null);
    });
    afterEach(() => setDbHandleForTests(null));

    it("fires 50 once, then stays silent at unchanged spend, then fires only 100 on a big jump", async () => {
      const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
      const now = ms(2026, 7, 10);
      await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 7, 5) });
      let alerts = await recomputeLimits({ now, monthlyIncome: null });
      expect(alerts).toEqual([expect.objectContaining({ limitId: limit.id, threshold: 50 })]);
      alerts = await recomputeLimits({ now, monthlyIncome: null }); // same spend → no re-fire
      expect(alerts).toEqual([]);
      await seedTx({ walletId: "w1", categoryId: "food", amount: 550000, occurredAt: ms(2026, 7, 9) });
      alerts = await recomputeLimits({ now, monthlyIncome: null }); // 1,050,000 → highest only
      expect(alerts).toEqual([expect.objectContaining({ threshold: 100 })]);
      const state = await getLimitAlertState(limit.id);
      expect(state?.fired).toEqual([50, 100]);
    });

    it("excludes transfer-linked spend and respects category descendants + wallet filter", async () => {
      await seedWallet("w2");
      const limit = await createLimit({
        scope: "monthly", basis: "fixed", value: 1000000,
        categoryFilter: ["food"], walletFilter: ["w1"],
      });
      const now = ms(2026, 7, 10);
      await seedTx({ walletId: "w1", categoryId: "delivery", amount: 500000, occurredAt: ms(2026, 7, 3) }); // counts (descendant)
      await seedTx({ walletId: "w1", categoryId: "transport", amount: 400000, occurredAt: ms(2026, 7, 3) }); // wrong category
      await seedTx({ walletId: "w2", categoryId: "food", amount: 400000, occurredAt: ms(2026, 7, 3) });      // wrong wallet
      await seedTx({ walletId: "w1", categoryId: "food", amount: 400000, occurredAt: ms(2026, 7, 4), transferLinkId: "tl-x" }); // transfer-linked
      const statuses = await getLimitStatuses({ now, monthlyIncome: null });
      const s = statuses.find((x) => x.limit.id === limit.id)!;
      expect(s.spend).toBe(500000);
      expect(s.uiState).toBe("caution"); // 50% used
    });

    it("percent-of-income limit with unknown income is paused: no counting, no alerts", async () => {
      await createLimit({ scope: "monthly", basis: "percent-of-income", value: 20 });
      await seedTx({ walletId: "w1", categoryId: "food", amount: 900000, occurredAt: ms(2026, 7, 5) });
      const alerts = await recomputeLimits({ now: ms(2026, 7, 10), monthlyIncome: null });
      expect(alerts).toEqual([]);
      const statuses = await getLimitStatuses({ now: ms(2026, 7, 10), monthlyIncome: null });
      expect(statuses[0].uiState).toBe("paused");
      expect(statuses[0].effectiveLimit).toBeNull();
    });

    it("rolls the period: carryover = clamp(prevBase − prevSpend, 0, base), thresholds reset", async () => {
      const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000, rollover: true });
      await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 6, 20) }); // July spend ₱5,000
      await recomputeLimits({ now: ms(2026, 6, 25), monthlyIncome: null }); // July evaluation (fires 50)
      const alerts = await recomputeLimits({ now: ms(2026, 7, 2), monthlyIncome: null }); // August
      expect(alerts).toEqual([]);
      const state = await getLimitAlertState(limit.id);
      expect(state?.periodStart).toBe(new Date(2026, 7, 1).getTime());
      expect(state?.carryover).toBe(300000); // ₱8,000 − ₱5,000
      expect(state?.fired).toEqual([]);
      const s = (await getLimitStatuses({ now: ms(2026, 7, 2), monthlyIncome: null }))[0];
      expect(s.effectiveLimit).toBe(1100000); // ₱11,000.00
    });

    it("mute suppresses returned alerts but still records fired thresholds", async () => {
      const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
      await recomputeLimits({ now: ms(2026, 7, 1), monthlyIncome: null }); // init state
      await muteLimitForPeriod(limit.id, ms(2026, 7, 1));
      await seedTx({ walletId: "w1", categoryId: "food", amount: 600000, occurredAt: ms(2026, 7, 2) });
      const alerts = await recomputeLimits({ now: ms(2026, 7, 2), monthlyIncome: null });
      expect(alerts).toEqual([]);
      expect((await getLimitAlertState(limit.id))?.fired).toEqual([50]);
    });

    it("inactive limits are skipped entirely", async () => {
      const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 100000, isActive: false });
      await seedTx({ walletId: "w1", categoryId: "food", amount: 900000, occurredAt: ms(2026, 7, 5) });
      expect(await recomputeLimits({ now: ms(2026, 7, 10), monthlyIncome: null })).toEqual([]);
      void limit;
    });

    it("notifyLimitAlerts posts exactly ONE coalesced notification for multiple alerts", async () => {
      await notifyLimitAlerts([
        { limitId: "a", limitName: "Overall", threshold: 80, spend: 850000, effectiveLimit: 1000000, daysLeft: 9 },
        { limitId: "b", limitName: "GCash", threshold: 100, spend: 1100000, effectiveLimit: 1000000, daysLeft: 9 },
      ]);
      expect(postAlert).toHaveBeenCalledTimes(1);
      const call = (postAlert as jest.Mock).mock.calls[0][0];
      expect(call.channel).toBe("limits");
      expect(call.body.indexOf("GCash")).toBeLessThan(call.body.indexOf("Overall"));
    });

    it("refreshLimitBase after a manual edit re-snapshots the base immediately (rule 11)", async () => {
      const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
      await recomputeLimits({ now: ms(2026, 7, 2), monthlyIncome: null });
      await updateLimit(limit.id, { value: 1200000 });
      const { refreshLimitBase } = await import("../limit_service");
      await refreshLimitBase(limit.id, ms(2026, 7, 2), null);
      expect((await getLimitAlertState(limit.id))?.base).toBe(1200000);
    });
  });
  ```

- [ ] Run it (expected: FAIL — `limit_service`/`categories_repo` missing): `npx jest --ci lib/limits/__tests__/limit_service.test.ts`

- [ ] Implement `mobile/lib/db/repos/categories_repo.ts` (or add to the existing foundation file):

  ```ts
  import { getDbHandle } from "../db_handle";

  export async function listCategoryRefs(): Promise<{ id: string; parentId: string | null }[]> {
    const db = await getDbHandle();
    const rows = await db.getAllAsync<{ id: string; parent_id: string | null }>(
      "SELECT id, parent_id FROM categories",
    );
    return rows.map((r) => ({ id: r.id, parentId: r.parent_id }));
  }
  ```

  Implement `mobile/lib/limits/limit_service.ts`:

  ```ts
  import type { Centavos, Limit } from "@/types/domain";
  import type { LimitAlertState } from "@/types/control";
  import { sumSpend } from "@/lib/db/repos/transactions_repo";
  import {
    getLimit, getLimitAlertState, listLimits, setLimitAlertState,
  } from "@/lib/db/repos/limits_repo";
  import { listCategoryRefs } from "@/lib/db/repos/categories_repo";
  import { postAlert } from "@/lib/alerts/alerts_service";
  import {
    baseFor, buildAlertNotification, carryoverFor, coalesceAlerts, crossedThreshold,
    effectiveLimitFor, expandCategoryIds, periodWindowFor, previousPeriodWindow,
    type LimitAlert, type PeriodWindow,
  } from "./limit_engine";

  export type LimitStatus = {
    limit: Limit; paused: boolean; base: Centavos | null; carryover: Centavos;
    effectiveLimit: Centavos | null; spend: Centavos; window: PeriodWindow;
    uiState: "on_track" | "caution" | "warning" | "over" | "paused";
  };

  async function filtersFor(limit: Limit): Promise<{ categoryIds?: string[]; walletIds?: string[] }> {
    const out: { categoryIds?: string[]; walletIds?: string[] } = {};
    if (limit.categoryFilter?.length) {
      out.categoryIds = expandCategoryIds(limit.categoryFilter, await listCategoryRefs());
    }
    if (limit.walletFilter?.length) out.walletIds = limit.walletFilter;
    return out;
  }

  /** Ensure alert state exists and belongs to the current period; roll it if not. */
  async function ensureState(
    limit: Limit, window: PeriodWindow, now: number, base: Centavos,
  ): Promise<LimitAlertState> {
    const existing = await getLimitAlertState(limit.id);
    if (existing && existing.periodStart === window.start) return existing;
    const prev = previousPeriodWindow(limit.scope, now);
    const prevBase = existing && existing.periodStart === prev.start ? existing.base : base;
    const filters = await filtersFor(limit);
    const prevSpend = await sumSpend({ from: prev.start, to: prev.end, ...filters });
    const carryover = carryoverFor({ rollover: limit.rollover, prevBase, prevSpend, base });
    const fresh: LimitAlertState = {
      periodStart: window.start, base, carryover, fired: [], muted: false, lastSpend: 0,
    };
    await setLimitAlertState(limit.id, fresh);
    return fresh;
  }

  export async function recomputeLimits(args: {
    now: number; monthlyIncome: Centavos | null;
  }): Promise<LimitAlert[]> {
    const alerts: LimitAlert[] = [];
    for (const limit of await listLimits({ activeOnly: true })) {
      const base = baseFor(limit, args.monthlyIncome);
      if (base === null) continue; // Paused — income unknown (rule 12): no counting, no alerting
      const window = periodWindowFor(limit.scope, args.now);
      const state = await ensureState(limit, window, args.now, base);
      const effectiveLimit = effectiveLimitFor(state.base, state.carryover);
      const filters = await filtersFor(limit);
      const spend = await sumSpend({ from: window.start, to: window.end, ...filters });
      const threshold = crossedThreshold({
        prevSpend: state.lastSpend, newSpend: spend, effectiveLimit, alreadyFired: state.fired,
      });
      if (threshold) {
        state.fired = [...state.fired, threshold];
        if (!state.muted) {
          alerts.push({
            limitId: limit.id, limitName: limitDisplayName(limit), threshold,
            spend, effectiveLimit, daysLeft: window.daysLeft,
          });
        }
      }
      state.lastSpend = spend;
      await setLimitAlertState(limit.id, state);
    }
    return coalesceAlerts(alerts);
  }

  function limitDisplayName(limit: Limit): string {
    return `${limit.scope} limit`; // UI passes richer names; engine fallback stays generic
  }

  export async function notifyLimitAlerts(alerts: LimitAlert[]): Promise<void> {
    if (!alerts.length) return;
    const { title, body } = buildAlertNotification(coalesceAlerts(alerts));
    await postAlert({ channel: "limits", title, body, data: { limitIds: alerts.map((a) => a.limitId) } });
  }

  export async function getLimitStatuses(args: {
    now: number; monthlyIncome: Centavos | null;
  }): Promise<LimitStatus[]> {
    const out: LimitStatus[] = [];
    for (const limit of await listLimits()) {
      const window = periodWindowFor(limit.scope, args.now);
      const base = limit.isActive ? baseFor(limit, args.monthlyIncome) : baseFor(limit, args.monthlyIncome);
      if (base === null) {
        out.push({
          limit, paused: true, base: null, carryover: 0, effectiveLimit: null,
          spend: 0, window, uiState: "paused",
        });
        continue;
      }
      const state = limit.isActive
        ? await ensureState(limit, window, args.now, base)
        : { periodStart: window.start, base, carryover: 0, fired: [], muted: false, lastSpend: 0 };
      const effectiveLimit = effectiveLimitFor(state.base, state.carryover);
      const filters = await filtersFor(limit);
      const spend = await sumSpend({ from: window.start, to: window.end, ...filters });
      const ratio = spend / effectiveLimit;
      const uiState = ratio >= 1 ? "over" : ratio >= 0.8 ? "warning" : ratio >= 0.5 ? "caution" : "on_track";
      out.push({ limit, paused: false, base, carryover: state.carryover, effectiveLimit, spend, window, uiState });
    }
    return out;
  }

  export async function muteLimitForPeriod(limitId: string, now: number): Promise<void> {
    const limit = await getLimit(limitId);
    if (!limit) return;
    const window = periodWindowFor(limit.scope, now);
    const state = (await getLimitAlertState(limitId)) ?? {
      periodStart: window.start, base: limit.value, carryover: 0,
      fired: [], muted: false, lastSpend: 0,
    };
    await setLimitAlertState(limitId, { ...state, muted: true });
  }

  /** Manual edit to the limit or the IncomeProfile → re-snapshot base NOW (rule 11). */
  export async function refreshLimitBase(
    limitId: string, now: number, monthlyIncome: Centavos | null,
  ): Promise<void> {
    const limit = await getLimit(limitId);
    if (!limit) return;
    const base = baseFor(limit, monthlyIncome);
    if (base === null) return;
    const window = periodWindowFor(limit.scope, now);
    const state = (await getLimitAlertState(limitId)) ?? {
      periodStart: window.start, base, carryover: 0, fired: [], muted: false, lastSpend: 0,
    };
    await setLimitAlertState(limitId, { ...state, periodStart: window.start, base });
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci lib/limits/__tests__/limit_service.test.ts`

- [ ] Commit:

  ```
  git add mobile/lib/limits mobile/lib/db/repos/categories_repo.ts
  git commit -m "feat(limits): commit-time recompute with rollover state, coalesced notifications, statuses"
  ```

---

### Task 8: Limits UI — Plan hub, list, create/edit, detail, entitlement gate

Plan-tab screens per the limits spec UX states table: Empty / On track / Caution / Warning / Over / Paused — income unknown / Inactive (gated). Create flow enforces `canCreateLimit(activeCount)` and the free-tier "filters are Plus" rule at the call-site (MVP tier is `plus`, so gates exist but do not block). Colors come from the palette tokens only (`brand`, `warn`, `danger`).

**Files:**
- Modify: the foundation Plan tab route — if it is `mobile/app/(tabs)/plan.tsx`, move it to `mobile/app/(tabs)/plan/index.tsx` (same route in expo-router) so feature screens nest under `plan/`
- Create: `mobile/app/(tabs)/plan/limits/index.tsx`, `mobile/app/(tabs)/plan/limits/new.tsx`, `mobile/app/(tabs)/plan/limits/[id].tsx`, `mobile/components/limits/limit_card.tsx`, `mobile/hooks/queries/use_limit_statuses.ts`, `mobile/hooks/mutations/use_limit_mutations.ts`, `mobile/constants/control_query_keys.ts`
- Test: `mobile/components/limits/__tests__/limit_card.test.tsx`

**Interfaces:**
- Consumes: `getLimitStatuses`, `muteLimitForPeriod`, `refreshLimitBase` (Task 7); `createLimit`, `updateLimit`, `deleteLimit`, `listLimits` (Task 3); `canCreateLimit`, `getTier` (foundation `mobile/lib/entitlements.ts`, contract §7); `formatCentavos` (Task 1); `listTransactions` (contract §3) for the detail drill-down; palette tokens (contract §2).
- Produces: routes `/plan/limits`, `/plan/limits/new`, `/plan/limits/[id]`; `LimitCard` component; `controlQueryKeys` factory (`limits`, `income`, `goals`, `loans`, `bills` families) used by all later UI tasks.

**Steps:**

- [ ] Install the component-test dependency if the foundation has not already:

  ```
  npm i -D @testing-library/react-native
  ```

- [ ] Write the failing component test — `mobile/components/limits/__tests__/limit_card.test.tsx`:

  ```tsx
  import React from "react";
  import { render } from "@testing-library/react-native";
  import { LimitCard } from "../limit_card";

  const base = {
    name: "Food & Dining", scope: "monthly" as const, spend: 0,
    effectiveLimit: 1000000 as number | null, daysLeft: 9,
    paused: false, inactive: false,
  };

  describe("LimitCard", () => {
    it("on track: shows remaining and days left", () => {
      const { getByText } = render(<LimitCard {...base} spend={200000} />);
      getByText("Food & Dining");
      getByText("₱8,000.00 left, 9 days to go");
    });

    it("over: shows the overage line instead of remaining", () => {
      const { getByText } = render(<LimitCard {...base} spend={1150000} />);
      getByText("Over by ₱1,500.00");
    });

    it("paused (income unknown): explains and hides amounts", () => {
      const { getByText, queryByText } = render(
        <LimitCard {...base} paused effectiveLimit={null} />,
      );
      getByText("Paused — declare your income to activate");
      expect(queryByText(/left,/)).toBeNull();
    });

    it("inactive (gated): shows the inactive tag", () => {
      const { getByText } = render(<LimitCard {...base} inactive />);
      getByText("Inactive");
    });
  });
  ```

- [ ] Run it (expected: FAIL — component missing): `npx jest --ci components/limits/__tests__/limit_card.test.tsx`

- [ ] Implement `mobile/components/limits/limit_card.tsx`:

  ```tsx
  import React from "react";
  import { Text, View } from "react-native";
  import { formatCentavos } from "@/lib/money";
  import type { Centavos } from "@/types/domain";

  export type LimitCardProps = {
    name: string; scope: "daily" | "weekly" | "monthly" | "annual";
    spend: Centavos; effectiveLimit: Centavos | null; daysLeft: number;
    paused: boolean; inactive: boolean;
  };

  export function LimitCard(p: LimitCardProps) {
    if (p.paused) {
      return (
        <View className="rounded-2xl bg-surface dark:bg-surface-dark p-4 opacity-60">
          <Text className="text-fg dark:text-fg-dark font-semibold">{p.name}</Text>
          <Text className="text-fg-2 dark:text-fg-2-dark mt-1">
            Paused — declare your income to activate
          </Text>
        </View>
      );
    }
    const limit = p.effectiveLimit ?? 0;
    const ratio = limit > 0 ? p.spend / limit : 0;
    const over = ratio >= 1;
    const barClass = over
      ? "bg-danger dark:bg-danger-dark"
      : ratio >= 0.8
        ? "bg-warn dark:bg-warn-dark"
        : "bg-brand dark:bg-brand-dark";
    return (
      <View className={`rounded-2xl bg-surface dark:bg-surface-dark p-4 ${p.inactive ? "opacity-60" : ""}`}>
        <View className="flex-row items-center justify-between">
          <Text className="text-fg dark:text-fg-dark font-semibold">{p.name}</Text>
          {p.inactive ? (
            <Text className="text-fg-2 dark:text-fg-2-dark text-xs uppercase">Inactive</Text>
          ) : null}
        </View>
        <View className="h-2 rounded-full bg-brand-soft dark:bg-brand-soft-dark mt-3 overflow-hidden">
          <View className={`h-2 rounded-full ${barClass}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </View>
        <Text className="text-fg-2 dark:text-fg-2-dark mt-2">
          {over
            ? `Over by ${formatCentavos(p.spend - limit)}`
            : `${formatCentavos(limit - p.spend)} left, ${p.daysLeft} days to go`}
        </Text>
      </View>
    );
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci components/limits/__tests__/limit_card.test.tsx`

- [ ] Create `mobile/constants/control_query_keys.ts`:

  ```ts
  export const controlQueryKeys = {
    limits: {
      all: ["limits"] as const,
      statuses: () => ["limits", "statuses"] as const,
      detail: (id: string) => ["limits", "detail", id] as const,
    },
    income: { profile: ["income", "profile"] as const },
    goals: { all: ["goals"] as const, detail: (id: string) => ["goals", "detail", id] as const },
    loans: { all: ["loans"] as const, detail: (id: string) => ["loans", "detail", id] as const },
    bills: { all: ["bills"] as const, detail: (id: string) => ["bills", "detail", id] as const },
  } as const;
  ```

  Create `mobile/hooks/queries/use_limit_statuses.ts`:

  ```ts
  import { useQuery } from "@tanstack/react-query";
  import { controlQueryKeys } from "@/constants/control_query_keys";
  import { getLimitStatuses } from "@/lib/limits/limit_service";
  import { getMonthlyEquivalentIncome } from "@/lib/income/income_service"; // Task 11; until then pass null inline
  import { systemClock } from "@/lib/clock";

  export function useLimitStatuses() {
    return useQuery({
      queryKey: controlQueryKeys.limits.statuses(),
      queryFn: async () => getLimitStatuses({
        now: systemClock.now(),
        monthlyIncome: await getMonthlyEquivalentIncome(),
      }),
    });
  }
  ```

  NOTE: until Task 11 lands, stub the income import as `const getMonthlyEquivalentIncome = async () => null;` inside this file and remove the stub in Task 11 (the Task 11 checklist includes this removal).

  Create `mobile/hooks/mutations/use_limit_mutations.ts`:

  ```ts
  import { useMutation, useQueryClient } from "@tanstack/react-query";
  import { controlQueryKeys } from "@/constants/control_query_keys";
  import {
    createLimit, deleteLimit, updateLimit, type NewLimit,
  } from "@/lib/db/repos/limits_repo";
  import { muteLimitForPeriod, refreshLimitBase } from "@/lib/limits/limit_service";
  import { systemClock } from "@/lib/clock";

  export function useLimitMutations() {
    const qc = useQueryClient();
    const invalidate = () => qc.invalidateQueries({ queryKey: controlQueryKeys.limits.all });
    return {
      create: useMutation({ mutationFn: (input: NewLimit) => createLimit(input), onSuccess: invalidate }),
      update: useMutation({
        mutationFn: async (args: { id: string; patch: Partial<NewLimit> }) => {
          const limit = await updateLimit(args.id, args.patch);
          await refreshLimitBase(args.id, systemClock.now(), null); // rule 11 immediate recompute
          return limit;
        },
        onSuccess: invalidate,
      }),
      remove: useMutation({ mutationFn: (id: string) => deleteLimit(id), onSuccess: invalidate }),
      mute: useMutation({
        mutationFn: (id: string) => muteLimitForPeriod(id, systemClock.now()),
        onSuccess: invalidate,
      }),
    };
  }
  ```

- [ ] Create the screens. `mobile/app/(tabs)/plan/index.tsx` (hub — keep whatever foundation content exists and add the section links):

  ```tsx
  import React from "react";
  import { Pressable, ScrollView, Text, View } from "react-native";
  import { Link } from "expo-router";

  const SECTIONS = [
    { href: "/plan/limits", title: "Limits", blurb: "Spending caps with 50/80/100% alerts" },
    { href: "/plan/income", title: "Income", blurb: "Your pay rhythm — detected or declared" },
    { href: "/plan/goals", title: "Goals", blurb: "Savings targets backed by real wallets" },
    { href: "/plan/loans", title: "Loans", blurb: "Utang both ways: balances and next dues" },
    { href: "/plan/bills", title: "Bills", blurb: "Due-date reminders and auto-matched payments" },
  ] as const;

  export default function PlanScreen() {
    return (
      <ScrollView className="flex-1 bg-bg dark:bg-bg-dark p-4">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} asChild>
            <Pressable className="rounded-2xl bg-surface dark:bg-surface-dark p-4 mb-3">
              <Text className="text-fg dark:text-fg-dark text-lg font-semibold">{s.title}</Text>
              <Text className="text-fg-2 dark:text-fg-2-dark mt-1">{s.blurb}</Text>
            </Pressable>
          </Link>
        ))}
      </ScrollView>
    );
  }
  ```

  `mobile/app/(tabs)/plan/limits/index.tsx`:

  ```tsx
  import React from "react";
  import { FlatList, Pressable, Text, View } from "react-native";
  import { Link, useRouter } from "expo-router";
  import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
  import { LimitCard } from "@/components/limits/limit_card";
  import { canCreateLimit } from "@/lib/entitlements";

  export default function LimitsScreen() {
    const router = useRouter();
    const { data: statuses = [] } = useLimitStatuses();
    const activeCount = statuses.filter((s) => s.limit.isActive).length;

    const onAdd = () => {
      if (!canCreateLimit(activeCount)) {
        router.push("/plan/limits/new?gated=1"); // create screen renders the upgrade sheet
        return;
      }
      router.push("/plan/limits/new");
    };

    if (!statuses.length) {
      return (
        <View className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center p-6">
          <Text className="text-fg dark:text-fg-dark text-lg font-semibold">Set your first limit</Text>
          <Text className="text-fg-2 dark:text-fg-2-dark text-center mt-2">
            A cap on spending for a day, week, month, or year — PeraPlano watches it for you.
          </Text>
          <Pressable onPress={onAdd} className="mt-4 rounded-full bg-brand dark:bg-brand-dark px-6 py-3">
            <Text className="text-white font-semibold">Add a limit</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View className="flex-1 bg-bg dark:bg-bg-dark">
        <FlatList
          contentContainerClassName="p-4 gap-3"
          data={statuses}
          keyExtractor={(s) => s.limit.id}
          renderItem={({ item: s }) => (
            <Link href={`/plan/limits/${s.limit.id}`} asChild>
              <Pressable>
                <LimitCard
                  name={s.limit.categoryFilter?.length ? "Filtered limit" : `${s.limit.scope} limit`}
                  scope={s.limit.scope}
                  spend={s.spend}
                  effectiveLimit={s.effectiveLimit}
                  daysLeft={s.window.daysLeft}
                  paused={s.paused}
                  inactive={!s.limit.isActive}
                />
              </Pressable>
            </Link>
          )}
        />
        <Pressable onPress={onAdd} className="absolute bottom-6 right-6 rounded-full bg-brand dark:bg-brand-dark px-5 py-4">
          <Text className="text-white font-semibold">Add</Text>
        </Pressable>
      </View>
    );
  }
  ```

  `mobile/app/(tabs)/plan/limits/new.tsx` (create flow per spec steps 1–7; the same form component is reused by `[id].tsx` for editing):

  ```tsx
  import React, { useState } from "react";
  import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
  import { Link, useLocalSearchParams, useRouter } from "expo-router";
  import { useLimitMutations } from "@/hooks/mutations/use_limit_mutations";
  import { getTier } from "@/lib/entitlements";
  import type { LimitBasis, LimitScope } from "@/types/control";

  const SCOPES: LimitScope[] = ["daily", "weekly", "monthly", "annual"];

  export default function NewLimitScreen() {
    const router = useRouter();
    const { gated } = useLocalSearchParams<{ gated?: string }>();
    const { create } = useLimitMutations();
    const [scope, setScope] = useState<LimitScope>("monthly");
    const [basis, setBasis] = useState<LimitBasis>("fixed");
    const [pesos, setPesos] = useState("");     // whole-peso entry, converted to centavos on save
    const [percent, setPercent] = useState("");
    const [rollover, setRollover] = useState(false);
    const [incomeUsable] = useState(false);     // wired to the IncomeProfile in Task 12

    if (gated === "1") {
      return (
        <View className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center p-6">
          <Text className="text-fg dark:text-fg-dark text-lg font-semibold">Limit cap reached</Text>
          <Text className="text-fg-2 dark:text-fg-2-dark text-center mt-2">
            Free keeps one active limit. Your data stays — upgrade to Plus for unlimited,
            per-category limits.
          </Text>
        </View>
      );
    }

    const percentBlocked = basis === "percent-of-income" && !incomeUsable;

    const onSave = async () => {
      const value = basis === "fixed"
        ? Math.round(Number(pesos) * 100)
        : Math.round(Number(percent));
      if (!value || value <= 0 || percentBlocked) return;
      await create.mutateAsync({ scope, basis, value, rollover });
      router.back();
    };

    return (
      <ScrollView className="flex-1 bg-bg dark:bg-bg-dark p-4">
        <Text className="text-fg dark:text-fg-dark font-semibold">Period</Text>
        <View className="flex-row gap-2 mt-2">
          {SCOPES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setScope(s)}
              className={`rounded-full px-4 py-2 ${scope === s ? "bg-brand dark:bg-brand-dark" : "bg-surface dark:bg-surface-dark"}`}
            >
              <Text className={scope === s ? "text-white" : "text-fg dark:text-fg-dark"}>{s}</Text>
            </Pressable>
          ))}
        </View>

        <Text className="text-fg dark:text-fg-dark font-semibold mt-6">Basis</Text>
        <View className="flex-row gap-2 mt-2">
          <Pressable onPress={() => setBasis("fixed")}
            className={`rounded-full px-4 py-2 ${basis === "fixed" ? "bg-brand dark:bg-brand-dark" : "bg-surface dark:bg-surface-dark"}`}>
            <Text className={basis === "fixed" ? "text-white" : "text-fg dark:text-fg-dark"}>Fixed ₱</Text>
          </Pressable>
          <Pressable onPress={() => setBasis("percent-of-income")}
            className={`rounded-full px-4 py-2 ${basis !== "fixed" ? "bg-brand dark:bg-brand-dark" : "bg-surface dark:bg-surface-dark"}`}>
            <Text className={basis !== "fixed" ? "text-white" : "text-fg dark:text-fg-dark"}>% of income</Text>
          </Pressable>
        </View>

        {basis === "fixed" ? (
          <TextInput
            className="mt-3 rounded-xl bg-surface dark:bg-surface-dark p-3 text-fg dark:text-fg-dark"
            keyboardType="numeric" placeholder="Amount in pesos, e.g. 8000"
            value={pesos} onChangeText={setPesos}
          />
        ) : (
          <TextInput
            className="mt-3 rounded-xl bg-surface dark:bg-surface-dark p-3 text-fg dark:text-fg-dark"
            keyboardType="numeric" placeholder="Percent of income, e.g. 20"
            value={percent} onChangeText={setPercent}
          />
        )}

        {percentBlocked ? (
          <View className="mt-3 rounded-xl bg-brand-soft dark:bg-brand-soft-dark p-3">
            <Text className="text-fg dark:text-fg-dark">
              Percent-of-income needs a usable income. Declare it now or switch to fixed.
            </Text>
            <Link href="/plan/income" className="text-brand dark:text-brand-dark mt-2">Declare income</Link>
          </View>
        ) : null}

        {getTier() === "plus" ? (
          <Text className="text-fg-2 dark:text-fg-2-dark mt-6">
            Category and wallet filters can be added from the limit detail screen after saving.
          </Text>
        ) : null}

        <View className="flex-row items-center justify-between mt-6">
          <View className="flex-1 pr-4">
            <Text className="text-fg dark:text-fg-dark font-semibold">Rollover</Text>
            <Text className="text-fg-2 dark:text-fg-2-dark">
              Unused headroom carries into the next period — at most one period's worth, never stacking.
            </Text>
          </View>
          <Switch value={rollover} onValueChange={setRollover} />
        </View>

        <Pressable
          onPress={onSave} disabled={percentBlocked}
          className={`mt-8 rounded-full px-6 py-3 items-center ${percentBlocked ? "bg-surface dark:bg-surface-dark" : "bg-brand dark:bg-brand-dark"}`}
        >
          <Text className={percentBlocked ? "text-fg-2 dark:text-fg-2-dark" : "text-white font-semibold"}>Save</Text>
        </Pressable>
      </ScrollView>
    );
  }
  ```

  `mobile/app/(tabs)/plan/limits/[id].tsx` (detail: itemized effective limit, this-period transactions via the pinned `listTransactions`, edit/mute/delete):

  ```tsx
  import React from "react";
  import { FlatList, Pressable, Text, View } from "react-native";
  import { useLocalSearchParams, useRouter } from "expo-router";
  import { useQuery } from "@tanstack/react-query";
  import { controlQueryKeys } from "@/constants/control_query_keys";
  import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
  import { useLimitMutations } from "@/hooks/mutations/use_limit_mutations";
  import { listTransactions } from "@/lib/db/repos/transactions_repo";
  import { formatCentavos } from "@/lib/money";

  export default function LimitDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { data: statuses = [] } = useLimitStatuses();
    const { mute, remove } = useLimitMutations();
    const s = statuses.find((x) => x.limit.id === id);

    const { data: txs = [] } = useQuery({
      queryKey: controlQueryKeys.limits.detail(id ?? ""),
      enabled: !!s && !s.paused,
      queryFn: () => listTransactions({
        from: s!.window.start, to: s!.window.end, direction: "out", excludeTransferLinked: true,
        ...(s!.limit.walletFilter?.length === 1 ? { walletId: s!.limit.walletFilter[0] } : {}),
      }),
    });

    if (!s) return <View className="flex-1 bg-bg dark:bg-bg-dark" />;
    return (
      <View className="flex-1 bg-bg dark:bg-bg-dark p-4">
        <Text className="text-fg dark:text-fg-dark text-xl font-semibold">
          {s.paused ? "Paused — income unknown" : formatCentavos(s.effectiveLimit ?? 0)}
        </Text>
        {!s.paused && s.carryover > 0 ? (
          <Text className="text-fg-2 dark:text-fg-2-dark mt-1">
            {formatCentavos(s.base ?? 0)} base + {formatCentavos(s.carryover)} rollover
          </Text>
        ) : null}
        {!s.paused ? (
          <Text className="text-fg-2 dark:text-fg-2-dark mt-1">
            Spent {formatCentavos(s.spend)} · {s.window.daysLeft} days left
          </Text>
        ) : null}
        <View className="flex-row gap-3 mt-4">
          <Pressable onPress={() => mute.mutate(s.limit.id)} className="rounded-full bg-surface dark:bg-surface-dark px-4 py-2">
            <Text className="text-fg dark:text-fg-dark">Mute this period</Text>
          </Pressable>
          <Pressable
            onPress={() => { remove.mutate(s.limit.id); router.back(); }}
            className="rounded-full bg-surface dark:bg-surface-dark px-4 py-2"
          >
            <Text className="text-danger dark:text-danger-dark">Delete</Text>
          </Pressable>
        </View>
        <Text className="text-fg dark:text-fg-dark font-semibold mt-6 mb-2">Counted this period</Text>
        <FlatList
          data={txs}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => (
            <View className="flex-row justify-between py-2">
              <Text className="text-fg dark:text-fg-dark">{item.merchant ?? "—"}</Text>
              <Text className="text-fg dark:text-fg-dark">{formatCentavos(item.amount)}</Text>
            </View>
          )}
        />
      </View>
    );
  }
  ```

- [ ] Typecheck the new screens (component tests already passed): `npx tsc --noEmit`

- [ ] Commit:

  ```
  git add mobile/app mobile/components/limits mobile/hooks mobile/constants/control_query_keys.ts mobile/package.json mobile/package-lock.json
  git commit -m "feat(limits): plan hub and limits screens with entitlement-gated creation"
  ```

---

### Task 9: Income repository + candidate income events

Two pieces. The repo maps the singleton `income_profiles` row (+ `income_profile_sources` join table) and persists detection state in `app_settings`. The candidates module implements income rules 1–4: an inbound, committed, non-transfer-linked, non-loan-payment credit ≥ ₱500.00; refund exclusion (same amount, same merchant, within 7 days of a prior outflow); grouping by (wallet, merchant, ±30% of the group's running median) with the largest recurring group as the primary income stream.

**Files:**
- Create: `mobile/lib/db/repos/income_repo.ts`, `mobile/lib/income/candidates.ts`
- Test: `mobile/lib/db/repos/__tests__/income_repo.test.ts`, `mobile/lib/income/__tests__/candidates.test.ts`

**Interfaces:**
- Consumes: `DbHandle` seam + harness (Task 1); `Transaction`, `IncomeProfile`, `Centavos` from `mobile/types/domain.ts` (foundation; `IncomeProfile` = `{ id, cadence, averageAmount, sourceWalletIds, isManualOverride, createdAt, updatedAt }` per docs/02-domain-model.md §3.6).
- Produces:
  - `type Cadence = "kinsenas" | "weekly" | "monthly" | "irregular"` (add to `mobile/types/control.ts`)
  - `type IncomeDetectionState = { status: "unknown" | "provisional" | "confirmed" | "lapsed"; cadence: Cadence | null; averageAmount: Centavos | null; sourceWalletIds: string[]; matchedTransactionIds: string[]; suggestionDismissedSignature: string | null; missedWindows: number }`
  - `getIncomeProfile(): Promise<IncomeProfile | null>` · `saveIncomeProfile(input: { cadence: Cadence; averageAmount: Centavos; sourceWalletIds: string[]; isManualOverride: boolean }): Promise<IncomeProfile>` (upsert — exactly one profile, invariant I9) · `clearIncomeProfile(): Promise<void>`
  - `getIncomeDetectionState(): Promise<IncomeDetectionState>` · `setIncomeDetectionState(s: IncomeDetectionState): Promise<void>`
  - `listLoanPaymentTransactionIds(): Promise<string[]>` (read-only view over `loan_payments` — income rule 1 / loans rule 17 exclusion)
  - `type CandidateEvent = { transactionId: string; walletId: string; amount: Centavos; occurredAt: number; merchant: string | null }`
  - `selectCandidates(transactions: Transaction[], loanPaymentTxIds: Set<string>): CandidateEvent[]`
  - `primaryStream(events: CandidateEvent[]): CandidateEvent[]`

**Steps:**

- [ ] Write the failing repo test — `mobile/lib/db/repos/__tests__/income_repo.test.ts`:

  ```ts
  /** @jest-environment node */
  import { createTestDb } from "@/test/db_harness";
  import { setDbHandleForTests, type DbHandle } from "@/lib/db/db_handle";
  import {
    clearIncomeProfile, getIncomeDetectionState, getIncomeProfile,
    listLoanPaymentTransactionIds, saveIncomeProfile, setIncomeDetectionState,
  } from "../income_repo";

  let db: DbHandle;

  describe("income_repo", () => {
    beforeEach(async () => {
      db = await createTestDb();
      setDbHandleForTests(db);
    });
    afterEach(() => setDbHandleForTests(null));

    it("starts empty and upserts a singleton profile with source wallets", async () => {
      expect(await getIncomeProfile()).toBeNull();
      const p1 = await saveIncomeProfile({
        cadence: "kinsenas", averageAmount: 1850000,
        sourceWalletIds: ["w-bpi", "w-gcash"], isManualOverride: false,
      });
      expect(p1.cadence).toBe("kinsenas");
      expect(p1.averageAmount).toBe(1850000); // ₱18,500.00
      expect(p1.sourceWalletIds.sort()).toEqual(["w-bpi", "w-gcash"]);
      const p2 = await saveIncomeProfile({
        cadence: "weekly", averageAmount: 500000,
        sourceWalletIds: ["w-bpi"], isManualOverride: true,
      });
      expect(p2.id).toBe(p1.id); // singleton — same row updated
      expect(p2.isManualOverride).toBe(true);
      expect(p2.sourceWalletIds).toEqual(["w-bpi"]);
      expect(await getIncomeProfile()).toEqual(p2);
    });

    it("clearIncomeProfile removes the profile and its sources", async () => {
      await saveIncomeProfile({
        cadence: "monthly", averageAmount: 3000000, sourceWalletIds: ["w1"], isManualOverride: false,
      });
      await clearIncomeProfile();
      expect(await getIncomeProfile()).toBeNull();
      const rows = await db.getAllAsync("SELECT * FROM income_profile_sources");
      expect(rows).toEqual([]);
    });

    it("detection state defaults to unknown and round-trips through app_settings", async () => {
      const initial = await getIncomeDetectionState();
      expect(initial.status).toBe("unknown");
      expect(initial.missedWindows).toBe(0);
      const next = {
        status: "provisional" as const, cadence: "kinsenas" as const,
        averageAmount: 1850000, sourceWalletIds: ["w-bpi"],
        matchedTransactionIds: ["t1", "t2", "t3"],
        suggestionDismissedSignature: null, missedWindows: 0,
      };
      await setIncomeDetectionState(next);
      expect(await getIncomeDetectionState()).toEqual(next);
    });

    it("lists transaction ids referenced by loan_payments", async () => {
      await db.runAsync(
        `INSERT INTO loans (id, direction, counterparty, principal, interest_rate, schedule,
           linked_wallet_id, next_due_date, next_due_amount, created_at, updated_at)
         VALUES ('L1', 'owed-to-me', 'Juan', 500000, NULL, NULL, NULL, NULL, NULL, 0, 0)`);
      await db.runAsync(
        `INSERT INTO loan_payments (id, loan_id, transaction_id, amount, paid_at, kind, note, created_at)
         VALUES ('LP1', 'L1', 'tx-77', 100000, 0, 'payment', NULL, 0)`);
      await db.runAsync(
        `INSERT INTO loan_payments (id, loan_id, transaction_id, amount, paid_at, kind, note, created_at)
         VALUES ('LP2', 'L1', NULL, 50000, 0, 'adjustment', 'fee', 0)`);
      expect(await listLoanPaymentTransactionIds()).toEqual(["tx-77"]);
    });
  });
  ```

- [ ] Run it (expected: FAIL): `npx jest --ci lib/db/repos/__tests__/income_repo.test.ts`

- [ ] Add to `mobile/types/control.ts`:

  ```ts
  export type Cadence = "kinsenas" | "weekly" | "monthly" | "irregular";

  export type IncomeDetectionState = {
    status: "unknown" | "provisional" | "confirmed" | "lapsed";
    cadence: Cadence | null;
    averageAmount: Centavos | null;
    sourceWalletIds: string[];
    matchedTransactionIds: string[];
    suggestionDismissedSignature: string | null; // hash of last dismissed suggestion (income flow 2)
    missedWindows: number;                       // consecutive expected windows with no match (rule 13)
  };
  ```

  Implement `mobile/lib/db/repos/income_repo.ts`:

  ```ts
  import type { IncomeProfile } from "@/types/domain";
  import type { Cadence, IncomeDetectionState } from "@/types/control";
  import { getDbHandle } from "../db_handle";
  import { newId } from "@/lib/ids";

  const DETECTION_KEY = "income_detection_state";

  type ProfileRow = {
    id: string; cadence: Cadence; average_amount: number;
    is_manual_override: number; created_at: number; updated_at: number;
  };

  export async function getIncomeProfile(): Promise<IncomeProfile | null> {
    const db = await getDbHandle();
    const row = await db.getFirstAsync<ProfileRow>("SELECT * FROM income_profiles LIMIT 1");
    if (!row) return null;
    const sources = await db.getAllAsync<{ wallet_id: string }>(
      "SELECT wallet_id FROM income_profile_sources WHERE income_profile_id = ?", [row.id],
    );
    return {
      id: row.id, cadence: row.cadence, averageAmount: row.average_amount,
      sourceWalletIds: sources.map((s) => s.wallet_id),
      isManualOverride: row.is_manual_override === 1,
      createdAt: row.created_at, updatedAt: row.updated_at,
    } as IncomeProfile;
  }

  export async function saveIncomeProfile(input: {
    cadence: Cadence; averageAmount: number; sourceWalletIds: string[]; isManualOverride: boolean;
  }): Promise<IncomeProfile> {
    const db = await getDbHandle();
    const now = Date.now();
    const existing = await db.getFirstAsync<{ id: string }>("SELECT id FROM income_profiles LIMIT 1");
    const id = existing?.id ?? newId();
    if (existing) {
      await db.runAsync(
        "UPDATE income_profiles SET cadence=?, average_amount=?, is_manual_override=?, updated_at=? WHERE id=?",
        [input.cadence, input.averageAmount, input.isManualOverride ? 1 : 0, now, id],
      );
    } else {
      await db.runAsync(
        `INSERT INTO income_profiles (id, cadence, average_amount, is_manual_override, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.cadence, input.averageAmount, input.isManualOverride ? 1 : 0, now, now],
      );
    }
    await db.runAsync("DELETE FROM income_profile_sources WHERE income_profile_id = ?", [id]);
    for (const walletId of input.sourceWalletIds) {
      await db.runAsync(
        "INSERT INTO income_profile_sources (income_profile_id, wallet_id) VALUES (?, ?)",
        [id, walletId],
      );
    }
    return (await getIncomeProfile())!;
  }

  export async function clearIncomeProfile(): Promise<void> {
    const db = await getDbHandle();
    await db.runAsync("DELETE FROM income_profile_sources");
    await db.runAsync("DELETE FROM income_profiles");
  }

  export async function getIncomeDetectionState(): Promise<IncomeDetectionState> {
    const db = await getDbHandle();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?", [DETECTION_KEY],
    );
    if (!row) {
      return {
        status: "unknown", cadence: null, averageAmount: null, sourceWalletIds: [],
        matchedTransactionIds: [], suggestionDismissedSignature: null, missedWindows: 0,
      };
    }
    return JSON.parse(row.value) as IncomeDetectionState;
  }

  export async function setIncomeDetectionState(s: IncomeDetectionState): Promise<void> {
    const db = await getDbHandle();
    await db.runAsync(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [DETECTION_KEY, JSON.stringify(s)],
    );
  }

  /** Read-only cross-aggregate view: txs matched to any loan (income rule 1 exclusion). */
  export async function listLoanPaymentTransactionIds(): Promise<string[]> {
    const db = await getDbHandle();
    const rows = await db.getAllAsync<{ transaction_id: string }>(
      "SELECT transaction_id FROM loan_payments WHERE transaction_id IS NOT NULL",
    );
    return rows.map((r) => r.transaction_id);
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci lib/db/repos/__tests__/income_repo.test.ts`

- [ ] Commit:

  ```
  git add mobile/lib/db/repos/income_repo.ts mobile/types/control.ts mobile/lib/db/repos/__tests__/income_repo.test.ts
  git commit -m "feat(income): singleton income profile repo with detection state in app_settings"
  ```

- [ ] Write the failing candidates test — `mobile/lib/income/__tests__/candidates.test.ts`:

  ```ts
  import { primaryStream, selectCandidates, type CandidateEvent } from "../candidates";
  import type { Transaction } from "@/types/domain";

  const ms = (y: number, m: number, d: number) => new Date(y, m, d, 10).getTime();

  function tx(over: Partial<Transaction> & { id: string; amount: number; occurredAt: number }): Transaction {
    return {
      walletId: "w1", categoryId: "c1", direction: "in", merchant: "ACME PAYROLL",
      counterparty: null, referenceNo: null, source: "notification", confidence: 1,
      rawNotificationId: null, transferLinkId: null, note: null,
      createdAt: over.occurredAt, updatedAt: over.occurredAt, ...over,
    } as Transaction;
  }

  describe("selectCandidates (income rules 1–3)", () => {
    it("keeps committed inbound credits ≥ ₱500 and drops out/transfer/loan/small", () => {
      const txs = [
        tx({ id: "ok", amount: 1850000, occurredAt: ms(2026, 6, 15) }),
        tx({ id: "out", amount: 1850000, occurredAt: ms(2026, 6, 15), direction: "out" }),
        tx({ id: "transfer", amount: 1850000, occurredAt: ms(2026, 6, 15), transferLinkId: "tl1" }),
        tx({ id: "loanpay", amount: 1850000, occurredAt: ms(2026, 6, 15) }),
        tx({ id: "tiny", amount: 49900, occurredAt: ms(2026, 6, 15) }), // ₱499.00 < noise floor
        tx({ id: "edge", amount: 50000, occurredAt: ms(2026, 6, 16) }), // exactly ₱500.00 stays
      ];
      const out = selectCandidates(txs, new Set(["loanpay"]));
      expect(out.map((c) => c.transactionId).sort()).toEqual(["edge", "ok"]);
    });

    it("manual entries qualify (rule 3)", () => {
      const out = selectCandidates(
        [tx({ id: "m1", amount: 1850000, occurredAt: ms(2026, 6, 15), source: "manual" })],
        new Set(),
      );
      expect(out).toHaveLength(1);
    });

    it("excludes a refund: same amount, same merchant, within 7 days of a prior outflow (rule 2)", () => {
      const txs = [
        tx({ id: "buy", amount: 250000, occurredAt: ms(2026, 6, 10), direction: "out", merchant: "SHOPEE" }),
        tx({ id: "refund", amount: 250000, occurredAt: ms(2026, 6, 14), merchant: "SHOPEE" }),
        tx({ id: "late", amount: 250000, occurredAt: ms(2026, 6, 20), merchant: "SHOPEE" }), // > 7 days → keeps
      ];
      const ids = selectCandidates(txs, new Set()).map((c) => c.transactionId);
      expect(ids).toEqual(["late"]);
    });
  });

  describe("primaryStream (rule 4)", () => {
    const ev = (id: string, amount: number, day: number, merchant = "ACME PAYROLL", walletId = "w1"): CandidateEvent =>
      ({ transactionId: id, walletId, amount, occurredAt: ms(2026, 6, day), merchant });

    it("picks the largest recurring group by wallet+merchant+amount band", () => {
      const events = [
        ev("s1", 1850000, 1), ev("s2", 1900000, 15), ev("s3", 1820000, 30), ev("s4", 1850000, 31),
        ev("p1", 300000, 5, "PADALA JUAN", "w2"), ev("p2", 310000, 20, "PADALA JUAN", "w2"),
      ];
      const stream = primaryStream(events);
      expect(stream.map((e) => e.transactionId).sort()).toEqual(["s1", "s2", "s3", "s4"]);
    });

    it("splits the same merchant into bands when amounts differ beyond ±30% of the running median", () => {
      const events = [
        ev("a1", 1850000, 1), ev("a2", 1850000, 15),
        ev("b1", 100000, 2), ev("b2", 100000, 16), ev("b3", 100000, 28),
      ];
      // amounts 18,500 vs 1,000 cannot share a band even with identical wallet+merchant
      const stream = primaryStream(events);
      expect(stream.map((e) => e.transactionId).sort()).toEqual(["b1", "b2", "b3"]);
    });

    it("empty input yields an empty stream", () => {
      expect(primaryStream([])).toEqual([]);
    });
  });
  ```

- [ ] Run it (expected: FAIL): `npx jest --ci lib/income/__tests__/candidates.test.ts`

- [ ] Implement `mobile/lib/income/candidates.ts`:

  ```ts
  import type { Centavos, Transaction } from "@/types/domain";

  export type CandidateEvent = {
    transactionId: string; walletId: string; amount: Centavos;
    occurredAt: number; merchant: string | null;
  };

  const NOISE_FLOOR = 50_000;          // ₱500.00 (income rule 1)
  const REFUND_WINDOW_MS = 7 * 86_400_000;

  /** Income rules 1–3. `transactions` = committed ledger rows (both directions, for refund pairing). */
  export function selectCandidates(
    transactions: Transaction[], loanPaymentTxIds: Set<string>,
  ): CandidateEvent[] {
    const outflows = transactions.filter((t) => t.direction === "out");
    const isRefund = (t: Transaction): boolean =>
      !!t.merchant && outflows.some((o) =>
        o.merchant === t.merchant && o.amount === t.amount
        && t.occurredAt - o.occurredAt > 0 && t.occurredAt - o.occurredAt <= REFUND_WINDOW_MS,
      );
    return transactions
      .filter((t) =>
        t.direction === "in"
        && !t.transferLinkId               // internal movements are never income (invariant I2)
        && !loanPaymentTxIds.has(t.id)     // owed-to-me repayments are never income (loans rule 17)
        && t.amount >= NOISE_FLOOR
        && !isRefund(t))
      .map((t) => ({
        transactionId: t.id, walletId: t.walletId, amount: t.amount,
        occurredAt: t.occurredAt, merchant: t.merchant ?? null,
      }));
  }

  function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  /**
   * Income rule 4: group by (walletId, normalized merchant, amount within ±30% of the
   * group's running median); the largest group is the primary income stream.
   */
  export function primaryStream(events: CandidateEvent[]): CandidateEvent[] {
    type Group = { key: string; amounts: number[]; events: CandidateEvent[] };
    const groups: Group[] = [];
    const sorted = [...events].sort((a, b) => a.occurredAt - b.occurredAt);
    for (const e of sorted) {
      const key = `${e.walletId}|${(e.merchant ?? "").trim().toUpperCase()}`;
      const group = groups.find((g) => {
        if (g.key !== key) return false;
        const m = median(g.amounts);
        return Math.abs(e.amount - m) <= m * 0.3;
      });
      if (group) {
        group.amounts.push(e.amount);
        group.events.push(e);
      } else {
        groups.push({ key, amounts: [e.amount], events: [e] });
      }
    }
    if (!groups.length) return [];
    groups.sort((a, b) => b.events.length - a.events.length);
    return groups[0].events;
  }
  ```

- [ ] Run again (expected: PASS): `npx jest --ci lib/income/__tests__/candidates.test.ts`

- [ ] Commit:

  ```
  git add mobile/lib/income
  git commit -m "feat(income): candidate income events with refund exclusion and primary-stream grouping"
  ```

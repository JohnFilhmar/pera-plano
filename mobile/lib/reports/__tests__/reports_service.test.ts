// lib/reports/__tests__/reports_service.test.ts — M3b Task 2.
//
// The service layer's only job is picking a range under the caller's tier
// and delegating the arithmetic to aggregate.ts (Task 1). Every test here is
// named after the RULE it protects (docs/04-features/10-reports.md and the
// task-2 brief), not the mechanics.
//
// Date.now() is mocked to line up with `TODAY` because `listTransactions`'s
// tier-history floor (lib/db/repos/transactions_repo.ts) reads the real
// clock, not this service's `today` parameter — the same thing
// transactions_repo.test.ts does for its own history-window test. Nothing in
// reports_service.ts itself reads Date.now() (clock discipline); this mock
// only keeps the REPO layer's own clock-dependent gate deterministic.
import { closeDatabase } from "@/lib/db/database";
import {
  getTransaction,
  insertTransaction,
  listTransactions,
} from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { parseDateIso } from "@/lib/dates";
import { __setTierForTests } from "@/lib/entitlements";
import { summarizePeriod } from "@/lib/reports/aggregate";
import { availableScopes, getReport } from "@/lib/reports/reports_service";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";
import type { NewTransaction } from "@/types/domain";

const DAY_MS = 24 * 60 * 60 * 1000;
const CATEGORY_ID = "cat_food";
const TODAY = "2026-08-15";
// Noon on TODAY — an arbitrary time of day, chosen only so it is unambiguous
// this is a moment ON that date regardless of the machine's own timezone.
const NOW_MS = parseDateIso(TODAY).getTime() + 12 * 60 * 60 * 1000;

let db: SQLiteDatabase;
let walletId: string;

async function seedCategory(id: string, name: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, ?, NULL, 'circle-help', 1, 0, 0, 0)`,
    [id, name],
  );
}

/** A committed Transaction, defaulting to `NOW_MS`. Pass `date` for a plain calendar day. */
function baseTx(overrides: Partial<NewTransaction> & { date?: string } = {}): NewTransaction {
  const { date, occurredAt, ...rest } = overrides;
  return {
    walletId,
    categoryId: CATEGORY_ID,
    amount: 1000,
    direction: "out",
    source: "manual",
    confidence: 1,
    occurredAt: occurredAt ?? (date ? parseDateIso(date).getTime() : NOW_MS),
    ...rest,
  };
}

beforeEach(async () => {
  db = await freshDb();
  await seedCategory(CATEGORY_ID, "Food & Dining");
  walletId = (await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 0 })).id;
  jest.spyOn(Date, "now").mockReturnValue(NOW_MS);
});

afterEach(async () => {
  __setTierForTests(null);
  jest.restoreAllMocks();
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Rule 1 — Free is limited to the current month, full stop.
// ---------------------------------------------------------------------------

test("free tier's availableScopes offers only the current month and customAllowed: false", async () => {
  __setTierForTests("free");

  expect(await availableScopes(TODAY)).toEqual({
    months: ["2026-08"],
    customAllowed: false,
  });
});

test("a custom range on free silently clamps to the current month and sets truncatedByTier", async () => {
  __setTierForTests("free");
  await insertTransaction(baseTx({ date: "2026-08-05", amount: 12000, direction: "out" }));

  // Free has no custom range at all (customAllowed is always false) — this
  // asks for a period nowhere near August and must still land on August.
  const result = await getReport(
    { kind: "custom", range: { from: "2020-01-01", to: "2020-01-31" } },
    TODAY,
  );

  expect(result.truncatedByTier).toBe(true);
  expect(result.summary.range).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  expect(result.summary.spend).toBe(12000);
});

test("plus honors a custom range verbatim, unclamped — inclusive on both calendar ends", async () => {
  __setTierForTests("plus");
  await insertTransaction(baseTx({ date: "2026-07-10", amount: 5000, direction: "out" }));
  // Both boundary days count. (This alone does NOT pin fetchTransactions's
  // endOfLocalDay conversion — Plus also widens the underlying DB fetch to
  // cover the trailing trend window (up to August here), which happens to
  // extend past this range's own `to` and would mask that specific
  // regression. See the dedicated Free-tier test below, where nothing widens
  // the fetch, for the one that actually catches it.)
  await insertTransaction(baseTx({ date: "2026-07-01", amount: 100, direction: "out" })); // range.from
  await insertTransaction(baseTx({ date: "2026-07-31", amount: 200, direction: "out" })); // range.to
  // Outside the requested range — proves the range is exact, not padded.
  await insertTransaction(baseTx({ date: "2026-08-10", amount: 7000, direction: "out" }));

  const range = { from: "2026-07-01", to: "2026-07-31" };
  const result = await getReport({ kind: "custom", range }, TODAY);

  expect(result.truncatedByTier).toBe(false);
  expect(result.summary.range).toEqual(range);
  expect(result.summary.spend).toBe(5300);
});

test("the last calendar day of the range is not dropped by the half-open conversion", async () => {
  // Free, deliberately: rule 3 makes Free's trend collapse to exactly
  // `range` (lib/reports/reports_service.ts, `getReport`), so
  // fetchTransactions's DB window is exactly [range.from, range.to] with
  // nothing else widening it — unlike the Plus test above, where the
  // trailing trend window can accidentally cover this same boundary bug.
  // This is the tier that would actually go dark if fetchTransactions's
  // `endOfLocalDay` conversion regressed to a bare `parseDateIso`.
  __setTierForTests("free");
  await insertTransaction(baseTx({ date: "2026-08-01", amount: 100, direction: "out" })); // range.from
  await insertTransaction(baseTx({ date: "2026-08-31", amount: 200, direction: "out" })); // range.to

  const result = await getReport({ kind: "month", month: "2026-08" }, TODAY);

  expect(result.summary.spend).toBe(300);
});

// ---------------------------------------------------------------------------
// Rule 3 — Trend spans the trailing window on Plus, just the current month
// on Free.
// ---------------------------------------------------------------------------

test("plus's trend spans the trailing 6 months ending at today's month", async () => {
  __setTierForTests("plus");

  const result = await getReport({ kind: "month", month: "2026-08" }, TODAY);

  expect(result.trend.map((point) => point.range)).toEqual([
    { from: "2026-03-01", to: "2026-03-31" },
    { from: "2026-04-01", to: "2026-04-30" },
    { from: "2026-05-01", to: "2026-05-31" },
    { from: "2026-06-01", to: "2026-06-30" },
    { from: "2026-07-01", to: "2026-07-31" },
    { from: "2026-08-01", to: "2026-08-31" },
  ]);
});

// ---------------------------------------------------------------------------
// Rule 2 — History gating hides, it never deletes.
// ---------------------------------------------------------------------------

test("old data does not reach free-tier figures", async () => {
  await insertTransaction(baseTx({ date: "2026-08-05", amount: 8000, direction: "out" }));
  // ~120 days before TODAY: outside both the current month AND the 90-day
  // visibility floor, so it must not move this figure either way. NOTE: this
  // cannot isolate WHICH gate is doing the excluding — rule 1 always clamps
  // Free's range to the current month (≤31 days), so anything old enough to
  // trip the 90-day floor is also automatically outside the month, and this
  // test would pass identically if the floor did not exist. It pins the
  // end-to-end promise ("old data stays out of a Free report"), not the
  // floor specifically — see the task report's Decisions section for why
  // that isolation is structurally impossible under rule 1 as written.
  await insertTransaction(
    baseTx({ occurredAt: NOW_MS - 120 * DAY_MS, amount: 999999, direction: "out" }),
  );
  __setTierForTests("free");

  const result = await getReport({ kind: "month", month: "2026-08" }, TODAY);

  expect(result.summary.spend).toBe(8000);
});

test("older data is still present in the database afterward — history gating never deletes", async () => {
  const old = await insertTransaction(
    baseTx({ occurredAt: NOW_MS - 120 * DAY_MS, amount: 999999, direction: "out" }),
  );
  __setTierForTests("free");

  await getReport({ kind: "month", month: "2026-08" }, TODAY);

  // A genuine read-back, not an assertion about what getReport returned — a
  // report path could "work" today by soft-deleting or purging the row and
  // this test would still be the one to catch it, which is the whole point
  // of writing it as a fresh query rather than trusting the report's silence.
  const stillThere = await getTransaction(old.id);
  expect(stillThere).not.toBeNull();
  expect(stillThere?.amount).toBe(999999);
});

// ---------------------------------------------------------------------------
// Rule 4 — Nothing here recomputes aggregation.
// ---------------------------------------------------------------------------

test("getReport's summary matches summarizePeriod called directly over the same range and data", async () => {
  __setTierForTests("plus");
  await insertTransaction(baseTx({ date: "2026-08-03", amount: 10000, direction: "out" }));
  await insertTransaction(baseTx({ date: "2026-08-20", amount: 4000, direction: "in" }));
  // Outside August — must not leak into either computation.
  await insertTransaction(baseTx({ date: "2026-07-15", amount: 99999, direction: "out" }));

  const result = await getReport({ kind: "month", month: "2026-08" }, TODAY);

  const range = { from: "2026-08-01", to: "2026-08-31" };
  const allTransactions = await listTransactions({}); // plus: no history floor to worry about
  expect(result.summary).toEqual(summarizePeriod(allTransactions, range));
});

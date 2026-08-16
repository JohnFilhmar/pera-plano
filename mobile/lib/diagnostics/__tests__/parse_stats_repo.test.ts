// lib/diagnostics/__tests__/parse_stats_repo.test.ts — m3b Task 7 Step 1.
//
// Four behaviors named in the task brief, plus the schema-shape assertion the
// brief's rule 3 demands explicitly: this store must be STRUCTURALLY
// incapable of holding notification content, not merely conventionally
// well-behaved about it.
import { closeDatabase } from "@/lib/db/database";
import { freshDb } from "@/test_support/db";
import {
  clearParseStats,
  getParseStats,
  recordParseResult,
} from "../parse_stats_repo";
import type { SQLiteDatabase } from "@/lib/db/database";

const DAY_MS = 24 * 60 * 60 * 1000;

// A fixed local midday, so `startOfLocalDay` inside the repo lands on a
// predictable day boundary regardless of the machine running the test.
const DAY_ONE = new Date(2026, 7, 10, 12, 0).getTime();
const DAY_TWO = DAY_ONE + DAY_MS;

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

test("recording increments the right counter — ok increments parsed, not-ok increments failed", async () => {
  await recordParseResult("gcash", true, DAY_ONE);
  await recordParseResult("gcash", true, DAY_ONE);
  await recordParseResult("gcash", false, DAY_ONE);

  const stats = await getParseStats(0);

  expect(stats).toEqual([{ providerKey: "gcash", parsed: 2, failed: 1 }]);
});

test("stats aggregate per provider — two providers never share a counter", async () => {
  await recordParseResult("gcash", true, DAY_ONE);
  await recordParseResult("bpi-sms", false, DAY_ONE);
  await recordParseResult("bpi-sms", false, DAY_ONE);

  const stats = await getParseStats(0);

  expect(stats.sort((a, b) => a.providerKey.localeCompare(b.providerKey))).toEqual([
    { providerKey: "bpi-sms", parsed: 0, failed: 2 },
    { providerKey: "gcash", parsed: 1, failed: 0 },
  ]);
});

test("sinceMs filters older rows out of the aggregate", async () => {
  await recordParseResult("gcash", true, DAY_ONE);
  await recordParseResult("gcash", true, DAY_TWO);

  // A cutoff strictly between the two days: the older day's bucket start
  // falls before it, the newer day's falls on or after it.
  const cutoff = DAY_ONE + DAY_MS / 2;

  const stats = await getParseStats(cutoff);

  expect(stats).toEqual([{ providerKey: "gcash", parsed: 1, failed: 0 }]);

  // And widening the window back out recovers both days' counts, proving the
  // first result was really a filter and not silent data loss.
  expect(await getParseStats(0)).toEqual([{ providerKey: "gcash", parsed: 2, failed: 0 }]);
});

test("clear empties the table", async () => {
  await recordParseResult("gcash", true, DAY_ONE);
  await recordParseResult("bpi-sms", false, DAY_ONE);

  await clearParseStats();

  expect(await getParseStats(0)).toEqual([]);
});

test("clear is a no-op, not a throw, on an already-empty table", async () => {
  await expect(clearParseStats()).resolves.toBeUndefined();
  expect(await getParseStats(0)).toEqual([]);
});

test("a provider with nothing recorded in the window is absent, not zero-filled", async () => {
  await recordParseResult("gcash", true, DAY_ONE);

  const stats = await getParseStats(DAY_TWO);

  // DAY_ONE's row falls before the cutoff, so gcash has nothing in-window —
  // the caller (the success meter) decides how to render that, not this repo.
  expect(stats).toEqual([]);
});

test("two results for the same provider on the same day share one row", async () => {
  await recordParseResult("gcash", true, DAY_ONE);
  await recordParseResult("gcash", false, DAY_ONE + 60_000);

  const row = await db.getAllAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM parse_stats WHERE provider_key = 'gcash'",
  );
  expect(row[0]?.n).toBe(1);
});

// ---------------------------------------------------------------------------
// Brief rule 3 / interface contract §6: "local counts only; never content."
// This is the structural half of that promise — the migration's own column
// set leaves nowhere for a title, body, amount, or merchant to go.
// ---------------------------------------------------------------------------
test("the schema holds only counts — no column could carry notification content", async () => {
  const columns = await db.getAllAsync<{ name: string; type: string }>(
    "PRAGMA table_info(parse_stats)",
  );

  expect(columns.map((c) => ({ name: c.name, type: c.type }))).toEqual([
    { name: "id", type: "TEXT" },
    // A short catalogue key ("gcash", "bpi-sms"), not free text — the parser
    // catalogue's own identifier, never anything read off a captured
    // notification.
    { name: "provider_key", type: "TEXT" },
    { name: "day_start_at", type: "INTEGER" },
    { name: "parsed_count", type: "INTEGER" },
    { name: "failed_count", type: "INTEGER" },
    { name: "updated_at", type: "INTEGER" },
  ]);
});

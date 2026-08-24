// lib/diagnostics/parse_stats_repo.ts — m3b Task 7. The only SQL surface for
// `parse_stats` (migration 009) — the local, content-free parse-outcome
// counters behind the Parser diagnostics screen and (later) the telemetry
// opt-in's aggregate upload.
//
// COUNTS ONLY, NEVER CONTENT. docs/04-features/11-settings-privacy.md rule
// 15 and the interface contract's telemetry route both promise the same
// thing: what this store holds is numbers, never a notification's title,
// body, amount, or merchant. That is enforced structurally by the migration
// (five narrow columns, none of them free text) rather than by convention
// here — see `lib/db/migrations/009_parse_stats.sql`'s header and
// `__tests__/parse_stats_repo.test.ts`'s schema assertion.
//
// ONE ROW PER (providerKey, day). `recordParseResult` upserts into that row
// rather than appending an event, so the table stays bounded by
// providers x days rather than by notification volume — see the migration's
// header for why. `startOfLocalDay` is the same day-bucketing every other
// calendar question in this app already uses (`lib/dates.ts`).
import { getDatabase } from "@/lib/db/database";
import { startOfLocalDay } from "@/lib/dates";
import { newId } from "@/lib/ids";

/** Parsed vs. failed counts for one provider, aggregated over whatever window the caller asked for. */
export type ProviderParseStats = {
  providerKey: string;
  parsed: number;
  failed: number;
};

/**
 * Records one parse attempt's outcome for `providerKey`, bucketed onto the
 * local day `now` falls in.
 *
 * `now` is a REQUIRED parameter, never read from the clock in here — this is
 * a `lib/` module (see `lib/clock.ts`'s house rule) and the pipeline already
 * has an instant in hand for the capture it is processing; reading a fresh
 * one here could disagree with it across a day boundary.
 *
 * Increments exactly one counter: `parsed_count` when `ok`, `failed_count`
 * otherwise. The other counter, and every other provider's row, is untouched.
 */
export async function recordParseResult(
  providerKey: string,
  ok: boolean,
  now: number,
): Promise<void> {
  const db = await getDatabase();
  const dayStartAt = startOfLocalDay(now);

  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM parse_stats WHERE provider_key = ? AND day_start_at = ?",
    [providerKey, dayStartAt],
  );

  if (existing === null) {
    await db.runAsync(
      `INSERT INTO parse_stats (id, provider_key, day_start_at, parsed_count, failed_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), providerKey, dayStartAt, ok ? 1 : 0, ok ? 0 : 1, now],
    );
    return;
  }

  const column = ok ? "parsed_count" : "failed_count";
  await db.runAsync(
    // `column` is one of the two literal strings above, never caller input —
    // interpolating it is not a SQL-injection surface the way interpolating
    // `providerKey` would be.
    `UPDATE parse_stats SET ${column} = ${column} + 1, updated_at = ? WHERE id = ?`,
    [now, existing.id],
  );
}

/**
 * Parsed and failed counts per provider, summed across every day bucket
 * whose `day_start_at` falls on or after `sinceMs` — the rolling window Flow
 * G's diagnostics screen asks for (docs/04-features/11-settings-privacy.md).
 *
 * A provider with no rows in the window is simply absent from the result,
 * not present with zeros — the caller (the success meter) decides how to
 * render "no data yet" for a provider it otherwise knows about.
 */
export async function getParseStats(sinceMs: number): Promise<ProviderParseStats[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ provider_key: string; parsed: number; failed: number }>(
    `SELECT provider_key, SUM(parsed_count) AS parsed, SUM(failed_count) AS failed
     FROM parse_stats
     WHERE day_start_at >= ?
     GROUP BY provider_key
     ORDER BY provider_key`,
    [sinceMs],
  );
  return rows.map((row) => ({
    providerKey: row.provider_key,
    parsed: row.parsed,
    failed: row.failed,
  }));
}

/** Deletes every recorded count. A no-op, not a throw, when the table is already empty. */
export async function clearParseStats(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM parse_stats");
}

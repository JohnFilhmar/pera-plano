// lib/db/repos/limits_repo.ts — the only SQL surface for the Limit aggregate
// (interface contract §3; m2 Task 3). Same house shape as wallets_repo.ts:
// thin functions over getDatabase(), rowToLimit from lib/db/mappers.ts, domain
// types from types/domain.ts, no entitlement checks here (`canCreateLimit`
// lives at the UI layer — see lib/entitlements.ts).
//
// THE COLUMN NAMES ARE `*_json`. The m2 plan was drafted against
// `category_filter`, `wallet_filter` and `thresholds_fired`; 001_core.sql ships
// `category_filter_json`, `wallet_filter_json` and `thresholds_fired_json`.
// This is the class of error the interface contract's "Shipped reality" table
// exists for — it fails at runtime, not at compile time, so the repo tests run
// against the real migrations.
//
// PER-PERIOD ALERT STATE SPANS TWO COLUMNS, AND ONE UPDATE. `fired[]` lives in
// `thresholds_fired_json`, which is also the domain field `Limit.thresholdsFired`
// (docs/02-domain-model.md §3.5); the other five fields live in
// `limit_alert_state_json` (migration 004). `setLimitAlertState` writes both in
// a single statement, because a period boundary resets `fired` and re-snapshots
// `base` together and must never half-apply. Migration 004's header records why
// the plan's original design — the whole object in `thresholds_fired` — was not
// possible, and why an `app_settings` map was rejected in its place.
import { getDatabase } from "@/lib/db/database";
import { rowToLimit, type LimitRow } from "@/lib/db/mappers";
import { newId } from "@/lib/ids";
import type { Limit, LimitThreshold } from "@/types/domain";
import type { LimitAlertState, NewLimit } from "@/types/control";

/**
 * Thrown by `updateLimit` and `setLimitAlertState` when `id` has no row — the
 * shape wallets_repo.ts and categories_repo.ts already use. `deleteLimit` does
 * NOT throw it: deleting is idempotent, and a caller retrying a delete is
 * asking for a state that already holds.
 */
export class LimitNotFoundError extends Error {
  constructor(public readonly limitId: string) {
    super(`limit not found: ${limitId}`);
    this.name = "LimitNotFoundError";
  }
}

/**
 * `null` for absent AND for empty.
 *
 * The empty case is the one that matters: NULL means "count every category",
 * while a stored `"[]"` would read as "count transactions whose category is in
 * the empty set" — a limit that can never be reached and therefore never
 * alerts. A UI that hands back an emptied multi-select must mean the former.
 */
function encodeFilter(filter: string[] | null | undefined): string | null {
  return filter && filter.length > 0 ? JSON.stringify(filter) : null;
}

/** The persisted half of the alert state — everything except `fired`. */
type StoredAlertState = Omit<LimitAlertState, "fired">;

export async function createLimit(input: NewLimit): Promise<Limit> {
  const db = await getDatabase();
  const now = Date.now();
  const id = newId();

  await db.runAsync(
    `INSERT INTO limits (id, scope, basis, value, category_filter_json, wallet_filter_json,
                         rollover, is_active, thresholds_fired_json, created_at, updated_at,
                         limit_alert_state_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, NULL)`,
    [
      id,
      input.scope,
      input.basis,
      input.value,
      encodeFilter(input.categoryFilter),
      encodeFilter(input.walletFilter),
      input.rollover ? 1 : 0,
      // `=== false`, not `?? true` inverted: `isActive` defaults to ON, and only
      // an explicit `false` turns it off. An omitted field must not create a
      // limit the user cannot see working.
      input.isActive === false ? 0 : 1,
      now,
      now,
    ],
  );

  // Read back rather than construct: the row is what every later read returns,
  // so a mapping bug shows up on the very first call instead of on the reload.
  const created = await getLimit(id);
  if (created === null) throw new LimitNotFoundError(id);
  return created;
}

export async function getLimit(id: string): Promise<Limit | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<LimitRow>("SELECT * FROM limits WHERE id = ?", [id]);
  return row ? rowToLimit(row) : null;
}

export async function listLimits(opts?: { activeOnly?: boolean }): Promise<Limit[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LimitRow>(
    opts?.activeOnly
      ? "SELECT * FROM limits WHERE is_active = 1 ORDER BY created_at"
      : "SELECT * FROM limits ORDER BY created_at",
  );
  return rows.map(rowToLimit);
}

/**
 * Patches a limit. Fields the patch omits keep their current values.
 *
 * `categoryFilter` and `walletFilter` are checked with `!== undefined` rather
 * than `??`, so an explicit `null` CLEARS the filter while omitting it
 * preserves one. With `??` those two requests would be identical and a user
 * could narrow a limit to a category but never widen it back.
 *
 * DOES NOT TOUCH `thresholds_fired_json` OR `limit_alert_state_json`. Limits
 * rule 1 says an edit takes effect immediately and thresholds are RE-EVALUATED
 * against the new effective limit — which needs `fired` and `lastSpend` to
 * still be there. Rewriting every column would wipe them and re-arm every
 * threshold the user has already been alerted for.
 */
export async function updateLimit(id: string, patch: Partial<NewLimit>): Promise<Limit> {
  const db = await getDatabase();
  const current = await getLimit(id);
  if (current === null) throw new LimitNotFoundError(id);

  const merged = {
    scope: patch.scope ?? current.scope,
    basis: patch.basis ?? current.basis,
    value: patch.value ?? current.value,
    categoryFilter:
      patch.categoryFilter !== undefined ? patch.categoryFilter : current.categoryFilter,
    walletFilter: patch.walletFilter !== undefined ? patch.walletFilter : current.walletFilter,
    rollover: patch.rollover ?? current.rollover,
    isActive: patch.isActive ?? current.isActive,
  };

  await db.runAsync(
    `UPDATE limits
        SET scope = ?, basis = ?, value = ?, category_filter_json = ?, wallet_filter_json = ?,
            rollover = ?, is_active = ?, updated_at = ?
      WHERE id = ?`,
    [
      merged.scope,
      merged.basis,
      merged.value,
      encodeFilter(merged.categoryFilter),
      encodeFilter(merged.walletFilter),
      merged.rollover ? 1 : 0,
      merged.isActive ? 1 : 0,
      Date.now(),
      id,
    ],
  );

  const updated = await getLimit(id);
  if (updated === null) throw new LimitNotFoundError(id);
  return updated;
}

/**
 * Deletes a limit. Idempotent — deleting an id that is already gone is not an
 * error. Never touches Transactions (m2 Global Constraint 11): a limit is a
 * view over the ledger, and removing the view removes no money.
 */
export async function deleteLimit(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM limits WHERE id = ?", [id]);
}

/**
 * The engine's working memory for this limit, or `null` if it has never been
 * evaluated.
 *
 * PRESENCE IS KEYED ON `limit_alert_state_json` ALONE, never on
 * `thresholds_fired_json` being empty. That column is NOT NULL with a `'[]'`
 * default, so emptiness there is the state of a limit that has never been
 * evaluated AND of a period whose first evaluation fired nothing. Confusing the
 * two would make the engine re-snapshot `base` on every ledger commit, which
 * for a percent-of-income limit means the base silently tracking income
 * mid-period instead of being fixed at the boundary (limits rule 11).
 */
export async function getLimitAlertState(limitId: string): Promise<LimitAlertState | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    thresholds_fired_json: string;
    limit_alert_state_json: string | null;
  }>("SELECT thresholds_fired_json, limit_alert_state_json FROM limits WHERE id = ?", [limitId]);

  if (!row || row.limit_alert_state_json === null) return null;

  const stored = JSON.parse(row.limit_alert_state_json) as StoredAlertState;
  return {
    ...stored,
    fired: JSON.parse(row.thresholds_fired_json ?? "[]") as LimitThreshold[],
  };
}

/**
 * Replaces the whole state. NOT a merge — a period boundary resets `fired` to
 * `[]` (docs/02-domain-model.md §3.5), and a merge would carry the previous
 * period's thresholds forward and silence every one of them for the new period.
 *
 * ONE UPDATE, BOTH COLUMNS. See this file's header and migration 004.
 */
export async function setLimitAlertState(
  limitId: string,
  state: LimitAlertState,
): Promise<void> {
  const db = await getDatabase();
  const { fired, ...stored } = state;

  const result = await db.runAsync(
    "UPDATE limits SET thresholds_fired_json = ?, limit_alert_state_json = ? WHERE id = ?",
    [JSON.stringify(fired), JSON.stringify(stored), limitId],
  );

  // A silent no-op here would leave the engine believing it had persisted a
  // period boundary it had not, and it would re-fire every threshold on the
  // next commit.
  if (result.changes === 0) throw new LimitNotFoundError(limitId);
}

// lib/db/repos/parser_rulesets_repo.ts — the only SQL surface for the
// versioned parser ruleset (interface contract §3). Same house shape as
// wallets_repo.ts: thin functions over getDatabase(), domain types imported
// (here from lib/ingest/ruleset_types.ts, which owns the shape shared verbatim
// with the server), no entitlement checks.
//
// SHIPPED SCHEMA (mobile/lib/db/migrations/001_core.sql):
//
//   CREATE TABLE parser_rulesets (
//     id TEXT PRIMARY KEY NOT NULL,
//     version INTEGER NOT NULL UNIQUE,
//     payload_json TEXT NOT NULL,
//     installed_at INTEGER NOT NULL
//   );
//
// Two properties of that DDL drive everything below. `version` is UNIQUE, so
// re-installing a version already present is not a harmless double-write — it
// THROWS. And there is no singleton `id = 'current'` row (some plans assumed
// one): "current" means the highest `version`, and superseded rows stay on
// disk so a bad ruleset can be rolled back to its predecessor (spec §11.2).
//
// This file is the only place that knows the bundle is stored as JSON. Rule 1
// of the task: callers see `RulesetBundle`, never `payload_json`.
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import {
  DEFAULT_TUNABLES,
  type PartialPipelineTunables,
  type PipelineTunables,
  type RulesetBundle,
  type RulesetBundleInput,
} from "@/lib/ingest/ruleset_types";
import type { SQLiteDatabase } from "@/lib/db/database";

type RulesetRow = { version: number; payload_json: string };

/**
 * Completes a partial (or absent) `tunables` from the defaults, one level
 * deep — the nested `penalties` object merges field-by-field too, so a payload
 * that overrides one penalty does not blank the other four.
 *
 * This runs on READ, not on write, and the distinction matters: the row keeps
 * the server's payload verbatim, so a tunable the payload never mentioned
 * tracks whatever DEFAULT_TUNABLES says today. Merging at write time would
 * freeze the defaults as they were the day the bundle was installed, and a
 * recalibrated constant shipped in an app update would silently not apply.
 */
function withDefaultTunables(partial: PartialPipelineTunables | undefined): PipelineTunables {
  return {
    ...DEFAULT_TUNABLES,
    ...partial,
    penalties: { ...DEFAULT_TUNABLES.penalties, ...partial?.penalties },
  };
}

/**
 * Decodes one row, or returns `null` if its payload is unusable.
 *
 * `upsertRuleset` is the only writer and always writes `JSON.stringify`
 * output, so this should never fire in normal operation — but a partially
 * restored backup or a future migration writing the table directly can still
 * leave a row that will not parse, exactly as `app_settings_repo` documents
 * for its own `value_json`. Throwing here would take down the whole ingest
 * pipeline with no recovery; returning `null` lets the caller fall back to
 * the previous good version, which is the same rollback behaviour spec §11.2
 * requires of a bad ruleset. The corruption is logged rather than swallowed —
 * a device silently running a ruleset older than the one it reports installed
 * is its own debugging nightmare.
 */
function decodeRow(row: RulesetRow): RulesetBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload_json);
  } catch {
    console.warn(
      `parser_rulesets_repo: unparseable payload_json at version ${row.version} — falling back to the previous version`,
    );
    return null;
  }

  if (parsed === null || typeof parsed !== "object") {
    console.warn(
      `parser_rulesets_repo: payload_json at version ${row.version} is not an object — falling back to the previous version`,
    );
    return null;
  }

  const input = parsed as Partial<RulesetBundleInput>;
  if (!Array.isArray(input.providers)) {
    console.warn(
      `parser_rulesets_repo: payload_json at version ${row.version} has no providers array — falling back to the previous version`,
    );
    return null;
  }

  return {
    // The COLUMN's version, not the payload's: `version` is the UNIQUE key the
    // no-downgrade guard and `getActiveVersion` both compare against, so the
    // bundle handed out can never disagree with the row it came from.
    version: row.version,
    providers: input.providers,
    tunables: withDefaultTunables(input.tunables),
  };
}

/**
 * Walks versions newest-first and returns the first one that decodes. The
 * happy path reads exactly one row; each additional read only happens because
 * the row above it was corrupt, which is why this is a walk rather than a
 * `SELECT *` of the whole table (the table grows by one row per installed
 * ruleset version and is never pruned).
 */
async function loadNewestUsable(db: SQLiteDatabase): Promise<RulesetBundle | null> {
  let row = await db.getFirstAsync<RulesetRow>(
    "SELECT version, payload_json FROM parser_rulesets ORDER BY version DESC LIMIT 1",
  );
  while (row) {
    const bundle = decodeRow(row);
    if (bundle) {
      return bundle;
    }
    row = await db.getFirstAsync<RulesetRow>(
      "SELECT version, payload_json FROM parser_rulesets WHERE version < ? ORDER BY version DESC LIMIT 1",
      [row.version],
    );
  }
  return null;
}

/**
 * The ruleset the pipeline should parse with: the highest-version bundle the
 * device can actually read. `null` only when the table is empty (or every row
 * in it is corrupt) — a state the bundled seed (Task 2) exists to prevent, so
 * that the app parses fully offline and on first run (spec §11.5).
 */
export async function getActiveRuleset(): Promise<RulesetBundle | null> {
  const db = await getDatabase();
  return loadNewestUsable(db);
}

/**
 * Installs `bundle`, unless an equal-or-higher version is already present.
 *
 * Never downgrades (rule 2): a stale server response — a cached CDN body, a
 * response that raced a newer one — must not regress a device's parsers. The
 * guard is part of the INSERT rather than a read-then-write, so two callers
 * racing (bootstrap's `seedParserRules()` and a server fetch can be in flight
 * together) cannot both observe the same `MAX(version)` before either writes
 * and have the loser die on the UNIQUE constraint. A no-op writes nothing at
 * all and is not an error.
 *
 * The payload is stored exactly as supplied — including absent or partial
 * `tunables`, which `getActiveRuleset` completes on the way out (see
 * `withDefaultTunables`).
 */
export async function upsertRuleset(bundle: RulesetBundleInput): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO parser_rulesets (id, version, payload_json, installed_at)
     SELECT ?, ?, ?, ?
     WHERE ? > (SELECT COALESCE(MAX(version), 0) FROM parser_rulesets)`,
    [newId(), bundle.version, JSON.stringify(bundle), Date.now(), bundle.version],
  );
}

/**
 * The installed version, `0` when the device has never installed one — never
 * `null`, so callers can branch on `0` without "never fetched" and "the read
 * failed" collapsing into the same value.
 *
 * This is `MAX(version)`: the same expression `upsertRuleset`'s guard compares
 * against, and the value that goes out as `?since_version=` (contract §7). The
 * two must agree, or a caller told "you are on version N" could hand N back to
 * `upsertRuleset` and watch it no-op for no visible reason. In the corrupt-row
 * case this can exceed `getActiveRuleset()!.version`, which reports the newest
 * version actually usable — deliberately: one answers "what is installed", the
 * other "what am I parsing with".
 */
export async function getActiveVersion(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0) AS version FROM parser_rulesets",
  );
  return row?.version ?? 0;
}

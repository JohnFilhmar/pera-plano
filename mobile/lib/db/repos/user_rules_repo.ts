// lib/db/repos/user_rules_repo.ts — the only SQL surface for the UserRule
// aggregate (docs/02-domain-model.md §3.11). Same house shape as
// wallets_repo.ts: thin functions over getDatabase(), domain types from
// types/domain.ts, no entitlement checks (rule replay is ungated — §3.11
// "Tier note").
//
// SHIPPED SCHEMA (mobile/lib/db/migrations/001_core.sql):
//
//   CREATE TABLE user_rules (
//     id TEXT PRIMARY KEY NOT NULL,
//     matcher_json TEXT NOT NULL,
//     action_json TEXT NOT NULL,
//     priority INTEGER NOT NULL,
//     is_enabled INTEGER NOT NULL DEFAULT 1,
//     created_from TEXT,
//     applied_count INTEGER NOT NULL DEFAULT 0,
//     last_applied_at INTEGER,
//     created_at INTEGER NOT NULL,
//     updated_at INTEGER NOT NULL
//   );
//
// TWO JSON COLUMNS, and this file is the only place that knows it — exactly as
// parser_rulesets_repo.ts owns `payload_json`. Callers see `UserRuleMatcher`
// and `UserRuleAction`; nobody outside builds or reads those strings.
//
// The m1b plan (Task 8) sketched a flat `UserRuleKind` union
// ("merchant_category" | "provider_wallet" | "ignore_pattern"). No such type
// exists: types/domain.ts ships a matcher/action pair, and the plan's three
// kinds are three ACTION kinds — `set-category`, `set-wallet`, `ignore`. The
// filter below is therefore keyed on `UserRuleAction["kind"]`, which covers all
// six shipped actions rather than the three the plan happened to name.
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import type { EpochMs, UserRule, UserRuleAction, UserRuleMatcher } from "@/types/domain";

/**
 * A rule to create. `matcher` and `action` are required; everything else has a
 * sensible default so the Review Queue's one-tap "always do this" path does not
 * have to invent evaluation metadata it has no opinion about.
 *
 * `createdFrom` is optional here but is invariant I15 / §3.11 invariant 1 ("every
 * UserRule is traceable to `createdFrom`") in spirit: the column is nullable
 * because rules created outside a correction flow exist, and this repo records
 * what it is given rather than fabricating provenance.
 */
export type NewUserRule = {
  matcher: UserRuleMatcher;
  action: UserRuleAction;
  /** Evaluation order, higher first. Defaults to 0. */
  priority?: number;
  /** Defaults to `true`; the user can disable a rule without deleting it. */
  isEnabled?: boolean;
  /** The originating Review Queue item or Transaction id. Defaults to `null`. */
  createdFrom?: string | null;
};

type UserRuleRow = {
  id: string;
  matcher_json: string;
  action_json: string;
  priority: number;
  is_enabled: number;
  created_from: string | null;
  applied_count: number;
  last_applied_at: number | null;
  created_at: number;
  updated_at: number;
};

/** Every action kind types/domain.ts ships, for validating what came off disk. */
const ACTION_KINDS: ReadonlySet<string> = new Set<UserRuleAction["kind"]>([
  "set-category",
  "set-wallet",
  "set-merchant",
  "mark-transfer",
  "suppress-recurring",
  "ignore",
]);

/** `JSON.parse` that answers `undefined` instead of throwing. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decodes one row, or returns `null` if either JSON column is unusable.
 *
 * WHY THIS DOES NOT THROW. `createUserRule` is the only writer and always
 * writes `JSON.stringify` output, so a bad row means a partially restored
 * backup or a future migration writing the table directly — the same class of
 * damage app_settings_repo's `decodeStoredValue` and parser_rulesets_repo's
 * `decodeRow` already absorb. The cost of being strict here is far worse than
 * theirs, though: `listUserRules` feeds the Categorizer, so one unparseable row
 * throwing would return NO rules at all, and every transaction from then on
 * would quietly lose every correction the user has ever made. §8 rule 2 is
 * "user corrections must stick"; a thrown SyntaxError unsticks all of them at
 * once, with nothing on screen to explain it. Dropping the single bad row costs
 * that one rule and keeps the rest replaying.
 *
 * `null` and arrays are rejected alongside parse failures: `JSON.parse("null")`
 * succeeds, and a null matcher only fails later, at match time, inside the
 * pipeline. An action is additionally required to carry a known `kind` — a
 * kindless action reaches the categorizer's `action.kind` comparison as
 * `undefined` and matches nothing, which looks exactly like a rule that simply
 * never fires.
 *
 * The corruption is logged rather than swallowed: a rule that silently stops
 * applying is its own debugging nightmare, and this is the one place the app
 * can notice.
 */
function decodeRow(row: UserRuleRow): UserRule | null {
  const matcher = parseJson(row.matcher_json);
  if (!isPlainObject(matcher)) {
    console.warn(`user_rules_repo: unusable matcher_json on rule ${row.id} — skipping the rule`);
    return null;
  }

  const action = parseJson(row.action_json);
  if (!isPlainObject(action) || typeof action.kind !== "string" || !ACTION_KINDS.has(action.kind)) {
    console.warn(`user_rules_repo: unusable action_json on rule ${row.id} — skipping the rule`);
    return null;
  }

  return {
    id: row.id,
    matcher: matcher as UserRuleMatcher,
    action: action as unknown as UserRuleAction,
    priority: row.priority,
    isEnabled: row.is_enabled === 1,
    createdFrom: row.created_from,
    appliedCount: row.applied_count,
    lastAppliedAt: row.last_applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Creates a rule and returns it as stored.
 *
 * `now` is injectable (Global Constraint: no bare `Date.now()` in a testable
 * path) and defaults to the wall clock for the app's own call sites. It matters
 * more than usual here because `created_at` is part of the ORDER BY below — a
 * test that could not pin it could not pin the tie-break either.
 */
export async function createUserRule(input: NewUserRule, now: number = Date.now()): Promise<UserRule> {
  const db = await getDatabase();
  const rule: UserRule = {
    id: newId(),
    matcher: input.matcher,
    action: input.action,
    priority: input.priority ?? 0,
    isEnabled: input.isEnabled ?? true,
    createdFrom: input.createdFrom ?? null,
    appliedCount: 0,
    lastAppliedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.runAsync(
    `INSERT INTO user_rules
       (id, matcher_json, action_json, priority, is_enabled, created_from,
        applied_count, last_applied_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rule.id,
      JSON.stringify(rule.matcher),
      JSON.stringify(rule.action),
      rule.priority,
      rule.isEnabled ? 1 : 0,
      rule.createdFrom,
      rule.appliedCount,
      rule.lastAppliedAt,
      rule.createdAt,
      rule.updatedAt,
    ],
  );

  return rule;
}

/**
 * Every rule, in evaluation order, optionally narrowed to one action kind.
 *
 * ORDER (also documented on `categorizer.ts`, which re-establishes it rather
 * than trusting the caller's array):
 *   1. `priority` DESC — higher priority evaluates first.
 *   2. `created_at` DESC — §3.11: "Later-created rules evaluate first." A
 *      newer correction is the user's more recent intent.
 *   3. `id` ASC — two rules can share a millisecond (a bulk correction writes
 *      several at once), and "whatever SQLite scanned first" is not an answer.
 *      This makes the order total, so the same rule set always resolves the
 *      same way on every device.
 *
 * DISABLED RULES ARE INCLUDED. The settings screen has to list a rule the user
 * turned off in order to let them turn it back on. Honouring `isEnabled` is the
 * consumer's job — `categorizer.ts` drops them explicitly.
 *
 * The `kind` filter runs in JS, not SQL. Reaching into `action_json` would mean
 * `json_extract` (a JSON1 dependency this repo does not otherwise take), and a
 * row too corrupt to parse cannot be classified by SQL anyway — it has to reach
 * `decodeRow` to be reported and dropped.
 */
export async function listUserRules(kind?: UserRuleAction["kind"]): Promise<UserRule[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<UserRuleRow>(
    `SELECT id, matcher_json, action_json, priority, is_enabled, created_from,
            applied_count, last_applied_at, created_at, updated_at
       FROM user_rules
      ORDER BY priority DESC, created_at DESC, id ASC`,
  );

  const rules: UserRule[] = [];
  for (const row of rows) {
    const rule = decodeRow(row);
    if (rule && (kind === undefined || rule.action.kind === kind)) {
      rules.push(rule);
    }
  }
  return rules;
}

/**
 * Deletes one rule. A no-op (not a throw) when the id is not present — §3.11
 * lists deletion as a user action, and a rule already gone is the outcome the
 * caller asked for.
 */
export async function deleteUserRule(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM user_rules WHERE id = ?", [id]);
}

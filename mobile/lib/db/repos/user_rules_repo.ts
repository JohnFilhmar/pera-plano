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
import { z } from "zod";

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

/**
 * The matcher column's shape, validated field by field (GAP-057). Unknown keys
 * are dropped rather than refused: they mean nothing to `matcherApplies`.
 */
const userRuleMatcherSchema = z.object({
  providerKey: z.string().optional(),
  merchantPattern: z.string().optional(),
  direction: z.enum(["in", "out"]).optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
}) satisfies z.ZodType<UserRuleMatcher>;

/**
 * The action column's shape: one variant per kind types/domain.ts ships, each
 * carrying the field that kind acts on (GAP-057).
 *
 * `mark-loan-payment`'s loan id has to be non-blank as well as present. `""`
 * is not an id any loan has ever had, and a rule that matches transactions and
 * points at nothing is the failure docs/09-v2-backlog.md §2b.4 calls worse
 * than the rule's absence.
 */
const userRuleActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set-category"), categoryId: z.string() }),
  z.object({ kind: z.literal("set-wallet"), walletId: z.string() }),
  z.object({ kind: z.literal("set-merchant"), merchant: z.string() }),
  z.object({ kind: z.literal("mark-transfer"), counterpartWalletId: z.string() }),
  z.object({
    kind: z.literal("mark-loan-payment"),
    loanId: z.string().refine((loanId) => loanId.trim() !== ""),
  }),
  z.object({ kind: z.literal("suppress-recurring"), merchant: z.string() }),
  z.object({ kind: z.literal("ignore") }),
]) satisfies z.ZodType<UserRuleAction>;

/**
 * What `satisfies` cannot see, checked at compile time: a kind added to
 * UserRuleAction, or a field added to UserRuleMatcher, that the schemas above do
 * not know. Either would be dropped silently on read, and every rule carrying it
 * with it.
 */
type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const actionKindsCovered: SameMembers<
  z.infer<typeof userRuleActionSchema>["kind"],
  UserRuleAction["kind"]
> = true;
const matcherFieldsCovered: SameMembers<
  keyof z.infer<typeof userRuleMatcherSchema>,
  keyof UserRuleMatcher
> = true;
void actionKindsCovered;
void matcherFieldsCovered;

/** `JSON.parse` that answers `undefined` instead of throwing. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
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
 * EVERY FIELD IS VALIDATED, NOT CAST (GAP-057). The checks here used to cover
 * what a crash had already been seen on, and then cast the rest. A known kind
 * missing its own field still decoded, and a `set-category` rule with no
 * category handed insertTransaction `undefined` on every capture it matched.
 * The schemas above refuse any row the domain types cannot describe: `null`,
 * an array, an unknown kind, a missing field, a field of the wrong type.
 * REFUSED, NEVER DEFAULTED: a default would be a guess about where the user's
 * money went, repeated on every notification the rule matched.
 *
 * The corruption is logged rather than swallowed: a rule that silently stops
 * applying is its own debugging nightmare, and this is the one place the app
 * can notice.
 */
function decodeRow(row: UserRuleRow): UserRule | null {
  const matcher = userRuleMatcherSchema.safeParse(parseJson(row.matcher_json));
  if (!matcher.success) {
    console.warn(`user_rules_repo: unusable matcher_json on rule ${row.id} — skipping the rule`);
    return null;
  }

  const action = userRuleActionSchema.safeParse(parseJson(row.action_json));
  if (!action.success) {
    console.warn(`user_rules_repo: unusable action_json on rule ${row.id} — skipping the rule`);
    return null;
  }

  return {
    id: row.id,
    matcher: matcher.data,
    action: action.data,
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
 * Turns one rule on or off, leaving everything else about it untouched
 * (review-queue rule 16, GAP-128).
 *
 * DISABLING IS NOT DELETING, and rule 16 asks for both because they answer
 * different worries. A user who suspects a rule is miscategorizing wants to
 * silence it and watch what happens next; only someone certain wants it gone.
 * A disabled rule keeps its `appliedCount` and its matcher, so turning it back
 * on restores exactly what was there.
 *
 * Nothing already committed changes. This writes one column on one row, and
 * `categorizer.ts` reads `isEnabled` on the NEXT categorization — there is no
 * replay of past transactions in either direction, which is the same guarantee
 * rule 16 states for deletion.
 *
 * A no-op (not a throw) when the id is not present, matching
 * [deleteUserRule]'s contract: a screen that refetches while the user presses
 * a toggle can hand this an id that has just gone, and the state the caller
 * asked for is the state that holds.
 *
 * @param id - The rule to change. An unknown id does nothing.
 * @param isEnabled - `true` lets it fire again, `false` silences it.
 * @param now - Stamp for `updated_at`; defaults to the wall clock.
 */
export async function setUserRuleEnabled(
  id: string,
  isEnabled: boolean,
  now: number = Date.now(),
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("UPDATE user_rules SET is_enabled = ?, updated_at = ? WHERE id = ?", [
    isEnabled ? 1 : 0,
    now,
    id,
  ]);
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

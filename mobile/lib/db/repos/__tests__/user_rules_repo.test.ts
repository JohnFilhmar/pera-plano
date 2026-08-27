import { closeDatabase } from "@/lib/db/database";
import { freshDb } from "@/test_support/db";
import { createUserRule, deleteUserRule, listUserRules } from "../user_rules_repo";
import type { SQLiteDatabase } from "@/lib/db/database";

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

/** Fixed stamps so `created_at` never depends on how fast the suite runs. */
const T0 = 1_700_000_000_000;

/** Inserts a row the repo's own writer would never produce — corrupt-row cases only. */
async function insertRawRule(values: {
  id: string;
  matcherJson: string;
  actionJson: string;
  priority?: number;
  createdAt?: number;
}): Promise<void> {
  await db.runAsync(
    `INSERT INTO user_rules
       (id, matcher_json, action_json, priority, is_enabled, created_from,
        applied_count, last_applied_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, NULL, 0, NULL, ?, ?)`,
    [
      values.id,
      values.matcherJson,
      values.actionJson,
      values.priority ?? 0,
      values.createdAt ?? T0,
      values.createdAt ?? T0,
    ],
  );
}

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

test("create-then-list round-trips the rule, including its nested matcher and action", async () => {
  const created = await createUserRule(
    {
      matcher: { providerKey: "gcash", merchantPattern: "JUAN D", direction: "out" },
      action: { kind: "set-category", categoryId: "cat_utang_loan_payments" },
      priority: 20,
      createdFrom: "review_item_7",
    },
    T0,
  );

  const [listed] = await listUserRules();

  // The nested objects are the whole point: they live in TEXT columns, and a
  // repo that stringified the wrong thing still returns a plausible-looking row.
  expect(listed).toEqual(created);
  expect(listed.matcher.merchantPattern).toBe("JUAN D");
  expect(listed.matcher.providerKey).toBe("gcash");
  expect(listed.matcher.direction).toBe("out");
  expect(listed.action).toEqual({ kind: "set-category", categoryId: "cat_utang_loan_payments" });
  expect(listed.priority).toBe(20);
  expect(listed.createdFrom).toBe("review_item_7");
  expect(listed.createdAt).toBe(T0);
});

test("an amount-range matcher round-trips its bounds, including a zero floor", async () => {
  await createUserRule(
    {
      matcher: { amountMin: 0, amountMax: 50_000 },
      action: { kind: "ignore" },
    },
    T0,
  );

  const [listed] = await listUserRules();

  // `0` is the value a `??`/`||` default silently replaces.
  expect(listed.matcher.amountMin).toBe(0);
  expect(listed.matcher.amountMax).toBe(50_000);
});

test("createUserRule defaults priority, isEnabled, createdFrom and the stats fields", async () => {
  const created = await createUserRule(
    {
      matcher: { merchantPattern: "MERALCO" },
      action: { kind: "mark-transfer", counterpartWalletId: "w_meralco_source" },
    },
    T0,
  );

  expect(created.priority).toBe(0);
  expect(created.isEnabled).toBe(true);
  expect(created.createdFrom).toBeNull();
  expect(created.appliedCount).toBe(0);
  expect(created.lastAppliedAt).toBeNull();
  expect(created.updatedAt).toBe(T0);
});

test("a disabled rule round-trips as disabled rather than as the column default", async () => {
  await createUserRule(
    {
      matcher: { merchantPattern: "SHOPEE" },
      action: { kind: "set-category", categoryId: "cat_shopping" },
      isEnabled: false,
    },
    T0,
  );

  const [listed] = await listUserRules();

  // The repo lists disabled rules — hiding them here would leave the settings
  // screen unable to show a rule the user turned off. Honouring the flag is
  // the categorizer's job, and it cannot honour what it never receives.
  expect(listed.isEnabled).toBe(false);
});

// ---------------------------------------------------------------------------
// Kind filter
// ---------------------------------------------------------------------------

test("listUserRules(kind) returns only rules whose action has that kind", async () => {
  await createUserRule(
    {
      matcher: { merchantPattern: "GRAB" },
      action: { kind: "set-category", categoryId: "cat_transport" },
    },
    T0,
  );
  await createUserRule(
    { matcher: { providerKey: "gcash" }, action: { kind: "set-wallet", walletId: "wallet_gcash" } },
    T0,
  );
  await createUserRule({ matcher: { merchantPattern: "PROMO" }, action: { kind: "ignore" } }, T0);

  const categoryRules = await listUserRules("set-category");
  const walletRules = await listUserRules("set-wallet");

  expect(categoryRules).toHaveLength(1);
  expect(categoryRules[0].action).toEqual({
    kind: "set-category",
    categoryId: "cat_transport",
  });
  expect(walletRules).toHaveLength(1);
  expect(walletRules[0].action.kind).toBe("set-wallet");
  expect(await listUserRules()).toHaveLength(3);
});

test("listUserRules(kind) filters on the action, never on the matcher", async () => {
  // A matcher whose own text spells another action's kind. A filter reaching
  // into the wrong JSON column matches this row and must not.
  await createUserRule(
    {
      matcher: { merchantPattern: "set-wallet" },
      action: { kind: "set-category", categoryId: "cat_shopping" },
    },
    T0,
  );

  expect(await listUserRules("set-wallet")).toHaveLength(0);
  expect(await listUserRules("set-category")).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

test("listUserRules returns rules highest-priority first", async () => {
  const low = await createUserRule(
    { matcher: {}, action: { kind: "set-category", categoryId: "cat_a" }, priority: 1 },
    T0,
  );
  const high = await createUserRule(
    { matcher: {}, action: { kind: "set-category", categoryId: "cat_b" }, priority: 99 },
    T0 + 1,
  );
  const mid = await createUserRule(
    { matcher: {}, action: { kind: "set-category", categoryId: "cat_c" }, priority: 50 },
    T0 + 2,
  );

  const ids = (await listUserRules()).map((rule) => rule.id);

  expect(ids).toEqual([high.id, mid.id, low.id]);
});

test("rules of equal priority come back newest-created first", async () => {
  const older = await createUserRule(
    { matcher: {}, action: { kind: "set-category", categoryId: "cat_a" }, priority: 10 },
    T0,
  );
  const newer = await createUserRule(
    { matcher: {}, action: { kind: "set-category", categoryId: "cat_b" }, priority: 10 },
    T0 + 5_000,
  );

  const ids = (await listUserRules()).map((rule) => rule.id);

  // docs/02-domain-model.md §3.11: "Later-created rules evaluate first."
  expect(ids).toEqual([newer.id, older.id]);
});

test("rules created in the same millisecond come back in a stable id order", async () => {
  const created = [
    await createUserRule(
      { matcher: {}, action: { kind: "set-category", categoryId: "cat_a" }, priority: 10 },
      T0,
    ),
    await createUserRule(
      { matcher: {}, action: { kind: "set-category", categoryId: "cat_b" }, priority: 10 },
      T0,
    ),
    await createUserRule(
      { matcher: {}, action: { kind: "set-category", categoryId: "cat_c" }, priority: 10 },
      T0,
    ),
  ];

  const ids = (await listUserRules()).map((rule) => rule.id);

  // Ids are random UUIDs, so the expectation is derived, not hard-coded: what
  // matters is that a three-way tie resolves by SOMETHING total and repeatable
  // rather than by SQLite's unordered scan.
  expect(ids).toEqual(created.map((rule) => rule.id).sort());
  expect((await listUserRules()).map((rule) => rule.id)).toEqual(ids);
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test("deleteUserRule removes only the targeted rule", async () => {
  const doomed = await createUserRule(
    { matcher: { merchantPattern: "GRAB" }, action: { kind: "ignore" } },
    T0,
  );
  const survivor = await createUserRule(
    {
      matcher: { merchantPattern: "JOLLIBEE" },
      action: { kind: "set-category", categoryId: "cat_food_dining" },
    },
    T0,
  );

  await deleteUserRule(doomed.id);

  const remaining = await listUserRules();
  expect(remaining.map((rule) => rule.id)).toEqual([survivor.id]);
});

test("deleting an id that is not there is a no-op, not a throw", async () => {
  await expect(deleteUserRule("no_such_rule")).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// Corrupt rows
//
// One bad row must not blank the list. If it did, the categorizer would see NO
// rules at all and every transaction would silently lose every correction the
// user has ever made — the exact "user corrections must stick" failure of
// docs/03-ingest-pipeline.md §8 rule 2, with no symptom on screen.
// ---------------------------------------------------------------------------

test("an unparseable matcher_json drops that row and leaves the rest listed", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await insertRawRule({
      id: "rule_corrupt_matcher",
      matcherJson: '{"merchantPattern": ',
      actionJson: '{"kind":"set-category","categoryId":"cat_shopping"}',
    });
    const good = await createUserRule(
      {
        matcher: { merchantPattern: "GRAB" },
        action: { kind: "set-category", categoryId: "cat_transport" },
      },
      T0,
    );

    const rules = await listUserRules();

    expect(rules.map((rule) => rule.id)).toEqual([good.id]);
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("an unparseable action_json drops that row and leaves the rest listed", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await insertRawRule({
      id: "rule_corrupt_action",
      matcherJson: '{"merchantPattern":"SHOPEE"}',
      actionJson: "not json at all",
    });
    const good = await createUserRule(
      {
        matcher: { merchantPattern: "GRAB" },
        action: { kind: "set-category", categoryId: "cat_transport" },
      },
      T0,
    );

    const rules = await listUserRules();

    expect(rules.map((rule) => rule.id)).toEqual([good.id]);
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("an action that parses but carries no kind is dropped rather than listed", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    // Valid JSON, wrong shape — the case a `JSON.parse` in a try/catch waves
    // through. A kindless action reaches the categorizer's switch as
    // `undefined` and matches nothing, silently.
    await insertRawRule({
      id: "rule_kindless",
      matcherJson: '{"merchantPattern":"SHOPEE"}',
      actionJson: '{"categoryId":"cat_shopping"}',
    });

    const rules = await listUserRules();
    const categoryRules = await listUserRules("set-category");

    expect(rules).toHaveLength(0);
    expect(categoryRules).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("a matcher that parses to a non-object is dropped rather than listed", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    // `JSON.parse("null")` succeeds and returns null; reading `.merchantPattern`
    // off it throws at match time, deep inside the pipeline.
    await insertRawRule({
      id: "rule_null_matcher",
      matcherJson: "null",
      actionJson: '{"kind":"ignore"}',
    });

    expect(await listUserRules()).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("a mark-transfer rule round-trips with its counterpart wallet", async () => {
  await createUserRule({
    matcher: { providerKey: "gcash", merchantPattern: "BPI" },
    action: { kind: "mark-transfer", counterpartWalletId: "w_bpi" },
    priority: 100,
  });

  const [rule] = await listUserRules();
  expect(rule?.action).toEqual({ kind: "mark-transfer", counterpartWalletId: "w_bpi" });
});

test("a mark-transfer row with no counterpart wallet is dropped, not defaulted", async () => {
  await db.runAsync(
    `INSERT INTO user_rules
       (id, matcher_json, action_json, priority, is_enabled, created_from,
        applied_count, last_applied_at, created_at, updated_at)
     VALUES ('ur_legacy', '{"providerKey":"gcash"}', '{"kind":"mark-transfer"}', 100, 1, NULL, 0, NULL, 0, 0)`,
  );

  expect(await listUserRules()).toHaveLength(0);
});

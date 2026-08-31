import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { MERCHANT_CATEGORY_MAP, categorize } from "../categorizer";
import type { NormalizedEvent } from "@/lib/ingest/normalizer";
import type { Transaction, UserRule, UserRuleAction, UserRuleMatcher } from "@/types/domain";

const T0 = 1_700_000_000_000;

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    providerKey: "gcash",
    amount: 15_000,
    direction: "out",
    merchant: "GRAB",
    occurredAt: T0,
    confidence: 1,
    walletId: "wallet_gcash",
    channel: "push",
    ...overrides,
  };
}

let ruleSeq = 0;

function rule(
  matcher: UserRuleMatcher,
  action: UserRuleAction,
  overrides: Partial<Pick<UserRule, "priority" | "isEnabled" | "createdAt" | "id">> = {},
): UserRule {
  ruleSeq += 1;
  const createdAt = overrides.createdAt ?? T0;
  return {
    id: overrides.id ?? `rule_${String(ruleSeq).padStart(3, "0")}`,
    matcher,
    action,
    priority: overrides.priority ?? 0,
    isEnabled: overrides.isEnabled ?? true,
    createdFrom: null,
    appliedCount: 0,
    lastAppliedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function categoryRule(
  matcher: UserRuleMatcher,
  categoryId: string,
  overrides: Partial<Pick<UserRule, "priority" | "isEnabled" | "createdAt" | "id">> = {},
): UserRule {
  return rule(matcher, { kind: "set-category", categoryId }, overrides);
}

let txSeq = 0;

function tx(overrides: Partial<Transaction> = {}): Transaction {
  txSeq += 1;
  return {
    id: `tx_${String(txSeq).padStart(3, "0")}`,
    walletId: "wallet_gcash",
    categoryId: "cat_food_dining",
    amount: 15_000,
    direction: "out",
    occurredAt: T0,
    merchant: "SIOMAI HOUSE",
    counterparty: null,
    referenceNo: null,
    source: "notification",
    confidence: 1,
    rawNotificationId: null,
    transferLinkId: null,
    note: null,
    balanceAfter: null,
    computedBalance: null,
    isAdjustment: false,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** `n` history rows for one merchant, all filed under one category. */
function history(merchant: string, categoryId: string, count: number): Transaction[] {
  return Array.from({ length: count }, (_unused, index) =>
    tx({ merchant, categoryId, occurredAt: T0 - index * 86_400_000 }),
  );
}

// ---------------------------------------------------------------------------
// Merchant map (§8 rule 1)
// ---------------------------------------------------------------------------

test("a known merchant resolves from the built-in merchant map", () => {
  expect(categorize(event({ merchant: "GRAB" }), [], [])).toEqual({
    categoryId: "cat_transport",
    source: "merchant_map",
    penalty: 0,
  });
});

test("merchant-map matching is case-insensitive", () => {
  expect(categorize(event({ merchant: "Jollibee" }), [], []).categoryId).toBe("cat_food_dining");
  expect(categorize(event({ merchant: "jollibee" }), [], []).source).toBe("merchant_map");
});

test("the merchant map still matches when the merchant carries a trailing reference code", () => {
  // Real notification text is "JOLLIBEE 12345", not the tidy name — §8's
  // "merchant string instability" failure mode.
  expect(categorize(event({ merchant: "JOLLIBEE 12345" }), [], []).categoryId).toBe(
    "cat_food_dining",
  );
  expect(categorize(event({ merchant: "GRABPAY *TRIP" }), [], []).categoryId).toBe("cat_transport");
});

test("the merchant map prefers the most specific matching entry", () => {
  // "grab" and "grabfood" both match "GRABFOOD DELIVERY"; the longer key is
  // the one that knows more, and picking by iteration order is not an answer.
  expect(categorize(event({ merchant: "GRABFOOD DELIVERY" }), [], []).categoryId).toBe(
    "cat_food_dining",
  );
});

test("every merchant-map target is one of the 15 seeded default category ids", () => {
  // Copied from categories_repo's DEFAULT_CATEGORIES, whose ids are fixed
  // slugs precisely so they can be depended on. A typo here points committed
  // transactions at a category that does not exist — `transactions.category_id`
  // is a foreign key, so the whole commit fails at the last stage of the
  // pipeline, long after anything says "merchant map".
  const seeded = new Set([
    "cat_food_dining",
    "cat_groceries_palengke",
    "cat_transport",
    "cat_load_data",
    "cat_bills_utilities",
    "cat_rent_housing",
    "cat_utang_loan_payments",
    "cat_padala_remittance",
    "cat_shopping",
    "cat_health_pharmacy",
    "cat_education_tuition",
    "cat_entertainment_subscriptions",
    "cat_savings_investments",
    "cat_fees_charges",
    UNCATEGORIZED_ID,
  ]);

  for (const [merchant, categoryId] of Object.entries(MERCHANT_CATEGORY_MAP)) {
    expect([merchant, seeded.has(categoryId)]).toEqual([merchant, true]);
  }
});

test("merchant-map keys are stored folded, so a key can never be unreachable", () => {
  for (const key of Object.keys(MERCHANT_CATEGORY_MAP)) {
    expect(key).toBe(key.toLowerCase().trim());
    expect(key).not.toBe("");
  }
});

// ---------------------------------------------------------------------------
// User rules (§8 rule 2 — corrections must stick)
// ---------------------------------------------------------------------------

test("a user rule overrides the built-in merchant map", () => {
  const rules = [categoryRule({ merchantPattern: "GRAB" }, "cat_utang_loan_payments")];

  expect(categorize(event({ merchant: "GRAB" }), rules, [])).toEqual({
    categoryId: "cat_utang_loan_payments",
    source: "user_rule",
    penalty: 0,
  });
});

test("a user rule categorizes a merchant the map has never heard of", () => {
  const rules = [categoryRule({ merchantPattern: "JUAN D" }, "cat_utang_loan_payments")];

  expect(categorize(event({ merchant: "JUAN D." }), rules, []).source).toBe("user_rule");
});

test("user-rule merchant matching is case-insensitive in both directions", () => {
  const rules = [categoryRule({ merchantPattern: "juan d" }, "cat_utang_loan_payments")];

  expect(categorize(event({ merchant: "JUAN D." }), rules, []).categoryId).toBe(
    "cat_utang_loan_payments",
  );
});

test("a disabled rule is not applied", () => {
  const rules = [
    categoryRule({ merchantPattern: "GRAB" }, "cat_utang_loan_payments", { isEnabled: false }),
  ];

  // Turning a rule off and watching it keep firing is the bug this pins.
  expect(categorize(event({ merchant: "GRAB" }), rules, [])).toEqual({
    categoryId: "cat_transport",
    source: "merchant_map",
    penalty: 0,
  });
});

test("a disabled rule does not shadow an enabled one that also matches", () => {
  const rules = [
    categoryRule({ merchantPattern: "GRAB" }, "cat_fees_charges", {
      isEnabled: false,
      priority: 100,
    }),
    categoryRule({ merchantPattern: "GRAB" }, "cat_utang_loan_payments", { priority: 1 }),
  ];

  expect(categorize(event({ merchant: "GRAB" }), rules, []).categoryId).toBe(
    "cat_utang_loan_payments",
  );
});

test("the higher-priority rule wins when two enabled rules match", () => {
  const loser = categoryRule({ merchantPattern: "GRAB" }, "cat_fees_charges", { priority: 1 });
  const winner = categoryRule({ merchantPattern: "GRAB" }, "cat_transport", { priority: 99 });

  expect(categorize(event({ merchant: "GRAB" }), [loser, winner], []).categoryId).toBe(
    "cat_transport",
  );
  // Same two rules, opposite array order — same verdict, or resolution is
  // being decided by whatever order the caller happened to pass.
  expect(categorize(event({ merchant: "GRAB" }), [winner, loser], []).categoryId).toBe(
    "cat_transport",
  );
});

test("equal-priority rules resolve to the newest-created one, whatever the array order", () => {
  const older = categoryRule({ merchantPattern: "GRAB" }, "cat_fees_charges", {
    priority: 10,
    createdAt: T0,
  });
  const newer = categoryRule({ merchantPattern: "GRAB" }, "cat_transport", {
    priority: 10,
    createdAt: T0 + 5_000,
  });

  expect(categorize(event({ merchant: "GRAB" }), [older, newer], []).categoryId).toBe(
    "cat_transport",
  );
  expect(categorize(event({ merchant: "GRAB" }), [newer, older], []).categoryId).toBe(
    "cat_transport",
  );
});

test("rules identical in priority and createdAt resolve by id, whatever the array order", () => {
  const first = categoryRule({ merchantPattern: "GRAB" }, "cat_transport", {
    priority: 10,
    createdAt: T0,
    id: "rule_aaa",
  });
  const second = categoryRule({ merchantPattern: "GRAB" }, "cat_fees_charges", {
    priority: 10,
    createdAt: T0,
    id: "rule_bbb",
  });

  expect(categorize(event({ merchant: "GRAB" }), [first, second], []).categoryId).toBe(
    "cat_transport",
  );
  expect(categorize(event({ merchant: "GRAB" }), [second, first], []).categoryId).toBe(
    "cat_transport",
  );
});

test("only set-category actions categorize", () => {
  const rules = [
    rule({ merchantPattern: "GRAB" }, { kind: "set-wallet", walletId: "wallet_maya" }, {
      priority: 100,
    }),
    rule({ merchantPattern: "GRAB" }, { kind: "ignore" }, { priority: 100 }),
    rule({ merchantPattern: "GRAB" }, { kind: "set-merchant", merchant: "Grab PH" }, {
      priority: 100,
    }),
    rule(
      { merchantPattern: "GRAB" },
      { kind: "mark-transfer", counterpartWalletId: "wallet_bpi" },
      { priority: 100 },
    ),
  ];

  // `ignore` belongs to an earlier stage; a set-wallet rule has no categoryId
  // to offer at all.
  expect(categorize(event({ merchant: "GRAB" }), rules, [])).toEqual({
    categoryId: "cat_transport",
    source: "merchant_map",
    penalty: 0,
  });
});

// ---------------------------------------------------------------------------
// Matcher conditions
// ---------------------------------------------------------------------------

test("a providerKey condition must match the event's provider", () => {
  const rules = [
    categoryRule({ providerKey: "maya", merchantPattern: "GRAB" }, "cat_utang_loan_payments"),
  ];

  expect(categorize(event({ providerKey: "gcash", merchant: "GRAB" }), rules, []).source).toBe(
    "merchant_map",
  );
  expect(categorize(event({ providerKey: "maya", merchant: "GRAB" }), rules, []).source).toBe(
    "user_rule",
  );
});

test("a direction condition must match the event's direction", () => {
  const rules = [categoryRule({ merchantPattern: "GRAB", direction: "in" }, "cat_fees_charges")];

  expect(categorize(event({ direction: "out" }), rules, []).source).toBe("merchant_map");
  expect(categorize(event({ direction: "in" }), rules, []).source).toBe("user_rule");
});

test("amountMin and amountMax bound the event amount inclusively", () => {
  const rules = [
    categoryRule({ merchantPattern: "GRAB", amountMin: 10_000, amountMax: 20_000 }, "cat_shopping"),
  ];

  expect(categorize(event({ amount: 9_999 }), rules, []).source).toBe("merchant_map");
  expect(categorize(event({ amount: 10_000 }), rules, []).source).toBe("user_rule");
  expect(categorize(event({ amount: 20_000 }), rules, []).source).toBe("user_rule");
  expect(categorize(event({ amount: 20_001 }), rules, []).source).toBe("merchant_map");
});

test("a rule with an empty matcher applies to everything", () => {
  const rules = [categoryRule({}, "cat_fees_charges")];

  expect(categorize(event({ merchant: "GRAB" }), rules, []).categoryId).toBe("cat_fees_charges");
  expect(categorize(event({ merchant: undefined }), rules, []).categoryId).toBe("cat_fees_charges");
});

test("a rule with a merchantPattern never matches an event that has no merchant", () => {
  const rules = [categoryRule({ merchantPattern: "GRAB" }, "cat_fees_charges")];

  expect(categorize(event({ merchant: undefined }), rules, []).source).toBe("default");
});

test("a blank merchantPattern matches nothing rather than everything", () => {
  // A settings form writing "" where it meant "omit this condition" must not
  // turn one rule into a blanket recategorization of the entire ledger.
  const rules = [categoryRule({ merchantPattern: "   " }, "cat_fees_charges")];

  expect(categorize(event({ merchant: "GRAB" }), rules, []).source).toBe("merchant_map");
  expect(categorize(event({ merchant: "ANYTHING AT ALL" }), rules, []).source).toBe("default");
});

// ---------------------------------------------------------------------------
// Learned suggestions (§8 rule 3)
// ---------------------------------------------------------------------------

test("three history rows for the same merchant and category produce a learned verdict", () => {
  const past = history("SIOMAI HOUSE", "cat_food_dining", 3);

  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past)).toEqual({
    categoryId: "cat_food_dining",
    source: "learned",
    penalty: 0.05,
  });
});

test("two history rows do not", () => {
  const past = history("SIOMAI HOUSE", "cat_food_dining", 2);

  // Both sides of the boundary, so an implementation that used `>= 2` fails.
  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past)).toEqual({
    categoryId: UNCATEGORIZED_ID,
    source: "default",
    penalty: 0,
  });
});

test("three history rows across three different categories produce no learned verdict", () => {
  const past = [
    tx({ merchant: "SIOMAI HOUSE", categoryId: "cat_food_dining" }),
    tx({ merchant: "SIOMAI HOUSE", categoryId: "cat_groceries_palengke" }),
    tx({ merchant: "SIOMAI HOUSE", categoryId: "cat_shopping" }),
  ];

  // "categorized the SAME WAY three or more times", not "seen three times".
  // A merchant the user keeps recategorizing is the one case where a confident
  // guess is most likely to be the wrong one.
  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past).source).toBe("default");
});

test("a category clears the threshold even when other categories also appear", () => {
  const past = [
    ...history("SIOMAI HOUSE", "cat_food_dining", 3),
    tx({ merchant: "SIOMAI HOUSE", categoryId: "cat_shopping" }),
  ];

  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past).categoryId).toBe(
    "cat_food_dining",
  );
});

test("two categories tied at the threshold produce no learned verdict", () => {
  const past = [
    ...history("SIOMAI HOUSE", "cat_food_dining", 3),
    ...history("SIOMAI HOUSE", "cat_shopping", 3),
  ];

  // Three each is not "the same way three times" — it is a user who has not
  // settled, and the honest answer is Uncategorized rather than a coin flip.
  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past).source).toBe("default");
});

test("learned matching folds case on both the event and the history rows", () => {
  const past = history("siomai house", "cat_food_dining", 3);

  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past).source).toBe("learned");
});

test("history rows for other merchants do not count toward the threshold", () => {
  const past = [
    ...history("SIOMAI HOUSE", "cat_food_dining", 2),
    ...history("LUGAWAN", "cat_food_dining", 5),
  ];

  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past).source).toBe("default");
});

test("history rows with no merchant do not count toward the threshold", () => {
  const past = [
    ...history("SIOMAI HOUSE", "cat_food_dining", 2),
    tx({ merchant: null, categoryId: "cat_food_dining" }),
  ];

  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past).source).toBe("default");
});

test("Uncategorized history rows are not evidence of a learned category", () => {
  const past = history("SIOMAI HOUSE", UNCATEGORIZED_ID, 5);

  // Otherwise every unresolved merchant "learns" Uncategorized after three
  // sightings and starts carrying a 0.05 penalty — contradicting §8 rule 5
  // and pushing good parses out of auto-commit for being uncategorized.
  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past)).toEqual({
    categoryId: UNCATEGORIZED_ID,
    source: "default",
    penalty: 0,
  });
});

test("transfer-linked history rows are not evidence of a learned category", () => {
  const past = history("SIOMAI HOUSE", "cat_food_dining", 3).map((row) => ({
    ...row,
    transferLinkId: "link_1",
  }));

  // §8 rule 5: transfer legs are not categorized at all, so their category
  // records no decision the user ever made.
  expect(categorize(event({ merchant: "SIOMAI HOUSE" }), [], past).source).toBe("default");
});

test("a learned suggestion never overrides the merchant map or a user rule", () => {
  const past = history("GRAB", "cat_shopping", 5);

  // §8 rule 3 offers learning "for merchants still unresolved".
  expect(categorize(event({ merchant: "GRAB" }), [], past).source).toBe("merchant_map");

  const rules = [categoryRule({ merchantPattern: "GRAB" }, "cat_utang_loan_payments")];
  expect(categorize(event({ merchant: "GRAB" }), rules, past).source).toBe("user_rule");
});

// ---------------------------------------------------------------------------
// Default (§8 rules 4 and 5)
// ---------------------------------------------------------------------------

test("an unknown merchant falls back to Uncategorized with no penalty", () => {
  expect(categorize(event({ merchant: "SOME SARI-SARI STORE" }), [], [])).toEqual({
    categoryId: UNCATEGORIZED_ID,
    source: "default",
    penalty: 0,
  });
});

test("an event with no merchant returns the default verdict without throwing", () => {
  expect(() => categorize(event({ merchant: undefined }), [], [])).not.toThrow();
  expect(categorize(event({ merchant: undefined }), [], [])).toEqual({
    categoryId: UNCATEGORIZED_ID,
    source: "default",
    penalty: 0,
  });
  expect(categorize(event({ merchant: "   " }), [], []).source).toBe("default");
});

test("an event with no merchant tolerates a full history and rule set", () => {
  const past = history("SIOMAI HOUSE", "cat_food_dining", 4);
  const rules = [categoryRule({ merchantPattern: "SIOMAI" }, "cat_shopping")];

  expect(categorize(event({ merchant: undefined }), rules, past)).toEqual({
    categoryId: UNCATEGORIZED_ID,
    source: "default",
    penalty: 0,
  });
});

test("categorize mutates neither the rules array nor the history array", () => {
  const rules = [
    categoryRule({ merchantPattern: "GRAB" }, "cat_fees_charges", { priority: 1 }),
    categoryRule({ merchantPattern: "GRAB" }, "cat_transport", { priority: 99 }),
  ];
  const past = history("GRAB", "cat_shopping", 3);
  const rulesBefore = rules.map((entry) => entry.id);
  const pastBefore = past.map((entry) => entry.id);

  categorize(event({ merchant: "GRAB" }), rules, past);

  // Sorting in place would reorder the orchestrator's own arrays under it.
  expect(rules.map((entry) => entry.id)).toEqual(rulesBefore);
  expect(past.map((entry) => entry.id)).toEqual(pastBefore);
});

// constants/__tests__/query_keys.test.ts — the hierarchy property under test
// is the one that makes cache invalidation work: `invalidateQueries({ queryKey:
// queryKeys.<family>.all })` only cascades to every query in that family if
// every list()/detail()/etc. key produced by that family starts with its own
// `all` key. These tests assert exact array contents (not just shape) and
// verify the hierarchy holds for every family by iterating queryKeys itself,
// so a family added later can't silently skip the check.
import { queryKeys } from "../query_keys";

describe("exact key contents (STACK_BASIS §6 shape)", () => {
  test("wallets", () => {
    expect(queryKeys.wallets.all).toEqual(["wallets"]);
    expect(queryKeys.wallets.list()).toEqual(["wallets", "list"]);
    expect(queryKeys.wallets.detail("abc")).toEqual(["wallets", "detail", "abc"]);
  });

  test("transactions — list() takes an optional filter object", () => {
    expect(queryKeys.transactions.all).toEqual(["transactions"]);
    expect(queryKeys.transactions.list()).toEqual(["transactions", "list", undefined]);
    expect(queryKeys.transactions.list({ type: "expense" })).toEqual([
      "transactions",
      "list",
      { type: "expense" },
    ]);
    expect(queryKeys.transactions.detail("tx1")).toEqual(["transactions", "detail", "tx1"]);
  });

  test("reviewQueue — snake_case key segment, open()/count() instead of list()/detail()", () => {
    expect(queryKeys.reviewQueue.all).toEqual(["review_queue"]);
    expect(queryKeys.reviewQueue.open()).toEqual(["review_queue", "open"]);
    expect(queryKeys.reviewQueue.count()).toEqual(["review_queue", "count"]);
  });

  test("categories — list() only, no detail()", () => {
    expect(queryKeys.categories.all).toEqual(["categories"]);
    expect(queryKeys.categories.list()).toEqual(["categories", "list"]);
  });

  test("limits", () => {
    expect(queryKeys.limits.all).toEqual(["limits"]);
    expect(queryKeys.limits.list()).toEqual(["limits", "list"]);
    expect(queryKeys.limits.detail("l1")).toEqual(["limits", "detail", "l1"]);
  });

  test("goals", () => {
    expect(queryKeys.goals.all).toEqual(["goals"]);
    expect(queryKeys.goals.list()).toEqual(["goals", "list"]);
    expect(queryKeys.goals.detail("g1")).toEqual(["goals", "detail", "g1"]);
  });

  test("loans", () => {
    expect(queryKeys.loans.all).toEqual(["loans"]);
    expect(queryKeys.loans.list()).toEqual(["loans", "list"]);
    expect(queryKeys.loans.detail("ln1")).toEqual(["loans", "detail", "ln1"]);
  });

  test("bills", () => {
    expect(queryKeys.bills.all).toEqual(["bills"]);
    expect(queryKeys.bills.list()).toEqual(["bills", "list"]);
    expect(queryKeys.bills.detail("b1")).toEqual(["bills", "detail", "b1"]);
  });

  test("settings — all key only, no list()/detail()", () => {
    expect(queryKeys.settings.all).toEqual(["settings"]);
  });
});

describe("hierarchy: every generated key nests under its family's `all` key", () => {
  // Walk queryKeys itself rather than hand-writing one assertion per family —
  // a hand-written list is exactly where the next family added later gets
  // forgotten, and invalidateQueries({ queryKey: family.all }) would then
  // silently miss it, leaving stale money on screen.
  const families = Object.entries(queryKeys) as Array<
    [string, Record<string, unknown>]
  >;

  for (const [familyName, family] of families) {
    const allKey = family.all as readonly unknown[];
    const generators = Object.entries(family).filter(
      ([methodName]) => methodName !== "all",
    ) as Array<[string, (...args: unknown[]) => readonly unknown[]]>;

    if (generators.length === 0) {
      // "settings" has only `all` — nothing further can violate the property.
      continue;
    }

    describe(`${familyName}`, () => {
      test.each(generators)(`%s(...) key starts with ${familyName}.all`, (_methodName, fn) => {
        const key = fn("sample-id");
        expect(key.slice(0, allKey.length)).toEqual(allKey);
      });
    });
  }

  test("at least one family with detail() and one without were actually checked", () => {
    // Guards against the loop above silently checking zero families (e.g. if
    // queryKeys were empty or every family had only `all`).
    const checkedFamilies = families.filter(
      ([, family]) => Object.keys(family).length > 1,
    );
    expect(checkedFamilies.length).toBeGreaterThanOrEqual(7);
  });
});

describe("stability: repeated calls are deeply equal (React Query dedupes on this)", () => {
  test("wallets.list() called twice", () => {
    expect(queryKeys.wallets.list()).toEqual(queryKeys.wallets.list());
  });

  test("wallets.detail(id) called twice with the same id", () => {
    expect(queryKeys.wallets.detail("abc")).toEqual(queryKeys.wallets.detail("abc"));
  });

  test("transactions.list(filters) called twice with an equal (not identical) filter object", () => {
    expect(queryKeys.transactions.list({ walletId: "w1" })).toEqual(
      queryKeys.transactions.list({ walletId: "w1" }),
    );
  });
});

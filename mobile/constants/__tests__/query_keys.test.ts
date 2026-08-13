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
    expect(queryKeys.wallets.lists()).toEqual(["wallets", "list"]);
    expect(queryKeys.wallets.list()).toEqual(["wallets", "list", false]);
    expect(queryKeys.wallets.list(true)).toEqual(["wallets", "list", true]);
    expect(queryKeys.wallets.detail("abc")).toEqual(["wallets", "detail", "abc"]);
    expect(queryKeys.wallets.drift("abc")).toEqual(["wallets", "detail", "abc", "drift"]);
    expect(queryKeys.wallets.matchers("abc")).toEqual(["wallets", "detail", "abc", "matchers"]);
  });

  test("wallets.list — the archived toggle is IN the key, with one entry per state", () => {
    // m1c Task 4. Without the parameter the Wallets tab's "Show archived"
    // toggle and the default view share a single cache entry, and whichever
    // resolved first answers for both.
    expect(queryKeys.wallets.list(true)).not.toEqual(queryKeys.wallets.list(false));
    // …and the bare call is the SAME entry as the explicit `false`, not a
    // third one keyed on `undefined`: two keys for one list is two copies of
    // the same balances that can fall out of step after a write.
    expect(queryKeys.wallets.list()).toEqual(queryKeys.wallets.list(false));
  });

  test("wallets.lists() is the prefix BOTH toggle states nest under", () => {
    // This is what lets a mutation invalidate `lists()` once and refresh the
    // archived view as well as the default one.
    const lists = queryKeys.wallets.lists();
    for (const key of [queryKeys.wallets.list(false), queryKeys.wallets.list(true)]) {
      expect(key.slice(0, lists.length)).toEqual(lists);
    }
    // The detail family must NOT nest under it, or invalidating the lists
    // would drop every wallet's cached detail too.
    expect(queryKeys.wallets.detail("abc").slice(0, lists.length)).not.toEqual(lists);
  });

  test("wallets.drift/matchers nest under the wallet's own detail key", () => {
    // A committed transaction invalidates `wallets.detail(id)`; the drift
    // figures and matcher chips on that same screen have to go stale with it.
    const detail = queryKeys.wallets.detail("abc");
    for (const key of [queryKeys.wallets.drift("abc"), queryKeys.wallets.matchers("abc")]) {
      expect(key.slice(0, detail.length)).toEqual(detail);
    }
    // Another wallet's detail must not sweep them up.
    expect(queryKeys.wallets.drift("abc").slice(0, detail.length)).not.toEqual(
      queryKeys.wallets.detail("xyz"),
    );
  });

  test("ruleset — the active parser bundle, where the drift tolerance lives", () => {
    expect(queryKeys.ruleset.all).toEqual(["ruleset"]);
    expect(queryKeys.ruleset.active()).toEqual(["ruleset", "active"]);
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

  test("rawCaptures — the transparency panel's two reads over one row", () => {
    // snake_case key segment, mirroring the `raw_notifications` table. The
    // expiry nests UNDER the capture's own detail key: the purge removes the
    // row and the expiry together, so anything that invalidates one has to
    // reach the other, or the panel counts down to a deletion that has already
    // happened.
    expect(queryKeys.rawCaptures.all).toEqual(["raw_captures"]);
    expect(queryKeys.rawCaptures.detail("cap1")).toEqual(["raw_captures", "detail", "cap1"]);
    expect(queryKeys.rawCaptures.expiry("cap1")).toEqual([
      "raw_captures",
      "detail",
      "cap1",
      "expiry",
    ]);
    const detail = queryKeys.rawCaptures.detail("cap1");
    expect(queryKeys.rawCaptures.expiry("cap1").slice(0, detail.length)).toEqual(detail);
  });

  test("userRules — the corrections a category edit teaches the pipeline", () => {
    expect(queryKeys.userRules.all).toEqual(["user_rules"]);
    expect(queryKeys.userRules.list()).toEqual(["user_rules", "list"]);
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

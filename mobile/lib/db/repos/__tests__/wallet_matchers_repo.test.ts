// lib/db/repos/__tests__/wallet_matchers_repo.test.ts — `wallet_matchers`,
// the table that says which Wallet a given app's notifications belong to.
//
// THE READ SIDE (`listMatchers`) came first, owed to the Normalizer since m1b
// plan Task 5: `normalizeEvent(event, provider, wallets, matchers, tunables)` is
// pure and does no I/O, so somebody has to hand it the rows.
//
// THE WRITE SIDE (`setMatchers`, `findWalletForPackage`) is m1c Task 5's, and
// carries the rule this whole table lives or dies by: A PAIR OF
// (package, hint) BELONGS TO EXACTLY ONE WALLET. Assigning it to a second
// wallet MOVES it; it never duplicates.
//
// That is not tidiness. `claimingMatchers` in the Normalizer collects the rows
// claiming an event and `resolveWallet` refuses anything with more than one
// distinct target — so the instant two wallets hold the same pair, EVERY
// capture from that provider becomes unresolvable and routes to the Review
// Queue forever, with no error and nothing on screen to explain it. The
// reassignment tests below are the guard against that, and they are the reason
// `setMatchers` deletes across wallets rather than only within one.
import { closeDatabase } from "@/lib/db/database";
import { createWallet } from "../wallets_repo";
import { freshDb } from "@/test_support/db";
import { findWalletForPackage, listMatchers, setMatchers } from "../wallet_matchers_repo";
import type { SQLiteDatabase } from "@/lib/db/database";

const NOW = 1_786_000_000_000;

const GCASH = "com.globe.gcash.android";
const MAYA = "com.paymaya";

let db: SQLiteDatabase;
let main: string;
let savings: string;

async function insertMatcher(
  id: string,
  walletId: string,
  packageName: string,
  hint: string | null,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO wallet_matchers (id, wallet_id, package_name, hint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, walletId, packageName, hint, NOW, NOW],
  );
}

beforeEach(async () => {
  db = await freshDb();
  main = (await createWallet({ name: "GCash" })).id;
  savings = (await createWallet({ name: "GSave" })).id;
});

afterEach(async () => {
  await closeDatabase();
});

test("listMatchers returns every row as a domain WalletMatcher", async () => {
  await insertMatcher("m-1", main, "com.globe.gcash.android", null);
  await insertMatcher("m-2", savings, "com.globe.gcash.android", "GSave");

  const matchers = await listMatchers();

  expect(matchers).toEqual([
    {
      id: "m-1",
      walletId: main,
      packageName: "com.globe.gcash.android",
      // An absent hint is null, not "" and not undefined — `foldHint` in the
      // Normalizer treats null as "this row claims the whole provider".
      hint: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "m-2",
      walletId: savings,
      packageName: "com.globe.gcash.android",
      hint: "GSave",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
});

test("listMatchers narrows to one wallet when given an id", async () => {
  await insertMatcher("m-1", main, "com.globe.gcash.android", null);
  await insertMatcher("m-2", savings, "com.globe.gcash.android", "GSave");

  const matchers = await listMatchers(savings);

  expect(matchers.map((matcher) => matcher.id)).toEqual(["m-2"]);
});

test("an empty table lists nothing rather than throwing", async () => {
  expect(await listMatchers()).toEqual([]);
  expect(await listMatchers(main)).toEqual([]);
});

/**
 * `(packageName, hint)` for every row on the device, in a fixed order.
 *
 * SORTED, not in `listMatchers` order. Rows written by one `setMatchers` call
 * share a `created_at` to the millisecond, so that function's documented
 * `created_at, id` ordering tie-breaks on a random UUID. The array order is not
 * something the Normalizer depends on (it collects distinct targets), so these
 * assertions are about WHICH PAIRS EXIST — sorting keeps them from failing on a
 * property nothing relies on.
 */
async function allPairs(walletId?: string): Promise<[string, string | null][]> {
  const matchers = await listMatchers(walletId);
  return matchers
    .map((matcher): [string, string | null] => [matcher.packageName, matcher.hint])
    .sort(([aPackage, aHint], [bPackage, bHint]) =>
      aPackage === bPackage ? `${aHint}`.localeCompare(`${bHint}`) : aPackage.localeCompare(bPackage),
    );
}

describe("setMatchers", () => {
  test("set-then-list round-trips a provider-wide matcher and a hinted one", async () => {
    await setMatchers(main, [
      { packageName: GCASH },
      { packageName: GCASH, hint: "GSave" },
    ]);

    const matchers = await listMatchers(main);

    expect(matchers).toHaveLength(2);
    expect(await allPairs(main)).toEqual([
      [GCASH, "GSave"],
      [GCASH, null],
    ]);
    expect(matchers.every((matcher) => matcher.walletId === main)).toBe(true);
    expect(matchers.every((matcher) => matcher.id.length > 0)).toBe(true);
  });

  test("REPLACES the wallet's set rather than appending to it", async () => {
    await setMatchers(main, [{ packageName: GCASH }, { packageName: MAYA }]);
    // The user removed Maya from this wallet and saved again.
    await setMatchers(main, [{ packageName: GCASH }]);

    // Appending instead of replacing would leave the wallet catching Maya —
    // a provider the user explicitly took off it, still silently routing money.
    expect(await allPairs()).toEqual([[GCASH, null]]);
  });

  test("an empty set clears the wallet's matchers", async () => {
    await setMatchers(main, [{ packageName: GCASH }]);
    await setMatchers(main, []);

    expect(await listMatchers(main)).toEqual([]);
  });

  test("collapses duplicate pairs within one call to a single row", async () => {
    await setMatchers(main, [
      { packageName: GCASH, hint: "GSave" },
      { packageName: GCASH, hint: "gsave " },
    ]);

    // Two rows here would make the wallet claim its own provider twice. The
    // Normalizer dedupes by TARGET so it would still resolve, but the chips
    // would show the same provider twice and the next reassignment would only
    // move one of them.
    expect(await allPairs()).toEqual([[GCASH, "GSave"]]);
  });

  test("stores a blank hint as null, the way the Normalizer reads it", async () => {
    await setMatchers(main, [{ packageName: GCASH, hint: "   " }]);

    // `foldHint` treats blank as absent, so a row stored as `""` would route as
    // provider-wide while the conflict check below saw it as a distinct pair —
    // the two halves of this rule disagreeing about the same row.
    expect(await allPairs()).toEqual([[GCASH, null]]);
  });

  test("trims a hint's surrounding whitespace but keeps the user's casing", async () => {
    await setMatchers(main, [{ packageName: GCASH, hint: "  GSave  " }]);

    expect(await allPairs()).toEqual([[GCASH, "GSave"]]);
  });

  test("leaves another wallet's non-conflicting matchers alone", async () => {
    await setMatchers(savings, [{ packageName: MAYA }]);
    await setMatchers(main, [{ packageName: GCASH }]);

    expect(await listMatchers(savings)).toHaveLength(1);
    expect(await listMatchers(main)).toHaveLength(1);
  });
});

describe("one pair belongs to exactly one wallet", () => {
  test("reassigning a pair MOVES it instead of creating a second row", async () => {
    await setMatchers(main, [{ packageName: GCASH }]);

    await setMatchers(savings, [{ packageName: GCASH }]);

    // The whole rule in three assertions. A second row here would make every
    // GCash capture ambiguous — `resolveWallet` sees two distinct targets and
    // returns `walletId: null`, a hard route to the Review Queue for every
    // future GCash notification, with no error anywhere.
    expect(await allPairs()).toEqual([[GCASH, null]]);
    expect(await listMatchers(main)).toEqual([]);
    expect((await listMatchers(savings)).map((matcher) => matcher.packageName)).toEqual([GCASH]);
  });

  test("a pair differing only in hint case or padding is the same pair, and moves", async () => {
    await setMatchers(main, [{ packageName: GCASH, hint: "GSave" }]);

    await setMatchers(savings, [{ packageName: GCASH, hint: " gsave " }]);

    // `foldHint` compares hints case-folded and trimmed, so "GSave" and "gsave"
    // claim the SAME notifications. Treating them as different pairs here would
    // let both rows live and reintroduce the ambiguity by the back door.
    expect(await allPairs()).toEqual([[GCASH, "gsave"]]);
    expect(await listMatchers(main)).toEqual([]);
  });

  test("moving one pair does not disturb the losing wallet's other pairs", async () => {
    await setMatchers(main, [{ packageName: GCASH }, { packageName: MAYA }]);

    await setMatchers(savings, [{ packageName: GCASH }]);

    expect((await listMatchers(main)).map((matcher) => matcher.packageName)).toEqual([MAYA]);
  });

  test("two wallets may share a provider when their hints differ", async () => {
    await setMatchers(main, [{ packageName: GCASH }]);

    await setMatchers(savings, [{ packageName: GCASH, hint: "GSave" }]);

    // The canonical GCash-main-vs-GSave setup (spec rule 5). A move here would
    // break the one arrangement the hint column exists for.
    expect(await listMatchers(main)).toHaveLength(1);
    expect(await listMatchers(savings)).toHaveLength(1);
    expect(await allPairs()).toEqual([
      [GCASH, "GSave"],
      [GCASH, null],
    ]);
  });
});

describe("findWalletForPackage", () => {
  beforeEach(async () => {
    await setMatchers(main, [{ packageName: GCASH }]);
    await setMatchers(savings, [{ packageName: GCASH, hint: "GSave" }]);
  });

  test("resolves the provider-wide wallet when no hint is given", async () => {
    expect(await findWalletForPackage(GCASH)).toBe(main);
  });

  test("resolves the hinted wallet when a hint is given", async () => {
    // The discriminating half: ignoring the hint collapses GCash main and GSave
    // into one wallet and the sub-account split stops existing.
    expect(await findWalletForPackage(GCASH, "GSave")).toBe(savings);
  });

  test("folds hint case and padding the way the Normalizer does", async () => {
    expect(await findWalletForPackage(GCASH, "  gsave ")).toBe(savings);
  });

  test("treats a blank hint as no hint at all", async () => {
    expect(await findWalletForPackage(GCASH, "   ")).toBe(main);
  });

  test("returns null for a package no wallet claims", async () => {
    expect(await findWalletForPackage(MAYA)).toBeNull();
  });

  test("returns null for an unclaimed hint rather than falling back to the provider-wide wallet", async () => {
    // EXACT-PAIR SEMANTICS, deliberately not the Normalizer's precedence walk.
    // This answers the picker's question — "is this exact pair already taken?"
    // A fallback would warn "GCash already catches this" the moment a user typed
    // a NEW sub-account hint, which is the one setup the spec wants them to make.
    expect(await findWalletForPackage(GCASH, "GInvest")).toBeNull();
  });
});

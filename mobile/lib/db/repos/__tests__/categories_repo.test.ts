import { closeDatabase } from "@/lib/db/database";
import {
  createCategory,
  deleteCategory,
  DuplicateCategoryNameError,
  getCategory,
  hideCategory,
  listCategories,
  listCategoryRefs,
  seedDefaultCategories,
  SystemCategoryDeleteError,
  UncategorizedProtectedError,
  UNCATEGORIZED_ID,
} from "../categories_repo";
import { createWallet } from "../wallets_repo";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";

/** Raw-SQL transaction insert for setup — no dedicated factory exists yet. */
async function insertTransaction(args: {
  id: string;
  walletId: string;
  categoryId: string;
  amount: number;
}): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, source, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'out', ?, 'manual', 1.0, ?, ?)`,
    [args.id, args.walletId, args.categoryId, args.amount, now, now, now],
  );
}

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

// The exact PH default set from docs/02-domain-model.md §3.4 (brief cites §5,
// but §5 is "cross-entity invariants" — the list itself lives in §3.4; the
// brief's own rule 5 reproduces the same 15 names, so this is what both agree
// on). Kept as its own constant so a typo in the implementation's seed list
// and a typo in this expectation don't coincidentally cancel out — this is
// retyped independently from the brief text, not copy-pasted from the source.
const PH_DEFAULT_CATEGORY_NAMES = [
  "Food & Dining",
  "Groceries/Palengke",
  "Transport",
  "Load & Data",
  "Bills & Utilities",
  "Rent & Housing",
  "Utang & Loan Payments",
  "Padala/Remittance",
  "Shopping",
  "Health & Pharmacy",
  "Education & Tuition",
  "Entertainment & Subscriptions",
  "Savings & Investments",
  "Fees & Charges",
  "Uncategorized",
].sort();

// ---------------------------------------------------------------------------
// Verbatim from task-12-brief.md Step 1 — the seven named tests.
// ---------------------------------------------------------------------------

test("seedDefaultCategories inserts the 15 PH default categories", async () => {
  await seedDefaultCategories();

  const rows = await db.getAllAsync<{ name: string; is_system: number }>(
    "SELECT name, is_system FROM categories",
  );
  expect(rows).toHaveLength(15);
  expect(rows.every((r) => r.is_system === 1)).toBe(true);

  // Exact name SET, not just count — a typo in one seed name keeps the count
  // right but would slip past a bare `toHaveLength(15)` check.
  expect(rows.map((r) => r.name).sort()).toEqual(PH_DEFAULT_CATEGORY_NAMES);
});

test("seedDefaultCategories is idempotent", async () => {
  const dateSpy = jest.spyOn(Date, "now");
  dateSpy.mockReturnValue(1_000);
  await seedDefaultCategories();

  const before = await db.getAllAsync<{ id: string; created_at: number }>(
    "SELECT id, created_at FROM categories ORDER BY id",
  );
  expect(before).toHaveLength(15);

  // Advance the clock and run again. A true no-op must not touch existing
  // rows at all — a "DELETE then re-insert with the same fixed ids" would
  // keep the id set stable too, but would reset created_at to the new time.
  dateSpy.mockReturnValue(2_000);
  await seedDefaultCategories();
  dateSpy.mockRestore();

  const after = await db.getAllAsync<{ id: string; created_at: number }>(
    "SELECT id, created_at FROM categories ORDER BY id",
  );
  expect(after).toHaveLength(15);
  expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  expect(after).toEqual(before);
});

test("UNCATEGORIZED_ID resolves to a seeded system category", async () => {
  await seedDefaultCategories();
  const category = await getCategory(UNCATEGORIZED_ID);
  expect(category).not.toBeNull();
  expect(category?.name).toBe("Uncategorized");
  expect(category?.isSystem).toBe(true);
});

test("createCategory nests under a parent and listCategories orders parents before children", async () => {
  const parent = await createCategory({ name: "Subscriptions", icon: "tv" });
  const childB = await createCategory({
    name: "Netflix",
    icon: "tv",
    parentId: parent.id,
  });
  const childA = await createCategory({
    name: "Disney+",
    icon: "tv",
    parentId: parent.id,
  });

  const list = await listCategories();
  const ids = list.map((c) => c.id);
  expect(ids).toEqual([parent.id, childA.id, childB.id]);
});

test("deleteCategory throws for a system category", async () => {
  await seedDefaultCategories();
  // Guard: if the fixed id below ever changes, fail loudly instead of
  // silently passing on a null lookup.
  const target = await getCategory("cat_food_dining");
  expect(target).not.toBeNull();

  await expect(deleteCategory(target!.id)).rejects.toThrow(SystemCategoryDeleteError);
  expect(await getCategory(target!.id)).not.toBeNull();
});

test("hideCategory removes the row from listCategories but includeHidden returns it", async () => {
  await seedDefaultCategories();
  const target = await getCategory("cat_fees_charges");
  expect(target).not.toBeNull();

  await hideCategory(target!.id);

  const defaultList = await listCategories();
  expect(defaultList.map((c) => c.id)).not.toContain(target!.id);

  const withHidden = await listCategories({ includeHidden: true });
  const found = withHidden.find((c) => c.id === target!.id);
  expect(found).toBeDefined();
  expect(found?.isHidden).toBe(true);
});

test("deleting a parent reparents its children instead of orphaning them", async () => {
  const parent = await createCategory({ name: "Subscriptions", icon: "tv" });
  const childA = await createCategory({
    name: "Netflix",
    icon: "tv",
    parentId: parent.id,
  });
  const childB = await createCategory({
    name: "Disney+",
    icon: "tv",
    parentId: parent.id,
  });

  await deleteCategory(parent.id);

  expect(await getCategory(parent.id)).toBeNull();
  const rereadA = await getCategory(childA.id);
  const rereadB = await getCategory(childB.id);
  expect(rereadA).not.toBeNull();
  expect(rereadB).not.toBeNull();
  // Parent was top-level (parentId null), so children become top-level too —
  // not deleted, not left pointing at a row that no longer exists.
  expect(rereadA?.parentId).toBeNull();
  expect(rereadB?.parentId).toBeNull();
});

// ---------------------------------------------------------------------------
// Discriminating suite below, built so a plausible-but-broken implementation
// fails for a specific, identifiable reason.
// ---------------------------------------------------------------------------

describe("listCategories ordering discriminates DFS-per-family from a flat BFS-by-level merge", () => {
  test("two parents with children inserted out of order still come back family-grouped, name-ascending within each group", async () => {
    // Insertion order deliberately scrambled: Zeta family first, Alpha family
    // second, children interleaved. If listCategories sorted by created_at,
    // or grouped "all parents then all children merged alphabetically across
    // families" (a BFS-by-level reading of the ordering rule), the result
    // would differ from strict per-family DFS pre-order in a way this test
    // catches — both alternates are plausible readings of "parents before
    // children, each group name-ascending" and must be ruled out explicitly.
    const zeta = await createCategory({ name: "Zeta", icon: "tv" });
    const zetaChildB = await createCategory({ name: "Zeta-B", icon: "tv", parentId: zeta.id });
    const alpha = await createCategory({ name: "Alpha", icon: "tv" });
    const alphaChildB = await createCategory({ name: "Alpha-B", icon: "tv", parentId: alpha.id });
    const zetaChildA = await createCategory({ name: "Zeta-A", icon: "tv", parentId: zeta.id });
    const alphaChildA = await createCategory({
      name: "Alpha-A",
      icon: "tv",
      parentId: alpha.id,
    });

    const list = await listCategories();
    expect(list.map((c) => c.id)).toEqual([
      alpha.id,
      alphaChildA.id,
      alphaChildB.id,
      zeta.id,
      zetaChildA.id,
      zetaChildB.id,
    ]);
  });
});

describe("seedDefaultCategories name-set precision", () => {
  test("no default category name is duplicated and every default is top-level", async () => {
    await seedDefaultCategories();
    const rows = await listCategories();
    const names = rows.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(rows.every((c) => c.parentId === null)).toBe(true);
  });
});

describe("deleteCategory rejects every system row, not just Uncategorized", () => {
  test("a non-Uncategorized default (Fees & Charges) survives a delete attempt", async () => {
    await seedDefaultCategories();
    await expect(deleteCategory("cat_fees_charges")).rejects.toThrow(SystemCategoryDeleteError);
    expect(await getCategory("cat_fees_charges")).not.toBeNull();
  });
});

describe("reparenting resolves to the grandparent's id when one exists, not just null", () => {
  test("deleting a middle-tier category promotes its children to the grandparent, not to top-level", async () => {
    const grandparent = await createCategory({ name: "Digital Life", icon: "tv" });
    const parent = await createCategory({
      name: "Streaming",
      icon: "tv",
      parentId: grandparent.id,
    });
    const childA = await createCategory({ name: "Netflix", icon: "tv", parentId: parent.id });
    const childB = await createCategory({ name: "Disney+", icon: "tv", parentId: parent.id });

    await deleteCategory(parent.id);

    expect(await getCategory(parent.id)).toBeNull();
    expect((await getCategory(childA.id))?.parentId).toBe(grandparent.id);
    expect((await getCategory(childB.id))?.parentId).toBe(grandparent.id);
  });
});

describe("createCategory sibling-name uniqueness handles the NULL parent_id case explicitly (review finding)", () => {
  // `WHERE parent_id = ?` never matches when the column is NULL — SQLite
  // treats every NULL as distinct from every other NULL — so a naive
  // same-parent uniqueness check silently lets two top-level "Food" rows
  // coexist. This proves the top-level branch is handled as its own case.
  test("two top-level categories with the same name (case-insensitive) collide", async () => {
    await createCategory({ name: "Food", icon: "utensils" });
    await expect(createCategory({ name: "food", icon: "utensils" })).rejects.toThrow(
      DuplicateCategoryNameError,
    );
  });

  test("the same name is allowed under two different parents (siblings only, not global)", async () => {
    const parentA = await createCategory({ name: "Family A", icon: "tv" });
    const parentB = await createCategory({ name: "Family B", icon: "tv" });
    await createCategory({ name: "Misc", icon: "tv", parentId: parentA.id });
    // Same name "Misc" under a DIFFERENT parent must be allowed — uniqueness
    // is per-sibling-group, not tree-wide.
    await expect(
      createCategory({ name: "Misc", icon: "tv", parentId: parentB.id }),
    ).resolves.toBeTruthy();
  });

  test("a non-Uncategorized child name colliding with an unrelated top-level sibling is still allowed", async () => {
    // Sanity check that the NULL-parent branch doesn't over-match: a
    // top-level category and a nested category sharing a name are NOT
    // siblings (different parent_id groups) and must both be allowed.
    const parent = await createCategory({ name: "Container", icon: "tv" });
    await createCategory({ name: "Echo", icon: "tv" });
    await expect(
      createCategory({ name: "Echo", icon: "tv", parentId: parent.id }),
    ).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Coordinator rulings (fix pass): Uncategorized is protected from hide too,
// and deleteCategory must reassign its own Transactions instead of relying
// on the FK to reject the delete outright.
// ---------------------------------------------------------------------------

describe("Uncategorized cannot be hidden or deleted (docs §3.4 invariant 2, §5 I8)", () => {
  test("hideCategory(UNCATEGORIZED_ID) throws and the row stays visible and unhidden", async () => {
    await seedDefaultCategories();
    await expect(hideCategory(UNCATEGORIZED_ID)).rejects.toThrow(UncategorizedProtectedError);

    const stillThere = await getCategory(UNCATEGORIZED_ID);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.isHidden).toBe(false);
    expect((await listCategories()).map((c) => c.id)).toContain(UNCATEGORIZED_ID);
  });

  test("deleteCategory(UNCATEGORIZED_ID) throws and the row survives", async () => {
    await seedDefaultCategories();
    await expect(deleteCategory(UNCATEGORIZED_ID)).rejects.toThrow(UncategorizedProtectedError);

    const stillThere = await getCategory(UNCATEGORIZED_ID);
    expect(stillThere).not.toBeNull();
    expect((await listCategories()).map((c) => c.id)).toContain(UNCATEGORIZED_ID);
  });
});

describe("deleteCategory reassigns the deleted category's own transactions instead of orphaning them", () => {
  test("deleting a child category moves its transactions to the parent, amount intact", async () => {
    const wallet = await createWallet({ name: "Cash" });
    const parent = await createCategory({ name: "Food (custom)", icon: "utensils" });
    const child = await createCategory({ name: "Coffee", icon: "coffee", parentId: parent.id });
    await insertTransaction({
      id: "tx-coffee",
      walletId: wallet.id,
      categoryId: child.id,
      amount: 15000,
    });

    await deleteCategory(child.id);

    expect(await getCategory(child.id)).toBeNull();
    const row = await db.getFirstAsync<{ category_id: string; amount: number }>(
      "SELECT category_id, amount FROM transactions WHERE id = ?",
      ["tx-coffee"],
    );
    // Exact centavo value, not just "truthy" — catches a reassignment that
    // accidentally rewrites more than category_id.
    expect(row).toEqual({ category_id: parent.id, amount: 15000 });
  });

  test("deleting a top-level category moves its transactions to Uncategorized, amount intact", async () => {
    await seedDefaultCategories();
    const wallet = await createWallet({ name: "Cash" });
    const custom = await createCategory({ name: "One-off", icon: "circle" });
    await insertTransaction({
      id: "tx-oneoff",
      walletId: wallet.id,
      categoryId: custom.id,
      amount: 999999,
    });

    await deleteCategory(custom.id);

    expect(await getCategory(custom.id)).toBeNull();
    const row = await db.getFirstAsync<{ category_id: string; amount: number }>(
      "SELECT category_id, amount FROM transactions WHERE id = ?",
      ["tx-oneoff"],
    );
    expect(row).toEqual({ category_id: UNCATEGORIZED_ID, amount: 999999 });
  });
});

describe("deleteCategory's reparent + transaction-reassign + delete are atomic", () => {
  test("when the delete step fails, no transaction is reassigned and the category survives", async () => {
    await seedDefaultCategories();
    const wallet = await createWallet({ name: "Cash" });
    const custom = await createCategory({ name: "Doomed", icon: "circle" });
    await insertTransaction({
      id: "tx-doomed",
      walletId: wallet.id,
      categoryId: custom.id,
      amount: 42000,
    });

    // Force the final DELETE to fail without mocking anything: a bill still
    // references this category, and the schema's foreign key on
    // bills.category_id has no ON DELETE action, so
    // `DELETE FROM categories WHERE id = ?` throws mid-transaction — after
    // the reparent and transaction-reassign UPDATEs earlier in the same
    // withTransactionAsync block have already run, but before COMMIT.
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO bills (id, name, amount, amount_mode, due_rule_json, category_id, created_at, updated_at)
       VALUES (?, ?, ?, 'fixed', '{}', ?, ?, ?)`,
      ["bill-doomed", "Doomed Bill", 10000, custom.id, now, now],
    );

    await expect(deleteCategory(custom.id)).rejects.toThrow(/FOREIGN KEY/i);

    // Rolled back: the category itself must still exist...
    expect(await getCategory(custom.id)).not.toBeNull();
    // ...and the transaction must still point at it, not at wherever it
    // would have been reassigned to had the delete gone through.
    const row = await db.getFirstAsync<{ category_id: string }>(
      "SELECT category_id FROM transactions WHERE id = ?",
      ["tx-doomed"],
    );
    expect(row).toEqual({ category_id: custom.id });
  });
});

// ---------------------------------------------------------------------------
// listCategoryRefs — m2 Task 7. The tree edges the limits engine walks
// (limits rule 4: picking a parent includes all its descendants).
// ---------------------------------------------------------------------------
describe("listCategoryRefs", () => {
  it("returns every category as an id/parentId pair, roots with a null parent", async () => {
    await seedDefaultCategories();
    const parent = await createCategory({ name: "Side Hustle", icon: "briefcase" });
    const child = await createCategory({ name: "Delivery", icon: "bike", parentId: parent.id });

    const refs = await listCategoryRefs();

    expect(refs).toContainEqual({ id: parent.id, parentId: null });
    expect(refs).toContainEqual({ id: child.id, parentId: parent.id });
    // Every row, seeded defaults included — the engine walks the whole tree.
    expect(refs).toHaveLength((await listCategories({ includeHidden: true })).length);
  });

  it("INCLUDES hidden categories", async () => {
    // A transaction can still sit in a hidden category, and its spend counts
    // toward the parent the user actually selected for their limit. Filtering
    // them out here would silently stop counting that spend.
    const parent = await createCategory({ name: "Food & Dining", icon: "utensils" });
    const child = await createCategory({ name: "Delivery", icon: "bike", parentId: parent.id });
    await hideCategory(child.id);

    expect(await listCategoryRefs()).toContainEqual({ id: child.id, parentId: parent.id });
  });
});

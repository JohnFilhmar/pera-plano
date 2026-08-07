// lib/db/repos/categories_repo.ts — the only SQL surface for the Category
// aggregate (interface contract §3). Screens/services call these functions,
// never SQL. Same house shape as wallets_repo.ts (Task 10): thin functions
// over getDatabase(), rowToX mappers from lib/db/mappers.ts, domain types
// from types/domain.ts, no entitlement checks here (those live at the
// UI/service layer — see lib/entitlements.ts).
import { getDatabase } from "@/lib/db/database";
import { categoryToRow, rowToCategory, type CategoryRow } from "@/lib/db/mappers";
import { newId } from "@/lib/ids";
import type { Category, NewCategory } from "@/types/domain";

/**
 * Thrown by `deleteCategory` when the target is a system category
 * (`is_system = 1`; docs/02-domain-model.md §3.4 invariant 3). System rows
 * are the shipped PH defaults that the parser/Categorizer pin by id — deleting
 * one would leave those mappings dangling. `hideCategory` is the supported
 * retirement path for a system row.
 */
export class SystemCategoryDeleteError extends Error {
  constructor(public readonly categoryId: string) {
    super("cannot delete a system category");
    this.name = "SystemCategoryDeleteError";
  }
}

/**
 * Thrown by `updateCategory` when the target is a system category. Per
 * docs/02-domain-model.md §3.4: system categories cannot be renamed,
 * re-parented, or have their icon changed — only hidden/unhidden — because
 * the parser/Categorizer mappings and this file's fixed seed ids assume the
 * shipped defaults never change shape.
 */
export class SystemCategoryEditError extends Error {
  constructor(public readonly categoryId: string) {
    super("cannot modify a system category");
    this.name = "SystemCategoryEditError";
  }
}

/**
 * Thrown by `updateCategory` when `id` has no row.
 */
export class CategoryNotFoundError extends Error {
  constructor(public readonly categoryId: string) {
    super(`category not found: ${categoryId}`);
    this.name = "CategoryNotFoundError";
  }
}

/**
 * Thrown by `createCategory` when `name` collides with an existing sibling
 * (same `parentId`, docs/02-domain-model.md §3.4: "Unique among siblings").
 * The comparison is case-insensitive — category names are free-typed for
 * custom categories, so "Food" and "food" are the same collision a real user
 * will trip over (Task 10 precedent, wallets_repo.ts `DuplicateNameError`).
 */
export class DuplicateCategoryNameError extends Error {
  constructor(public readonly categoryName: string) {
    super(`category name already in use among siblings: ${categoryName}`);
    this.name = "DuplicateCategoryNameError";
  }
}

/**
 * Stable, fixed id for the universal fallback category. The ingest
 * pipeline's Categorizer falls back to this for every unmatched transaction,
 * so it must be the same value on every device and across every app launch —
 * never generated via `newId()`.
 */
export const UNCATEGORIZED_ID = "cat_uncategorized";

type DefaultCategorySeed = { id: string; name: string; icon: string };

/**
 * The 15 PH-flavored default categories (docs/02-domain-model.md §3.4; brief
 * rule 5 reproduces the same list). All top-level, all `is_system = 1`. Ids
 * are fixed, human-readable slugs — not `newId()` — so `seedDefaultCategories`
 * can key on them and re-running it is a genuine no-op rather than a
 * duplication or an id renumbering that would break Transactions already
 * pointing at a default category.
 */
const DEFAULT_CATEGORIES: DefaultCategorySeed[] = [
  { id: "cat_food_dining", name: "Food & Dining", icon: "utensils" },
  { id: "cat_groceries_palengke", name: "Groceries/Palengke", icon: "shopping-basket" },
  { id: "cat_transport", name: "Transport", icon: "bus" },
  { id: "cat_load_data", name: "Load & Data", icon: "smartphone" },
  { id: "cat_bills_utilities", name: "Bills & Utilities", icon: "receipt" },
  { id: "cat_rent_housing", name: "Rent & Housing", icon: "home" },
  { id: "cat_utang_loan_payments", name: "Utang & Loan Payments", icon: "hand-coins" },
  { id: "cat_padala_remittance", name: "Padala/Remittance", icon: "send" },
  { id: "cat_shopping", name: "Shopping", icon: "shopping-bag" },
  { id: "cat_health_pharmacy", name: "Health & Pharmacy", icon: "pill" },
  { id: "cat_education_tuition", name: "Education & Tuition", icon: "graduation-cap" },
  {
    id: "cat_entertainment_subscriptions",
    name: "Entertainment & Subscriptions",
    icon: "clapperboard",
  },
  { id: "cat_savings_investments", name: "Savings & Investments", icon: "piggy-bank" },
  { id: "cat_fees_charges", name: "Fees & Charges", icon: "banknote" },
  { id: UNCATEGORIZED_ID, name: "Uncategorized", icon: "circle-help" },
];

/**
 * Inserts the 15 PH default categories if they are not already present.
 * Idempotent by construction: every default row has a fixed id, and
 * `INSERT OR IGNORE` silently skips any id that already exists rather than
 * duplicating the row or touching its `created_at`/`updated_at`. Runs on
 * every app launch from bootstrap.
 */
export async function seedDefaultCategories(): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  for (const seed of DEFAULT_CATEGORIES) {
    await db.runAsync(
      `INSERT OR IGNORE INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 1, 0, ?, ?)`,
      [seed.id, seed.name, seed.icon, now, now],
    );
  }
}

/** Returns `null` (never throws, never `undefined`) when `id` has no row. */
export async function getCategory(id: string): Promise<Category | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CategoryRow>("SELECT * FROM categories WHERE id = ?", [id]);
  return row ? rowToCategory(row) : null;
}

function compareNames(a: Category, b: Category): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Parents before their children, each sibling group name-ascending
 * (case-insensitive) — a depth-first, pre-order walk of the tree starting
 * from the top-level (`parent_id IS NULL`) group. Pass `includeHidden: true`
 * to also get hidden rows woven into the same order.
 */
export async function listCategories(opts?: { includeHidden?: boolean }): Promise<Category[]> {
  const db = await getDatabase();
  const sql = opts?.includeHidden
    ? "SELECT * FROM categories"
    : "SELECT * FROM categories WHERE is_hidden = 0";
  const rows = await db.getAllAsync<CategoryRow>(sql);
  const categories = rows.map(rowToCategory);

  const childrenByParent = new Map<string | null, Category[]>();
  for (const category of categories) {
    const siblings = childrenByParent.get(category.parentId) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareNames);
  }

  const ordered: Category[] = [];
  const visit = (parentId: string | null): void => {
    for (const category of childrenByParent.get(parentId) ?? []) {
      ordered.push(category);
      visit(category.id);
    }
  };
  visit(null);
  return ordered;
}

/**
 * Creates a custom (non-system) Category. Throws `DuplicateCategoryNameError`
 * when `name` collides case-insensitively with a sibling under the same
 * `parentId` — including the top-level group, which SQLite's NULL-is-distinct
 * semantics make easy to miss if the check is a naive `parent_id = ?` (Task 7
 * review finding): top-level siblings are matched with an explicit
 * `parent_id IS NULL` branch instead.
 */
export async function createCategory(input: NewCategory): Promise<Category> {
  const db = await getDatabase();
  const parentId = input.parentId ?? null;

  const clash =
    parentId === null
      ? await db.getFirstAsync<{ id: string }>(
          "SELECT id FROM categories WHERE parent_id IS NULL AND name = ? COLLATE NOCASE",
          [input.name],
        )
      : await db.getFirstAsync<{ id: string }>(
          "SELECT id FROM categories WHERE parent_id = ? AND name = ? COLLATE NOCASE",
          [parentId, input.name],
        );
  if (clash) {
    throw new DuplicateCategoryNameError(input.name);
  }

  const now = Date.now();
  const category: Category = {
    id: newId(),
    name: input.name,
    parentId,
    icon: input.icon,
    isSystem: false,
    isHidden: false,
    createdAt: now,
    updatedAt: now,
  };
  const row = categoryToRow(category);

  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
    [row.id, row.name, row.parent_id, row.icon, row.created_at, row.updated_at],
  );
  return category;
}

/**
 * Renames, re-parents, or re-icons a custom Category. Throws
 * `SystemCategoryEditError` for a system row (docs/02-domain-model.md §3.4:
 * system categories "cannot be deleted, renamed, or re-parented" — icon
 * changes are grouped with rename/re-parent in the same "custom only"
 * lifecycle rule) and `CategoryNotFoundError` when `id` has no row.
 */
export async function updateCategory(
  id: string,
  patch: Partial<Pick<Category, "name" | "icon" | "parentId">>,
): Promise<Category> {
  const db = await getDatabase();
  const existing = await getCategory(id);
  if (!existing) {
    throw new CategoryNotFoundError(id);
  }
  if (existing.isSystem) {
    throw new SystemCategoryEditError(id);
  }

  const now = Date.now();
  const updated: Category = {
    ...existing,
    name: patch.name ?? existing.name,
    icon: patch.icon ?? existing.icon,
    parentId: patch.parentId !== undefined ? patch.parentId : existing.parentId,
    updatedAt: now,
  };

  await db.runAsync(
    "UPDATE categories SET name = ?, icon = ?, parent_id = ?, updated_at = ? WHERE id = ?",
    [updated.name, updated.icon, updated.parentId, updated.updatedAt, id],
  );
  return updated;
}

/**
 * Hides a Category from pickers and suggestion surfaces without deleting it
 * (docs/02-domain-model.md §3.4: hiding is "the model's archival mechanism
 * for categories"). This is the supported way to retire a system category —
 * `deleteCategory` rejects those outright. A no-op if `id` has no row.
 */
export async function hideCategory(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("UPDATE categories SET is_hidden = 1, updated_at = ? WHERE id = ?", [
    Date.now(),
    id,
  ]);
}

/**
 * Deletes a custom Category, reassigning its children to its own `parentId`
 * (or `null` if it was top-level) so nothing is orphaned. Throws
 * `SystemCategoryDeleteError` for a system row; a no-op if `id` has no row.
 *
 * Does not touch Transactions that reference this category directly — the
 * schema's foreign key on `transactions.category_id` will reject the DELETE
 * if any exist. Reassigning a deleted category's own Transactions (to its
 * parent or to Uncategorized, per docs/02-domain-model.md §3.4) is out of
 * this repo's scope; see the task report for why.
 */
export async function deleteCategory(id: string): Promise<void> {
  const db = await getDatabase();
  const existing = await getCategory(id);
  if (!existing) {
    return;
  }
  if (existing.isSystem) {
    throw new SystemCategoryDeleteError(id);
  }

  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE categories SET parent_id = ?, updated_at = ? WHERE parent_id = ?", [
      existing.parentId,
      now,
      id,
    ]);
    await db.runAsync("DELETE FROM categories WHERE id = ?", [id]);
  });
}

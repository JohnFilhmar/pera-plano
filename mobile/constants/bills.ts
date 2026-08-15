// constants/bills.ts — bill defaults shared by the form and the repository.
//
// HERE RATHER THAN IN `lib/db/repos/bills_repo.ts`, where these first lived. A
// component importing a repository module pulls `getDatabase` into the UI
// layer, and the MVP release gate greps `components/` for exactly that — the
// rule exists so a screen can never reach the database directly, and an import
// for one harmless constant is still the import that makes it possible.
//
// These are spec defaults, not storage details: docs/04-features/07-bills.md
// rule 10 and its acceptance criteria both require them "without user
// configuration", which is a product fact that outlives whatever writes it.

/** Spec rule 10's default: 3 days before, and on the due date. Negative = before. */
export const DEFAULT_REMINDER_OFFSETS = [-3, 0];

/** The create flow's default category (spec's create-bill flow, step 6). */
export const DEFAULT_BILL_CATEGORY_ID = "cat_bills_utilities";

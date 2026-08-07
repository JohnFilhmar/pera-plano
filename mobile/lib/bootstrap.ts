// lib/bootstrap.ts — the single startup sequence the root layout awaits
// before mounting the navigator (task-17-brief.md rule 1). Applies pending
// migrations, seeds the default categories, and reads onboarding_complete —
// each of those three steps is independently safe to repeat (runMigrations
// tracks applied versions in schema_migrations; seedDefaultCategories uses
// fixed ids + INSERT OR IGNORE; getSetting is a pure read) so bootstrapApp()
// itself is safe to call on every launch (brief's ordering-hazard rule 3).
import { getDatabase } from "@/lib/db/database";
import { runMigrations } from "@/lib/db/migrations";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";

export type BootstrapResult = { onboardingComplete: boolean };

// Holds the most recent bootstrapApp() result so app/index.tsx can read it
// synchronously without a second DB round-trip or a second render-blank gate
// of its own — by the time index.tsx mounts, the root layout has already
// awaited bootstrapApp() once (rule 1's gate). Module-level singleton, same
// house pattern as lib/db/database.ts's `dbPromise` and lib/fonts.ts's
// `applied` flag: a run-once-at-startup fact, not React state.
let lastResult: BootstrapResult | null = null;

/** Test-only reset so bootstrap.test.ts and app/__tests__ don't leak state across files. */
export function __resetBootstrapForTests(): void {
  lastResult = null;
}

/**
 * Runs the full startup sequence: apply pending migrations, seed the PH
 * default categories, then read `onboarding_complete`. Safe to call on every
 * launch — and, per the brief, safe to call twice in the same launch without
 * doubling any seeded data.
 */
export async function bootstrapApp(): Promise<BootstrapResult> {
  const db = await getDatabase();
  await runMigrations(db);
  await seedDefaultCategories();
  const onboardingComplete = await getSetting("onboarding_complete");
  lastResult = { onboardingComplete };
  return lastResult;
}

/**
 * Synchronous read of the last bootstrapApp() result. Returns `null` only if
 * bootstrapApp() has never resolved in this process — shouldn't happen in the
 * real app given the root layout's gate, but app/index.tsx still treats it
 * defensively (falls through to the tabs) rather than crashing on a null.
 */
export function getLastBootstrapResult(): BootstrapResult | null {
  return lastResult;
}

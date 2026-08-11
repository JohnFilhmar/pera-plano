// lib/bootstrap.ts — the single startup sequence the root layout awaits
// before mounting the navigator (task-17-brief.md rule 1). Applies pending
// migrations, seeds the default categories, seeds the bundled parser ruleset,
// and reads onboarding_complete — each of those four steps is independently
// safe to repeat (runMigrations tracks applied versions in schema_migrations;
// seedDefaultCategories uses fixed ids + INSERT OR IGNORE; seedParserRules
// upserts through a guard that ignores an equal-or-lower version; getSetting is
// a pure read) so bootstrapApp() itself is safe to call on every launch
// (brief's ordering-hazard rule 3).
import { getDatabase } from "@/lib/db/database";
import { runMigrations } from "@/lib/db/migrations";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { purgeExpired } from "@/lib/db/repos/review_queue_repo";
import { purgeExpiredRawCaptures } from "@/lib/db/repos/raw_notifications_repo";
import { seedParserRules } from "@/lib/ingest/seed_rules";

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
 * default categories, seed the bundled parser ruleset, then read
 * `onboarding_complete`. Safe to call on every launch — and, per the brief,
 * safe to call twice in the same launch without doubling any seeded data.
 *
 * The ruleset seed sits after the category seed and before the settings read,
 * where it needs the migrated schema but nothing else. A failure here is left
 * to propagate like every other step's: a device that reaches the tabs with no
 * parser rules would look healthy while silently ingesting nothing, which is
 * worse than the recovery screen.
 */
export async function bootstrapApp(): Promise<BootstrapResult> {
  const db = await getDatabase();
  await runMigrations(db);
  await seedDefaultCategories();
  await seedParserRules();
  await runRetention(Date.now());
  const onboardingComplete = await getSetting("onboarding_complete");
  lastResult = { onboardingComplete };
  return lastResult;
}

/**
 * Retention hygiene (plan Task 11 rule 1). Startup is where it runs, because it
 * is the only moment guaranteed to happen on a device someone actually opens —
 * there is no background job, and a phone that never launches the app should
 * not be accumulating notification text indefinitely.
 *
 * Raw captures carry the 30-day TTL that makes the "we keep the text for a
 * month" promise real rather than aspirational (contract §3), and expired
 * review items are notification-derived content too. `listOpen` already hides
 * an expired item, which is exactly why the deletion has to happen here:
 * hiding is not retention.
 *
 * FAILURES ARE SWALLOWED, unlike every other step in this sequence. A purge is
 * housekeeping; the app is completely usable without it, and letting a failed
 * DELETE put the user on the recovery screen would trade a slightly larger
 * table for a device that cannot open. That asymmetry is the whole reason this
 * is not inlined above.
 */
async function runRetention(now: number): Promise<void> {
  try {
    await purgeExpiredRawCaptures(now);
    await purgeExpired(now);
  } catch {
    // Housekeeping only — never worth failing a launch over.
  }
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

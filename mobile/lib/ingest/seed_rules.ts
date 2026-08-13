// lib/ingest/seed_rules.ts — the ruleset the app ships with.
//
// Spec §11.5: "the app always embeds a known-good ruleset so it works fully
// offline and on first run; remote updates are an improvement channel, not a
// dependency." This module is that embed — it hands the bundled catalogue to
// the versioned ruleset repository at bootstrap, once, and gets out of the way.
//
// ---------------------------------------------------------------------------
// EVERY PATTERN IN assets/parser_rules/seed.json IS A GUESS.
//
// No real GCash, Maya or bank notification has been captured for this project.
// The templates were invented from the illustrative shapes in spec §11.4 to
// give the pipeline something to parse and the corpus something to correct;
// they are NOT verified provider formats, and the JSON carries that disclaimer
// as its first key so it travels with the data into the database row and out
// again in any support dump. Real formats get captured from team-owned devices
// and maintained as a versioned corpus before launch (§11.3), and the ≥95%
// parse-accuracy criterion is measured against THAT, never against this file.
//
// The Android package names are guesses too — none has been checked against a
// device or a Play Store listing. That is survivable rather than fatal only
// because the routing table is remote-updatable ruleset data (§11.1): a wrong
// package name is a data fix, not an app release. Until it is fixed, that
// provider's notifications land in the unknown-bin, where the money-like
// pre-filter still retains them (§3 rule 3).
// ---------------------------------------------------------------------------
//
// Two shape decisions worth stating, because both look like omissions:
//
//   - `tunables` is absent from the JSON, deliberately. The repository merges
//     tunables on READ from DEFAULT_TUNABLES, so restating the fourteen
//     constants here would buy nothing and create a second copy that silently
//     drifts the first time one is recalibrated (§9.1). Absent means "whatever
//     ruleset_types.ts says today", which is exactly what a bundled seed wants.
//   - No template declares a `(?<direction>…)` capture group. Every one of them
//     fixes its direction with the template's own `direction` field instead,
//     so the parser never has to infer from weak keyword cues and never charges
//     the §9.1 weak-direction penalty against a seeded provider.
import seedJson from "@/assets/parser_rules/seed.json";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import type { RulesetBundleInput } from "@/lib/ingest/ruleset_types";

/**
 * The bundled catalogue, typed.
 *
 * The double assertion is unavoidable rather than lazy: TypeScript widens every
 * string in a JSON module to `string`, so `channel` arrives as `string` and not
 * `"push" | "sms"`, and no single-step assertion bridges that. What the compiler
 * cannot check, `__tests__/seed_rules.test.ts` checks at runtime instead — every
 * channel, every direction, every confidence, every `packageNames` entry, and
 * that each `match` compiles and binds an amount.
 *
 * `RulesetBundleInput`, not `RulesetBundle`, because `tunables` is absent (see
 * the header). The extra `_note` / `_packageNamesNote` keys ride along into
 * `payload_json` on purpose; the repository reads only `version`, `providers`
 * and `tunables` back out.
 */
export const SEED_BUNDLE = seedJson as unknown as RulesetBundleInput;

/**
 * Installs the bundled ruleset, unless the device already has an equal-or-newer
 * one. Idempotent, and safe on every launch.
 *
 * There is no version check here on purpose. `upsertRuleset`'s INSERT is
 * guarded by `WHERE ? > (SELECT COALESCE(MAX(version), 0) …)`, so re-running
 * this writes nothing and a device that already fetched ruleset 7 from the
 * server is not dragged back to the bundled 1 on its next cold start. Adding a
 * read-then-write check on top would only reintroduce the race that guard
 * exists to close — bootstrap's seed and a server fetch can be in flight at the
 * same time.
 */
export async function seedParserRules(): Promise<void> {
  await upsertRuleset(SEED_BUNDLE);
}

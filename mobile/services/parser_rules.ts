// services/parser_rules.ts — fetches an updated parser ruleset from the
// server without an app release (M3c Task 5; interface contract §6). This is
// the mitigation for the parser-rot risk (docs/08-risks-and-open-questions.md
// R2): when a provider changes its notification wording, a fixed ruleset
// ships in hours instead of waiting on an app-store release cycle.
//
// THE SERVER DOES NOT EXIST YET (see services/api.ts's header). `server/` is
// 15 tasks of work scheduled after the mobile MVP, so every request this
// makes runs against nothing today — which, for the foreseeable future, is
// the actual runtime condition, not a gap this file works around. Every
// branch below must behave correctly whether the request 404s, times out, or
// one day returns a real bundle.
//
// RULE 3 IS THE WHOLE POINT OF THIS FILE: an invalid remote bundle is
// discarded, never stored. A malformed ruleset that reached every device at
// once would be the exact parser-rot catastrophe this feature exists to
// prevent, so validation runs BEFORE `parser_rulesets_repo.upsertRuleset` —
// never after. A bundle that fails any check is thrown away in memory with
// no write to the database at all.
import { apiClient } from "@/services/api";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { getActiveVersion, upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import type { RulesetBundleInput } from "@/lib/ingest/ruleset_types";

/**
 * How often `checkForRulesetUpdate` is allowed to make a network request.
 * Not pinned to a number anywhere in the spec — docs/03-ingest-pipeline.md
 * §11.2 requires versioning and rollback-safety but names no cadence — so
 * this is a deliberate choice, recorded here rather than silently baked in:
 * 24 hours, matching the app's other once-a-day cadences (the Review Queue
 * digest, the cash-reconcile prompt's own 24-hour threshold). Frequent enough
 * that a provider fix reaches devices the same day it ships; infrequent
 * enough that an extended offline stretch — the PH-mobile-data norm this app
 * is built around — doesn't turn every launch or foreground into a repeat
 * request for nothing new.
 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type RawTemplate = { match?: unknown };
type RawProvider = { templates?: unknown };
type RawBundle = { version?: unknown; providers?: unknown };

/**
 * Rule 3, exactly and no further: a higher version than what's installed, a
 * non-empty `providers` array, and every template's `match` compiles as a
 * regex. Nothing beyond that — a stricter check here (requiring
 * `packageNames`, a fixed `direction`, a `channel`, whatever) risks rejecting
 * a legitimate server bundle that the bundled seed's own shape
 * (assets/parser_rules/seed.json, validated by
 * lib/ingest/__tests__/seed_rules.test.ts) would accept without issue.
 *
 * Compilation is checked by actually constructing the `RegExp` — a string
 * check for a marker substring would pass happily on a source with an
 * unbalanced paren, which is precisely the pattern that throws here and would
 * otherwise reach `upsertRuleset` and take down every parse on the device
 * that uses it.
 */
function isValidBundle(data: unknown, currentVersion: number): data is RulesetBundleInput {
  if (data === null || typeof data !== "object") return false;
  const { version, providers } = data as RawBundle;

  if (typeof version !== "number" || version <= currentVersion) return false;
  if (!Array.isArray(providers) || providers.length === 0) return false;

  for (const provider of providers as RawProvider[]) {
    if (provider === null || typeof provider !== "object") return false;
    const { templates } = provider;
    if (!Array.isArray(templates)) return false;

    for (const template of templates as RawTemplate[]) {
      if (template === null || typeof template !== "object") return false;
      const { match } = template;
      if (typeof match !== "string") return false;
      try {
        new RegExp(match);
      } catch {
        return false;
      }
    }
  }

  return true;
}

/**
 * Fetches `GET /v1/parser_rules?since_version=N` (N = the device's installed
 * version, per `parser_rulesets_repo.getActiveVersion()`) and installs the
 * response if — and only if — it validates (rule 3).
 *
 * Never throws. A network failure, a non-200 status (404 included — contract
 * §6's short-circuit and a not-yet-existing server both answer this way, and
 * both mean "nothing to install"), an empty `providers` array, or a bundle
 * that fails validation all resolve the same way: `{ updated: false, version
 * }` with the device's installed ruleset untouched (rule 4).
 */
export async function checkForRulesetUpdate(
  now: number,
): Promise<{ updated: boolean; version: number }> {
  const currentVersion = await getActiveVersion();

  const lastCheckedAt = await getSetting("parser_rules_checked_at");
  if (lastCheckedAt !== null && now - lastCheckedAt < CHECK_INTERVAL_MS) {
    return { updated: false, version: currentVersion };
  }

  let status: number;
  let data: unknown;
  try {
    const response = await apiClient.get<unknown>("/v1/parser_rules", {
      params: { since_version: currentVersion },
    });
    status = response.status;
    data = response.data;
  } catch {
    // A real network failure — no HTTP response reached us at all
    // (services/api.ts's response interceptor). Silent, like every other
    // failure mode here (rule 4); offline is normal. The check time is
    // deliberately NOT recorded on this path — a device that never reached
    // the server should retry on the next opportunity, not wait out the full
    // interval it never got to use.
    return { updated: false, version: currentVersion };
  }

  // A response reached us — record the check regardless of what it found, so
  // a 404/empty/invalid answer doesn't re-request on every subsequent
  // launch or foreground before the interval is up (rule 5).
  await setSetting("parser_rules_checked_at", now);

  if (status !== 200) {
    // A 404 is a normal answer here, not an error (services/api.ts) — and so
    // is any other non-200 status: none of them carry a bundle to install.
    return { updated: false, version: currentVersion };
  }

  const providers = (data as RawBundle | null)?.providers;
  if (!Array.isArray(providers) || providers.length === 0) {
    // Rule 2: an empty (or absent/malformed) providers array means the
    // device is current. Not a failure, so no warning — this is the normal,
    // expected shape of "nothing new."
    return { updated: false, version: currentVersion };
  }

  if (!isValidBundle(data, currentVersion)) {
    // Non-empty providers that still fails validation (stale version, or a
    // template whose regex won't compile) is the case rule 3 exists for:
    // discard in memory, never store.
    console.warn(
      "[parser_rules] discarding invalid ruleset bundle from server — keeping the current version",
    );
    return { updated: false, version: currentVersion };
  }

  await upsertRuleset(data);
  return { updated: true, version: await getActiveVersion() };
}

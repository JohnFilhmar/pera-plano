// services/telemetry.ts — aggregate parse-outcome telemetry (M3c Task 6).
//
// THE PROMISE THIS FILE KEEPS. The Settings screen and the Privacy Centre
// both tell the user, in writing: "When on, PeraPlano shares only counts of
// successful and failed notification parses, per provider. Never
// notification content, amounts, or merchant names." This file is what
// makes that sentence true or false — see docs/07-privacy-and-compliance.md
// §5 rule 3 and the interface contract's §6 route definition.
//
// THE WHITELIST. `POST /v1/telemetry/parse_stats` carries exactly seven
// fields: `appVersion`, `rulesetVersion`, `providerKey`, `parsed`, `failed`,
// `periodStart`, `periodEnd`. `services/__tests__/telemetry.test.ts` pins
// this with a whitelist assertion (exact key match) AND a privacy-regression
// assertion (the full serialized body scanned for forbidden substrings, so a
// value smuggled a level deeper than the top level is still caught). Both
// tests must never be deleted or loosened — a change that adds a field
// should make them FAIL, not pass silently.
//
// WHAT NEVER GOES IN THE BODY. `services/api.ts`'s `apiClient` already
// attaches no device identifier and no Authorization header (see that
// file's own guard). This file must not defeat that by putting an id in the
// BODY instead of a header — there is no field here for one, and the
// whitelist test is what would catch an attempt to add one.
//
// ONE REQUEST PER PROVIDER. The contract's route shape is a single object
// (`providerKey` singular, not an array), so a device with counts for two
// providers sends two requests, not one batched array the server was never
// specified to accept.
//
// THE INTERVAL / PERIOD-START SEAM. `app_settings.last_telemetry_sent_at`
// (epoch ms, `null` before the first successful send) does two jobs at
// once: it gates re-sends ("at most once per TELEMETRY_INTERVAL_MS") and it
// is the local stats window's `periodStart` for the *next* send. Both must
// move together, so it is written in the SAME step that clears
// `parse_stats` — on a confirmed successful send only. Never on an opted-out
// call, a zero-stats call, or a failed one: advancing it on a failure would
// move `periodStart` past counts that are still sitting, unsent, in the
// table (`lib/diagnostics/parse_stats_repo.ts`), silently dropping them from
// every future report. A `{ status: 0 }` network rejection from `apiClient`
// (a normal condition — offline is this app's expected state, per
// `services/api.ts`'s header) is exactly such a failure.
//
// SILENT ON FAILURE, like the ruleset check (`services/parser_rules.ts`).
// Nothing here throws to the caller; a rejected or non-2xx response simply
// resolves `{ sent: false }`.
import Constants from "expo-constants";

import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { clearParseStats, getParseStats } from "@/lib/diagnostics/parse_stats_repo";

import { apiClient } from "./api";

/**
 * Minimum time between sends. `parse_stats` (migration 009) already buckets
 * on local-day boundaries and the diagnostics screen's own rolling window is
 * day-granular, so a day is the natural cadence for the server-bound batch
 * built from the same table — there is nothing new to report more often
 * than that. Not pinned anywhere else in the docs (an acknowledged
 * ambiguity — recorded in task-6-report.md's Decisions).
 */
const TELEMETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The EXACT and ONLY fields the interface contract §6 allows on the wire. */
type ParseStatsPayload = {
  appVersion: string;
  rulesetVersion: number;
  providerKey: string;
  parsed: number;
  failed: number;
  periodStart: number;
  periodEnd: number;
};

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Sends the device's accumulated parse-outcome counts to the server, one
 * request per provider, then clears the local window — but only once a
 * send is CONFIRMED to have succeeded end to end.
 *
 * Returns `{ sent: false }` — never throws — when: telemetry is opted out
 * (rule 3, no request made at all); the last successful send was within
 * `TELEMETRY_INTERVAL_MS`; there is nothing accumulated to report; or the
 * request failed (rejected, or resolved with a non-2xx status). `now` is a
 * required parameter — this is a service entry point, per `lib/clock.ts`'s
 * house rule, and the caller (app bootstrap / foreground) is the one place
 * that should ever read the wall clock.
 */
export async function sendParseStats(now: number): Promise<{ sent: boolean }> {
  const telemetryEnabled = await getSetting("telemetry_enabled");
  if (!telemetryEnabled) {
    return { sent: false };
  }

  const lastSentAt = await getSetting("last_telemetry_sent_at");
  if (lastSentAt !== null && now - lastSentAt < TELEMETRY_INTERVAL_MS) {
    return { sent: false };
  }

  const periodStart = lastSentAt ?? 0;
  const periodEnd = now;
  const stats = await getParseStats(periodStart);
  if (stats.length === 0) {
    return { sent: false };
  }

  const appVersion = Constants.expoConfig?.version ?? "unknown";
  const rulesetVersion = await getSetting("last_parser_ruleset_version");

  try {
    const responses = await Promise.all(
      stats.map((stat) => {
        const payload: ParseStatsPayload = {
          appVersion,
          rulesetVersion,
          providerKey: stat.providerKey,
          parsed: stat.parsed,
          failed: stat.failed,
          periodStart,
          periodEnd,
        };
        return apiClient.post("/v1/telemetry/parse_stats", payload);
      }),
    );

    if (!responses.every((response) => isSuccessStatus(response.status))) {
      return { sent: false };
    }

    await clearParseStats();
    await setSetting("last_telemetry_sent_at", now);
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

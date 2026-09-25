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
//
// WHOEVER ANSWERS THAT URL IS NOT TRUSTED, and neither is anyone who can sit
// between the device and it. The bundle they send decides whether money is
// booked without the user ever seeing it, and supplies the regexes every
// notification is run through, so `lib/ingest/ruleset_schema.ts` bounds its
// shape, its numbers and its patterns; this file bounds its SIZE, before
// anything here parses it. Authenticity is a separate problem that neither
// solves.
import { apiClient } from "@/services/api";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { getActiveVersion, upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { MAX_RESPONSE_CHARS, parseRulesetBundle } from "@/lib/ingest/ruleset_schema";
import {
  RULESET_SIGNATURE_HEADER,
  verifyRulesetSignature,
} from "@/lib/ingest/ruleset_signature";

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

type RawBundle = { providers?: unknown };

/**
 * Reads the raw response body, refusing anything too large to be a ruleset
 * BEFORE `JSON.parse` ever sees it.
 *
 * THE ORDER IS THE CONTROL. A cap applied after parsing is not a cap: by then
 * a multi-megabyte body has already been walked, allocated and turned into an
 * object graph on a phone, which is the denial of service the cap exists to
 * prevent. That is also why the request below asks for text with axios's JSON
 * transform switched off — left on, axios would have parsed a hostile body
 * before this function was ever reached.
 *
 * What this does NOT do is stop the download. React Native's XHR transport
 * offers no way to abort mid-body, so a hostile server can still make a device
 * pull bytes until the client's 30-second timeout (services/api.ts). The cap
 * bounds what is parsed and what is stored, not what is received.
 */
function decodeBody(data: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (typeof data !== "string") return { ok: false, reason: "response body was not text" };
  if (data.length > MAX_RESPONSE_CHARS) {
    return {
      ok: false,
      reason: `response body is ${data.length} characters, over the ${MAX_RESPONSE_CHARS} cap`,
    };
  }

  try {
    return { ok: true, value: JSON.parse(data) as unknown };
  } catch {
    return { ok: false, reason: "response body is not JSON" };
  }
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
  let signatureHeader: string | null = null;
  try {
    const response = await apiClient.get<unknown>("/v1/parser_rules", {
      params: { since_version: currentVersion },
      // The body arrives as TEXT, untouched: `decodeBody` has to see the raw
      // string to cap it, and axios's default JSON transform would have
      // parsed a hostile body before this file got a look at its size.
      responseType: "text",
      transformResponse: [],
    });
    status = response.status;
    data = response.data;
    const header = (response.headers as Record<string, unknown> | undefined)?.[
      RULESET_SIGNATURE_HEADER
    ];
    signatureHeader = typeof header === "string" ? header : null;
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

  // AUTHENTICITY, BEFORE A SINGLE BYTE IS PARSED (GAP-043, docs/03 §11.2 rule
  // 2). The cap in `decodeBody` is a denial-of-service control and the schema
  // below is a shape control; neither says anything about ORIGIN, and until
  // this existed the only thing standing behind a bundle was TLS to a host the
  // owner controls. The type and size guards are repeated here rather than
  // borrowed from `decodeBody` so that verification genuinely runs FIRST: a
  // verifier that only sees what a parser already accepted is checking the
  // wrong artefact, and hashing an uncapped body would hand back the very cost
  // the cap exists to refuse.
  //
  // FAILS CLOSED, INCLUDING WHEN THE HEADER IS SIMPLY ABSENT. There is no
  // allowance for unsigned bundles while the server is being built, because an
  // allowance like that is what would still be in place the day it went live.
  if (
    typeof data !== "string" ||
    data.length > MAX_RESPONSE_CHARS ||
    !verifyRulesetSignature(data, signatureHeader)
  ) {
    console.warn(
      "[parser_rules] discarding a ruleset bundle that is unsigned or fails signature verification — keeping the current version",
    );
    return { updated: false, version: currentVersion };
  }

  const body = decodeBody(data);
  if (!body.ok) {
    console.warn(
      `[parser_rules] discarding invalid ruleset bundle from server (${body.reason}) — keeping the current version`,
    );
    return { updated: false, version: currentVersion };
  }

  const providers = (body.value as RawBundle | null)?.providers;
  if (!Array.isArray(providers) || providers.length === 0) {
    // Rule 2: an empty (or absent/malformed) providers array means the
    // device is current. Not a failure, so no warning — this is the normal,
    // expected shape of "nothing new."
    return { updated: false, version: currentVersion };
  }

  const parsed = parseRulesetBundle(body.value);
  if (!parsed.ok) {
    // Non-empty providers that still fails validation — an unrecognised
    // shape, a tunable outside its range, or a pattern too long, too tangled
    // or too slow — is the case rule 3 exists for: discard in memory, never
    // store.
    console.warn(
      `[parser_rules] discarding invalid ruleset bundle from server (${parsed.reason}) — keeping the current version`,
    );
    return { updated: false, version: currentVersion };
  }

  if (parsed.bundle.version <= currentVersion) {
    console.warn(
      "[parser_rules] discarding invalid ruleset bundle from server (not newer than the installed version) — keeping the current version",
    );
    return { updated: false, version: currentVersion };
  }

  // STAGED ROLLOUT (docs/03 §11.2 rule 4, GAP-043), and its position in this
  // function is the security-relevant part. `rolloutPercent` arrives INSIDE the
  // bundle, so it is attacker-chosen until the signature has been checked; this
  // runs after verification, after the schema, and after the version comparison,
  // which means a percentage can only ever narrow what a bundle the app had
  // already decided to trust does.
  //
  // A DEVICE OUTSIDE THE ROLLOUT IS NOT A FAILURE AND SAYS NOTHING. It keeps the
  // ruleset it has and records the check like any other answer, so it does not
  // re-ask before the interval is up. It will install this version the moment the
  // percentage is raised past its bucket, with no further state needed.
  if (!isInRollout(parsed.bundle.rolloutPercent, await rolloutBucket())) {
    return { updated: false, version: currentVersion };
  }

  // The PARSED bundle, not the raw body: the schema strips keys it does not
  // know, so nothing an attacker chose to append is stored verbatim.
  await upsertRuleset(parsed.bundle);
  return { updated: true, version: await getActiveVersion() };
}

/**
 * Whether this device is inside a bundle's rollout.
 *
 * An ABSENT percentage means everyone, because every bundle published before the
 * field existed has to keep installing. `bucket < percent` rather than `<=`, so
 * `rolloutPercent: 10` reaches buckets 0 to 9, which is ten of a hundred rather
 * than eleven; at 100 every bucket qualifies.
 *
 * @param rolloutPercent - 1 to 100, or `undefined` for every device.
 * @param bucket - This device's stable 0-99 bucket.
 */
export function isInRollout(rolloutPercent: number | undefined, bucket: number): boolean {
  return rolloutPercent === undefined || bucket < rolloutPercent;
}

/**
 * This device's rollout bucket, assigning one on first use.
 *
 * WRITTEN ONCE AND THEN STABLE. A bucket re-rolled per check would move the
 * device in and out of a rollout on successive days, which is not a staged
 * rollout of anything. See `parser_rules_rollout_bucket` in
 * `lib/db/repos/app_settings_repo.ts` for why this is a stored random number
 * rather than a hash of a device identifier: this app deliberately holds no such
 * identifier, and minting one to bucket by would be a worse trade than a random
 * integer that never leaves the phone.
 */
async function rolloutBucket(): Promise<number> {
  const stored = await getSetting("parser_rules_rollout_bucket");
  if (stored !== null) return stored;
  const assigned = Math.floor(Math.random() * 100);
  await setSetting("parser_rules_rollout_bucket", assigned);
  return assigned;
}

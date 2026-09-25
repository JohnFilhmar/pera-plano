// server/apps/web/app/v1/parser_rules/route.ts — the parser-ruleset channel
// (docs/03-ingest-pipeline.md §11.2, GAP-043).
//
// Served on the API subdomain, whose nginx site and hostname live in
// docs/nginx/peraplano-api-production.conf, and NOT under /api/, which is the
// app's own convention for its own routes. The host is named there rather than
// here because `structure.test.ts`'s hostname discipline forbids the literal
// anywhere under app/, components/ or messages/: a hostname in this tree silently
// beats PUBLIC_BASE_URL on a staging deploy, and the check is a blunt string
// match on purpose, so that a comment today cannot become a string tomorrow. The
// version lives in the path because this is the one endpoint a shipped phone
// keeps calling forever: every installed copy asks for `/v1/parser_rules` until
// the user updates, so the path has to outlive whatever serves it.
//
// THE BODY IS RETURNED BYTE FOR BYTE. `Response.json()` is deliberately not used
// anywhere in this file: it re-serializes, and the client verifies an Ed25519
// signature over the exact bytes it received. One re-ordered key or one changed
// space and every device on earth rejects a valid ruleset.
//
// THIS ROUTE HOLDS NO KEY AND SIGNS NOTHING. The signature was produced on the
// owner's machine by `mobile/scripts/sign_ruleset.mjs` and committed beside the
// body. That is the whole security posture: someone who takes this box can serve
// any bytes they like and cannot make a phone accept them, because the private
// key was never here. A route that signed per request would hand that power to
// whoever reached the host.
import {
  RULESET_BODY,
  RULESET_SIGNATURE,
  RULESET_VERSION,
} from "@/rulesets/current_ruleset";

/**
 * The header the client reads, lower-cased to match
 * `mobile/lib/ingest/ruleset_signature.ts`'s `RULESET_SIGNATURE_HEADER`.
 */
const SIGNATURE_HEADER = "x-ruleset-signature";

export const dynamic = "force-dynamic";

/**
 * Parses `since_version` the way a hostile caller should be parsed.
 *
 * Anything that is not a non-negative integer is treated as "no version", which
 * serves the bundle. That is the safe direction: the client discards a bundle it
 * already has by version anyway, so the cost of serving one needlessly is one
 * response, while refusing on a malformed parameter would let a typo stop a
 * device receiving a fix.
 */
function parseSinceVersion(raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Serves the published ruleset, or 204 when there is nothing newer to send.
 *
 * 204 RATHER THAN 404 FOR "NOTHING NEW", and the client treats every non-200 the
 * same way, so this is for whoever reads the logs rather than for the app: a 404
 * on a route that exists invites someone to go looking for a deployment problem
 * that is not there. A device that is already current is the ordinary case, not
 * a miss.
 *
 * NO CACHE HEADERS AND `force-dynamic`. The body and its signature have to travel
 * together: a cached body paired with a newer version's signature fails
 * verification on every device that receives it, and the client already asks at
 * most once a day, so there is nothing to win and a silent outage to lose.
 */
export function GET(request: Request): Response {
  if (RULESET_BODY === null || RULESET_SIGNATURE === null || RULESET_VERSION === null) {
    // The channel is deployed and no ruleset has been published through it yet.
    // The app's own seeded ruleset keeps working; this is not a failure state.
    return new Response(null, { status: 204 });
  }

  const since = parseSinceVersion(new URL(request.url).searchParams.get("since_version"));
  if (since !== null && since >= RULESET_VERSION) {
    return new Response(null, { status: 204 });
  }

  return new Response(RULESET_BODY, {
    status: 200,
    headers: {
      // `application/json` describes the bytes honestly, and the client asks
      // axios not to parse them anyway (`responseType: "text"`), so this
      // annotates rather than instructs.
      "content-type": "application/json; charset=utf-8",
      [SIGNATURE_HEADER]: RULESET_SIGNATURE,
      // A bundle is immutable for its version, but it is also small and asked
      // for once a day. Revalidating always is what keeps the pairing above
      // true through every proxy between here and the phone.
      "cache-control": "no-store",
    },
  });
}

// server/apps/web/rulesets/current_ruleset.ts — GENERATED. Do not hand-edit.
//
// Written by `mobile/scripts/sign_ruleset.mjs`, which is the only thing that
// touches the signing key. Re-run that script to publish a new ruleset; the
// values below are its output.
//
// WHY THE BODY IS A STRING AND NOT AN IMPORTED JSON OBJECT. The signature is
// detached and computed over the RAW BYTES the client receives, so those bytes
// have to survive from signing to serving unchanged. An `import bundle from
// "./ruleset.json"` would hand the route an object, and re-serializing it puts
// key order, number formatting, escaping and whitespace between the signature
// and the body — every one of which is a place for the two sides to disagree
// and for verification to fail on a bundle that is perfectly valid. A string
// literal cannot drift: what was signed is what is sent.
//
// Reading from disk at request time was the other option and is worse here. The
// app builds to a Next.js standalone bundle, which copies traced modules and not
// arbitrary data files, so a `fs.readFile` of a sibling JSON would work in dev
// and 500 in the container.
//
// THE SIGNATURE IS NOT A SECRET. It is a public assertion about a public body;
// only the key that produced it is private, and that key has never been in this
// repository.

/** The exact bytes to serve, or `null` when no ruleset has been published yet. */
export const RULESET_BODY: string | null = null;

/** Base64 Ed25519 signature over `RULESET_BODY`, or `null` with no bundle. */
export const RULESET_SIGNATURE: string | null = null;

/**
 * The published bundle's version, or `null` with no bundle.
 *
 * Exported alongside the body so the route can answer `since_version` without
 * parsing what it is about to serve verbatim. A test pins this against
 * `JSON.parse(RULESET_BODY).version`, because two copies of one number is
 * exactly the shape that drifts.
 */
export const RULESET_VERSION: number | null = null;

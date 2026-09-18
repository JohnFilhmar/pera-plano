// lib/ingest/ruleset_signature.ts — Ed25519 authenticity for the remote parser
// ruleset (GAP-043; docs/03-ingest-pipeline.md §11.2 rule 2).
//
// WHAT THIS CLOSES. The ruleset channel is the one thing that changes how every
// notification on the device is parsed without a store release, and until this
// existed the only thing standing behind a bundle was TLS to a host the owner
// controls. `ruleset_schema.ts` bounds a bundle's SHAPE; it says nothing about
// where the bundle came from. A server that was compromised, or a TLS chain
// that was, could rewrite every user's parsing rules at once and every one of
// those bundles would validate perfectly.
//
// THE SIGNATURE IS DETACHED, IN A HEADER, OVER THE RAW BODY BYTES, and that is
// the whole reason there is no canonicalization code here. Signing a FIELD
// inside the JSON would mean agreeing with the server on a byte-exact
// re-serialization of the rest — key order, number formatting, escaping,
// whitespace — and every one of those is a place for the two sides to disagree
// and for a verifier to be talked into checking something other than what it
// parsed. `parser_rules.ts` already asks axios for text and keeps the raw
// string, so the bytes that are verified are exactly the bytes that are parsed.
//
// FAIL CLOSED, ALWAYS. A missing header, a malformed one, a signature that does
// not verify, and a body that arrived as something other than text all resolve
// the same way: this returns false and the caller keeps the ruleset it already
// has. There is deliberately no "unsigned bundles are allowed while the server
// is being built" escape hatch — a flag like that is exactly what would still
// be switched on the day the server went live.
//
// THE CLIENT SHIPS FIRST, ON PURPOSE. There is no server behind this endpoint
// yet, so nothing is verified in practice today. That is precisely why the key
// ships now: an install that goes out without verification accepts unsigned
// bundles forever, and no later server change can reach it. The build that
// ships before the server exists is the one that has to already know the key.
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";

/**
 * The public half of the parser-ruleset signing key (Ed25519, 32 bytes, hex).
 *
 * Generated 2026-09-18. The private half has never been in this repository and
 * never may be: it lives outside the working tree and belongs in SOPS with the
 * rest of the project's key material.
 *
 * ROTATION COSTS A STORE RELEASE, and that is accepted rather than overlooked.
 * A second trusted key, or a key-rotation bundle signed by the current key,
 * would both remove that cost and both widen exactly the surface this file
 * exists to narrow, so neither ships until there is a server to need it. Losing
 * the private key does not endanger any user's data; it only ends the update
 * channel until the next release.
 */
export const RULESET_PUBLIC_KEY_HEX =
  "6807ace19d1a0a12e76c95a04c618222785c9a295ba5df56acbea86201f15643";

/** The response header carrying the detached signature, lowercase because
 * axios normalises header names and HTTP header names are case-insensitive. */
export const RULESET_SIGNATURE_HEADER = "x-ruleset-signature";

/** An Ed25519 signature is 64 bytes, so 128 hex characters and nothing else. */
const SIGNATURE_HEX_LENGTH = 128;

/**
 * Whether `signatureHex` is a valid signature over `body` under the shipped
 * public key.
 *
 * NEVER THROWS. Every rejection route returns false, because the one thing this
 * must not do is turn a hostile or malformed input into an exception on a
 * background update path where the only correct outcome is "keep what we have".
 *
 * @param body The raw response text, exactly as received and exactly as it will
 *   be parsed. Verified as UTF-8 bytes.
 * @param signatureHex The detached signature from the response header, or
 *   null/undefined when the server sent none.
 * @param publicKeyHex The key to verify under. DEFAULTS TO THE SHIPPED KEY and
 *   the one production call site never passes it — `parser_rules.ts` calls this
 *   with two arguments. It is a parameter solely so the unit tests can exercise
 *   the real Ed25519 path with a keypair they generate, which is otherwise
 *   impossible: producing a valid signature under the shipped key would require
 *   the private half, and that must never be in this repository. A test pins
 *   the default to `RULESET_PUBLIC_KEY_HEX` so this cannot drift into an
 *   accidental escape hatch.
 */
export function verifyRulesetSignature(
  body: string,
  signatureHex: string | null | undefined,
  publicKeyHex: string = RULESET_PUBLIC_KEY_HEX,
): boolean {
  if (typeof signatureHex !== "string") return false;

  const signature = signatureHex.trim().toLowerCase();
  // Length and alphabet are checked before `hexToBytes` so a malformed header
  // is a plain false rather than a thrown parse error inside the try below.
  if (signature.length !== SIGNATURE_HEX_LENGTH) return false;
  if (!/^[0-9a-f]+$/.test(signature)) return false;

  try {
    return ed25519.verify(
      hexToBytes(signature),
      new TextEncoder().encode(body),
      hexToBytes(publicKeyHex),
    );
  } catch {
    return false;
  }
}

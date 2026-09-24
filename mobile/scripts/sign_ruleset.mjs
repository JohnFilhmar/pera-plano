#!/usr/bin/env node
// mobile/scripts/sign_ruleset.mjs — signs a parser-ruleset bundle and writes the
// module the server serves (GAP-043, docs/03-ingest-pipeline.md §11.2).
//
// WHY THIS LIVES IN mobile/ AND NOT IN server/. It signs with the same
// @noble/curves the app verifies with, which is already a dependency here and is
// the library the key was generated with. Signing with a different
// implementation would mean matching key encodings by hand, and the failure mode
// of getting that wrong is a bundle that verifies nowhere — discovered on a
// phone, days later, as "updates silently stopped arriving". The server needs no
// crypto at all: it serves bytes and a string.
//
// THE KEY IS NEVER PRINTED, NEVER LOGGED, AND NEVER COPIED. It is read, used and
// dropped. Its path comes from an argument or the environment, never a constant,
// so this script has no opinion about where you keep it and cannot be run by
// accident against a key it found lying around.
//
// Usage:
//   node mobile/scripts/sign_ruleset.mjs --bundle <path-to-bundle.json> \
//     --key <path-to-private-key> [--out <path-to-current_ruleset.ts>]
//
//   The key path may also come from PERAPLANO_RULESET_KEY.
//   --out defaults to server/apps/web/rulesets/current_ruleset.ts
//
// The bundle you pass is the artefact that gets signed, so format it exactly as
// you want it served: this script writes those bytes out verbatim and signs
// those same bytes. It does not reformat, sort keys, or strip whitespace,
// because every one of those would put a transformation between what you read
// and what the phone verifies.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ed25519 } from "@noble/curves/ed25519.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const DEFAULT_OUT = resolve(REPO_ROOT, "server/apps/web/rulesets/current_ruleset.ts");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function fail(message) {
  console.error(`sign_ruleset: ${message}`);
  process.exit(1);
}

/**
 * Pulls the 32-byte seed out of the key file.
 *
 * The file is comment lines beginning `#` followed by one line of 64 hex
 * characters, which is how it was generated on 2026-09-18. Anything else is
 * refused rather than guessed at: a key read wrongly produces a signature that
 * verifies nowhere, and that failure surfaces on a user's phone rather than here.
 */
function readSeed(keyPath) {
  let text;
  try {
    text = readFileSync(keyPath, "utf8");
  } catch {
    fail(`cannot read the key at ${keyPath}`);
  }
  const candidates = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (candidates.length !== 1 || !/^[0-9a-f]{64}$/i.test(candidates[0])) {
    fail(
      "the key file should hold exactly one line of 64 hex characters, with any comments prefixed '#'. Refusing to guess at its format.",
    );
  }
  return Uint8Array.from(Buffer.from(candidates[0], "hex"));
}

const bundlePath = arg("bundle");
const keyPath = arg("key") ?? process.env.PERAPLANO_RULESET_KEY ?? null;
const outPath = arg("out") ?? DEFAULT_OUT;

if (bundlePath === null) fail("--bundle <path> is required");
if (keyPath === null) fail("--key <path> or PERAPLANO_RULESET_KEY is required");

let body;
try {
  body = readFileSync(bundlePath, "utf8");
} catch {
  fail(`cannot read the bundle at ${bundlePath}`);
}

// Parsed only to read the version and to refuse malformed JSON early. The bytes
// written below are the bytes read above, untouched.
let version;
try {
  const parsed = JSON.parse(body);
  version = parsed?.version;
} catch {
  fail("the bundle is not valid JSON");
}
if (!Number.isSafeInteger(version) || version < 1) {
  fail("the bundle needs an integer `version` of 1 or more; the app installs a bundle only when its version is higher than the one it holds");
}

// The client caps what it will even hash. Refusing here is better than shipping a
// bundle every device discards.
const MAX_RESPONSE_CHARS = 256 * 1024;
if (body.length > MAX_RESPONSE_CHARS) {
  fail(`the bundle is ${body.length} characters; the app refuses anything over ${MAX_RESPONSE_CHARS}`);
}

const seed = readSeed(keyPath);
const signature = Buffer.from(ed25519.sign(new TextEncoder().encode(body), seed)).toString("base64");

// Proves the pair before writing it, using the same verify the app uses. A
// signature that does not check out here would otherwise be found by every
// phone at once and by nobody in between.
const publicKey = ed25519.getPublicKey(seed);
const verified = ed25519.verify(
  Uint8Array.from(Buffer.from(signature, "base64")),
  new TextEncoder().encode(body),
  publicKey,
);
if (!verified) fail("the signature did not verify against its own key; refusing to write");

const module = `// server/apps/web/rulesets/current_ruleset.ts — GENERATED. Do not hand-edit.
//
// Written by \`mobile/scripts/sign_ruleset.mjs\`. Re-run that script to publish a
// new ruleset. See the previous revision of this file in git history for why the
// body is a string literal rather than an imported JSON object: the signature is
// over the exact bytes, and re-serializing an object puts key order and
// whitespace between the signature and the body.
//
// Published version ${version}. The signature is a public assertion about a
// public body; only the key that produced it is private, and that key has never
// been in this repository.

/** The exact bytes to serve, or \`null\` when no ruleset has been published yet. */
export const RULESET_BODY: string | null = ${JSON.stringify(body)};

/** Base64 Ed25519 signature over \`RULESET_BODY\`, or \`null\` with no bundle. */
export const RULESET_SIGNATURE: string | null = ${JSON.stringify(signature)};

/**
 * The published bundle's version, or \`null\` with no bundle.
 *
 * Exported alongside the body so the route can answer \`since_version\` without
 * parsing what it is about to serve verbatim. A test pins this against
 * \`JSON.parse(RULESET_BODY).version\`, because two copies of one number is
 * exactly the shape that drifts.
 */
export const RULESET_VERSION: number | null = ${version};
`;

writeFileSync(outPath, module, "utf8");

// The public key is printed so it can be compared against the constant compiled
// into the app. The private half is not printed, here or anywhere.
console.log(`sign_ruleset: wrote ${outPath}`);
console.log(`  version   ${version}`);
console.log(`  body      ${body.length} characters`);
console.log(`  publicKey ${Buffer.from(publicKey).toString("hex")}`);
console.log("");
console.log("Compare that public key against RULESET_PUBLIC_KEY_HEX in");
console.log("mobile/lib/ingest/ruleset_signature.ts. If they differ, this bundle was");
console.log("signed with the wrong key and every device will reject it.");

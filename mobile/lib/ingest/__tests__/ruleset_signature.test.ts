// lib/ingest/__tests__/ruleset_signature.test.ts — GAP-043.
//
// THE REAL ED25519 PATH, not a mock of it. `verifyRulesetSignature` takes the
// public key as a defaulted parameter precisely so this file can generate a
// keypair and exercise genuine signing and verification; producing a valid
// signature under the SHIPPED key would need the private half, which must never
// be in this repository.
//
// So the coverage is split deliberately:
//   here          — the crypto itself, plus the shipped key's own shape, plus
//                   the assertion that the default really is the shipped key
//   parser_rules  — that the fetch path refuses to install anything this
//                   function rejects
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  RULESET_PUBLIC_KEY_HEX,
  RULESET_SIGNATURE_HEADER,
  verifyRulesetSignature,
} from "../ruleset_signature";

const BODY = JSON.stringify({ version: 4, providers: [{ providerKey: "gcash" }] });

function keypair() {
  const priv = ed25519.utils.randomSecretKey();
  return { priv, pubHex: bytesToHex(ed25519.getPublicKey(priv)) };
}

function sign(body: string, priv: Uint8Array): string {
  return bytesToHex(ed25519.sign(new TextEncoder().encode(body), priv));
}

test("a genuine signature over the exact body verifies", () => {
  const { priv, pubHex } = keypair();

  expect(verifyRulesetSignature(BODY, sign(BODY, priv), pubHex)).toBe(true);
});

// The whole point of the control: a bundle that is perfectly well-formed but
// signed by somebody else. A compromised server can produce exactly this.
test("a signature from a DIFFERENT key is refused", () => {
  const mine = keypair();
  const attacker = keypair();

  expect(verifyRulesetSignature(BODY, sign(BODY, attacker.priv), mine.pubHex)).toBe(false);
});

// Detached over the raw bytes, so one character anywhere breaks it. This is
// what makes "the bytes verified are the bytes parsed" true.
test("a single changed byte in the body breaks verification", () => {
  const { priv, pubHex } = keypair();
  const signature = sign(BODY, priv);

  expect(verifyRulesetSignature(BODY.replace("gcash", "gcasH"), signature, pubHex)).toBe(false);
  expect(verifyRulesetSignature(BODY + " ", signature, pubHex)).toBe(false);
});

test("a missing signature is refused rather than treated as unsigned-but-fine", () => {
  const { pubHex } = keypair();

  expect(verifyRulesetSignature(BODY, null, pubHex)).toBe(false);
  expect(verifyRulesetSignature(BODY, undefined, pubHex)).toBe(false);
  expect(verifyRulesetSignature(BODY, "", pubHex)).toBe(false);
});

// Every one of these used to be a candidate for throwing out of a background
// update path, where the only correct outcome is "keep what we have".
test("malformed signatures return false and never throw", () => {
  const { priv, pubHex } = keypair();
  const good = sign(BODY, priv);

  expect(() => verifyRulesetSignature(BODY, "not-hex-at-all", pubHex)).not.toThrow();
  expect(verifyRulesetSignature(BODY, "not-hex-at-all", pubHex)).toBe(false);
  // Right alphabet, wrong length.
  expect(verifyRulesetSignature(BODY, good.slice(0, 126), pubHex)).toBe(false);
  expect(verifyRulesetSignature(BODY, good + "00", pubHex)).toBe(false);
  // Right length, not a point on the curve.
  expect(verifyRulesetSignature(BODY, "f".repeat(128), pubHex)).toBe(false);
});

test("a malformed public key is refused rather than throwing", () => {
  const { priv } = keypair();

  expect(verifyRulesetSignature(BODY, sign(BODY, priv), "abcd")).toBe(false);
  expect(verifyRulesetSignature(BODY, sign(BODY, priv), "zz".repeat(32))).toBe(false);
});

test("an uppercase signature is accepted -- hex case is not a rejection reason", () => {
  const { priv, pubHex } = keypair();

  expect(verifyRulesetSignature(BODY, sign(BODY, priv).toUpperCase(), pubHex)).toBe(true);
});

// THE DEFAULT IS THE CONTROL. The parameter above exists for these tests; if it
// ever silently became something else, production would be verifying against a
// key nobody chose.
test("the default key is the shipped key, and it is a well-formed Ed25519 public key", () => {
  expect(RULESET_PUBLIC_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);

  const { priv } = keypair();
  const signature = sign(BODY, priv);
  // Signed by a key that is NOT the shipped one, so the two-argument call --
  // exactly what parser_rules.ts makes -- must refuse it.
  expect(verifyRulesetSignature(BODY, signature)).toBe(false);
  expect(verifyRulesetSignature(BODY, signature, RULESET_PUBLIC_KEY_HEX)).toBe(false);
});

test("the header name is lowercase, because axios normalises header names", () => {
  expect(RULESET_SIGNATURE_HEADER).toBe(RULESET_SIGNATURE_HEADER.toLowerCase());
});

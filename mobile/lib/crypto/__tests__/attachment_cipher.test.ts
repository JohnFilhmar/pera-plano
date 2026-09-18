// lib/crypto/__tests__/attachment_cipher.test.ts — GAP-072.
//
// The cipher itself, away from the filesystem. What `lib/support/__tests__/
// attachments.test.ts` pins is that the support layer USES it; what this file
// pins is that it is worth using: real AES-256-GCM, a fresh nonce per call, and
// a refusal rather than garbage on every failure path.
import {
  AttachmentDecryptionError,
  AttachmentKeyMissingError,
  clearAttachmentKey,
  decryptAttachmentBytes,
  encryptAttachmentBytes,
  hasAttachmentKey,
  setAttachmentKey,
} from "../attachment_cipher";

const KEY = new Uint8Array(32).fill(0x42);
const OTHER_KEY = new Uint8Array(32).fill(0x37);
const PLAINTEXT = new TextEncoder().encode(
  "GCash: you received PHP 5,000.00 from JUAN DELA CRUZ. Ref 9921 4410 2288.",
);

afterEach(() => {
  clearAttachmentKey();
});

test("a round trip returns the exact bytes", async () => {
  setAttachmentKey(KEY);

  const sealed = await encryptAttachmentBytes(PLAINTEXT);

  expect(Array.from(decryptAttachmentBytes(sealed))).toEqual(Array.from(PLAINTEXT));
});

test("the sealed bytes carry none of the plaintext", async () => {
  setAttachmentKey(KEY);

  const sealed = await encryptAttachmentBytes(PLAINTEXT);
  const asText = new TextDecoder().decode(sealed);

  expect(asText).not.toContain("JUAN DELA CRUZ");
  expect(asText).not.toContain("5,000.00");
  expect(Array.from(sealed)).not.toEqual(Array.from(PLAINTEXT));
  // Nonce (12) plus GCM tag (16), and nothing else: no padding, no header.
  expect(sealed.length).toBe(PLAINTEXT.length + 28);
});

// Reusing a nonce under one key is a total break of GCM's confidentiality, and
// it is the reason the nonce is drawn inside the function rather than accepted
// as a parameter. Identical input twice must not produce identical output.
test("two encryptions of the same bytes differ", async () => {
  setAttachmentKey(KEY);

  const first = await encryptAttachmentBytes(PLAINTEXT);
  const second = await encryptAttachmentBytes(PLAINTEXT);

  expect(Array.from(first)).not.toEqual(Array.from(second));
  expect(Array.from(first.slice(0, 12))).not.toEqual(Array.from(second.slice(0, 12)));
  // Both still decrypt, so the difference is the nonce and not corruption.
  expect(Array.from(decryptAttachmentBytes(first))).toEqual(Array.from(PLAINTEXT));
  expect(Array.from(decryptAttachmentBytes(second))).toEqual(Array.from(PLAINTEXT));
});

test("a different key cannot read it, and fails authentication rather than returning noise", async () => {
  setAttachmentKey(KEY);
  const sealed = await encryptAttachmentBytes(PLAINTEXT);

  setAttachmentKey(OTHER_KEY);

  expect(() => decryptAttachmentBytes(sealed)).toThrow(AttachmentDecryptionError);
});

test("a flipped bit anywhere is detected", async () => {
  setAttachmentKey(KEY);
  const sealed = await encryptAttachmentBytes(PLAINTEXT);

  for (const index of [0, 5, 20, sealed.length - 1]) {
    const tampered = new Uint8Array(sealed);
    tampered[index] ^= 0xff;
    expect(() => decryptAttachmentBytes(tampered)).toThrow(AttachmentDecryptionError);
  }
});

test("a truncated blob is refused rather than read as a short message", async () => {
  setAttachmentKey(KEY);
  const sealed = await encryptAttachmentBytes(PLAINTEXT);

  expect(() => decryptAttachmentBytes(sealed.slice(0, 8))).toThrow(AttachmentDecryptionError);
  expect(() => decryptAttachmentBytes(new Uint8Array(12))).toThrow(AttachmentDecryptionError);
  expect(() => decryptAttachmentBytes(new Uint8Array())).toThrow(AttachmentDecryptionError);
});

// The lock teardown scrubs this module's copy. Encrypting afterwards would be
// encrypting under 32 zero bytes, which is a key an attacker can simply guess.
test("no key at all is a distinct error from a bad blob, on both paths", async () => {
  clearAttachmentKey();

  await expect(encryptAttachmentBytes(PLAINTEXT)).rejects.toThrow(AttachmentKeyMissingError);
  expect(() => decryptAttachmentBytes(new Uint8Array(64))).toThrow(AttachmentKeyMissingError);
});

test("an all-zero key counts as absent, which is what a scrubbed buffer looks like", async () => {
  setAttachmentKey(new Uint8Array(32));

  expect(hasAttachmentKey()).toBe(false);
  await expect(encryptAttachmentBytes(PLAINTEXT)).rejects.toThrow(AttachmentKeyMissingError);
});

// `key_manager.lock()` zeroes the DEK buffer IN PLACE. Aliasing the caller's
// array would turn this module's key into zeros while it still looked present.
test("the key is copied, not aliased, so a caller zeroing its own buffer cannot blind this module", async () => {
  const caller = new Uint8Array(32).fill(0x42);
  setAttachmentKey(caller);
  caller.fill(0);

  expect(hasAttachmentKey()).toBe(true);
  const sealed = await encryptAttachmentBytes(PLAINTEXT);
  expect(Array.from(decryptAttachmentBytes(sealed))).toEqual(Array.from(PLAINTEXT));
});

test("hasAttachmentKey tracks the lifecycle", () => {
  expect(hasAttachmentKey()).toBe(false);
  setAttachmentKey(KEY);
  expect(hasAttachmentKey()).toBe(true);
  clearAttachmentKey();
  expect(hasAttachmentKey()).toBe(false);
});

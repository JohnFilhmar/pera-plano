// lib/crypto/attachment_cipher.ts — AES-256-GCM for the support outbox's
// attachment files (GAP-072; docs/12-encryption-and-app-lock.md §4, §8).
//
// WHY THIS IS NOT `cache_cipher.ts`, which already does AES-256-GCM under the
// DEK. That module's codec takes a JSON value and returns HEX, and hex DOUBLES
// the payload. On the query cache that is a handful of kilobytes; on an 8 MB
// screenshot it is a 16 MB string built on the JS thread, and this app has
// already measured what per-write hex encoding does to that thread (see
// `query_client.ts`'s `PERSISTED_QUERY_PREFIXES` and the 4.6 s stall that
// motivated it). This module moves BYTES: `Uint8Array` in, `Uint8Array` out,
// no text encoding at either end.
//
// AND IT IS NOT BASE64 EITHER. `expo-file-system`'s legacy API can only read a
// file as a base64 string, and `key_manager.ts`'s hand-rolled base64 helpers
// build a `number[]` one byte at a time — fine for a 32-byte key, a ten-million
// element array for an 8 MB file. The SDK 54 `File` API reads and writes
// `Uint8Array` directly, which is why the support layer reaches for it here and
// only here while the rest of the app stays on the legacy API.
//
// THE COST IS PAID TWICE PER FILE, NOT PER EVENT, and that is what makes it
// acceptable: once when the user picks the file, once when the report actually
// uploads. Both are deliberate user actions with a progress state already on
// screen. The query cache's problem was the opposite shape — a full re-encrypt
// on every cache event, throttled to one second, forever.
import { gcm } from "@noble/ciphers/aes.js";
import * as Crypto from "expo-crypto";

/** GCM's standard nonce width, same as `cache_cipher.ts` and `key_manager.ts`. */
const GCM_NONCE_BYTES = 12;

/**
 * Thrown when an encrypt or decrypt is attempted with no key set — the app is
 * locked, or was never unlocked. Distinct from a corruption failure, because a
 * caller can do something about this one: wait, or stop trying.
 */
export class AttachmentKeyMissingError extends Error {
  constructor() {
    super("attachment cipher key is not set -- support attachments cannot be read or written before unlock");
    this.name = "AttachmentKeyMissingError";
  }
}

/** Thrown when a blob fails GCM authentication, is truncated, or was written
 * under a different key. Never returns partial data. */
export class AttachmentDecryptionError extends Error {
  constructor() {
    super("support attachment could not be decrypted");
    this.name = "AttachmentDecryptionError";
  }
}

/**
 * This module's own copy of the DEK.
 *
 * COPIED, NOT ALIASED, for the reason `query_client.ts`'s
 * `setCacheEncryptionKey` documents at length: `key_manager.lock()` zeroes the
 * DEK buffer IN PLACE, and `lib/security/wipe.ts`'s `wipeKeys()` does it
 * without going through any setter. Holding the caller's array would mean a
 * lock silently turning this key into 32 zero bytes while it still looked
 * present.
 *
 * NEVER logged and NEVER exported directly, so every write site is grep-able.
 */
let attachmentKey: Uint8Array | null = null;

/** Set with the unwrapped DEK at unlock, beside the query cache's own key. */
export function setAttachmentKey(key: Uint8Array): void {
  const previous = attachmentKey;
  attachmentKey = new Uint8Array(key);
  previous?.fill(0);
}

/** Companion to `setAttachmentKey`, for the lock teardown and test cleanup.
 * Zeroes the bytes before dropping the reference, because the buffer is this
 * module's own copy and nothing else will ever scrub it. */
export function clearAttachmentKey(): void {
  attachmentKey?.fill(0);
  attachmentKey = null;
}

/** All-zero counts as absent: that is what a buffer looks like after
 * `key_manager.lock()` has scrubbed it, and encrypting under it would be
 * encrypting under a key an attacker can guess. */
function requireKey(): Uint8Array {
  if (attachmentKey === null || attachmentKey.length === 0) {
    throw new AttachmentKeyMissingError();
  }
  let accumulator = 0;
  for (const byte of attachmentKey) accumulator |= byte;
  if (accumulator === 0) throw new AttachmentKeyMissingError();
  return attachmentKey;
}

/** Whether a key is currently set. For callers that would rather skip a pass
 * than throw through it — the outbox runner's sweep is one. */
export function hasAttachmentKey(): boolean {
  try {
    requireKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypts file bytes, returning `nonce || ciphertext` as a single buffer.
 *
 * A FRESH RANDOM NONCE PER CALL, drawn here rather than accepted as a
 * parameter: reusing a nonce under one key is a total break of GCM's
 * confidentiality guarantee, and a parameter is an invitation to reuse one. The
 * ciphertext already carries GCM's authentication tag, so the returned buffer
 * is the complete, self-contained on-disk blob — the same nonce-prefix
 * convention `cache_cipher.ts` and `key_manager.ts` both use.
 *
 * @param plaintext The file's bytes, exactly as read from disk.
 */
export async function encryptAttachmentBytes(plaintext: Uint8Array): Promise<Uint8Array> {
  const nonce = await Crypto.getRandomBytesAsync(GCM_NONCE_BYTES);
  // Nothing may be inserted between these two lines: a lock landing inside the
  // nonce draw must be seen HERE, not after the key has already been read.
  const key = requireKey();
  const ciphertext = gcm(key, nonce).encrypt(plaintext);

  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);
  return blob;
}

/**
 * Decrypts a blob produced by `encryptAttachmentBytes`.
 *
 * Throws `AttachmentDecryptionError` — never returns partial or garbage bytes —
 * for a truncated blob, a failed authentication check, or the wrong key, and
 * `AttachmentKeyMissingError` distinctly and BEFORE anything cryptographic when
 * there is no key at all.
 */
export function decryptAttachmentBytes(blob: Uint8Array): Uint8Array {
  const key = requireKey();
  if (blob.length <= GCM_NONCE_BYTES) throw new AttachmentDecryptionError();
  try {
    return gcm(key, blob.slice(0, GCM_NONCE_BYTES)).decrypt(blob.slice(GCM_NONCE_BYTES));
  } catch {
    throw new AttachmentDecryptionError();
  }
}

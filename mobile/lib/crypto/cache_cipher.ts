// AES-256-GCM encryption for the persisted React Query cache.
//
// See docs/12-encryption-and-app-lock.md §8 ("The persisted React Query
// cache in AsyncStorage | AES-256-GCM with a key wrapped the same way as the
// DEK") and lib/query_client.ts's header comment for how this module is
// wired into createAsyncStoragePersister. In one line: the key every
// function here is handed IS the DEK (key_manager.ts) -- it is already a
// random 256-bit key, wrapped twice on disk (KEK-device, KEK-recovery), so
// reusing it directly needs no extra derivation step (see Task 7's
// carried-forward note making the identical argument for the database key).
//
// Why this is its own module rather than living inline in query_client.ts:
// every property this task exists to guarantee -- ciphertext must not
// contain plaintext, a tampered blob must be REJECTED rather than silently
// accepted, a failed read must be non-fatal, and a missing key must fail
// loudly rather than quietly writing plaintext -- is exactly the kind of
// thing a "simplify this" pass could break in one line. Each gets its own
// small, directly unit-testable function here instead of being buried
// inside persister wiring where only a slow, indirect end-to-end test would
// ever notice a regression.
//
// SECURITY: the key handed to every function here IS the DEK. Never log it,
// a fragment of it, or any ciphertext in a way that could be paired back to
// the plaintext it came from. The `console.warn` in createCacheCodec logs a
// COUNT only -- never the blob, never the key, never the decrypted or
// attempted plaintext.

import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as Crypto from "expo-crypto";

// Standard AES-GCM nonce width, matching key_manager.ts's own choice.
// getRandomBytesAsync (not the sync getRandomBytes) is used deliberately --
// expo-crypto's own source falls back to Math.random for getRandomBytes
// specifically when remote JS debugging is active, a fallback
// getRandomBytesAsync does not have. recovery_phrase.ts and key_manager.ts
// both already standardized on the async form for exactly this reason; this
// module follows the same rule rather than reintroducing a sync path here.
const GCM_NONCE_BYTES = 12;

/**
 * Thrown by every function below when handed a null/undefined/empty key --
 * the "fail safely, never silently write plaintext or decrypt with a broken
 * key" case (task-8-brief.md rule 4). This is a caller/wiring bug (the app
 * touched the persisted cache before unlock supplied a key), never a data
 * problem, so createCacheCodec's deserialize (below) still catches it, but
 * encryptCacheValue/decryptCacheValue keep it as its OWN distinct type
 * rather than folding it into CacheDecryptionError -- a direct caller (and
 * this file's own tests) can tell "no key" apart from "corrupt data" even
 * though the codec, one layer up, deliberately cannot.
 */
export class CacheCipherKeyMissingError extends Error {
  constructor() {
    super("cache cipher key is not set -- the persisted query cache cannot be read or written before unlock");
    this.name = "CacheCipherKeyMissingError";
  }
}

/**
 * Thrown by decryptCacheValue when a blob cannot be authenticated --
 * malformed hex, truncated data, or (the case that matters most) a GCM
 * authentication-tag mismatch, which is what catches disk corruption or
 * deliberate tampering. NEVER thrown alongside a partial or garbage return
 * value -- @noble/ciphers verifies the tag before it ever materializes
 * plaintext, so this module has nothing partial to hand back even if it
 * wanted to.
 */
export class CacheDecryptionError extends Error {
  constructor() {
    super("unable to decrypt persisted cache blob");
    this.name = "CacheDecryptionError";
  }
}

function requireKey(key: Uint8Array | null | undefined): Uint8Array {
  if (key === null || key === undefined || key.length === 0) {
    throw new CacheCipherKeyMissingError();
  }
  return key;
}

/**
 * Encrypts any JSON-serializable value under `key` with AES-256-GCM and a
 * fresh random nonce per call -- reusing a nonce under the same key is a
 * total break of GCM's confidentiality guarantee, which is why this is
 * drawn fresh here rather than accepted as a parameter. Returns hex: nonce
 * || ciphertext (the ciphertext already carries the GCM authentication
 * tag), so the returned string is the complete, self-contained on-disk
 * blob -- the same nonce-prefix convention key_manager.ts's wrap functions
 * use.
 */
export async function encryptCacheValue(
  key: Uint8Array | null | undefined,
  value: unknown,
): Promise<string> {
  const realKey = requireKey(key);
  const nonce = await Crypto.getRandomBytesAsync(GCM_NONCE_BYTES);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = gcm(realKey, nonce).encrypt(plaintext);

  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);
  return bytesToHex(blob);
}

/**
 * Decrypts a blob produced by encryptCacheValue and JSON.parses the result.
 * Throws CacheDecryptionError -- never returns partial or garbage data --
 * for a truncated/malformed blob or a failed GCM authentication check
 * (tampering, corruption, or the wrong key). Throws
 * CacheCipherKeyMissingError, distinctly and BEFORE attempting anything
 * cryptographic, if `key` itself is absent (see that class's doc).
 */
export function decryptCacheValue(key: Uint8Array | null | undefined, blob: string): unknown {
  const realKey = requireKey(key);
  try {
    const bytes = hexToBytes(blob);
    const nonce = bytes.slice(0, GCM_NONCE_BYTES);
    const ciphertext = bytes.slice(GCM_NONCE_BYTES);
    const plaintext = gcm(realKey, nonce).decrypt(ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new CacheDecryptionError();
  }
}

/**
 * How many persisted-cache reads have been discarded because they failed to
 * decrypt (tampered/corrupted blob, a blob from a key that is no longer
 * current, or the codec being asked to read before a key was ever set).
 * Exposed so the app can log/observe this, and so cache_cipher.test.ts can
 * assert the count actually moves rather than only asserting on a
 * console.warn call. Deliberately module-global and never auto-reset --
 * only test code should ever call resetDiscardedCacheReadsForTests.
 */
let discardedCacheReads = 0;

export function getDiscardedCacheReads(): number {
  return discardedCacheReads;
}

export function resetDiscardedCacheReadsForTests(): void {
  discardedCacheReads = 0;
}

/**
 * Builds the {serialize, deserialize} pair createAsyncStoragePersister
 * needs (lib/query_client.ts), bound to `key`.
 *
 * serialize rejects with CacheCipherKeyMissingError when `key` is absent --
 * deliberately loud, even though @tanstack/query-async-storage-persister's
 * own persistClient (verified against its published source) swallows a
 * rejected serialize into a silent no-op write when no `retry` option is
 * configured: throwing here is what makes the failure exist and be
 * unit-testable at all, and guarantees the ONLY two outcomes of a write
 * attempt are "genuinely encrypted" or "nothing written" -- plaintext is
 * never one of them.
 *
 * deserialize NEVER throws -- not merely because "a cache is disposable"
 * (task-8-brief.md rule 3), but because @tanstack/query-persist-client-core's
 * persistQueryClientRestore (verified against its published source) catches
 * a restoreClient() rejection, discards the stored blob, and then RE-THROWS
 * -- which would abort persistQueryClient's restore chain before it ever
 * reaches persistQueryClientSubscribe, silently disabling ALL future
 * persistence for the rest of the app session, not just the one bad read.
 * So a missing key and a corrupted/tampered blob deliberately fold into the
 * SAME "discard and start empty" outcome here, even though
 * encryptCacheValue and decryptCacheValue keep them distinct, separately
 * testable errors one layer down.
 */
export function createCacheCodec(key: Uint8Array | null | undefined): {
  serialize: (value: unknown) => Promise<string>;
  deserialize: (cached: string) => unknown;
} {
  return {
    serialize: (value: unknown) => encryptCacheValue(key, value),
    deserialize: (cached: string) => {
      try {
        return decryptCacheValue(key, cached);
      } catch {
        discardedCacheReads += 1;
        console.warn(
          `[cache_cipher] discarded an unreadable persisted query cache (failed reads so far: ${discardedCacheReads})`,
        );
        return undefined;
      }
    },
  };
}

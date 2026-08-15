// Recovery-phrase generation and Argon2id key derivation.
//
// See docs/12-encryption-and-app-lock.md §3 (key hierarchy) and §5 (the
// recovery problem, and why BIP-39 was chosen) for the design rationale.
// In one line: Android destroys the device Keystore key when a user
// removes their screen lock, and these twelve words are the only other
// path back to the DEK — and the only key material that can travel to a
// new phone for cloud restore.
//
// Copy rule, binding on every screen that surfaces this: call these
// "recovery words" in the UI. Never "seed phrase", "wallet", or
// "mnemonic" — BIP-39 is a cryptocurrency-adjacent artifact chosen here
// purely for its wordlist and checksum properties; the vocabulary is not
// part of what we're borrowing.
//
// SECURITY: the phrase, any single word of it, and any key derived from it
// must never reach a log, an analytics event, an error message, or a stack
// trace. Do not add a catch block here that logs its input on failure.

import * as Crypto from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { BIP39_WORDLIST } from "./wordlist";

const WORD_COUNT = 12;
const ENTROPY_BYTES = 16; // 128 bits -> 12 words at 11 bits each, see below
const BITS_PER_WORD = 11; // log2(2048)
const CHECKSUM_BITS = 4; // BIP-39: ENT / 32, for ENT = 128

// ---------------------------------------------------------------------------
// Argon2id parameters — PERMANENT. Read this before touching any of these
// four numbers.
//
// These become part of the on-disk format: KEK-recovery is re-derived from
// the user's phrase by re-running Argon2id with exactly these parameters
// (see docs/12-encryption-and-app-lock.md §3). Change any of them and every
// wrap blob created under the old parameters becomes unopenable — every
// existing user loses their data, with no way back, because the phrase
// itself is unchanged but the key it derives to is not. If these ever need
// to change, it requires a migration (derive under both parameter sets and
// re-wrap while the old key is still derivable), never a version bump of
// these constants alone.
//
// Why these are deliberately LIGHTER than a password-hashing Argon2id
// configuration (e.g. OWASP's Password Storage Cheat Sheet tables, which
// assume tens-to-hundreds of MiB): Argon2id is expensive on purpose to
// defend a weak, human-chosen secret against offline brute force. That is
// not the threat model here. A 12-word BIP-39 phrase drawn from a CSPRNG
// carries 128 bits of entropy — no realistic KDF work factor changes an
// attacker's position against a 2^128 search; it is infeasible whether
// derivation costs a microsecond or a minute, so the security of this
// scheme rests on that entropy, not on Argon2id's hardness. What the work
// factor still buys is defense in depth against a NARROWED search — a user
// who recorded eleven of twelve words and lost the twelfth, a partial
// shoulder-surf, a photo with a few words obscured — where the remaining
// search space is small enough that a cheap KDF would make brute force
// practical. That is worth a fraction of a second, not the 500ms-1s a
// password KDF would target.
//
// Chosen values: m=2048 KiB (2 MiB), t=2, p=1. `@noble/hashes` is a
// pure-JS Argon2id implementation, and its async variant yields to the
// event loop periodically (via its internal scheduler) so derivation
// doesn't block the JS thread for the full duration — under Jest, each
// yield costs far more wall-clock time than the same yield does under
// Hermes in a release build (measured: the same m=19456,t=2 configuration
// once tried here took 55-80 SECONDS under Jest against ~190ms in a plain
// Node benchmark of the identical call — a 300x+ gap from Jest/Babel
// overhead alone, not from the underlying compute). Do not use a Jest
// timing as a stand-in for on-device timing in either direction. These
// values were tuned by benchmarking directly inside Jest (not extrapolated
// from Node) to land at roughly 1.2-1.6 seconds there.
//
// MEASURED ON HARDWARE 2026-08-15 (encryption Gate A, docs/13). Samsung
// SM-A546E / Exynos 1380 / Android 16, Hermes: **3,351 ms median** over five
// runs after a warm-up ([3351, 3506, 3526, 3263, 3207]).
//
// THE PREDICTION THIS COMMENT USED TO MAKE WAS BACKWARDS. It said to expect a
// real device "to come in under" the Jest figure. Hermes is 2-3x SLOWER than
// Jest for this workload, not faster. Do not treat a Jest timing as a ceiling
// when next tuning these.
//
// KEPT AT 3.35 s ANYWAY, by the project owner's decision on 2026-08-15, on
// two grounds:
//
//   1. It is not on any hot path. `deriveRecoveryKey` has exactly two callers
//      (key_manager.ts's wrap/unwrap) — onboarding, and a recovery unlock.
//      Normal unlock uses the Keystore device KEK and never comes here. A
//      user meets this once at setup and again only if they lose their screen
//      lock, while typing twelve words by hand.
//   2. The work factor does not buy the narrowed-search defense described
//      above, AT ANY VALUE REACHABLE IN PURE JS. An attacker runs native
//      Argon2id: at m=2 MiB, t=2 that is single-digit milliseconds a guess, so
//      the 2,048 candidates left by a lost twelfth word fall in under a
//      minute. Raising to the OWASP floor (m=19456) would cost ~30 SECONDS per
//      derivation here and still leave that search trivial for the attacker.
//      The asymmetry runs the wrong way and cannot be closed without a native
//      Argon2id (JSI) implementation, which was considered and declined.
//
// So these constants are close to a free variable, and the 128 bits of phrase
// entropy — as the top of this comment already says — is what the scheme
// actually rests on.
const ARGON2ID_TIME_COST = 2; // iterations
const ARGON2ID_MEMORY_COST_KIB = 2048; // 2 MiB
const ARGON2ID_PARALLELISM = 1;
const ARGON2ID_OUTPUT_BYTES = 32; // 256-bit key, matches the DEK width
// ---------------------------------------------------------------------------

const WORD_TO_INDEX = new Map<string, number>(
  BIP39_WORDLIST.map((word, index) => [word, index]),
);

function bytesToBitString(bytes: Uint8Array): string {
  let bits = "";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }
  return bits;
}

function bitStringToBytes(bits: string): Uint8Array {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

/** BIP-39 checksum: the top CHECKSUM_BITS bits of SHA-256(entropy). */
function checksumBitsForEntropy(entropy: Uint8Array): string {
  const hash = sha256(entropy);
  return bytesToBitString(hash).slice(0, CHECKSUM_BITS);
}

/**
 * Generates a fresh 12-word recovery phrase from cryptographically secure
 * randomness. Never uses Math.random — a predictable phrase would be a
 * total compromise of both the device-loss recovery path and the cloud
 * backup key.
 */
export async function generatePhrase(): Promise<string[]> {
  const entropy = await Crypto.getRandomBytesAsync(ENTROPY_BYTES);
  const checksum = checksumBitsForEntropy(entropy);
  const bits = bytesToBitString(entropy) + checksum;

  const words: string[] = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    const chunk = bits.slice(i * BITS_PER_WORD, (i + 1) * BITS_PER_WORD);
    words.push(BIP39_WORDLIST[parseInt(chunk, 2)]);
  }
  return words;
}

/**
 * Normalizes what a human actually types or pastes: mixed case, doubled
 * spaces, tabs, a trailing newline from a paste. Returns the individual
 * words, ready for validatePhrase or deriveRecoveryKey.
 */
export function normalizePhrase(input: string): string[] {
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * Validates a recovery phrase in two stages: are all 12 words real BIP-39
 * entries, and does the phrase's checksum actually check out. The checksum
 * is what makes an internally inconsistent phrase (e.g. one mistyped word
 * that autocorrected to a different valid word) rejectable in milliseconds,
 * instead of failing open into a slow, doomed Argon2id derivation.
 *
 * badIndexes reports word-list membership failures only — it does not
 * localize a checksum failure to a single word, because the checksum
 * mixes every word's bits together; there is no single word to blame.
 */
export function validatePhrase(words: string[]): {
  ok: boolean;
  badIndexes: number[];
} {
  const badIndexes: number[] = [];
  words.forEach((word, index) => {
    if (!WORD_TO_INDEX.has(word)) {
      badIndexes.push(index);
    }
  });

  if (words.length !== WORD_COUNT || badIndexes.length > 0) {
    return { ok: false, badIndexes };
  }

  const bits = words
    .map((word) =>
      WORD_TO_INDEX.get(word)!.toString(2).padStart(BITS_PER_WORD, "0"),
    )
    .join("");
  const entropyBits = bits.slice(0, ENTROPY_BYTES * 8);
  const checksumBits = bits.slice(ENTROPY_BYTES * 8);
  const entropy = bitStringToBytes(entropyBits);

  const ok = checksumBitsForEntropy(entropy) === checksumBits;
  return { ok, badIndexes: [] };
}

/**
 * Derives KEK-recovery from a recovery phrase and salt via Argon2id. See
 * the parameter block above — these four numbers are permanent for any
 * given salt/phrase pair once a phrase has been generated for a real user.
 *
 * Callers are responsible for validating the phrase (validatePhrase) before
 * calling this — derivation does not re-check the checksum, so a caller
 * that skips validation will happily derive a key from a broken phrase.
 */
export async function deriveRecoveryKey(
  phrase: string[],
  salt: Uint8Array,
): Promise<Uint8Array> {
  const password = new TextEncoder().encode(phrase.join(" "));
  return argon2idAsync(password, salt, {
    t: ARGON2ID_TIME_COST,
    m: ARGON2ID_MEMORY_COST_KIB,
    p: ARGON2ID_PARALLELISM,
    dkLen: ARGON2ID_OUTPUT_BYTES,
  });
}

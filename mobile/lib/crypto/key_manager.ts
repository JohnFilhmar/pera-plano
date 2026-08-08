// The DEK (Data Encryption Key) lifecycle — the one key that decrypts a
// user's entire financial history.
//
// See docs/12-encryption-and-app-lock.md §3 (key hierarchy) and §5 (the
// recovery problem) for the design rationale, and interface contract §9 for
// the exact function signatures this file must expose. In one line: the DEK
// is a random 256-bit AES key, generated once, and it is NEVER written to
// storage unwrapped. It is written twice, wrapped by two independent keys
// (KEK-device, in the Android Keystore; KEK-recovery, derived on demand from
// the user's 12-word recovery phrase), so that either path recovers the same
// DEK. That redundancy is what survives a routine phone-settings change
// (removing a screen lock destroys KEK-device) without losing the database.
//
// SECURITY: the DEK, any wrap of it, any key derived from the recovery
// phrase, and the phrase itself must never reach a log, an analytics event,
// or an error message. Errors below are deliberately generic where the
// alternative would be an oracle (see unlockWithRecoveryPhrase).

import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import * as NotificationListener from "@/modules/notification_listener";
import * as RecoveryPhrase from "./recovery_phrase";

export type KeyState = "uninitialized" | "locked" | "unlocked";

const DEK_BYTES = 32; // 256 bits, matches SQLCipher's AES-256 key width.
const RECOVERY_SALT_BYTES = 16; // Argon2id salt for KEK-recovery.
const GCM_NONCE_BYTES = 12; // Standard AES-GCM nonce width.

// Our OWN storage format, private to this module. Nothing here crosses the
// native bridge, so there is no reason to match its base64 convention —
// hex via @noble/hashes keeps this file free of any Buffer/atob dependency,
// which matters because neither is guaranteed to exist under Hermes.
const STORAGE_KEYS = {
  deviceWrap: "peraplano.key_manager.device_wrap",
  recoveryWrap: "peraplano.key_manager.recovery_wrap",
  recoverySalt: "peraplano.key_manager.recovery_salt",
} as const;

// The plaintext DEK, held only in memory, only while unlocked. This is the
// one variable in the whole encryption plan that must never be logged,
// serialized, or written to disk.
let dek: Uint8Array | null = null;

/**
 * A wrong recovery phrase and a corrupted recovery wrap blob must be
 * indistinguishable to the caller (contract §9 rule 5) — anything finer is
 * an oracle that helps an attacker confirm a partially-guessed phrase. Both
 * unlockWithRecoveryPhrase and rewrapAfterInvalidation surface exactly this
 * one error for every failure inside the recovery-unwrap step, regardless of
 * which sub-step actually failed.
 */
export class RecoveryUnlockFailedError extends Error {
  constructor() {
    super("unable to unlock with the provided recovery phrase");
    this.name = "RecoveryUnlockFailedError";
  }
}

// ---------------------------------------------------------------------------
// Minimal base64 <-> bytes, used ONLY at the native-bridge boundary
// (wrapWithDeviceKek/unwrapWithDeviceKek take/return base64 strings by
// contract). Hand-rolled rather than relying on the Node-only global
// `Buffer` or the browser-only `btoa`/`atob`, neither of which this RN app
// polyfills — this keeps the module portable between Jest and Hermes.
// ---------------------------------------------------------------------------
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? "=" : BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? "=" : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * True once every piece of first-run state exists in secure storage.
 *
 * PARTIAL WRITES, ON PURPOSE: performInitializeKeys writes deviceWrap, then
 * recoveryWrap, then recoverySalt as three SEPARATE awaited calls, not one
 * atomic transaction (expo-secure-store has no multi-key transaction
 * primitive to reach for). If the process dies, or any one write rejects,
 * between two of those three, secure storage is left holding a STRICT
 * SUBSET of the three items.
 *
 * This function's `&&` of all three means ANY strict subset -- 0, 1, or 2
 * present, regardless of which ones -- evaluates to false, exactly the same
 * as "initializeKeys has never run." That is a deliberate classification,
 * not an oversight, and it is provably the honest one:
 * performInitializeKeys never assigns the in-memory `dek` (nor does any
 * other code path) until AFTER all three writes have already succeeded, so
 * a strict subset can only exist on a device where no caller was ever
 * handed a DEK and nothing was ever encrypted with one. There is no
 * committed state to protect, so getKeyState() reporting "uninitialized" --
 * never "locked" -- for a partial subset is both correct and useful: it
 * routes the user back through onboarding, and the NEXT initializeKeys
 * call safely overwrites the stale remnant with a fresh, fully consistent
 * DEK (see the "self-heals from a partial first-run state" test in
 * key_manager.test.ts). The failure mode this comment exists to rule out is
 * getKeyState() reporting "locked" for a partial write -- that would send
 * the user to an unlock screen for a DEK that no wrap on disk can actually
 * produce. The boolean `&&` below makes that impossible by construction:
 * there is no subset of size < 3 for which it evaluates to true.
 */
async function hasStoredKeys(): Promise<boolean> {
  const [deviceWrap, recoveryWrap, recoverySalt] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.deviceWrap),
    SecureStore.getItemAsync(STORAGE_KEYS.recoveryWrap),
    SecureStore.getItemAsync(STORAGE_KEYS.recoverySalt),
  ]);
  return deviceWrap !== null && recoveryWrap !== null && recoverySalt !== null;
}

/**
 * Wraps the DEK under KEK-recovery (freshly derived from the phrase with a
 * fresh salt) via AES-256-GCM. Returns hex, not base64 — this never crosses
 * the native bridge.
 */
async function wrapWithRecoveryPhrase(
  dekBytes: Uint8Array,
  phrase: string[],
): Promise<{ wrapHex: string; saltHex: string }> {
  const salt = await Crypto.getRandomBytesAsync(RECOVERY_SALT_BYTES);
  const key = await RecoveryPhrase.deriveRecoveryKey(phrase, salt);
  const nonce = await Crypto.getRandomBytesAsync(GCM_NONCE_BYTES);
  const ciphertext = gcm(key, nonce).encrypt(dekBytes);

  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);

  return { wrapHex: bytesToHex(blob), saltHex: bytesToHex(salt) };
}

/**
 * Unwraps the DEK from whatever is currently in secure storage using the
 * given phrase. Every failure inside this function — missing storage,
 * malformed hex, a derivation mismatch, a failed GCM tag check — surfaces as
 * the SAME RecoveryUnlockFailedError. See that class's doc: distinguishing
 * "wrong phrase" from "corrupt blob" would be an oracle.
 */
async function unwrapWithRecoveryPhrase(phrase: string[]): Promise<Uint8Array> {
  try {
    const [wrapHex, saltHex] = await Promise.all([
      SecureStore.getItemAsync(STORAGE_KEYS.recoveryWrap),
      SecureStore.getItemAsync(STORAGE_KEYS.recoverySalt),
    ]);
    if (!wrapHex || !saltHex) {
      throw new Error("recovery wrap not present");
    }

    const salt = hexToBytes(saltHex);
    const blob = hexToBytes(wrapHex);
    const nonce = blob.slice(0, GCM_NONCE_BYTES);
    const ciphertext = blob.slice(GCM_NONCE_BYTES);

    const key = await RecoveryPhrase.deriveRecoveryKey(phrase, salt);
    return gcm(key, nonce).decrypt(ciphertext);
  } catch {
    throw new RecoveryUnlockFailedError();
  }
}

/**
 * Serializes initializeKeys so concurrent calls observe and PRODUCE the
 * SAME DEK, instead of racing to mint two different ones.
 *
 * THE BUG THIS FIXES: the realistic trigger is a double-tap on the
 * onboarding "confirm your recovery words" button on a laggy budget
 * phone — this product's target hardware. Two concurrent initializeKeys
 * calls used to each run hasStoredKeys(), each see "nothing stored yet"
 * (the check happened before either call had written anything), and each
 * mint an INDEPENDENT DEK. The three writes from both calls then
 * interleaved at the SecureStore level in whatever order their individual
 * awaits happened to resolve, so the device wrap could end up holding one
 * call's DEK while the recovery wrap ended up holding the OTHER call's DEK.
 * Nothing crashed; the guard ("never overwrite an existing DEK") is not
 * wrong, it just was not atomic — both calls read "no DEK present" before
 * either wrote anything. Everything then worked perfectly right up until
 * the day the OTHER unlock path was needed (e.g. the user removed their
 * screen lock, invalidating the device key) — at which point the recovery
 * phrase, made mandatory specifically to prevent data loss, silently failed
 * to open the same database.
 *
 * THE FIX: the first call to arrive starts performInitializeKeys and
 * stores its promise in this module-level variable BEFORE doing anything
 * else observable. Every other call's check-and-return runs with no
 * `await` in between — JS is single-threaded, so nothing can run between
 * the `if` below and the assignment inside it — so a second call arriving
 * even a microtask later still finds inFlightInit already set and AWAITS
 * THAT SAME PROMISE instead of starting a second, independent init. Both
 * callers therefore observe the exact same DEK, not merely "don't crash."
 * Cleared in .finally() once the in-flight call settles (success OR
 * failure), so a genuinely later call — after the first one has fully
 * finished — is free to run its own hasStoredKeys() check rather than
 * being blocked forever.
 */
let inFlightInit: Promise<void> | null = null;

export function initializeKeys(phrase: string[]): Promise<void> {
  if (inFlightInit === null) {
    inFlightInit = performInitializeKeys(phrase).finally(() => {
      inFlightInit = null;
    });
  }
  return inFlightInit;
}

/**
 * First-run setup. Generates the DEK exactly once from a CSPRNG, wraps it
 * under both KEK-device (via the native bridge, which creates the Keystore
 * key on demand — see wrapWithDeviceKek's contract) and KEK-recovery
 * (derived here from the phrase), and writes both wraps plus the recovery
 * salt to secure storage. Nothing is written until both wraps succeed.
 *
 * MUST NEVER overwrite an existing DEK: running this twice on a device that
 * already has one would orphan the encrypted database (silently swapping
 * every future read/write onto a key that cannot open the data already on
 * disk). If first-run state is already present, this is a no-op.
 *
 * The hasStoredKeys() check below is the ATOMIC re-check the fix depends
 * on: it is only ever evaluated with a single execution of this function
 * in flight at a time (see initializeKeys's inFlightInit guard, above),
 * which is what makes "check, then write" here safe against a concurrent
 * initializeKeys call — the exact race that guard exists to close. Without
 * it, this check-then-write is exactly what let two concurrent calls both
 * observe "no DEK yet" and each mint an independent one.
 */
async function performInitializeKeys(phrase: string[]): Promise<void> {
  if (await hasStoredKeys()) {
    return;
  }

  const newDek = await Crypto.getRandomBytesAsync(DEK_BYTES);

  const deviceWrapB64 = await NotificationListener.wrapWithDeviceKek(bytesToBase64(newDek));
  const { wrapHex, saltHex } = await wrapWithRecoveryPhrase(newDek, phrase);

  await SecureStore.setItemAsync(STORAGE_KEYS.deviceWrap, deviceWrapB64);
  await SecureStore.setItemAsync(STORAGE_KEYS.recoveryWrap, wrapHex);
  await SecureStore.setItemAsync(STORAGE_KEYS.recoverySalt, saltHex);

  // We already hold the plaintext DEK we just minted — no reason to force a
  // second, redundant unlock immediately after onboarding.
  dek = newDek;
}

/**
 * Normal unlock path: unwraps the DEK via the device Keystore key. Rejects
 * with whatever the native bridge rejects with, UNCHANGED — DeviceKeyMissing
 * (never initialized; route to onboarding), DeviceKeyInvalidated (screen
 * lock was removed; route to the recovery-phrase form), or NotAuthenticated
 * (re-prompt biometric and retry). This function does not catch or
 * reinterpret any of them; see modules/notification_listener/index.ts for
 * the taxonomy.
 */
export async function unlockWithDeviceKey(): Promise<Uint8Array> {
  const deviceWrapB64 = await SecureStore.getItemAsync(STORAGE_KEYS.deviceWrap);
  if (deviceWrapB64 === null) {
    throw new Error("cannot unlock: keys have not been initialized on this device");
  }

  const dekB64 = await NotificationListener.unwrapWithDeviceKek(deviceWrapB64);
  const unwrapped = base64ToBytes(dekB64);
  dek = unwrapped;
  return unwrapped;
}

/**
 * Recovery path: unwraps the DEK via KEK-recovery, re-derived from the
 * phrase. Yields the exact same DEK unlockWithDeviceKey does, by
 * construction — both wraps were made from the same DEK at initializeKeys
 * time. Throws RecoveryUnlockFailedError on any failure (wrong phrase or a
 * corrupt blob look identical from here — see that class's doc).
 */
export async function unlockWithRecoveryPhrase(phrase: string[]): Promise<Uint8Array> {
  const unwrapped = await unwrapWithRecoveryPhrase(phrase);
  dek = unwrapped;
  return unwrapped;
}

/**
 * The recovery primitive for a permanently invalidated device key (contract
 * §9 rule 3; docs/12-encryption-and-app-lock.md §5). Recovers the DEK via
 * the phrase, deletes the dead Keystore alias and generates a fresh one
 * (via recreateDeviceKek — NEVER ensureDeviceKek, which is presence-only
 * idempotent and would return the same dead key, looping the user through
 * their recovery words forever), then rewraps the SAME DEK under the fresh
 * key. The database is untouched — only the device wrap blob changes.
 *
 * Leaves the DEK unlocked in memory: this function already holds the
 * plaintext DEK by the time it succeeds, and forcing a second, separate
 * unlock call right after a successful recovery would be a redundant prompt
 * for no security benefit.
 */
export async function rewrapAfterInvalidation(phrase: string[]): Promise<void> {
  const recoveredDek = await unwrapWithRecoveryPhrase(phrase);

  await NotificationListener.recreateDeviceKek();
  const newDeviceWrapB64 = await NotificationListener.wrapWithDeviceKek(bytesToBase64(recoveredDek));
  await SecureStore.setItemAsync(STORAGE_KEYS.deviceWrap, newDeviceWrapB64);

  dek = recoveredDek;
}

/**
 * uninitialized: no first-run state exists at all — route to onboarding.
 * locked: first-run state exists, but the DEK is not currently in memory.
 * unlocked: the DEK is in memory right now.
 *
 * Deliberately does NOT call isDeviceKeyUsable() or attempt any unwrap.
 * isDeviceKeyUsable() returns false for BOTH "device key never created" and
 * "device key permanently invalidated" (Task 4's carried-forward note) — it
 * cannot tell "uninitialized" apart from "locked, and the device key
 * happens to be dead". Presence of OUR OWN wrap blobs is the check that
 * actually answers "has initializeKeys ever run on this device", without
 * provoking a failed unwrap just to find out.
 */
export async function getKeyState(): Promise<KeyState> {
  if (dek !== null) {
    return "unlocked";
  }
  return (await hasStoredKeys()) ? "locked" : "uninitialized";
}

/**
 * Zeroes the in-memory DEK buffer before dropping the reference. Best-effort
 * in JS — there is no way to guarantee no other copy exists — but zeroing
 * the actual bytes (rather than merely nulling the variable) is worth doing:
 * the alternative is leaving key material for the GC to scatter, and this
 * also scrubs the exact buffer any caller who still holds the reference
 * returned by an unlock call is looking at.
 */
export function lock(): void {
  if (dek !== null) {
    dek.fill(0);
  }
  dek = null;
}

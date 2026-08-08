// initializeKeys concurrency: the double-tap defect and its fix.
//
// TRIGGER: a double-tap on the onboarding "confirm your recovery words"
// button on a laggy budget phone -- this product's target hardware -- calls
// initializeKeys twice before the first call's writes land. Both calls used
// to independently observe "no DEK yet" and each mint its OWN DEK, so the
// device wrap and the recovery wrap could end up wrapping two DIFFERENT
// keys, depending on how the two calls' three writes each happened to
// interleave at the SecureStore level. Nothing crashed and nothing looked
// wrong -- the failure was silent and would only surface the day the OTHER
// unlock path was needed (e.g. the device key got invalidated and the
// recovery phrase, made mandatory specifically to prevent data loss,
// silently failed to open the same database).
//
// See key_manager.ts's `inFlightInit` for the fix: the first call's promise
// is shared by every concurrent caller, so exactly one DEK is ever minted
// per overlapping burst of initializeKeys calls.
//
// A NOTE ON HOW THIS FILE PROVES THE BUG (read before changing these
// tests): the original reviewer probe (zz_review_probe2.test.ts, now
// deleted) called `await Promise.all([initializeKeys(PHRASE),
// initializeKeys(PHRASE)])` and compared the two unlock paths directly.
// Investigating why it failed turned up two independent facts:
//   1. The probe's comparison was itself unsound -- it read
//      `unlockWithDeviceKey()`'s return value AFTER a second `lock()` call,
//      and `lock()` zeroes that exact buffer IN PLACE (see key_manager.ts's
//      `lock`). Comparing an already-zeroed buffer against the recovery
//      path's non-zero result fails EVERY time, on both buggy and fixed
//      code, regardless of whether a real DEK mismatch occurred -- it is
//      not evidence of the concurrency bug at all. (key_manager.test.ts's
//      own "both unlock paths agree" test snapshots the buffer BEFORE the
//      second lock() specifically to avoid this; the probe did not.)
//   2. Separately, and more importantly: with an unmodified
//      `Promise.all([initializeKeys(P), initializeKeys(P)])` and Jest's
//      synchronous mocks (Map.set with no real I/O latency), BOTH
//      concurrent calls' three writes land in a tight, uninterrupted burst
//      near the end of each call -- there is no natural opportunity for the
//      writes to interleave in a way that splits the final state across
//      two different DEKs; whichever call reaches the write phase first
//      just happens to consistently "win" all three keys, or lose all
//      three, because nothing pauses either call mid-burst. That is a
//      property of this mock's zero-latency scheduling, not proof the race
//      is safe -- on a real device, SecureStore/Keystore calls have real,
//      variable I/O latency, which is exactly the kind of gap a genuine
//      interleaving needs.
// The bug is still completely real (that is *why* the guard needs to be
// atomic with the write, per the fix above) -- it just needed a properly
// constructed reproduction. `initializeKeysWithForcedInterleaving` below
// SCRIPTS that gap deterministically: it pauses whichever call reaches its
// own device-wrap write first (via a real macrotask yield, `setTimeout`),
// which gives a concurrent second call every opportunity to run its own
// full write sequence to completion via microtasks alone before the first
// call resumes and writes its remaining two items. Against the unpatched
// module this reliably produces a split state (device wrap from one DEK,
// recovery wrap + salt from the other); against the fix, only one DEK is
// ever minted in the first place, so there is nothing to split.
//
// Reuses the same mock shapes as key_manager.test.ts -- see that file's
// header for the two Jest/Babel traps these mocks work around
// (`import * as X` everywhere, and tracking expo-crypto calls via a
// closure the mock factory itself owns rather than via jest.spyOn).

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => (store.has(key) ? (store.get(key) as string) : null)),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
});

jest.mock("@/modules/notification_listener", () => ({
  wrapWithDeviceKek: jest.fn(),
  unwrapWithDeviceKek: jest.fn(),
  isDeviceKeyUsable: jest.fn(),
  recreateDeviceKek: jest.fn(),
}));

jest.mock("expo-crypto", () => {
  const generated: Uint8Array[] = [];
  return {
    getRandomBytesAsync: (byteCount: number) => {
      const bytes = new Uint8Array(require("crypto").randomBytes(byteCount));
      generated.push(bytes);
      return Promise.resolve(bytes);
    },
    __generated: generated,
  };
});

import * as SecureStore from "expo-secure-store";
import * as NotificationListener from "@/modules/notification_listener";
import * as RecoveryPhrase from "../recovery_phrase";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { initializeKeys, unlockWithDeviceKey, unlockWithRecoveryPhrase, lock, RecoveryUnlockFailedError } from "../key_manager";

type SecureStoreMock = { getItemAsync: jest.Mock; setItemAsync: jest.Mock; deleteItemAsync: jest.Mock; __store: Map<string, string> };
const secureStoreMock = SecureStore as unknown as SecureStoreMock;
const nativeWrap = NotificationListener.wrapWithDeviceKek as jest.Mock;
const nativeUnwrap = NotificationListener.unwrapWithDeviceKek as jest.Mock;

// A REAL, phrase-and-salt-dependent derivation, just fast (sha256 instead of
// Argon2id) -- see key_manager.test.ts's fakeDeriveRecoveryKey for why a
// constant stand-in would be wrong here: it would make every phrase derive
// to the same key, hiding exactly the bug this file exists to catch.
function fakeDeriveRecoveryKey(phrase: string[], salt: Uint8Array): Promise<Uint8Array> {
  const material = `${phrase.join(" ")}::${bytesToHex(salt)}`;
  return Promise.resolve(sha256(new TextEncoder().encode(material)));
}

function xorBase64(input: string): string {
  const bytes = Buffer.from(input, "base64");
  return Buffer.from(bytes.map((b) => b ^ 0xff)).toString("base64");
}

function wireNativeBridge(): void {
  nativeWrap.mockImplementation(async (plaintextB64: string) => `gen0:${xorBase64(plaintextB64)}`);
  nativeUnwrap.mockImplementation(async (blobB64: string) => {
    const match = /^gen(\d+):(.*)$/.exec(blobB64);
    if (!match) throw new Error("malformed test fixture blob");
    return xorBase64(match[2]);
  });
}

/**
 * See the file header ("A NOTE ON HOW THIS FILE PROVES THE BUG") for why
 * this exists instead of a plain `Promise.all`. Forces the device-wrap
 * write of whichever call reaches it first to pause for one real
 * macrotask tick -- long enough for a concurrent second call's entire
 * mint-and-wrap sequence (pure microtask chains, no timers of its own) to
 * finish first -- before letting the paused call resume and write its own
 * recovery wrap and salt. Deterministic in both directions: against the
 * unpatched module this reliably splits the final state across two DEKs;
 * against the fix, only one call ever reaches performInitializeKeys at
 * all, so the pause is a harmless no-op delay.
 */
async function initializeKeysWithForcedInterleaving(phraseA: string[], phraseB: string[]): Promise<void> {
  let deviceWriteCount = 0;
  secureStoreMock.setItemAsync.mockImplementation(async (key: string, value: string) => {
    secureStoreMock.__store.set(key, value);
    if (/^gen\d+:/.test(value)) {
      deviceWriteCount += 1;
      if (deviceWriteCount === 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  });

  await Promise.all([initializeKeys(phraseA), initializeKeys(phraseB)]);
}

const PHRASE_A = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
const PHRASE_B = ["golf", "hotel", "india", "juliet", "kilo", "lima"];

beforeEach(() => {
  lock();
  secureStoreMock.__store.clear();
  jest.clearAllMocks();
  wireNativeBridge();
  // Baseline write-through implementation; initializeKeysWithForcedInterleaving
  // installs its own override for the tests that need it. Set fresh every
  // time so no test's override can leak into the next one.
  secureStoreMock.setItemAsync.mockImplementation(async (key: string, value: string) => {
    secureStoreMock.__store.set(key, value);
  });
  jest.spyOn(RecoveryPhrase, "deriveRecoveryKey").mockImplementation(fakeDeriveRecoveryKey);
});

afterEach(() => {
  lock();
});

describe("initializeKeys under genuine concurrency", () => {
  it("SAME phrase, double-tapped initializeKeys (as onboarding's confirm button actually triggers it): both unlock paths yield byte-identical DEKs", async () => {
    await Promise.all([initializeKeys(PHRASE_A), initializeKeys(PHRASE_A)]);

    lock();
    const viaDevice = Uint8Array.from(await unlockWithDeviceKey());
    lock();
    const viaRecovery = await unlockWithRecoveryPhrase(PHRASE_A);

    expect(Buffer.from(viaDevice)).toEqual(Buffer.from(viaRecovery));
  });

  it("SAME phrase, double-tapped initializeKeys: mints exactly one DEK, not one per caller", async () => {
    // The direct mechanism check: two independent mints would each call the
    // native wrap bridge once, for a total of two. A single shared mint
    // calls it exactly once, regardless of how many callers awaited it.
    await Promise.all([initializeKeys(PHRASE_A), initializeKeys(PHRASE_A)]);

    expect(nativeWrap).toHaveBeenCalledTimes(1);
  });

  it("SAME phrase, FORCED interleaving (one call paused mid-write while the other runs to completion): the device wrap and recovery wrap MUST NOT end up wrapping two different DEKs", async () => {
    await initializeKeysWithForcedInterleaving(PHRASE_A, PHRASE_A);

    lock();
    const viaDevice = Uint8Array.from(await unlockWithDeviceKey());
    lock();
    const viaRecovery = await unlockWithRecoveryPhrase(PHRASE_A);

    expect(Buffer.from(viaDevice)).toEqual(Buffer.from(viaRecovery));
  });

  it("DIFFERENT phrases, FORCED interleaving: whichever call wins, the device wrap and the winning recovery wrap stay internally consistent", async () => {
    await initializeKeysWithForcedInterleaving(PHRASE_A, PHRASE_B);

    lock();
    const viaDevice = Uint8Array.from(await unlockWithDeviceKey());

    let successes = 0;
    let winningRecoveryDek: Uint8Array | null = null;
    for (const candidate of [PHRASE_A, PHRASE_B]) {
      lock();
      try {
        const viaRecovery = await unlockWithRecoveryPhrase(candidate);
        successes += 1;
        winningRecoveryDek = Uint8Array.from(viaRecovery);
      } catch (error) {
        expect(error).toBeInstanceOf(RecoveryUnlockFailedError);
      }
    }

    // Exactly one phrase must unlock the DEK the device path also unlocks
    // -- not zero (both wraps would be orphaned, pointing at neither
    // phrase) and not two (which would mean the DEK was not actually
    // derived from the phrase at all).
    expect(successes).toBe(1);
    expect(Buffer.from(winningRecoveryDek as Uint8Array)).toEqual(Buffer.from(viaDevice));
  });
});

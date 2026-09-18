// The DEK lifecycle -- see key_manager.ts's header comment and
// docs/12-encryption-and-app-lock.md §3/§5 for the design this exercises.
//
// Both dependencies this file mocks are replaced with fakes that behave
// like the real thing closely enough to catch real regressions, not with
// identity passthroughs -- an identity "wrap" would make a broken
// implementation that skips wrapping entirely indistinguishable from a
// correct one. See wireDefaultNativeBridge (a stateful fake with real
// "generations", so recreateDeviceKek's rotation is actually observable)
// and fakeDeriveRecoveryKey (a real, phrase-and-salt-dependent hash, not a
// constant).
//
// JEST/BABEL TRAP (see recovery_phrase.test.ts / progress.md Task 5): a
// spy on a NAMED import destructures into a private local binding the
// module under test never sees. key_manager.ts imports its dependencies as
// `import * as X from "..."` for exactly this reason -- this file mirrors
// that with `import * as RecoveryPhrase from "../recovery_phrase"` so
// `jest.spyOn(RecoveryPhrase, "deriveRecoveryKey")` actually reaches the
// call key_manager.ts makes.

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
  recreateCaptureKeyPair: jest.fn(),
}));

// Tracks every Uint8Array expo-crypto has ever generated, via a closure the
// mock factory itself owns -- NOT via jest.spyOn.
//
// JEST/BABEL TRAP #2 (beyond the named-import trap Task 5 already
// documented): in THIS file specifically -- once another moduleNameMapper
// ("@/...") -aliased module is also imported -- Babel's ES-module interop
// for a namespace import of a mock module that lacks `__esModule` (exactly
// what a plain jest.mock factory object is) produces a WRAPPER copy of that
// module's properties. Reassigning a property on the wrapper via
// jest.spyOn(NamespaceImport, "fn") was empirically verified (by a
// debug marker written on one side and read as `undefined` on the other) to
// land on a DIFFERENT wrapper instance than the one key_manager.ts's own
// `import * as Crypto` resolves to -- so the spy silently reports zero
// calls even though the real, correct implementation calls the function
// three times. This reproduced with expo-crypto specifically once
// "@/modules/notification_listener" was also imported into this same file;
// it did NOT reproduce for recovery_phrase.ts (a real compiled ES module,
// which DOES carry `__esModule`, so Babel's interop returns the ORIGINAL
// object with no copy -- which is exactly why the RecoveryPhrase spy below
// works fine). Tracking calls INSIDE the mock's own closure sidesteps the
// hazard entirely: there is only ever one function object, so there is
// nothing for two divergent wrappers to disagree about.
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
import * as Crypto from "expo-crypto";
import * as NotificationListener from "@/modules/notification_listener";
import * as RecoveryPhrase from "../recovery_phrase";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  initializeKeys,
  unlockWithDeviceKey,
  unlockWithRecoveryPhrase,
  rewrapAfterInvalidation,
  getKeyState,
  lock,
  wipeKeys,
  RecoveryUnlockFailedError,
} from "../key_manager";

// ---------------------------------------------------------------------------
// Test fixtures and fakes
// ---------------------------------------------------------------------------

const TEST_PHRASE = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
const OTHER_PHRASE = ["golf", "hotel", "india", "juliet", "kilo", "lima"];
const WRONG_PHRASE = ["november", "oscar", "papa", "quebec", "romeo", "sierra"];

type SecureStoreMock = {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  __store: Map<string, string>;
};
const secureStoreMock = SecureStore as unknown as SecureStoreMock;

const cryptoMock = Crypto as unknown as { __generated: Uint8Array[] };

const nativeWrap = NotificationListener.wrapWithDeviceKek as jest.Mock;
const nativeUnwrap = NotificationListener.unwrapWithDeviceKek as jest.Mock;
const nativeIsUsable = NotificationListener.isDeviceKeyUsable as jest.Mock;
const nativeRecreate = NotificationListener.recreateDeviceKek as jest.Mock;

/**
 * A REAL, phrase-and-salt-dependent derivation, just fast (sha256 instead of
 * Argon2id) -- Argon2id's own correctness is recovery_phrase.test.ts's job,
 * and re-running the real ~1.5s KDF here for every case would make this
 * suite unusably slow. Using a CONSTANT stand-in instead would be wrong in
 * the other direction: it would make "wrong phrase" and "right phrase"
 * derive to the SAME key, and every discriminating test below would pass
 * against a broken implementation for the wrong reason.
 */
function fakeDeriveRecoveryKey(phrase: string[], salt: Uint8Array): Promise<Uint8Array> {
  const material = `${phrase.join(" ")}::${bytesToHex(salt)}`;
  return Promise.resolve(sha256(new TextEncoder().encode(material)));
}

function xorBase64(input: string): string {
  const bytes = Buffer.from(input, "base64");
  const xored = Buffer.from(bytes.map((b) => b ^ 0xff));
  return xored.toString("base64");
}

// A stateful fake for the device KEK that models what Android actually
// does: once invalidated, EVERY operation (wrap AND unwrap) fails until
// recreateDeviceKek() runs, and a wrap made under one generation never
// unwraps under another. This is what makes the rewrapAfterInvalidation
// tests below able to catch "forgot to call recreateDeviceKek": the fake
// wrap call would reject, not silently succeed.
let deviceKeyInvalidated = false;
let deviceKeyGeneration = 0;

function resetFakeDeviceKek(): void {
  deviceKeyInvalidated = false;
  deviceKeyGeneration = 0;
}

function simulateDeviceKeyInvalidated(): void {
  deviceKeyInvalidated = true;
}

class FakeDeviceKeyInvalidatedError extends Error {
  readonly code = "DeviceKeyInvalidated";
  constructor() {
    super("device key invalidated (test double)");
    this.name = "DeviceKeyInvalidatedError";
  }
}

function wireDefaultNativeBridge(): void {
  nativeWrap.mockImplementation(async (plaintextB64: string) => {
    if (deviceKeyInvalidated) throw new FakeDeviceKeyInvalidatedError();
    return `gen${deviceKeyGeneration}:${xorBase64(plaintextB64)}`;
  });
  nativeUnwrap.mockImplementation(async (blobB64: string) => {
    if (deviceKeyInvalidated) throw new FakeDeviceKeyInvalidatedError();
    const match = /^gen(\d+):(.*)$/.exec(blobB64);
    if (!match) throw new Error("malformed test fixture blob");
    if (Number(match[1]) !== deviceKeyGeneration) throw new FakeDeviceKeyInvalidatedError();
    return xorBase64(match[2]);
  });
  nativeIsUsable.mockImplementation(async () => !deviceKeyInvalidated);
  nativeRecreate.mockImplementation(async () => {
    deviceKeyInvalidated = false;
    deviceKeyGeneration += 1;
  });
}

beforeEach(() => {
  lock();
  secureStoreMock.__store.clear();
  cryptoMock.__generated.length = 0;
  jest.clearAllMocks();
  resetFakeDeviceKek();
  jest.spyOn(RecoveryPhrase, "deriveRecoveryKey").mockImplementation(fakeDeriveRecoveryKey);
});

afterEach(() => {
  lock();
});

// ---------------------------------------------------------------------------

describe("initializeKeys", () => {
  it("writes a device wrap, a recovery wrap, and a salt, and never stores the raw DEK bytes", async () => {
    wireDefaultNativeBridge();

    await initializeKeys(TEST_PHRASE);

    expect(secureStoreMock.__store.size).toBe(3);

    // Identify the DEK among everything expo-crypto generated by its unique
    // 32-byte length (the recovery salt is 16 bytes, the GCM nonce is 12).
    const dekBytes = cryptoMock.__generated.find((bytes) => bytes.length === 32);
    expect(dekBytes).toBeDefined();

    const dekHex = bytesToHex(dekBytes as Uint8Array);
    const dekB64 = Buffer.from(dekBytes as Uint8Array).toString("base64");

    for (const stored of secureStoreMock.__store.values()) {
      expect(stored).not.toContain(dekHex);
      expect(stored).not.toContain(dekB64);
    }
  });

  it("leaves the DEK unlocked in memory on first run, with no redundant unlock call needed", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    await expect(getKeyState()).resolves.toBe("unlocked");
  });

  it("never overwrites an existing DEK or its wraps when called a second time, even with a different phrase", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);

    const wrapCallsAfterFirstInit = nativeWrap.mock.calls.length;
    const storedAfterFirstInit = new Map(secureStoreMock.__store);

    lock();
    await initializeKeys(OTHER_PHRASE);

    expect(nativeWrap.mock.calls.length).toBe(wrapCallsAfterFirstInit);
    expect(new Map(secureStoreMock.__store)).toEqual(storedAfterFirstInit);

    // The strongest proof the DEK was not replaced: the ORIGINAL phrase
    // still unlocks it, and the second call's phrase does not.
    const dekBytes = await unlockWithRecoveryPhrase(TEST_PHRASE);
    expect(dekBytes.length).toBe(32);

    lock();
    await expect(unlockWithRecoveryPhrase(OTHER_PHRASE)).rejects.toBeInstanceOf(RecoveryUnlockFailedError);
  });
});

describe("unlockWithDeviceKey and unlockWithRecoveryPhrase agree", () => {
  it("both unlock paths return the exact same DEK", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();

    const viaDevice = await unlockWithDeviceKey();
    const viaDeviceCopy = Uint8Array.from(viaDevice); // snapshot before lock() scrubs the buffer
    lock();

    const viaRecovery = await unlockWithRecoveryPhrase(TEST_PHRASE);

    expect(viaDeviceCopy.length).toBe(32);
    expect(viaDeviceCopy.some((b) => b !== 0)).toBe(true);
    expect(Buffer.from(viaDeviceCopy)).toEqual(Buffer.from(viaRecovery));
  });

  it("propagates a native DeviceKeyInvalidated rejection from unlockWithDeviceKey completely UNCHANGED", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();

    const invalidatedError = new FakeDeviceKeyInvalidatedError();
    nativeUnwrap.mockRejectedValueOnce(invalidatedError);

    await expect(unlockWithDeviceKey()).rejects.toBe(invalidatedError);
  });
});

describe("unlockWithRecoveryPhrase", () => {
  it("throws RecoveryUnlockFailedError for a wrong phrase", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();

    await expect(unlockWithRecoveryPhrase(WRONG_PHRASE)).rejects.toBeInstanceOf(RecoveryUnlockFailedError);
  });

  it("fails with the SAME error for a wrong phrase as for a corrupted blob -- neither is distinguishable from outside", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();

    let wrongPhraseError: unknown;
    try {
      await unlockWithRecoveryPhrase(WRONG_PHRASE);
    } catch (error) {
      wrongPhraseError = error;
    }
    expect(wrongPhraseError).toBeInstanceOf(RecoveryUnlockFailedError);

    // Corrupt everything in storage (simulating a damaged blob on disk).
    // unlockWithRecoveryPhrase only ever reads the recovery wrap and salt,
    // so mutating the device wrap alongside them is harmless noise.
    for (const key of secureStoreMock.__store.keys()) {
      secureStoreMock.__store.set(key, "ff".repeat(40));
    }

    let corruptBlobError: unknown;
    try {
      await unlockWithRecoveryPhrase(TEST_PHRASE);
    } catch (error) {
      corruptBlobError = error;
    }

    expect(corruptBlobError).toBeInstanceOf(RecoveryUnlockFailedError);
    expect((corruptBlobError as Error).message).toBe((wrongPhraseError as Error).message);
  });

  it("throws RecoveryUnlockFailedError, not a native-bridge error, when keys were never initialized", async () => {
    await expect(unlockWithRecoveryPhrase(TEST_PHRASE)).rejects.toBeInstanceOf(RecoveryUnlockFailedError);
  });
});

describe("rewrapAfterInvalidation", () => {
  it("recreates the device key and rewraps the recovered DEK; the new wrap then unlocks via the device path to the SAME DEK", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    const originalDek = Uint8Array.from(await unlockWithDeviceKey());
    lock();

    simulateDeviceKeyInvalidated();
    await expect(unlockWithDeviceKey()).rejects.toBeInstanceOf(FakeDeviceKeyInvalidatedError);

    await rewrapAfterInvalidation(TEST_PHRASE);
    expect(nativeRecreate).toHaveBeenCalledTimes(1);

    lock(); // force a genuine re-unlock through the device path, not the in-memory side effect
    const afterRecovery = await unlockWithDeviceKey();

    expect(Buffer.from(afterRecovery)).toEqual(Buffer.from(originalDek));
  });

  it("MUST call recreateDeviceKek, not merely re-wrap under the same (still-dead) key", async () => {
    // This is the exact bug Task 4's progress log recorded against
    // ensureDeviceKek(): a presence-only idempotent call would return the
    // SAME invalidated key, and wrapping under it would fail (or, worse,
    // silently produce a wrap that can never be unwrapped again). The fake
    // bridge models Android faithfully here -- wrapWithDeviceKek ALSO
    // rejects while deviceKeyInvalidated is true, so if
    // rewrapAfterInvalidation skipped recreateDeviceKek, this call would
    // reject instead of resolving.
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();
    simulateDeviceKeyInvalidated();

    await expect(rewrapAfterInvalidation(TEST_PHRASE)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("MUST also replace the capture keypair, which the same event invalidated", async () => {
    // GAP-059. Removing the device screen lock kills EVERY key created with
    // `setUserAuthenticationRequired(true)`, and that is the device KEK and the
    // capture keypair, not just the KEK. Recovery used to rotate the KEK and
    // stop, so it reported success while `getCapturePublicKey()` still returned
    // the dead pair's public half. The listener then sealed every new capture
    // to a key nothing could open, each drain discarded the batch, and the
    // health card kept saying the listener was fine. Silent and permanent.
    //
    // Asserted as a CALL rather than through the fake bridge, deliberately:
    // unlike the KEK there is nothing downstream in this file that would fail
    // if the pair stayed dead, which is precisely the property that let this
    // ship. Nothing failing is the bug.
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();
    simulateDeviceKeyInvalidated();
    (NotificationListener.recreateCaptureKeyPair as jest.Mock).mockClear();

    await rewrapAfterInvalidation(TEST_PHRASE);

    expect(NotificationListener.recreateCaptureKeyPair).toHaveBeenCalledTimes(1);
  });

  it("replaces the capture keypair on a wipe, so the next install starts clean", async () => {
    // Same reasoning from the other direction: a wipe is the likeliest thing a
    // user reaches for AFTER an invalidation, so "start over" must not start
    // over on the dead pair that sent them there.
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    (NotificationListener.recreateCaptureKeyPair as jest.Mock).mockClear();

    await wipeKeys();

    expect(NotificationListener.recreateCaptureKeyPair).toHaveBeenCalledTimes(1);
  });

  it("leaves the DEK unlocked in memory immediately after a successful recovery", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();
    simulateDeviceKeyInvalidated();

    await rewrapAfterInvalidation(TEST_PHRASE);

    await expect(getKeyState()).resolves.toBe("unlocked");
  });

  it("returns the SAME recovered DEK it leaves unlocked in memory, so a caller never has to re-derive it via a second, redundant unlock call", async () => {
    // Carried forward from Task 6's progress note: rewrapAfterInvalidation
    // already holds the plaintext DEK by the time it succeeds, so Task 9's
    // app-lock flow (get the DEK -> unlockDatabase(dek) ->
    // setCacheEncryptionKey(dek)) must be able to use THIS return value
    // directly. A second unlockWithRecoveryPhrase call to fetch it would
    // re-run Argon2id for nothing (~1.5s wasted) and is exactly what this
    // return value exists to make unnecessary.
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    const originalDek = Uint8Array.from(await unlockWithDeviceKey());
    lock();
    simulateDeviceKeyInvalidated();

    const returnedDek = await rewrapAfterInvalidation(TEST_PHRASE);

    expect(Buffer.from(returnedDek)).toEqual(Buffer.from(originalDek));
  });

  it("propagates RecoveryUnlockFailedError for a wrong phrase without touching the device key at all", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();
    simulateDeviceKeyInvalidated();

    await expect(rewrapAfterInvalidation(WRONG_PHRASE)).rejects.toBeInstanceOf(RecoveryUnlockFailedError);
    expect(nativeRecreate).not.toHaveBeenCalled();
  });
});

describe("wipeKeys", () => {
  it("deletes all three secure-store items, so getKeyState reports uninitialized afterward", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    expect(secureStoreMock.__store.size).toBe(3);

    await wipeKeys();

    expect(secureStoreMock.__store.size).toBe(0);
    await expect(getKeyState()).resolves.toBe("uninitialized");
  });

  it("clears the in-memory DEK -- a wipe must not leave key material live after 'destroying' it", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    await expect(getKeyState()).resolves.toBe("unlocked");

    await wipeKeys();

    await expect(getKeyState()).resolves.toBe("uninitialized");
  });

  it("is safe to call when already uninitialized (no keys ever written)", async () => {
    await expect(wipeKeys()).resolves.toBeUndefined();
    await expect(getKeyState()).resolves.toBe("uninitialized");
  });

  it("leaves initializeKeys free to run a genuinely fresh setup afterward, not blocked by stale remnants", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    await wipeKeys();

    await initializeKeys(OTHER_PHRASE);

    await expect(getKeyState()).resolves.toBe("unlocked");
    lock();
    // Only the NEW phrase should unlock the NEW keys -- proves wipeKeys did
    // not merely hide the old wraps behind a false "uninitialized" report
    // while secretly leaving them (and the old DEK) reachable.
    await expect(unlockWithRecoveryPhrase(TEST_PHRASE)).rejects.toBeInstanceOf(RecoveryUnlockFailedError);
    await expect(unlockWithRecoveryPhrase(OTHER_PHRASE)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("getKeyState", () => {
  it("reports uninitialized when no first-run state exists", async () => {
    await expect(getKeyState()).resolves.toBe("uninitialized");
  });

  it("reports locked once first-run state exists but the DEK is not in memory", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();
    await expect(getKeyState()).resolves.toBe("locked");
  });

  it("reports unlocked while the DEK is held in memory", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    await expect(getKeyState()).resolves.toBe("unlocked");
  });

  it("reports locked, NOT uninitialized, once the device key is invalidated -- distinguishing the two is this function's whole job", async () => {
    // isDeviceKeyUsable() would report false here, indistinguishably from
    // "never initialized" (Task 4's carried-forward gap). getKeyState must
    // answer from secure-storage presence, not from that signal.
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();
    simulateDeviceKeyInvalidated();

    await expect(getKeyState()).resolves.toBe("locked");
  });

  it("never calls isDeviceKeyUsable -- answered from secure-storage presence alone, without provoking a failed unwrap", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();
    simulateDeviceKeyInvalidated();

    await getKeyState();

    expect(nativeIsUsable).not.toHaveBeenCalled();
    expect(nativeUnwrap).not.toHaveBeenCalled();
  });

  // A partial first-run state: the process dies (or a write rejects)
  // between two of initializeKeys's three sequential SecureStore writes
  // (deviceWrap, then recoveryWrap, then recoverySalt -- see
  // performInitializeKeys), leaving a STRICT SUBSET of the three items on
  // disk. See hasStoredKeys()'s doc for the argument that its `&&` of all
  // three makes "locked" for a partial subset IMPOSSIBLE by construction --
  // these tests pin that down as observable behavior, using the real write
  // order learned from a genuine completed initializeKeys call rather than
  // hardcoding this module's private storage-key strings.
  describe("with a partial first-run state (process death mid-initializeKeys)", () => {
    it("reports uninitialized, not locked, when only the FIRST of the three writes landed", async () => {
      wireDefaultNativeBridge();
      await initializeKeys(TEST_PHRASE);
      const keysInWriteOrder = [...secureStoreMock.__store.keys()];
      const values = new Map(secureStoreMock.__store);
      lock();
      secureStoreMock.__store.clear();

      secureStoreMock.__store.set(keysInWriteOrder[0], values.get(keysInWriteOrder[0]) as string);

      await expect(getKeyState()).resolves.toBe("uninitialized");
    });

    it("reports uninitialized, not locked, when only the FIRST TWO of the three writes landed", async () => {
      wireDefaultNativeBridge();
      await initializeKeys(TEST_PHRASE);
      const keysInWriteOrder = [...secureStoreMock.__store.keys()];
      const values = new Map(secureStoreMock.__store);
      lock();
      secureStoreMock.__store.clear();

      secureStoreMock.__store.set(keysInWriteOrder[0], values.get(keysInWriteOrder[0]) as string);
      secureStoreMock.__store.set(keysInWriteOrder[1], values.get(keysInWriteOrder[1]) as string);

      await expect(getKeyState()).resolves.toBe("uninitialized");
    });

    it("self-heals: a later initializeKeys call replaces a stale partial remnant with a fully consistent pair, unaffected by what was left behind", async () => {
      wireDefaultNativeBridge();
      await initializeKeys(TEST_PHRASE); // establish the real write order once
      const keysInWriteOrder = [...secureStoreMock.__store.keys()];
      lock();
      secureStoreMock.__store.clear();

      // Simulate a crash after the first two of three writes, from a phrase
      // that will never be used again. There is no live DEK depending on
      // this remnant -- initializeKeys never sets the in-memory `dek` until
      // AFTER all three writes succeed -- so overwriting it from scratch is
      // safe by construction, not just in this test.
      secureStoreMock.__store.set(keysInWriteOrder[0], "stale-partial-device-wrap");
      secureStoreMock.__store.set(keysInWriteOrder[1], "stale-partial-recovery-wrap");
      await expect(getKeyState()).resolves.toBe("uninitialized");

      await initializeKeys(OTHER_PHRASE);

      await expect(getKeyState()).resolves.toBe("unlocked");
      lock();
      const viaDevice = Uint8Array.from(await unlockWithDeviceKey()); // snapshot before lock() scrubs the buffer
      lock();
      const viaRecovery = await unlockWithRecoveryPhrase(OTHER_PHRASE);
      expect(Buffer.from(viaDevice)).toEqual(Buffer.from(viaRecovery));
    });
  });
});

describe("lock", () => {
  it("zeroes the exact DEK buffer previously returned by an unlock call, and getKeyState reports locked afterward", async () => {
    wireDefaultNativeBridge();
    await initializeKeys(TEST_PHRASE);
    lock();

    const dekBytes = await unlockWithDeviceKey();
    expect(dekBytes.some((b) => b !== 0)).toBe(true);

    lock();

    expect(dekBytes.every((b) => b === 0)).toBe(true);
    await expect(getKeyState()).resolves.toBe("locked");
  });

  it("is safe to call when already locked or uninitialized", () => {
    expect(() => lock()).not.toThrow();
    expect(() => lock()).not.toThrow();
  });
});

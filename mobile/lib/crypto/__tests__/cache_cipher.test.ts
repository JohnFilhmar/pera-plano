// lib/crypto/__tests__/cache_cipher.test.ts -- see cache_cipher.ts's header
// comment for why this exists as its own module and its own suite: a cipher
// that no-ops passes every naive round-trip test ever written, so several
// tests here are deliberately built to FAIL against specific plausible-
// broken implementations, not just to confirm the happy path.
//
// expo-crypto's getRandomBytesAsync is mocked globally in
// test_support/jest_setup.ts with a real Node CSPRNG (require("crypto").
// randomBytes), and the override below keeps that CSPRNG while adding the
// one thing the lock-race tests need: the ability to hold a single draw
// suspended, which is the exact await encryptCacheValue parks on. Controls
// live in the factory's own closure rather than behind jest.spyOn, for the
// namespace-import reason key_manager.test.ts documents at length.
jest.mock("expo-crypto", () => {
  let parkNextDraw = false;
  let releaseDraw: (() => void) | null = null;
  let announceParked: (() => void) | null = null;
  return {
    getRandomBytesAsync: async (byteCount: number) => {
      const bytes = new Uint8Array(require("crypto").randomBytes(byteCount));
      if (parkNextDraw) {
        parkNextDraw = false;
        await new Promise<void>((resolve) => {
          releaseDraw = resolve;
          announceParked?.();
          announceParked = null;
        });
      }
      return bytes;
    },
    // Arms a one-shot park on the NEXT draw and resolves once that draw is
    // actually suspended, so a test never has to guess a microtask count to
    // know the write it started is genuinely mid-flight.
    __parkNextNonceDraw: () =>
      new Promise<void>((resolve) => {
        parkNextDraw = true;
        announceParked = resolve;
      }),
    __releaseParkedNonceDraw: () => {
      releaseDraw?.();
      releaseDraw = null;
    },
  };
});

import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as Crypto from "expo-crypto";
import {
  encryptCacheValue,
  decryptCacheValue,
  createCacheCodec,
  getDiscardedCacheReads,
  resetDiscardedCacheReadsForTests,
  CacheCipherKeyMissingError,
  CacheDecryptionError,
} from "../cache_cipher";

const KEY = new Uint8Array(32).fill(7); // any fixed, non-secret 32-byte key
const OTHER_KEY = new Uint8Array(32).fill(9);

// The mock-only controls the factory above adds on top of expo-crypto's real
// surface; the cast reaches them without widening the module's own types.
const CryptoMock = Crypto as unknown as {
  __parkNextNonceDraw: () => Promise<void>;
  __releaseParkedNonceDraw: () => void;
};

// AES-GCM's authentication tag is a fixed, spec-mandated 16 bytes appended
// after the ciphertext data -- not this module's private choice, so tests
// are free to rely on it without reaching into cache_cipher.ts's internals
// (its own GCM_NONCE_BYTES constant is intentionally unexported).
const AES_GCM_TAG_BYTES = 16;

// A distinctive, Philippines-flavored merchant string -- exactly the kind
// of value docs/12-encryption-and-app-lock.md §1 names as sensitive
// ("who they paid"). A cipher that got "simplified" into a no-op would leave
// this sitting in the stored blob's bytes verbatim.
const MERCHANT = "Jollibee SM Megamall";

/** True iff `needle`'s ASCII bytes appear as a contiguous run inside
 * `haystack`. Deliberately operates on DECODED bytes, not on the outer hex
 * string -- hex-encoding alone (with no actual encryption) would already
 * make a naive `hexBlob.includes(needle)` check pass for the WRONG reason,
 * since encoding transforms every byte into two hex digits and destroys any
 * literal ASCII substring regardless of whether real encryption happened.
 * Checking the decoded bytes is what actually discriminates "encrypted" from
 * "encoded but not encrypted". */
function bytesContainAsciiSubstring(haystack: Uint8Array, needle: string): boolean {
  let ascii = "";
  for (const byte of haystack) ascii += String.fromCharCode(byte);
  return ascii.includes(needle);
}

beforeEach(() => {
  resetDiscardedCacheReadsForTests();
});

describe("encryptCacheValue / decryptCacheValue round-trip", () => {
  it("round-trips a nested object intact, not just flat strings", async () => {
    const value = {
      wallet: { id: "w1", balanceCents: 543210, currency: "PHP" },
      transactions: [
        { id: "t1", merchant: MERCHANT, amountCents: -18500, tags: ["food", "lunch"] },
        { id: "t2", merchant: "Meralco", amountCents: -210000, tags: ["bills"] },
      ],
      metadata: { syncedAt: null, nested: { deeper: { still: [1, 2, 3] } } },
    };

    const blob = await encryptCacheValue(() => KEY, value);
    const result = decryptCacheValue(KEY, blob);

    expect(result).toEqual(value);
  });

  it("produces a DIFFERENT blob each time for the identical value, because the nonce is fresh per call", async () => {
    const value = { merchant: MERCHANT };
    const blobOne = await encryptCacheValue(() => KEY, value);
    const blobTwo = await encryptCacheValue(() => KEY, value);

    expect(blobOne).not.toBe(blobTwo);
  });

  it("fails to decrypt under the wrong key rather than returning wrong-but-valid data", async () => {
    const blob = await encryptCacheValue(() => KEY, { merchant: MERCHANT });
    expect(() => decryptCacheValue(OTHER_KEY, blob)).toThrow(CacheDecryptionError);
  });
});

// The property that catches a cipher reduced to a no-op (or to a reversible
// encoding standing in for encryption, e.g. base64/hex with no actual AES
// call): the emitted blob's bytes must not contain the plaintext merchant
// string this cached data holds.
describe("ciphertext does not leak plaintext", () => {
  it("the encrypted blob's bytes do not contain the plaintext merchant string", async () => {
    const blob = await encryptCacheValue(() => KEY, {
      merchant: MERCHANT,
      note: "some other unrelated text",
    });

    const blobBytes = hexToBytes(blob);
    expect(bytesContainAsciiSubstring(blobBytes, MERCHANT)).toBe(false);
  });
});

// The property that catches a switch to an unauthenticated cipher mode
// (e.g. AES-CTR instead of AES-GCM): a single tampered byte, chosen so that
// under an UNAUTHENTICATED stream cipher it would decrypt to still-valid-
// but-wrong JSON (never throwing), must be REJECTED outright under the real
// authenticated cipher, before any plaintext is even materialized.
describe("a tampered blob is rejected, not silently accepted", () => {
  it("throws CacheDecryptionError for a blob with one flipped byte, never returning partial data", async () => {
    const PROBE = "AAAA";
    const value = { merchant: "irrelevant for this test", probe: PROBE };
    const plaintextJson = JSON.stringify(value);
    // Pin the exact literal shape this test's byte-offset math depends on --
    // if JSON.stringify's key order or formatting ever changed, this fails
    // loudly here instead of the offset silently landing somewhere else.
    expect(plaintextJson.endsWith(`"${PROBE}"}`)).toBe(true);

    const blob = await encryptCacheValue(() => KEY, value);
    const blobBytes = hexToBytes(blob);

    // Target the LAST character of PROBE: plaintext ends "...AAAA"} --
    // 0 = '}', 1 = closing '"', 2 = the last 'A'. Counting in from the end
    // of the BLOB, past the 16-byte GCM tag, lands exactly on that byte --
    // no dependency on this module's private nonce-length constant.
    const targetIndex = blobBytes.length - 1 - AES_GCM_TAG_BYTES - 2;
    // XOR by the difference between 'A' and 'B': under a plain stream/CTR
    // cipher this deterministically flips the recovered plaintext byte from
    // 'A' to 'B' -- still perfectly valid JSON -- REGARDLESS of the actual
    // keystream value, which this test never needs to know. Under the real
    // authenticated GCM cipher, tampering this (or any) ciphertext byte
    // invalidates the tag and must be rejected before that swap could ever
    // be observed.
    blobBytes[targetIndex] ^= "A".charCodeAt(0) ^ "B".charCodeAt(0);
    const tampered = bytesToHex(blobBytes);

    expect(() => decryptCacheValue(KEY, tampered)).toThrow(CacheDecryptionError);
  });

  it("throws CacheDecryptionError for a truncated blob", async () => {
    const blob = await encryptCacheValue(() => KEY, { merchant: MERCHANT });
    const truncated = blob.slice(0, blob.length - 8);

    expect(() => decryptCacheValue(KEY, truncated)).toThrow(CacheDecryptionError);
  });

  it("throws CacheDecryptionError for a blob that is not valid hex at all", () => {
    expect(() => decryptCacheValue(KEY, "not a hex blob at all")).toThrow(CacheDecryptionError);
  });

  it("sanity check: decrypting an UNMODIFIED blob succeeds -- proves the tamper above is what causes the throw, not some incidental bug", async () => {
    const value = { merchant: "irrelevant for this test", probe: "AAAA" };
    const blob = await encryptCacheValue(() => KEY, value);

    expect(decryptCacheValue(KEY, blob)).toEqual(value);
  });
});

describe("a missing key fails explicitly, distinctly from a corrupt blob", () => {
  it("encryptCacheValue rejects with CacheCipherKeyMissingError when key is null", async () => {
    await expect(encryptCacheValue(() => null, { a: 1 })).rejects.toBeInstanceOf(CacheCipherKeyMissingError);
  });

  it("encryptCacheValue rejects with CacheCipherKeyMissingError when key is an empty Uint8Array", async () => {
    await expect(encryptCacheValue(() => new Uint8Array(0), { a: 1 })).rejects.toBeInstanceOf(
      CacheCipherKeyMissingError,
    );
  });

  it("decryptCacheValue throws CacheCipherKeyMissingError, NOT CacheDecryptionError, when key is absent", () => {
    let caught: unknown;
    try {
      decryptCacheValue(undefined, "deadbeef");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CacheCipherKeyMissingError);
    expect(caught).not.toBeInstanceOf(CacheDecryptionError);
  });
});

// The write-side ordering guarantee in cache_cipher.ts's header. A cache
// write is parked on its nonce draw for a real slice of time, and
// KeyManager.lock() destroys the DEK by zeroing that exact buffer in place,
// so an implementation that resolves the key BEFORE the draw resumes holding
// 32 zero bytes and encrypts the whole dehydrated cache under a key every
// attacker already has. Nothing else in this file can see that: such a blob
// is well-formed, round-trips under its own key, and leaks no plaintext --
// it just happens to be readable by anyone.
describe("a lock landing mid-write cannot produce a blob under the zeroed key", () => {
  it("rejects a write whose nonce draw was still pending when the key was cleared and zeroed", async () => {
    const dek = new Uint8Array(32).fill(7);
    let liveKey: Uint8Array | null = dek;

    const parked = CryptoMock.__parkNextNonceDraw();
    const write = createCacheCodec(() => liveKey).serialize({ merchant: MERCHANT });
    await parked;

    // lockNow()'s teardown, in its own order: drop the reference the codec
    // reads, then zero the DEK buffer itself.
    liveKey = null;
    dek.fill(0);
    CryptoMock.__releaseParkedNonceDraw();

    await expect(write).rejects.toBeInstanceOf(CacheCipherKeyMissingError);
  });

  it("still rejects when only the bytes were zeroed and the reference survived", async () => {
    const dek = new Uint8Array(32).fill(7);

    const parked = CryptoMock.__parkNextNonceDraw();
    const write = createCacheCodec(() => dek).serialize({ merchant: MERCHANT });
    await parked;

    // lib/security/wipe.ts's wipeKeys() zeroes the DEK without ever going
    // through clearCacheEncryptionKey(), so "the reference is still there"
    // must not be enough to make a write proceed.
    dek.fill(0);
    CryptoMock.__releaseParkedNonceDraw();

    await expect(write).rejects.toBeInstanceOf(CacheCipherKeyMissingError);
  });

  it("completes normally under the live key when no lock intervenes -- the park itself is not what rejects", async () => {
    const dek = new Uint8Array(32).fill(7);

    const parked = CryptoMock.__parkNextNonceDraw();
    const write = createCacheCodec(() => dek).serialize({ merchant: MERCHANT });
    await parked;
    CryptoMock.__releaseParkedNonceDraw();

    expect(decryptCacheValue(dek, await write)).toEqual({ merchant: MERCHANT });
  });

  it("refuses an all-zero key outright -- it can only ever be a scrubbed DEK, never a real one", async () => {
    await expect(encryptCacheValue(() => new Uint8Array(32), { merchant: MERCHANT })).rejects.toBeInstanceOf(
      CacheCipherKeyMissingError,
    );
    expect(() => decryptCacheValue(new Uint8Array(32), "deadbeef")).toThrow(CacheCipherKeyMissingError);
  });
});

describe("createCacheCodec", () => {
  it("serialize + deserialize round-trip a nested object through the exact functions query_client.ts wires up", async () => {
    const codec = createCacheCodec(() => KEY);
    const value = { buster: "v", timestamp: 1, clientState: { queries: [{ id: "q1", data: { merchant: MERCHANT } }] } };

    const cached = await codec.serialize(value);
    expect(codec.deserialize(cached)).toEqual(value);
  });

  it("deserialize discards a tampered blob and returns undefined INSTEAD OF THROWING -- a corrupted cache is disposable, not fatal", async () => {
    const codec = createCacheCodec(() => KEY);
    const blob = await codec.serialize({ merchant: MERCHANT });
    const corrupted = blob.slice(0, blob.length - 10) + "0".repeat(10);

    const before = getDiscardedCacheReads();
    let result: unknown;
    expect(() => {
      result = codec.deserialize(corrupted);
    }).not.toThrow();

    expect(result).toBeUndefined();
    expect(getDiscardedCacheReads()).toBe(before + 1);
  });

  it("logs a COUNT on a discarded read, never the blob or any decrypted content", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const codec = createCacheCodec(() => KEY);
      const blob = await codec.serialize({ merchant: MERCHANT });
      const corrupted = "00" + blob.slice(2);

      codec.deserialize(corrupted);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const loggedText = warnSpy.mock.calls.flat().join(" ");
      expect(loggedText).toMatch(/\d+/); // a count is present
      expect(loggedText).not.toContain(MERCHANT);
      expect(loggedText).not.toContain(blob);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("deserialize also returns undefined (never throws) when no key was ever set -- read-side failures are uniformly non-fatal", () => {
    const codec = createCacheCodec(() => null);
    expect(() => codec.deserialize("deadbeef")).not.toThrow();
    expect(codec.deserialize("deadbeef")).toBeUndefined();
  });

  it("serialize rejects (does not silently write plaintext) when no key was ever set", async () => {
    const codec = createCacheCodec(() => null);
    await expect(codec.serialize({ merchant: MERCHANT })).rejects.toBeInstanceOf(CacheCipherKeyMissingError);
  });
});

// Direct sanity check on the primitive this whole module leans on: GCM
// itself must be the thing doing the rejecting, not some layer above it
// silently swallowing valid ciphertext. If this test ever fails, every test
// above that asserts "throws on tamper" is resting on a false assumption.
describe("the underlying primitive really is authenticated AES-GCM", () => {
  it("noble/ciphers' gcm().decrypt() itself throws on a tampered ciphertext", () => {
    const nonce = new Uint8Array(12).fill(1);
    const ciphertext = gcm(KEY, nonce).encrypt(new TextEncoder().encode("hello"));
    const tampered = Uint8Array.from(ciphertext);
    tampered[0] ^= 0xff;

    expect(() => gcm(KEY, nonce).decrypt(tampered)).toThrow();
  });
});

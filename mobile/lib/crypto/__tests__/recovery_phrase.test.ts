import * as Crypto from "expo-crypto";
import {
  generatePhrase,
  deriveRecoveryKey,
  normalizePhrase,
  validatePhrase,
} from "../recovery_phrase";
import { BIP39_WORDLIST } from "../wordlist";

// Known-answer BIP-39 test vector: 16 zero bytes of entropy encode to this
// exact phrase (published in the BIP-39 reference test vectors). Using a
// vector from the spec, rather than a phrase this suite invents, is itself
// evidence the checksum math here matches the standard.
const ZERO_ENTROPY_PHRASE = [
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "about",
];

// All twelve words are real BIP-39 entries (so a validator that only checks
// list membership would accept this), but changing word 0 from "abandon" to
// "ability" invalidates the checksum word (index 11) still encodes for the
// old entropy. This is the fixture that proves the checksum is wired.
const WRONG_COMBINATION_PHRASE = [
  "ability",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "about",
];

// A configuration this fast would indicate the KDF was accidentally left at
// trivial parameters (t=1, m=8 KiB derives in single-digit milliseconds
// under this same Jest environment — see recovery_phrase.ts's parameter
// comment for the benchmark). The real parameters measure ~1.2-1.6s here,
// so this floor has wide margin below the real value and wide margin above
// a trivially-configured one.
const TRIVIAL_KDF_FLOOR_MS = 300;

// An upper bound so a future change can't silently restore something like
// the 55-80 SECOND-per-derivation configuration this task tried before
// retuning — that isn't a slow test, it's an unusable recovery flow.
//
// RAISED from 5s to 20s on 2026-08-14. This assertion measures WALL CLOCK, so
// it is really measuring the machine as much as the KDF: under a full-suite run
// with parallel workers competing for CPU it began failing at ~1.4s of real
// work, and it fails on any slow CI box for the same reason. A ceiling that
// flags a busy laptop is a ceiling that gets deleted the third time it cries
// wolf, and then the 55-second regression it exists to catch ships unnoticed.
//
// 20s still catches that regression by a factor of three while leaving room for
// a loaded machine. The floor is the sharper half of this test anyway: a
// trivially-configured KDF returns in microseconds, and no amount of load makes
// a real one that fast.
const MAX_REASONABLE_DERIVATION_MS = 20_000;

describe("BIP39_WORDLIST", () => {
  it("has exactly 2048 unique entries", () => {
    expect(BIP39_WORDLIST.length).toBe(2048);
    expect(new Set(BIP39_WORDLIST).size).toBe(2048);
  });

  it("starts with abandon and ends with zoo", () => {
    expect(BIP39_WORDLIST[0]).toBe("abandon");
    expect(BIP39_WORDLIST[BIP39_WORDLIST.length - 1]).toBe("zoo");
  });
});

describe("generatePhrase", () => {
  it("returns 12 words, all drawn from the BIP-39 list", async () => {
    const phrase = await generatePhrase();
    expect(phrase).toHaveLength(12);
    for (const word of phrase) {
      expect(BIP39_WORDLIST).toContain(word);
    }
  });

  it("produces a phrase that passes its own checksum", async () => {
    const phrase = await generatePhrase();
    expect(validatePhrase(phrase)).toEqual({ ok: true, badIndexes: [] });
  });

  it("does not repeat across many draws", async () => {
    const draws = await Promise.all(
      Array.from({ length: 50 }, () => generatePhrase()),
    );
    const serialized = draws.map((words) => words.join(" "));
    expect(new Set(serialized).size).toBe(serialized.length);
  });
});

// These two are whitebox on purpose. No assertion on generatePhrase's OUTPUT
// can ever prove its randomness came from a CSPRNG rather than a fast,
// insecure PRNG — Math.random is non-deterministic across calls too, so
// "does not repeat across many draws" above passes against either. The
// property that actually matters — that the bytes' PROVENANCE is the secure
// source, never Math.random — is only observable by asserting on the call
// itself.
describe("generatePhrase randomness provenance", () => {
  it("draws its entropy from expo-crypto's getRandomBytesAsync", async () => {
    const spy = jest.spyOn(Crypto, "getRandomBytesAsync");
    try {
      await generatePhrase();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("never falls back to Math.random", async () => {
    const spy = jest.spyOn(Math, "random");
    try {
      await generatePhrase();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("validatePhrase", () => {
  it("accepts a well-formed phrase", () => {
    expect(validatePhrase(ZERO_ENTROPY_PHRASE)).toEqual({
      ok: true,
      badIndexes: [],
    });
  });

  it("rejects 12 valid-list words in a combination that fails the checksum", () => {
    // Every word here is a real BIP-39 entry — a validator that only checks
    // list membership, and never recomputes the checksum, would pass this.
    for (const word of WRONG_COMBINATION_PHRASE) {
      expect(BIP39_WORDLIST).toContain(word);
    }

    const result = validatePhrase(WRONG_COMBINATION_PHRASE);
    expect(result.ok).toBe(false);
    expect(result.badIndexes).toEqual([]);
  });

  it("reports the exact indexes of words that are not in the list", () => {
    const phrase = [
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "notaword",
      "abandon",
      "abandon",
      "abandon",
      "alsofake",
      "abandon",
      "about",
    ];

    const result = validatePhrase(phrase);
    expect(result.ok).toBe(false);
    expect(result.badIndexes).toEqual([5, 9]);
  });
});

describe("normalizePhrase", () => {
  it("trims, lowercases, and collapses whitespace the way a human pastes it", () => {
    const pasted =
      "  Abandon   ABANDON\tabandon\n" +
      "abandon abandon abandon\n" +
      "abandon  abandon abandon abandon abandon About\n";

    expect(normalizePhrase(pasted)).toEqual(ZERO_ENTROPY_PHRASE);
  });
});

describe("deriveRecoveryKey", () => {
  const saltA = new Uint8Array(16).fill(1);
  const saltB = new Uint8Array(16).fill(2);

  it("derives 32 bytes, identically for the same phrase and salt", async () => {
    const keyOne = await deriveRecoveryKey(ZERO_ENTROPY_PHRASE, saltA);
    const keyTwo = await deriveRecoveryKey(ZERO_ENTROPY_PHRASE, saltA);

    expect(keyOne.length).toBe(32);
    expect(Buffer.from(keyOne)).toEqual(Buffer.from(keyTwo));
  }, 10000);

  it("derives a different key for a different salt", async () => {
    const keyOne = await deriveRecoveryKey(ZERO_ENTROPY_PHRASE, saltA);
    const keyTwo = await deriveRecoveryKey(ZERO_ENTROPY_PHRASE, saltB);

    expect(Buffer.from(keyOne)).not.toEqual(Buffer.from(keyTwo));
  }, 10000);

  it("derives a completely different key when one word changes", async () => {
    const keyOne = await deriveRecoveryKey(ZERO_ENTROPY_PHRASE, saltA);
    const keyTwo = await deriveRecoveryKey(WRONG_COMBINATION_PHRASE, saltA);

    expect(Buffer.from(keyOne)).not.toEqual(Buffer.from(keyTwo));
  }, 10000);

  it("takes longer than a floor that would flag trivial KDF parameters, and less than a ceiling that would flag an unusable one", async () => {
    const start = Date.now();
    await deriveRecoveryKey(ZERO_ENTROPY_PHRASE, saltA);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThan(TRIVIAL_KDF_FLOOR_MS);
    expect(elapsed).toBeLessThan(MAX_REASONABLE_DERIVATION_MS);
    // No per-test timeout override: it would have to exceed the ceiling above,
    // or Jest kills the test before the assertion it exists for can run.
  });
});

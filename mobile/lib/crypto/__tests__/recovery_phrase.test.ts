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
// trivial parameters (t=1, m=8 KiB costs ~31ms of CPU time under this same
// Jest environment — see recovery_phrase.ts's parameter comment for the
// wall-clock benchmark). The real parameters cost roughly 2.6-4.1s of CPU
// time here (see the comment on MAX_REASONABLE_DERIVATION_MS below), so this
// floor has wide margin below the real value and wide margin above a
// trivially-configured one.
const TRIVIAL_KDF_FLOOR_MS = 300;

// An upper bound so a future change can't silently restore something like
// the 55-80 SECOND-per-derivation configuration this task tried before
// retuning (m=19456 instead of 2048) — that isn't a slow test, it's an
// unusable recovery flow.
//
// MEASURES CPU TIME, NOT WALL CLOCK (changed 2026-08-16; was raised 5s->20s
// on 2026-08-14 as a stopgap on the wall-clock version, which is why the
// name says "reasonable" rather than "cpu"). The wall-clock version was
// flaky by design, not by bad luck: under a full 144-suite parallel `jest
// --ci` run, the OS scheduler starves this worker of timeslices, and
// Date.now() counts that starvation as if it were KDF work. Observed
// directly: one run measured 20058ms against the then-20000ms ceiling and
// failed by 58ms; a run seconds later on the same machine, same code,
// finished in ~1.5s. The test was measuring how busy the laptop was, not
// whether the parameters are sane.
//
// process.cpuUsage() only counts CPU time this process actually consumed
// (user + system), not time spent waiting to be scheduled. Verified by
// reproduction: deriving under a deliberately CPU-saturated machine (16
// busy processes pinned across all 16 cores) moved wall-clock from ~4.2-6.0s
// to ~8.9s for the identical call, while CPU time for that same call stayed
// in a 2.6-4.1s band throughout — CPU time did not track the contention at
// all. That is the metric this guard actually wants: the KDF's own cost,
// not the scheduler's mood.
//
// 10000ms is calibrated against direct measurement of both ends, taken with
// this exact call path in this Jest environment: real params (t=2, m=2048)
// cost 2.6-4.1s of CPU time across five separate measurements (idle and
// contended); the exact historical regression this comment describes (t=2,
// m=19456) cost 32078ms of CPU time under the identical harness. 10s sits
// with >2.4x margin above the highest real figure observed and >3x margin
// below the regression figure, so it stays sensitive to a genuine parameter
// mistake without caring how many other Jest workers are running.
const MAX_REASONABLE_DERIVATION_MS = 10_000;

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
    // CPU time, not wall-clock — see the comment on MAX_REASONABLE_DERIVATION_MS
    // above for why. process.cpuUsage(prior) returns a delta since `prior`.
    const cpuStart = process.cpuUsage();
    await deriveRecoveryKey(ZERO_ENTROPY_PHRASE, saltA);
    const cpuElapsed = process.cpuUsage(cpuStart);
    const cpuElapsedMs = (cpuElapsed.user + cpuElapsed.system) / 1000;

    expect(cpuElapsedMs).toBeGreaterThan(TRIVIAL_KDF_FLOOR_MS);
    expect(cpuElapsedMs).toBeLessThan(MAX_REASONABLE_DERIVATION_MS);
    // No per-test timeout override: the global 30s testTimeout (package.json's
    // jest.testTimeout) is still a wall-clock backstop against a genuine hang
    // — a derivation that never resolves fails that way, well before this
    // assertion would ever get to run.
  });
});

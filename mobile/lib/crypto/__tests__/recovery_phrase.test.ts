import * as Crypto from "expo-crypto";
import {
  ARGON2ID_PARAMS,
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

// THE TIMING FLOOR IS GONE, ON PURPOSE (2026-09-18). It required a derivation
// to burn more than 300ms of CPU, on the reasoning that trivial parameters
// (t=1, m=8 KiB) cost ~31ms while the shipped ones cost 2.6-4.1s here. The
// margin looked enormous and the assertion still failed on master at `4ee2ac4`,
// measuring under 300ms — an order of magnitude below the floor, which means
// the measurement was wrong rather than the KDF weak. "Nobody left the KDF at
// trivial parameters" is a claim about four numbers, so it is now asserted
// against `ARGON2ID_PARAMS` directly; see "refuses trivial KDF parameters"
// below. The CEILING survives, because it is robust in the direction a floor
// is not.

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

  // THE FLOOR IS ASSERTED AGAINST THE PARAMETERS, NOT AGAINST A CLOCK.
  //
  // It used to measure CPU time and require more than TRIVIAL_KDF_FLOOR_MS of
  // it. That failed on master at `4ee2ac4` on a GitHub runner, having measured
  // under 300ms for a derivation this suite's own comments put at 2.6-4.1s —
  // an order of magnitude out, which is not "the KDF got faster" but
  // `process.cpuUsage()` failing to attribute the work. The wall-clock version
  // before it was replaced for the same class of reason (see
  // MAX_REASONABLE_DERIVATION_MS's comment); moving from wall-clock to CPU time
  // narrowed the flakiness without removing it, because both are measurements
  // of the machine rather than of the configuration.
  //
  // What the floor was ever FOR is "nobody left the KDF at trivial parameters",
  // and that is a statement about four numbers. `ARGON2ID_PARAMS` is the frozen
  // record `deriveRecoveryKey` actually reads — its own doc calls that export
  // load-bearing precisely so it cannot drift from what derivation does — so
  // asserting it is both deterministic and strictly stronger than timing:
  // timing catches a weakened KDF probabilistically and only on a machine slow
  // enough to notice, while this catches it always.
  it("refuses trivial KDF parameters", () => {
    // t=1, m=8 KiB is the accidental-default shape the old floor existed to
    // catch. Each bound is well below the shipped value and well above a
    // trivial one, so retuning within sane ranges does not trip it.
    expect(ARGON2ID_PARAMS.t).toBeGreaterThanOrEqual(2);
    expect(ARGON2ID_PARAMS.m_kib).toBeGreaterThanOrEqual(1024);
    expect(ARGON2ID_PARAMS.p).toBeGreaterThanOrEqual(1);
    // A 256-bit key, matching the DEK width. A shorter one would be a weaker
    // key regardless of how long it took to derive.
    expect(ARGON2ID_PARAMS.dk_len).toBe(32);
  });

  it("takes less than a ceiling that would flag an unusable configuration", async () => {
    // THE CEILING STAYS ON THE CLOCK, and that asymmetry is deliberate. It
    // guards against the 55-80 SECOND-per-derivation configuration this task
    // tried before retuning, and a ceiling is robust in the direction a floor
    // is not: a configuration that unusable blows any reasonable bound on any
    // machine, while a floor fails whenever the machine is merely fast or the
    // measurement is merely wrong. CPU time, not wall-clock — see the comment
    // on MAX_REASONABLE_DERIVATION_MS above for why.
    const cpuStart = process.cpuUsage();
    await deriveRecoveryKey(ZERO_ENTROPY_PHRASE, saltA);
    const cpuElapsed = process.cpuUsage(cpuStart);
    const cpuElapsedMs = (cpuElapsed.user + cpuElapsed.system) / 1000;

    expect(cpuElapsedMs).toBeLessThan(MAX_REASONABLE_DERIVATION_MS);
    // No per-test timeout override: the global 30s testTimeout (package.json's
    // jest.testTimeout) is still a wall-clock backstop against a genuine hang
    // — a derivation that never resolves fails that way, well before this
    // assertion would ever get to run.
  });
});

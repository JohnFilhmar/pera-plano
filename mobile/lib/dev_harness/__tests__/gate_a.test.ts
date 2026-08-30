// What this file can and cannot prove.
//
// It CANNOT prove anything about Gate A. Gate A is a question about how long
// Hermes takes on an A54, and Jest is neither Hermes nor an A54 — the whole
// reason lib/dev_harness/gate_a.ts exists is that this environment cannot
// answer it. No assertion here looks at a duration.
//
// What it DOES pin is everything about the harness that could quietly make an
// on-device number wrong or unsafe, and that a device session would not
// notice: that the parameters reported are the ones derivation actually uses
// rather than a transcribed copy, that the real derivation ran (a 32-byte key
// came back), that the emitted result carries no phrase material, and that the
// wrong-engine warning fires when the engine is wrong — which, in here, it
// always is.
//
// EVERY run_gate_a CALL COSTS A REAL ARGON2ID DERIVATION, on the order of ten
// seconds under this preset. The read-only assertions therefore share one
// measured result from `beforeAll` instead of each paying for their own; only
// the two tests that need a different shape (a warm-up, a progress sequence)
// run their own.

import {
  DEV_HARNESS_SENTINEL,
  HARNESS_LOG_PREFIX,
  type GateAResult,
  classify_band,
  emit_result,
  median,
  run_gate_a,
} from "@/lib/dev_harness/gate_a";
import { ARGON2ID_PARAMS } from "@/lib/crypto/recovery_phrase";

describe("median", () => {
  it("takes the middle of an odd-length sample", () => {
    expect(median([3263, 3351, 3526])).toBe(3351);
  });

  it("averages the two middles of an even-length sample", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("does not reorder the caller's array", () => {
    // The report prints runs in the order they happened, so a median that
    // sorted in place would silently rewrite the run log.
    const runs = [3506, 3207, 3351];
    median(runs);
    expect(runs).toEqual([3506, 3207, 3351]);
  });
});

describe("classify_band", () => {
  it("names the side of the 500ms-1s design target the median landed on", () => {
    expect(classify_band(400)).toBe("under_target");
    expect(classify_band(500)).toBe("in_target");
    expect(classify_band(1000)).toBe("in_target");
    expect(classify_band(3351)).toBe("over_target");
  });
});

describe("run_gate_a", () => {
  let result: GateAResult;

  // One derivation, no warm-up: these are correctness checks, and Argon2id at
  // these parameters costs seconds under Jest.
  beforeAll(async () => {
    result = await run_gate_a({ runs: 1, warmups: 0 });
  });

  it("reports the parameters derivation actually uses, not a copy of them", () => {
    expect(result.params).toEqual({
      t: ARGON2ID_PARAMS.t,
      m_kib: ARGON2ID_PARAMS.m_kib,
      p: ARGON2ID_PARAMS.p,
      dk_len: ARGON2ID_PARAMS.dk_len,
    });
  });

  it("actually derives a key of the width the DEK expects", () => {
    // If the harness ever stopped calling the real deriveRecoveryKey — stubbed
    // it, reimplemented it, timed a no-op — this is what would notice.
    expect(result.derived_key_bytes).toBe(32);
    expect(result.derived_key_bytes).toBe(ARGON2ID_PARAMS.dk_len);
    expect(result.runs_ms).toHaveLength(1);
    expect(result.warmup_ms).toHaveLength(0);
  });

  it("warns that the engine is not Hermes, because here it is not", () => {
    expect(result.engine.hermes).toBe(false);
    expect(result.warnings.join(" ")).toContain("Not running on Hermes");
  });

  it("puts no phrase material into the emitted result", () => {
    const serialized = JSON.stringify(result);

    // The harness times the public all-zero-entropy BIP-39 test vector, so
    // even a leak here would expose nothing. The assertion is a shape rule,
    // not a secrecy claim about this particular input: the result object is
    // designed to be pasted into a document and read aloud, so no word, salt
    // or key may ever appear in it. If someone adds one for debugging, this
    // goes red before it reaches a device.
    //
    // MATCHED AS A PHRASE, NOT AS WORDS. The first version of this test
    // asserted the absence of the bare strings "about" and "salt" and went red
    // on its own explanatory prose — "a question about the shipping JS
    // engine". That is the same shape as the leak this whole harness is
    // careful about, running the other way: a substring filter over English
    // does not mean what it looks like it means. A two-word run of wordlist
    // entries is phrase-shaped; a single common English word is not.
    expect(serialized).not.toContain("abandon abandon");
    expect(serialized).not.toContain("abandon about");
    expect(Object.keys(result)).toEqual(
      expect.not.arrayContaining(["phrase", "words", "salt", "key", "derived_key"]),
    );
  });

  it("separates warm-up runs from timed runs", async () => {
    const warmed = await run_gate_a({ runs: 1, warmups: 1 });

    expect(warmed.warmup_ms).toHaveLength(1);
    expect(warmed.runs_ms).toHaveLength(1);
  });

  it("reports progress for every derivation, warm-up included", async () => {
    const seen: Array<[number, number]> = [];
    await run_gate_a({ runs: 2, warmups: 0, on_progress: (d, t) => seen.push([d, t]) });

    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("emit_result", () => {
  it("writes exactly one prefixed, parseable line for the adb runner to scrape", async () => {
    const result = await run_gate_a({ runs: 1, warmups: 0 });
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    emit_result(result);

    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    expect(line.startsWith(`${HARNESS_LOG_PREFIX} `)).toBe(true);
    // run_gate_a.ps1 splits on the first space and JSON.parses the rest. If
    // the line ever stops being one line of valid JSON, the runner reports a
    // missing result rather than a wrong one, which is harder to diagnose on a
    // device than here.
    expect(line.indexOf("\n")).toBe(-1);
    const parsed = JSON.parse(line.slice(HARNESS_LOG_PREFIX.length + 1));
    expect(parsed.gate).toBe("A");
    expect(parsed.sentinel).toBe(DEV_HARNESS_SENTINEL);

    log.mockRestore();
  });
});

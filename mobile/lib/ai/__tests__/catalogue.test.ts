// mobile/lib/ai/__tests__/catalogue.test.ts
//
// THE IDS ARE PINNED AS LITERALS ON PURPOSE. An id is the on-disk filename
// (spec §2.3). Renaming one orphans a downloaded model on every device that
// already has it — the file stays, costs the user their storage, and is never
// read again. A test that derived the ids from the catalogue would bless the
// rename.
//
// THE COUNT IS A LITERAL for the same reason in the other direction: the tier
// list was CUT TO TWO on 2026-08-31 (owner's decision, recorded in
// `docs/superpowers/specs/2026-08-31-model-hosting-decision.md` §5). A silent
// third entry - a tier reinstated without its digest computed and verified -
// fails here.
import { MODEL_CATALOGUE } from "../catalogue";

const EXPECTED_IDS = ["qwen3-0.6b-q4", "qwen3-1.7b-q4"];

const EXPECTED_DIGESTS: Record<string, string> = {
  "qwen3-0.6b-q4": "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a",
  "qwen3-1.7b-q4": "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897",
};

const EXPECTED_BYTES: Record<string, number> = {
  "qwen3-0.6b-q4": 396705472,
  "qwen3-1.7b-q4": 1107409472,
};

describe("the catalogue is pinned data", () => {
  test("ships exactly two tiers", () => {
    expect(MODEL_CATALOGUE).toHaveLength(2);
  });

  test("with exactly these ids, in this order", () => {
    expect(MODEL_CATALOGUE.map((spec) => spec.id)).toEqual(EXPECTED_IDS);
  });

  test("ids are unique", () => {
    expect(new Set(MODEL_CATALOGUE.map((spec) => spec.id)).size).toBe(MODEL_CATALOGUE.length);
  });

  test.each(EXPECTED_IDS)("%s carries its verified digest", (id) => {
    const spec = MODEL_CATALOGUE.find((entry) => entry.id === id);
    expect(spec?.sha256).toBe(EXPECTED_DIGESTS[id]);
  });

  test.each(EXPECTED_IDS)("%s carries its thrice-read byte count", (id) => {
    const spec = MODEL_CATALOGUE.find((entry) => entry.id === id);
    expect(spec?.bytes).toBe(EXPECTED_BYTES[id]);
  });

  test.each(EXPECTED_IDS)("%s names its release month as its knowledge limit", (id) => {
    // Qwen publishes no training cutoff for Qwen3. The release month is the
    // fact that can be checked: Hugging Face's API lists both repos as created
    // on 2025-04-27. Assistant levels spec §5.3.
    const spec = MODEL_CATALOGUE.find((entry) => entry.id === id);
    expect(spec?.knowledgeLimit).toBe("April 2025");
  });
});

describe("every entry", () => {
  test.each(MODEL_CATALOGUE.map((spec) => [spec.id, spec] as const))("%s", (_id, spec) => {
    expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(spec.url.startsWith("https:")).toBe(true);
    expect(spec.license.length).toBeGreaterThan(0);
    expect(spec.displayName.length).toBeGreaterThan(0);
    expect(spec.params.length).toBeGreaterThan(0);
    expect(spec.quant.length).toBeGreaterThan(0);
    expect(spec.contextTokens).toBeGreaterThan(0);
  });

  test.each(MODEL_CATALOGUE.map((spec) => [spec.id, spec] as const))(
    "%s pins an immutable revision, never resolve/main",
    (_id, spec) => {
      // A bare `main` URL is rejected outright: the file behind it can change
      // without the digest changing here, which turns verification into a
      // permanent failure for every user on the day upstream re-uploads.
      expect(spec.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
      expect(spec.url).not.toContain("/resolve/main/");
    },
  );

  test.each(MODEL_CATALOGUE.map((spec) => [spec.id, spec] as const))(
    "%s reserves more RAM than the file weighs",
    (_id, spec) => {
      // "A catalogue where they are equal is a catalogue that offers a model
      // with no room to run." Necessary, and nowhere near sufficient — the
      // spike measured 3.3x the file at tier 1 and 2.4x at tier 2.
      expect(spec.minRamBytes).toBeGreaterThan(spec.bytes);
    },
  );

  test.each(MODEL_CATALOGUE.map((spec) => [spec.id, spec] as const))(
    "%s suppresses thinking, because both surviving tiers are hybrid Qwen3",
    (_id, spec) => {
      // Spec §2.1: tiers 1-3 are hybrid-thinking and emit <think>…</think>
      // unless suppressed; the 2507 instruct refreshes do not think and must
      // NOT be told to suppress. Both 2507 tiers were cut, so every surviving
      // entry is hybrid. Reinstating a 2507 tier means this assertion has to
      // become per-entry data again.
      expect(spec.suppressThinking).toBe(true);
    },
  );
});

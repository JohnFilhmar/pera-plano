// lib/ingest/__tests__/parser.test.ts — the template engine and its scoring.
//
// ILLUSTRATIVE ONLY. Every notification-shaped string and every template
// pattern below is INVENTED for planning (docs/03-ingest-pipeline.md §11.4).
// No real GCash, Maya or bank notification has been captured for this project.
// Nothing here should be read as a confirmed provider format.
//
// WHAT THESE TESTS ARE GUARDING. This stage decides the amount, the direction
// and — through `confidence` — whether the whole thing is committed silently or
// shown to a human first. The scoring is not decoration: at ≥ 0.90 the number
// lands in the ledger without anyone looking at it (spec §9.2). So a penalty
// applied where it should not be floods the Review Queue and trains the user to
// tap through it, and a penalty skipped where it belongs auto-commits a number
// nobody checked. Both failures are silent, which is why every penalty below is
// pinned to an exact expected score rather than a range.
//
// Two tests exist purely as regressions against readings of the plan that were
// corrected on 2026-08-10 — see "the 2026-08-10 corrections" section.
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { parseCapture } from "@/lib/ingest/parser";
import seedJson from "@/assets/parser_rules/seed.json";

import type { ProviderRuleset, ProviderTemplate } from "@/lib/ingest/ruleset_types";
import type { RawCapture } from "@/types/domain";

/**
 * The shipped catalogue, read straight from the JSON.
 *
 * Read directly rather than through `seed_rules.ts`, which imports the ruleset
 * repository and would drag the database into a suite testing a pure function.
 * Same approach as `source_router.test.ts`.
 */
const SEED_PROVIDERS = (seedJson as unknown as { providers: ProviderRuleset[] }).providers;

function seedProvider(providerKey: string): ProviderRuleset {
  const provider = SEED_PROVIDERS.find((candidate) => candidate.providerKey === providerKey);
  if (provider === undefined) throw new Error(`seed.json has no provider "${providerKey}"`);
  return provider;
}

/** Pinned clock. This stage reads no clock, and this pair proves it. */
const POSTED_AT = 1_754_100_000_000;
/** Deliberately different from `postedAt` — spec §10 turns on which one is used. */
const CAPTURED_AT = POSTED_AT + 4_000;

const TEST_PACKAGE = "com.example.test.wallet";

/** An amount span, as the illustrative templates below all write it. */
const AMOUNT = String.raw`(?<amount>₱[\d,]+\.\d{2})`;
const BALANCE = String.raw`(?<balance>₱[\d,]+\.\d{2})`;

function makeCapture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: "capture-1",
    packageName: TEST_PACKAGE,
    title: null,
    text: null,
    subText: null,
    bigText: null,
    postedAt: POSTED_AT,
    capturedAt: CAPTURED_AT,
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<ProviderTemplate> = {}): ProviderTemplate {
  return {
    id: "template_1",
    match: `You paid ${AMOUNT}`,
    confidence: 1,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<ProviderRuleset> = {}): ProviderRuleset {
  return {
    providerKey: "test_provider",
    packageNames: [TEST_PACKAGE],
    version: 1,
    channel: "push",
    templates: [makeTemplate()],
    ...overrides,
  };
}

/** The four penalties this stage owns, read from the same place the parser reads them. */
const { weakDirection, amountAmbiguity, merchantMissing, smsChannel } = DEFAULT_TUNABLES.penalties;

// ---------------------------------------------------------------------------
// Binding — the fields, and which value lands in which one
// ---------------------------------------------------------------------------

test("an exact template match scores 1.00 and binds every field", () => {
  // EVERY FIELD GETS A DISTINCT VALUE. A fixture that reused one string across
  // merchant and counterparty would pass just as happily with the two swapped,
  // and a swap here puts the payee's name in the merchant column of the ledger
  // for every transaction the app records.
  const provider = makeProvider({
    providerKey: "distinct_fields_provider",
    templates: [
      makeTemplate({
        match:
          `You paid ${AMOUNT} to (?<merchant>[^,]+), for (?<counterparty>[^,]+), ` +
          `ref (?<ref>[A-Z0-9]+), balance ${BALANCE}`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(
    makeCapture({
      // ILLUSTRATIVE
      text: "You paid ₱1,234.56 to Kanto Freestyle, for Maria Santos, ref ABC123XYZ, balance ₱7,890.12",
    }),
    [provider],
  );

  expect(parsed).toEqual({
    providerKey: "distinct_fields_provider",
    amount: 123456,
    direction: "out",
    merchant: "Kanto Freestyle",
    counterparty: "Maria Santos",
    referenceNo: "ABC123XYZ",
    balanceAfter: 789012,
    occurredAt: POSTED_AT,
    confidence: 1,
  });
});

test("the provider key comes from the provider that owned the matching template", () => {
  const first = makeProvider({
    providerKey: "provider_without_a_match",
    templates: [makeTemplate({ match: "this text never appears" })],
  });
  const second = makeProvider({
    providerKey: "provider_that_matched",
    templates: [makeTemplate({ direction: "out" })],
  });

  const parsed = parseCapture(makeCapture({ text: "You paid ₱10.00" }), [first, second]); // ILLUSTRATIVE

  expect(parsed?.providerKey).toBe("provider_that_matched");
});

test("an unparseable amount is refused rather than committed, and the next template gets its turn", () => {
  // `parseAmountToCentavos` returns null for a three-digit fraction, so the
  // first template here has matched text it cannot turn into money. Falling
  // through is the conservative move: the alternative is either a wrong number
  // or a lost transaction, and a later template may read the same text properly.
  const provider = makeProvider({
    templates: [
      makeTemplate({ id: "greedy", match: String.raw`Charged (?<amount>₱[\d.,]+)`, direction: "out" }),
      makeTemplate({
        id: "precise",
        match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(
    // ILLUSTRATIVE
    makeCapture({ text: "Charged ₱1.2345 today. You paid ₱99.00 to Kanto Freestyle" }),
    [provider],
  );

  expect(parsed?.amount).toBe(9900);
  expect(parsed?.merchant).toBe("Kanto Freestyle");
});

test("a balance that will not parse leaves balanceAfter undefined without failing the parse", () => {
  // Spec §5 rule 5: balance-after "never overrides the ledger". It is a
  // reconciliation cross-check, so an unreadable one costs nothing and must
  // never take a good amount down with it.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        match: `You paid ${AMOUNT}, balance (?<balance>[^ ]+)`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(
    makeCapture({ text: "You paid ₱10.00, balance unavailable" }), // ILLUSTRATIVE
    [provider],
  );

  expect(parsed?.amount).toBe(1000);
  expect(parsed?.balanceAfter).toBeUndefined();
});

test("a merchant of only whitespace becomes undefined rather than an empty string", () => {
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: `You paid ${AMOUNT} to (?<merchant>[^|]*)\\|`, direction: "out" }),
    ],
  });

  const parsed = parseCapture(makeCapture({ text: "You paid ₱10.00 to    |" }), [provider]); // ILLUSTRATIVE

  expect(parsed?.merchant).toBeUndefined();
  expect(parsed).not.toHaveProperty("merchant", "");
});

test("surrounding whitespace is trimmed off the bound text fields", () => {
  const provider = makeProvider({
    templates: [
      makeTemplate({
        match: `You paid ${AMOUNT} to (?<merchant>[^|]+)\\|(?<counterparty>[^|]+)\\|`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(
    makeCapture({ text: "You paid ₱10.00 to   Kanto Freestyle  | Maria Santos |" }), // ILLUSTRATIVE
    [provider],
  );

  expect(parsed?.merchant).toBe("Kanto Freestyle");
  expect(parsed?.counterparty).toBe("Maria Santos");
});

test("a walletHint group is bound so one provider can be split across two wallets", () => {
  // `ParsedEvent.walletHint` is contract §5, and the Normalizer (plan Task 5
  // rule 1) resolves GCash-main vs GSave with it. The parser is the only stage
  // that reads notification text, so if it does not bind the field, nothing can.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        match: `You paid ${AMOUNT} from your (?<walletHint>GSave|Main) wallet`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(
    makeCapture({ text: "You paid ₱10.00 from your GSave wallet" }), // ILLUSTRATIVE
    [provider],
  );

  expect(parsed?.walletHint).toBe("GSave");
});

// ---------------------------------------------------------------------------
// Base score
// ---------------------------------------------------------------------------

test("a partial match scores 0.70", () => {
  // The template declares its own base (contract §5: "1.00 exact / 0.70
  // partial"). The fuzzy SMS templates in the shipped seed are the real
  // instances of this.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        confidence: 0.7,
        match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(makeCapture({ text: "You paid ₱10.00 to Kanto Freestyle" }), [
    provider,
  ]); // ILLUSTRATIVE

  expect(parsed?.confidence).toBe(0.7);
});

test("a base score outside 0..1 is clamped rather than trusted", () => {
  // Templates arrive as remote data (spec §11.1). A bad row must not be able to
  // push a score above 1.00 and make the auto-commit threshold meaningless.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        confidence: 1.5,
        match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(makeCapture({ text: "You paid ₱10.00 to Kanto Freestyle" }), [
    provider,
  ]); // ILLUSTRATIVE

  expect(parsed?.confidence).toBe(1);
});

// ---------------------------------------------------------------------------
// The 2026-08-10 corrections — regressions against readings that broke the math
// ---------------------------------------------------------------------------

test("an exact match with an unbound optional group still scores 1.00", () => {
  // REGRESSION FOR THE AUTO-COMMIT BUG (plan rule 3, corrected 2026-08-10).
  //
  // The base is 1.00 because the REGEX MATCHED, not because every declared
  // group happened to bind. Under the pre-correction reading — "base 1.00 when
  // every group the template declares is bound" — a template with an optional
  // `ref` group that no notification carried would score 0.70, and since Task 2
  // rule 4 REQUIRES merchant and ref groups to be optional, nearly every real
  // notification would land below the 0.90 auto-commit threshold forever.
  // Spec §5 rule 2's "fully matches" is a property of the match, not of which
  // optional groups fired.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        match: `You paid ${AMOUNT} to (?<merchant>[^.,]+)(?:, ref (?<ref>[A-Z0-9]+))?`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(makeCapture({ text: "You paid ₱10.00 to Kanto Freestyle" }), [
    provider,
  ]); // ILLUSTRATIVE

  expect(parsed?.referenceNo).toBeUndefined();
  expect(parsed?.confidence).toBe(1);
});

test("an unbound optional merchant group costs 0.05 and no more", () => {
  // The same correction, at its sharpest. The missing merchant is charged ONCE,
  // as the −0.05 penalty that represents the lost information. Charging it
  // twice — once as a base downgrade to 0.70 and again as the penalty — is what
  // produced the 0.65 that made auto-commit unreachable.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        match: `You paid ${AMOUNT}(?: to (?<merchant>[^.,]+))?`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(makeCapture({ text: "You paid ₱10.00" }), [provider]); // ILLUSTRATIVE

  expect(parsed?.merchant).toBeUndefined();
  expect(parsed?.confidence).toBe(1 - merchantMissing);
  expect(parsed?.confidence).toBe(0.95);
  expect(parsed?.confidence).not.toBe(0.65);
});

test("direction from a bound capture group carries no weak-cue penalty", () => {
  // REGRESSION FOR RULE 4'S CORRECTED MIDDLE PATH (2026-08-10). Contract §5
  // lists `direction` among the named groups, so a template that declares one
  // has stated the direction explicitly — that is an explicit cue, not a guess
  // scraped from surrounding prose, and it must not be penalised.
  //
  // Paired deliberately with the next test: identical text, identical keyword
  // present, and the ONLY difference is whether the template declares the group.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        match: `You (?<direction>sent|received) ${AMOUNT} to (?<merchant>[^.]+)`,
      }),
    ],
  });

  const parsed = parseCapture(makeCapture({ text: "You sent ₱1,500.00 to Kanto Freestyle" }), [
    provider,
  ]); // ILLUSTRATIVE

  expect(parsed?.direction).toBe("out");
  expect(parsed?.confidence).toBe(1);
});

test("direction inferred from a keyword carries the 0.15 penalty", () => {
  // The same notification as above, read by a template that declares no
  // direction at all. Now the direction really is inferred from prose, and
  // spec §9.1 charges −0.15 for it.
  const provider = makeProvider({
    templates: [makeTemplate({ match: `You sent ${AMOUNT} to (?<merchant>[^.]+)` })],
  });

  const parsed = parseCapture(makeCapture({ text: "You sent ₱1,500.00 to Kanto Freestyle" }), [
    provider,
  ]); // ILLUSTRATIVE

  expect(parsed?.direction).toBe("out");
  expect(parsed?.confidence).toBe(1 - weakDirection);
  expect(parsed?.confidence).toBe(0.85);
});

test("an explicit template direction field carries no penalty either", () => {
  // The first of rule 4's three paths, pinned so a future refactor cannot
  // start charging the weak-cue penalty against the seeded providers — all 32
  // shipped templates use this path.
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: `You sent ${AMOUNT} to (?<merchant>[^.]+)`, direction: "out" }),
    ],
  });

  const parsed = parseCapture(makeCapture({ text: "You sent ₱1,500.00 to Kanto Freestyle" }), [
    provider,
  ]); // ILLUSTRATIVE

  expect(parsed?.confidence).toBe(1);
});

test("the template direction field beats a bound group that disagrees", () => {
  // Rule 4's precedence, made observable. A template that fixes its direction
  // has been authored deliberately; a group is a pattern that may have caught
  // the wrong word.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        match: `You (?<direction>sent|received) ${AMOUNT} to (?<merchant>[^.]+)`,
        direction: "in",
      }),
    ],
  });

  const parsed = parseCapture(makeCapture({ text: "You sent ₱1,500.00 to Kanto Freestyle" }), [
    provider,
  ]); // ILLUSTRATIVE

  expect(parsed?.direction).toBe("in");
});

test("a direction group may name the direction literally", () => {
  const provider = makeProvider({
    templates: [makeTemplate({ match: `(?<direction>in|out): ${AMOUNT}` })],
  });

  expect(parseCapture(makeCapture({ text: "in: ₱10.00" }), [provider])?.direction).toBe("in"); // ILLUSTRATIVE
  expect(parseCapture(makeCapture({ text: "out: ₱10.00" }), [provider])?.direction).toBe("out"); // ILLUSTRATIVE
});

test("a direction group that captured an unrecognised word falls back to keyword inference", () => {
  // The group bound, but not to anything meaning a direction. Falling back to
  // the prose — with the weak-cue penalty, because that is what this now is —
  // beats discarding a parse that the surrounding text explains perfectly well.
  const provider = makeProvider({
    templates: [makeTemplate({ match: String.raw`(?<direction>\w+) sent ${AMOUNT}` })],
  });

  const parsed = parseCapture(makeCapture({ text: "Processed sent ₱10.00" }), [provider]); // ILLUSTRATIVE

  expect(parsed?.direction).toBe("out");
  // 1.00 − 0.15 − 0.05, written as the literal it should be.
  //
  // Note the expression `1 - weakDirection - merchantMissing` evaluates to
  // 0.7999999999999999 in IEEE-754 — the same dust the parser's fixed-point
  // scoring exists to keep away from the 0.60 and 0.90 routing thresholds. The
  // implementation is right and the naive expression is wrong, so the literal
  // is what gets asserted.
  expect(parsed?.confidence).toBe(0.8);
});

test("keyword inference reads the earliest cue in the text, not a favoured set", () => {
  // "sent" (out) appears before "refund" (in). An implementation that scanned
  // one keyword set to exhaustion before the other would answer "in" here and
  // book a spend as income.
  const provider = makeProvider({
    templates: [makeTemplate({ match: `${AMOUNT}` })],
  });

  const parsed = parseCapture(
    makeCapture({ text: "You sent ₱500.00 as a refund to Kanto Freestyle" }), // ILLUSTRATIVE
    [provider],
  );

  expect(parsed?.direction).toBe("out");
});

test("every keyword the plan lists resolves to its documented direction", () => {
  const provider = makeProvider({ templates: [makeTemplate({ match: `${AMOUNT}` })] });
  const cases: ReadonlyArray<readonly [string, "in" | "out"]> = [
    ["You sent ₱10.00", "out"],
    ["You paid ₱10.00", "out"],
    ["Your purchase of ₱10.00", "out"],
    ["Debit of ₱10.00", "out"],
    ["Withdrawal of ₱10.00", "out"],
    ["You received ₱10.00", "in"],
    ["Your account was credited ₱10.00", "in"],
    ["A refund of ₱10.00", "in"],
    ["Cash-in of ₱10.00", "in"],
    ["Deposit of ₱10.00", "in"],
  ];

  for (const [text, direction] of cases) {
    // ILLUSTRATIVE
    expect(parseCapture(makeCapture({ text }), [provider])?.direction).toBe(direction);
  }
});

// ---------------------------------------------------------------------------
// The amount-ambiguity penalty (spec §9.1, §4 failure-mode table)
// ---------------------------------------------------------------------------

test("two amount tokens with no balance group carry the 0.30 penalty", () => {
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`, direction: "out" }),
    ],
  });

  const parsed = parseCapture(
    // ILLUSTRATIVE — the second token is a balance the template does not read.
    makeCapture({ text: "You paid ₱250.00 to Kanto Freestyle. Your balance is ₱7,890.12" }),
    [provider],
  );

  expect(parsed?.confidence).toBe(1 - amountAmbiguity);
  expect(parsed?.confidence).toBe(0.7);
});

test("two amount tokens with a bound balance group carry no ambiguity penalty", () => {
  // THE CLAUSE THAT KEEPS THE PIPELINE USABLE. A balance group has ABSORBED the
  // second token — the parser knows exactly what that number is, so nothing is
  // ambiguous. Without this, every provider helpful enough to report a running
  // balance would be penalised into the Review Queue on every transaction.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        match: `You paid ${AMOUNT} to (?<merchant>[^.]+)\\. Your balance is ${BALANCE}`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(
    // ILLUSTRATIVE — identical text to the previous test.
    makeCapture({ text: "You paid ₱250.00 to Kanto Freestyle. Your balance is ₱7,890.12" }),
    [provider],
  );

  expect(parsed?.balanceAfter).toBe(789012);
  expect(parsed?.confidence).toBe(1);
});

test("a third amount token the template never bound is still ambiguous", () => {
  // Spec §9.1 charges the penalty when "multiple amount-like tokens SURVIVED
  // parsing". Amount and balance are both bound here, so both are accounted
  // for — but the fee token is not, and it is exactly the kind of number a
  // looser template could have bound as the amount.
  //
  // The plan's parenthetical ("did not bind an explicit balance group to absorb
  // the second token") assumes there are exactly two tokens; the spec's wording
  // is the general rule, and per Global Constraints the spec wins.
  const provider = makeProvider({
    templates: [
      makeTemplate({
        match: `You paid ${AMOUNT} to (?<merchant>[^.]+)\\. Fee ₱[\\d,.]+\\. Balance ${BALANCE}`,
        direction: "out",
      }),
    ],
  });

  const parsed = parseCapture(
    // ILLUSTRATIVE
    makeCapture({ text: "You paid ₱250.00 to Kanto Freestyle. Fee ₱15.00. Balance ₱7,890.12" }),
    [provider],
  );

  expect(parsed?.confidence).toBe(1 - amountAmbiguity);
});

test("a single amount token is never ambiguous", () => {
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`, direction: "out" }),
    ],
  });

  const parsed = parseCapture(makeCapture({ text: "You paid ₱250.00 to Kanto Freestyle" }), [
    provider,
  ]); // ILLUSTRATIVE

  expect(parsed?.confidence).toBe(1);
});

// ---------------------------------------------------------------------------
// The remaining penalties
// ---------------------------------------------------------------------------

test("a missing merchant carries 0.05", () => {
  const provider = makeProvider({
    templates: [makeTemplate({ match: `You sent ${AMOUNT}`, direction: "out" })],
  });

  const parsed = parseCapture(makeCapture({ text: "You sent ₱500.00" }), [provider]); // ILLUSTRATIVE

  expect(parsed?.merchant).toBeUndefined();
  expect(parsed?.confidence).toBe(1 - merchantMissing);
  expect(parsed?.confidence).toBe(0.95);
});

test("an SMS-channel provider carries 0.05", () => {
  // Spec §9.1: SMS-via-Messages formats are less structured than push. The
  // penalty attaches to the PROVIDER's channel, not to anything in the text.
  const provider = makeProvider({
    providerKey: "sms_provider",
    channel: "sms",
    senderIds: ["BPI"],
    templates: [
      makeTemplate({ match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`, direction: "out" }),
    ],
  });

  const parsed = parseCapture(
    makeCapture({ text: "BPI: You paid ₱250.00 to Kanto Freestyle" }), // ILLUSTRATIVE
    [provider],
  );

  expect(parsed?.confidence).toBe(1 - smsChannel);
  expect(parsed?.confidence).toBe(0.95);
});

test("penalties stack, subtracted from the base as one sum", () => {
  // Every penalty this stage owns, on one parse: a 0.70 partial base, direction
  // scraped from a keyword, an unabsorbed second token, no merchant, SMS
  // channel. 0.70 − 0.15 − 0.30 − 0.05 − 0.05 = 0.15.
  //
  // The exact equality also pins the arithmetic itself: computed naively in
  // floating point this expression yields 0.14999999999999997, and dust like
  // that sitting next to the 0.60 and 0.90 thresholds decides Review Queue
  // routing on rounding error.
  const provider = makeProvider({
    channel: "sms",
    senderIds: ["BPI"],
    templates: [makeTemplate({ confidence: 0.7, match: `Debited ${AMOUNT}` })],
  });

  const parsed = parseCapture(
    makeCapture({ text: "Debited ₱500.00 today. Balance ₱1,000.00" }), // ILLUSTRATIVE
    [provider],
  );

  expect(parsed?.direction).toBe("out");
  expect(parsed?.confidence).toBe(0.15);
});

test("stacked penalties clamp at 0 and never go negative", () => {
  // Clamping at the FLOOR. A negative confidence would compare below every
  // threshold correctly by luck, then read as nonsense anywhere it is shown or
  // averaged. The contract says `confidence: 0..1`.
  const provider = makeProvider({
    channel: "sms",
    senderIds: ["BPI"],
    templates: [makeTemplate({ confidence: 0.1, match: `Debited ${AMOUNT}` })],
  });

  const parsed = parseCapture(
    makeCapture({ text: "Debited ₱500.00 today. Balance ₱1,000.00" }), // ILLUSTRATIVE
    [provider],
  );

  expect(parsed?.confidence).toBe(0);
  expect(parsed?.confidence).toBeGreaterThanOrEqual(0);
});

test("confidence stays within 0..1 across every fixture shape", () => {
  const provider = makeProvider({
    channel: "sms",
    senderIds: ["BPI"],
    templates: [
      makeTemplate({ id: "a", confidence: 1, match: `Debited ${AMOUNT}` }),
      makeTemplate({ id: "b", confidence: 0.7, match: `Withdrawal of ${AMOUNT}` }),
    ],
  });

  for (const text of [
    "Debited ₱500.00 today. Balance ₱1,000.00",
    "Withdrawal of ₱500.00",
    "Debited ₱1.00",
  ]) {
    // ILLUSTRATIVE
    const confidence = parseCapture(makeCapture({ text }), [provider])?.confidence ?? -1;
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  }
});

// ---------------------------------------------------------------------------
// Field search order (plan rule 2, spec §5)
// ---------------------------------------------------------------------------

test("bigText is preferred over text", () => {
  // DIFFERENT AMOUNTS IN EACH FIELD. Same-value fixtures prove nothing here —
  // they pass whichever field the parser actually read. The expanded text is
  // the complete one (spec §4 failure modes: "Truncated collapsed-notification
  // text → fields cut off"), so reading `text` first can bind an amount that
  // was chopped mid-number.
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`, direction: "out" }),
    ],
  });

  const parsed = parseCapture(
    makeCapture({
      title: "Test Wallet",
      text: "You paid ₱250.00 to Kanto Freestyle", // ILLUSTRATIVE — the collapsed form
      bigText: "You paid ₱1,500.00 to Kanto Freestyle", // ILLUSTRATIVE — the expanded form
    }),
    [provider],
  );

  expect(parsed?.amount).toBe(150000);
});

test("text is read when bigText is absent, and title when both are", () => {
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`, direction: "out" }),
    ],
  });

  const fromText = parseCapture(
    makeCapture({ text: "You paid ₱250.00 to Kanto Freestyle" }), // ILLUSTRATIVE
    [provider],
  );
  const fromTitle = parseCapture(
    makeCapture({ title: "You paid ₱99.00 to Kanto Freestyle" }), // ILLUSTRATIVE
    [provider],
  );

  expect(fromText?.amount).toBe(25000);
  expect(fromTitle?.amount).toBe(9900);
});

test("an empty bigText does not shadow a populated text", () => {
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`, direction: "out" }),
    ],
  });

  const parsed = parseCapture(
    makeCapture({ bigText: "   ", text: "You paid ₱250.00 to Kanto Freestyle" }), // ILLUSTRATIVE
    [provider],
  );

  expect(parsed?.amount).toBe(25000);
});

test("subText is never searched", () => {
  // The router does not inspect it either. It carries an app-supplied label —
  // an account nickname or folder name — not the notification body, and the two
  // stages must agree on which fields exist or a capture the router kept on the
  // strength of one becomes an unparseable Review Queue item forever.
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: `You paid ${AMOUNT} to (?<merchant>[^.]+)`, direction: "out" }),
    ],
  });

  const parsed = parseCapture(
    makeCapture({ subText: "You paid ₱250.00 to Kanto Freestyle" }), // ILLUSTRATIVE
    [provider],
  );

  expect(parsed).toBeNull();
});

// ---------------------------------------------------------------------------
// Ordering (plan rule 5, spec §4 rule 2)
// ---------------------------------------------------------------------------

test("templates are tried in array order and the first match wins", () => {
  const provider = makeProvider({
    templates: [
      makeTemplate({ id: "first", match: `You paid ${AMOUNT}`, direction: "out", confidence: 1 }),
      makeTemplate({ id: "second", match: `You paid ${AMOUNT}`, direction: "in", confidence: 0.7 }),
    ],
  });

  // Both orderings, because a single assertion would also pass for an
  // implementation that picked the highest confidence, or the last match.
  expect(parseCapture(makeCapture({ text: "You paid ₱10.00" }), [provider])).toMatchObject({
    direction: "out",
  }); // ILLUSTRATIVE

  const reversed = makeProvider({ templates: [...provider.templates].reverse() });
  expect(parseCapture(makeCapture({ text: "You paid ₱10.00" }), [reversed])).toMatchObject({
    direction: "in",
  }); // ILLUSTRATIVE
});

test("providers are tried in array order too", () => {
  const first = makeProvider({
    providerKey: "first_provider",
    templates: [makeTemplate({ direction: "out" })],
  });
  const second = makeProvider({
    providerKey: "second_provider",
    templates: [makeTemplate({ direction: "out" })],
  });

  expect(parseCapture(makeCapture({ text: "You paid ₱10.00" }), [first, second])?.providerKey).toBe(
    "first_provider",
  ); // ILLUSTRATIVE
  expect(parseCapture(makeCapture({ text: "You paid ₱10.00" }), [second, first])?.providerKey).toBe(
    "second_provider",
  ); // ILLUSTRATIVE
});

// ---------------------------------------------------------------------------
// Refusals and robustness
// ---------------------------------------------------------------------------

test("a template with an invalid regex is skipped, not thrown", () => {
  // Templates are REMOTE DATA (spec §11.1). One malformed row from the server
  // must cost that one template, not the whole pipeline — an exception here
  // takes down every parse on the device until an app update, which is exactly
  // the fragility that shipping rules as data was meant to remove (§4 rule 4).
  const provider = makeProvider({
    templates: [
      makeTemplate({ id: "unclosed_group", match: "([unclosed" }),
      makeTemplate({ id: "bad_group_name", match: "(?<1invalid>x)" }),
      makeTemplate({ id: "usable", match: `You paid ${AMOUNT}`, direction: "out" }),
    ],
  });

  let parsed: ReturnType<typeof parseCapture> = null;
  expect(() => {
    parsed = parseCapture(makeCapture({ text: "You paid ₱10.00" }), [provider]); // ILLUSTRATIVE
  }).not.toThrow();
  expect(parsed).toMatchObject({ amount: 1000, direction: "out" });
});

test("a provider whose every template is malformed returns null instead of throwing", () => {
  const provider = makeProvider({ templates: [makeTemplate({ match: "([unclosed" })] });

  expect(() => parseCapture(makeCapture({ text: "You paid ₱10.00" }), [provider])).not.toThrow(); // ILLUSTRATIVE
  expect(parseCapture(makeCapture({ text: "You paid ₱10.00" }), [provider])).toBeNull(); // ILLUSTRATIVE
});

test("no matching template returns null", () => {
  // Spec §4 rule 3: a known provider's marketing, OTPs and balance inquiries
  // are classified and dropped. Returning null is how this stage says so.
  const provider = makeProvider();

  expect(parseCapture(makeCapture({ text: "Get 5% cashback this weekend!" }), [provider])).toBeNull();
});

test("an empty rules array returns null and never throws", () => {
  expect(parseCapture(makeCapture({ text: "You paid ₱10.00" }), [])).toBeNull(); // ILLUSTRATIVE
});

test("a capture with no text at all returns null", () => {
  // Spec §2 failure modes: image-only and custom-layout notifications arrive
  // with every text field null.
  expect(parseCapture(makeCapture(), [makeProvider()])).toBeNull();
});

test("text with no resolvable direction returns null", () => {
  // A transaction without a direction is unusable — it cannot be added to or
  // subtracted from anything. Guessing would be worse than refusing: the raw
  // capture still reaches the Review Queue, where a human supplies it.
  const provider = makeProvider({
    templates: [makeTemplate({ match: `Transaction of ${AMOUNT} completed` })],
  });

  expect(parseCapture(makeCapture({ text: "Transaction of ₱500.00 completed" }), [provider])) // ILLUSTRATIVE
    .toBeNull();
});

test("a template that matches but binds no amount yields no event", () => {
  const provider = makeProvider({
    templates: [makeTemplate({ match: "You paid something", direction: "out" })],
  });

  expect(parseCapture(makeCapture({ text: "You paid something" }), [provider])).toBeNull(); // ILLUSTRATIVE
});

// ---------------------------------------------------------------------------
// The shipped seed — the arithmetic that has to work end to end
// ---------------------------------------------------------------------------

test("a shipped GCash send template clears the 0.90 auto-commit threshold", () => {
  // THE CORRECTED RULE 3, MEASURED AGAINST REAL RULESET DATA rather than a
  // fixture built to agree with it.
  //
  // Task 2 rule 4 REQUIRES the seed's merchant and reference groups to be
  // optional, and a GCash send binds `counterparty` but no `merchant`. So the
  // score is 1.00 − 0.05 = 0.95 → auto-commit. Under the pre-correction reading
  // the unbound optional groups would have dragged the base to 0.70, giving
  // 0.65, and EVERY notification on the device would have queued for review
  // forever — the ≥95% auto-commit target (§11.4) unreachable by construction.
  //
  // This test fails the moment that reading creeps back in, and it fails using
  // the templates that actually ship.
  const parsed = parseCapture(
    makeCapture({
      packageName: "com.globe.gcash.android",
      title: "GCash",
      text: "You have sent ₱1,500.00 to JUAN D. Ref. No. 90210123.", // ILLUSTRATIVE
    }),
    [seedProvider("gcash")],
  );

  expect(parsed).toMatchObject({
    providerKey: "gcash",
    amount: 150000,
    direction: "out",
    counterparty: "JUAN D",
    referenceNo: "90210123",
    confidence: 0.95,
  });
  expect(parsed?.confidence).toBeGreaterThanOrEqual(DEFAULT_TUNABLES.autoCommitThreshold);
});

test("a shipped SMS template lands in the prefilled review band, not below it", () => {
  // The seed's two SMS templates declare `confidence: 0.7` because bank SMS
  // wording really is fuzzier than push. 0.70 − 0.05 (SMS channel) = 0.65,
  // which is inside the 0.60–0.89 prefilled band (§9.2): one tap to confirm,
  // with every field already filled in. Dropping below 0.60 would demote it to
  // "needs details" and make the user retype the amount.
  const parsed = parseCapture(
    makeCapture({
      packageName: "com.google.android.apps.messaging",
      title: "BPI",
      // ILLUSTRATIVE
      text: "BPI: Your account ending 1234 was debited PHP 2,000.00 on 08/02 via ATM.",
    }),
    [seedProvider("sms_relay")],
  );

  expect(parsed?.amount).toBe(200000);
  expect(parsed?.direction).toBe("out");
  expect(parsed?.confidence).toBe(0.65);
  expect(parsed?.confidence).toBeGreaterThanOrEqual(DEFAULT_TUNABLES.prefilledThreshold);
  expect(parsed?.confidence).toBeLessThan(DEFAULT_TUNABLES.autoCommitThreshold);
});

test("a shipped template binds the balance and is not charged for ambiguity", () => {
  // The seed templates all declare an optional balance group precisely so the
  // running balance providers like to quote does not read as a second
  // candidate amount. With it bound, the score stays at auto-commit.
  const parsed = parseCapture(
    makeCapture({
      packageName: "com.globe.gcash.android",
      title: "GCash",
      // ILLUSTRATIVE
      text: "You have received ₱2,000.00 from MARIA S. Your new balance is ₱7,890.12.",
    }),
    [seedProvider("gcash")],
  );

  expect(parsed?.amount).toBe(200000);
  expect(parsed?.direction).toBe("in");
  expect(parsed?.balanceAfter).toBe(789012);
  expect(parsed?.confidence).toBe(0.95);
});

test("marketing from a known provider matches no shipped template", () => {
  // Spec §4 rule 3. The router deliberately admits a wallet app's whole
  // notification volume on the package alone, which makes rejecting the
  // marketing this stage's job.
  const parsed = parseCapture(
    makeCapture({
      packageName: "com.globe.gcash.android",
      title: "GCash",
      text: "Get 5% cashback this weekend!", // ILLUSTRATIVE
    }),
    [seedProvider("gcash")],
  );

  expect(parsed).toBeNull();
});

test("every shipped template compiles, so none is silently skipped", () => {
  // The invalid-regex guard above is a safety net for bad SERVER data. If it
  // ever catches something we shipped ourselves, that provider is dead on
  // arrival and no other test would say so.
  for (const provider of SEED_PROVIDERS) {
    for (const template of provider.templates) {
      expect(() => new RegExp(template.match)).not.toThrow();
    }
  }
});

// ---------------------------------------------------------------------------
// Timestamps (spec §10, plan rule 6)
// ---------------------------------------------------------------------------

test("occurredAt is the notification's postedAt, never the capture time", () => {
  // Spec §10: the notification's OWN timestamp decides which Limit period the
  // money lands in. A capture drained from the native buffer after a device
  // reboot can be hours or days younger than the notification, and using
  // `capturedAt` would silently push spending into the wrong month.
  const provider = makeProvider({ templates: [makeTemplate({ direction: "out" })] });

  const parsed = parseCapture(makeCapture({ text: "You paid ₱10.00" }), [provider]); // ILLUSTRATIVE

  expect(parsed?.occurredAt).toBe(POSTED_AT);
  expect(parsed?.occurredAt).not.toBe(CAPTURED_AT);
});

test("parseCapture is pure — the same inputs give the same result, and inputs are not mutated", () => {
  // Plan Global Constraints: no bare `Date.now()`, no I/O, no clock in any
  // stage. Frozen inputs would throw on any write in strict mode.
  const provider = Object.freeze(
    makeProvider({ templates: [Object.freeze(makeTemplate({ direction: "out" }))] }),
  );
  const capture = Object.freeze(makeCapture({ text: "You paid ₱10.00" })); // ILLUSTRATIVE

  const first = parseCapture(capture, [provider]);
  const second = parseCapture(capture, [provider]);

  expect(first).toEqual(second);
  expect(capture.postedAt).toBe(POSTED_AT);
});

// ---------------------------------------------------------------------------
// Remote tunability of the §9.1 penalties.
//
// Spec §9.1's penalty table "ships as tunable ruleset data (§11)", so a server
// bundle must be able to move these four penalties without an app release.
// Until 2026-08-10 contract §5 pinned parseCapture to (capture, rules) with no
// tunables argument, so it could only ever read DEFAULT_TUNABLES -- and the
// failure was silent, because the Normalizer's and DedupeGate's tunables WERE
// passed in and moved normally. Remote tuning looked wired up and was not, for
// precisely the four penalties that decide auto-commit.
// ---------------------------------------------------------------------------

test("a retuned penalty from the ruleset actually moves the score", () => {
  // ILLUSTRATIVE. This fixture also trips merchantMissing (the template binds
  // no merchant group), so the absolute score is 1.00 − smsChannel − merchant.
  // That is exactly why the assertion below is on the DELTA rather than on a
  // hardcoded total: the delta isolates the one penalty under test and does not
  // silently encode which others happen to apply.
  const provider = makeProvider({
    channel: "sms",
    templates: [makeTemplate({ direction: "out", confidence: 1 })],
  });
  const capture = makeCapture({ text: "You paid ₱10.00 to STORE" }); // ILLUSTRATIVE

  const atDefault = parseCapture(capture, [provider], DEFAULT_TUNABLES);

  // The same capture, same template — only the ruleset's smsChannel penalty
  // changed, from its default to 0.40.
  const retunedTo = 0.4;
  const retuned = parseCapture(capture, [provider], {
    ...DEFAULT_TUNABLES,
    penalties: { ...DEFAULT_TUNABLES.penalties, smsChannel: retunedTo },
  });

  // A parser that ignored the argument and read DEFAULT_TUNABLES would return
  // the same number twice, making this delta 0.
  const delta = atDefault!.confidence - retuned!.confidence;
  expect(delta).toBeCloseTo(retunedTo - DEFAULT_TUNABLES.penalties.smsChannel, 5);
  expect(delta).toBeGreaterThan(0);
});

test("parseCapture defaults to DEFAULT_TUNABLES when none is supplied", () => {
  // The third argument is optional so existing call sites keep working; this
  // pins that the default is the shipped table rather than an empty object,
  // which would make every penalty NaN.
  const provider = makeProvider({
    channel: "sms",
    templates: [makeTemplate({ direction: "out", confidence: 1 })],
  });
  const capture = makeCapture({ text: "You paid ₱10.00 to STORE" }); // ILLUSTRATIVE

  const implicit = parseCapture(capture, [provider]);
  const explicit = parseCapture(capture, [provider], DEFAULT_TUNABLES);

  expect(implicit!.confidence).toBe(explicit!.confidence);
  expect(Number.isNaN(implicit!.confidence)).toBe(false);
});

// ---------------------------------------------------------------------------
// Non-PHP currency is a HARD route to the Review Queue (spec §5 rule 1, §9.2).
//
// The failure this guards is silent and expensive: parseAmountToCentavos
// accepts a BARE "50.00", so a template capturing only the digits out of
// "USD 50.00" would return 5000 centavos and book fifty dollars as fifty pesos
// at full confidence. The plan assigned this check to the Normalizer, which
// cannot do it -- a ParsedEvent carries no text, so the currency marker is
// already gone by then.
// ---------------------------------------------------------------------------

test("a foreign currency amount is refused rather than booked as pesos", () => {
  // ILLUSTRATIVE. The template binds only the digits, which is exactly how a
  // real template written for "₱50.00" would behave on a USD notification.
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: String.raw`(?<amount>[\d,]+\.\d{2})`, direction: "out", confidence: 1 }),
    ],
  });

  const foreign = parseCapture(makeCapture({ text: "You paid USD 50.00 to STORE" }), [provider]);
  expect(foreign).toBeNull();

  // The identical notification in pesos still parses — proving the guard keys
  // on the currency marker and has not simply broken this template.
  const pesos = parseCapture(makeCapture({ text: "You paid PHP 50.00 to STORE" }), [provider]);
  expect(pesos).not.toBeNull();
  expect(pesos!.amount).toBe(5000);
});

test("a foreign currency mentioned away from the amount does not block the parse", () => {
  // ILLUSTRATIVE. Scoping the check to a window around the amount is what keeps
  // an unrelated aside from sending a genuine peso transaction to the queue.
  const provider = makeProvider({
    templates: [
      makeTemplate({ match: String.raw`paid (?<amount>[\d,]+\.\d{2})`, direction: "out", confidence: 1 }),
    ],
  });

  const event = parseCapture(
    makeCapture({ text: "You paid 50.00 to STORE. USD rates updated today." }),
    [provider],
  );

  expect(event).not.toBeNull();
  expect(event!.amount).toBe(5000);
});

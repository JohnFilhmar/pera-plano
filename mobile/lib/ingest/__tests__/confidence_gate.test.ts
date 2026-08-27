// lib/ingest/__tests__/confidence_gate.test.ts — Stage 7, the stage that decides.
//
// ILLUSTRATIVE ONLY. Every wallet id and transaction id below is INVENTED for
// planning (docs/03-ingest-pipeline.md §11.4).
//
// WHAT THESE TESTS ARE GUARDING. This is the single point in the pipeline where
// a number becomes "write this to the ledger without asking" or "ask a human".
// Every earlier stage exists to feed it, and every one of its two failure
// directions is named in spec §9.2: too lax and wrong data is committed
// silently and corrupts totals; too strict and the Review Queue floods until
// the user stops reading it. So the assertions below are almost all about a
// boundary, and each is written so that moving the boundary one step in EITHER
// direction fails something.
//
// THE BANDS ARE PINNED AT THEIR EDGES, INCLUSIVELY. Spec §9.2 reads "≥ 0.90"
// and "0.60 – 0.89": a score landing exactly on either edge belongs to the
// HIGHER band. A `>` written where the spec says `≥` passes every test taken a
// comfortable distance from the edge and fails only on real scores.
//
// THE DUST TESTS ARE WRITTEN AS ARITHMETIC, NOT AS LITERALS. `0.95 - 0.05` is
// `0.8999999999999999` in IEEE-754, and the categorizer's 0.05 learned penalty
// is subtracted by the ORCHESTRATOR — downstream of every scaling this file's
// subject controls. Written as the literal `0.9` the test cannot catch a gate
// that compares raw floats, so the expressions below are left unevaluated on
// purpose. Do not "simplify" them. This pipeline has already produced float
// dust twice: `0.70 - 0.05 - 0.05` in the parser and a rejected fee at
// `8176.999999999999` in the transfer detector.
//
// THE SCALE IS PINNED AT TEN-THOUSANDTHS, not hundredths. 0.8999 and 0.5999 sit
// below their thresholds and must stay below them; rounding to two decimals
// would promote both, which is how a remotely retuned penalty finer than the
// spec's two decimals (§11.1) would silently stop working.
//
// ALL THREE THRESHOLDS ARE RETUNED IN THIS FILE, in both directions where it
// applies. §9.2's table ships as ruleset data and `autoCommitThreshold` /
// `prefilledThreshold` are the likeliest in the whole pipeline to be
// recalibrated against the corpus, so a gate that hardcodes `0.90` and `0.60`
// is a gate whose remote tuning knob is a placebo. The third,
// `reviewFloorThreshold` (shipped at `0.5`, the review-floor amendment of
// 2026-08-20), is retuned the same way for the same reason.
import { decideRoute, GATE_REASONS } from "@/lib/ingest/confidence_gate";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";

import type { GateInput } from "@/lib/ingest/confidence_gate";
import type { PipelineTunables } from "@/lib/ingest/ruleset_types";

/** The already-committed row a dedupe or transfer verdict would name. */
const COUNTERPART_TX = "tx_0000000000000001";

/** A resolved wallet. Its presence is what keeps the unmapped-wallet route off. */
const WALLET = "wallet_gcash";

function tunables(overrides: Partial<PipelineTunables> = {}): PipelineTunables {
  return { ...DEFAULT_TUNABLES, ...overrides };
}

/**
 * A capture that has cleared every hard route: recognized provider, pesos, a
 * known wallet, no duplicate, no transfer ambiguity. Only `confidence` decides.
 * Every test below states exactly the one fact it is about.
 */
function clean(overrides: Partial<GateInput> = {}): GateInput {
  return {
    confidence: 1,
    // Everything arriving from `runStages` has an amount by construction (the
    // parser refuses to return a `ParsedEvent` without one); `false` is the
    // unreadable-capture path and every test below states it explicitly.
    hasAmount: true,
    walletId: WALLET,
    dedupe: { kind: "unique" },
    transfer: { kind: "none" },
    routed: "known",
    nonPhpCurrency: false,
    tunables: tunables(),
    ...overrides,
  };
}

/** The `reason` of a decision, or `undefined` when nothing is shown (`auto_commit`, `discard`). */
function reasonOf(decision: ReturnType<typeof decideRoute>): string | undefined {
  return decision.route === "auto_commit" || decision.route === "discard"
    ? undefined
    : decision.reason;
}

// ---------------------------------------------------------------------------
// Score bands (§9.2 rule 1) — the boundaries the whole product turns on
// ---------------------------------------------------------------------------

test("a clean 0.95 auto-commits", () => {
  expect(decideRoute(clean({ confidence: 0.95 }))).toEqual({ route: "auto_commit" });
});

test("exactly 0.90 auto-commits — the band is inclusive at its floor", () => {
  // §9.2 says "≥ 0.90". A `>` here sends every score landing precisely on the
  // shipped threshold to the Review Queue, and 0.90 is not an unusual score:
  // it is a 1.00 exact match carrying one 0.10 wallet-fallback penalty.
  expect(decideRoute(clean({ confidence: 0.9 }))).toEqual({ route: "auto_commit" });
});

test("0.89 routes to the Review Queue prefilled", () => {
  expect(decideRoute(clean({ confidence: 0.89 })).route).toBe("review_prefilled");
});

test("exactly 0.60 routes prefilled — the lower band is inclusive at its floor too", () => {
  expect(decideRoute(clean({ confidence: 0.6 })).route).toBe("review_prefilled");
});

test("0.59 routes to the Review Queue needing details", () => {
  expect(decideRoute(clean({ confidence: 0.59 })).route).toBe("review_needs_details");
});

test("a review route always carries a non-empty reason, hard route or not", () => {
  // The plan's type demands a `reason` on BOTH review variants, not only on a
  // hard route: a card that says nothing about why it is in the queue is the
  // mystery §9.2 rule 3 exists to prevent, and a plain low score is the most
  // common way to land here.
  const prefilled = reasonOf(decideRoute(clean({ confidence: 0.75 })));
  const needsDetails = reasonOf(decideRoute(clean({ confidence: 0.3 })));

  expect(prefilled).toBeTruthy();
  expect(needsDetails).toBeTruthy();
  expect(prefilled).not.toBe(needsDetails);
});

// ---------------------------------------------------------------------------
// Float dust — the failure this stage was warned about twice already
// ---------------------------------------------------------------------------

test("0.95 minus a 0.05 penalty still auto-commits, computed in floats", () => {
  // 0.8999999999999999. The categorizer's learned-category penalty is applied
  // by the orchestrator, so this exact expression is what reaches the gate.
  // A raw-float `>= 0.90` sends a clean auto-commit to the queue on dust.
  expect(decideRoute(clean({ confidence: 0.95 - 0.05 }))).toEqual({ route: "auto_commit" });
});

test("0.70 minus two 0.05 penalties still routes prefilled, computed in floats", () => {
  // 0.5999999999999999 — the parser's own dust case (a partial match with no
  // merchant, over SMS), landing on the lower band instead of the upper one.
  expect(decideRoute(clean({ confidence: 0.7 - 0.05 - 0.05 })).route).toBe("review_prefilled");
});

test("0.8999 does not auto-commit — the scale is ten-thousandths, not hundredths", () => {
  // Rounding to two decimals promotes this to 0.90 and auto-commits a score the
  // spec puts in the Review Queue. Ten-thousandths keeps a remotely retuned
  // penalty finer than two decimals (§11.1) meaningful.
  expect(decideRoute(clean({ confidence: 0.8999 })).route).toBe("review_prefilled");
});

test("0.5999 needs details — the same scale at the lower band", () => {
  expect(decideRoute(clean({ confidence: 0.5999 })).route).toBe("review_needs_details");
});

test("a confidence that is not a number never auto-commits", () => {
  // NaN loses every comparison, so the fall-through must be the SAFE end of the
  // range. A gate written as "auto-commit unless below the threshold" inverts
  // that and commits an unscored event silently.
  expect(decideRoute(clean({ confidence: Number.NaN })).route).toBe("review_needs_details");
});

// ---------------------------------------------------------------------------
// Both thresholds are ruleset data (§9.2 / §11.1), not literals
// ---------------------------------------------------------------------------

test("a raised autoCommitThreshold stops a score that ships as an auto-commit", () => {
  const strict = clean({ confidence: 0.92, tunables: tunables({ autoCommitThreshold: 0.95 }) });
  expect(decideRoute(strict).route).toBe("review_prefilled");
});

test("a lowered autoCommitThreshold auto-commits a score that ships as a review", () => {
  const lax = clean({ confidence: 0.55, tunables: tunables({ autoCommitThreshold: 0.5 }) });
  expect(decideRoute(lax)).toEqual({ route: "auto_commit" });
});

test("a raised prefilledThreshold pushes a prefilled score down to needs-details", () => {
  const strict = clean({ confidence: 0.7, tunables: tunables({ prefilledThreshold: 0.8 }) });
  expect(decideRoute(strict).route).toBe("review_needs_details");
});

test("a lowered prefilledThreshold lifts a needs-details score up to prefilled", () => {
  const lax = clean({ confidence: 0.4, tunables: tunables({ prefilledThreshold: 0.3 }) });
  expect(decideRoute(lax).route).toBe("review_prefilled");
});

// ---------------------------------------------------------------------------
// Hard routes (§9.2) — a high score never buys past any of these
// ---------------------------------------------------------------------------
//
// Every case below is pinned at 0.99: comfortably inside the auto-commit band,
// so the ONLY thing that can send it to the Review Queue is the hard route
// itself. Each asserts a non-empty `reason` individually, because "the reason
// is populated" is a per-branch property and one shared assertion would pass
// while five branches returned `""`.

test("an unmapped wallet routes to review even at 0.99", () => {
  // The exact failure this route exists for: writing money to a wallet we could
  // not identify. The balance moves on an account the user never named.
  const decision = decideRoute(clean({ confidence: 0.99, walletId: null }));

  expect(decision.route).not.toBe("auto_commit");
  expect(reasonOf(decision)).toBe(GATE_REASONS.unmappedWallet);
  expect(reasonOf(decision)?.length).toBeGreaterThan(0);
});

test("a possible-duplicate routes to review even at 0.99", () => {
  const decision = decideRoute(
    clean({
      confidence: 0.99,
      dedupe: { kind: "possible-duplicate", ofTransactionId: COUNTERPART_TX },
    }),
  );

  expect(decision.route).not.toBe("auto_commit");
  expect(reasonOf(decision)).toBe(GATE_REASONS.possibleDuplicate);
  expect(reasonOf(decision)?.length).toBeGreaterThan(0);
});

test("an ambiguous transfer routes to review even at 0.99", () => {
  const decision = decideRoute(
    clean({
      confidence: 0.99,
      transfer: {
        kind: "ambiguous-transfer",
        counterpartTransactionId: COUNTERPART_TX,
        reason: "multiple_candidates",
      },
    }),
  );

  expect(decision.route).not.toBe("auto_commit");
  expect(reasonOf(decision)).toBe(GATE_REASONS.ambiguousTransfer);
  expect(reasonOf(decision)?.length).toBeGreaterThan(0);
});

test("a fee-tolerant transfer candidate routes to review even at 0.99", () => {
  // §9.2 lists "fee-tolerant transfer candidates (§7 rule 3.2)" as its own hard
  // route. The TransferDetector already delivers them as `ambiguous-transfer`
  // with `reason: "fee_delta"`, so this gate needs no separate flag — but the
  // spec's separately-named route must still be demonstrably covered.
  const decision = decideRoute(
    clean({
      confidence: 0.99,
      transfer: {
        kind: "ambiguous-transfer",
        counterpartTransactionId: COUNTERPART_TX,
        reason: "fee_delta",
      },
    }),
  );

  expect(decision.route).not.toBe("auto_commit");
  expect(reasonOf(decision)?.length).toBeGreaterThan(0);
});

test("an unknown provider routes to review even at 0.99", () => {
  const decision = decideRoute(clean({ confidence: 0.99, routed: "unknown" }));

  expect(decision.route).not.toBe("auto_commit");
  expect(reasonOf(decision)).toBe(GATE_REASONS.unknownProvider);
  expect(reasonOf(decision)?.length).toBeGreaterThan(0);
});

test("a non-PHP amount routes to review even at 0.99", () => {
  const decision = decideRoute(clean({ confidence: 0.99, nonPhpCurrency: true }));

  expect(decision.route).not.toBe("auto_commit");
  expect(reasonOf(decision)).toBe(GATE_REASONS.nonPhpCurrency);
  expect(reasonOf(decision)?.length).toBeGreaterThan(0);
});

test("a one-sided transfer is a hard route even at a high score", () => {
  // Same slot as `ambiguousTransfer` — it is the same question ("is this a
  // transfer?") and answering it changes what the row MEANS, so a 0.99 score
  // must not buy past it either.
  const decision = decideRoute({
    confidence: 0.99,
    hasAmount: true,
    walletId: "w_gcash",
    dedupe: { kind: "unique" },
    transfer: { kind: "one_sided", counterpartWalletId: "w_bpi", signal: "rule" },
    routed: "known",
    nonPhpCurrency: false,
    tunables: tunables(),
  });

  expect(decision).toEqual({
    route: "review_prefilled",
    reason: GATE_REASONS.oneSidedTransfer,
  });
});

test("an auto-linked transfer is NOT a hard route and still auto-commits", () => {
  // The counter-test to the four above: `auto_link` is the TransferDetector
  // saying it is CERTAIN, and §9.2 hard-routes only the ambiguous pairs. A gate
  // that treats every non-`none` verdict as doubt sends every confirmed
  // internal transfer to the queue and makes the detector pointless.
  const decision = decideRoute(
    clean({
      confidence: 0.95,
      transfer: { kind: "auto_link", counterpartTransactionId: COUNTERPART_TX },
    }),
  );

  expect(decision).toEqual({ route: "auto_commit" });
});

// ---------------------------------------------------------------------------
// Verdicts that should never arrive (plan Task 9 rule 4)
// ---------------------------------------------------------------------------

test("a confirmed duplicate is never auto-committed", () => {
  // Rule 4: the orchestrator drops a `duplicate` before this stage, so reaching
  // here at all is a broken invariant. It is hard-routed rather than thrown:
  // throwing inside a background notification handler loses the capture with no
  // trace, which is the one outcome worse than an extra Review Queue card.
  const decision = decideRoute(
    clean({ confidence: 0.99, dedupe: { kind: "duplicate", ofTransactionId: COUNTERPART_TX } }),
  );

  expect(decision.route).not.toBe("auto_commit");
  expect(reasonOf(decision)).toBe(GATE_REASONS.duplicate);
  expect(reasonOf(decision)?.length).toBeGreaterThan(0);
});

test("a capture routed not_financial is never auto-committed", () => {
  // The same broken invariant from the other side: the SourceRouter said this
  // is not money and the orchestrator drops it, so a parsed transaction cannot
  // legitimately carry this routing. Committing it silently would put a
  // notification the router already rejected into the ledger.
  const decision = decideRoute(clean({ confidence: 0.99, routed: "not_financial" }));

  expect(decision.route).not.toBe("auto_commit");
  expect(reasonOf(decision)).toBe(GATE_REASONS.notFinancial);
  expect(reasonOf(decision)?.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Which review band a hard route lands in
// ---------------------------------------------------------------------------

test("a hard route keeps the band its score earned — 0.99 lands prefilled", () => {
  // The hard route decides THAT a human looks; the score decides HOW MUCH of
  // the card is filled in. A 0.99 unmapped-wallet event is one tap away from
  // correct, and dumping the raw capture on the user instead would discard a
  // perfectly good parse.
  expect(decideRoute(clean({ confidence: 0.99, walletId: null })).route).toBe("review_prefilled");
});

test("a hard route on a low score still needs details — 0.30 lands needs-details", () => {
  expect(decideRoute(clean({ confidence: 0.3, walletId: null })).route).toBe(
    "review_needs_details",
  );
});

test("a hard route at exactly 0.60 lands prefilled — the band edge still applies", () => {
  expect(decideRoute(clean({ confidence: 0.6, walletId: null })).route).toBe("review_prefilled");
});

test("a hard route respects a retuned prefilledThreshold", () => {
  const strict = clean({
    confidence: 0.7,
    walletId: null,
    tunables: tunables({ prefilledThreshold: 0.8 }),
  });
  expect(decideRoute(strict).route).toBe("review_needs_details");
});

// ---------------------------------------------------------------------------
// Reason precedence — the card text must be deterministic
// ---------------------------------------------------------------------------
//
// Several hard routes can be true at once, and support cannot work with a card
// whose wording depends on which branch happened to be checked first. The order
// asserted here is: duplicate → possible-duplicate → ambiguous-transfer →
// not_financial → unknown provider → non-PHP → unmapped wallet.

test("every hard-route reason is distinct and non-empty", () => {
  const reasons = Object.values(GATE_REASONS);

  expect(reasons.length).toBeGreaterThan(0);
  for (const reason of reasons) expect(reason.length).toBeGreaterThan(0);
  expect(new Set(reasons).size).toBe(reasons.length);
});

test("a confirmed duplicate outranks every other hard route", () => {
  const decision = decideRoute(
    clean({
      confidence: 0.99,
      dedupe: { kind: "duplicate", ofTransactionId: COUNTERPART_TX },
      transfer: {
        kind: "ambiguous-transfer",
        counterpartTransactionId: COUNTERPART_TX,
        reason: "fee_delta",
      },
      routed: "unknown",
      nonPhpCurrency: true,
      walletId: null,
    }),
  );

  expect(reasonOf(decision)).toBe(GATE_REASONS.duplicate);
});

test("a possible-duplicate outranks transfer, provider, currency and wallet", () => {
  const decision = decideRoute(
    clean({
      confidence: 0.99,
      dedupe: { kind: "possible-duplicate", ofTransactionId: COUNTERPART_TX },
      transfer: {
        kind: "ambiguous-transfer",
        counterpartTransactionId: COUNTERPART_TX,
        reason: "extended_window",
      },
      routed: "unknown",
      nonPhpCurrency: true,
      walletId: null,
    }),
  );

  expect(reasonOf(decision)).toBe(GATE_REASONS.possibleDuplicate);
});

test("an ambiguous transfer outranks provider, currency and wallet", () => {
  const decision = decideRoute(
    clean({
      confidence: 0.99,
      transfer: {
        kind: "ambiguous-transfer",
        counterpartTransactionId: COUNTERPART_TX,
        reason: "multiple_candidates",
      },
      routed: "unknown",
      nonPhpCurrency: true,
      walletId: null,
    }),
  );

  expect(reasonOf(decision)).toBe(GATE_REASONS.ambiguousTransfer);
});

test("a not_financial routing outranks currency and wallet", () => {
  const decision = decideRoute(
    clean({ confidence: 0.99, routed: "not_financial", nonPhpCurrency: true, walletId: null }),
  );

  expect(reasonOf(decision)).toBe(GATE_REASONS.notFinancial);
});

test("an unknown provider outranks currency and wallet", () => {
  const decision = decideRoute(
    clean({ confidence: 0.99, routed: "unknown", nonPhpCurrency: true, walletId: null }),
  );

  expect(reasonOf(decision)).toBe(GATE_REASONS.unknownProvider);
});

test("a non-PHP amount outranks an unmapped wallet", () => {
  const decision = decideRoute(clean({ confidence: 0.99, nonPhpCurrency: true, walletId: null }));

  expect(reasonOf(decision)).toBe(GATE_REASONS.nonPhpCurrency);
});

test("a hard-route reason replaces the plain low-confidence reason", () => {
  // A 0.30 unmapped-wallet event is in the queue for BOTH reasons, and the card
  // must name the one the user can act on rather than the generic one.
  const decision = decideRoute(clean({ confidence: 0.3, walletId: null }));

  expect(decision.route).toBe("review_needs_details");
  expect(reasonOf(decision)).toBe(GATE_REASONS.unmappedWallet);
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test("the gate is a pure function of its arguments", () => {
  const input = clean({ confidence: 0.99, walletId: null, nonPhpCurrency: true });
  const snapshot = JSON.stringify(input);

  expect(decideRoute(input)).toEqual(decideRoute(input));
  expect(JSON.stringify(input)).toBe(snapshot);
});

// ---------------------------------------------------------------------------
// The review floor (§9.2 amendment, 2026-08-20) — an unreadable capture is
// never queued, but a parsed amount is never thrown away on a score alone.
// ---------------------------------------------------------------------------

test("a capture with nothing parsed is discarded, not queued", () => {
  expect(
    decideRoute(clean({ confidence: 0, hasAmount: false, walletId: null })),
  ).toEqual({ route: "discard" });
});

test("exactly at the floor is discarded — the rule is 'higher than 50', not 'at least 50'", () => {
  expect(decideRoute(clean({ confidence: 0.5, hasAmount: false }))).toEqual({
    route: "discard",
  });
  // One step above the floor, the other direction: moving the edge either way
  // fails one of these two.
  expect(decideRoute(clean({ confidence: 0.5001, hasAmount: false })).route).toBe(
    "review_needs_details",
  );
});

test("0.8 minus a 0.2 minus a 0.1 lands exactly on the floor, computed in floats", () => {
  // WRITTEN AS ARITHMETIC, NOT AS A LITERAL — this file's own header rule.
  // `0.8 - 0.2 - 0.1` is `0.5000000000000001` in IEEE-754: a RAW `<=`
  // comparison against `reviewFloorThreshold` (0.5) reads `false` and would
  // wrongly queue this as `review_needs_details`, letting a dust-inflated
  // score slip one hair above the floor. `toScaled` rounds it back to exactly
  // `5000`, which is `<=` the scaled floor, so it must discard.
  expect(
    decideRoute(clean({ confidence: 0.8 - 0.2 - 0.1, hasAmount: false })),
  ).toEqual({ route: "discard" });
});

test("a below-floor capture that DID parse an amount is queued, never discarded", () => {
  // The most important test in this task: the data-safety constraint that
  // outranks the owner's "ignore at or below 50%" rule. Losing a parsed
  // amount is invisible to the user and corrupts totals with no trace.
  expect(decideRoute(clean({ confidence: 0.2, hasAmount: true })).route).toBe(
    "review_needs_details",
  );
});

test("a hard route does not rescue an unreadable capture", () => {
  // The unmappedWallet hard route is live (walletId: null) but there is no
  // candidate transaction to ask a wallet question about, so it must not
  // pull an unreadable capture back into the queue.
  expect(
    decideRoute(clean({ confidence: 0, hasAmount: false, walletId: null })),
  ).toEqual({ route: "discard" });
});

test("the floor comes from the ruleset, not from this file", () => {
  const lax = clean({
    confidence: 0.3,
    hasAmount: false,
    tunables: tunables({ reviewFloorThreshold: 0.2 }),
  });
  expect(decideRoute(lax).route).toBe("review_needs_details");

  const strict = clean({
    confidence: 0.3,
    hasAmount: false,
    tunables: tunables({ reviewFloorThreshold: 0.4 }),
  });
  expect(decideRoute(strict)).toEqual({ route: "discard" });
});

test("a confidence that is not a number is queued, never discarded", () => {
  // NaN must lose the `<=` comparison too, the same NaN property the score
  // bands already rely on. `NaN <= x` is `false` regardless of where the
  // check sits — the safety comes from writing the comparison DIRECTLY
  // rather than as the inverse "discard unless above the floor" (see
  // `scoreBand`'s doc comment) — so a non-number falls through to the safe
  // end instead of being silently discarded.
  expect(
    decideRoute(clean({ confidence: Number.NaN, hasAmount: false })).route,
  ).toBe("review_needs_details");
});

// lib/ingest/__tests__/normalizer.test.ts — wallet resolution and the canonical event.
//
// ILLUSTRATIVE ONLY. Every merchant string, package name and wallet below is
// INVENTED for planning (docs/03-ingest-pipeline.md §11.4). Nothing here should
// be read as a confirmed provider format.
//
// WHAT THESE TESTS ARE GUARDING. This stage decides WHICH ACCOUNT the money
// went into. Every other stage can be wrong in a way the user can see — a bad
// amount looks wrong in the ledger, a bad direction looks wrong in the totals.
// A wrong `walletId` looks completely normal: the transaction is there, the
// amount is right, and two balances are quietly off with nothing on screen to
// explain it. That is why the ambiguous cases below assert `null` — a hard route
// to the Review Queue (spec §9.2) — and never "the first plausible wallet".
//
// The confidence assertions are pinned to exact values rather than ranges for
// the same reason parser.test.ts pins its own: 0.90 is the auto-commit line
// (§9.2), the fallback penalty is 0.10, and an exact-match base is 1.00 — so
// applying the penalty where it does not belong, or applying it twice, moves an
// event across that line silently in either direction.
import { normalizeEvent } from "@/lib/ingest/normalizer";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";

import type { ParsedEvent } from "@/lib/ingest/parser";
import type { PipelineTunables, ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { Wallet, WalletMatcher } from "@/types/domain";

const TEST_PACKAGE = "com.example.test.wallet";
/** A second package on the same provider — real super-apps ship more than one. */
const TEST_PACKAGE_ALT = "com.example.test.wallet.lite";
const OTHER_PACKAGE = "com.example.other.bank";

/** Pinned. This stage reads no clock, and every fixture timestamp being fixed proves it. */
const OCCURRED_AT = 1_754_100_000_000;
const ROW_AT = 1_754_000_000_000;

const { walletFallback } = DEFAULT_TUNABLES.penalties;

function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: "wallet_main",
    name: "Main",
    type: "e-wallet",
    balance: 0,
    currency: "PHP",
    isArchived: false,
    createdAt: ROW_AT,
    updatedAt: ROW_AT,
    ...overrides,
  };
}

function makeMatcher(overrides: Partial<WalletMatcher> = {}): WalletMatcher {
  return {
    id: "matcher_1",
    walletId: "wallet_main",
    packageName: TEST_PACKAGE,
    hint: null,
    createdAt: ROW_AT,
    updatedAt: ROW_AT,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<ProviderRuleset> = {}): ProviderRuleset {
  return {
    providerKey: "test_provider",
    packageNames: [TEST_PACKAGE],
    version: 1,
    channel: "push",
    templates: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    providerKey: "test_provider",
    amount: 50_000,
    direction: "out",
    occurredAt: OCCURRED_AT,
    confidence: 1,
    ...overrides,
  };
}

/** `DEFAULT_TUNABLES` with one penalty moved, to prove the value is read and not inlined. */
function retuned(walletFallbackPenalty: number): PipelineTunables {
  return {
    ...DEFAULT_TUNABLES,
    penalties: { ...DEFAULT_TUNABLES.penalties, walletFallback: walletFallbackPenalty },
  };
}

// ---------------------------------------------------------------------------
// Wallet resolution — explicit matchers (spec §5 rule 4, contract's
// `wallet_matchers(id, wallet_id, package_name, hint, ...)`)
// ---------------------------------------------------------------------------

test("an explicit matcher resolves the wallet and leaves the confidence untouched", () => {
  const wallet = makeWallet({ id: "wallet_gcash" });
  const event = makeEvent({ confidence: 1 });

  const normalized = normalizeEvent(
    event,
    makeProvider(),
    [wallet, makeWallet({ id: "wallet_decoy", name: "Decoy" })],
    [makeMatcher({ walletId: "wallet_gcash" })],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBe("wallet_gcash");
  // THE POINT OF THIS TEST. An explicit matcher is not a fallback — §9.1 charges
  // the 0.10 only when the wallet was GUESSED from "only one Wallet of that
  // type". Charging it here would drop every matcher-resolved exact match from
  // 1.00 to 0.90, sitting it exactly on the auto-commit line, and the next
  // 0.05 penalty from any other stage would push it into the Review Queue.
  expect(normalized.confidence).toBe(1);
});

test("a matcher on the provider's second package name still applies", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider({ packageNames: [TEST_PACKAGE, TEST_PACKAGE_ALT] }),
    [makeWallet({ id: "wallet_gcash" }), makeWallet({ id: "wallet_decoy", name: "Decoy" })],
    [makeMatcher({ packageName: TEST_PACKAGE_ALT, walletId: "wallet_gcash" })],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBe("wallet_gcash");
});

test("a matcher for a package this provider does not own is ignored", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [makeWallet({ id: "wallet_gcash" }), makeWallet({ id: "wallet_bank", name: "Bank" })],
    [makeMatcher({ packageName: OTHER_PACKAGE, walletId: "wallet_bank" })],
    DEFAULT_TUNABLES,
  );

  // The foreign matcher must not claim the event, and with two open wallets the
  // fallback cannot decide either — so this is the Review Queue, not "wallet_bank".
  expect(normalized.walletId).toBeNull();
});

// ---------------------------------------------------------------------------
// Wallet resolution — `walletHint`, the one-provider-two-wallets case
// (spec §5 rule 4: "One provider can map to multiple Wallets")
// ---------------------------------------------------------------------------

test("a walletHint picks the right wallet when one provider maps to two", () => {
  // TWO HINTED MATCHERS ON THE SAME PACKAGE. One matcher plus one fallback would
  // pass even if `hint` were ignored entirely, because there would be nothing to
  // choose between. Both rows here claim the same package, so only reading the
  // hint can separate them.
  const normalized = normalizeEvent(
    makeEvent({ walletHint: "GSave" }),
    makeProvider(),
    [makeWallet({ id: "wallet_gcash" }), makeWallet({ id: "wallet_gsave", type: "savings" })],
    [
      makeMatcher({ id: "matcher_main", walletId: "wallet_gcash", hint: "main" }),
      makeMatcher({ id: "matcher_save", walletId: "wallet_gsave", hint: "gsave" }),
    ],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBe("wallet_gsave");
  expect(normalized.confidence).toBe(1);
});

test("hint matching ignores case and surrounding whitespace", () => {
  const normalized = normalizeEvent(
    makeEvent({ walletHint: "  gSAVE " }),
    makeProvider(),
    [makeWallet({ id: "wallet_gcash" }), makeWallet({ id: "wallet_gsave", type: "savings" })],
    [
      makeMatcher({ id: "matcher_main", walletId: "wallet_gcash", hint: "Main" }),
      makeMatcher({ id: "matcher_save", walletId: "wallet_gsave", hint: "GSave" }),
    ],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBe("wallet_gsave");
});

test("a hint-qualified matcher outranks the provider-wide row", () => {
  const normalized = normalizeEvent(
    makeEvent({ walletHint: "GSave" }),
    makeProvider(),
    [makeWallet({ id: "wallet_gcash" }), makeWallet({ id: "wallet_gsave", type: "savings" })],
    [
      makeMatcher({ id: "matcher_any", walletId: "wallet_gcash", hint: null }),
      makeMatcher({ id: "matcher_save", walletId: "wallet_gsave", hint: "gsave" }),
    ],
    DEFAULT_TUNABLES,
  );

  // Both rows claim the package. The hinted one is the narrower claim and wins;
  // treating them as equals would make this ambiguous and lose a resolvable event.
  expect(normalized.walletId).toBe("wallet_gsave");
});

test("an event with no walletHint falls to the provider-wide row", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [makeWallet({ id: "wallet_gcash" }), makeWallet({ id: "wallet_gsave", type: "savings" })],
    [
      makeMatcher({ id: "matcher_any", walletId: "wallet_gcash", hint: null }),
      makeMatcher({ id: "matcher_save", walletId: "wallet_gsave", hint: "gsave" }),
    ],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBe("wallet_gcash");
  expect(normalized.confidence).toBe(1);
});

test("a hinted matcher whose hint does not fire leaves the fallback in charge", () => {
  // Only a GSave row exists; a plain payment on the same package is not a GSave
  // event, so no matcher CLAIMS it and the ordinary fallback applies.
  const normalized = normalizeEvent(
    makeEvent({ walletHint: "Padala" }),
    makeProvider(),
    [makeWallet({ id: "wallet_gcash" })],
    [makeMatcher({ walletId: "wallet_gsave", hint: "gsave" })],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBe("wallet_gcash");
  expect(normalized.confidence).toBe(1 - walletFallback);
});

test("a blank matcher hint is treated as provider-wide, not as never-matching", () => {
  // `hint TEXT` is nullable and a form writing "" instead of NULL is the likeliest
  // way a row ends up blank. A blank hint carries no discriminating information,
  // which is precisely what an absent hint means.
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [makeWallet({ id: "wallet_gcash" }), makeWallet({ id: "wallet_decoy", name: "Decoy" })],
    [makeMatcher({ walletId: "wallet_gcash", hint: "   " })],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBe("wallet_gcash");
});

// ---------------------------------------------------------------------------
// Wallet resolution — fallback (spec §9.1, "only one Wallet of that type")
// ---------------------------------------------------------------------------

test("a single open wallet resolves via fallback and subtracts the walletFallback penalty", () => {
  const normalized = normalizeEvent(
    makeEvent({ confidence: 1 }),
    makeProvider(),
    [makeWallet({ id: "wallet_only" })],
    [],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBe("wallet_only");
  // Exact, so both failures are caught: skipping the penalty leaves 1.00, and
  // applying it twice leaves 0.80. Read from tunables so a retune moves the test.
  expect(normalized.confidence).toBe(1 - walletFallback);
});

test("the fallback penalty is read from tunables, not hardcoded", () => {
  const normalized = normalizeEvent(
    makeEvent({ confidence: 1 }),
    makeProvider(),
    [makeWallet({ id: "wallet_only" })],
    [],
    retuned(0.25),
  );

  expect(normalized.confidence).toBe(0.75);
});

test("the fallback subtraction introduces no floating-point dust", () => {
  // 0.7 - 0.1 is 0.5999999999999999 in IEEE-754, which is BELOW the 0.60
  // prefilled threshold — a partial-template match resolved by fallback would
  // route to "needs details" instead of "prefilled" on rounding dust alone.
  const normalized = normalizeEvent(
    makeEvent({ confidence: 0.7 }),
    makeProvider(),
    [makeWallet({ id: "wallet_only" })],
    [],
    DEFAULT_TUNABLES,
  );

  expect(normalized.confidence).toBe(0.6);
  expect(normalized.confidence).toBeGreaterThanOrEqual(DEFAULT_TUNABLES.prefilledThreshold);
});

test("the fallback penalty never drives the confidence below zero", () => {
  const normalized = normalizeEvent(
    makeEvent({ confidence: 0.05 }),
    makeProvider(),
    [makeWallet({ id: "wallet_only" })],
    [],
    DEFAULT_TUNABLES,
  );

  expect(normalized.confidence).toBe(0);
});

test("two candidate wallets with no matcher yield walletId null", () => {
  // THE MONEY-ROUTING DECISION. Two open wallets and nothing to choose between
  // them: picking either one books the transaction into an account it may not
  // belong to, and the only visible symptom is two wrong balances. `null` is a
  // hard route to the Review Queue (§9.2), where the user assigns it once.
  const normalized = normalizeEvent(
    makeEvent({ confidence: 1 }),
    makeProvider(),
    [makeWallet({ id: "wallet_a" }), makeWallet({ id: "wallet_b", name: "B" })],
    [],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBeNull();
  // No fallback happened, so no fallback penalty. Docking here would double-count
  // an event that is already routed to a human, and would decide which Review
  // Queue lane it lands in — degrading a perfectly good prefill for nothing.
  expect(normalized.confidence).toBe(1);
});

test("no wallets at all yield walletId null", () => {
  const normalized = normalizeEvent(makeEvent(), makeProvider(), [], [], DEFAULT_TUNABLES);

  expect(normalized.walletId).toBeNull();
  expect(normalized.confidence).toBe(1);
});

// ---------------------------------------------------------------------------
// Archived wallets — never chosen, on either path
// ---------------------------------------------------------------------------

test("an archived wallet is not a fallback candidate", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [makeWallet({ id: "wallet_old", isArchived: true }), makeWallet({ id: "wallet_new", name: "New" })],
    [],
    DEFAULT_TUNABLES,
  );

  // Two wallets, but only one is open — so the fallback is unambiguous.
  expect(normalized.walletId).toBe("wallet_new");
  expect(normalized.confidence).toBe(1 - walletFallback);
});

test("an archived wallet is never chosen even when it is the only one", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [makeWallet({ id: "wallet_old", isArchived: true })],
    [],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBeNull();
});

test("an archived wallet is never chosen as the target of an explicit matcher", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [
      makeWallet({ id: "wallet_gcash", isArchived: true }),
      makeWallet({ id: "wallet_other", name: "Other" }),
    ],
    [makeMatcher({ walletId: "wallet_gcash" })],
    DEFAULT_TUNABLES,
  );

  // NOT `wallet_other`. The matcher is an explicit statement that this provider's
  // money belongs in the archived wallet; when it cannot go there the answer is
  // "ask", never "put it somewhere else". See the module header.
  expect(normalized.walletId).toBeNull();
  expect(normalized.confidence).toBe(1);
});

test("a matcher pointing at a wallet absent from the list yields null, not a fallback", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [makeWallet({ id: "wallet_other", name: "Other" })],
    [makeMatcher({ walletId: "wallet_deleted" })],
    DEFAULT_TUNABLES,
  );

  // A dangling `walletId` handed to the committer would violate the
  // transactions.wallet_id foreign key, so the matcher cannot be honoured — and
  // silently redirecting to `wallet_other` at 0.90 would auto-commit the guess.
  expect(normalized.walletId).toBeNull();
});

test("an unusable matcher target does not stop a sibling matcher from resolving", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [
      makeWallet({ id: "wallet_old", isArchived: true }),
      makeWallet({ id: "wallet_live", name: "Live" }),
    ],
    [
      makeMatcher({ id: "matcher_old", walletId: "wallet_old" }),
      makeMatcher({ id: "matcher_live", walletId: "wallet_live" }),
    ],
    DEFAULT_TUNABLES,
  );

  // Exactly one selectable explicit target remains, so there is nothing to guess.
  expect(normalized.walletId).toBe("wallet_live");
  expect(normalized.confidence).toBe(1);
});

test("two matchers naming different open wallets with no hint to separate them yield null", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [makeWallet({ id: "wallet_a" }), makeWallet({ id: "wallet_b", name: "B" })],
    [
      makeMatcher({ id: "matcher_a", walletId: "wallet_a" }),
      makeMatcher({ id: "matcher_b", walletId: "wallet_b" }),
    ],
    DEFAULT_TUNABLES,
  );

  expect(normalized.walletId).toBeNull();
});

test("duplicate matcher rows naming the same wallet still resolve", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [makeWallet({ id: "wallet_a" }), makeWallet({ id: "wallet_b", name: "B" })],
    [
      makeMatcher({ id: "matcher_1", walletId: "wallet_a" }),
      makeMatcher({ id: "matcher_2", walletId: "wallet_a" }),
    ],
    DEFAULT_TUNABLES,
  );

  // Two rows, one destination — that is agreement, not ambiguity.
  expect(normalized.walletId).toBe("wallet_a");
});

// ---------------------------------------------------------------------------
// Merchant normalization (spec §5 rule 3, plan Task 5 rule 2)
// ---------------------------------------------------------------------------

test("merchant whitespace is collapsed and title-cased", () => {
  const normalized = normalizeEvent(
    makeEvent({ merchant: "  JOLLIBEE   MALATE\tBRANCH " }),
    makeProvider(),
    [makeWallet()],
    [makeMatcher()],
    DEFAULT_TUNABLES,
  );

  expect(normalized.merchant).toBe("Jollibee Malate Branch");
});

test("a trailing reference fragment is stripped from the merchant", () => {
  const normalized = normalizeEvent(
    makeEvent({ merchant: "JOLLIBEE MALATE  Ref No. 0012345" }),
    makeProvider(),
    [makeWallet()],
    [makeMatcher()],
    DEFAULT_TUNABLES,
  );

  expect(normalized.merchant).toBe("Jollibee Malate");
});

test("a merchant that is only a reference fragment becomes undefined", () => {
  const normalized = normalizeEvent(
    makeEvent({ merchant: "Ref#A1B2C3" }),
    makeProvider(),
    [makeWallet()],
    [makeMatcher()],
    DEFAULT_TUNABLES,
  );

  expect(normalized.merchant).toBeUndefined();
});

test("deliberate mixed-case in a merchant is preserved", () => {
  const normalized = normalizeEvent(
    makeEvent({ merchant: "7-ELEVEN GCash" }),
    makeProvider(),
    [makeWallet()],
    [makeMatcher()],
    DEFAULT_TUNABLES,
  );

  // "7-ELEVEN" is shouted and gets title-cased; "GCash" was cased on purpose and
  // must survive — flattening it to "Gcash" renames a brand in every ledger row.
  expect(normalized.merchant).toBe("7-Eleven GCash");
});

test("an empty merchant becomes undefined, not an empty string", () => {
  const normalized = normalizeEvent(
    makeEvent({ merchant: "   " }),
    makeProvider(),
    [makeWallet()],
    [makeMatcher()],
    DEFAULT_TUNABLES,
  );

  expect(normalized.merchant).toBeUndefined();
  // `""` is a VALUE — it renders as a blank merchant in the ledger and would be
  // written to a NOT NULL-free column as an empty string rather than NULL. The
  // key must be absent, exactly as the parser leaves it when nothing bound.
  expect(Object.keys(normalized)).not.toContain("merchant");
});

test("an absent merchant stays absent", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider(),
    [makeWallet()],
    [makeMatcher()],
    DEFAULT_TUNABLES,
  );

  expect(normalized.merchant).toBeUndefined();
  expect(Object.keys(normalized)).not.toContain("merchant");
});

// ---------------------------------------------------------------------------
// Channel, passthrough and purity
// ---------------------------------------------------------------------------

test("channel is copied from the provider — push", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider({ channel: "push" }),
    [makeWallet()],
    [makeMatcher()],
    DEFAULT_TUNABLES,
  );

  expect(normalized.channel).toBe("push");
});

test("channel is copied from the provider — sms", () => {
  const normalized = normalizeEvent(
    makeEvent(),
    makeProvider({ channel: "sms", senderIds: ["BPI"] }),
    [makeWallet()],
    [makeMatcher()],
    DEFAULT_TUNABLES,
  );

  // Hardcoding "push" here would silently erase the basis for §6's twin window
  // and for the SMS penalty the parser already charged.
  expect(normalized.channel).toBe("sms");
});

test("every parsed field is carried through unchanged", () => {
  const event = makeEvent({
    providerKey: "gcash",
    amount: 123_456,
    direction: "in",
    counterparty: "Juan Dela Cruz",
    referenceNo: "REF12345",
    balanceAfter: 431_025,
    walletHint: "gsave",
  });

  const normalized = normalizeEvent(
    event,
    makeProvider(),
    [makeWallet({ id: "wallet_gsave", type: "savings" })],
    [makeMatcher({ walletId: "wallet_gsave", hint: "gsave" })],
    DEFAULT_TUNABLES,
  );

  expect(normalized.providerKey).toBe("gcash");
  expect(normalized.amount).toBe(123_456);
  expect(normalized.direction).toBe("in");
  expect(normalized.counterparty).toBe("Juan Dela Cruz");
  expect(normalized.referenceNo).toBe("REF12345");
  expect(normalized.balanceAfter).toBe(431_025);
  expect(normalized.walletHint).toBe("gsave");
  // Spec §10 / §5 rule 6 — the notification's own post time, untouched.
  expect(normalized.occurredAt).toBe(OCCURRED_AT);
});

test("the input event is not mutated", () => {
  const event = makeEvent({ merchant: "  JOLLIBEE  MALATE ", confidence: 1 });
  const before = JSON.stringify(event);

  normalizeEvent(event, makeProvider(), [makeWallet({ id: "wallet_only" })], [], DEFAULT_TUNABLES);

  expect(JSON.stringify(event)).toBe(before);
});

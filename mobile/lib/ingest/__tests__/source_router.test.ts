// lib/ingest/__tests__/source_router.test.ts — the pipeline's privacy gate.
//
// ILLUSTRATIVE ONLY. Every notification-shaped string below is INVENTED for
// planning (docs/03-ingest-pipeline.md §11.4). No real GCash, Maya or bank
// notification has been captured for this project, and the package names in
// assets/parser_rules/seed.json are unverified guesses (§3 rule 1). Nothing
// here should be read as a confirmed provider format.
//
// WHAT THESE TESTS ARE GUARDING. The three routes are not equivalent outcomes:
//
//   known         → parsed normally.
//   unknown       → the RAW NOTIFICATION TEXT is shown to the user in the
//                   Review Queue so they can teach the app (§3 rule 4).
//   not_financial → dropped on the spot, never stored, never displayed
//                   (§1 principle 2, §3 rule 3 "data minimization").
//
// So a mistake in the not_financial → unknown direction takes a friend's text
// message and prints it inside a finance app. Several tests below exist for no
// other reason than to pin that direction down: the personal-contact case, the
// bare-number case, and the mid-sentence sender-ID case are each a specific way
// the gate could be built wrong while every other test still passed.
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { routeCapture } from "@/lib/ingest/source_router";
import seedJson from "@/assets/parser_rules/seed.json";

import type { ProviderRuleset, RulesetBundle } from "@/lib/ingest/ruleset_types";
import type { RawCapture } from "@/types/domain";

/**
 * The shipped catalogue, as a complete bundle.
 *
 * Read straight from the JSON rather than through `seed_rules.ts` on purpose:
 * that module imports the ruleset repository, which would drag the database
 * into the dependency graph of a suite testing a pure function. `tunables` is
 * absent from the file by design (the repo merges it on read), so it is filled
 * here the same way the repo does.
 *
 * Using the REAL catalogue for the GCash and SMS cases is deliberate too — it
 * makes these tests fail if a shipped `packageNames` or `senderIds` entry is
 * dropped, not merely if the router's logic breaks.
 */
const SEED: RulesetBundle = {
  ...(seedJson as unknown as Omit<RulesetBundle, "tunables">),
  tunables: DEFAULT_TUNABLES,
};

const GCASH_PACKAGE = "com.globe.gcash.android";
const MESSAGES_PACKAGE = "com.google.android.apps.messaging";
const UNKNOWN_PACKAGE = "com.example.some.unlisted.app";

/** A pinned clock — nothing in this stage reads one, and nothing may start. */
const POSTED_AT = 1_754_100_000_000;

function makeCapture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: "capture-1",
    packageName: UNKNOWN_PACKAGE,
    title: null,
    text: null,
    subText: null,
    bigText: null,
    postedAt: POSTED_AT,
    capturedAt: POSTED_AT + 500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Known providers
// ---------------------------------------------------------------------------

test("a GCash package routes to the GCash provider", () => {
  const capture = makeCapture({
    packageName: GCASH_PACKAGE,
    title: "GCash",
    text: "You have sent ₱1,500.00 to JUAN D. Ref. No. 90210123.", // ILLUSTRATIVE
  });

  const routed = routeCapture(capture, SEED);

  expect(routed.kind).toBe("known");
  // The identity of the provider is the whole point of this stage — "known"
  // alone would pass even if the router handed the Parser BDO's templates.
  expect(routed.kind === "known" && routed.provider.providerKey).toBe("gcash");
  expect(routed.kind === "known" && routed.provider.channel).toBe("push");
  expect(routed.capture).toBe(capture);
});

test("a known push provider routes on its package alone, with no money token required", () => {
  // Spec §3 rule 5: super-app and wallet packages route to their provider, and
  // it is the PARSER's job to reject the marketing volume they emit (§4 rule 3).
  // Requiring a money signal here would silently drop every provider
  // notification whose wording we failed to anticipate.
  const routed = routeCapture(
    makeCapture({
      packageName: GCASH_PACKAGE,
      title: "GCash",
      text: "Get 5% cashback this weekend!", // ILLUSTRATIVE
    }),
    SEED,
  );

  expect(routed.kind).toBe("known");
  expect(routed.kind === "known" && routed.provider.providerKey).toBe("gcash");
});

// ---------------------------------------------------------------------------
// The SMS sub-route (spec §3 rule 2)
// ---------------------------------------------------------------------------

test("an SMS-app capture whose text begins with a BPI sender prefix routes to the SMS provider", () => {
  const capture = makeCapture({
    packageName: MESSAGES_PACKAGE,
    title: "BPI",
    // ILLUSTRATIVE
    text: "BPI: Your account ending 1234 was debited PHP 2,000.00 on 08/02 via ATM.",
  });

  const routed = routeCapture(capture, SEED);

  expect(routed.kind).toBe("known");
  expect(routed.kind === "known" && routed.provider.providerKey).toBe("sms_relay");
  // The channel is what earns the §9.1 SMS penalty downstream; a router that
  // reached the right provider through a push entry would break that.
  expect(routed.kind === "known" && routed.provider.channel).toBe("sms");
});

test("an SMS-app capture whose title alone carries the sender ID still routes to the SMS provider", () => {
  // The Messages app puts the sender ID in the notification TITLE and the
  // message body in `text`; a bank SMS that does not repeat its own name in
  // the body would be lost if only `text` were inspected.
  const routed = routeCapture(
    makeCapture({
      packageName: MESSAGES_PACKAGE,
      title: "BDO",
      text: "A purchase of PHP 1,250.00 was posted to your account.", // ILLUSTRATIVE
    }),
    SEED,
  );

  expect(routed.kind).toBe("known");
  expect(routed.kind === "known" && routed.provider.providerKey).toBe("sms_relay");
});

test("an SMS-app capture from a personal contact with no sender ID and no money token is not_financial", () => {
  // THE RULE 2 DISCRIMINATOR. The Messages app's package IS in the catalogue,
  // so a router that matched on `packageNames` alone would route every private
  // text message on the phone as bank SMS.
  const routed = routeCapture(
    makeCapture({
      packageName: MESSAGES_PACKAGE,
      title: "Mom",
      text: "Are you coming home for dinner tonight?",
    }),
    SEED,
  );

  expect(routed.kind).toBe("not_financial");
});

test("a sender ID mentioned mid-sentence is not a bank SMS", () => {
  // Spec §3 rule 2 says sender-ID PREFIX. "begins with", not "contains" — a
  // friend gossiping about their BPI branch is not a bank notification, and a
  // `.includes()` here would route the whole conversation into the pipeline.
  const routed = routeCapture(
    makeCapture({
      packageName: MESSAGES_PACKAGE,
      title: "Ana",
      text: "The queue at the BPI branch was insane today",
    }),
    SEED,
  );

  expect(routed.kind).toBe("not_financial");
});

test("an SMS capture with a money signal but an unlisted sender ID is unknown, never not_financial", () => {
  // THE DECISION THE PLAN LEAVES OPEN (task-3 brief). The Messages package is
  // listed, the sender prefix is not, but the text is money-like.
  //
  // Routing this `not_financial` would silently discard a real bank SMS from
  // every sender prefix we failed to guess — and our `senderIds` list IS a
  // guess beyond the four the spec names (BPI, BDO, MB, LBP). Spec §1
  // principle 1 says the pipeline asks when it is unsure; §9's cost asymmetry
  // says a Review Queue item costs one tap while a dropped transaction
  // corrupts totals invisibly.
  const routed = routeCapture(
    makeCapture({
      packageName: MESSAGES_PACKAGE,
      title: "RCBC",
      // ILLUSTRATIVE — a bank whose sender prefix is not in our list.
      text: "RCBC: PHP 3,400.00 has been debited from your account ending 8899.",
    }),
    SEED,
  );

  expect(routed.kind).toBe("unknown");
});

test("an SMS-app capture with a matching sender ID routes known even with no parseable amount", () => {
  // Rule 2 is a routing rule, not a money filter. Classifying an OTP or a
  // balance-inquiry reply is spec §4 rule 3's job — the PARSER's — and doing
  // it here would mean a bank SMS whose amount wording we cannot yet read
  // never reaches the templates that would learn it.
  const routed = routeCapture(
    makeCapture({
      packageName: MESSAGES_PACKAGE,
      title: "BPI",
      text: "BPI: Your one-time PIN is 483920. Do not share it.", // ILLUSTRATIVE
    }),
    SEED,
  );

  expect(routed.kind).toBe("known");
  expect(routed.kind === "known" && routed.provider.providerKey).toBe("sms_relay");
});

// ---------------------------------------------------------------------------
// The unknown-bin pre-filter (spec §3 rule 3)
// ---------------------------------------------------------------------------

test("an unknown package containing PHP 500.00 is unknown", () => {
  const capture = makeCapture({
    title: "Some Wallet",
    text: "You received PHP 500.00 from a friend.", // ILLUSTRATIVE
  });

  const routed = routeCapture(capture, SEED);

  expect(routed.kind).toBe("unknown");
  expect(routed.capture).toBe(capture);
});

test("an unknown package with no money token is not_financial", () => {
  // Chat and game notifications must never reach the Review Queue — spec §3
  // rule 3 drops them "immediately and never stored".
  const routed = routeCapture(
    makeCapture({
      title: "Kuya Ben",
      text: "haha ok see you later",
    }),
    SEED,
  );

  expect(routed.kind).toBe("not_financial");
});

test("a bare number is not a money signal", () => {
  // THE PREDICATE'S SHARPEST EDGE. Digits are everywhere in notifications:
  // unread counts, game currency, times, order numbers. A predicate that fired
  // on any number would push most of the phone's notification traffic — group
  // chats included — into a screen inside a finance app.
  const bareNumberTexts = [
    "You have 500 new messages",
    "500 coins collected!",
    "Your order 1234567 has shipped",
    "3 people reacted to your post",
    "Battery at 15%",
    "1,234 steps today",
  ];

  for (const text of bareNumberTexts) {
    expect(routeCapture(makeCapture({ title: "Chat", text }), SEED).kind).toBe("not_financial");
  }
});

test("every currency-token form the spec names counts as a money signal", () => {
  // Spec §3 rule 3 names the markers explicitly: ₱, "PHP", "Php". The spacing
  // and separator variants are what real notifications differ on.
  const moneyTexts = [
    "Debited ₱1,234.56 today",
    "Debited ₱ 1,234.56 today",
    "Debited PHP 1,234.56 today",
    "Debited PHP1234 today",
    "Debited Php500.00 today",
    "Amount: ₱99",
  ];

  for (const text of moneyTexts) {
    expect(routeCapture(makeCapture({ title: "Wallet", text }), SEED).kind).toBe("unknown");
  }
});

test("a currency word with no digits after it is not a money signal", () => {
  // "PHP" is also a programming language and an ISO code that appears in
  // plenty of non-money text. Requiring digits after the token is what keeps
  // a developer's build notification out of the Review Queue.
  const notMoneyTexts = [
    "PHP developers meetup this Saturday",
    "Php is not going anywhere",
    "The ₱ symbol was adopted in 1967", // digits, but not after the token
  ];

  for (const text of notMoneyTexts) {
    expect(routeCapture(makeCapture({ title: "News", text }), SEED).kind).toBe("not_financial");
  }
});

test("the money signal is found in bigText when the collapsed fields lack it", () => {
  // Spec §5 prefers the expanded text, and Task 4's parser reads bigText
  // first. A router that only inspected `text` would drop the notifications
  // whose amount lives past the collapse point — exactly the long ones.
  const routed = routeCapture(
    makeCapture({
      title: "Some Bank",
      text: "You have a new transaction alert",
      bigText: "You have a new transaction alert. Amount: PHP 750.00 was debited.", // ILLUSTRATIVE
    }),
    SEED,
  );

  expect(routed.kind).toBe("unknown");
});

test("a capture with no text at all is not_financial rather than a crash", () => {
  // Spec §2 failure modes: image-only and custom-layout notifications arrive
  // with every text field null. Nothing to inspect means nothing to keep.
  const routed = routeCapture(makeCapture(), SEED);

  expect(routed.kind).toBe("not_financial");
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** A minimal provider fixture — templates are irrelevant to routing. */
function makeProvider(overrides: Partial<ProviderRuleset> = {}): ProviderRuleset {
  return {
    providerKey: "first_in_order",
    packageNames: ["com.example.shared"],
    version: 1,
    channel: "push",
    templates: [],
    ...overrides,
  };
}

function bundleOf(providers: ProviderRuleset[]): RulesetBundle {
  return { version: 1, providers, tunables: DEFAULT_TUNABLES };
}

test("a package listed by two providers resolves to the first in bundle order", () => {
  const first = makeProvider({ providerKey: "first_in_order" });
  const second = makeProvider({ providerKey: "second_in_order" });
  const capture = makeCapture({ packageName: "com.example.shared", text: "₱10.00" });

  // Both orderings, because a single assertion would also pass for an
  // implementation that sorted alphabetically, or that built a lookup object
  // keyed by package name and depended on JS key-insertion order.
  expect(routeCapture(capture, bundleOf([first, second]))).toMatchObject({
    kind: "known",
    provider: { providerKey: "first_in_order" },
  });
  expect(routeCapture(capture, bundleOf([second, first]))).toMatchObject({
    kind: "known",
    provider: { providerKey: "second_in_order" },
  });
});

test("an SMS provider that fails its sender gate does not block a later provider on the same package", () => {
  // Order still decides, but a provider that did not actually match cannot
  // consume the capture. Without this, listing the Messages package under a
  // bank's SMS entry ahead of a broader one would black-hole every capture
  // whose sender prefix belonged to the second entry.
  const strictSms = makeProvider({
    providerKey: "sms_bpi_only",
    packageNames: [MESSAGES_PACKAGE],
    channel: "sms",
    senderIds: ["BPI"],
  });
  const laterSms = makeProvider({
    providerKey: "sms_bdo_only",
    packageNames: [MESSAGES_PACKAGE],
    channel: "sms",
    senderIds: ["BDO"],
  });

  const routed = routeCapture(
    makeCapture({
      packageName: MESSAGES_PACKAGE,
      title: "BDO",
      text: "BDO: PHP 1,250.00 was debited.", // ILLUSTRATIVE
    }),
    bundleOf([strictSms, laterSms]),
  );

  expect(routed.kind).toBe("known");
  expect(routed.kind === "known" && routed.provider.providerKey).toBe("sms_bdo_only");
});

test("an sms-channel provider with no senderIds never matches on its package alone", () => {
  // A malformed or half-written ruleset row must fail CLOSED. `senderIds`
  // absent means there is no prefix that can satisfy rule 2, so the entry
  // routes nothing — the alternative is that shipping an incomplete SMS
  // provider quietly turns the whole Messages app into a money source.
  const brokenSms = makeProvider({
    providerKey: "sms_no_ids",
    packageNames: [MESSAGES_PACKAGE],
    channel: "sms",
    senderIds: undefined,
  });

  const routed = routeCapture(
    makeCapture({
      packageName: MESSAGES_PACKAGE,
      title: "Mom",
      text: "Call me when you get this",
    }),
    bundleOf([brokenSms]),
  );

  expect(routed.kind).toBe("not_financial");
});

test("a blank senderIds entry does not turn the Messages app into a money source", () => {
  // `"".startsWith(anything)` is true, so a stray empty string in the ruleset
  // would match EVERY notification the Messages app posts — every private
  // conversation on the phone, routed as bank SMS, from one bad data row.
  const sloppySms = makeProvider({
    providerKey: "sms_blank_id",
    packageNames: [MESSAGES_PACKAGE],
    channel: "sms",
    senderIds: ["", "   "],
  });

  const routed = routeCapture(
    makeCapture({
      packageName: MESSAGES_PACKAGE,
      title: "Mom",
      text: "Call me when you get this",
    }),
    bundleOf([sloppySms]),
  );

  expect(routed.kind).toBe("not_financial");
});

test("an empty bundle routes by the money signal alone and never throws", () => {
  // A device whose ruleset failed to seed still has to behave: keep the
  // money-like, drop the rest.
  expect(routeCapture(makeCapture({ text: "sent ₱20.00" }), bundleOf([])).kind).toBe("unknown");
  expect(routeCapture(makeCapture({ text: "good morning" }), bundleOf([])).kind).toBe(
    "not_financial",
  );
});

test("the capture is passed through by reference on every route", () => {
  // Downstream stages key on `capture.id` (pipeline rule 11) and persist the
  // raw text verbatim; a router that rebuilt or trimmed the capture would
  // change what the "Why was this recorded?" view shows.
  const known = makeCapture({ packageName: GCASH_PACKAGE, text: "sent ₱1.00" });
  const unknown = makeCapture({ text: "received ₱1.00" });
  const dropped = makeCapture({ text: "hello" });

  expect(routeCapture(known, SEED).capture).toBe(known);
  expect(routeCapture(unknown, SEED).capture).toBe(unknown);
  expect(routeCapture(dropped, SEED).capture).toBe(dropped);
});

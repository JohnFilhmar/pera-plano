// lib/ingest/__tests__/candidates.test.ts — the best-effort read of a
// notification no ruleset matched.
//
// ILLUSTRATIVE ONLY. Every notification-shaped string below is INVENTED for
// planning (docs/03-ingest-pipeline.md §11.4). No real GCash, Maya or bank
// notification has been captured for this project.
//
// WHAT THESE TESTS GUARD. This module never commits anything by itself — it
// proposes, and the Review Queue card turns a proposal into a one-tap commit
// ONLY when `best` is non-null. So the dangerous failure is not "found
// nothing"; it is "confidently named the balance as the amount". Every
// multi-token case below exists to pin that down: two amounts and no way to
// tell them apart must yield `best === null` and let the user tap the one they
// mean.
import { autofillFrom, captureCandidates, snippetLines } from "@/lib/ingest/candidates";
import type { RawCapture } from "@/types/domain";

function captureOf(fields: Partial<RawCapture>): RawCapture {
  return {
    id: "cap-1",
    packageName: "com.example.wallet",
    title: null,
    text: null,
    subText: null,
    bigText: null,
    postedAt: 1_700_000_000_000,
    capturedAt: 1_700_000_000_000,
    ...fields,
  };
}

// ---------------------------------------------------------------------------
// Amount candidates
// ---------------------------------------------------------------------------

test("a single amount token is the best candidate", () => {
  const result = captureCandidates(captureOf({ text: "You sent ₱1,250.00 to Juan." }));

  expect(result.amounts).toHaveLength(1);
  expect(result.best?.centavos).toBe(125000);
  expect(result.best?.text).toBe("₱1,250.00");
});

test("a trailing balance is demoted, leaving one transaction-shaped candidate", () => {
  // The shape nearly every Philippine e-wallet notification takes. Without the
  // demotion this card would be ambiguous forever and the one-tap path would
  // never fire in the field.
  const result = captureCandidates(
    captureOf({ text: "You sent ₱1,250.00 to Juan. Your new balance is ₱3,420.50." }),
  );

  expect(result.amounts.map((candidate) => candidate.role)).toEqual(["amount", "balance"]);
  expect(result.best?.centavos).toBe(125000);
});

test("every spelling of a balance cue demotes the token that follows it", () => {
  const cases = [
    "Paid ₱500.00. New balance: ₱1,000.00",
    "Paid ₱500.00. Available balance ₱1,000.00",
    "Paid ₱500.00. Bal: ₱1,000.00",
    "Paid ₱500.00. Remaining balance is ₱1,000.00",
  ];

  for (const text of cases) {
    const result = captureCandidates(captureOf({ text }));
    expect(result.best?.centavos).toBe(50000);
  }
});

test("two transaction-shaped amounts leave no best candidate", () => {
  // A payment and a fee. Nothing in the text ranks one over the other, and
  // picking either would be the silent wrong commit the queue exists to
  // prevent — so the user taps.
  const result = captureCandidates(
    captureOf({ text: "Paid ₱1,250.00 to Meralco. Convenience fee ₱15.00." }),
  );

  expect(result.amounts).toHaveLength(2);
  expect(result.best).toBeNull();
});

test("a token the strict parser refuses is not offered as a candidate", () => {
  // `₱12,34` is a malformed group. `countAmountTokens`' loose pattern sees it;
  // `parseAmountToCentavos` refuses it, and a candidate that cannot become
  // centavos is not a candidate.
  const result = captureCandidates(captureOf({ text: "Paid ₱12,34 to someone" }));

  expect(result.amounts).toHaveLength(0);
  expect(result.best).toBeNull();
});

test("candidate offsets point at the token inside its own line", () => {
  const capture = captureOf({ title: "Wallet", text: "You sent ₱1,250.00 to Juan." });
  const result = captureCandidates(capture);
  const candidate = result.best;

  expect(candidate).not.toBeNull();
  const line = result.lines[candidate?.lineIndex ?? -1];
  expect(line.slice(candidate?.start ?? 0, candidate?.end ?? 0)).toBe("₱1,250.00");
});

// ---------------------------------------------------------------------------
// Direction and merchant
// ---------------------------------------------------------------------------

test("direction comes from the keyword sets the parser already uses", () => {
  expect(captureCandidates(captureOf({ text: "You sent ₱100.00" })).direction).toBe("out");
  expect(captureCandidates(captureOf({ text: "You received ₱100.00" })).direction).toBe("in");
  expect(captureCandidates(captureOf({ text: "₱100.00 has been credited" })).direction).toBe("in");
});

test("no keyword means no direction, never a guess", () => {
  expect(captureCandidates(captureOf({ text: "₱100.00 GCash" })).direction).toBeNull();
});

test("the richest field decides the direction", () => {
  // `bigText` is the expanded body and the field the parser reads first; a
  // title that merely says "Payment sent" must not overrule it.
  const result = captureCandidates(
    captureOf({ title: "Payment sent", bigText: "You received ₱100.00 from Ana" }),
  );

  expect(result.direction).toBe("in");
});

test("a merchant is read from the preposition that names it", () => {
  expect(captureCandidates(captureOf({ text: "You sent ₱100.00 to Juan Dela Cruz" })).merchant).toBe(
    "Juan Dela Cruz",
  );
  expect(
    captureCandidates(captureOf({ text: "Payment of ₱100.00 at SM Supermarket on Aug 28" }))
      .merchant,
  ).toBe("SM Supermarket");
});

test("the user's own account is not a merchant", () => {
  // Bank prose, and the reason this guard exists: "your account" in the
  // merchant field would go on to key a category rule matching every
  // notification the app ever sends.
  expect(
    captureCandidates(captureOf({ text: "PHP 1,250.00 was debited from your account." })).merchant,
  ).toBeNull();
});

test("a merchant guess never returns an amount or an empty run", () => {
  expect(captureCandidates(captureOf({ text: "Transferred to ₱100.00" })).merchant).toBeNull();
  expect(captureCandidates(captureOf({ text: "Sent ₱100.00 to " })).merchant).toBeNull();
});

// ---------------------------------------------------------------------------
// snippetLines — the same three lines the card and the sheet both show
// ---------------------------------------------------------------------------

test("snippet lines dedupe and cap at three, richest order preserved", () => {
  const lines = snippetLines(
    captureOf({ title: "GCash", text: "You sent ₱100.00", bigText: "You sent ₱100.00", subText: "Wallet" }),
  );

  expect(lines).toEqual(["GCash", "You sent ₱100.00", "Wallet"]);
});

// ---------------------------------------------------------------------------
// autofillFrom — the one-tap gate
// ---------------------------------------------------------------------------

test("autofill is offered only when both the amount and the direction are certain", () => {
  const ready = autofillFrom(
    captureOf({ text: "You sent ₱1,250.00 to Juan. New balance ₱3,420.50" }),
  );
  expect(ready).toEqual({ amount: 125000, direction: "out", merchant: "Juan" });

  // Two live candidates — the amount is a question, so nothing is offered.
  expect(autofillFrom(captureOf({ text: "Paid ₱1,250.00, fee ₱15.00" }))).toBeNull();
  // No direction keyword — committing would book spending as income.
  expect(autofillFrom(captureOf({ text: "₱1,250.00 GCash" }))).toBeNull();
});

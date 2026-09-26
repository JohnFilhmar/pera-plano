// mobile/lib/ai/tools/handlers/__tests__/get_safe_to_spend.test.ts
//
// THE SPEC NAMES A FIELD THAT DOES NOT EXIST. §5.2/7 asks for
// `formatCentavos(getSafeToSpend(...).amount)`; SafeToSpendResult has no
// `amount`. The home screen's figure is `perDay`, and `overBy` is documented
// in lib/safe_to_spend.ts as "the WHOLE-PERIOD shortfall, not a per-day
// figure" — dividing it "would tell a user who is ₱3,499 over that they are
// ₱175 over". The identity test below is therefore against `perDay`, and
// `overBy` gets its own labelled field so the two can never be conflated.
import { formatCentavos } from "@/components/ui/amount_text";
import { closeDatabase } from "@/lib/db/database";
import { getSafeToSpend } from "@/lib/safe_to_spend_service";
import { FIXTURE_NOW, lockForTest, seedAiFixture } from "@/test_support/ai_fixture";
import { handleGetSafeToSpend } from "../get_safe_to_spend";

const NOW = FIXTURE_NOW;

afterEach(async () => {
  await closeDatabase();
});

describe("identity with the service, not similarity", () => {
  test("the per-day display field IS formatCentavos of the service's perDay", async () => {
    await seedAiFixture();
    const expected = await getSafeToSpend("2026-03-15", NOW);
    const result = await handleGetSafeToSpend({}, NOW);

    if (!result.ok) throw new Error("expected a successful result");
    const perDay = result.display.find((field) => field.key === "per_day");
    expect(perDay?.value).toBe(formatCentavos(expected.perDay));
  });

  test("headroom is the service's headroom, not a re-derivation", async () => {
    await seedAiFixture();
    const expected = await getSafeToSpend("2026-03-15", NOW);
    const result = await handleGetSafeToSpend({}, NOW);

    if (!result.ok) throw new Error("expected a successful result");
    const headroom = result.display.find((field) => field.key === "headroom");
    expect(headroom?.value).toBe(formatCentavos(expected.headroom));
  });

  test("overBy is its OWN field, never folded into the daily figure", async () => {
    await seedAiFixture();
    const expected = await getSafeToSpend("2026-03-15", NOW);
    const result = await handleGetSafeToSpend({}, NOW);

    if (!result.ok) throw new Error("expected a successful result");
    const overBy = result.display.find((field) => field.key === "over_by");
    if (expected.overBy > 0) {
      expect(overBy?.value).toBe(formatCentavos(expected.overBy));
      // And it is never the per-day figure wearing a different label.
      const perDay = result.display.find((field) => field.key === "per_day");
      expect(overBy?.value).not.toBe(perDay?.value);
    } else {
      expect(overBy).toBeUndefined();
    }
  });
});

describe("no raw money escapes into data", () => {
  test("data carries the state and the labels, never a centavo integer", async () => {
    await seedAiFixture();
    const result = await handleGetSafeToSpend({}, NOW);
    if (!result.ok) throw new Error("expected a successful result");
    for (const value of Object.values(result.data as Record<string, unknown>)) {
      expect(typeof value).not.toBe("number");
    }
  });

  test("every amount field is formatCentavos output, two decimals and a peso mark", async () => {
    await seedAiFixture();
    const result = await handleGetSafeToSpend({}, NOW);
    if (!result.ok) throw new Error("expected a successful result");
    for (const field of result.display.filter((f) => f.kind === "amount")) {
      expect(field.value).toMatch(/^-?₱[\d,]+\.\d{2}$/);
    }
  });
});

describe("locked is a refusal, not an empty ledger", () => {
  test("refuses with reason 'locked' rather than returning zeroes", async () => {
    await seedAiFixture();
    await lockForTest();
    const result = await handleGetSafeToSpend({}, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toBe("locked");
    expect(result.tool).toBe("get_safe_to_spend");
    // The sharp half: nothing in the refusal may read as a statement about
    // how much money the user has.
    expect(result.message).not.toMatch(/₱|0\.00|no transactions/i);
  });
});

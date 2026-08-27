import { matcherApplies } from "@/lib/ingest/rule_matcher";
import type { NormalizedEvent } from "@/lib/ingest/normalizer";

const event = {
  providerKey: "gcash",
  amount: 100_000,
  direction: "in",
  merchant: "BPI",
  occurredAt: 1_786_000_000_000,
  confidence: 0.9,
  walletId: "w_gcash",
  channel: "push",
} as NormalizedEvent;

test("an empty matcher matches everything", () => {
  expect(matcherApplies({}, event)).toBe(true);
});

test("a provider mismatch fails", () => {
  expect(matcherApplies({ providerKey: "seabank" }, event)).toBe(false);
});

test("a merchant pattern matches case-insensitively", () => {
  expect(matcherApplies({ merchantPattern: "bpi" }, event)).toBe(true);
});

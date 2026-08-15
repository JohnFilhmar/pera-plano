// lib/limits/__tests__/limit_label.test.ts — m2 Task 8.
import { limitDisplayName } from "../limit_label";

const UNFILTERED = { scope: "monthly", categoryFilter: null, walletFilter: null } as const;

test("an unfiltered limit is named by its scope", () => {
  expect(limitDisplayName(UNFILTERED)).toBe("Monthly limit");
  expect(limitDisplayName({ ...UNFILTERED, scope: "daily" })).toBe("Daily limit");
  expect(limitDisplayName({ ...UNFILTERED, scope: "weekly" })).toBe("Weekly limit");
  expect(limitDisplayName({ ...UNFILTERED, scope: "annual" })).toBe("Annual limit");
});

test("one category, with names to hand, is named", () => {
  const names = new Map([["cat-food", "Food & Dining"]]);

  expect(limitDisplayName({ ...UNFILTERED, categoryFilter: ["cat-food"] }, names)).toBe(
    "Monthly limit · Food & Dining",
  );
});

test("without a name map it falls back to a COUNT, never a raw id", () => {
  // The alert path calls this with no map. A uuid in a notification body is
  // worse than no detail at all.
  expect(limitDisplayName({ ...UNFILTERED, categoryFilter: ["cat-food"] })).toBe(
    "Monthly limit · 1 category",
  );
});

test("an id the map does not know also falls back to the count", () => {
  // A category deleted since the limit was created.
  const names = new Map([["cat-food", "Food & Dining"]]);

  expect(limitDisplayName({ ...UNFILTERED, categoryFilter: ["cat-gone"] }, names)).toBe(
    "Monthly limit · 1 category",
  );
});

test("several categories are counted rather than listed", () => {
  // Joining them runs past the card's width, and a truncated list reads as if
  // the limit covers only the categories that happened to fit.
  const names = new Map([
    ["cat-food", "Food & Dining"],
    ["cat-transport", "Transport"],
  ]);

  expect(
    limitDisplayName({ ...UNFILTERED, categoryFilter: ["cat-food", "cat-transport"] }, names),
  ).toBe("Monthly limit · 2 categories");
});

test("a wallet filter is named only when there is no category filter", () => {
  // What the money was spent ON matters more than which card paid, and a label
  // carrying both is longer than the card it sits on.
  expect(limitDisplayName({ ...UNFILTERED, walletFilter: ["w-gcash"] })).toBe(
    "Monthly limit · 1 wallet",
  );
  expect(limitDisplayName({ ...UNFILTERED, walletFilter: ["w-gcash", "w-bpi"] })).toBe(
    "Monthly limit · 2 wallets",
  );
  expect(
    limitDisplayName(
      { ...UNFILTERED, categoryFilter: ["cat-food"], walletFilter: ["w-gcash"] },
      new Map([["cat-food", "Food & Dining"]]),
    ),
  ).toBe("Monthly limit · Food & Dining");
});

test("an empty filter array reads as no filter", () => {
  // limits_repo normalises empty to null on write, but a caller assembling a
  // draft limit in a form has not been through it yet.
  expect(limitDisplayName({ ...UNFILTERED, categoryFilter: [], walletFilter: [] })).toBe(
    "Monthly limit",
  );
});

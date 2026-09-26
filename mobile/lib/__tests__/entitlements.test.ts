import {
  __setTierForTests,
  canCreateGoal,
  canCreateLimit,
  canCreateLoan,
  canCreateWallet,
  canUseAssistantLevel,
  getTier,
  hasBackup,
  hasCsvExport,
  hasProjection,
  hasRecurringDetection,
  hasTrends,
  historyWindowDays,
} from "../entitlements";

afterEach(() => {
  __setTierForTests(null);
});

test("MVP hardcodes the plus tier", () => {
  expect(getTier()).toBe("plus");
});

describe("free tier caps (docs/05-monetization.md §2)", () => {
  beforeEach(() => {
    __setTierForTests("free");
  });

  test("wallets are capped at 3", () => {
    expect(canCreateWallet(0)).toBe(true);
    expect(canCreateWallet(2)).toBe(true);
    expect(canCreateWallet(3)).toBe(false);
    expect(canCreateWallet(9)).toBe(false);
  });

  test("active limits are capped at 1", () => {
    expect(canCreateLimit(0)).toBe(true);
    expect(canCreateLimit(1)).toBe(false);
  });

  test("goals are capped at 1", () => {
    expect(canCreateGoal(0)).toBe(true);
    expect(canCreateGoal(1)).toBe(false);
  });

  test("loans are capped at 1", () => {
    expect(canCreateLoan(0)).toBe(true);
    expect(canCreateLoan(1)).toBe(false);
  });

  test("history is a 90-day visibility window", () => {
    expect(historyWindowDays()).toBe(90);
  });

  test("depth features are off", () => {
    expect(hasRecurringDetection()).toBe(false);
    expect(hasBackup()).toBe(false);
    expect(hasProjection()).toBe(false);
    expect(hasCsvExport()).toBe(false);
    expect(hasTrends()).toBe(false);
  });
});

describe("plus tier", () => {
  beforeEach(() => {
    __setTierForTests("plus");
  });

  test("every creation cap is unlimited", () => {
    expect(canCreateWallet(3)).toBe(true);
    expect(canCreateWallet(999)).toBe(true);
    expect(canCreateLimit(1)).toBe(true);
    expect(canCreateLimit(999)).toBe(true);
    expect(canCreateGoal(1)).toBe(true);
    expect(canCreateGoal(999)).toBe(true);
    expect(canCreateLoan(1)).toBe(true);
    expect(canCreateLoan(999)).toBe(true);
  });

  test("history is unlimited", () => {
    expect(historyWindowDays()).toBeNull();
  });

  test("depth features are on", () => {
    expect(hasRecurringDetection()).toBe(true);
    expect(hasBackup()).toBe(true);
    expect(hasProjection()).toBe(true);
    expect(hasCsvExport()).toBe(true);
    expect(hasTrends()).toBe(true);
  });
});

test("__setTierForTests(null) restores the shipped tier", () => {
  __setTierForTests("free");
  expect(getTier()).toBe("free");
  __setTierForTests(null);
  expect(getTier()).toBe("plus");
});

describe("assistant answer levels (assistant levels spec §6)", () => {
  test("levels 1 to 3 are open to everyone", () => {
    __setTierForTests("free");
    expect([1, 2, 3].map(canUseAssistantLevel)).toEqual([true, true, true]);
  });

  test("levels 4 and 5 need Plus", () => {
    __setTierForTests("free");
    expect([4, 5].map(canUseAssistantLevel)).toEqual([false, false]);
    __setTierForTests("plus");
    expect([4, 5].map(canUseAssistantLevel)).toEqual([true, true]);
  });
});

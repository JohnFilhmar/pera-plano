// lib/wallets/__tests__/matchers.test.ts — the pure half of matcher editing
// (m1c Task 5, rules 1 and 2).
//
// The matcher picker thinks in PROVIDERS ("GCash") because that is what a user
// recognizes; `wallet_matchers` stores ANDROID PACKAGES because that is what a
// notification carries. These functions are the translation, and they carry the
// hint-folding rule that decides whether two matchers are the same matcher.
import {
  foldMatcherHint,
  matchersForProvider,
  ownerOfPair,
  selectedHintByProvider,
  storedMatcherHint,
} from "../matchers";
import type { MatcherOwner } from "../matchers";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";

const GCASH: ProviderRuleset = {
  providerKey: "gcash",
  packageNames: ["com.globe.gcash.android"],
  version: 1,
  channel: "push",
  templates: [],
};

/** A provider with more than one package — the SMS relay is the real one. */
const SMS: ProviderRuleset = {
  providerKey: "sms_relay",
  packageNames: ["com.google.android.apps.messaging", "com.samsung.android.messaging"],
  version: 1,
  channel: "sms",
  senderIds: ["BPI"],
  templates: [],
};

describe("foldMatcherHint", () => {
  test.each([
    ["GSave", "gsave"],
    ["  GSave  ", "gsave"],
    ["gsave", "gsave"],
  ])("folds %p to %p", (input, expected) => {
    expect(foldMatcherHint(input)).toBe(expected);
  });

  test.each([[undefined], [null], [""], ["   "]])(
    "reads %p as no hint at all",
    (input: string | null | undefined) => {
      // Byte-for-byte the Normalizer's own `foldHint`: a blank hint claims the
      // whole provider. Any disagreement here and the pipeline routes a row one
      // way while the conflict check treats it as a different pair entirely.
      expect(foldMatcherHint(input)).toBeNull();
    },
  );
});

describe("storedMatcherHint", () => {
  test("trims but keeps the user's casing, because the chips show it", () => {
    expect(storedMatcherHint("  GSave  ")).toBe("GSave");
  });

  test("stores a blank hint as null", () => {
    expect(storedMatcherHint("   ")).toBeNull();
  });
});

describe("matchersForProvider", () => {
  test("emits one matcher per package the provider claims", () => {
    // One row per package, because `claimingMatchers` filters on
    // `provider.packageNames.includes(matcher.packageName)` — a provider whose
    // second package has no row catches nothing from that app.
    expect(matchersForProvider(SMS, null)).toEqual([
      { packageName: "com.google.android.apps.messaging", hint: null },
      { packageName: "com.samsung.android.messaging", hint: null },
    ]);
  });

  test("carries the hint onto every package", () => {
    expect(matchersForProvider(GCASH, "GSave")).toEqual([
      { packageName: "com.globe.gcash.android", hint: "GSave" },
    ]);
  });

  test("normalizes a blank hint to null", () => {
    expect(matchersForProvider(GCASH, "  ")).toEqual([
      { packageName: "com.globe.gcash.android", hint: null },
    ]);
  });
});

describe("selectedHintByProvider", () => {
  test("reads stored rows back as a provider selection", () => {
    const selection = selectedHintByProvider(
      [GCASH, SMS],
      [{ packageName: "com.globe.gcash.android", hint: "GSave" }],
    );

    expect(selection.get("gcash")).toBe("GSave");
    expect(selection.has("sms_relay")).toBe(false);
  });

  test("a provider is selected when ANY of its packages has a row", () => {
    const selection = selectedHintByProvider(
      [SMS],
      [{ packageName: "com.samsung.android.messaging", hint: null }],
    );

    expect(selection.get("sms_relay")).toBe("");
  });

  test("a package no installed provider claims selects nothing", () => {
    // A stale row from a ruleset that has since dropped the provider. Silently
    // inventing a selection for it would make the form show a provider the app
    // can no longer route.
    expect(selectedHintByProvider([GCASH], [{ packageName: "com.unknown.app" }]).size).toBe(0);
  });
});

describe("ownerOfPair", () => {
  const owners: MatcherOwner[] = [
    {
      packageName: "com.globe.gcash.android",
      hint: null,
      walletId: "w-main",
      walletName: "GCash",
    },
    {
      packageName: "com.globe.gcash.android",
      hint: "GSave",
      walletId: "w-save",
      walletName: "GSave",
    },
  ];

  test("names the wallet already holding the pair", () => {
    expect(ownerOfPair(owners, GCASH, null)?.walletName).toBe("GCash");
  });

  test("matches the hinted pair on its hint, folded", () => {
    expect(ownerOfPair(owners, GCASH, " gsave ")?.walletId).toBe("w-save");
  });

  test("a NEW hint on a claimed provider is not a conflict", () => {
    // The whole point of the hint column: GCash main and GSave are two wallets
    // on one provider, and warning here would talk the user out of the only
    // arrangement that keeps their savings out of their spending money.
    expect(ownerOfPair(owners, GCASH, "GInvest")).toBeNull();
  });

  test("the wallet being edited never conflicts with itself", () => {
    expect(ownerOfPair(owners, GCASH, null, "w-main")).toBeNull();
  });
});

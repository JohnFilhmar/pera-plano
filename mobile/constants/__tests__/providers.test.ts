// constants/__tests__/providers.test.ts — the display half of the provider
// mapping (m1c Task 5's matcher chips, Task 7's transparency panel).
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is a screen printing
// "com.globe.gcash.android" at a user. On a matcher chip that is merely ugly.
// On the "Why was this recorded?" panel it is a broken promise: the panel's
// whole job is telling the user which app was read, and an android package id
// does not tell them that.
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";

import { contrastRatio } from "@/lib/ui/contrast";
import {
  PROVIDER_BADGE,
  PROVIDER_LABELS,
  providerBadge,
  providerKeyForPackage,
  providerLabel,
  providerLabelForPackage,
} from "../providers";

const GCASH_PACKAGE = "com.globe.gcash.android";

function provider(overrides: Partial<ProviderRuleset> = {}): ProviderRuleset {
  return {
    providerKey: "gcash",
    packageNames: [GCASH_PACKAGE],
    version: 1,
    channel: "push",
    templates: [],
    ...overrides,
  };
}

describe("providerLabel", () => {
  test("names a known key", () => {
    expect(providerLabel("gcash")).toBe("GCash");
    expect(providerLabel("sms_relay")).toBe("Bank SMS");
  });

  test("an unknown key degrades to the key, never to a blank", () => {
    // The ruleset is remotely updatable and can ship a provider this file has
    // never heard of. "seabank2" is worse than "SeaBank" and better than blank.
    expect(providerLabel("seabank2")).toBe("seabank2");
  });
});

describe("providerLabelForPackage", () => {
  test("resolves through the installed ruleset", () => {
    expect(providerLabelForPackage([provider()], GCASH_PACKAGE)).toBe("GCash");
  });

  test("names a known package even when the ruleset has not loaded", () => {
    // THE CASE THAT MATTERS FOR THE TRANSPARENCY PANEL. `useRuleset()` is a
    // separate async read, and the panel renders as soon as the capture
    // resolves — with an empty provider list on a cold cache, and on any
    // install whose ruleset write failed. Without the static fallback the
    // panel spends that window telling the user a package name.
    expect(providerLabelForPackage([], GCASH_PACKAGE)).toBe("GCash");
    expect(providerLabelForPackage([], "com.paymaya")).toBe("Maya");
    expect(providerLabelForPackage([], "com.google.android.apps.messaging")).toBe("Bank SMS");
  });

  test("the installed ruleset wins over the static fallback", () => {
    // The ruleset is the authority on routing (docs/03 §11.1: a wrong package
    // is corrected without an app release). If it reassigns a package, the
    // label has to follow it rather than quoting this file's stale copy.
    expect(providerLabelForPackage([provider({ providerKey: "maya" })], GCASH_PACKAGE)).toBe("Maya");
  });

  test("a package nothing claims still renders something readable", () => {
    expect(providerLabelForPackage([], "com.unknown.bank")).toBe("com.unknown.bank");
  });
});

// mobile-ui-revamp Part 2 Task 5: `providerBadge` needs a KEY, and
// `Wallet` carries none — a wallet's provider is derived through its
// `WalletMatcher.packageName`, so a screen needs a package -> key resolver,
// not just the package -> label one above.
describe("providerKeyForPackage", () => {
  test("resolves through the installed ruleset", () => {
    expect(providerKeyForPackage([provider()], GCASH_PACKAGE)).toBe("gcash");
  });

  test("falls back to the shipped package table when the ruleset has not loaded", () => {
    expect(providerKeyForPackage([], GCASH_PACKAGE)).toBe("gcash");
    expect(providerKeyForPackage([], "com.paymaya")).toBe("maya");
  });

  test("the installed ruleset wins over the static fallback", () => {
    expect(providerKeyForPackage([provider({ providerKey: "maya" })], GCASH_PACKAGE)).toBe("maya");
  });

  test("a package nothing claims resolves to null, NEVER the raw package name", () => {
    // The difference from `providerLabelForPackage`'s fallback on purpose: a
    // label has to print something readable, so it falls back to the package
    // string. A badge has no text slot for a package id — `providerBadge`
    // already has its own designed "unidentified provider" fallback (a grey
    // square, the key's own initial), and handing it a raw package name
    // instead would badge it with the package string's first letter, a worse
    // version of that SAME fallback rather than a distinct, honest state.
    expect(providerKeyForPackage([], "com.unknown.bank")).toBeNull();
  });
});

describe("providerLabelForPackage delegates to providerKeyForPackage", () => {
  // THE FAILURE THIS PINS: a badge and the label beside it resolving the same
  // package to two different providers, because each carried its own copy of
  // "ruleset first, then the static table". Asserted by constructing the
  // label the delegation implies and checking the real function agrees with
  // it, for every case the two functions could disagree on.
  test("when the key resolves, the label is providerLabel of THAT key", () => {
    const providers = [provider({ providerKey: "maya" })];
    const key = providerKeyForPackage(providers, GCASH_PACKAGE);
    expect(key).not.toBeNull();
    expect(providerLabelForPackage(providers, GCASH_PACKAGE)).toBe(providerLabel(key as string));
  });

  test("when the key is null, the label falls back to the raw package — not to the key's fallback", () => {
    expect(providerKeyForPackage([], "com.unknown.bank")).toBeNull();
    expect(providerLabelForPackage([], "com.unknown.bank")).toBe("com.unknown.bank");
  });
});

test("every labelled provider has a badge", () => {
  for (const key of Object.keys(PROVIDER_LABELS)) {
    expect(PROVIDER_BADGE[key]).toBeDefined();
  }
});

test("every badge letter is a single uppercase character", () => {
  for (const badge of Object.values(PROVIDER_BADGE)) {
    expect(badge.letter).toMatch(/^[A-Z]$/);
  }
});

test("every badge colour is a six-digit hex", () => {
  for (const badge of Object.values(PROVIDER_BADGE)) {
    expect(badge.color).toMatch(/^#[0-9A-F]{6}$/);
  }
});

test("an unknown provider falls back to its own initial, never to blank", () => {
  expect(providerBadge("chipmunk-bank")).toEqual({ color: "#5B6E64", letter: "C", ink: "#FFFFFF" });
});

test("an empty key still yields a letter rather than an empty badge", () => {
  expect(providerBadge("").letter).toBe("?");
});

// F2: the badge letter renders at a fixed 8-ish px with `allowFontScaling`
// off, which is small text under WCAG — the 3:1 large-text allowance does
// not apply. This is the enforcement for every `ink`-on-`color` pairing in
// `PROVIDER_BADGE`; the values in that file are not self-verifying without
// it. Shape mirrors components/ui/__tests__/chip_contrast.test.ts.
const AA = 4.5;

describe("provider badge ink clears WCAG AA", () => {
  test.each(Object.entries(PROVIDER_BADGE))("%s", (_key, badge) => {
    expect(contrastRatio(badge.ink, badge.color)).toBeGreaterThanOrEqual(AA);
  });

  test("the unknown-provider fallback also clears AA", () => {
    const fallback = providerBadge("chipmunk-bank");
    expect(contrastRatio(fallback.ink, fallback.color)).toBeGreaterThanOrEqual(AA);
  });
});

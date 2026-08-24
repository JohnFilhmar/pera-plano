// lib/ingest/__tests__/provider_catalogue.test.ts — the set algebra behind the
// onboarding provider picker (provider-selection plan Task 4).
//
// The picker's own suite (components/onboarding/__tests__/provider_picker.test.tsx)
// covers interaction; this one covers grouping, ordering, dedupe and naming
// against the pure function directly, where a wrong answer is visible as data
// rather than as a rendered tree.
//
// WHY DEDUPE IS THE LOAD-BEARING TEST HERE. None of the fifteen seed package
// names has been checked against a device (lib/ingest/seed_rules.ts's header),
// but "unverified" is not "wrong" — whichever ones happen to be right WILL
// also arrive from the device, and GCash is in both lists on any phone that
// has it. A naive concatenation renders GCash twice,
// and the second row's tap toggles a different entry than the one the user is
// looking at. That is the specific bug this file exists to catch.
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { buildProviderChoices } from "@/lib/ingest/provider_catalogue";
import seedJson from "@/assets/parser_rules/seed.json";

import type { ObservedPackage } from "@/modules/notification_listener";
import type { RulesetBundle } from "@/lib/ingest/ruleset_types";

/**
 * The shipped catalogue, as a complete bundle — read straight from the JSON
 * rather than through `seed_rules.ts`, which would drag the database into a
 * suite testing a pure function. Same construction source_router.test.ts uses,
 * and for the same reason: a test built on the REAL catalogue fails if a
 * shipped `packageNames` entry is dropped, not merely if the merge breaks.
 */
const SEED: RulesetBundle = {
  ...(seedJson as unknown as Omit<RulesetBundle, "tunables">),
  tunables: DEFAULT_TUNABLES,
};

/** Real, and in the seed. */
const GCASH = "com.globe.gcash.android";
/** Real, and in the seed. */
const MAYA = "com.paymaya";
/** Invented by the seed, and therefore very unlikely to be observed. */
const BPI_GUESS = "com.bpi.ng.app";
/** Observed on a device and absent from the seed — the whole point of Task 3. */
const UNSEEDED_BANK = "com.example.realbank.ph";

const POSTED_AT = 1_754_100_000_000;

function observed(packageName: string, overrides: Partial<ObservedPackage> = {}): ObservedPackage {
  return { packageName, count: 3, lastSeenAt: POSTED_AT, ...overrides };
}

/** A minimal two-provider bundle, for the cases the real seed would obscure. */
function bundleOf(providers: Array<[key: string, packages: string[]]>): RulesetBundle {
  return {
    version: 1,
    providers: providers.map(([providerKey, packageNames]) => ({
      providerKey,
      packageNames,
      version: 1,
      channel: "push" as const,
      templates: [],
    })),
    tunables: DEFAULT_TUNABLES,
  };
}

// ---------------------------------------------------------------------------
// Rule 1 — two groups, observed first.
// ---------------------------------------------------------------------------

test("every observed choice comes before every suggestion", () => {
  const choices = buildProviderChoices([observed(UNSEEDED_BANK), observed(MAYA)], SEED);

  const lastSeen = choices.map((c) => c.seen).lastIndexOf(true);
  const firstUnseen = choices.map((c) => c.seen).indexOf(false);

  expect(lastSeen).toBeGreaterThanOrEqual(0);
  expect(firstUnseen).toBeGreaterThan(lastSeen);
});

test("observed order is the device's own recency order, never re-sorted", () => {
  // listObservedPackages() hands these back newest-first, and recency is the
  // only ranking the app has evidence for — re-sorting alphabetically would
  // bury the app the user just used under the one they installed years ago.
  const choices = buildProviderChoices(
    [observed(UNSEEDED_BANK), observed(GCASH), observed(MAYA)],
    SEED,
  );

  expect(choices.filter((c) => c.seen).map((c) => c.packageName)).toEqual([
    UNSEEDED_BANK,
    GCASH,
    MAYA,
  ]);
});

test("suggestions keep the seed's own catalogue order", () => {
  const choices = buildProviderChoices([], SEED);
  const seedOrder = SEED.providers.flatMap((p) => p.packageNames);

  expect(choices.map((c) => c.packageName)).toEqual(seedOrder);
});

// ---------------------------------------------------------------------------
// Rule 4 — one entry, never two. The naive merge's failure mode.
// ---------------------------------------------------------------------------

test("a package that is both observed and in the seed appears EXACTLY once", () => {
  const choices = buildProviderChoices([observed(GCASH)], SEED);

  expect(choices.filter((c) => c.packageName === GCASH)).toHaveLength(1);
});

test("that single entry sits in the observed group and is still marked suggested", () => {
  const choices = buildProviderChoices([observed(GCASH)], SEED);
  const gcash = choices.find((c) => c.packageName === GCASH);

  expect(gcash).toEqual({
    packageName: GCASH,
    displayName: "gcash",
    seen: true,
    suggested: true,
  });
});

test("no package name is ever emitted twice, even when every seed package was also observed", () => {
  const everySeedPackage = SEED.providers.flatMap((p) => p.packageNames);
  const choices = buildProviderChoices(everySeedPackage.map((p) => observed(p)), SEED);

  const names = choices.map((c) => c.packageName);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toHaveLength(everySeedPackage.length);
});

test("a duplicated observed entry collapses rather than rendering the same app twice", () => {
  const choices = buildProviderChoices([observed(GCASH), observed(GCASH)], SEED);

  expect(choices.filter((c) => c.packageName === GCASH)).toHaveLength(1);
});

test("a package listed by two different seed providers is still emitted once", () => {
  const bundle = bundleOf([
    ["first", ["com.shared.app"]],
    ["second", ["com.shared.app", "com.second.only"]],
  ]);

  const choices = buildProviderChoices([], bundle);

  expect(choices.map((c) => c.packageName)).toEqual(["com.shared.app", "com.second.only"]);
  // First provider wins the name — arbitrary but deterministic, and the
  // alternative (last wins) would make the label depend on catalogue ordering
  // the server can change underneath us.
  expect(choices[0].displayName).toBe("first");
});

// ---------------------------------------------------------------------------
// Naming — the reason Task 3 exists at all.
// ---------------------------------------------------------------------------

test("an observed package absent from the seed renders under its raw package name", () => {
  const choices = buildProviderChoices([observed(UNSEEDED_BANK)], SEED);
  const entry = choices.find((c) => c.packageName === UNSEEDED_BANK);

  // Not blank, not filtered out. Seven of the seed's thirteen package names
  // are guesses, so the bank whose real package this is would otherwise be
  // invisible in the one screen that could fix it.
  expect(entry).toEqual({
    packageName: UNSEEDED_BANK,
    displayName: UNSEEDED_BANK,
    seen: true,
    suggested: false,
  });
});

test("a seed package never observed is a suggestion under its provider key", () => {
  const choices = buildProviderChoices([], SEED);
  const bpi = choices.find((c) => c.packageName === BPI_GUESS);

  expect(bpi).toEqual({
    packageName: BPI_GUESS,
    displayName: "bpi",
    seen: false,
    suggested: true,
  });
});

test("every one of the seed's package names is offered, including the SMS relay's three", () => {
  const choices = buildProviderChoices([], SEED);
  const offered = new Set(choices.map((c) => c.packageName));

  for (const provider of SEED.providers) {
    for (const packageName of provider.packageNames) {
      expect(offered.has(packageName)).toBe(true);
    }
  }
  expect(choices.filter((c) => c.displayName === "sms_relay")).toHaveLength(3);
});

// ---------------------------------------------------------------------------
// Degenerate inputs — a fresh install has observed nothing.
// ---------------------------------------------------------------------------

test("nothing observed still offers the whole seed catalogue", () => {
  const choices = buildProviderChoices([], SEED);

  expect(choices.length).toBeGreaterThan(0);
  expect(choices.every((c) => c.seen === false && c.suggested === true)).toBe(true);
});

test("an empty bundle and an empty device produce no choices rather than throwing", () => {
  expect(buildProviderChoices([], bundleOf([]))).toEqual([]);
});

test("a blank package name is dropped rather than rendered as an unlabelled row", () => {
  const choices = buildProviderChoices([observed(""), observed("   "), observed(GCASH)], SEED);

  expect(choices.filter((c) => c.seen).map((c) => c.packageName)).toEqual([GCASH]);
});

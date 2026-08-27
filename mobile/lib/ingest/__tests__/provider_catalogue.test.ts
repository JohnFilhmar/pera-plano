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
import { applyAppLabels, buildProviderChoices } from "@/lib/ingest/provider_catalogue";
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
    // Irrelevant to catalogue building; present because a bundle carries one.
    traitSignals: [],
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
    providerKey: "gcash",
    appLabel: null,
    displayName: "GCash",
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
  expect(choices[0].providerKey).toBe("first");
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
    providerKey: null,
    appLabel: null,
    displayName: UNSEEDED_BANK,
    seen: true,
    suggested: false,
  });
});

test("a seed package never observed is a suggestion under its provider key", () => {
  const choices = buildProviderChoices([], SEED);
  const bpi = choices.find((c) => c.packageName === BPI_GUESS);

  // The PRINTED name is the curated brand name, not the routing key: the key
  // is what the ruleset matches on and is carried separately now.
  expect(bpi).toEqual({
    packageName: BPI_GUESS,
    providerKey: "bpi",
    appLabel: null,
    displayName: "BPI",
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
  expect(choices.filter((c) => c.providerKey === "sms_relay")).toHaveLength(3);
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


// ---------------------------------------------------------------------------
// applyAppLabels — the real names read off the device.
//
// The bug that motivated this: `ph.seabank.seabank` is the SeaBank package,
// the app on the phone is now called Maribank, and the picker offered a tile
// reading "seabank" — a brand the user cannot match to anything on their
// launcher, on the one screen whose only job is that recognition.
// ---------------------------------------------------------------------------

/** A package whose seeded brand name has gone stale — the motivating case. */
const REBRANDED = "ph.seabank.seabank";

test("the device's app label wins over the curated brand name", () => {
  const bundle = bundleOf([["seabank", [REBRANDED]]]);
  const choices = applyAppLabels(buildProviderChoices([observed(REBRANDED)], bundle), {
    [REBRANDED]: "Maribank",
  });

  expect(choices[0].displayName).toBe("Maribank");
  expect(choices[0].appLabel).toBe("Maribank");
  // The ROUTING key is untouched. A rebrand renames the app, never the
  // package, and every matcher and ruleset lookup keys on this.
  expect(choices[0].providerKey).toBe("seabank");
  expect(choices[0].packageName).toBe(REBRANDED);
});

test("a package with no label keeps the name it already had", () => {
  const choices = applyAppLabels(buildProviderChoices([], SEED), {});
  const bpi = choices.find((c) => c.packageName === BPI_GUESS);

  // Not blanked, not dropped: "Common in the Philippines" is BY DEFINITION
  // apps this phone does not have, so every one of them is unlabelled.
  expect(bpi?.displayName).toBe("BPI");
  expect(bpi?.appLabel).toBeNull();
});

test("an observed app the catalogue has never heard of gets a real name", () => {
  const choices = applyAppLabels(buildProviderChoices([observed(UNSEEDED_BANK)], SEED), {
    [UNSEEDED_BANK]: "Real Bank PH",
  });
  const entry = choices.find((c) => c.packageName === UNSEEDED_BANK);

  // The whole point of learning package names: before this, an unrecognised
  // bank rendered as a raw `com.example.realbank.ph` tile.
  expect(entry?.displayName).toBe("Real Bank PH");
  expect(entry?.providerKey).toBeNull();
});

test("a blank label is ignored rather than blanking the tile", () => {
  const choices = applyAppLabels(buildProviderChoices([], SEED), { [BPI_GUESS]: "   " });

  expect(choices.find((c) => c.packageName === BPI_GUESS)?.displayName).toBe("BPI");
});

test("labels are trimmed", () => {
  const choices = applyAppLabels(buildProviderChoices([], SEED), { [BPI_GUESS]: "  BPI Mobile  " });

  expect(choices.find((c) => c.packageName === BPI_GUESS)?.displayName).toBe("BPI Mobile");
});

test("every choice survives labelling, in order", () => {
  const before = buildProviderChoices([observed(GCASH), observed(UNSEEDED_BANK)], SEED);
  const after = applyAppLabels(before, { [GCASH]: "GCash" });

  expect(after.map((c) => c.packageName)).toEqual(before.map((c) => c.packageName));
});

test("a label for a package that is not in the list changes nothing", () => {
  const before = buildProviderChoices([], SEED);
  const after = applyAppLabels(before, { "com.not.in.the.list": "Ghost" });

  expect(after).toEqual(before);
});

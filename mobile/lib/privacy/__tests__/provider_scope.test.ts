// lib/privacy/__tests__/provider_scope.test.ts — GAP-119.
//
// DELIBERATELY NARROW. The three states that must stay silent (an empty pause
// row, a ruleset naming no packages, a landed deny-all beside a stale
// allowlist) are asserted where they are actually dangerous — on the rendered
// screen, in app/__tests__/privacy_screen.test.tsx — and are not re-proved
// here. What IS here is the one property no screen test can show in a single
// render: that a warned-about state CONVERGES, i.e. that the very allowlist
// this function computes is the one `resyncProviderFilter` pushes, so a
// successful launch always turns `not_in_force` into `in_force`. A comparison
// that can be true forever is the failure mode this whole entry warned about,
// and it is a property of two calls, not one.
import { compareProviderScope } from "@/lib/privacy/provider_scope";

const GCASH = "com.globe.gcash.android";
const BPI = "com.bpi.ng.app";
const UNKNOWN = "com.some.bank.the.ruleset.never.heard.of";

const UNIVERSE = [GCASH, BPI];

/**
 * What `resyncProviderFilter()` in lib/bootstrap.ts would push for this row,
 * re-derived here rather than imported so the test measures agreement between
 * two independent statements of the rule instead of a function agreeing with
 * itself. If these two ever drift apart, the banner stops clearing on relaunch
 * and this test is what says so.
 */
function whatTheNextLaunchWouldPush(
  universe: readonly string[],
  paused: readonly string[],
): { packageNames: string[]; denyAll: boolean } {
  const pausedSet = new Set(paused);
  const allowed = universe.filter((packageName) => !pausedSet.has(packageName));
  return { packageNames: allowed, denyAll: allowed.length === 0 };
}

test("a filter the device never applied converges after one successful re-assert", () => {
  const paused = [GCASH];
  const beforeTheLaunch = { packageNames: [], denyAll: false };

  expect(compareProviderScope({ universe: UNIVERSE, paused, actual: beforeTheLaunch })).toBe(
    "not_in_force",
  );
  expect(
    compareProviderScope({
      universe: UNIVERSE,
      paused,
      actual: whatTheNextLaunchWouldPush(UNIVERSE, paused),
    }),
  ).toBe("in_force");
});

test("an every-provider pause converges too, through the deny-all the allowlist cannot spell", () => {
  const paused = [GCASH, BPI];

  expect(
    compareProviderScope({
      universe: UNIVERSE,
      paused,
      actual: { packageNames: [], denyAll: false },
    }),
  ).toBe("not_in_force");
  expect(
    compareProviderScope({
      universe: UNIVERSE,
      paused,
      actual: whatTheNextLaunchWouldPush(UNIVERSE, paused),
    }),
  ).toBe("in_force");
});

test("a package the ruleset never heard of is a mismatch that a launch still resolves", () => {
  // The pre-existing limitation `resyncProviderFilter` documents: the re-sync
  // builds its allowlist from the ruleset universe alone, so it cannot express
  // "allow only a package the ruleset has never heard of" and narrows one away.
  // Reporting that as a mismatch is honest — the applied scope really is not
  // the recorded one — and it is only safe to report BECAUSE the next launch
  // converges it, which is what this asserts. Nothing here tries to fix the
  // limitation itself.
  const paused = [GCASH];
  const fromOnboarding = { packageNames: [UNKNOWN, BPI], denyAll: false };

  expect(compareProviderScope({ universe: UNIVERSE, paused, actual: fromOnboarding })).toBe(
    "not_in_force",
  );
  expect(
    compareProviderScope({
      universe: UNIVERSE,
      paused,
      actual: whatTheNextLaunchWouldPush(UNIVERSE, paused),
    }),
  ).toBe("in_force");
});

test("a listener holding LESS than the record is a mismatch too, not only a wider one", () => {
  // A ruleset update mid-session grows the universe, and nothing re-asserts
  // until the next launch. The privacy danger runs the other way, but the
  // screen's claim is symmetrical — the switches are not what is in force —
  // and this too converges on relaunch.
  const paused = [GCASH];
  const universeAfterAnUpdate = [GCASH, BPI, UNKNOWN];

  expect(
    compareProviderScope({
      universe: universeAfterAnUpdate,
      paused,
      actual: { packageNames: [BPI], denyAll: false },
    }),
  ).toBe("not_in_force");
  expect(
    compareProviderScope({
      universe: universeAfterAnUpdate,
      paused,
      actual: whatTheNextLaunchWouldPush(universeAfterAnUpdate, paused),
    }),
  ).toBe("in_force");
});

test("order and duplicates are not a difference — membership is the only question", () => {
  expect(
    compareProviderScope({
      universe: [GCASH, BPI, BPI],
      paused: [GCASH],
      actual: { packageNames: [BPI], denyAll: false },
    }),
  ).toBe("in_force");
});

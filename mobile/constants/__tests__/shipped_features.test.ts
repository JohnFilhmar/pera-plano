import {
  SHIPPED_FEATURES,
  isShipped,
  useShippedFeature,
} from "../shipped_features";
import type { FeatureKey, ShipState } from "../shipped_features";

// SHIPPED_FEATURES is exported readonly — app code must never mutate the
// single per-build rollout switch at runtime. Tests poke it anyway (there is
// no other seam), casting away readonly at this one contained call site.
function setShipState(key: FeatureKey, state: ShipState): void {
  (SHIPPED_FEATURES as Record<FeatureKey, ShipState>)[key] = state;
}

// Literal, independent of the module — catches a dynamically-built map that
// silently drops a key (a Record type does not guarantee completeness at
// runtime).
const ALL_KEYS: FeatureKey[] = [
  "limits",
  "income",
  "goals",
  "loans",
  "bills",
  "safe_to_spend",
  "recurring",
  "reports",
  "csv_export",
  "privacy_center",
  "listener_health",
  "parser_diagnostics",
];

describe("SHIPPED_FEATURES", () => {
  test("every FeatureKey has a valid ship-state entry", () => {
    for (const key of ALL_KEYS) {
      const state = SHIPPED_FEATURES[key];
      expect(state === "soon" || state === "shipped").toBe(true);
    }
  });

  /**
   * WHERE THE ROLLOUT HAS ACTUALLY GOT TO.
   *
   * This replaces an "every key starts soon" baseline, which was true only
   * until the first plan flipped anything and then simply broke. The rollout
   * table (2026-08-02-mobile-foundation-part2.md Task 15) assigns every key to
   * exactly one plan, so the honest invariant is the current position — and a
   * plan that flips a key it does not own, or forgets one it does, fails here
   * rather than being noticed on a device.
   *
   * m2-part2 Task 14 flipped `limits` and `income`; m2b Task 9 flipped `goals`
   * and `loans`; m2c Task 6 flipped `bills` and with it finished the whole
   * Plan tab; M3 Part 2 Task 7 flipped `safe_to_spend` and `recurring`. Still
   * to come: m3b Task 8 (the remaining five).
   */
  const SHIPPED_SO_FAR: readonly FeatureKey[] = [
    "limits",
    "income",
    "goals",
    "loans",
    "bills",
    "safe_to_spend",
    "recurring",
  ];

  test("exactly the keys the shipped plans own are flipped", () => {
    for (const key of ALL_KEYS) {
      expect([key, SHIPPED_FEATURES[key]]).toEqual([
        key,
        SHIPPED_SO_FAR.includes(key) ? "shipped" : "soon",
      ]);
    }
  });
});

describe("isShipped", () => {
  afterEach(() => {
    // Restore every key to its baseline in case a prior assertion in this
    // block threw before the finally ran.
    for (const key of ALL_KEYS) {
      setShipState(key, "soon");
    }
  });

  test("agrees with the map in both directions, for every key", () => {
    for (const key of ALL_KEYS) {
      setShipState(key, "soon");
      expect(isShipped(key)).toBe(false);

      setShipState(key, "shipped");
      expect(isShipped(key)).toBe(true);
    }
  });
});

describe("useShippedFeature", () => {
  afterEach(() => {
    for (const key of ALL_KEYS) {
      setShipState(key, "soon");
    }
  });

  test("returns exactly the map's current state, for every key", () => {
    for (const key of ALL_KEYS) {
      setShipState(key, "soon");
      expect(useShippedFeature(key)).toBe("soon");

      setShipState(key, "shipped");
      expect(useShippedFeature(key)).toBe("shipped");
    }
  });
});

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

  test("M1 baseline: every key starts soon (no plan has flipped any yet)", () => {
    for (const key of ALL_KEYS) {
      expect(SHIPPED_FEATURES[key]).toBe("soon");
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

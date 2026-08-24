import { ISOLATED_LINK_HIT_SLOP } from "../hit_slop";

test("ISOLATED_LINK_HIT_SLOP closes the app's largest plausible unstyled-text deficit (44 - 20 = 24) on every edge", () => {
  expect(ISOLATED_LINK_HIT_SLOP).toEqual({ top: 16, bottom: 16, left: 16, right: 16 });
  expect(ISOLATED_LINK_HIT_SLOP.top + ISOLATED_LINK_HIT_SLOP.bottom).toBeGreaterThanOrEqual(24);
});

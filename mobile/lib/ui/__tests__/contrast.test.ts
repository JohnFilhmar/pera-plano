import { contrastRatio, softBackground } from "../contrast";

test("contrastRatio matches known WCAG pairs", () => {
  expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
  expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 2);
  expect(contrastRatio("#FFFFFF", "#15803D")).toBeCloseTo(5.02, 1);
});

test("contrastRatio is symmetric", () => {
  expect(contrastRatio("#DC2626", "#F7FAF7")).toBeCloseTo(
    contrastRatio("#F7FAF7", "#DC2626"),
    5,
  );
});

test("softBackground returns rgba at the requested alpha", () => {
  expect(softBackground("#D97706", 0.14)).toBe("rgba(217, 119, 6, 0.14)");
  expect(softBackground("#DC2626", 0.12)).toBe("rgba(220, 38, 38, 0.12)");
});

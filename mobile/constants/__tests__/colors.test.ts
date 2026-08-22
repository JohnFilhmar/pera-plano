import { palette } from "../colors";

test("every light token has a -dark sibling", () => {
  const keys = Object.keys(palette);
  const lightKeys = keys.filter((k) => !k.endsWith("-dark"));
  for (const key of lightKeys) {
    expect(keys).toContain(`${key}-dark`);
  }
});

test("contract §2 values are verbatim", () => {
  expect(palette.brand).toBe("#15803D");
  expect(palette["brand-dark"]).toBe("#22C55E");
  expect(palette["brand-soft"]).toBe("#DCFCE7");
  expect(palette["brand-soft-dark"]).toBe("#14261C");
  expect(palette.bg).toBe("#F7FAF7");
  expect(palette["bg-dark"]).toBe("#0B1210");
  expect(palette.surface).toBe("#FFFFFF");
  expect(palette["surface-dark"]).toBe("#111A16");
  expect(palette.fg).toBe("#10201A");
  expect(palette["fg-dark"]).toBe("#E8F0EC");
  expect(palette["fg-2"]).toBe("#5B6E64");
  expect(palette["fg-2-dark"]).toBe("#9BB0A6");
  expect(palette.danger).toBe("#DC2626");
  expect(palette["danger-dark"]).toBe("#F87171");
  expect(palette.warn).toBe("#D97706");
  expect(palette["warn-dark"]).toBe("#FBBF24");
  expect(palette["ph-blue"]).toBe("#0038A8");
  expect(palette["ph-blue-dark"]).toBe("#4D7CDB");
  expect(palette["ph-red"]).toBe("#CE1126");
  expect(palette["ph-red-dark"]).toBe("#E4566A");
  expect(palette["ph-yellow"]).toBe("#FCD116");
  expect(palette["ph-yellow-dark"]).toBe("#FCD116");
});

test("the design's line and chip surfaces are verbatim", () => {
  expect(palette.line).toBe("#E3EBE5");
  expect(palette["line-dark"]).toBe("#22302A");
  expect(palette.chip).toBe("#EDF3EE");
  expect(palette["chip-dark"]).toBe("#18231E");
});

test("warn-ink is darker than warn, and exists only as soft-chip ink", () => {
  expect(palette["warn-ink"]).toBe("#B45309");
  expect(palette["warn-ink-dark"]).toBe("#FBBF24");
});

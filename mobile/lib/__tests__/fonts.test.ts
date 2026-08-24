import { Text, TextInput } from "react-native";

type PatchedComponent = { defaultProps?: { style?: unknown } };

function familyOf(component: unknown): string | undefined {
  const style = (component as PatchedComponent).defaultProps?.style;
  const flat = Array.isArray(style)
    ? Object.assign({}, ...(style as object[]))
    : (style as object | undefined);
  return (flat as { fontFamily?: string } | undefined)?.fontFamily;
}

// Reset module state before each test to ensure clean slate
beforeEach(() => {
  jest.resetModules();
  // Also reset Text/TextInput defaultProps that persisted from previous tests
  (Text as any).defaultProps = undefined;
  (TextInput as any).defaultProps = undefined;
});

test("applyGlobalFont injects Inter into Text and TextInput defaultProps", () => {
  const { APP_FONT_FAMILY, applyGlobalFont } = require("../fonts");
  applyGlobalFont();
  expect(APP_FONT_FAMILY).toBe("Inter_400Regular");
  expect(familyOf(Text)).toBe(APP_FONT_FAMILY);
  expect(familyOf(TextInput)).toBe(APP_FONT_FAMILY);
});

test("applyGlobalFont is idempotent — no duplicate style layers", () => {
  const { APP_FONT_FAMILY, applyGlobalFont } = require("../fonts");
  applyGlobalFont();
  applyGlobalFont();
  const style = (Text as unknown as PatchedComponent).defaultProps?.style;
  const layers = Array.isArray(style) ? style : [style];
  const fontLayers = layers.filter(
    (l) => (l as { fontFamily?: string } | undefined)?.fontFamily === APP_FONT_FAMILY,
  );
  expect(fontLayers).toHaveLength(1);
});

test("applyGlobalFont preserves pre-existing Text style — appends font as array head", () => {
  const { APP_FONT_FAMILY, applyGlobalFont } = require("../fonts");
  // Pre-set Text defaultProps with existing style
  (Text as any).defaultProps = { style: { fontSize: 14 } };
  applyGlobalFont();
  // Assert font is applied and pre-existing style is preserved
  const style = (Text as unknown as PatchedComponent).defaultProps?.style;
  expect(Array.isArray(style)).toBe(true);
  expect(style).toHaveLength(2);
  expect((style as object[])[0]).toEqual({ fontFamily: APP_FONT_FAMILY });
  expect((style as object[])[1]).toEqual({ fontSize: 14 });
});

test("applyGlobalFont preserves pre-existing TextInput style — appends font as array head", () => {
  const { APP_FONT_FAMILY, applyGlobalFont } = require("../fonts");
  // Pre-set TextInput defaultProps with existing style
  (TextInput as any).defaultProps = { style: { fontSize: 16 } };
  applyGlobalFont();
  // Assert font is applied and pre-existing style is preserved
  const style = (TextInput as unknown as PatchedComponent).defaultProps?.style;
  expect(Array.isArray(style)).toBe(true);
  expect(style).toHaveLength(2);
  expect((style as object[])[0]).toEqual({ fontFamily: APP_FONT_FAMILY });
  expect((style as object[])[1]).toEqual({ fontSize: 16 });
});

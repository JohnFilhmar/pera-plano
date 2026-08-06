import { Text, TextInput } from "react-native";
import { APP_FONT_FAMILY, applyGlobalFont } from "../fonts";

type PatchedComponent = { defaultProps?: { style?: unknown } };

function familyOf(component: unknown): string | undefined {
  const style = (component as PatchedComponent).defaultProps?.style;
  const flat = Array.isArray(style)
    ? Object.assign({}, ...(style as object[]))
    : (style as object | undefined);
  return (flat as { fontFamily?: string } | undefined)?.fontFamily;
}

test("applyGlobalFont injects Inter into Text and TextInput defaultProps", () => {
  applyGlobalFont();
  expect(APP_FONT_FAMILY).toBe("Inter_400Regular");
  expect(familyOf(Text)).toBe(APP_FONT_FAMILY);
  expect(familyOf(TextInput)).toBe(APP_FONT_FAMILY);
});

test("applyGlobalFont is idempotent — no duplicate style layers", () => {
  applyGlobalFont();
  applyGlobalFont();
  const style = (Text as unknown as PatchedComponent).defaultProps?.style;
  const layers = Array.isArray(style) ? style : [style];
  const fontLayers = layers.filter(
    (l) => (l as { fontFamily?: string } | undefined)?.fontFamily === APP_FONT_FAMILY,
  );
  expect(fontLayers).toHaveLength(1);
});

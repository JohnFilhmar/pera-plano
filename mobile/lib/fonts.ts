import { Text, TextInput } from "react-native";

/** The loaded Inter face NativeWind's `font-sans` and all default text uses. */
export const APP_FONT_FAMILY = "Inter_400Regular";

type PatchableComponent = {
  defaultProps?: { style?: unknown } & Record<string, unknown>;
};

let applied = false;

/**
 * App-wide font: patch Text/TextInput defaultProps once at module load
 * (STACK_BASIS §4) so every component renders Inter without per-component
 * styling. Existing defaultProps styles are preserved underneath.
 */
export function applyGlobalFont(): void {
  if (applied) return;
  applied = true;
  for (const component of [Text, TextInput] as unknown as PatchableComponent[]) {
    const defaults = component.defaultProps ?? {};
    const existingStyle = defaults.style;
    component.defaultProps = {
      ...defaults,
      style: existingStyle
        ? [{ fontFamily: APP_FONT_FAMILY }, existingStyle]
        : { fontFamily: APP_FONT_FAMILY },
    };
  }
}

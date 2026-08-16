// components/settings/__tests__/theme_picker.test.tsx — M3b Task 5.
//
// Component-scoped, unlike app/__tests__/more_tab.test.tsx's screen-level
// theme test: this file proves ThemePicker itself is wired correctly against
// a real ThemeProvider (no mocking of "nativewind" or "react-native" — the
// same convention app/__tests__/more_hub.test.tsx already uses for a
// screen-level ThemeProvider), independent of where it's mounted.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { ThemeProvider } from "@/contexts/theme_context";

import { ThemePicker } from "../theme_picker";

beforeEach(async () => {
  await AsyncStorage.clear();
});

function renderPicker() {
  return render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>,
  );
}

test("renders all three options", async () => {
  renderPicker();
  await screen.findByTestId("theme-picker");

  screen.getByTestId("theme-picker-auto");
  screen.getByTestId("theme-picker-light");
  screen.getByTestId("theme-picker-dark");
  screen.getByText("Auto");
  screen.getByText("Light");
  screen.getByText("Dark");
});

test("auto is selected by default", async () => {
  renderPicker();
  await screen.findByTestId("theme-picker");

  expect(screen.getByTestId("theme-picker-auto").props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId("theme-picker-light").props.accessibilityState.selected).toBe(
    false,
  );
  expect(screen.getByTestId("theme-picker-dark").props.accessibilityState.selected).toBe(false);
});

test("pressing an option selects it immediately and persists it", async () => {
  renderPicker();
  await screen.findByTestId("theme-picker");

  fireEvent.press(screen.getByTestId("theme-picker-light"));

  // Immediate: reflected in the same render pass, no waitFor.
  expect(screen.getByTestId("theme-picker-light").props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId("theme-picker-auto").props.accessibilityState.selected).toBe(false);

  // Persisted: the same AsyncStorage key theme_context.test.tsx already pins.
  await waitFor(async () =>
    expect(await AsyncStorage.getItem("peraplano.theme_preference")).toBe("light"),
  );
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useColorScheme } from "react-native";
import { ThemeProvider, useTheme } from "../theme_context";

jest.mock("nativewind", () => ({ colorScheme: { set: jest.fn() } }));

// Mock react-native's useColorScheme so tests can drive the OS scheme
// directly instead of relying on whatever the test environment reports.
// A Proxy (not `{...actual}`) is required here: spreading the real module
// eagerly evaluates every lazy getter on it — including native-only exports
// like DevMenu — which crashes outside a real app. The Proxy only forwards
// the specific properties real code actually touches.
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const mockedUseColorScheme = jest.fn(() => "light");
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === "useColorScheme") return mockedUseColorScheme;
      return Reflect.get(target, prop, receiver);
    },
  });
});

const mockUseColorScheme = useColorScheme as jest.Mock;

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockUseColorScheme.mockReturnValue("light");
});

test("defaults to auto and resolves from the system scheme", async () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(result.current.isReady).toBe(true));
  expect(result.current.preference).toBe("auto");
  expect(["light", "dark"]).toContain(result.current.resolved);
});

test("isReady is false on the first render, before AsyncStorage has resolved", async () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  // Synchronous read right after mount: the AsyncStorage.getItem() promise
  // has not settled yet, so the root layout must still gate on this.
  expect(result.current.isReady).toBe(false);
  await waitFor(() => expect(result.current.isReady).toBe(true));
});

test("setPreference resolves immediately and persists", async () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(result.current.isReady).toBe(true));
  act(() => result.current.setPreference("dark"));
  expect(result.current.preference).toBe("dark");
  expect(result.current.resolved).toBe("dark");
  await waitFor(async () =>
    expect(await AsyncStorage.getItem("peraplano.theme_preference")).toBe("dark"),
  );
});

test("restores a persisted preference on mount", async () => {
  await AsyncStorage.setItem("peraplano.theme_preference", "dark");
  const { result } = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(result.current.preference).toBe("dark"));
  expect(result.current.resolved).toBe("dark");
});

test('persists the literal preference "auto", not the resolved scheme', async () => {
  // "dark" alone can't distinguish "we stored the preference" from "we
  // stored the resolved scheme" — both are valid ResolvedTheme values too.
  // "auto" is only ever a valid ThemePreference, so it's the only value
  // that proves the raw preference (not a snapshot of it) hit storage.
  const { result } = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(result.current.isReady).toBe(true));
  act(() => result.current.setPreference("auto"));
  await waitFor(async () =>
    expect(await AsyncStorage.getItem("peraplano.theme_preference")).toBe("auto"),
  );
});

test('a persisted "auto" re-resolves against the OS scheme on the next mount, not the scheme captured when it was saved', async () => {
  mockUseColorScheme.mockReturnValue("light");
  const first = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(first.result.current.isReady).toBe(true));
  act(() => first.result.current.setPreference("auto"));
  expect(first.result.current.resolved).toBe("light");
  first.unmount();

  // The OS scheme changes while the preference remains "auto" in storage.
  mockUseColorScheme.mockReturnValue("dark");
  const second = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(second.result.current.isReady).toBe(true));
  expect(second.result.current.preference).toBe("auto");
  expect(second.result.current.resolved).toBe("dark");
});

test("pushes the preference into nativewind so dark: variants track it", async () => {
  const { colorScheme } = jest.requireMock("nativewind") as {
    colorScheme: { set: jest.Mock };
  };
  const { result } = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(result.current.isReady).toBe(true));
  act(() => result.current.setPreference("light"));
  expect(colorScheme.set).toHaveBeenLastCalledWith("light");
  act(() => result.current.setPreference("auto"));
  expect(colorScheme.set).toHaveBeenLastCalledWith("system");
});

test('resolved tracks a live OS scheme change while preference is "auto"', async () => {
  mockUseColorScheme.mockReturnValue("light");
  const { result, rerender } = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(result.current.isReady).toBe(true));
  expect(result.current.resolved).toBe("light");

  // The OS flips scheme while the app is running, with no user action.
  mockUseColorScheme.mockReturnValue("dark");
  rerender(undefined);
  expect(result.current.resolved).toBe("dark");
});

test('resolved ignores an OS scheme change once the preference is pinned to "light"', async () => {
  mockUseColorScheme.mockReturnValue("light");
  const { result, rerender } = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(result.current.isReady).toBe(true));
  act(() => result.current.setPreference("light"));
  expect(result.current.resolved).toBe("light");

  mockUseColorScheme.mockReturnValue("dark");
  rerender(undefined);
  expect(result.current.resolved).toBe("light");
});

test('a hydration failure still becomes ready, defaulting to "auto"', async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(
    new Error("storage unavailable"),
  );
  const { result } = renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(result.current.isReady).toBe(true));
  expect(result.current.preference).toBe("auto");
});

test("useTheme outside ThemeProvider throws", () => {
  // Silence React's error boundary noise for this expected throw.
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(() => renderHook(() => useTheme())).toThrow(
    "useTheme must be used within ThemeProvider",
  );
  spy.mockRestore();
});

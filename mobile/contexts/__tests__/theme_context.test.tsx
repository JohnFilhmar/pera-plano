import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ThemeProvider, useTheme } from "../theme_context";

jest.mock("nativewind", () => ({ colorScheme: { set: jest.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
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

test("useTheme outside ThemeProvider throws", () => {
  // Silence React's error boundary noise for this expected throw.
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(() => renderHook(() => useTheme())).toThrow(
    "useTheme must be used within ThemeProvider",
  );
  spy.mockRestore();
});

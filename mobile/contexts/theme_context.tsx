import AsyncStorage from "@react-native-async-storage/async-storage";
import { colorScheme as nativewindColorScheme } from "nativewind";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";

export type ThemePreference = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "peraplano.theme_preference";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  isReady: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useSystemColorScheme(); // "light" | "dark" | null
  const [preference, setPreferenceState] = useState<ThemePreference>("auto");
  const [isReady, setIsReady] = useState(false);

  // Restore the persisted preference once on mount.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === "auto" || stored === "light" || stored === "dark") {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // Storage read failed (e.g. native module error) — fall back to
        // the default "auto" preference rather than leaving an unhandled
        // rejection; `finally` below still lets the app render.
      })
      .finally(() => setIsReady(true));
  }, []);

  // Drive NativeWind's dark: variant from the preference.
  useEffect(() => {
    nativewindColorScheme.set(preference === "auto" ? "system" : preference);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    void AsyncStorage.setItem(STORAGE_KEY, p);
  }, []);

  const resolved: ResolvedTheme =
    preference === "auto" ? (system === "dark" ? "dark" : "light") : preference;

  const value = useMemo(
    () => ({ preference, resolved, setPreference, isReady }),
    [preference, resolved, setPreference, isReady],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

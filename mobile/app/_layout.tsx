// app/_layout.tsx — root provider tree (STACK_BASIS §16, minus auth/contacts:
// this app is local-first with no login). Outer to inner:
// PersistQueryClientProvider -> KeyboardProvider -> ThemeProvider -> Stack.
//
// Renders null until the font face is loaded AND bootstrapApp() has resolved
// AND the theme preference has rehydrated (task-17-brief.md rule 1) — render
// any earlier and the user sees a flash of unstyled, wrong-theme content in
// the system font on every cold start.
//
// A throwing bootstrap does not leave the screen permanently blank
// (task-17-brief.md rule 2): it renders a plain, themed recovery screen with
// a "Try again" action that re-invokes bootstrapApp(), instead of a white
// void the user has no way to act on.
import { Inter_400Regular } from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { palette } from "@/constants/colors";
import { ThemeProvider, useTheme } from "@/contexts/theme_context";
import { applyGlobalFont } from "@/lib/fonts";
import { bootstrapApp } from "@/lib/bootstrap";
import { persistOptions, queryClient } from "@/lib/query_client";

// Must run before the first render so the very first frame uses Inter, not
// the system font (lib/fonts.ts).
applyGlobalFont();

type BootstrapState = "pending" | "ready" | "error";

function BootstrapErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View
      testID="bootstrap-error"
      className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
    >
      <Text className="text-center text-lg font-semibold text-fg dark:text-fg-dark">
        PeraPlano couldn't start
      </Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Something went wrong preparing your data. You can try again, or close and reopen the app.
      </Text>
      <Pressable
        testID="bootstrap-retry"
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        className="rounded-lg bg-brand px-4 py-3 dark:bg-brand-dark"
      >
        <Text className="font-semibold text-surface dark:text-surface-dark">Try again</Text>
      </Pressable>
    </View>
  );
}

/** Mounted unconditionally inside ThemeProvider so bootstrapApp() starts in
 * parallel with font loading and theme rehydration, not after them. */
function AppShell({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { resolved, isReady: themeReady } = useTheme();
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>("pending");

  const runBootstrap = useCallback(() => {
    setBootstrapState("pending");
    bootstrapApp()
      .then(() => setBootstrapState("ready"))
      .catch((error: unknown) => {
        console.error("bootstrapApp failed to start the app", error);
        setBootstrapState("error");
      });
  }, []);

  useEffect(() => {
    runBootstrap();
  }, [runBootstrap]);

  if (!fontsLoaded || !themeReady || bootstrapState === "pending") {
    return null;
  }

  if (bootstrapState === "error") {
    return <BootstrapErrorScreen onRetry={runBootstrap} />;
  }

  const bg = resolved === "dark" ? palette["bg-dark"] : palette.bg;
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
      <StatusBar style="auto" />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular });

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <KeyboardProvider>
        <ThemeProvider>
          <AppShell fontsLoaded={fontsLoaded} />
        </ThemeProvider>
      </KeyboardProvider>
    </PersistQueryClientProvider>
  );
}

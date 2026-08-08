// app/_layout.tsx — root provider tree (STACK_BASIS §16, minus auth/contacts:
// this app is local-first with no login). Outer to inner:
// KeyboardProvider -> ThemeProvider -> LockProvider -> (once unlocked)
// PersistQueryClientProvider -> Stack.
//
// Renders null until the font face is loaded AND the theme preference has
// rehydrated (task-17-brief.md rule 1) AND the app lock reports "unlocked"
// AND bootstrapApp() has resolved — four conditions, not three: Task 9
// (docs/12-encryption-and-app-lock.md §7; interface contract §10) added the
// app lock as the fourth. Render any earlier and the user either sees a
// flash of unstyled, wrong-theme content on every cold start, or — the
// reason the lock condition exists at all — a locked phone's financial data
// rendered before anyone authenticated.
//
// WHY BOOTSTRAP WAITS FOR UNLOCKED, NOT THE OTHER WAY AROUND: bootstrapApp()
// calls getDatabase(), which THROWS DatabaseLockedError until
// unlockDatabase(dek) has run (lib/db/database.ts). The lock sequence (get
// the DEK, unlockDatabase(dek), setCacheEncryptionKey(dek) — all three, in
// that order, live in contexts/lock_context.tsx) must complete BEFORE
// bootstrap is even attempted, not just before the Stack renders.
//
// WHY PersistQueryClientProvider MOVED INSIDE THE LOCK GATE: it used to wrap
// the entire tree unconditionally, mounting (and triggering its own
// persisted-cache restore) long before unlock ever ran.
// lib/query_client.ts's setCacheEncryptionKey doc is explicit that the key
// "MUST be called ... before PersistQueryClientProvider's persister reads or
// writes anything — concretely, before it mounts." The only way to make that
// literally true (rather than merely "before the first read succeeds by
// accident") is to not mount the provider at all until AFTER unlock has
// already called setCacheEncryptionKey — so it now wraps only the
// post-unlock subtree. Nothing above this file's Stack/tabs ever reads
// react-query, so nothing lost access by moving it.
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
import { LockProvider, useLock } from "@/contexts/lock_context";
import { applyGlobalFont } from "@/lib/fonts";
import { bootstrapApp } from "@/lib/bootstrap";
import { persistOptions, queryClient } from "@/lib/query_client";
import LockScreen from "./lock";

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

/** Mounted unconditionally inside ThemeProvider/LockProvider so bootstrapApp()
 * starts as soon as (and only once) the lock reports "unlocked" — see this
 * file's header comment for why bootstrap cannot run any earlier. */
function AppShell({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { resolved, isReady: themeReady } = useTheme();
  const { status: lockStatus } = useLock();
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

  // Deliberately gated on lockStatus, not fired unconditionally on mount —
  // bootstrapApp() would throw DatabaseLockedError if it ran before unlock.
  //
  // MUST depend on lockStatus ALONE, not on bootstrapState: an earlier
  // version also depended on bootstrapState (to skip re-running once
  // already "ready") and re-introduced exactly the "forever-looping" bug
  // class this whole plan warns about — a rejected bootstrapApp() sets
  // bootstrapState to "error", which is itself a CHANGE the effect would
  // then react to ("error" !== "ready" is still true), calling
  // runBootstrap() again, rejecting again, forever, with no user action in
  // between. Depending on lockStatus only means this effect re-fires
  // exactly on a locked<->unlocked transition — a real re-unlock after the
  // five-minute background timeout — and never merely because bootstrap's
  // own state changed.
  useEffect(() => {
    if (lockStatus === "unlocked") {
      runBootstrap();
    }
  }, [lockStatus, runBootstrap]);

  // Fonts, theme, and the lock's own "checking" phase all render nothing —
  // the same bucket pre-Task-9 fonts/theme/bootstrap already shared.
  if (!fontsLoaded || !themeReady || lockStatus === "checking") {
    return null;
  }

  // The fourth render-gate condition (contract §10): anything other than
  // "unlocked" shows the lock screen instead of the app, full stop —
  // including while bootstrap would otherwise be pending/erroring, since
  // bootstrap cannot have even started yet without a DEK.
  if (lockStatus !== "unlocked") {
    return <LockScreen />;
  }

  const bg = resolved === "dark" ? palette["bg-dark"] : palette.bg;
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {bootstrapState === "pending" ? null : bootstrapState === "error" ? (
        <BootstrapErrorScreen onRetry={runBootstrap} />
      ) : (
        <>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
          <StatusBar style="auto" />
        </>
      )}
    </PersistQueryClientProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular });

  return (
    <KeyboardProvider>
      <ThemeProvider>
        <LockProvider>
          <AppShell fontsLoaded={fontsLoaded} />
        </LockProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}

// mobile/components/ui/keypad_host.tsx — W1 Task 4.
//
// MOUNTED MORE THAN ONCE, ON PURPOSE. Once in app/_layout.tsx beside the
// Stack, and once inside bottom_sheet.tsx's Modal. contexts/keypad_context.tsx
// hands out a token per mount and only the highest live token renders, which
// is always the topmost native window. See that file's header for why a
// single root host cannot work.
//
// NO SCRIM, DELIBERATELY. The obvious design is a translucent full-screen
// backdrop that closes on tap, and it is wrong here: these forms are dense --
// the manual-entry sheet has direction toggles, a wallet picker, a category
// picker and a date field all above the amount -- and a scrim turns every one
// of those taps into a DISMISSAL instead of the action the user intended. The
// panel takes the bottom band; everything above it stays live and directly
// tappable. The cost is that tapping the background does nothing, which is
// what x, Done and hardware back are for.
//
// HARDWARE BACK IS CONSUMED WHILE OPEN. Without returning true from the
// handler, a user's first back press leaves the screen they are halfway
// through filling in.
//
// READS THE CONTEXT OPTIONALLY. bottom_sheet.tsx is a shared primitive that
// dozens of suites mount on its own, and a throwing read would turn
// KeypadProvider into a hard dependency of every one of them. With no
// provider above it this host renders nothing, which is exactly right: there
// is no keypad state for it to draw. Fields keep using the throwing
// `useKeypad` — see keypad_context.tsx.
//
// THE Animated.View CARRIES NO className. NativeWind's support for className
// on an Animated host is unverified in this app (nothing else here does it),
// and a class list that silently resolves to nothing would leave the panel
// unpainted on a device while every test stayed green. The animated wrapper
// is bare -- position, opacity, transform -- and every class sits on the
// plain View immediately inside it.
import { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { cssInterop } from "nativewind";

import { useKeypadOptional } from "@/contexts/keypad_context";
import { appendKey, formatPesoInput, removeLastKey } from "@/lib/money/peso_input";
import { NumericKeypad, type KeypadMode } from "./numeric_keypad";

cssInterop(X, { className: { target: "style", nativeStyleToProp: { color: true } } });

/** What the panel's big read-out shows for the text being typed. */
function displayFor(mode: KeypadMode, text: string): string {
  if (mode === "peso") return formatPesoInput(text);
  if (mode === "rate") return `${text === "" ? "0" : text}%`;
  return text === "" ? "0" : text;
}

export function KeypadHost() {
  const keypad = useKeypadOptional();
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState<number | null>(null);

  // Pulled out one by one so every hook below can depend on a stable
  // reference whether or not a provider is above this host. Each of these is
  // a useCallback with no dependencies in the provider, so none of them
  // changes identity between renders.
  const request = keypad?.request ?? null;
  const activeHost = keypad?.activeHost ?? null;
  const close = keypad?.close;
  const registerHost = keypad?.registerHost;
  const releaseHost = keypad?.releaseHost;
  const setKeypadHeight = keypad?.setKeypadHeight;

  useEffect(() => {
    if (!registerHost || !releaseHost) return;
    const mine = registerHost();
    setToken(mine);
    return () => releaseHost(mine);
  }, [registerHost, releaseHost]);

  const visible = request !== null && token !== null && token === activeHost;

  useEffect(() => {
    if (!visible || !close) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true; // consumed — never a navigation
    });
    return () => subscription.remove();
  }, [visible, close]);

  // React Native's own Animated, not reanimated: a fade-and-rise needs no
  // worklet, and the project has no reanimated jest mock configured.
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, {
      toValue: visible ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [visible, rise]);

  useEffect(() => {
    if (!visible) setKeypadHeight?.(0);
  }, [visible, setKeypadHeight]);

  // DEFENCE IN DEPTH for the effect immediately above, which fires only on a
  // `visible` TRANSITION and so cannot cover a host that is unmounted while
  // it is still the one drawing — a sheet dismissed with the panel open, or
  // the root host going away when AppShell swaps in the lock screen. The
  // authoritative fix is releaseHost in contexts/keypad_context.tsx (the only
  // place that knows a host died); this is the same guarantee stated where
  // the height is actually published, and the two are independent.
  //
  // GUARDED BY `visible`, because an INACTIVE host unmounting must not wipe
  // the height an active one just measured. `visibleRef` is read only from
  // the unmount path, where the last render's value is the value at unmount.
  // `setKeypadHeight` is a bare useState setter, so this effect's dependency
  // never changes and the cleanup runs on unmount and nowhere else.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(
    () => () => {
      if (visibleRef.current) setKeypadHeight?.(0);
    },
    [setKeypadHeight],
  );

  // Every hook above runs on every render, provider or not — this is the only
  // exit, and it is below all of them.
  if (keypad === null || !visible || request === null) return null;

  return (
    <Animated.View
      testID="keypad-host"
      onLayout={(event) => keypad.setKeypadHeight(event.nativeEvent.layout.height)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        opacity: rise,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
      }}
    >
      <View
        className="gap-3 rounded-t-3xl bg-bg p-4 dark:bg-bg-dark"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <View className="flex-row items-center justify-between">
          <Text testID="keypad-label" className="font-semibold text-fg dark:text-fg-dark">
            {request.label}
          </Text>
          <View className="flex-row items-center gap-2">
            {/* x and Done do the same thing. Two affordances because the panel
                reads as a dialog to some users and as a keyboard to others, and
                losing either group to a panel they cannot dismiss is worse than
                a small redundancy. Do NOT later make x a revert — that is an
                undo feature, and it turns two identical-looking buttons into a
                safe one and a destructive one with no cue telling them apart. */}
            <Pressable
              testID="keypad-close"
              accessibilityRole="button"
              accessibilityLabel="Close keypad"
              onPress={keypad.close}
              className="h-10 w-10 items-center justify-center rounded-full bg-surface dark:bg-surface-dark"
            >
              <X className="text-fg dark:text-fg-dark" size={18} />
            </Pressable>
            <Pressable
              testID="keypad-done"
              accessibilityRole="button"
              accessibilityLabel="Done"
              onPress={keypad.close}
              className="rounded-xl bg-brand px-4 py-2 dark:bg-brand-dark"
            >
              <Text className="font-semibold text-on-brand dark:text-on-brand-dark">Done</Text>
            </Pressable>
          </View>
        </View>

        <Text
          testID="keypad-display"
          className="text-center text-4xl font-bold text-fg dark:text-fg-dark"
        >
          {displayFor(request.mode, request.text)}
        </Text>

        <NumericKeypad
          mode={request.mode}
          // A SEEDED FIGURE IS REPLACED BY THE FIRST DIGIT, NOT APPENDED TO.
          // Detected income arrives as an average — ₱18,333.33 — which seeds
          // the field already at appendKey's two-decimal cap, and from there
          // appendKey refuses every digit, so the panel reads as dead. See
          // `untouched` in contexts/keypad_context.tsx for the full case;
          // `emit` is what clears the flag, so this reverts to plain
          // appending from the second key onward.
          onKey={(key) => keypad.emit(appendKey(request.untouched ? "" : request.text, key))}
          // NOT replaced: backspace edits the seeded figure in place, which
          // is what someone pressing it is asking for.
          onBackspace={() => keypad.emit(removeLastKey(request.text))}
          onClear={() => keypad.emit("")}
        />
      </View>
    </Animated.View>
  );
}

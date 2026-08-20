// mobile/contexts/keypad_context.tsx — W1 Task 3.
//
// TWO JOBS, AND THEY ARE GENUINELY SEPARATE.
//
// 1. WHICH FIELD IS FOCUSED. One at a time. Opening a second field while one
//    is open SWAPS the request rather than closing and reopening, because a
//    close/open animation between two adjacent amount fields reads as a
//    glitch rather than as focus moving.
//
// 2. WHICH HOST MAY DRAW. components/ui/bottom_sheet.tsx is built on the
//    platform Modal -- its own header says it is "its own native window: it
//    is NOT inside whatever View" rendered it -- so a panel hosted once at
//    the root renders BEHIND any open sheet. <KeypadHost /> is therefore
//    mountable more than once, each mount takes a monotonically increasing
//    token, and the highest live token wins. That is always the topmost
//    native window.
//
// WHY onChangeText LIVES IN A REF AND NOT IN STATE. Forms pass inline arrows,
// so the handler's identity changes on every render. Holding it in `request`
// would mean: provider re-renders -> field re-renders -> new arrow identity
// -> sync effect fires -> new request object -> provider re-renders. An
// infinite loop that only appears once a real form is wired up, which is
// exactly the kind of thing that ships. A ref write causes no re-render, so
// the cycle cannot start.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard } from "react-native";

import type { KeypadMode } from "@/components/ui/numeric_keypad";

export type KeypadRequest = {
  /** The focused field's testID. Identity, not decoration — the field compares against it. */
  fieldId: string;
  label: string;
  mode: KeypadMode;
  text: string;
  /**
   * The panel was seeded with `text` and no key has been pressed since.
   *
   * REPLACE-ON-FIRST-KEYSTROKE, AND IT IS NOT COSMETIC. `pesoInputFrom`
   * seeds an edit field from a stored amount, and a detected income is an
   * AVERAGE -- ₱18,333.33, not ₱18,000 -- so the seed usually arrives
   * already at the two-decimal cap. `appendKey`'s fraction rule then refuses
   * EVERY digit, and the user taps 0-9 on a panel that appears simply dead:
   * no error, no explanation. The first digit or decimal therefore starts a
   * fresh string instead of appending, which is what every amount UI does.
   *
   * BACKSPACE DOES NOT TRIGGER THE REPLACE. Someone pressing backspace is
   * deliberately editing the seeded figure; it edits normally and clears
   * this flag like any other key.
   *
   * IT LIVES HERE, NOT IN lib/money/peso_input.ts. That module is a pure
   * keystroke state machine over a string and has no idea where the string
   * came from — "seeded" is a fact about this focus session, so it belongs
   * to the request that opened it.
   */
  untouched: boolean;
};

/** What a field hands to `open` — `untouched` is the provider's to set. */
export type KeypadOpenRequest = Omit<KeypadRequest, "untouched"> & {
  onChangeText: (text: string) => void;
};

export type KeypadContextValue = {
  request: KeypadRequest | null;
  open: (request: KeypadOpenRequest) => void;
  close: () => void;
  /** The host calls this with the next text on every key. */
  emit: (text: string) => void;
  /** The focused field calls this so the panel never renders a stale value. */
  syncFocused: (fieldId: string, text: string, onChangeText: (text: string) => void) => void;
  registerHost: () => number;
  releaseHost: (token: number) => void;
  activeHost: number | null;
  keypadHeight: number;
  setKeypadHeight: (height: number) => void;
};

const KeypadContext = createContext<KeypadContextValue | null>(null);

export function KeypadProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<KeypadRequest | null>(null);
  const [hosts, setHosts] = useState<readonly number[]>([]);
  const [keypadHeight, setKeypadHeight] = useState(0);

  const onChangeRef = useRef<((text: string) => void) | null>(null);
  const nextTokenRef = useRef(1);

  const activeHost = hosts.length === 0 ? null : Math.max(...hosts);

  // Mirrors activeHost for releaseHost, which must know whether the host
  // going away is the one currently holding the panel — and cannot read the
  // post-update value of its own setState.
  const activeHostRef = useRef<number | null>(null);
  activeHostRef.current = activeHost;

  const open = useCallback(({ onChangeText, ...next }: KeypadOpenRequest) => {
    // ONLY ONE KEYBOARD IS EVER UP (owner's device report: "app opens numpad
    // user keyboard does not close by itself").
    //
    // components/ui/numeric_field.tsx is a Pressable and that is deliberate —
    // a component with no TextInput in its tree cannot raise the OS keyboard
    // however it is later edited. The same property is why it cannot BLUR one
    // either: nothing about pressing a Pressable touches focus. So a user
    // moving from a name field to an amount field got our panel stacked in
    // front of the OS keyboard, and had to dismiss the OS one by hand.
    //
    // HERE RATHER THAN IN THE FIELD, and rather than an `onFocus` on each of
    // the TextInputs across the nine forms that mix the two: this is the one
    // function every path to an open panel goes through, so "the OS keyboard
    // is down whenever ours is up" holds for a field added tomorrow too.
    //
    // SAFE ON A SWAP. Opening a second field while one is already open calls
    // this again, and dismissing an already-dismissed keyboard is a no-op.
    Keyboard.dismiss();
    onChangeRef.current = onChangeText;
    // Every open starts untouched, including one with an empty `text`: there
    // the replacement and the append are the same string, so nothing special
    // happens and there is no second case to reason about.
    setRequest({ ...next, untouched: true });
  }, []);

  const close = useCallback(() => {
    onChangeRef.current = null;
    setRequest(null);
  }, []);

  // THE RETURN TRIP: the OS keyboard coming up takes our panel down.
  //
  // `open` above covers "panel opens while the OS keyboard is up". This covers
  // the other order — panel already open on an amount, user taps a text field —
  // which is just as reachable on every one of the nine forms that mix the two
  // kinds of input, and leaves the same two-keyboard pile-up.
  //
  // A LISTENER, NOT AN onFocus ON EVERY TextInput. The OS raising its keyboard
  // is the actual event; subscribing to it means a TextInput added anywhere in
  // the app, in a screen or a sheet, is covered without knowing this file
  // exists.
  //
  // NO LOOP WITH `open`. That path calls `Keyboard.dismiss()`, which raises
  // `keyboardDidHide` — never `keyboardDidShow` — so it cannot re-enter here.
  //
  // `keyboardDidShow`, NOT `keyboardWillShow`: Android does not emit the
  // `will` events at all (react-native's own Keyboard docs), and Android is
  // this app's only platform today.
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () => {
      onChangeRef.current = null;
      setRequest(null);
    });
    // The provider is torn down and rebuilt on every lock/unlock — it is
    // mounted INSIDE the lock gate in app/_layout.tsx, deliberately — so an
    // un-removed listener would call setState on a dead tree once per keyboard
    // raise, for the rest of the process's life.
    return () => subscription.remove();
  }, []);

  const emit = useCallback((text: string) => {
    // ANY key ends the seeded state — digit, decimal, backspace or clear.
    // Backspace especially: `request.untouched` only decides whether the
    // NEXT digit replaces or appends, and someone who has already backspaced
    // into the seeded figure is editing it, not about to retype it.
    setRequest((current) => {
      // Same object when nothing moved, for the reason syncFocused documents.
      if (current === null || !current.untouched) return current;
      return { ...current, untouched: false };
    });
    onChangeRef.current?.(text);
  }, []);

  const syncFocused = useCallback(
    (fieldId: string, text: string, onChangeText: (next: string) => void) => {
      // Ref write first, and unconditionally: the handler may have a new
      // identity even when the text has not moved.
      onChangeRef.current = onChangeText;
      setRequest((current) => {
        if (current === null || current.fieldId !== fieldId) return current;
        // Returning the SAME object when nothing changed is what stops the
        // render loop described in this file's header.
        if (current.text === text) return current;
        return { ...current, text };
      });
    },
    [],
  );

  const registerHost = useCallback(() => {
    const token = nextTokenRef.current;
    nextTokenRef.current += 1;
    setHosts((previous) => [...previous, token]);
    return token;
  }, []);

  const releaseHost = useCallback((token: number) => {
    const wasActive = activeHostRef.current === token;
    setHosts((previous) => previous.filter((held) => held !== token));
    // A sheet closing while the keypad is open closes the keypad. Silently
    // re-parenting to the root host would leave a panel editing a field that
    // no longer exists.
    if (wasActive) {
      onChangeRef.current = null;
      setRequest(null);
      // AND THE HEIGHT GOES WITH IT. components/ui/keypad_host.tsx zeroes
      // this from an effect keyed on its own `visible`, which fires only on a
      // TRANSITION -- so when a sheet host takes the panel (root host already
      // went `visible: false` and already ran its effect) and is then
      // unmounted, nothing re-runs at the root and the last measured height
      // survives the panel. Two taps reach it: open the correct sheet, tap
      // the amount, tap the category row, dismiss the picker. Every consumer
      // then reserves a band for a panel that is gone -- ~380dp of dead space
      // under a sheet's Confirm (bottom_sheet.tsx), phantom bottom padding on
      // every form (form_screen.tsx), a footer floating ~330dp up
      // (onboarding_frame.tsx). This provider is the only place that knows a
      // host died, so it is the only place that can put the height back.
      setKeypadHeight(0);
    }
  }, []);

  const value = useMemo<KeypadContextValue>(
    () => ({
      request,
      open,
      close,
      emit,
      syncFocused,
      registerHost,
      releaseHost,
      activeHost,
      keypadHeight,
      setKeypadHeight,
    }),
    [request, open, close, emit, syncFocused, registerHost, releaseHost, activeHost, keypadHeight],
  );

  return <KeypadContext.Provider value={value}>{children}</KeypadContext.Provider>;
}

export function useKeypad(): KeypadContextValue {
  const context = useContext(KeypadContext);
  if (!context) throw new Error("useKeypad must be used within KeypadProvider");
  return context;
}

/**
 * The same read, answering `null` instead of throwing.
 *
 * FOR HOSTS ONLY, and it exists because of one mount point:
 * components/ui/bottom_sheet.tsx renders a <KeypadHost /> inside its Modal,
 * and BottomSheet is a shared primitive that dozens of suites mount on its
 * own, with no app around it. A throwing read there would make KeypadProvider
 * a hard dependency of every sheet render in the codebase — the provider is
 * mounted once in app/_layout.tsx, so on a real device the host always finds
 * it, and a suite rendering a lone sheet is asking a question the keypad is
 * not part of.
 *
 * FIELDS MUST KEEP USING useKeypad. A field that silently no-ops when the
 * provider is missing is a number the user typed and the app never saw; that
 * one deserves the loud crash.
 */
export function useKeypadOptional(): KeypadContextValue | null {
  return useContext(KeypadContext);
}

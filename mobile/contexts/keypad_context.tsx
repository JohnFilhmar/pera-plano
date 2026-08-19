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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { KeypadMode } from "@/components/ui/numeric_keypad";

export type KeypadRequest = {
  /** The focused field's testID. Identity, not decoration — the field compares against it. */
  fieldId: string;
  label: string;
  mode: KeypadMode;
  text: string;
};

export type KeypadContextValue = {
  request: KeypadRequest | null;
  open: (request: KeypadRequest & { onChangeText: (text: string) => void }) => void;
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

  const open = useCallback(
    ({ onChangeText, ...next }: KeypadRequest & { onChangeText: (text: string) => void }) => {
      onChangeRef.current = onChangeText;
      setRequest(next);
    },
    [],
  );

  const close = useCallback(() => {
    onChangeRef.current = null;
    setRequest(null);
  }, []);

  const emit = useCallback((text: string) => {
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

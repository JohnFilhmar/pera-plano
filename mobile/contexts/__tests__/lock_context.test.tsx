// contexts/__tests__/lock_context.test.tsx — the app-lock state machine
// (docs/12-encryption-and-app-lock.md §7, §7a's sibling §11a; contract §10;
// task-9-brief.md). Every dependency below is mocked with a factory that
// hands back its own jest.fn()s directly -- no jest.spyOn on top of an
// import -- which is the pattern key_manager.test.ts already established as
// safe against the Jest/Babel namespace-import trap that file documents
// (that trap only bites jest.spyOn on a namespace import of a module
// lacking `__esModule`; a factory-provided jest.fn(), imported the same way
// on both sides, never hits it).
//
// react-native's AppState is mocked via a Proxy over jest.requireActual, not
// a plain `{...actual}` spread -- see contexts/__tests__/theme_context.test.tsx's
// identical note: spreading eagerly evaluates every lazy getter on the real
// module, including native-only exports that crash outside a real app.
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const listeners: Array<(state: string) => void> = [];
  const mockAppState = {
    currentState: "active",
    addEventListener: jest.fn((_event: string, cb: (state: string) => void) => {
      listeners.push(cb);
      return {
        remove: jest.fn(() => {
          const idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
        }),
      };
    }),
    __emit: (state: string) => {
      for (const cb of [...listeners]) cb(state);
    },
    __listenerCount: () => listeners.length,
  };
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === "AppState") return mockAppState;
      return Reflect.get(target, prop, receiver);
    },
  });
});

jest.mock("expo-local-authentication", () => ({
  authenticateAsync: jest.fn(),
}));

jest.mock("@/lib/crypto/key_manager", () => {
  class RecoveryUnlockFailedError extends Error {
    constructor() {
      super("unable to unlock with the provided recovery phrase");
      this.name = "RecoveryUnlockFailedError";
    }
  }
  return {
    getKeyState: jest.fn(),
    unlockWithDeviceKey: jest.fn(),
    unlockWithRecoveryPhrase: jest.fn(),
    rewrapAfterInvalidation: jest.fn(),
    lock: jest.fn(),
    RecoveryUnlockFailedError,
  };
});

jest.mock("@/lib/db/database", () => ({
  unlockDatabase: jest.fn(),
  closeDatabase: jest.fn(),
}));

jest.mock("@/lib/query_client", () => ({
  setCacheEncryptionKey: jest.fn(),
  clearCacheEncryptionKey: jest.fn(),
}));

jest.mock("@/lib/security/wipe", () => ({
  wipeAndStartOver: jest.fn(),
}));

// The real classes' shape (code/name), redeclared here rather than imported
// from the real module -- @/modules/notification_listener's top-level
// requireNativeModule() call throws under Jest with no native registration,
// so the module itself must be mocked, and this factory IS that mock. Both
// this test file's `import` and lock_context.tsx's `import` resolve to this
// SAME module instance, so `instanceof` checks in the code under test match
// exactly what this file throws.
jest.mock("@/modules/notification_listener", () => {
  class DeviceKeyMissingError extends Error {
    code = "DeviceKeyMissing";
    constructor(message = "the device key has not been created yet") {
      super(message);
      this.name = "DeviceKeyMissingError";
    }
  }
  class DeviceKeyInvalidatedError extends Error {
    code = "DeviceKeyInvalidated";
    constructor(message = "the device key has been permanently invalidated") {
      super(message);
      this.name = "DeviceKeyInvalidatedError";
    }
  }
  class NotAuthenticatedError extends Error {
    code = "NotAuthenticated";
    constructor(message = "authentication is required to complete this operation") {
      super(message);
      this.name = "NotAuthenticatedError";
    }
  }
  return {
    DeviceKeyMissingError,
    DeviceKeyInvalidatedError,
    NotAuthenticatedError,
    isDeviceSecure: jest.fn(),
  };
});

import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { authenticateAsync } from "expo-local-authentication";
import * as KeyManager from "@/lib/crypto/key_manager";
import * as Database from "@/lib/db/database";
import * as QueryCache from "@/lib/query_client";
import { wipeAndStartOver } from "@/lib/security/wipe";
import {
  DeviceKeyMissingError,
  DeviceKeyInvalidatedError,
  NotAuthenticatedError,
  isDeviceSecure,
} from "@/modules/notification_listener";
import { LockProvider, useLock } from "../lock_context";

const mockAuthenticateAsync = authenticateAsync as jest.Mock;
const mockGetKeyState = KeyManager.getKeyState as jest.Mock;
const mockUnlockWithDeviceKey = KeyManager.unlockWithDeviceKey as jest.Mock;
const mockRewrapAfterInvalidation = KeyManager.rewrapAfterInvalidation as jest.Mock;
const mockKeyManagerLock = KeyManager.lock as jest.Mock;
const mockUnlockDatabase = Database.unlockDatabase as jest.Mock;
const mockCloseDatabase = Database.closeDatabase as jest.Mock;
const mockSetCacheEncryptionKey = QueryCache.setCacheEncryptionKey as jest.Mock;
const mockClearCacheEncryptionKey = QueryCache.clearCacheEncryptionKey as jest.Mock;
const mockWipeAndStartOver = wipeAndStartOver as jest.Mock;
const mockIsDeviceSecure = isDeviceSecure as jest.Mock;

const DEK = new Uint8Array(32).fill(0x42);
const PHRASE = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

const wrapper = ({ children }: { children: ReactNode }) => (
  <LockProvider>{children}</LockProvider>
);

function emitAppState(state: "active" | "background") {
  (AppState as unknown as { __emit: (s: string) => void }).__emit(state);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetKeyState.mockResolvedValue("locked");
  mockAuthenticateAsync.mockResolvedValue({ success: true });
  mockUnlockWithDeviceKey.mockResolvedValue(DEK);
  mockUnlockDatabase.mockResolvedValue(undefined);
  mockCloseDatabase.mockResolvedValue(undefined);
  mockRewrapAfterInvalidation.mockResolvedValue(DEK);
  mockWipeAndStartOver.mockResolvedValue(undefined);
  // Secure by default so every pre-existing submitRecoveryPhrase() test
  // above continues to reach rewrapAfterInvalidation unchanged; the
  // "needs_device_lock" describe block below overrides this per-test.
  mockIsDeviceSecure.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Cold start
// ---------------------------------------------------------------------------

describe("cold start", () => {
  test("starts in \"checking\" before getKeyState resolves", async () => {
    let resolveKeyState!: (state: string) => void;
    mockGetKeyState.mockReturnValue(
      new Promise((resolve) => {
        resolveKeyState = resolve;
      }),
    );

    const { result } = renderHook(() => useLock(), { wrapper });
    expect(result.current.status).toBe("checking");

    await act(async () => {
      resolveKeyState("locked");
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  test("a first-run device (getKeyState uninitialized) goes straight to needs_onboarding, never locked", async () => {
    mockGetKeyState.mockResolvedValue("uninitialized");

    const { result } = renderHook(() => useLock(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("needs_onboarding"));
  });

  test("an already-provisioned device (getKeyState locked) lands on the lock screen, requiring a fresh unlock", async () => {
    mockGetKeyState.mockResolvedValue("locked");

    const { result } = renderHook(() => useLock(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("locked"));
    expect(mockUnlockWithDeviceKey).not.toHaveBeenCalled();
  });

  test("even if key_manager already holds the DEK in memory (getKeyState unlocked), cold start still requires a fresh unlock -- it never trusts a pre-existing in-memory DEK", async () => {
    mockGetKeyState.mockResolvedValue("unlocked");

    const { result } = renderHook(() => useLock(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("locked"));
  });
});

// ---------------------------------------------------------------------------
// unlock() -- the device-key path
// ---------------------------------------------------------------------------

describe("unlock()", () => {
  test("runs the three-step sequence IN ORDER: authenticate, get the DEK, unlockDatabase(dek), THEN setCacheEncryptionKey(dek)", async () => {
    const order: string[] = [];
    mockAuthenticateAsync.mockImplementation(async () => {
      order.push("authenticate");
      return { success: true };
    });
    mockUnlockWithDeviceKey.mockImplementation(async () => {
      order.push("getDek");
      return DEK;
    });
    mockUnlockDatabase.mockImplementation(async () => {
      order.push("unlockDatabase");
    });
    mockSetCacheEncryptionKey.mockImplementation(() => {
      order.push("setCacheEncryptionKey");
    });

    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));

    await act(async () => {
      await result.current.unlock();
    });

    expect(order).toEqual(["authenticate", "getDek", "unlockDatabase", "setCacheEncryptionKey"]);
    expect(result.current.status).toBe("unlocked");
  });

  test("never biometric-only: authenticateAsync is called with device-credential fallback enabled", async () => {
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockAuthenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });

  test("a cancelled/failed system prompt stays locked and never attempts the DEK unwrap", async () => {
    mockAuthenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" });
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));

    await act(async () => {
      await result.current.unlock();
    });

    expect(result.current.status).toBe("locked");
    expect(mockUnlockWithDeviceKey).not.toHaveBeenCalled();
    expect(mockUnlockDatabase).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBeTruthy();
  });

  test("DeviceKeyMissingError routes to needs_onboarding, never a recovery prompt for words the user has never seen", async () => {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyMissingError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));

    await act(async () => {
      await result.current.unlock();
    });

    expect(result.current.status).toBe("needs_onboarding");
  });

  test("DeviceKeyInvalidatedError routes to needs_recovery, not a generic error", async () => {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyInvalidatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));

    await act(async () => {
      await result.current.unlock();
    });

    expect(result.current.status).toBe("needs_recovery");
  });

  test("NotAuthenticatedError is treated as a re-promptable retry, not a failure -- stays locked, no database/cache calls", async () => {
    mockUnlockWithDeviceKey.mockRejectedValue(new NotAuthenticatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));

    await act(async () => {
      await result.current.unlock();
    });

    expect(result.current.status).toBe("locked");
    expect(mockUnlockDatabase).not.toHaveBeenCalled();
    expect(mockSetCacheEncryptionKey).not.toHaveBeenCalled();
  });

  test("a second unlock() call while the first is still in flight does not trigger a second authentication prompt (no double-tap)", async () => {
    let resolveAuth!: (value: { success: boolean }) => void;
    mockAuthenticateAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveAuth = resolve;
      }),
    );
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));

    let firstDone = false;
    let secondDone = false;
    act(() => {
      void result.current.unlock().then(() => {
        firstDone = true;
      });
      void result.current.unlock().then(() => {
        secondDone = true;
      });
    });

    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAuth({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(firstDone).toBe(true));
    expect(secondDone).toBe(true);
    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1);
  });

  test("an unexpected error stays locked with a generic message -- never the raw error text (no key material leaks into UI copy)", async () => {
    mockUnlockWithDeviceKey.mockRejectedValue(new Error("some internal detail"));
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));

    await act(async () => {
      await result.current.unlock();
    });

    expect(result.current.status).toBe("locked");
    expect(result.current.errorMessage).not.toContain("some internal detail");
  });
});

// ---------------------------------------------------------------------------
// Recovery-phrase submission
// ---------------------------------------------------------------------------

describe("submitRecoveryPhrase()", () => {
  async function arriveAtNeedsRecovery() {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyInvalidatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("needs_recovery"));
    return result;
  }

  test("a successful recovery calls rewrapAfterInvalidation (never a second, redundant unlockWithRecoveryPhrase call) then the same three-step unlock sequence", async () => {
    const result = await arriveAtNeedsRecovery();
    const mockUnlockWithRecoveryPhrase = KeyManager.unlockWithRecoveryPhrase as jest.Mock;

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(mockRewrapAfterInvalidation).toHaveBeenCalledWith(PHRASE);
    expect(mockUnlockWithRecoveryPhrase).not.toHaveBeenCalled();
    expect(mockUnlockDatabase).toHaveBeenCalledWith(DEK);
    expect(mockSetCacheEncryptionKey).toHaveBeenCalledWith(DEK);
    expect(result.current.status).toBe("unlocked");
  });

  test("a wrong phrase stays on needs_recovery with an error, and does NOT loop or auto-retry", async () => {
    const result = await arriveAtNeedsRecovery();
    mockRewrapAfterInvalidation.mockRejectedValue(new KeyManager.RecoveryUnlockFailedError());

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(result.current.status).toBe("needs_recovery");
    expect(result.current.errorMessage).toBeTruthy();
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledTimes(1);

    // Nothing here re-invokes rewrapAfterInvalidation on its own -- a second
    // attempt requires a NEW explicit submitRecoveryPhrase call.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledTimes(1);
  });

  test("a second submit while the first is still in flight does not run rewrapAfterInvalidation twice", async () => {
    const result = await arriveAtNeedsRecovery();
    let resolveRewrap!: (dek: Uint8Array) => void;
    mockRewrapAfterInvalidation.mockReturnValue(
      new Promise((resolve) => {
        resolveRewrap = resolve;
      }),
    );

    await act(async () => {
      void result.current.submitRecoveryPhrase(PHRASE);
      void result.current.submitRecoveryPhrase(PHRASE);
      // Let the isDeviceSecure() await (task-9a-brief) resolve before
      // asserting -- rewrapAfterInvalidation is no longer the very first
      // thing this function does.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRewrapAfterInvalidation).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRewrap(DEK);
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});

// ---------------------------------------------------------------------------
// The device-screen-lock gate inside submitRecoveryPhrase() (task-9a-brief
// rule 5; docs §5a's "mid-life removal" paragraph) -- wiring Task 9's TODO.
// recreateDeviceKek() (inside rewrapAfterInvalidation) cannot create a new
// auth-gated Keystore key on a device with no screen lock present, so this
// must be checked and routed BEFORE rewrapAfterInvalidation is ever called.
// ---------------------------------------------------------------------------

describe("submitRecoveryPhrase() routes an insecure device to needs_device_lock first", () => {
  async function arriveAtNeedsRecovery() {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyInvalidatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("needs_recovery"));
    return result;
  }

  test("an insecure device is routed to needs_device_lock, and rewrapAfterInvalidation is never called", async () => {
    mockIsDeviceSecure.mockResolvedValue(false);
    const result = await arriveAtNeedsRecovery();

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(result.current.status).toBe("needs_device_lock");
    // The discriminating assertion: a version of this gate that checked
    // isDeviceSecure() but still called rewrapAfterInvalidation anyway (or
    // never checked at all) would attempt to recreate a Keystore key with no
    // screen lock present -- exactly the failure docs §5a says has no
    // fallback that preserves the security claim.
    expect(mockRewrapAfterInvalidation).not.toHaveBeenCalled();
    expect(mockUnlockDatabase).not.toHaveBeenCalled();
  });

  test("a secure device proceeds straight to rewrapAfterInvalidation, never needs_device_lock", async () => {
    mockIsDeviceSecure.mockResolvedValue(true);
    const result = await arriveAtNeedsRecovery();

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(result.current.status).toBe("unlocked");
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledWith(PHRASE);
  });

  test("returning still-insecure stays on needs_device_lock -- no auto-advance, no auto-retry of rewrapAfterInvalidation", async () => {
    mockIsDeviceSecure.mockResolvedValue(false);
    const result = await arriveAtNeedsRecovery();
    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });
    await waitFor(() => expect(result.current.status).toBe("needs_device_lock"));

    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("needs_device_lock");
    expect(mockRewrapAfterInvalidation).not.toHaveBeenCalled();
  });

  test("returning secure moves back to needs_recovery -- NOT straight to unlocked, since the phrase was never retained", async () => {
    mockIsDeviceSecure.mockResolvedValue(false);
    const result = await arriveAtNeedsRecovery();
    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });
    await waitFor(() => expect(result.current.status).toBe("needs_device_lock"));

    mockIsDeviceSecure.mockResolvedValue(true);
    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("needs_recovery");
    // Still never called -- moving to needs_recovery must not itself spend
    // a phrase that was never stored anywhere in this context.
    expect(mockRewrapAfterInvalidation).not.toHaveBeenCalled();

    // A FRESH explicit submit (this time secure) now succeeds normally.
    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });
    expect(result.current.status).toBe("unlocked");
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledWith(PHRASE);
  });

  test("a background transition alone (never returning to active) never rechecks isDeviceSecure while needs_device_lock", async () => {
    mockIsDeviceSecure.mockResolvedValue(false);
    const result = await arriveAtNeedsRecovery();
    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });
    await waitFor(() => expect(result.current.status).toBe("needs_device_lock"));
    mockIsDeviceSecure.mockClear();

    act(() => emitAppState("background"));

    expect(mockIsDeviceSecure).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// wipeAndStartOver() -- the §11a unrecoverable-state escape hatch
// ---------------------------------------------------------------------------

describe("wipeAndStartOver()", () => {
  test("invokes the wipe primitive and routes to needs_onboarding", async () => {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyInvalidatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("needs_recovery"));

    await act(async () => {
      await result.current.wipeAndStartOver();
    });

    expect(mockWipeAndStartOver).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("needs_onboarding");
  });

  test("a rapid second call while the first is still in flight does not start a second wipe cycle", async () => {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyInvalidatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("needs_recovery"));

    let resolveWipe!: () => void;
    mockWipeAndStartOver.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveWipe = resolve;
      }),
    );

    act(() => {
      void result.current.wipeAndStartOver();
      void result.current.wipeAndStartOver();
    });
    expect(mockWipeAndStartOver).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWipe();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockWipeAndStartOver).toHaveBeenCalledTimes(1);
  });

  // The DOUBLE CONFIRMATION requirement itself (one confirmation alone must
  // destroy nothing) is a UI-level property of RecoveryUnlockForm, which
  // only ever calls this context function once both confirmations have
  // happened -- see components/lock/__tests__/recovery_unlock_form.test.tsx.
  // This context-level test only pins that the underlying action, once
  // actually invoked, does the right thing -- it is not itself the gate.
});

// ---------------------------------------------------------------------------
// Background timeout -- five minutes, measured from when the app
// backgrounded, never from "last interaction" (there is no such signal
// anywhere in this file).
// ---------------------------------------------------------------------------

describe("background timeout", () => {
  async function arriveAtUnlocked() {
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("unlocked"));
    return result;
  }

  test("four minutes in the background does NOT re-lock", async () => {
    const result = await arriveAtUnlocked();
    const nowSpy = jest.spyOn(Date, "now");
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);

    act(() => emitAppState("background"));
    nowSpy.mockReturnValue(t0 + 4 * 60 * 1000);
    act(() => emitAppState("active"));

    expect(result.current.status).toBe("unlocked");
    expect(mockCloseDatabase).not.toHaveBeenCalled();
    expect(mockClearCacheEncryptionKey).not.toHaveBeenCalled();
    expect(mockKeyManagerLock).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  test("six minutes in the background DOES re-lock, tearing down all three: database, cache key, and DEK", async () => {
    const result = await arriveAtUnlocked();
    const nowSpy = jest.spyOn(Date, "now");
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);

    act(() => emitAppState("background"));
    nowSpy.mockReturnValue(t0 + 6 * 60 * 1000);
    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.status).toBe("locked"));
    expect(mockClearCacheEncryptionKey).toHaveBeenCalledTimes(1);
    expect(mockCloseDatabase).toHaveBeenCalledTimes(1);
    expect(mockKeyManagerLock).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  test("exactly five minutes re-locks -- the threshold is inclusive, not a moment later", async () => {
    const result = await arriveAtUnlocked();
    const nowSpy = jest.spyOn(Date, "now");
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);

    act(() => emitAppState("background"));
    nowSpy.mockReturnValue(t0 + 5 * 60 * 1000);
    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.status).toBe("locked"));
    nowSpy.mockRestore();
  });

  test("re-locking after the timeout requires a brand-new unlock() call -- there is no silent auto-resume", async () => {
    const result = await arriveAtUnlocked();
    const nowSpy = jest.spyOn(Date, "now");
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);
    act(() => emitAppState("background"));
    nowSpy.mockReturnValue(t0 + 6 * 60 * 1000);
    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    nowSpy.mockRestore();

    mockUnlockWithDeviceKey.mockClear();
    expect(mockUnlockWithDeviceKey).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.unlock();
    });
    expect(mockUnlockWithDeviceKey).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("unlocked");
  });

  test("backgrounding while already locked (never unlocked yet) does not attempt any teardown", async () => {
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_700_000_000_000);
    act(() => emitAppState("background"));
    nowSpy.mockReturnValue(1_700_000_000_000 + 10 * 60 * 1000);
    act(() => emitAppState("active"));

    expect(mockCloseDatabase).not.toHaveBeenCalled();
    expect(mockKeyManagerLock).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});

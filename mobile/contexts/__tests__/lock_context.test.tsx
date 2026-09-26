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

// `queryClient` is a stub object rather than the real client for the same
// reason the two key functions are jest.fn()s: every describe above asserts
// WHICH teardown steps lockNow() ran and in what order, and the real client
// would drag its persister and the cache cipher into all of them. The last
// describe in this file is the one that routes back to the real module, and
// it never reads `queryClient`.
jest.mock("@/lib/query_client", () => ({
  setCacheEncryptionKey: jest.fn(),
  clearCacheEncryptionKey: jest.fn(),
  queryClient: { clear: jest.fn() },
}));

// GAP-072 added a second consumer of the DEK on exactly the same lifecycle.
// Mocked for the same reason the query cache is: these tests assert WHICH
// teardown steps ran and in what order, not what AES does.
jest.mock("@/lib/crypto/attachment_cipher", () => ({
  setAttachmentKey: jest.fn(),
  clearAttachmentKey: jest.fn(),
}));

// `WipeIncompleteError` is redeclared here rather than imported from the real
// module, the same shape the key_manager factory above uses: this factory IS
// the module lock_context.tsx imports, so the class the test throws and the
// class the `instanceof` check reads are the same one. lib/security/__tests__/
// wipe.test.ts is what pins the REAL wipeAndStartOver to actually throw this
// type for a post-database failure and NOT for a wipeDatabase() one — without
// that file the two tests below would only be describing a fiction this
// factory invented.
jest.mock("@/lib/security/wipe", () => {
  class WipeIncompleteError extends Error {
    readonly cause: unknown;

    constructor(cause: unknown) {
      super(cause instanceof Error ? cause.message : String(cause));
      this.name = "WipeIncompleteError";
      this.cause = cause;
    }
  }
  return {
    wipeAndStartOver: jest.fn(),
    WipeIncompleteError,
  };
});

// Keeps jest_setup.ts's real Node CSPRNG and adds a one-shot park, so the
// last describe in this file can hold a persisted-cache write suspended on
// the exact await it parks on for real (cache_cipher.ts's nonce draw) while
// the background timeout tears the DEK down underneath it. Controls live in
// the factory's own closure, not behind jest.spyOn -- see
// lib/crypto/__tests__/key_manager.test.ts's note on the namespace-import
// trap that makes a spy on a mocked module silently miss.
jest.mock("expo-crypto", () => {
  let parkNextDraw = false;
  let releaseDraw: (() => void) | null = null;
  let announceParked: (() => void) | null = null;
  return {
    randomUUID: () => require("crypto").randomUUID(),
    getRandomBytesAsync: async (byteCount: number) => {
      const bytes = new Uint8Array(require("crypto").randomBytes(byteCount));
      if (parkNextDraw) {
        parkNextDraw = false;
        await new Promise<void>((resolve) => {
          releaseDraw = resolve;
          announceParked?.();
          announceParked = null;
        });
      }
      return bytes;
    },
    __parkNextNonceDraw: () =>
      new Promise<void>((resolve) => {
        parkNextDraw = true;
        announceParked = resolve;
      }),
    __releaseParkedNonceDraw: () => {
      releaseDraw?.();
      releaseDraw = null;
    },
  };
});

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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { gcm } from "@noble/ciphers/aes.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import * as Crypto from "expo-crypto";
import { authenticateAsync } from "expo-local-authentication";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import * as KeyManager from "@/lib/crypto/key_manager";
import * as Database from "@/lib/db/database";
import * as AttachmentCipher from "@/lib/crypto/attachment_cipher";
import { onAppEvent } from "@/lib/events/app_events";
import * as QueryCache from "@/lib/query_client";
import { wipeAndStartOver, WipeIncompleteError } from "@/lib/security/wipe";
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
const mockQueryClientClear = QueryCache.queryClient.clear as jest.Mock;
const mockSetAttachmentKey = AttachmentCipher.setAttachmentKey as jest.Mock;
const mockClearAttachmentKey = AttachmentCipher.clearAttachmentKey as jest.Mock;
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

  // GAP-034. A REJECTION AND "locked" ARE NOT THE SAME ANSWER, and mapping the
  // first onto the second is what bricked the app: "locked" renders an Unlock
  // button whose unwrap reads the same SecureStore that just threw, so a
  // persistent failure (some OEM Keystore states) failed forever with generic
  // copy, and the only wipe affordance lived under "needs_recovery".
  test("a REJECTED getKeyState goes to storage_error, never to locked", async () => {
    mockGetKeyState.mockRejectedValue(new Error("SecureStore unavailable"));

    const { result } = renderHook(() => useLock(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("storage_error"));
    // The screen owns the explanation, so there is nothing to say above it
    // until a retry has also failed.
    expect(result.current.errorMessage).toBeNull();
    expect(mockUnlockWithDeviceKey).not.toHaveBeenCalled();
  });

  test("retryKeyState recovers from storage_error when the read starts working again", async () => {
    mockGetKeyState.mockRejectedValueOnce(new Error("SecureStore unavailable"));

    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("storage_error"));

    mockGetKeyState.mockResolvedValue("locked");
    await act(async () => {
      await result.current.retryKeyState();
    });

    expect(result.current.status).toBe("locked");
    expect(result.current.errorMessage).toBeNull();
  });

  test("a first-run device whose key state only became readable on the retry still reaches onboarding, not the lock screen", async () => {
    mockGetKeyState.mockRejectedValueOnce(new Error("SecureStore unavailable"));

    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("storage_error"));

    mockGetKeyState.mockResolvedValue("uninitialized");
    await act(async () => {
      await result.current.retryKeyState();
    });

    expect(result.current.status).toBe("needs_onboarding");
  });

  test("a retry that fails again stays on storage_error and says so, so the button is not silently inert", async () => {
    mockGetKeyState.mockRejectedValue(new Error("SecureStore unavailable"));

    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("storage_error"));

    await act(async () => {
      await result.current.retryKeyState();
    });

    expect(result.current.status).toBe("storage_error");
    expect(result.current.errorMessage).toMatch(/Still no answer from secure storage/);
  });

  test("retryKeyState never rejects, whatever getKeyState throws", async () => {
    mockGetKeyState.mockRejectedValue(new Error("SecureStore unavailable"));

    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("storage_error"));

    await act(async () => {
      await expect(result.current.retryKeyState()).resolves.toBeUndefined();
    });
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
// THE AUTHENTICATION WINDOW ON THE RECOVERY PATH
// (docs/12-encryption-and-app-lock.md §7; modules/notification_listener's
// rejection taxonomy). rewrapAfterInvalidation() runs recreateDeviceKek() and
// then wrapWithDeviceKek() -- the same auth-gated Keystore key, usable only
// for ~10s after the user passes a system challenge, and nothing raises that
// challenge just because Kotlin code reaches for the key. unlock() is reached
// BY authenticating; this path is reached by TYPING TWELVE WORDS, so until
// this fix nothing had opened the window at all. The identical omission in
// onboarding (commit e3ec7cb) failed every single time on a physical Samsung
// A54; only the fact that this path needs a REMOVED SCREEN LOCK to reach kept
// that device session from finding it here too.
// ---------------------------------------------------------------------------

describe("submitRecoveryPhrase() authenticates before the auth-gated rewrap", () => {
  async function arriveAtNeedsRecovery() {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyInvalidatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("needs_recovery"));
    // unlock() authenticated to GET here; clear that call so every count
    // below is about the recovery path alone.
    mockAuthenticateAsync.mockClear();
    return result;
  }

  test("raises the system authentication prompt BEFORE rewrapAfterInvalidation, not after it", async () => {
    const result = await arriveAtNeedsRecovery();

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1);
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledTimes(1);
    // ORDER, not mere presence. A prompt raised after the call it exists to
    // open the Keystore window for is exactly as useless as no prompt at
    // all, and "both were called" cannot tell those two apart.
    expect(mockAuthenticateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mockRewrapAfterInvalidation.mock.invocationCallOrder[0],
    );
    expect(result.current.status).toBe("unlocked");
  });

  test("never asks for biometric-only -- a user whose fingerprint enrollment died with their old screen lock can still recover with their PIN", async () => {
    const result = await arriveAtNeedsRecovery();

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    // Same pin as unlock() (task-9-brief rule 2 / contract §10). This user's
    // screen lock was just removed and re-created, so a device
    // PIN/pattern/password is frequently the only credential they have left.
    expect(mockAuthenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });

  test("a cancelled prompt never calls rewrapAfterInvalidation, never reaches unlocked, and never discards the phrase the user typed", async () => {
    const result = await arriveAtNeedsRecovery();
    mockAuthenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" });

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(mockRewrapAfterInvalidation).not.toHaveBeenCalled();
    expect(mockUnlockDatabase).not.toHaveBeenCalled();
    expect(mockSetCacheEncryptionKey).not.toHaveBeenCalled();
    expect(result.current.status).not.toBe("unlocked");
    // THE ONE THAT MATTERS FOR THE TYPED WORDS. This context never holds the
    // phrase -- RecoveryUnlockForm's own TextInput does -- so "the words are
    // still in the box" IS "the status still renders RecoveryUnlockForm"
    // (app/lock.tsx). Any other status (needs_device_lock, locked,
    // needs_onboarding) unmounts that form and silently throws away twelve
    // words the user just copied off paper.
    expect(result.current.status).toBe("needs_recovery");
    expect(result.current.errorMessage).toBeTruthy();

    // And the form is genuinely usable again, not merely still on screen: a
    // second, successful attempt gets the SAME phrase into the same call.
    mockAuthenticateAsync.mockResolvedValue({ success: true });
    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledTimes(1);
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledWith(PHRASE);
    expect(result.current.status).toBe("unlocked");
  });

  test("a NotAuthenticatedError re-prompts once and retries the SAME call with the SAME phrase", async () => {
    const result = await arriveAtNeedsRecovery();
    // The ~10s window can expire between the prompt and the call -- a slow or
    // interrupted user. The module's contract for this rejection is explicit:
    // re-prompt and retry the same call.
    mockRewrapAfterInvalidation.mockRejectedValueOnce(new NotAuthenticatedError());

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(2);
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledTimes(2);
    // The identical array instance, not a fresh phrase that happens to
    // compare equal -- the retry is the SAME call, re-issued.
    expect(mockRewrapAfterInvalidation.mock.calls[1][0]).toBe(
      mockRewrapAfterInvalidation.mock.calls[0][0],
    );
    expect(mockRewrapAfterInvalidation).toHaveBeenLastCalledWith(PHRASE);
    // The second prompt is raised BEFORE the retry, for the same reason the
    // first one is raised before the first attempt.
    expect(mockAuthenticateAsync.mock.invocationCallOrder[1]).toBeLessThan(
      mockRewrapAfterInvalidation.mock.invocationCallOrder[1],
    );
    expect(result.current.status).toBe("unlocked");
  });

  test("a cancelled RE-prompt still keeps the phrase and never reaches unlocked", async () => {
    const result = await arriveAtNeedsRecovery();
    mockRewrapAfterInvalidation.mockRejectedValueOnce(new NotAuthenticatedError());
    // A counter rather than mockResolvedValueOnce: a once-queue survives
    // jest.clearAllMocks() (which only clears usage data), so an unconsumed
    // entry would leak into the NEXT test's unlock(). A plain
    // mockImplementation is replaced outright by beforeEach's mockResolvedValue.
    let prompts = 0;
    mockAuthenticateAsync.mockImplementation(async () => {
      prompts += 1;
      return prompts === 1 ? { success: true } : { success: false, error: "user_cancel" };
    });

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(2);
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("needs_recovery");
    expect(result.current.errorMessage).toBeTruthy();
    expect(mockUnlockDatabase).not.toHaveBeenCalled();
  });

  test("a second NotAuthenticatedError gives up instead of prompting forever", async () => {
    const result = await arriveAtNeedsRecovery();
    mockRewrapAfterInvalidation.mockRejectedValue(new NotAuthenticatedError());

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    // Bounded at exactly one re-prompt. "A forever-looping recovery" is a bug
    // shape this codebase has already shipped once (see lock_context.tsx's
    // "WHY NO AUTO-RETRY LOOP ANYWHERE HERE"); an unescapable prompt loop on
    // the screen standing between a user and all of their data is the worst
    // possible place for a second one.
    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(2);
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("needs_recovery");

    // Nothing re-invokes itself afterwards either -- a third attempt needs a
    // NEW explicit submit.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(2);
    expect(mockRewrapAfterInvalidation).toHaveBeenCalledTimes(2);
  });

  test("a NotAuthenticatedError never produces the generic \"Something went wrong\" copy -- it names the one failure whose remedy is known", async () => {
    const result = await arriveAtNeedsRecovery();
    mockRewrapAfterInvalidation.mockRejectedValue(new NotAuthenticatedError());

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(result.current.errorMessage).toBeTruthy();
    // The discriminating assertion: this rejection used to fall into the
    // catch-all bucket, so the user was told "something went wrong" about a
    // failure whose cause AND remedy are both perfectly well known.
    expect(result.current.errorMessage).not.toBe("Something went wrong. Try again.");
    // And it must never be mistaken for the wrong-words message either --
    // that one sends the user hunting for a typo that does not exist.
    expect(result.current.errorMessage).not.toBe(
      "That recovery phrase doesn't match. Check the words and try again.",
    );
  });

  test("an insecure device is still routed to needs_device_lock without ever raising a prompt it has no credential to satisfy", async () => {
    mockIsDeviceSecure.mockResolvedValue(false);
    const result = await arriveAtNeedsRecovery();

    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });

    expect(result.current.status).toBe("needs_device_lock");
    expect(mockAuthenticateAsync).not.toHaveBeenCalled();
    expect(mockRewrapAfterInvalidation).not.toHaveBeenCalled();
  });

  test("every OTHER failure keeps today's copy -- a wrong phrase still says so, and an unexpected error is still generic", async () => {
    const result = await arriveAtNeedsRecovery();

    mockRewrapAfterInvalidation.mockRejectedValueOnce(new KeyManager.RecoveryUnlockFailedError());
    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });
    expect(result.current.errorMessage).toBe(
      "That recovery phrase doesn't match. Check the words and try again.",
    );

    mockRewrapAfterInvalidation.mockRejectedValueOnce(new Error("some internal detail"));
    await act(async () => {
      await result.current.submitRecoveryPhrase(PHRASE);
    });
    expect(result.current.errorMessage).toBe("Something went wrong. Try again.");
    expect(result.current.status).toBe("needs_recovery");
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

  // -------------------------------------------------------------------------
  // GAP-078 — the wipe's own failure must be reported. RecoveryUnlockForm
  // fires this as `void onWipe()`, so before these two paths existed a
  // rejection was an unhandled promise and the status simply never moved.
  // -------------------------------------------------------------------------

  test("a wipe that fails AFTER the database file is gone still lands on onboarding, with a message saying so", async () => {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyInvalidatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("needs_recovery"));

    // wipeDatabase() succeeded and wipeKeys() threw — the ordering
    // lib/security/wipe.ts's header calls deliberate, and the state its
    // WipeIncompleteError exists to name.
    mockWipeAndStartOver.mockRejectedValueOnce(
      new WipeIncompleteError(new Error("secure store unavailable")),
    );

    await act(async () => {
      // NOT `rejects` — this must resolve. Its one call site does not hold the
      // promise, so a rejection here is an unhandled one on the screen where a
      // silent failure is most dangerous.
      await expect(result.current.wipeAndStartOver()).resolves.toBeUndefined();
    });

    // STAYING ON "needs_recovery" IS THE DEFECT, not the safe option. The
    // database file is deleted by this point, so the phrase box the user would
    // be left staring at can only re-wrap a key against a database that no
    // longer exists.
    expect(result.current.status).toBe("needs_onboarding");
    expect(result.current.errorMessage).not.toBeNull();
    // The two claims the message has to make: the data IS gone (the user is
    // about to be handed a fresh setup flow that would otherwise look like the
    // wipe did nothing), and the reset did not finish.
    expect(result.current.errorMessage).toContain("erased");
    expect(result.current.errorMessage).toContain("couldn't finish");
    // Same cleanup the success path does: this module's cache key is its own
    // copy of the DEK bytes and wipeKeys() could never have reached it.
    expect(mockClearCacheEncryptionKey).toHaveBeenCalled();
  });

  test("a wipe that fails BEFORE anything is destroyed stays on the recovery screen and says nothing was erased", async () => {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyInvalidatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("needs_recovery"));

    // A bare Error, which is what wipeAndStartOver propagates when
    // wipeDatabase() itself fails: the ledger and both wraps are untouched.
    mockWipeAndStartOver.mockRejectedValueOnce(new Error("disk I/O error"));

    await act(async () => {
      await expect(result.current.wipeAndStartOver()).resolves.toBeUndefined();
    });

    // The opposite of the test above, and the reason the two failures may not
    // share one branch: nothing was destroyed, so the recovery phrase still
    // opens this database and the form must stay mounted for it.
    expect(result.current.status).toBe("needs_recovery");
    expect(result.current.errorMessage).toContain("Nothing was erased");
  });

  // The DOUBLE CONFIRMATION requirement itself (one confirmation alone must
  // destroy nothing) is a UI-level property of RecoveryUnlockForm, which
  // only ever calls this context function once both confirmations have
  // happened -- see components/lock/__tests__/recovery_unlock_form.test.tsx.
  // This context-level test only pins that the underlying action, once
  // actually invoked, does the right thing -- it is not itself the gate.
});

// ---------------------------------------------------------------------------
// keysProvisioned() -- onboarding's first-run handoff. The whole reason it
// exists is app/(onboarding)/index.tsx's pre-flow running ABOVE the render
// gate, with no Stack mounted and no open database (see that file's header and
// this context's own keysProvisioned doc); the end-to-end walk lives in
// app/(onboarding)/__tests__/first_run_handoff.test.tsx. What is pinned HERE
// is the property that keeps it from being a back door: it can only ever move
// "needs_onboarding" to "locked".
// ---------------------------------------------------------------------------

describe("keysProvisioned()", () => {
  test("moves a freshly-keyed first-run device to locked, so the ordinary unlock still has to happen", async () => {
    mockGetKeyState.mockResolvedValue("uninitialized");
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("needs_onboarding"));

    act(() => {
      result.current.keysProvisioned();
    });

    expect(result.current.status).toBe("locked");
    // It opens NOTHING on its own -- no DEK is fetched, no database handle,
    // no cache key. Only unlock() does that, and only after authenticating.
    expect(mockUnlockWithDeviceKey).not.toHaveBeenCalled();
    expect(mockUnlockDatabase).not.toHaveBeenCalled();
    expect(mockSetCacheEncryptionKey).not.toHaveBeenCalled();
  });

  test("cannot pull a user out of needs_recovery -- a dead device key still needs the phrase", async () => {
    mockUnlockWithDeviceKey.mockRejectedValue(new DeviceKeyInvalidatedError());
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("needs_recovery"));

    act(() => {
      result.current.keysProvisioned();
    });

    expect(result.current.status).toBe("needs_recovery");
  });

  test("never reports unlocked, however many times it is called", async () => {
    mockGetKeyState.mockResolvedValue("uninitialized");
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("needs_onboarding"));

    act(() => {
      result.current.keysProvisioned();
      result.current.keysProvisioned();
      result.current.keysProvisioned();
    });

    expect(result.current.status).toBe("locked");
  });
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

  // GAP-030. Every test above drives the re-lock through a RETURN to the
  // foreground, which is the only way the app used to reach it: for the whole
  // background stay the DEK, the open database handle and every decrypted row
  // stayed in memory, and docs §7's "what happens while locked" described a
  // state the app had not entered yet.
  test("five minutes in the background re-locks on its own, with no return to the foreground", async () => {
    const result = await arriveAtUnlocked();
    // Enabled only now: arriveAtUnlocked() above waits on real promises
    // through waitFor, which fake timers would stall.
    jest.useFakeTimers();
    try {
      act(() => emitAppState("background"));
      // Still unlocked one millisecond short of the window, which is what
      // makes the assertion after it about the timer and not about
      // backgrounding alone.
      await act(async () => {
        jest.advanceTimersByTime(5 * 60 * 1000 - 1);
        await Promise.resolve();
      });
      expect(result.current.status).toBe("unlocked");
      expect(mockKeyManagerLock).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.status).toBe("locked");
      expect(mockClearCacheEncryptionKey).toHaveBeenCalledTimes(1);
      expect(mockCloseDatabase).toHaveBeenCalledTimes(1);
      expect(mockKeyManagerLock).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // GAP-072. The support outbox's attachment files are encrypted under the same
  // DEK, so the key holding it has to die with the cache key. A lock that
  // scrubbed one and not the other would leave a live copy of the DEK in
  // whichever module was forgotten, which is the whole point of the teardown.
  test("locking scrubs the attachment key too, not only the query cache's", async () => {
    const result = await arriveAtUnlocked();
    expect(mockSetAttachmentKey).toHaveBeenCalledWith(DEK);

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

    // Both keys, or neither — the pairing IS the assertion.
    expect(mockClearAttachmentKey).toHaveBeenCalledTimes(1);
    expect(mockClearCacheEncryptionKey).toHaveBeenCalledTimes(1);
  });

  // GAP-030's other half. Closing the database ends the app's ability to read
  // a row; the rows it already read are plain objects in the query cache with
  // a gcTime that outlives the lock, so a "locked" app kept the ledger in
  // memory and repainted it on unlock before any refetch resolved.
  test("locking empties the in-memory query cache, after the database is closed and before the DEK is zeroed", async () => {
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

    expect(mockQueryClientClear).toHaveBeenCalledTimes(1);
    expect(mockCloseDatabase.mock.invocationCallOrder[0]).toBeLessThan(
      mockQueryClientClear.mock.invocationCallOrder[0],
    );
    expect(mockQueryClientClear.mock.invocationCallOrder[0]).toBeLessThan(
      mockKeyManagerLock.mock.invocationCallOrder[0],
    );
  });

  // The timer must not outlive the trip to the background that armed it, or a
  // user who comes back at minute four, keeps using the app and never
  // backgrounds it again is re-locked mid-session at minute five.
  test("returning to the foreground inside the window disarms the timer entirely", async () => {
    const result = await arriveAtUnlocked();
    const nowSpy = jest.spyOn(Date, "now");
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);

    act(() => emitAppState("background"));
    nowSpy.mockReturnValue(t0 + 4 * 60 * 1000);
    act(() => emitAppState("active"));
    expect(result.current.status).toBe("unlocked");
    nowSpy.mockRestore();

    jest.useFakeTimers();
    try {
      await act(async () => {
        jest.advanceTimersByTime(10 * 60 * 1000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.status).toBe("unlocked");
      expect(mockKeyManagerLock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// GAP-002 -- the persisted cache and the lock, end to end
// ---------------------------------------------------------------------------

// The only block in this file that runs the REAL lib/query_client (via
// requireActual, routed in through the two mocks lock_context.tsx already
// calls) and the real cache cipher underneath it. Everything above asserts
// that lockNow() calls the teardown steps in order; this asserts what those
// steps mean for a write that was ALREADY RUNNING when they fired.
//
// The race, concretely: the persister's serialize awaits a nonce draw, and
// during that await lock_context drops the cache key, closes the database
// and calls KeyManager.lock(), whose real implementation zeroes the DEK
// BUFFER in place -- the very buffer lock_context handed to
// setCacheEncryptionKey. A serialize that resolved its key before that await
// resumes holding 32 zero bytes and writes the whole dehydrated cache
// (wallet balances, merchant names) to AsyncStorage under a key that is
// public by definition. Nothing detects it: the blob simply fails to
// authenticate on the next unlock and is discarded as corrupt.
describe("a persisted-cache write in flight when the app re-locks", () => {
  // query-async-storage-persister's documented default key, same as
  // lib/__tests__/query_client.test.ts.
  const STORAGE_KEY = "REACT_QUERY_OFFLINE_CACHE";
  const GCM_NONCE_BYTES = 12;
  const ZERO_KEY = new Uint8Array(32);
  const MERCHANT = "Jollibee SM Megamall";

  const realQueryCache = jest.requireActual<typeof import("@/lib/query_client")>("@/lib/query_client");

  // The mock-only controls the expo-crypto factory at the top of this file
  // adds; the cast reaches them without widening the module's own types.
  const CryptoMock = Crypto as unknown as {
    __parkNextNonceDraw: () => Promise<void>;
    __releaseParkedNonceDraw: () => void;
  };

  // Deliberately does NOT go through cache_cipher.ts -- this is the attacker's
  // side of the test, and it must not inherit any guard the module under test
  // happens to have.
  function decryptsUnderZeroKey(blob: string): boolean {
    try {
      const bytes = hexToBytes(blob);
      gcm(ZERO_KEY, bytes.slice(0, GCM_NONCE_BYTES)).decrypt(bytes.slice(GCM_NONCE_BYTES));
      return true;
    } catch {
      return false;
    }
  }

  function persistedClient(): PersistedClient {
    return {
      buster: realQueryCache.persistOptions.buster,
      timestamp: 1_700_000_000_000,
      clientState: { mutations: [], queries: [{ queryKey: ["wallets"], state: { data: { merchant: MERCHANT } } }] },
    } as unknown as PersistedClient;
  }

  beforeEach(async () => {
    mockSetCacheEncryptionKey.mockImplementation(realQueryCache.setCacheEncryptionKey);
    mockClearCacheEncryptionKey.mockImplementation(realQueryCache.clearCacheEncryptionKey);
    await AsyncStorage.clear();
  });

  afterEach(async () => {
    realQueryCache.clearCacheEncryptionKey();
    mockSetCacheEncryptionKey.mockReset();
    mockClearCacheEncryptionKey.mockReset();
    mockKeyManagerLock.mockReset();
    await AsyncStorage.clear();
  });

  test("resumes after the lock without ever writing a blob readable under the zeroed DEK", async () => {
    const dek = new Uint8Array(32).fill(0x42);
    mockUnlockWithDeviceKey.mockResolvedValue(dek);
    // key_manager.ts's real lock(): zero the bytes, THEN drop the reference.
    mockKeyManagerLock.mockImplementation(() => {
      dek.fill(0);
    });

    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("unlocked"));

    const parked = CryptoMock.__parkNextNonceDraw();
    const write = realQueryCache.persistOptions.persister.persistClient(persistedClient());
    // Resolves only once serialize is genuinely suspended inside the nonce
    // draw -- this is the liveness proof that the write is in flight, not a
    // write that never started.
    await parked;

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

    expect(mockKeyManagerLock).toHaveBeenCalledTimes(1);
    expect(Array.from(dek)).toEqual(Array.from(ZERO_KEY));

    await act(async () => {
      CryptoMock.__releaseParkedNonceDraw();
      await Promise.resolve(write).catch(() => undefined);
      await new Promise((resolve) => setImmediate(resolve));
    });

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw !== null) expect(decryptsUnderZeroKey(raw)).toBe(false);
    expect(raw).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lock:engaged
// ---------------------------------------------------------------------------

describe("lock:engaged", () => {
  // WHY AN EVENT AND NOT AN UNMOUNT. `lib/ai/session.ts` is a module-scoped
  // store rather than a React context — assistant state must never reach
  // react-query, which is persisted to disk — so it cannot learn about a lock
  // by unmounting. An event is also the only thing a test can fire at a chosen
  // point in a token stream, which is what AI spec §4.5's race needs.
  async function relockAfterTimeout() {
    const { result } = renderHook(() => useLock(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("locked"));
    await act(async () => {
      await result.current.unlock();
    });
    await waitFor(() => expect(result.current.status).toBe("unlocked"));

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
  }

  test("re-locking emits lock:engaged", async () => {
    const seen: unknown[] = [];
    const off = onAppEvent("lock:engaged", (payload) => {
      seen.push(payload);
    });

    await relockAfterTimeout();
    off();

    expect(seen).toHaveLength(1);
  });

  test("lock:engaged is emitted AFTER closeDatabase resolves", async () => {
    // Ordering matters: a subscriber that reads the database on this event must
    // find it already closed, not racing the close.
    const order: string[] = [];
    mockCloseDatabase.mockImplementation(async () => {
      await Promise.resolve();
      order.push("closeDatabase");
    });
    const off = onAppEvent("lock:engaged", () => {
      order.push("lock:engaged");
    });

    await relockAfterTimeout();
    off();

    expect(order).toEqual(["closeDatabase", "lock:engaged"]);
  });

  test("a throwing subscriber does not prevent the lock", async () => {
    // The bus already swallows a throwing handler, and this asserts the lock
    // path inherits that: a broken assistant must never be able to keep the
    // ledger open.
    const off = onAppEvent("lock:engaged", () => {
      throw new Error("subscriber exploded");
    });

    await relockAfterTimeout();
    off();

    expect(mockKeyManagerLock).toHaveBeenCalledTimes(1);
  });
});

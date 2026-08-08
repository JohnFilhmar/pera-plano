import type { RawCapture } from "@/types/domain";

/**
 * Encryption plan Task 4 (docs/12-encryption-and-app-lock.md §6, §9;
 * interface contract §4) — the seam where the Kotlin crypto meets JS.
 *
 * The native module is mocked entirely: the object below stands in for what
 * `requireNativeModule("NotificationListener")` returns on a real device.
 *
 * The mock factory builds that object ENTIRELY INSIDE itself, with no
 * reference to an outer variable. That is deliberate, not a style choice:
 * `index.ts` calls `requireNativeModule(...)` exactly once, at module-load
 * time, to compute its module-level `NativeNotificationListener` constant.
 * Babel's ES-module-to-CommonJS transform hoists the `import ... from
 * "../index"` below to run before a same-named outer `const` would actually
 * be *assigned* (only `jest.mock` calls -- not arbitrary outer variables --
 * are hoisted early enough to be safe), so a factory that closed over an
 * outer `mockNativeModule` would capture it as still-`undefined` at the
 * moment `requireNativeModule` actually runs. Building the object inside the
 * factory sidesteps that ordering hazard entirely. `jest.requireMock` below
 * then hands back the exact same cached module instance the factory already
 * produced -- the same object `index.ts` is holding onto -- so tests can
 * configure/inspect it after the fact.
 */
jest.mock("expo-modules-core", () => {
  // Created ONCE, when this factory itself is invoked (Jest caches the
  // module after that) -- every call to requireNativeModule below, whether
  // index.ts's own module-load-time call or this test file's later call via
  // jest.requireMock, returns this exact same instance. A factory that
  // built a fresh object per call would hand index.ts one object and the
  // test file a different one, and configuring the test file's copy would
  // never affect what index.ts actually calls.
  const nativeModule = {
    getCapturePublicKey: jest.fn(),
    wrapWithDeviceKek: jest.fn(),
    unwrapWithDeviceKek: jest.fn(),
    isDeviceKeyUsable: jest.fn(),
    recreateDeviceKek: jest.fn(),
    drainPendingCaptures: jest.fn(),
  };
  return {
    requireNativeModule: () => nativeModule,
  };
});

import {
  CaptureBufferReadFailedError,
  DeviceKeyInvalidatedError,
  DeviceKeyMissingError,
  NotAuthenticatedError,
  drainPendingCaptures,
  getCapturePublicKey,
  isDeviceKeyUsable,
  recreateDeviceKek,
  unwrapWithDeviceKek,
  wrapWithDeviceKek,
} from "../index";

type MockNativeModule = {
  getCapturePublicKey: jest.Mock;
  wrapWithDeviceKek: jest.Mock;
  unwrapWithDeviceKek: jest.Mock;
  isDeviceKeyUsable: jest.Mock;
  recreateDeviceKek: jest.Mock;
  drainPendingCaptures: jest.Mock;
};

// The same singleton object `index.ts`'s `NativeNotificationListener`
// constant already holds -- see the class doc above for why this has to be
// retrieved this way rather than via an outer variable closed over by the
// jest.mock factory.
const mockNativeModule: MockNativeModule = (
  jest.requireMock("expo-modules-core") as { requireNativeModule: () => MockNativeModule }
).requireNativeModule();

beforeEach(() => {
  jest.resetAllMocks();
});

// A native rejection is a plain object shaped like what an Expo Kotlin
// CodedException produces crossing the bridge: an Error-like value with a
// `code` string property. Never string-matched by callers — see index.ts.
function nativeRejection(code: string): Error & { code: string } {
  return Object.assign(new Error("native failure"), { code });
}

describe("getCapturePublicKey", () => {
  it("delegates to the native module with no arguments and resolves with its base64 result", async () => {
    mockNativeModule.getCapturePublicKey.mockResolvedValue("c3BraS1iYXNlNjQ=");

    const result = await getCapturePublicKey();

    expect(mockNativeModule.getCapturePublicKey).toHaveBeenCalledWith();
    expect(result).toBe("c3BraS1iYXNlNjQ=");
    expect(typeof result).toBe("string");
  });

  it("requires no authentication: it resolves even when every auth-gated native function is wired to fail", async () => {
    // Traps: if getCapturePublicKey's implementation ever called any of
    // these first (e.g. to "ensure" something auth-related), the mocked
    // rejection below would propagate and this test would fail — proving
    // the public-key fetch genuinely never touches an auth-gated path.
    mockNativeModule.isDeviceKeyUsable.mockRejectedValue(new Error("auth required"));
    mockNativeModule.wrapWithDeviceKek.mockRejectedValue(new Error("auth required"));
    mockNativeModule.unwrapWithDeviceKek.mockRejectedValue(new Error("auth required"));
    mockNativeModule.drainPendingCaptures.mockRejectedValue(new Error("auth required"));
    mockNativeModule.getCapturePublicKey.mockResolvedValue("c3BraS1iYXNlNjQ=");

    await expect(getCapturePublicKey()).resolves.toBe("c3BraS1iYXNlNjQ=");

    expect(mockNativeModule.isDeviceKeyUsable).not.toHaveBeenCalled();
    expect(mockNativeModule.wrapWithDeviceKek).not.toHaveBeenCalled();
    expect(mockNativeModule.unwrapWithDeviceKek).not.toHaveBeenCalled();
    expect(mockNativeModule.drainPendingCaptures).not.toHaveBeenCalled();
  });
});

describe("wrapWithDeviceKek", () => {
  it("delegates the base64 plaintext argument unchanged and resolves with the native module's base64 result", async () => {
    mockNativeModule.wrapWithDeviceKek.mockResolvedValue("d3JhcHBlZC1iYXNlNjQ=");

    const result = await wrapWithDeviceKek("cGxhaW50ZXh0LWJhc2U2NA==");

    expect(mockNativeModule.wrapWithDeviceKek).toHaveBeenCalledWith("cGxhaW50ZXh0LWJhc2U2NA==");
    expect(result).toBe("d3JhcHBlZC1iYXNlNjQ=");
    expect(typeof result).toBe("string");
    expect(Array.isArray(result)).toBe(false);
  });

  it("surfaces a DeviceKeyInvalidated native rejection as DeviceKeyInvalidatedError", async () => {
    mockNativeModule.wrapWithDeviceKek.mockRejectedValue(nativeRejection("DeviceKeyInvalidated"));

    await expect(wrapWithDeviceKek("cGxhaW50ZXh0")).rejects.toBeInstanceOf(DeviceKeyInvalidatedError);
  });
});

describe("unwrapWithDeviceKek", () => {
  it("delegates the base64 blob argument unchanged and resolves with the native module's base64 result", async () => {
    mockNativeModule.unwrapWithDeviceKek.mockResolvedValue("dW53cmFwcGVkLWJhc2U2NA==");

    const result = await unwrapWithDeviceKek("YmxvYi1iYXNlNjQ=");

    expect(mockNativeModule.unwrapWithDeviceKek).toHaveBeenCalledWith("YmxvYi1iYXNlNjQ=");
    expect(result).toBe("dW53cmFwcGVkLWJhc2U2NA==");
    expect(typeof result).toBe("string");
    expect(Array.isArray(result)).toBe(false);
  });

  it("surfaces a NotAuthenticated native rejection as NotAuthenticatedError", async () => {
    mockNativeModule.unwrapWithDeviceKek.mockRejectedValue(nativeRejection("NotAuthenticated"));

    await expect(unwrapWithDeviceKek("YmxvYi1iYXNlNjQ=")).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it("surfaces a DeviceKeyMissing native rejection as DeviceKeyMissingError -- distinct from DeviceKeyInvalidatedError", async () => {
    // DeviceKeyMissing means the device KEK was NEVER created (belongs in
    // onboarding); DeviceKeyInvalidated means it WAS created and later
    // died (belongs in the recovery-phrase flow). Reachable specifically
    // at unlock -- unwrapWithDeviceKek is called with no prior
    // ensureDeviceKek, unlike wrapWithDeviceKek.
    mockNativeModule.unwrapWithDeviceKek.mockRejectedValue(nativeRejection("DeviceKeyMissing"));

    let thrown: unknown;
    try {
      await unwrapWithDeviceKek("YmxvYi1iYXNlNjQ=");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DeviceKeyMissingError);
    expect(thrown).not.toBeInstanceOf(DeviceKeyInvalidatedError);
  });
});

describe("isDeviceKeyUsable", () => {
  it("delegates with no arguments and resolves with the native module's boolean, unchanged", async () => {
    mockNativeModule.isDeviceKeyUsable.mockResolvedValue(true);
    await expect(isDeviceKeyUsable()).resolves.toBe(true);
    expect(mockNativeModule.isDeviceKeyUsable).toHaveBeenCalledWith();

    mockNativeModule.isDeviceKeyUsable.mockResolvedValue(false);
    const result = await isDeviceKeyUsable();
    expect(result).toBe(false);
    expect(typeof result).toBe("boolean");
  });
});

describe("recreateDeviceKek", () => {
  it("delegates with no arguments and resolves", async () => {
    mockNativeModule.recreateDeviceKek.mockResolvedValue(undefined);

    await expect(recreateDeviceKek()).resolves.toBeUndefined();
    expect(mockNativeModule.recreateDeviceKek).toHaveBeenCalledWith();
  });
});

describe("drainPendingCaptures", () => {
  const nativeCapture: RawCapture = {
    id: "cap-1",
    packageName: "com.globe.gcash.android",
    title: "GCash",
    text: "You have sent PHP 500.00",
    subText: null,
    bigText: null,
    postedAt: 1754060400000,
    capturedAt: 1754060400500,
  };

  it("delegates with no arguments and resolves with typed RawCapture objects carrying exactly the eight contract §4 fields", async () => {
    mockNativeModule.drainPendingCaptures.mockResolvedValue([nativeCapture]);

    const result = await drainPendingCaptures();

    expect(mockNativeModule.drainPendingCaptures).toHaveBeenCalledWith();
    expect(result).toEqual([nativeCapture]);
    expect(Object.keys(result[0]).sort()).toEqual(
      ["bigText", "capturedAt", "id", "packageName", "postedAt", "subText", "text", "title"].sort(),
    );
  });

  it("resolves with an empty array when genuinely nothing is pending -- not an error", async () => {
    mockNativeModule.drainPendingCaptures.mockResolvedValue([]);

    await expect(drainPendingCaptures()).resolves.toEqual([]);
  });

  // ---------------------------------------------------------------------
  // The rejection taxonomy. Each of the three failure codes below demands a
  // different JS-side response (prompt for recovery words / re-prompt
  // biometric and retry / leave the buffer alone and try later) and must
  // never be collapsed into another -- or into the genuinely-empty case,
  // which is the specific data-loss bug this task exists to prevent.
  // ---------------------------------------------------------------------

  it("a DeviceKeyInvalidated rejection surfaces as DeviceKeyInvalidatedError, and the promise rejects rather than resolving empty", async () => {
    mockNativeModule.drainPendingCaptures.mockRejectedValue(nativeRejection("DeviceKeyInvalidated"));

    let resolved: RawCapture[] | undefined;
    let thrown: unknown;
    try {
      resolved = await drainPendingCaptures();
    } catch (error) {
      thrown = error;
    }

    expect(resolved).toBeUndefined();
    expect(thrown).toBeInstanceOf(DeviceKeyInvalidatedError);
  });

  it("a NotAuthenticated rejection surfaces as NotAuthenticatedError, and the promise rejects rather than resolving empty", async () => {
    mockNativeModule.drainPendingCaptures.mockRejectedValue(nativeRejection("NotAuthenticated"));

    let resolved: RawCapture[] | undefined;
    let thrown: unknown;
    try {
      resolved = await drainPendingCaptures();
    } catch (error) {
      thrown = error;
    }

    expect(resolved).toBeUndefined();
    expect(thrown).toBeInstanceOf(NotAuthenticatedError);
  });

  it("a CaptureBufferReadFailed rejection surfaces as CaptureBufferReadFailedError, and the promise rejects rather than resolving empty", async () => {
    mockNativeModule.drainPendingCaptures.mockRejectedValue(nativeRejection("CaptureBufferReadFailed"));

    let resolved: RawCapture[] | undefined;
    let thrown: unknown;
    try {
      resolved = await drainPendingCaptures();
    } catch (error) {
      thrown = error;
    }

    expect(resolved).toBeUndefined();
    expect(thrown).toBeInstanceOf(CaptureBufferReadFailedError);
  });

  it("the four rejection types map to four distinct, non-overlapping error classes -- collapsing any two is the bug this task must avoid", async () => {
    // Exercised via drainPendingCaptures purely as a vehicle: rethrowTyped
    // is the SAME shared mapping function behind wrapWithDeviceKek,
    // unwrapWithDeviceKek, and drainPendingCaptures, so testing it through
    // any one call site proves the mapping itself, regardless of which
    // Kotlin catch site would realistically produce a given code (e.g.
    // DeviceKeyMissing is only realistically reachable from
    // unwrapWithDeviceKek -- see that describe block -- but the JS-level
    // mapping code does not know or care which call site it came from).
    async function rejectionFor(code: string): Promise<unknown> {
      mockNativeModule.drainPendingCaptures.mockRejectedValueOnce(nativeRejection(code));
      try {
        await drainPendingCaptures();
        return undefined;
      } catch (error) {
        return error;
      }
    }

    const classesByCode: Array<[string, new (...args: never[]) => Error]> = [
      ["DeviceKeyInvalidated", DeviceKeyInvalidatedError],
      ["DeviceKeyMissing", DeviceKeyMissingError],
      ["NotAuthenticated", NotAuthenticatedError],
      ["CaptureBufferReadFailed", CaptureBufferReadFailedError],
    ];

    const rejections = await Promise.all(classesByCode.map(([code]) => rejectionFor(code)));

    // Each code produces an instance of its OWN class...
    classesByCode.forEach(([, ErrorClass], i) => {
      expect(rejections[i]).toBeInstanceOf(ErrorClass);
    });

    // ...and of NO other class in the taxonomy -- the exhaustive pairwise
    // check that actually catches a collapse between any two.
    classesByCode.forEach(([, _ErrorClass], i) => {
      classesByCode.forEach(([, OtherErrorClass], j) => {
        if (i !== j) {
          expect(rejections[i]).not.toBeInstanceOf(OtherErrorClass);
        }
      });
    });
  });

  it("an unrecognized native rejection code is rethrown unchanged, not miscategorized as one of the four known types", async () => {
    mockNativeModule.drainPendingCaptures.mockRejectedValue(new Error("boom, no code at all"));

    let thrown: unknown;
    try {
      await drainPendingCaptures();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).not.toBeInstanceOf(DeviceKeyInvalidatedError);
    expect(thrown).not.toBeInstanceOf(DeviceKeyMissingError);
    expect(thrown).not.toBeInstanceOf(NotAuthenticatedError);
    expect(thrown).not.toBeInstanceOf(CaptureBufferReadFailedError);
    expect((thrown as Error).message).toBe("boom, no code at all");
  });
});

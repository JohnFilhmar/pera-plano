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
    clearCaptureBuffer: jest.fn(),
    isDeviceSecure: jest.fn(),
    openSecuritySettings: jest.fn(),
    isKeyguardLocked: jest.fn(),
    // M1a Task 8 -- the listener surface. `addListener` is not a function
    // the Kotlin `ModuleDefinition` declares by name: it is the EventEmitter
    // method every Expo `NativeModule` inherits, which the Kotlin side feeds
    // via `Events("onCapture")` + `sendEvent`.
    isAccessGranted: jest.fn(),
    openAccessSettings: jest.fn(),
    setCaptureEnabled: jest.fn(),
    setProviderFilter: jest.fn(),
    getListenerHealth: jest.fn(),
    // Provider-selection plan Task 3 -- the packages this device has been
    // seen posting notifications, which is how the onboarding picker stops
    // guessing at package names.
    listObservedPackages: jest.fn(),
    addListener: jest.fn(),
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
  addCaptureListener,
  clearCaptureBuffer,
  drainPendingCaptures,
  getCapturePublicKey,
  getListenerHealth,
  isAccessGranted,
  isDeviceKeyUsable,
  isDeviceSecure,
  isKeyguardLocked,
  listObservedPackages,
  openAccessSettings,
  openSecuritySettings,
  recreateDeviceKek,
  setCaptureEnabled,
  setProviderFilter,
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
  clearCaptureBuffer: jest.Mock;
  isDeviceSecure: jest.Mock;
  openSecuritySettings: jest.Mock;
  isKeyguardLocked: jest.Mock;
  isAccessGranted: jest.Mock;
  openAccessSettings: jest.Mock;
  setCaptureEnabled: jest.Mock;
  setProviderFilter: jest.Mock;
  getListenerHealth: jest.Mock;
  listObservedPackages: jest.Mock;
  addListener: jest.Mock;
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

// ---------------------------------------------------------------------------
// clearCaptureBuffer -- the §11a wipe primitive Task 9's wipe was missing
// (docs/12-encryption-and-app-lock.md §11a; task-9a-brief).
// ---------------------------------------------------------------------------

describe("clearCaptureBuffer", () => {
  it("delegates to the native module with no arguments and resolves", async () => {
    mockNativeModule.clearCaptureBuffer.mockResolvedValue(undefined);

    await expect(clearCaptureBuffer()).resolves.toBeUndefined();
    expect(mockNativeModule.clearCaptureBuffer).toHaveBeenCalledWith();
  });

  it("requires no authentication: it resolves even when every auth-gated native function is wired to fail", async () => {
    mockNativeModule.isDeviceKeyUsable.mockRejectedValue(new Error("auth required"));
    mockNativeModule.unwrapWithDeviceKek.mockRejectedValue(new Error("auth required"));
    mockNativeModule.drainPendingCaptures.mockRejectedValue(new Error("auth required"));
    mockNativeModule.clearCaptureBuffer.mockResolvedValue(undefined);

    await expect(clearCaptureBuffer()).resolves.toBeUndefined();

    expect(mockNativeModule.isDeviceKeyUsable).not.toHaveBeenCalled();
    expect(mockNativeModule.unwrapWithDeviceKek).not.toHaveBeenCalled();
    expect(mockNativeModule.drainPendingCaptures).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// isDeviceSecure / openSecuritySettings -- the docs §5a device screen-lock
// requirement (task-9a-brief).
// ---------------------------------------------------------------------------

describe("isDeviceSecure", () => {
  it("delegates with no arguments and resolves with the native module's boolean, unchanged", async () => {
    mockNativeModule.isDeviceSecure.mockResolvedValue(true);
    await expect(isDeviceSecure()).resolves.toBe(true);
    expect(mockNativeModule.isDeviceSecure).toHaveBeenCalledWith();

    mockNativeModule.isDeviceSecure.mockResolvedValue(false);
    const result = await isDeviceSecure();
    expect(result).toBe(false);
    expect(typeof result).toBe("boolean");
  });
});

describe("openSecuritySettings", () => {
  it("delegates to the native module synchronously, with no arguments, and returns nothing", () => {
    const result = openSecuritySettings();

    expect(mockNativeModule.openSecuritySettings).toHaveBeenCalledWith();
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isKeyguardLocked — docs/12-encryption-and-app-lock.md §7a; task-9b-brief.
// The POST-time check every alert-posting task (M2/M2b/M2c/M3) must call
// immediately before selectAlertCopy, never at schedule time. Distinct from
// isDeviceSecure above: that asks whether a screen lock is CONFIGURED at
// all (an onboarding prerequisite); this asks whether the device is LOCKED
// RIGHT NOW (a per-notification check).
// ---------------------------------------------------------------------------

describe("isKeyguardLocked", () => {
  it("delegates with no arguments and resolves with the native module's boolean, unchanged", async () => {
    mockNativeModule.isKeyguardLocked.mockResolvedValue(true);
    await expect(isKeyguardLocked()).resolves.toBe(true);
    expect(mockNativeModule.isKeyguardLocked).toHaveBeenCalledWith();

    mockNativeModule.isKeyguardLocked.mockResolvedValue(false);
    const result = await isKeyguardLocked();
    expect(result).toBe(false);
    expect(typeof result).toBe("boolean");
  });

  it("requires no authentication: it resolves even when every auth-gated native function is wired to fail", async () => {
    mockNativeModule.isDeviceKeyUsable.mockRejectedValue(new Error("auth required"));
    mockNativeModule.unwrapWithDeviceKek.mockRejectedValue(new Error("auth required"));
    mockNativeModule.drainPendingCaptures.mockRejectedValue(new Error("auth required"));
    mockNativeModule.isKeyguardLocked.mockResolvedValue(true);

    await expect(isKeyguardLocked()).resolves.toBe(true);

    expect(mockNativeModule.isDeviceKeyUsable).not.toHaveBeenCalled();
    expect(mockNativeModule.unwrapWithDeviceKek).not.toHaveBeenCalled();
    expect(mockNativeModule.drainPendingCaptures).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// M1a Task 8 -- the listener surface (interface contract §4; M1a plan Task 8).
//
// Everything above this line is the encryption plan's half of contract §4.
// Everything below is the half the listener itself needs: the notification-
// access grant, the two user-facing switches, health, and live capture
// events.
//
// `NotificationListenerModule.kt` -- not the plan's interface block -- is the
// source of truth for each function's sync/async shape. The plan disagrees
// with the contract on `isAccessGranted`, so every shape below was read off
// the Kotlin `ModuleDefinition`: `AsyncFunction` for all but
// `openAccessSettings`, which is a bare `Function` and therefore `void`.
// ===========================================================================

/** The eight contract §4 field names, as `Object.keys(...)` should report them. */
const RAW_CAPTURE_FIELDS = [
  "bigText",
  "capturedAt",
  "id",
  "packageName",
  "postedAt",
  "subText",
  "text",
  "title",
].sort();

/**
 * A capture with every one of the eight fields populated -- deliberately
 * including non-null `subText`/`bigText`, which the encryption-era
 * `drainPendingCaptures` test above leaves `null`. A normalizer that dropped
 * either field entirely would still pass that older test; it cannot pass this
 * one.
 */
const fullyPopulatedCapture: RawCapture = {
  id: "cap-live-1",
  packageName: "com.globe.gcash.android",
  title: "GCash",
  text: "You have received PHP 1,250.00",
  subText: "Wallet",
  bigText: "You have received PHP 1,250.00 from JUAN D. Ref. No. 9001234567.",
  postedAt: 1754060400000,
  capturedAt: 1754060400500,
};

/**
 * What the bridge hands over when the Kotlin side's nullable string fields are
 * absent rather than null. Task 5 already collapses blank-to-null per field in
 * Kotlin; this is the shape the JS wrapper has to defend against on top of
 * that -- a field the bridge omits from the object entirely.
 */
const captureWithFieldsOmitted = {
  id: "cap-sparse-1",
  packageName: "com.bdo.digitalbanking",
  postedAt: 1754060500000,
  capturedAt: 1754060500250,
};

/** A stand-in for expo-modules-core's `EventSubscription`. */
function subscriptionStub(): { remove: jest.Mock } {
  return { remove: jest.fn() };
}

describe("the contract §4 listener surface", () => {
  // The file-level beforeEach resets every implementation, so each native
  // method needs a resolvable default again before the delegation table below
  // can await anything.
  beforeEach(() => {
    mockNativeModule.isAccessGranted.mockResolvedValue(true);
    mockNativeModule.openAccessSettings.mockReturnValue(undefined);
    mockNativeModule.setCaptureEnabled.mockResolvedValue(undefined);
    mockNativeModule.setProviderFilter.mockResolvedValue(undefined);
    mockNativeModule.drainPendingCaptures.mockResolvedValue([]);
    mockNativeModule.getListenerHealth.mockResolvedValue({
      granted: true,
      serviceConnected: true,
      lastCaptureAt: null,
    });
    mockNativeModule.listObservedPackages.mockResolvedValue([]);
    mockNativeModule.addListener.mockReturnValue(subscriptionStub());
  });

  // -------------------------------------------------------------------------
  // Delegation, parametrized over all seven contract §4 listener functions.
  // Asserting the ARGUMENTS (not merely that the mock was called) is what
  // catches a dropped or reordered argument; asserting that no OTHER native
  // method was touched is what catches a wrapper wired to the wrong one.
  // -------------------------------------------------------------------------

  type DelegationCase = {
    wrapper: string;
    nativeMethod: keyof MockNativeModule;
    call: () => unknown;
    nativeArgs: unknown[];
  };

  const delegationCases: DelegationCase[] = [
    {
      wrapper: "isAccessGranted",
      nativeMethod: "isAccessGranted",
      call: () => isAccessGranted(),
      nativeArgs: [],
    },
    {
      wrapper: "openAccessSettings",
      nativeMethod: "openAccessSettings",
      call: () => openAccessSettings(),
      nativeArgs: [],
    },
    {
      wrapper: "setCaptureEnabled",
      nativeMethod: "setCaptureEnabled",
      // `false` rather than `true`: a wrapper that inverted the flag, or that
      // hardcoded `true` and ignored its argument, passes with `true` and
      // fails here.
      call: () => setCaptureEnabled(false),
      nativeArgs: [false],
    },
    {
      wrapper: "setProviderFilter",
      nativeMethod: "setProviderFilter",
      // Two entries, so a wrapper that spread the array into positional
      // arguments, or reversed it, fails.
      call: () => setProviderFilter(["com.globe.gcash.android", "com.bdo.digitalbanking"]),
      nativeArgs: [["com.globe.gcash.android", "com.bdo.digitalbanking"]],
    },
    {
      wrapper: "drainPendingCaptures",
      nativeMethod: "drainPendingCaptures",
      call: () => drainPendingCaptures(),
      nativeArgs: [],
    },
    {
      wrapper: "getListenerHealth",
      nativeMethod: "getListenerHealth",
      call: () => getListenerHealth(),
      nativeArgs: [],
    },
    {
      wrapper: "listObservedPackages",
      nativeMethod: "listObservedPackages",
      call: () => listObservedPackages(),
      nativeArgs: [],
    },
    {
      // The one wrapper whose native counterpart is NOT its namesake: capture
      // events arrive through the inherited EventEmitter, under the exact
      // event name `EVENT_ON_CAPTURE` declares in Kotlin. A typo here produces
      // a listener that silently never fires rather than an error, which is
      // why the event name is asserted literally.
      wrapper: "addCaptureListener",
      nativeMethod: "addListener",
      call: () => addCaptureListener(jest.fn()),
      nativeArgs: ["onCapture", expect.any(Function)],
    },
  ];

  it.each(delegationCases)(
    "each exported function delegates to the matching native method with the same arguments: $wrapper -> $nativeMethod",
    async ({ nativeMethod, call, nativeArgs }) => {
      await call();

      expect(mockNativeModule[nativeMethod]).toHaveBeenCalledTimes(1);
      expect(mockNativeModule[nativeMethod]).toHaveBeenCalledWith(...nativeArgs);

      const everyNativeMethod = Object.keys(mockNativeModule) as Array<keyof MockNativeModule>;
      everyNativeMethod
        .filter((method) => method !== nativeMethod)
        .forEach((method) => {
          expect(mockNativeModule[method]).not.toHaveBeenCalled();
        });
    },
  );

  // -------------------------------------------------------------------------
  // isAccessGranted / openAccessSettings -- the grant, and the only way to ask
  // for it (Kotlin: AsyncFunction / Function respectively).
  // -------------------------------------------------------------------------

  describe("isAccessGranted", () => {
    it("resolves with the native module's boolean unchanged, both true and false", async () => {
      mockNativeModule.isAccessGranted.mockResolvedValue(true);
      await expect(isAccessGranted()).resolves.toBe(true);

      mockNativeModule.isAccessGranted.mockResolvedValue(false);
      const revoked = await isAccessGranted();
      expect(revoked).toBe(false);
      expect(typeof revoked).toBe("boolean");
    });
  });

  describe("openAccessSettings", () => {
    // The brief's named trap. The plan's interface block and the Kotlin agree
    // that this is synchronous, but an `async` wrapper -- or one that
    // `return`ed the native call -- would still satisfy the delegation case
    // above. `toBeUndefined()` is what actually discriminates: an async
    // wrapper hands back a Promise.
    it("is synchronous and returns nothing -- never a Promise", () => {
      const result = openAccessSettings();

      expect(mockNativeModule.openAccessSettings).toHaveBeenCalledWith();
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // The two user-facing switches.
  // -------------------------------------------------------------------------

  describe("setCaptureEnabled", () => {
    it("forwards the boolean unchanged in both directions -- an inverted pause switch silently stops capture", async () => {
      await setCaptureEnabled(false);
      expect(mockNativeModule.setCaptureEnabled).toHaveBeenLastCalledWith(false);

      await setCaptureEnabled(true);
      expect(mockNativeModule.setCaptureEnabled).toHaveBeenLastCalledWith(true);
      expect(mockNativeModule.setCaptureEnabled).toHaveBeenCalledTimes(2);
    });
  });

  describe("setProviderFilter", () => {
    it("forwards an empty array AS an empty array -- that clears the filter, and is not the same as omitting the argument", async () => {
      // CapturePrefs.getProviderFilter reads an empty allowlist as "allow
      // every package". A wrapper that dropped `[]` as falsy, or substituted a
      // default, would turn "clear the filter" into something else entirely.
      await setProviderFilter([]);

      expect(mockNativeModule.setProviderFilter).toHaveBeenCalledWith([]);
      expect(mockNativeModule.setProviderFilter.mock.calls[0][0]).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // drainPendingCaptures -- the eight fields, and the JS-side absent-value
  // guarantee (plan Task 8 rule 3).
  // -------------------------------------------------------------------------

  describe("drainPendingCaptures", () => {
    it("returns typed RawCapture objects carrying all eight fields intact, including non-null subText and bigText", async () => {
      mockNativeModule.drainPendingCaptures.mockResolvedValue([fullyPopulatedCapture]);

      const [capture] = await drainPendingCaptures();

      expect(capture).toEqual(fullyPopulatedCapture);
      expect(Object.keys(capture).sort()).toEqual(RAW_CAPTURE_FIELDS);
      expect(capture.subText).toBe("Wallet");
      expect(capture.bigText).toBe(
        "You have received PHP 1,250.00 from JUAN D. Ref. No. 9001234567.",
      );
      expect(capture.postedAt).toBe(1754060400000);
      expect(capture.capturedAt).toBe(1754060400500);
    });

    it("normalizes missing string fields to null, never leaving them undefined", async () => {
      mockNativeModule.drainPendingCaptures.mockResolvedValue([captureWithFieldsOmitted]);

      const [capture] = await drainPendingCaptures();

      // toBeNull, never toBeFalsy: `undefined` is falsy, so toBeFalsy would
      // pass on the exact bug this guards against -- two "nothing here"
      // shapes reaching downstream parsers instead of one.
      expect(capture.title).toBeNull();
      expect(capture.text).toBeNull();
      expect(capture.subText).toBeNull();
      expect(capture.bigText).toBeNull();
      expect(Object.keys(capture).sort()).toEqual(RAW_CAPTURE_FIELDS);
    });

    it("leaves a genuinely empty drain empty rather than manufacturing a normalized row", async () => {
      mockNativeModule.drainPendingCaptures.mockResolvedValue([]);

      await expect(drainPendingCaptures()).resolves.toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // addCaptureListener -- live events, and the unsubscribe function that has
  // to actually detach (plan Task 8 rule 2). A listener that cannot be removed
  // keeps the native sink installed across screens and leaks raw notification
  // text into a dead callback.
  // -------------------------------------------------------------------------

  describe("addCaptureListener", () => {
    it("registers a listener and the returned function removes it", () => {
      const subscription = subscriptionStub();
      mockNativeModule.addListener.mockReturnValue(subscription);
      const onCapture = jest.fn();

      const unsubscribe = addCaptureListener(onCapture);

      expect(mockNativeModule.addListener).toHaveBeenCalledWith("onCapture", expect.any(Function));
      expect(typeof unsubscribe).toBe("function");
      // Registering must not detach anything on its own.
      expect(subscription.remove).not.toHaveBeenCalled();

      // The registered native listener genuinely drives the caller's callback.
      const nativeListener = mockNativeModule.addListener.mock.calls[0][1] as (
        capture: RawCapture,
      ) => void;
      nativeListener(fullyPopulatedCapture);
      expect(onCapture).toHaveBeenCalledWith(fullyPopulatedCapture);

      // The point of the test: the returned function is not a no-op. Assert
      // the subscription's own remove was invoked, not merely that something
      // callable came back.
      unsubscribe();
      expect(subscription.remove).toHaveBeenCalledTimes(1);
    });

    it("applies the same absent-value normalization to a live capture as the drained path does", () => {
      // The Kotlin side deliberately routes both paths through the one
      // CaptureRecord.toMap so a live capture and a drained one can never
      // disagree about their fields. The JS side must not reintroduce the
      // disagreement by normalizing only one of them.
      mockNativeModule.addListener.mockReturnValue(subscriptionStub());
      const onCapture = jest.fn();

      addCaptureListener(onCapture);
      const nativeListener = mockNativeModule.addListener.mock.calls[0][1] as (
        capture: unknown,
      ) => void;
      nativeListener(captureWithFieldsOmitted);

      const delivered = onCapture.mock.calls[0][0] as RawCapture;
      expect(delivered.title).toBeNull();
      expect(delivered.text).toBeNull();
      expect(delivered.subText).toBeNull();
      expect(delivered.bigText).toBeNull();
      expect(Object.keys(delivered).sort()).toEqual(RAW_CAPTURE_FIELDS);
    });
  });

  // -------------------------------------------------------------------------
  // getListenerHealth -- three facts, and the null that must stay null.
  // -------------------------------------------------------------------------

  describe("getListenerHealth", () => {
    it("passes lastCaptureAt through as null when the native side reports null", async () => {
      mockNativeModule.getListenerHealth.mockResolvedValue({
        granted: true,
        serviceConnected: true,
        lastCaptureAt: null,
      });

      const health = await getListenerHealth();

      // `0` is a valid epoch millisecond, so a `?? 0` here would render as
      // "last captured 1 January 1970" on the health screen instead of
      // "not yet".
      expect(health.lastCaptureAt).toBeNull();
      expect(health).toEqual({ granted: true, serviceConnected: true, lastCaptureAt: null });
    });

    it("normalizes an absent lastCaptureAt to null and passes a real timestamp through untouched", async () => {
      mockNativeModule.getListenerHealth.mockResolvedValue({
        granted: false,
        serviceConnected: false,
      });

      const neverCaptured = await getListenerHealth();
      expect(neverCaptured.lastCaptureAt).toBeNull();
      expect(neverCaptured.granted).toBe(false);
      expect(neverCaptured.serviceConnected).toBe(false);

      mockNativeModule.getListenerHealth.mockResolvedValue({
        granted: true,
        serviceConnected: true,
        lastCaptureAt: 1754060400000,
      });

      const healthy = await getListenerHealth();
      expect(healthy.lastCaptureAt).toBe(1754060400000);
      expect(Object.keys(healthy).sort()).toEqual(
        ["granted", "lastCaptureAt", "serviceConnected"].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // listObservedPackages -- what the onboarding picker reads (provider-
  // selection plan Task 3). Seven of the thirteen `seed.json` package names
  // were constructed from app names, and a wrong one is a silent failure:
  // that provider is never routed and looks to the user like their bank
  // simply does not work. These are the names the device actually saw.
  // -------------------------------------------------------------------------

  describe("listObservedPackages", () => {
    it("resolves with the native array unchanged, newest-first, carrying exactly the three ObservedPackage fields", async () => {
      // Newest-first is the native side's ordering guarantee, and this
      // wrapper must not re-sort or reverse it -- the picker shows these in
      // the order it receives them.
      const observed = [
        { packageName: "com.globe.gcash.android", count: 12, lastSeenAt: 1754060402000 },
        { packageName: "com.paymaya", count: 3, lastSeenAt: 1754060401000 },
      ];
      mockNativeModule.listObservedPackages.mockResolvedValue(observed);

      const result = await listObservedPackages();

      expect(mockNativeModule.listObservedPackages).toHaveBeenCalledWith();
      expect(result).toEqual(observed);
      expect(result.map((entry) => entry.packageName)).toEqual([
        "com.globe.gcash.android",
        "com.paymaya",
      ]);
      // PACKAGE NAMES ONLY. A title or body reaching this payload would make
      // the picker's data a shadow copy of the capture buffer, so the field
      // set is asserted exactly rather than sampled.
      expect(Object.keys(result[0]).sort()).toEqual(["count", "lastSeenAt", "packageName"]);
    });

    it("resolves with an empty array when nothing has been observed yet -- not an error", async () => {
      // The fresh-install state: the user can reach the picker before a
      // single notification has arrived, and an empty list is the correct,
      // unremarkable answer there.
      mockNativeModule.listObservedPackages.mockResolvedValue([]);

      await expect(listObservedPackages()).resolves.toEqual([]);
    });
  });
});

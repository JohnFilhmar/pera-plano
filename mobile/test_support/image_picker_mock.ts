// Jest stand-in for expo-image-picker (native module). Mapped via jest
// moduleNameMapper, the same way `sqlite_mock.ts` stands in for op-sqlite.
//
// WHY A MAPPER AND NOT A PER-SUITE `jest.mock`. `expo-image-picker` has no
// JS-only implementation at all: it calls `requireNativeModule` at import
// time, so ANY suite whose import graph reaches
// `lib/support/attachment_picker.ts` — including the report screen's own
// render test, which never opens a picker — dies at module load without a
// stand-in. A mapper covers all of them once, which is exactly the argument
// `jest_setup.ts` already makes for the AsyncStorage and expo-crypto mocks.
//
// THE DEFAULT IS "THE USER CANCELLED", not "the user picked a file". A test
// that wants a pick says so (`__setNextPick`); every other test gets the
// answer that changes nothing, so a screen test cannot accidentally depend on
// a phantom attachment appearing.

export type MockPickedAsset = { uri: string; mimeType?: string };

type MockResult = { canceled: true } | { canceled: false; assets: MockPickedAsset[] };

let nextResult: MockResult = { canceled: true };
let permissionGranted = true;

/** The options the last `launchImageLibraryAsync` call was made with, for assertions. */
export let lastLaunchOptions: Record<string, unknown> | null = null;

/** Queues what the next pick returns. Persists until changed — call it in `beforeEach`. */
export function __setNextPick(assets: MockPickedAsset[] | null): void {
  nextResult = assets === null ? { canceled: true } : { canceled: false, assets };
}

/** Flips what `requestMediaLibraryPermissionsAsync` answers (the iOS branch only). */
export function __setPermissionGranted(granted: boolean): void {
  permissionGranted = granted;
}

/** Puts the module back to its defaults. */
export function __resetImagePickerMock(): void {
  nextResult = { canceled: true };
  permissionGranted = true;
  lastLaunchOptions = null;
}

export async function requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: permissionGranted };
}

export async function launchImageLibraryAsync(
  options?: Record<string, unknown>,
): Promise<MockResult> {
  lastLaunchOptions = options ?? null;
  return nextResult;
}

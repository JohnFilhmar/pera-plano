import { requireNativeModule } from "expo-modules-core";

import type { RawCapture } from "@/types/domain";

/**
 * JS-facing surface of the notification listener local Expo module. The
 * five functions below are added by the encryption plan's Task 4 (interface
 * contract §4, docs/12-encryption-and-app-lock.md §6/§9) — the seam where
 * the Kotlin crypto in `KeyStoreBridge`/`CaptureBuffer` meets JS.
 *
 * `NotificationListenerModule.kt` is the only thing on the other side of
 * `requireNativeModule` below; see its class doc for the exact exception ->
 * `code` mapping this file reads.
 */
type NativeNotificationListenerModule = {
  getCapturePublicKey(): Promise<string>;
  wrapWithDeviceKek(plaintextB64: string): Promise<string>;
  unwrapWithDeviceKek(blobB64: string): Promise<string>;
  isDeviceKeyUsable(): Promise<boolean>;
  drainPendingCaptures(): Promise<RawCapture[]>;
};

const NativeNotificationListener = requireNativeModule<NativeNotificationListenerModule>(
  "NotificationListener",
);

// ---------------------------------------------------------------------
// The rejection taxonomy (contract §4; docs/12-encryption-and-app-lock.md
// §6/§9). Four possible outcomes for an operation that touches an
// auth-gated Keystore key, and each demands a different caller response:
//
//   - DeviceKeyInvalidatedError -- the device KEK was permanently destroyed
//     (screen lock removed). Caller must prompt for the 12-word recovery
//     phrase, never show a generic failure.
//   - NotAuthenticatedError -- called outside the ~10s post-unlock
//     authentication window. Caller must re-prompt biometric/device
//     credential and retry the SAME call. This is NOT a statement about
//     whether there is anything pending -- see CaptureBuffer's class doc:
//     drain() decrypts before ever touching the file on disk specifically
//     so this exception leaves every capture intact, and folding it into
//     an empty result would make those captures invisible until some other
//     trigger runs a drain.
//   - CaptureBufferReadFailedError -- a storage-layer read error, unrelated
//     to auth or contents. Caller must leave the buffer alone and retry
//     later, never treat it as "nothing pending".
//   - Genuinely empty -- not an error at all. The promise resolves with
//     `[]`.
//
// Callers branch on `instanceof`/`.code`, never on a message string.
// ---------------------------------------------------------------------

/** `code` values a native rejection can carry, matching the Kotlin side exactly. */
type BridgeErrorCode = "DeviceKeyInvalidated" | "NotAuthenticated" | "CaptureBufferReadFailed";

/**
 * The device KEK (or the capture keypair's private key, for
 * `drainPendingCaptures`) was permanently invalidated -- typically because
 * the user removed their device screen lock. Recoverable only via the
 * recovery phrase (docs/12-encryption-and-app-lock.md §5); never fatal.
 */
export class DeviceKeyInvalidatedError extends Error {
  readonly code: BridgeErrorCode = "DeviceKeyInvalidated";
  constructor(message = "the device key has been permanently invalidated") {
    super(message);
    this.name = "DeviceKeyInvalidatedError";
  }
}

/**
 * The operation ran outside the Keystore key's ~10-second post-unlock
 * authentication window (docs/12-encryption-and-app-lock.md §7). Retry
 * after re-authenticating -- this says nothing about whether there is
 * anything pending, and must never be treated as "empty".
 */
export class NotAuthenticatedError extends Error {
  readonly code: BridgeErrorCode = "NotAuthenticated";
  constructor(message = "authentication is required to complete this operation") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

/**
 * The pending-capture file exists but a storage-layer error prevented
 * reading it (`CaptureBuffer.ReadFailedException` on the native side) --
 * unrelated to authentication or to the file's contents. Leave the buffer
 * alone and retry later; never treat it as "empty".
 */
export class CaptureBufferReadFailedError extends Error {
  readonly code: BridgeErrorCode = "CaptureBufferReadFailed";
  constructor(message = "the pending-capture buffer could not be read") {
    super(message);
    this.name = "CaptureBufferReadFailedError";
  }
}

/**
 * Maps a native rejection's `code` to its distinguishable JS error type. An
 * unrecognized `code` (or no `code` at all) rethrows the original error
 * completely unchanged -- this function only ever narrows the three known
 * codes, never substitutes a default for anything else, so a genuinely
 * novel native failure is never miscategorized as one of the three.
 */
function rethrowTyped(error: unknown): never {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === "DeviceKeyInvalidated") throw new DeviceKeyInvalidatedError();
  if (code === "NotAuthenticated") throw new NotAuthenticatedError();
  if (code === "CaptureBufferReadFailed") throw new CaptureBufferReadFailedError();
  throw error;
}

/** Base64-encoded SPKI public key of the capture keypair. Requires NO authentication. */
export function getCapturePublicKey(): Promise<string> {
  return NativeNotificationListener.getCapturePublicKey();
}

/** Wraps a base64 plaintext (the DEK) under the device KEK; returns a base64 blob. */
export function wrapWithDeviceKek(plaintextB64: string): Promise<string> {
  return NativeNotificationListener.wrapWithDeviceKek(plaintextB64).catch(rethrowTyped);
}

/** Unwraps a base64 blob under the device KEK; returns the base64 plaintext. */
export function unwrapWithDeviceKek(blobB64: string): Promise<string> {
  return NativeNotificationListener.unwrapWithDeviceKek(blobB64).catch(rethrowTyped);
}

/** False once the device KEK has been permanently invalidated (e.g. screen lock removed). */
export function isDeviceKeyUsable(): Promise<boolean> {
  return NativeNotificationListener.isDeviceKeyUsable();
}

/**
 * Drains and decrypts every buffered-while-dead capture. Keeps the exact
 * signature and plaintext `RawCapture[]` return shape contract §4 pins --
 * decryption happens below the bridge, so no caller ever learns the
 * captures were sealed on disk. Requires the app to be unlocked (the
 * capture keypair's private-key authentication window); see the rejection
 * taxonomy above for what a caller does with each failure mode.
 */
export function drainPendingCaptures(): Promise<RawCapture[]> {
  return NativeNotificationListener.drainPendingCaptures().catch(rethrowTyped);
}

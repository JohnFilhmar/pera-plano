import { requireNativeModule } from "expo-modules-core";

import type { EventSubscription } from "expo-modules-core";

import type { RawCapture } from "@/types/domain";

/**
 * The one event the Kotlin module emits, matching `EVENT_ON_CAPTURE` in
 * `NotificationListenerModule.kt` exactly. A constant for the same reason it
 * is one over there: a typo in an event name produces a listener that
 * silently never fires rather than an error.
 */
const CAPTURE_EVENT_NAME = "onCapture";

/**
 * The three facts `getListenerHealth` promises (interface contract §4), and
 * nothing else.
 *
 * `lastCaptureAt` is `number | null`, never `number`. `0` is a valid epoch
 * millisecond, so a 0-as-absent sentinel would render as "last captured
 * 1 January 1970" instead of "not yet" — `CapturePrefs.lastCaptureAt` already
 * draws that distinction on the Kotlin side and nothing here may flatten it.
 */
export type ListenerHealth = {
  granted: boolean;
  serviceConnected: boolean;
  lastCaptureAt: number | null;
};

/**
 * One package this device has actually been seen posting a notification
 * (interface contract §4; provider-selection plan Task 3) — the raw material
 * for the onboarding provider picker.
 *
 * These are REAL package names, read off `sbn.packageName` by the listener
 * service, which is the whole reason this exists: not one of the fifteen
 * package names in the parser seed has been checked against a device or a
 * Play listing (see `lib/ingest/seed_rules.ts`), and a wrong one is a silent
 * failure — that provider is never routed, captures nothing, and looks to the
 * user like their bank simply does not work.
 *
 * THREE FIELDS, NEVER A NOTIFICATION'S CONTENT. `count` is occurrences and
 * `lastSeenAt` is epoch milliseconds; there is deliberately nowhere here for
 * a title or body, which would make this list a shadow copy of the capture
 * history the sealed native buffer exists to protect.
 */
export type ObservedPackage = {
  packageName: string;
  count: number;
  lastSeenAt: number;
};

/**
 * A capture exactly as it can arrive over the bridge, which is NOT quite a
 * `RawCapture`: a nullable string field may be ABSENT from the object rather
 * than present-and-null. `normalizeCapture` below closes that gap so every
 * value this module hands out is a true `RawCapture`.
 */
type NativeRawCapture = Omit<RawCapture, "title" | "text" | "subText" | "bigText"> & {
  title?: string | null;
  text?: string | null;
  subText?: string | null;
  bigText?: string | null;
};

/** Health as it can arrive over the bridge — `lastCaptureAt` may be absent. */
type NativeListenerHealth = Omit<ListenerHealth, "lastCaptureAt"> & {
  lastCaptureAt?: number | null;
};

/**
 * JS-facing surface of the notification listener local Expo module. The
 * encryption functions are added by the encryption plan's Task 4 (interface
 * contract §4, docs/12-encryption-and-app-lock.md §6/§9) — the seam where
 * the Kotlin crypto in `KeyStoreBridge`/`CaptureBuffer` meets JS. The
 * listener's own surface (the access grant, the two switches, health, and
 * the `onCapture` event) is added by the M1a plan's Task 8.
 *
 * `NotificationListenerModule.kt` is the only thing on the other side of
 * `requireNativeModule` below, and it — not any plan document — is the source
 * of truth for each function's shape: everything it declares as an
 * `AsyncFunction` is a `Promise` here, and the two it declares as a bare
 * `Function` (`openSecuritySettings`, `openAccessSettings`) are `void`. See
 * its class doc for the exact exception -> `code` mapping this file reads.
 */
type NativeNotificationListenerModule = {
  getCapturePublicKey(): Promise<string>;
  wrapWithDeviceKek(plaintextB64: string): Promise<string>;
  unwrapWithDeviceKek(blobB64: string): Promise<string>;
  isDeviceKeyUsable(): Promise<boolean>;
  recreateDeviceKek(): Promise<void>;
  drainPendingCaptures(): Promise<NativeRawCapture[]>;
  clearCaptureBuffer(): Promise<void>;
  isDeviceSecure(): Promise<boolean>;
  openSecuritySettings(): void;
  isKeyguardLocked(): Promise<boolean>;

  // ---- The listener surface (M1a plan Task 8; contract §4) --------------
  isAccessGranted(): Promise<boolean>;
  openAccessSettings(): void;
  setCaptureEnabled(enabled: boolean): Promise<void>;
  setProviderFilter(packageNames: string[], denyAll: boolean): Promise<void>;
  getListenerHealth(): Promise<NativeListenerHealth>;

  // ---- Learned package names (provider-selection plan Task 3) ----------
  // Every field is non-nullable and always written by the Kotlin
  // `ObservedPackage.toMap()`, so unlike captures and health there is no
  // absent-value gap for the wrapper to close.
  listObservedPackages(): Promise<ObservedPackage[]>;

  // ---- Real app names (app-label plan) ---------------------------------
  // Partial by design: a package that is not installed, not visible, or has
  // no usable label is ABSENT from the map rather than present-and-blank.
  // See `AppLabels.kt` for why absence, not a placeholder, is the answer.
  getAppLabels(packageNames: string[]): Promise<Record<string, string>>;

  /**
   * Inherited from the `EventEmitter` every Expo `NativeModule` extends —
   * the JS end of the Kotlin `Events(EVENT_ON_CAPTURE)` declaration. Not
   * called directly by anything outside `addCaptureListener`, which is what
   * keeps `EventSubscription` from leaking into callers.
   */
  addListener(
    eventName: typeof CAPTURE_EVENT_NAME,
    listener: (capture: NativeRawCapture) => void,
  ): EventSubscription;
};

const NativeNotificationListener = requireNativeModule<NativeNotificationListenerModule>(
  "NotificationListener",
);

// ---------------------------------------------------------------------
// The rejection taxonomy (contract §4; docs/12-encryption-and-app-lock.md
// §6/§9). Four possible outcomes for an operation that touches an
// auth-gated Keystore key, and each demands a different caller response:
//
//   - DeviceKeyInvalidatedError -- the device KEK WAS created and was later
//     permanently destroyed (screen lock removed). Caller must prompt for
//     the 12-word recovery phrase, then call recreateDeviceKek(), never
//     show a generic failure.
//   - DeviceKeyMissingError -- the device KEK has NEVER been created at
//     all. Genuinely different from "invalidated": there is nothing to
//     recover, so the caller belongs in onboarding (initializeKeys, §9),
//     not the recovery-phrase flow.
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
type BridgeErrorCode =
  | "DeviceKeyInvalidated"
  | "DeviceKeyMissing"
  | "NotAuthenticated"
  | "CaptureBufferReadFailed"
  | "ProviderFilterNotStored";

/**
 * The device KEK (or the capture keypair's private key, for
 * `drainPendingCaptures`) WAS created and was later permanently invalidated
 * -- typically because the user removed their device screen lock.
 * Recoverable via the recovery phrase followed by `recreateDeviceKek()`
 * (docs/12-encryption-and-app-lock.md §5); never fatal on its own.
 */
export class DeviceKeyInvalidatedError extends Error {
  readonly code: BridgeErrorCode = "DeviceKeyInvalidated";
  constructor(message = "the device key has been permanently invalidated") {
    super(message);
    this.name = "DeviceKeyInvalidatedError";
  }
}

/**
 * The device KEK has never been created on this device at all. Distinct
 * from `DeviceKeyInvalidatedError`: there is no prior wrap to recover, so
 * the caller belongs in onboarding (`initializeKeys`, contract §9), never
 * the recovery-phrase flow.
 */
export class DeviceKeyMissingError extends Error {
  readonly code: BridgeErrorCode = "DeviceKeyMissing";
  constructor(message = "the device key has not been created yet") {
    super(message);
    this.name = "DeviceKeyMissingError";
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
 * The capture scope the caller asked for is NOT the one the device is
 * applying: `setProviderFilter` could not store it (GAP-114). The listener
 * keeps whatever filter it already had, so the provider the user just paused
 * is still being captured -- and the reverse for a resume.
 *
 * NOT AN AUTHENTICATION FAILURE, unlike the four above, and callers must not
 * treat it as one. The provider allowlist is sealed under the listener's
 * UNAUTHENTICATED prefs key, so no biometric prompt and no recovery phrase can
 * make the same call succeed; only a relaunch can, because that is where the
 * key is created (`ensurePrefsKeyOnLaunch`, and the listener service's own
 * `onListenerConnected`).
 *
 * A CALLER MUST NOT RECORD THE CHANGE. `paused_provider_packages` is the only
 * readable record of which providers are paused, so writing it after this
 * rejection is what produces a switch list that reports a pause the listener
 * never applied.
 */
export class ProviderFilterNotStoredError extends Error {
  readonly code: BridgeErrorCode = "ProviderFilterNotStored";
  constructor(message = "the provider filter could not be stored on this device") {
    super(message);
    this.name = "ProviderFilterNotStoredError";
  }
}

/**
 * Maps a native rejection's `code` to its distinguishable JS error type. An
 * unrecognized `code` (or no `code` at all) rethrows the original error
 * completely unchanged -- this function only ever narrows the five known
 * codes, never substitutes a default for anything else, so a genuinely
 * novel native failure is never miscategorized as one of the five.
 */
function rethrowTyped(error: unknown): never {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === "DeviceKeyInvalidated") throw new DeviceKeyInvalidatedError();
  if (code === "DeviceKeyMissing") throw new DeviceKeyMissingError();
  if (code === "NotAuthenticated") throw new NotAuthenticatedError();
  if (code === "CaptureBufferReadFailed") throw new CaptureBufferReadFailedError();
  if (code === "ProviderFilterNotStored") throw new ProviderFilterNotStoredError();
  throw error;
}

/**
 * The JS-side absent-value guarantee (M1a plan Task 8 rule 3): every capture
 * leaving this module has exactly the eight contract §4 fields, and a missing
 * string field is `null` — never `undefined`.
 *
 * Task 5 already collapses blank-to-null per field on the Kotlin side, and
 * `CaptureRecord.toMap` writes all eight keys. This closes the remaining gap:
 * a field the BRIDGE omits from the object entirely. Downstream parsers get
 * exactly one "nothing here" shape to branch on rather than two.
 *
 * `??` and not `||`: an empty string and a `0` timestamp are real values and
 * must survive. Both capture paths run through here — the drained queue and
 * the live `onCapture` event — deliberately, because the Kotlin side routes
 * both through the one `CaptureRecord.toMap` so a live capture and a drained
 * one can never disagree about their fields, and normalizing only one of them
 * here would reintroduce exactly that disagreement.
 */
function normalizeCapture(capture: NativeRawCapture): RawCapture {
  return {
    id: capture.id,
    packageName: capture.packageName,
    title: capture.title ?? null,
    text: capture.text ?? null,
    subText: capture.subText ?? null,
    bigText: capture.bigText ?? null,
    postedAt: capture.postedAt,
    capturedAt: capture.capturedAt,
    // Absent on every record the native buffer holds from a build older than
    // this field. `null` is the honest reading — "this capture cannot say
    // which notification slot it came from" — and `findReplayCapture` treats
    // it as "cannot tell" and suppresses nothing.
    notificationKey: capture.notificationKey ?? null,
  };
}

/** Base64-encoded SPKI public key of the capture keypair. Requires NO authentication. */
export function getCapturePublicKey(): Promise<string> {
  return NativeNotificationListener.getCapturePublicKey();
}

/** Wraps a base64 plaintext (the DEK) under the device KEK; returns a base64 blob. */
export function wrapWithDeviceKek(plaintextB64: string): Promise<string> {
  return NativeNotificationListener.wrapWithDeviceKek(plaintextB64).catch(rethrowTyped);
}

/**
 * Unwraps a base64 blob under the device KEK; returns the base64 plaintext.
 * Rejects with `DeviceKeyMissingError` if the device KEK was never created
 * (belongs in onboarding), or `DeviceKeyInvalidatedError` if it was created
 * and later destroyed (belongs in the recovery-phrase flow) -- see the
 * rejection taxonomy above.
 */
export function unwrapWithDeviceKek(blobB64: string): Promise<string> {
  return NativeNotificationListener.unwrapWithDeviceKek(blobB64).catch(rethrowTyped);
}

/** False once the device KEK has been permanently invalidated (e.g. screen lock removed). */
export function isDeviceKeyUsable(): Promise<boolean> {
  return NativeNotificationListener.isDeviceKeyUsable();
}

/**
 * Deletes the device KEK and generates a fresh replacement, UNCONDITIONALLY
 * -- the recovery primitive behind `key_manager.ts`'s `rewrapAfterInvalidation`
 * (contract §9). Call this ONLY after successfully unwrapping the DEK via
 * the recovery phrase, then immediately `wrapWithDeviceKek` that same DEK
 * under the fresh key this produces. Every wrap made under the OLD key
 * becomes permanently unopenable the instant this resolves -- calling it
 * without already holding the DEK from the recovery path loses it forever.
 */
export function recreateDeviceKek(): Promise<void> {
  return NativeNotificationListener.recreateDeviceKek();
}

/**
 * Drains and decrypts every buffered-while-dead capture. Keeps the exact
 * signature and plaintext `RawCapture[]` return shape contract §4 pins --
 * decryption happens below the bridge, so no caller ever learns the
 * captures were sealed on disk. Requires the app to be unlocked (the
 * capture keypair's private-key authentication window); see the rejection
 * taxonomy above for what a caller does with each failure mode.
 *
 * `.catch(rethrowTyped)` stays attached directly to the native call, ahead of
 * the normalization step, so the rejection taxonomy only ever narrows a NATIVE
 * failure — a bug thrown by `normalizeCapture` itself could never be
 * miscategorized as one of the four codes.
 */
export function drainPendingCaptures(): Promise<RawCapture[]> {
  return NativeNotificationListener.drainPendingCaptures()
    .catch(rethrowTyped)
    .then((captures) => captures.map(normalizeCapture));
}

/**
 * Deletes the pending-capture buffer outright (docs/12-encryption-and-app-lock.md
 * §11a; task-9a-brief) -- the one native touch-point `lib/security/wipe.ts`'s
 * `wipeAndStartOver` was missing until this task: without it, a wipe left
 * `pending_captures.ndjson` on disk, sealed under a capture keypair the wipe
 * had just made irrelevant. Not a confidentiality leak on its own (the
 * contents stay ciphertext), but it broke the wipe's own promise to clear
 * "the capture buffer" as part of starting over.
 *
 * Requires NO authentication -- deleting a file of opaque ciphertext needs
 * no Keystore key at all, unlike every other function in this module past
 * `getCapturePublicKey`. Resolves whether or not anything was pending; see
 * `CaptureBuffer.clear`'s doc for why "nothing to wipe" and "wiped" are the
 * same end state here, never a rejection.
 */
export function clearCaptureBuffer(): Promise<void> {
  return NativeNotificationListener.clearCaptureBuffer();
}

/**
 * `KeyguardManager.isDeviceSecure()` -- true once the device has ANY screen
 * lock configured (docs/12-encryption-and-app-lock.md §5a; task-9a-brief).
 * Android refuses to create an auth-gated Keystore key with none of these,
 * so this is the prerequisite check onboarding runs before generating any
 * key, and that the unlock-time recovery flow (`contexts/lock_context.tsx`'s
 * `submitRecoveryPhrase`) runs before ever calling `recreateDeviceKek()` --
 * that call cannot create a new auth-gated key on a device with no screen
 * lock present either. Requires NO authentication.
 */
export function isDeviceSecure(): Promise<boolean> {
  return NativeNotificationListener.isDeviceSecure();
}

/**
 * Launches Android's screen-lock settings page so the user can set one
 * (docs §5a; task-9a-brief). Synchronous and fire-and-forget, matching the
 * native side exactly: this reports nothing about whether the user actually
 * set a lock. Callers find that out by re-checking `isDeviceSecure()` when
 * the app returns to the foreground -- never from anything this returns.
 */
export function openSecuritySettings(): void {
  NativeNotificationListener.openSecuritySettings();
}

/**
 * `KeyguardManager.isKeyguardLocked()` -- true if the device is locked RIGHT
 * NOW (docs/12-encryption-and-app-lock.md §7a; task-9b-brief). Distinct from
 * `isDeviceSecure` above: that asks whether a screen lock is CONFIGURED at
 * all (an onboarding-time prerequisite); this asks about the device's
 * CURRENT lock state, and exists specifically to drive amount-free alert
 * copy (`lib/alerts/alert_copy.ts`'s `selectAlertCopy`).
 *
 * Every alert-posting task (M2's limit alerts, M2b's loan reminders, M2c's
 * bill reminders, M3's payday summary and tracking-interrupted notice) MUST
 * call this at POST time, immediately before `selectAlertCopy`, never at
 * schedule time -- a reminder queued days earlier cannot know what state
 * the phone will be in when it actually fires:
 *
 *   selectAlertCopy(copy, await isKeyguardLocked())
 *
 * Requires NO Keystore key and NO authentication, like `isDeviceSecure`.
 */
export function isKeyguardLocked(): Promise<boolean> {
  return NativeNotificationListener.isKeyguardLocked();
}

// ---------------------------------------------------------------------
// The listener's own surface (M1a plan Task 8; interface contract §4).
//
// Everything above is the encryption plan's half of contract §4. Below is
// the half the listener itself needs: the notification-access grant, the two
// user-facing switches, health, and live capture events. None of these
// requires AUTHENTICATION, so none can produce a rejection from the
// four-code taxonomy above.
//
// `setProviderFilter` is the one that can still reject (GAP-114): the
// allowlist it writes is sealed under the listener's own unauthenticated
// prefs key, and on a device where that key is unavailable the write does not
// happen. `ProviderFilterNotStoredError` is deliberately kept out of the
// taxonomy above for that reason -- it is not fixed by authenticating.
// ---------------------------------------------------------------------

/**
 * Whether the user has granted this app notification access — the permission
 * the entire ingest pipeline depends on.
 *
 * ALWAYS A LIVE QUERY on the native side, never a cached flag: access is
 * revocable from system settings at any moment with no callback to this app,
 * and some OEM builds drop it across a reboot or an app update. Callers must
 * therefore re-ask rather than remembering an earlier answer — in particular
 * when the app returns to the foreground after `openAccessSettings()`.
 */
export function isAccessGranted(): Promise<boolean> {
  return NativeNotificationListener.isAccessGranted();
}

/**
 * Launches Android's Notification Access settings page so the user can grant
 * the listener. Synchronous and fire-and-forget, matching the native side
 * exactly — a bare `Function` in the Kotlin `ModuleDefinition`, not an
 * `AsyncFunction`.
 *
 * IT ONLY NAVIGATES. Nothing here grants anything, and nothing here reports
 * whether the user granted anything; there is no such Android API. Callers
 * find out by re-running `isAccessGranted()` when the app returns to the
 * foreground, never from anything this returns — which is why returning a
 * Promise would be actively misleading rather than merely redundant.
 */
export function openAccessSettings(): void {
  NativeNotificationListener.openAccessSettings();
}

/**
 * The global pause switch (contract §4). Writes straight through to
 * `SharedPreferences` below the bridge, never to in-memory state: the
 * listener service that has to honour this runs in a process Android may
 * create long after this one is dead, so the value has to outlive us.
 *
 * Distinct from `setProviderFilter([])` — this is how capture is turned OFF;
 * an empty provider filter means "allow every package". See that function.
 */
export function setCaptureEnabled(enabled: boolean): Promise<void> {
  return NativeNotificationListener.setCaptureEnabled(enabled);
}

/**
 * The provider allowlist (contract §4). Crosses the bridge as an array and is
 * stored as a set below it — duplicates collapse and order is meaningless,
 * since membership is the only question the listener ever asks.
 *
 * AN EMPTY ARRAY MEANS "ALLOW EVERY PACKAGE", not "allow none". Passing `[]`
 * is how a caller CLEARS the filter, never how it disables capture; that is
 * `setCaptureEnabled(false)`'s job.
 *
 * `denyAll` IS THE ONE SENTENCE THE ARRAY CANNOT CARRY (GAP-103): "block every
 * package". An allowlist has exactly one empty value and it already means the
 * opposite, so pausing every provider used to arrive here as `[]` and switch
 * capture from most-restricted to unrestricted. It is REQUIRED, with no
 * default, for that reason — the fail-open value is the one a caller would
 * omit, and every call site now has to say which of the two it means.
 *
 * IT IS NOT THE MASTER PAUSE. `setCaptureEnabled` stays a separate control the
 * user sets separately; neither call moves the other. Send `[]` alongside
 * `true` — the flag outranks the filter below the bridge, so the array is only
 * what a later resume falls back to.
 *
 * REJECTS WITH `ProviderFilterNotStoredError` WHEN THE SCOPE DID NOT LAND
 * (GAP-114). The allowlist is sealed on the far side, and a device with no
 * usable prefs key writes nothing rather than falling back to allow-all — this
 * used to resolve regardless, so a caller recorded a pause the listener never
 * applied. **Nothing may write its own record of the change until this
 * resolves**, since there is no getter across this bridge to notice the
 * disagreement later. See that error's doc for why re-authenticating is the
 * wrong response.
 */
export function setProviderFilter(packageNames: string[], denyAll: boolean): Promise<void> {
  return NativeNotificationListener.setProviderFilter(packageNames, denyAll).catch(rethrowTyped);
}

/**
 * Subscribes to live captures and returns an UNSUBSCRIBE FUNCTION — callers
 * detach by calling it, and never see an `EventSubscription`.
 *
 * Calling the returned function is mandatory on teardown, not optional
 * hygiene. The Kotlin side installs its live sink on the first subscriber
 * (`OnStartObserving`) and tears it down when the last one leaves
 * (`OnStopObserving`), so a listener that is never removed keeps the native
 * service holding a lambda that closes over a dead JS runtime, and keeps raw
 * bank/e-wallet notification text flowing into a callback whose screen is
 * gone.
 *
 * The subscription is wrapped in an arrow rather than returned as
 * `subscription.remove` directly so the method can never be invoked detached
 * from its own receiver.
 */
export function addCaptureListener(listener: (capture: RawCapture) => void): () => void {
  const subscription = NativeNotificationListener.addListener(CAPTURE_EVENT_NAME, (capture) => {
    listener(normalizeCapture(capture));
  });
  return () => {
    subscription.remove();
  };
}

/**
 * The three facts contract §4 promises about the listener, and nothing else.
 *
 * `granted` is a live access check on the native side, never a stored flag —
 * see `isAccessGranted`. `serviceConnected` and `lastCaptureAt` are written
 * by the listener service itself.
 *
 * `lastCaptureAt` STAYS NULL when nothing has ever been captured, and is
 * normalized to `null` if the bridge omits it. It is never coerced to `0`:
 * `0` is a valid epoch millisecond, so the health UI would render "not yet"
 * as "last captured 1 January 1970". `??` and not `||` for the same reason —
 * a genuine `0` must survive.
 */
export function getListenerHealth(): Promise<ListenerHealth> {
  return NativeNotificationListener.getListenerHealth().then((health) => ({
    granted: health.granted,
    serviceConnected: health.serviceConnected,
    lastCaptureAt: health.lastCaptureAt ?? null,
  }));
}

/**
 * Every package this device has been seen posting a notification, NEWEST
 * FIRST (contract §4; provider-selection plan Task 3) — what the onboarding
 * provider picker offers alongside the seed catalogue.
 *
 * The ordering is the native side's and is not re-sorted here: recency is the
 * only ranking the app has evidence for, and the picker's first screenful is
 * what most people will ever read.
 *
 * The native side records a package for EVERY notification the listener sees,
 * including the ones it drops for being filtered out or ongoing — a package
 * the user has not selected is precisely the one that has to appear in the
 * picker. It records the package NAME only; see `ObservedPackage`.
 *
 * Resolves with `[]` when nothing has been observed yet, which is the normal
 * fresh-install state rather than an error, and requires NO authentication:
 * the list is sealed under the listener's own unauthenticated prefs key, not
 * the auth-gated device KEK, so this cannot produce a rejection from the
 * taxonomy above.
 */
export function listObservedPackages(): Promise<ObservedPackage[]> {
  return NativeNotificationListener.listObservedPackages();
}

/**
 * The name Android itself shows for each of `packageNames` — what the app is
 * CALLED on this phone, as opposed to what the parser seed once decided to
 * call it.
 *
 * WHY THIS EXISTS. The seed's brand names are hand-written and go stale: a
 * bank rebrands, the package id does not, and the picker goes on offering
 * "seabank" for an app whose icon on this very phone reads Maribank. Since
 * the picker exists to have the user confirm "yes, that is my banking app",
 * naming it something the user has never seen is a direct failure of the
 * screen's only job. Resolving the name at display time fixes every past and
 * future rename without an app release.
 *
 * PARTIAL BY DESIGN — the map contains an entry only for packages that are
 * installed, visible, and carry a usable label. A missing key is the normal
 * answer for a catalogue app the user does not have, and callers are expected
 * to fall through to their own next-best name (see `applyAppLabels` in
 * `lib/ingest/provider_catalogue.ts` for that chain). The native side never
 * substitutes a placeholder, precisely so absence stays distinguishable.
 *
 * TAKES THE PACKAGES TO RESOLVE, AND DOES NOT ENUMERATE. Nothing in this
 * module can produce a list of the user's installed apps; this asks about
 * packages the caller already had. The empty-input short circuit keeps a
 * picker with no choices from crossing the bridge at all.
 *
 * REJECTS ONLY ON A BRIDGE FAILURE. There is no per-package error: the native
 * side swallows an unresolvable package into absence, because one dead lookup
 * must not cost the caller the other twenty names.
 */
export function getAppLabels(packageNames: string[]): Promise<Record<string, string>> {
  if (packageNames.length === 0) return Promise.resolve({});
  // Normalized the same way `getListenerHealth` closes its absent-value gap:
  // every value this module hands out is the shape its type promises, so no
  // caller has to guard a property read on the result.
  return NativeNotificationListener.getAppLabels(packageNames).then((labels) => labels ?? {});
}

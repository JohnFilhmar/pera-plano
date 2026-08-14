package expo.modules.notificationlistener

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS-facing surface of the notification listener. The JS name is pinned by the
 * interface contract §4 wrapper (mobile/modules/notification_listener/index.ts).
 *
 * M1a plan Task 6 adds the listener's own surface -- the notification-access
 * grant ([isAccessGranted]/[openAccessSettings]), the two user-facing switches
 * ([setCaptureEnabled]/[setProviderFilter]), [listenerHealth], and the
 * `onCapture` event. Like the encryption functions below, every one of them is
 * a one-line delegation to a top-level, `Module`-free function further down
 * this file: an `AsyncFunction` body cannot be invoked without the JSI runtime,
 * so anything with a decision in it lives outside the `ModuleDefinition` where
 * `NotificationListenerModuleTest` can reach it. Keep these bodies one-liners.
 *
 * Encryption-plan Task 4 (docs/12-encryption-and-app-lock.md §6, §9; interface
 * contract §4) adds the key-operation functions below. Every one of them is a
 * thin pass-through to [KeyStoreBridge] / [CaptureBuffer] -- no new crypto
 * logic lives here, only two things:
 *
 *  1. Base64 <-> [ByteArray] conversion at the boundary (contract §4 rule 3:
 *     binary crosses the bridge as base64 strings, never number arrays).
 *  2. Mapping platform exceptions to a distinguishable [CodedException] with
 *     a `code` a JS caller can branch on (contract §4 rule 2, and the
 *     rejection taxonomy this task's brief calls out) -- FOUR outcomes, each
 *     demanding a different JS-side response:
 *       - [KeyPermanentlyInvalidatedException] -> `code == "DeviceKeyInvalidated"`
 *         (a key that WAS created and was later permanently destroyed --
 *         typically the screen lock was removed; JS must prompt for the
 *         recovery phrase, never show a generic failure)
 *       - a device KEK alias that has NEVER been created at all ->
 *         `code == "DeviceKeyMissing"` (a genuinely different state from
 *         "invalidated": nothing was ever wrapped, so there is nothing to
 *         recover -- JS belongs in onboarding, not the recovery flow; see
 *         [requireDeviceKekPresent])
 *       - [UserNotAuthenticatedException] -> `code == "NotAuthenticated"`
 *         (called outside the ~10s post-unlock authentication window; JS
 *         must re-prompt biometric/device-credential and retry the SAME
 *         call -- NEVER treat this as "the buffer is empty", see
 *         [CaptureBuffer]'s class doc on why `drain()` decrypts before ever
 *         touching the file specifically so this exception leaves every
 *         capture intact on disk)
 *       - [CaptureBuffer.ReadFailedException] -> `code == "CaptureBufferReadFailed"`
 *         (a storage-layer read error, unrelated to auth or to the file's
 *         contents, and only reachable from [drainPendingCaptures]; JS must
 *         leave the buffer alone and retry later -- NEVER treat this as
 *         "the buffer is empty" either)
 *
 * A fifth outcome -- the buffer is genuinely empty -- is not an error at
 * all: [CaptureBuffer.drain] returns an empty list normally, and
 * `drainPendingCaptures` resolves with `[]`. Collapsing any two of these
 * outcomes together is the exact bug class this task exists to avoid: each
 * demands a different JS-side response (prompt onboarding / prompt for
 * recovery words / re-prompt biometric and retry / leave the buffer alone
 * and try later / do nothing).
 *
 * `recreateDeviceKek` is the one function here that is NOT a taxonomy
 * source -- it is the recovery ACTION the `DeviceKeyInvalidated` rejection
 * exists to lead to. See [KeyStoreBridge.recreateDeviceKek]'s doc.
 */
class NotificationListenerModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("NotificationListener")

    // ---- App launch (provider-selection plan Task 2) ---------------------
    // The earliest native code this app runs in its own process. See
    // [ensurePrefsKeyOnLaunch] for why the prefs KEK is created here rather
    // than lazily on first use, and why the listener service does the same
    // thing independently.

    OnCreate {
      ensurePrefsKeyOnLaunch()
    }

    // ---- Capture keypair: public half, no auth required -----------------

    AsyncFunction("getCapturePublicKey") {
      KeyStoreBridge.ensureCaptureKeyPair()
      Base64.encodeToString(KeyStoreBridge.capturePublicKeySpki(), Base64.NO_WRAP)
    }

    // ---- Device KEK: wrap / unwrap the DEK -------------------------------

    AsyncFunction("wrapWithDeviceKek") { plaintextB64: String ->
      KeyStoreBridge.ensureDeviceKek()
      val plaintext = Base64.decode(plaintextB64, Base64.NO_WRAP)
      val wrapped = mapKeyErrors { KeyStoreBridge.wrapWithDeviceKek(plaintext) }
      Base64.encodeToString(wrapped, Base64.NO_WRAP)
    }

    AsyncFunction("unwrapWithDeviceKek") { blobB64: String ->
      // Deliberately no ensureDeviceKek() here (unlike wrapWithDeviceKek):
      // if the device KEK has never existed, silently generating one would
      // turn a clear "never initialized" state into a confusing decrypt
      // failure under the WRONG key. requireDeviceKekPresent gives that
      // state its own distinguishable rejection instead.
      requireDeviceKekPresent()
      val blob = Base64.decode(blobB64, Base64.NO_WRAP)
      val plaintext = mapKeyErrors { KeyStoreBridge.unwrapWithDeviceKek(blob) }
      Base64.encodeToString(plaintext, Base64.NO_WRAP)
    }

    AsyncFunction("isDeviceKeyUsable") {
      KeyStoreBridge.isDeviceKekUsable()
    }

    // ---- Recovery: rotate a permanently-invalidated device KEK ----------

    AsyncFunction("recreateDeviceKek") {
      KeyStoreBridge.recreateDeviceKek()
    }

    // ---- Decrypting drain of the buffered-while-dead queue ---------------

    AsyncFunction("drainPendingCaptures") {
      val file = CaptureBuffer.fileFor(requireContext())
      val records =
        try {
          mapKeyErrors { CaptureBuffer.drain(file) }
        } catch (readFailed: CaptureBuffer.ReadFailedException) {
          throw CaptureBufferReadFailedException()
        }
      records.map { it.toMap() }
    }

    // ---- §11a "wipe and start over": delete the buffer outright ---------

    AsyncFunction("clearCaptureBuffer") {
      CaptureBuffer.clear(CaptureBuffer.fileFor(requireContext()))
    }

    // ---- Device screen lock (docs §5a; task-9a-brief) --------------------
    // Requires NO Keystore key and NO authentication -- KeyguardManager's
    // lock-state query and launching Settings are both plain system-service
    // calls, unlike everything above this block.

    AsyncFunction("isDeviceSecure") {
      isDeviceSecure(requireContext())
    }

    Function("openSecuritySettings") {
      openSecuritySettings(requireContext())
    }

    // ---- Keyguard state at alert-post time (docs §7a; task-9b-brief) ----
    // Requires NO Keystore key and NO authentication -- KeyguardManager's
    // current-lock-state query is a plain system-service call, same as
    // isDeviceSecure above, but it answers a different question (see
    // isKeyguardLocked's doc).

    AsyncFunction("isKeyguardLocked") {
      isKeyguardLocked(requireContext())
    }

    // ---- Notification access (M1a plan Task 6 rules 1-2) -----------------
    // The permission the whole app depends on, and the only way to ask for
    // it. Requires NO Keystore key and NO authentication.

    AsyncFunction("isAccessGranted") {
      isAccessGranted(requireContext())
    }

    Function("openAccessSettings") {
      openAccessSettings(requireContext())
    }

    // ---- The two user-facing switches (contract §4; plan Task 6) ---------

    AsyncFunction("setCaptureEnabled") { enabled: Boolean ->
      setCaptureEnabled(requireContext(), enabled)
    }

    AsyncFunction("setProviderFilter") { packageNames: List<String> ->
      setProviderFilter(requireContext(), packageNames)
    }

    // ---- Health (contract §4; plan Task 6 rule 4) ------------------------

    AsyncFunction("getListenerHealth") {
      listenerHealth(requireContext())
    }

    // ---- Learned package names (contract §4; provider-selection Task 3) --

    AsyncFunction("listObservedPackages") {
      observedPackages(requireContext())
    }

    // ---- Live capture events (contract §4; plan Task 6 rule 5) -----------
    //
    // The sink is installed only while JS is actually subscribed, and torn
    // down the moment it is not. Leaving it installed past OnStopObserving
    // would keep the listener service holding a lambda that closes over this
    // Module -- a leak, and a crash the first time the service delivers into
    // a bridge whose JS runtime is gone.
    //
    // SECURITY: this path carries raw bank/e-wallet notification text. It is
    // deliberately a bare hand-off to sendEvent with nothing in between --
    // no logging, no inspection, no copy kept here.

    Events(EVENT_ON_CAPTURE)

    OnStartObserving {
      installLiveSink { payload -> sendEvent(EVENT_ON_CAPTURE, payload) }
    }

    OnStopObserving {
      clearLiveSink()
    }
  }

  /** Standard Expo-module pattern: the react context, or a clear error if it's gone. */
  private fun requireContext() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
}

/**
 * The one event this module emits (interface contract §4's
 * `addCaptureListener`). A constant rather than a string literal because it
 * appears three times -- the [Events] declaration, the [sendEvent] call, and
 * the JS wrapper's listener name -- and a typo in any one of them produces a
 * silently-never-firing listener rather than an error.
 */
internal const val EVENT_ON_CAPTURE = "onCapture"

/** Only for the one line below that has nothing to report to JS. */
private const val TAG = "PeraPlanoListenerModule"

/**
 * Creates the prefs KEK on app launch (provider-selection plan Task 2), so
 * every value [CapturePrefs] seals -- the provider filter above all -- has a
 * key to seal against before anything can ask for one.
 *
 * CALLED FROM `OnCreate`, NOT LAZILY FROM `setProviderFilter`. The first
 * thing that touches `CapturePrefs` in this process may well be a read
 * (`getListenerHealth` on the health screen) or the constructor's own
 * plaintext-to-sealed migration, neither of which is a natural place to hang
 * key creation off. `OnCreate` runs once, needs no `Context` (nothing in
 * [KeyStoreBridge] does), and cannot be skipped by a JS refactor the way a
 * bootstrap call from TypeScript could.
 *
 * AND IT IS ONLY HALF THE WIRING. `PeraPlanoNotificationListenerService`'s
 * `onListenerConnected` creates the same key, independently, and both are
 * required. A user can grant notification access from Android Settings
 * before ever opening PeraPlano; Android then hosts the listener in a
 * process where this module was never created and this function never ran.
 * The capture keypair had exactly this shape -- created only by the app --
 * and silently dropped every capture on such a device until `bca1bcd`. One
 * call site is how that bug is written; two is how it is not.
 *
 * NEVER THROWS. An exception escaping module creation would take the whole
 * native module down with it, costing the app every function on this bridge
 * -- including `isDeviceSecure`/`openSecuritySettings`, which is the flow
 * that fixes a device unable to create keys in the first place. A device
 * where this fails degrades to the pre-Task-2 behaviour for the values
 * involved (see `CapturePrefs`), which is exactly what it should do.
 */
internal fun ensurePrefsKeyOnLaunch() {
  try {
    KeyStoreBridge.ensurePrefsKek()
  } catch (error: Exception) {
    // Type only, never a message: the same SECURITY discipline KeyStoreBridge
    // and the listener service hold -- nothing from the crypto layer reaches
    // logcat with a payload attached.
    Log.e(TAG, "could not prepare the prefs key: ${error.javaClass.simpleName}")
  }
}

/**
 * Whether the user has granted this app notification access (plan Task 6
 * rule 1).
 *
 * ALWAYS A LIVE QUERY, never a cached flag. Notification access is revocable
 * from system settings at any moment with no callback to this app, and some
 * OEM builds drop it across a reboot or an app update -- so a value captured
 * once at module init would keep reporting a listener that stopped working
 * days ago as healthy, which is the exact failure [listenerHealth] exists to
 * surface.
 *
 * [NotificationManagerCompat.getEnabledListenerPackages] reads the
 * `enabled_notification_listeners` secure setting and returns the PACKAGE
 * names in it. Membership of our own package is the question -- not "is the
 * list non-empty", and not whether our service class in particular appears
 * (the platform lists a component per enabled listener, and matching on the
 * class name would start returning false the moment the service is ever
 * renamed, while access is still perfectly granted).
 *
 * A top-level, [Context]-taking function for the same testability reason as
 * [isDeviceSecure] -- see its doc.
 */
internal fun isAccessGranted(context: Context): Boolean {
  val applicationContext = context.applicationContext
  return NotificationManagerCompat.getEnabledListenerPackages(applicationContext)
    .contains(applicationContext.packageName)
}

/**
 * Launches Android's Notification Access settings page so the user can grant
 * the listener (plan Task 6 rule 2). `FLAG_ACTIVITY_NEW_TASK` is required for
 * the same reason as [openSecuritySettings]: the caller holds the React
 * Application context, not an Activity.
 *
 * IT ONLY NAVIGATES. Nothing here grants anything, and nothing here reports
 * whether the user granted anything -- there is no such API. Callers find out
 * by re-running [isAccessGranted] when the app returns to the foreground,
 * exactly as with [isDeviceSecure]/[openSecuritySettings].
 */
internal fun openAccessSettings(context: Context) {
  val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  context.startActivity(intent)
}

/**
 * The global pause switch (contract §4). Writes straight through to
 * [CapturePrefs], i.e. to `SharedPreferences`, never to a field here -- the
 * listener service that has to honour this runs in a process Android may
 * create long after this one is dead, so in-memory state would be invisible
 * exactly where it matters. See [CapturePrefs]' class doc.
 */
internal fun setCaptureEnabled(context: Context, enabled: Boolean) {
  CapturePrefs(context).setCaptureEnabled(enabled)
}

/**
 * The provider allowlist (contract §4). Crosses the bridge as a JS array and
 * is stored as a set -- duplicates collapse, order is meaningless, and
 * membership is the only question [CapturePrefs.shouldCapture] ever asks.
 *
 * An EMPTY list means "allow every package", not "allow none" -- see
 * [CapturePrefs.getProviderFilter]. Passing `[]` is therefore how a caller
 * clears the filter, not how it disables capture; that is
 * [setCaptureEnabled]'s job.
 */
internal fun setProviderFilter(context: Context, packageNames: List<String>) {
  CapturePrefs(context).setProviderFilter(packageNames.toSet())
}

/**
 * The three facts contract §4's `getListenerHealth` promises, and nothing
 * else.
 *
 * `granted` is a live [isAccessGranted] call, never a stored flag -- see that
 * function's doc. `serviceConnected` and `lastCaptureAt` come from
 * [CapturePrefs], written by the listener service itself.
 *
 * `lastCaptureAt` STAYS NULL when nothing has ever been captured. `0L` is a
 * valid epoch millisecond, so a 0-as-absent sentinel would render as
 * "last captured 1 January 1970" on the health screen instead of "not yet" --
 * [CapturePrefs.lastCaptureAt] already draws that distinction with a presence
 * check, and this must not flatten it back out with an `?: 0L`.
 */
internal fun listenerHealth(context: Context): Map<String, Any?> {
  val prefs = CapturePrefs(context)
  return mapOf(
    "granted" to isAccessGranted(context),
    "serviceConnected" to prefs.isListenerConnected(),
    "lastCaptureAt" to prefs.lastCaptureAt(),
  )
}

/**
 * Every package this device has been seen posting a notification, newest
 * first (contract §4 `listObservedPackages`; provider-selection plan Task 3)
 * -- what the onboarding picker offers alongside the seed catalogue.
 *
 * These are REAL package names, read off `sbn.packageName` by the listener,
 * and that is the entire point: seven of the thirteen names in the parser
 * seed were constructed from app names, and a wrong one silently routes
 * nothing. Requires NO new Android permission -- in particular not
 * `QUERY_ALL_PACKAGES`, which is restricted on Play and unnecessary when the
 * listener is already told who posted.
 *
 * Mapped through [ObservedPackage.toMap] rather than a second hand-rolled
 * mapping, for the same reason [installLiveSink] uses [CaptureRecord.toMap]:
 * one place decides these field names.
 *
 * An empty list is the normal fresh-install answer, never an error -- the
 * user can reach the picker before any notification has arrived.
 */
internal fun observedPackages(context: Context): List<Map<String, Any?>> =
  CapturePrefs(context).listObservedPackages().map { it.toMap() }

/**
 * Points [PeraPlanoNotificationListenerService.liveSink] at [emit], adapting
 * the [CaptureRecord] the service produces into the contract §4 map JS
 * expects via [CaptureRecord.toMap] -- the same mapping `drainPendingCaptures`
 * uses, deliberately, so a live capture and a drained one can never disagree
 * about their field names.
 *
 * Paired with [clearLiveSink]; see the `OnStopObserving` comment in
 * [NotificationListenerModule] for why leaving a sink installed is both a
 * leak and a crash. Split out as a top-level function so the install/clear
 * pair is testable without a `Module` -- the same seam as everything else
 * here.
 */
internal fun installLiveSink(emit: (Map<String, Any?>) -> Unit) {
  PeraPlanoNotificationListenerService.liveSink = { record -> emit(record.toMap()) }
}

/** Detaches the live sink. `null` is the service's normal resting state. */
internal fun clearLiveSink() {
  PeraPlanoNotificationListenerService.liveSink = null
}

/**
 * Maps the two Keystore exceptions [KeyStoreBridge] can throw for ANY
 * device-KEK or capture-private-key operation to the distinguishable
 * [CodedException]s the JS side branches on -- see
 * [NotificationListenerModule]'s class doc for the full taxonomy. Every
 * other exception (a tampered blob's [javax.crypto.BadPaddingException],
 * for instance) propagates completely unchanged; this function only ever
 * narrows two specific exception types, never widens what already crosses
 * the bridge as-is.
 *
 * A top-level, Context-free function -- not a method on
 * [NotificationListenerModule] -- specifically so `NotificationListenerModuleTest`
 * can exercise it directly against real [KeyPermanentlyInvalidatedException]/
 * [UserNotAuthenticatedException] instances without constructing a `Module`
 * or an `AppContext` at all.
 */
internal fun <T> mapKeyErrors(block: () -> T): T =
  try {
    block()
  } catch (invalidated: KeyPermanentlyInvalidatedException) {
    throw DeviceKeyInvalidatedException()
  } catch (notAuthenticated: UserNotAuthenticatedException) {
    throw NotAuthenticatedException()
  }

/**
 * Throws [DeviceKeyMissingException] if the device KEK has never been
 * created at all. Deliberately distinct from [KeyPermanentlyInvalidatedException]
 * (a key that WAS created and later died) -- see [NotificationListenerModule]'s
 * class doc taxonomy: "never initialized" belongs in onboarding, "died"
 * belongs in the recovery flow, and conflating them sends the user to the
 * wrong screen.
 *
 * [KeyStoreBridge.unwrapWithDeviceKek] has no way to distinguish "never
 * created" from other Keystore failures on its own -- the underlying
 * [KeyVault.getAesKey] throws a bare, uncoded `IllegalStateException`
 * either way, from a code path shared with the (unrelated) capture-keypair
 * lookup -- so this check runs BEFORE calling it, using the same
 * [KeyVault.hasAesKey] presence check [KeyStoreBridge.isDeviceKekUsable]
 * already relies on, rather than catching that generic exception and
 * risking miscategorizing some unrelated future `IllegalStateException` as
 * `DeviceKeyMissing`.
 *
 * A top-level, Context-free function for the same testability reason as
 * [mapKeyErrors].
 */
internal fun requireDeviceKekPresent() {
  if (!KeyStoreBridge.vault.hasAesKey(KeyStoreBridge.DEVICE_KEK_ALIAS)) {
    throw DeviceKeyMissingException()
  }
}

/**
 * `KeyguardManager.isDeviceSecure()` -- true once the device has ANY screen
 * lock configured (PIN, pattern, password, or an enrolled biometric).
 *
 * docs/12-encryption-and-app-lock.md §5a: Android refuses to create a
 * Keystore key with `setUserAuthenticationRequired(true)` on a device with
 * none of these -- `KeyGenParameterSpec` throws at generation time, with no
 * fallback that preserves the security claim (task-9a-brief). This is the
 * prerequisite check onboarding runs before generating any key at all, and
 * that the unlock-time recovery flow (`lock_context.tsx`'s
 * `submitRecoveryPhrase`) runs before ever calling `recreateDeviceKek()` --
 * that call cannot create a new auth-gated key with no screen lock present
 * either.
 *
 * A top-level function taking a bare [Context] -- not a method on
 * [NotificationListenerModule] -- for the same testability reason as
 * [mapKeyErrors]/[requireDeviceKekPresent]: unlike those two this needs a
 * [Context] (there is no Context-free way to ask the platform about the
 * screen lock), but nothing else Android-framework-specific, so a
 * Robolectric test can call it directly with a plain [Context] instead of
 * constructing a `Module`/`AppContext`.
 */
internal fun isDeviceSecure(context: Context): Boolean {
  val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
  return keyguardManager.isDeviceSecure
}

/**
 * Launches Android's screen-lock settings page
 * (`Settings.ACTION_SECURITY_SETTINGS`) so the user can set a PIN, pattern,
 * password, or biometric (docs §5a; task-9a-brief). `FLAG_ACTIVITY_NEW_TASK`
 * is required because [NotificationListenerModule.requireContext] hands back
 * the React Application context, not an Activity -- starting an Activity
 * from a non-Activity [Context] throws without it.
 *
 * Fire-and-forget by design, matching the JS wrapper's `void` (not
 * `Promise<void>`) return: nothing here reports whether the user actually
 * set a lock. The caller finds that out the way task-9a-brief rule 3
 * already requires regardless -- re-checking [isDeviceSecure] when the app
 * returns to the foreground, never from anything this function returns.
 *
 * A top-level, [Context]-taking function for the same testability reason as
 * [isDeviceSecure] above.
 */
internal fun openSecuritySettings(context: Context) {
  val intent = Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  context.startActivity(intent)
}

/**
 * `KeyguardManager.isKeyguardLocked()` -- true if the device is locked RIGHT
 * NOW.
 *
 * docs/12-encryption-and-app-lock.md §7a: every app-generated alert
 * (limit alerts, bill/loan reminders, the payday summary, the
 * tracking-interrupted notice) renders on the lock screen whether or not
 * the phone is unlocked, and must show an amount-free variant while it is
 * locked. This is the query the alerts service calls at POST time --
 * immediately before `lib/alerts/alert_copy.ts`'s `selectAlertCopy` --
 * never at schedule time, because a reminder queued days earlier cannot
 * know what state the phone will be in when it actually fires.
 *
 * Deliberately distinct from [isDeviceSecure] above, which asks a different
 * question ("does this device have a screen lock configured at all",
 * docs §5a) despite both being one-line `KeyguardManager` queries wrapped
 * the same way for the same testability reason -- see that function's doc.
 */
internal fun isKeyguardLocked(context: Context): Boolean {
  val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
  return keyguardManager.isKeyguardLocked
}

/**
 * Crosses the bridge as `code == "DeviceKeyInvalidated"` -- the device
 * screen lock was removed (or the key was otherwise permanently destroyed by
 * the platform). JS must respond by prompting for the 12-word recovery
 * phrase (docs/12-encryption-and-app-lock.md §5), never by showing a generic
 * failure -- see [NotificationListenerModule]'s class doc.
 *
 * SECURITY: the message names only the failure, never any key material,
 * plaintext, or ciphertext -- see [KeyStoreBridge]'s class doc for why that
 * discipline is load-bearing everywhere in this module.
 */
internal class DeviceKeyInvalidatedException :
  CodedException(
    code = "DeviceKeyInvalidated",
    message = "the device key has been permanently invalidated",
    cause = null,
  )

/**
 * Crosses the bridge as `code == "DeviceKeyMissing"` -- the device KEK has
 * never been created on this device at all. Distinct from
 * `DeviceKeyInvalidated`: there is no prior wrap to recover, so JS belongs
 * in onboarding (`initializeKeys`, contract §9), not the recovery-phrase
 * flow. See [requireDeviceKekPresent].
 */
internal class DeviceKeyMissingException :
  CodedException(
    code = "DeviceKeyMissing",
    message = "the device key has not been created yet",
    cause = null,
  )

/**
 * Crosses the bridge as `code == "NotAuthenticated"` -- called outside the
 * ~10-second post-unlock authentication window (docs/12-encryption-and-app-lock.md
 * §7). This is NOT a statement about the buffer's contents: JS must
 * re-prompt biometric/device-credential and retry the exact same call, never
 * treat it as "nothing to drain" -- see [CaptureBuffer]'s class doc on why
 * folding this into "empty" would silently strand every buffered capture.
 */
internal class NotAuthenticatedException :
  CodedException(
    code = "NotAuthenticated",
    message = "authentication is required to complete this operation",
    cause = null,
  )

/**
 * Crosses the bridge as `code == "CaptureBufferReadFailed"` -- the
 * pending-capture file exists but a storage-layer error (permission,
 * `EMFILE`, a transient I/O error) prevented reading it; unrelated to
 * authentication or to the file's contents. JS must leave the buffer alone
 * and retry later, never treat it as "nothing to drain" -- see
 * [CaptureBuffer.ReadFailedException]'s doc for why conflating the two would
 * let one storage hiccup permanently destroy up to
 * [CaptureBuffer.MAX_CAPTURES] buffered captures.
 */
internal class CaptureBufferReadFailedException :
  CodedException(
    code = "CaptureBufferReadFailed",
    message = "the pending-capture buffer could not be read",
    cause = null,
  )

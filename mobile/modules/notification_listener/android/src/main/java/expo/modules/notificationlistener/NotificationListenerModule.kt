package expo.modules.notificationlistener

import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS-facing surface of the notification listener. The JS name is pinned by the
 * interface contract §4 wrapper (mobile/modules/notification_listener/index.ts).
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
  }

  /** Standard Expo-module pattern: the react context, or a clear error if it's gone. */
  private fun requireContext() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
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

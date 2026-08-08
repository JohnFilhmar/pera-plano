package expo.modules.notificationlistener

import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

/**
 * Covers the bridge-level exception mapping in `NotificationListenerModule.kt`
 * -- [mapKeyErrors] and [requireDeviceKekPresent] -- which is the crux of
 * Task 4's rejection taxonomy (docs/12-encryption-and-app-lock.md §6/§9;
 * interface contract §4). Both functions are top-level and Context-free
 * specifically so this can run as plain JUnit, exactly like
 * [KeyStoreBridgeTest], with no `Module`/`AppContext`/Robolectric needed:
 * neither function touches anything Android-framework-specific beyond the
 * exception CLASSES themselves (simple constructs with no real platform
 * behavior), and [KeyStoreBridge.vault] is swapped for a [FakeKeyVault]
 * exactly like every other JVM test in this module.
 *
 * A code review caught that this mapping previously had NO test at all --
 * only a successful compile and a reading of the vendor source stood behind
 * it. Without a test, a future refactor that breaks the mapping (e.g.
 * swapping two `catch` branches, or losing the presence check) produces a
 * green build and a broken unlock.
 */
class NotificationListenerModuleTest {

  @Before
  fun setUp() {
    KeyStoreBridge.vault = FakeKeyVault()
  }

  @After
  fun tearDown() {
    // Defensive, same reasoning as every other test file here: KeyStoreBridge
    // is a process-global singleton.
    KeyStoreBridge.vault = AndroidKeyVault
  }

  // ---------------------------------------------------------------------
  // mapKeyErrors
  // ---------------------------------------------------------------------

  @Test
  fun `mapKeyErrors maps KeyPermanentlyInvalidatedException to DeviceKeyInvalidatedException coded DeviceKeyInvalidated`() {
    val thrown = assertThrows(DeviceKeyInvalidatedException::class.java) {
      mapKeyErrors<Unit> { throw KeyPermanentlyInvalidatedException() }
    }

    assertEquals("DeviceKeyInvalidated", thrown.code)
  }

  @Test
  fun `mapKeyErrors maps UserNotAuthenticatedException to NotAuthenticatedException coded NotAuthenticated`() {
    val thrown = assertThrows(NotAuthenticatedException::class.java) {
      mapKeyErrors<Unit> { throw UserNotAuthenticatedException() }
    }

    assertEquals("NotAuthenticated", thrown.code)
  }

  @Test
  fun `mapKeyErrors lets an unrelated exception propagate completely unchanged`() {
    val original = IllegalArgumentException("not a Keystore failure at all")

    val propagated = assertThrows(IllegalArgumentException::class.java) {
      mapKeyErrors<Unit> { throw original }
    }

    // Not just "same exception type" -- the exact same instance, proving
    // mapKeyErrors never wraps or replaces what it doesn't recognize.
    assertSame(original, propagated)
  }

  @Test
  fun `mapKeyErrors returns the block's result untouched when nothing is thrown`() {
    val result = mapKeyErrors { "unaffected" }

    assertEquals("unaffected", result)
  }

  // ---------------------------------------------------------------------
  // requireDeviceKekPresent
  // ---------------------------------------------------------------------

  @Test
  fun `requireDeviceKekPresent throws DeviceKeyMissingException coded DeviceKeyMissing when the device KEK was never created`() {
    // setUp installs a brand-new FakeKeyVault -- no ensureDeviceKek call at
    // all, so the alias genuinely does not exist yet.
    val thrown = assertThrows(DeviceKeyMissingException::class.java) {
      requireDeviceKekPresent()
    }

    assertEquals("DeviceKeyMissing", thrown.code)
  }

  @Test
  fun `requireDeviceKekPresent does not throw once the device KEK has been created`() {
    KeyStoreBridge.ensureDeviceKek()

    requireDeviceKekPresent() // must not throw
  }

  // ---------------------------------------------------------------------
  // The taxonomy's four codes are pairwise distinct strings -- collapsing
  // any two would be exactly the bug class this task exists to avoid.
  // ---------------------------------------------------------------------

  @Test
  fun `the four bridge error codes are pairwise distinct`() {
    val codes = listOf(
      DeviceKeyInvalidatedException().code,
      DeviceKeyMissingException().code,
      NotAuthenticatedException().code,
      CaptureBufferReadFailedException().code,
    )

    assertEquals(4, codes.toSet().size)
    assertEquals("DeviceKeyInvalidated", codes[0])
    assertEquals("DeviceKeyMissing", codes[1])
    assertEquals("NotAuthenticated", codes[2])
    assertEquals("CaptureBufferReadFailed", codes[3])
    // Belt-and-suspenders pairwise check, spelled out rather than only
    // relying on set-size: makes the failure message point at exactly
    // which two codes collided if this regresses.
    for (i in codes.indices) {
      for (j in codes.indices) {
        if (i != j) assertNotEquals(codes[i], codes[j])
      }
    }
  }
}

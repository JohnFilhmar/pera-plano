package expo.modules.notificationlistener

import android.app.KeyguardManager
import android.content.Context
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

/**
 * Covers `isKeyguardLocked` (docs/12-encryption-and-app-lock.md §7a;
 * interface contract §4; task-9b-brief) -- the check the alerts service
 * (M2's limit alerts, M2b's loan reminders, M2c's bill reminders, M3's
 * payday summary and tracking-interrupted notice) must run at POST time,
 * never at schedule time, immediately before choosing which `AlertCopy`
 * variant (`lib/alerts/alert_copy.ts`'s `selectAlertCopy`) to actually show.
 *
 * Distinct from `isDeviceSecure` in DeviceSecurityTest.kt, which is a
 * different `KeyguardManager` query answering a different question: that
 * one asks "does this device HAVE a screen lock configured at all" (an
 * onboarding-time prerequisite, docs §5a); this one asks "is the device
 * locked RIGHT NOW" (a per-notification check, docs §7a). Conflating the two
 * would mean either checking the wrong thing at post time or being unable
 * to gate onboarding at all.
 *
 * Robolectric, same reasoning as DeviceSecurityTest: `KeyguardManager` has
 * no meaning outside an Android runtime, and `ShadowKeyguardManager`
 * provides `setKeyguardLocked` as a direct hook for `isKeyguardLocked()`.
 */
// sdk 34, matching every other Robolectric suite in this module (see
// CaptureEnvelopeTest's doc for why: this module's real compileSdk 36 needs
// Java 21, and the toolchain at the time this module's tests were written was
// Java 17).
@Config(sdk = [34])
@RunWith(RobolectricTestRunner::class)
class KeyguardStateTest {

  @Test
  fun `isKeyguardLocked returns true when the keyguard is currently engaged`() {
    val context = RuntimeEnvironment.getApplication()
    val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    Shadows.shadowOf(keyguardManager).setKeyguardLocked(true)

    assertTrue(isKeyguardLocked(context))
  }

  @Test
  fun `isKeyguardLocked returns false once the device is unlocked -- the state that selects the unlocked AlertCopy variant`() {
    val context = RuntimeEnvironment.getApplication()
    val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    Shadows.shadowOf(keyguardManager).setKeyguardLocked(false)

    assertFalse(isKeyguardLocked(context))
  }
}

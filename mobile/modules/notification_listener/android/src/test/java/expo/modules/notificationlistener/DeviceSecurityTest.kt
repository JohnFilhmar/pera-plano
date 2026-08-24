package expo.modules.notificationlistener

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

/**
 * Covers the two bridge-level, Context-taking helpers `isDeviceSecure` and
 * `openSecuritySettings` (task-9a-brief; docs/12-encryption-and-app-lock.md
 * §5a) -- both top-level and Context-free of anything BUT a bare [Context]
 * for the same testability reason as [mapKeyErrors]/[requireDeviceKekPresent]
 * in `NotificationListenerModuleTest`: no `Module`/`AppContext` needed, only
 * a real Android [Context], which is exactly what Robolectric provides.
 *
 * Runs under Robolectric, not plain JUnit -- unlike `mapKeyErrors`, these two
 * touch real Android framework classes (`KeyguardManager`, `Settings`,
 * `Context.startActivity`) that have no meaning outside an Android runtime.
 */
// sdk 34, matching every other Robolectric suite in this module (see
// CaptureEnvelopeTest's doc for why: this module's real compileSdk 36 needs
// Java 21, and the toolchain at the time this module's tests were written was
// Java 17).
@Config(sdk = [34])
@RunWith(RobolectricTestRunner::class)
class DeviceSecurityTest {

  // ---------------------------------------------------------------------
  // isDeviceSecure
  // ---------------------------------------------------------------------

  @Test
  fun `isDeviceSecure returns true when KeyguardManager reports a screen lock is configured`() {
    val context = RuntimeEnvironment.getApplication()
    val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    Shadows.shadowOf(keyguardManager).setIsDeviceSecure(true)

    assertTrue(isDeviceSecure(context))
  }

  @Test
  fun `isDeviceSecure returns false when no screen lock is configured -- the exact state docs §5a exists to catch`() {
    val context = RuntimeEnvironment.getApplication()
    val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    Shadows.shadowOf(keyguardManager).setIsDeviceSecure(false)

    assertFalse(isDeviceSecure(context))
  }

  // ---------------------------------------------------------------------
  // openSecuritySettings
  // ---------------------------------------------------------------------

  @Test
  fun `openSecuritySettings starts an Intent for ACTION_SECURITY_SETTINGS`() {
    val context = RuntimeEnvironment.getApplication()

    openSecuritySettings(context)

    val started = Shadows.shadowOf(context).nextStartedActivity
    assertNotNull("openSecuritySettings must actually call startActivity", started)
    assertEquals(Settings.ACTION_SECURITY_SETTINGS, started.action)
  }

  @Test
  fun `openSecuritySettings sets FLAG_ACTIVITY_NEW_TASK -- required because the caller is not an Activity Context`() {
    val context = RuntimeEnvironment.getApplication()

    openSecuritySettings(context)

    val started = Shadows.shadowOf(context).nextStartedActivity
    assertTrue(
      "starting an Activity from a non-Activity Context throws on a real device without this flag",
      (started.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0,
    )
  }
}

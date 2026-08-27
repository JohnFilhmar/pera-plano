package expo.modules.notificationlistener

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

/**
 * Covers `AppLabels.kt` -- resolving an Android package to the name the user
 * actually sees on their launcher.
 *
 * WHY IT MATTERS ENOUGH TO TEST. The provider picker's whole job is to have
 * the user recognise their own banking apps. Before this, the only names it
 * had were the parser seed's hand-written brand names and, failing that, the
 * raw package id -- and the seed's names go stale, because banks rebrand and
 * package ids do not. `ph.seabank.seabank` still routes as "seabank" and the
 * app on the phone is called Maribank.
 *
 * The two behaviours worth pinning are both about ABSENCE. Every degenerate
 * case has to come back `null`/absent rather than a plausible-looking
 * placeholder, because JS falls through to a better answer on absence and
 * would print the placeholder instead. That is why "app declares no label"
 * (where `loadLabel` helpfully returns the package name) is tested
 * explicitly: it is the case most likely to be "fixed" into a regression.
 */
@Config(sdk = [34])
@RunWith(RobolectricTestRunner::class)
class AppLabelsTest {
  private lateinit var context: Context

  private val gcash = "com.globe.gcash.android"
  private val rebranded = "ph.seabank.seabank"

  @Before
  fun setUp() {
    context = RuntimeEnvironment.getApplication()
  }

  /**
   * Puts a package on the fake device.
   *
   * `nonLocalizedLabel` rather than `labelRes`: `loadLabel` prefers it and it
   * needs no resource table, which keeps these tests about the resolution
   * rules rather than about Robolectric's resource plumbing. Passing `null`
   * models an app that declares no label at all, where `loadLabel` falls back
   * to returning the package name.
   */
  private fun installPackage(packageName: String, label: CharSequence?) {
    val applicationInfo = ApplicationInfo().apply {
      this.packageName = packageName
      if (label != null) nonLocalizedLabel = label
    }
    val packageInfo = PackageInfo().apply {
      this.packageName = packageName
      this.applicationInfo = applicationInfo
    }
    Shadows.shadowOf(context.packageManager).installPackage(packageInfo)
  }

  // -------------------------------------------------------------------------
  // sanitizeAppLabel -- pure, and where every absence decision is made.
  // -------------------------------------------------------------------------

  @Test
  fun `an ordinary label passes through`() {
    assertEquals("Maribank", sanitizeAppLabel("Maribank", rebranded))
  }

  @Test
  fun `a null label is absent`() {
    assertNull(sanitizeAppLabel(null, rebranded))
  }

  @Test
  fun `a blank label is absent rather than an empty tile`() {
    assertNull(sanitizeAppLabel("", rebranded))
    assertNull(sanitizeAppLabel("   ", rebranded))
  }

  @Test
  fun `a label equal to the package name is absent, not a resolved answer`() {
    // What `loadLabel` returns for an app declaring no `android:label`.
    // Returning it would silently pre-empt the seed's real brand name, so an
    // unlabelled `com.seabank.ph` would render as "com.seabank.ph" instead of
    // "SeaBank" -- worse than the behaviour before this file existed.
    assertNull(sanitizeAppLabel(rebranded, rebranded))
  }

  @Test
  fun `whitespace is trimmed and collapsed`() {
    assertEquals("Bank PH", sanitizeAppLabel("  Bank   PH  ", gcash))
  }

  @Test
  fun `a newline becomes a space rather than eating the rest of the line`() {
    // The tile renders one line. A label carrying a newline would otherwise
    // silently drop everything after it.
    assertEquals("Bank PH", sanitizeAppLabel("Bank\nPH", gcash))
  }

  @Test
  fun `an over-long label is capped`() {
    val long = "M".repeat(200)
    val result = sanitizeAppLabel(long, gcash)

    // An app label is arbitrary text chosen by whoever built the app, so it
    // is treated like any other foreign string at this boundary.
    assertEquals(64, result?.length)
  }

  // -------------------------------------------------------------------------
  // appLabels -- the PackageManager round trip.
  // -------------------------------------------------------------------------

  @Test
  fun `resolves the installed app's real name`() {
    installPackage(rebranded, "Maribank")

    assertEquals(mapOf(rebranded to "Maribank"), appLabels(context, listOf(rebranded)))
  }

  @Test
  fun `an uninstalled package is absent rather than an error or a placeholder`() {
    // The normal answer for the "Common in the Philippines" group, which is
    // BY DEFINITION apps this phone does not have.
    assertTrue(appLabels(context, listOf("com.not.installed")).isEmpty())
  }

  @Test
  fun `one unresolvable package does not cost the others their names`() {
    installPackage(gcash, "GCash")
    installPackage(rebranded, "Maribank")

    val labels = appLabels(context, listOf(gcash, "com.not.installed", rebranded))

    assertEquals(mapOf(gcash to "GCash", rebranded to "Maribank"), labels)
  }

  @Test
  fun `an installed app that declares no label is absent`() {
    installPackage(rebranded, null)

    assertFalse(appLabels(context, listOf(rebranded)).containsKey(rebranded))
  }

  @Test
  fun `blank and duplicate requests are skipped`() {
    installPackage(gcash, "GCash")

    val labels = appLabels(context, listOf("", "   ", gcash, gcash))

    assertEquals(mapOf(gcash to "GCash"), labels)
  }

  @Test
  fun `an empty request is an empty answer, never an error`() {
    assertTrue(appLabels(context, emptyList()).isEmpty())
  }

  @Test
  fun `a package name is trimmed before it is looked up and keyed`() {
    installPackage(gcash, "GCash")

    assertEquals(mapOf(gcash to "GCash"), appLabels(context, listOf("  $gcash  ")))
  }
}

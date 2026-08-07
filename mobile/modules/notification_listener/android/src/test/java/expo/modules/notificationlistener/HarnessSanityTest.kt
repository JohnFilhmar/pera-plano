package expo.modules.notificationlistener

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Proves the JVM unit-test harness for this local Expo module actually
 * compiles and runs Kotlin tests end-to-end (Task 1 of the M1a plan).
 * Task 6 adds real coverage of the capture buffer/filter alongside this.
 */
class HarnessSanityTest {
  @Test
  fun `junit and kotlin actually run in this module`() {
    assertEquals(2, 1 + 1)
  }
}

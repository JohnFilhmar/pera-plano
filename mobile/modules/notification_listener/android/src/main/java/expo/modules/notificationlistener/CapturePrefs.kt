package expo.modules.notificationlistener

import android.content.Context
import android.content.SharedPreferences

/**
 * The listener's two user-facing switches -- the global capture pause and the
 * provider allowlist -- plus the two health facts the JS side reports back
 * (`serviceConnected`, `lastCaptureAt`, interface contract §4).
 *
 * All four live in [SharedPreferences] rather than in memory for one reason:
 * Android starts `PeraPlanoNotificationListenerService` on its own schedule,
 * in a process that may have been created purely to host it, long after the
 * process that set these values was killed. The service has to be able to
 * answer "should I capture this?" with no JS running and no user present, so
 * the answer has to already be on disk. A field on a singleton would be
 * silently reset to the default on every process restart -- and the visible
 * symptom would be the app quietly capturing from providers the user
 * de-selected, which is a privacy regression, not a glitch.
 *
 * NEVER THROWS. Every getter falls back to its documented default rather than
 * propagating. This is not defensive habit: the only callers that matter run
 * inside the listener service, which is alive precisely when no UI exists to
 * report a failure. A `ClassCastException` out of [SharedPreferences.getStringSet]
 * -- the realistic shape of a preferences file left behind by an older build
 * that stored the filter under the same key with a different type -- would
 * kill `onNotificationPosted` and cost every capture from then on, with
 * nothing anywhere to say why. Falling back to "capture enabled, allow all"
 * degrades toward capturing too much, which the user can see and correct;
 * the alternative degrades toward capturing nothing, which they cannot.
 *
 * Writes use `commit()`, not `apply()`. `apply()` only guarantees its
 * background flush completes when the process shuts down through the normal
 * Android lifecycle, and the process hosting a notification listener is a
 * prime low-memory-kill candidate that frequently does not. The values here
 * are small and written rarely (a settings toggle, or once per captured
 * notification), so the blocking write costs far less than losing the pause
 * switch the user just turned off.
 */
class CapturePrefs(context: Context) {

  // applicationContext, not the caller's: a Service or Activity Context would
  // otherwise be captured for the lifetime of this object, and -- more to the
  // point -- Android keys its SharedPreferences cache per name, so both the
  // service and the bridge module must reach the same instance for a write on
  // one side to be visible on the other without a disk round trip.
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  // ---------------------------------------------------------------------
  // Global pause switch -- defaults ON.
  // ---------------------------------------------------------------------

  /**
   * Whether capture is switched on at all. Defaults to `true`: a fresh
   * install has to capture before the user has been anywhere near a settings
   * screen, otherwise the app looks broken rather than paused.
   */
  fun isCaptureEnabled(): Boolean =
    try {
      prefs.getBoolean(KEY_CAPTURE_ENABLED, DEFAULT_CAPTURE_ENABLED)
    } catch (error: Exception) {
      DEFAULT_CAPTURE_ENABLED
    }

  fun setCaptureEnabled(enabled: Boolean) {
    write { it.putBoolean(KEY_CAPTURE_ENABLED, enabled) }
  }

  // ---------------------------------------------------------------------
  // Provider allowlist -- empty means ALLOW ALL, not deny all.
  // ---------------------------------------------------------------------

  /**
   * The set of package names capture is restricted to. **An empty set means
   * "allow every package"**, which is also the fresh-install state: the user
   * has not picked providers yet and must not have to before anything works.
   * Reading empty as "allow nothing" is the inverted default that would make
   * a new install capture silently nothing at all.
   */
  fun getProviderFilter(): Set<String> =
    try {
      // Copied out deliberately. The Set handed back by getStringSet is the
      // live instance SharedPreferences holds, and the platform documents its
      // contents as unstable across a later edit -- handing it to a caller
      // would let a mutation reach into the stored preferences.
      prefs.getStringSet(KEY_PROVIDER_FILTER, null)?.toSet() ?: emptySet()
    } catch (error: Exception) {
      emptySet()
    }

  fun setProviderFilter(packageNames: Set<String>) {
    // Copy on the way in for the mirror-image reason: SharedPreferences stores
    // the reference, so a caller that kept and mutated its own set would
    // otherwise be silently editing persisted state.
    val stored = packageNames.toSet()
    write { it.putStringSet(KEY_PROVIDER_FILTER, stored) }
  }

  /**
   * The one question the listener service actually asks, per plan rule 2:
   * `isCaptureEnabled() && (filter.isEmpty() || packageName in filter)`.
   *
   * The pause switch outranks the allowlist -- when capture is off, no
   * package passes, including ones the user explicitly allowlisted.
   */
  fun shouldCapture(packageName: String): Boolean {
    if (!isCaptureEnabled()) return false
    val filter = getProviderFilter()
    return filter.isEmpty() || packageName in filter
  }

  // ---------------------------------------------------------------------
  // Health facts (contract §4 `getListenerHealth`).
  // ---------------------------------------------------------------------

  /**
   * Records whether Android currently has the listener service bound, written
   * from `onListenerConnected`/`onListenerDisconnected`. Defaults to `false`:
   * never claim a binding that has not been observed -- the health UI's job is
   * to catch exactly the case where the service is not running.
   */
  fun recordListenerConnected(connected: Boolean) {
    write { it.putBoolean(KEY_LISTENER_CONNECTED, connected) }
  }

  fun isListenerConnected(): Boolean =
    try {
      prefs.getBoolean(KEY_LISTENER_CONNECTED, DEFAULT_LISTENER_CONNECTED)
    } catch (error: Exception) {
      DEFAULT_LISTENER_CONNECTED
    }

  /** [atMillis] is epoch milliseconds (interface contract §1). */
  fun recordCapture(atMillis: Long) {
    write { it.putLong(KEY_LAST_CAPTURE_AT, atMillis) }
  }

  /**
   * Epoch milliseconds of the most recent capture, or `null` when nothing has
   * ever been captured.
   *
   * `null`, not `0L`, and the distinction is load-bearing: `0L` is a valid
   * epoch millisecond value, so a `0L`-as-absent sentinel would report "last
   * captured 1 January 1970" to the health screen instead of "not yet" --
   * and, worse, would erase a genuine `recordCapture(0L)`. Hence the explicit
   * [SharedPreferences.contains] presence check rather than a default value.
   */
  fun lastCaptureAt(): Long? =
    try {
      if (prefs.contains(KEY_LAST_CAPTURE_AT)) {
        prefs.getLong(KEY_LAST_CAPTURE_AT, 0L)
      } else {
        null
      }
    } catch (error: Exception) {
      null
    }

  /**
   * Every write goes through here so the `commit()`-not-`apply()` decision
   * (see the class doc) is made in exactly one place, and so a failing write
   * can never escape into the listener service either.
   */
  private fun write(edit: (SharedPreferences.Editor) -> SharedPreferences.Editor) {
    try {
      edit(prefs.edit()).commit()
    } catch (error: Exception) {
      // Nothing useful to do and nowhere to report it -- the caller is
      // usually the headless service. The next read falls back to its
      // documented default, which is the same outcome as the write never
      // having happened.
    }
  }

  companion object {
    /**
     * Pinned by the plan (Task 4 rule 1). Changing this string silently
     * abandons every user's existing pause switch and allowlist back to the
     * defaults, so it is effectively a data migration, not a rename.
     */
    const val PREFS_NAME = "peraplano_capture_prefs"

    private const val KEY_CAPTURE_ENABLED = "capture_enabled"
    private const val KEY_PROVIDER_FILTER = "provider_filter"
    private const val KEY_LISTENER_CONNECTED = "listener_connected"
    private const val KEY_LAST_CAPTURE_AT = "last_capture_at"

    private const val DEFAULT_CAPTURE_ENABLED = true
    private const val DEFAULT_LISTENER_CONNECTED = false
  }
}

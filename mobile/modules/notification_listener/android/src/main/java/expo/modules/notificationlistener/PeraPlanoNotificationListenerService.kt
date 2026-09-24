package expo.modules.notificationlistener

import android.app.Notification
import android.content.Context
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.io.File
import java.util.UUID

/**
 * The 24/7 capture service (M1a plan Task 5; interface contract §4).
 *
 * This is the only part of PeraPlano that runs when the app is closed. Android
 * binds it on its own schedule -- often in a process created purely to host it,
 * with no JS, no UI, no user, and (per docs/12-encryption-and-app-lock.md §6)
 * no DEK in memory. A notification it drops is gone with no trace and nowhere
 * to report it, which is why almost every decision below is about not dropping
 * and not leaking rather than about the happy path.
 *
 * THE ORDER IN [handlePosted] IS THE DESIGN (plan rule 3): seal-and-append to
 * [CaptureBuffer] FIRST, then [CapturePrefs.recordCapture], and only then tell
 * [liveSink]. If JS dies part-way through delivery -- which is routine, since
 * the sink is a bridge into a process Android kills freely -- the capture is
 * already durable on disk and the next drain picks it up. The reverse order
 * loses exactly the captures that arrive during a crash, i.e. the ones hardest
 * to notice missing.
 *
 * THE MIRROR RULE: [liveSink] must NEVER fire for a notification that was
 * dropped -- capture paused, package outside the allowlist, ongoing, or
 * carrying no text. That path would hand JS the precise notification text the
 * user asked not to capture, so every drop below is a bare `return` before the
 * sink is ever reached.
 *
 * THE ONE THING THAT HAPPENS EVEN FOR A DROPPED NOTIFICATION is
 * [CapturePrefs.recordObservedPackage] -- the package NAME, and nothing else
 * (provider-selection plan Task 3). It is not an exception to the mirror rule
 * but its complement: the rule is about notification CONTENT, and an
 * unselected package is exactly what the onboarding picker exists to offer.
 * It is told whether the delivery is ongoing so it can record a package's
 * first sighting while ignoring the re-posts that follow -- an ongoing tile
 * arrives about once a second, and a prefs write per arrival is main-thread
 * I/O with no end to it. See the comment on the call itself.
 *
 * AND THE SAME THING HAPPENS ONCE PER BIND, FROM THE SHADE (GAP-125).
 * [onListenerConnected] hands whatever is already posted to
 * [CapturePrefs.recordObservedPackages]. Without it the observed list starts
 * EMPTY at the instant the user grants access and fills only from what posts
 * afterwards -- so the onboarding picker, which runs seconds later and whose
 * whole subject is "apps we've seen", had nothing to show. Names only, exactly
 * as above: [recordObservedFrom] reads the package name and the post time off
 * each [StatusBarNotification] and touches nothing else on it.
 *
 * TESTABILITY: [extractCapture] is a pure companion function and [handlePosted]
 * takes its [CapturePrefs] and its buffer `File` as parameters, so the whole
 * flow is exercisable with no running Android `Service` at all (plan rule 1).
 * The buffer `File` doubles as the observation seam -- [CaptureBuffer] is a
 * Kotlin `object` with nothing to inject, and reading back the real sealed
 * NDJSON it wrote is a stronger assertion than any recorded call would be.
 *
 * SECURITY: nothing here may put notification text into a log. This class
 * handles bank and e-wallet messages by definition, and a crash reporter that
 * scrapes logcat is exactly the exfiltration path that would create -- the
 * same discipline [KeyStoreBridge] and [CaptureEnvelope] hold.
 */
class PeraPlanoNotificationListenerService : NotificationListenerService() {

  /**
   * Deliberately does not call `super`: the base implementation is empty, and
   * this must never throw (see [handlePosted]).
   */
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      handlePosted(
        sbn = sbn,
        prefs = CapturePrefs(this),
        bufferFile = CaptureBuffer.fileFor(this),
        nowMillis = System.currentTimeMillis(),
      )
    } catch (error: Exception) {
      // Only reachable if the Context itself is unusable (no filesDir, no
      // SharedPreferences) -- handlePosted swallows everything downstream of
      // that. Still caught here, because an exception escaping onto the
      // binder thread costs every subsequent capture too.
      Log.e(TAG, "could not start the capture flow: ${error.javaClass.simpleName}")
    }
  }

  override fun onListenerConnected() {
    // Keys BEFORE anything that touches CapturePrefs: constructing it runs
    // the plaintext-to-sealed migration, which needs the prefs KEK.
    ensureKeysReady()
    recordConnection(this, true)
    recordActiveNotifications(this)
  }

  override fun onListenerDisconnected() {
    recordConnection(this, false)
  }

  /**
   * Creates BOTH Keystore keys this service depends on, if they do not exist
   * yet, so it can run with no help from the app at all:
   *
   *  - the **capture keypair**, whose public half seals every notification
   *    into [CaptureBuffer];
   *  - the **prefs KEK**, which seals the provider filter [CapturePrefs]
   *    consults on every delivery.
   *
   * WHY THIS IS HERE AT ALL. Nothing stops a user granting notification
   * access from Android Settings before they ever open PeraPlano. Until the
   * first call existed, that user's notifications were all silently dropped:
   * `CaptureBuffer.append` looks the capture public key up on every append,
   * the keypair was created only by the app, and so `getPublicKey` threw
   * `IllegalStateException` on every single post. [handlePosted]'s catch
   * turned that into one logcat line per lost notification. Found on a real
   * device, not by the suite -- see the regression test of the same name.
   *
   * THE PREFS KEK IS HERE FOR THE IDENTICAL REASON, and it is the second time
   * the shape has come up: on that same never-opened install, `CapturePrefs`
   * could neither open the filter (falling back to allow-all, capturing from
   * every app on the phone) nor seal a capture timestamp (leaving the health
   * screen reporting "not yet" forever). The app-launch path creates it too
   * -- `ensurePrefsKeyOnLaunch`, from the module's `OnCreate` -- and BOTH are
   * required: neither process is guaranteed to have run first.
   *
   * Each key is ensured in its own guarded call, not one shared `try`, so a
   * device that cannot create one still gets the other. Safe to call on every
   * bind: both `ensure*` functions are idempotent and never rotate an
   * existing key, so neither can orphan an already-sealed record or filter.
   * Done once per connection rather than per notification because generating
   * a Keystore key is expensive and posts are frequent.
   *
   * Never throws. On a device with no screen lock, capture-keypair generation
   * legitimately fails (docs/12-encryption-and-app-lock.md §5a) and there is
   * nothing this service can do about it -- onboarding is what must demand a
   * screen lock. Dropping back to the previous behaviour is the correct
   * outcome there. (The prefs KEK is unauthenticated and is not subject to
   * that constraint; see `AndroidKeyVault.getOrCreateUnauthenticatedAesKey`.)
   */
  private fun ensureKeysReady() {
    ensureKey("the capture keypair") { KeyStoreBridge.ensureCaptureKeyPair() }
    ensureKey("the prefs key") { KeyStoreBridge.ensurePrefsKek() }
  }

  private fun ensureKey(what: String, ensure: () -> Unit) {
    try {
      ensure()
    } catch (error: Exception) {
      // Message deliberately omitted -- see the class doc's SECURITY note.
      Log.e(TAG, "could not prepare $what: ${error.javaClass.simpleName}")
    }
  }

  /**
   * Plan rule 4. Wrapped for the same never-throw reason as [handlePosted]:
   * these run on the same binder thread, and Android calls
   * `onListenerDisconnected` while it is tearing the service down.
   */
  private fun recordConnection(context: Context, connected: Boolean) {
    try {
      CapturePrefs(context).recordListenerConnected(connected)
    } catch (error: Exception) {
      Log.e(TAG, "could not record the listener connection state: ${error.javaClass.simpleName}")
    }
  }

  /**
   * Records every package already sitting in the shade at bind time
   * (GAP-125).
   *
   * AFTER [recordConnection], NOT BEFORE. Reporting the binding is plan rule 4
   * and the health screen reads it; this is a convenience for one onboarding
   * screen, and it must not be able to delay or displace the thing that says
   * the listener is alive.
   *
   * WRAPPED, like its two neighbours. `activeNotifications` throws when the
   * listener is not currently connected, and Android can tear this service
   * down around the callback, so the one thing this must never do is take the
   * bind down with it. A failure here costs a fuller picker on a first run and
   * nothing else -- the list still fills from live posts exactly as before.
   */
  private fun recordActiveNotifications(context: Context) {
    try {
      val prefs = CapturePrefs(context)
      val now = System.currentTimeMillis()
      // Read ONCE: `activeNotifications` is a binder call into the system
      // server, and the two passes below must agree about what was on screen.
      val active = activeNotifications
      recordObservedFrom(active, prefs, now)
      // The captures themselves, for the gap an OEM kill left (GAP-050).
      // AFTER the sighting pass, so a package the allowlist drops is still
      // offered to the onboarding picker, which is the reason that pass runs
      // before every drop in `handlePosted` too.
      captureActiveSince(active, prefs, CaptureBuffer.fileFor(context), now)
    } catch (error: Exception) {
      // Message deliberately omitted -- see the class doc's SECURITY note.
      Log.e(TAG, "could not record the active notifications: ${error.javaClass.simpleName}")
    }
  }

  companion object {

    private const val TAG = "PeraPlanoListener"

    /**
     * Set by `NotificationListenerModule` while JS is alive and listening, and
     * cleared when it stops -- so live capture events flow only while there is
     * something on the other end. `null` is the normal state, not an error:
     * the service spends most of its life running with no JS process at all,
     * which is precisely what [CaptureBuffer] exists for.
     *
     * `@Volatile` because it is written from the JS thread and read from the
     * binder thread Android delivers notifications on. Without it a sink
     * installed by `OnStartObserving` can stay invisible to the listener
     * thread indefinitely (and, worse, a CLEARED sink can stay visible --
     * delivering into a dead bridge).
     */
    @Volatile
    @JvmStatic
    var liveSink: ((CaptureRecord) -> Unit)? = null

    /**
     * Pulls one [CaptureRecord] out of a posted notification, or `null` if the
     * notification carries no text worth capturing (plan rule 2).
     *
     * Pure and static by design -- no `Service`, no `Context` -- which is what
     * makes the parsing testable without an Android runtime (plan rule 1).
     *
     * [nowMillis] becomes `capturedAt`; `postedAt` comes from
     * [StatusBarNotification.getPostTime]. Two genuinely different facts
     * (interface contract §1, epoch milliseconds both): a capture can sit in
     * the buffer for days before anything reads it, so collapsing them would
     * report every buffered transaction as having happened at drain time.
     */
    @JvmStatic
    fun extractCapture(sbn: StatusBarNotification, nowMillis: Long): CaptureRecord? {
      val extras: Bundle? = sbn.notification?.extras

      val title = extras.captureText(Notification.EXTRA_TITLE)
      val text = extras.captureText(Notification.EXTRA_TEXT)
      val subText = extras.captureText(Notification.EXTRA_SUB_TEXT)
      val bigText = extras.captureText(Notification.EXTRA_BIG_TEXT)

      // Plan rule 2. All four absent-or-blank means there is no financial
      // information here at all -- a media-player tile, a "connected to
      // Wi-Fi" toast -- and it must not consume one of the buffer's bounded
      // slots, let alone reach JS.
      if (title == null && text == null && subText == null && bigText == null) {
        return null
      }

      return CaptureRecord(
        // Interface contract §1: UUIDv4, generated client-side.
        id = UUID.randomUUID().toString(),
        packageName = sbn.packageName,
        title = title,
        text = text,
        subText = subText,
        bigText = bigText,
        postedAt = sbn.postTime,
        capturedAt = nowMillis,
        // The slot this arrived in, so JS can tell an EDIT of a notification
        // it has already captured from a second, genuine transaction. Neither
        // [id] nor the text can: [id] is per-delivery, and a repost carries
        // the same text as its original. Not user content -- the key is
        // `package|id|tag|user`, none of which is notification text.
        notificationKey = sbn.key,
      )
    }

    /**
     * Turns the shade into the observed-package list (GAP-125), as a pure
     * companion function so it runs with no `Service` attached -- the same
     * seam [handlePosted] uses, and for the same reason: `activeNotifications`
     * is a property of a bound service, and a test that had to bind one could
     * only assert that binding works.
     *
     * NAMES AND TIMES ONLY. `packageName` and `postTime` are read off each
     * delivery and nothing else is touched, so this stays on the same side of
     * the mirror rule as [CapturePrefs.recordObservedPackage]: the rule is
     * about notification CONTENT, and the whole point of the picker is to
     * offer packages the user has not selected yet.
     *
     * ONGOING TILES COUNT HERE, unlike on the posted path. There the
     * `isOngoing` flag exists to stop a tile re-posting once a second from
     * paying for a write each time; this runs once per bind, so there is no
     * re-post to suppress -- and a bank's persistent tile can be the only
     * thing it has posted, which makes it exactly the evidence the picker
     * wants.
     *
     * THE LATEST POST WINS for a package that appears twice, because the list
     * is capped and sorted by recency: taking whichever entry the array
     * happened to list last would drop the wrong one at the cap.
     *
     * `nowMillis` is a FALLBACK, not the value used. A `postTime` of zero or
     * less is not a real instant, and letting it through would sort that
     * package to the bottom and make it the first thing dropped at the cap --
     * so an app with a broken post time is recorded as seen now rather than
     * silently discarded.
     */
    internal fun recordObservedFrom(
      active: Array<StatusBarNotification>?,
      prefs: CapturePrefs,
      nowMillis: Long,
    ) {
      val sightings = active.orEmpty()
        .filter { it.packageName != null && it.packageName.isNotEmpty() }
        .groupBy { it.packageName }
        .mapValues { (_, posts) ->
          posts.maxOf { if (it.postTime > 0L) it.postTime else nowMillis }
        }

      prefs.recordObservedPackages(sightings)
    }

    /**
     * Captures what is still sitting in the shade and arrived while nothing
     * was listening (docs/03 principle 5, GAP-050).
     *
     * BOUNDED BY [CapturePrefs.lastCaptureAt], and the bound is the design
     * rather than an optimisation. Feeding the whole shade through on every
     * bind would re-capture whatever has been sitting there since yesterday,
     * long past the replay window that recognises a redelivery, and a
     * re-captured bank notification becomes a SECOND transaction in the
     * user's ledger. Everything posted after the last capture is exactly the
     * gap the kill left, and nothing older than it can be new.
     *
     * NO FLOOR MEANS NO GAP. A device that has never captured anything cannot
     * know which of these the user has already dealt with, so a fresh install
     * takes none of them and the live path picks up everything from here.
     *
     * Each notification goes through [handlePosted], so the pause switch, the
     * ongoing-tile rule and the provider allowlist all apply exactly as they
     * do to a live post; this adds no way into the buffer that a live capture
     * does not already have.
     *
     * @return how many notifications were fed through, for the caller's log.
     */
    internal fun captureActiveSince(
      active: Array<StatusBarNotification>?,
      prefs: CapturePrefs,
      bufferFile: File,
      nowMillis: Long,
    ): Int {
      val floor = prefs.lastCaptureAt() ?: return 0
      var offered = 0
      for (sbn in active.orEmpty()) {
        if (sbn.postTime <= floor) continue
        handlePosted(sbn, prefs, bufferFile, nowMillis)
        offered++
      }
      return offered
    }

    /**
     * The posted flow, with every collaborator passed in so it can run with no
     * `Service` attached -- see the class doc on the seam.
     *
     * NEVER THROWS. Same reasoning as [CapturePrefs]' never-throw rule, one
     * layer up: this runs headless on a binder thread with no UI in existence,
     * so an escaping exception would not merely lose this capture, it would
     * take out the whole delivery and, in the realistic case of a persistent
     * cause (a full disk, a preferences file left by an older build), every
     * capture after it -- silently.
     *
     * `Error` is deliberately NOT caught: an `OutOfMemoryError` or
     * `StackOverflowError` says the process is already unrecoverable, and
     * pretending otherwise here just hides it.
     */
    internal fun handlePosted(
      sbn: StatusBarNotification,
      prefs: CapturePrefs,
      bufferFile: File,
      nowMillis: Long,
    ) {
      try {
        // Read once and passed to both users below, so the recording and the
        // drop can never disagree about what this delivery is.
        val isOngoing = sbn.isOngoing

        // BEFORE EVERY DROP BELOW, and that placement is the whole point
        // (provider-selection plan Task 3 rule 1). Not one of the fifteen
        // package names in the parser seed has been checked against a device
        // or a Play listing, and a wrong one is a silent failure
        // -- the provider is never routed and the bank simply looks broken.
        // This service sees `sbn.packageName` for every notification on the
        // device, so it is the one place that can learn the real ones, with
        // no new permission.
        //
        // A package the user has NOT selected -- one dropped by the filter
        // three lines down, or an ongoing tile dropped on the next -- is
        // precisely the one the onboarding picker has to be able to offer.
        // Recording after any of these returns would surface only the apps
        // the user already chose, which makes the picker useless for its own
        // job.
        //
        // PACKAGE NAME ONLY, never the notification's text: see
        // [CapturePrefs.recordObservedPackage]. And it cannot cost a capture
        // -- it never throws, which is what keeps this first line from
        // reaching the catch below and losing the notification it was only
        // supposed to make a note of.
        //
        // [isOngoing] IS PASSED THROUGH RATHER THAN CHECKED HERE. The tiles
        // dropped on the next line re-post about once a second for as long as
        // the download, the track or the route lasts, and a package's FIRST
        // sighting still has to be recorded even when it arrives that way --
        // a bank's foreground-service tile can be the only thing it posts
        // before the user reaches the picker. Only `recordObservedPackage`
        // knows whether this package is already on the list, so only it can
        // tell a first sighting from the thousandth re-post; a check here
        // could only choose between recording every one of them and recording
        // none, and both are wrong.
        prefs.recordObservedPackage(sbn.packageName, nowMillis, isOngoing = isOngoing)

        // Plan rule 5. Ongoing notifications are the persistent "app is
        // running" / "download in progress" tiles -- never transactions, and
        // they re-post constantly, so capturing them would churn the bounded
        // buffer and evict real captures.
        if (isOngoing) return

        val record = extractCapture(sbn, nowMillis) ?: return

        // Plan rule 2 of Task 4: the pause switch AND the provider allowlist,
        // in one question, answered from disk because no JS is alive to ask.
        if (!prefs.shouldCapture(record.packageName)) return

        // DURABLE FIRST -- see the class doc. Everything below this line is
        // reporting; only this line is the capture actually surviving.
        // The eviction count rides along (GAP-051): past the cap the buffer
        // drops its oldest capture, and until this was recorded the loss had
        // no number anywhere, which left the tracking-interrupted notice
        // unable to say how much went missing.
        CaptureBuffer.append(bufferFile, record) { dropped -> prefs.recordEvictedCaptures(dropped) }
        prefs.recordCapture(record.postedAt)

        // ...and only now is JS told, so a crash inside the bridge cannot
        // cost a capture that is already on disk. A sink that throws is
        // caught below exactly like any other failure: the capture stands.
        liveSink?.invoke(record)
      } catch (error: Exception) {
        // No notification text, no exception message -- only the failure's
        // type. See the class doc's SECURITY note: an exception message can
        // carry the very content this app must never write to logcat.
        Log.e(TAG, "dropped one notification capture: ${error.javaClass.simpleName}")
      }
    }

    /**
     * Reads one notification extra as a capture field.
     *
     * `getCharSequence`, not `getString`: the platform stores these as
     * whatever the posting app handed [Notification.Builder] -- a `String`, a
     * `SpannableString`, any `CharSequence` -- and `getString` returns `null`
     * for every non-`String` one, silently dropping the styled text that
     * plenty of real bank apps post.
     *
     * Blank normalizes to `null` so downstream parsers have exactly one
     * "nothing here" shape (contract §4: every string field is
     * `string | null`), and so plan rule 2's "null or blank" check upstream is
     * a plain null check rather than four repeated `isBlank()`s that a later
     * edit could drop one of.
     */
    private fun Bundle?.captureText(key: String): String? =
      this?.getCharSequence(key)?.toString()?.takeIf { it.isNotBlank() }
  }
}

// app/(onboarding)/recovery_phrase.tsx — captures and confirms the recovery
// phrase during onboarding (docs/12-encryption-and-app-lock.md §5; interface
// contract §9 rule 2; task-10-brief.md). Reached only after
// app/(onboarding)/index.tsx has already confirmed a screen lock exists
// (docs §5a) -- key generation needs a screen lock to exist, so this screen
// never runs generatePhrase() or initializeKeys() any earlier than that.
//
// MANDATORY, NOT SKIPPABLE (task-10-brief rule 1): one of exactly two
// unskippable onboarding steps, the other being the device lock. Every other
// M3c step keeps its skip-and-degrade-to-manual behavior; this one does not,
// because skipping it means losing the entire financial history the first
// time Android invalidates the device key (docs §5) -- and zero confirmation
// of the words is indistinguishable from a user who never wrote them down at
// all.
//
// ONBOARDING vs MID-LIFE COPY -- Task 9a's carried-forward note, task-10-brief's
// "one thing flagged for you": components/lock/recovery_unlock_form.tsx asks
// for these same twelve words from a user recovering AFTER a settings
// change wiped their device key; that user already has data at risk and is
// recalling words from memory or paper. This screen's user has never seen
// these words before -- the copy in phrase_display.tsx is written for THAT
// moment ("why am I suddenly being shown twelve words"), not the recovery
// moment's "your screen lock was removed" framing. The two copy blocks are
// deliberately not shared.
//
// initializeKeys(phrase) RUNS EXACTLY ONCE, ON CONFIRMATION (task-10-brief
// rule 5 / contract §9 rule 1), before any wallet or transaction can exist.
// initializingRef guards against a double-tap invoking it twice -- belt and
// suspenders with PhraseConfirm's own `confirmed` guard, and functionally
// the same discipline as key_manager.ts's inFlightInit (Task 6's fix for
// the exact same hazard one layer down). Even though key_manager.ts already
// serializes concurrent real calls into one shared promise, THIS guard is
// what keeps the call COUNT at exactly one from the caller's side, which is
// what this task's own tests pin against a mocked initializeKeys.
//
// WHY THIS SCREEN AUTHENTICATES BEFORE initializeKeys(), and why that is not
// optional: initializeKeys() ends in wrapWithDeviceKek(), which uses an
// auth-gated Keystore key that is only usable for a ~10s window after the
// user passes a system authentication challenge (docs §7) -- and nothing
// invokes that challenge just because Kotlin code reaches for the key.
// expo-local-authentication's authenticateAsync() is the JS-level trigger,
// exactly as contexts/lock_context.tsx's unlock() uses it (see that file's
// "WHY unlock() calls expo-local-authentication BEFORE the native unwrap"
// note -- this is the same step, on the one path that was missing it).
// Until it existed here, first-run setup could only ever succeed BY
// ACCIDENT, on the tail of a device unlock the OS still happened to count;
// on a physical Samsung A54 it failed every single time with
// NotAuthenticatedError, and nobody could finish onboarding at all.
// `disableDeviceFallback: false` is pinned for the same reason unlock()
// pins it (task-9-brief rule 2 / contract §10): a user with no enrolled
// fingerprint must still be able to finish setup with their device
// PIN/pattern/password.
//
// THE TWO FAILURES ARE NOT THE SAME FAILURE. A failed generatePhrase()
// means no words ever reached the user, so starting over from a fresh
// phrase costs them nothing -- that is "generate_error", and its retry
// regenerates. A failed initializeKeys() happens AFTER the user has been
// told to write twelve specific words down; regenerating there hands them a
// piece of paper that opens nothing while they believe it opens everything,
// which is strictly worse than the error it would be replacing. So
// "init_error"'s retry re-runs initializeKeys with the SAME words and never
// touches generatePhrase(). The two shared one "error" stage and one
// retryKey bump until this fix, which is precisely how a phrase the user had
// already written down could be silently replaced.
//
// A CANCELLED OR FAILED PROMPT IS NOT AN ERROR AT ALL. The likeliest cause
// is a user who looked away and let the sheet time out, on the screen where
// abandoning setup is most expensive -- so it returns to the confirm step
// with a plain-language notice instead of the dead-end error screen.
// PhraseConfirm is remounted (via confirmAttempt) because its own one-shot
// `confirmed` latch would otherwise leave the step permanently disabled:
// still on screen, no longer usable.
//
// EXACTLY ONE RE-PROMPT, NEVER A LOOP. The ~10s window can expire between
// the prompt and the call, so a NotAuthenticatedError from initializeKeys
// re-prompts and retries THE SAME call with THE SAME words, once -- the
// response the module's rejection taxonomy requires
// (modules/notification_listener/index.ts). A second NotAuthenticatedError
// gives up to "init_error", where the next attempt needs a fresh, explicit
// tap; "a forever-looping recovery" is a named bug shape in this codebase
// (contexts/lock_context.tsx's "WHY NO AUTO-RETRY LOOP ANYWHERE HERE"), and
// an unescapable prompt loop on a mandatory onboarding step is the worst
// place to ship one.
// GOING BACK FROM THE CONFIRM STEP MINTS A NEW PHRASE, ON PURPOSE. Until
// this existed, "I've written these down" was a one-way door: the words are
// shown on exactly one screen, once, and a user who tapped through before
// their pen caught up had no route back to them at all -- on a step they are
// not allowed to skip. Both the button on PhraseConfirm and Android's own
// back gesture now return them to the display step.
//
// AND THAT RETURN REGENERATES, rather than re-showing the same twelve words.
// A phrase that has been on screen and then abandoned mid-transcription is a
// phrase whose paper copy is, by definition, in an unknown state -- some
// prefix of it is written down, possibly torn out, possibly photographed.
// Handing back the SAME words rewards that half-copy; handing back a fresh
// set makes the paper unambiguously stale, which the button says out loud
// (phrase_confirm.tsx's back warning) so nobody splices two phrases together.
// This is safe here for the same reason "generate_error" may regenerate and
// "init_error" may not: nothing has been initialized yet, so no phrase the
// user might be holding opens anything. Once initializeKeys() is in flight
// the route back is gone -- see the `stage === "confirm"` guards below.
//
// THERE IS STILL NO SHARE ACTION ON THIS ROUTE (GAP-017), AND THERE IS NOW ONE
// NARROWER ONE. This screen used to own a handleShare that put
// `words.join(" ")` on the OS share sheet, handing the ledger's second unwrap
// path to whichever third-party app the user tapped and, on Android, to share
// history and usually a clipboard on the way there. `83b1253` deleted it and
// left paper as the only exit.
//
// The owner's call, 2026-09-08, is that twelve hand-copied words is too much to
// ask at first run. `handleSave` below is the replacement: the share sheet does
// not come back, a folder the user picks does. lib/crypto/phrase_export.ts owns
// the operation, and its header carries the rest of the reasoning -- including
// why the Copy button that was planned beside it was dropped rather than
// shipped without the clipboard mitigation SDK 54 cannot provide.
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as LocalAuthentication from "expo-local-authentication";
import { generatePhrase } from "@/lib/crypto/recovery_phrase";
import { savePhraseToFile } from "@/lib/crypto/phrase_export";
import { initializeKeys } from "@/lib/crypto/key_manager";
import { NotAuthenticatedError } from "@/modules/notification_listener";
import { Button } from "@/components/ui/button";
import { PhraseDisplay } from "@/components/onboarding/phrase_display";
import { PhraseConfirm } from "@/components/onboarding/phrase_confirm";

type Stage =
  | "generating"
  | "display"
  | "confirm"
  | "initializing"
  | "done"
  // Deliberately two error stages, not one plus a flag: which call failed
  // decides whether the retry may regenerate the phrase, and a separate flag
  // is something that can drift out of sync with the stage it describes.
  | "generate_error"
  | "init_error";

/** Says what did not happen and what to do, and never implies the words are
 * gone -- the user is holding them on paper while reading this. */
const AUTH_NOT_COMPLETED_NOTICE =
  "We couldn't confirm it's you, so your keys aren't set up yet. Your recovery words haven't changed — confirm them again to finish.";

/**
 * The system authentication challenge that opens the Keystore's ~10s window.
 * Same options as contexts/lock_context.tsx's unlock(), including the one
 * that matters most:
 *
 * `disableDeviceFallback: false` -- NEVER biometric-only (task-9-brief rule 2
 * / contract §10). A user with no enrolled fingerprint must still be able to
 * finish setting up their own app with their PIN/pattern/password.
 *
 * The prompt message is setup's, not unlock()'s: nothing has been locked yet,
 * and "Unlock PeraPlano" on a first run would be describing a door the user
 * has never seen.
 */
async function authenticateForKeySetup(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirm it's you to finish setting up PeraPlano",
    disableDeviceFallback: false,
  });
  return result.success;
}

export default function RecoveryPhraseScreen({ onDone }: { onDone?: () => void } = {}) {
  // For the confirm/initializing stage's footer only — see that branch below.
  // Every OTHER stage on this route delegates its edges to a child that already
  // insets itself (PhraseDisplay, PhraseConfirm), which is exactly why the two
  // Texts that are NOT inside one of those were the ones sitting under the
  // navigation bar.
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>("generating");
  const [words, setWords] = useState<string[] | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [confirmNotice, setConfirmNotice] = useState<string | null>(null);
  // Bumped only when the confirm step is handed BACK to the user, and used as
  // PhraseConfirm's key -- see this file's header for why a remount is what
  // makes that step usable again rather than merely visible.
  const [confirmAttempt, setConfirmAttempt] = useState(0);
  const initializingRef = useRef(false);

  /** What the last save did, in the user's words. Cleared by the next one. */
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStage("generating");
    setWords(null);
    setConfirmNotice(null);
    generatePhrase()
      .then((generated) => {
        if (cancelled) return;
        setWords(generated);
        setStage("display");
      })
      .catch((err: unknown) => {
        // NEVER the phrase itself, only the failure. `generatePhrase` returns
        // the words; a log line that included them would put a recovery phrase
        // into logcat, readable by anything holding READ_LOGS.
        console.error("[recovery_phrase] generatePhrase failed", err);
        if (!cancelled) setStage("generate_error");
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  /**
   * "Save to a file" -- the folder picker, then one file into it.
   *
   * A DECLINED PICKER SAYS NOTHING. `savePhraseToFile` reports `cancelled`
   * rather than throwing for exactly this, and a "saved" notice there would be
   * a lie while an error notice would report a failure that did not happen.
   */
  const handleSave = useCallback(async () => {
    if (words === null) return;
    try {
      const outcome = await savePhraseToFile(words);
      setExportNotice(outcome === "saved" ? "Saved to the folder you picked." : null);
    } catch (err) {
      // NEVER the words, only the failure -- the same rule the generation
      // handler above keeps. A file error carries paths and permission codes,
      // which are safe; the phrase is not passed to the logger at all.
      console.error("[recovery_phrase] saving the recovery words failed", err);
      setExportNotice("That didn't save. Your words are still on this screen.");
    }
  }, [words]);

  /** Hands the confirm step back to the user with the phrase they already
   * wrote down still intact -- the ONLY response to an incomplete
   * authentication. */
  const returnToConfirmStep = useCallback(() => {
    setConfirmNotice(AUTH_NOT_COMPLETED_NOTICE);
    setConfirmAttempt((attempt) => attempt + 1);
    setStage("confirm");
  }, []);

  /**
   * The route back to the words, from the confirm step only. Bumping
   * `retryKey` re-runs the generation effect above, which is what resets the
   * stage to "generating", clears the old words out of state, and mints the
   * new phrase -- one code path for "start this step over", shared with
   * "generate_error"'s retry rather than duplicated beside it.
   *
   * The initializingRef guard is the same one handleConfirmed uses, for the
   * same reason: it is set synchronously before key setup starts, so a back
   * press that lands in the same tick as a confirm tap cannot pull the phrase
   * out from under an initializeKeys() call that is already running.
   */
  const handleBackToWords = useCallback(() => {
    if (initializingRef.current) return;
    setRetryKey((k) => k + 1);
  }, []);

  /**
   * Android's back button, on the confirm step only.
   *
   * A user who wants another look at their words reaches for the system back
   * gesture before they read any button, and on first run this whole flow
   * renders outside the router's Stack (see phrase_display.tsx) -- so there
   * is no navigator above it to give that gesture a meaning. Unhandled, it
   * fell through to the OS and backed out of setup entirely.
   *
   * Returning `true` CONSUMES the press, which is the point on a step the
   * user is not allowed to skip: back means "back to the words", never "out
   * of onboarding". The listener is registered only while `stage` is exactly
   * "confirm", so it is already gone by the time key setup is in flight, and
   * it never touches the display step -- backing out from there is not this
   * fix's business.
   */
  useEffect(() => {
    if (stage !== "confirm") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBackToWords();
      return true;
    });
    return () => subscription.remove();
  }, [stage, handleBackToWords]);

  /**
   * Authenticate, then initialize -- in that order, once, with at most one
   * re-prompt. `phrase` is passed in and threaded through both attempts
   * rather than read from state, so "retry the SAME call with the SAME
   * words" is true by construction rather than by care.
   */
  const runKeySetup = useCallback(
    async (phrase: string[]) => {
      try {
        if (!(await authenticateForKeySetup())) {
          returnToConfirmStep();
          return;
        }

        try {
          await initializeKeys(phrase);
        } catch (err: unknown) {
          if (!(err instanceof NotAuthenticatedError)) throw err;
          // The window expired between the prompt and the call. One
          // re-prompt, one retry of the identical call -- and if the user
          // declines this prompt too, the phrase is still not destroyed.
          if (!(await authenticateForKeySetup())) {
            returnToConfirmStep();
            return;
          }
          // A second NotAuthenticatedError falls through to the catch below
          // and stops there. There is no third attempt.
          await initializeKeys(phrase);
        }

        setStage("done");
      } catch (err: unknown) {
        // This is the failure that costs a user their data, and until commit
        // 5bad9d2 it was discarded — the screen said "try again" and logged
        // nothing, so an on-device failure could not be diagnosed at all.
        // `phrase` is NOT logged, only the error.
        console.error("[recovery_phrase] initializeKeys failed", err);
        setStage("init_error");
      }
    },
    [returnToConfirmStep],
  );

  const handleConfirmed = useCallback(() => {
    if (initializingRef.current || !words) return;
    initializingRef.current = true;
    setConfirmNotice(null);
    setStage("initializing");
    void runKeySetup(words).finally(() => {
      initializingRef.current = false;
    });
  }, [words, runKeySetup]);

  /**
   * The two error stages retry DIFFERENT things, which is the whole point of
   * their being two: "init_error" re-runs key setup with the words already on
   * the user's paper, and only "generate_error" is allowed to mint a new
   * phrase (nothing was ever displayed, so nothing is invalidated).
   */
  const handleRetry = useCallback(() => {
    if (stage === "init_error") {
      handleConfirmed();
      return;
    }
    setRetryKey((k) => k + 1);
  }, [stage, handleConfirmed]);

  if (stage === "generate_error" || stage === "init_error") {
    return (
      <View
        testID="recovery-phrase-error"
        className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
      >
        <Text className="text-center text-body font-medium text-fg dark:text-fg-dark">
          Something went wrong preparing your recovery words. There is no way to continue
          without them, so please try again.
        </Text>
        <View className="w-full">
          <Button testID="recovery-phrase-retry-button" title="Try again" size="lg" onPress={handleRetry} />
        </View>
      </View>
    );
  }

  if (stage === "generating" || !words) {
    return (
      <View
        testID="recovery-phrase-generating"
        className="flex-1 items-center justify-center bg-bg px-6 dark:bg-bg-dark"
      >
        <Text className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">
          Preparing your recovery words…
        </Text>
      </View>
    );
  }

  if (stage === "display") {
    return (
      <PhraseDisplay
        words={words}
        onContinue={() => setStage("confirm")}
        // `void` rather than passing the async function straight through: the
        // prop is `() => void`, and handing it a promise nobody awaits is how a
        // rejection becomes an unhandled one. `handleSave` catches internally.
        onSave={() => {
          void handleSave();
        }}
        notice={exportNotice}
      />
    );
  }

  if (stage === "confirm" || stage === "initializing") {
    // THE MESSAGES BELOW PhraseConfirm ARE THE SCREEN'S FOOTER, and they were
    // the one thing on this route nothing held clear of Android's navigation
    // bar (owner's device report: "onboarding encrypting message footer is
    // blocked by hardware bottom navbar").
    //
    // PhraseConfirm PADS ITSELF — its own header says so, `SCREEN_PADDING +
    // insets.bottom`. These two Texts are its SIBLINGS in this column, outside
    // that padding, and carried a flat `pb-4`/`pb-6`. 24dp against the A54's
    // 126px strip is not a near miss; "Setting up your encryption keys…" sat
    // under the ▢ ◁ buttons entirely, which is the one moment in setup where
    // the user has nothing to do but read it.
    //
    // ONE FOOTER RATHER THAN AN INSET ON EACH Text, so the bar is cleared once
    // no matter which of the two is showing — and so a third message added
    // later inherits it instead of repeating the bug.
    //
    // RENDERED ONLY WHEN IT HAS SOMETHING IN IT. An always-mounted footer
    // carrying `paddingBottom: insets.bottom` would push PhraseConfirm up by a
    // navigation bar's height on the plain confirm step, which has no footer
    // text at all and already handles that edge itself.
    const footer = confirmNotice !== null || stage === "initializing";
    return (
      <View className="flex-1 bg-bg dark:bg-bg-dark">
        {/* `onBack` only while the user still owns this step. During
            "initializing" the words are already committed to a running
            initializeKeys(), so the control is not merely disabled but
            absent -- there is nothing to go back to that would still be
            true. */}
        <PhraseConfirm
          key={confirmAttempt}
          words={words}
          onConfirmed={handleConfirmed}
          onBack={stage === "confirm" ? handleBackToWords : undefined}
        />
        {footer ? (
          <View testID="recovery-phrase-footer" style={{ paddingBottom: insets.bottom }}>
            {confirmNotice ? (
              <Text
                testID="recovery-phrase-auth-notice"
                className="px-6 pb-4 text-center text-secondary font-medium text-fg-2 dark:text-fg-2-dark"
              >
                {confirmNotice}
              </Text>
            ) : null}
            {stage === "initializing" ? (
              <Text
                testID="recovery-phrase-initializing"
                className="pb-6 text-center text-secondary font-medium text-fg-2 dark:text-fg-2-dark"
              >
                Setting up your encryption keys…
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  // stage === "done": initializeKeys has already resolved.
  //
  // `onDone` is the caller's onward-navigation hook, added by the
  // provider-selection plan's Task 4 so app/(onboarding)/index.tsx can advance
  // to the provider picker. Optional, exactly like device_lock.tsx's onSecure,
  // so every test that predates it (constructing this component with zero
  // props) keeps working unmodified — and the action below renders only when a
  // caller actually supplied one, rather than a dead button that goes nowhere.
  //
  // FIRED FROM A TAP, NEVER FROM AN EFFECT. Unlike device_lock.tsx, where
  // "secure" is a machine-observed fact worth advancing on immediately, this
  // screen's last frame is addressed to the user: it confirms the words are
  // saved and tells them to keep the paper somewhere private and offline.
  // Auto-advancing would replace that message before it could be read.
  return (
    <View
      testID="recovery-phrase-done"
      className="flex-1 items-center justify-center gap-3 bg-bg px-6 dark:bg-bg-dark"
    >
      <Text className="text-center text-title font-bold text-fg dark:text-fg-dark">
        Your recovery words are saved
      </Text>
      <Text className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">
        Keep what you wrote down somewhere private and offline.
      </Text>
      {onDone ? (
        <View className="mt-2 w-full">
          <Button testID="recovery-phrase-continue-button" title="Continue" size="lg" onPress={onDone} />
        </View>
      ) : null}
    </View>
  );
}

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
// A failed generatePhrase() or initializeKeys() restarts the WHOLE flow
// from a freshly generated phrase (via retryKey) rather than trying to
// resume with stale words -- simpler than tracking which of the two calls
// failed, and safe: initializeKeys is a no-op if keys already exist
// (key_manager.ts's hasStoredKeys() check), so re-running from scratch after
// a partial failure never double-initializes.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Share, Text, View } from "react-native";
import { generatePhrase } from "@/lib/crypto/recovery_phrase";
import { initializeKeys } from "@/lib/crypto/key_manager";
import { PhraseDisplay } from "@/components/onboarding/phrase_display";
import { PhraseConfirm } from "@/components/onboarding/phrase_confirm";

type Stage = "generating" | "display" | "confirm" | "initializing" | "done" | "error";

export default function RecoveryPhraseScreen({ onDone }: { onDone?: () => void } = {}) {
  const [stage, setStage] = useState<Stage>("generating");
  const [words, setWords] = useState<string[] | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const initializingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setStage("generating");
    setWords(null);
    generatePhrase()
      .then((generated) => {
        if (cancelled) return;
        setWords(generated);
        setStage("display");
      })
      .catch(() => {
        if (!cancelled) setStage("error");
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const handleShare = useCallback(() => {
    if (!words) return;
    void Share.share({ message: words.join(" ") });
  }, [words]);

  const handleConfirmed = useCallback(() => {
    if (initializingRef.current || !words) return;
    initializingRef.current = true;
    setStage("initializing");
    initializeKeys(words)
      .then(() => setStage("done"))
      .catch(() => setStage("error"))
      .finally(() => {
        initializingRef.current = false;
      });
  }, [words]);

  const handleRetry = useCallback(() => setRetryKey((k) => k + 1), []);

  if (stage === "error") {
    return (
      <View
        testID="recovery-phrase-error"
        className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
      >
        <Text className="text-center text-fg dark:text-fg-dark">
          Something went wrong preparing your recovery words. There is no way to continue
          without them, so please try again.
        </Text>
        <Pressable
          testID="recovery-phrase-retry-button"
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          className="rounded-lg bg-brand px-6 py-3 dark:bg-brand-dark"
        >
          <Text className="font-semibold text-surface dark:text-surface-dark">Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (stage === "generating" || !words) {
    return (
      <View
        testID="recovery-phrase-generating"
        className="flex-1 items-center justify-center bg-bg px-6 dark:bg-bg-dark"
      >
        <Text className="text-center text-fg-2 dark:text-fg-2-dark">
          Preparing your recovery words…
        </Text>
      </View>
    );
  }

  if (stage === "display") {
    return (
      <PhraseDisplay words={words} onContinue={() => setStage("confirm")} onShare={handleShare} />
    );
  }

  if (stage === "confirm" || stage === "initializing") {
    return (
      <View className="flex-1">
        <PhraseConfirm words={words} onConfirmed={handleConfirmed} />
        {stage === "initializing" ? (
          <Text
            testID="recovery-phrase-initializing"
            className="pb-6 text-center text-fg-2 dark:text-fg-2-dark"
          >
            Setting up your encryption keys…
          </Text>
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
      <Text className="text-center text-lg font-semibold text-fg dark:text-fg-dark">
        Your recovery words are saved
      </Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Keep what you wrote down somewhere private and offline.
      </Text>
      {onDone ? (
        <Pressable
          testID="recovery-phrase-continue-button"
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          className="mt-2 rounded-lg bg-brand px-6 py-3 dark:bg-brand-dark"
        >
          <Text className="font-semibold text-surface dark:text-surface-dark">Continue</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

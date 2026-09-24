// components/onboarding/phrase_display.tsx — shows the freshly generated
// 12-word recovery phrase during onboarding (docs/12-encryption-and-app-lock.md
// §5; interface contract §9 rule 2; task-10-brief.md rules 2, 4 & 5). Purely
// presentational, same shape as device_lock_explainer.tsx and
// recovery_unlock_form.tsx: the caller (app/(onboarding)/recovery_phrase.tsx)
// owns generatePhrase() and holds the words in state; this component only
// ever displays what it's given and forwards taps.
//
// TERMINOLOGY (docs §5, binding on every screen that surfaces this): call
// these "recovery words", never "seed phrase", "wallet", or "mnemonic" --
// BIP-39 is a cryptocurrency-adjacent artifact borrowed purely for its
// wordlist and checksum properties, not for its vocabulary. A user who
// googles one of these words should not land wondering what their budgeting
// app is doing on a crypto-wallet support page.
//
// THERE IS NO SKIP BUTTON ANYWHERE IN THIS FILE (task-10-brief rule 1). This
// step is one of exactly two unskippable steps in onboarding (the other is
// the device lock, device_lock_explainer.tsx) -- not an oversight to double
// check for in review: there is deliberately no prop, no state, and no code
// path that could render one. The copy is equally deliberate: it says
// plainly why the user is being asked to do this before ever showing the
// words, per docs §5's "one plain sentence" instruction, in language for
// someone who has never seen these words before (contrast
// recovery_unlock_form.tsx's copy, written for the DIFFERENT moment of
// recovering after a settings change).
//
// ONE WAY OFF THIS SCREEN, AND IT IS NOT THE ONE GAP-017 REMOVED. The twelve
// words are the second unwrap path for the entire ledger (docs §5), so every
// affordance that copies them somewhere is a leak of the whole thing, and
// `83b1253` removed the "Copy or share" control that handed them to the OS
// share sheet -- to whatever third-party app the user picked, plus Android's
// share history and usually a clipboard on the way there. That left writing
// twelve words on paper as the only exit.
//
// The owner's call, 2026-09-08: that is too much to ask of every user at first
// run. SAVE is the replacement, and it is not the share sheet under another
// name: the Storage Access Framework asks the USER which folder, then hands
// this app a one-shot URI to write one file into. No third-party app receives
// the words, nothing enters share history, no clipboard is touched, and the app
// keeps no standing permission afterwards. lib/crypto/phrase_export.ts owns the
// operation; this component only forwards the tap.
//
// THERE IS NO COPY BUTTON, AND THAT WAS DECIDED RATHER THAN FORGOTTEN. One was
// planned beside Save, justified by Android's ClipDescription.EXTRA_IS_SENSITIVE
// (hides the 13+ paste preview, keeps the words out of Gboard's clipboard
// history). expo-clipboard exposes that as `isSensitive` -- and not in the
// version SDK 54 pins, whose SetStringOptions carries only `inputFormat`. A
// Copy button here would therefore have been the original leak with none of the
// mitigation that justified reopening it. phrase_export.ts's header records
// what it would take to bring it back.
//
// The words are also still not `selectable`: long-press selection is the same
// clipboard route by another name, and nothing above replaces it.
//
// THE PROMISE IS SCOPED TO THIS PHONE, DELIBERATELY (GAP-100). The copy below
// used to open with "If you ever get a new phone" -- half of a sentence whose
// other half was true, which is what made it credible. Reset the fingerprint
// or PIN on THIS device and the words do exactly what they say: SecureStore
// still holds `recoveryWrap` and `recoverySalt`, and KEK-recovery unwraps the
// DEK. Move to a NEW handset and there is nothing to unwrap -- SecureStore is
// per-device, both values are absent, and unwrapWithRecoveryPhrase throws
// "recovery wrap not present" (lib/crypto/key_manager.ts:171-178) before it
// derives anything. Nothing copies that blob off the phone either:
// lib/privacy/data_export.ts carries ledger rows and no key material, and the
// database is local. So this paragraph says what the words open and what they
// do not, and it stops there -- whether onboarding should ALSO announce that
// no backup exists today is a separate product decision (GAP-054), not this
// screen's to make by implication. If new-device recovery ever ships, the
// copy changes with it, not before it. docs/12-encryption-and-app-lock.md §5
// carries the same correction in prose.
//
// SCREENSHOTS ARE BLOCKED WHILE THIS COMPONENT IS MOUNTED, AND ONLY WHILE.
// usePreventScreenCapture sets Android's FLAG_SECURE on mount and clears it
// on unmount, so the rest of the app -- including the support flow that
// deliberately attaches screenshots -- is untouched. The key is this screen's
// own because the package ref-counts prevent/allow BY KEY: two surfaces
// sharing the default key would have the first unmount release the flag while
// the second is still showing a phrase.
//
// THAT IS ANDROID-EFFECTIVE, NOT A GUARANTEE. FLAG_SECURE stops the system
// screenshot, the Recents thumbnail and screen recording; it cannot stop a
// second phone's camera, and some OEM builds honour it incompletely. The
// warning copy below is written to survive that -- write them on paper, do
// not photograph them -- rather than promising the words cannot escape.
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePreventScreenCapture } from "expo-screen-capture";

import { Button } from "@/components/ui/button";

/** The `py-8` this screen used to carry, kept as the floor its system-bar
 * insets are added to (see the root View below). */
const SCREEN_PADDING = 32;

/** This surface's own prevent/allow key -- see the header for why the three
 * phrase surfaces must not share one. */
const CAPTURE_GUARD_KEY = "recovery-phrase-display";

// RESTYLE (mobile-ui-revamp Part 3 Task 6) — TOKENS ONLY, NOT THE FRAME. See
// device_lock_explainer.tsx's own header for the full reasoning: this screen
// is reached both from app/(onboarding)/recovery_phrase.tsx AND, mid-life,
// from app/lock.tsx's recovery path, neither of which is a numbered onboarding
// step with a valid `OnboardingStep`. recovery_phrase.test.tsx additionally
// pins the ABSENCE of any "skip"/"not now"/"later"/"maybe" wording anywhere on
// this screen (task-10-brief rule 1) — `OnboardingFrame`'s skip affordance
// must never reach this component, wrapped or not. Only className tokens
// changed below.

export function PhraseDisplay({
  words,
  onContinue,
  onSave,
  notice,
}: {
  words: string[];
  onContinue: () => void;
  /**
   * Opens the folder picker and writes the file. Owned by the caller.
   *
   * REQUIRED, NOT OPTIONAL. An optional handler would let a caller mount this
   * screen with a Save button that silently does nothing, on the one screen
   * where the user's belief that they saved their words is the whole point.
   */
  onSave: () => void;
  /**
   * What just happened, in the user's words -- "Saved.", "Copied." and the
   * failure cases.
   *
   * IT IS A PROP, NOT STATE HERE, because the outcomes it reports belong to
   * operations this component does not perform. A local `useState` would have
   * this file guessing whether a save it did not run succeeded, which is how a
   * screen ends up claiming a file was written that was not.
   */
  notice?: string | null;
}) {
  usePreventScreenCapture(CAPTURE_GUARD_KEY);

  // First-run: app/lock.tsx renders this whole flow OUTSIDE the router's Stack,
  // so no navigator above it clears the system bars, and app.json's
  // `edgeToEdgeEnabled` runs the column edge to edge — leaving "I've written
  // them down" under Android's navigation bar. `py-8` moves into `style`
  // because a `style` prop replaces, rather than adds to, the padding
  // NativeWind compiles from `className`.
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="phrase-display"
      className="flex-1 bg-bg px-6 dark:bg-bg-dark"
      style={{
        paddingTop: SCREEN_PADDING + insets.top,
        paddingBottom: SCREEN_PADDING + insets.bottom,
      }}
    >
      <Text className="text-center text-title font-bold text-fg dark:text-fg-dark">
        Write down your recovery words
      </Text>
      <Text className="mt-2 text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">
        If you ever turn off and reset your fingerprint or PIN, these 12 recovery words are the
        only way back to your data, and PeraPlano cannot recover them for you. They unlock the
        data already on this phone, and they don't move it to a new one.
      </Text>

      <ScrollView
        testID="phrase-word-list"
        className="mt-6 max-h-96 rounded-2xl border border-line dark:border-line-dark"
      >
        <View className="flex-row flex-wrap p-4">
          {words.map((word, index) => (
            <View key={`${index}-${word}`} className="w-1/3 flex-row gap-1 py-1.5">
              <Text
                testID={`phrase-index-${index}`}
                className="text-row font-medium text-fg-2 dark:text-fg-2-dark"
              >
                {index + 1}
              </Text>
              <Text
                testID={`phrase-word-${index}`}
                className="text-row font-semibold text-fg dark:text-fg-dark"
              >
                {word}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* `secondary`, so it does not compete with "I've saved these words"
          below. Saving is the convenience; confirming is the step. */}
      <View className="mt-4">
        <Button
          testID="phrase-save-button"
          title="Save to a file"
          variant="secondary"
          onPress={onSave}
        />
      </View>

      {notice === null || notice === undefined ? null : (
        <Text
          testID="phrase-export-notice"
          className="mt-2 text-center text-secondary font-medium text-fg-2 dark:text-fg-2-dark"
        >
          {notice}
        </Text>
      )}

      {/* WHAT THIS PARAGRAPH MAY AND MAY NOT PROMISE. FLAG_SECURE is
          Android-effective, not a guarantee (see the header), and the button
          above puts the words somewhere this app does not control. So it says
          what is true of the destination and stops: a file is only as private
          as the folder it is put in. It does not tell the user their words are
          safe, because once they pick a folder that is no longer something this
          app knows. */}
      <Text className="mt-4 text-center text-secondary font-medium text-warn dark:text-warn-dark">
        Screenshots are turned off on this screen. Whether you save the file or write the words
        down, keep them somewhere only you can reach -- and don't photograph them.
      </Text>

      <View className="mt-3">
        <Button
          testID="phrase-continue-button"
          title="I've saved these words"
          size="lg"
          onPress={onContinue}
        />
      </View>
    </View>
  );
}

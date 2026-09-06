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
// NOTHING ON THIS SCREEN MOVES THE WORDS OFF IT (GAP-017). The twelve words
// are the second unwrap path for the entire ledger (docs §5), so every
// affordance that copies them somewhere is a leak of the whole thing. The
// "Copy or share" control that used to sit below the list handed them to the
// OS share sheet -- that is, to whatever third-party app the user picked,
// plus Android's share history and usually a clipboard on the way. The words
// are no longer `selectable` for the same reason: long-press selection is a
// one-tap route to the system clipboard. Writing them down by hand is the
// only way off this screen, which is exactly what the confirm step checks.
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
}: {
  words: string[];
  onContinue: () => void;
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

      <Text className="mt-4 text-center text-secondary font-medium text-warn dark:text-warn-dark">
        Screenshots are turned off on this screen, so these words cannot reach your photo
        library. Write them on paper and keep it somewhere private -- don't photograph them
        either.
      </Text>

      <View className="mt-3">
        <Button
          testID="phrase-continue-button"
          title="I've written these down"
          size="lg"
          onPress={onContinue}
        />
      </View>
    </View>
  );
}

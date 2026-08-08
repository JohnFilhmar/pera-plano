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
import { Pressable, ScrollView, Text, View } from "react-native";

export function PhraseDisplay({
  words,
  onContinue,
  onShare,
}: {
  words: string[];
  onContinue: () => void;
  onShare: () => void;
}) {
  return (
    <View testID="phrase-display" className="flex-1 bg-bg px-6 py-8 dark:bg-bg-dark">
      <Text className="text-center text-lg font-semibold text-fg dark:text-fg-dark">
        Write down your recovery words
      </Text>
      <Text className="mt-2 text-center text-fg-2 dark:text-fg-2-dark">
        If you ever get a new phone, or turn off and reset your fingerprint or PIN, these 12
        recovery words are the only way back to your data -- PeraPlano cannot recover them for
        you.
      </Text>

      <ScrollView
        testID="phrase-word-list"
        className="mt-6 max-h-96 rounded-lg border border-fg-2 dark:border-fg-2-dark"
      >
        <View className="flex-row flex-wrap p-4">
          {words.map((word, index) => (
            <View key={`${index}-${word}`} className="w-1/3 flex-row gap-1 py-1.5">
              <Text testID={`phrase-index-${index}`} className="text-fg-2 dark:text-fg-2-dark">
                {index + 1}
              </Text>
              <Text
                selectable
                testID={`phrase-word-${index}`}
                className="font-semibold text-fg dark:text-fg-dark"
              >
                {word}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <Text className="mt-4 text-center text-warn dark:text-warn-dark">
        A screenshot saves these words to your phone's photo library, where other apps may be
        able to read them. Write them down somewhere private instead.
      </Text>

      <Pressable
        testID="phrase-share-button"
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel="Copy or share your recovery words"
        className="mt-4 items-center rounded-lg border border-brand py-3 dark:border-brand-dark"
      >
        <Text className="font-semibold text-brand dark:text-brand-dark">Copy or share</Text>
      </Pressable>

      <Pressable
        testID="phrase-continue-button"
        onPress={onContinue}
        accessibilityRole="button"
        accessibilityLabel="I've written these down"
        className="mt-3 items-center rounded-lg bg-brand py-3 dark:bg-brand-dark"
      >
        <Text className="font-semibold text-surface dark:text-surface-dark">
          I've written these down
        </Text>
      </Pressable>
    </View>
  );
}

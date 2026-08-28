// components/onboarding/phrase_confirm.tsx — the docs §5 / task-10-brief
// rule 3 confirmation step: three words at random positions, not a full
// re-entry. Full re-entry is punishing enough that a mandatory step this
// early would push users to fake it (paste anything just to get past a
// wall); asking for three specific positions is the cheapest check that
// still proves the words are actually written down somewhere real, because
// a user who only copy-pasted the phrase into this screen has nothing to
// recall from a different position than the ones they happened to leave
// visible.
//
// Accepts an answer case-insensitively and ignoring surrounding whitespace
// (task-10-brief rule 2) -- someone copying three words off a piece of paper
// will not reliably match the generator's exact lowercase-no-space output.
//
// THERE IS NO SKIP BUTTON ANYWHERE IN THIS FILE (task-10-brief rule 1) --
// same discipline as phrase_display.tsx and device_lock_explainer.tsx. A
// wrong word at ANY of the three positions rejects the whole confirmation;
// there is no partial credit, because partial credit is exactly what would
// let a user who wrote down nine of twelve words pass.
//
// GOING BACK IS NOT SKIPPING, and `onBack` is not a back door around rule 1.
// Both routes off this screen still end at this same confirmation: the only
// thing `onBack` reaches is the step immediately in front of it, the one
// showing the words. Until it existed, "I've written these down" was a
// one-way door -- a user who tapped it while their pen was still moving, or
// who wanted one more look before typing, had no route back to the only
// screen in the app that ever shows those twelve words.
//
// AND THE WORDS THEY GO BACK TO ARE NEW ONES (the caller regenerates; see
// app/(onboarding)/recovery_phrase.tsx's handleBackToWords). That is why the
// button carries a sentence saying so rather than a bare arrow: a user who
// wrote down eleven words, went back for the twelfth, and copied it off a
// freshly minted phrase would walk away holding a line of words that opens
// nothing -- the same failure shape the caller's two-error-stages split
// exists to prevent, arriving through the user instead of through an error.
import { useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { usePlaceholderColor } from "@/lib/ui/placeholder";

const CHALLENGE_COUNT = 3;

/** The `py-8` this screen used to carry, kept as the floor its system-bar
 * insets are added to (see the root View below). */
const SCREEN_PADDING = 32;

/**
 * Picks CHALLENGE_COUNT distinct positions out of `wordCount`, ascending.
 * Plain Math.random is fine here, unlike recovery_phrase.ts's
 * generatePhrase(): WHICH three words get quizzed is not security-sensitive
 * -- only which twelve words exist is -- so there is no CSPRNG requirement.
 */
function pickPositions(wordCount: number, count: number): number[] {
  const pool = Array.from({ length: wordCount }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

function normalizeAnswer(input: string): string {
  return input.trim().toLowerCase();
}

export function PhraseConfirm({
  words,
  onConfirmed,
  onBack,
}: {
  words: string[];
  onConfirmed: () => void;
  /** Optional, exactly like the screen's own `onDone`: a caller with nowhere
   * to send the user back to renders no back button at all, rather than a
   * dead control that goes nowhere. */
  onBack?: () => void;
}) {
  const placeholderColor = usePlaceholderColor();
  const positions = useMemo(() => pickPositions(words.length, CHALLENGE_COUNT), [words.length]);
  const [answers, setAnswers] = useState<string[]>(() => positions.map(() => ""));
  const [error, setError] = useState<string | null>(null);
  // Belt-and-suspenders against a double-tap firing onConfirmed twice --
  // task-10-brief.md's own named hazard, the same shape Task 6 had to
  // serialize key_manager.ts's initializeKeys against. The AUTHORITATIVE
  // guard lives one level up, in the screen's initializingRef (it must
  // survive even if this component were ever remounted mid-tap); this one
  // stops the SECOND tap from even attempting a second onConfirmed call in
  // the first place.
  const [confirmed, setConfirmed] = useState(false);

  const insets = useSafeAreaInsets();

  const handleChange = (index: number, value: string) => {
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));
  };

  const handleSubmit = () => {
    if (confirmed) return;
    const allCorrect = positions.every(
      (position, i) => normalizeAnswer(answers[i]) === words[position],
    );
    if (!allCorrect) {
      setError("One or more words don't match what you wrote down. Check and try again.");
      return;
    }
    setError(null);
    setConfirmed(true);
    onConfirmed();
  };

  return (
    // Same first-run, no-navigator, edge-to-edge situation as
    // phrase_display.tsx: without these insets the "Confirm" button sits under
    // Android's navigation bar.
    <View
      testID="phrase-confirm"
      className="flex-1 bg-bg px-6 dark:bg-bg-dark"
      style={{
        paddingTop: SCREEN_PADDING + insets.top,
        paddingBottom: SCREEN_PADDING + insets.bottom,
      }}
    >
      <Text className="text-center text-title font-bold text-fg dark:text-fg-dark">
        Confirm your recovery words
      </Text>
      <Text className="mt-2 text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">
        Type the words below from what you wrote down, to make sure you actually have them.
      </Text>

      {positions.map((position, i) => (
        <View key={position} className="mt-4 gap-1">
          <Text testID={`confirm-label-${i}`} className="text-row font-medium text-fg-2 dark:text-fg-2-dark">
            Word {position + 1}
          </Text>
          <TextInput
            placeholderTextColor={placeholderColor}
            testID={`confirm-input-${i}`}
            value={answers[i]}
            onChangeText={(value) => handleChange(i, value)}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!confirmed}
            accessibilityLabel={`Word ${position + 1}`}
            className="rounded-xl border border-line p-3 text-body font-medium text-fg dark:border-line-dark dark:text-fg-dark"
          />
        </View>
      ))}

      {error ? (
        <Text testID="confirm-error" className="mt-3 text-center text-body font-medium text-danger dark:text-danger-dark">
          {error}
        </Text>
      ) : null}

      <View className="mt-6">
        <Button
          testID="confirm-submit-button"
          title="Confirm"
          size="lg"
          disabled={confirmed}
          onPress={handleSubmit}
        />
      </View>

      {onBack ? (
        // Disabled by the SAME `confirmed` latch that disables the inputs and
        // the submit button: once onConfirmed has fired, key setup is in
        // flight against these exact words, and swapping the phrase out from
        // under a running initializeKeys is the one thing this screen must
        // never allow. The caller stops rendering the confirm step entirely at
        // that point anyway -- this is the belt to that suspenders.
        <View className="mt-3 gap-1">
          <Button
            testID="confirm-back-button"
            title="Go back to my words"
            variant="ghost"
            size="lg"
            disabled={confirmed}
            onPress={onBack}
          />
          <Text
            testID="confirm-back-warning"
            className="text-center text-secondary font-medium text-fg-2 dark:text-fg-2-dark"
          >
            You'll get a different set of twelve words, so anything you already wrote down stops
            working.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

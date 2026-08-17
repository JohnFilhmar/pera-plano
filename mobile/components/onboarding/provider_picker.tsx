// components/onboarding/provider_picker.tsx — the onboarding step where the
// user chooses which apps PeraPlano listens to (provider-selection plan Task 4;
// docs/04-features/01-onboarding.md step 6).
//
// Purely presentational, exactly like device_lock_explainer.tsx and
// phrase_display.tsx: the caller (app/(onboarding)/providers.tsx) owns loading
// the catalogue and writing the filter across the bridge; this component holds
// only which rows are ticked and forwards the answer.
//
// TWO GROUPS, OBSERVED FIRST (plan rule 1). "Apps we've seen" carries REAL
// package names the listener read off `sbn.packageName`; "Common in the
// Philippines" carries the seed's guesses, seven of which were invented from
// app names and have never been checked against a device. That is why the
// learned group leads: the rows most likely to be correct are the ones the user
// reads first, and an app the seed named wrongly is still reachable here under
// whatever Android actually calls it.
//
// EVERY ROW SHOWS ITS PACKAGE NAME, not just its label. Three of the seed's
// rows share the `sms_relay` key (one per Messages app), and a picker showing
// three identical "sms_relay" rows would be unusable. The package name is also
// the only thing that distinguishes a learned entry from the seed's guess at
// the same provider.
//
// THERE IS A SKIP BUTTON, DELIBERATELY (plan rule 3) — the opposite of
// device_lock_explainer.tsx and phrase_display.tsx, which must not have one.
// Every onboarding step except the device lock and the recovery phrase is
// skippable, and skipping this one is SAFE: it writes an empty filter, which
// CapturePrefs.shouldCapture already treats as allow-all. See the caller for
// why that must never be confused with pausing capture.
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ProviderChoice } from "@/lib/ingest/provider_catalogue";

/** The `py-8` this screen used to carry, kept as the floor its system-bar
 * insets are added to (see the root View below). */
const SCREEN_PADDING = 32;

function ChoiceRow({
  choice,
  selected,
  onToggle,
}: {
  choice: ProviderChoice;
  selected: boolean;
  onToggle: (packageName: string) => void;
}) {
  return (
    <Pressable
      testID={`provider-choice-${choice.packageName}`}
      onPress={() => onToggle(choice.packageName)}
      accessibilityRole="checkbox"
      // The tick below is a visual affordance only; this is what a screen
      // reader announces, and the only thing that reports state without colour.
      accessibilityState={{ checked: selected }}
      accessibilityLabel={choice.displayName}
      className="min-h-[44px] flex-row items-center gap-3 py-3"
    >
      <View
        className={
          selected
            ? "h-5 w-5 items-center justify-center rounded border-2 border-brand bg-brand dark:border-brand-dark dark:bg-brand-dark"
            : "h-5 w-5 rounded border-2 border-fg-2 dark:border-fg-2-dark"
        }
      >
        {selected ? (
          <Text className="text-xs font-semibold text-surface dark:text-surface-dark">✓</Text>
        ) : null}
      </View>
      <View className="flex-1">
        <Text
          numberOfLines={1}
          testID={`provider-name-${choice.packageName}`}
          className="text-base text-fg dark:text-fg-dark"
        >
          {choice.displayName}
        </Text>
        {/* Suppressed when the label IS the package name — an observed app the
            catalogue has never heard of would otherwise render the same string
            twice, one above the other. */}
        {choice.displayName === choice.packageName ? null : (
          <Text
            numberOfLines={1}
            testID={`provider-package-${choice.packageName}`}
            className="text-sm text-fg-2 dark:text-fg-2-dark"
          >
            {choice.packageName}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function ProviderPicker({
  choices,
  onConfirm,
  onSkip,
  busy = false,
}: {
  choices: ProviderChoice[];
  /** The packages the user ticked — `[]` when they ticked none. */
  onConfirm: (packageNames: string[]) => void;
  onSkip: () => void;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const insets = useSafeAreaInsets();

  const toggle = useCallback((packageName: string) => {
    setSelected((prev) =>
      prev.includes(packageName)
        ? prev.filter((name) => name !== packageName)
        : [...prev, packageName],
    );
  }, []);

  // `selected`, never "every rendered package". Substituting the visible list
  // would look identical today and silently drop every app the catalogue does
  // not know about the moment it changes.
  const handleConfirm = useCallback(() => onConfirm(selected), [onConfirm, selected]);

  const seen = choices.filter((choice) => choice.seen);
  const unseen = choices.filter((choice) => !choice.seen);

  return (
    // Same first-run, no-navigator, edge-to-edge situation as
    // phrase_display.tsx: this screen's Continue and "Not now" both live at the
    // bottom of the column, which is where Android's navigation bar is.
    <View
      testID="provider-picker"
      className="flex-1 bg-bg px-6 dark:bg-bg-dark"
      style={{
        paddingTop: SCREEN_PADDING + insets.top,
        paddingBottom: SCREEN_PADDING + insets.bottom,
      }}
    >
      <Text className="text-center text-lg font-semibold text-fg dark:text-fg-dark">
        Which apps should PeraPlano listen to?
      </Text>
      {/* Rule 5 — the one moment the privacy promise stops being an abstract
          claim in a settings screen and becomes a decision the user is making
          right now, about their own banking apps. */}
      <Text testID="provider-picker-privacy" className="mt-2 text-center text-fg-2 dark:text-fg-2-dark">
        PeraPlano reads notifications only from the apps you pick here. Nothing else on your phone
        is read, and the text never leaves this device.
      </Text>

      <ScrollView testID="provider-picker-list" className="mt-4 flex-1">
        {/* Detecting nothing is not an error (docs/04-features/01-onboarding.md
            rule 7) — the group is omitted entirely rather than rendered empty,
            which would read as a failed detection. */}
        {seen.length > 0 ? (
          <View testID="provider-group-observed">
            <Text
              testID="provider-heading-observed"
              className="pb-1 pt-2 text-base font-semibold text-fg dark:text-fg-dark"
            >
              Apps we&apos;ve seen
            </Text>
            <Text className="pb-2 text-sm text-fg-2 dark:text-fg-2-dark">
              These have posted a notification on this phone.
            </Text>
            {seen.map((choice) => (
              <ChoiceRow
                key={choice.packageName}
                choice={choice}
                selected={selected.includes(choice.packageName)}
                onToggle={toggle}
              />
            ))}
          </View>
        ) : null}

        {unseen.length > 0 ? (
          <View testID="provider-group-suggested">
            <Text
              testID="provider-heading-suggested"
              className="pb-1 pt-5 text-base font-semibold text-fg dark:text-fg-dark"
            >
              Common in the Philippines
            </Text>
            <Text className="pb-2 text-sm text-fg-2 dark:text-fg-2-dark">
              We haven&apos;t seen these on your phone yet. Pick one anyway if you use it.
            </Text>
            {unseen.map((choice) => (
              <ChoiceRow
                key={choice.packageName}
                choice={choice}
                selected={selected.includes(choice.packageName)}
                onToggle={toggle}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* The honest half of rule 2. An empty filter is allow-all, so a screen
          that promised only "we read the apps you pick" would be lying to the
          user who picks none — which is also the user most likely to be
          worried about exactly that. */}
      <Text
        testID="provider-picker-allow-all-note"
        className="mt-3 text-center text-sm text-fg-2 dark:text-fg-2-dark"
      >
        Pick nothing and PeraPlano keeps watching every app for money notifications instead. You
        can narrow this down any time in Settings.
      </Text>

      <Pressable
        testID="provider-picker-continue-button"
        onPress={handleConfirm}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Continue"
        accessibilityState={{ disabled: busy }}
        className="mt-4 items-center rounded-lg bg-brand py-3 dark:bg-brand-dark"
      >
        <Text className="font-semibold text-surface dark:text-surface-dark">Continue</Text>
      </Pressable>

      <Pressable
        testID="provider-picker-skip-button"
        onPress={onSkip}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Skip for now"
        accessibilityState={{ disabled: busy }}
        className="mt-3 items-center py-3"
      >
        <Text className="font-semibold text-brand dark:text-brand-dark">Skip for now</Text>
      </Pressable>
    </View>
  );
}

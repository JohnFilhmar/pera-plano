// components/ui/chip.tsx — m1c plan Task 2.
//
// One chip, five tones. Category chips in the ledger, matcher chips on a wallet
// ("Catches: GCash"), due chips on bills, and the "Soon" chip SoonGate renders
// are all this component — which is the point: a second hand-rolled pill is how
// two different greys end up meaning two different things.
import { Pressable, Text, View } from "react-native";

export type ChipTone = "neutral" | "brand" | "warn" | "danger" | "soon";

export type ChipProps = {
  label: string;
  tone?: ChipTone;
  onPress?: () => void;
  testID?: string;
};

/**
 * Tone → background, contract §2 tokens only.
 *
 * `soon` is byte-for-byte the grey `components/gates/soon_gate.tsx` shipped
 * first, and SoonGate now renders this component so the two cannot drift apart.
 * docs/11 "TWO GATING STATES" makes grey and brand green mean opposite things —
 * grey is "designed, not built yet", brand green is "built, needs Plus" — so a
 * chip that picks the wrong one makes a promise the app will not keep.
 *
 * `neutral` is the only unfilled tone. That is deliberate: it leaves *solid
 * grey* reserved for `soon` alone, so a category chip can never be mistaken for
 * a dormant feature at a glance.
 */
const TONE_BG: Record<ChipTone, string> = {
  neutral: "bg-bg dark:bg-bg-dark",
  brand: "bg-brand dark:bg-brand-dark",
  warn: "bg-warn dark:bg-warn-dark",
  danger: "bg-danger dark:bg-danger-dark",
  soon: "bg-fg-2 dark:bg-fg-2-dark",
};

/**
 * Filled tones invert to the surface colour, which lands near-white on light
 * fills and near-black on the brighter dark-mode fills — the same pairing the
 * shipped Plus badge and Soon chip already use.
 */
const TONE_TEXT: Record<ChipTone, string> = {
  neutral: "text-fg-2 dark:text-fg-2-dark",
  brand: "text-surface dark:text-surface-dark",
  warn: "text-surface dark:text-surface-dark",
  danger: "text-surface dark:text-surface-dark",
  soon: "text-surface dark:text-surface-dark",
};

export function Chip({ label, tone = "neutral", onPress, testID }: ChipProps) {
  const body = (
    <Text className={`text-xs font-semibold ${TONE_TEXT[tone]}`}>{label}</Text>
  );
  const className = `rounded-full px-2 py-0.5 ${TONE_BG[tone]}`;

  // A chip with no handler stays a plain View rather than a disabled Pressable:
  // a Pressable still announces itself to TalkBack as something to activate,
  // and most chips in the app are labels, not controls.
  if (!onPress) {
    return (
      <View testID={testID} className={className}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={className}
    >
      {body}
    </Pressable>
  );
}

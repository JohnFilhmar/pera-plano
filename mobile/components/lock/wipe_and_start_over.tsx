// components/lock/wipe_and_start_over.tsx — the §11a "wipe and start over"
// escape hatch (docs/12-encryption-and-app-lock.md §11a; task-9-brief.md
// rule 7), extracted from recovery_unlock_form.tsx when GAP-034 gave it a
// second caller.
//
// THE DOUBLE CONFIRMATION IS THE POINT, not decoration. One confirmation
// alone must destroy nothing: a single mis-tap on the one control in this app
// that deletes a user's whole ledger must never be irreversible. The first
// step explains why there is no way back, the second names exactly what is
// destroyed, and only the second actually calls onWipe.
//
// Both callers reach this screen from a DIFFERENT dead end, which is why the
// trigger label and the first step's explanation are props. The second step
// is not: "every transaction, wallet, and setting on this device, and this
// cannot be undone" is the same sentence whichever way the user got here, and
// it is the sentence that must never drift between the two screens.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

type WipeStep = "hidden" | "confirm1" | "confirm2";

/**
 * Touch target (design F1 sweep). The trigger and both "Cancel" links carry no
 * padding class and no size guarantee — the same bare-Pressable shape as
 * `app/wallet/[id].tsx`'s "Edit". Unlike that control, or
 * `ISOLATED_LINK_HIT_SLOP`'s five call sites, each of these three sits
 * directly BELOW another Pressable in a `gap-*` column (the caller's primary
 * button above the trigger, each wipe step's own "…continue" button above its
 * "Cancel") — a full-strength slop on that shared edge would reach into the
 * button above it, the vertical version of the mis-tap bug `CHIP_HIT_SLOP`'s
 * own comment documents fixing on the horizontal axis. TOP is capped at half
 * the relevant gap so the two controls' touch regions meet at the gap's
 * midpoint rather than overlap; BOTTOM, LEFT and RIGHT have no neighbour to
 * collide with, so they take the same generous, unstyled-text-safe value
 * `ISOLATED_LINK_HIT_SLOP` documents deriving.
 */
const TRIGGER_HIT_SLOP = { top: 8, bottom: 16, left: 16, right: 16 }; // gap-4 (16px) above, halved
const WIPE_CANCEL_HIT_SLOP = { top: 6, bottom: 16, left: 16, right: 16 }; // gap-3 (12px) above, halved

/**
 * The two-step confirmation in front of `wipeAndStartOver`, for every screen
 * that is a dead end for a user who cannot get back into their own data.
 *
 * Renders as a single bare link until the user opens it, so it adds nothing
 * but one line to a screen whose main job is the route that still works.
 *
 * @param triggerLabel The link that opens the first step. Names the user's
 *   situation, never the destruction: a user who has not yet been told there
 *   is no way back should not be reading the word "wipe" on a link they might
 *   tap to find out what it does.
 * @param firstConfirmMessage Why this user in particular has no way back, and
 *   that wiping is what is left. The second step's copy is fixed and not a
 *   prop.
 * @param onWipe Runs only from the second confirmation. Never rejects (see
 *   lock_context's `wipeAndStartOver`), so the caller reports every outcome
 *   through lock status and message rather than through this component.
 * @param triggerTestID Defaults to the id this control had before the
 *   extraction, so recovery_unlock_form.test.tsx keeps addressing it by the
 *   same name. A second caller passes its own rather than inheriting a name
 *   that describes a recovery phrase it never mentions.
 */
export function WipeAndStartOver({
  triggerLabel,
  firstConfirmMessage,
  onWipe,
  triggerTestID = "forgot-phrase-link",
}: {
  triggerLabel: string;
  firstConfirmMessage: string;
  onWipe: () => void | Promise<void>;
  triggerTestID?: string;
}) {
  const [wipeStep, setWipeStep] = useState<WipeStep>("hidden");

  return (
    <>
      {wipeStep === "hidden" ? (
        <Pressable
          testID={triggerTestID}
          accessibilityRole="button"
          accessibilityLabel={triggerLabel}
          onPress={() => setWipeStep("confirm1")}
          hitSlop={TRIGGER_HIT_SLOP}
        >
          <Text className="text-center text-fg-2 underline dark:text-fg-2-dark">{triggerLabel}</Text>
        </Pressable>
      ) : null}

      {wipeStep === "confirm1" ? (
        <View testID="wipe-confirm-1" className="w-full gap-3 rounded-lg border border-danger p-4 dark:border-danger-dark">
          <Text className="text-center text-fg dark:text-fg-dark">{firstConfirmMessage}</Text>
          <Pressable
            testID="wipe-confirm-1-continue"
            onPress={() => setWipeStep("confirm2")}
            accessibilityRole="button"
            className="min-h-[44px] justify-center rounded-lg bg-danger px-4 py-3 dark:bg-danger-dark"
          >
            <Text className="text-center font-semibold text-surface dark:text-surface-dark">
              I understand — continue
            </Text>
          </Pressable>
          <Pressable
            testID="wipe-confirm-1-cancel"
            onPress={() => setWipeStep("hidden")}
            accessibilityRole="button"
            hitSlop={WIPE_CANCEL_HIT_SLOP}
          >
            <Text className="text-center text-fg-2 dark:text-fg-2-dark">Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {wipeStep === "confirm2" ? (
        <View testID="wipe-confirm-2" className="w-full gap-3 rounded-lg border border-danger p-4 dark:border-danger-dark">
          <Text className="text-center font-semibold text-danger dark:text-danger-dark">
            This will permanently delete every transaction, wallet, and setting on this device.
            This cannot be undone.
          </Text>
          <Pressable
            testID="wipe-confirm-2-continue"
            onPress={() => void onWipe()}
            accessibilityRole="button"
            className="min-h-[44px] justify-center rounded-lg bg-danger px-4 py-3 dark:bg-danger-dark"
          >
            <Text className="text-center font-semibold text-surface dark:text-surface-dark">
              Wipe and start over
            </Text>
          </Pressable>
          <Pressable
            testID="wipe-confirm-2-cancel"
            onPress={() => setWipeStep("hidden")}
            accessibilityRole="button"
            hitSlop={WIPE_CANCEL_HIT_SLOP}
          >
            <Text className="text-center text-fg-2 dark:text-fg-2-dark">Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

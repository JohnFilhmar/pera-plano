// components/ui/mutation_error_toast.tsx — the app's one transient-notice
// surface, mounted once in app/_layout.tsx. It renders the queue in
// lib/query_client.ts, whose only producer today is that file's
// `createMutationErrorCache` (GAP-013: 49 mutation hooks, none with an
// `onError`, so a failed write closed the sheet and said nothing).
//
// THE NAME IS THE MOUNT, NOT THE LIMIT. It is called MutationErrorToast
// because a failed mutation is the reason it exists, but it draws whatever is
// queued: `publishToast` takes a tone, an optional action, and its own
// duration, so a triage undo or any later notice reuses this host rather than
// growing a second overlay that has to be kept out of this one's way.
//
// TOP-ANCHORED, NOT A BOTTOM SNACKBAR. Every other layer in this app already
// owns the bottom band: the tab bar, `BottomSheet`, and `KeypadHost`, which
// takes the whole lower third with no scrim so the form above stays tappable.
// A bottom notice would cover the tab bar on most screens and be covered by
// the keypad on exactly the screens where a save is most likely to fail. The
// top strip is free, and it is where a status message is looked for.
//
// NO ANIMATION AT ALL, deliberately. `keypad_host.tsx`'s header records that
// NativeWind `className` on an `Animated` host is unverified in this app, so
// an animated card would have to be styled in raw JS and would drift from
// every other surface here. A notice that simply appears also needs no
// reduced-motion branch: there is no motion to reduce.
//
// THE CONTROLS ARE TEXT, matching app/review/index.tsx's failure banner
// exactly ("Try again" / "Dismiss" as plain pressables). An icon-only close
// would be a second vocabulary for the same job on the same kind of message.
//
// A COPY IS NEVER AN ERROR. `AppToast.title`/`body` are written strings from
// lib/query_client.ts, and nothing in this file reads `error.message`, a
// stack, or notification text. The ledger and the captures that feed it stay
// off this surface entirely (docs/12).
import { Info, TriangleAlert } from "lucide-react-native";
import { useEffect, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  dismissToast,
  getToasts,
  subscribeToToasts,
  type AppToast,
  type AppToastTone,
} from "@/lib/query_client";

import { registerIcon, type IconComponent } from "./button";

/**
 * The rail down the leading edge carries the tone, and it is a FILL of the
 * base tone rather than one of the `*-ink` tokens: constants/colors.ts is
 * explicit that the ink tokens are tuned for text on that hue's own soft tint
 * and must never paint a solid. The card itself stays `surface`, so a failure
 * reads as the app's own voice rather than a red slab over the screen the
 * message is about — the same call app/review/index.tsx made for its banner.
 */
const TONE_RAIL: Record<AppToastTone, string> = {
  failure: "bg-danger dark:bg-danger-dark",
  neutral: "bg-fg-2 dark:bg-fg-2-dark",
};

const TONE_ICON: Record<AppToastTone, string> = {
  failure: "text-danger dark:text-danger-dark",
  neutral: "text-fg-2 dark:text-fg-2-dark",
};

/**
 * The glyph follows the tone. It did not before: one `TriangleAlert` was
 * registered for the whole component, so the neutral tone — the one GAP-075's
 * undo notice and every later non-failure message use — announced itself with
 * an alarm triangle.
 *
 * NO `testID` ON THE ICON. A lucide glyph does not forward one into the
 * rendered tree here, so an added testID is silently absent and any test
 * written against it fails for a reason that has nothing to do with the tone.
 * The test asserts the component TYPE instead, which is the claim anyway.
 */
const TONE_GLYPH: Record<AppToastTone, IconComponent> = {
  failure: registerIcon(TriangleAlert),
  neutral: registerIcon(Info),
};

/**
 * One card, and the owner of its expiry timer — see the queue's own doc in
 * lib/query_client.ts for why the store holds no timers.
 *
 * KEYED ON `toast.id`, which is reissued when a repeat replaces an entry under
 * the same `dedupeKey`. That is what makes a second identical failure restart
 * the countdown instead of inheriting the remains of the first one's.
 */
function ToastCard({ toast }: { toast: AppToast }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs]);

  const action =
    toast.actionLabel !== undefined && toast.onAction !== undefined
      ? { label: toast.actionLabel, run: toast.onAction }
      : undefined;

  const ToneIcon = TONE_GLYPH[toast.tone];

  return (
    <View
      testID="app-toast"
      // Polite, not assertive: the user is mid-task, and a failed write is not
      // worth cutting off a screen reader's current sentence. Matches
      // app/review/index.tsx's own failure banner.
      accessibilityLiveRegion="polite"
      className="flex-row overflow-hidden rounded-xl bg-surface shadow-sm dark:border dark:border-line-dark dark:bg-surface-dark"
    >
      <View testID="app-toast-rail" className={`w-1 ${TONE_RAIL[toast.tone]}`} />
      <View className="flex-1 flex-row items-start gap-3 px-3 py-3">
        <ToneIcon size={18} className={`mt-0.5 ${TONE_ICON[toast.tone]}`} />
        <View className="flex-1 gap-0.5">
          <Text className="text-body font-semibold text-fg dark:text-fg-dark">{toast.title}</Text>
          <Text className="text-secondary text-fg-2 dark:text-fg-2-dark">{toast.body}</Text>
          <View className="mt-1 flex-row gap-4">
            {action === undefined ? null : (
              <Pressable
                testID="app-toast-action"
                accessibilityRole="button"
                onPress={() => {
                  // Taken down first: the offer is spent the moment it is
                  // taken, and a card still showing it while the handler runs
                  // invites a second tap on a one-shot action.
                  dismissToast(toast.id);
                  action.run();
                }}
                className="min-h-[44px] justify-center"
              >
                <Text className="text-body font-semibold text-fg dark:text-fg-dark">
                  {action.label}
                </Text>
              </Pressable>
            )}
            <Pressable
              testID="app-toast-dismiss"
              accessibilityRole="button"
              onPress={() => dismissToast(toast.id)}
              className="min-h-[44px] justify-center"
            >
              <Text className="text-body text-fg-2 dark:text-fg-2-dark">Dismiss</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * Mounted once, beside the navigator rather than inside it, so a notice
 * survives whatever navigation the failing screen has already done.
 *
 * `pointerEvents="box-none"` on the strip, with only the cards inside it
 * taking touches: the notice must never swallow a tap meant for the header
 * underneath, which on most screens is a back button.
 *
 * It pads the TOP inset itself, the one edge it touches — app/_layout.tsx's
 * header states the rule that an edge is padded exactly once, by whichever
 * component actually meets it.
 */
export function MutationErrorToast() {
  const toasts = useSyncExternalStore(subscribeToToasts, getToasts, getToasts);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      testID="app-toasts"
      pointerEvents="box-none"
      style={{ position: "absolute", top: insets.top, left: 0, right: 0 }}
      className="gap-2 px-4 pt-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </View>
  );
}

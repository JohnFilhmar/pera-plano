// components/ui/button.tsx — m1c plan Task 2.
//
// The only button in the app. Two of its behaviours are money-safety features
// rather than polish, and both live in the `loading` state (plan rule 2):
// the button must not shrink, and it must not fire twice.
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { cssInterop } from "nativewind";

/** Any icon from the lucide set — the app's only icon source (docs/11). */
export type IconComponent = LucideIcon;

const REGISTERED_ICONS = new WeakSet<IconComponent>();

/**
 * Lucide icons ship as plain SVG components and ignore `className` until they
 * are registered with cssInterop; `nativeStyleToProp` routes the resolved
 * `color` style back onto the `color` prop lucide actually reads. Without this
 * the icon silently renders black — invisible on a dark-mode filled button.
 *
 * Registration is global and idempotent, and the icon arrives as a prop rather
 * than as a module-scope import, so the WeakSet does the once-only bookkeeping
 * a top-level `cssInterop(Lock, …)` call gets for free (see
 * `components/gates/plus_gate.tsx` for that simpler case).
 */
export function registerIcon(Icon: IconComponent): IconComponent {
  if (!REGISTERED_ICONS.has(Icon)) {
    cssInterop(Icon, {
      className: { target: "style", nativeStyleToProp: { color: true } },
    });
    REGISTERED_ICONS.add(Icon);
  }
  return Icon;
}

// ActivityIndicator reads its colour from a `color` prop, not from a style, so
// it needs the same treatment before `className` can tint the spinner.
cssInterop(ActivityIndicator, {
  className: { target: "style", nativeStyleToProp: { color: true } },
});

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "outline-destructive";

export type ButtonSize = "md" | "lg";

type ButtonBaseProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
};

/**
 * `icon` and `iconOnly` are a discriminated pair, not two independent
 * optionals. `iconOnly: true` with no `icon` used to compile cleanly and
 * render a blank-but-tappable 44x44 pill: no label (dropped by `iconOnly`),
 * no icon (never provided), and a live `onPress` underneath nothing on
 * screen. Requiring `icon` the moment `iconOnly` is `true` turns that state
 * into a compile error instead of a runtime one. This costs nothing at any
 * existing call site — nothing in the app sets `iconOnly` yet.
 */
export type ButtonProps = ButtonBaseProps &
  (
    | { icon?: IconComponent; iconOnly?: false }
    | {
        icon: IconComponent;
        /**
         * Renders the icon alone — no visible label — for a compact, square
         * button. `title` is still required and still backs
         * `accessibilityLabel`, so the button stays announced correctly even
         * though nothing on screen says it.
         */
        iconOnly: true;
      }
  );

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: "bg-brand dark:bg-brand-dark",
  secondary: "bg-brand-soft dark:bg-brand-soft-dark",
  ghost: "bg-transparent",
  // `danger` is reserved for actions that destroy data. Nothing else in the
  // app may claim it, or the colour stops carrying a warning.
  destructive: "bg-danger dark:bg-danger-dark",
  // The design's "Wipe everything": surface fill, danger border, danger ink.
  // A destructive action the user should be able to READ calmly before
  // pressing gets an outline; one they are confirming gets the fill.
  "outline-destructive": "bg-surface border border-danger dark:bg-surface-dark dark:border-danger-dark",
};

const VARIANT_FG: Record<ButtonVariant, string> = {
  // `on-brand`/`on-brand-dark`, not `surface`/`surface-dark`: the label sits
  // ON a `bg-brand`/`bg-danger` FILL, which is a different idea from "the
  // page background" — see constants/colors.ts's ON-BRAND FOREGROUND block
  // for why the two used to collide and the contrast numbers for this pair.
  primary: "text-on-brand dark:text-on-brand-dark",
  // `brand-ink`, not the bare `brand` this variant originally shipped with.
  // `secondary`'s fill is `bg-brand-soft` (VARIANT_BG above) — an opaque
  // token, #DCFCE7 — and `brand` on it measures 4.567:1
  // (constants/colors.ts), a hair over WCAG AA's 4.5:1 floor with no
  // headroom. `brand-ink` measures 6.49:1 on the same background, the exact
  // fix components/gates/plus_gate.tsx already proved for this pairing.
  // `ghost`'s `text-brand` stays as-is: its fill is `bg-transparent`
  // (VARIANT_BG.ghost), not a soft tint, so this file's own rule (ink tokens
  // are for text on a hue's own soft tint, nowhere else) does not apply there.
  secondary: "text-brand-ink dark:text-brand-ink-dark",
  ghost: "text-brand dark:text-brand-dark",
  destructive: "text-on-brand dark:text-on-brand-dark",
  "outline-destructive": "text-danger dark:text-danger-dark",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: "px-5 py-2.5",
  lg: "px-5 py-3.5",
};

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  iconOnly = false,
  testID,
}: ButtonProps) {
  const inactive = loading || disabled;
  const foreground = VARIANT_FG[variant];
  const Icon = icon ? registerIcon(icon) : undefined;

  // While loading the label stays MOUNTED and merely invisible. Unmounting it
  // would collapse the button to spinner-width, and a button that shrinks
  // moves whatever sits beside it under a finger already on its way down —
  // which on a confirm dialog is a mis-tap on the other action.
  const hidden = loading ? " opacity-0" : "";

  const containerClass = [
    "min-h-[44px] flex-row items-center justify-center gap-2 rounded-full",
    iconOnly ? "aspect-square px-0" : SIZE_CLASS[size],
    VARIANT_BG[variant],
    disabled || loading ? "opacity-40" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Pressable
      testID={testID}
      // Belt and braces. `disabled` stops the touch responder; dropping the
      // handler stops anything that gets past it anyway. A press that gets
      // past it on a submit button is a second committed transaction.
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      className={containerClass}
    >
      {Icon ? <Icon size={18} className={`${foreground}${hidden}`} /> : null}
      {/* `iconOnly` drops the label from the tree rather than hiding it —
          there is no width to preserve for a spinner to grow into, unlike
          the loading case above, and a hidden-but-present "x" would still
          take up flex-row space next to the icon in an `aspect-square`
          button that has none to spare. */}
      {iconOnly ? null : (
        <Text className={`text-body font-semibold ${foreground}${hidden}`}>
          {title}
        </Text>
      )}
      {loading ? (
        <View className="absolute inset-0 items-center justify-center">
          <ActivityIndicator testID="button-spinner" className={foreground} />
        </View>
      ) : null}
    </Pressable>
  );
}

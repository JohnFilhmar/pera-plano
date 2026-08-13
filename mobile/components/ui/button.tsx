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

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconComponent;
  testID?: string;
};

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: "bg-brand dark:bg-brand-dark",
  secondary: "bg-brand-soft dark:bg-brand-soft-dark",
  ghost: "bg-transparent",
  // `danger` is reserved for actions that destroy data. Nothing else in the
  // app may claim it, or the colour stops carrying a warning.
  destructive: "bg-danger dark:bg-danger-dark",
};

const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: "text-surface dark:text-surface-dark",
  secondary: "text-brand dark:text-brand-dark",
  ghost: "text-brand dark:text-brand-dark",
  destructive: "text-surface dark:text-surface-dark",
};

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
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
      className={[
        "flex-row items-center justify-center gap-2 rounded-xl px-4 py-3",
        VARIANT_BG[variant],
        // Dim only for `disabled`. A loading button is still an active
        // commitment the user made and should not look switched off.
        disabled && !loading ? "opacity-50" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {Icon ? <Icon size={18} className={`${foreground}${hidden}`} /> : null}
      <Text className={`text-base font-semibold ${foreground}${hidden}`}>
        {title}
      </Text>
      {loading ? (
        <View className="absolute inset-0 items-center justify-center">
          <ActivityIndicator testID="button-spinner" className={foreground} />
        </View>
      ) : null}
    </Pressable>
  );
}

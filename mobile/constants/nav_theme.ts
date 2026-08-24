// constants/nav_theme.ts — the one place react-navigation learns our colours.
//
// THE DEFECT THIS FIXES, from five device screenshots: a light-grey void filled
// everything below a screen's content — the whole lower half of Plan -> Limits
// -> new, Plan -> Goals -> new and More -> Reports, a thinner strip under Plan
// -> Bills -> new and Plan -> Loans -> new — with the app in DARK mode in every
// one of them.
//
// The app's colours were being applied only INSIDE each screen, on a child View
// carrying `bg-bg dark:bg-bg-dark`. Every navigator above those screens was
// still painting its scenes with react-navigation's own built-in light default,
// because nothing in the tree had ever set a navigation theme. So any pixel a
// screen's content did not itself cover showed that default through. Two things
// routinely fail to cover: components/ui/form_screen.tsx's `paddingBottom` band
// (BASE_PADDING, plus the open keypad's height — the big voids), and any short
// screen whose content stops above the fold (the thin strips).
//
// WHY THE ROOT Stack's `contentStyle` WAS NOT ENOUGH. app/_layout.tsx does set
// `contentStyle: { backgroundColor: bg }`, and it works — for the ROOT Stack's
// own screens. `(tabs)` is one of those screens, and the Tabs navigator inside
// it, plus the `plan/` and `more/` Stacks inside that, each render their own
// scene containers with their own backgrounds, each painting over whatever the
// root Stack put down. The screens in the screenshots all live two or three
// navigators deep.
//
// WHY A THEME RATHER THAN A PROP PER NAVIGATOR. Painting them by hand costs one
// prop on (tabs)/_layout.tsx, one on plan/_layout.tsx, one on more/_layout.tsx,
// one on (onboarding)/_layout.tsx — and a fifth the day someone adds a
// navigator and does not know to. That failure is invisible in tests, invisible
// in light mode, and shows up as a grey void on a device. react-navigation
// resolves its colours from the nearest ThemeProvider, so ONE provider above
// the root Stack reaches every navigator nested under it, including ones that
// do not exist yet. The same structural argument app/(tabs)/plan/_layout.tsx
// already makes for being a Stack instead of a hand-maintained list of
// `href: null` routes.
//
// THE BASE THEME IS SPREAD, NOT REPLACED. v7's `Theme` carries a required
// `fonts` block alongside `colors`, and `colors` has keys this file has no
// opinion about. Spreading DarkTheme/DefaultTheme and overriding the six
// colours we actually own means a key added by a future react-navigation
// version arrives with a sane value instead of `undefined`.
import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";

import { palette } from "./colors";
import type { ResolvedTheme } from "@/contexts/theme_context";

/**
 * The navigation theme for a resolved (never "auto") app theme.
 *
 * A PURE FUNCTION OF THE RESOLVED THEME, so it can be asserted without a render
 * tree — app/_layout.tsx already holds `resolved` for the Stack's existing
 * `contentStyle`, and hands the same value here.
 */
export function navThemeFor(resolved: ResolvedTheme): Theme {
  const isDark = resolved === "dark";
  const base = isDark ? DarkTheme : DefaultTheme;

  return {
    ...base,
    colors: {
      ...base.colors,
      // The scene/page colour. This is the one the screenshots are about.
      background: isDark ? palette["bg-dark"] : palette.bg,
      // A Stack screen's card and a header's fill. `surface` is this palette's
      // "a page/card background" token — see constants/colors.ts's `on-brand`
      // note for why that is a different idea from the ink painted onto a fill.
      card: isDark ? palette["surface-dark"] : palette.surface,
      text: isDark ? palette["fg-dark"] : palette.fg,
      // Hairlines between navigation chrome and content. `surface` rather than
      // a dedicated border token because this palette has none, and a border
      // the same colour as the card reads as no border — which is what every
      // screen in this app already draws.
      border: isDark ? palette["surface-dark"] : palette.surface,
      primary: isDark ? palette["brand-dark"] : palette.brand,
      notification: isDark ? palette["danger-dark"] : palette.danger,
    },
  };
}

// constants/__tests__/nav_theme.test.ts — the "broken UI" screenshots.
//
// THE DEFECT. Five separate screenshots from a physical A54 showed a light-grey
// void filling everything below a screen's content: the whole lower half of
// Plan -> Limits -> new, of Plan -> Goals -> new and of More -> Reports, and a
// thinner strip under Plan -> Bills -> new and Plan -> Loans -> new. The app is
// in dark mode in every one of them.
//
// WHERE THE GREY CAME FROM. Nothing in app/, components/ or contexts/ set a
// react-navigation theme (`sceneStyle`, `sceneContainerStyle`, `DefaultTheme`
// — zero hits across the tree), so every navigator painted its scenes with
// react-navigation's own built-in light default. The app's colours were applied
// only INSIDE each screen, on a child View carrying `bg-bg dark:bg-bg-dark`, so
// any pixel a screen's content did not itself cover fell through to that
// default. Two things routinely fail to cover: components/ui/form_screen.tsx's
// `paddingBottom` band (BASE_PADDING, plus the keypad's height while a panel is
// open — the big voids), and any short screen whose content stops above the
// fold (the thin strips).
//
// WHY THE ROOT Stack's `contentStyle` DID NOT ALREADY COVER IT. app/_layout.tsx
// sets `contentStyle: { backgroundColor: bg }`, and that is real — but it
// applies to the ROOT Stack's own screens. `(tabs)` is ONE of those screens,
// and the Tabs navigator inside it, plus the `plan/` and `more/` Stacks inside
// that, each render their own scene containers with their own backgrounds. Each
// of those paints OVER whatever the root Stack put down.
//
// WHY A THEME AND NOT FOUR `contentStyle` PROPS. Painting each navigator by
// hand needs one prop on (tabs)/_layout.tsx, one on plan/_layout.tsx, one on
// more/_layout.tsx and one on (onboarding)/_layout.tsx — and a fifth the day
// someone adds a navigator, which would fail silently, in dark mode, on a
// device. react-navigation reads its colours from the nearest ThemeProvider, so
// one provider above the root Stack reaches every navigator nested under it,
// including ones that do not exist yet. Same structural argument
// app/(tabs)/plan/_layout.tsx already makes for why it is a Stack rather than a
// hand-maintained list of `href: null` routes.
import { navThemeFor } from "../nav_theme";
import { palette } from "../colors";

test("paints scenes with the app's own background, not react-navigation's default", () => {
  // THE ASSERTION THE SCREENSHOTS ARE ABOUT. react-navigation's DefaultTheme
  // background is a light grey; ours is near-black in dark mode. A navigator
  // left on the default is exactly the void the owner photographed.
  expect(navThemeFor("dark").colors.background).toBe(palette["bg-dark"]);
  expect(navThemeFor("light").colors.background).toBe(palette.bg);
});

test("paints cards and headers from the palette too", () => {
  // `card` is what a Stack screen and a header use. Left on the default it
  // reproduces the same defect one layer in.
  expect(navThemeFor("dark").colors.card).toBe(palette["surface-dark"]);
  expect(navThemeFor("light").colors.card).toBe(palette.surface);
  expect(navThemeFor("dark").colors.text).toBe(palette["fg-dark"]);
  expect(navThemeFor("light").colors.text).toBe(palette.fg);
});

test("reports its own darkness, so navigators pick matching built-in defaults", () => {
  // react-navigation branches on `theme.dark` for things this file does not
  // override (ripples, the modal scrim). Reporting light while painting a
  // near-black background is how you get a black-on-black header.
  expect(navThemeFor("dark").dark).toBe(true);
  expect(navThemeFor("light").dark).toBe(false);
});

test("keeps every key react-navigation v7 requires", () => {
  // v7's Theme gained a required `fonts` block, and a hand-built colours object
  // that drops a key crashes at render rather than at compile time in JS
  // consumers. Spreading the base theme is what guarantees this; the test is
  // what keeps someone from replacing the spread with a literal.
  const theme = navThemeFor("dark");

  expect(theme.fonts).toBeDefined();
  expect(Object.keys(theme.colors).sort()).toEqual(
    ["background", "border", "card", "notification", "primary", "text"].sort(),
  );
});

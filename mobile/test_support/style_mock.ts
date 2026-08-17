// test_support/style_mock.ts — stands in for `global.css` under Jest.
//
// `app/_layout.tsx` imports `../global.css` because NativeWind needs the app to
// register its compiled stylesheet; without that import every `className` in
// the app is inert on a real device (proved on hardware — a `text-center`
// heading rendered left-aligned).
//
// Jest cannot parse CSS: the import throws a syntax error and takes down every
// suite that renders the root layout. Metro compiles the stylesheet through
// `withNativeWind`; Jest has no such transform and needs none, because these
// tests assert on text, testIDs and behaviour rather than on computed styles.
//
// So this is a deliberate no-op, NOT a gap being papered over. A test that
// needed to prove a class actually applies could not do it here anyway — that
// question only has a real answer on a device, which is where the missing
// import was found in the first place.
export {};

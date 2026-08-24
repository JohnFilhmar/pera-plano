// test_support/svg_mock.tsx — stands in for the Metro SVG transform under Jest.
//
// `mobile/metro.config.js` routes `.svg` imports through
// `react-native-svg-transformer`, which turns each file into a React
// component backed by `react-native-svg`'s native drawing primitives. Jest
// has no such transform: asked to parse a `.svg` file's raw XML as a CommonJS
// module, it throws a syntax error and takes down every suite that imports
// one — exactly the failure `\\.css$` → `style_mock.ts` exists to prevent
// for `global.css`.
//
// So `jest.moduleNameMapper`'s `\\.svg$` entry (mobile/package.json) redirects
// every `.svg` import to this file instead. It renders a plain `View` and
// forwards every prop it receives, `testID` included, so a test can assert an
// SVG-backed component was asked to render at the right size and with the
// right identity — the only things these tests can or should assert, since
// this mock draws nothing. Proving the artwork itself renders correctly is a
// question only a real device can answer (the same boundary `style_mock.ts`
// draws for CSS), so this is a deliberate stand-in for the transform, not a
// gap being papered over.
import { View } from "react-native";
import type { ViewProps } from "react-native";

export default function SvgMock(props: ViewProps) {
  return <View {...props} />;
}

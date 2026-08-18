// components/ui/__tests__/brand_mark.test.tsx — task-1-brief.md.
//
// `BrandMark` wraps the one brand SVG that's safe to render on React Native
// (assets/brand/README.md's SMIL fact — every other delivered file freezes
// on its first frame). These tests exercise the wrapper's own contract —
// default size, an explicit size reaching BOTH dimensions, and testID
// forwarding — not the artwork itself, which `test_support/svg_mock.tsx`
// stands in for under Jest.
import { render, screen } from "@testing-library/react-native";

import { BrandMark } from "../brand_mark";

test("renders the brand mark at the default size", () => {
  render(<BrandMark testID="brand-mark" />);

  const mark = screen.getByTestId("brand-mark");
  expect(mark.props.width).toBe(48);
  expect(mark.props.height).toBe(48);
});

test("applies an explicit size to both dimensions", () => {
  render(<BrandMark testID="brand-mark" size={96} />);

  const mark = screen.getByTestId("brand-mark");
  expect(mark.props.width).toBe(96);
  expect(mark.props.height).toBe(96);
});

test("forwards testID", () => {
  render(<BrandMark testID="onboarding-brand-mark" />);

  expect(screen.getByTestId("onboarding-brand-mark")).toBeTruthy();
});

// components/ui/__tests__/brand_mark.test.tsx — task-1-brief.md.
//
// `BrandMark` wraps the one brand SVG that's safe to render on React Native
// (assets/brand/README.md's SMIL fact — every other delivered file freezes
// on its first frame). These tests exercise the wrapper's own contract —
// default size, an explicit size reaching BOTH dimensions, and testID
// forwarding — not the artwork itself, which `test_support/svg_mock.tsx`
// stands in for under Jest.
//
// Task 4 added `variant`/`playToken`; the motion those unlock is tested next
// door in brand_mark_motion.test.tsx. What stays HERE is the default path,
// because `image_placeholder.tsx` renders `<BrandMark size={28} />` with no
// variant at all — so "no variant means the plain static SVG, unchanged" is a
// backward-compatibility guarantee, not an implementation detail.
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

test("renders the static mark when no variant is given", () => {
  render(<BrandMark testID="brand-mark" />);

  // The static branch renders the imported `.svg` directly, so under
  // svg_mock.tsx the size arrives as PROPS. Every animated variant wraps the
  // mark in Reanimated boxes that carry their size in `style` instead — so a
  // `width` prop here is proof the default path did not become animated, and
  // proof that no reduced-motion listener is needed to reach the artwork.
  const mark = screen.getByTestId("brand-mark");
  expect(mark.props.width).toBe(48);
  expect(mark.props.height).toBe(48);
});

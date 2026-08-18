// components/onboarding/__tests__/value_carousel.test.tsx — task-3-brief.md.
//
// ValueCarousel is pure presentation over VALUE_PANELS or an injected
// fixture (rule 8) -- the first two tests drive a two-panel fixture so
// "one dot per panel" and "every panel's label and brief" are genuine
// assertions about the component's behaviour, not incidentally true because
// VALUE_PANELS happens to have four entries today. The third test pins the
// real four-panel default against value_panels.ts's own export.
import { render, screen } from "@testing-library/react-native";

import { ValueCarousel } from "../value_carousel";
import { VALUE_PANELS, type ValuePanel } from "../value_panels";

const TEST_PANELS: readonly ValuePanel[] = [
  { id: "panel_one", label: "Panel One", brief: "The first test brief." },
  { id: "panel_two", label: "Panel Two", brief: "The second test brief." },
];

test("renders every panel's label and brief", () => {
  render(<ValueCarousel panels={TEST_PANELS} />);

  for (const panel of TEST_PANELS) {
    expect(screen.getByText(panel.label)).toBeTruthy();
    expect(screen.getByText(panel.brief)).toBeTruthy();
  }
});

test("renders one dot per panel", () => {
  render(<ValueCarousel panels={TEST_PANELS} />);

  for (const panel of TEST_PANELS) {
    expect(screen.getByTestId(`value-carousel-dot-${panel.id}`)).toBeTruthy();
  }
  expect(screen.getAllByTestId(/^value-carousel-dot-/)).toHaveLength(TEST_PANELS.length);
});

test("renders the four shipped value panels by default", () => {
  render(<ValueCarousel />);

  expect(screen.getAllByTestId(/^value-carousel-dot-/)).toHaveLength(VALUE_PANELS.length);
  for (const panel of VALUE_PANELS) {
    expect(screen.getByText(panel.label)).toBeTruthy();
    expect(screen.getByText(panel.brief)).toBeTruthy();
  }
});

import { render, screen } from "@testing-library/react-native";

import { MiniBars } from "../mini_bars";

function heightOf(testID: string): number {
  const style = screen.getByTestId(testID).props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  return flat.height as number;
}

test("the tallest value fills the track and the others scale against it", () => {
  render(<MiniBars testID="b" values={[10, 20, 40]} barClassName="bg-on-brand/40" labelClassName="text-on-brand/70" />);
  expect(heightOf("b-bar-2")).toBeGreaterThan(heightOf("b-bar-1"));
  expect(heightOf("b-bar-1")).toBeGreaterThan(heightOf("b-bar-0"));
});

test("all-zero values render visible stubs, not an invisible row", () => {
  render(<MiniBars testID="b" values={[0, 0, 0]} barClassName="bg-on-brand/40" labelClassName="text-on-brand/70" />);
  for (const index of [0, 1, 2]) {
    expect(heightOf(`b-bar-${index}`)).toBeGreaterThan(0);
  }
});

test("a single value does not divide by zero", () => {
  render(<MiniBars testID="b" values={[7]} barClassName="bg-on-brand/40" labelClassName="text-on-brand/70" />);
  expect(heightOf("b-bar-0")).toBeGreaterThan(0);
});

test("end labels render when given, in the ink the caller chose", () => {
  render(<MiniBars testID="b" values={[1, 2]} barClassName="bg-fg/30" labelClassName="text-fg/70" startLabel="Mon" endLabel="Sun" />);
  screen.getByText("Mon");
  screen.getByText("Sun");
  expect(String(screen.getByText("Mon").props.className)).toContain("text-fg/70");
});

test("the chart is one accessible summary, not seven unlabelled views", () => {
  render(<MiniBars testID="b" values={[1, 2]} barClassName="bg-on-brand/40" labelClassName="text-on-brand/70" startLabel="Mon" endLabel="Sun" />);
  expect(screen.getByTestId("b").props.accessibilityLabel).toContain("Mon");
});

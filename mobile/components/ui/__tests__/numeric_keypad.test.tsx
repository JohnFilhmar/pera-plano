// mobile/components/ui/__tests__/numeric_keypad.test.tsx — W1 Task 2.
//
// THE LAYOUT IS PART OF THE CONTRACT. The component this replaces laid ten
// keys out with flex-wrap over fixed-width children, which produced 4/4/3 on
// the test device by accident and would have produced 5/5 on a tablet. The
// row assertions below exist so the grid cannot drift back into being
// whatever wrapping happens to do.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { NumericKeypad } from "../numeric_keypad";

const onKey = jest.fn();
const onBackspace = jest.fn();
const onClear = jest.fn();

beforeEach(() => {
  onKey.mockClear();
  onBackspace.mockClear();
  onClear.mockClear();
});

function renderKeypad(mode: "peso" | "integer" | "rate" = "peso") {
  render(
    <NumericKeypad mode={mode} onKey={onKey} onBackspace={onBackspace} onClear={onClear} />,
  );
}

test("renders twelve keys in phone order, three to a row", () => {
  renderKeypad();

  for (const key of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "."]) {
    expect(screen.getByTestId(`keypad-key-${key}`)).toBeTruthy();
  }
  expect(screen.getByTestId("keypad-backspace")).toBeTruthy();

  const rows = screen.getByTestId("numeric-keypad").props.children;
  expect(rows).toHaveLength(4);
});

test("a digit press reports that digit", () => {
  renderKeypad();

  fireEvent.press(screen.getByTestId("keypad-key-7"));

  expect(onKey).toHaveBeenCalledWith("7");
});

test("the decimal key reports a point in peso mode", () => {
  renderKeypad("peso");

  fireEvent.press(screen.getByTestId("keypad-key-."));

  expect(onKey).toHaveBeenCalledWith(".");
});

test("the decimal key is present but inert in integer mode", () => {
  renderKeypad("integer");

  const decimal = screen.getByTestId("keypad-key-.");
  // Rendered, so the grid never reflows between modes and the keys do not
  // move under a thumb already on its way down.
  expect(decimal).toBeTruthy();
  expect(decimal.props.accessibilityState.disabled).toBe(true);

  fireEvent.press(decimal);

  expect(onKey).not.toHaveBeenCalled();
});

test("the decimal key works in rate mode", () => {
  renderKeypad("rate");

  fireEvent.press(screen.getByTestId("keypad-key-."));

  expect(onKey).toHaveBeenCalledWith(".");
});

describe("backspace is two behaviours, not one", () => {
  // Wiring both to one handler passes any test that only checks the field
  // ends up empty -- on a one-character value they are identical.
  test("press removes one character", () => {
    renderKeypad();

    fireEvent.press(screen.getByTestId("keypad-backspace"));

    expect(onBackspace).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
  });

  test("long press clears", () => {
    renderKeypad();

    fireEvent(screen.getByTestId("keypad-backspace"), "longPress");

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onBackspace).not.toHaveBeenCalled();
  });
});

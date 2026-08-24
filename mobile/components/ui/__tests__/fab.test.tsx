import { fireEvent, render, screen } from "@testing-library/react-native";

import { Fab } from "../fab";

test("pressing the fab calls onPress", () => {
  const onPress = jest.fn();
  render(<Fab testID="f" onPress={onPress} accessibilityLabel="Add a transaction" />);
  fireEvent.press(screen.getByTestId("f"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("the fab is labelled — an unlabelled icon button is unusable with a screen reader", () => {
  render(<Fab testID="f" onPress={() => {}} accessibilityLabel="Add a transaction" />);
  expect(screen.getByTestId("f").props.accessibilityLabel).toBe("Add a transaction");
  expect(screen.getByTestId("f").props.accessibilityRole).toBe("button");
});

test("the fab clears the 56dp Material touch target", () => {
  render(<Fab testID="f" onPress={() => {}} accessibilityLabel="Add" />);
  const style = screen.getByTestId("f").props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  expect(flat.width).toBeGreaterThanOrEqual(56);
});

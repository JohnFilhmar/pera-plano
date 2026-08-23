import { fireEvent, render, screen } from "@testing-library/react-native";

import { ErrorState } from "../error_state";

test("an error names what failed and what to do about it", () => {
  render(
    <ErrorState
      testID="e"
      title="Couldn't read that notification"
      body="BPI changed their alert format. Add it manually and we'll learn the new shape."
      retryLabel="Add manually"
      onRetry={() => {}}
    />,
  );
  screen.getByText("Couldn't read that notification");
  screen.getByText("Add manually");
});

test("an error with no action renders no button rather than a dead one", () => {
  render(<ErrorState testID="e" title="Something went wrong" body="Try again in a moment." />);
  expect(screen.queryByTestId("e-retry")).toBeNull();
});

test("the retry action fires", () => {
  const onRetry = jest.fn();
  render(<ErrorState testID="e" title="x" body="y" retryLabel="Retry" onRetry={onRetry} />);
  fireEvent.press(screen.getByTestId("e-retry"));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test("an error is danger-toned, not the empty state's inviting mint", () => {
  render(<ErrorState testID="e" title="x" body="y" />);
  expect(String(screen.getByTestId("e-icon").props.className)).toContain("danger");
});

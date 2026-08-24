import { fireEvent, render, screen } from "@testing-library/react-native";
import { TriangleAlert } from "lucide-react-native";

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
  // `TriangleAlert` itself is a stable, importable reference — but
  // NativeWind's cssInterop wrapper consumes `className` before it ever
  // reaches that inner element (confirmed by inspecting the rendered tree:
  // the wrapper receives `{ size, className }`, the real `TriangleAlert`
  // underneath it receives only `{ ref, size }`). The className this test
  // needs to see therefore lives one level up, on that wrapper — reached by
  // walking up from `TriangleAlert` via `.parent` rather than by hardcoding
  // NativeWind's internal wrapper name, which is an implementation detail.
  // This still reads the real prop on the node that actually produces the
  // icon's colour, not a decorative stand-in that could drift from it.
  const icon = screen.UNSAFE_getByType(TriangleAlert);
  expect(String(icon.parent?.props.className)).toContain("danger");
});

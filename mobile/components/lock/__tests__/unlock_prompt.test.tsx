import { fireEvent, render, screen } from "@testing-library/react-native";
import { UnlockPrompt } from "../unlock_prompt";

test("shows an Unlock action and invokes onUnlock when pressed", () => {
  const onUnlock = jest.fn();
  render(<UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={onUnlock} />);

  fireEvent.press(screen.getByTestId("unlock-button"));
  expect(onUnlock).toHaveBeenCalledTimes(1);
});

test("disables the Unlock action while authenticating -- a tap mid-prompt cannot fire a second attempt", () => {
  const onUnlock = jest.fn();
  render(<UnlockPrompt isAuthenticating={true} errorMessage={null} onUnlock={onUnlock} />);

  fireEvent.press(screen.getByTestId("unlock-button"));
  expect(onUnlock).not.toHaveBeenCalled();
});

test("renders no error text when there is none", () => {
  render(<UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={jest.fn()} />);
  expect(screen.queryByTestId("unlock-error")).toBeNull();
});

test("surfaces the given error message verbatim", () => {
  render(
    <UnlockPrompt
      isAuthenticating={false}
      errorMessage="Please authenticate again to continue."
      onUnlock={jest.fn()}
    />,
  );
  expect(screen.getByTestId("unlock-error")).toBeTruthy();
  expect(screen.getByText("Please authenticate again to continue.")).toBeTruthy();
});

test("never renders any amount, balance, or transaction data -- this screen exists before the app is unlocked", () => {
  render(<UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={jest.fn()} />);
  const tree = JSON.stringify(screen.toJSON());
  expect(tree).not.toContain("₱");
});

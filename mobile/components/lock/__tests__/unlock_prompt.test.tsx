import { fireEvent, render, screen } from "@testing-library/react-native";
import { StrictMode } from "react";
import { UnlockPrompt } from "../unlock_prompt";

test("shows an Unlock action and invokes onUnlock when pressed", () => {
  const onUnlock = jest.fn();
  render(<UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={onUnlock} />);
  // Isolate the button press from the mount-time auto-fire (task-6-brief.md)
  // -- covered on its own below.
  onUnlock.mockClear();

  fireEvent.press(screen.getByTestId("unlock-button"));
  expect(onUnlock).toHaveBeenCalledTimes(1);
});

test("disables the Unlock action while authenticating -- a tap mid-prompt cannot fire a second attempt", () => {
  const onUnlock = jest.fn();
  render(<UnlockPrompt isAuthenticating={true} errorMessage={null} onUnlock={onUnlock} />);
  // Isolate the button press from the mount-time auto-fire (task-6-brief.md).
  onUnlock.mockClear();

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

// Design F1 sweep: this button relied on px-6/py-3 padding plus its Text's
// (unstyled) height alone to reach 44pt, with no explicit guarantee.
// `min-h-[44px]` removes that ambiguity directly.
test("guarantees a 44pt minimum touch target directly, rather than trusting padding and text height alone", () => {
  render(<UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={jest.fn()} />);
  expect(String(screen.getByTestId("unlock-button").props.className)).toContain("min-h-[44px]");
});

// ---------------------------------------------------------------------------
// task-6-brief.md: auto-fire the system prompt exactly once, on first mount
// -- never on re-render, never again after a cancellation or an error. Every
// test below counts real invocations of `onUnlock` (the callback a user's
// fingerprint or a system prompt actually triggers), not internal state, so a
// regression that fires twice or never fires at all fails loudly here rather
// than passing on an implementation detail.
// ---------------------------------------------------------------------------

test("fires the system prompt once on mount", () => {
  const onUnlock = jest.fn();
  render(<UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={onUnlock} />);

  expect(onUnlock).toHaveBeenCalledTimes(1);
});

test("does not re-fire on re-render", () => {
  const onUnlock = jest.fn();
  const { rerender } = render(
    <UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={onUnlock} />,
  );
  expect(onUnlock).toHaveBeenCalledTimes(1);

  // A plain re-render with identical props -- e.g. a parent re-rendering for a
  // reason that has nothing to do with the lock state.
  rerender(<UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={onUnlock} />);
  expect(onUnlock).toHaveBeenCalledTimes(1);

  // And authenticating -> not authenticating, the shape of a real attempt in
  // flight and then resolving, still the same mounted instance.
  rerender(<UnlockPrompt isAuthenticating={true} errorMessage={null} onUnlock={onUnlock} />);
  rerender(<UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={onUnlock} />);
  expect(onUnlock).toHaveBeenCalledTimes(1);
});

test("does not re-fire after a cancelled prompt", () => {
  const onUnlock = jest.fn();
  const { rerender } = render(
    <UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={onUnlock} />,
  );
  expect(onUnlock).toHaveBeenCalledTimes(1);

  // contexts/lock_context.tsx's response to a cancelled or failed prompt:
  // status goes back to "locked" and a benign error message is set -- app/
  // lock.tsx renders this SAME UnlockPrompt element for both "locked" and
  // "authenticating", so this is a re-render, never a remount.
  rerender(
    <UnlockPrompt
      isAuthenticating={false}
      errorMessage="Authentication wasn't completed. Try again."
      onUnlock={onUnlock}
    />,
  );
  expect(onUnlock).toHaveBeenCalledTimes(1);

  // A second failure, same story: still no automatic retry.
  rerender(
    <UnlockPrompt
      isAuthenticating={false}
      errorMessage="Please authenticate again to continue."
      onUnlock={onUnlock}
    />,
  );
  expect(onUnlock).toHaveBeenCalledTimes(1);
});

test("leaves the manual unlock button usable after a failure", () => {
  const onUnlock = jest.fn();
  const { rerender } = render(
    <UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={onUnlock} />,
  );
  rerender(
    <UnlockPrompt
      isAuthenticating={false}
      errorMessage="Authentication wasn't completed. Try again."
      onUnlock={onUnlock}
    />,
  );
  // Isolate the manual tap below from the auto-fire on mount above.
  onUnlock.mockClear();

  const button = screen.getByTestId("unlock-button");
  expect(button.props.accessibilityState?.disabled).toBe(false);

  fireEvent.press(button);
  expect(onUnlock).toHaveBeenCalledTimes(1);
});

test("still fires only once under StrictMode's mount -> cleanup -> mount replay", () => {
  // The exact threat task-6-brief.md names: a mount-once guard implemented
  // with state instead of a ref, or one that resets on cleanup, fires TWICE
  // here even though production never remounts this component between
  // attempts (see the "does not re-fire after a cancelled prompt" case above).
  const onUnlock = jest.fn();
  render(
    <StrictMode>
      <UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={onUnlock} />
    </StrictMode>,
  );

  expect(onUnlock).toHaveBeenCalledTimes(1);
});

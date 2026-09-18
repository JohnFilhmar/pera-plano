// components/lock/__tests__/storage_error_screen.test.tsx —
// docs/12-encryption-and-app-lock.md §11a; GAP-034. The screen a user reaches
// when getKeyState() rejected, so the app cannot tell whether this device has
// keys at all.
//
// WHAT THESE TESTS ARE REALLY PINNING: that the non-destructive route is the
// one the user meets first, and that the destructive one still costs two
// deliberate taps. This is the second screen in the app that can delete a
// whole ledger, and the first one (recovery_unlock_form.test.tsx) pins the
// same double confirmation against the shared component underneath both.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StorageErrorScreen } from "../storage_error_screen";

function renderScreen(
  overrides: Partial<{
    errorMessage: string | null;
    onRetry: () => void | Promise<void>;
    onWipe: () => void | Promise<void>;
  }> = {},
) {
  const props = {
    errorMessage: null as string | null,
    onRetry: jest.fn(),
    onWipe: jest.fn(),
    ...overrides,
  };
  render(<StorageErrorScreen {...props} />);
  return props;
}

test("offers the retry immediately and keeps the wipe folded away behind a link", () => {
  renderScreen();

  expect(screen.getByTestId("storage-error-retry-button")).toBeTruthy();
  expect(screen.getByTestId("storage-error-wipe-link")).toBeTruthy();
  expect(screen.queryByTestId("wipe-confirm-1")).toBeNull();
  expect(screen.queryByTestId("wipe-confirm-2")).toBeNull();
});

test("the retry runs the key-state read again", async () => {
  const { onRetry } = renderScreen();

  // Awaited inside act because the handler clears its own pending flag after
  // onRetry settles, which is a state update the press itself does not cover.
  await act(async () => {
    fireEvent.press(screen.getByTestId("storage-error-retry-button"));
  });

  expect(onRetry).toHaveBeenCalledTimes(1);
});

test("a retry already in flight cannot be fired a second time by an impatient tap", async () => {
  let release!: () => void;
  const onRetry = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  renderScreen({ onRetry });

  fireEvent.press(screen.getByTestId("storage-error-retry-button"));
  fireEvent.press(screen.getByTestId("storage-error-retry-button"));
  expect(onRetry).toHaveBeenCalledTimes(1);

  await act(async () => {
    release();
    await Promise.resolve();
  });

  await act(async () => {
    fireEvent.press(screen.getByTestId("storage-error-retry-button"));
  });
  expect(onRetry).toHaveBeenCalledTimes(2);

  // The second call parked too; settle it so nothing updates state after this
  // test's component is torn down.
  await act(async () => {
    release();
    await Promise.resolve();
  });
});

test("shows a failed retry's message", () => {
  renderScreen({ errorMessage: "Still no answer from secure storage. Try restarting your phone." });

  expect(screen.getByTestId("storage-error-message")).toHaveTextContent(/Still no answer/);
});

test("shows no message line on arrival, when the screen's own explanation is all there is to say", () => {
  renderScreen({ errorMessage: null });

  expect(screen.queryByTestId("storage-error-message")).toBeNull();
});

// The double confirmation, against THIS screen's copy rather than the
// recovery form's: a single mis-tap on the control that deletes every
// transaction on the device must never be irreversible.
test("the first confirmation destroys nothing on its own", () => {
  const { onWipe } = renderScreen();

  fireEvent.press(screen.getByTestId("storage-error-wipe-link"));

  expect(screen.getByTestId("wipe-confirm-1")).toBeTruthy();
  expect(screen.queryByTestId("wipe-confirm-2")).toBeNull();
  expect(onWipe).not.toHaveBeenCalled();
});

test("the second confirmation destroys nothing until its own button is pressed", () => {
  const { onWipe } = renderScreen();

  fireEvent.press(screen.getByTestId("storage-error-wipe-link"));
  fireEvent.press(screen.getByTestId("wipe-confirm-1-continue"));

  expect(screen.getByTestId("wipe-confirm-2")).toBeTruthy();
  expect(onWipe).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId("wipe-confirm-2-continue"));
  expect(onWipe).toHaveBeenCalledTimes(1);
});

test("cancelling either step folds the whole thing back to a link and wipes nothing", () => {
  const { onWipe } = renderScreen();

  fireEvent.press(screen.getByTestId("storage-error-wipe-link"));
  fireEvent.press(screen.getByTestId("wipe-confirm-1-cancel"));
  expect(screen.getByTestId("storage-error-wipe-link")).toBeTruthy();

  fireEvent.press(screen.getByTestId("storage-error-wipe-link"));
  fireEvent.press(screen.getByTestId("wipe-confirm-1-continue"));
  fireEvent.press(screen.getByTestId("wipe-confirm-2-cancel"));
  expect(screen.getByTestId("storage-error-wipe-link")).toBeTruthy();

  expect(onWipe).not.toHaveBeenCalled();
});

// The recovery phrase is a dead route on this failure: key_manager reads
// recoveryWrap and recoverySalt out of the same SecureStore that just threw.
// Nothing on this screen may invite the user to fetch their paper copy.
test("never offers a recovery-phrase field", () => {
  renderScreen();

  expect(screen.queryByTestId("recovery-phrase-input")).toBeNull();
  expect(screen.queryByTestId("recovery-submit-button")).toBeNull();
  expect(screen.queryByTestId("forgot-phrase-link")).toBeNull();
});

// components/lock/__tests__/recovery_unlock_form.test.tsx —
// docs/12-encryption-and-app-lock.md §5, §11a; task-9-brief.md rules 3 & 7.
// generatePhrase() is the REAL implementation (fast — Argon2id only runs in
// deriveRecoveryKey, which this component never calls directly), used here
// purely as a fixture generator for a phrase that genuinely passes
// validatePhrase's BIP-39 membership + checksum check.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { generatePhrase } from "@/lib/crypto/recovery_phrase";
import { RecoveryUnlockForm } from "../recovery_unlock_form";

async function validPhraseText(): Promise<{ words: string[]; text: string }> {
  const words = await generatePhrase();
  return { words, text: words.join(" ") };
}

function renderForm(overrides: Partial<Parameters<typeof RecoveryUnlockForm>[0]> = {}) {
  const onSubmitPhrase = jest.fn();
  const onWipe = jest.fn();
  render(
    <RecoveryUnlockForm
      errorMessage={null}
      onSubmitPhrase={onSubmitPhrase}
      onWipe={onWipe}
      {...overrides}
    />,
  );
  return { onSubmitPhrase, onWipe };
}

test("explains in plain language why the user is being asked, not a bare instruction", () => {
  renderForm();
  // Not a literal string pin (copy can be refined) -- but it must actually
  // name the cause, not just say "enter your recovery phrase".
  const tree = JSON.stringify(screen.toJSON());
  expect(tree.toLowerCase()).toMatch(/screen lock/);
});

test("a well-formed, checksum-valid phrase calls onSubmitPhrase with the normalized words", async () => {
  const { text, words } = await validPhraseText();
  const { onSubmitPhrase } = renderForm();

  fireEvent.changeText(screen.getByTestId("recovery-phrase-input"), text.toUpperCase());
  await act(async () => {
    fireEvent.press(screen.getByTestId("recovery-submit-button"));
  });

  expect(onSubmitPhrase).toHaveBeenCalledTimes(1);
  expect(onSubmitPhrase).toHaveBeenCalledWith(words);
});

test("a gibberish phrase is rejected locally -- never reaches the slow Argon2id path via onSubmitPhrase", async () => {
  const { onSubmitPhrase } = renderForm();

  fireEvent.changeText(
    screen.getByTestId("recovery-phrase-input"),
    "not real words at all here nope nope nope nope nope",
  );
  await act(async () => {
    fireEvent.press(screen.getByTestId("recovery-submit-button"));
  });

  expect(onSubmitPhrase).not.toHaveBeenCalled();
  expect(screen.getByTestId("recovery-validation-error")).toBeTruthy();
});

test("an empty submit is rejected locally without calling onSubmitPhrase", async () => {
  const { onSubmitPhrase } = renderForm();

  await act(async () => {
    fireEvent.press(screen.getByTestId("recovery-submit-button"));
  });

  expect(onSubmitPhrase).not.toHaveBeenCalled();
});

test("surfaces an externally-supplied error message (e.g. from a failed rewrap) verbatim", () => {
  renderForm({ errorMessage: "That recovery phrase doesn't match. Check the words and try again." });
  expect(
    screen.getByText("That recovery phrase doesn't match. Check the words and try again."),
  ).toBeTruthy();
});

// Accessibility sweep (branch-review-design.md F5's gap, found again here):
// this Pressable carried neither an accessibilityRole nor a label at all —
// TalkBack could still reach it (RN marks any onPress handler focusable
// regardless of role) but never announced it as actionable.
test("the forgot-phrase link is announced to TalkBack as a button with a spoken label, not a silent wrapper", () => {
  renderForm();

  const link = screen.getByTestId("forgot-phrase-link");
  expect(link.props.accessibilityRole).toBe("button");
  expect(link.props.accessibilityLabel).toBe("Forgot your recovery words?");
});

describe("wipe and start over -- the §11a escape hatch", () => {
  test("the wipe affordance is not a destructive action by itself -- it only reveals the first confirmation", () => {
    const { onWipe } = renderForm();
    fireEvent.press(screen.getByTestId("forgot-phrase-link"));
    expect(onWipe).not.toHaveBeenCalled();
    expect(screen.getByTestId("wipe-confirm-1")).toBeTruthy();
  });

  test("ONE confirmation alone destroys nothing", () => {
    const { onWipe } = renderForm();
    fireEvent.press(screen.getByTestId("forgot-phrase-link"));
    fireEvent.press(screen.getByTestId("wipe-confirm-1-continue"));

    expect(onWipe).not.toHaveBeenCalled();
    expect(screen.getByTestId("wipe-confirm-2")).toBeTruthy();
  });

  test("only the SECOND confirmation actually invokes the wipe", async () => {
    const { onWipe } = renderForm();
    fireEvent.press(screen.getByTestId("forgot-phrase-link"));
    fireEvent.press(screen.getByTestId("wipe-confirm-1-continue"));

    await act(async () => {
      fireEvent.press(screen.getByTestId("wipe-confirm-2-continue"));
    });

    expect(onWipe).toHaveBeenCalledTimes(1);
  });

  test("the confirmation copy says plainly that the data cannot be recovered", () => {
    renderForm();
    fireEvent.press(screen.getByTestId("forgot-phrase-link"));
    fireEvent.press(screen.getByTestId("wipe-confirm-1-continue"));

    const tree = JSON.stringify(screen.toJSON()).toLowerCase();
    expect(tree).toMatch(/cannot be recovered|permanently/);
  });

  test("cancelling the first confirmation returns to the hidden state without invoking onWipe", () => {
    const { onWipe } = renderForm();
    fireEvent.press(screen.getByTestId("forgot-phrase-link"));
    fireEvent.press(screen.getByTestId("wipe-confirm-1-cancel"));

    expect(onWipe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("wipe-confirm-1")).toBeNull();
    expect(screen.getByTestId("forgot-phrase-link")).toBeTruthy();
  });

  test("cancelling the second confirmation returns to hidden without invoking onWipe", () => {
    const { onWipe } = renderForm();
    fireEvent.press(screen.getByTestId("forgot-phrase-link"));
    fireEvent.press(screen.getByTestId("wipe-confirm-1-continue"));
    fireEvent.press(screen.getByTestId("wipe-confirm-2-cancel"));

    expect(onWipe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("wipe-confirm-2")).toBeNull();
  });
});

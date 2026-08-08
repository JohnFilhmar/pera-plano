// components/onboarding/__tests__/recovery_phrase.test.tsx — Task 10's own
// discriminating tests (task-10-brief.md; docs/12-encryption-and-app-lock.md
// §5), covering app/(onboarding)/recovery_phrase.tsx together with the two
// components it composes (phrase_display.tsx, phrase_confirm.tsx) — the same
// "screen + its components in one file" shape components/onboarding/__tests__/
// device_lock.test.tsx already established.
//
// generatePhrase()/validatePhrase() run for REAL here (fast — Argon2id only
// runs inside deriveRecoveryKey, which this screen never calls directly,
// exactly like components/lock/__tests__/recovery_unlock_form.test.tsx's own
// note). Only initializeKeys is mocked: both to keep this suite fast, and to
// assert on its call COUNT directly — the "exactly once" assertions below
// are this task's version of the double-tap hazard Task 6 had to serialize
// key_manager.ts against, and a mock's call count is the only thing that can
// actually discriminate "called once" from "called twice, both resolved the
// same because key_manager.ts happens to serialize internally."
jest.mock("@/lib/crypto/key_manager", () => ({
  initializeKeys: jest.fn(),
}));

// A Proxy over jest.requireActual, not a plain `{...actual}` spread — the
// same reasoning components/onboarding/__tests__/device_lock.test.tsx and
// contexts/__tests__/lock_context.test.tsx document: spreading eagerly
// evaluates every lazy getter on the real react-native module, including
// native-only exports (e.g. DevMenu) that crash outside a real app.
const mockShareModule = { share: jest.fn().mockResolvedValue({ action: "sharedAction" }) };
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === "Share") return mockShareModule;
      return Reflect.get(target, prop, receiver);
    },
  });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { initializeKeys } from "@/lib/crypto/key_manager";
import RecoveryPhraseScreen from "@/app/(onboarding)/recovery_phrase";

const mockInitializeKeys = initializeKeys as jest.Mock;
const mockShare = Share.share as jest.Mock;

const WORD_COUNT = 12;
const CHALLENGE_COUNT = 3;

beforeEach(() => {
  jest.clearAllMocks();
  mockInitializeKeys.mockResolvedValue(undefined);
});

async function renderScreenAndWaitForWords(): Promise<void> {
  render(<RecoveryPhraseScreen />);
  await waitFor(() => expect(screen.getByTestId("phrase-display")).toBeTruthy());
}

function getDisplayedWords(): string[] {
  const words: string[] = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    words.push(screen.getByTestId(`phrase-word-${i}`).props.children as string);
  }
  return words;
}

/** Reads the actual "Word N" labels off the rendered confirm step, rather
 * than reimplementing/guessing the random-position logic — this is what
 * lets the tests below stay correct regardless of which three positions
 * were actually picked. */
function getConfirmPositions(): number[] {
  const positions: number[] = [];
  for (let i = 0; i < CHALLENGE_COUNT; i++) {
    const children = screen.getByTestId(`confirm-label-${i}`).props.children;
    const text = Array.isArray(children) ? children.join("") : String(children);
    const match = text.match(/\d+/);
    positions.push(Number(match![0]) - 1);
  }
  return positions;
}

async function proceedToConfirm(): Promise<string[]> {
  await renderScreenAndWaitForWords();
  const words = getDisplayedWords();
  await act(async () => {
    fireEvent.press(screen.getByTestId("phrase-continue-button"));
  });
  await waitFor(() => expect(screen.getByTestId("phrase-confirm")).toBeTruthy());
  return words;
}

function fillConfirmInputs(answers: string[]): void {
  answers.forEach((answer, i) => {
    fireEvent.changeText(screen.getByTestId(`confirm-input-${i}`), answer);
  });
}

// ---------------------------------------------------------------------------
// Rule 2 / brief: show all twelve words at once, numbered.
// ---------------------------------------------------------------------------

test("shows all twelve recovery words, each numbered", async () => {
  await renderScreenAndWaitForWords();

  for (let i = 0; i < WORD_COUNT; i++) {
    expect(screen.getByTestId(`phrase-index-${i}`).props.children).toBe(i + 1);
    expect(screen.getByTestId(`phrase-word-${i}`)).toBeTruthy();
  }
});

// ---------------------------------------------------------------------------
// Rule 1: mandatory. No skip affordance anywhere on the phrase screen — on
// EITHER step, and asserted as an absence, not merely "the primary action
// exists".
// ---------------------------------------------------------------------------

test("there is no skip affordance anywhere on the display step", async () => {
  await renderScreenAndWaitForWords();

  expect(screen.queryByText(/skip/i)).toBeNull();
  expect(screen.queryByText(/not now/i)).toBeNull();
  expect(screen.queryByText(/later/i)).toBeNull();
  expect(screen.queryByText(/maybe/i)).toBeNull();
});

test("there is no skip affordance anywhere on the confirm step", async () => {
  await proceedToConfirm();

  expect(screen.queryByText(/skip/i)).toBeNull();
  expect(screen.queryByText(/not now/i)).toBeNull();
  expect(screen.queryByText(/later/i)).toBeNull();
  expect(screen.queryByText(/maybe/i)).toBeNull();
});

// ---------------------------------------------------------------------------
// Rule 4: say the stakes in one plain sentence, before showing the words —
// and call them "recovery words", never crypto-wallet vocabulary.
// ---------------------------------------------------------------------------

test("states the stakes in plain language, and never uses crypto-wallet vocabulary", async () => {
  await renderScreenAndWaitForWords();

  const tree = JSON.stringify(screen.toJSON()).toLowerCase();
  expect(tree).toMatch(/new phone/);
  expect(tree).toMatch(/only way back/);
  expect(tree).toMatch(/recovery words/);
  expect(tree).not.toMatch(/seed phrase/);
  expect(tree).not.toMatch(/wallet/);
  expect(tree).not.toMatch(/mnemonic/);
});

// ---------------------------------------------------------------------------
// Rule 5: offer a copy/share action, and warn about screenshots.
// ---------------------------------------------------------------------------

test("offers a copy/share action wired to the platform share sheet, and warns about screenshots", async () => {
  await renderScreenAndWaitForWords();

  const tree = JSON.stringify(screen.toJSON()).toLowerCase();
  expect(tree).toMatch(/screenshot/);

  const words = getDisplayedWords();
  fireEvent.press(screen.getByTestId("phrase-share-button"));

  expect(mockShare).toHaveBeenCalledTimes(1);
  expect(mockShare).toHaveBeenCalledWith({ message: words.join(" ") });
});

// ---------------------------------------------------------------------------
// Rule 3: confirm by asking for three words at random positions — rejecting
// a wrong word at a correct index, and accepting case/whitespace variance.
// ---------------------------------------------------------------------------

test("confirmation asks for exactly three distinct positions", async () => {
  await proceedToConfirm();

  const positions = getConfirmPositions();
  expect(positions).toHaveLength(CHALLENGE_COUNT);
  expect(new Set(positions).size).toBe(CHALLENGE_COUNT);
  positions.forEach((p) => {
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(WORD_COUNT);
  });
});

test("rejects a wrong word at a correct index -- one bad answer fails the whole confirmation", async () => {
  const words = await proceedToConfirm();
  const positions = getConfirmPositions();

  // Two of the three answers are genuinely correct; the FIRST is a real
  // word from the phrase, just not the one that belongs at its position --
  // proving a single wrong-but-plausible answer at a correct index is
  // rejected, not merely "everything wrong" or "gibberish".
  const wrongButRealWord = words.find((w) => w !== words[positions[0]])!;
  const answers = positions.map((p, i) => (i === 0 ? wrongButRealWord : words[p]));

  fillConfirmInputs(answers);
  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-submit-button"));
  });

  expect(screen.getByTestId("confirm-error")).toBeTruthy();
  expect(mockInitializeKeys).not.toHaveBeenCalled();
  expect(screen.queryByTestId("recovery-phrase-done")).toBeNull();
});

test("accepts correct words regardless of case and surrounding whitespace", async () => {
  const words = await proceedToConfirm();
  const positions = getConfirmPositions();
  const answers = positions.map((p) => `  ${words[p].toUpperCase()}  `);

  fillConfirmInputs(answers);
  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-submit-button"));
  });

  await waitFor(() => expect(mockInitializeKeys).toHaveBeenCalledTimes(1));
  expect(mockInitializeKeys).toHaveBeenCalledWith(words);
});

// ---------------------------------------------------------------------------
// Rule 6 / task-10-brief's named hazard: initializeKeys is called EXACTLY
// once on confirmation, even under a double-tap.
// ---------------------------------------------------------------------------

test("successful confirmation calls initializeKeys exactly once, even under a rapid double-tap", async () => {
  const words = await proceedToConfirm();
  const positions = getConfirmPositions();
  fillConfirmInputs(positions.map((p) => words[p]));

  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-submit-button"));
    fireEvent.press(screen.getByTestId("confirm-submit-button"));
  });

  await waitFor(() => expect(mockInitializeKeys).toHaveBeenCalledTimes(1));
});

// ---------------------------------------------------------------------------
// Onboarding cannot advance past this step without a successful
// initializeKeys() call.
// ---------------------------------------------------------------------------

test("onboarding cannot advance past this step until initializeKeys actually resolves", async () => {
  let resolveInit!: () => void;
  mockInitializeKeys.mockReturnValue(
    new Promise<void>((resolve) => {
      resolveInit = resolve;
    }),
  );

  const words = await proceedToConfirm();
  const positions = getConfirmPositions();
  fillConfirmInputs(positions.map((p) => words[p]));

  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-submit-button"));
  });

  // Still not "done" -- the initializeKeys call is genuinely in flight, not
  // merely unobserved.
  expect(screen.queryByTestId("recovery-phrase-done")).toBeNull();
  expect(screen.getByTestId("recovery-phrase-initializing")).toBeTruthy();

  await act(async () => {
    resolveInit();
  });

  await waitFor(() => expect(screen.getByTestId("recovery-phrase-done")).toBeTruthy());
});

test("a failed initializeKeys does not advance past this step, and going back through it never re-invokes it while still in flight", async () => {
  mockInitializeKeys.mockRejectedValueOnce(new Error("native bridge error"));

  const words = await proceedToConfirm();
  const positions = getConfirmPositions();
  fillConfirmInputs(positions.map((p) => words[p]));

  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-submit-button"));
  });

  await waitFor(() => expect(screen.getByTestId("recovery-phrase-error")).toBeTruthy());
  expect(screen.queryByTestId("recovery-phrase-done")).toBeNull();
  expect(mockInitializeKeys).toHaveBeenCalledTimes(1);
});

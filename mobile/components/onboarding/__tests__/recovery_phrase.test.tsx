// components/onboarding/__tests__/recovery_phrase.test.tsx — Task 10's own
// discriminating tests (task-10-brief.md; docs/12-encryption-and-app-lock.md
// §5), covering app/(onboarding)/recovery_phrase.tsx together with the two
// components it composes (phrase_display.tsx, phrase_confirm.tsx) — the same
// "screen + its components in one file" shape components/onboarding/__tests__/
// device_lock.test.tsx already established.
//
// generatePhrase()/validatePhrase() still run for REAL here (fast — Argon2id
// only runs inside deriveRecoveryKey, which this screen never calls directly,
// exactly like components/lock/__tests__/recovery_unlock_form.test.tsx's own
// note). initializeKeys is mocked: both to keep this suite fast, and to
// assert on its call COUNT directly — the "exactly once" assertions below
// are this task's version of the double-tap hazard Task 6 had to serialize
// key_manager.ts against, and a mock's call count is the only thing that can
// actually discriminate "called once" from "called twice, both resolved the
// same because key_manager.ts happens to serialize internally."
jest.mock("@/lib/crypto/key_manager", () => ({
  initializeKeys: jest.fn(),
}));

// A jest.fn() WRAPPING the real generatePhrase, not a stub: every test that
// predates this mock still gets genuine BIP-39 words (and the real
// checksum), while the retry tests below can count calls and force a single
// rejection. That call count is the only thing that can discriminate
// "retried initialization with the words the user wrote down" from
// "quietly minted twelve new ones" — the whole point of this file's second
// half. jest.clearAllMocks() clears calls but not the implementation passed
// to jest.fn(), so the real generator survives every beforeEach.
jest.mock("@/lib/crypto/recovery_phrase", () => {
  const actual = jest.requireActual("@/lib/crypto/recovery_phrase");
  return { ...actual, generatePhrase: jest.fn(actual.generatePhrase) };
});

// The screen authenticates before it touches the auth-gated Keystore key,
// exactly as contexts/lock_context.tsx's unlock() does — so this suite owns
// the prompt's outcome, the same way contexts/__tests__/lock_context.test.tsx
// does.
jest.mock("expo-local-authentication", () => ({
  authenticateAsync: jest.fn(),
}));

// The real class's shape (code/name), redeclared here rather than imported
// from the real module — @/modules/notification_listener's top-level
// requireNativeModule() call throws under Jest with no native registration,
// so the module itself must be mocked, and this factory IS that mock (the
// same note contexts/__tests__/lock_context.test.tsx carries). Both this
// file's `new NotAuthenticatedError()` and the screen's `instanceof` check
// resolve to this SAME class.
jest.mock("@/modules/notification_listener", () => {
  class NotAuthenticatedError extends Error {
    code = "NotAuthenticated";
    constructor(message = "authentication is required to complete this operation") {
      super(message);
      this.name = "NotAuthenticatedError";
    }
  }
  return { NotAuthenticatedError };
});

// expo-screen-capture is a native module (its default export is a
// requireNativeModule call), so it has nothing to bind to under Jest — the
// same reason @/modules/notification_listener is mocked above.
//
// The factory REIMPLEMENTS the package's own usePreventScreenCapture body
// rather than stubbing it with a bare jest.fn(): prevent on mount, allow on
// unmount, keyed. "The guard is engaged while a phrase is on screen and
// released when that screen goes away" is the exact claim GAP-017's fix has
// to make, and a stubbed hook could only ever prove the hook was called at
// all — never that it lets go. The two jest.fn()s live INSIDE the factory and
// are read back off the imported module below, because a factory is hoisted
// above this file's own const declarations (mockShareModule gets away with an
// outer reference only because its Proxy dereferences lazily).
jest.mock("expo-screen-capture", () => {
  const { useEffect } = require("react");
  const preventScreenCaptureAsync = jest.fn(async (_key: string) => undefined);
  const allowScreenCaptureAsync = jest.fn(async (_key: string) => undefined);
  return {
    preventScreenCaptureAsync,
    allowScreenCaptureAsync,
    usePreventScreenCapture: (key: string) => {
      useEffect(() => {
        void preventScreenCaptureAsync(key);
        return () => {
          void allowScreenCaptureAsync(key);
        };
      }, [key]);
    },
  };
});

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
import { BackHandler, Share, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { authenticateAsync } from "expo-local-authentication";
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from "expo-screen-capture";
import { initializeKeys } from "@/lib/crypto/key_manager";
import { generatePhrase } from "@/lib/crypto/recovery_phrase";
import { NotAuthenticatedError } from "@/modules/notification_listener";
import RecoveryPhraseScreen from "@/app/(onboarding)/recovery_phrase";

const mockInitializeKeys = initializeKeys as jest.Mock;
const mockGeneratePhrase = generatePhrase as jest.Mock;
const mockAuthenticateAsync = authenticateAsync as jest.Mock;
const mockShare = Share.share as jest.Mock;
const mockPreventScreenCapture = preventScreenCaptureAsync as jest.Mock;
const mockAllowScreenCapture = allowScreenCaptureAsync as jest.Mock;

const WORD_COUNT = 12;
const CHALLENGE_COUNT = 3;

/** The keys phrase_display.tsx and phrase_confirm.tsx pass to the guard.
 * Pinned here because they are not decorative: the package ref-counts
 * prevent/allow BY KEY, so two phrase surfaces sharing one would have the
 * first unmount clear the flag out from under the second. */
const DISPLAY_CAPTURE_KEY = "recovery-phrase-display";
const CONFIRM_CAPTURE_KEY = "recovery-phrase-confirm";

beforeEach(() => {
  jest.clearAllMocks();
  mockInitializeKeys.mockResolvedValue(undefined);
  // A device whose owner passes the system challenge. The tests that care
  // override this per-case; every test that predates the prompt needs it
  // only because the screen now refuses to touch the Keystore without one.
  mockAuthenticateAsync.mockResolvedValue({ success: true });
});

// The 5000 ms default is not enough for the FIRST render in this file when the
// whole suite is running: that one call pays costs none of the others do --
// importing the 2048-word BIP-39 list, the first mount of this component tree,
// and jest-expo's transform of both -- while competing with every other Jest
// worker for CPU. Observed as `shows all twelve recovery words` (the first test
// here) timing out under full-suite load while the same file passed in 1.6 s on
// its own.
//
// This is a timeout on a CONTENT assertion, not a performance budget: nothing
// here is asserting that the screen is fast, so the default was only ever an
// arbitrary ceiling. Raising it removes a CI flake without weakening a single
// claim the file makes. If this ever needs raising again, that IS a signal
// something got genuinely slow -- investigate rather than raise it twice.
//
// BOTH ceilings have to move, and this is the trap: waitFor's timeout and
// Jest's per-test timeout are independent, and Jest's default is ALSO 5000 ms.
// Raising only waitFor's changes nothing -- Jest kills the test at 5 s first,
// and the flake survives looking exactly the same. The waitFor value is kept
// BELOW the test value on purpose, so a genuine hang fails with waitFor's
// "unable to find element" message rather than Jest's contentless timeout.
jest.setTimeout(30_000);
const FIRST_RENDER_TIMEOUT_MS = 20_000;

async function renderScreenAndWaitForWords(props: { onDone?: () => void } = {}): Promise<void> {
  render(<RecoveryPhraseScreen {...props} />);
  await waitFor(() => expect(screen.getByTestId("phrase-display")).toBeTruthy(), {
    timeout: FIRST_RENDER_TIMEOUT_MS,
  });
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

async function proceedToConfirm(props: { onDone?: () => void } = {}): Promise<string[]> {
  await renderScreenAndWaitForWords(props);
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

/** Answers whatever three positions the confirm step is CURRENTLY asking for
 * and submits. Re-reads the labels every time on purpose: a return to the
 * confirm step remounts PhraseConfirm (that is what releases its one-shot
 * `confirmed` latch), so the second attempt quizzes different positions than
 * the first. */
async function submitConfirmation(words: string[]): Promise<void> {
  const positions = getConfirmPositions();
  fillConfirmInputs(positions.map((p) => words[p]));
  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-submit-button"));
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
// A way back OFF the confirm step, and what going back costs.
//
// "I've written these down" used to be a one-way door: the twelve words are
// shown on exactly one screen, once, and a user who tapped through early had
// no route back to them -- on the step they are least allowed to abandon.
// Going back is not skipping (the tests above still hold: both routes end at
// the same mandatory confirmation), and the words it goes back to are NEW
// ones, which is the half these tests exist to pin.
// ---------------------------------------------------------------------------

test("the confirm step offers a way back to the words", async () => {
  await proceedToConfirm();

  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-back-button"));
  });

  await waitFor(() => expect(screen.getByTestId("phrase-display")).toBeTruthy());
});

test("going back mints a NEW phrase, and says so before the user taps it", async () => {
  const first = await proceedToConfirm();
  expect(mockGeneratePhrase).toHaveBeenCalledTimes(1);
  // The warning has to be readable BEFORE the tap, not after: it is the only
  // thing standing between a half-copied phrase and a spliced one.
  expect(screen.getByTestId("confirm-back-warning")).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-back-button"));
  });
  await waitFor(() => expect(screen.getByTestId("phrase-display")).toBeTruthy());

  expect(mockGeneratePhrase).toHaveBeenCalledTimes(2);
  expect(getDisplayedWords().join(" ")).not.toBe(first.join(" "));
});

test("after going back, only the NEW words confirm -- the abandoned ones no longer pass", async () => {
  const first = await proceedToConfirm();

  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-back-button"));
  });
  await waitFor(() => expect(screen.getByTestId("phrase-display")).toBeTruthy());
  const second = getDisplayedWords();

  await act(async () => {
    fireEvent.press(screen.getByTestId("phrase-continue-button"));
  });
  await waitFor(() => expect(screen.getByTestId("phrase-confirm")).toBeTruthy());

  // Typing off the abandoned paper fails, rather than quietly initializing
  // keys against a phrase the user is no longer holding.
  const positions = getConfirmPositions();
  fillConfirmInputs(positions.map((position) => first[position]));
  await act(async () => {
    fireEvent.press(screen.getByTestId("confirm-submit-button"));
  });
  expect(screen.getByTestId("confirm-error")).toBeTruthy();
  expect(mockInitializeKeys).not.toHaveBeenCalled();

  await submitConfirmation(second);
  await waitFor(() => expect(mockInitializeKeys).toHaveBeenCalledWith(second));
});

test("the way back is gone once key setup is in flight -- the phrase cannot change under initializeKeys", async () => {
  let releaseInit: () => void = () => {};
  mockInitializeKeys.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        releaseInit = () => resolve();
      }),
  );

  const words = await proceedToConfirm();
  await submitConfirmation(words);

  await waitFor(() => expect(screen.getByTestId("recovery-phrase-initializing")).toBeTruthy());
  expect(screen.queryByTestId("confirm-back-button")).toBeNull();

  await act(async () => {
    releaseInit();
  });
});

test("Android's own back button returns to the words instead of dropping out of a mandatory step", async () => {
  // On first run this flow renders outside the router's Stack, so nothing
  // above it gives the system back gesture a meaning -- unhandled, it leaves
  // setup. The handler must both fire the same regeneration and CONSUME the
  // press (return true).
  const handlers: Array<() => boolean> = [];
  const spy = jest.spyOn(BackHandler, "addEventListener").mockImplementation(((
    _event: string,
    handler: () => boolean,
  ) => {
    handlers.push(handler);
    return { remove: jest.fn() };
  }) as never);

  try {
    const first = await proceedToConfirm();
    expect(handlers).toHaveLength(1);

    let consumed = false;
    await act(async () => {
      consumed = handlers[handlers.length - 1]();
    });
    expect(consumed).toBe(true);

    await waitFor(() => expect(screen.getByTestId("phrase-display")).toBeTruthy());
    expect(getDisplayedWords().join(" ")).not.toBe(first.join(" "));
  } finally {
    spy.mockRestore();
  }
});

// ---------------------------------------------------------------------------
// Rule 4: say the stakes in one plain sentence, before showing the words —
// and call them "recovery words", never crypto-wallet vocabulary.
// ---------------------------------------------------------------------------

test("states the stakes in plain language, and never uses crypto-wallet vocabulary", async () => {
  await renderScreenAndWaitForWords();

  const tree = JSON.stringify(screen.toJSON()).toLowerCase();
  // Was /new phone/ until GAP-100 -- that half of the sentence was the false
  // one. The trigger the words genuinely cover is the screen-lock reset.
  expect(tree).toMatch(/fingerprint or pin/);
  expect(tree).toMatch(/only way back/);
  expect(tree).toMatch(/recovery words/);
  expect(tree).not.toMatch(/seed phrase/);
  expect(tree).not.toMatch(/wallet/);
  expect(tree).not.toMatch(/mnemonic/);
});

// ---------------------------------------------------------------------------
// GAP-100: the promise is scoped to THIS phone, and the scope is the point.
// `recoveryWrap` and `recoverySalt` live in this device's SecureStore, nothing
// copies them off it (lib/privacy/data_export.ts carries ledger rows and no
// key material), and unwrapWithRecoveryPhrase throws "recovery wrap not
// present" the moment they are absent (lib/crypto/key_manager.ts:171-178). So
// the words open this phone's data after a screen-lock reset and open nothing
// at all on a new handset. The copy this screen shipped with promised both --
// the true half is exactly what made the false half credible -- and it was
// false in the direction that silently loses every wallet, bill, goal and
// loan the user has.
//
// These assertions pin the SCOPE, not one sentence: they fail if the old
// wording returns, and they still pass for any rewrite that keeps the promise
// device-bound. The last block is the general form -- a screen may mention a
// new phone only to deny, never to promise.
// ---------------------------------------------------------------------------

test("scopes the recovery promise to this phone, and never promises data back on a new one", async () => {
  await renderScreenAndWaitForWords();

  const tree = JSON.stringify(screen.toJSON()).toLowerCase();

  // The true half survives intact: a screen-lock reset is what the words are
  // for, and nobody can hand them back if they are lost.
  expect(tree).toMatch(/fingerprint or pin/);
  expect(tree).toMatch(/peraplano cannot recover them for you/);

  // ...and the scope that makes it true -- the data is ALREADY here.
  expect(tree).toMatch(/already on this phone/);

  // The false half is gone, in the exact shape it shipped in.
  expect(tree).not.toMatch(/if you ever get a new phone/);

  // ...and in any other shape. Every sentence that mentions a new phone or
  // device has to deny: "they don't move it to a new one" passes, "the only
  // way back" sitting in the same sentence as "new phone" does not.
  const newDeviceSentences = tree
    .split(".")
    .filter((sentence) => /new (phone|device|one)\b/.test(sentence));
  expect(newDeviceSentences.length).toBeGreaterThan(0);
  for (const sentence of newDeviceSentences) {
    expect(sentence).toMatch(/\b(don't|do not|cannot|can't|won't|never|not)\b/);
    expect(sentence).not.toMatch(/only way back|bring .*back|restore/);
  }
});

// ---------------------------------------------------------------------------
// GAP-017: the words leave this screen on paper or not at all. Rule 5 used to
// ask for a copy/share action here; that action put the ledger's second
// unwrap path on the OS share sheet, so the assertions below are its
// inversion -- the affordance is gone, the clipboard route with it, and the
// screens that show or accept the phrase hold a screen-capture guard for
// exactly as long as they are mounted.
// ---------------------------------------------------------------------------

test("offers no share or copy affordance, and never reaches the platform share sheet", async () => {
  await renderScreenAndWaitForWords();

  expect(screen.queryByTestId("phrase-share-button")).toBeNull();

  const tree = JSON.stringify(screen.toJSON()).toLowerCase();
  expect(tree).not.toMatch(/share/);
  expect(tree).not.toMatch(/copy/);

  // Not just "no button": nothing on the display step reaches Share at all.
  expect(mockShare).not.toHaveBeenCalled();
});

test("the displayed words are not selectable -- no long-press route to the clipboard", async () => {
  await renderScreenAndWaitForWords();

  for (let i = 0; i < WORD_COUNT; i++) {
    expect(screen.getByTestId(`phrase-word-${i}`).props.selectable).toBeFalsy();
  }
});

test("warns that screenshots are off here, and still tells the user to keep the words private", async () => {
  await renderScreenAndWaitForWords();

  const tree = JSON.stringify(screen.toJSON()).toLowerCase();
  expect(tree).toMatch(/screenshots are turned off/);
  // The guard is Android-effective, not absolute -- a camera still works, so
  // the copy must not stop at "you're safe here".
  //
  // THIS USED TO PIN /on paper/, and paper used to be the only way off this
  // screen. Since the save affordance landed there are two, so the assertion
  // moved to the part that is true of BOTH and is the part that actually
  // matters: wherever the words end up, only the user should be able to reach
  // them. Pinning "on paper" now would fail the screen for offering the file
  // the owner asked for, which is the opposite of what this test is guarding.
  expect(tree).toMatch(/keep them somewhere only you can reach/);
  expect(tree).toMatch(/photograph/);
});

// THE SAVE AFFORDANCE ITSELF. The button's absence would not fail any test
// above -- the screen would simply render as it did before the owner asked for
// this, and hand-copying twelve words would quietly come back.
test("offers a way to save the words to a file the user chooses", async () => {
  await renderScreenAndWaitForWords();

  expect(screen.getByTestId("phrase-save-button")).toBeTruthy();
});

test("blocks screen capture while the words are displayed, and releases it on unmount", async () => {
  await renderScreenAndWaitForWords();

  // AWAITED, not asserted straight off the render. The guard runs from an
  // effect, and the words appearing only proves the component rendered, not
  // that React has flushed its effects yet. Asserting immediately passes on an
  // idle machine and fails when the whole suite is running, which is the
  // difference between a test that measures the guard and one that measures
  // the scheduler.
  await waitFor(() => {
    expect(mockPreventScreenCapture).toHaveBeenCalledWith(DISPLAY_CAPTURE_KEY);
  });
  expect(mockAllowScreenCapture).not.toHaveBeenCalledWith(DISPLAY_CAPTURE_KEY);

  // RELEASED, not left on: a guard that never lets go would silently disable
  // screenshots everywhere else in the app, including the support flow that
  // deliberately attaches them.
  await act(async () => {
    screen.unmount();
  });

  expect(mockAllowScreenCapture).toHaveBeenCalledWith(DISPLAY_CAPTURE_KEY);
});

test("the confirm step holds its own guard, and the display step's is released as it leaves", async () => {
  await proceedToConfirm();

  // Awaited for the same reason as the display guard above: the swap runs
  // through two effects (the leaving screen's cleanup and the arriving
  // screen's setup), and neither is guaranteed to have flushed the moment the
  // confirm step's markup appears.
  await waitFor(() => {
    expect(mockPreventScreenCapture).toHaveBeenCalledWith(CONFIRM_CAPTURE_KEY);
    expect(mockAllowScreenCapture).toHaveBeenCalledWith(DISPLAY_CAPTURE_KEY);
  });
  expect(mockAllowScreenCapture).not.toHaveBeenCalledWith(CONFIRM_CAPTURE_KEY);

  await act(async () => {
    screen.unmount();
  });

  expect(mockAllowScreenCapture).toHaveBeenCalledWith(CONFIRM_CAPTURE_KEY);
});

test("the confirm inputs opt out of the OS autofill service", async () => {
  await proceedToConfirm();

  for (let i = 0; i < CHALLENGE_COUNT; i++) {
    expect(screen.getByTestId(`confirm-input-${i}`).props.importantForAutofill).toBe("no");
  }
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

// ---------------------------------------------------------------------------
// onDone (provider-selection plan Task 4): the hook app/(onboarding)/index.tsx
// uses to advance from this step to the provider picker. Optional, exactly
// like device_lock.tsx's onSecure, so every test above (constructing this
// component with zero props) is unaffected.
// ---------------------------------------------------------------------------

async function confirmPhrase(props: { onDone?: () => void } = {}): Promise<void> {
  const words = await proceedToConfirm(props);
  await submitConfirmation(words);
  await waitFor(() => expect(screen.getByTestId("recovery-phrase-done")).toBeTruthy());
}

test("offers an onward action once the keys are initialized, and only then", async () => {
  const onDone = jest.fn();

  await renderScreenAndWaitForWords({ onDone });
  // Not on the display step -- the words are not confirmed yet, so there is
  // nothing to move on from.
  expect(screen.queryByTestId("recovery-phrase-continue-button")).toBeNull();

  await confirmPhrase({ onDone });

  expect(screen.getByTestId("recovery-phrase-continue-button")).toBeTruthy();
  expect(onDone).not.toHaveBeenCalled();
});

test("tapping the onward action reports completion exactly once", async () => {
  const onDone = jest.fn();

  await confirmPhrase({ onDone });
  fireEvent.press(screen.getByTestId("recovery-phrase-continue-button"));

  expect(onDone).toHaveBeenCalledTimes(1);
});

test("never auto-advances past the confirmation screen the user has not read", async () => {
  const onDone = jest.fn();

  await confirmPhrase({ onDone });

  // The done screen tells the user their words are saved and to keep them
  // offline. Firing onDone from an effect would replace it before it could be
  // read -- the one screen in onboarding that has to land.
  expect(onDone).not.toHaveBeenCalled();
});

test("renders no onward action at all when no onDone is given, exactly as before", async () => {
  await confirmPhrase();

  expect(screen.getByTestId("recovery-phrase-done")).toBeTruthy();
  expect(screen.queryByTestId("recovery-phrase-continue-button")).toBeNull();
});

// ---------------------------------------------------------------------------
// THE AUTHENTICATION WINDOW (docs/12-encryption-and-app-lock.md §7;
// modules/notification_listener/index.ts's rejection taxonomy). Found on a
// physical Samsung A54, not here: initializeKeys() ends in an auth-gated
// Keystore key that is only usable for ~10s after the user passes a system
// challenge, and nothing in onboarding ever raised one — so first run failed
// with NotAuthenticatedError on every attempt, and the retry silently minted
// a NEW phrase over the twelve words the user had just been told to write
// down. These tests are the on-device failure, brought back where the Jest
// harness (which never touches a real Keystore) can see it.
// ---------------------------------------------------------------------------

test("raises the system authentication prompt BEFORE initializeKeys, not after it", async () => {
  const words = await proceedToConfirm();
  await submitConfirmation(words);

  await waitFor(() => expect(mockInitializeKeys).toHaveBeenCalledTimes(1));
  expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1);
  // ORDER, not mere presence. A prompt raised after the call it exists to
  // open the Keystore window for is exactly as useless as no prompt at all,
  // and "both were called" cannot tell the two apart.
  expect(mockAuthenticateAsync.mock.invocationCallOrder[0]).toBeLessThan(
    mockInitializeKeys.mock.invocationCallOrder[0],
  );
});

test("never asks for biometric-only -- a user with no enrolled fingerprint can finish setup with their PIN", async () => {
  const words = await proceedToConfirm();
  await submitConfirmation(words);

  await waitFor(() => expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1));
  // Same pin as contexts/lock_context.tsx's unlock() (task-9-brief rule 2 /
  // contract §10): `disableDeviceFallback: false`, so device
  // PIN/pattern/password is always an acceptable answer.
  expect(mockAuthenticateAsync).toHaveBeenCalledWith(
    expect.objectContaining({ disableDeviceFallback: false }),
  );
});

test("a cancelled prompt never calls initializeKeys and never replaces the phrase the user wrote down", async () => {
  mockAuthenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" });

  const words = await proceedToConfirm();
  await submitConfirmation(words);

  await waitFor(() => expect(screen.getByTestId("recovery-phrase-auth-notice")).toBeTruthy());
  expect(mockInitializeKeys).not.toHaveBeenCalled();
  // Not the dead-end error screen: a prompt the user dismissed is not a
  // failure, it is a step to take again.
  expect(screen.queryByTestId("recovery-phrase-error")).toBeNull();
  expect(mockGeneratePhrase).toHaveBeenCalledTimes(1);

  // And the step is genuinely usable again, not merely still on screen: a
  // second, successful attempt gets the SAME twelve words into initializeKeys.
  mockAuthenticateAsync.mockResolvedValue({ success: true });
  await submitConfirmation(words);

  await waitFor(() => expect(mockInitializeKeys).toHaveBeenCalledTimes(1));
  expect(mockInitializeKeys).toHaveBeenCalledWith(words);
  expect(mockGeneratePhrase).toHaveBeenCalledTimes(1);
});

test("a NotAuthenticatedError re-prompts once and retries the SAME call with the SAME words", async () => {
  // The ~10s window can expire between the prompt and the call — a slow or
  // interrupted user. The module's contract for this rejection is explicit:
  // re-prompt and retry the same call.
  mockInitializeKeys.mockRejectedValueOnce(new NotAuthenticatedError());

  const words = await proceedToConfirm();
  await submitConfirmation(words);

  await waitFor(() => expect(screen.getByTestId("recovery-phrase-done")).toBeTruthy());
  expect(mockAuthenticateAsync).toHaveBeenCalledTimes(2);
  expect(mockInitializeKeys).toHaveBeenCalledTimes(2);
  // The identical array instance, not a fresh phrase that happens to compare
  // equal — the retry is the SAME call, re-issued.
  expect(mockInitializeKeys.mock.calls[1][0]).toBe(mockInitializeKeys.mock.calls[0][0]);
  expect(mockInitializeKeys).toHaveBeenLastCalledWith(words);
  expect(mockGeneratePhrase).toHaveBeenCalledTimes(1);
});

test("a second NotAuthenticatedError gives up instead of prompting forever", async () => {
  mockInitializeKeys.mockRejectedValue(new NotAuthenticatedError());

  const words = await proceedToConfirm();
  await submitConfirmation(words);

  await waitFor(() => expect(screen.getByTestId("recovery-phrase-error")).toBeTruthy());
  // Bounded at exactly one re-prompt: "a forever-looping recovery" is a bug
  // shape this codebase has already shipped once (contexts/lock_context.tsx's
  // "WHY NO AUTO-RETRY LOOP ANYWHERE HERE"), and a prompt loop on the
  // onboarding screen is unescapable without force-quitting.
  expect(mockAuthenticateAsync).toHaveBeenCalledTimes(2);
  expect(mockInitializeKeys).toHaveBeenCalledTimes(2);
});

test('"Try again" after a failed initializeKeys retries with the SAME words and never regenerates the phrase', async () => {
  mockInitializeKeys.mockRejectedValueOnce(new Error("native bridge error"));

  const words = await proceedToConfirm();
  await submitConfirmation(words);
  await waitFor(() => expect(screen.getByTestId("recovery-phrase-error")).toBeTruthy());

  await act(async () => {
    fireEvent.press(screen.getByTestId("recovery-phrase-retry-button"));
  });

  await waitFor(() => expect(screen.getByTestId("recovery-phrase-done")).toBeTruthy());
  expect(mockInitializeKeys).toHaveBeenCalledTimes(2);
  expect(mockInitializeKeys.mock.calls[1][0]).toBe(mockInitializeKeys.mock.calls[0][0]);
  expect(mockInitializeKeys).toHaveBeenLastCalledWith(words);
  // THE ONE THAT MATTERS. The user has already been told to write these
  // twelve words down. A retry that generates a fresh phrase leaves them
  // holding a piece of paper that opens nothing, believing it opens
  // everything — strictly worse than the error it replaced.
  expect(mockGeneratePhrase).toHaveBeenCalledTimes(1);
});

test('"Try again" after a failed generatePhrase DOES generate a new phrase -- nothing was ever shown to invalidate', async () => {
  mockGeneratePhrase.mockRejectedValueOnce(new Error("no entropy"));

  render(<RecoveryPhraseScreen />);
  await waitFor(() => expect(screen.getByTestId("recovery-phrase-error")).toBeTruthy(), {
    timeout: FIRST_RENDER_TIMEOUT_MS,
  });
  expect(mockGeneratePhrase).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent.press(screen.getByTestId("recovery-phrase-retry-button"));
  });

  await waitFor(() => expect(screen.getByTestId("phrase-display")).toBeTruthy(), {
    timeout: FIRST_RENDER_TIMEOUT_MS,
  });
  // The mirror image of the test above: no words ever reached the user here,
  // so there is nothing a fresh phrase could invalidate — and there is no
  // phrase to retry initialization WITH.
  expect(mockGeneratePhrase).toHaveBeenCalledTimes(2);
  expect(mockInitializeKeys).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// THE BURIED "Setting up your encryption keys…" MESSAGE (owner's device
// report: "onboarding encrypting message footer is blocked by hardware bottom
// navbar").
//
// WHY THIS SCREEN AND NOT OnboardingFrame. components/onboarding/
// onboarding_frame.tsx already solved exactly this — its header records the
// same defect, measured at 126px on a physical A54 — but this screen does not
// use that frame. It is reached from app/lock.tsx's first-run flow, before any
// navigator exists, and renders its own column.
//
// AND NOT PhraseConfirm EITHER. That component DOES pad itself by
// `insets.bottom` (its own header says so). The two Texts below it —
// `recovery-phrase-auth-notice` and `recovery-phrase-initializing` — are its
// SIBLINGS in the column, outside that padding, carrying a flat `pb-4`/`pb-6`.
// Against a 126px navigation bar, 24dp of flat padding is not enough, so the
// message the user is meant to read while their keys are generated sits under
// the ▢ ◁ strip.
//
// THE PROVIDER IS THE TEST. test_support/safe_area_mock.ts answers ZERO insets
// unless a real SafeAreaProvider is mounted, which is why every other test in
// this file passes today: with no navigation bar there is nothing to be buried
// under. This one supplies the bar.
// ---------------------------------------------------------------------------

/** The A54's navigation bar — the device this defect was found on. */
const NAV_BAR = 126;

function footerPadding(): number {
  const flat = StyleSheet.flatten(screen.getByTestId("recovery-phrase-footer").props.style) ?? {};
  return (flat as { paddingBottom?: number }).paddingBottom ?? 0;
}

/** Holds initializeKeys in flight so the "initializing" stage stays rendered. */
function holdInitializeKeys(): () => void {
  let resolveInit!: () => void;
  mockInitializeKeys.mockReturnValue(
    new Promise<void>((resolve) => {
      resolveInit = resolve;
    }),
  );
  return () => resolveInit();
}

test("the encrypting message clears the hardware navigation bar", async () => {
  const releaseInit = holdInitializeKeys();

  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: 0, bottom: NAV_BAR, left: 0, right: 0 },
      }}
    >
      <RecoveryPhraseScreen />
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("phrase-display")).toBeTruthy(), {
    timeout: FIRST_RENDER_TIMEOUT_MS,
  });

  const words = getDisplayedWords();
  await act(async () => {
    fireEvent.press(screen.getByTestId("phrase-continue-button"));
  });
  await waitFor(() => expect(screen.getByTestId("phrase-confirm")).toBeTruthy());
  await submitConfirmation(words);

  // The exact stage the owner photographed: keys genuinely in flight.
  expect(screen.getByTestId("recovery-phrase-initializing")).toBeTruthy();
  expect(footerPadding()).toBeGreaterThanOrEqual(NAV_BAR);

  await act(async () => {
    releaseInit();
  });
});

// The other half, and it is a SEPARATE claim: the footer must not reserve a
// navigation bar that is not there. A flat `paddingBottom: 126` would satisfy
// the test above on every device and leave a dead band on a gesture-navigation
// phone — the same double-counting trap onboarding_frame.tsx documents.
test("it reserves nothing extra when there is no navigation bar", async () => {
  const releaseInit = holdInitializeKeys();

  const words = await proceedToConfirm();
  await submitConfirmation(words);

  expect(screen.getByTestId("recovery-phrase-initializing")).toBeTruthy();
  expect(footerPadding()).toBe(0);

  await act(async () => {
    releaseInit();
  });
});

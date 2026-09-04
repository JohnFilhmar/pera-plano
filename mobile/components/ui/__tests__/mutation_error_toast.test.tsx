// components/ui/__tests__/mutation_error_toast.test.tsx — GAP-013.
//
// The claim under test is a user-visible one, so most of this file drives the
// real path end to end: a mutation on the app's own `queryClient` rejects, and
// the mounted host is asserted to be showing something about it. Publishing
// straight into the queue is used only for the cases a mutation cannot reach
// (a neutral tone, an action label), which are the seams GAP-075's undo
// snackbar and GAP-079's sheets will build on.
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import {
  clearToasts,
  publishToast,
  queryClient,
  MUTATION_FAILURE_TOAST,
  TOAST_DURATION_MS,
} from "@/lib/query_client";

import { MutationErrorToast } from "../mutation_error_toast";

const LEDGER_ERROR = new Error(
  "UNIQUE constraint failed: transactions.external_ref (Jollibee SM Megamall)",
);

/** The same shape hooks/mutations/* run through, driven without a screen. */
async function failOneMutation(): Promise<void> {
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationFn: (): Promise<void> => Promise.reject(LEDGER_ERROR),
  });

  await act(async () => {
    await mutation.execute(undefined).catch(() => undefined);
  });

  // Every Mutation schedules a five-minute garbage-collection timeout in its
  // own constructor (query-core's Removable). Left alone, each one built here
  // keeps a real timer alive long after the test that made it has finished,
  // which is what makes Jest report a worker that "failed to exit gracefully"
  // and then sit waiting for it.
  mutation.destroy();
}

beforeEach(() => {
  clearToasts();
});

afterEach(() => {
  act(() => {
    clearToasts();
  });
});

test("nothing is drawn while nothing has failed — the strip must not sit over the header all day", () => {
  render(<MutationErrorToast />);

  expect(screen.queryByTestId("app-toasts")).toBeNull();
});

test("a rejected mutation puts a readable notice on screen", async () => {
  render(<MutationErrorToast />);

  await failOneMutation();

  screen.getByText(MUTATION_FAILURE_TOAST.title);
  screen.getByText(MUTATION_FAILURE_TOAST.body);
});

test("the notice never shows the error, the constraint, or the merchant inside it", async () => {
  render(<MutationErrorToast />);

  await failOneMutation();

  expect(screen.queryByText(LEDGER_ERROR.message)).toBeNull();
  expect(screen.queryByText(/UNIQUE constraint/)).toBeNull();
  expect(screen.queryByText(/Jollibee/)).toBeNull();
  expect(screen.queryByText(/transactions\.external_ref/)).toBeNull();
});

test("Dismiss takes it down", async () => {
  render(<MutationErrorToast />);
  await failOneMutation();

  fireEvent.press(screen.getByTestId("app-toast-dismiss"));

  expect(screen.queryByTestId("app-toast")).toBeNull();
});

test("a notice expires on its own, so a failure the user has read does not hold the top of the screen", () => {
  jest.useFakeTimers();
  try {
    render(<MutationErrorToast />);
    act(() => {
      publishToast({ tone: "failure", title: "a", body: "b", dedupeKey: "one" });
    });
    expect(screen.queryByTestId("app-toast")).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(TOAST_DURATION_MS);
    });

    expect(screen.queryByTestId("app-toast")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test("a caller's own duration is honoured — an undo window is longer than a failure notice", () => {
  jest.useFakeTimers();
  try {
    render(<MutationErrorToast />);
    act(() => {
      publishToast({
        tone: "neutral",
        title: "Dismissed",
        body: "It will not come back on its own.",
        dedupeKey: "review:undo",
        durationMs: TOAST_DURATION_MS * 2,
      });
    });

    act(() => {
      jest.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByTestId("app-toast")).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByTestId("app-toast")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test("two different notices stack rather than replacing each other", () => {
  render(<MutationErrorToast />);

  act(() => {
    publishToast({ tone: "failure", title: "first", body: "b", dedupeKey: "one" });
    publishToast({ tone: "neutral", title: "second", body: "d", dedupeKey: "two" });
  });

  expect(screen.getAllByTestId("app-toast")).toHaveLength(2);
  screen.getByText("first");
  screen.getByText("second");
});

test("an action renders only when it has both a label and a handler, and taking it closes the notice", () => {
  const undo = jest.fn();
  render(<MutationErrorToast />);

  act(() => {
    publishToast({ tone: "neutral", title: "Dismissed", body: "b", dedupeKey: "review:undo" });
  });
  expect(screen.queryByTestId("app-toast-action")).toBeNull();

  act(() => {
    publishToast({
      tone: "neutral",
      title: "Dismissed",
      body: "b",
      dedupeKey: "review:undo",
      actionLabel: "Undo",
      onAction: undo,
    });
  });

  fireEvent.press(screen.getByTestId("app-toast-action"));
  expect(undo).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("app-toast")).toBeNull();
});

test("the tone is carried by the rail, danger for a failure and neutral ink otherwise", () => {
  render(<MutationErrorToast />);

  act(() => {
    publishToast({ tone: "failure", title: "a", body: "b", dedupeKey: "one" });
    publishToast({ tone: "neutral", title: "c", body: "d", dedupeKey: "two" });
  });

  const [failure, neutral] = screen.getAllByTestId("app-toast-rail");
  expect(String(failure.props.className)).toContain("bg-danger");
  expect(String(neutral.props.className)).not.toContain("bg-danger");
});

test("the strip lets a tap through to whatever is under it — a header's back button is under this", () => {
  render(<MutationErrorToast />);

  act(() => {
    publishToast({ tone: "failure", title: "a", body: "b", dedupeKey: "one" });
  });

  expect(screen.getByTestId("app-toasts").props.pointerEvents).toBe("box-none");
});

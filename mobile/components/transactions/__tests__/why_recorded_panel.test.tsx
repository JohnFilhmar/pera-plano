// components/transactions/__tests__/why_recorded_panel.test.tsx — m1c plan
// Task 7, rules 2–4.
//
// THIS PANEL IS THE APP'S HONESTY MECHANISM, and these assertions are what make
// that claim checkable. PeraPlano reads the user's notifications. The only
// thing that makes that defensible is being able to show them, on demand,
// exactly what was read and exactly when it will be deleted. Every failure
// mode below turns a privacy promise into an unverifiable one:
//
//   A PACKAGE NAME INSTEAD OF A PROVIDER. "com.globe.gcash.android" tells the
//   user nothing about which app was read. The panel exists to answer that
//   question and this is the answer being unreadable.
//
//   A COUNTDOWN THAT DISAGREES WITH THE DELETION. The expiry is a stored
//   column, written from the STORE time, and `purgeExpiredRawCaptures` deletes
//   on it. A countdown derived from `capturedAt` is a different number on any
//   replayed or late-drained capture — the panel promising a date the database
//   will not honour.
//
//   AN EMPTY BOX AFTER EXPIRY. A blank panel reads as a bug. Deletion working
//   exactly as promised has to LOOK like deletion working, in words.
//
//   THE PANEL ON A MANUAL ROW. "Why was this recorded?" over a transaction the
//   user typed in themselves invites them to look for a notification that never
//   existed.
//
// Presentational: the capture, the expiry and the provider name arrive as
// props, resolved by the screen. No database, no hooks, and the clock is always
// injected.
import { fireEvent, render, screen } from "@testing-library/react-native";

import type { EpochMs, RawCapture, TxSource } from "@/types/domain";

import {
  captureExpiryLabel,
  MANUAL_SOURCE_NOTE,
  RAW_CAPTURE_EXPIRED_NOTICE,
  WHY_RECORDED_TITLE,
  WhyRecordedPanel,
} from "../why_recorded_panel";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pinned clock. Nothing in this file is a function of the day it runs on. */
const NOW: EpochMs = new Date(2026, 7, 13, 21, 0).getTime();

const CAPTURED_TEXT = "You have sent PHP 500.00 to JUAN D. Ref. 1234567";

function capture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: "cap-1",
    packageName: "com.globe.gcash.android",
    title: "GCash",
    text: CAPTURED_TEXT,
    subText: null,
    bigText: null,
    postedAt: NOW - DAY_MS,
    capturedAt: NOW - DAY_MS,
    ...overrides,
  };
}

type PanelProps = {
  source?: TxSource;
  providerName?: string;
  capture?: RawCapture | null;
  expiresAt?: EpochMs | null;
  confidence?: number;
  now?: EpochMs;
};

function renderPanel(props: PanelProps = {}) {
  return render(
    <WhyRecordedPanel
      source={props.source ?? "notification"}
      providerName={props.providerName ?? "GCash"}
      capture={props.capture === undefined ? capture() : props.capture}
      expiresAt={props.expiresAt === undefined ? NOW + 12 * DAY_MS : props.expiresAt}
      confidence={props.confidence}
      now={props.now ?? NOW}
    />,
  );
}

/** Opens the disclosure — the panel is collapsed until the user asks. */
function expand(): void {
  fireEvent.press(screen.getByTestId("why-recorded-toggle"));
}

// ---------------------------------------------------------------------------
// The disclosure itself
// ---------------------------------------------------------------------------

describe("the disclosure", () => {
  test("renders the question, with the captured text hidden until it is asked", () => {
    renderPanel();

    expect(screen.getByText(WHY_RECORDED_TITLE)).toBeTruthy();
    // The raw text carries third parties' names — the sender of a padala, the
    // person who was paid. It is shown on request, not by default, to every
    // shoulder scrolling past a ledger.
    expect(screen.queryByTestId("why-recorded-body")).toBeNull();
    expect(screen.queryByText(CAPTURED_TEXT)).toBeNull();
  });

  test("expanding shows the body, and collapsing puts it away again", () => {
    renderPanel();

    expand();
    expect(screen.getByTestId("why-recorded-body")).toBeTruthy();

    fireEvent.press(screen.getByTestId("why-recorded-toggle"));
    expect(screen.queryByTestId("why-recorded-body")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What was read (rule 2)
// ---------------------------------------------------------------------------

describe("the captured notification", () => {
  test("shows the captured text VERBATIM", () => {
    renderPanel();
    expand();

    // `getByText` matches a whole text node exactly, which is the assertion
    // this panel needs: a truncated or reworded rendering of what was read is
    // not what was read.
    expect(screen.getByText(CAPTURED_TEXT)).toBeTruthy();
    expect(screen.getByTestId("why-recorded-text")).toBeTruthy();
  });

  test("shows every non-empty field of the capture, not just `text`", () => {
    // The parser reads `bigText` too — an expanded notification often carries
    // the reference number the collapsed one omits. A panel that showed only
    // `text` would be hiding part of what the app actually read.
    renderPanel({
      capture: capture({
        title: "GCash",
        text: "You have sent PHP 500.00",
        bigText: "You have sent PHP 500.00 to JUAN D. Ref. 1234567",
        subText: "Main wallet",
      }),
    });
    expand();

    expect(screen.getByTestId("why-recorded-text")).toBeTruthy();
    // Twice, and both are real: the resolved PROVIDER ("read from GCash") and
    // the notification's own title, which happens to read the same. They are
    // two different facts and the panel states both.
    expect(screen.getAllByText("GCash")).toHaveLength(2);
    expect(screen.getByText("You have sent PHP 500.00 to JUAN D. Ref. 1234567")).toBeTruthy();
    expect(screen.getByText("Main wallet")).toBeTruthy();
  });

  test("a field Android repeated verbatim is rendered once, not twice", () => {
    // Android routinely copies `text` into `bigText`. The same sentence printed
    // twice reads as a rendering bug and undermines the one screen whose job is
    // to look exact.
    renderPanel({ capture: capture({ text: CAPTURED_TEXT, bigText: CAPTURED_TEXT }) });
    expand();

    expect(screen.getAllByText(CAPTURED_TEXT)).toHaveLength(1);
  });

  test("names the PROVIDER, never the android package", () => {
    renderPanel({ providerName: "GCash" });
    expand();

    expect(screen.getByTestId("why-recorded-provider")).toHaveTextContent("GCash");
    // The whole point. A package id answers "which app?" with a string the
    // user has never seen in their life.
    expect(screen.queryByText(/com\.globe\.gcash\.android/)).toBeNull();
  });

  test("shows the confidence when the screen passes one (spec Flow C step 2)", () => {
    renderPanel({ confidence: 0.95 });
    expand();

    expect(screen.getByTestId("why-recorded-confidence")).toHaveTextContent(/95%/);
  });
});

// ---------------------------------------------------------------------------
// The countdown (rule 2)
// ---------------------------------------------------------------------------

describe("the expiry countdown", () => {
  test("renders the remaining days for a pinned clock", () => {
    renderPanel({ expiresAt: NOW + 12 * DAY_MS });
    expand();

    expect(screen.getByTestId("why-recorded-expiry")).toHaveTextContent(
      "This capture is deleted in 12 days",
    );
  });

  test("captureExpiryLabel is exact at the boundaries, and never rounds a day EARLY", () => {
    // Rounding up is the only safe direction. Saying "1 day" when 1 day and 2
    // hours remain is honest — the text is gone on that day. Saying "11 days"
    // when 11 days and 23 hours remain tells the user their data is gone
    // before it is, which is the one error a deletion promise cannot make.
    expect(captureExpiryLabel(NOW + 30 * DAY_MS, NOW)).toBe("This capture is deleted in 30 days");
    expect(captureExpiryLabel(NOW + 12 * DAY_MS, NOW)).toBe("This capture is deleted in 12 days");
    expect(captureExpiryLabel(NOW + 12 * DAY_MS - 1, NOW)).toBe(
      "This capture is deleted in 12 days",
    );
    expect(captureExpiryLabel(NOW + 11 * DAY_MS + 1, NOW)).toBe(
      "This capture is deleted in 12 days",
    );
  });

  test("the last day is singular, and reads as a day rather than as `1 days`", () => {
    expect(captureExpiryLabel(NOW + DAY_MS, NOW)).toBe("This capture is deleted in 1 day");
    expect(captureExpiryLabel(NOW + 60_000, NOW)).toBe("This capture is deleted in 1 day");
  });

  test("a countdown that has run out is the expired notice, not `in 0 days`", () => {
    expect(captureExpiryLabel(NOW, NOW)).toBe(RAW_CAPTURE_EXPIRED_NOTICE);
    expect(captureExpiryLabel(NOW - 1, NOW)).toBe(RAW_CAPTURE_EXPIRED_NOTICE);
  });
});

// ---------------------------------------------------------------------------
// Expiry (rule 3) — the panel must never render a blank box
// ---------------------------------------------------------------------------

describe("an expired capture", () => {
  test("a PURGED capture renders the expired notice, not an empty box", () => {
    // `purgeExpiredRawCaptures` deleted the row and nulled the Transaction's
    // pointer. Everything the panel had to show is gone, which is the system
    // working — so it has to read as the system working.
    renderPanel({ capture: null, expiresAt: null });
    expand();

    const body = screen.getByTestId("why-recorded-body");
    expect(body).toHaveTextContent(RAW_CAPTURE_EXPIRED_NOTICE);
    expect(screen.queryByTestId("why-recorded-text")).toBeNull();
  });

  test("the notice is the spec's sentence, and says the deletion was BY DESIGN", () => {
    // docs/04-features/11-settings-privacy.md Flow C step 4, verbatim. A user
    // who reads "no data" concludes something broke; the whole sentence is what
    // turns a missing record into evidence the promise was kept.
    expect(RAW_CAPTURE_EXPIRED_NOTICE).toBe(
      "The original notification text was automatically deleted after 30 days, as designed.",
    );
  });

  test("a capture PAST its expiry that the purge has not reached yet shows no text", () => {
    // The purge runs at bootstrap, so a long-running session can hold a row
    // whose expiry passed an hour ago. The panel promised deletion at that
    // instant; rendering the text anyway would make the promise false on the
    // one screen that makes it.
    renderPanel({ capture: capture(), expiresAt: NOW - 60_000 });
    expand();

    expect(screen.getByTestId("why-recorded-body")).toHaveTextContent(RAW_CAPTURE_EXPIRED_NOTICE);
    expect(screen.queryByText(CAPTURED_TEXT)).toBeNull();
  });

  test("a capture that has NOT loaded yet does not claim the text was deleted", () => {
    // `undefined` is "the read has not resolved", which is not "it is gone".
    // Announcing a deletion that has not happened is the same lie in the other
    // direction, and it resolves itself a frame later, so nobody would ever
    // catch it in review.
    renderPanel({ capture: undefined as unknown as null, expiresAt: undefined as unknown as null });
    expand();

    expect(screen.queryByText(RAW_CAPTURE_EXPIRED_NOTICE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Manual transactions (rule 4)
// ---------------------------------------------------------------------------

describe("a transaction the app did not record", () => {
  test("a MANUAL transaction renders the manual note and NO panel", () => {
    renderPanel({ source: "manual", capture: null, expiresAt: null });

    expect(screen.getByTestId("transaction-manual-note")).toHaveTextContent(MANUAL_SOURCE_NOTE);
    // Asserted as ABSENT, not merely "the note is present": a panel offering
    // to explain why the app recorded something the USER recorded sends them
    // looking for a notification that never existed.
    expect(screen.queryByTestId("why-recorded-panel")).toBeNull();
    expect(screen.queryByText(WHY_RECORDED_TITLE)).toBeNull();
  });

  test("the manual note is the plan's sentence", () => {
    expect(MANUAL_SOURCE_NOTE).toBe("You added this manually");
  });

  test("a notification transaction renders the panel and NOT the manual note", () => {
    renderPanel({ source: "notification" });

    expect(screen.getByTestId("why-recorded-panel")).toBeTruthy();
    expect(screen.queryByTestId("transaction-manual-note")).toBeNull();
  });

  test("an imported or rule-generated row explains itself without inventing a capture", () => {
    // Neither source has a notification behind it. Spec rule 6's completeness
    // requirement covers `source: notification`; these two must still say
    // something true rather than offering a panel with nothing in it.
    for (const source of ["import", "recurring-rule"] as const) {
      const view = renderPanel({ source, capture: null, expiresAt: null });

      expect(screen.getByTestId("transaction-source-note")).toBeTruthy();
      expect(screen.queryByTestId("why-recorded-panel")).toBeNull();
      view.unmount();
    }
  });
});

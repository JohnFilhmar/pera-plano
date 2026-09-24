// components/income/__tests__/income_screen.test.tsx — m2-part2 Task 13.
//
// The route and its components, against a real database. The service is NOT
// mocked: what matters about this screen is that its four actions reach the
// income rules — that confirming really sets `isManualOverride` false while
// saving the form sets it true — and a mocked service would assert only that
// the screen calls functions with the names I gave them.
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { IncomeForm } from "@/components/income/income_form";
import { PaydayDetectedSheet } from "@/components/income/payday_detected_sheet";
import { incomeSentence } from "@/components/income/income_summary_card";
import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { typeAmount } from "@/test_support/keypad";
import { closeDatabase } from "@/lib/db/database";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import {
  getIncomeDetectionState,
  getIncomeProfile,
  setIncomeDetectionState,
} from "@/lib/db/repos/income_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { refreshIncomeDetection, UNKNOWN_INCOME } from "@/lib/income/income_service";
import type { IncomeSummary } from "@/lib/income/income_service";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import IncomeScreen from "../../../app/(tabs)/plan/income";

const mockPush = jest.fn();
const mockBack = jest.fn();

const on = (y: number, m: number, d: number) => new Date(y, m, d, 10, 0).getTime();

let payroll: Wallet;

function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity, staleTime: 0 },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

/**
 * The amount field is a NumericField now (numeric-input-system Task 12), and
 * `useKeypad` throws without a provider. <KeypadHost /> is rendered BEFORE the
 * subject on purpose: mount effects commit in completion order and the panel
 * goes to the highest live token, so the root stand-in registering first
 * leaves the higher tokens for anything the screen mounts later.
 */
function renderScreen(ui: ReactNode) {
  return render(
    <QueryClientProvider client={makeTestClient()}>
      <KeypadProvider>
        <KeypadHost />
        {ui}
      </KeypadProvider>
    </QueryClientProvider>,
  );
}

async function credit(amount: number, at: number): Promise<void> {
  await insertTransaction({
    walletId: payroll.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "in",
    occurredAt: at,
    merchant: "ACME PAYROLL",
    source: "notification",
    confidence: 1,
  });
}

/**
 * The `count` most recent kinsenas paydays that are already in the PAST.
 *
 * Relative to today, because the screen reads the real clock through
 * `useIncomeSummary` — the composition edge, and the one place in this feature
 * allowed to. Anchors that have not happened yet are skipped and the walk keeps
 * going, so the seed always produces `count` credits in CONSECUTIVE windows
 * whatever day of the month the suite happens to run on. Generating a fixed
 * pattern and dropping the future ones instead yields a different number of
 * paydays depending on the date, which is how a detection test passes for three
 * weeks a month.
 */
async function seedRecentKinsenas(count: number, splitInHalves = false): Promise<void> {
  const now = Date.now();
  const today = new Date(now);
  const anchors: number[] = [];

  for (let monthsBack = 0; monthsBack < 8 && anchors.length < count; monthsBack++) {
    const month = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (const day of [lastDay, 15]) {
      if (anchors.length >= count) break;
      const at = new Date(month.getFullYear(), month.getMonth(), day, 10, 0).getTime();
      if (at < now) anchors.push(at);
    }
  }

  for (const at of anchors) {
    if (splitInHalves) {
      // Two deposits, one local date — the same hour offsets the service suite
      // uses. Kept inside the same day deliberately: a payday is a local date.
      await credit(925000, at - 3_600_000);
      await credit(925000, at + 3 * 3_600_000);
    } else {
      await credit(1850000, at);
    }
  }
}

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  await seedDefaultCategories();
  payroll = await createWallet({ name: "BPI Payroll" });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// The plain-language sentence (rule 1)
// ---------------------------------------------------------------------------
const summaryFor = (over: Partial<IncomeSummary>): IncomeSummary => ({
  cadence: "kinsenas",
  averageAmount: 1850000,
  monthlyEquivalent: 3700000,
  status: "confirmed",
  isManualOverride: false,
  expectedNextAt: null,
  sourceWalletIds: [],
  hasPendingSuggestion: false,
  hasSplitPaydayNotice: false,
  ...over,
});

test.each([
  ["kinsenas", "You're paid twice a month, around ₱18,500.00 each time."],
  ["weekly", "You're paid weekly, around ₱18,500.00 each time."],
  ["monthly", "You're paid monthly, around ₱18,500.00."],
] as const)("the %s summary reads as a sentence", (cadence, expected) => {
  // Rule 1: "the plain-language sentence the user cares about ... not a cadence
  // enum".
  expect(incomeSentence(summaryFor({ cadence }))).toBe(expected);
});

test("the kinsenas sentence never says 'kinsenas'", () => {
  // The one cadence whose enum value reads as jargon on a card. "weekly" and
  // "monthly" are ordinary English and belong in their own sentences, so the
  // rule is about this word specifically, not about the enum in general.
  expect(incomeSentence(summaryFor({ cadence: "kinsenas" }))).not.toContain("kinsenas");
});

test("the irregular sentence describes a MONTH, not a payday", () => {
  // There is no typical payday to describe. Rule 9 already made this figure a
  // monthly total, so saying "each time" would be describing a payday that does
  // not exist.
  const sentence = incomeSentence(
    summaryFor({ cadence: "irregular", averageAmount: 450000, monthlyEquivalent: 450000 }),
  );

  expect(sentence).toBe("Your income varies — about ₱4,500.00 a month.");
  expect(sentence).not.toContain("each time");
});

// ---------------------------------------------------------------------------
// Unknown income (rule 4)
// ---------------------------------------------------------------------------
test("UNKNOWN INCOME EXPLAINS WHAT DEPENDS ON IT, and offers the manual form", async () => {
  // Rule 4: "the screen explains what depends on it — percent-of-income Limits
  // are paused until income is known — with a direct link to set it manually".
  // A user who does not know a limit is sitting paused has no reason to fill
  // this in, and the limit stays silently inert.
  renderScreen(<IncomeScreen />);

  await screen.findByTestId("income-unknown");
  expect(screen.getByText(/paused/)).toBeTruthy();
  // The form is right there rather than behind a tap — there is nothing else
  // this screen can usefully show.
  screen.getByTestId("income-amount");
  screen.getByTestId("income-save");
});

// ---------------------------------------------------------------------------
// The manual form (rule 3)
// ---------------------------------------------------------------------------
test("SUBMITTING THE FORM SETS A MANUAL OVERRIDE with the entered values", async () => {
  renderScreen(<IncomeScreen />);
  await screen.findByTestId("income-amount");

  fireEvent.press(screen.getByTestId("cadence-monthly"));
  typeAmount("income-amount", "30000"); // was changeText "3000000" in centavos
  fireEvent.press(screen.getByTestId(`income-wallet-${payroll.id}`));
  fireEvent.press(screen.getByTestId("income-save"));

  await waitFor(async () => expect(await getIncomeProfile()).not.toBeNull());
  const profile = await getIncomeProfile();
  expect(profile?.cadence).toBe("monthly");
  expect(profile?.averageAmount).toBe(3000000); // ₱30,000.00, from the pesos typed
  expect(profile?.sourceWalletIds).toEqual([payroll.id]);
  // Rule 14: any user-entered value sets the override.
  expect(profile?.isManualOverride).toBe(true);
});

test("the form states plainly that it overrides detection", async () => {
  // Rule 3. The sentence is load-bearing: the point of an override is that the
  // user is taking over, and an app that quietly reverted their figure a week
  // later would be worse than one that never offered the choice.
  renderScreen(<IncomeScreen />);

  const note = await screen.findByTestId("income-override-note");
  expect(note.props.children.join?.("") ?? String(note.props.children)).toMatch(/overrides/i);
});

test("the amount field echoes back the centavos it will save", async () => {
  // RENAMED from "...what the digits mean" (numeric-input-system Task 12):
  // there are no centavo-digits to interpret any more. 18500 keyed on the
  // panel is ₱18,500 — what the field itself shows — and the preview line
  // states the same figure the way the ledger will store it.
  renderScreen(<IncomeScreen />);
  await screen.findByTestId("income-amount");

  typeAmount("income-amount", "18500");

  expect(screen.getByTestId("income-amount-preview")).toHaveTextContent("₱18,500.00");
});

test("A STORED AMOUNT SEEDS THE FIELD AS ITSELF, NOT A HUNDRED TIMES ITSELF", async () => {
  // THE LATENT 100× BUG numeric-input-system Task 12 fixes.
  // `IncomeFormValues.averageAmount` is Centavos. The form used to seed its
  // field with `String(initial.averageAmount)` — correct while the field read
  // its text as centavo digits, and a hundredfold inflation the moment the
  // same text started being read as PESOS. A user re-opening "Change my
  // income" on a stored ₱2,000.00 would have found ₱200,000.00 waiting in the
  // box, and saving without retyping would have written it.
  renderScreen(
    <IncomeForm
      wallets={[]}
      initial={{ cadence: "monthly", averageAmount: 200_000, sourceWalletIds: [] }}
      onSubmit={jest.fn()}
    />,
  );

  // The field's own live display (formatPesoInput) and the preview line
  // (formatCentavos) are different strings for the same amount, so neither
  // assertion can be satisfied by the other's element.
  expect(screen.getByTestId("income-amount")).toHaveTextContent("₱2,000");
  expect(screen.getByTestId("income-amount-preview")).toHaveTextContent("₱2,000.00");
  expect(screen.queryByText("₱200,000.00")).toBeNull();
});

test("an empty amount cannot be saved", async () => {
  renderScreen(<IncomeScreen />);
  await screen.findByTestId("income-save");

  fireEvent.press(screen.getByTestId("income-save"));

  await waitFor(async () => expect(await getIncomeProfile()).toBeNull());
});

// ---------------------------------------------------------------------------
// Detection status (rule 2)
// ---------------------------------------------------------------------------
test("a provisional detection offers Confirm and Not right", async () => {
  await seedRecentKinsenas(3);
  await refreshIncomeDetection(Date.now());

  renderScreen(<IncomeScreen />);

  await screen.findByTestId("income-suggestion");
  screen.getByTestId("income-confirm");
  screen.getByTestId("income-dismiss");
});

test("CONFIRMING applies the detection WITHOUT setting an override", async () => {
  // Income flow 2: "Confirm applies it (isManualOverride stays false; automatic
  // updates continue)." Confirming is agreement, not a takeover.
  await seedRecentKinsenas(3);
  await refreshIncomeDetection(Date.now());
  renderScreen(<IncomeScreen />);
  await screen.findByTestId("income-confirm");

  fireEvent.press(screen.getByTestId("income-confirm"));

  await waitFor(async () => expect((await getIncomeProfile())?.cadence).toBe("kinsenas"));
  expect((await getIncomeProfile())?.isManualOverride).toBe(false);
});

test("DISMISSING records the signature and stops re-proposing it", async () => {
  await seedRecentKinsenas(3);
  await refreshIncomeDetection(Date.now());
  renderScreen(<IncomeScreen />);
  await screen.findByTestId("income-dismiss");

  fireEvent.press(screen.getByTestId("income-dismiss"));

  await waitFor(async () =>
    expect((await getIncomeDetectionState()).suggestionDismissedSignature).not.toBeNull(),
  );
  // The prompt goes away rather than being re-offered on the next render.
  await waitFor(() => expect(screen.queryByTestId("income-suggestion")).not.toBeOnTheScreen());
});

test("THE ONE-TIME SPLIT-PAYDAY NOTICE APPEARS ON THE CARD AND STAYS DISMISSED", async () => {
  // GAP-117's owner decision: fix it, and tell the user. The notice explains why
  // the income figure — and the headroom of every percent-of-income Limit
  // measured against it — moved without them touching anything.
  //
  // The seeded state is what the OLD build left behind: a confirmed kinsenas
  // profile whose `averageAmount` was one HALF of the pay that arrived.
  await seedRecentKinsenas(6, true);
  await setIncomeDetectionState({
    ...UNKNOWN_INCOME,
    status: "confirmed",
    cadence: "kinsenas",
    averageAmount: 925000,
    sourceWalletIds: [payroll.id],
  });
  await refreshIncomeDetection(Date.now());

  renderScreen(<IncomeScreen />);
  const notice = await screen.findByTestId("income-split-payday-notice");

  // It explains the two things that moved, and never blocks: the card's own
  // figure is on screen beside it.
  expect(notice).toBeTruthy();
  screen.getByText(/percentage of your income/);
  screen.getByTestId("income-summary-card");

  fireEvent.press(screen.getByTestId("income-split-payday-ack"));

  await waitFor(() => expect(screen.queryByTestId("income-split-payday-notice")).not.toBeOnTheScreen());
  expect(await getSetting("income_split_payday_notice")).toBe("done");
});

test("a manual override says so, and offers switching back to automatic", async () => {
  renderScreen(<IncomeScreen />);
  await screen.findByTestId("income-amount");
  typeAmount("income-amount", "30000"); // was changeText "3000000" in centavos
  fireEvent.press(screen.getByTestId("income-save"));

  await screen.findByTestId("income-manual-note");
  // Rule 15's "Switch to automatic" — offered only when there is an override to
  // switch away from, or it is a button that undoes nothing.
  screen.getByTestId("income-clear-manual");
});

// ---------------------------------------------------------------------------
// The payday sheet (rule 5)
// ---------------------------------------------------------------------------
test("the payday sheet renders the amount and the date from the event", () => {
  render(
    <PaydayDetectedSheet
      payday={{
        transactionIds: ["tx-1"],
        walletId: "w-1",
        amount: 1854000,
        occurredAt: on(2026, 7, 15),
      }}
      walletName="BPI Payroll"
      onDismiss={() => undefined}
    />,
  );

  screen.getByTestId("payday-sheet");
  // The ACTUAL credit, not `averageAmount` — goals allocate against this figure
  // (income rule 12), so showing the average would describe a different sum
  // from the one about to move.
  expect(screen.getByTestId("payday-amount").props.children).toContain("₱18,540.00");
  screen.getByText(/BPI Payroll/);
  screen.getByText(/Aug 15, 2026/);
});

test("the payday sheet renders nothing when there is no payday", () => {
  render(<PaydayDetectedSheet payday={null} onDismiss={() => undefined} />);

  expect(screen.queryByTestId("payday-sheet")).toBeNull();
});

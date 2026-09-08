// app/__tests__/limit_routes.test.tsx — m2 Task 8's three limits routes.
//
// THE PLAN HUB TESTS THAT USED TO LIVE HERE ARE GONE (mobile-ui-revamp Part 2
// Task 7). `PlanScreen` stopped being a scrollable stack of section cards —
// it is now a segmented host, and pressing a segment is a state change, never
// a `router.push` (revamp spec R4). The two tests this file used to carry —
// "the hub lists the IA's four sections" (which asserted `getByText("Loans")`
// and the absence of "Income") and "THE HUB REACHES LIMITS" (which asserted
// pressing `plan-section-limits` called `push`) — describe a screen and a
// testID that no longer exist. Their replacements live in
// app/__tests__/plan_segments.test.tsx, which owns the segmented host now.
//
// The card is tested in isolation next door (components/limits/__tests__); this
// file is about what the ROUTES do — the reads they wire together and the
// writes they commit against a real database. Three claims live here and
// nowhere else:
//
//   THE FREE CAP BLOCKS CREATION AND DELETES NOTHING. docs/05-monetization.md
//   §3.1, and m2 Global Constraint 11. The gated screen must still leave the
//   user's existing limits alone.
//
//   THE DRILL-DOWN LIST ADDS UP TO THE TOTAL ABOVE IT. The m2 plan's own
//   version passes a wallet id only when the limit filters on exactly one, and
//   never passes the category filter — so a filtered limit lists transactions
//   the total does not count, and the screen contradicts itself on screen.
//
//   A LIMIT IS NAMED THE SAME WAY EVERYWHERE. The list and the detail header
//   both go through `limitDisplayName`.
//
// expo-router is mocked rather than driven through `renderRouter`, matching
// app/__tests__/wallet_routes.test.tsx: the subject is what each screen renders
// and where it says it is going, which is the part a typo breaks.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { TextInput } from "react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { typeAmount } from "@/test_support/keypad";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, createCategory } from "@/lib/db/repos/categories_repo";
import { createLimit, getLimit, listLimits } from "@/lib/db/repos/limits_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { setManualIncome } from "@/lib/income/income_service";
import { derivedLimitsFrom } from "@/lib/limits/limit_derivation";
import { previousPeriodWindow } from "@/lib/limits/limit_engine";
import { getLimitAlertState, setLimitAlertState } from "@/lib/db/repos/limits_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Category, Wallet } from "@/types/domain";

import LimitsScreen from "../(tabs)/plan/limits";
import NewLimitScreen from "../(tabs)/plan/limits/new";
import LimitDetailScreen from "../(tabs)/plan/limits/[id]";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};

/** The app's own defaults, with `retry: 0` so a failing read fails the test. */
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
 * The create route's amount and percent fields are NumericFields now
 * (numeric-input-system Task 12), and `useKeypad` throws without a provider —
 * so every screen in this file gets one, not just the two that hold a field.
 *
 * <KeypadHost /> COMES FIRST, BEFORE THE SUBJECT. React commits mount effects
 * in completion order, so a host rendered after a subtree registers a HIGHER
 * token than any host nested inside that subtree — and keypad_context.tsx
 * hands the panel to the highest live token. Rendering the root stand-in
 * first leaves the higher tokens for whatever a screen mounts later (a
 * BottomSheet's own host), which is the real app's ordering. Task 11's fix
 * round found this the hard way.
 */
function renderScreen(ui: ReactNode) {
  const client = makeTestClient();
  return render(
    <QueryClientProvider client={client}>
      <KeypadProvider>
        <KeypadHost />
        {ui}
      </KeypadProvider>
    </QueryClientProvider>,
  );
}

let wallet: Wallet;
let food: Category;
let delivery: Category;
let transport: Category;

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  mockParams = {};
  __setTierForTests(null);

  await seedDefaultCategories();
  wallet = await createWallet({ name: "GCash" });
  food = await createCategory({ name: "Kainan", icon: "utensils" });
  delivery = await createCategory({ name: "Delivery", icon: "bike", parentId: food.id });
  transport = await createCategory({ name: "Byahe", icon: "bus" });
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

async function spend(
  categoryId: string,
  amount: number,
  occurredAt: number = Date.now(),
): Promise<void> {
  await insertTransaction({
    walletId: wallet.id,
    categoryId,
    amount,
    direction: "out",
    occurredAt,
    source: "manual",
    confidence: 1,
  });
}

// ---------------------------------------------------------------------------
// The limits list
// ---------------------------------------------------------------------------
test("empty: the spec's own copy, and Add opens the create route", async () => {
  renderScreen(<LimitsScreen />);

  await screen.findByTestId("limits-empty");
  screen.getByText("Set your first limit");

  fireEvent.press(screen.getByText("Add a limit"));
  expect(mockPush).toHaveBeenCalledWith("/plan/limits/new");
});

test("a limit renders as a card named the way its filters describe it", async () => {
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 1000000,
    categoryFilter: [food.id],
  });
  await spend(food.id, 250000);

  renderScreen(<LimitsScreen />);

  await screen.findByTestId(`limit-card-${limit.id}`);
  // The category NAME, not its uuid and not a bare count — `useCategories` has
  // loaded by the time the list renders.
  screen.getByText("Monthly limit · Kainan");
  // The remainder is stated; the days-left figure depends on today's date, so
  // only the money half is asserted exactly.
  screen.getByText(/^₱7,500\.00 left, \d+ days? to go$/);
});

test("pressing a card opens that limit's detail route", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });

  renderScreen(<LimitsScreen />);
  await screen.findByTestId(`limit-row-${limit.id}`);

  fireEvent.press(screen.getByTestId(`limit-row-${limit.id}`));

  // The object form, because `[id]` is a dynamic route — the same shape
  // app/(tabs)/wallets.tsx uses for /wallet/[id].
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/plan/limits/[id]",
    params: { id: limit.id },
  });
});

// F5: the row was a bare Pressable — TalkBack could reach it (RN marks any
// onPress handler focusable regardless of role) but never announced it as
// actionable, unlike `plan-income-row` sitting 64 lines away in the same file.
test("the limit row is announced to TalkBack as a button with a spoken label, not a silent wrapper", async () => {
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 1000000,
    categoryFilter: [food.id],
  });
  await spend(food.id, 250000);

  renderScreen(<LimitsScreen />);
  const row = await screen.findByTestId(`limit-row-${limit.id}`);

  expect(row.props.accessibilityRole).toBe("button");
  // Same name and figures this file's own "a limit renders as a card..." test
  // already pins on screen ("Monthly limit · Kainan", ₱2,500 of ₱10,000).
  expect(row.props.accessibilityLabel).toBe("Monthly limit · Kainan, ₱2,500.00 of ₱10,000.00 spent");
});

test("THE FREE CAP BLOCKS CREATION AND DELETES NOTHING", async () => {
  // docs/05-monetization.md §3.1 / m2 Global Constraint 11: a cap blocks a NEW
  // record and never touches existing data.
  __setTierForTests("free");
  const existing = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });

  renderScreen(<LimitsScreen />);
  await screen.findByTestId(`limit-row-${existing.id}`);

  fireEvent.press(screen.getByTestId("limits-add"));

  expect(mockPush).toHaveBeenCalledWith("/plan/limits/new?gated=1");
  // The existing limit is untouched — still there, still active.
  expect(await getLimit(existing.id)).not.toBeNull();
  expect((await listLimits()).length).toBe(1);
});

test("the cap counts ACTIVE limits, so a deactivated one leaves room", async () => {
  __setTierForTests("free");
  await createLimit({ scope: "monthly", basis: "fixed", value: 1000000, isActive: false });

  renderScreen(<LimitsScreen />);
  await screen.findByTestId("limits-add");

  fireEvent.press(screen.getByTestId("limits-add"));

  expect(mockPush).toHaveBeenCalledWith("/plan/limits/new");
});

test("AND IT DOES NOT COUNT THE ONES THE APP DERIVED", async () => {
  // Owner-approved 2026-08-20. Entering one limit now also creates the
  // equivalent at the other three cadences, so counting those would take a
  // Free user from "one limit" to "gated" the instant they finished
  // onboarding — tripping a cap they never approached, over rows they never
  // asked for.
  __setTierForTests("free");
  const source = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  for (const derived of derivedLimitsFrom(source)) await createLimit(derived);

  renderScreen(<LimitsScreen />);
  await screen.findByTestId(`limit-row-${source.id}`);

  fireEvent.press(screen.getByTestId("limits-add"));

  // Four active limits on screen, one of them the user's — so still gated at
  // exactly the point the cap actually means.
  expect((await listLimits()).length).toBe(4);
  expect(mockPush).toHaveBeenCalledWith("/plan/limits/new?gated=1");
});

// ---------------------------------------------------------------------------
// Gap warnings between limits (owner, 2026-08-20).
// ---------------------------------------------------------------------------

test("a weekly limit looser than the monthly one is called out", async () => {
  // ₱10,000/week is ~₱1,425/day against ₱20,000/month's ~₱657/day: spending to
  // the weekly cap blows the monthly one before the month is out, and the user
  // would otherwise only find out at the end of it.
  await createLimit({ scope: "weekly", basis: "fixed", value: 1_000_000 });
  await createLimit({ scope: "monthly", basis: "fixed", value: 2_000_000 });

  renderScreen(<LimitsScreen />);

  await screen.findByTestId("limit-gap-contradiction");
});

test("A DERIVED SET RAISES NO WARNING AT ALL", async () => {
  // The test that keeps the feature credible: onboarding creates all four
  // cadences at once, and a warning on the set the app itself just built is
  // how users learn to ignore warnings.
  const source = await createLimit({ scope: "monthly", basis: "fixed", value: 2_000_000 });
  for (const derived of derivedLimitsFrom(source)) await createLimit(derived);

  renderScreen(<LimitsScreen />);
  await screen.findByTestId(`limit-row-${source.id}`);

  expect(screen.queryByTestId("limit-gap-contradiction")).toBeNull();
  expect(screen.queryByTestId("limit-gap-never-binds")).toBeNull();
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
test("saving a fixed limit stores CENTAVOS, from the PESOS typed", async () => {
  // RENAMED FROM "...from the digits typed" (numeric-input-system Task 12).
  // The keystrokes changed and the stored value did not: the field used to
  // read "800000" as centavos, and now reads "8000" as pesos. Both are
  // ₱8,000.00. The expectation below is untouched precisely because the
  // amount the user means is untouched.
  renderScreen(<NewLimitScreen />);

  typeAmount("limit-amount", "8000");
  // Echoed back with the centavos it will actually store, before saving.
  screen.getByText("₱8,000.00");
  fireEvent.press(screen.getByTestId("limit-save"));

  // FOUR ROWS, NOT ONE (owner-approved 2026-08-20): the entered limit plus the
  // same limit restated at the other three cadences. The assertions below are
  // about the one the user actually typed, which is the one that is NOT
  // derived — see lib/limits/limit_derivation.ts.
  await waitFor(async () => expect((await listLimits()).length).toBe(4));
  const saved = (await listLimits()).find((limit) => limit.derivedFrom === null)!;
  expect(saved.value).toBe(800000);
  expect(saved.basis).toBe("fixed");
  expect(saved.scope).toBe("monthly");
  expect(mockBack).toHaveBeenCalled();
});

test("the derived limits are marked, so the free tier's cap ignores them", async () => {
  // `canCreateLimit` caps Free at ONE active limit. Without `derivedFrom` the
  // four rows above would gate a user the instant they saved their first one.
  renderScreen(<NewLimitScreen />);

  typeAmount("limit-amount", "8000");
  fireEvent.press(screen.getByTestId("limit-save"));

  await waitFor(async () => expect((await listLimits()).length).toBe(4));
  const limits = await listLimits();
  const entered = limits.find((limit) => limit.derivedFrom === null)!;
  expect(limits.filter((limit) => limit.derivedFrom === null)).toHaveLength(1);
  expect(limits.filter((limit) => limit.derivedFrom === entered.id)).toHaveLength(3);
  expect(limits.map((limit) => limit.scope).sort()).toEqual([
    "annual",
    "daily",
    "monthly",
    "weekly",
  ]);
});

test("the scope chips choose the period, and rollover defaults OFF", async () => {
  // Spec step 5: "Toggle rollover on or off (default off)."
  renderScreen(<NewLimitScreen />);

  // task-4b: "Resets" is now a ListRow that opens the scope picker in a sheet
  // (the board's "each opening its existing picker"), so choosing a scope is
  // two presses now, not one — `limit-scope-weekly` itself is unchanged.
  fireEvent.press(screen.getByTestId("limit-resets-row"));
  fireEvent.press(screen.getByTestId("limit-scope-weekly"));
  typeAmount("limit-amount", "1500"); // was changeText "150000" — same ₱1,500.00
  fireEvent.press(screen.getByTestId("limit-save"));

  await waitFor(async () => expect((await listLimits()).length).toBe(4));
  const saved = (await listLimits()).find((limit) => limit.derivedFrom === null)!;
  expect(saved.scope).toBe("weekly");
  expect(saved.rollover).toBe(false);
  // NOT INHERITED by the derived rows either: rollover changes how much may be
  // spent, and switching it on for three cadences nobody chose it for would do
  // that silently.
  expect((await listLimits()).every((limit) => limit.rollover === false)).toBe(true);
});

test("the Rollover Switch announces itself to a screen reader, matching its restyled siblings", () => {
  // branch-review-design.md F4: this Switch had no accessibility props at
  // all, unlike components/privacy/capture_toggle.tsx's
  // capture-toggle-switch and components/privacy/provider_switch_list.tsx's
  // provider-switch-* in the same diff.
  renderScreen(<NewLimitScreen />);

  const rolloverSwitch = screen.getByTestId("limit-rollover");
  expect(rolloverSwitch.props.accessibilityRole).toBe("switch");
  expect(rolloverSwitch.props.accessibilityLabel).toBe("Rollover");
  // Positive assertion first (the switch exists and starts unchecked, form's
  // own `rollover` default) — a guard built only of negative/undefined
  // checks would pass just as well against a Switch that was never rendered
  // at all.
  expect(rolloverSwitch.props.accessibilityState).toEqual({ checked: false });

  fireEvent(rolloverSwitch, "valueChange", true);
  expect(screen.getByTestId("limit-rollover").props.accessibilityState).toEqual({ checked: true });
});

test("the Rollover row's explanation does not clip to one line", () => {
  // branch-review-correctness.md F2's defect class: list_row.tsx's subtitle
  // defaults to `numberOfLines={1}` unless a caller opts in. RNTL cannot see
  // a device's line-clamp — `getByText` below finds the full string either
  // way — so the only real assertion is on the rendered node's own
  // `numberOfLines` prop, never the text content.
  renderScreen(<NewLimitScreen />);

  const subtitle = screen.getByText("Unused headroom carries into the next period, never stacking");
  expect(subtitle.props.numberOfLines).toBeGreaterThan(1);
});

test("an empty or zero amount cannot be saved", async () => {
  // 001_core.sql's CHECK (value > 0). A disabled button beats a constraint
  // violation surfacing as an unexplained crash.
  renderScreen(<NewLimitScreen />);

  fireEvent.press(screen.getByTestId("limit-save"));
  typeAmount("limit-amount", "0");
  fireEvent.press(screen.getByTestId("limit-save"));

  await waitFor(() => expect(mockBack).not.toHaveBeenCalled());
  expect(await listLimits()).toEqual([]);
});

test("percent-of-income cannot be saved until income exists", async () => {
  // Spec step 3: "The Limit cannot be saved as active without one of the two."
  // Income lands in m2-part2 Task 12, so this is blocked for now — and says so
  // rather than failing silently on save.
  renderScreen(<NewLimitScreen />);

  fireEvent.press(screen.getByTestId("limit-basis-percent"));
  screen.getByTestId("limit-percent-blocked");
  typeAmount("limit-percent", "20");
  fireEvent.press(screen.getByTestId("limit-save"));

  await waitFor(() => expect(mockBack).not.toHaveBeenCalled());
  expect(await listLimits()).toEqual([]);
});

test("the percent field says what the percentage comes to, once income is known", async () => {
  // The onboarding first-Limit step has always shown this sentence; the create
  // route showed a bare "20%" until 2026-08-26, which is not a figure anyone
  // can judge a limit by. Both screens render components/limits/limit_preview.tsx
  // now, so this string and onboarding's cannot drift.
  await setManualIncome(
    { cadence: "monthly", averageAmount: 3_000_000, sourceWalletIds: [] },
    Date.now(),
  );

  renderScreen(<NewLimitScreen />);

  fireEvent.press(screen.getByTestId("limit-basis-percent"));
  await waitFor(() => expect(screen.queryByTestId("limit-percent-blocked")).toBeNull());

  typeAmount("limit-percent", "20");

  // 20% of ₱30,000.00 monthly = ₱6,000.00; 600,000 × 12 ÷ 365 = ₱197.26 a day.
  await waitFor(() =>
    expect(screen.getByTestId("limit-percent-preview")).toHaveTextContent(
      "₱6,000.00 every month is about ₱197.26 a day.",
    ),
  );
});

test("no percent sentence is drawn while income is unknown", async () => {
  // "₱0.00 every month" beside a card saying the app does not know your income
  // would contradict the card.
  renderScreen(<NewLimitScreen />);

  fireEvent.press(screen.getByTestId("limit-basis-percent"));
  typeAmount("limit-percent", "20");

  expect(screen.queryByTestId("limit-percent-preview")).toBeNull();
  screen.getByTestId("limit-percent-blocked");
});

test("THE CREATE ROUTE RAISES NO SYSTEM KEYBOARD, on either basis", async () => {
  // numeric-input-system Task 12. Both fields are Pressables now
  // (components/ui/numeric_field.tsx), and a subtree with no TextInput in it
  // cannot raise the OS keypad however it is later edited.
  renderScreen(<NewLimitScreen />);

  expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);

  fireEvent.press(screen.getByTestId("limit-basis-percent"));

  expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
});

test("the gated create route explains the cap and shows NO form", async () => {
  mockParams = { gated: "1" };

  renderScreen(<NewLimitScreen />);

  screen.getByTestId("limits-gated");
  screen.getByText("Limit cap reached");
  expect(screen.queryByTestId("limit-amount")).toBeNull();
  expect(screen.queryByTestId("limit-save")).toBeNull();
});

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
// ITEMIZED means base, rollover and effective are three DIFFERENT figures on
// screen, and this test could not see any of that before. It created a
// rollover-free fixed limit — for which base, effective and the card's own
// total are all the same ₱10,000.00 — then asserted
// `getAllByText("₱10,000.00").length > 0` and the bare existence of the
// `limit-detail-effective` node. Every one of those held against a card that
// printed the base three times, or that dropped the rollover row entirely,
// which is exactly the itemization rule 3 exists to force.
//
// So the fixture now has a real carryover: last month closed with ₱2,500 of
// its ₱10,000 base unspent, and rule 14 clamps that forward. Base ₱10,000,
// rollover ₱2,500, effective ₱12,500, spend ₱3,000 — four figures no two of
// which are equal, each read off the node that is supposed to carry it.
test("detail itemizes the effective limit as base plus rollover, and lists what counted", async () => {
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 1000000,
    rollover: true,
  });

  // Rule 18: a limit only carries headroom forward from a period it was
  // actually watching, which the engine checks by requiring a stored state
  // whose `periodStart` IS the previous window. Seeded rather than simulated
  // — the boundary logic itself belongs to lib/limits/__tests__.
  const previous = previousPeriodWindow("monthly", Date.now());
  await setLimitAlertState(limit.id, {
    periodStart: previous.start,
    base: 1000000,
    carryover: 0,
    fired: [],
    muted: false,
    lastSpend: 0,
  });
  // ₱7,500 of last month's ₱10,000, leaving ₱2,500 to carry. `sumSpend` over
  // the previous window is what the engine reads, not the stored `lastSpend`.
  await spend(food.id, 750000, previous.start + 86_400_000);

  await spend(food.id, 300000);
  mockParams = { id: limit.id };

  renderScreen(<LimitDetailScreen />);

  await screen.findByTestId("limit-detail");
  screen.getByText("Monthly limit");
  // Base: the only place ₱10,000.00 appears, since the card above now totals
  // ₱12,500.00. `getByText`, singular, so a second copy is a failure.
  screen.getByText("₱10,000.00");
  expect(screen.getByTestId("limit-detail-carryover").props.children).toBe("₱2,500.00");
  expect(screen.getByTestId("limit-detail-effective").props.children).toBe("₱12,500.00");
  screen.getByText(/Spent ₱3,000.00/);
  // The card and the itemization have to agree, which they cannot if the card
  // is quietly showing the base.
  screen.getByText("₱3,000.00 / ₱12,500.00");
});

// The other side of the same rule, and the reason the test above cannot simply
// assert "a carryover row exists": with rollover off there is nothing to
// itemize, and printing a ₱0.00 rollover line would invent a concept the user
// has not turned on.
test("detail shows no rollover row when the limit does not roll over", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await spend(food.id, 250000);
  mockParams = { id: limit.id };

  renderScreen(<LimitDetailScreen />);

  await screen.findByTestId("limit-detail");
  expect(screen.queryByTestId("limit-detail-carryover")).toBeNull();
  expect(screen.getByTestId("limit-detail-effective").props.children).toBe("₱10,000.00");
  screen.getByText(/Spent ₱2,500.00/);
});

test("THE DRILL-DOWN LIST MATCHES THE TOTAL ABOVE IT", async () => {
  // A category-filtered limit. The m2 plan's detail screen never passes the
  // category filter to `listTransactions`, so it lists every outflow in the
  // period while the header counts only the filtered ones — the screen
  // disagreeing with itself about the user's money.
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 1000000,
    categoryFilter: [food.id],
  });
  await spend(delivery.id, 100000); // counts — descendant of Kainan (rule 4)
  await spend(transport.id, 400000); // must NOT be listed
  mockParams = { id: limit.id };

  renderScreen(<LimitDetailScreen />);

  await screen.findByTestId("limit-detail");
  await waitFor(() => expect(screen.getAllByText("−₱1,000.00").length).toBe(1));
  expect(screen.queryByText("−₱4,000.00")).toBeNull();
  screen.getByText(/Spent ₱1,000.00/);
});

test("mute records the mute without silencing the visual state", async () => {
  // Rule 25/30: muting affects notifications only.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await spend(food.id, 600000);
  mockParams = { id: limit.id };

  renderScreen(<LimitDetailScreen />);
  await screen.findByTestId("limit-mute");

  fireEvent.press(screen.getByTestId("limit-mute"));

  await waitFor(async () => expect((await getLimitAlertState(limit.id))?.muted).toBe(true));
  // The card is still on screen, still showing the figures.
  screen.getByTestId("limit-detail-card");
});

// WAS "delete removes the limit". REWRITTEN, not renamed (owner-approved
// 2026-08-20): the old assertion was `getLimit(...)` resolving to null after a
// literal `DELETE FROM limits`, and the claim is now the opposite one — the
// row survives, and it is the LIST it leaves.
test("archive retires the limit and goes back, touching no transactions", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await spend(food.id, 250000);
  mockParams = { id: limit.id };

  renderScreen(<LimitDetailScreen />);
  await screen.findByTestId("limit-archive");

  fireEvent.press(screen.getByTestId("limit-archive"));
  // BEHIND A CONFIRMATION. The row leaves the list and there is no un-archive
  // screen yet, so an accidental tap must not be how a user finds that out.
  fireEvent.press(await screen.findByTestId("confirm-dialog-confirm"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  // Gone from the list...
  expect(await listLimits()).toEqual([]);
  // ...and still on file, with the spend it was watching untouched.
  const archived = await getLimit(limit.id);
  expect(archived).not.toBeNull();
  expect(archived!.archivedAt).toEqual(expect.any(Number));
});

test("archiving asks first, and cancelling leaves the limit alone", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  mockParams = { id: limit.id };

  renderScreen(<LimitDetailScreen />);
  fireEvent.press(await screen.findByTestId("limit-archive"));
  fireEvent.press(await screen.findByTestId("confirm-dialog-cancel"));

  await waitFor(async () => expect((await listLimits()).length).toBe(1));
  expect(mockBack).not.toHaveBeenCalled();
});

test("a limit that no longer exists says so instead of rendering blank", async () => {
  mockParams = { id: "no-such-limit" };

  renderScreen(<LimitDetailScreen />);

  await screen.findByTestId("limit-detail-missing");
  screen.getByText("This limit is gone");
});

// app/__tests__/limit_routes.test.tsx — m2 Task 8's four screens: the Plan hub
// and the three limits routes.
//
// The card is tested in isolation next door (components/limits/__tests__); this
// file is about what the ROUTES do — the reads they wire together and the
// writes they commit against a real database. Four claims live here and nowhere
// else:
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
//   THE HUB DOES NOT INVITE ANYONE INTO AN UNSHIPPED SECTION. Limits went
//   "shipped" in m2-part2 Task 14 and now navigates; Goals, Loans and Bills
//   belong to m2b/m2c and stay grey and inert until those plans flip them.
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

import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, createCategory } from "@/lib/db/repos/categories_repo";
import { createLimit, getLimit, listLimits } from "@/lib/db/repos/limits_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { getLimitAlertState } from "@/lib/db/repos/limits_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Category, Wallet } from "@/types/domain";

import PlanScreen from "../(tabs)/plan";
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

function renderScreen(ui: ReactNode) {
  const client = makeTestClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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
  wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  food = await createCategory({ name: "Kainan", icon: "utensils" });
  delivery = await createCategory({ name: "Delivery", icon: "bike", parentId: food.id });
  transport = await createCategory({ name: "Byahe", icon: "bus" });
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

async function spend(categoryId: string, amount: number): Promise<void> {
  await insertTransaction({
    walletId: wallet.id,
    categoryId,
    amount,
    direction: "out",
    occurredAt: Date.now(),
    source: "manual",
    confidence: 1,
  });
}

// ---------------------------------------------------------------------------
// The Plan hub
// ---------------------------------------------------------------------------
test("the hub lists the IA's four sections", async () => {
  // docs/06-information-architecture.md §2: "Plan hub: Limits, Goals, Loans,
  // Bills". The m2 plan's snippet adds a fifth Income row; income is an
  // onboarding step and has no hub row.
  renderScreen(<PlanScreen />);

  screen.getByText("Limits");
  screen.getByText("Goals");
  screen.getByText("Loans");
  screen.getByText("Bills");
  expect(screen.queryByText("Income")).toBeNull();
});

test("THE HUB REACHES LIMITS", async () => {
  // m2-part2 Task 14 flipped `limits` (and `income`) to "shipped" in
  // constants/shipped_features.ts, per the foundation plan's rollout table.
  //
  // ONLY THE LIMITS ROW IS ASSERTED HERE, deliberately. Which OTHER sections
  // are live changes with every rollout flip, and pinning that here as well
  // would make one assertion have to be edited in two files on every plan —
  // app/__tests__/plan_hub.test.tsx owns the hub-wide picture.
  renderScreen(<PlanScreen />);

  fireEvent.press(screen.getByTestId("plan-section-limits"));
  expect(mockPush).toHaveBeenCalledWith("/plan/limits");
});

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

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
test("saving a fixed limit stores CENTAVOS, from the digits typed", async () => {
  renderScreen(<NewLimitScreen />);

  fireEvent.changeText(screen.getByTestId("limit-amount"), "800000");
  // Echoed back so the user can see what the digits mean before saving.
  screen.getByText("₱8,000.00");
  fireEvent.press(screen.getByTestId("limit-save"));

  await waitFor(async () => expect((await listLimits()).length).toBe(1));
  const [saved] = await listLimits();
  expect(saved.value).toBe(800000);
  expect(saved.basis).toBe("fixed");
  expect(saved.scope).toBe("monthly");
  expect(mockBack).toHaveBeenCalled();
});

test("the scope chips choose the period, and rollover defaults OFF", async () => {
  // Spec step 5: "Toggle rollover on or off (default off)."
  renderScreen(<NewLimitScreen />);

  fireEvent.press(screen.getByTestId("limit-scope-weekly"));
  fireEvent.changeText(screen.getByTestId("limit-amount"), "150000");
  fireEvent.press(screen.getByTestId("limit-save"));

  await waitFor(async () => expect((await listLimits()).length).toBe(1));
  const [saved] = await listLimits();
  expect(saved.scope).toBe("weekly");
  expect(saved.rollover).toBe(false);
});

test("an empty or zero amount cannot be saved", async () => {
  // 001_core.sql's CHECK (value > 0). A disabled button beats a constraint
  // violation surfacing as an unexplained crash.
  renderScreen(<NewLimitScreen />);

  fireEvent.press(screen.getByTestId("limit-save"));
  fireEvent.changeText(screen.getByTestId("limit-amount"), "0");
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
  fireEvent.changeText(screen.getByTestId("limit-percent"), "20");
  fireEvent.press(screen.getByTestId("limit-save"));

  await waitFor(() => expect(mockBack).not.toHaveBeenCalled());
  expect(await listLimits()).toEqual([]);
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
test("detail itemizes the effective limit and lists what counted", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await spend(food.id, 250000);
  mockParams = { id: limit.id };

  renderScreen(<LimitDetailScreen />);

  await screen.findByTestId("limit-detail");
  screen.getByText("Monthly limit");
  screen.getByTestId("limit-detail-effective");
  expect(screen.getAllByText("₱10,000.00").length).toBeGreaterThan(0);
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

test("delete removes the limit and goes back, touching no transactions", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await spend(food.id, 250000);
  mockParams = { id: limit.id };

  renderScreen(<LimitDetailScreen />);
  await screen.findByTestId("limit-delete");

  fireEvent.press(screen.getByTestId("limit-delete"));

  await waitFor(async () => expect(await getLimit(limit.id)).toBeNull());
  expect(mockBack).toHaveBeenCalled();
});

test("a limit that no longer exists says so instead of rendering blank", async () => {
  mockParams = { id: "no-such-limit" };

  renderScreen(<LimitDetailScreen />);

  await screen.findByTestId("limit-detail-missing");
  screen.getByText("This limit is gone");
});

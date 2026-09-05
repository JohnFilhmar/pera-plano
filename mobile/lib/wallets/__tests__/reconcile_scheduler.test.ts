// lib/wallets/__tests__/reconcile_scheduler.test.ts — the wiring defect
// GAP-010 names.
//
// `cash_reconcile_prompt_at` was declared in app_settings_repo.ts and read and
// written by NOTHING. The reconcile sheet, its delta math and its write path all
// worked; nothing ever asked the question, so a cash wallet drifted for as long
// as the user let it and the row's "reconcile weekly" copy was a promise with no
// keeper.
//
// What is proven here is the TRIGGER — which ledger state makes a wallet due,
// which states deliberately do not (a fresh install, a wallet with an empty
// ledger, an install still inside onboarding), and that the suppression gate is
// spent only by a prompt the OS actually accepted. The delta math is
// reconcile.ts's own and is proven in reconcile.test.ts.
jest.mock("@/lib/alerts/alerts_service", () => ({
  postAlert: jest.fn(),
}));

jest.mock("@/lib/db/repos/app_settings_repo", () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/db/repos/wallets_repo", () => ({
  listWallets: jest.fn(),
  listReconcileActivity: jest.fn(),
}));

import { postAlert } from "@/lib/alerts/alerts_service";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { listReconcileActivity, listWallets } from "@/lib/db/repos/wallets_repo";
import { emitAppEvent } from "@/lib/events/app_events";
import type { Wallet } from "@/types/domain";

import {
  computeNextReconcilePrompt,
  reconcileTriggerFor,
  RECONCILE_CADENCE_MS,
  runReconcilePromptPass,
  startReconcilePromptSubscriber,
  type CashWalletState,
} from "../reconcile_scheduler";

const mockPostAlert = postAlert as jest.MockedFunction<typeof postAlert>;
const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;
const mockSetSetting = setSetting as jest.MockedFunction<typeof setSetting>;
const mockListWallets = listWallets as jest.MockedFunction<typeof listWallets>;
const mockListActivity = listReconcileActivity as jest.MockedFunction<typeof listReconcileActivity>;

const DAY = 24 * 60 * 60 * 1000;
/** Local constructor, never a UTC string parse — lib/clock.ts's own rule. */
const NOW = new Date(2026, 8, 5, 12, 0).getTime();

/**
 * A cash wallet in the state the scheduler cares about: created two months ago,
 * spent from yesterday, never reconciled, no cash-out. Every test names the ONE
 * fact it is about.
 */
function cashWallet(overrides: Partial<CashWalletState> = {}): CashWalletState {
  return {
    walletId: "w-cash",
    name: "Pocket cash",
    createdAt: NOW - 60 * DAY,
    lastReconciledAt: null,
    lastActivityAt: NOW - 1 * DAY,
    lastCashInAt: null,
    ...overrides,
  };
}

/** The repository's own shape, for the pass-level tests. */
function walletRow(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: "w-cash",
    name: "Pocket cash",
    balance: 50000,
    currency: "PHP",
    isArchived: false,
    owedBalance: false,
    owedPinned: false,
    // Zero matchers IS what "cash" means now that the type enum is gone
    // (lib/wallets/summary.ts's `isManualOnly`).
    matcherCount: 0,
    driftDismissedTransactionId: null,
    createdAt: NOW - 60 * DAY,
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * `getSetting` answers PER KEY rather than with one blanket value: the pass
 * reads `onboarding_complete` AND `cash_reconcile_prompt_at`, and a single
 * answer covering both would let the onboarding test pass for the wrong reason.
 * Defaults are the settled state — onboarding done, never prompted.
 */
function withSettings(
  overrides: { onboarding_complete?: boolean; cash_reconcile_prompt_at?: number | null } = {},
): void {
  const values = { onboarding_complete: true, cash_reconcile_prompt_at: null, ...overrides };
  mockGetSetting.mockImplementation((key) =>
    Promise.resolve(values[key as keyof typeof values] as never),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPostAlert.mockResolvedValue("os-id");
  mockSetSetting.mockResolvedValue(undefined);
  withSettings();
  mockListWallets.mockResolvedValue([walletRow()]);
  mockListActivity.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// The three triggers, docs/04-features/02-wallets.md §cash Wallet
// reconciliation rule 1.
// ---------------------------------------------------------------------------

describe("reconcileTriggerFor — which ledger state makes a cash wallet due", () => {
  test("THE WEEKLY SCHEDULE FIRES AT SEVEN DAYS, NOT BEFORE", () => {
    // The acceptance criterion, both sides of the boundary against one fixed
    // clock: eight days since the last reconciliation is due, six is not.
    const overdue = cashWallet({ lastReconciledAt: NOW - 8 * DAY });
    const recent = cashWallet({ lastReconciledAt: NOW - 6 * DAY });

    expect(reconcileTriggerFor(overdue, NOW)).toBe("schedule");
    expect(reconcileTriggerFor(recent, NOW)).toBeNull();
  });

  test("a wallet that has never been reconciled is measured from its own creation", () => {
    // Not from zero, which would make every wallet 56 years overdue the instant
    // it is created, and not from the last activity, which would let a busy
    // wallet postpone its own reconciliation forever.
    expect(reconcileTriggerFor(cashWallet({ createdAt: NOW - 8 * DAY }), NOW)).toBe("schedule");
    expect(reconcileTriggerFor(cashWallet({ createdAt: NOW - 2 * DAY }), NOW)).toBeNull();
  });

  test("A CASH-OUT TRANSFER LINK MAKES THE WALLET DUE IMMEDIATELY", () => {
    // Trigger (b). One hour after the withdrawal, well inside a cadence window
    // that has three days left to run — the calendar has nothing to say yet and
    // the money is already in the user's pocket, uncounted.
    const justWithdrew = cashWallet({
      lastReconciledAt: NOW - 4 * DAY,
      lastCashInAt: NOW - 60 * 60 * 1000,
    });

    expect(reconcileTriggerFor(justWithdrew, NOW)).toBe("cash-out");
  });

  test("a cash-out that was already reconciled is not due again", () => {
    // Otherwise the wallet would be permanently due after its first ATM run:
    // the withdrawal never stops having happened, so the comparison has to be
    // against the reconciliation, not against a window.
    const settled = cashWallet({
      lastCashInAt: NOW - 3 * DAY,
      lastReconciledAt: NOW - 2 * DAY,
    });

    expect(reconcileTriggerFor(settled, NOW)).toBeNull();
  });

  test("FOURTEEN IDLE DAYS ARE DUE EVEN INSIDE THE CADENCE WINDOW", () => {
    // Trigger (c), and the one shape where it says something the weekly rule
    // does not: reconciled two days ago, but no real spending recorded for
    // fifteen. Adjustments are excluded from `lastActivityAt` precisely so
    // answering the prompt cannot reset the idle clock it is measured against.
    const idle = cashWallet({
      lastReconciledAt: NOW - 2 * DAY,
      lastActivityAt: NOW - 15 * DAY,
    });

    expect(reconcileTriggerFor(idle, NOW)).toBe("idle");
  });

  test("A CASH WALLET WITH AN EMPTY LEDGER IS NEVER DUE", () => {
    // The fresh-install guard, and the reason it is a guard and not a side
    // effect of the arithmetic: this wallet is a year old, so both the weekly
    // and the idle rule would otherwise fire. Nothing has ever moved in it, so
    // it still holds exactly the opening balance the user typed and there is
    // nothing to have drifted. Without this, a user who created "Pocket cash"
    // during onboarding and never used it is nagged about it forever.
    const untouched = cashWallet({ createdAt: NOW - 365 * DAY, lastActivityAt: null });

    expect(reconcileTriggerFor(untouched, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The gate and the selection.
// ---------------------------------------------------------------------------

describe("computeNextReconcilePrompt — one prompt, and only once a cadence", () => {
  test("returns the due wallet and the trigger that made it due", () => {
    expect(
      computeNextReconcilePrompt([cashWallet({ lastReconciledAt: NOW - 8 * DAY })], null, NOW),
    ).toEqual({ walletId: "w-cash", walletName: "Pocket cash", trigger: "schedule" });
  });

  test("stays silent while the previous prompt's cadence is still running", () => {
    const due = [cashWallet({ lastReconciledAt: NOW - 30 * DAY })];

    expect(computeNextReconcilePrompt(due, NOW + 1, NOW)).toBeNull();
    expect(computeNextReconcilePrompt(due, NOW, NOW)).not.toBeNull();
  });

  test("ASKS ABOUT ONE WALLET AT A TIME", () => {
    // Three cash wallets that all came due on the same Sunday is within rule
    // 15's "one prompt per Wallet per day" and would still arrive as three
    // notifications at once. The first is asked, the gate closes, the rest come
    // round on later passes.
    const prompt = computeNextReconcilePrompt(
      [
        cashWallet({ walletId: "w-1", name: "Pocket cash", lastReconciledAt: NOW - 9 * DAY }),
        cashWallet({ walletId: "w-2", name: "Wallet cash", lastReconciledAt: NOW - 9 * DAY }),
        cashWallet({ walletId: "w-3", name: "Drawer", lastReconciledAt: NOW - 9 * DAY }),
      ],
      null,
      NOW,
    );

    expect(prompt).toEqual({ walletId: "w-1", walletName: "Pocket cash", trigger: "schedule" });
  });
});

// ---------------------------------------------------------------------------
// The pass — settings gate, posting, and what spends the gate.
// ---------------------------------------------------------------------------

describe("runReconcilePromptPass", () => {
  test("A DUE CASH WALLET IS PROMPTED, AND THE GATE MOVES A FULL CADENCE", () => {
    mockListActivity.mockResolvedValue([
      {
        walletId: "w-cash",
        lastReconciledAt: NOW - 8 * DAY,
        lastActivityAt: NOW - 1 * DAY,
        lastCashInAt: null,
      },
    ]);

    return runReconcilePromptPass(NOW).then((prompt) => {
      expect(prompt).toEqual({
        walletId: "w-cash",
        walletName: "Pocket cash",
        trigger: "schedule",
      });
      expect(mockPostAlert).toHaveBeenCalledTimes(1);
      expect(mockSetSetting).toHaveBeenCalledWith(
        "cash_reconcile_prompt_at",
        NOW + RECONCILE_CADENCE_MS,
      );
    });
  });

  test("A FRESH INSTALL IS NOT PROMPTED", async () => {
    // No cash wallet and no history — the state every install starts in. There
    // is nothing to reconcile and nothing has drifted, so the first thing a new
    // user sees must not be the app asking them to count money it has never
    // seen.
    mockListWallets.mockResolvedValue([]);

    expect(await runReconcilePromptPass(NOW)).toBeNull();
    expect(mockPostAlert).not.toHaveBeenCalled();
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  test("MID-ONBOARDING IS NOT PROMPTED", async () => {
    // Exactly 0f6895d's gate, for the same reason and against the same setting:
    // `completeOnboarding` writes `onboarding_complete` only after the access
    // and alerts steps have both been offered. A wallet that is genuinely
    // overdue by every ledger measure still waits until the user has been
    // introduced to the app.
    withSettings({ onboarding_complete: false });
    mockListActivity.mockResolvedValue([
      {
        walletId: "w-cash",
        lastReconciledAt: NOW - 30 * DAY,
        lastActivityAt: NOW - 1 * DAY,
        lastCashInAt: null,
      },
    ]);

    expect(await runReconcilePromptPass(NOW)).toBeNull();
    expect(mockPostAlert).not.toHaveBeenCalled();
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  test("THE GATE IS SPENT ONLY BY A PROMPT THE OS ACCEPTED", async () => {
    // `postAlert` returns null when notification permission is missing, which on
    // Android 13+ is every install until onboarding's alerts step asks for
    // POST_NOTIFICATIONS. Stamping the gate for a prompt nobody saw would
    // silence the following week's real one over nothing — 0f6895d's second
    // defect, in this feature.
    mockPostAlert.mockResolvedValue(null);
    mockListActivity.mockResolvedValue([
      {
        walletId: "w-cash",
        lastReconciledAt: NOW - 8 * DAY,
        lastActivityAt: NOW - 1 * DAY,
        lastCashInAt: null,
      },
    ]);

    expect(await runReconcilePromptPass(NOW)).toBeNull();
    expect(mockPostAlert).toHaveBeenCalledTimes(1);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  test("a tracked wallet is never prompted, however overdue its ledger looks", async () => {
    // Rule 15: prompts fire only for cash Wallets. A wallet with a matcher is
    // kept honest by the provider's own notifications.
    mockListWallets.mockResolvedValue([walletRow({ matcherCount: 2 })]);
    mockListActivity.mockResolvedValue([
      {
        walletId: "w-cash",
        lastReconciledAt: NOW - 90 * DAY,
        lastActivityAt: NOW - 1 * DAY,
        lastCashInAt: null,
      },
    ]);

    expect(await runReconcilePromptPass(NOW)).toBeNull();
    expect(mockPostAlert).not.toHaveBeenCalled();
  });

  test("a failed read is swallowed, never thrown at the root layout", async () => {
    mockListWallets.mockRejectedValue(new Error("database is not open"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(runReconcilePromptPass(NOW)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// The subscriber — the thing app/_layout.tsx starts.
// ---------------------------------------------------------------------------

describe("startReconcilePromptSubscriber", () => {
  /** Lets a fire-and-forget pass' promise chain run to completion. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  test("checks once at launch", async () => {
    const stop = startReconcilePromptSubscriber();
    await settle();

    expect(mockListWallets).toHaveBeenCalledTimes(1);
    stop();
  });

  test("A LEDGER COMMIT WAKES IT, SO A CASH-OUT IS NOTICED WITHOUT A RELAUNCH", async () => {
    jest.useFakeTimers();
    const stop = startReconcilePromptSubscriber({ debounceMs: 10 });
    await settle();
    mockListWallets.mockClear();

    await emitAppEvent("ledger:committed", { transactionId: "t-1" });
    await emitAppEvent("ledger:committed", { transactionId: "t-2" });
    jest.advanceTimersByTime(10);
    await settle();

    // ONE pass for the burst, not one per commit — trailing-edge debounced.
    expect(mockListWallets).toHaveBeenCalledTimes(1);
    stop();
  });

  test("the teardown cancels a pass that has not fired yet", async () => {
    jest.useFakeTimers();
    const stop = startReconcilePromptSubscriber({ debounceMs: 10 });
    await settle();
    mockListWallets.mockClear();

    await emitAppEvent("ledger:committed", { transactionId: "t-1" });
    stop();
    jest.advanceTimersByTime(50);
    await settle();

    expect(mockListWallets).not.toHaveBeenCalled();
  });
});

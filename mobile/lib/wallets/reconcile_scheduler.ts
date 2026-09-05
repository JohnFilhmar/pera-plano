// lib/wallets/reconcile_scheduler.ts — the half of cash reconciliation that
// ASKS (docs/04-features/02-wallets.md §cash Wallet reconciliation rule 1;
// docs/06-information-architecture.md §4.7 rule 1's "periodic gentle prompt
// when cash activity is stale").
//
// WHAT WAS MISSING. `lib/wallets/reconcile.ts` computes the delta,
// `useReconcileCash` commits it, and the sheet collects the figure — the whole
// answering path works. Nothing ever asked the question. `cash_reconcile_prompt_at`
// was declared in app_settings_repo.ts with a default of `null` and no reader
// and no writer anywhere else in the app, so the schedule the wallet row
// promises ("Manual · reconcile weekly") did not exist and a cash wallet drifted
// for as long as the user let it. Cash sends no notifications; the prompt is the
// only mechanism the app has to notice.
//
// A NUDGE, NOT AN ALARM, and every constant below is chosen that way. The
// cadence is the doc's own stated default (weekly), the idle window is the
// doc's own (14 days), and one prompt at a time is the most the app will ever
// post — see `computeNextReconcilePrompt`.
//
// THE ONBOARDING GATE IS COPIED FROM 0f6895d, deliberately, along with the
// reason: a fresh install must not be greeted by a complaint about a feature it
// has not been offered yet. That commit's second lesson is copied too — the
// suppression timestamp is written ONLY when the OS actually accepted the
// notice, because `postAlert` returns `null` when notification permission is
// missing and a notice nobody saw must not spend the next prompt's slot.
//
// CHANNEL_REMINDERS, AND NOT A NEW CHANNEL. Android channel ids are permanent
// (channels.ts's own header), and docs/06 §6.1's canonical channel table has no
// cash-reconciliation row at all — inventing a permanent id for a type the
// canonical list does not name is the larger mistake. Of the two channels that
// do exist, "reminders" is the quiet one, which is exactly what §4.7 calls this
// prompt: gentle. A follow-up that adds the §6.1 row can promote it then.
import type { AlertCopy } from "@/lib/alerts/alert_copy";
import { postAlert } from "@/lib/alerts/alerts_service";
import { CHANNEL_REMINDERS } from "@/lib/alerts/channels";
import { systemClock } from "@/lib/clock";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import {
  listReconcileActivity,
  listWallets,
  type ReconcileActivity,
} from "@/lib/db/repos/wallets_repo";
import { onAppEvent } from "@/lib/events/app_events";
import type { EpochMs } from "@/types/domain";

import { walletKind } from "./summary";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Trigger (a), verbatim: "a recurring schedule, default weekly, adjustable per
 * Wallet". Seven days, and the per-wallet adjustment is not built here — the
 * doc's own open question 3 asked whether the default should key off income
 * cadence instead, and this module records the answer it shipped with rather
 * than inventing a second one.
 */
export const RECONCILE_CADENCE_MS = 7 * DAY_MS;

/** Trigger (c), verbatim: "after 14 days with no cash activity at all". */
export const RECONCILE_IDLE_MS = 14 * DAY_MS;

/** Which of the doc's three triggers made a wallet due. */
export type ReconcileTrigger = "cash-out" | "schedule" | "idle";

/** One cash wallet's schedule inputs: its own age plus its ledger facts. */
export type CashWalletState = ReconcileActivity & {
  name: string;
  /**
   * When the wallet row was created — the schedule anchor before any
   * reconciliation has happened. Using it rather than 0 is what keeps a wallet
   * made this morning from being a week overdue the moment it exists.
   */
  createdAt: EpochMs;
};

/** The wallet to ask about, and why. */
export type ReconcilePrompt = {
  walletId: string;
  walletName: string;
  trigger: ReconcileTrigger;
};

/**
 * Which trigger makes this one wallet due, or `null` for a wallet that is not.
 *
 * NOTHING IS DUE ON AN EMPTY LEDGER, and this is the first check for a reason.
 * A cash wallet with no transaction at all holds exactly the opening balance the
 * user typed into the wallet form; there is no drift, because nothing has moved.
 * Without this line the very first thing a new user would meet — having just
 * created "Pocket cash" during onboarding — is the app asking them to re-count
 * money it has never seen leave. That is the same defect 0f6895d fixed on the
 * tracking notice, in a different feature.
 *
 * ORDER IS THE DOC'S URGENCY ORDER. A cash-out that has not been reconciled
 * since is the most specific fact available ("you just took out cash"), so it
 * outranks the calendar; the weekly schedule outranks the idle window because it
 * is the shorter of the two.
 */
export function reconcileTriggerFor(wallet: CashWalletState, now: EpochMs): ReconcileTrigger | null {
  if (wallet.lastActivityAt === null) return null;

  // Trigger (b). Compared against the last reconciliation rather than against a
  // time window, so the prompt survives the user ignoring it: cash withdrawn on
  // Monday is still unaccounted for on Friday, and stays due until it is
  // counted.
  if (wallet.lastCashInAt !== null && wallet.lastCashInAt > (wallet.lastReconciledAt ?? 0)) {
    return "cash-out";
  }
  // Trigger (a). Anchored on the last reconciliation, falling back to the
  // wallet's own creation for one that has never been reconciled.
  if (now - (wallet.lastReconciledAt ?? wallet.createdAt) >= RECONCILE_CADENCE_MS) {
    return "schedule";
  }
  // Trigger (c). Only reachable when a reconciliation happened inside the
  // cadence window but no real spending has been recorded since — a wallet the
  // user has quietly stopped entering cash into, which is the highest-drift
  // state there is.
  if (now - wallet.lastActivityAt >= RECONCILE_IDLE_MS) return "idle";

  return null;
}

/**
 * The single prompt to show right now, or `null` when nothing is due or the app
 * is still inside the previous prompt's cadence.
 *
 * `promptAllowedFrom` is `cash_reconcile_prompt_at`: the earliest instant the
 * app may ask again, written one cadence into the future every time a prompt
 * actually lands. `null` is the fresh-install default and means "never asked",
 * which never blocks.
 *
 * ONE PROMPT, NOT ONE PER DUE WALLET. Rule 15 caps this at "one prompt per
 * Wallet per day"; a user with three cash wallets that all came due on the same
 * Sunday would be within that rule and still get three notifications at once,
 * which is an alarm. The first due wallet is asked, the gate closes for a week,
 * and the others come round on later passes — a queue, not a burst.
 *
 * FIRST IN THE LIST WINS, and the caller passes `listWallets`' own order, which
 * is oldest-first. Deterministic, so two passes over the same state never
 * disagree about which wallet is being asked about.
 */
export function computeNextReconcilePrompt(
  wallets: readonly CashWalletState[],
  promptAllowedFrom: EpochMs | null,
  now: EpochMs,
): ReconcilePrompt | null {
  if (promptAllowedFrom !== null && now < promptAllowedFrom) return null;

  for (const wallet of wallets) {
    const trigger = reconcileTriggerFor(wallet, now);
    if (trigger !== null) {
      return { walletId: wallet.walletId, walletName: wallet.name, trigger };
    }
  }
  return null;
}

/**
 * The prompt's copy, docs rule 2's question verbatim ("How much cash do you
 * have right now?").
 *
 * BUILT HERE RATHER THAN IN `alert_copy.ts`'s catalogue, because that catalogue
 * is keyed to docs/06 §6.1's channel table and this prompt has no row there yet
 * (see the file header). It still obeys §7a's two-variant discipline: the
 * wallet's NAME is a fact about the user's money, so it appears only in the
 * unlocked variant, the same way every amount in the catalogue does.
 */
function cashReconcileAlertCopy(walletName: string): AlertCopy {
  const title = "Time for a quick cash check";
  return {
    locked: { title, body: "How much cash do you have right now?" },
    unlocked: { title, body: `How much cash do you have right now? Tap to update ${walletName}.` },
  };
}

/** Cash wallets, each carrying the ledger facts its schedule is computed from. */
async function listCashWalletState(): Promise<CashWalletState[]> {
  const [wallets, activity] = await Promise.all([listWallets(), listReconcileActivity()]);
  const byWallet = new Map(activity.map((row) => [row.walletId, row]));

  // `listWallets()` already drops archived wallets, and `walletKind` is the one
  // place in the app that decides what "cash" means now that the type enum is
  // gone — an owed (credit) wallet is excluded by it too, which is right: rule
  // 15 says prompts fire only for cash Wallets, and a hand-tracked credit card
  // is not a pocket anyone can count.
  return wallets
    .filter((wallet) => walletKind(wallet) === "manual")
    .map((wallet) => {
      const row = byWallet.get(wallet.id);
      return {
        walletId: wallet.id,
        name: wallet.name,
        createdAt: wallet.createdAt,
        lastReconciledAt: row?.lastReconciledAt ?? null,
        lastActivityAt: row?.lastActivityAt ?? null,
        lastCashInAt: row?.lastCashInAt ?? null,
      };
    });
}

/**
 * One scheduling pass: decide whether a cash wallet is due, post the prompt, and
 * close the gate. Resolves to the prompt that was actually shown, or `null`.
 *
 * THE GATE IS ONBOARDING FIRST (0f6895d's precedent). `onboarding_complete` is
 * written by `completeOnboarding` after the access and alerts steps have both
 * been offered; before that the app has no permission to post with and the user
 * has not been introduced to the feature, so a pass that got as far as
 * `postAlert` would either be dropped silently or would interrupt the flow that
 * is still explaining what the app does.
 *
 * THE TIMESTAMP IS WRITTEN ONLY WHEN THE NOTICE LANDED, which is the other half
 * of 0f6895d: `postAlert` returns `null` when notification permission is
 * missing, and stamping the gate for a prompt the OS never drew would silence
 * the next week's real one over nothing.
 *
 * CLOCK-INJECTED like every entry point under lib/ — the whole module is elapsed
 * time arithmetic, and a version that read the wall clock itself could only be
 * tested by waiting a week.
 *
 * A FAILURE HERE IS SWALLOWED. This runs fire-and-forget from the root layout;
 * a database that is not open yet or a refused notification must not reach it.
 */
export async function runReconcilePromptPass(now: EpochMs): Promise<ReconcilePrompt | null> {
  try {
    const [onboardingComplete, promptAllowedFrom] = await Promise.all([
      getSetting("onboarding_complete"),
      getSetting("cash_reconcile_prompt_at"),
    ]);
    if (!onboardingComplete) return null;

    const prompt = computeNextReconcilePrompt(
      await listCashWalletState(),
      promptAllowedFrom,
      now,
    );
    if (prompt === null) return null;

    const id = await postAlert({
      channel: CHANNEL_REMINDERS,
      copy: cashReconcileAlertCopy(prompt.walletName),
      // `kind` is the discriminant `lib/alerts/alert_routes.ts` switches on.
      // That resolver does not know this kind yet, so a tap lands on its
      // documented fallback (Home) rather than on the wallet — which is where
      // every alert in the app lands today, because nothing registers a
      // notification-response listener at all (alert_routes.ts's own header).
      // Adding the case belongs with whoever wires that listener.
      data: { kind: "cashReconcile", walletId: prompt.walletId, trigger: prompt.trigger },
    });
    if (id === null) return null;

    // The gate moves a full cadence, not a day: being asked IS the prompt, so
    // answering it, snoozing it, or ignoring it all push the next one to the
    // same place. Answering additionally moves the wallet's own anchor, because
    // the adjustment it writes becomes `lastReconciledAt`.
    await setSetting("cash_reconcile_prompt_at", now + RECONCILE_CADENCE_MS);
    return prompt;
  } catch (error) {
    console.warn("the cash reconcile check failed; the app runs without it", error);
    return null;
  }
}

/**
 * Long enough to swallow a drained capture burst, short enough that the cash-out
 * leg of an ATM withdrawal is noticed while the user is still standing at the
 * machine. The same window `limit_ledger_subscriber.ts` uses, for the same
 * reason.
 */
const DEFAULT_DEBOUNCE_MS = 750;

/**
 * Checks on launch and after every debounced ledger commit, posting the cash
 * reconciliation prompt when one is due. Returns the teardown, which also
 * cancels a pass still waiting to fire.
 *
 * TWO WAKE-UPS, BECAUSE THE TRIGGERS SPLIT THAT WAY. The calendar ones (weekly,
 * 14 idle days) come true while the app is closed and are caught at launch; the
 * cash-out one comes true the instant a transfer leg commits, and waiting until
 * the next launch to notice it would miss the whole point of asking "right
 * after" the withdrawal.
 */
export function startReconcilePromptSubscriber(options: { debounceMs?: number } = {}): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let pending: ReturnType<typeof setTimeout> | null = null;

  void runReconcilePromptPass(systemClock.now());

  const unsubscribe = onAppEvent("ledger:committed", () => {
    // Restarting the timer rather than letting the first one stand is what makes
    // this trailing-edge: a drained burst of fifty commits schedules one pass,
    // and that pass sees all fifty.
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void runReconcilePromptPass(systemClock.now());
    }, debounceMs);
  });

  return () => {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    unsubscribe();
  };
}

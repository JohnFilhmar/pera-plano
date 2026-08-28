// lib/onboarding/wallet_draft.ts — what the wallet step is holding for the
// user while they are still inside onboarding.
//
// WHY THIS EXISTS AT ALL. app/(onboarding)/wallets.tsx keeps its whole list —
// which providers are proposed, what the user renamed them to, what they keyed
// in for "what's in it right now" — in component state, and a route's
// component state dies the moment the route unmounts. The step after it is a
// `router.push`, so the user who continues, realises on the NEXT screen that
// they forgot a wallet, and comes back finds a list rebuilt from scratch:
// every balance they typed replaced by a blank field. They then have to type
// it all again to add the one wallet they came back for — which is the bug
// this module exists to end (owner's report, 2026-08-28).
//
// DELIBERATELY IN MEMORY, NOT IN THE DATABASE.
// lib/onboarding/onboarding_state.ts's own header sets the rule this follows:
// "PROGRESS IS NOT PERSISTED ... quitting mid-flow restarts at welcome."
// A draft that outlived the process would be exactly the durable cursor that
// header refuses — a value written by one app version and read by another,
// with no way to tell "abandoned" from "mid-step". A module-level variable
// dies with the process, so a relaunch still starts clean; it only has to
// survive an unmount inside one run of the flow, which is all the bug needs.
//
// NOT A SUBSTITUTE FOR READING THE DATABASE. Wallets the step already CREATED
// are recovered from `useWallets`, not from here (see `reconcileWithExisting`
// in app/(onboarding)/wallets.tsx): they are real rows, and the database is
// the only thing that can still be right about them after a relaunch. This
// draft carries the UNSAVED half — edits, unchecks, quick-added chips — which
// nothing else has a record of.
import type { WalletProposal } from "@/components/onboarding/quick_wallet_list";
import type { ProviderChoice } from "@/lib/ingest/provider_catalogue";
import type { NewWalletMatcher } from "@/types/domain";

export type WalletStepDraft = {
  proposals: WalletProposal[];
  /** The quick-add chips still unspent — a chip the user already tapped must
   * not come back as tappable when they return to the step. */
  addable: ProviderChoice[];
  /** Each proposal's full matcher set, keyed by proposal key. Re-deriving it
   * on restore would need the ruleset again; carrying it costs nothing. */
  pendingMatchers: Record<string, NewWalletMatcher[]>;
};

let draft: WalletStepDraft | null = null;

/** What the step was last showing, or `null` on the first visit of this run. */
export function readWalletDraft(): WalletStepDraft | null {
  return draft;
}

export function writeWalletDraft(next: WalletStepDraft): void {
  draft = next;
}

/**
 * Forgets the draft. Called when onboarding actually finishes
 * (app/(onboarding)/done.tsx) so a user who re-enters the flow later — a
 * reset, a second profile — never meets the previous run's half-finished list,
 * and so each test in a suite starts from an empty step.
 */
export function clearWalletDraft(): void {
  draft = null;
}

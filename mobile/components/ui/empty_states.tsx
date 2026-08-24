// components/ui/empty_states.tsx — the empty-state copy catalogue (m3c Task 8;
// docs/06-information-architecture.md §5).
//
// THIS IS A SURVEY, NOT A REWRITE. The audit for this task found that most of
// the app's lists already ship a distinct, useful empty state — Wallets,
// Limits, Goals, Loans, Bills, the Review Queue, Reports, and the ledger
// (Transactions) all render one today, each with its own copy chosen by the
// task that shipped that screen. Changing working, tested copy for the sake
// of centralising it would be a net loss (per this task's own brief), so this
// file does not replace any of those — it TRANSCRIBES their copy into one
// place a test can scan for the two invariants IA §5 cares about (every
// catalogued screen has real copy; no two share it), and adds the ONE entry
// this audit found genuinely missing: Home's "no transactions yet" state
// (IA §5's first row), wired into `app/(tabs)/index.tsx` below.
//
// WHY TRANSCRIBED RATHER THAN RE-EXPORTED. Most of the eight already-shipped
// screens inline their copy as JSX string literals rather than named
// exported constants (`app/(tabs)/plan/limits.tsx` is typical: `title="Set
// your first limit"` directly in the `<EmptyState>` call). Re-exporting a
// shared binding would mean adding an export to every one of those files for
// a value nothing else needs — the definition of "rewriting what works" this
// task was told to avoid. Transcribing costs one thing: if a screen's inline
// copy is edited later without updating its mirror here, the catalogue and
// the screen can drift. That is judged the smaller risk against touching
// eight already-correct, already-tested screens to chase single-source-of-
// truth purity.
//
// NOT EVERY EmptyState IN THE APP IS HERE. Several screens (wallet, loan,
// bill, goal, and transaction detail) show a distinct "this was deleted / not
// found" state — good, useful, on-brand copy — but IA §5's table is
// specifically about EMPTY LISTS, and a deleted-detail state answers a
// different question ("where did it go") than an empty list does ("there is
// nothing here yet"). They are deliberately left out of the uniqueness scan
// below for that reason, not overlooked.
/** One catalogued screen's empty-state copy. `actionLabel` is optional — the
 * Review Queue's "all caught up" state deliberately has none (IA §5). */
export type EmptyStateEntry = {
  /** Stable lookup key, not shown to the user. */
  screen: string;
  title: string;
  body: string;
  actionLabel?: string;
};

/**
 * One entry per IA §5 table row, in the doc's own order. `screen` is a stable
 * key (not shown to the user) the audit test iterates and any future screen
 * can look itself up by.
 */
export const EMPTY_STATE_CATALOGUE: readonly EmptyStateEntry[] = [
  {
    screen: "home",
    title: "Watching for your first transaction",
    body: "Pay with GCash or your bank as usual — we'll catch it automatically.",
    actionLabel: "Add manually",
  },
  {
    screen: "transactions",
    // Mirrors `LEDGER_EMPTY_TITLE`/`LEDGER_EMPTY_BODY`
    // (components/transactions/ledger_list.tsx) — see this file's header.
    // THIS IS THE "BOTH EMPTY" CASE ONLY (task-7-brief.md rule 1): when the
    // ledger is empty but the review queue is not, ledger_list.tsx renders a
    // different, queue-aware body instead (`ledgerEmptyReviewPendingBody`).
    // That variant is deliberately NOT a second catalogue row — it is a
    // situational refinement of this same screen's empty state, the kind of
    // thing this file's header already excludes ("NOT EVERY EmptyState IN
    // THE APP IS HERE"), not a ninth IA §5 row.
    title: "Nothing tracked yet",
    body: "Your transactions will appear here automatically.",
    actionLabel: "Add manual Transaction",
  },
  {
    screen: "reviewQueue",
    // Mirrors `REVIEW_EMPTY_TITLE`/`REVIEW_EMPTY_BODY` (app/review/index.tsx).
    // NO ACTION — IA §5: "(state, not error)"; there is nothing to offer.
    title: "All caught up.",
    body: "PeraPlano only asks when it isn't sure. Right now, nothing needs a second look.",
  },
  {
    screen: "wallets",
    // Mirrors app/(tabs)/wallets.tsx.
    title: "Add your first Wallet",
    body: "Start with the bank or e-wallet you use most.",
    actionLabel: "Add Wallet",
  },
  {
    screen: "planLimits",
    // Mirrors app/(tabs)/plan/limits.tsx.
    title: "Set your first limit",
    body: "A cap on spending for a day, week, month, or year — PeraPlano watches it for you.",
    actionLabel: "Add a limit",
  },
  {
    screen: "planGoals",
    // Mirrors app/(tabs)/plan/goals.tsx.
    title: "No goals yet",
    body: "Name something you are saving for and PeraPlano will track it against a savings account.",
    actionLabel: "Create a goal",
  },
  {
    screen: "planLoans",
    // Mirrors app/(tabs)/plan/loans.tsx.
    title: "No loans tracked",
    body: "Track what you owe and what people owe you — including utang with no fixed terms.",
    actionLabel: "Add a loan",
  },
  {
    screen: "planBills",
    // Mirrors app/(tabs)/plan/bills.tsx.
    title: "No bills tracked yet",
    body: "Add the ones you never want to miss — rent, Meralco, tuition, a subscription.",
    actionLabel: "Add a bill",
  },
  {
    screen: "moreReports",
    // Mirrors app/(tabs)/more/reports.tsx's `EMPTY_TITLE` plus its inline body.
    title: "No transactions in this period.",
    body: "Nothing was tracked in this range yet.",
    actionLabel: "View Transactions",
  },
] as const;

/**
 * Looks an entry up by its `screen` key. Throws on a miss rather than
 * returning `undefined` — a screen that asks the catalogue for copy and gets
 * nothing back would otherwise render a blank space with no test able to
 * catch it before a device does.
 */
export function getEmptyStateCopy(screen: string): EmptyStateEntry {
  const entry = EMPTY_STATE_CATALOGUE.find((candidate) => candidate.screen === screen);
  if (entry === undefined) {
    throw new Error(`empty_states: no catalogue entry for screen "${screen}"`);
  }
  return entry;
}

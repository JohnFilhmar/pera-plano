// app/review/index.tsx — the Review Queue (m1c plan Task 9;
// docs/04-features/08-review-queue.md).
//
// THE PRESSURE VALVE OF THE INGEST PIPELINE. Everything the pipeline could not
// commit with confidence waits here for a one-or-two-tap human decision, and the
// alternative to this screen is not "fewer cards" — it is the gate guessing, and
// wrong rows landing silently in a ledger the user has no reason to doubt (top
// risk 4).
//
// TWO FAILURE MODES OUTRANK EVERYTHING VISUAL, AND BOTH ARE STRUCTURAL:
//
//   A CARD WITH NO EXPLANATION trains the user to tap through without reading.
//   The queue then still clears, still shows zero, and has become a rubber
//   stamp — the same wrong data as a lax gate, with a confirmation attached.
//   `review_card.tsx` is where that is prevented; this screen's part is simply
//   never rendering a card any other way.
//
//   A QUEUE THAT GROWS stops being triage and becomes a second inbox nobody
//   opens. That is why the order here is OLDEST FIRST and not negotiable: a
//   newest-first queue guarantees that its oldest item is the one nobody ever
//   reaches, sinking a row with every capture until it expires unread at 30 days
//   and is discarded without ever having been seen.
//
// A THIRD FAILURE MODE, ADDED HERE BECAUSE IT IS THE FIRST TWO AT SCALE: THE
// QUEUE RENDERED ALL AT ONCE. This screen originally mapped every open item
// into one `ScrollView` — a `ReviewCard` per row, each a full parse breakdown
// with its own per-kind body and up to three buttons. That is fine at the
// spec's "Normal" size (1–25 items) and wrong at every size past it: the first
// frame costs the whole queue, and 200 mixed cards on one rope is not triage,
// it is the second inbox the note above warns about, wearing a scrollbar.
//
// So the list is PAGED and FILTERABLE, and both are reads, not renderings:
//
//   PAGING IS KEYSET, ONE PAGE PER SPEC-SIZED QUEUE (`REVIEW_PAGE_SIZE` = 25).
//   The cursor is the last row actually shown, never an offset — every action
//   on this screen resolves an item out of the very predicate the pagination
//   runs over, and an offset would skip whatever slid across the page boundary
//   in between. Silently. See `ReviewCursor` in review_queue_repo.ts.
//
//   FILTERING IS BY KIND, IN THE QUERY. `listOpenPage` takes the kinds, so a
//   page of "possible duplicates" is 25 duplicates. Narrowing the fetched page
//   client-side instead would return 3-row pages and, worse, an EMPTY first
//   page for any kind absent from the oldest 25 — a screen saying "none of
//   these" over a queue full of them.
//
// NEITHER TOUCHES THE ORDER. Pages concatenate oldest-first because page 2
// starts where page 1 ended, and `sortOldestFirst` still runs over the result.
//
// THIN BY DESIGN. Grouping, copy and per-kind layout live in the components; the
// screen resolves the four collections its cards need, picks the filter, and
// orders the list. Global Constraints: hooks only, no repository import, no
// SQL — the page size lives in the repository and the hook, never here.
import { ChevronLeft } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CorrectSheet } from "@/components/review/correct_sheet";
import { loanCandidates, ReviewCard } from "@/components/review/review_card";
import { ReviewFilterBar } from "@/components/review/review_filter_bar";
import { Button, registerIcon } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { REVIEW_KIND_LABELS } from "@/constants/review_kinds";
import { useReviewAction, type ReviewAction } from "@/hooks/mutations/use_review_action";
import { useCategories } from "@/hooks/queries/use_categories";
import { useReviewKindCounts } from "@/hooks/queries/use_review_kind_counts";
import { useReviewQueuePage } from "@/hooks/queries/use_review_queue_page";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallets } from "@/hooks/queries/use_wallets";
import type { ReviewKind, ReviewQueueItem } from "@/types/domain";

const BackGlyph = registerIcon(ChevronLeft);

export const REVIEW_QUEUE_TITLE = "Review queue";

/**
 * Rule 6's empty state, in the SPEC's words.
 *
 * docs/04-features/08-review-queue.md §UX states writes it with the full stop —
 * `"All caught up."` — where the m1c plan drops it; Global Constraints give the
 * spec the tie. The same row calls it a reward: "absence of work is the reward".
 *
 * So this is the one empty state in the app that is allowed to feel good, and it
 * keeps the paper-airplane mark (`EmptyState`'s default) rather than the spec's
 * bare line — the spec's "no empty-state artwork" clause is explicitly scoped to
 * *inside the ledger*, where the queue appears as a collapsed row, not to this
 * screen, which a user reached by asking for it and should not find blank.
 *
 * There is NO ACTION BUTTON. docs/06-information-architecture.md §5: empty
 * states are "calm, not salesy". There is also nothing to offer — the queue
 * fills by itself or not at all.
 */
export const REVIEW_EMPTY_TITLE = "All caught up.";
export const REVIEW_EMPTY_BODY =
  "PeraPlano only asks when it isn't sure. Right now, nothing needs a second look.";

/**
 * The OTHER empty state — a filter with nothing behind it, which is a
 * completely different fact about the world and must never borrow the reward
 * above.
 *
 * "All caught up." under an active filter is a lie the user has no way to
 * catch: thirty cards can be waiting one chip away while the screen
 * congratulates them for an empty queue. The same distinction
 * `ledger_list.tsx` draws between "nothing tracked yet" and "nothing matches
 * this filter", for the same reason — an empty list has to say WHY it is
 * empty, or the user reads it as data loss.
 *
 * The body names the way out, and the chip row above it is still on screen
 * with the selected chip showing its own zero (see review_filter_bar.tsx on
 * why that chip survives at zero).
 */
export const REVIEW_FILTERED_EMPTY_TITLE = "Nothing of this kind.";
export function reviewFilteredEmptyBody(kind: ReviewKind): string {
  return `No "${REVIEW_KIND_LABELS[kind]}" items are waiting. Tap All to see the rest of the queue.`;
}

/**
 * docs/04-features/08-review-queue.md §UX states, "Backlog" row, in the spec's
 * own words — shown above the list once the queue passes 25 open items.
 *
 * IT IS NOT A SCOLDING. The sentence blames the parsers, and it should: a
 * backlog means the pipeline stopped recognizing something it used to, and the
 * user's only fault is having kept using their bank. The chips directly above
 * are the "grouped triage" the same spec row offers alongside this line.
 */
export const REVIEW_BACKLOG_THRESHOLD = 25;
export const REVIEW_BACKLOG_BANNER =
  "That's a lot of unreviewed items — parsers may be out of date.";

/**
 * Oldest first (rule 2), sorted HERE rather than trusted from the caller.
 *
 * `listOpen` already returns `ORDER BY created_at ASC`, so relying on it would
 * pass every test written against the repository's output — and silently invert
 * the queue the first time anything else feeds this list: a cached array
 * restored by the persister, a client-side filter, an optimistic insert after a
 * Task 10 resolution. The cost of being wrong is invisible (nothing throws; the
 * oldest item just quietly rots at the bottom until it expires), which is
 * exactly the kind of bug worth three lines of defence.
 *
 * The id breaks a `createdAt` tie so the order is stable: `startIngest` drains
 * up to 500 buffered captures in one pass and several can be enqueued within the
 * same millisecond, and an unstable sort there would reshuffle the visible queue
 * on every refetch under the user's thumb.
 */
export function sortOldestFirst(items: readonly ReviewQueueItem[]): ReviewQueueItem[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * What the PRIMARY button on each kind of card actually does (rule 4's pairs, in
 * the spec's wording — see `REVIEW_ACTIONS`).
 *
 *   "Looks right"                  → commit exactly what was proposed.
 *   "Same transaction"             → discard the HELD twin. The DedupeGate never
 *                                    committed it, so there is nothing to delete
 *                                    and the committed original is untouched
 *                                    (rule 10). `mergeDuplicate` is the ledger's
 *                                    merge, for two rows that are both already
 *                                    committed.
 *   "It's a transfer"              → commit the queued leg AND pair it, in one
 *                                    write; a commit that failed to pair would
 *                                    leave an internal movement inflating spend.
 *   "This is a money notification" → open the assisted form, which is the only
 *                                    way the missing amount and wallet can be
 *                                    supplied.
 */
function primaryActionFor(item: ReviewQueueItem): ReviewAction | "correct" | null {
  switch (item.kind) {
    case "low-confidence":
      return { kind: "confirm", itemId: item.id };
    case "possible-duplicate":
      return { kind: "dismiss", itemId: item.id };
    case "ambiguous-transfer":
      return { kind: "confirm-transfer", itemId: item.id };
    case "unknown-provider":
      return "correct";
    case "loan-match": {
      // `null` WHEN THERE IS A CHOICE TO MAKE — loans rule 9: "If two or more
      // open loans are plausible for one Transaction, it is always a suggestion
      // listing the candidates — never an auto-match." Returning the
      // top-scoring loan here would make the primary button an auto-match
      // wearing a confirmation: one tap, no statement of which loan, and a
      // balance the user has no reason to go back and check.
      //
      // `null` reaches `ReviewCard` as an ABSENT `onPrimary`, which that file's
      // own rule renders as disabled-but-visible — so the pair still shows what
      // the outcomes are, and `LoanMatchBody` renders the per-loan buttons that
      // actually pick one.
      const candidates = loanCandidates(item);
      if (candidates.length !== 1) return null;
      return { kind: "confirm-loan-match", itemId: item.id, loanId: candidates[0].loanId };
    }
    case "one-sided-transfer":
      // `null` FOR THE SAME REASON `loan-match` RETURNS IT ABOVE — the choice
      // (which wallet the other leg belongs to) is the card's to make, not a
      // single answer this function could stand for. Unlike `loan-match`
      // there is no "exactly one candidate" shortcut either: every unarchived
      // wallet is a candidate, and picking one for the user would mint a
      // ledger row on an account they never named. Task 12's card dispatches
      // the real action through `onChooseTransferWallet` once a wallet is
      // chosen; this function is never the path for it.
      return null;
    case "wallet-kind-unclear":
      // "Money I have" — the user confirming the assumption the app has been
      // running on since this wallet was created. It PINS rather than merely
      // agreeing, which is why it is a real action and not a dismissal: a
      // wallet its owner has vouched for must not be flipped later by a run
      // of odd notifications.
      return { kind: "answer-wallet-kind", itemId: item.id, owed: false };
  }
}

/**
 * And the SECONDARY.
 *
 *   "Correct"        → the form. Rule 5: the only action that opens one.
 *   "Different"      → commit the held twin as its own Transaction. Two genuine
 *                      ₱1,250.00 purchases minutes apart are a real thing, and
 *                      the gate holding the second one was a question.
 *   "Not a transfer" → commit the queued leg unpaired; both legs then count
 *                      normally, which is what "not a transfer" means.
 *   "Not money"      → discard the capture. NOT the mute: spec §"unknown
 *                      provider" step 5 offers "always ignore notifications like
 *                      this" only after the SECOND dismissal of the same source,
 *                      and creating an ignore rule on the first would silence an
 *                      app on one tap the user cannot see the consequence of.
 */
function secondaryActionFor(item: ReviewQueueItem): ReviewAction | "correct" {
  switch (item.kind) {
    case "low-confidence":
      return "correct";
    case "possible-duplicate":
    case "ambiguous-transfer":
      return { kind: "confirm", itemId: item.id };
    case "unknown-provider":
      return { kind: "dismiss", itemId: item.id };
    case "loan-match":
      // "Not a loan payment" — and NOTHING ELSE (loans rule 10: "Rejecting a
      // suggestion never creates a negative UserRule automatically"). The
      // transaction stays exactly where it is, committed and counted; only the
      // question goes away. That rule's follow-up — a one-time "stop suggesting
      // this merchant for this loan?" after repeated rejections — needs a
      // rejection count per merchant-loan pair that nothing stores yet, and
      // writing an `ignore` rule here instead would silence a real repayment
      // the user only meant to skip once.
      return { kind: "dismiss", itemId: item.id };
    case "one-sided-transfer":
      // "Not a transfer" — commit the captured leg UNPAIRED, exactly what
      // `ambiguous-transfer`'s own secondary does above, and for the same
      // reason: the money already parsed and moved, so the honest way to
      // decline "is this half of a transfer?" is to let it count normally on
      // its own, not to discard it. `confirm` with no counterpart is that.
      return { kind: "confirm", itemId: item.id };
    case "wallet-kind-unclear":
      // "Money I owe" — the ONLY secondary in this queue that is not a
      // rejection, a correction or a way out. It is the other half of a
      // two-answer question, and it is exactly as final as the primary: both
      // pin the wallet. Rendering it in the secondary slot is a layout
      // decision, not a statement that this answer is the lesser one.
      return { kind: "answer-wallet-kind", itemId: item.id, owed: true };
  }
}

/**
 * The reject affordance (task 4a) — `null` for a kind whose own pair already
 * offers a way out, or that must never offer one at all.
 *
 *   `low-confidence`     → the only kind with no rejection anywhere in its
 *                          pair ("Looks right" / "Correct" both keep the
 *                          card's proposal alive), and the one kind that can
 *                          be pure noise: a failed parse, an unmapped wallet,
 *                          a foreign currency PeraPlano cannot read at all.
 *                          Ten such rows sat in the owner's queue with no way
 *                          to clear them — this is that way.
 *   `possible-duplicate` → its PRIMARY ("Same transaction") already discards
 *                          the held twin; a second "Not money" button would
 *                          be a second way to do what one button already
 *                          does.
 *   `unknown-provider`   → its SECONDARY IS "Not money" (`REVIEW_ACTIONS`) —
 *                          the exact outcome this function exists to add
 *                          elsewhere is already that card's own pair.
 *   `ambiguous-transfer` → real money moved and the amount parsed; the open
 *                          question is HOW to record it (as a transfer or
 *                          not), never WHETHER. Dismissing would lose a real
 *                          transaction, so this kind deliberately gets none —
 *                          not an oversight, the one case reject must refuse.
 *   `loan-match`         → its SECONDARY is the rejection ("Not a loan
 *                          payment", `REVIEW_ACTIONS`), exactly as
 *                          `unknown-provider`'s is. A third button repeating
 *                          it would ask the user to work out which of two
 *                          identical outcomes they meant.
 *   `one-sided-transfer` → same call as `ambiguous-transfer`, and for the
 *                          identical reason: real money moved and parsed, so
 *                          the open question is HOW to record it (paired or
 *                          not), never WHETHER. Its own secondary ("Not a
 *                          transfer") is already the honest way to decline.
 */
function rejectActionFor(item: ReviewQueueItem): ReviewAction | null {
  return item.kind === "low-confidence" ? { kind: "dismiss", itemId: item.id } : null;
}

export default function ReviewQueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // The kind chip currently selected, `null` for the whole queue. It lives here
  // rather than inside the bar because it KEYS THE QUERY — the filter is a
  // different read, not a different rendering of one read (see
  // use_review_queue_page.ts on why narrowing after the page was cut returns
  // short pages and phantom empty states).
  const [kind, setKind] = useState<ReviewKind | null>(null);

  const queue = useReviewQueuePage(kind === null ? undefined : [kind]);
  const { data: counts } = useReviewKindCounts();
  const { data: wallets } = useWallets();
  const { data: categories } = useCategories();
  const { data: ruleset } = useRuleset();
  const triage = useReviewAction();

  // The item whose correction form is open, held by ID rather than by object so
  // a refetch that replaces the array cannot leave a stale copy on screen.
  const [correcting, setCorrecting] = useState<string | null>(null);

  // Pages concatenate in arrival order, which IS queue order — page 2 begins
  // where page 1 ended. `sortOldestFirst` still runs over the result for the
  // reason its own docblock gives: the guarantee is worth three lines and does
  // not depend on trusting every future feeder of this list.
  const ordered = useMemo(
    () =>
      queue.data === undefined
        ? undefined
        : sortOldestFirst(queue.data.pages.flatMap((page) => page.items)),
    [queue.data],
  );
  const correctingItem = ordered?.find((entry) => entry.id === correcting) ?? null;

  // The whole queue, not the filtered slice: the backlog banner is a statement
  // about how much is waiting in total, and hiding it behind a chip that
  // narrows to three items would suppress it exactly when it is most true.
  const openTotal = useMemo(
    () =>
      counts === undefined
        ? undefined
        : Object.values(counts).reduce((sum, count) => sum + count, 0),
    [counts],
  );
  // How many of the CURRENT filter are still unfetched, for the footer's label.
  // `undefined` whenever the counts have not loaded or the arithmetic would
  // disagree with `hasNextPage` — a button that promises "0 more" and then
  // produces 25 is worse than one that just says "Show more".
  const shown = ordered?.length ?? 0;
  const filteredTotal = counts === undefined ? undefined : kind === null ? openTotal : counts[kind];
  const remaining =
    filteredTotal === undefined || filteredTotal - shown <= 0 ? undefined : filteredTotal - shown;

  const dispatch = useCallback(
    (action: ReviewAction | "correct", item: ReviewQueueItem): void => {
      if (action === "correct") {
        setCorrecting(item.id);
        return;
      }
      triage.mutate(action);
    },
    [triage],
  );

  return (
    // Insets, not a header: this screen runs `headerShown: false` and is NOT
    // inside the tab navigator, so nothing above it clears either system bar —
    // its own back button would sit under the status bar and the last review
    // card under Android's navigation bar (app.json `edgeToEdgeEnabled`). The
    // inner `pt-4`/`pb-8` stay as design padding on top of the system bars,
    // which only works because the insets go on this padding-free outer View:
    // a `style` prop replaces, rather than adds to, what `className` compiles.
    <View
      testID="review-queue-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center gap-2 px-2 pb-2 pt-4">
        <Pressable
          testID="review-queue-back"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <BackGlyph size={24} className="text-fg dark:text-fg-dark" />
        </Pressable>
        {/* `text-title font-bold` (task-4b) — the app's own header scale
            (EmptyState's title uses the same pair), replacing the unscaled
            `text-xl font-semibold` this shipped with.

            THE TEXT ITSELF STAYS "Review queue", not the brief's "Needs
            review" — docs/04-features/08-review-queue.md's own H1 is
            "# Review Queue", and this constant already matched it before
            this task touched the file. Nothing pins the string either way
            (no test in this suite or `review_queue.test.tsx` reads
            `REVIEW_QUEUE_TITLE`), so this is a copy decision, not a test
            constraint — and where a restyle's suggested label and the
            feature's own spec disagree, the spec wins. */}
        <Text className="text-title font-bold text-fg dark:text-fg-dark">
          {REVIEW_QUEUE_TITLE}
        </Text>
      </View>

      {/* Outside the list, so the chips stay reachable however far down the
          queue the user has scrolled — the same call
          app/(tabs)/transactions.tsx makes about its own filter bar. It
          renders nothing at all while there is only one kind waiting (see
          review_filter_bar.tsx). */}
      <ReviewFilterBar counts={counts} selected={kind} onChange={setKind} />

      {openTotal !== undefined && openTotal > REVIEW_BACKLOG_THRESHOLD ? (
        <View
          testID="review-backlog-banner"
          // `bg-chip`, not a warn tint: the app has no opaque `warn-soft`
          // token (constants/colors.ts — only `brand-soft` is real), and a
          // yellow slab over a queue of honest questions would recolour the
          // pipeline's correct refusal to guess as a fault the user caused.
          // The sentence carries the message; the surface stays calm.
          className="mx-4 mt-2 rounded-xl bg-chip px-4 py-3 dark:bg-chip-dark"
        >
          <Text className="text-body text-fg dark:text-fg-dark">{REVIEW_BACKLOG_BANNER}</Text>
        </View>
      ) : null}

      {ordered === undefined ? (
        // Nothing at all until the first read resolves. Flashing "All caught up."
        // on every cold start would congratulate the user for work they have not
        // done, and the correction a frame later reads as data appearing from
        // nowhere.
        <View testID="review-queue-loading" className="flex-1">
          <LoadingSkeleton rows={5} />
        </View>
      ) : ordered.length === 0 ? (
        <View className="flex-1 justify-center">
          {kind === null ? (
            <EmptyState
              testID="review-queue-empty"
              title={REVIEW_EMPTY_TITLE}
              body={REVIEW_EMPTY_BODY}
            />
          ) : (
            // NOT the reward. See `REVIEW_FILTERED_EMPTY_TITLE` — "All caught
            // up." over an active filter would congratulate the user while
            // thirty cards wait one chip away.
            <EmptyState
              testID="review-queue-empty-filtered"
              title={REVIEW_FILTERED_EMPTY_TITLE}
              body={reviewFilteredEmptyBody(kind)}
              action={{ label: "Show all", onPress: () => setKind(null) }}
            />
          )}
        </View>
      ) : (
        <FlatList
          testID="review-queue-list"
          data={ordered}
          keyExtractor={(entry) => entry.id}
          contentContainerClassName="pb-8 pt-1"
          // `FlatList` REPLACED A `ScrollView` HERE, and the two layers are not
          // redundant. Paging bounds what is FETCHED and held in memory (25
          // rows, not 500); virtualization bounds what is MOUNTED inside that
          // page. A `ReviewCard` is a heavy row — a parse breakdown, a per-kind
          // body, up to three buttons — so a page rendered whole still costs 25
          // of them on the first frame. React Native's default
          // `initialNumToRender` (10) is deliberately left alone: it is already
          // well past a phone's viewport for rows this tall, and pinning it to
          // the page size would hand back exactly the cost this list exists to
          // avoid.
          //
          // Redraw the rows when the filter changes — `renderItem` closes over
          // `dispatch`, and a `FlatList` that never hears about a new closure
          // is how a stale handler survives a filter change.
          extraData={kind}
          ListFooterComponent={
            queue.hasNextPage ? (
              <View className="px-4 pt-2">
                {/* AN EXPLICIT BUTTON, NOT `onEndReached`. Auto-loading on
                    scroll is the smoother pattern for a feed, and this is not
                    a feed: it is a work list the user is trying to reach the
                    END of. A queue that grows another 25 rows every time the
                    bottom comes into view never visibly shrinks no matter how
                    many cards are triaged, which is the exact "second inbox
                    nobody opens" feeling this screen's header warns about.
                    The count on the label is the point — it is the only place
                    in the app that says how much work is actually left. */}
                <Button
                  testID="review-queue-load-more"
                  variant="secondary"
                  title={remaining === undefined ? "Show more" : `Show ${remaining} more`}
                  loading={queue.isFetchingNextPage}
                  disabled={queue.isFetchingNextPage}
                  onPress={() => void queue.fetchNextPage()}
                />
              </View>
            ) : null
          }
          renderItem={({ item: entry }) => {
              // Resolved once per entry rather than inline in `onReject`
              // below: the prop must be `undefined` (not a handler that
              // happens to no-op) whenever this kind has none, because
              // review_card.tsx renders NOTHING for an absent `onReject` —
              // see its header on why that is the opposite of the pair's
              // "absent means disabled" rule.
              const rejectAction = rejectActionFor(entry);
              // Same treatment, one kind further: `null` here means this card
              // has no single answer its primary could stand for (a
              // `loan-match` listing two or more loans), so the handler is
              // WITHHELD rather than supplied-and-inert — which is what makes
              // the button render disabled instead of picking a loan silently.
              const primaryAction = primaryActionFor(entry);
              return (
                <ReviewCard
                  item={entry}
                  wallets={wallets}
                  categories={categories}
                  providers={ruleset?.providers}
                  // Supplying the handlers is what lights the pair up:
                  // without them the card renders DISABLED rather than
                  // live-but-inert — see review_card.tsx's header on why a
                  // dead tap on a money decision is the one affordance worth
                  // withholding.
                  onPrimary={
                    primaryAction === null ? undefined : (item) => dispatch(primaryAction, item)
                  }
                  onSecondary={(item) => dispatch(secondaryActionFor(item), item)}
                  onReject={
                    rejectAction === null ? undefined : (item) => dispatch(rejectAction, item)
                  }
                  onChooseLoan={(item, loanId) =>
                    triage.mutate({ kind: "confirm-loan-match", itemId: item.id, loanId })
                  }
                  onChooseTransferWallet={(item, walletId, feeAmount) =>
                    triage.mutate({
                      kind: "confirm-one-sided-transfer",
                      itemId: item.id,
                      counterpartWalletId: walletId,
                      feeAmount,
                    })
                  }
                />
              );
            }}
        />
      )}

      {/* ONE SHEET FOR THE WHOLE LIST, not one per card. Only one correction can
          be open at a time, and mounting a modal behind every row would put the
          queue's whole form state in memory for a screen that shows a card at a
          time. */}
      {correctingItem === null ? null : (
        <CorrectSheet
          visible
          item={correctingItem}
          wallets={wallets ?? []}
          categories={categories ?? []}
          onDismiss={() => setCorrecting(null)}
          onSubmit={(patch) => {
            setCorrecting(null);
            triage.mutate({ kind: "correct", itemId: correctingItem.id, patch });
          }}
        />
      )}
    </View>
  );
}

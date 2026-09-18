// app/(onboarding)/wallets.tsx — the M3c onboarding wallet-setup step
// (m3c-onboarding-client plan Task 3, rule 2; docs/04-features/01-onboarding.md
// step 7). Proposes one Wallet per provider the listener has actually seen,
// plus a cash Wallet checked by default, all editable inline before the user
// commits with a single tap.
//
// WHERE THE PROPOSALS COME FROM. The candidates are re-derived the same way
// providers.tsx derives them, and the user's own choices on that screen are
// then subtracted.
//
// THE CHANNEL BETWEEN THE TWO SCREENS EXISTS NOW (GAP-091), and this paragraph
// used to explain at length why it could not. Every reason it gave was true of
// the OLD step order: providers.tsx ran above the unlock gate with no database,
// so it could not persist anything, and `setProviderFilter` is a write-only
// native call with no paired getter (`CapturePrefs.getProviderFilter()` is
// never wired to an AsyncFunction — see hooks/queries/use_capture_settings.ts's
// own doc for the same gap on the native side), so nothing could be read back
// either. Moving the step into the numbered flow gave it an open database, and
// it now writes `paused_provider_packages` before it navigates here. That row
// is the channel, and it is not a new invention: it is the same row the Privacy
// centre's switches read and `lib/bootstrap.ts` re-asserts on every launch.
//
// SUBTRACTED, NOT SUBSTITUTED. This screen still re-derives from
// `listObservedPackages()` rather than rendering the picker's allowlist
// directly, because the two questions differ: the picker asks which providers
// to CAPTURE, and an allowlist entry for an app that has never posted anything
// is not evidence the user holds an account there. What the row is used for is
// the one thing re-deriving cannot know — that the user was shown a provider
// and said no. Proposing a wallet for it one screen later would be the flow
// contradicting itself.
//
// So this screen derives candidates the SAME way providers.tsx does — `listObservedPackages()` plus the active ruleset,
// through the shared, pure `buildProviderChoices` — and proposes a Wallet for
// every OBSERVED provider the ruleset actually RECOGNISES (`seen: true &&
// suggested: true`), not merely `seen: true`. `buildProviderChoices`
// deliberately emits a choice for EVERY observed package, `displayName`
// falling back to the raw package name and `suggested: false` when the
// ruleset has no provider for it — the right behaviour for the provider
// PICKER, where an unrecognised bank must still be tickable, but wrong here:
// treating "seen" alone as "propose a Wallet" turned every app that had ever
// posted a notification (`com.facebook.orca`, `com.termux`, `android`, ...)
// into a pre-checked, junk-named Wallet proposal (task-2-brief). The
// strongest on-device signal of real usage is therefore "seen AND
// recognised", the same "seen beats guessed" reasoning
// docs/04-features/01-onboarding.md rules 19-20 already settled for the
// picker itself — narrowed to packages the ruleset can actually name. A
// provider the user ticked but that has never yet posted a notification is
// not auto-proposed; it is one tap away in "Add another wallet" below, which
// lists the rest of the catalogue. This is flagged as a
// known gap, not a silent one — closing it for real needs a native
// `getProviderFilter()` getter, which is out of this task's scope.
//
// RULE 2's CAP BYPASS. The free-tier Wallet cap (`canCreateWallet`,
// lib/entitlements.ts) never blocks a creation HERE — every included proposal
// is written regardless of count. It is only consulted to decide whether to
// show the explanation afterward: docs/05-monetization.md §3.1's "a cap
// blocks creation of new, never operation of existing" is about ONE new
// Wallet at a time from a screen with an upgrade sheet to send the user to;
// onboarding has neither a single new Wallet nor a moment for that sheet
// (§5 rule 4: "Upgrade surfaces never appear during onboarding"). Blocking
// here would mean silently dropping wallets for providers the user explicitly
// picked, which is the one outcome this rule exists to prevent.
//
// COMPONENTS NEVER IMPORT A REPOSITORY (release-gate grep) — this file does,
// because it is a route, exactly like app/wallet/new.tsx and
// app/(onboarding)/providers.tsx before it. The actual writes go through
// hooks/mutations/use_create_wallet.ts and use_set_wallet_matchers.ts, per the
// task brief; `buildProviderChoices`/`listObservedPackages` are read-only and
// side-effect-free, the same read path providers.tsx already uses.
//
// IT NAVIGATES ITSELF (m3c-onboarding-client fix). This file is a ROUTE:
// expo-router mounts it from app/(onboarding)/battery.tsx's
// `router.push("/(onboarding)/wallets")` with no props at all. It shipped
// written as if it were a child component — `onDone`/`onBack` supplied by a
// parent that does not exist — so "Continue" ran the creation loop, wrote real
// Wallet rows, then called `onDone?.()`, which was `undefined`: a silent no-op
// AFTER the database had already been mutated. `advance` below therefore
// falls back to the same `router.push` idiom welcome/how_it_works/access/
// battery already use. The props are KEPT and still take precedence, because
// the step suites (components/onboarding/__tests__/providers_step.test.tsx)
// drive this screen directly and assert on them; nothing in the app supplies
// them, so nothing in the app depends on them either.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { QuickWalletList } from "@/components/onboarding/quick_wallet_list";
import type { WalletProposal } from "@/components/onboarding/quick_wallet_list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { ProviderBadge } from "@/components/ui/provider_badge";
import { useCreateWallet } from "@/hooks/mutations/use_create_wallet";
import { useSetWalletMatchers } from "@/hooks/mutations/use_set_wallet_matchers";
import { usePausedProviderPackages } from "@/hooks/queries/use_capture_settings";
import { useAllWalletMatchers } from "@/hooks/queries/use_all_wallet_matchers";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallets } from "@/hooks/queries/use_wallets";
import { canCreateWallet } from "@/lib/entitlements";
import { applyAppLabels, buildProviderChoices } from "@/lib/ingest/provider_catalogue";
import { centavosFrom } from "@/lib/money/peso_input";
import { matchersForProvider } from "@/lib/wallets/matchers";
import { getAppLabels, listObservedPackages } from "@/modules/notification_listener";

import type { ProviderChoice } from "@/lib/ingest/provider_catalogue";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { ObservedPackage } from "@/modules/notification_listener";
import type { NewWalletMatcher, Wallet, WalletMatcher } from "@/types/domain";

const CASH_KEY = "cash";

/**
 * The name to pre-fill a proposed wallet with.
 *
 * `choice.displayName` IS ALREADY THE RESOLVED HUMAN NAME — the app's real
 * label off this phone where one was found, the curated brand name otherwise,
 * the package id as a last resort (see `resolveDisplayName` in
 * lib/ingest/provider_catalogue.ts). This used to wrap it in `providerLabel`
 * because `displayName` was then the raw provider KEY; re-wrapping it now
 * would ask `PROVIDER_LABELS` to look up "Maribank" and get "Maribank" back.
 *
 * The proposed name is editable in place on this screen, which is what makes
 * preferring the device's label safe even where it is blunter than the
 * curated one ("Messages" rather than "Bank SMS"): the user renames it in the
 * field it is already sitting in. The reverse error — quietly naming their
 * wallet after a bank that rebranded — is not something they can spot, let
 * alone correct.
 */
function defaultNameFor(choice: ProviderChoice): string {
  return choice.displayName;
}

/**
 * The identity two choices are "the same provider" by.
 *
 * `providerKey` where the catalogue claims one, and the PACKAGE NAME where it
 * does not. Falling back to the package is what keeps two unrecognised
 * observed apps from collapsing into each other: they both have a `null` key,
 * and deduping on `null` would silently drop every unrecognised app but the
 * first.
 */
function providerIdentity(choice: ProviderChoice): string {
  return choice.providerKey ?? choice.packageName;
}

/** Deduplicated by provider, keeping the first package seen for each — the
 * "Also have one of these?" row offers one chip per PROVIDER, never one per
 * Android package `buildProviderChoices` happens to have listed separately
 * (task-3-brief rule 1). */
function dedupeByProvider(choices: ProviderChoice[]): ProviderChoice[] {
  const seen = new Set<string>();
  const deduped: ProviderChoice[] = [];
  for (const choice of choices) {
    const identity = providerIdentity(choice);
    if (seen.has(identity)) continue;
    seen.add(identity);
    deduped.push(choice);
  }
  return deduped;
}

/**
 * Every package a choice's provider owns, as matchers — falling back to the
 * choice's own single package when the ruleset has no provider for it (should
 * not happen for anything `buildProviderChoices` emits, but a fallback beats
 * a thrown error over a provider the ruleset stopped shipping mid-onboarding).
 *
 * SHARED BY BOTH GROUPS. Review fix (2026-08-18): this used to run only for a
 * QUICK-ADDED provider. An OBSERVED multi-package provider (`sms_relay` seen
 * via `com.samsung.android.messaging` alone) got matched on that one package
 * only — so switching SMS apps silently stopped tracking, the exact failure
 * `lib/wallets/matchers.ts`'s own header exists to prevent. Reused here rather
 * than re-derived, same as the quick-add path already did.
 */
function matchersForChoice(
  choice: ProviderChoice,
  ruleset: { providers: readonly ProviderRuleset[] } | null | undefined,
): NewWalletMatcher[] {
  const provider = ruleset?.providers.find(
    (candidate) => choice.providerKey !== null && candidate.providerKey === choice.providerKey,
  );
  return provider ? matchersForProvider(provider, undefined) : [{ packageName: choice.packageName }];
}

/** The names and provider packages a non-archived Wallet already holds. */
type ClaimedIdentity = { names: Set<string>; packages: Set<string> };

/**
 * What the wallets on this device already lay claim to.
 *
 * ONBOARDING RUNS MORE THAN ONCE (GAP-067), so a second pass re-proposes
 * providers the first pass already created, and re-creating them is not merely
 * untidy. `createWallet` throws `DuplicateNameError` on the first name
 * collision and `submit` abandons every proposal after it; and `setMatchers`
 * MOVES a claimed pair rather than duplicating it
 * (lib/db/repos/wallet_matchers_repo.ts's own "MOVE, NOT DUPLICATE"), so a
 * wallet the user had renamed would silently hand the provider it was catching
 * to a fresh empty one -- no error, and nothing on any screen saying why the
 * money stopped arriving.
 *
 * Names fold to lower case because `createWallet`'s collision check is
 * `COLLATE NOCASE`. Matching any more loosely than the repository does would
 * refuse a wallet it would have accepted.
 */
function claimedByExistingWallets(
  wallets: Wallet[] | undefined,
  matchers: WalletMatcher[] | undefined,
): ClaimedIdentity {
  // `useWallets()` excludes archived rows already; filtered again for the same
  // reason `submit`'s cap count does it -- an archived wallet holds neither a
  // name nor a package any more, and both are free to be claimed afresh.
  const active = (wallets ?? []).filter((wallet) => !wallet.isArchived);
  const activeIds = new Set(active.map((wallet) => wallet.id));
  return {
    names: new Set(active.map((wallet) => wallet.name.trim().toLowerCase())),
    packages: new Set(
      (matchers ?? [])
        .filter((matcher) => activeIds.has(matcher.walletId))
        .map((matcher) => matcher.packageName),
    ),
  };
}

/** Whether `name`, or any package in `matchers`, is already spoken for. */
function alreadyClaimed(
  name: string,
  matchers: readonly NewWalletMatcher[],
  claimed: ClaimedIdentity,
): boolean {
  if (claimed.names.has(name.trim().toLowerCase())) return true;
  return matchers.some((matcher) => claimed.packages.has(matcher.packageName));
}

function proposalFor(choice: ProviderChoice, included: boolean): WalletProposal {
  return {
    key: choice.packageName,
    name: defaultNameFor(choice),
    packageName: choice.packageName,
    // Non-null in practice: every choice this function runs on has
    // `suggested: true` (dedupeByProvider only ever receives
    // seen-and-suggested or suggested-only choices — see the two call sites
    // below), and `buildProviderChoices` only sets `suggested: true` when it
    // resolved a real provider. Carried as `string | null` anyway because
    // that is what `ProviderChoice` promises and what `WalletProposal`
    // already accepts (`CASH_PROPOSAL` is `null`), rather than asserting the
    // invariant away with a `??` that would smuggle a package id in here.
    providerKey: choice.providerKey,
    included,
    // Task 4 rule 1: optional, blank by default — the user opts in by typing.
    openingBalanceText: "",
  };
}

/** Rule: "plus a cash wallet checked by default." Always present, always on. */
const CASH_PROPOSAL: WalletProposal = {
  key: CASH_KEY,
  name: "Cash",
  packageName: null,
  providerKey: null,
  included: true,
  openingBalanceText: "",
};

/** A bridge failure degrades to "nothing observed" — the cash proposal alone
 * is still a usable step, never an error screen (same discipline as
 * providers.tsx's own `loadObserved`). */
async function loadObserved(): Promise<ObservedPackage[]> {
  try {
    return await listObservedPackages();
  } catch {
    return [];
  }
}

/**
 * The real app names for `packageNames`, or nothing — the same degrade-to-`{}`
 * contract app/(onboarding)/providers.tsx uses, and deliberately a second
 * small copy rather than a shared helper: this screen and that one already
 * keep their own `loadObserved` for the same reason (that file's header on why
 * the two screens re-derive rather than share state).
 *
 * A failure here costs the proposals their real names, not their existence:
 * every choice keeps whatever `buildProviderChoices` already called it.
 */
async function loadAppLabels(packageNames: string[]): Promise<Record<string, string>> {
  try {
    // `?? {}` for the same reason providers.tsx has it: a nullish map makes
    // `applyAppLabels` throw inside the init effect, which leaves this screen
    // on its loading skeleton permanently — no error, no proposals, no way
    // forward. See that file's copy of this function.
    return (await getAppLabels(packageNames)) ?? {};
  } catch {
    return {};
  }
}

export default function WalletsScreen({
  onDone,
  onBack,
}: { onDone?: () => void; onBack?: () => void } = {}) {
  const router = useRouter();
  const { data: ruleset } = useRuleset();
  const { data: existingWallets } = useWallets();
  // Whose provider packages are already spoken for -- see
  // `claimedByExistingWallets`. A whole-table read, the same one the matcher
  // picker makes for the same question.
  const { data: existingMatchers } = useAllWalletMatchers();
  // What the user turned DOWN on the provider step, one screen ago (GAP-091).
  const { data: pausedPackages } = usePausedProviderPackages();
  const createWallet = useCreateWallet();
  const setMatchers = useSetWalletMatchers();

  const [observed, setObserved] = useState<ObservedPackage[] | null>(null);
  const [proposals, setProposals] = useState<WalletProposal[] | null>(null);
  const [addable, setAddable] = useState<ProviderChoice[]>([]);
  // A quick-added proposal's full matcher set — every package its provider
  // owns (task-3-brief rule 1), keyed by the proposal's own key. A proposal
  // absent here falls back to its single `packageName` in `submit` below,
  // which is what every OBSERVED proposal already had before this.
  const [pendingMatchers, setPendingMatchers] = useState<Record<string, NewWalletMatcher[]>>({});
  const initializedRef = useRef(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [capExceeded, setCapExceeded] = useState(false);

  // nextStep("wallets") === "income" (lib/onboarding/onboarding_state.ts) —
  // hardcoded rather than computed, the same reasoning every routed step in
  // this flow gives: the literal has to match a real file
  // (app/(onboarding)/income.tsx) for expo-router to resolve it.
  const advance = useCallback(() => {
    if (onDone) {
      onDone();
      return;
    }
    router.push("/(onboarding)/income");
  }, [onDone, router]);

  const goBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    router.back();
  }, [onBack, router]);

  useEffect(() => {
    let cancelled = false;
    loadObserved().then((packages) => {
      if (!cancelled) setObserved(packages);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Builds the initial proposal list exactly ONCE, the moment both the
  // observed packages and the ruleset are ready — never again, so a later
  // ruleset refetch (React Query can refire this at any time) does not wipe
  // out edits the user has already made to the list.
  useEffect(() => {
    if (initializedRef.current) return;
    if (observed === null || ruleset === undefined) return;
    initializedRef.current = true;

    // ASYNC NOW, BECAUSE THE NAMES COME OFF THE DEVICE. The proposed wallet
    // names have to agree with the tiles the user just tapped on the provider
    // step — proposing "SeaBank" one screen after they picked a tile reading
    // "Maribank" makes them doubt they picked the right app. Guarded by
    // `initializedRef` above exactly as before, so the await cannot let a
    // second run in and wipe the user's edits.
    let cancelled = false;
    (async () => {
      const catalogue = ruleset ? buildProviderChoices(observed, ruleset) : [];
      const labels = await loadAppLabels(catalogue.map((choice) => choice.packageName));
      if (cancelled) return;
      const choices = applyAppLabels(catalogue, labels);
      // Review fix (2026-08-18): deduped by provider too, not just the
      // quick-add row — two packages of the same OBSERVED provider (both
      // Google Messages and Samsung Messages posting sms_relay traffic) used to
      // propose two identically-named wallets, splitting one provider's
      // notifications across two Wallet rows by default.
      //
      // Bug fix (task-2-brief): `choice.seen` alone is not "this is a bank the
      // user uses" — `buildProviderChoices` emits a choice for every OBSERVED
      // package regardless of whether the ruleset recognises it, precisely so
      // the provider PICKER can still offer an unrecognised package as a
      // tickable, raw-named entry. Left unfiltered here, every app that had
      // ever posted a notification (com.facebook.orca, com.termux, android,
      // ...) became a pre-checked, junk-named Wallet proposal. Only a
      // RECOGNISED observed provider (`suggested: true`) is a real proposal;
      // `lib/ingest/provider_catalogue.ts` itself is untouched — this is a
      // filter at the call site, not a change to what it emits.
      // THE PROVIDER STEP'S ANSWER, SUBTRACTED BEFORE THE DEDUPE (GAP-091).
      // Order matters: `dedupeByProvider` keeps the FIRST package it sees for
      // each provider, so filtering afterwards could drop a provider the user
      // KEPT -- they ticked its second package, the dedupe kept its first, and
      // the first is the one recorded as paused. Filtering first lets the
      // package they actually ticked become the survivor.
      //
      // AN EMPTY ROW FILTERS NOTHING, which is not an edge case but the common
      // path: "the user ticked nothing" and "the user tapped Skip" both mean
      // capture everything, and lib/onboarding/pending_provider_pause.ts
      // records nothing paused for either. Treating an empty row as "everything
      // is paused" would propose no wallets at all to most users.
      const paused = new Set(pausedPackages ?? []);
      const kept =
        paused.size === 0 ? choices : choices.filter((choice) => !paused.has(choice.packageName));
      const observedChoices = dedupeByProvider(
        kept.filter((choice) => choice.seen && choice.suggested),
      );
      // NOT FILTERED, unlike the proposals above. These are the "Also have one
      // of these?" chips, and adding one takes a deliberate tap -- so a user who
      // changes their mind about a provider they skipped still has a way back,
      // and nothing is created for them that they did not ask for twice.
      const suggestedOnly = choices.filter((choice) => !choice.seen);

      // NOT AN UNCONDITIONAL `true` ANY MORE (GAP-067). A proposal whose name
      // or whose provider packages a non-archived Wallet already holds starts
      // unticked, so a second pass through onboarding shows the user what is
      // already set up instead of offering to build it again.
      //
      // BEST-EFFORT, DELIBERATELY. The two queries behind `claimed` are NOT
      // added to this effect's gate above: a query that never resolves would
      // wedge the screen on its loading skeleton for good, which costs the
      // whole install, where a stale tick costs one wallet the user can add
      // from the Wallets tab. `submit` repeats the check against fresh data
      // and is the half that actually guarantees the writes are idempotent.
      const claimed = claimedByExistingWallets(existingWallets, existingMatchers);
      // Derived once and read twice below, because the seed and the matcher map
      // have to agree about which packages a proposal is about to claim.
      const observedMatchers = new Map(
        observedChoices.map(
          (choice) => [choice.packageName, matchersForChoice(choice, ruleset)] as const,
        ),
      );
      setProposals([
        ...observedChoices.map((choice) =>
          proposalFor(
            choice,
            !alreadyClaimed(
              defaultNameFor(choice),
              observedMatchers.get(choice.packageName) ?? [],
              claimed,
            ),
          ),
        ),
        // The cash wallet is still always PRESENT -- "plus a cash wallet
        // checked by default" is about the proposal existing, and a user who
        // wants a second one renames this row. It is only pre-TICKED when there
        // is not a cash wallet already, which is the same second-pass rule
        // every other proposal now follows.
        {
          ...CASH_PROPOSAL,
          included: !claimed.names.has(CASH_PROPOSAL.name.toLowerCase()),
        },
      ]);
      // Every OBSERVED proposal now carries its provider's FULL package list
      // too, the same as a quick-added one — seeing sms_relay via ONE package
      // must not leave the created wallet matching only that one.
      setPendingMatchers((current) => {
        const next = { ...current };
        for (const [packageName, matchers] of observedMatchers) {
          next[packageName] = matchers;
        }
        return next;
      });
      // task-3-brief rule 1: one quick-add chip per PROVIDER, not one per
      // package `sms_relay` (or any future multi-package provider) happens to
      // list separately.
      setAddable(dedupeByProvider(suggestedOnly));
    })();

    return () => {
      cancelled = true;
    };
  }, [observed, ruleset]);

  function rename(key: string, name: string): void {
    setProposals((current) =>
      current ? current.map((p) => (p.key === key ? { ...p, name } : p)) : current,
    );
  }

  function toggleIncluded(key: string): void {
    setProposals((current) =>
      current ? current.map((p) => (p.key === key ? { ...p, included: !p.included } : p)) : current,
    );
  }

  function changeOpeningBalance(key: string, text: string): void {
    setProposals((current) =>
      current
        ? current.map((p) => (p.key === key ? { ...p, openingBalanceText: text } : p))
        : current,
    );
  }

  function addProvider(choice: ProviderChoice): void {
    const proposal = proposalFor(choice, true);
    setProposals((current) => (current ? [...current, proposal] : current));
    // Every package the provider owns, not just the one this chip happened to
    // be keyed on — otherwise a user whose bank texts arrive via a different
    // package under the same provider (e.g. com.android.mms for sms_relay)
    // silently catches nothing (task-3-brief rule 1).
    setPendingMatchers((current) => ({
      ...current,
      [proposal.key]: matchersForChoice(choice, ruleset),
    }));
    // Dedupe is by provider (rule 1), so every addable entry sharing this
    // provider's label leaves the row together — not just the one tapped.
    setAddable((current) =>
      current.filter((c) => providerIdentity(c) !== providerIdentity(choice)),
    );
  }

  async function submit(): Promise<void> {
    if (!proposals || submitting) return;
    const included = proposals.filter((p) => p.included && p.name.trim() !== "");

    if (included.length === 0) {
      advance();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    // Only ACTIVE existing wallets count toward the cap (same rule
    // app/wallet/new.tsx applies) — onboarding runs on a fresh install, so
    // this is normally zero, but re-entering onboarding after a partial run
    // must not double-count nor under-count what is already there.
    let runningCount = (existingWallets ?? []).filter((wallet) => !wallet.isArchived).length;
    let wouldExceedCap = false;
    // READ HERE, NOT TAKEN FROM THE SEED ABOVE (GAP-067). By the time the user
    // taps Continue both queries have had the whole step to resolve, so this is
    // the authoritative answer where the seed was only the best one available
    // at mount; and the user can tick a row back on themselves, which the seed
    // cannot know about at all.
    const claimed = claimedByExistingWallets(existingWallets, existingMatchers);

    try {
      for (const proposal of included) {
        // Both quick-added AND observed proposals carry their provider's FULL
        // package list in `pendingMatchers` now (see the init effect above,
        // and `matchersForChoice`'s own doc for why observed joined quick-add
        // here) — so the only proposal left to reach this fallback is CASH,
        // whose `packageName` is `null` and whose matcher list is correctly
        // empty. A non-cash proposal missing from `pendingMatchers` would be a
        // bug upstream, not a case this fallback is meant to paper over; per-
        // package fallback is exactly the failure lib/wallets/matchers.ts:48-53
        // exists to prevent (a provider whose SMS arrive via a second app
        // silently stops being tracked), so this stays a safety net for cash
        // alone, not a second matching path for observed providers.
        const matchers =
          pendingMatchers[proposal.key] ??
          (proposal.packageName ? [{ packageName: proposal.packageName }] : []);

        // ALREADY SET UP, SO THERE IS NOTHING TO DO (GAP-067). Skipping is not
        // merely tidier than letting the writes run: `createWallet` throws
        // `DuplicateNameError` on the name, which the catch below turns into
        // "Some wallets couldn't be saved" and which abandons every proposal
        // after this one; and `setMatchers` would take the provider away from
        // the wallet already catching it. Neither failure is one the user could
        // diagnose, and both are avoidable by not asking.
        if (alreadyClaimed(proposal.name, matchers, claimed)) continue;

        // Rule 2: checked ONLY to decide whether to explain the cap
        // afterward. Creation below runs unconditionally — the cap never
        // blocks a wallet the user asked for during this setup.
        if (!canCreateWallet(runningCount)) wouldExceedCap = true;

        const wallet = await createWallet.mutateAsync({
          name: proposal.name.trim(),
          // Task 4 rule 1: a blank field is ₱0.00 via centavosFrom, written
          // the same way app/wallet/new.tsx already writes a manually created
          // wallet's opening balance — an anchor on the brand-new row, not a
          // patch on an existing one (wallet_form.tsx:11-13's "create-only"
          // rule is about EDITING an existing wallet's balance, never about
          // the very INSERT that gives it its first figure).
          //
          // centavosFrom, replacing the centavos-by-digit helper this used to
          // call (numeric-input-system Task 13): the proposal now carries what
          // the user KEYED IN PESOS, so "3000" is ₱3,000.00. This screen is
          // where the owner's report landed — 100000 used to become ₱1,000.00
          // here.
          openingBalance: centavosFrom(proposal.openingBalanceText),
        });
        if (matchers.length > 0) {
          await setMatchers.mutateAsync({ walletId: wallet.id, matchers });
        }
        runningCount += 1;
      }
    } catch {
      // Wallets already created stay created (gate principle 1: never delete
      // on a failure either) — only the ones that did not get created yet are
      // lost, and the user can add them from the Wallets tab afterward.
      setSubmitError(
        "Some wallets couldn't be saved. The ones that worked are ready — add any others later from the Wallets tab.",
      );
      return;
    } finally {
      setSubmitting(false);
    }

    // ADVANCING IS DELIBERATELY OUTSIDE THE try ABOVE. That catch means one
    // thing — "a wallet could not be saved" — and it says so on screen. Moving
    // on is not a save, and a navigation that threw from inside it would be
    // reported to the user as data loss that did not happen.
    if (wouldExceedCap) {
      // The explanation renders below; the flow only advances once the user
      // has actually seen it (its own "Continue" button).
      setCapExceeded(true);
      return;
    }
    advance();
  }

  if (capExceeded) {
    return (
      <OnboardingFrame
        step="wallets"
        title="Wallets are set up"
        onPrimary={advance}
        primaryLabel="Continue"
      >
        {/*
          NO FREE-PLAN CAP NOTE (spec D10: no cap in beta; the paywall sheet
          is built but never triggered). This branch is already unreachable
          from any real beta install — `wouldExceedCap` above can only ever
          be true when a test forces `__setTierForTests("free")`
          (components/onboarding/__tests__/providers_step.test.tsx, out of
          this task's file list, still exercises it and still expects
          `wallet-cap-note` to exist under that forced tier) — so the branch
          itself stays, for that fail-safe test coverage, but the copy no
          longer advertises a specific "free plan" cap number during beta.
        */}
        <Card testID="wallet-cap-note">
          <Text className="text-section font-bold text-fg dark:text-fg-dark">
            You have more wallets than usual
          </Text>
          <Text className="mt-2 text-body font-medium text-fg-2 dark:text-fg-2-dark">
            Every wallet you just set up is created and working. Nothing you already have is ever
            removed.
          </Text>
        </Card>
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame
      step="wallets"
      title="Set up your wallets"
      onPrimary={submit}
      primaryLabel="Continue"
      primaryDisabled={!proposals || submitting}
      primaryBusy={submitting}
      onBack={goBack}
      onSkip={advance}
    >
      <Text testID="wallets-step-intro" className="text-body font-medium text-fg-2 dark:text-fg-2-dark">
        PeraPlano sets up a wallet for each app you use, plus cash for what you spend by hand. Edit
        anything below, or uncheck what you don&apos;t want.
      </Text>

      {proposals ? (
        <QuickWalletList
          proposals={proposals}
          onRename={rename}
          onToggleIncluded={toggleIncluded}
          onChangeOpeningBalance={changeOpeningBalance}
        />
      ) : (
        <View testID="wallets-step-loading">
          <LoadingSkeleton rows={4} />
        </View>
      )}

      {addable.length > 0 ? (
        <View className="gap-2">
          <Text className="text-section font-bold text-fg dark:text-fg-dark">Add another wallet</Text>
          <View className="flex-row flex-wrap gap-2">
            {addable.map((choice) => (
              <Pressable
                key={choice.packageName}
                testID={`wallet-add-${choice.packageName}`}
                onPress={() => addProvider(choice)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${defaultNameFor(choice)}`}
                className="min-h-[44px] flex-row items-center gap-2 rounded-full border-2 border-dashed border-line bg-surface px-3 py-2 dark:border-line-dark dark:bg-surface-dark"
              >
                {/* The routing key where there is one, else the printed name —
                    never `packageName`, which would letter the square from a
                    package id ("p" for `ph.seabank.seabank`). Same rule as
                    provider_picker.tsx's tile. */}
                <ProviderBadge providerKey={choice.providerKey ?? choice.displayName} size={16} />
                <Text className="text-row font-semibold text-brand dark:text-brand-dark">
                  + {defaultNameFor(choice)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {submitError ? (
        <Text testID="wallets-step-error" className="text-body font-medium text-danger dark:text-danger-dark">
          {submitError}
        </Text>
      ) : null}
    </OnboardingFrame>
  );
}

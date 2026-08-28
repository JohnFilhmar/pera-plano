// app/(onboarding)/wallets.tsx — the M3c onboarding wallet-setup step
// (m3c-onboarding-client plan Task 3, rule 2; docs/04-features/01-onboarding.md
// step 7). Proposes one Wallet per provider the listener has actually seen,
// plus a cash Wallet checked by default, all editable inline before the user
// commits with a single tap.
//
// WHERE THE PROPOSALS COME FROM, AND WHY NOT FROM app/(onboarding)/providers.tsx
// DIRECTLY. The obvious design — hand the exact packages ticked on the
// provider-picker screen straight to this one — is not reachable in this
// codebase today: providers.tsx runs BEFORE the database ever unlocks (its own
// header comment), `setProviderFilter` is a write-only native call with no
// paired getter (`CapturePrefs.getProviderFilter()` is never wired to an
// AsyncFunction — see hooks/queries/use_capture_settings.ts's own doc for the
// same gap on the native side), and this screen needs `createWallet`/
// `setMatchers`, both of which need a live QueryClient and an unlocked
// database that provably do not exist yet at providers.tsx's mount time. There
// is therefore no in-memory OR durable channel between the two screens today.
// Rather than invent one (a new persisted setting, or a native getter) outside
// this task's file list, this screen re-derives candidates the SAME way
// providers.tsx does — `listObservedPackages()` plus the active ruleset,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallets } from "@/hooks/queries/use_wallets";
import { DuplicateNameError } from "@/lib/db/repos/wallets_repo";
import { canCreateWallet } from "@/lib/entitlements";
import { applyAppLabels, buildProviderChoices } from "@/lib/ingest/provider_catalogue";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import { readWalletDraft, writeWalletDraft } from "@/lib/onboarding/wallet_draft";
import { matchersForProvider } from "@/lib/wallets/matchers";
import { getAppLabels, listObservedPackages } from "@/modules/notification_listener";

import type { ProviderChoice } from "@/lib/ingest/provider_catalogue";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { ObservedPackage } from "@/modules/notification_listener";
import type { NewWalletMatcher, Wallet } from "@/types/domain";

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

/**
 * The identity a proposal and an already-created Wallet are the same thing by.
 *
 * THE NAME, CASE-FOLDED — because that is exactly what `createWallet` refuses
 * a duplicate of (`wallets_repo.ts`: `WHERE name = ? COLLATE NOCASE AND
 * is_archived = 0`). Matching on anything narrower here would let this screen
 * re-offer a row the database is guaranteed to reject a second later, which is
 * the whole failure this reconciliation exists to prevent.
 */
function walletIdentity(name: string): string {
  return name.trim().toLowerCase();
}

/** A row standing for a Wallet that already exists. Shown, never re-created. */
function savedProposalFor(wallet: Wallet): WalletProposal {
  return {
    key: `saved:${wallet.id}`,
    name: wallet.name,
    // No provider to badge and no matcher to attach: this row writes nothing.
    // A `Wallet` carries only `matcherCount`, not the packages behind it, and
    // it is already matched — re-deriving them just to draw a badge would be a
    // second, weaker copy of what the wallet screen already shows properly.
    packageName: null,
    providerKey: null,
    included: true,
    saved: true,
    openingBalanceText: pesoInputFrom(wallet.balance),
  };
}

/**
 * Folds the Wallets that ALREADY EXIST into the proposal list.
 *
 * THE BUG THIS FIXES (owner's report, 2026-08-28). Continue on this step
 * creates real Wallet rows and pushes the next step. A user who then realises
 * they missed a wallet comes back — and, before this, met a list that had
 * forgotten every one of those creations: the same providers proposed again,
 * their balances blank. Tapping Continue re-ran `createWallet` on names that
 * now existed, `DuplicateNameError` threw on the FIRST one, and the loop
 * abandoned every wallet after it under the message "Some wallets couldn't be
 * saved" — while the wallet the user had actually come back to add was one of
 * the ones silently dropped. So the step both demanded work the user had
 * already done and then failed at the one new thing they asked for.
 *
 * Reconciling makes a return visit honest: a proposal whose name is already a
 * live Wallet becomes a read-only "already saved" row showing that Wallet's
 * REAL balance, and every live Wallet with no proposal of its own is added as
 * one, so what is on screen is the full truth about what exists.
 *
 * IDEMPOTENT ON PURPOSE — it runs again on every wallet-list refetch. A row it
 * already marked saved matches its Wallet by name on the next pass and is
 * counted as matched, so it is never appended a second time.
 */
function reconcileWithExisting(proposals: WalletProposal[], wallets: Wallet[]): WalletProposal[] {
  if (wallets.length === 0) return proposals;

  const byIdentity = new Map(wallets.map((wallet) => [walletIdentity(wallet.name), wallet]));
  const matched = new Set<string>();

  const reconciled = proposals.map((proposal) => {
    const wallet = byIdentity.get(walletIdentity(proposal.name));
    if (!wallet) return proposal;
    matched.add(wallet.id);
    // The figure comes from the Wallet, not from the draft: what the user
    // keyed was an OPENING balance, and by now the wallet may have moved.
    return {
      ...proposal,
      name: wallet.name,
      included: true,
      saved: true,
      openingBalanceText: pesoInputFrom(wallet.balance),
    };
  });

  const unproposed = wallets.filter((wallet) => !matched.has(wallet.id)).map(savedProposalFor);
  return [...unproposed, ...reconciled];
}

/**
 * "GCash", or "GCash and Maya", or "GCash, Maya and BPI".
 *
 * An error that NAMES what failed is worth more than one that counts it: the
 * user's next move is to add those wallets by hand from the Wallets tab, and
 * they cannot do that from "some wallets".
 */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default function WalletsScreen({
  onDone,
  onBack,
}: { onDone?: () => void; onBack?: () => void } = {}) {
  const router = useRouter();
  const { data: ruleset } = useRuleset();
  const { data: existingWallets } = useWallets();
  const createWallet = useCreateWallet();
  const setMatchers = useSetWalletMatchers();

  const [observed, setObserved] = useState<ObservedPackage[] | null>(null);
  // SEEDED FROM THE DRAFT, NOT FROM NOTHING. Coming back to this step must not
  // hand the user a blank list they have already filled in once — see
  // lib/onboarding/wallet_draft.ts for why that draft is in memory only.
  const [proposals, setProposals] = useState<WalletProposal[] | null>(
    () => readWalletDraft()?.proposals ?? null,
  );
  const [addable, setAddable] = useState<ProviderChoice[]>(() => readWalletDraft()?.addable ?? []);
  // A quick-added proposal's full matcher set — every package its provider
  // owns (task-3-brief rule 1), keyed by the proposal's own key. A proposal
  // absent here falls back to its single `packageName` in `submit` below,
  // which is what every OBSERVED proposal already had before this.
  const [pendingMatchers, setPendingMatchers] = useState<Record<string, NewWalletMatcher[]>>(
    () => readWalletDraft()?.pendingMatchers ?? {},
  );
  // A restored draft IS the initialisation: rebuilding the list over it would
  // throw away exactly the edits the draft exists to keep.
  const initializedRef = useRef(readWalletDraft() !== null);

  // Only ACTIVE wallets are "already there": an archived one does not block a
  // name (`createWallet`'s clash check ignores it) and must not be shown as a
  // saved row on a setup screen the user is still filling in.
  const liveWallets = useMemo(
    () => (existingWallets ?? []).filter((wallet) => !wallet.isArchived),
    [existingWallets],
  );

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

  // KEEPS THE STEP'S UNSAVED HALF ALIVE ACROSS AN UNMOUNT. Continue pushes the
  // next step, and coming back re-mounts this route from scratch; without this
  // the typed balances, the renames and the quick-add taps are simply gone.
  useEffect(() => {
    if (proposals === null) return;
    writeWalletDraft({ proposals, addable, pendingMatchers });
  }, [proposals, addable, pendingMatchers]);

  // Re-reads the database whenever the wallet list changes — which includes
  // the moment this step's own creations land. That is what turns a proposal
  // the user has already committed into a read-only "already saved" row
  // instead of a second attempt at a name that now exists.
  useEffect(() => {
    if (existingWallets === undefined) return;
    setProposals((current) => (current ? reconcileWithExisting(current, liveWallets) : current));
  }, [existingWallets, liveWallets]);

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
    // `existingWallets` joins the gate: a list built before the database has
    // said what is already there would flash the user a proposal for a wallet
    // they created on a previous pass, and only correct itself a frame later.
    if (observed === null || ruleset === undefined || existingWallets === undefined) return;
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
      const observedChoices = dedupeByProvider(
        choices.filter((choice) => choice.seen && choice.suggested),
      );
      const suggestedOnly = choices.filter((choice) => !choice.seen);

      setProposals(
        reconcileWithExisting(
          [...observedChoices.map((choice) => proposalFor(choice, true)), CASH_PROPOSAL],
          liveWallets,
        ),
      );
      // Every OBSERVED proposal now carries its provider's FULL package list
      // too, the same as a quick-added one — seeing sms_relay via ONE package
      // must not leave the created wallet matching only that one.
      setPendingMatchers((current) => {
        const next = { ...current };
        for (const choice of observedChoices) {
          next[choice.packageName] = matchersForChoice(choice, ruleset);
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
  }, [observed, ruleset, existingWallets, liveWallets]);

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
    // `!p.saved` IS THE WHOLE RETURN-VISIT FIX. A saved proposal is a Wallet
    // that already exists; handing it to `createWallet` again can only raise
    // `DuplicateNameError`, which is how a user who came back to add ONE
    // missed wallet used to end up with an error and no new wallet at all.
    const pending = proposals.filter((p) => p.included && !p.saved && p.name.trim() !== "");

    if (pending.length === 0) {
      advance();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    // Only ACTIVE existing wallets count toward the cap (same rule
    // app/wallet/new.tsx applies) — onboarding runs on a fresh install, so
    // this is normally zero, but re-entering onboarding after a partial run
    // must not double-count nor under-count what is already there.
    let runningCount = liveWallets.length;
    let wouldExceedCap = false;

    // ONE PROPOSAL'S FAILURE IS NOT THE REST'S. The loop used to sit inside a
    // single try: the first throw abandoned every proposal after it, unread,
    // under a message that said only "some wallets". Each proposal now carries
    // its own failure, so a bad name costs exactly one wallet and the message
    // can name it.
    const created = new Set<string>();
    const failed: string[] = [];

    try {
      for (const proposal of pending) {
        try {
          // Rule 2: checked ONLY to decide whether to explain the cap
          // afterward. Creation below runs unconditionally — the cap never
          // blocks a wallet the user asked for during this setup.
          if (!canCreateWallet(runningCount)) wouldExceedCap = true;

          const wallet = await createWallet.mutateAsync({
            name: proposal.name.trim(),
            // Task 4 rule 1: a blank field is ₱0.00 via centavosFrom, written
            // the same way app/wallet/new.tsx already writes a manually
            // created wallet's opening balance — an anchor on the brand-new
            // row, not a patch on an existing one (wallet_form.tsx:11-13's
            // "create-only" rule is about EDITING an existing wallet's
            // balance, never about the very INSERT that gives it its first
            // figure).
            //
            // centavosFrom, replacing the centavos-by-digit helper this used
            // to call (numeric-input-system Task 13): the proposal carries
            // what the user KEYED IN PESOS, so "3000" is ₱3,000.00. This
            // screen is where the owner's original report landed — 100000
            // used to become ₱1,000.00 here.
            openingBalance: centavosFrom(proposal.openingBalanceText),
          });
          // Both quick-added AND observed proposals carry their provider's
          // FULL package list in `pendingMatchers` (see the init effect, and
          // `matchersForChoice`'s own doc for why observed joined quick-add
          // here) — so the only proposal left to reach this fallback is CASH,
          // whose `packageName` is `null` and whose matcher list is correctly
          // empty. Per-package fallback is exactly the failure
          // lib/wallets/matchers.ts:48-53 exists to prevent (a provider whose
          // SMS arrive via a second app silently stops being tracked), so this
          // stays a safety net for cash alone, not a second matching path.
          const matchers =
            pendingMatchers[proposal.key] ??
            (proposal.packageName ? [{ packageName: proposal.packageName }] : []);
          if (matchers.length > 0) {
            await setMatchers.mutateAsync({ walletId: wallet.id, matchers });
          }
          runningCount += 1;
          created.add(proposal.key);
        } catch (error) {
          // A NAME THAT IS ALREADY TAKEN IS NOT A FAILURE HERE. The user asked
          // for a wallet by that name and a wallet by that name exists — the
          // outcome they wanted. Reporting it as an error is what made the
          // step look broken to someone who had merely walked back a screen.
          // It is folded in with the creations so the row settles as saved.
          if (error instanceof DuplicateNameError) {
            created.add(proposal.key);
            continue;
          }
          failed.push(proposal.name.trim());
        }
      }
    } finally {
      setSubmitting(false);
    }

    // Marked saved on the spot rather than waiting for the wallet list to come
    // back: this is what stops a second Continue tap (or a walk back to this
    // step) from trying to create them all over again. The reconcile effect
    // above then corrects each row's balance to the Wallet's real one.
    setProposals((current) =>
      current
        ? current.map((p) => (created.has(p.key) ? { ...p, saved: true, included: true } : p))
        : current,
    );

    // NAMES THE WALLETS THAT DID NOT MAKE IT, and only appears when one truly
    // did not: the recovery is "add these from the Wallets tab", which the
    // user cannot act on if the message will not say which ones. Wallets
    // already created stay created (gate principle 1: never delete on a
    // failure either).
    if (failed.length > 0) {
      setSubmitError(
        `${listNames(failed)} couldn't be saved. Everything else is ready — you can add ` +
          `${failed.length === 1 ? "it" : "them"} later from the Wallets tab.`,
      );
      return;
    }

    // ADVANCING IS DELIBERATELY AFTER THE ERROR CHECK ABOVE, NOT INSIDE IT.
    // That message means one thing — "a wallet could not be saved" — and it
    // says so on screen. Moving on is not a save, and a navigation that threw
    // from inside that path would be reported to the user as data loss that
    // did not happen.
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

  const savedCount = proposals?.filter((proposal) => proposal.saved).length ?? 0;

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

      {/* Only ever shown on a RETURN visit — a first pass has nothing saved.
          It answers the question the old screen left the user holding: the
          wallets they set up a moment ago are still there, so the only thing
          left to do here is the one they came back for. */}
      {savedCount > 0 ? (
        <Text
          testID="wallets-step-saved-note"
          className="text-body font-medium text-fg-2 dark:text-fg-2-dark"
        >
          {savedCount === 1 ? "One wallet is" : `${savedCount} wallets are`} already saved from
          earlier — those are kept as they are. Add anything you missed below.
        </Text>
      ) : null}

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

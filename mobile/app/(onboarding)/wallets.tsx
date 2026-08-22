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
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { QuickWalletList } from "@/components/onboarding/quick_wallet_list";
import type { WalletProposal } from "@/components/onboarding/quick_wallet_list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { providerLabel } from "@/constants/providers";
import { useCreateWallet } from "@/hooks/mutations/use_create_wallet";
import { useSetWalletMatchers } from "@/hooks/mutations/use_set_wallet_matchers";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallets } from "@/hooks/queries/use_wallets";
import { canCreateWallet } from "@/lib/entitlements";
import { buildProviderChoices } from "@/lib/ingest/provider_catalogue";
import { centavosFrom } from "@/lib/money/peso_input";
import { matchersForProvider } from "@/lib/wallets/matchers";
import { listObservedPackages } from "@/modules/notification_listener";

import type { ProviderChoice } from "@/lib/ingest/provider_catalogue";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { ObservedPackage } from "@/modules/notification_listener";
import type { NewWalletMatcher, WalletType } from "@/types/domain";

const CASH_KEY = "cash";

/** A sensible starting `WalletType` per known provider — editable inline
 * (rule 2), so a wrong guess here costs one tap, not a support ticket. */
const WALLET_TYPE_BY_PROVIDER_KEY: Record<string, WalletType> = {
  gcash: "e-wallet",
  maya: "e-wallet",
  shopeepay: "e-wallet",
  grabpay: "e-wallet",
  seabank: "savings",
  gotyme: "savings",
  cimb: "savings",
  bpi: "bank",
  bdo: "bank",
  unionbank: "bank",
  metrobank: "bank",
  landbank: "bank",
  sms_relay: "bank",
};

function defaultNameFor(choice: ProviderChoice): string {
  return providerLabel(choice.displayName);
}

/** Deduplicated by provider, keeping the first package seen for each — the
 * "Also have one of these?" row offers one chip per PROVIDER, never one per
 * Android package `buildProviderChoices` happens to have listed separately
 * (task-3-brief rule 1). `choice.displayName` is the provider key here (see
 * `ProviderChoice`'s own doc), so it is the right thing to dedupe on. */
function dedupeByProvider(choices: ProviderChoice[]): ProviderChoice[] {
  const seen = new Set<string>();
  const deduped: ProviderChoice[] = [];
  for (const choice of choices) {
    if (seen.has(choice.displayName)) continue;
    seen.add(choice.displayName);
    deduped.push(choice);
  }
  return deduped;
}

function defaultTypeFor(choice: ProviderChoice): WalletType {
  return WALLET_TYPE_BY_PROVIDER_KEY[choice.displayName] ?? "bank";
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
    (candidate) => candidate.providerKey === choice.displayName,
  );
  return provider ? matchersForProvider(provider, undefined) : [{ packageName: choice.packageName }];
}

function proposalFor(choice: ProviderChoice, included: boolean): WalletProposal {
  return {
    key: choice.packageName,
    name: defaultNameFor(choice),
    type: defaultTypeFor(choice),
    packageName: choice.packageName,
    included,
    // Task 4 rule 1: optional, blank by default — the user opts in by typing.
    openingBalanceText: "",
  };
}

/** Rule: "plus a cash wallet checked by default." Always present, always on. */
const CASH_PROPOSAL: WalletProposal = {
  key: CASH_KEY,
  name: "Cash",
  type: "cash",
  packageName: null,
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

    const choices = ruleset ? buildProviderChoices(observed, ruleset) : [];
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

    setProposals([...observedChoices.map((choice) => proposalFor(choice, true)), CASH_PROPOSAL]);
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
  }, [observed, ruleset]);

  function rename(key: string, name: string): void {
    setProposals((current) =>
      current ? current.map((p) => (p.key === key ? { ...p, name } : p)) : current,
    );
  }

  function changeType(key: string, type: WalletType): void {
    setProposals((current) =>
      current ? current.map((p) => (p.key === key ? { ...p, type } : p)) : current,
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
    setAddable((current) => current.filter((c) => c.displayName !== choice.displayName));
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

    try {
      for (const proposal of included) {
        // Rule 2: checked ONLY to decide whether to explain the cap
        // afterward. Creation below runs unconditionally — the cap never
        // blocks a wallet the user asked for during this setup.
        if (!canCreateWallet(runningCount)) wouldExceedCap = true;

        const wallet = await createWallet.mutateAsync({
          name: proposal.name.trim(),
          type: proposal.type,
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
        <Card testID="wallet-cap-note">
          <Text className="font-semibold text-fg dark:text-fg-dark">
            You have more wallets than the free plan usually allows
          </Text>
          <Text className="mt-2 text-fg-2 dark:text-fg-2-dark">
            The free plan's usual cap is 3 — but every wallet you just set up is created and
            working. The cap only applies when adding new wallets later, and nothing you already
            have is ever removed.
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
      <Text testID="wallets-step-intro" className="text-fg-2 dark:text-fg-2-dark">
        PeraPlano sets up a wallet for each app you use, plus cash for what you spend by hand. Edit
        anything below, or uncheck what you don&apos;t want.
      </Text>

      {proposals ? (
        <QuickWalletList
          proposals={proposals}
          onRename={rename}
          onChangeType={changeType}
          onToggleIncluded={toggleIncluded}
          onChangeOpeningBalance={changeOpeningBalance}
        />
      ) : (
        <View testID="wallets-step-loading" />
      )}

      {addable.length > 0 ? (
        <View className="gap-2">
          <Text className="text-sm font-semibold text-fg dark:text-fg-dark">
            Also have one of these?
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {addable.map((choice) => (
              <Text
                key={choice.packageName}
                testID={`wallet-add-${choice.packageName}`}
                onPress={() => addProvider(choice)}
                accessibilityRole="button"
                className="rounded-full bg-brand-soft px-3 py-2 text-sm text-brand dark:bg-brand-soft-dark dark:text-brand-dark"
              >
                + {defaultNameFor(choice)}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {submitError ? (
        <Text testID="wallets-step-error" className="text-danger dark:text-danger-dark">
          {submitError}
        </Text>
      ) : null}
    </OnboardingFrame>
  );
}

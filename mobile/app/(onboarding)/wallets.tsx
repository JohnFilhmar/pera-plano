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
// every OBSERVED provider (`seen: true`): the strongest on-device signal of
// real usage, and the same "seen beats guessed" reasoning
// docs/04-features/01-onboarding.md rules 19-20 already settled for the
// picker itself. A provider the user ticked but that has never yet posted a
// notification is not auto-proposed; it is one tap away in "Add another
// wallet" below, which lists the rest of the catalogue. This is flagged as a
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
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { QuickWalletList } from "@/components/onboarding/quick_wallet_list";
import type { WalletProposal } from "@/components/onboarding/quick_wallet_list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCreateWallet } from "@/hooks/mutations/use_create_wallet";
import { useSetWalletMatchers } from "@/hooks/mutations/use_set_wallet_matchers";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallets } from "@/hooks/queries/use_wallets";
import { canCreateWallet } from "@/lib/entitlements";
import { buildProviderChoices } from "@/lib/ingest/provider_catalogue";
import { listObservedPackages } from "@/modules/notification_listener";

import type { ProviderChoice } from "@/lib/ingest/provider_catalogue";
import type { ObservedPackage } from "@/modules/notification_listener";
import type { WalletType } from "@/types/domain";

const CASH_KEY = "cash";

/** Human-cased labels for the catalogue's known provider keys. An observed
 * app the catalogue never heard of falls back to its raw package name, same
 * as provider_picker.tsx's own `displayName` rule. */
const PROVIDER_LABELS: Record<string, string> = {
  gcash: "GCash",
  maya: "Maya",
  bpi: "BPI",
  bdo: "BDO",
  unionbank: "UnionBank",
  metrobank: "Metrobank",
  seabank: "SeaBank",
  gotyme: "GoTyme",
  cimb: "CIMB",
  landbank: "Landbank",
  shopeepay: "ShopeePay",
  grabpay: "GrabPay",
  sms_relay: "Bank SMS",
};

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
  return PROVIDER_LABELS[choice.displayName] ?? choice.displayName;
}

function defaultTypeFor(choice: ProviderChoice): WalletType {
  return WALLET_TYPE_BY_PROVIDER_KEY[choice.displayName] ?? "bank";
}

function proposalFor(choice: ProviderChoice, included: boolean): WalletProposal {
  return {
    key: choice.packageName,
    name: defaultNameFor(choice),
    type: defaultTypeFor(choice),
    packageName: choice.packageName,
    included,
  };
}

/** Rule: "plus a cash wallet checked by default." Always present, always on. */
const CASH_PROPOSAL: WalletProposal = {
  key: CASH_KEY,
  name: "Cash",
  type: "cash",
  packageName: null,
  included: true,
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
  const { data: ruleset } = useRuleset();
  const { data: existingWallets } = useWallets();
  const createWallet = useCreateWallet();
  const setMatchers = useSetWalletMatchers();

  const [observed, setObserved] = useState<ObservedPackage[] | null>(null);
  const [proposals, setProposals] = useState<WalletProposal[] | null>(null);
  const [addable, setAddable] = useState<ProviderChoice[]>([]);
  const initializedRef = useRef(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [capExceeded, setCapExceeded] = useState(false);

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
    const observedChoices = choices.filter((choice) => choice.seen);
    const suggestedOnly = choices.filter((choice) => !choice.seen);

    setProposals([...observedChoices.map((choice) => proposalFor(choice, true)), CASH_PROPOSAL]);
    setAddable(suggestedOnly);
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

  function addProvider(choice: ProviderChoice): void {
    setProposals((current) => (current ? [...current, proposalFor(choice, true)] : current));
    setAddable((current) => current.filter((c) => c.packageName !== choice.packageName));
  }

  async function submit(): Promise<void> {
    if (!proposals || submitting) return;
    const included = proposals.filter((p) => p.included && p.name.trim() !== "");

    if (included.length === 0) {
      onDone?.();
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
        });
        if (proposal.packageName) {
          await setMatchers.mutateAsync({
            walletId: wallet.id,
            matchers: [{ packageName: proposal.packageName }],
          });
        }
        runningCount += 1;
      }

      if (wouldExceedCap) {
        // The explanation renders below; onDone fires only once the user has
        // actually seen it (its own "Continue" button).
        setCapExceeded(true);
      } else {
        onDone?.();
      }
    } catch {
      // Wallets already created stay created (gate principle 1: never delete
      // on a failure either) — only the ones that did not get created yet are
      // lost, and the user can add them from the Wallets tab afterward.
      setSubmitError(
        "Some wallets couldn't be saved. The ones that worked are ready — add any others later from the Wallets tab.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (capExceeded) {
    return (
      <OnboardingFrame
        step="wallets"
        title="Wallets are set up"
        onPrimary={() => onDone?.()}
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
      onBack={onBack}
      onSkip={() => onDone?.()}
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

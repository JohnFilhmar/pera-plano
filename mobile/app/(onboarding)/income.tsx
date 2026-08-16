// app/(onboarding)/income.tsx — the M3c onboarding income-declaration step
// (m3c-onboarding-client plan Task 3, rule 3; docs/04-features/01-onboarding.md
// step 8).
//
// WHY THIS STEP COMES AFTER WALLETS. `setManualIncome` (lib/income/income_service.ts)
// takes `sourceWalletIds`, and the only Wallets that can possibly be a source
// are the ones the previous step just created — asking this question any
// earlier would have nothing to offer the picker.
//
// SKIP AND "LET PERAPLANO FIGURE IT OUT" ARE THE SAME ACTION, wired to the
// same handler, the same discipline app/(onboarding)/providers.tsx already
// uses for "Skip" and "confirm with nothing ticked": both leave no
// IncomeProfile at all (docs rule 12) and detection — already running on
// bootstrap and every ledger commit — proposes one later on its own.
//
// COMPONENTS NEVER IMPORT A REPOSITORY (release-gate grep). This file does,
// through hooks/mutations/use_set_manual_income.ts and
// hooks/queries/use_wallets.ts only — never lib/db/repos/** directly.
import { useCallback } from "react";

import { IncomeQuickForm } from "@/components/onboarding/income_quick_form";
import type { IncomeQuickFormValues } from "@/components/onboarding/income_quick_form";
import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { useSetManualIncome } from "@/hooks/mutations/use_set_manual_income";
import { useWallets } from "@/hooks/queries/use_wallets";

export default function IncomeScreen({
  onDone,
  onBack,
}: { onDone?: () => void; onBack?: () => void } = {}) {
  const { data: wallets } = useWallets();
  const setManual = useSetManualIncome();

  const advance = useCallback(() => onDone?.(), [onDone]);

  const submit = useCallback(
    async (values: IncomeQuickFormValues) => {
      await setManual.mutateAsync(values);
      advance();
    },
    [setManual, advance],
  );

  return (
    <OnboardingFrame
      step="income"
      title="When do you get paid?"
      // The form owns exactly one button ("Save my income"); the frame's
      // primary button and skip link are both "figure it out" — two
      // differently-worded, equally safe ways to leave without declaring a
      // figure the user does not have yet (see income_quick_form.tsx's header).
      onPrimary={advance}
      primaryLabel="Let PeraPlano figure it out"
      onBack={onBack}
      onSkip={advance}
    >
      <IncomeQuickForm wallets={wallets ?? []} busy={setManual.isPending} onSubmit={submit} />
    </OnboardingFrame>
  );
}

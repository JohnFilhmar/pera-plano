// components/privacy/wipe_flow.tsx — "Wipe everything" (m3b Task 6 rule 5;
// docs §04-features/11-settings-privacy.md Flow F, rules 10-11).
//
// THE MOST DANGEROUS CODE IN THIS TASK. It is the trigger for
// `lib/privacy/data_wipe.ts`'s `wipeAllData()`, which deletes the user's
// entire ledger irrecoverably — so a single tap must never be enough.
//
// TWO CONFIRMATIONS, NEITHER OF WHICH IS THE OTHER'S RUBBER STAMP:
//
//   STEP 1 — a destructive `ConfirmDialog` that names exactly what will be
//   destroyed, in plain nouns ("every wallet, transaction ... captured
//   notification, and setting"), never a euphemism like "your data". Its
//   confirm label reads "Continue to wipe" — docs Flow F step 1's own
//   wording, verbatim, because this step does not itself erase anything; it
//   only opens the real gate.
//
//   STEP 2 — the typed confirmation docs Flow F step 2 requires: the user
//   must type the exact word DELETE before the final, differently-worded
//   button ("Erase everything") becomes pressable at all. A dialog tap and a
//   keyboard entry are different muscle memories on purpose — the second
//   step cannot be satisfied by someone's thumb landing in the same place
//   twice.
//
// CANCELLING EITHER STEP WIPES NOTHING. Backing out of step 1 never opens
// step 2; backing out of step 2 returns to idle with `onConfirmed` never
// called — asserted directly in app/__tests__/privacy_screen.test.tsx via
// the mocked `wipeAllData`/`exportAllData` never firing.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { ConfirmDialog } from "@/components/ui/confirm_dialog";

/** The exact word docs Flow F step 2 requires — no case-folding, no trimming shortcuts beyond surrounding whitespace. */
const CONFIRM_WORD = "DELETE";

/**
 * Enumerates what is destroyed, in plain domain nouns rather than raw SQL
 * table names. Every noun here names a real entity `wipeAllData()` actually
 * empties — app/__tests__/privacy_screen.test.tsx's wipe-copy test checks
 * each one against the live table list from `lib/db/table_names.ts`, not a
 * hand-trusted guess. `data_wipe.test.ts` separately proves the FUNCTION
 * empties every single table, including the junction/history tables no
 * user-facing sentence would name individually (`loan_payments`,
 * `bill_cycles`, `income_profile_sources`, and so on) — this copy's job is a
 * truthful summary, not a literal schema dump.
 */
export const WIPE_STEP_ONE_BODY =
  "This permanently deletes every wallet, transaction, transfer, category, limit, income profile, goal, loan, bill, recurring pattern, and rule on this device — along with every captured notification, pending review item, and setting. This cannot be undone.";

export const WIPE_STEP_TWO_BODY = `Type ${CONFIRM_WORD} to confirm. This is permanent — there is no way to recover your data afterward.`;

export type WipeFlowProps = {
  /** Called only once BOTH confirmations are satisfied. */
  onConfirmed: () => void | Promise<void>;
  busy?: boolean;
  testID?: string;
};

type Step = "idle" | "confirm" | "type-delete";

export function WipeFlow({ onConfirmed, busy = false, testID = "wipe-flow" }: WipeFlowProps) {
  const [step, setStep] = useState<Step>("idle");
  const [typedWord, setTypedWord] = useState("");

  const reset = () => {
    setStep("idle");
    setTypedWord("");
  };

  const handleErase = () => {
    if (typedWord.trim() !== CONFIRM_WORD) return;
    void onConfirmed();
  };

  return (
    <View testID={testID}>
      <Button
        testID="wipe-everything-trigger"
        title="Wipe everything"
        variant="destructive"
        onPress={() => setStep("confirm")}
      />

      <ConfirmDialog
        visible={step === "confirm"}
        title="Erase everything?"
        body={WIPE_STEP_ONE_BODY}
        confirmLabel="Continue to wipe"
        destructive
        onConfirm={() => setStep("type-delete")}
        onCancel={reset}
      />

      <BottomSheet visible={step === "type-delete"} onDismiss={reset} title="Type DELETE to confirm">
        <View className="gap-3">
          <Text className="text-fg-2 dark:text-fg-2-dark">{WIPE_STEP_TWO_BODY}</Text>
          <TextInput
            testID="wipe-confirm-input"
            value={typedWord}
            onChangeText={setTypedWord}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            placeholder={CONFIRM_WORD}
            accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
            className="rounded-lg border border-fg-2 p-3 text-fg dark:border-fg-2-dark dark:text-fg-dark"
          />
          <Button
            testID="wipe-confirm-erase"
            title="Erase everything"
            variant="destructive"
            onPress={handleErase}
            disabled={typedWord.trim() !== CONFIRM_WORD}
            loading={busy}
          />
          <Button testID="wipe-confirm-cancel" title="Cancel" variant="ghost" onPress={reset} />
        </View>
      </BottomSheet>
    </View>
  );
}

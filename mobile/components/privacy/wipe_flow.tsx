// components/privacy/wipe_flow.tsx — "Wipe everything" (m3b Task 6 rule 5;
// docs §04-features/11-settings-privacy.md Flow F, rules 10-11).
//
// THE MOST DANGEROUS CODE IN THIS TASK. It is the trigger for the Privacy
// centre's full factory reset — `contexts/lock_context.tsx`'s
// `wipeAndStartOver`, which runs `lib/security/wipe.ts` (wipeDatabase →
// wipeKeys → clearCaptureBuffer) and then drops the app back to
// "needs_onboarding". That deletes the user's entire ledger AND the key
// material and recovery phrase that could ever have reopened it, all
// irrecoverably — so a single tap must never be enough. It used to trigger
// only `lib/privacy/data_wipe.ts`'s `wipeAllData()`, a logical `DELETE FROM`
// sweep that left the keys and the phrase in place; see
// app/(tabs)/more/privacy.tsx's `handleWipeConfirmed` for why that was a bug
// and what the copy below had to start saying once it was fixed.
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
// the mocked `wipeAndStartOver`/`exportAllData` never firing.
import { useState } from "react";
import { Trash2 } from "lucide-react-native";
import { Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { ConfirmDialog } from "@/components/ui/confirm_dialog";
import { usePlaceholderColor } from "@/lib/ui/placeholder";

/** The exact word docs Flow F step 2 requires — no case-folding, no trimming shortcuts beyond surrounding whitespace. */
const CONFIRM_WORD = "DELETE";

/**
 * Enumerates what is destroyed, in plain domain nouns rather than raw SQL
 * table names. Every noun in the first sentence names a real entity the wipe
 * actually destroys — app/__tests__/privacy_screen.test.tsx's wipe-copy test
 * checks each one against the live table list from `lib/db/table_names.ts`,
 * not a hand-trusted guess. `data_wipe.test.ts` separately proves a table
 * sweep reaches every single table, including the junction/history tables no
 * user-facing sentence would name individually (`loan_payments`,
 * `bill_cycles`, `income_profile_sources`, and so on) — this copy's job is a
 * truthful summary, not a literal schema dump.
 *
 * THE SECOND SENTENCE IS THE ONE THIS FLOW USED TO OWE THE USER. The wipe is
 * now `lib/security/wipe.ts`'s full start-over: the database FILE, both key
 * wraps, and the capture buffer, which means the 12-word recovery phrase the
 * user wrote down and the device-lock enrolment behind it stop working too,
 * and the next launch is a genuine first run. Copy that promised only "your
 * data" would be understating a destruction the user cannot reverse and
 * cannot be warned about afterwards, so it says so here, before the typed
 * confirmation rather than after it.
 */
export const WIPE_STEP_ONE_BODY =
  "This permanently deletes every wallet, transaction, transfer, category, limit, income profile, goal, loan, bill, recurring pattern, and rule on this device — along with every captured notification, pending review item, and setting. It also destroys this device's encryption keys, so your current 12-word recovery phrase stops working and PeraPlano starts over from scratch: a new device-lock step and a brand-new phrase to write down. This cannot be undone.";

export const WIPE_STEP_TWO_BODY = `Type ${CONFIRM_WORD} to confirm. This is permanent — your data, your encryption keys, and your current recovery phrase are all destroyed, and you will set PeraPlano up from scratch afterward.`;

export type WipeFlowProps = {
  /** Called only once BOTH confirmations are satisfied. */
  onConfirmed: () => void | Promise<void>;
  busy?: boolean;
  testID?: string;
};

type Step = "idle" | "confirm" | "type-delete";

export function WipeFlow({ onConfirmed, busy = false, testID = "wipe-flow" }: WipeFlowProps) {
  const placeholderColor = usePlaceholderColor();
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
      {/*
        mobile-ui-revamp Part 3 Task 4 — the `outline-destructive` variant
        Part 1 Task 4 built (surface fill, danger border, danger ink) and
        this exact button is the reason it exists: this trigger sits at REST
        on the Privacy centre, readable calmly before anyone presses it. The
        typed-confirmation "Erase everything" button inside the sheet below
        keeps the SOLID `destructive` fill on purpose — that one is a press
        happening inside a dialog flow the user already chose to enter, which
        is the other half of the same distinction (see button.tsx's own
        comment on the variant).
      */}
      <Button
        testID="wipe-everything-trigger"
        title="Wipe all PeraPlano data"
        variant="outline-destructive"
        icon={Trash2}
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
            placeholderTextColor={placeholderColor}
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

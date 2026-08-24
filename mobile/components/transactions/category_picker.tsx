// components/transactions/category_picker.tsx — m1c plan Task 7, rule 6.
//
// The sheet behind the transaction detail's category field, and the checkbox
// that decides whether the correction is remembered.
//
// THE CHECKBOX IS THE WHOLE POINT OF THIS COMPONENT. §8 rule 2 is that user
// corrections must stick — a user who recategorizes the same merchant every
// month, forever, will stop correcting anything at all. So it is CHECKED BY
// DEFAULT: the common case is "yes, always".
//
// AND UNCHECKING IT MUST MEAN EXACTLY WHAT IT SAYS. A user who unchecks has
// made a specific statement — this one row is wrong, the merchant is not. Some
// Jollibee visits are groceries. Creating the rule anyway would silently
// recategorize rows they never looked at, they would find out weeks later from
// a report, and by then nothing on screen explains why. That is why the
// checkbox's state is reported to the caller as a distinct value rather than
// being an implementation detail of the save.
//
// THE RULE IT DESCRIBES IS THE SHIPPED `UserRule` SHAPE, not the plan's. The
// plan says "a UserRule of kind `merchant_category`"; that model does not exist
// in this codebase (types/domain.ts ships a matcher/action pair). The caller
// builds it — this component only decides whether one is wanted.
//
// NO RULE IS OFFERED WITHOUT A MERCHANT. `merchantPattern` is a
// case-insensitive substring test and lib/ingest/categorizer.ts makes a blank
// pattern FAIL CLOSED, so a rule built from a null merchant is a rule that can
// never fire — sitting in the user's settings looking as though it might.
//
// PRESENTATIONAL: categories arrive from the screen's `useCategories()`.
import { Check } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { registerIcon } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import type { Category } from "@/types/domain";

const CheckGlyph = registerIcon(Check);

/** The checkbox's sentence. Names BOTH halves of what the rule will do. */
export function alwaysCategorizeLabel(merchant: string, categoryName: string): string {
  return `Always categorize ${merchant} as ${categoryName}`;
}

export type CategoryChoice = {
  categoryId: string;
  /** False when the user unchecked the box, or when there is no merchant. */
  createRule: boolean;
};

export type CategoryPickerProps = {
  visible: boolean;
  categories: readonly Category[];
  /** The transaction's current category — preselected, so Save is never blind. */
  selectedId: string;
  /** `null` when the row has no merchant: no rule can be offered. */
  merchant: string | null;
  onDismiss: () => void;
  onSubmit: (choice: CategoryChoice) => void;
};

export function CategoryPicker({
  visible,
  categories,
  selectedId,
  merchant,
  onDismiss,
  onSubmit,
}: CategoryPickerProps) {
  const [pending, setPending] = useState(selectedId);
  const [createRule, setCreateRule] = useState(true);

  // Reopening the sheet starts from the row's CURRENT category and a fresh
  // checkbox. Without this, a sheet dismissed mid-edit re-opens holding a
  // choice the user abandoned, and one more tap on Save commits it.
  useEffect(() => {
    if (visible) {
      setPending(selectedId);
      setCreateRule(true);
    }
  }, [visible, selectedId]);

  const selectedName = categories.find((category) => category.id === pending)?.name ?? "";
  const changed = pending !== selectedId;
  // Rule 6: only when the transaction has a merchant, and only when the
  // category is actually changing — "always categorize X as X" teaches nothing.
  const offersRule = merchant !== null && merchant.trim() !== "" && changed;

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Category">
      <View testID="category-picker" className="gap-3">
        <ScrollView className="max-h-80">
          {categories.map((category) => {
            const isPending = category.id === pending;
            return (
              <Pressable
                key={category.id}
                testID={`category-option-${category.id}`}
                onPress={() => setPending(category.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isPending, checked: isPending }}
                accessibilityLabel={category.name}
                className="min-h-[44px] flex-row items-center gap-3 py-3"
              >
                <Text className="flex-1 text-base text-fg dark:text-fg-dark">{category.name}</Text>
                {isPending ? (
                  <CheckGlyph size={18} className="text-brand dark:text-brand-dark" />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        {offersRule ? (
          <Pressable
            testID="category-rule-checkbox"
            onPress={() => setCreateRule((on) => !on)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: createRule }}
            accessibilityLabel={alwaysCategorizeLabel(merchant, selectedName)}
            className="min-h-[44px] flex-row items-center gap-3 py-2"
          >
            <View
              className={
                createRule
                  ? "h-5 w-5 items-center justify-center rounded border-2 border-brand bg-brand dark:border-brand-dark dark:bg-brand-dark"
                  : "h-5 w-5 items-center justify-center rounded border-2 border-fg-2 dark:border-fg-2-dark"
              }
            >
              {createRule ? (
                <CheckGlyph size={14} className="text-surface dark:text-surface-dark" />
              ) : null}
            </View>
            <Text className="flex-1 text-sm text-fg dark:text-fg-dark">
              {alwaysCategorizeLabel(merchant, selectedName)}
            </Text>
          </Pressable>
        ) : null}

        <Button
          testID="category-picker-save"
          title="Save"
          onPress={() => onSubmit({ categoryId: pending, createRule: offersRule && createRule })}
        />
      </View>
    </BottomSheet>
  );
}

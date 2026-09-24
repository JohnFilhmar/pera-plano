// components/privacy/user_rules_list.tsx — GAP-128, review-queue rule 16.
//
// The list that rule 16 promised and nothing ever built. Every UserRule the
// device holds, what it matches, what it does, how often it has fired, and the
// two controls the rule needs: a switch and a delete.
//
// PRESENTATIONAL, like `health_card.tsx`. The rules, the name lookups and both
// callbacks arrive as props, so this file requires under Jest with no database
// and no native module, and the screen owns the hooks.
//
// WHY THE NAMES ARE PASSED IN RATHER THAN LOOKED UP HERE. A row reading "Set
// category to 7f3a-91c2-…" satisfies "listed" on a technicality and fails the
// point of it: the user is deciding whether a rule is the one miscategorizing
// their lunches, and a UUID tells them nothing. Categories and wallets resolve
// because the screen already has both lists cheaply. A loan does NOT, and that is
// deliberate rather than unfinished: "Mark as a loan payment" plus the matcher
// says everything needed to judge the rule, and pulling a third query in to name
// the loan would buy a noun.
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm_dialog";
import { EmptyState } from "@/components/ui/empty_state";
import type { UserRule, UserRuleAction, UserRuleMatcher } from "@/types/domain";

/** Just enough of a category or wallet to name one. */
export type NamedRef = { id: string; name: string };

export type UserRulesListProps = {
  rules: UserRule[];
  categories: NamedRef[];
  wallets: NamedRef[];
  onToggle: (change: { id: string; isEnabled: boolean }) => void;
  onDelete: (id: string) => void;
  testID?: string;
};

/** The name for an id, or the id itself — never blank. */
function nameFor(refs: NamedRef[], id: string): string {
  return refs.find((ref) => ref.id === id)?.name ?? id;
}

/**
 * The matcher as a sentence: every field the user actually set, in the order
 * `matcherApplies` tests them.
 *
 * An EMPTY matcher matches everything, and says so rather than rendering an
 * empty line. One can exist: the schema makes every field optional, so a
 * correction that named no condition produces a rule that fires on every
 * notification, and that is precisely the rule a user most needs to find.
 */
function describeMatcher(matcher: UserRuleMatcher): string {
  const parts: string[] = [];
  if (matcher.providerKey !== undefined) parts.push(`from ${matcher.providerKey}`);
  if (matcher.merchantPattern !== undefined) parts.push(`mentioning "${matcher.merchantPattern}"`);
  if (matcher.direction !== undefined) {
    parts.push(matcher.direction === "in" ? "money in" : "money out");
  }
  if (matcher.amountMin !== undefined) parts.push(`at least ${formatCentavos(matcher.amountMin)}`);
  if (matcher.amountMax !== undefined) parts.push(`at most ${formatCentavos(matcher.amountMax)}`);
  return parts.length === 0 ? "Any notification" : parts.join(", ");
}

/** The action as a sentence, one per kind the domain ships. */
function describeAction(
  action: UserRuleAction,
  categories: NamedRef[],
  wallets: NamedRef[],
): string {
  switch (action.kind) {
    case "set-category":
      return `Categorize as ${nameFor(categories, action.categoryId)}`;
    case "set-wallet":
      return `Assign to ${nameFor(wallets, action.walletId)}`;
    case "set-merchant":
      return `Rename the merchant to ${action.merchant}`;
    case "mark-transfer":
      return `Treat as a transfer with ${nameFor(wallets, action.counterpartWalletId)}`;
    case "mark-loan-payment":
      return "Mark as a loan payment";
    case "suppress-recurring":
      return `Stop suggesting ${action.merchant} as a subscription`;
    case "ignore":
      return "Ignore it";
  }
}

/** "Never applied", or how many times and nothing more precise than that. */
function describeUse(appliedCount: number): string {
  if (appliedCount === 0) return "Never applied yet";
  return appliedCount === 1 ? "Applied once" : `Applied ${appliedCount} times`;
}

/**
 * Every UserRule, with a switch and a delete apiece (review-queue rule 16).
 *
 * Deleting asks first and the switch does not, which is the difference between
 * the two: `setUserRuleEnabled` is reversible in one press, while a delete
 * cannot be undone and the confirmation says what it does and does not touch.
 */
export function UserRulesList({
  rules,
  categories,
  wallets,
  onToggle,
  onDelete,
  testID,
}: UserRulesListProps) {
  const [pendingDelete, setPendingDelete] = useState<UserRule | null>(null);

  if (rules.length === 0) {
    return (
      <EmptyState
        testID="user-rules-empty"
        title="No rules yet"
        body="When you correct a transaction in the Review Queue, PeraPlano remembers the correction as a rule and applies it to matching notifications from then on. Those rules appear here."
      />
    );
  }

  return (
    <View testID={testID ?? "user-rules-list"} className="gap-3">
      {rules.map((rule) => (
        <Card key={rule.id} testID={`user-rule-row-${rule.id}`}>
          <View className="flex-row items-start gap-3">
            <View className="flex-1 gap-1">
              <Text className="font-semibold text-fg dark:text-fg-dark">
                {describeAction(rule.action, categories, wallets)}
              </Text>
              <Text className="text-secondary text-fg-2 dark:text-fg-2-dark">
                {describeMatcher(rule.matcher)}
              </Text>
              <View className="mt-1 flex-row items-center gap-2">
                <Text className="text-secondary text-fg-2 dark:text-fg-2-dark">
                  {describeUse(rule.appliedCount)}
                </Text>
                {rule.isEnabled ? null : (
                  <Chip
                    testID={`user-rule-off-${rule.id}`}
                    label="Off"
                    tone="neutral"
                    fill="outline"
                  />
                )}
              </View>
            </View>
            <Switch
              testID={`user-rule-toggle-${rule.id}`}
              value={rule.isEnabled}
              onValueChange={(isEnabled) => onToggle({ id: rule.id, isEnabled })}
              accessibilityRole="switch"
              accessibilityLabel={`${describeAction(rule.action, categories, wallets)}, ${describeMatcher(rule.matcher)}`}
              accessibilityState={{ checked: rule.isEnabled }}
            />
          </View>

          <Pressable
            testID={`user-rule-delete-${rule.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Delete rule: ${describeAction(rule.action, categories, wallets)}`}
            className="mt-3 self-start"
            onPress={() => setPendingDelete(rule)}
          >
            <Text className="font-semibold text-danger dark:text-danger-dark">Delete rule</Text>
          </Pressable>
        </Card>
      ))}

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete this rule?"
        body="It stops applying to new notifications. Transactions it already changed stay exactly as they are — deleting a rule never rewrites your past ledger."
        confirmLabel="Delete rule"
        destructive
        onConfirm={() => {
          if (pendingDelete === null) return;
          onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}

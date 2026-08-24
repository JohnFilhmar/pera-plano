# Mobile UI Revamp — Part 3: More, System States, Onboarding and Motion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the revamp — the More tab and its five screens, the beta-tier presentation, the system states, all twelve onboarding steps, and the motion layer.

**Architecture:** More first, because it carries the two risks that outlive this task (R2's dead Plus badges and R3's contradictory tier counts). Then system states, then onboarding, then motion last so it lands on finished screens and needs one device pass rather than four.

**Tech Stack:** Expo 54 · React Native 0.81.5 · expo-router 6 · NativeWind 4.2.6 · Reanimated 4.1.1 · lucide-react-native · jest-expo + @testing-library/react-native

**Spec:** `docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md`

**Prerequisite:** Parts 1 and 2 are merged.

## Global Constraints

Everything in Part 1's Global Constraints still applies. Additionally:

- **Beta means unlocked, not free-of-charge-forever-for-everyone.** `lib/entitlements.ts` already hardcodes `MVP_TIER = "plus"`. Nothing in this part changes enforcement. What changes is that the unlocked state becomes visible and is labelled honestly.
- **No prices, no purchase path, no trial CTA.** Spec D7. Plus is blocked on a PIC entity, a DPO and NPC registration; a button that starts a trial has nothing to start.
- **No install date anywhere.** Spec §6.3. Nothing records one, and one cannot be reconstructed. Do not render "member since", "beta tester since", or any date derived from an assumption that this data exists.
- **`SoonGate` stays.** It gains its first real user in Task 3 (Shared budgets). Do not delete it.

## How to read the restyle tasks

Tasks 1, 2, 3, 5 and 7 give full code, because they create components or change behaviour.

Tasks 4, 4b and 6 do not, and that is deliberate. They restyle roughly forty existing files whose current contents this plan's author did not read line by line. Writing invented JSX for them would produce code that looks right and silently drops a `testID`, an accessibility label, or a branch that a comment in the file explains. So those tasks specify the **target composition** exactly — which component, which tone, which token, which `testID`s are load-bearing — and require you to open the file first.

**Every one of those tasks starts by reading the file.** If a step tells you to change a class string and you cannot find it, the file has moved on since this plan was written: follow the file, not the plan, and say so in your commit message.

## What is already built, and must not be rebuilt

Read this before Task 7. `components/ui/brand_mark.tsx` **already implements the entire motion layer**:

```ts
export type BrandMarkVariant = "static" | "idle" | "launch" | "loading";
export type BrandMarkProps = {
  size?: number;          // square edge in dp, default 48
  variant?: BrandMarkVariant;
  playToken?: number;     // `launch` only: any change replays the one-shot
  className?: string;
  testID?: string;
};
```

It already honours reduce-motion, and it does so correctly — `useReduceMotion` treats `null` (the OS has not answered yet) as "do not move", which is the safe default and easy to get backwards. `brand_mark_motion.ts` already holds the designer's transcribed keyframes, and `__tests__/brand_mark_motion.test.tsx` asserts their literal values.

**Task 7 is placement, not authoring.** Spec R8's resolution reads as though the reduce-motion work is still to do; it is not. Do not re-implement any of it, and do not "tune" a single constant in `brand_mark_motion.ts` — that file's header explains why every value in it is a hand-copy rather than a choice.

---

### Task 1: More hub — profile card and grouped sections

**Files:**
- Modify: `mobile/app/(tabs)/more/index.tsx`
- Create: `mobile/components/more/profile_card.tsx`
- Create: `mobile/components/more/__tests__/profile_card.test.tsx`
- Modify: `mobile/app/__tests__/more_hub.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Chip`, `BrandMark`, `ListRow` (Parts 1–2).
- Produces: `<ProfileCard testID?: string />`.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/more/__tests__/profile_card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { ProfileCard } from "../profile_card";

test("names the beta user and says what that means", () => {
  render(<ProfileCard testID="p" />);
  screen.getByText("Beta User");
  screen.getByText("Beta tester · everything unlocked");
});

test("there is no upgrade call to action during beta", () => {
  render(<ProfileCard testID="p" />);
  expect(screen.queryByText(/go plus/i)).toBeNull();
  expect(screen.queryByText(/upgrade/i)).toBeNull();
});

test("no install date is claimed, because none is recorded", () => {
  render(<ProfileCard testID="p" />);
  expect(screen.queryByText(/since/i)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- profile_card`
Expected: FAIL — `Cannot find module '../profile_card'`.

- [ ] **Step 3: Implement**

Create `mobile/components/more/profile_card.tsx`:

```tsx
// components/more/profile_card.tsx — the card at the top of More.
//
// The design draws "Ana Reyes · Free plan · [Go Plus]". None of those three
// things is true here: there is no account and therefore no name, the tier is
// not Free (lib/entitlements.ts pins MVP_TIER to "plus"), and there is nothing
// to upgrade to while Plus is blocked on a PIC entity, a DPO and NPC
// registration. So the card says the true version of the same three things.
//
// NO DATE. Nothing records when this install happened, and an install date
// cannot be reconstructed after the fact (revamp spec §6.3). A "beta tester
// since March" line would be inventing data. The cohort question is deferred
// to Google account linking.
import { Text, View } from "react-native";

import { BETA_USER_LABEL } from "@/components/home/greeting_header";
import { BrandMark } from "@/components/ui/brand_mark";
import { Card } from "@/components/ui/card";

// ONE declaration of the user-facing tag, in greeting_header.tsx, imported
// here. Two independent copies is how "Beta User" and "Beta user" end up on
// adjacent screens.
export const BETA_STATUS_LABEL = "Beta tester · everything unlocked";

export function ProfileCard({ testID }: { testID?: string }) {
  return (
    <View testID={testID}>
      <Card>
        <View className="flex-row items-center gap-3">
          <BrandMark size={40} />
          <View className="flex-1">
            <Text className="text-section font-bold text-fg dark:text-fg-dark">
              {BETA_USER_LABEL}
            </Text>
            <Text className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
              {BETA_STATUS_LABEL}
            </Text>
          </View>
        </View>
      </Card>
    </View>
  );
}
```

If `greeting_header.tsx` has not landed yet because Part 2 is still in review, declare `BETA_USER_LABEL` here and import it *from* here in `greeting_header.tsx` instead. Either direction is fine; two declarations is not.

- [ ] **Step 4: Restyle the More hub**

In `mobile/app/(tabs)/more/index.tsx`, render `<ProfileCard testID="more-profile" />` first, then group the rows under three `SectionHeader`s — **Insights** (Reports, Subscriptions, Shared budgets), **Tracking** (Listener health, Parser diagnostics, Privacy centre), **App** (Settings, About).

Replace each `Card`-wrapped `Pressable` with a `ListRow`: `title` is the row name, `subtitle` is the existing one-line blurb, `left` is the row's lucide glyph in a 32dp `bg-chip` disc, `right` is a `ChevronRight`. Keep every existing `testID` and `accessibilityLabel` exactly — `more-reports`, `more-subscriptions`, `more-settings`, `more-privacy-center` and the rest are asserted in `more_hub.test.tsx`.

Keep both gates exactly where they are. `SoonGate feature="reports"` and `PlusGate capability="recurring"` stay wrapped around the same rows; Task 2 changes what `PlusGate` renders, not where it sits.

Add the About row if it does not exist, showing `APP_VERSION`. Do not add a date beside it.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean, with `more_hub.test.tsx` passing on its existing assertions.

- [ ] **Step 6: Commit**

```bash
git add mobile/components/more/ mobile/app/\(tabs\)/more/index.tsx mobile/app/__tests__/more_hub.test.tsx
git commit -m "feat(more): profile card and grouped sections"
```

---

### Task 2: Make the Plus badges visible and drop the tier counts

**Files:**
- Modify: `mobile/components/gates/plus_gate.tsx`
- Modify: `mobile/components/gates/upgrade_sheet.tsx`
- Modify: `mobile/components/gates/__tests__/gates.test.tsx`

**Interfaces:**
- Consumes: `Chip` with `fill="soft"` (Part 1).
- Produces: `PlusGate` renders a non-interactive badge on the unlocked path. `PLUS_BETA_LABEL` is exported for tests.

**This is spec R2 and R3, the two risks that outlive the revamp.**

R2: `plus_gate.tsx:31` currently returns `<>{children}</>` when the tier is plus. With `MVP_TIER = "plus"`, **no PLUS badge has ever rendered in this app**, though the design draws one on nine of the thirty-six boards.

R3: `upgrade_sheet.tsx`'s `CAPABILITY_COPY` publishes the free-tier counts — `wallets: { free: "3" }`, `goals: { free: "1, progress tracking" }`, `amortization: { free: "1, basic tracking" }`. The design's table says "Limits & goals — 3 each". The code says 1. Those numbers must not ship.

- [ ] **Step 1: Write the failing test**

Add to `mobile/components/gates/__tests__/gates.test.tsx`:

```tsx
import { PLUS_BETA_LABEL } from "../plus_gate";

test("on plus, children render AND the badge shows — it is not silently absent", () => {
  __setTierForTests("plus");
  render(
    <PlusGate capability="recurring">
      <Text>Subscriptions</Text>
    </PlusGate>,
  );
  screen.getByText("Subscriptions");
  screen.getByTestId("plus-badge");
  screen.getByText(PLUS_BETA_LABEL);
});

test("the unlocked badge does not intercept presses", () => {
  __setTierForTests("plus");
  const onPress = jest.fn();
  render(
    <PlusGate capability="recurring">
      <Pressable testID="inner" onPress={onPress}>
        <Text>Subscriptions</Text>
      </Pressable>
    </PlusGate>,
  );
  fireEvent.press(screen.getByTestId("inner"));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("plus-gate")).toBeNull();
});

test("on free, the gate still intercepts and still opens the sheet", () => {
  __setTierForTests("free");
  render(
    <PlusGate capability="recurring">
      <Text>Subscriptions</Text>
    </PlusGate>,
  );
  screen.getByTestId("plus-gate");
  screen.getByTestId("plus-badge");
});

test("no free-tier count is published anywhere in the sheet", () => {
  __setTierForTests("free");
  render(<UpgradeSheet visible onClose={() => {}} capability="wallets" />);
  // entitlements.ts caps limits, goals and loans at 1; the design's table says
  // 3. Until docs/05 settles it, the app publishes neither number.
  expect(screen.queryByText("3")).toBeNull();
  expect(screen.queryByText(/^1,/)).toBeNull();
});
```

Reuse whatever render helper and `__setTierForTests` import the file already has; do not introduce a second pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gates`
Expected: FAIL — `PLUS_BETA_LABEL` is not exported and no badge renders on the plus path.

- [ ] **Step 3: Render the badge on both paths**

Rewrite the body of `PlusGate` in `mobile/components/gates/plus_gate.tsx`:

```tsx
/**
 * The label on an UNLOCKED Plus capability during beta.
 *
 * Why label it at all, when nothing is blocked: the design puts a mint lock
 * badge on nine boards, and until now `getTier() === "plus"` returned bare
 * children, so not one of them had ever rendered in the running app. Shipping
 * the badge only on the `free` path would have shipped the entire Plus visual
 * language as unreachable code.
 *
 * Why this wording and not a plain "PLUS": a badge reading PLUS on a feature
 * that is not locked reads as a bug. This says the true thing — it becomes
 * paid later, it is yours now — so the eventual switch to paid is a change of
 * copy rather than a change of layout across a dozen screens, and beta testers
 * already know which features they were promised.
 */
export const PLUS_BETA_LABEL = "PLUS · free in beta";

export function PlusGate({
  capability,
  children,
}: {
  capability: PlusCapability;
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  if (getTier() === "plus") {
    return (
      <View>
        {children}
        <View testID="plus-badge" className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-brand-soft px-2 py-0.5 dark:bg-brand-soft-dark">
          <Lock size={11} className="text-brand dark:text-brand-dark" />
          <Text className="text-badge font-bold text-brand dark:text-brand-dark">
            {PLUS_BETA_LABEL}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <Pressable
        testID="plus-gate"
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Requires PeraPlano Plus — tap to see what's included"
      >
        <View pointerEvents="none">{children}</View>
        <View testID="plus-badge" className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-brand px-2 py-0.5 dark:bg-brand-dark">
          <Lock size={11} className="text-on-brand dark:text-on-brand-dark" />
          <Text className="text-badge font-bold text-on-brand dark:text-on-brand-dark">Plus</Text>
        </View>
      </Pressable>
      <UpgradeSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        capability={capability}
      />
    </>
  );
}
```

The unlocked badge is soft mint with brand ink; the locked one stays a solid brand fill. Two states, two treatments — a user should be able to tell "yours" from "not yours" without reading.

- [ ] **Step 4: Strip the counts from the capability table**

In `mobile/components/gates/upgrade_sheet.tsx`, replace every numeric `free` value with a non-numeric one, and add a header comment:

```tsx
/**
 * NO COUNTS IN THIS TABLE, DELIBERATELY.
 *
 * `lib/entitlements.ts` caps the free tier at 3 wallets, 1 active limit,
 * 1 goal and 1 loan. The design's Free-vs-Plus board says "Limits & goals —
 * 3 each". Those disagree by 3x, and nobody has decided which is right
 * (logged against the pricing launch in docs/08-risks-and-open-questions.md).
 *
 * Publishing either number advertises a plan the app may not honour — to an
 * audience that was promised permanent Plus. So the table states the SHAPE of
 * each capability and no quantity, which is true under both readings.
 */
const CAPABILITY_COPY: Record<PlusCapability, { label: string; free: string; plus: string }> = {
  wallets: { label: "Auto-tracked wallets", free: "A few", plus: "Unlimited" },
  csv_export: { label: "Export", free: "—", plus: "CSV (PDF later)" },
  recurring: { label: "Recurring/subscription detection", free: "—", plus: "✓" },
  backup: { label: "Cloud backup / multi-device sync", free: "—", plus: "✓" },
  projection: { label: "Safe-to-Spend", free: "Today only", plus: "Projected to end of period" },
  goals: { label: "Goals", free: "Progress tracking", plus: "Unlimited + payday auto-allocate" },
  amortization: { label: "Loans", free: "Balance + next due", plus: "Unlimited + full amortization schedule" },
  reports: { label: "Reports", free: "Basic monthly", plus: "Full + trends + custom range" },
};
```

Restyle the sheet to the design's Free-vs-Plus board: brand-filled mark, the heading **"Everything's unlocked"**, the sub-line **"Free for beta testers, forever. Plus is for people juggling more wallets and utang."**, then the capability table. **Delete the price blocks and the "Start 14-day free trial" button entirely** — do not render them disabled, because a disabled price is still a published price.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Build to the A54**

Run: `npm run android`

Confirm the mint `PLUS · free in beta` badge now appears on Home's projection curve, More's Subscriptions row, and the loan amortization schedule — three places it has never rendered before. Confirm pressing each still works and does **not** open the upgrade sheet.

- [ ] **Step 7: Commit**

```bash
git add mobile/components/gates/
git commit -m "feat(tier): render the Plus badge when unlocked and publish no tier counts"
```

---

### Task 3: Shared budgets — the Soon placeholder

**Files:**
- Create: `mobile/app/(tabs)/more/shared_budgets.tsx`
- Modify: `mobile/constants/shipped_features.ts`
- Modify: `mobile/constants/__tests__/shipped_features.test.ts`
- Modify: `mobile/app/(tabs)/more/index.tsx`
- Create: `mobile/app/__tests__/shared_budgets_screen.test.tsx`

**Interfaces:**
- Consumes: `SoonGate`, `Chip` with `tone="soon"`.
- Produces: `FeatureKey` gains `"shared_budgets"`, seeded `"soon"` — the first key in this map that is not `"shipped"`.

**Why this is worth building.** `shipped_features.ts` says every key is shipped and its header notes there is "no key left for a future plan to flip". `SoonGate` therefore has no live user and reads as dead machinery. Shared budgets gives it one, and signals the roadmap without promising a date.

- [ ] **Step 1: Write the failing test**

Add to `mobile/constants/__tests__/shipped_features.test.ts`:

```ts
test("shared_budgets is the one key still soon", () => {
  expect(SHIPPED_FEATURES.shared_budgets).toBe("soon");
  expect(isShipped("shared_budgets")).toBe(false);
});

test("every other key is shipped", () => {
  for (const [key, state] of Object.entries(SHIPPED_FEATURES)) {
    if (key === "shared_budgets") continue;
    expect(state).toBe("shipped");
  }
});
```

Create `mobile/app/__tests__/shared_budgets_screen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import SharedBudgetsScreen from "../(tabs)/more/shared_budgets";

test("the screen says it is coming, without saying when", () => {
  render(<SharedBudgetsScreen />);
  screen.getByText("Shared budgets are coming in an update");
  expect(screen.queryByText(/\b20\d\d\b/)).toBeNull();
});

test("it lists what the feature will do", () => {
  render(<SharedBudgetsScreen />);
  screen.getByText("Invite by QR — still no accounts");
  screen.getByText("Each phone tracks its own alerts");
  screen.getByText("Shared limits, private transactions");
});

test("the notify action exists but promises nothing it cannot keep", () => {
  render(<SharedBudgetsScreen />);
  screen.getByTestId("shared-budgets-notify");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- shared_budgets`
Expected: FAIL on both files.

- [ ] **Step 3: Add the feature key**

In `mobile/constants/shipped_features.ts`, add `| "shared_budgets"` to `FeatureKey` and to `SHIPPED_FEATURES`:

```ts
  // The first key added after the rollout table closed. Every other key here
  // was flipped to "shipped" by a plan that had built the thing behind it;
  // this one is seeded "soon" and stays that way until shared budgets exists.
  // It also gives SoonGate a live user again — before this, the gate could not
  // close for any key, which made it read as dead machinery.
  shared_budgets: "soon",
```

Update the file's header comment, which currently states that every key is shipped and no key is left to flip. That is now false.

- [ ] **Step 4: Build the screen**

Create `mobile/app/(tabs)/more/shared_budgets.tsx`, rendering the design's Soon board: a 48dp `bg-chip` disc with a lucide `Users` glyph in `text-fg-2`, the heading **"Shared budgets are coming in an update"** at `text-title font-bold`, the body **"Split a household budget with your partner or family — one pool, separate phones, no shared login."**, then three rows each with a dotted-circle glyph and the bullets asserted above, and a full-width secondary `Button` labelled **"Notify me when it ships"**.

The whole screen is `opacity-60` and its glyphs are `text-fg-2` — the design's grey, dormant treatment, which means "designed, not built" and must never be brand green.

**The notify button must not claim a notification will arrive.** There is no account and no push registration for this. On press, show the existing `ConfirmDialog` or a simple inline note saying the app will surface it in the changelog when it ships. If that cannot be done honestly in this task, render the button `disabled` — an inert button is better than a broken promise.

- [ ] **Step 5: Add the row to More**

In the **Insights** group in `more/index.tsx`, below Subscriptions:

```tsx
      <SoonGate feature="shared_budgets">
        <ListRow
          testID="more-shared-budgets"
          title="Shared budgets"
          subtitle="Split a household budget — one pool, separate phones."
          onPress={() => router.push("/more/shared_budgets")}
        />
      </SoonGate>
```

`SoonGate` greys it and appends the Soon chip automatically, and `pointerEvents="none"` means the row will not navigate while the key is `"soon"` — which is correct. The route still exists so the screen can be opened directly during development.

- [ ] **Step 6: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/\(tabs\)/more/shared_budgets.tsx mobile/app/\(tabs\)/more/index.tsx mobile/constants/shipped_features.ts mobile/constants/__tests__/shipped_features.test.ts mobile/app/__tests__/shared_budgets_screen.test.tsx
git commit -m "feat(more): shared budgets as a Soon placeholder"
```

---

### Task 4: Reports, Privacy, Listener health, Settings

**Files:**
- Modify: `mobile/app/(tabs)/more/reports.tsx`
- Modify: `mobile/app/(tabs)/more/privacy.tsx`
- Modify: `mobile/app/(tabs)/more/listener_health.tsx`
- Modify: `mobile/app/(tabs)/more/settings.tsx`
- Modify: `mobile/app/(tabs)/more/subscriptions.tsx`
- Modify: `mobile/components/reports/*.tsx`
- Modify: `mobile/components/privacy/*.tsx`

**Interfaces:** no API changes anywhere. Class strings, composition, and the atoms from Part 1.

- [ ] **Step 1: Reports**

Donut gains the legend beside it — one row per category, colour dot, name, percentage, amount — matching the board. `summary_tiles.tsx` becomes a row of `StatTile`. `ranked_bars.tsx` becomes the "Where it went most" list: merchant icon disc, name, `Nx` count chip, amount. `trend_line.tsx` becomes the six-period bar row with the current period filled brand and any over-limit period filled soft danger.

The CSV export row keeps its `PlusGate` and now shows the `PLUS · free in beta` badge from Task 2. It stays functional.

`donut_chart.tsx` keeps its deterministic id→colour hash into `chart-1..8` exactly as it is. Do not repoint it at semantic tokens.

- [ ] **Step 2: Privacy centre**

The green reassurance banner at the top: `bg-brand-soft` card, phone glyph, **"Everything stays on this phone"**, body from the existing copy. Toggle rows become `ListRow` with a `Switch` as `right`. The stored-data table becomes three `ListRow`s showing count and size. The three actions at the bottom: Export and Delete as `secondary` buttons, and **Wipe all PeraPlano data** as the new `outline-destructive` variant from Part 1 Task 4 — this is the button that variant was built for.

- [ ] **Step 3: Listener health**

Health card gains the mint disc with a heart-pulse glyph and the headline **"Everything's listening"** (or its unhealthy equivalents — keep the existing copy logic). Permission rows become `ListRow` with a status chip on the right: `tone="brand" fill="soft"` for granted, `tone="warn" fill="soft"` for a check, `tone="neutral" fill="outline"` for not granted. Per-provider rows gain a `ProviderBadge` and the existing `provider_success_meter.tsx` on the right.

- [ ] **Step 4: Settings and Subscriptions**

Settings rows become `ListRow`; keep `ThemePicker` exactly as it is — it already works and its behaviour is documented at length.

Subscriptions gets the total card, the price-change alert banner (`tone="warn" fill="soft"`), and one `ListRow` per service with a `ProviderBadge`-style disc, next-charge date, and amount. Keep the `PlusGate`; it now renders the beta badge.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean. `reports_screen.test.tsx`, `privacy_screen.test.tsx`, `listener_health_screen.test.tsx` and `parser_diagnostics_screen.test.tsx` must all still pass; update only assertions that matched on a class string that changed.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/\(tabs\)/more/ mobile/components/reports/ mobile/components/privacy/
git commit -m "feat(more): restyle reports, privacy, listener health, settings and subscriptions"
```

---

### Task 4b: Plan's create, detail and edit routes

**Files:**
- Modify: `mobile/app/(tabs)/plan/limits/new.tsx`, `limits/[id].tsx`, `limits/[id]/edit.tsx`
- Modify: `mobile/app/(tabs)/plan/goals/new.tsx`, `goals/[id].tsx`
- Modify: `mobile/app/(tabs)/plan/loans/new.tsx`, `loans/[id].tsx`, `loans/[id]/edit.tsx`
- Modify: `mobile/app/(tabs)/plan/bills/new.tsx`, `bills/[id].tsx`, `bills/[id]/edit.tsx`
- Modify: `mobile/app/(tabs)/plan/income.tsx`
- Modify: `mobile/components/limits/limit_form.tsx`, `limit_card.tsx`
- Modify: `mobile/components/goals/goal_form.tsx`, `goal_card.tsx`, `progress_ring.tsx`, `allocation_sheet.tsx`
- Modify: `mobile/components/loans/loan_form.tsx`, `loan_card.tsx`, `schedule_table.tsx`, `payment_match_sheet.tsx`
- Modify: `mobile/components/bills/bill_form.tsx`, `bill_row.tsx`, `due_chip.tsx`, `due_rule_picker.tsx`, `bill_match_sheet.tsx`
- Modify: `mobile/components/income/income_form.tsx`, `cadence_picker.tsx`, `income_summary_card.tsx`, `payday_detected_sheet.tsx`
- Modify: the matching tests in `mobile/app/__tests__/`

**Interfaces:** no API changes. `SegmentedControl`, `Chip` fills, `Button` sizes, `StatTile` from Part 1.

**Why this is its own task and not part of Plan's segment change.** These eleven routes are pushed from both the Plan panels and from elsewhere — Home's no-limit hero pushes `/plan/limits/new`, and `alerts_feed.tsx` deep-links to `/plan/limits/[id]` and `/plan/bills/[id]`. None of them changed when Plan became segmented, so restyling them is independent work with an independent review.

- [ ] **Step 1: Create limit — the one designed board here**

"Create limit · with hindsight preview" is one of the 36. Build `limits/new.tsx` to it:

1. Header: X close, "New limit".
2. "What are you capping?" then a wrapped `Chip` row of category options plus "Everything", selected `fill="solid"`, unselected `fill="outline"`, each with its lucide glyph.
3. A `Card` holding a `SegmentedControl` for **Amount ₱ / % of income**, the figure at `text-hero font-extrabold`, and three preset chips beneath.
4. Three `ListRow`s: Resets, Wallets counted, Warn me at — each opening its existing picker.
5. The hindsight preview as a `bg-brand-soft` card: **"If this were active last month"** at `text-micro font-bold`, then the sentence the app can already compute from history.
6. A full-width `lg` primary "Create limit" pinned to the bottom.

**The hindsight preview only renders when there is history to compute it from.** On a fresh install there is none, and a preview card that says nothing is worse than no card. Check what `limit_form.tsx` already computes before adding any new arithmetic — if the figure does not exist yet, render no card rather than inventing a query in a restyle task, and note it as follow-up.

- [ ] **Step 2: The remaining forms**

`limit_form.tsx`, `goal_form.tsx`, `loan_form.tsx`, `bill_form.tsx` and `income_form.tsx` all take the same field rhythm: label at `text-micro font-semibold text-fg-2` above the control, controls on `bg-chip rounded-xl min-h-[44px]`, option groups as `Chip fill="outline"` rows, and any two-to-four-way exclusive choice as `SegmentedControl`. `cadence_picker.tsx` and `due_rule_picker.tsx` are both `SegmentedControl` candidates — use it where there are four or fewer options and keep the wrapped chip row where there are more, as `due_rule_picker` has five.

- [ ] **Step 3: The cards**

`limit_card.tsx`: glyph disc, name, scope, amount over cap on the right, and the progress bar beneath — green, `warn` past 80%, `danger` past 100%, which is the design's stated bar rule.

`goal_card.tsx`: `progress_ring.tsx` on the left at 44dp, name, `N% · ₱X of ₱Y`, and a `Chip` for the contribution rule (`AUTO` when one is set). A reached goal fills its ring brand and shows a party glyph.

`loan_card.tsx`: glyph disc, name, `N mos · N paid · ₱X/mo`, amount left on the right, progress bar, and `Next: <date>` with `N% paid`. An overdue promise gets a `tone="danger" fill="soft"` banner inside the card.

`bill_row.tsx` and `due_chip.tsx`: `due_chip` becomes the design's soft chips — `tone="neutral" fill="outline"` for "due in 3d", `tone="warn" fill="soft"` for "due today", `tone="danger" fill="soft"` for "overdue 2d". These three are the exact chips Part 1 Task 2's contrast work was done for.

- [ ] **Step 4: The amortization schedule keeps its Plus gate**

`schedule_table.tsx` stays behind `PlusGate capability="amortization"` and now shows the `PLUS · free in beta` badge from Task 2. Restyle the table to alternating `bg-chip` rows with mono figures. Do not ungate it.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean. `limit_routes.test.tsx`, `goal_routes.test.tsx`, `loan_routes.test.tsx` and `bills_screen.test.tsx` must all pass.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/\(tabs\)/plan/ mobile/components/limits/ mobile/components/goals/ mobile/components/loans/ mobile/components/bills/ mobile/components/income/ mobile/app/__tests__/
git commit -m "feat(plan): restyle the create, detail and edit routes"
```

---

### Task 5: System states

**Files:**
- Modify: `mobile/components/ui/empty_state.tsx`
- Create: `mobile/components/ui/error_state.tsx`
- Create: `mobile/components/ui/loading_skeleton.tsx`
- Create: `mobile/components/ui/__tests__/error_state.test.tsx`
- Create: `mobile/components/ui/__tests__/loading_skeleton.test.tsx`
- Modify: the four `testID="*-loading"` blank views: `app/(tabs)/index.tsx`, `app/(tabs)/wallets.tsx`, `components/plan/limits_panel.tsx`, and any other `*-loading` returning a bare `View`

**Interfaces:**
- Produces:
  - `<ErrorState title body onRetry? retryLabel? testID? />`
  - `<LoadingSkeleton rows={number} testID? />`

- [ ] **Step 1: Write the failing tests**

Create `mobile/components/ui/__tests__/error_state.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { ErrorState } from "../error_state";

test("an error names what failed and what to do about it", () => {
  render(
    <ErrorState
      testID="e"
      title="Couldn't read that notification"
      body="BPI changed their alert format. Add it manually and we'll learn the new shape."
      retryLabel="Add manually"
      onRetry={() => {}}
    />,
  );
  screen.getByText("Couldn't read that notification");
  screen.getByText("Add manually");
});

test("an error with no action renders no button rather than a dead one", () => {
  render(<ErrorState testID="e" title="Something went wrong" body="Try again in a moment." />);
  expect(screen.queryByTestId("e-retry")).toBeNull();
});

test("the retry action fires", () => {
  const onRetry = jest.fn();
  render(<ErrorState testID="e" title="x" body="y" retryLabel="Retry" onRetry={onRetry} />);
  fireEvent.press(screen.getByTestId("e-retry"));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test("an error is danger-toned, not the empty state's inviting mint", () => {
  render(<ErrorState testID="e" title="x" body="y" />);
  expect(String(screen.getByTestId("e-icon").props.className)).toContain("danger");
});
```

Create `mobile/components/ui/__tests__/loading_skeleton.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { LoadingSkeleton } from "../loading_skeleton";

test("renders the requested number of placeholder rows", () => {
  render(<LoadingSkeleton testID="s" rows={3} />);
  screen.getByTestId("s-row-0");
  screen.getByTestId("s-row-2");
  expect(screen.queryByTestId("s-row-3")).toBeNull();
});

test("the skeleton is announced as busy rather than read out as empty rows", () => {
  render(<LoadingSkeleton testID="s" rows={2} />);
  expect(screen.getByTestId("s").props.accessibilityLabel).toBe("Loading");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- error_state loading_skeleton`
Expected: FAIL, two `Cannot find module` errors.

- [ ] **Step 3: Implement both**

`ErrorState` mirrors `EmptyState`'s structure with a danger-toned disc and a `TriangleAlert` glyph, an optional dismiss and an optional retry. `LoadingSkeleton` renders `rows` grey bars in `bg-chip dark:bg-chip-dark` at alternating widths, wrapped in one `View` with `accessible` and `accessibilityLabel="Loading"` so a screen reader says "Loading" once rather than reading five empty rows.

**Do not animate the skeleton in this task.** A shimmer is motion, and motion lands in Task 7 with its device pass.

- [ ] **Step 4: Replace the blank loading views**

Every `testID="*-loading"` currently returns a bare `<View className="flex-1 bg-bg dark:bg-bg-dark" />` — a blank screen with nothing to say it is working. Replace each with `<LoadingSkeleton rows={4} />` inside the same container, keeping the existing `testID` on the container so existing tests still find it.

- [ ] **Step 5: Restyle the five empty states**

`components/ui/empty_states.tsx`'s `EMPTY_STATE_CATALOGUE` keeps every string exactly — the copy is spec-owned and several of its entries carry comments saying so. Only `empty_state.tsx`'s presentation changes, and it already got its type sizes in Part 1 Task 9. Confirm each of the five renders its action button where the catalogue defines one.

- [ ] **Step 6: The four Android notification layouts**

`lib/alerts/alerts_service.ts` is the only place that builds a notification. The design draws four cards, and each is a title/body pair plus its actions:

| Board | Title | Body shape | Actions |
|---|---|---|---|
| Capture | `₱285 tracked at Jollibee` | `{category} · {wallet}. You have ₱{safeToSpend} safe to spend today.` | none |
| Limit warning | `80% of your Food limit is gone` | `₱{spent} of ₱{cap} · {n} days left in the month.` | See breakdown · Mute 7 days |
| Payday | `Kinsenas landed — ₱9,250` | `Move ₱{amount} to {goal} now?` | Move ₱{amount} · Not now |
| Listener down | `Tracking stopped working` | `Notification access was revoked. Nothing has been tracked for {n} days.` | Fix now |

Align the existing strings to these shapes **only where the current copy says the same thing less clearly**. Do not add a notification that does not already fire, and do not add an action the service cannot handle — an action button that does nothing is worse than no button.

The persistent foreground-service notification ("PeraPlano is listening · Persistent · tap to pause") is built in the native module, not here. Leave it alone.

Update `lib/alerts/__tests__/alerts_service.test.ts` for any string you change.

- [ ] **Step 7: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add mobile/components/ui/ mobile/app/ mobile/components/plan/ mobile/lib/alerts/
git commit -m "feat(ui): real loading skeletons, a danger-toned error state and clearer alerts"
```

---

### Task 6: Onboarding — all twelve steps

**Files:**
- Modify: `mobile/components/onboarding/*.tsx` (all)
- Modify: `mobile/app/(onboarding)/*.tsx` (all twelve)
- Modify: `mobile/app/(onboarding)/__tests__/*.test.tsx`

**Interfaces:** no API changes. The step count, the step order, and every route stay exactly as they are.

**Recovery phrase and device lock do not move.** Spec D3. They fix parameters that cannot change once a user holds a phrase. They are restyled in place, in the same visual language as the nine designed steps, and nothing about their position or their copy changes.

- [ ] **Step 1: The frame**

`onboarding_frame.tsx` gets the design's shape: back chevron and a "Skip" text action in the header, the title at `text-title font-bold` left-aligned, body at `text-body font-medium text-fg-2`, content, then a full-width `lg` primary button pinned to the bottom with a secondary text action beneath it. `step_progress.tsx` becomes the design's dot row.

- [ ] **Step 2: The provider picker — the biggest single improvement in the app**

`components/onboarding/provider_picker.tsx` is currently a vertical list of `min-h-[44px]` rows, each a hand-drawn 20dp checkbox square beside a lowercase name. The design draws a two-column grid of tiles: `ProviderBadge` at 20dp, the display name at `text-row font-semibold`, and a check circle on the right when selected. A selected tile is `border-2 border-brand bg-brand-soft`; an unselected one is `border border-line bg-surface`.

Replace `ChoiceRow` with that tile. **Keep `testID={`provider-choice-${choice.packageName}`}`, `testID={`provider-name-${choice.packageName}`}`, `accessibilityRole="checkbox"` and `accessibilityState={{ checked }}` exactly** — `provider_picker` has tests and an accessibility contract that the visual change must not touch.

Keep the existing suppression of the package-name subtitle when the label *is* the package name; that comment explains a real case.

- [ ] **Step 3: Wallet setup — stop showing package ids as names**

`components/onboarding/quick_wallet_list.tsx` currently renders raw observed package names as editable wallet names, so a real device offers to create a wallet called `com.samsung.android.app.smartcapture`. Route every name through `providerLabel()` and render a `ProviderBadge` beside it. **Where no label exists for an observed package, do not propose a wallet for it at all** — commit `9d36c05` already established that only recognised providers get proposed, so this is presentation catching up with behaviour that is already correct.

Restyle each row to the design: badge, name, type chip, balance on the right, and the "Add another wallet" dashed row at the bottom. **No free-plan cap note** — spec D10.

- [ ] **Step 4: The remaining ten steps**

Welcome, How it works, Notification access, Battery, Device lock, Recovery phrase, Income, First limit, Ready, and the index gate. Each takes the frame from Step 1. Specific pieces from the boards: How it works becomes three numbered cards with mint glyph discs; Notification access and Battery get their reassurance list with lucide glyphs; Income gets a `SegmentedControl` for cadence plus the payday chips; First limit gets the `SegmentedControl` for Amount-₱-versus-%-of-income and the live "roughly per day" preview; Ready gets the check medallion and the four-item checklist.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean. `setup_flow_e2e.test.tsx`, `first_run_handoff.test.tsx`, `wallets_step.test.tsx`, `how_it_works.test.tsx` and `index.test.tsx` must all pass. **If the e2e flow test fails, the step order changed — revert that, do not update the test.**

- [ ] **Step 6: Build to the A54 and run the whole flow**

Run: `npm run android`

Wipe the app's data, then walk all twelve steps end to end. Confirm the recovery phrase step is unchanged in behaviour, the provider grid shows real names and badges, and no screen offers a wallet named after a package id.

- [ ] **Step 7: Commit**

```bash
git add mobile/components/onboarding/ mobile/app/\(onboarding\)/
git commit -m "feat(onboarding): restyle all twelve steps and fix package-id wallet names"
```

---

### Task 7: Place the motion

**Files:**
- Modify: `mobile/components/ui/empty_state.tsx`
- Modify: `mobile/components/ui/loading_skeleton.tsx`
- Modify: `mobile/app/index.tsx` (splash handoff)
- Modify: `mobile/app/(onboarding)/done.tsx`
- Modify: `mobile/components/goals/goal_card.tsx` (goal reached)
- Modify: `mobile/app/(tabs)/plan/limits/new.tsx` (limit created)
- Modify: `mobile/app/(tabs)/index.tsx` (first auto-capture)
- Create: `mobile/components/ui/__tests__/motion_placement.test.tsx`

**Interfaces:** no new components. `BrandMark` already provides everything — `variant`, `playToken`, and reduce-motion. Re-read this plan's "What is already built" section before starting.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/ui/__tests__/motion_placement.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { EmptyState } from "../empty_state";
import { LoadingSkeleton } from "../loading_skeleton";

test("an empty state drifts rather than sitting still", () => {
  render(<EmptyState testID="e" title="Nothing yet" body="It'll show up here." />);
  expect(screen.getByTestId("e-mark").props.variant).toBe("idle");
});

test("a loading skeleton carries the loop, not a bare ActivityIndicator", () => {
  render(<LoadingSkeleton testID="s" rows={2} />);
  expect(screen.getByTestId("s-mark").props.variant).toBe("loading");
});
```

Asserting on `props.variant` requires `BrandMark` to be reachable as a host component in the tree; if the test renderer flattens it, assert on the `testID` being present instead and verify the variant on device. Do not change `BrandMark` to make the assertion convenient.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- motion_placement`
Expected: FAIL — `e-mark` does not exist.

- [ ] **Step 3: The three ambient placements**

- `empty_state.tsx`: replace the static `Send` glyph disc with `<BrandMark testID={`${testID}-mark`} variant="idle" size={40} />` inside the existing mint disc. Keep the `icon` prop for callers that pass a specific glyph — a category-specific empty state should keep its own icon; only the default becomes the drifting mark.
- `loading_skeleton.tsx`: put `<BrandMark testID={`${testID}-mark`} variant="loading" size={32} />` above the placeholder rows.
- `app/index.tsx`: play `variant="launch"` once during the splash handoff, then route.

- [ ] **Step 4: The four success beats**

Each uses a `playToken` that changes when the moment occurs:

```tsx
const [playToken, setPlayToken] = useState(0);
// on the moment:
setPlayToken((token) => token + 1);
// in render:
<BrandMark variant="launch" playToken={playToken} size={64} />
```

- Onboarding "You're all set" — plays on mount, alongside the confetti dots the board draws.
- Goal reached — plays when a goal's progress first crosses 100%.
- Limit created — plays on the success of the create mutation.
- First auto-capture — plays when the ledger commits its first transaction ever.

**The first-auto-capture beat is the one with a real hazard.** It fires off a notification-driven ledger commit, so the JS thread may be parsing when it plays. Defer it one frame past the commit with `requestAnimationFrame`, and gate it on the ledger having been empty before — the beat is "your first transaction landed", not "a transaction landed".

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Build to the A54 and measure**

Run: `npm run android`

This is the task that most needs a device and least tolerates an emulator.

1. Watch the splash takeoff. It must not delay first paint.
2. Open a screen with a cold cache and watch the loading loop. It must not stutter while the query resolves.
3. Trigger a real capture — send yourself a test notification from Listener health — on an empty ledger, and watch the launch beat. **This is the frame-drop candidate.** If it stutters, gate it behind `InteractionManager.runAfterInteractions` before considering removing it.
4. Turn on **Settings → Accessibility → Remove animations** and repeat all three. Every mark must render its static frame and nothing must move.

- [ ] **Step 7: Commit**

```bash
git add mobile/components/ui/ mobile/app/ mobile/components/goals/goal_card.tsx
git commit -m "feat(ui): place the brand motion on loading, empty and success moments"
```

---

### Task 8: The two document changes the spec requires

**Files:**
- Modify: `docs/08-risks-and-open-questions.md`
- Modify: `docs/09-v2-backlog.md`

**Interfaces:** none. Spec §9.

- [ ] **Step 1: Log the free-tier count conflict**

Add to `docs/08-risks-and-open-questions.md`, matching the file's existing entry format:

```markdown
### Free-tier counts disagree between the code and the design handoff

`lib/entitlements.ts` caps the free tier at `FREE_WALLET_CAP = 3`,
`FREE_ACTIVE_LIMIT_CAP = 1`, `FREE_GOAL_CAP = 1`, `FREE_LOAN_CAP = 1`. The mobile design
handoff's Free-vs-Plus board says "Limits & goals — 3 each". Wallets agree; limits and goals
disagree by 3x.

**Blocking before pricing, not before launch.** Every cap is inert today because
`MVP_TIER = "plus"`, so nothing behaves wrongly right now. The 2026-08-22 UI revamp removed
all counts from the Free-vs-Plus table rather than publish a number that may be wrong
(`components/gates/upgrade_sheet.tsx` carries the reasoning). The table cannot state a
quantity again until this is settled.

**Owner:** whoever settles `docs/05-monetization.md` §2. The decision is a pricing one, not
an engineering one.
```

- [ ] **Step 2: Add the backlog item**

Add to `docs/09-v2-backlog.md` §2, following the section's existing template:

```markdown
### 2.12 Google account linking & beta cohort — Band: Mid

**What.** Let a user link a Google account, and use it to carry identity off the phone for the
first time.

**Why it is deferred rather than refused.** §4's standing non-goals do not cover accounts —
they refuse advertising, data monetization, `READ_SMS`, moving money, and social feeds.
Account linking is none of those. It is deferred because it needs the server, which is second
in the build order (mobile → server → web).

**What it must carry.** The permanent-Plus promise made to everyone who installs during the
testing period. Nothing in the app records who those people are: the 2026-08-22 UI revamp
decided against persisting `first_install_at`, `build_channel` or a cohort id, and ships
"Beta User" as a cosmetic label only (revamp spec §6.2, §6.3).

**The consequence, which is not reversible.** An install date cannot be reconstructed from the
app after the fact. When this ships, the only evidence of who installed during beta will be
Google Play Console's install records. **Nobody has verified that Play Console exposes
per-account first-install dates in an exportable form.** Verify that before the beta ends — it
is the sole surviving source, and there is no second chance to collect it.

**Prerequisites.** The server exists. A decision on what a linked account is allowed to sync,
which must clear the privacy bar in `docs/07-privacy-and-compliance.md` — today the app
promises "no account, no cloud sync", and that sentence is published in the Privacy centre.

**Tier placement.** Account linking itself is free. What it unlocks (cloud backup,
multi-device sync) is already Plus in the locked tier matrix and does not move.
```

- [ ] **Step 3: Commit**

```bash
git add docs/08-risks-and-open-questions.md docs/09-v2-backlog.md
git commit -m "docs: log the free-tier count conflict and file the account-linking backlog item"
```

---

## Definition of done for Part 3, and for the revamp

- [ ] `npm test` and `npm run typecheck` clean.
- [ ] Every one of the 36 boards has a corresponding screen in the app.
- [ ] The `PLUS · free in beta` badge renders in all nine places the design draws it — verified on device, since it has never rendered before.
- [ ] The Free-vs-Plus screen publishes no price, no trial CTA and no tier count.
- [ ] All twelve onboarding steps walked on the A54 from a wiped install.
- [ ] Motion verified on the A54 **with "Remove animations" both off and on.**
- [ ] `docs/08` and `docs/09` updated.
- [ ] No screen shows a raw Android package id.
- [ ] Nothing in the app claims an install date.

**Boards covered by Part 3 (20 of 36):** More menu, Reports, Privacy centre, Listener health, Free vs Plus, Subscriptions, Plan create-limit, Push notifications ×4, Empty & error states ×5, Plus sheet, Soon screen, and Onboarding ×9. Together with Part 2's 16, every board has a screen.

**Coverage note.** 16 + 20 exceeds 36 because the component sheet and the cover are not screens, and several boards (the four Home states, the five empty states, the four push cards) are one screen apiece rather than one board apiece. The check that matters is the first line above: **every one of the 36 boards has a corresponding screen**, walked on the device.

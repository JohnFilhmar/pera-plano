# Mobile Insight M3b — Reports, Settings and Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a view of where their money went and complete control over what the app knows — period reports with category and trend breakdowns, CSV export, and a privacy center that makes reading notifications defensible: pause it, see exactly what was captured, export everything, wipe everything.

**Architecture:** A pure aggregation module computes every report figure from transactions, so report math is tested without a UI. Charts are drawn with `react-native-svg` primitives rather than a chart library, keeping the bundle small and the styling on the contract palette. The privacy screens are thin wrappers over the native listener API and the repositories — the app's honesty depends on them being direct, not clever.

**Tech Stack:** TypeScript ~5.9 strict · expo-sqlite via repositories · TanStack React Query · NativeWind · react-native-svg ^15 · expo-file-system · expo-sharing · lucide-react-native · jest + jest-expo + @testing-library/react-native.

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW. Behavior comes from `docs/04-features/10-reports.md` and `docs/04-features/11-settings-privacy.md`; obligations from `docs/07-privacy-and-compliance.md`. Where this plan and a spec disagree, the spec wins.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** for all money. Format only via `formatPhp` / `AmountText`. CSV exports raw decimal pesos with two places (see Task 4).
- **Time:** epoch **milliseconds** for timestamps; calendar dates as `'YYYY-MM-DD'` strings.
- **IDs:** UUIDv4 strings via `newId()`.
- **Clock:** no bare `Date.now()` in any testable path.
- **Commits:** Conventional Commits. **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → run it green → commit.
- **Test commands:** all tests `npx jest --ci`; a single file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`.
- **Working directory:** all commands run from `mobile/`.
- **Density:** exact files, exact interfaces, the rules and named tests that matter — you write the test bodies and the implementation.

### What earlier plans already delivered (consume, do not redo)

| From | You get |
|---|---|
| Foundation | Repositories, entitlements (`historyWindowDays`, `hasBackup`), gates, `queryClient`, app shell, `app_settings_repo` |
| M1a | `modules/notification_listener` → `setCaptureEnabled`, `setProviderFilter`, `getListenerHealth`, `isAccessGranted`, `openAccessSettings` |
| M1b | `raw_notifications_repo` → `getRawCapture`, `purgeExpiredRawCaptures`; `parser_rulesets_repo` |
| M1c | `components/ui/*` primitives, hooks pattern |
| M3 Task 1 | `lib/period.ts`, `utils/money.ts` → `formatPhp` |

---

### Task 1: Report aggregation

**Files:**
- Create: `mobile/lib/reports/aggregate.ts`
- Test: `mobile/lib/reports/__tests__/aggregate.test.ts`

**Interfaces:**
```ts
type DateRange = { from: string; to: string };            // inclusive calendar dates
type CategoryTotal = { categoryId: string; categoryName: string; total: Centavos; share: number };
type PeriodSummary = { range: DateRange; spend: Centavos; income: Centavos; net: Centavos; transactionCount: number };
type TrendPoint = { label: string; range: DateRange; spend: Centavos; income: Centavos };
summarizePeriod(transactions: Transaction[], range: DateRange): PeriodSummary;
categoryBreakdown(transactions: Transaction[], categories: Category[], range: DateRange): CategoryTotal[];
trendSeries(transactions: Transaction[], ranges: DateRange[]): TrendPoint[];
topMerchants(transactions: Transaction[], range: DateRange, limit: number): { merchant: string; total: Centavos; count: number }[];
```

**Rules:**
1. **Transfer-linked transactions are excluded from every figure.** Spend, income, category totals, trends, top merchants — all of them. This is the single rule that decides whether the reports are true. A user who moves ₱10,000 to savings has not spent ₱10,000.
2. `share` is each category's fraction of total spend, rounded for display but summing to 1.0 within rounding tolerance. Assert the sum.
3. Category totals roll child categories into their parent, with an option to expand. A breakdown that lists eleven sub-categories of Food is not a breakdown.
4. Ranges are inclusive on both ends and compared as calendar dates.
5. Uncategorized appears as its own row, never hidden — hiding it would make the percentages lie.
6. Empty ranges return zeroed summaries, not throws.

- [ ] **Step 1: Write the failing tests:** `summarizePeriod` sums spend and income and computes net · transfer legs are excluded from spend (regression) · transfer legs are excluded from income (regression) · transfer legs are excluded from category totals · transfer legs are excluded from trends · category shares sum to 1.0 within tolerance · child categories roll into parents · Uncategorized appears as its own row · an empty range returns zeros · range bounds are inclusive · `topMerchants` orders by total descending and respects the limit.
- [ ] **Step 2:** Run `npx jest --ci lib/reports/__tests__/aggregate.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (11 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/reports
  git commit -m "feat(reports): add aggregation with transfer exclusion"
  ```

---

### Task 2: Report service with tier windows

**Files:**
- Create: `mobile/lib/reports/reports_service.ts`
- Test: `mobile/lib/reports/__tests__/reports_service.test.ts`

**Interfaces:**
```ts
type ReportScope = { kind: "month"; month: string } | { kind: "custom"; range: DateRange };
getReport(scope: ReportScope, today: string): Promise<{
  summary: PeriodSummary; categories: CategoryTotal[]; trend: TrendPoint[];
  merchants: { merchant: string; total: Centavos; count: number }[]; truncatedByTier: boolean;
}>;
availableScopes(today: string): Promise<{ months: string[]; customAllowed: boolean }>;
```

**Rules:**
1. The free tier is limited to the current month; `customAllowed` is false and `availableScopes.months` contains only the current month. Requesting anything else silently clamps and sets `truncatedByTier: true` so the UI can explain rather than fail.
2. Reads respect `historyWindowDays()` (90 on free, unlimited on Plus). Data outside the window still exists on the device and is never deleted — it is only not shown.
3. The trend series spans the spec's number of trailing periods on Plus, and just the current month on free.
4. Nothing here recomputes aggregation; it selects ranges and delegates to Task 1.

- [ ] **Step 1: Write the failing tests:** free tier returns only the current month and `customAllowed: false` (mock `getTier`) · a custom range on free clamps and sets `truncatedByTier` · plus allows a custom range · plus returns the full trailing trend · the 90-day window on free excludes older data from figures · older data is still present in the database afterward (no deletion) · figures match `summarizePeriod` for the same inputs.
- [ ] **Step 2:** Run `npx jest --ci lib/reports/__tests__/reports_service.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (7 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/reports
  git commit -m "feat(reports): add report service with tier-aware windows"
  ```

---

### Task 3: Report charts and screens

**Files:**
- Create: `mobile/app/more/reports.tsx`
- Create: `mobile/components/reports/donut_chart.tsx`, `ranked_bars.tsx`, `trend_line.tsx`, `summary_tiles.tsx`, `range_picker.tsx`
- Create: `mobile/hooks/queries/use_report.ts`
- Test: `mobile/components/reports/__tests__/charts.test.tsx`
- Test: `mobile/app/__tests__/reports_screen.test.tsx`

**Rules:**
1. All three charts are drawn with `react-native-svg` primitives — no chart library. Keep each under a few hundred lines by keeping them dumb: they receive computed values and draw them.
2. Colors come from the contract §2 palette. Category colors are assigned deterministically from the category id so the same category is the same color across every render and every screen.
3. Every chart is paired with an accessible text alternative — a legend or a value list. A donut alone is not readable by a screen reader, and a finance app must not hide numbers inside a picture.
4. `summary_tiles` shows spend, income, and net for the range, with net colored by sign.
5. `range_picker` on free shows the current month and a Plus row for custom ranges; on Plus it offers month selection and a custom range.
6. Empty state: "No transactions in this period."

- [ ] **Step 1: Write the failing tests:** the donut renders one arc per category and a legend with values · category colors are stable across renders for the same id · ranked bars order by total descending · the trend line renders one point per period · summary tiles color net by sign · the range picker shows the Plus row on free · the range picker offers custom on plus · the truncated-by-tier notice renders when set · the empty state renders.
- [ ] **Step 2:** Run `npx jest --ci components/reports app/__tests__/reports_screen.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/reports app/more/reports.tsx hooks
  git commit -m "feat(reports): add report screens with svg charts"
  ```

---

### Task 4: CSV export (Plus)

**Files:**
- Create: `mobile/lib/reports/csv_export.ts`
- Create: `mobile/components/reports/export_button.tsx`
- Modify: `mobile/package.json` (add `expo-file-system`, `expo-sharing`)
- Test: `mobile/lib/reports/__tests__/csv_export.test.ts`

**Interfaces:**
```ts
buildTransactionsCsv(rows: TransactionExportRow[]): string;
exportTransactionsCsv(range: DateRange, today: string): Promise<string>;   // returns the written file uri
```

**Column specification** — exactly this header, in this order:
```
date,time,direction,amount,currency,wallet,category,merchant,counterparty,reference,source,confidence,transfer,note
```

**Rules:**
1. `amount` is decimal pesos with exactly two places (`1234.56`), positive, with `direction` carrying the sign meaning. Spreadsheets are the consumer here, and a `₱` prefix would break every numeric column.
2. `transfer` is `yes` or `no`. Transfer rows are **included** in the export — unlike reports, an export is a record of everything, and omitting them would make the file irreconcilable with the bank. The column lets the user filter.
3. **RFC 4180 escaping:** any field containing a comma, a double quote, or a newline is wrapped in double quotes with internal quotes doubled. Merchant names contain commas constantly; getting this wrong corrupts every downstream row.
4. Line endings are `\r\n`; the file is UTF-8 with a BOM so Excel renders `₱` and Filipino characters in the note column correctly.
5. `exportTransactionsCsv` writes to the cache directory with a dated filename (`peraplano-transactions-YYYY-MM-DD.csv`) and hands off to `expo-sharing`. It never writes to a location the app cannot clean up.
6. **Gated on Plus** via `PlusGate` and an `hasBackup`-independent check on the export capability per contract §7; free tier sees the button with the Plus badge.

- [ ] **Step 1: Write the failing tests:** the header matches the specification exactly · amounts render with two decimals and no currency symbol · a merchant containing a comma is quoted · a field containing a double quote has it doubled and is quoted · a note containing a newline is quoted · transfer rows are included with `yes` · line endings are CRLF · the output starts with a UTF-8 BOM · an empty range produces a header-only file · a peso sign in a note survives the round trip.
- [ ] **Step 2:** Install `expo-file-system` and `expo-sharing`. Run `npx jest --ci lib/reports/__tests__/csv_export.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (10 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/reports components/reports package.json package-lock.json
  git commit -m "feat(reports): add rfc4180 csv export gated on plus"
  ```

---

### Task 5: More tab and settings

**Files:**
- Modify: `mobile/app/(tabs)/more.tsx`
- Create: `mobile/app/more/settings.tsx`
- Create: `mobile/components/settings/setting_row.tsx`, `theme_picker.tsx`
- Create: `mobile/hooks/queries/use_settings.ts`, `mobile/hooks/mutations/use_set_setting.ts`
- Test: `mobile/app/__tests__/more_tab.test.tsx`
- Test: `mobile/components/settings/__tests__/settings_screen.test.tsx`

**Rules:**
1. The More tab lists: Reports, Subscriptions, Settings, Privacy centre, Listener health, Parser diagnostics, About and tier. Each entry not yet shipped is wrapped in `SoonGate`; each Plus-only entry carries the Plus badge.
2. Settings covers theme (auto/light/dark, persisted through `app_settings_repo` and applied via the existing `useTheme`), alert preferences, and the telemetry opt-out.
3. **The telemetry toggle states plainly what is sent:** counts of successful and failed parses per provider, and nothing else — no notification content, no amounts, no merchants. If the copy cannot say that truthfully, the telemetry implementation is wrong, not the copy.
4. Changing the theme applies immediately without a restart.

- [ ] **Step 1: Write the failing tests:** the More tab renders every entry · unshipped entries render the Soon chip · Plus-only entries render the Plus badge · changing the theme persists and applies immediately · the telemetry toggle persists · the telemetry copy names exactly what is sent.
- [ ] **Step 2:** Run `npx jest --ci app/__tests__/more_tab.test.tsx components/settings` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add app/(tabs)/more.tsx app/more/settings.tsx components/settings hooks
  git commit -m "feat(settings): add more tab and settings screen"
  ```

---

### Task 6: Privacy centre

This is the screen that earns the notification permission. Build it with care.

**Files:**
- Create: `mobile/app/more/privacy.tsx`
- Create: `mobile/components/privacy/capture_toggle.tsx`, `provider_switch_list.tsx`, `captured_list.tsx`, `expiry_countdown.tsx`, `wipe_flow.tsx`
- Create: `mobile/lib/privacy/data_export.ts`, `mobile/lib/privacy/data_wipe.ts`
- Test: `mobile/lib/privacy/__tests__/data_export.test.ts`
- Test: `mobile/lib/privacy/__tests__/data_wipe.test.ts`
- Test: `mobile/components/privacy/__tests__/privacy_screen.test.tsx`

**Interfaces:**
```ts
exportAllData(now: number): Promise<string>;        // writes a JSON bundle, returns the file uri
wipeAllData(): Promise<void>;                       // clears every table, resets settings, clears the native buffer
```

**Rules:**
1. **Master pause** calls `setCaptureEnabled(false)` on the native module AND persists `capture_enabled` in settings, so the state survives a reinstall of the JS layer. When paused, every screen that shows tracked data shows the paused pill — no silent gaps.
2. **Per-provider switches** call `setProviderFilter` with the enabled package list. Turning a provider off must stop captures from it immediately, not at the next launch.
3. **"What PeraPlano captured"** lists `raw_notifications` newest first, each showing the provider, the captured text, and an `expiry_countdown` ("deleted in 12 days"). This list is the proof behind the privacy promise; it must show the real rows, never a summary.
4. **Export all my data** writes a JSON bundle of every table plus a schema version, and shares it. It includes raw captures — it is the user's data and they are entitled to all of it.
5. **Wipe everything** is a double confirmation: a destructive `ConfirmDialog` naming exactly what will be deleted, then a typed confirmation. It clears every table, resets settings to defaults, and drains and discards the native capture buffer. It is irreversible and the copy must say so.
6. After a wipe the app returns to the onboarding entry state rather than an empty logged-in shell.
7. Retention: `purgeExpiredRawCaptures` already runs at bootstrap; this screen shows the countdown so the 30-day promise is visible rather than merely claimed.

- [ ] **Step 1: Write the failing tests** for `data_export`: the bundle includes every table · it includes a schema version · it includes raw captures · it is valid JSON for a populated database.
- [ ] **Step 2: Write the failing tests** for `data_wipe`: every table is empty afterward · settings return to defaults · the native buffer drain is called · the onboarding flag is reset to false.
- [ ] **Step 3:** Run `npx jest --ci lib/privacy` — expected FAIL. Implement both. Run — expected PASS. Commit:
  ```
  git add lib/privacy
  git commit -m "feat(privacy): add full data export and wipe"
  ```
- [ ] **Step 4: Write the failing tests** for the screen: the master pause calls the native setter and persists the setting · a provider switch calls `setProviderFilter` with the remaining packages · the captured list renders real rows newest first · the countdown renders the correct remaining days for a pinned clock · an expired capture is not listed · export calls `exportAllData` · wipe requires both confirmations · cancelling either confirmation wipes nothing.
- [ ] **Step 5:** Run `npx jest --ci components/privacy` — expected FAIL. Implement. Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit**
  ```
  git add components/privacy app/more/privacy.tsx
  git commit -m "feat(privacy): add privacy centre with capture transparency"
  ```

---

### Task 7: Listener health and parser diagnostics

**Files:**
- Create: `mobile/app/more/listener_health.tsx`, `mobile/app/more/parser_diagnostics.tsx`
- Create: `mobile/components/privacy/health_card.tsx`, `oem_guidance.tsx`, `provider_success_meter.tsx`
- Create: `mobile/lib/diagnostics/parse_stats_repo.ts`
- Test: `mobile/lib/diagnostics/__tests__/parse_stats_repo.test.ts`
- Test: `mobile/components/privacy/__tests__/listener_health.test.tsx`

**Interfaces:**
```ts
// parse_stats_repo.ts — local counts only; never content
recordParseResult(providerKey: string, ok: boolean, now: number): Promise<void>;
getParseStats(sinceMs: number): Promise<{ providerKey: string; parsed: number; failed: number }[]>;
clearParseStats(): Promise<void>;
```

**Rules:**
1. `health_card` shows three facts from `getListenerHealth()`: is access granted, is the service connected, and when the last capture arrived. If access was revoked — which some OEMs do silently — the card says so loudly and offers `openAccessSettings()`.
2. `oem_guidance` detects the device manufacturer and shows the matching battery-optimization steps for the common Philippine devices (Xiaomi/MIUI, Oppo/ColorOS, Vivo/FuntouchOS, Huawei/EMUI, Samsung/OneUI), with generic steps as the fallback. Aggressive battery managers are the top cause of missed captures; vague advice here costs users their data.
3. `provider_success_meter` shows parsed versus failed counts per provider from local stats. A provider with a rising failure rate is the early warning that its notification wording changed — surface it plainly, and offer a "report this" action that only sends the aggregate counts.
4. `recordParseResult` is called from the ingest pipeline; wire that call in this task. It stores counts only, never text.
5. Both screens are free-tier — a user must always be able to see whether tracking is working.

- [ ] **Step 1: Write the failing tests** for `parse_stats_repo`: recording increments the right counter · stats aggregate per provider · `sinceMs` filters older rows · clear empties. Run, implement, green, commit.
- [ ] **Step 2: Write the failing tests** for the screens: the health card renders all three facts · revoked access renders the loud warning and the settings action · OEM guidance renders the matching steps per manufacturer (parametrized over five plus fallback) · the success meter renders parsed and failed counts · a provider above the failure threshold is highlighted.
- [ ] **Step 3:** Run `npx jest --ci components/privacy/__tests__/listener_health.test.tsx` — expected FAIL. Implement, including the pipeline call to `recordParseResult`.
- [ ] **Step 4:** Run the full suite `npx jest --ci` — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/diagnostics components/privacy app/more lib/ingest
  git commit -m "feat(diagnostics): add listener health and parser diagnostics screens"
  ```

---

### Task 8: Ship the More tab features

**Files:**
- Modify: `mobile/constants/shipped_features.ts`
- Test: `mobile/app/__tests__/more_tab.test.tsx` (extend)

**Rules:**
1. Flip `reports`, `csv_export`, `privacy_center`, `listener_health` and `parser_diagnostics` to `"shipped"`.
2. Verify no Soon chips remain anywhere in the app — every feature key is now `"shipped"`.

- [ ] **Step 1: Extend the failing tests:** every More-tab entry renders as active with no Soon chip · every key in `SHIPPED_FEATURES` is `"shipped"`.
- [ ] **Step 2:** Run `npx jest --ci app/__tests__/more_tab.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite `npx jest --ci` — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add constants/shipped_features.ts app
  git commit -m "feat(more): ship reports, privacy and diagnostics"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 1–8 committed; `npx jest --ci` green; `npx tsc --noEmit` clean.
- [ ] Transfer-linked transactions are excluded from every report figure (all five exclusion tests pass).
- [ ] Free-tier windows clamp rather than fail, and no data is ever deleted to enforce a tier.
- [ ] The CSV header matches the specification exactly and RFC 4180 escaping handles commas, quotes and newlines.
- [ ] The privacy centre shows real captured rows with live expiry countdowns.
- [ ] Wipe requires two confirmations, clears every table, resets settings, and drains the native buffer.
- [ ] The telemetry toggle's copy accurately describes what is sent (counts only).
- [ ] OEM battery guidance covers the five common Philippine manufacturers plus a fallback.
- [ ] Every `SHIPPED_FEATURES` key is `"shipped"`; no Soon chips remain.
- [ ] Next plan unblocked: `2026-08-02-mobile-insight-m3c-onboarding-client.md`.

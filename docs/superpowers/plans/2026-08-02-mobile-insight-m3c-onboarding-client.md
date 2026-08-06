# Mobile Insight M3c — Onboarding, Server Client and Release Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the MVP — the nine-step onboarding that earns the notification permission, the two server calls the app actually makes (parser rule updates and aggregate telemetry), and the final polish pass that proves the whole product works end to end on a real device.

**Architecture:** Onboarding is a route group whose every step is skippable, writing its results through the existing repositories and finishing by setting one flag. The server client is deliberately minimal: one axios instance with no auth interceptor, because the MVP is local-first and calls only public endpoints. Auth, backup and entitlements exist and are tested on the server, and the mobile side stays dormant until cloud backup ships.

**Tech Stack:** TypeScript ~5.9 strict · expo-router ~6 · axios ^1.13 · TanStack React Query · NativeWind · lucide-react-native · jest + jest-expo + @testing-library/react-native.

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW — §6 fixes the server routes and payload shapes. Behavior comes from `docs/04-features/01-onboarding.md`; visual treatment from `docs/11-mobile-app-design-prompt.md`.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** for all money. Format only via `formatPhp` / `AmountText`.
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
| Foundation | All repositories, `app_settings_repo` (`onboarding_complete`, `telemetry_enabled`, `last_parser_ruleset_version`), `constants/env.ts` → `ENV`, entitlements, gates, app shell, `lib/bootstrap.ts` |
| M1a | `modules/notification_listener` → `isAccessGranted`, `openAccessSettings`, `setProviderFilter`, `getListenerHealth` |
| M1b | `lib/ingest/*`, `parser_rulesets_repo` → `upsertRuleset`, `getActiveVersion`; `RulesetBundle` |
| M1c | `components/ui/*` primitives, wallet form and matcher picker |
| M2 + M2b + M2c | Limits, income, goals, loans and bills services and screens |
| M3 + M3b | Safe-to-Spend, recurring, reports, settings, privacy, diagnostics; `lib/diagnostics/parse_stats_repo.ts` → `getParseStats`, `clearParseStats` |
| Server plan | `GET /v1/parser_rules?since_version=N` and `POST /v1/telemetry/parse_stats` (contract §6) |

---

### Task 1: Onboarding shell and progress

**Files:**
- Create: `mobile/app/(onboarding)/_layout.tsx`, `index.tsx`
- Create: `mobile/components/onboarding/onboarding_frame.tsx`, `step_progress.tsx`, `skip_link.tsx`
- Create: `mobile/lib/onboarding/onboarding_state.ts`
- Test: `mobile/lib/onboarding/__tests__/onboarding_state.test.ts`
- Test: `mobile/components/onboarding/__tests__/onboarding_frame.test.tsx`

**Interfaces:**
```ts
type OnboardingStep = "welcome" | "how_it_works" | "access" | "battery" | "providers" | "wallets" | "income" | "first_limit" | "done";
const ONBOARDING_STEPS: OnboardingStep[];
nextStep(current: OnboardingStep): OnboardingStep | null;
completeOnboarding(): Promise<void>;                 // sets onboarding_complete true
isOnboardingComplete(): Promise<boolean>;
```

**Rules:**
1. **Every step is skippable.** Skipping never blocks and never dead-ends: the app degrades to manual mode and still works. A user who declines notification access must still land in a usable app, or the first-run experience becomes a wall.
2. `onboarding_frame` provides the consistent shell — progress dots, a back affordance, a primary action, and the skip link — so individual steps only supply content.
3. Progress is not persisted mid-flow: quitting during onboarding restarts it. Partial state here is not worth the complexity, and the flow is short.
4. `completeOnboarding` is the only writer of `onboarding_complete`; `app/index.tsx` (foundation Task 17) already routes on it — remove that plan's temporary fall-through guard in this task now that the route group exists.

- [ ] **Step 1: Write the failing tests:** `ONBOARDING_STEPS` is in the specified order · `nextStep` advances and returns null at the end · `completeOnboarding` sets the flag · `isOnboardingComplete` reads it · the frame renders progress, back, primary and skip · skip advances to the next step.
- [ ] **Step 2:** Run `npx jest --ci lib/onboarding components/onboarding` — expected FAIL.
- [ ] **Step 3:** Implement, and remove the temporary guard in `app/index.tsx`.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add app/(onboarding) components/onboarding lib/onboarding app/index.tsx
  git commit -m "feat(onboarding): add onboarding shell and step state"
  ```

---

### Task 2: Value and permission steps

**Files:**
- Create: `mobile/app/(onboarding)/welcome.tsx`, `how_it_works.tsx`, `access.tsx`, `battery.tsx`
- Create: `mobile/components/onboarding/access_explainer.tsx`, `battery_explainer.tsx`
- Test: `mobile/components/onboarding/__tests__/access_step.test.tsx`
- Test: `mobile/components/onboarding/__tests__/battery_step.test.tsx`

**Rules:**
1. **Value before permission, always.** The access step explains what PeraPlano reads, why it needs to, and — first, not buried — that raw notification text is parsed on the device and never leaves it. Then it opens the system screen. Asking first and explaining later is how apps get denied and uninstalled.
2. The explainer names concretely what is read (bank and e-wallet notifications), what is extracted (amount, direction, merchant, reference), and what is discarded (raw text after 30 days). Vague reassurance reads as evasion.
3. After returning from the system screen, the step re-checks `isAccessGranted()` and branches: granted → continue; not granted → a calm "you can turn this on later in Settings" and continue anyway. Never trap the user.
4. The battery step explains that Android may stop background apps and that an exemption keeps tracking alive, then offers the system exemption intent. On the OEMs known to be aggressive it shows the matching guidance from `oem_guidance` (M3b Task 7) rather than generic advice.
5. Both steps are skippable, and skipping is a visible, unpunished choice.

- [ ] **Step 1: Write the failing tests:** the access explainer states the local-first promise before the action · it names what is extracted and what is discarded · pressing the action calls `openAccessSettings` · returning granted advances · returning not granted advances with the later-in-settings message · skipping advances · the battery step renders OEM-specific guidance for a known manufacturer · it renders generic guidance for an unknown one.
- [ ] **Step 2:** Run `npx jest --ci components/onboarding/__tests__/access_step.test.tsx components/onboarding/__tests__/battery_step.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement all four steps.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add app/(onboarding) components/onboarding
  git commit -m "feat(onboarding): add value-first permission steps"
  ```

---

### Task 3: Setup steps — providers, wallets, income, first limit

**Files:**
- Create: `mobile/app/(onboarding)/providers.tsx`, `wallets.tsx`, `income.tsx`, `first_limit.tsx`, `done.tsx`
- Create: `mobile/components/onboarding/provider_checklist.tsx`, `quick_wallet_list.tsx`, `income_quick_form.tsx`, `first_limit_form.tsx`
- Test: `mobile/components/onboarding/__tests__/providers_step.test.tsx`
- Test: `mobile/components/onboarding/__tests__/first_limit_step.test.tsx`

**Rules:**
1. The provider checklist lists the seeded catalogue with initials-chip avatars (no logo assets), pre-checking nothing. Selecting providers calls `setProviderFilter` with the chosen packages and seeds `wallet_matchers`.
2. The wallet step proposes one wallet per selected provider with a sensible default name and type, editable inline, plus a cash wallet checked by default. Creating five wallets in five taps is the goal; the free-tier cap does **not** apply during onboarding setup of matched providers — it applies to later manual creation, per the monetization spec's principle that gates block new creation rather than break setup. If the selection exceeds the free cap, create them and surface the cap explanation afterward rather than silently dropping wallets.
3. The income step offers the four cadences with kinsenas first (it is the Philippine norm) and an amount, and allows "let PeraPlano figure it out" which skips to detection.
4. The first-limit step accepts a monthly amount or a percentage of the declared income and shows a **live preview sentence**: "₱10,000 every month is about ₱333 a day." That sentence is what makes the abstraction land.
5. Percentage basis is offered only when income was declared; otherwise the form shows fixed only, with a note.
6. The done step confirms what was set up and routes to Home.

- [ ] **Step 1: Write the failing tests:** the checklist renders the catalogue with nothing pre-checked · selecting providers calls `setProviderFilter` with those packages · selecting providers seeds matchers · the wallet step proposes one wallet per provider plus cash · exceeding the free cap still creates the wallets and shows the explanation · the income step lists kinsenas first · choosing let-us-figure-it-out skips to detection · the limit preview sentence updates live with the amount · the percentage basis is hidden when no income was declared · completing sets `onboarding_complete` and routes to Home.
- [ ] **Step 2:** Run `npx jest --ci components/onboarding` — expected FAIL.
- [ ] **Step 3:** Implement all five steps.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add app/(onboarding) components/onboarding
  git commit -m "feat(onboarding): add provider, wallet, income and first limit steps"
  ```

---

### Task 4: API client

**Files:**
- Create: `mobile/services/api.ts`
- Create: `mobile/services/device_info.ts`
- Test: `mobile/services/__tests__/api.test.ts`

**Interfaces:**
```ts
const apiClient: AxiosInstance;
getDeviceHeaders(): Promise<Record<string, string>>;    // X-App-Version, X-Device-OS, X-Device-OS-Version, X-Client-Type
```

**Rules (STACK_BASIS §7, adapted):**
1. `baseURL` from `ENV.API_URL`, `timeout` 30000, `validateStatus: () => true` so callers inspect status rather than catching.
2. **No auth interceptor.** The MVP calls only public endpoints; adding token plumbing now would be dead code guarding nothing. The server's auth exists and is tested server-side, and this file gains an interceptor when cloud backup ships.
3. Device headers carry no identifier — no device token, no install id. The two endpoints the app calls need version context for compatibility, nothing more, and sending an id would contradict the privacy promise.
4. Network failures reject with `{ status: 0, message }` and log at warn level, never error: being offline is the expected state on Philippine mobile data, not a fault.

- [ ] **Step 1: Write the failing tests** with the HTTP layer mocked: the base URL comes from `ENV` · `validateStatus` accepts a 404 without throwing · device headers include app version and OS · **device headers contain no identifier field** (privacy regression test) · a network error rejects with status 0 · no Authorization header is ever attached.
- [ ] **Step 2:** Run `npx jest --ci services/__tests__/api.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (6 tests).
- [ ] **Step 5: Commit**
  ```
  git add services
  git commit -m "feat(api): add public-endpoint api client without auth"
  ```

---

### Task 5: Parser rule updates

**Files:**
- Create: `mobile/services/parser_rules.ts`
- Test: `mobile/services/__tests__/parser_rules.test.ts`

**Interfaces:**
```ts
checkForRulesetUpdate(now: number): Promise<{ updated: boolean; version: number }>;
```

**Rules:**
1. Calls `GET /v1/parser_rules?since_version=N` with N from `parser_rulesets_repo.getActiveVersion()`, per contract §6.
2. A response whose `providers` array is empty means the device is current — record the check time and do nothing.
3. A newer bundle is validated before it is stored: it must have a higher version, a non-empty providers array, and every template's `match` must compile as a regex. **An invalid bundle is discarded, not stored** — a bad remote ruleset must never break local parsing, which is the entire risk this feature exists to manage.
4. Failures are silent to the user and never block anything. Offline is normal.
5. Checks run at most once per the spec's interval, tracked in `app_settings`.
6. This is the mitigation for the parser-rot risk in `docs/08-risks-and-open-questions.md`: it is what lets a provider wording change ship without an app release.

- [ ] **Step 1: Write the failing tests** with the client mocked: the request carries the current version as `since_version` · an empty providers array leaves the stored ruleset unchanged · a higher-version valid bundle is stored · a lower-version bundle is ignored · a bundle with an uncompilable regex is discarded and the previous ruleset survives · a bundle with an empty providers array but a higher version is discarded · a network failure resolves without throwing · a check inside the interval does not re-request.
- [ ] **Step 2:** Run `npx jest --ci services/__tests__/parser_rules.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (8 tests).
- [ ] **Step 5: Commit**
  ```
  git add services
  git commit -m "feat(api): add remote parser ruleset updates with validation"
  ```

---

### Task 6: Aggregate telemetry

**Files:**
- Create: `mobile/services/telemetry.ts`
- Test: `mobile/services/__tests__/telemetry.test.ts`

**Interfaces:**
```ts
sendParseStats(now: number): Promise<{ sent: boolean }>;
```

**Rules:**
1. Posts to `POST /v1/telemetry/parse_stats` with exactly the contract §6 fields: `appVersion`, `rulesetVersion`, `providerKey`, `parsed`, `failed`, `periodStart`, `periodEnd`. One request per provider, or a batch if the server accepts it — match the contract.
2. **Counts only. Never content.** No notification text, no amounts, no merchants, no wallet names, no identifiers. There is a test asserting the request body's keys are exactly the allowed set, and it must never be deleted or loosened.
3. Honors the `telemetry_enabled` setting; when off, `sendParseStats` returns `{ sent: false }` and makes no request at all.
4. Sends at most once per the spec's interval; clears the local stats window after a successful send so counts are not double-reported.
5. Silent on failure, like the ruleset check.

- [ ] **Step 1: Write the failing tests** with the client mocked: the body keys are exactly the seven contract fields (whitelist assertion) · **no merchant, amount, text, or identifier appears anywhere in the serialized body** (privacy regression) · opt-out makes no request and returns `sent: false` · a successful send clears the stats window · a failed send does not clear it · a send inside the interval does not re-request · zero stats sends nothing.
- [ ] **Step 2:** Run `npx jest --ci services/__tests__/telemetry.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (7 tests).
- [ ] **Step 5: Commit**
  ```
  git add services
  git commit -m "feat(api): add aggregate parse telemetry with opt-out"
  ```

---

### Task 7: Wire the client into startup

**Files:**
- Modify: `mobile/lib/bootstrap.ts`
- Modify: `mobile/app/_layout.tsx`
- Test: `mobile/lib/__tests__/bootstrap.test.ts` (extend)

**Rules:**
1. After migrations and seeding, bootstrap fires `checkForRulesetUpdate(now)` and `sendParseStats(now)` **without awaiting them** — neither may delay first paint. Startup must never block on the network (STACK_BASIS §8).
2. Both are wrapped so a throw is logged and swallowed.
3. Re-check on app foreground, respecting the intervals.

- [ ] **Step 1: Extend the failing tests:** bootstrap resolves without waiting for the network calls · a throwing ruleset check does not break bootstrap · a throwing telemetry send does not break bootstrap · foregrounding triggers a re-check outside the interval · foregrounding inside the interval does not.
- [ ] **Step 2:** Run `npx jest --ci lib/__tests__/bootstrap.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/bootstrap.ts app/_layout.tsx lib/__tests__
  git commit -m "feat(api): check rules and send telemetry off the startup path"
  ```

---

### Task 8: Empty states and notification audit

**Files:**
- Modify: the five tab screens and the main list screens
- Create: `mobile/components/ui/empty_states.tsx` (the copy catalogue)
- Test: `mobile/components/ui/__tests__/empty_states.test.tsx`
- Test: `mobile/lib/alerts/__tests__/alert_audit.test.ts`

**Rules:**
1. Every list and tab has a distinct, useful empty state with the copy from `docs/06-information-architecture.md` — never a blank screen and never a generic "No data". Collect the copy in one catalogue so it stays consistent.
2. Audit every app-generated notification named in the design brief and confirm each exists and routes correctly when tapped: limit alerts at 50/80/100 (three intensities), bill reminders, loan reminders, payday summary, and the tracking-interrupted notice.
3. Confirm the anti-spam rules hold: each limit threshold fires at most once per limit per period; reminders cancel when their obligation is paid; no more than the spec's cap of notifications per day.

- [ ] **Step 1: Write the failing tests:** every screen in the catalogue has non-empty distinct copy · no two empty states share copy · each of the audited notification types is producible · a threshold fires once per limit per period · a paid bill cancels its remaining reminders · the daily cap is enforced.
- [ ] **Step 2:** Run `npx jest --ci components/ui/__tests__/empty_states.test.tsx lib/alerts/__tests__/alert_audit.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement the catalogue, wire the screens, and fix any audit failures.
- [ ] **Step 4:** Run the full suite `npx jest --ci` — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components app lib/alerts
  git commit -m "feat(polish): add empty state catalogue and audit app notifications"
  ```

---

### Task 9: MVP release gate

**Files:** none created — this task decides whether the MVP is done.

- [ ] **Step 1:** Full suite `npx jest --ci` — expected PASS, zero failures, zero skipped.
- [ ] **Step 2:** `npx tsc --noEmit` — expected clean.
- [ ] **Step 3:** Grep audits, each of which must come back empty: hard-coded hex colors in `components/` and `app/` · `Date.now()` in `lib/ingest/`, `lib/limits/`, `lib/income/`, `lib/goals/`, `lib/loans/`, `lib/bills/` · repository imports inside `components/` · `READ_SMS` or `RECEIVE_SMS` anywhere in the project · any AI-attribution trailer in `git log`.
- [ ] **Step 4:** Confirm `mobile/android/` and `mobile/ios/` are not committed, and that no real `.env` file is tracked.
- [ ] **Step 5:** Verify every key in `constants/shipped_features.ts` is `"shipped"`.
- [ ] **Step 6: End-to-end manual QA on a real device.** Fresh install, then in order: complete onboarding including granting access and the battery exemption · confirm the provider picker seeded wallets and matchers · trigger or post an illustrative provider notification and confirm it appears in the ledger within seconds · open "Why was this recorded?" and confirm the captured text and expiry countdown · post a twin SMS-style notification and confirm no double count · move money between two wallets and confirm the transfer links and is excluded from spend · spend past a limit's 50% and confirm exactly one alert fires · confirm Safe-to-Spend on Home updates after the spend · add a bill due in three days and confirm the reminder schedules · add a loan and confirm payment matching proposes the right transaction · open Reports and confirm transfers are excluded from every figure · export a CSV and open it in a spreadsheet to confirm escaping and the peso column · pause capture and confirm the paused pill appears and nothing is captured · open the privacy centre and confirm the captured list shows real rows with countdowns · export all data and confirm the JSON bundle · wipe everything and confirm the app returns to onboarding with no data · repeat the core flow in dark mode.
- [ ] **Step 7:** Record the results.
  ```
  git commit --allow-empty -m "test(mobile): record MVP end-to-end verification results"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 1–9 committed; `npx jest --ci` green; `npx tsc --noEmit` clean.
- [ ] Every onboarding step is skippable and skipping always lands in a usable app.
- [ ] The access explainer states the local-first promise before requesting the permission.
- [ ] The API client attaches no Authorization header and no device identifier.
- [ ] An invalid remote ruleset is discarded and never breaks local parsing.
- [ ] The telemetry body whitelist test passes and no content of any kind is transmitted.
- [ ] Neither network call is awaited on the startup path.
- [ ] Every grep audit in Task 9 Step 3 comes back empty.
- [ ] The full manual QA walkthrough was performed on a real device and its results recorded.
- [ ] **MVP is complete:** notifications become a trustworthy ledger; limits, goals, loans and bills work; Safe-to-Spend answers the daily question; users can see, export and delete everything the app knows.

# Mobile Ingest M1b — Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a raw Android notification capture into a trustworthy ledger entry — parse it, reject its duplicate twin, recognize when it is really an internal transfer, categorize it, and either commit it silently or route it to the Review Queue — implementing `docs/03-ingest-pipeline.md` end to end.

**Architecture:** Nine small, individually testable stage modules under `mobile/lib/ingest/`, composed by a single `pipeline.ts` orchestrator. Every stage is a pure function over its inputs plus injected dependencies (clock, repositories, ruleset), so the whole pipeline is testable without a device, a database file, or a real notification. Parser behavior lives in *data* — a versioned ruleset row — not in code, so provider wording changes ship without an app release.

**Tech Stack:** TypeScript ~5.9 strict · expo-sqlite via the foundation repositories · jest + jest-expo. No new runtime dependencies.

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW — exact names, signatures, tables, tokens. A task may add private internals; it may not rename or reshape anything the contract defines. Behavior comes from `docs/03-ingest-pipeline.md`; where this plan and that spec disagree, the spec wins and the plan is the bug.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** for all money. Format to `₱1,234.56` only at display. `type Centavos = number`.
- **Time:** epoch **milliseconds** (`number`) for timestamps; calendar dates as `'YYYY-MM-DD'` strings.
- **IDs:** UUIDv4 strings via `newId()` from `@/lib/ids`.
- **Clock:** no bare `Date.now()` in any testable path. Every stage that needs the time takes a `now: number` argument or an injected `Clock`. Tests pin the clock.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → run it green → commit. Never write implementation before its failing test.
- **Test commands:** all tests `npx jest --ci`; a single file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`. Both must pass before every commit.
- **Working directory:** all commands run from `mobile/` unless a step says otherwise.
- **DB access:** this plan runs no DDL and writes no SQL outside `lib/db/`. It consumes the foundation repositories only.
- **Density:** tasks below give exact files, exact interfaces, and the rules and named tests that matter — you write the test bodies and the implementation. Every threshold quoted here is copied from the spec; do not round or "improve" them.

### What earlier plans already delivered (consume, do not redo)

| From | You get |
|---|---|
| `2026-08-02-mobile-foundation.md` Tasks 1–8 | Expo scaffold, jest harness, `lib/db/database.ts`, migration runner, `001_core.sql` (all 19 tables), `types/domain.ts`, `lib/ids.ts` → `newId()`, `lib/db/mappers.ts`, `test_support/db.ts` → `freshDb()` |
| `2026-08-02-mobile-foundation-part2.md` Tasks 9–18 | `lib/entitlements.ts`; repos `wallets_repo` (`createWallet`, `getWallet`, `listWallets`), `transactions_repo` (`insertTransaction`, `listTransactions`, `sumSpend`), `categories_repo` (`seedDefaultCategories`, `UNCATEGORIZED_ID`), `review_queue_repo` (`enqueue`, `listOpen`, `resolve`, `countOpen`, `purgeExpired`), `app_settings_repo` (`getSetting`, `setSetting`); React Query client; five-tab app shell |
| `2026-08-02-mobile-ingest-m1a-native-module.md` Tasks 1–9 | `modules/notification_listener` → `RawCapture`, `drainPendingCaptures()`, `addCaptureListener()`, `setCaptureEnabled()`, `setProviderFilter()`, `getListenerHealth()`, `isAccessGranted()`, `openAccessSettings()` |

---

### Task 1: Ruleset types + `parser_rulesets` repository

**Files:**
- Create: `mobile/lib/ingest/ruleset_types.ts`
- Create: `mobile/lib/db/repos/parser_rulesets_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/parser_rulesets_repo.test.ts`

**Interfaces** — the JSON shape is contract §5 and is shared verbatim with the server's `GET /v1/parser_rules`:
```ts
type ProviderTemplate = {
  id: string;
  match: string;                       // regex source, named groups: amount, direction, merchant, counterparty, ref, balance
  direction?: "in" | "out";            // when the template itself fixes the direction
  confidence: number;                  // base score, 1.00 exact / 0.70 partial
};
type ProviderRuleset = {
  providerKey: string;
  packageNames: string[];
  version: number;
  channel: "push" | "sms";             // sms == posted by the default Messages app
  senderIds?: string[];                // for channel "sms": bank sender-ID prefixes, e.g. ["BPI", "BDO"]
  templates: ProviderTemplate[];
};
type RulesetBundle = {
  version: number;
  providers: ProviderRuleset[];
  tunables: PipelineTunables;
};
type PipelineTunables = {
  dedupeStrongWindowMs: number;        // 172_800_000  (48 h)
  dedupeTwinWindowMs: number;          // 180_000      (180 s)
  transferPrimaryWindowMs: number;     // 900_000      (15 min)
  transferExtendedWindowMs: number;    // 86_400_000   (24 h)
  transferFeeFloorCentavos: number;    // 2_500        (₱25.00)
  transferFeeRate: number;             // 0.01         (1%)
  autoCommitThreshold: number;         // 0.90
  prefilledThreshold: number;          // 0.60
  penalties: {
    weakDirection: number;             // 0.15
    amountAmbiguity: number;           // 0.30
    walletFallback: number;            // 0.10
    merchantMissing: number;           // 0.05
    smsChannel: number;                // 0.05
  };
};
// parser_rulesets_repo.ts
getActiveRuleset(): Promise<RulesetBundle | null>   // highest version row
upsertRuleset(bundle: RulesetBundle): Promise<void> // no-op when an equal-or-higher version exists
getActiveVersion(): Promise<number>                 // 0 when none
```

**Rules:**
1. The row stores the bundle as JSON; the repo is the only place that knows that.
2. `upsertRuleset` never downgrades — a lower version is silently ignored, so a stale server response cannot regress a device.
3. `DEFAULT_TUNABLES` is exported from `ruleset_types.ts` with exactly the values commented above (spec §6, §7, §9). A bundle missing `tunables` inherits the defaults.

- [ ] **Step 1: Write the failing tests:** `getActiveVersion` is 0 on a fresh database · `upsertRuleset` then `getActiveRuleset` round-trips the bundle including nested templates · a lower-version upsert is ignored · a higher-version upsert replaces the active bundle · a bundle with no `tunables` reads back with `DEFAULT_TUNABLES` · `DEFAULT_TUNABLES` matches the spec values exactly (assert each field).
- [ ] **Step 2:** Run `npx jest --ci lib/db/repos/__tests__/parser_rulesets_repo.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run — expected PASS (6 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/ingest/ruleset_types.ts lib/db/repos
  git commit -m "feat(ingest): add parser ruleset types and versioned ruleset repository"
  ```

---

### Task 2: Seed ruleset — the PH provider catalogue

**Files:**
- Create: `mobile/assets/parser_rules/seed.json`
- Create: `mobile/lib/ingest/seed_rules.ts`
- Test: `mobile/lib/ingest/__tests__/seed_rules.test.ts`

**Interfaces:**
```ts
const SEED_BUNDLE: RulesetBundle;                  // imported from seed.json, typed
seedParserRules(): Promise<void>;                  // idempotent; upserts SEED_BUNDLE when the device has nothing newer
```

**Rules:**
1. `seed.json` starts at `"version": 1` and covers, per contract §5 and spec §5: **GCash, Maya, BPI, BDO, UnionBank, Metrobank, SeaBank, GoTyme, CIMB, Landbank, ShopeePay (in the Shopee app), GrabPay (in the Grab app)**, plus one `channel: "sms"` provider entry for the default Messages app carrying `senderIds` for the bank sender prefixes.
2. **Every sample notification string in this file and its tests is ILLUSTRATIVE.** Add a `"_note"` key at the top of `seed.json` saying so verbatim: *"Illustrative patterns only. Real notification formats must be captured from devices and maintained as a versioned corpus before launch — see docs/03-ingest-pipeline.md §11."* Do not present these as verified formats anywhere.
3. Each provider needs at minimum a send/debit template and a receive/credit template. GCash additionally needs cash-in, pay-QR, and buy-load templates; the wording differences are what the corpus will refine.
4. Regex requirements: use named groups (`(?<amount>…)`), make merchant and reference groups optional, and tolerate both `₱` and `PHP` prefixes and thousands separators.
5. `seedParserRules()` runs from `lib/bootstrap.ts` (foundation Task 17) — add the call there in this task.

- [ ] **Step 1: Write the failing tests:** every provider in the catalogue above is present with at least two templates · every `packageNames` entry is non-empty · every template's `match` compiles as a regex with a named `amount` group · the SMS provider entry has non-empty `senderIds` · `seedParserRules` is idempotent (run twice, version still 1, one active bundle) · `seedParserRules` does not overwrite a higher server-supplied version.
- [ ] **Step 2:** Run `npx jest --ci lib/ingest/__tests__/seed_rules.test.ts` — expected FAIL.
- [ ] **Step 3:** Author `seed.json` and implement `seed_rules.ts`; wire the call into `lib/bootstrap.ts`.
- [ ] **Step 4:** Run — expected PASS (6 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add assets/parser_rules lib/ingest lib/bootstrap.ts
  git commit -m "feat(ingest): add illustrative PH provider seed ruleset"
  ```

---

### Task 3: `source_router.ts`

**Files:**
- Create: `mobile/lib/ingest/source_router.ts`
- Test: `mobile/lib/ingest/__tests__/source_router.test.ts`

**Interfaces:**
```ts
type RoutedCapture =
  | { kind: "known"; capture: RawCapture; provider: ProviderRuleset }
  | { kind: "unknown"; capture: RawCapture }
  | { kind: "not_financial"; capture: RawCapture };
routeCapture(capture: RawCapture, bundle: RulesetBundle): RoutedCapture;
```

**Rules:**
1. Match `capture.packageName` against every provider's `packageNames`.
2. For a `channel: "sms"` provider, additionally require that the capture's title or text begins with one of its `senderIds` — otherwise a personal text message from a friend would be routed as bank SMS.
3. Unknown package **with a money-like signal** (a currency token `₱` or `PHP` followed by digits) → `kind: "unknown"`, which the pipeline later routes to the Review Queue so the user can teach it (spec §3, §9.2).
4. Unknown package **without** a money-like signal → `kind: "not_financial"`, dropped silently. Chat and game notifications must never reach the Review Queue.

- [ ] **Step 1: Write the failing tests:** a GCash package routes to the GCash provider · an SMS-app capture with a `BPI` sender prefix routes to the SMS provider · an SMS-app capture from a personal contact with no sender ID and no money token is `not_financial` · an unknown package containing `PHP 500.00` is `unknown` · an unknown package with no money token is `not_financial` · a package listed by two providers resolves deterministically to the first match in bundle order.
- [ ] **Step 2:** Run `npx jest --ci lib/ingest/__tests__/source_router.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (6 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/ingest
  git commit -m "feat(ingest): add source router with money-signal detection"
  ```

---

### Task 4: `amount.ts` + `parser.ts` — the template engine

**Files:**
- Create: `mobile/lib/ingest/amount.ts`
- Create: `mobile/lib/ingest/parser.ts`
- Test: `mobile/lib/ingest/__tests__/amount.test.ts`
- Test: `mobile/lib/ingest/__tests__/parser.test.ts`

**Interfaces** (`ParsedEvent` is contract §5 — do not reshape):
```ts
// amount.ts
parseAmountToCentavos(raw: string): Centavos | null;
countAmountTokens(text: string): number;           // feeds the amount-ambiguity penalty
// parser.ts
type ParsedEvent = {
  providerKey: string; amount: Centavos; direction: "in" | "out";
  merchant?: string; counterparty?: string; referenceNo?: string; balanceAfter?: Centavos;
  occurredAt: number; walletHint?: string; confidence: number;
};
parseCapture(capture: RawCapture, rules: ProviderRuleset[]): ParsedEvent | null;
```

**Rules:**
1. `parseAmountToCentavos` accepts `"₱1,234.56"`, `"PHP 1,234.56"`, `"1234.56"`, `"1,234"` (→ `123400`), and `"P1,234.56"`. It returns `null` for anything else. It must never use floating-point arithmetic to reach centavos — parse the integer and fraction parts separately, or the classic `12.10 * 100 === 1209.9999` bug will corrupt the ledger.
2. `parseCapture` searches the notification text in this order: `bigText`, then `text`, then `title` — expanded text is the most complete (spec §5).
3. Template scoring per spec §9.1: base `1.00` when every group the template declares is bound, `0.70` for a partial match. Then subtract: weak-cue direction `0.15`, amount ambiguity `0.30` (when `countAmountTokens > 1` and the template did not bind an explicit balance group to absorb the second token), merchant missing `0.05`, SMS channel `0.05`. Clamp to `[0, 1]`. The wallet-fallback penalty (`0.10`) is applied later by the normalizer, which is the stage that resolves wallets.
4. Direction resolution: an explicit template `direction` wins; otherwise infer from keyword sets (`sent|paid|purchase|debit|withdraw` → `out`; `received|credited|refund|cash-in|deposit` → `in`) and apply the weak-cue penalty. If neither yields a direction, return `null` — a transaction without a direction is unusable.
5. Templates are tried in array order; the first match wins. A template whose regex throws is skipped and must not crash the parse (spec §4 rule 4).
6. `occurredAt` is `capture.postedAt`, never the capture time — the notification's own timestamp decides which Limit period the transaction lands in (spec §10).

- [ ] **Step 1: Write the failing tests** for `amount.ts`: each accepted format converts correctly · `"12.10"` yields exactly `1210` (float-safety regression test) · junk returns `null` · `countAmountTokens` counts two tokens in a text carrying both an amount and a balance.
- [ ] **Step 2:** Run `npx jest --ci lib/ingest/__tests__/amount.test.ts` — expected FAIL. Implement `amount.ts`. Run — expected PASS. Commit:
  ```
  git add lib/ingest/amount.ts lib/ingest/__tests__/amount.test.ts
  git commit -m "feat(ingest): add float-safe peso amount parsing"
  ```
- [ ] **Step 3: Write the failing tests** for `parser.ts` (all fixtures commented ILLUSTRATIVE): an exact template match scores 1.00 and binds every field · a partial match scores 0.70 · direction inferred from a keyword carries the 0.15 penalty · two amount tokens with no balance group carry the 0.30 penalty · a missing merchant carries 0.05 · an SMS-channel provider carries 0.05 · penalties stack and clamp at 0 · `bigText` is preferred over `text` · a template with an invalid regex is skipped rather than throwing · no matching template returns `null` · a text with no resolvable direction returns `null` · `occurredAt` equals `capture.postedAt`.
- [ ] **Step 4:** Run `npx jest --ci lib/ingest/__tests__/parser.test.ts` — expected FAIL. Implement `parser.ts`. Run — expected PASS (12 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/ingest/parser.ts lib/ingest/__tests__/parser.test.ts
  git commit -m "feat(ingest): add template parser with spec confidence scoring"
  ```

---

### Task 5: `normalizer.ts` — wallet resolution and canonical event

**Files:**
- Create: `mobile/lib/ingest/normalizer.ts`
- Test: `mobile/lib/ingest/__tests__/normalizer.test.ts`

**Interfaces:**
```ts
type NormalizedEvent = ParsedEvent & {
  walletId: string | null;             // null when unresolvable → hard route to Review Queue
  merchant?: string;                   // trimmed, collapsed whitespace, title-cased
  channel: "push" | "sms";
};
normalizeEvent(event: ParsedEvent, provider: ProviderRuleset, wallets: Wallet[], tunables: PipelineTunables): NormalizedEvent;
```

**Rules:**
1. Wallet resolution order: (a) an explicit `wallet_matchers` row binding this `providerKey` (plus `walletHint` when the provider splits across wallets, e.g. GCash main vs GSave); (b) fallback — exactly one non-archived wallet whose type matches the provider's type, which applies the `walletFallback` **0.10** penalty; (c) otherwise `walletId: null`.
2. Merchant normalization: trim, collapse internal whitespace, strip trailing reference fragments, title-case. An empty result becomes `undefined`, not `""`.
3. Non-PHP currency is a hard Review Queue route (spec §9.2) — the parser has already rejected unparseable amounts, so the normalizer's job is only to flag a currency token that is present and not PHP.
4. The normalizer never writes to the database. It receives the wallet list; the orchestrator loads it.

- [ ] **Step 1: Write the failing tests:** an explicit matcher resolves the wallet with no penalty · a `walletHint` picks the right wallet when one provider maps to two · a single type-matching wallet resolves via fallback and subtracts 0.10 · two candidate wallets with no matcher yield `walletId: null` · an archived wallet is never chosen · merchant whitespace is collapsed and title-cased · an empty merchant becomes `undefined` · `channel` is copied from the provider.
- [ ] **Step 2:** Run `npx jest --ci lib/ingest/__tests__/normalizer.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (8 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/ingest
  git commit -m "feat(ingest): add event normalizer with wallet resolution"
  ```

---

### Task 6: `dedupe_gate.ts`

Implements spec §6 exactly. Target: ≥95% of push/SMS twin pairs suppressed.

**Files:**
- Create: `mobile/lib/ingest/dedupe_gate.ts`
- Test: `mobile/lib/ingest/__tests__/dedupe_gate.test.ts`

**Interfaces:**
```ts
type DedupeVerdict =
  | { kind: "unique" }
  | { kind: "duplicate"; ofTransactionId: string }
  | { kind: "possible-duplicate"; ofTransactionId: string };
checkDuplicate(event: NormalizedEvent, recent: Transaction[], tunables: PipelineTunables): DedupeVerdict;
```

**Rules (verbatim from spec §6):**
1. **Strong key.** Same provider + same reference number + same amount, within `dedupeStrongWindowMs` (48 h) → `duplicate`, regardless of channel.
2. **Twin window.** No reference number, same provider, same amount, same direction, **different channels** (push vs sms), within `dedupeTwinWindowMs` (180 s) → `duplicate`.
3. **Legitimate twins are protected.** Two **same-channel** events with the same amount, distinct notification instances, and no shared reference are **not** duplicates — two ₱100.00 load purchases minutes apart are real.
4. **Undecidable → escalate, never guess.** Same amount, same channel, inside the twin window, references absent → `possible-duplicate`, which the pipeline routes to the Review Queue. Silently merging and silently double-counting are both wrong.
5. `recent` is supplied by the orchestrator (transactions within the strong window); the gate performs no I/O.

- [ ] **Step 1: Write the failing tests:** matching reference within 48 h is a duplicate across different channels · matching reference at 49 h is unique · push and SMS twins 60 s apart with no reference are duplicates · the same pair 200 s apart is unique · two same-channel ₱100.00 purchases 5 min apart are unique (rule 3 regression) · same amount, same channel, 60 s apart, no references is `possible-duplicate` · a different direction is never a duplicate · a different provider is never a duplicate.
- [ ] **Step 2:** Run `npx jest --ci lib/ingest/__tests__/dedupe_gate.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (8 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/ingest
  git commit -m "feat(ingest): add dedupe gate with strong-key and twin-window rules"
  ```

---

### Task 7: `transfer_detector.ts`

Implements spec §7 exactly. Target: ≥90% of internal transfers auto-linked. A false link hides real spend and real income, so the auto-link bar is deliberately high.

**Files:**
- Create: `mobile/lib/ingest/transfer_detector.ts`
- Test: `mobile/lib/ingest/__tests__/transfer_detector.test.ts`

**Interfaces:**
```ts
type TransferVerdict =
  | { kind: "none" }
  | { kind: "auto_link"; counterpartTransactionId: string }
  | { kind: "ambiguous-transfer"; counterpartTransactionId: string; reason: "fee_delta" | "extended_window" | "multiple_candidates" };
detectTransfer(event: NormalizedEvent, candidates: Transaction[], tunables: PipelineTunables): TransferVerdict;
```

**Rules (verbatim from spec §7):**
1. **Candidate pair:** one `out` leg and one `in` leg in **different** wallets, within the detection window.
2. **Windows:** primary `transferPrimaryWindowMs` (15 min); extended `transferExtendedWindowMs` (24 h). Extended-window pairs are **never** auto-linked — they route as `ambiguous-transfer` with reason `extended_window`.
3. **Fee tolerance:** exact amount match, or `in.amount < out.amount` and `(out.amount − in.amount) ≤ max(₱25.00, 1% of out.amount)`. A fee delta is plausible but **never** auto-linked — reason `fee_delta`.
4. **Auto-link requires ALL of:** exact amount match, both legs inside the primary window, both wallets known and distinct, and **exactly one** candidate pairing with no competing candidate for either leg. Anything less routes to the Review Queue.
5. Two candidates inside the primary window → `multiple_candidates`, never a guess.

- [ ] **Step 1: Write the failing tests:** exact amount, different wallets, 5 min apart, single candidate → `auto_link` · the same pair 20 min apart → `ambiguous-transfer` / `extended_window` · a ₱20.00 fee on a ₱1,000.00 transfer → `ambiguous-transfer` / `fee_delta` · a ₱30.00 delta on ₱1,000.00 exceeds `max(₱25, 1%)` → `none` · a ₱40.00 delta on ₱10,000.00 is within 1% → `ambiguous-transfer` / `fee_delta` · same-wallet legs → `none` · two exact candidates → `ambiguous-transfer` / `multiple_candidates` · same-direction legs → `none` · a candidate whose wallet is unknown → never `auto_link` · the coincidence case from the spec (sending ₱1,000.00 to a friend while receiving a ₱1,000.00 salary advance, both inside the window, two candidates) → `ambiguous-transfer`, not a silent link.
- [ ] **Step 2:** Run `npx jest --ci lib/ingest/__tests__/transfer_detector.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (10 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/ingest
  git commit -m "feat(ingest): add transfer detector with conservative auto-link rules"
  ```

---

### Task 8: `categorizer.ts`

**Files:**
- Create: `mobile/lib/ingest/categorizer.ts`
- Create: `mobile/lib/db/repos/user_rules_repo.ts`
- Test: `mobile/lib/ingest/__tests__/categorizer.test.ts`
- Test: `mobile/lib/db/repos/__tests__/user_rules_repo.test.ts`

**Interfaces:**
```ts
// user_rules_repo.ts
type UserRuleKind = "merchant_category" | "provider_wallet" | "ignore_pattern";
createUserRule(input: NewUserRule): Promise<UserRule>;
listUserRules(kind?: UserRuleKind): Promise<UserRule[]>;
deleteUserRule(id: string): Promise<void>;
// categorizer.ts
type CategoryVerdict = { categoryId: string; source: "merchant_map" | "user_rule" | "learned" | "default"; penalty: number };
categorize(event: NormalizedEvent, rules: UserRule[], history: Transaction[]): CategoryVerdict;
```

**Rules (spec §8):**
1. Resolution order: built-in merchant map → `UserRule` of kind `merchant_category` → learned suggestion → `UNCATEGORIZED_ID`.
2. **User rules beat the built-in map.** A user who recategorized a merchant must never be overridden by the shipped mapping.
3. Learned suggestion: the same merchant categorized the same way **three or more times** in `history` proposes that category, with a reduced-confidence `penalty` of `0.05` and `source: "learned"`. Below three occurrences, no suggestion.
4. The built-in merchant map covers common PH merchants and maps into the seeded default categories (e.g. Grab → Transport, Jollibee → Food & Dining, Meralco → Bills & Utilities, Shopee → Shopping).
5. `default` carries no penalty — being uncategorized is not evidence that the parse was wrong.

- [ ] **Step 1: Write the failing tests** for `user_rules_repo`: create-then-list round-trips · `listUserRules(kind)` filters · delete removes.
- [ ] **Step 2:** Run, implement, run green, commit:
  ```
  git add lib/db/repos
  git commit -m "feat(ingest): add user rules repository"
  ```
- [ ] **Step 3: Write the failing tests** for `categorizer`: a known merchant resolves from the merchant map · a user rule overrides the merchant map (rule 2 regression) · three matching history rows produce a learned verdict with a 0.05 penalty · two matching rows do not · an unknown merchant returns `UNCATEGORIZED_ID` with `source: "default"` and zero penalty · matching is case-insensitive.
- [ ] **Step 4:** Run `npx jest --ci lib/ingest/__tests__/categorizer.test.ts` — expected FAIL. Implement. Run — expected PASS (6 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/ingest
  git commit -m "feat(ingest): add categorizer with user rule precedence and learned suggestions"
  ```

---

### Task 9: `confidence_gate.ts`

**Files:**
- Create: `mobile/lib/ingest/confidence_gate.ts`
- Test: `mobile/lib/ingest/__tests__/confidence_gate.test.ts`

**Interfaces:**
```ts
type GateDecision =
  | { route: "auto_commit" }
  | { route: "review_prefilled"; reason: string }
  | { route: "review_needs_details"; reason: string };
decideRoute(args: {
  confidence: number;
  walletId: string | null;
  dedupe: DedupeVerdict;
  transfer: TransferVerdict;
  routed: RoutedCapture["kind"];
  nonPhpCurrency: boolean;
  tunables: PipelineTunables;
}): GateDecision;
```

**Rules (spec §9.2 — the thresholds are exact):**
1. Score routing: `≥ 0.90` auto-commit · `0.60–0.89` review prefilled · `< 0.60` review needs details.
2. **Hard routes to the Review Queue regardless of score:** unknown provider · non-PHP currency · unmapped wallet (`walletId === null`) · `possible-duplicate` · `ambiguous-transfer` · fee-tolerant transfer candidate.
3. A hard route always carries a human-readable `reason` — the Review Queue card shows it, and "why is this here?" must never be a mystery.
4. A confirmed `duplicate` never reaches this gate; the orchestrator drops it earlier.

- [ ] **Step 1: Write the failing tests:** 0.95 with everything clean → `auto_commit` · exactly 0.90 → `auto_commit` (boundary) · 0.89 → `review_prefilled` (boundary) · exactly 0.60 → `review_prefilled` · 0.59 → `review_needs_details` · 0.99 with `walletId: null` → review (hard route) · 0.99 with `possible-duplicate` → review · 0.99 with `ambiguous-transfer` → review · 0.99 from an unknown provider → review · 0.99 with non-PHP currency → review · every hard route returns a non-empty `reason`.
- [ ] **Step 2:** Run `npx jest --ci lib/ingest/__tests__/confidence_gate.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (11 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/ingest
  git commit -m "feat(ingest): add confidence gate with spec routing thresholds"
  ```

---

### Task 10: `pipeline.ts` — the orchestrator

**Files:**
- Create: `mobile/lib/ingest/pipeline.ts`
- Create: `mobile/lib/db/repos/raw_notifications_repo.ts`
- Create: `mobile/lib/db/repos/transfer_links_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/raw_notifications_repo.test.ts`
- Test: `mobile/lib/ingest/__tests__/pipeline.test.ts`

**Interfaces** (`PipelineOutcome` is contract §5 — do not reshape):
```ts
// raw_notifications_repo.ts
storeRawCapture(capture: RawCapture, now: number): Promise<string>;   // returns raw_notification id; expires_at = now + 30 days
getRawCapture(id: string): Promise<RawCapture | null>;
purgeExpiredRawCaptures(now: number): Promise<number>;
// transfer_links_repo.ts
linkTransfer(outTransactionId: string, inTransactionId: string, feeAmount: Centavos): Promise<TransferLink>;
unlinkTransfer(id: string): Promise<void>;
// pipeline.ts
type PipelineOutcome =
  | { kind: "committed"; transactionId: string }
  | { kind: "queued"; reviewItemId: string }
  | { kind: "ignored"; reason: "not_financial" | "duplicate" | "unknown-provider" | "paused" };
processCapture(capture: RawCapture): Promise<PipelineOutcome>;
startIngest(): Promise<() => void>;   // drains the buffer, subscribes to live captures, returns an unsubscribe
```

**Rules:**
1. Stage order is fixed and matches spec §2: route → parse → normalize → dedupe → transfer → categorize → gate → commit-or-queue. No stage may be skipped or reordered.
2. `processCapture` stores the raw capture FIRST (30-day TTL) so `rawNotificationRef` is available for the "Why was this recorded?" view even when the parse later fails.
3. Paused (`app_settings.capture_enabled === false`) returns `ignored: "paused"` before any parsing work.
4. `unknown` routing produces a Review Queue item of kind `unknown-provider` and returns `queued` — **not** `ignored`. `ignored: "unknown-provider"` is reserved for the case where the user has explicitly dismissed that package before.
5. A `duplicate` verdict returns `ignored: "duplicate"` and writes nothing to the ledger.
6. An `auto_link` transfer verdict commits the transaction and then creates the `TransferLink` with `feeAmount` as the leg difference. Per contract §3 and `docs/02-domain-model.md`, the fee is **informational only** — it is never counted in any spend total, Limit, or report.
7. After a successful commit the orchestrator emits a `ledger:committed` event so the M2 limit engine can recompute. Define the event name here; M2 subscribes.
8. `startIngest()` calls `drainPendingCaptures()` first, processes each buffered capture in `postedAt` order, then subscribes via `addCaptureListener`. Buffered-first ordering matters: a live capture must never be committed ahead of an older buffered one.
9. Raw capture storage is the only place notification text is persisted, and it never syncs (contract §3 invariant 3).

10. **Persist the whole drained batch before processing any of it.** `drainPendingCaptures()` is destructive — the moment it returns, the native buffer is empty and the only copy of those captures is a JavaScript array. Processing them one at a time from that array means a crash partway through loses every capture not yet reached, silently, with up to ~499 transactions gone. So: drain, immediately write **all** returned captures to `raw_notifications` in one pass, and only then run the per-capture pipeline. Raw storage is durable and already the first step of `processCapture` (rule 2), so this only moves work earlier; after it, a crash costs nothing because the captures can be reprocessed from `raw_notifications` on the next launch.

11. **Deduplicate replays by capture id at the pipeline entrance, before parsing.** The native `drain` is deliberately *at-least-once*: a crash between the buffer reading a batch and deleting the file hands the identical batch back on relaunch (M1a Task 3 chose this over at-most-once, correctly — replaying beats losing). That means `processCapture` must be idempotent per capture. Before routing, check whether this `RawCapture.id` already exists in `raw_notifications`; if it does, return `ignored: "duplicate"` and do no further work.
    Do **not** try to solve this in the DedupeGate. That gate compares *parsed events* — amounts, references, channels — and its rules 3 and 4 exist precisely to protect two genuine ₱100.00 load purchases minutes apart from being merged. A replayed capture is not a similar transaction; it is byte-identical input with the same id, and the id check settles it unambiguously and cheaply. Conflating the two would either weaken a rule that protects real spending or push replays into the Review Queue as user-visible noise.
    Test both halves: the same `RawCapture` processed twice commits exactly one transaction, **and** two genuinely distinct captures with identical amount, channel and timing still reach the DedupeGate rather than being suppressed by the id check.

- [ ] **Step 1: Write the failing tests** for `raw_notifications_repo`: store-then-get round-trips all six text fields · `expires_at` is exactly `now + 30 days` · `purgeExpiredRawCaptures` removes only rows past expiry and returns the count.
- [ ] **Step 2:** Run, implement `raw_notifications_repo.ts` and `transfer_links_repo.ts`, run green, commit:
  ```
  git add lib/db/repos
  git commit -m "feat(ingest): add raw notification and transfer link repositories"
  ```
- [ ] **Step 3: Write the failing integration tests** for `pipeline.ts`, each driving a real `freshDb()` from a `RawCapture` all the way to the ledger, with a pinned clock:
  - `a clean GCash send commits a transaction with source notification` → `committed`, ledger row present, amount and direction correct
  - `a low-confidence parse is queued and commits nothing` → `queued`, ledger empty, review item present
  - `a push and SMS twin commits once` → second call returns `ignored: "duplicate"`, ledger has exactly one row
  - `an internal transfer between two wallets auto-links both legs` → a `TransferLink` exists and both legs are excluded from `sumSpend`
  - `an ambiguous transfer is queued instead of linked` → review item of kind `ambiguous-transfer`, no link
  - `an unknown provider with a money signal is queued` → `queued`, review item kind `unknown-provider`
  - `an unknown provider with no money signal is ignored` → `ignored: "not_financial"`, nothing stored
  - `malformed text from a known provider is queued, never thrown` → `queued`, no exception
  - `a capture while paused is ignored before parsing` → `ignored: "paused"`
  - `the raw capture is stored even when the parse fails` → `getRawCapture` returns it
  - `a committed transaction carries a resolvable rawNotificationRef`
  - `startIngest drains buffered captures before live ones, in postedAt order`
- [ ] **Step 4:** Run `npx jest --ci lib/ingest/__tests__/pipeline.test.ts` — expected FAIL. Implement `pipeline.ts`. Run — expected PASS (12 tests). Run the whole suite `npx jest --ci` and `npx tsc --noEmit` — both clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/ingest
  git commit -m "feat(ingest): add pipeline orchestrator wiring capture to ledger"
  ```

---

### Task 11: Wire ingest into app startup

**Files:**
- Modify: `mobile/lib/bootstrap.ts`
- Modify: `mobile/app/_layout.tsx`
- Test: `mobile/lib/__tests__/bootstrap.test.ts` (extend)

**Rules:**
1. `bootstrapApp()` additionally calls `seedParserRules()` and `purgeExpiredRawCaptures(now)` and `purgeExpired(now)` on the Review Queue — startup is the natural place for retention hygiene.
2. The root layout starts ingest after bootstrap resolves and tears it down on unmount, using the unsubscribe returned by `startIngest()`.
3. Ingest failures must never block app start. Wrap the call so a thrown error is logged and the app still renders — a broken parser must not brick the UI.

- [ ] **Step 1: Extend the failing tests:** `bootstrapApp` seeds parser rules · it purges expired raw captures and expired review items · a throwing `startIngest` does not prevent bootstrap from resolving.
- [ ] **Step 2:** Run `npx jest --ci lib/__tests__/bootstrap.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement the wiring.
- [ ] **Step 4:** Run the full suite `npx jest --ci` — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/bootstrap.ts app/_layout.tsx lib/__tests__
  git commit -m "feat(ingest): start ingest pipeline on app bootstrap"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 1–11 committed; `npx jest --ci` green; `npx tsc --noEmit` clean.
- [ ] `processCapture` returns exactly the contract §5 `PipelineOutcome` union, and `parseCapture` exactly the contract §5 `ParsedEvent` shape.
- [ ] Every spec threshold is implemented at its exact value: 48 h strong key, 180 s twin window, 15 min primary transfer window, 24 h extended, `max(₱25.00, 1%)` fee tolerance, 0.90 auto-commit, 0.60 prefilled, and the five confidence penalties.
- [ ] Auto-link fires only on exact amount + primary window + distinct known wallets + single candidate.
- [ ] No bare `Date.now()` in `lib/ingest/` (grep to confirm) — every stage takes an injected time.
- [ ] Every sample notification string in `seed.json` and the tests is marked ILLUSTRATIVE, and `seed.json` carries the `_note` disclaimer.
- [ ] Raw notification text is stored with a 30-day TTL, is purged on startup, and is never synced.
- [ ] Next plan unblocked: `2026-08-02-mobile-ingest-m1c-ui.md`.

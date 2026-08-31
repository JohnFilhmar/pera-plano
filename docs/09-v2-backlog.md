# V2 Backlog

This document holds everything deliberately excluded from the MVP: for each item, what it is, why it was deferred, what must be true before it can be built, and where it will sit in the Free/Plus tier structure when it ships. The MVP scope is locked; nothing here re-enters scope without an explicit revision of the MVP scope doc. The backlog exists so that deferrals are decisions with reasons, not forgotten ideas — and so that MVP design choices (local-first, Entitlements flags, parser-as-data) keep the doors below open instead of welding them shut.

**Status:** Draft v1 · 2026-08-02 · §2b build-scope deferrals added 2026-08-30 · §2.12's Play Console premise corrected 2026-08-31

---

## 1. How to read this backlog

- **Deferred ≠ rejected.** Every item here was judged valuable but wrong for the MVP, usually because it conflicts with a locked MVP principle (local-first, Android-only, PHP-only), depends on MVP data that doesn't exist yet, or dilutes the ingest moat with breadth before depth.
- **Graduation criteria.** An item moves from this backlog into a planned release only when: (a) its prerequisites below are met, (b) MVP success criteria are holding in production (parse accuracy, listener uptime, crash-free rate), and (c) it has a feature doc written to the standard template.
- **Horizon bands** are relative sequencing, not dates: **Near** (natural next steps once MVP is stable), **Mid** (needs new infrastructure or data maturity), **Far** (needs external ecosystems or a strategic bet).
- **Tier placement** below states intended gating at ship time. Additions extend the tier matrix; they never silently modify existing locked rows.

### Tier matrix baseline (locked for MVP — reproduced for reference)

| Capability | Free | Plus |
|---|---|---|
| Auto-tracking (notification ingest) | Unlimited | Unlimited |
| Wallets | 3 | Unlimited |
| Limits | 1 active | Unlimited + per-category |
| Goals | 1 | Unlimited + payday auto-allocate |
| Loans | 1, basic tracking (balance + next due) | Unlimited + full amortization schedule |
| History | 90 days | Unlimited |
| Reports | Basic monthly | Full + trends + custom range |
| Export | — | CSV (PDF later) |
| Cloud backup / multi-device sync | — | ✓ |
| Recurring/subscription detection | — | ✓ |
| Safe-to-Spend | Today only | Projected to end of period |

Gate principle carried forward to every v2 item: when a Free user hits a cap — keep data, block creation of new, never delete.

---

## 2. Backlog items

### 2.1 iOS (degraded/manual ingest) — Band: Mid

**What it is.** PeraPlano for iPhone. iOS provides no public API for reading other apps' notifications, so the core auto-tracking promise cannot be delivered there. An iOS version is therefore a *degraded-ingest* product: fast manual entry tuned to seconds-per-transaction, share-sheet capture (user shares a provider notification, screenshot, or message text into the app for parsing), recurring-rule generation, and import. Everything downstream of ingest — Wallets, Limits, Goals, Loans, Bills, Safe-to-Spend, reports — carries over intact.

**Why deferred.** Locked decision: Android-only MVP. The core promise ("you never log a transaction") is unfulfillable on iOS; shipping it first or simultaneously would put the weakest version of the product in front of reviewers and press, and split engineering focus during the exact phase where the Android ingest moat is built. The PH market is overwhelmingly Android, so the opportunity cost is acceptable.

**Prerequisites.**
1. Android MVP meeting its success criteria in production.
2. Cloud backup / multi-device sync mature and trustworthy — an iOS companion is most valuable to existing Android users adding a second device, which requires sync.
3. Manual-entry UX proven fast on Android (it exists in MVP for cash); the iOS version lives or dies on manual-entry speed.
4. Honest positioning worked out: marketing must not imply auto-tracking parity on iOS.

**Tier placement when shipped.** Mirrors the Android matrix: manual tracking and core features Free within the same caps; sync, unlimited items, projections, and the rest of the Plus column identical. One subscription covers both platforms.

---

### 2.2 Household sharing — Band: Mid

**What it is.** Two or more people (typically partners) sharing selected Wallets, Limits, Goals, Loans, and Bills with shared visibility and combined totals — e.g., a shared "Household" Wallet and grocery Limit while personal Wallets stay private. Includes invitations, per-entity sharing choices, and clear attribution of who recorded or corrected what.

**Why deferred.** Forces cloud identity and server-mediated shared state, which conflicts directly with the local-first MVP: a shared ledger cannot live only on one person's phone. It also multiplies hard problems — conflict resolution when both partners edit offline, privacy boundaries inside a household, and Review Queue ownership — before the single-user experience is even proven.

**Prerequisites.**
1. Cloud backup / multi-device sync (Plus) operating reliably — sharing is architecturally an extension of sync.
2. A sign-in identity model with the web deletion path already required by Play policy.
3. A sharing permission model designed (viewer vs editor; which entity types are shareable in v1 of the feature).
4. Conflict-resolution rules specified for concurrent edits, including TransferLink and Review Queue interactions across members.
5. Privacy notice and Data safety form revisions (data is now shared between users by design).

**Tier placement when shipped.** Plus, requiring at least one Plus member per household; whether all members need Plus is a monetization design choice made at ship time (family-plan style bundling is the natural frame). Adds a new "Household sharing" row to the matrix.

---

### 2.3 Receipt OCR — Band: Far

**What it is.** Point the camera at a paper receipt; the app extracts amount, merchant, and date to create or enrich a Transaction — itemizing cash spend that produces no notification, or attaching line-item detail to an auto-tracked card payment.

**Why deferred.** It is a second ingest channel with its own accuracy problem, correction UX, and (if processed off-device) a major privacy-surface expansion — all competing with the notification pipeline for the same engineering attention. Cash is already covered in MVP by manual entry and cash reconciliation prompts, which deliver most of the value at a fraction of the complexity. PH receipt formats (thermal paper, faded ink, sari-sari store handwritten slips) make the accuracy bar genuinely hard.

**Prerequisites.**
1. MVP manual-entry and reconciliation usage data showing where receipts would actually reduce effort.
2. A processing-location decision (on-device vs server) with a privacy review; on-device is strongly preferred to keep the "raw data never leaves the phone" story intact — a receipt image is raw data.
3. Reuse of the Review Queue and ConfidenceGate patterns: low-confidence OCR lands in the queue, corrections become UserRules where generalizable.
4. A PH receipt corpus for accuracy evaluation, built the same way as the notification parser corpus.

**Tier placement when shipped.** Plus (depth feature on top of free core tracking). Adds a "Receipt capture (OCR)" row: Free —, Plus ✓.

---

### 2.4 Net worth tracking — Band: Mid

**What it is.** A single view of what the user owns minus what they owe: Wallet balances (bank, e-wallet, cash, credit, savings) plus manually declared assets, minus Loan balances where `direction: i-owe`, plus Loans where `direction: owed-to-me` as receivables. Trend over time, driven by the ledger the app already keeps.

**Why deferred.** Net worth is only as credible as its inputs, and MVP-stage balances need time to prove accurate: balance-after parsing coverage varies by provider, cash drifts between reconciliations, and Loan balances depend on payment matching maturing. Shipping a wrong net-worth number is worse than shipping none — it undermines trust in every other number. It also pulls toward investments (2.7), which is its own domain.

**Prerequisites.**
1. Demonstrated Wallet balance accuracy in production (balance-after cross-checks, reconciliation drift within tolerance).
2. Loan payment matching proven so outstanding balances are trustworthy.
3. A lightweight manual-asset concept specified (house, vehicle, informal savings) without turning into portfolio management.
4. History depth: a meaningful trend needs months of ledger.

**Tier placement when shipped.** Plus (it is an insight-depth feature; the Free tier's core tracking remains fully useful without it). Adds a "Net worth" row: Free —, Plus ✓.

---

### 2.5 Debt payoff planner (snowball/avalanche) — Band: Near

**What it is.** A planning layer over Loans with `direction: i-owe`: order debts by balance (snowball) or interest rate (avalanche), simulate payoff dates and total interest for a given monthly amount, and generate suggested extra payments — feeding Safe-to-Spend and payday allocation so the plan meets reality. Especially relevant in the PH mix of credit cards, GLoan, Home Credit, 5-6 (informal high-interest lending; typically 20% flat), and personal utang (informal personal debt).

**Why deferred.** Locked as v2 in the MVP scope. It needs a mature Loan book to plan over: real `interestRate` data, reliable `paymentHistory[]` matching from the ledger, and a trustworthy IncomeProfile to know what extra payment is even possible. Building the planner before the data layer is proven produces confident-looking nonsense. It is also the clearest Plus-depth upsell, which argues for shipping it when enforcement exists, not before.

**Prerequisites.**
1. Loans feature adopted in production with amortization schedules in use.
2. Payment matching accuracy validated (a plan built on wrong balances is harmful).
3. IncomeProfile reliability (cadence + averageAmount) sufficient to bound realistic extra payments.
4. Entitlements enforcement live, since this ships gated.

**Tier placement when shipped.** **Plus — locked** (already decided in planning). Adds a "Debt payoff planner" row: Free —, Plus ✓. Free users keep full Loan tracking per the existing matrix rows.

---

### 2.6 BSP Open Finance / bank API integration — Band: Far

**What it is.** Direct, consented account-data connections to banks and e-wallets under the Bangko Sentral ng Pilipinas (BSP) Open Finance framework — replacing or augmenting notification ingest with authoritative balances and transaction feeds where institutions expose them.

**Why deferred.** The PH Open Finance ecosystem is still maturing: institutional participation, aggregation intermediaries, and consent rails are not yet at a point where a small app can plug in reliably or affordably. Meanwhile, notification ingest works today across 13+ providers with no institutional permission needed — it *is* the moat. Building against APIs prematurely means chasing partnerships instead of users. Strategically, this is also the hedge against Risk R5 (providers changing notification behavior), so it stays warm on the radar rather than cold.

**Prerequisites.**
1. BSP framework participation practically available to third-party apps of PeraPlano's size (directly or via an accredited aggregator).
2. A fundamental privacy-architecture decision: API ingestion means financial data transiting company or partner infrastructure, which changes the local-first story, the lifecycle table, the Data safety form, the NPC posture, and the PIA. This must be designed as a *separate, opt-in connection per institution* with its own disclosure, never a silent replacement of local ingest.
3. Security review posture appropriate to holding bank connections (a different threat class from holding a ledger).
4. Reconciliation design: API data and notification data describing the same transactions must merge through the existing DedupeGate concepts, not duplicate them.

**Tier placement when shipped.** Plus, likely per-connection (bank connections carry real per-user cost). Adds a "Bank connections (Open Finance)" row: Free —, Plus ✓. Notification ingest remains Unlimited on Free — the free core promise does not regress.

---

### 2.7 Investments — Band: Far

**What it is.** Tracking investment holdings — PH-relevant vehicles like Pag-IBIG MP2, UITFs, mutual funds, stocks, crypto e-wallet balances — as a distinct asset class: contributions detected from the ledger (a transfer to an investment account), holdings and valuations, and a portfolio view feeding net worth (2.4).

**Why deferred.** Different domain with different data problems: valuations need market data (an external dependency the MVP deliberately has none of), and investment platforms' notifications are far less standardized than banking alerts. The MVP already handles the money-tracking part: an investment account can be modeled today as a `savings`-type Wallet with contributions visible as transfers, which covers the "am I actually investing?" question without pretending to be a portfolio tracker.

**Prerequisites.**
1. Net worth (2.4) shipped — investments without net-worth context are a stranded feature.
2. A valuation-data decision (manual valuation entry first; market-data feeds only if demand proves out).
3. Category and reporting treatment specified so contributions count as Savings & Investments, not spend — the existing category tree already anchors this.

**Tier placement when shipped.** Plus. Adds an "Investments" row: Free —, Plus ✓.

---

### 2.8 Web dashboard — Band: Mid

**What it is.** A browser-based read-and-review surface: bigger-screen reports, ledger browsing and bulk correction, CSV download, and printing — the phone remains the system of record and the only ingest point.

**Why deferred.** A web surface requires cloud sync and a sign-in identity by definition, so it cannot precede mature Plus backup. It also doubles the surface area for security review and Play-independent compliance (a web property has its own privacy obligations) while serving a review-and-analyze need that MVP reports and CSV export already cover at basic depth.

**Prerequisites.**
1. Cloud backup / multi-device sync stable in production.
2. Web-grade authentication and session security posture reviewed.
3. Scope discipline: read/review/correct first; no web-side ingest, no third-device write conflicts beyond what sync already resolves.
4. Privacy notice and lifecycle-table updates (a new access channel to the same data).

**Tier placement when shipped.** Plus (it is inseparable from sync, which is Plus). Adds a "Web dashboard" row: Free —, Plus ✓.

---

### 2.9 Widgets / Wear — Band: Near

**What it is.** Home-screen widgets and a watch surface for glanceable state: the Safe-to-Spend number first, active Limit progress second, and a one-tap manual entry shortcut for cash. No new data, no new permissions — new surfaces on existing state.

**Why deferred.** Pure polish-tier surface area. The MVP phase gates prioritize the pipeline and control features; widgets amplify a product that already works but rescue nothing if it doesn't. Deferring them costs little because they introduce no new architecture.

**Prerequisites.**
1. Safe-to-Spend stable and trusted (it is the number on the widget).
2. Refresh behavior designed within platform background-work limits so the widget never shows a stale number without saying so — a wrong glanceable number is worse than none.
3. Battery discipline maintained (the < 2%/day attribution criterion extends to widget refresh).

**Tier placement when shipped.** Follows the existing Safe-to-Spend row exactly: the Free widget shows today's number; the Plus widget adds the projection to end of period. No new matrix row needed — the existing "Safe-to-Spend | Today only | Projected to end of period" row governs the widget too.

---

### 2.10 Multi-currency — Band: Far

**What it is.** Wallets in currencies other than PHP — most relevantly for OFW (Overseas Filipino Worker) families receiving padala (remittances) with a foreign-currency leg, and for USD savings accounts. Per-Wallet `currency`, conversion at display time for combined totals, and FX-aware Transfer Links (a USD-out/PHP-in remittance pair is one movement with an exchange rate and fees, not income).

**Why deferred.** Locked decision: PHP (₱) only in MVP, Philippines-first. Multi-currency quietly complicates everything: Limits and Safe-to-Spend need a display-currency policy, TransferDetector's ≈equal-amounts logic breaks across currencies without rate data, reports need conversion rules, and an FX-rate source is a new external dependency. The domain model already carries `currency (PHP)` on Wallet, so the door is architecturally open.

**Prerequisites.**
1. Demonstrated demand signal (users modeling foreign-currency accounts as workaround Wallets, remittance-heavy usage patterns in aggregate telemetry).
2. An FX-rate source decision (daily reference rate vs live), including offline behavior consistent with local-first.
3. TransferDetector extension specified for cross-currency pairs (rate-tolerant matching replacing ≈equal amounts).
4. Reporting and Limit policy: one base currency (PHP) for totals, with per-Wallet native display.

**Tier placement when shipped.** Plus for additional-currency Wallets; PHP-only usage remains fully Free. Adds a "Multi-currency Wallets" row: Free —, Plus ✓.

---

### 2.11 AI insights — Band: Far

**What it is.** A layer that turns the ledger into guidance: plain-language monthly summaries, anomaly flags ("Fees & Charges doubled this month"), forward warnings ("at this pace you'll cross your Groceries/Palengke Limit by the 22nd"), and question-answering over the user's own data. Distinct from the MVP's deterministic insight features (recurring detection, Safe-to-Spend, reports), which remain rule-based and explainable.

**Why deferred.** Trust and data maturity both have to come first. Insight quality depends on months of clean ledger per user, which no one has at launch. More fundamentally, the privacy story is the product's spine: any processing of ledger content beyond the device must clear the same bar as everything else in [07-privacy-and-compliance.md](07-privacy-and-compliance.md), and an on-device-versus-server decision for this workload should not be rushed to chase a feature trend. A finance app's first AI feature must never be a gimmick that spends trust for novelty.

**Prerequisites.**
1. A processing-location decision with full privacy review; if any ledger content is processed off-device, it requires its own opt-in consent, lifecycle-table row, and Data safety declaration — never bundled silently into backup consent.
2. Sufficient per-user history depth and category hygiene (Review Queue correction rates settled) for insights to be accurate.
3. An evaluation protocol: insights are shipped only when demonstrably better than the deterministic reports baseline, with a measured false-alarm rate — a wrong "you're overspending" alert damages trust like a wrong balance does.
4. Tone and scope rules: descriptive and forward-warning insights first; prescriptive financial advice is a regulatory and ethical line requiring separate review before ever crossing.

**Tier placement when shipped.** Plus. Adds an "AI insights" row: Free —, Plus ✓. Deterministic MVP insights (Safe-to-Spend today, basic monthly reports) remain Free per the existing matrix.

---

### 2.12 Google account linking & beta cohort — Band: Mid

**What it is.** Let a user link a Google account, giving PeraPlano an identity that exists off
the phone for the first time in the product's history.

**Why deferred.** Not refused: §4's standing non-goals refuse advertising, data monetization,
`READ_SMS`, moving money, and social feeds, and account linking is none of those. It is deferred
because it needs the server, which is second in the build order (mobile → server → web).

It also has to carry a promise already made: everyone who installs during the testing period
keeps Plus permanently. Nothing in the app recorded who those people are — the 2026-08-22 UI
revamp deliberately chose not to persist `first_install_at`, `build_channel`, or a cohort id, and
ships "Beta User" as a cosmetic label only
(`docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md` §6.2–§6.3).

**Corrected 2026-08-31: the premise this item was built on was false.** The paragraph above used
to end by saying that Google Play Console's install records would be the only surviving evidence
of the beta cohort, and that nobody had checked whether Play Console exported per-account
first-install dates. Checked now, against Google's own documentation
([superpowers/specs/2026-08-31-google-account-linking-design.md](superpowers/specs/2026-08-31-google-account-linking-design.md)
§3): **Play Console and the Play Developer API expose no per-account first-install date at all**,
and the Play Integrity payload carries no install date either. There is nothing to export. The
device is the only source, through `expo-application`'s `getInstallationTimeAsync()` (Android's
`PackageManager.firstInstallTime`), and it is destroyed by an uninstall.

That reverses the urgency rather than removing it. Capture on the device is now the whole
mechanism, and it is implemented: `mobile/lib/onboarding/install_evidence.ts` reads the install
facts at bootstrap on every launch and stores them write-once, so the evidence exists before a
user has any reason to sign in. Whether it ships in time is the only remaining question.

One consequence of the same research is worth recording here, because it decides who the cohort
can reach automatically. The automatic rule requires Play Integrity to report `LICENSED`, which
means the Google account acquired the app **from Google Play**. Every tester who installed over
`adb` will fail it permanently, whatever their install date says, so the design carries an
operator-seeded pregrant list keyed by email address for exactly those people.

**Prerequisites.**
1. The server exists.
2. A decision on what a linked account is allowed to sync, cleared against the privacy bar in
   [07-privacy-and-compliance.md](07-privacy-and-compliance.md) §1. Settled and written down on
   2026-08-31: linking sends a verified email address, a Google subject id, and a device-attested
   install claim, and no ledger data. §1's identity carve-out, §2.3's lawful-basis row, §3.3's
   Data safety entries, and §4's lifecycle rows 9 to 11 are the record.
3. ~~Verification that Google Play Console exposes exportable per-account first-install dates,
   completed before the beta ends.~~ **Obsolete, 2026-08-31.** There is no such export to verify;
   see the correction above. It is replaced by: ship the device-side install capture
   (`mobile/lib/onboarding/install_evidence.ts`) in a mobile release before the beta window
   closes, ahead of the server, because an uninstall destroys the only copy.
4. Unlink and identity deletion, per [07-privacy-and-compliance.md](07-privacy-and-compliance.md)
   §3.7. Not built yet, and Play's account-deletion obligation now attaches to the identity rather
   than to cloud backup.

**Tier placement when shipped.** Account linking itself is Free. What it unlocks — cloud backup,
multi-device sync — is already Plus in the locked tier matrix and does not move.

---

## 2b. Build-scope deferrals — decided 2026-08-30

Six items cut from the mobile MVP by the owner on 2026-08-30. They differ in kind from §2: these are engineering scope inside features that already ship, not new product capabilities, so most of them carry no tier placement and add no row to the matrix. They are recorded at the same depth as everything above for the same reason. Each one cost a working session to reason through, and a bare title would let the debate reopen from zero the next time the question surfaces.

Two of them (2b.3 and 2b.4) had been written down only in a git-ignored working file. This is now their only home.

### 2b.1 App PIN as a third DEK wrap (W4) — Band: Near

**What it is.** A 6-digit app PIN as a *third* way to unwrap the database encryption key, alongside the device Keystore KEK and the recovery phrase. Specified as decision §0.1 of [superpowers/specs/2026-08-19-device-issues-triage-and-roadmap.md](superpowers/specs/2026-08-19-device-issues-triage-and-roadmap.md) and scheduled there as workstream W4.

**The distinction that must survive this deferral.** The PIN is an **additional** DEK wrap, never a replacement. The device screen lock stays mandatory: `isDeviceSecure()` remains a hard gate and the onboarding device-lock step is not removed. The reason is arithmetic, not preference. Six digits is 10^6 combinations. The device Keystore gives hardware-enforced rate limiting and, on most modern hardware, key material that never leaves the secure element; a PIN-derived key has neither, so an attacker with a device image can attack it offline at whatever rate their hardware allows. A high-cost Argon2id raises that cost but does not change its shape. Keeping the device key as the primary wrap means the PIN only ever *adds* an unlock path, so it can never become the weakest link. Anyone who later proposes "just use a PIN instead of the screen lock" is reopening a question already answered here and in [12-encryption-and-app-lock.md](12-encryption-and-app-lock.md) §2.

**Why deferred, and what it costs.** Nothing about the data at rest. Because the screen lock stays mandatory, the database is still encrypted and still locked without this. It is defense in depth that was wanted, not a hole being left open. What is deferred is the extra unlock path for the users the owner was worried about: no fingerprint enrolled, face unlock only, or a screen lock they resent, who otherwise depend on the device credential prompt.

**Why it was ordered last, and why that made it the cheapest thing to cut.** The roadmap ordered W4 after W3 for one stated reason: it is the only workstream that can lose a user's data if it is wrong. Dropping the tail of an order built on that logic removes the highest-risk work without disturbing anything ahead of it. The remaining order is W0 → W1 → W2 → W3.

**Prerequisites.**
1. W0 (the Class-3 biometric fix) shipped and verified on hardware; W4 depends on it, and the PIN's value is largest exactly where biometrics fail.
2. `NumericKeypad` available in `integer` mode for PIN entry, per [superpowers/specs/2026-08-19-numeric-input-system-design.md](superpowers/specs/2026-08-19-numeric-input-system-design.md) §10.
3. Device time budgeted for the wrap, unwrap, and re-wrap paths on real hardware, because this is the workstream that can destroy a ledger if it is wrong.

**Tier placement when shipped.** None. It is a security surface, not a gated capability; no matrix row.

---

### 2b.2 Notification action buttons, and the design's "Capture" board — Band: Near

**What it is.** Tappable actions on the app's own Android notifications. The design draws four notification cards carrying five actions between them: "See breakdown", "Mute 7 days", "Move ₱{amount}", "Not now", "Fix now". Recorded in [superpowers/notes/2026-08-23-mobile-ui-revamp-handoff.md](superpowers/notes/2026-08-23-mobile-ui-revamp-handoff.md) §6.

**Why deferred.** A worktree-wide grep across both TypeScript and native Android found **no notification action infrastructure of any kind**: no `categoryIdentifier`, no `setNotificationCategoryAsync`, no `actionIdentifier`, no response listeners, not for these actions and not for any notification the app posts. Building them is real work, new Expo notification categories plus a response handler, and it was never in the revamp's scope. Shipping title and body copy only was the deliberate call: a button in the notification shade that does nothing is worse than no button, because unlike a dead control on a screen it is not recoverable by backing out.

**The design's "Capture" board does not exist either.** The fourth board (`₱285 tracked at Jollibee`) has no builder, no notifier, and no call site. Only Limit warning, Payday, and Listener down are real, via `notifyLimitAlerts`, `notifyPaydaySummary`, and `notifyTrackingInterrupted`. None of those three is wired to a live production trigger yet; that gap predates the revamp branch and is not part of this deferral.

**Prerequisites.**
1. Expo notification categories registered and a response handler routing every `actionIdentifier` to a real destination. The actions and their infrastructure ship together or not at all.
2. A live behavior behind each of the five actions. "Mute 7 days" and "Move ₱{amount}" are state changes, not navigations, so each needs a decision about what it writes and how it is undone.
3. For the Capture board: a builder, a notifier, a call site, and the same notification-fatigue judgment the Review Queue already applies to per-item pushes.

**Tier placement when shipped.** None. Notifications follow the feature that raises them; no matrix row.

---

### 2b.3 Review-queue "Not money" second-dismissal mute (the ×2 counter) — Band: Near

**What it is.** [04-features/08-review-queue.md](04-features/08-review-queue.md) rule 12 and its unknown-provider flow offer "Always ignore notifications like this" after the **second** "Not money" dismissal of the same source pattern. The counter that gives "second" its meaning is what is deferred, not the mute itself.

**Why deferred.** "Not money" is a **dismiss**, not `ignoreProvider`. The spec offers the mute only after the second dismissal of a source. `ignoreProvider` ships and is tested, so the ability to mute a source exists and a user can already reach it. What has no owner is the ×2 counter, and with it the gentler path where the app volunteers the mute once the user has shown that a source is repeatedly worthless.

**Prerequisites.**
1. Per-source dismissal counting that survives resolution of the item, since a dismissed capture is discarded and the count cannot live on it.
2. A decision on what "the same source pattern" counts as: package name alone, or package plus a text signature.

**Tier placement when shipped.** None. The Review Queue is Free and uncapped.

**Provenance.** This reasoning existed only in `.superpowers/sdd/2026-08-02-mobile-ingest-m1c-ui/progress.md`, which is git-ignored and would have vanished on a fresh clone. That is why it is copied here verbatim in substance.

---

### 2b.4 The unwritable dedupe-signature UserRule — Band: Mid

**What it is.** One row in [04-features/08-review-queue.md](04-features/08-review-queue.md) rule 12's UserRule table: the "Same transaction" merge teaching a duplicate-signature rule that suppresses the twin at the DedupeGate stage.

**Why deferred.** It is unwritable as the model stands, and was deliberately skipped rather than half-built. `UserRuleAction` has no signature-bearing kind, `UserRuleMatcher` has no field for a duplicate signature, and `mobile/lib/ingest/dedupe_gate.ts` reads no UserRule at all. A rule of this kind would sit in the settings rule list unable to fire: visible, disableable, deletable, and inert. That is worse than its absence, because the user believes a correction was learned when nothing was.

**What revisiting takes: a matcher-model change, not just UI.** The matcher describes one notification (a provider, a merchant pattern, a direction). A dedupe signature is not a property of a notification at all; it is a property of a **pair** of rows, the assertion that two records describe one movement. Nothing in the current shape of a rule can carry a claim about a pair, and the DedupeGate has no rule input to feed it into even if one existed. So this is a change to what a rule *is*, plus a new consumer, not a settings screen.

**The worked precedent already exists.** The other pairing rule in the same table, "It's a transfer", had the identical problem and **shipped**: the pair is expressed as matcher-identifies-one-side, action-names-the-other, with the counterpart wallet carried on the action as `{ kind: "mark-transfer"; counterpartWalletId: string }` (`mobile/types/domain.ts`), decoded strictly rather than defaulted (`mobile/lib/db/repos/user_rules_repo.ts`), written by the Review Queue (`mobile/lib/review/resolve_actions.ts`), and read by `mobile/lib/ingest/transfer_detector.ts` via `mobile/lib/ingest/pipeline.ts`. Whoever picks up the dedupe rule should start from that shape rather than redesigning the matcher: it is the same problem solved once already.

**Prerequisites.**
1. A representation for a duplicate signature on the rule, following the mark-transfer precedent (put the half the matcher cannot describe on the action), with strict decoding rather than a default.
2. A consumer: `dedupe_gate.ts` currently takes no rules, so it needs a rule input threaded through `pipeline.ts` the way the transfer detector's is.
3. The kind renders sensibly in the parser-diagnostics rule list, where every rule is listed, disableable, and deletable.

**Tier placement when shipped.** None; it is ingest-correctness behavior, Free like the rest of the pipeline.

**Provenance.** Same git-ignored source as 2b.3, corrected on 2026-08-30: that note recorded both pairing rules as unwritable, which was true when it was written and is no longer true of the transfer rule.

---

### 2b.5 The 119 raw Tailwind type-size classes — Band: Near

**What it is.** The revamp's type scale (`hero`/`title`/`section`/`body`/`row`/`secondary`/`micro`/`badge`) is defined in `mobile/tailwind.config.ts`, but `text-xs`/`text-sm`/`text-base`/`text-lg` and friends are still used directly in 127 places, of which 119 are unconverted across roughly 55 files. Eight were converted in `app/(tabs)/more/privacy.tsx`; the rest were left. Recorded in [superpowers/notes/2026-08-23-mobile-ui-revamp-handoff.md](superpowers/notes/2026-08-23-mobile-ui-revamp-handoff.md) §4b.

**Why deferred.** They are **not a regression** from the revamp branch; they predate it. And the reason for leaving them is not effort. The mapping is not size-neutral: `text-sm`→`text-body` is identical at 14px, but `text-base`→`text-section` shrinks 16px to 15px. Converting all 119 would nudge layout across 55 files with no device available to check the result. That trade, app-wide layout drift for internal consistency and unverified on hardware, was the owner's call rather than a cleanup to absorb silently at the tail of a feature branch. The call has now been made: not in the MVP.

**Forward guidance, which is the part that matters.** If it is taken on, it is its own task, done against a device, and worth doing properly. A lint rule banning the raw type-size classes is what actually keeps the scale enforced. Without one, the next screen reintroduces them and the conversion has to happen again.

**Prerequisites.**
1. A device to check the result on, since the whole objection is unverifiable layout drift.
2. Scheduling as its own task, not folded into a feature branch alongside other changes.
3. A lint rule banning the raw classes landing in the same task as the conversion.

**Tier placement when shipped.** None. Internal consistency work with no user-facing capability.

---

### 2b.6 A non-destructive capture-buffer count in the native module — Band: Near

**What it is.** A way to ask the native listener how many captures are sitting in its buffer undrained, without consuming them, exposed to JS. It exists to give the tracking-interrupted notification an honest figure, so its unlocked body can once again read "PeraPlano stopped receiving notifications, {n} transactions missed" as designed.

**Why the figure had no honest source.** Two reasons stack, and the first is structural rather than an oversight. A dead notification listener captures nothing by definition, so the app cannot know what it missed during its own outage; the quantity the copy asks for may not be observable at all. The second is mechanical: `mobile/modules/notification_listener` exposes `drainPendingCaptures()`, which is **destructive** (it empties the buffer as it reads), and `clearCaptureBuffer()`. There is no read-only count anywhere on that surface, so even the captures that *are* buffered cannot be counted without consuming them.

**Why the interim number was worse than none.** The figure was being fed from `countOpen()` in the review-queue repo, which counts items awaiting the user's review. That is a different quantity, and it is wrong in both directions. A triaged-empty queue produces "0 transactions missed", which is actively reassuring and false. A backlog of stale low-confidence parses produces a count attributed to an outage it has nothing to do with. This is the one notification whose entire job is to announce that the ledger stopped being trustworthy, so a fabricated figure in it does more damage than a missing one.

**The decision, 2026-08-30.** The count comes out of the notification. The unlocked body drops its figure and matches the locked variant, which had always withheld it, so both read "PeraPlano stopped receiving notifications. Tap to fix tracking." The `pendingCount` parameter is deleted from `trackingInterruptedAlertCopy` and `notifyTrackingInterrupted` outright rather than left accepted and ignored, precisely so that no future caller can fabricate a number to satisfy a parameter that is still there.

**Why the true count is deferred rather than built now.** It is native Kotlin work in `modules/notification_listener`, and nothing in that area can be verified off-hardware. Building it now would land an unproven method and add another line to the on-device checklist rather than finishing anything. Removing the false figure was the correct immediate action; supplying a true one is separate work with a device attached.

**Prerequisites.**
1. The native method and its JS binding on `modules/notification_listener`, read-only by construction so it can never be confused with `drainPendingCaptures()`.
2. A decision on what the number means: buffered captures awaiting drain only, or also an estimate of the gap while the listener was fully dead. These are not the same quantity, and the second may not be knowable at all. If only the first is available, the copy has to say something true about a narrower fact rather than imply it covers the outage.
3. Restoring the count to `mobile/lib/alerts/alert_copy.ts` and to its tests, which is where it was removed from.
4. Device verification, since nothing in this area is settled off-hardware.

**Tier placement when shipped.** None; it is ingest-health behavior, Free like the rest of the pipeline. If it ships, the richer designed copy returns with it.

---

### 2b summary

| Item | Band | What unblocks it |
|---|---|---|
| App PIN as a third DEK wrap (W4) | Near | W0 shipped, plus device time for a key-material change |
| Notification action buttons and the Capture board | Near | Expo notification categories and a response handler |
| "Not money" ×2 mute counter | Near | Per-source dismissal counting that outlives the item |
| The unwritable dedupe-signature UserRule | Mid | A matcher-model change, not UI |
| 119 raw Tailwind type-size classes | Near | A device, its own task, and a lint rule |
| Non-destructive capture-buffer count | Near | A native read-only count, plus a device to verify it on |

---

## 3. Horizon summary

| Item | Band | Tier when shipped | Blocking prerequisite (the big one) |
|---|---|---|---|
| Debt payoff planner | Near | Plus (locked) | Loan data maturity + enforcement live |
| Widgets / Wear | Near | Follows existing Safe-to-Spend row | Stable, trusted Safe-to-Spend |
| iOS (degraded/manual ingest) | Mid | Mirrors Android matrix | Mature sync + proven manual entry |
| Household sharing | Mid | Plus | Cloud identity + conflict resolution |
| Net worth | Mid | Plus | Balance accuracy proven |
| Web dashboard | Mid | Plus | Stable sync + web security posture |
| Google account linking & beta cohort | Mid | Free (unlocks stay Plus) | Server exists |
| Receipt OCR | Far | Plus | On-device processing decision + PH corpus |
| BSP Open Finance / bank APIs | Far | Plus | Ecosystem access + privacy re-architecture |
| Investments | Far | Plus | Net worth shipped + valuation source |
| Multi-currency | Far | Plus | FX source + cross-currency transfer matching |
| AI insights | Far | Plus | Privacy-cleared processing + history depth |

---

## 4. Standing non-goals (not deferred — refused)

These are not backlog items and do not graduate:

1. Advertising of any kind inside the app.
2. Selling, sharing, or monetizing user data or aggregate financial behavior.
3. `READ_SMS` or call-log permissions, or accessibility-service ingest workarounds.
4. Lending, payments, or moving money — PeraPlano watches money; it never touches it.
5. Social feeds or public sharing of financial activity.

---

## 5. Cross-references

- MVP scope and phase gates that lock this split: [01-mvp-scope.md](01-mvp-scope.md)
- Domain model entities referenced above: [02-domain-model.md](02-domain-model.md)
- Ingest pipeline concepts (DedupeGate, ConfidenceGate, Review Queue) reused by future channels: [03-ingest-pipeline.md](03-ingest-pipeline.md)
- Tier matrix ownership and gate principles: [05-monetization.md](05-monetization.md)
- Privacy bar every item must clear: [07-privacy-and-compliance.md](07-privacy-and-compliance.md)
- Risks that shape sequencing (R1, R5 especially): [08-risks-and-open-questions.md](08-risks-and-open-questions.md)

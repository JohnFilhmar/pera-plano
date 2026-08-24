# V2 Backlog

This document holds everything deliberately excluded from the MVP: for each item, what it is, why it was deferred, what must be true before it can be built, and where it will sit in the Free/Plus tier structure when it ships. The MVP scope is locked; nothing here re-enters scope without an explicit revision of the MVP scope doc. The backlog exists so that deferrals are decisions with reasons, not forgotten ideas — and so that MVP design choices (local-first, Entitlements flags, parser-as-data) keep the doors below open instead of welding them shut.

**Status:** Draft v1 · 2026-08-02

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
keeps Plus permanently. Nothing in the app records who those people are — the 2026-08-22 UI
revamp deliberately chose not to persist `first_install_at`, `build_channel`, or a cohort id, and
ships "Beta User" as a cosmetic label only
(`docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md` §6.2–§6.3). That choice cannot be
undone after the fact: an install date cannot be reconstructed from the app once this ships. The
only surviving evidence of who installed during beta will be Google Play Console's install
records, and **nobody has verified that Play Console exposes per-account first-install dates in
an exportable form** — there is no second chance to collect this once the beta window closes.

**Prerequisites.**
1. The server exists.
2. A decision on what a linked account is allowed to sync, cleared against the privacy bar in
   [07-privacy-and-compliance.md](07-privacy-and-compliance.md) §1, which already locks a
   no-account, local-first architecture for the Free tier — account linking is new surface area
   against that promise, not a change to it.
3. Verification that Google Play Console exposes exportable per-account first-install dates,
   completed before the beta ends. It is the sole surviving source once it does.

**Tier placement when shipped.** Account linking itself is Free. What it unlocks — cloud backup,
multi-device sync — is already Plus in the locked tier matrix and does not move.

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

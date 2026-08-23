# Risks & Open Questions

This document is the honest ledger of what could sink or degrade PeraPlano, and of what is genuinely undecided. It expands the six top risks from the master planning context into a full register — each with likelihood, impact, mitigations, early-warning signals, and a contingency if the risk lands — and consolidates the open questions from across the documentation set into one place with enough framing that each can be decided later without re-research. Feature docs keep their local `## Open questions` sections; those roll up here at each revision of this document.

**Status:** Draft v1 · 2026-08-02

---

## 1. Risk register — overview

Ratings: likelihood and impact are Low / Medium / High / Critical, judged for the MVP launch window on the Philippine Android market.

| # | Risk | Likelihood | Impact | Net posture |
|---|---|---|---|---|
| R1 | Google Play rejection of notification-access justification | Medium–High | Critical (launch blocker) | Prepare hard, test the declaration early, keep a manual-mode contingency |
| R2 | Parser rot — providers silently change notification wording | High (certain over time) | High | Parsers as remote-updatable data; Review Queue as sensor |
| R3 | OEM background kills silence the listener | High | High | Exemptions, OEM guidance, health surface, catch-up |
| R4 | Dedupe / transfer-detection errors corrupt totals | Medium | High | Conservative auto-commit; easy user repair |
| R5 | Providers change or silence their own notifications | Medium | High (concentrated) | Multi-channel parsing; provider diversity |
| R6 | Users don't trust a finance app that reads all notifications | Medium (persistent headwind) | Critical for adoption | Local-first story, radical transparency |

---

## 2. The six risks, expanded

### R1 — Google Play rejection of the notification-access justification

**What it is.** PeraPlano's entire ingest path depends on `NotificationListenerService`, which Google Play treats as a sensitive capability requiring a declaration and justification. Finance apps draw extra review scrutiny. A rejection — or an approval later withdrawn in a policy sweep — blocks distribution of the core product. This is the single largest external dependency the product has, and it is adjudicated by a reviewer we cannot talk to in advance.

**Likelihood: Medium–High.** The use is genuinely core functionality (the strongest possible position), but review outcomes for sensitive permissions are inconsistent, policy language shifts, and finance + notification access is exactly the combination sweeps target.

**Impact: Critical.** No listener means no auto-tracking, which is the product's core promise. Manual-only PeraPlano competes in a crowded field with no moat.

**Mitigations.**
1. Core-functionality framing in the declaration: automatic transaction recording *is* the product; the declaration enumerates on-device parsing, the 30-day raw-text purge, and the fact that raw text never leaves the device (full strategy in [07-privacy-and-compliance.md](07-privacy-and-compliance.md) §3.1).
2. Prominent in-app disclosure and consent before the system settings screen, exceeding the policy minimum.
3. Review evidence pack: screen-recorded video of disclosure → grant → first auto-tracked transaction → transparency screen → pause → wipe, plus annotated screenshots and the privacy notice.
4. Fallback manual mode visible in the review flow: the permission is skippable and the app still functions, demonstrating the grant is not coerced.
5. Exercise the declaration on internal and closed testing tracks well before any public date is committed; treat the first successful declared release as a phase-gate artifact, not a formality.
6. Keep the `specialUse` foreground-service declaration (if used at all) word-for-word consistent with the notification-access justification; inconsistencies between declarations are a known rejection trigger.
7. No policy-adjacent adventurism: no `READ_SMS`, no accessibility-service ingest, ever. One clean story.

**Early-warning signals.**
- Rejection or clarification requests on internal/closed track submissions.
- Google Play policy-update announcements touching notification access, financial services, or `specialUse`.
- Other notification-reading finance trackers being delisted or force-updated (monitor a named watchlist of comparable apps monthly).
- Pre-launch report warnings in the Play Console.

**Contingency if it lands.** Launch cannot proceed on the planned promise. Options, in order: (a) appeal with an amended declaration and expanded evidence; (b) narrow the listener's stated scope (e.g., explicit provider allow-list surfaced in the disclosure) and resubmit; (c) ship a manual-entry + cash-reconciliation product to preserve momentum while the appeal runs. Sideloaded or alternative-store distribution is a last resort with severe reach and trust costs and is not part of the plan of record.

---

### R2 — Parser rot

**What it is.** Providers change notification wording, add promotional prefixes, restructure templates, or move information between push and SMS without notice. Every such change silently degrades parse accuracy. Unlike a crash, a bad parse can *look* fine — wrong `amount`, wrong `direction`, missed transaction — and corrupt the ledger the user trusts.

**Likelihood: High.** Not "if" but "when," repeatedly, across 13+ catalogued providers. Treat as a permanent operating condition, not an incident.

**Impact: High.** The success criterion is ≥95% of notifications from supported providers parsed with correct amount + direction. Sustained rot below that erodes the core promise and shows up as "app records wrong numbers" reviews — the worst possible review for a finance app.

**Mitigations.**
1. Parsers are versioned data, not code: per-provider rules ship as remote-updatable content, so a wording fix deploys in hours without an app release or review cycle.
2. The Review Queue is the sensor: any parse falling below the ConfidenceGate lands there instead of committing garbage; a sudden Review Queue spike for one provider is a rot alarm.
3. Parse-success telemetry (aggregate counts only, never content) per provider and parser version, with alerting thresholds tied to the 95% criterion.
4. Unknown-bin capture catches template changes so severe the SourceRouter no longer recognizes the message shape; users flagging "this is a money notification" turn gaps into training data.
5. Every user correction becomes a UserRule that replays on future notifications, so individual users self-heal ahead of a global parser fix.
6. Staged parser rollout with a kill switch: a bad parser update can be reverted remotely faster than it can spread.
7. A maintained corpus of real captured notification formats per provider, versioned alongside the parsers (all planning-doc samples are illustrative until this corpus exists).

**Early-warning signals.**
- Per-provider parse-success rate dropping against its trailing baseline.
- Review Queue arrival rate spiking for a single provider.
- Unknown-bin volume growth from a previously recognized package.
- Provider app-update announcements or PH fintech community chatter about redesigned notifications.
- Support contacts or reviews mentioning missed or wrong transactions clustered on one provider.

**Contingency if it lands.** For a broken provider: push a parser hotfix; until then the ConfidenceGate routes affected messages to the Review Queue (degraded but honest). If a provider becomes unparseable long-term, mark it "manual assist" in-app: notifications open a pre-filled manual entry instead of auto-committing.

---

### R3 — OEM background kills

**What it is.** Aggressive OEM battery managers (Xiaomi/MIUI, Huawei, Oppo, Vivo — a very large share of the PH Android installed base) kill background listeners regardless of Android's standard rules. The listener dies silently; the user finds out days later that nothing was tracked, which reads as "the app is broken."

**Likelihood: High.** These OEMs dominate PH price tiers; default settings kill unexempted background components as a matter of course.

**Impact: High.** Silent tracking gaps attack the core promise and the success criteria (listener uptime ≥ 99% outside OEM kills; battery attribution < 2%/day). The damage is trust, not just data: one unexplained gap makes users doubt every number.

**Mitigations.**
1. Battery-optimization exemption prompt in onboarding, explained before it is asked (value first, then the scary screen).
2. OEM-specific guidance screens: detected manufacturer → step-by-step instructions for that OEM's settings (autostart, battery saver, locked recents).
3. Listener-health indicator: an always-available surface showing listener alive/dead and last-event time, with a "tracking was interrupted" banner on app open after a detected gap.
4. Catch-up strategy: on reopen after a gap, prompt reconciliation — the user confirms current Wallet balances and the app records an adjustment rather than pretending the gap didn't happen.
5. Gap detection heuristic: a previously chatty provider going silent for an abnormal period flags probable listener death (distinct from the user simply not transacting).
6. Boot receiver re-attaches the listener after restarts; health check on every app open.

**Early-warning signals.**
- Listener uptime telemetry below target, segmented by OEM and model.
- Rising frequency of "tracking was interrupted" banner displays.
- Reconciliation adjustments growing as a share of ledger entries on specific OEMs.
- Reviews or support contacts saying tracking "stopped working after a few days" (classic OEM-kill signature).

**Contingency if it lands.** If a specific OEM/model family proves unrecoverable even with exemptions, degrade honestly on that hardware: detect it, tell the user tracking will be unreliable on this device, lean on reconciliation prompts and manual entry, and publish a supported-devices note rather than silently underperforming.

---

### R4 — Dedupe / transfer-detection errors corrupting totals

**What it is.** Two failure families with opposite signs. DedupeGate errors: a push and its SMS twin both commit (double-counted spend) or two genuinely distinct same-amount transactions get merged (missing spend). TransferDetector errors: a real internal movement isn't linked (fake income + fake expense inflate both totals) or two unrelated opposite-direction transactions get linked (real spend vanishes from totals). All four corrupt Limits, Safe-to-Spend, and reports — the numbers users act on.

**Likelihood: Medium.** The signals (time window + amount + reference number + provider; fee-tolerant amount matching across Wallets) are decent but genuinely ambiguous cases occur daily at scale: identical load purchases minutes apart, transfers with fees, providers omitting reference numbers in one channel.

**Impact: High.** Success criteria demand ≥95% of push/SMS twins deduplicated and ≥90% of internal transfers auto-linked. A user who catches one double-count re-checks everything afterward; the product's whole value is *not* having to do that.

**Mitigations.**
1. Conservative auto-commit: ambiguous dedupe or transfer candidates go to the Review Queue via the ConfidenceGate instead of guessing.
2. Domain invariant enforced everywhere: transfer-linked transactions never count in spend/income totals, Limits, or reports (they do affect Wallet balances) — so a correct link fully repairs totals.
3. Easy repair UI: merge (mark as duplicates), split (undo a wrong merge), link (create a TransferLink), unlink (dissolve one) — each one or two taps from the Transaction detail, no destructive deletes required.
4. Repairs teach the pipeline: corrections generate UserRules where a generalizable pattern exists (e.g., a provider pair that always needs linking).
5. Dedupe keys on reference numbers when present; time-window and amount tolerances are per-provider data (tunable remotely with the parsers, not hardcoded).
6. Success-criteria measurement before public launch (≥95% twin dedupe, ≥90% transfer auto-link) on the real captured corpus, not synthetic data.

**Early-warning signals.**
- Merge/split/link/unlink action rates trending up (users repairing means the pipeline is guessing wrong).
- Duplicate-pair detection rate falling for providers known to send push + SMS twins.
- Balance-after values parsed from notifications diverging from computed Wallet balances (a free integrity check where providers include balance-after).
- Support contacts about "double transactions" or "income that isn't income."

**Contingency if it lands.** Tighten ConfidenceGate thresholds remotely (more Review Queue, less silent error) while tuning per-provider windows; the Review Queue absorbs the load honestly. Worst case for a provider: route all its dedupe/transfer decisions through user confirmation until fixed.

---

### R5 — In-app-only notification changes by providers

**What it is.** A provider (GCash being the highest-stakes example given its share of PH e-wallet activity) could reduce, silence, or restructure its push notifications — moving alerts in-app, making them silent, gating them behind settings, or randomizing content. Unlike R2 (wording drift), this removes the signal itself. It can happen in one app update, without notice, for reasons that have nothing to do with us.

**Likelihood: Medium.** Providers have strong reasons to keep transaction alerts (fraud, engagement, regulator expectations), but redesigns, "notification fatigue" cleanups, and engagement experiments are routine.

**Impact: High, concentrated.** Losing one mid-tier provider is absorbable; materially losing GCash would gut coverage for a large fraction of PH users' daily transactions.

**Mitigations.**
1. Multi-channel parsing per provider: push notifications *and* bank SMS arriving as notifications posted by the default SMS app; when one channel degrades, the other often survives (DedupeGate already handles the overlap when both work).
2. Provider diversity: 13+ catalogued providers means no single failure zeroes the product; coverage breadth is a resilience strategy, not just a market-fit one.
3. Cash reconciliation prompts and manual entry as the universal fallback for anything unobserved.
4. Unknown-bin plus remote parser updates: if a provider restructures rather than removes notifications, this is R2 machinery and heals in hours.
5. Per-provider volume monitoring (aggregate counts) so a silencing event is detected within days, not months.
6. Relationship option (later): PH fintechs have partnership channels; a data partnership or heads-up channel is a v2-era possibility (see BSP Open Finance in [09-v2-backlog.md](09-v2-backlog.md)) — not a dependency of the MVP plan.

**Early-warning signals.**
- Sudden per-provider notification volume drop against baseline, not explained by seasonality.
- Provider app release notes or PH fintech press mentioning notification changes.
- Users of one provider reporting "my GCash stopped showing up" while others are unaffected.
- Increase in manual entries categorized to a provider whose auto-ingest volume fell.

**Contingency if it lands.** Shift the affected provider to its surviving channel (usually SMS-via-Messages for banks); if both channels die, mark the provider "manual assist" in-app, tell affected users plainly what changed and whose change it was, and lean on reconciliation. Honesty about the cause protects trust — silence would spend it.

---

### R6 — Trust: asking users to let a finance app read all notifications

**What it is.** The Notification Access grant screen is system-level, deliberately alarming, and grants reading of *all* notifications — messages, OTPs, personal apps — not just bank alerts. PH users are justifiably wary: SMS scams, predatory lending apps that harvested contacts, and data-leak news are recent memory. This risk is a persistent headwind on conversion at the single most important step of onboarding, and one bad press cycle ("expense app reads your messages") could be fatal regardless of the truth.

**Likelihood: Medium** as a persistent drag on the onboarding funnel; **Low–Medium** as an acute press event — but the acute version is the dangerous one.

**Impact: Critical for adoption.** Time from install → first auto-tracked transaction < 5 minutes is a success criterion; every user who bails at the grant screen never sees the product work even once.

**Mitigations.**
1. Local-first story front and center — and architecturally true: raw text never leaves the device, purged after 30 days, no ads, no data selling. The claim survives scrutiny because it is a design fact, not a policy promise ([07-privacy-and-compliance.md](07-privacy-and-compliance.md) §1).
2. Explain value *before* the scary screen: onboarding shows what the app will do with access and what it will never do, in plain language, before deep-linking to system settings.
3. Radical transparency in-product: the "why was this recorded?" screen shows the exact captured text via `rawNotificationRef`; parser diagnostics show what the pipeline touches; pause and wipe are one screen away.
4. Every permission is skippable — the app degrades to manual mode rather than blocking, which both improves the Play review posture (R1) and signals confidence to users.
5. An open, readable privacy policy written for humans, consistent to the letter with the lifecycle table.
6. Press-readiness: a plain-language security/privacy explainer page and prepared responses, because the acute version of this risk is won or lost in the first news cycle.

**Early-warning signals.**
- Onboarding funnel drop-off specifically at the Notification Access step (instrumented as an aggregate step-completion count).
- Uninstalls clustered within the first hour after granting access.
- Store reviews or social posts with privacy-fear language ("basa lahat ng messages" — "it reads all your messages").
- Third-party commentary or app-permission-audit content naming the app.

**Contingency if it lands.** For funnel drag: iterate the explainer flow (copy, ordering, demo-before-grant) and consider a "try manual mode first" path where the grant is asked after the user has seen value. For an acute trust event: respond within the same news cycle with the verifiable local-first facts, invite an external written review of the claims, and publish the finding.

---

## 3. Consolidated open questions

Genuinely open items only, framed for later decision. "Decide by" references the MVP phase gates (M1 ingest core, M2 control, M3 insight & polish) plus Pre-launch and Post-launch. Locked decisions (Android-only, PHP-only, local-first, freemium shape, no SMS permissions) are not reopened here.

### 3.1 Compliance & legal

1. **NPC registration scope.** Planning position is to appoint and register a DPO and register the backup processing system before launch. Open: whether the Free tier's on-device-only processing changes what must be registered, and whether the ledger's treatment at the sensitive-information bar is legally required or voluntarily adopted. Needs Philippine privacy counsel review of [07-privacy-and-compliance.md](07-privacy-and-compliance.md) §2. **Decide by: Pre-launch.**
2. **Telemetry retention lengths.** Doc 07 sets ≤ 90 days raw events / ≤ 24 months aggregates as the planning position. Open: whether counsel or the PIA recommends shorter, and whether crash data (which can embed device identifiers) needs its own row in the lifecycle table. **Decide by: M3.**
3. **`specialUse` foreground service — use it or design it out.** If catch-up processing fits within standard background limits, the declaration is dropped entirely, shrinking the Play policy surface (R1). Open pending measurement of catch-up workloads on real backlogs. **Decide by: M1 exit.**
4. **Web deletion path timing.** Play's account-deletion policy binds only once a sign-in identity exists (cloud backup, Plus). Open: stand up the web deletion endpoint at MVP launch (backup exists but unenforced tier) or gate it to backup enforcement. **Decide by: Pre-launch.**
5. **Support-channel data hygiene.** Users will paste screenshots of notifications into support messages despite warnings. Open: whether support tooling should auto-redact, and what the retention rule for attachments is beyond the ≤ 24 months in the lifecycle table. **Decide by: Post-launch.**

### 3.2 Ingest & pipeline

6. **Provider package-name verification.** The §4 provider catalogue's package names are indicative. Open: the verified list, including multi-package providers (ShopeePay inside the Shopee app, GrabPay inside Grab) and OEM-variant SMS apps beyond the default Messages app. **Decide by: M1.**
7. **Corpus collection method.** Real notification formats must be captured from devices and maintained as a versioned parser corpus; all planning samples are illustrative. Open: staff devices only, a paid device panel, opt-in capture from early testers (with explicit consent and on-device redaction), or a mix. Privacy review required for any user-sourced option. **Decide by: M1.**
8. **Remote parser update cadence and kill-switch policy.** Parsers ship as remote-updatable data. Open: update check frequency, staged-rollout percentages, and who can pull the kill switch on a bad parser at what severity. **Decide by: M2.**
9. **Unknown-bin flag → parser coverage loop.** Users can flag "this is a money notification." Open: what the response loop is — target turnaround for adding a flagged provider, and whether flagged (on-device) samples can ever inform parser authoring without content leaving the device. **Decide by: M3.**
10. **Dedupe/transfer tolerance defaults.** Time windows and fee tolerance are per-provider data. Open: initial default values per provider pair, to be set from the captured corpus, and the threshold at which the ConfidenceGate defers to the Review Queue. **Decide by: M1 exit (initial), tuned continuously.**

### 3.3 Product behavior

11. **Review Queue amounts on the Safe-to-Spend caption.** Uncommitted Review Queue items are not counted in Safe-to-Spend — an accepted simplification — and the annotation is already decided: a caption "N transactions awaiting review — not yet counted" shows whenever the queue is non-empty ([04-features/09-safe-to-spend.md](04-features/09-safe-to-spend.md), rule 12). Open: only whether the caption should additionally show the total peso amount awaiting review ("₱1,250.00 awaiting review"). **Decide by: M3.**
12. **Rollover residuals.** Rollover semantics are decided in [04-features/03-limits.md](04-features/03-limits.md), rules 14–18: carryover is one period deep, capped at one base value, never negative, computed from the previous period's base. Remaining open: exactly how existing carryover is re-clamped when the user edits the Limit's `value` mid-period (rule 18 covers the rollover toggle and percent bases, not a base-value change), and opt-in negative rollover (excluded from MVP, limits open question 4). **Decide by: M2.**
13. **Income detection residuals.** Evidence thresholds are decided in [04-features/04-income.md](04-features/04-income.md), rule 6 (kinsenas: 3 consecutive matched windows provisional, 4-of-5 confirmed; weekly/monthly analogues), and 13th-month/bonus handling is decided (off-schedule credits never reset evidence; the median-based `averageAmount` absorbs outliers — rules 8–9). Remaining open: validating those thresholds against real beta ledgers, and whether confirmed-status auto-apply without user confirmation (04-income detection flow, step 3) is acceptable to users in practice. **Decide by: M2 initial values, tuned in beta.**
14. **Cash reconciliation residuals.** Prompt cadence and delta treatment are decided in [04-features/02-wallets.md](04-features/02-wallets.md): default weekly per cash Wallet, plus after-cash-out and 14-idle-day triggers, and the delta posts as a recategorizable manual Transaction defaulting to Uncategorized. Remaining open: whether the default cadence should instead key off the user's income cadence (prompt at kinsenas boundaries — wallets open question 3). **Decide by: M2.**
15. **Loan payment-matching ambiguity.** A transaction may plausibly match either a Bill's `autoMatchRule` or a Loan's `paymentHistory[]` expectation (e.g., a credit card payment that is both). Open: precedence order, and whether a double-match always routes to the Review Queue. **Decide by: M2.**

### 3.4 Monetization & tiers

The tier matrix itself is locked; pricing figures are intentionally not decided in this planning phase. For reference:

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

16. **Pricing.** Deliberately open: monthly price point, annual discount, possible lifetime tier. [05-monetization.md](05-monetization.md) frames the options without fixing numbers. **Decide by: Pre-launch (enforcement flip), informed by MVP usage.**
17. **Enforcement flip timing.** Entitlements is hardcoded `plus` during MVP. Open: the criteria for flipping to enforced tiers — install base, retention threshold, or calendar date — and whether early users get a grace grant. **Decide by: Post-launch decision, criteria drafted Pre-launch.**
18. **Downgrade mechanics — residuals.** The principle is locked (keep data, block creation of new, never delete), and the which-item-stays-active question is decided: the most recently edited eligible item stays active by default — deterministic, user-swappable, no forced choice at downgrade ([05-monetization.md](05-monetization.md) §3.3; for Limits that means the most recently edited active unfiltered Limit, and Wallets, Goals, Loans, and Bills have no active-item selection because all keep operating). Remaining open: whether a one-time downgrade summary screen should surface the swap action, and validating the default against real lapse behavior once enforcement is on. **Decide by: Pre-launch (enforcement design).**

### Free-tier counts disagree between the code and the design handoff

`lib/entitlements.ts` caps the free tier at `FREE_WALLET_CAP = 3`, `FREE_ACTIVE_LIMIT_CAP = 1`,
`FREE_GOAL_CAP = 1`, `FREE_LOAN_CAP = 1`. The mobile design handoff's Free-vs-Plus board
(`docs/pera-plano-mobile/PeraPlano Mobile UI.dc.html`) combines Limits and Goals into one row
reading "Limits & goals — 3 each". Wallets agree at 3; Limits and Goals disagree by 3×. Loans
carries no count on that board at all — "Loan amortization" there is a plain feature check, so
`FREE_LOAN_CAP` has nothing to conflict with.

This is not a gap in the table above: §3.4's own tier matrix already states Limits at "1 active"
and Goals at "1", agreeing with the code, not the design board. The table is not being corrected
here — the design board is what disagrees, and nobody has yet decided which side moves.

**Blocking before pricing, not before launch.** Every cap is inert today because `MVP_TIER =
"plus"`, so nothing behaves wrongly right now. The 2026-08-22 UI revamp responded by removing
counts from the in-app Free-vs-Plus table entirely rather than publish a number that might be
wrong (`components/gates/upgrade_sheet.tsx`'s `CAPABILITY_COPY` header carries the reasoning).
The table cannot state a quantity again until this is settled.

**Owner:** whoever settles [05-monetization.md](05-monetization.md) §2, the canonical tier
matrix. The decision is a pricing one, not an engineering one — either the code's caps move to
3, or the design board's "3 each" is corrected to 1.

### 3.5 Platform & device support

19. **Minimum supported Android version.** Constrains listener behavior, notification-channel handling, and the POST_NOTIFICATIONS / foreground-service-type code paths. Open pending PH device-mix data for the target segments (heavily Xiaomi/Oppo/Vivo/realme at mid and low tiers). **Decide by: M1.**
20. **Work profile and multi-user behavior.** Notification access in a work profile is separately controlled, and provider apps may live in either profile. Open: whether MVP explicitly supports dual-profile parsing or documents it as unsupported. **Decide by: M3.**
21. **Supported-device posture for hostile OEMs.** If specific models prove unrecoverable for listener uptime (R3), open: whether to publish a supported/known-limited device list at launch, and what the in-app messaging is on detection. **Decide by: Pre-launch.**

### 3.6 Launch & operations

22. **Beta shape.** Open: closed beta size, recruitment channel (PH personal-finance communities are active), and whether beta feedback tooling stays within the no-third-party-content rule of doc 07. **Decide by: M3.**
23. **Parse-success measurement protocol.** The ≥95% parse and ≥95%/≥90% dedupe/transfer criteria must be measured before public launch. Open: the measurement protocol — corpus replay, live beta telemetry, or both — and the sample sizes that make the numbers trustworthy. **Decide by: M3.**
24. **Support load model.** Review Queue and reconciliation are designed to convert parser gaps into in-product actions instead of support tickets. Open: what support volume to staff for anyway at launch, and the escalation path from "wrong parse" reports to parser fixes. **Decide by: Pre-launch.**

### 3.7 Per-doc open-question index

Feature docs own their local `## Open questions` sections; this index is the roll-up so nothing hides. Items already absorbed into §3.1–§3.6 above are not repeated.

| Doc | Local open questions |
|---|---|
| [03-ingest-pipeline.md](03-ingest-pipeline.md) §14 | Unknown-bin pre-filter strictness · large-amount review guard · extended transfer-window length · suppressed-twin transparency |
| [04-features/01-onboarding.md](04-features/01-onboarding.md) | Pre-permission demo data · installed-app (package-visibility) detection and its Play-review risk · OEM guidance format (in-app illustrated vs linked page) |
| [04-features/02-wallets.md](04-features/02-wallets.md) | Balance-drift tolerance value · credit-Wallet vs Bill overlap · default reconciliation cadence (see §3.3 #14) · proactive sub-account discovery |
| [04-features/03-limits.md](04-features/03-limits.md) | Refund netting · payday-aligned periods · week-start setting · opt-in negative rollover (see §3.3 #12) |
| [04-features/04-income.md](04-features/04-income.md) | Multiple income streams · remittance-as-income · explicit 13th-month planning · payday-aligned Limit periods |
| [04-features/05-goals-savings.md](04-features/05-goals-savings.md) | Percent-rule cap on outsized paydays (13th month) · suggesting archive of a completed goal's Wallet · multiple goals per savings Wallet (v2) |
| [04-features/06-loans.md](04-features/06-loans.md) | Loans feeding Safe-to-Spend directly · prepayment recompute policy (shorter term vs smaller installment) · implied-cost display for flat/5-6 loans |
| [04-features/07-bills.md](04-features/07-bills.md) | PH holiday calendar for due-date adjustment · first-class partial payments · estimate statistic (mean-of-3 vs median-of-5) |
| [04-features/08-review-queue.md](04-features/08-review-queue.md) | Expiry destination (discard vs recoverable holding state) · auto-confirm ramp · digest trigger/timing tuning |
| [04-features/09-safe-to-spend.md](04-features/09-safe-to-spend.md) | Nearly-exhausted filtered Limit overriding the driver · negative rollover (joint with Limits) · payday markers on the projection curve |
| [04-features/10-reports.md](04-features/10-reports.md) | Refund netting against category spend · kinsenas-aligned trend periods · default trend metric (spend vs net) |
| [04-features/11-settings-privacy.md](04-features/11-settings-privacy.md) | Telemetry-sharing default (on vs opt-in — decide with the NPC compliance review, §3.1 #1) · export of in-flight Review Queue items · cloud-copy grace period on downgrade |

---

## 4. Cross-references

- Privacy, Play declarations, data lifecycle: [07-privacy-and-compliance.md](07-privacy-and-compliance.md)
- Ingest pipeline stages, provider catalogue, parser-as-data: [03-ingest-pipeline.md](03-ingest-pipeline.md)
- Tier matrix ownership, gate behavior, pricing framing: [05-monetization.md](05-monetization.md)
- Deferred scope that several open questions touch: [09-v2-backlog.md](09-v2-backlog.md)

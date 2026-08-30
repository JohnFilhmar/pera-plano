# PeraPlano — MVP Scope

This document is the binding scope contract for the PeraPlano MVP. It lists exactly what is in (organized into three layers: L1 ingest & ledger, L2 control, L3 light insight), exactly what is out and why, the three phase gates (M1–M3) with exit criteria, and the measurable success criteria that define launch readiness. Anything not listed as in-scope here is out of scope for MVP; scope changes require updating this document first. Product rationale lives in [00-product-brief.md](00-product-brief.md); per-feature behavior lives in the `04-features/` docs.

**Status:** Draft v1 · 2026-08-02

---

## 1. Scope philosophy

Three principles shaped every in/out call below:

1. **The ledger must be trustworthy before anything built on it matters.** L1 (ingest & ledger) is the foundation; L2 (control) and L3 (insight) are only as good as the transactions underneath them. This is why phase gate M1 is pure ingest.
2. **Build everything, gate later.** Every MVP feature — including Plus-tier capabilities like payday auto-allocation and recurring detection — is built and working in MVP. Gating is defined now (see §5) but enforced later via a single Entitlements layer reading `tier: free | plus`, hardcoded to `plus` during MVP. This lets the whole product be exercised in testing while keeping the paywall a one-flag decision.
3. **Cut anything that breaks local-first or Android-only.** Household sharing, web dashboard, and bank API integrations all force server-side identity or data custody. They are deferred, not because they lack value, but because they conflict with the MVP architecture (see §3).

## 2. In scope

### 2.1 L1 — Ingest & ledger

The passive pipeline that turns notifications into a trustworthy ledger. Full stage-by-stage specification in [03-ingest-pipeline.md](03-ingest-pipeline.md).

| # | Capability | Summary | Feature doc |
|---|---|---|---|
| L1-1 | Notification listener | 24/7 capture via Android `NotificationListenerService`; survives reboot via boot receiver; battery-optimization exemption prompt; OEM-specific guidance; listener-health indicator with "tracking was interrupted" catch-up banner | [03-ingest-pipeline.md](03-ingest-pipeline.md), [04-features/11-settings-privacy.md](04-features/11-settings-privacy.md) |
| L1-2 | PH parser catalogue | Versioned, remote-updatable parsing rules (shipped as data, not code) for the MVP provider set: GCash, Maya, BPI, BDO, UnionBank, Metrobank, SeaBank, GoTyme, CIMB, Landbank, ShopeePay, GrabPay, and bank SMS relayed through the default SMS app's notifications | [03-ingest-pipeline.md](03-ingest-pipeline.md) |
| L1-3 | Wallet modeling | User-named Wallets of `type: bank \| e-wallet \| cash \| credit \| savings`, each with `matchers[]` mapping notification sources to it; archive rules; no orphan Transactions | [04-features/02-wallets.md](04-features/02-wallets.md) |
| L1-4 | Auto-categorization | Merchant map → UserRules → learned suggestions → Uncategorized, over the PH-flavored default category tree | [03-ingest-pipeline.md](03-ingest-pipeline.md) |
| L1-5 | Review Queue | Inbox for low-confidence parses, unknown providers, and ambiguous transfers; one-or-two-tap confirm/correct; every correction becomes a UserRule that replays on future notifications; badge on Transactions tab | [04-features/08-review-queue.md](04-features/08-review-queue.md) |
| L1-6 | Duplicate suppression | DedupeGate collapses push/SMS twins of the same transaction (time window + amount + reference # + provider) | [03-ingest-pipeline.md](03-ingest-pipeline.md) |
| L1-7 | Transfer detection | Opposite-direction pairs across Wallets within a time window, approximately equal amounts (fee-tolerant), joined as a Transfer Link; both legs excluded from spend and income totals | [03-ingest-pipeline.md](03-ingest-pipeline.md) |
| L1-8 | Manual transaction entry | For cash and anything the listener cannot see; `source: manual` | [04-features/02-wallets.md](04-features/02-wallets.md) |
| L1-9 | Cash reconciliation prompts | Periodic "does your cash Wallet still hold ₱X?" check with quick adjust | [04-features/02-wallets.md](04-features/02-wallets.md) |

### 2.2 L2 — Control

The rules layer — the only part of the product the user is expected to actively configure.

| # | Capability | Summary | Feature doc |
|---|---|---|---|
| L2-1 | Limits | `scope: daily \| weekly \| monthly \| annual`; `basis: fixed \| percent-of-income`; optional `categoryFilter` and `walletFilter`; `rollover`; alerts at 50% / 80% / 100% | [04-features/03-limits.md](04-features/03-limits.md) |
| L2-2 | Income cadence detection | Detects `cadence: kinsenas (15th/30th) \| weekly \| monthly \| irregular` into an IncomeProfile with `averageAmount` and `sourceWalletIds[]`; manual override (`isManualOverride`); feeds percent-of-income Limits and payday allocation | [04-features/04-income.md](04-features/04-income.md) |
| L2-3 | Goals + savings Wallets | Goal with `targetAmount`, optional `targetDate`, `linkedWalletId` pointing at a savings Wallet; progress from ledger | [04-features/05-goals-savings.md](04-features/05-goals-savings.md) |
| L2-4 | Payday auto-allocation (Plus) | `contributionRule` on a Goal auto-allocates ₱X or X% on payday; built in MVP, Plus-gated at launch | [04-features/05-goals-savings.md](04-features/05-goals-savings.md) |
| L2-5 | Loans, both directions | `direction: i-owe \| owed-to-me` — covering GLoan, credit cards, Home Credit, 5-6 (informal lending, "borrow 5, pay 6"), personal utang, and personal lending out; amortization `schedule`; `paymentHistory[]` matched from the ledger; `nextDueDate` / `nextDueAmount` reminders | [04-features/06-loans.md](04-features/06-loans.md) |
| L2-6 | Bills | Recurring obligations with `amount: fixed \| estimated`, `dueRule` (e.g., every 20th), `reminderOffsets[]` (e.g., 3 days before, on due date), `autoMatchRule` linking the paying transaction from the ledger | [04-features/07-bills.md](04-features/07-bills.md) |

### 2.3 L3 (light) — Insight

Enough insight to make the ledger and rules legible — deliberately "light" because deeper analytics are v2.

| # | Capability | Summary | Feature doc |
|---|---|---|---|
| L3-1 | Safe-to-Spend | The single home-screen number: remaining headroom of the tightest active Limit, minus bills due before that limit's period ends, minus planned goal contributions, spread over days remaining; floored at ₱0 with an explicit "you're over" state; Free shows today only, Plus projects to end of period | [04-features/09-safe-to-spend.md](04-features/09-safe-to-spend.md) |
| L3-2 | Recurring/subscription detection | RecurringPattern detection (`merchant`, `amount`, `period`, `confidence`, `acknowledged`) surfacing "₱X/month locked in"; Plus-gated at launch | [04-features/10-reports.md](04-features/10-reports.md) |
| L3-3 | Reports | Period spend, category breakdown, in-vs-out, trend | [04-features/10-reports.md](04-features/10-reports.md) |
| L3-4 | CSV export | Full-ledger export; Plus-gated at launch (PDF later) | [04-features/10-reports.md](04-features/10-reports.md) |
| L3-5 | Settings & privacy controls | Pause listening (global or per provider), transparency screens (view exactly what was captured via `rawNotificationRef`), data export, full wipe, parser diagnostics, listener health | [04-features/11-settings-privacy.md](04-features/11-settings-privacy.md) |
| L3-6 | Entitlements flag layer | `tier: free \| plus` evaluated at feature call-sites; defined and wired in MVP, hardcoded to `plus`, not enforced | [05-monetization.md](05-monetization.md) |

Also in scope, cutting across all layers: onboarding (permission explainer → Notification Access grant → battery exemption → provider/Wallet setup → income declaration → first Limit, with every permission skippable and graceful degradation to manual mode — [04-features/01-onboarding.md](04-features/01-onboarding.md)), the app's own alert notifications (which require the `POST_NOTIFICATIONS` runtime permission on Android 13+), and the Google Play compliance work that gates launch: notification-access declaration, Data safety form, and declared foreground-service types on Android 14+ (see [07-privacy-and-compliance.md](07-privacy-and-compliance.md)).

## 3. Out of scope (v2 backlog)

Each exclusion with its one-line reason. Expanded treatment, including prerequisites for revisiting, in [09-v2-backlog.md](09-v2-backlog.md).

The table below lists product capabilities left out of the MVP. Build-scope cuts made inside features that *do* ship (the Review Queue's second-dismissal mute counter, two UserRule kinds the matcher model cannot express, and the pending Tailwind type-scale conversion) are not table rows because they are at a finer altitude; they are recorded with full reasoning in [09-v2-backlog.md](09-v2-backlog.md) §2b, decided 2026-08-30.

| Item | Why it is out of MVP |
|---|---|
| iOS | iOS has no public API to read other apps' notifications; it needs a designed degraded/manual ingest path, not a port. |
| Household sharing | Forces cloud identity and multi-user sync, which conflicts with the local-first MVP data model. |
| Receipt OCR | Solves the cash gap more elegantly than manual entry, but is a heavy capture pipeline the MVP ledger does not depend on. |
| Net worth tracking | Requires asset/liability modeling beyond Wallets and Loans; insight depth belongs after ledger trust is proven. |
| Debt payoff planner (snowball/avalanche) | Depth feature on top of Loans; will be Plus-gated when it ships in v2. |
| Bank API / BSP Open Finance integration | The PH open-finance ecosystem is immature, and notification ingest already covers the providers users actually use. |
| Investments | A different product domain (positions, prices, returns) with no overlap with the ingest moat. |
| Web dashboard | Requires cloud accounts and server-side data custody, conflicting with local-first MVP. |
| Widgets / Wear | Surface-area polish that multiplies UI work without changing the core value proposition. |
| Multi-currency | PHP-only keeps parsing, totals, and reporting unambiguous for the PH-first market. |
| AI insights | Insight quality depends on months of clean ledger data that does not exist until after launch. |
| App PIN as a third DEK wrap | Cut 2026-08-30. It was always an *additional* unlock path, never a replacement: the device screen lock stays mandatory, so the database is encrypted and locked without it. |
| Notification action buttons | Cut 2026-08-30. No notification action infrastructure exists anywhere in the app; a shade button that does nothing is worse than none, so alerts ship as title and body copy only. |
| SMS permission (`READ_SMS`) | Effectively prohibited by Google Play policy for expense tracking — permanently out, not deferred; bank SMS is covered via the default SMS app's notifications. |
| Ads / data monetization | Permanently out; the business model is Plus, and trust is the product (see [00-product-brief.md](00-product-brief.md) non-goals). |

## 4. Phase gates

Three sequential gates. A gate is passed only when every exit criterion is demonstrably met; later-phase work may begin early, but the MVP is not "past" a gate until its criteria hold.

### M1 — Ingest core

**Scope:** listener + parsers + Wallets + dedupe + transfers + Review Queue + manual entry (L1-1 through L1-9).

**Exit criteria — auto-tracked ledger works end-to-end on supported providers:**

- [ ] A device with Notification Access granted auto-commits correctly parsed Transactions from each supported provider, with correct `amount`, `direction`, `walletId`, and `timestamp`.
- [ ] Listener survives device reboot (boot receiver) and reports its status via the listener-health indicator; interruption shows the "tracking was interrupted" catch-up banner on next open.
- [ ] Push/SMS twins of the same transaction are suppressed by the DedupeGate; internal movements between Wallets are joined as Transfer Links and excluded from spend/income totals.
- [ ] Low-confidence parses and unknown providers land in the Review Queue; a confirm/correct action takes at most two taps and produces a UserRule that demonstrably replays on the next matching notification.
- [ ] Manual entry works for cash Wallets, and cash reconciliation prompts adjust balances.
- [ ] Raw notification text is stored encrypted on-device, purged at 30 days, and every auto-committed Transaction retains `rawNotificationRef` while raw text is retained.

### M2 — Control

**Scope:** Limits + income + Goals + Loans + Bills (L2-1 through L2-6).

**Exit criteria — all rule-setting features functional with alerts:**

- [ ] Limits of every `scope` and both `basis` values compute correctly against the ledger, respect `categoryFilter`/`walletFilter` and `rollover`, and fire alerts at 50% / 80% / 100%.
- [ ] Income cadence detection identifies kinsenas (15th/30th), weekly, monthly, and irregular patterns from ledger history; manual override sets `isManualOverride` and wins over detection; percent-of-income Limits recompute when the IncomeProfile changes.
- [ ] A Goal linked to a savings Wallet shows correct progress from ledger activity; payday auto-allocation executes its `contributionRule` on detected payday.
- [ ] Loans in both directions track balance and `nextDueDate`/`nextDueAmount`; amortization `schedule` computes; ledger payments match into `paymentHistory[]`.
- [ ] Bills remind at each configured `reminderOffsets[]` entry and auto-match the paying transaction via `autoMatchRule`; `estimated` amounts reconcile to the actual matched amount.
- [ ] Transfer-linked transactions are excluded from all Limit, report, and income computations (invariant check).

### M3 — Insight & polish

**Scope:** Safe-to-Spend + recurring detection + reports + export + settings/privacy + Entitlements flags + onboarding polish (L3-1 through L3-6, onboarding).

**Exit criteria — MVP definition of done:**

- [ ] Safe-to-Spend matches its canonical formula in [04-features/09-safe-to-spend.md](04-features/09-safe-to-spend.md) against hand-computed fixtures, floors at ₱0 with the "you're over" state, and excludes uncommitted Review Queue items (accepted simplification).
- [ ] Recurring detection surfaces genuine subscriptions as RecurringPatterns with an acknowledge action.
- [ ] Reports (period spend, category breakdown, in-vs-out, trend) reconcile exactly with the ledger; CSV export round-trips all committed Transactions.
- [ ] Settings deliver every privacy control: pause listening globally and per provider, captured-data transparency, full export, full wipe, parser diagnostics, listener health.
- [ ] Onboarding completes the full flow (explainer → Notification Access → battery exemption → provider/Wallet setup → income declaration → first Limit) with every permission skippable and a working manual-mode degradation path.
- [ ] Every gated capability in §5 is callable behind the Entitlements layer with tier flags in place (hardcoded `plus`), and flipping a test build to `free` produces correct gate behavior: data kept, new creation blocked, nothing deleted.
- [ ] All §6 success criteria are measured and met.

## 5. Tier gating defined in MVP

The Entitlements layer (`tier: free | plus`) ships in MVP hardcoded to `plus`; enforcement is a post-MVP flag flip, not new development. The matrix below is the canonical gating definition (identical in [05-monetization.md](05-monetization.md)):

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

Gate behavior everywhere: keep existing data, block creation of new items past the cap, never delete or hide anything retroactively.

## 6. MVP success criteria

Targets measured before public launch. Telemetry used for measurement is aggregate counts only, never notification content (see [07-privacy-and-compliance.md](07-privacy-and-compliance.md)).

| # | Criterion | Target | How measured |
|---|---|---|---|
| S1 | Parse accuracy | ≥95% of notifications from supported providers parsed with correct amount + direction | Parser corpus test suite + field-test devices against real provider notifications |
| S2 | Dedupe rate | ≥95% of push/SMS twin pairs deduplicated | Field-test ledgers audited against source notification logs on-device |
| S3 | Transfer linking | ≥90% of internal transfers auto-linked | Field-test audit of known cross-Wallet movements vs. created Transfer Links |
| S4 | Time to first value | Install → first auto-tracked transaction < 5 minutes (given a supported provider) | Timed onboarding sessions on test devices |
| S5 | Battery | Battery attribution < 2%/day on a typical device | OS battery-usage attribution over multi-day field tests |
| S6 | Listener uptime | ≥99% outside OEM kills | Listener-health heartbeat logs across the field-test fleet, OEM kills excluded and tracked separately |
| S7 | Stability | Crash-free sessions ≥ 99.5% | Crash reporting across internal/closed testing tracks |
| S8 | Gating readiness | Every MVP feature callable behind the Entitlements layer with tier flags in place | Test build flipped to `free` exercises every gate per §5 |

A criterion that misses its target does not silently slip: it either blocks launch or is consciously re-negotiated in this document with the change recorded in [08-risks-and-open-questions.md](08-risks-and-open-questions.md).

## 7. Assumptions and dependencies

1. **Google Play approval** of the notification-access declaration is a launch gate outside our full control; the mitigation plan (core-functionality framing, prominent in-app disclosure, review video, manual-mode fallback) is in [08-risks-and-open-questions.md](08-risks-and-open-questions.md).
2. **Provider notification formats are captured, not assumed.** All notification text in planning docs is illustrative; the real parser corpus is built from device captures during M1 and maintained as versioned, remote-updatable data.
3. **PHP (₱) only.** All amounts, Limits, Goals, Loans, and reports assume `currency (PHP)`; multi-currency is v2.
4. **OEM battery behavior varies.** S6 excludes OEM kills by definition, but OEM guidance screens and the reconciliation catch-up path are in-scope MVP work, not post-launch patches.
5. **Package names in the provider catalogue are indicative** and verified at implementation ([03-ingest-pipeline.md](03-ingest-pipeline.md)).

## 8. Related documents

- [00-product-brief.md](00-product-brief.md) — vision, audience, positioning, non-goals
- [02-domain-model.md](02-domain-model.md) — entities, fields, invariants referenced throughout this scope
- [03-ingest-pipeline.md](03-ingest-pipeline.md) — full L1 pipeline specification and provider catalogue
- [05-monetization.md](05-monetization.md) — tier matrix rationale and entitlement design
- [07-privacy-and-compliance.md](07-privacy-and-compliance.md) — RA 10173/NPC, Play policy compliance, data lifecycle
- [08-risks-and-open-questions.md](08-risks-and-open-questions.md) — launch risks, including Play review and parser rot
- [09-v2-backlog.md](09-v2-backlog.md) — expanded treatment of every §3 exclusion

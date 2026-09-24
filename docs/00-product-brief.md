# PeraPlano — Product Brief

This document defines what PeraPlano is, who it serves, how it is positioned, and what it deliberately is not. It is the top-level reference for every other planning document: when a downstream doc needs to justify a decision, the justification should trace back to the vision and audience described here. Scope details live in [01-mvp-scope.md](01-mvp-scope.md); entities and rules live in [02-domain-model.md](02-domain-model.md).

**Status:** Draft v1 · 2026-08-02

---

## 1. Vision

PeraPlano is a Philippines-first Android app that tracks money automatically and helps people plan it deliberately. The name says it plainly: *pera* is Filipino for money, *plano* for plan.

Most money apps fail for one reason: they demand labor. The user must remember every jeepney fare, every GCash send, every Shopee checkout, and type it in. Nearly everyone stops within weeks, and the moment the ledger has gaps, it stops being trusted — and an untrusted ledger is worthless.

PeraPlano removes the labor. Filipino financial life already flows through phones: banks and e-wallets announce every peso that moves as a notification. PeraPlano listens to those notifications 24/7 via Android's `NotificationListenerService`, parses them on the device, and builds a complete, categorized ledger without the user typing anything. The user's only job is to set the rules that matter to them — Limits, Goals, Loans, Bills, Wallets — and the app enforces and reports against those rules continuously.

The end state we are building toward: a person opens PeraPlano once in the morning, sees a single trustworthy Safe-to-Spend number, and closes it. Everything behind that number — capture, categorization, deduplication, transfer detection — happened while they slept.

## 2. Core promise & positioning statement

> **You never log a transaction; you only set the rules.**

Every product decision is tested against this sentence. If a feature requires routine manual data entry, it is either automated, moved to a one-time setup step, or cut. The only intentionally manual inputs are:

- One-time or occasional **setup**: Wallets, Limits, Goals, Loans, Bills, income declaration.
- **Cash**, which produces no notifications — manual entry and cash reconciliation prompts exist as a deliberate, contained exception.
- **Review Queue** confirmations — one or two taps on the rare parse the app was not confident about, each of which becomes a UserRule so the same correction never has to be made twice.

Positioning in one line: *the money app for people who quit money apps.* PeraPlano is not a bookkeeping tool that rewards diligence; it is a passive tracker with an opinionated planning layer on top, built for how Filipinos actually get paid and actually pay.

## 3. Why the Philippines, and why now

- **E-wallet saturation.** GCash and Maya are default payment rails for tens of millions of Filipinos. QR payments, send-money, and buy-load are daily events — and every one of them emits a push notification that can be parsed.
- **Notification-rich banking.** PH banks (BPI, BDO, UnionBank, Metrobank, Landbank) and digital banks (SeaBank, GoTyme, CIMB, Maya) send push and/or SMS alerts for debits and credits. Even bank SMS surfaces as a notification from the default SMS app, which the listener can read without any SMS permission (see [03-ingest-pipeline.md](03-ingest-pipeline.md)).
- **A distinct pay rhythm.** Salaried workers are paid *kinsenas* — twice monthly, on the 15th and 30th (the 30th payday is also called *katapusan*, end of month). Global budgeting apps assume monthly cycles and never fit. PeraPlano treats kinsenas as a first-class income cadence.
- **A distinct debt culture.** Informal borrowing is everywhere: *utang* (personal debt owed to or by friends and family), *5-6* (informal lending at nominally 20% interest, "borrow 5, pay 6"), Home Credit installments, GLoan, credit cards. PeraPlano tracks Loans in both directions — money the user owes and money owed to them — because both shape what is actually safe to spend.
- **Remittance flows.** *Padala* (money sent to family, domestically or from abroad) is a routine, budgeted category of Filipino life, not an edge case. It is a default category, not something users must invent.
- **Android dominance.** The PH smartphone market is overwhelmingly Android, which is also the only platform where notification listening is possible. Android-only MVP is not a compromise; it is a fit (see Non-goals for iOS).

No global competitor is built around these six facts simultaneously. That is the wedge.

## 4. Target audience

Three primary personas. They overlap heavily in practice; the product must serve all three without mode switches.

### 4.1 The salaried kinsenas earner

Office or service worker paid on the 15th and 30th. Salary lands in a payroll bank account (often BPI or BDO), gets partly moved to GCash for daily spending, with rent, bills, and padala clustered right after payday. Their pain: the second week of each half-month, when money runs thin and they cannot say where it went. What PeraPlano gives them: income cadence detection tuned to kinsenas, percent-of-income Limits that reset on their real pay cycle, payday auto-allocation to Goals (Plus), and a Safe-to-Spend number that understands "days until the 15th."

### 4.2 The gig / informal-income worker

Driver, freelancer, online seller, service provider. Income is irregular in timing and amount, arriving through GCash, Maya, or bank transfers — sometimes several small payments a day. Their pain: no employer payroll summary exists; their notification history *is* their income record, and manual apps demand they re-type it. What PeraPlano gives them: automatic capture of every incoming payment, the `irregular` income cadence with manual override, in-vs-out reports that show whether a week actually netted positive, and Loan tracking for the informal credit that bridges slow weeks.

### 4.3 The e-wallet-heavy spender

Often young, often the family's designated "money person." Runs daily life through GCash/Maya: load, transport, food delivery, Shopee/Lazada/TikTok Shop, bills, padala to province. Frequently maintains balances across three or more apps and moves money between them constantly. Their pain: internal transfers make every app's history double-count; no single place shows the whole picture. What PeraPlano gives them: multi-Wallet modeling, automatic Transfer Link detection so a GCash-to-bank move never counts as spending, and recurring/subscription detection that surfaces the quiet "₱X/month locked in."

**Secondary audiences** (served, not designed-for in MVP): budget-conscious students, OFW-supported households managing received padala, and small informal lenders tracking who owes them (`owed-to-me` Loans).

## 5. How it works (product-level summary)

1. During onboarding, the app explains — before showing any system screen — why it needs Notification Access, then sends the user to grant it. Every permission is skippable; the app degrades to manual mode rather than blocking (see [04-features/01-onboarding.md](04-features/01-onboarding.md)).
2. The listener runs 24/7. Each notification from a known provider is parsed on-device into a structured Transaction: `amount`, `direction`, `merchant`, `walletId`, `categoryId`, `confidence`.
3. Duplicates (a push and an SMS announcing the same transaction) are suppressed. Opposite-direction pairs across Wallets are joined into a Transfer Link and excluded from spend and income totals.
4. High-confidence parses auto-commit to the ledger. Low-confidence parses land in the Review Queue for a one-tap confirmation; every correction becomes a UserRule that replays automatically on future notifications.
5. Committed transactions update Limits, Goals, Bills, and the Safe-to-Spend number in real time. The app notifies the user only when something they set a rule about happens — a Limit crossing 50%, 80%, or 100%, a Bill coming due, a Loan payment date approaching.

An illustrative example (this notification text is invented for illustration only — real provider formats are captured and versioned during implementation, per [03-ingest-pipeline.md](03-ingest-pipeline.md)):

> *Illustrative:* "You have sent ₱1,500.00 to JUAN D. via GCash." → Transaction: `amount` ₱1,500.00, `direction: out`, `merchant` "JUAN D.", Wallet "GCash", suggested category "Utang & Loan Payments" if a UserRule exists for that counterparty, `source: notification`.

Raw notification text never leaves the phone. It is stored encrypted on-device with a 30-day time-to-live so the user can always answer "why did the app record this?", then purged. Only committed transaction records sync — encrypted, and only if the user enables cloud backup (a Plus feature). This local-first stance is a product feature, not a technical footnote: it is the honest answer to the trust question every finance app must face (see [07-privacy-and-compliance.md](07-privacy-and-compliance.md)).

## 6. Competitive framing

| Alternative | What it demands | Where it fails the PH user | PeraPlano's answer |
|---|---|---|---|
| Manual expense apps (global trackers, envelope budgeters) | Type every transaction; sustain the habit forever | Abandonment within weeks; gaps destroy trust in totals; monthly-cycle assumptions ignore kinsenas | Zero routine entry; kinsenas-native cadence; gaps only where notifications genuinely don't exist (cash), with reconciliation prompts |
| Bank & e-wallet apps' own history | Nothing — but each shows only itself | No cross-Wallet picture; transfers between apps double-count; no Limits, Goals, or Loans; no cash | One ledger across all Wallets; Transfer Links; a planning layer on top |
| Spreadsheets | High discipline, high skill | Same abandonment curve, plus setup cost; nothing is automatic | The spreadsheet builds itself; the user only writes the rules |
| Aggregators built on bank-API integrations | Credentials or API consent | Thin and uneven PH institutional coverage; e-wallets and informal flows poorly covered; server-side data custody | Notification ingest covers every provider that notifies — banks, e-wallets, digital banks — with data staying on the phone |
| Doing nothing (the true market leader) | Nothing | Payday-to-payday anxiety; unknowable utang positions; "saan napunta ang pera ko?" | An install-to-first-tracked-transaction time under 5 minutes, then passive value forever |

The honest competitive summary: PeraPlano's moat is not any single feature. It is the ingest pipeline — a maintained, versioned corpus of PH provider parsers plus the Review Queue flywheel that converts every user correction into a UserRule and every unknown provider into future coverage. That corpus compounds; a copycat starts from zero.

## 7. Brand

- **Icon family:** Lucide, used consistently across the app. No custom icon work in MVP.
- **Primary mark:** `Send` — the paper airplane — for the app icon, splash screen, and empty states. The paper airplane carries the brand idea: money in motion, launched deliberately, light rather than bureaucratic. It also echoes the send-money gesture every e-wallet user performs daily.
- **Secondary marks:** `PlaneTakeoff` for Goals (savings taking off), `Navigation` for Safe-to-Spend (the heading you steer by).
- **Voice:** plain, direct, respectful of the reader's intelligence and their money stress. Filipino terms used naturally where they aid the PH reader (utang, padala, kinsenas), defined on first use in any surface where a newcomer might land. Numbers formatted as `₱1,234.56`; dates absolute ("on the 15th and 30th"), never vague.
- **What the brand never does:** shame the user for spending, gamify guilt, show ads, or sell data. The tone of every alert is "here is the fact, here is your rule, here is where you stand."

## 8. Monetization stance

Freemium: **Free = core tracking, Plus = depth.** The free tier must remain genuinely useful forever — automatic tracking is never limited, because retention is the engine and upsell rides on depth (more Wallets, unlimited Limits and Goals, full Loan amortization, longer history, projection, backup). All features are built and working in MVP; gating is defined now and enforced later through a single Entitlements layer (`tier: free | plus`, hardcoded to `plus` during MVP). Pricing in ₱ is intentionally not decided in this planning phase; [05-monetization.md](05-monetization.md) frames the options without fixing numbers.

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
| Cloud backup / multi-device sync (PLANNED, no code exists) | — | ✓ |
| Recurring/subscription detection | — | ✓ |
| Safe-to-Spend | Today only | Projected to end of period |

Gate behavior principle (applies everywhere): when a free user hits a cap, existing data is kept, creation of new items is blocked with an upgrade prompt, and nothing is ever deleted or hidden retroactively.

## 9. Non-goals

Things PeraPlano is deliberately not, either permanently or for MVP. Deferred items are expanded in [09-v2-backlog.md](09-v2-backlog.md); permanent exclusions are permanent.

**Permanent non-goals:**

1. **Not a bank or e-money issuer.** PeraPlano never holds, moves, or touches funds. It observes and plans.
2. **Not a financial advisor.** It reports facts against user-set rules; it does not recommend products, investments, or credit.
3. **No ads, no data selling, ever.** The business model is the Plus subscription. Monetizing attention or data would destroy the trust the product depends on.
4. **No SMS permission.** Google Play policy effectively prohibits `READ_SMS` for expense tracking, and the product does not need it — bank SMS is parsed via the default SMS app's notifications. The app never requests SMS permissions.
5. **Not a business bookkeeping tool.** No invoicing, VAT, payroll, or BIR compliance features. Gig workers are served as individuals managing personal cash flow.

**Deferred (v2 backlog — out of MVP, with reasons):**

6. **iOS** — the platform has no public API for reading other apps' notifications; an iOS version needs a designed, degraded manual-ingest path, not a port.
7. **Household sharing** — forces cloud identity and multi-user sync, conflicting with the local-first MVP architecture.
8. **Bank API / BSP Open Finance integration** — the ecosystem is immature; notification ingest already covers the providers PH users actually use.
9. **Receipt OCR, net worth tracking, debt payoff planner (snowball/avalanche), investments, web dashboard, widgets/Wear, multi-currency, AI insights** — each is depth on top of a ledger that must exist and be trusted first. The debt payoff planner will be Plus-gated when it ships.

## 10. What success looks like

Success for the MVP is defined quantitatively in [01-mvp-scope.md](01-mvp-scope.md) (parse accuracy, dedupe and transfer-link rates, time-to-first-transaction, battery, stability). Success for the product is qualitative and singular: **the user trusts the number.** When a user glances at Safe-to-Spend and acts on it without opening the ledger to double-check, PeraPlano has done its job. Every risk to that trust — parser rot, OEM background kills, dedupe errors, Play review — is tracked honestly in [08-risks-and-open-questions.md](08-risks-and-open-questions.md).

## 11. Related documents

- [01-mvp-scope.md](01-mvp-scope.md) — what is in and out of MVP, phase gates, success criteria
- [02-domain-model.md](02-domain-model.md) — entities, fields, invariants
- [03-ingest-pipeline.md](03-ingest-pipeline.md) — the notification-to-ledger pipeline and provider catalogue
- [05-monetization.md](05-monetization.md) — tier matrix rationale, gate behavior, pricing framing
- [06-information-architecture.md](06-information-architecture.md) — screen map and key flows
- [07-privacy-and-compliance.md](07-privacy-and-compliance.md) — RA 10173/NPC, Google Play policies, data lifecycle
- [08-risks-and-open-questions.md](08-risks-and-open-questions.md) — launch risks and mitigations
- [09-v2-backlog.md](09-v2-backlog.md) — deferred items and their prerequisites

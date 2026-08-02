# Monetization

This document defines how PeraPlano makes money: the freemium model, the exact Free vs Plus tier matrix, the behavioral rules that govern every gate (what happens when a free user hits a cap, and what happens on downgrade), the design of the single Entitlements flag layer that enforces gating, the moments in the product where Plus is naturally surfaced, and the framing — deliberately without fixed prices — for how Plus will eventually be priced. The governing principle throughout: **Free = core tracking, Plus = depth.** The free tier must stay genuinely useful on its own (retention first, upsell on depth), and no monetization mechanic may ever compromise the integrity of the user's ledger or their trust in the app.

**Status:** Draft v1 · 2026-08-02

---

## 1. Model summary

- **Freemium, single paid tier.** The paid tier is **PeraPlano Plus** (short: "Plus"). There is no ad-supported tier, no multi-tier ladder, and no consumable purchases.
- **All features are built and working in the MVP.** Gating is *defined now* but *enforced later*: the Entitlements layer (§4) reads `tier: free | plus` and is hardcoded to `plus` during MVP. Flipping enforcement on is a configuration change, not a feature build.
- **The moat is free.** Auto-tracking — the notification ingest pipeline — is unlimited in both tiers. A free user gets the full "you never log a transaction" promise. Plus sells depth: more of everything, longer history, projection, sync, and analysis.
- **What we will never monetize:** ads, selling or sharing user data, or holding the user's own data hostage. A lapsed Plus subscriber never loses data — only depth features (see §3).

Cross-references: tier rows appear per-feature in each feature doc's `## Free vs Plus` section (e.g., [04-features/03-limits.md](04-features/03-limits.md)); the trust stance is expanded in [07-privacy-and-compliance.md](07-privacy-and-compliance.md).

## 2. Tier matrix (canonical)

This matrix is the single source of truth for gating. Every document that mentions gating reproduces these rows exactly.

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

Notes:

- The debt payoff planner (snowball/avalanche) is a v2 feature and will be Plus-gated when it ships; it is listed here for continuity, not as an MVP gate (see [09-v2-backlog.md](09-v2-backlog.md)).
- "1 active" for Limits means the cap is on *active* Limits; a free user may hold additional inactive Limits (e.g., after a downgrade) and swap which one is active.
- "90 days" for History is a *visibility* window, not a retention window. Data older than 90 days is retained in full and becomes visible again on upgrade (see §3.3).

## 3. Gate behavior principles

### 3.1 The three universal rules

Every gate in the product obeys these rules, with no exceptions:

1. **Hit a cap → keep all data.** Nothing the user created is ever deleted, truncated, or corrupted by a gate.
2. **Hit a cap → block creation of new, never operation of existing.** A free user at the Wallet cap cannot add a fourth Wallet, but the three existing Wallets keep working fully — including continued ingest into them.
3. **Never delete on downgrade.** When Plus lapses, over-cap items are never removed: they keep their data and their core tracking, and only Plus-depth behavior (activation, schedule views, automation) suspends, per §3.3. Re-upgrading restores everything exactly as it was.

Two corollaries:

4. **The ingest pipeline is never tier-gated.** No Entitlements check exists anywhere in the notification → ledger pipeline (see [03-ingest-pipeline.md](03-ingest-pipeline.md)). Auto-tracking is unlimited in both tiers, and ledger integrity must never depend on subscription state.
5. **Safety information is never paywalled.** Limit threshold alerts (50/80/100%), bill reminders, and listener-health warnings fire identically for free and Plus users, for the objects those users have active. A gate may limit *how many* Limits or Bills a free user can have active — it never silences alerts on the ones they do have.

### 3.2 At-the-cap behavior (free user tries to exceed a cap)

| Capability | What the free user sees at the cap |
|---|---|
| Wallets (cap 3) | "Add Wallet" remains visible but opens the Plus gate sheet instead of the create form. Existing 3 Wallets are fully functional. Archiving a Wallet frees a slot (archive rules in [04-features/02-wallets.md](04-features/02-wallets.md)). |
| Limits (cap 1 active) | Creating a second Limit, or activating an inactive one while another is active, opens the gate sheet with a one-tap "swap active Limit" alternative so the free path is never a dead end. |
| Goals (cap 1) | "New Goal" opens the gate sheet. The existing Goal, its linked savings Wallet, and its progress remain fully functional. |
| Loans (cap 1) | "Add Loan" opens the gate sheet. The existing Loan tracks balance + next due; the full amortization schedule view shows a Plus preview (§5). |
| History (90 days) | Scrolling or filtering past 90 days shows a boundary row: older records exist, are safe, and unlock with Plus. No partial or teaser rows of the actual older data. |
| Reports | Basic monthly report is fully functional. Trends, custom ranges, and comparison views render as locked previews. |
| Export | Export entry point is visible in More; tapping it opens the gate sheet. (The privacy-mandated full data takeout in Settings is separate and never gated — see [04-features/11-settings-privacy.md](04-features/11-settings-privacy.md).) |
| Cloud backup / sync | Toggle visible in Settings, gated on enable. |
| Recurring/subscription detection | The "₱X/month locked in" surface shows a locked preview with the count of detected RecurringPatterns but not their details. |
| Safe-to-Spend | Today's number always works. The end-of-period projection curve area shows a locked preview. |

The "gate sheet" is a single, consistent bottom sheet: what Plus adds for this capability (the relevant matrix rows only), one primary "Get Plus" action, one dismiss action. It never interrupts a flow the user did not initiate.

### 3.3 Downgrade behavior (Plus lapses → free), defined per feature

| Capability | On downgrade |
|---|---|
| Wallets | All Wallets kept and fully functional, including ingest into all of them, even if more than 3. Creating *new* Wallets is blocked until the unarchived count is under 3. |
| Limits | All Limits kept. The most recently edited active unfiltered Limit stays active by default; all others become inactive (configuration retained, including filters). The user can swap which single Limit is active at any time. Filtered Limits (`categoryFilter`/`walletFilter` are Plus capabilities) can be viewed but not activated on Free; if every Limit is filtered, all become inactive and the user is prompted to create or unfilter one (see [04-features/03-limits.md](04-features/03-limits.md)). |
| Goals | All Goals kept and visible with live progress — progress is derived from the linked Wallet balance, so it keeps updating for every Goal. Payday auto-allocation stops entirely (it is a Plus capability): `contributionRule` settings are retained but no prompts fire and no planned contributions are created. Creating new Goals is blocked while over the cap. |
| Loans | All Loans kept and tracked: balances update, ledger payment-matching keeps running, and reminders fire for every existing Loan (matching protects data quality). Amortization schedule views collapse to the basic summary (balance + next due) for all Loans; schedule data is retained. Creating new Loans is blocked while over the cap. |
| History | Records older than 90 days become invisible in ledger, search, and Reports, but are fully retained and reappear on re-upgrade. They still participate in Wallet balance math (balances must never change because of a tier change). |
| Reports | Revert to basic monthly. Saved custom ranges are kept but locked. |
| Export | Gated again. Previously exported files on the user's device are untouched (they are the user's files). |
| Cloud backup / sync | Sync stops. Local data is intact and authoritative. Handling of the last server-side backup (retention window before deletion) is defined in [07-privacy-and-compliance.md](07-privacy-and-compliance.md). |
| Recurring/subscription detection | New detections stop surfacing. Already-acknowledged RecurringPatterns are kept but frozen (no amount/period updates). |
| Safe-to-Spend | Projection collapses to today-only. The today number is computed identically in both tiers. |

Downgrade rules:

1. Downgrade is a state change, not a data migration. No records are rewritten; only Entitlements-evaluated visibility and activation change.
2. Where the user must end up with "one active" of something (Limits are the only such case — Wallets, Goals, Loans, and Bills all keep operating), the default selection is deterministic (most recently edited, and for Limits also unfiltered) and always user-swappable afterward. No modal forces a choice at downgrade time.
3. A tier change (either direction) takes effect immediately and applies on next screen render; no restart required.

## 4. Entitlements flag design

**Entitlements** is a single, thin layer — the only place in the product that knows about tiers.

- **Shape:** `tier: free | plus` (per §3 of the domain model, [02-domain-model.md](02-domain-model.md)). No per-feature flags, no numeric quota table in v1 of the design: call sites ask questions like "may the user create another Wallet?" and the layer answers from `tier` plus current counts.
- **Evaluated at feature call-sites.** Each gated capability checks Entitlements at the moment of the gated action (create Wallet, activate Limit, render projection, enable sync, run export, expand history query). There is exactly one check per gate, at the boundary where the action starts — never scattered or duplicated deeper in.
- **Hardcoded `plus` in MVP.** Every gate exists and is exercised in code paths during MVP, but the layer always answers `plus`. This satisfies the MVP success criterion that every feature is callable behind the Entitlements layer with tier flags in place, and guarantees enforcement can be turned on later without touching feature code.
- **Local-first evaluation.** The tier value is stored on-device and evaluated offline. Purchase state (from the store billing flow) updates the stored tier when connectivity allows; the app never blocks a gated-but-already-entitled action on a network call.
- **Grace on billing lapse.** A short grace window (aligned with the store's own grace/retry semantics) keeps `tier: plus` while payment retries, so a card hiccup does not freeze a user's second Limit mid-month. After grace expires, downgrade behavior in §3.3 applies.
- **Where checks must NOT exist:** anywhere in the ingest pipeline, in alert delivery for active objects, in Wallet balance computation, in the privacy controls (view captured data, full takeout, wipe), or in Review Queue triage. These are tier-independent by design.

Call-site inventory (one row per matrix row, for traceability):

| Matrix row | Gate call-site |
|---|---|
| Auto-tracking (notification ingest) | None — never gated |
| Wallets | Wallet create action |
| Limits | Limit create and Limit activate actions |
| Goals | Goal create action; payday auto-allocate rule attach |
| Loans | Loan create action; amortization schedule render |
| History | Ledger/report/search query window resolution |
| Reports | Trends, custom-range, and comparison report render |
| Export | CSV export action |
| Cloud backup / multi-device sync | Sync enable toggle |
| Recurring/subscription detection | RecurringPattern surfacing (detail render) |
| Safe-to-Spend | End-of-period projection render |

## 5. Upgrade moments (where Plus surfaces naturally)

Plus is surfaced *contextually, at the moment of need*, and nowhere else. There are no launch interstitials, no timed nag dialogs, no notification-based upsell (the app's own notifications never carry marketing — see [06-information-architecture.md](06-information-architecture.md) §6), and no countdown or artificial-urgency mechanics.

| Screen | Moment | What is shown |
|---|---|---|
| Wallets | Tapping "Add Wallet" with 3 unarchived Wallets | Gate sheet: "Unlimited Wallets" row |
| Plan → Limits | Creating/activating a second Limit | Gate sheet: "Unlimited + per-category" row, with the free "swap active Limit" alternative |
| Plan → Goals | Creating a second Goal; toggling payday auto-allocate | Gate sheet: "Unlimited + payday auto-allocate" row |
| Plan → Loans | Adding a second Loan; opening the amortization schedule on any Loan | Gate sheet / inline locked preview: "full amortization schedule" |
| Transactions | Scrolling or filtering past the 90-day boundary | Boundary row: "your older history is safe — unlock with Plus" |
| More → Reports | Opening trends, custom range, or comparisons | Locked preview of the actual chart frame (no real data teased) |
| More → Export | Tapping CSV export | Gate sheet: "Export" row |
| More → Settings | Enabling cloud backup / adding a second device | Gate sheet: "Cloud backup / multi-device sync" row |
| Home | Expanding Safe-to-Spend to the period projection | Locked preview of the projection curve area |
| Home / More | "₱X/month locked in" recurring summary | Locked preview with detection count only |
| More | A single, static "PeraPlano Plus" entry point | The full matrix (§2), pricing, and manage-subscription actions |

Rules for upgrade surfaces:

1. Every gate sheet is dismissible in one tap and the user lands back exactly where they were.
2. A locked preview never renders the user's real gated data behind a blur or teaser; it renders an empty/sample frame clearly labeled as a preview.
3. The full-matrix Plus screen in More is the only place the user can be *asked* to compare tiers; everywhere else shows only the rows relevant to the moment.
4. Upgrade surfaces never appear during onboarding. Onboarding's job is trust and the first auto-tracked transaction, not conversion.

## 6. Pricing framing (options only — no fixed prices in this phase)

Pricing in pesos is intentionally **not decided** in this planning phase. This section frames the option space and the decision inputs so the decision can be made later with data.

### 6.1 Structures under consideration

| Option | Framing | Considerations for the PH market |
|---|---|---|
| Monthly subscription | Single low monthly price; the default reference point | Matches prepaid, small-recurring-amount habits; lowest commitment barrier; churn-sensitive |
| Annual subscription (discounted) | Meaningful discount vs 12× monthly | Better LTV and parser-maintenance funding runway; harder first sell at PH price sensitivity; natural moment: after a full salary cycle of demonstrated value |
| Lifetime (one-time) | Possible, not committed | Attractive to trust-sensitive users wary of subscriptions; risks underpricing a product with permanent per-provider parser maintenance costs; if offered, likely as a limited or launch-window option |

A limited free trial of Plus (or a launch-window "everyone is Plus" period, which the MVP's hardcoded `plus` tier makes trivially possible) is part of the option space and interacts with all three structures.

### 6.2 Decision inputs (to be gathered before pricing is fixed)

1. Willingness-to-pay signals from PH users in beta (survey + observed gate-sheet interactions once enforcement is on).
2. Comparable pricing of finance and utility subscriptions actually paid by the target audience in PH.
3. Billing mechanics available through Google Play billing in the Philippines (carrier billing and locally popular payment methods materially affect conversion; Play policy requires in-app digital subscriptions to go through Play's billing system).
4. Cadence alignment: whether billing anchored to kinsenas (the PH 15th/30th payday rhythm) measurably improves renewal rates.
5. Cost floor: server costs of cloud backup/sync plus ongoing parser-corpus maintenance define the minimum sustainable price.

### 6.3 Constraints already locked

1. Currency: PHP (₱) only in MVP.
2. One paid tier only; no feature is sold outside Plus.
3. No ads and no data monetization at any price point, ever.
4. Whatever the price, the free tier remains genuinely useful indefinitely (the §2 matrix is the promise; it is not tightened to force conversion).

The open pricing decision is tracked with framing in [08-risks-and-open-questions.md](08-risks-and-open-questions.md).

## 7. Measurement (product-level, privacy-respecting)

Once enforcement is on, monetization health is read from aggregate, content-free events only (consistent with the telemetry stance in [07-privacy-and-compliance.md](07-privacy-and-compliance.md)):

1. Gate-sheet impressions and dismissals per gate (which caps are actually hit — validates the matrix rows).
2. Conversion rate per upgrade moment (which contexts convert, so surfaces can be reduced, not multiplied).
3. Free-tier retention independent of conversion (the "retention first" check: if free retention drops after enforcement, the gates are wrong).
4. Downgrade → re-upgrade rate (validates that §3.3 keeps lapsed users whole and willing to return).

No event ever includes transaction content, amounts, merchant names, or notification text.

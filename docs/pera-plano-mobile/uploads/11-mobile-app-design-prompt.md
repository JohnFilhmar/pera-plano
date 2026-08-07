# Claude Design Handoff Prompt — PeraPlano Mobile App UI (all features)

**Status:** Ready to use · 2026-08-02

Paste everything inside the fence below into Claude design as-is. It covers the full
mobile app UI for every planned feature — including the two gating visual states used
during phased implementation: **Soon** (feature not yet shipped, greyed out) and
**Plus** (shipped but paid-tier gated).

```text
Design the complete mobile app UI for PeraPlano — an Android personal-finance app made
in the Philippines that tracks money automatically by listening to bank and e-wallet
notifications (GCash, Maya, BPI, BDO, and more). The user never logs a transaction;
they only set rules (limits, goals, loans, bills). Deliver high-fidelity phone-frame
mockups for every screen listed below, plus a reusable component sheet, in BOTH light
and dark mode.

DESIGN LANGUAGE:
- Colors (exact tokens, each with the dark-mode value beside it):
  brand green #15803D (dark #22C55E) · soft mint #DCFCE7 (dark #14261C) ·
  background #F7FAF7 (dark #0B1210) · surface/cards #FFFFFF (dark #111A16) ·
  text #10201A (dark #E8F0EC) · secondary text #5B6E64 (dark #9BB0A6) ·
  danger #DC2626 (dark #F87171) · warning #D97706 (dark #FBBF24) ·
  Philippine flag accents used SPARINGLY (tiny badges/details only):
  blue #0038A8, red #CE1126, yellow #FCD116. Green leads everywhere.
- Typography: Inter. Big, highly legible numbers for money. Peso always ₱1,234.56.
- Icons: Lucide set. Brand mark = the "Send" paper airplane.
- Feel: calm, trustworthy, roomy cards with soft corners, Android conventions
  (bottom tab bar, system back, sheets for pickers). Friendly, plain-English copy.

TWO GATING STATES (component-level, reused across the whole app):
1. "SOON" state — feature designed but not yet shipped in the current release phase.
   Whole card/row/screen-entry rendered desaturated grey, non-interactive, with a small
   neutral-grey "Soon" chip. Content still readable so users see the roadmap. Show a
   Soon variant for at least: a Plan-tab section, a More-tab row, and a full screen
   placeholder ("This is coming in an update — your tracking already works").
2. "PLUS" state — feature shipped but requires the paid tier. Normal colors, small
   brand-green "Plus" badge with a lock glyph; tapping opens a bottom sheet showing the
   Free vs Plus comparison and an upgrade button. Design that sheet too.
   The two states must be instantly distinguishable: Soon = grey/dormant, Plus =
   green/inviting.

NAVIGATION: 5 bottom tabs: Home · Transactions · Wallets · Plan · More.

SCREENS TO DESIGN:

ONBOARDING (each step skippable — skipping degrades to manual mode, never blocks):
 1. Welcome: animated paper-airplane logo, one-line pitch, "Get started".
 2. How it works (3 cards): grant access → set your rules → tracked 24/7.
 3. Notification-access explainer: friendly WHY before the scary system screen
    ("PeraPlano reads bank/e-wallet notifications on your phone. Raw text never
    leaves it."), button to the system grant screen, "skip for now".
 4. Battery exemption ask (so tracking survives in the background) + OEM hint.
 5. Provider picker: checklist of PH banks/e-wallets with logos-as-initials chips
    (GCash, Maya, BPI, BDO, UnionBank, Metrobank, SeaBank, GoTyme, CIMB, Landbank,
    ShopeePay, GrabPay, Bank SMS).
 6. Wallet setup: create first wallets from picked providers + a cash wallet.
 7. Income declaration: cadence choice (15th & 30th "kinsenas", weekly, monthly,
    irregular) + amount, "auto-detect later" option.
 8. First limit: simple monthly amount or % of income, with a live preview sentence
    ("₱10,000 every month ≈ ₱333/day").
 9. Done: confetti-light, straight into Home.

HOME TAB:
 - Hero: one huge number — "Safe to spend today: ₱487" — with four states: healthy
   (green), tight (amber), over ("₱312 over" red), and no-limit-set (prompt to create).
 - Plus variant: small projection sparkline to end of period (mark with Plus badge).
 - Below: active limit progress bars with 50/80/100% threshold colors, upcoming bills
   strip, recent alerts feed, "tracking interrupted" recovery banner variant, and a
   "tracking paused" pill variant.

TRANSACTIONS TAB:
 - Ledger: day-grouped list; each row = merchant/counterparty, category chip, wallet,
   signed amount (green in / dark out); transfer rows shown linked with a paper-plane
   ↔ glyph and excluded-from-spend styling. Filter bar (wallet, category, date,
   direction) + search. Review Queue badge on the tab icon.
 - Review Queue: triage cards — parsed guess with confidence, one-tap Confirm, or
   Correct (category/wallet/amount pickers); special cards for "possible transfer —
   link these two?", "possible duplicate — merge?", and "unknown app — is this a money
   notification?". Show the empty "all caught up" state.
 - Transaction detail: fields, category edit, note, "Why was this recorded?" section
   showing the captured notification text with a 30-day expiry countdown, transfer
   link/unlink actions.
 - Manual entry form (for cash): amount-first numpad, direction toggle, wallet,
   category, date.

WALLETS TAB:
 - Wallet cards grid/list: name, type icon (bank/e-wallet/cash/credit/savings),
   balance; reported-vs-computed mismatch indicator. Total row.
 - Wallet detail: balance header, its transactions, matcher chips ("Catches: GCash").
 - Create/edit: type picker, provider matcher binding (incl. one provider split into
   two wallets, e.g. GCash main vs GSave), archive flow.
 - Cash reconciliation sheet: "How much is in your physical wallet right now?" →
   difference recorded as an adjustment.
 - Free-tier cap state: 4th wallet creation blocked with the Plus sheet (3 max free).

PLAN TAB (four sections; any unshipped section uses the SOON treatment):
 - Limits: list with progress bars + period labels; create/edit (scope daily/weekly/
   monthly/annual, fixed ₱ vs % of income, category/wallet filter, rollover toggle
   with plain-language explainer); breach detail screen (what tripped it).
 - Goals: goal cards — name, progress ring to target, pace indicator (ahead/on
   track/behind vs target date); create/edit linked to a savings wallet; payday
   auto-allocate prompt sheet ("Payday detected: move ₱2,000 to Emergency Fund?") —
   Plus badge.
 - Loans: two lists — "I owe" and "Owed to me"; loan cards with balance, next due
   chip; loan detail with payment history and amortization schedule table (Plus badge
   on the schedule); "we found a payment" match-confirmation sheet; add-loan form
   supporting formal (amount/rate/term) and informal utang/5-6 (flat or free-form).
 - Bills: upcoming list with due chips (due in 3d / today / overdue red); bill detail
   with payment history and estimated-amount note; create/edit with due-rule picker
   (every Nth, 15th & 30th, last day, weekday adjust) and reminder offsets.

MORE TAB (list screen linking to):
 - Reports: monthly summary (spend total, in vs out), category breakdown donut +
   ranked bars, trend line across months; custom date range + CSV export marked Plus;
   free tier sees current month only.
 - Subscriptions (Plus): detected recurring spends list — "₱1,548/month locked in"
   header, per-item cards, "promote to Bill" action.
 - Settings: theme (auto/light/dark), notification preferences, telemetry opt-out.
 - Privacy center: pause listening (master switch + per-provider switches),
   "What PeraPlano captured" transparency list with expiry countdowns, export all my
   data, wipe everything (double-confirm destructive flow, red).
 - Listener health: status card (access granted? service connected? last capture),
   OEM-specific battery guidance, re-grant walkthrough.
 - Parser diagnostics: per-provider parse success meters.
 - About + tier screen: Free vs Plus full comparison table and upgrade CTA
   (placeholder pricing ₱XX/month, ₱XXX/year marked as examples).

SYSTEM/OVERLAY:
 - The app's own Android notifications: limit alert at 50/80/100% (three intensities),
   bill reminder, payday summary, "tracking interrupted" — design the notification
   card content for each.
 - Empty states for all five tabs (friendly paper-airplane illustrations).
 - Generic error/loading states, and the Plus upgrade bottom sheet (shared).

DELIVERABLES:
 - Phone-frame mockups of every screen above in light AND dark mode.
 - A component sheet: buttons, cards, chips (category, Soon, Plus, due), progress
   bars/rings, amount displays, list rows, sheets, numpad, banners, badges, tab bar.
 - The design must read as one system: same spacing scale, same radii, same green.
```

## Notes for after the handoff

- **Screen inventory source:** matches `docs/06-information-architecture.md` and the
  eleven feature specs in `docs/04-features/` — if a design question comes up, those
  docs hold the behavioral answer.
- **Soon vs Plus is deliberate:** Soon = not yet implemented (rollout phases M1→M2→M3,
  see `01-mvp-scope.md`); Plus = implemented but gated (`05-monetization.md`). During
  implementation the app renders Soon states from a static per-build shipped-features
  map, so each release phase just flips entries — I will wire that during execution.
- **Palette sync:** hex tokens identical to `constants/colors.ts` in the interface
  contract (`docs/superpowers/plans/2026-08-02-00-interface-contract.md` §2) and to the
  marketing-site prompt (`10-web-design-prompt.md`). Change greens in one place → update
  all three.
- **Logo reuse:** the animated/layered SVG assets from the doc-10 handoff are the same
  brand marks used here (onboarding welcome, empty states).

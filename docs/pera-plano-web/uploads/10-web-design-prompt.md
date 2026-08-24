# Claude Design Handoff Prompt — PeraPlano Marketing Site + Animated Logo

**Status:** Ready to use · 2026-08-02

Paste everything inside the fence below into Claude design as-is. It covers the three
marketing pages (landing, about, pricing) and the animated SVG logo deliverables for both
web and mobile use.

```text
Build a marketing website for PeraPlano — an Android personal-finance app made in the
Philippines that automatically tracks your money by listening to bank and e-wallet
notifications (GCash, Maya, BPI, BDO, and more). Tagline: "You never log a transaction;
you only set the rules."

PAGES (3):

1. LANDING / HOME
   - Hero: animated paper-airplane logo, app name, tagline, "Get it on Google Play"
     badge (placeholder link #), phone mockup frame showing a home screen with one big
     "Safe-to-Spend today: ₱487" number.
   - How it works, 3 steps: (1) Grant notification access → (2) Set your limits, goals,
     and loans → (3) PeraPlano tracks every peso 24/7, automatically.
   - Feature highlights grid: Automatic tracking (no manual entry, ever) · Wallets
     (bank, e-wallet, cash) · Spending limits (fixed ₱ or % of income) · Savings goals ·
     Loan & utang tracking (both directions) · Bill reminders · Safe-to-Spend ·
     Smart transfer detection (moving your own money never counts as spending).
   - Privacy promise section (prominent): "Local-first. Raw notifications are parsed on
     your phone and never leave it. No ads. Your data is never sold."
   - Short FAQ (5-6 items: battery use, which banks/apps are supported, is it safe,
     iOS availability "coming later", is it free).
   - Footer: links to all pages, "Proudly made in the Philippines 🇵🇭" mark.

2. ABOUT US — fill entirely with clearly-marked EXAMPLE placeholder content I will
   replace later: company story, mission ("financial clarity for every Filipino"),
   values, team section (3-4 placeholder people with initials avatars, no stock
   photos), contact section.

3. PRICING — two-column Free vs PeraPlano Plus comparison, using EXACTLY this matrix:
   | Capability | Free | Plus |
   | Auto-tracking (notification ingest) | Unlimited | Unlimited |
   | Wallets | 3 | Unlimited |
   | Spending limits | 1 active | Unlimited + per-category |
   | Savings goals | 1 | Unlimited + payday auto-allocate |
   | Loans | 1, basic tracking | Unlimited + full amortization schedule |
   | History | 90 days | Unlimited |
   | Reports | Basic monthly | Full + trends + custom range |
   | Export | — | CSV |
   | Cloud backup / multi-device sync | — | Included |
   | Subscription detection | — | Included |
   | Safe-to-Spend | Today only | Projected to end of period |
   Placeholder prices marked as examples: ₱XX/month, ₱XXX/year (save 2 months),
   emphasize "Free forever tier — Plus adds depth, not the basics." Billing FAQ.

BRAND & THEME:
- Logo: paper airplane derived from the Lucide "Send" icon geometry. Create an
  ANIMATED SVG LOGO: paper airplane with a gentle looping float/flight animation and a
  dotted flight-path trail behind it. Requirements: self-contained SVG (CSS or SMIL
  animation inside the file, no JavaScript), degrades gracefully to a good-looking
  static mark when animation is unsupported, works at 24px up to 512px. Also provide:
  a static SVG variant, and a version with cleanly separated layers/groups (airplane
  body, trail, background) with stable ids so a mobile app can animate the parts
  natively. Plus a favicon-sized simplified mark.
- Colors: green-led palette (money, growth) — deep green primary #15803D, soft mint
  surfaces #DCFCE7, dark-mode variant of every token. Subtle hints of the Philippine
  flag as accents only: blue #0038A8, red #CE1126, yellow #FCD116 — used sparingly
  (small badges, the "made in PH" mark, tiny details). NOT a flag-colored site; green
  leads.
- Typography: highly legible friendly sans-serif (e.g. Inter or Manrope), generous
  sizes, strong contrast, comfortable line height. Peso amounts always ₱1,234.56.
- Tone: trustworthy, warm, plain English readable by everyday Filipino users.
- Audience: PH salaried workers paid on the 15th/30th, gig workers, heavy e-wallet users.
- Android-only today: single Google Play badge; small "iOS coming soon" note.
- Fully responsive, light + dark mode.
```

## Notes for after the handoff

- **Asset drop-off:** put the delivered SVGs in `mobile/assets/brand/` (mobile) and the
  web project's asset folder. The layered static variant (stable ids: `airplane_body`,
  `trail`, `background`) is the one the mobile app animates with Reanimated —
  `react-native-svg` does not play SMIL/CSS animations, which is why the prompt demands
  both variants.
- **Palette sync:** the hex values above match `constants/colors.ts` in the mobile
  interface contract (`docs/superpowers/plans/2026-08-02-00-interface-contract.md` §2).
  If the design round changes the greens, update both places together.
- **Pricing page:** prices are placeholders by design — real pricing is an open decision
  (see `08-risks-and-open-questions.md`); the tier matrix itself is locked
  (`05-monetization.md`).

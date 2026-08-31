# Front-facing web revamp — design

> Owner-approved 2026-08-31. The first design pass over `server/apps/web` since the pages
> were written as documents.
> Reads with `docs/14-design-revamp-prompt.md` (§4 web, §6 motion assets, §7 tokens), which
> stays authoritative on tokens and on the SMIL/Reanimated split.

## 1. The problem

`/` is eight stacked prose sections, roughly 1,170 words, no imagery and no motion beyond a
4.2s float on the 24px header mark. It reads as a document, not as the front door of a
product whose entire premise is that something happens without you typing.

Meanwhile every animated brand asset is unreferenced. Grepping `server/apps/web` for
`bg-planes`, `idle-loop`, `launch`, `layered` and `nav-` returns nothing: the 1600x900
seven-plane hero, the idle loop, the one-shot launch, the layered file with web-addressable
ids, and the whole eight-direction `nav/*` set all sit in the repo doing nothing.
`docs/14` §4 says the web "is the one place the full SMIL animation set can run natively".
None of it does.

## 2. Decisions taken

Four, chosen by the owner on 2026-08-31:

- **Direction: route-map skeleton plus capture-demo hero.** The privacy argument becomes one
  section rather than the page's whole identity. Privacy is the floor here, not the
  differentiator; automatic capture and the Philippine pay rhythm are.
- **Motion tier T2.** An IntersectionObserver and CSS floor, a small motion library for the
  hero's orchestrated beats, and one lazy WebGL field behind the hero. No three.js.
- **Scope: `/` rebuilt, the other five pages get a shared document shell.**
- **Copy: progressive disclosure.** Visible copy drops to roughly 350 words; today's prose
  moves into per-section disclosures rather than being deleted.

## 3. Tokens

Additions only. Every existing token keeps its value. Per `docs/14` §7 each is stated in
both dialects and must be added to `mobile/constants/colors.ts` and
`mobile/tailwind.config.ts` when the mobile side next moves; nothing on the phone consumes
them today.

| Token | Value (both themes) | Purpose | Contrast |
|---|---|---|---|
| `--ink` / `ink` | `#06120E` | ground of the hero band and the capture demo | `#E8F0EC` on it, 15.9:1 |
| `--ink-2` / `ink-2` | `#0E1F18` | card surfaces inside the hero band | `#E8F0EC` on it, 13.6:1 |
| `--trail` / `trail` | `rgba(34, 197, 94, 0.55)` | the route stroke | decorative, not text |

`--ink` is deliberately theme-invariant. The hero is a lit band in both themes and the
document pages below it stay light in light mode. That is the fintech convention of a dark
hero over a light body, and it keeps the compliance pages readable in whichever mode a
reviewer uses.

`--trail` replaces a one-off in `components/content/brand_mark.tsx`, which currently draws
the trail as `--brand-2` plus a literal `opacity="0.55"`.

`--ph-yellow` already exists and has no consumer on web. It gets exactly one job: the
low-confidence beat of the capture demo, matching the review queue on the phone. No other
flag colour appears on the page.

## 4. Type

- **Body, UI and numerals: Manrope**, unchanged, already self-hosted through `next/font`.
  Ledger figures use `font-variant-numeric: tabular-nums` rather than a third typeface.
- **Display: Bricolage Grotesque**, variable, self-hosted, used only for `h1` and waypoint
  `h2`. It reads warm and slightly optically irregular rather than like a security vendor,
  and it is not the serif-on-cream or Space-Grotesk default that generated landing pages
  converge on. Reversible in `app/layout.tsx` alone.

Scale: `h1` at `clamp(2.4rem, 6.5vw, 4.2rem)`, `h2` at `clamp(1.55rem, 3.4vw, 2.3rem)`,
tight tracking, `text-wrap: balance` already global.

## 5. Structure

A dark hero band, then a single route trail down the page with each section hung off it as a
waypoint.

```
[ --ink band, full bleed ]
  h1   You never log a transaction; you only set the rules.
  lede one line
  THE CAPTURE DEMO               <- signature, one <figure data-illustrative>
  [GCash] [Maya] [BPI] [unsure]     replay chips
  WebGL route field behind, lazy, reduced-motion aware

|  the trail: one SVG path, drawn on scroll
o  01  How it works                five beats, one line each
o  02  Who it is for               three cards, pain and gain
o  03  Why the Philippines         six stat chips
o  04  Nothing leaves your phone   boundary diagram
o  05  What it is not, and the unfilled compliance roles
'- tiers pointer, built alongside
```

Each waypoint is an eyebrow (waypoint number and name), an `h2`, one line, evidence
(chips, cards or beats), then a `<details>` holding today's long-form prose verbatim.

The `nav/*` eight-direction set is **used, not cut**: each waypoint marker points in the
trail's actual direction of travel at that node, and the document pages reuse the set as a
previous/next pager. That answers `docs/14` §6.3's open question.

Asset consumers, so nothing in `public/brand` is orphaned again:

| Asset | Consumer |
|---|---|
| `peraplano-bg-planes.svg` | hero field fallback when WebGL or motion is unavailable |
| `peraplano-launch.svg` | fires once when the demo commits a transaction |
| `peraplano-idle-loop.svg` | the demo's parsing state |
| `peraplano-idle-logo.svg` | the boundary diagram's resting mark |
| `peraplano-logo-layered.svg` | hero band mark; the web can address its ids directly |
| `nav/*` | waypoint markers and the document pager |

## 6. The signature: the capture demo

The product's premise, animated, because `docs/14` §6.3 names it as the thing to sell:
"A capture moment. The product's whole premise is a notification arriving and becoming a
transaction without being typed. Nothing animates that today."

Beats:

1. A notification card arrives, carrying the illustrative disclaimer.
2. It separates into labelled fields: amount, direction, merchant, wallet, category,
   confidence.
3. The fields settle into a ledger row.
4. Safe-to-Spend ticks down in tabular figures.
5. The `unsure` chip routes the card into a review-queue slot in `--ph-yellow` with a
   one-tap confirmation, so the honest path shows alongside the happy one.

Replayable by chip, looping with a long pause, and frozen to its final frame under
`prefers-reduced-motion` — a complete and readable state rather than a blank one.

Its keyframe values are written as a plain table in the component so they can be transcribed
into a `*_motion.ts` file for the phone under the §6.2 rule, if the mobile app wants the
same moment.

## 7. Motion budget

- **Floor.** IntersectionObserver reveals and `prefers-reduced-motion` honoured everywhere.
  Every animated element has a defined static state.
- **Scroll.** CSS scroll-driven animations where supported, falling back to the reveal
  floor. Support is verified against caniuse at implementation time, not from memory.
- **Orchestration.** `motion` (motion.dev), imported through `LazyMotion` and the `m`
  namespace so the shipped bundle is the mini build.
- **WebGL.** One `ogl` scene behind the hero: slow-drifting route arcs in `--brand` and
  `--trail` over `--ink`, parallaxed by pointer. Lazy, client-only, never blocking LCP, and
  it fails soft to `peraplano-bg-planes.svg` over a token gradient.

## 8. Copy

Visible copy on `/` drops from roughly 1,170 words to roughly 350. Nothing is deleted: each
waypoint's long form moves into a `<details>` disclosure, which still renders into the
server HTML, so a Play reviewer and the existing vitest assertions both still find it.

The glossary stops being a list. `kinsenas`, `utang` and `padala` are defined inline at
first use, satisfying the brief §7 voice rule without a terminology appendix.

## 9. The other five pages

One shared `DocumentShell`: sticky in-page contents on desktop, a refined prose scale, quiet
reveals, and the `nav/*` pager. `/installed-apps` and `/data-deletion` gain a short "why this
page exists" callout so the two Play-required surfaces read as deliberate rather than as
leftovers, which `docs/14` §2.1 asks for by name. Legal clause bodies get no motion.

## 10. Constraints this must not break

`server/apps/web/__tests__/marketing.test.tsx` is a content contract, and the revamp keeps
all of it:

- exactly one `<h1>`, carrying the tagline verbatim;
- **every peso figure on the page lives inside the single `<figure data-illustrative>`.**
  The test strips one non-greedy figure match and then bans currency digits everywhere else,
  so a second figure containing an amount fails the no-price rule;
- no `href="#"` anywhere, so the scroll cue targets a real anchor;
- `kinsenas`, `gig`, `e-wallet`, `utang`, `padala`, and a `kinsenas ... 15th and 30th`
  sentence with no full stop between them;
- the `data-unfilled-roles` block rendered from the shared component, byte-identical to
  `/support`;
- `href="/en/terms"`, `href="/en/privacy"`, a `mailto:` to the support address, and the owner
  link from `OWNER_SITE_URL` rather than a catalog literal.

Plus the standing product constraints: no account, no login, no sync, no price, no Play
badge, no testimonials.

## 11. New guard

`__tests__/motion_assets.test.ts`: every file under `public/brand` must be referenced by some
component or stylesheet. Unused animated assets become a CI failure rather than something
noticed two years later.

## 12. Files

New: `components/marketing/` (hero band, capture demo, route spine, waypoint, persona cards,
stat chips, boundary diagram, hero field, reveal, disclosure, nav glyph) and
`components/chrome/document_shell.tsx`.
Rewritten: `components/pages/marketing_page.tsx` and its stylesheet.
Edited: `app/globals.css`, `app/layout.tsx`, `messages/en.json`, `apps/web/package.json`.
Tests: `marketing.test.tsx` extended, `motion_assets.test.ts` added.

## 13. Explicitly cut

Testimonials (no users), a pricing grid (`docs/14` forbids one while tiers are unsettled), a
Play badge (no listing), any account, profile or sync affordance, and three.js.

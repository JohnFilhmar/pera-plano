# PeraPlano — UI/UX revamp brief for Claude Design

> Verified against the codebase on 2026-08-22 (branch `feat/mvp-implementation`, HEAD `ac99667`).
> Where this brief and `docs/10-web-design-prompt.md` / `docs/11-mobile-app-design-prompt.md`
> disagree, **this brief wins** — those two describe intent from before anything was built.

---

## 0. What I want back — TWO SEPARATE DELIVERABLES

Please keep these apart. Do not fold the asset work into the screen work.

**Deliverable A — UI/UX revamp.** A revamped visual and interaction direction covering the
mobile app's five tabs, its lock / onboarding / privacy surfaces, the front-facing web pages,
and the future AI surface. Key screens as artboards. For each surface, state what changed
against the original docs and why. Call out anything in the current build you think we should
**cut rather than restyle**.

**Deliverable B — motion asset system.** A named set of animated SVG / moving icons that the
revamp depends on: what exists today, what to redraw, and what is new. This is a separate
inventory with its own artboards and its own spec sheet, because it has a hard technical
split described in §6 — the same animation cannot ship as one file to both platforms.

Both deliverables must state token changes **explicitly** (§7), never one-off values.

### 0.1 About the files attached to this message

Attached are four `.dc.html` canvases and the paper-plane brand images. **The canvases are the
pre-build design intent, not the app.** Read them for brand feel and typography only. Where any
of them contradicts §2 of this brief, §2 is the truth:

| Attached | Status | How to treat it |
|---|---|---|
| `Landing.dc.html` | superseded | The real site is six pages (§2.1), not one landing page. |
| `About.dc.html` | **no such page exists** | There is no About route. Either fold it into `/` or propose it as a new page and say so. |
| `Pricing.dc.html` | **no such page exists, and the model is not settled** | There is no pricing page. Everyone currently runs as Plus (§2.1) and the AI tier is explicitly free (§5). Do not design a price grid as if the tiers were decided. |
| `PeraPlano Mobile UI.dc.html` | partially superseded | Predates the lock layer, the review queue, the Privacy centre, the Plan hub's five features, and the five-tab bar as shipped. |

**The plane images attached are static renders.** The real assets are SMIL-animated SVGs; a PNG
cannot show you the motion. §6.1 lists every source file by name with what it does, and §6.2 is
the rule every new asset must follow. Ask for any SVG source you want pasted in full.

**Design system is set to "None" in this composer on purpose** — the tokens are not in a package
you can import. They are the two hand-aligned definitions in §7, and the real values are listed
there. Use those, not a fresh palette.

---

## 1. What PeraPlano is

Offline-first Philippine personal-finance app. Android-first (Expo SDK 54, React Native 0.81.5,
NativeWind 4, Expo Router 6). Everything lives on the device: op-sqlite + SQLCipher, device-lock
plus a 12-word recovery phrase, **no account, no server sync, no login anywhere**. Money is
tracked by reading bank and e-wallet **notifications** through an Android notification listener —
the user does not type most transactions. Currency is PHP (integer centavos internally, always
formatted through one function). Dark mode is the default we test on. One person builds this.

---

## 2. What is BUILT and working today

Verified by reading the routes and modules, not by memory.

1. **Lock & key layer** — `app/lock.tsx` plus `components/lock/`: device-lock gate, 12-word
   recovery-phrase capture, recovery unlock, and a "wipe and start over" break-glass path.
   Every cold start passes the lock screen before any app chrome renders.
2. **Onboarding** — `app/(onboarding)/`, twelve routes, numbered and fully skippable:
   `index → welcome → how_it_works → access → battery → device_lock → recovery_phrase →
   providers → wallets → income → first_limit → done`. The provider picker and wallet setup
   are driven by packages the listener has **actually observed on the device**.
3. **Wallets** — types bank / e-wallet / savings / credit, grouped by type, archived group last,
   a total row that deliberately **excludes credit balances**, and a balance-drift badge
   (reported vs computed) with a remotely-tunable tolerance.
4. **Transactions** — capture, review queue (`app/review/`) for low-confidence parses, manual
   entry, transaction detail, transfer linking between two wallets.
5. **Plan hub** — limits, goals, loans (with adjustments), bills (with cycles), recurring
   patterns, income profile with multiple sources. Each has list / new / detail / edit routes.
6. **Reports** — lives at `(tabs)/more/reports`, **not** a top-level tab.
7. **More hub** — Privacy centre, listener health, parser diagnostics, settings, subscriptions.
8. **Provider catalogue** — GCash, Maya, BPI, BDO, UnionBank, Metrobank, SeaBank, GoTyme, CIMB,
   Landbank, ShopeePay, GrabPay, plus bank SMS relay. Package names are **learned from the
   device**, never trusted from a seed list.
9. **Monetization scaffolding** — `lib/entitlements.ts` is the only file that knows about tiers.
   `components/gates/` ships `plus_gate.tsx`, `soon_gate.tsx`, `upgrade_sheet.tsx` with a
   Free-vs-Plus comparison table already wired.
10. **Front-facing web** — Next.js 16 / React 19, `server/apps/web`.
11. **Brand assets** — `assets/brand/` already holds the paper-airplane set (see §6).

### 2.1 Corrections to the earlier draft of this brief

These were wrong or imprecise and the design must use the corrected version:

- **The five tabs are Home, Transactions, Wallets, Plan, More.** Reports is a More row.
  The Transactions tab carries the review-queue count badge (and only that tab).
- **The web page list is six pages, not four**: `/` (home/marketing), `/support`, `/terms`,
  `/privacy`, `/data-deletion`, `/installed-apps` — all under a `[locale]` segment, plus
  `robots.ts`, `sitemap.ts` and an `/api/health` route. Terms carries clauses marked DRAFT and
  a "counsel required" notice; home and support carry an "unfilled compliance roles" notice.
  **`/data-deletion` and `/installed-apps` exist because Google Play requires them** — they are
  compliance surfaces, and they need to look deliberate rather than like leftovers.
- **Everyone currently runs as Plus.** `MVP_TIER = "plus"`; the free caps are written and tested
  (3 wallets, 1 active limit, 1 goal, 1 loan, 90-day *visibility* window) but enforcement is a
  one-constant flip. So the free → Plus upgrade moment is designed **ahead of** ever being seen.
  Caps never delete data and a downgrade never breaks an existing record — the upgrade surface
  must not imply otherwise.
- **Empty states are mostly present, not mostly missing.** `components/ui/empty_states.tsx`
  holds `EMPTY_STATE_CATALOGUE` and a test asserts every catalogued screen has distinct copy.
  The real problem is **quality and hierarchy, not absence**: several states are text-only with a
  weak or off-screen action, and the "deleted / not found" detail states are a different species
  that were deliberately left out of the catalogue. Design both species.
- **The AI feature is on-device and planned as FREE, not a paid tier.** See §5 — the earlier
  framing ("AI is a paid capability", "make it clear when data leaves the device") contradicts
  the actual spec. Nothing leaves the device, ever.

---

## 3. Surfaces the original design docs do not cover — design these

- **The whole lock / recovery-phrase / factory-reset surface.** Functional, visually
  unconsidered, and it is the first thing every user sees on every cold start.
- **The Privacy centre.** Our trust centrepiece; today it reads as a settings dump — a long
  per-provider toggle list, a "what PeraPlano captured" feed with 30-day retention, an export
  button and a two-step destructive erase, all at equal visual weight.
- **The review queue.** The recurring daily interaction. Must feel like a fast triage inbox
  under one thumb, not a form.
- **Balance drift, listener health, parser diagnostics.** How do we say "the app may have missed
  something" without frightening someone about their money? Three screens, one honesty language.
- **Empty states and dead-end states across every tab**, per the correction above. Every one
  carries its own next action, on screen, reachable by thumb.
- **Onboarding when the device tells us nothing.** The wallet-setup step must degrade gracefully
  when no recognised bank app has been observed — this is the common case on a fresh install.
- **The onboarding art slots.** `components/ui/image_placeholder.tsx` renders numbered
  placeholder frames, and `value_carousel.tsx` drives a four-panel swipe on `how_it_works`:
  **"The tap" → "The notification" → "Already logged" → "What's left"**. Those four panels are
  currently grey boxes with a caption. They are the single best home for Deliverable B's motion.
- **The free → Plus upgrade moment**, given it is unreachable today.

---

## 4. Front-facing web

Six pages (§2.1), server-rendered, CSS Modules over CSS custom properties in
`app/globals.css`, Manrope as the type face, an explicit light/dark/`data-theme` token set, and
a `theme_toggle`. It is a compliance and marketing site — no app functionality, no login.
It must not imply an account exists.

The web is the one place the full SMIL animation set can run natively, including the 1600×900
seven-plane hero background that the phone deliberately does not ship.

---

## 5. What is coming: the AI assistant — read this carefully

Planned and specced (`docs/superpowers/plans/2026-08-20-on-device-ai-assistant.md`), **not
built**, deliberately held until the MVP ships polished. It needs a design language now.

The shape is narrower and stranger than a chat box, and the design should reflect the actual
constraints:

- **It runs entirely on the phone.** `llama.rn`, a model the user chooses and downloads. **Not a
  byte of ledger leaves the device, ever.** So do not design a "your data is being sent" state —
  design the opposite: the affordance for *nothing leaves, and here is why you can believe that*.
- **Tier placement is FREE, pending evidence.** The argument is that on-device inference has
  zero marginal cost, so gating it would turn "your money never leaves your phone" into a paid
  feature. The open question is not price, it is **whether the smallest model that a Philippine
  prepaid data plan can casually download (~0.4 GB) is good enough**. Treat tier placement as a
  variable, but design for free-by-default.
- **The model download is a first-class UI problem** — size in MB against prepaid data, device
  RAM gating, progress, pause/resume, delete. This is probably a bigger design surface than the
  chat itself, and it has no equivalent anywhere else in the app.
- **It explains; it never advises.** It is read-only by construction — seven read-only tools
  over the same repositories the screens read.
- **Every peso figure it prints is verified verbatim against a computed number before it
  renders**, and a failed check means the answer does not render. Design that failure state.
- **Nothing runs while locked, and the conversation is never written to disk** — it is destroyed
  when the app re-locks. Design the "this conversation will not be here later" affordance.
- **AI output about someone's money must never look as authoritative as a computed number.**
  This is the core visual problem: give me a durable typographic and colour distinction between
  *computed* and *generated* that works everywhere, not a disclaimer under a chat bubble.
- Expected surfaces beyond Q&A: smarter categorisation and parse repair (lands in the review
  queue), and proactive nudges (a limit about to break, a subscription that looks abandoned).

---

## 6. Deliverable B — the motion asset system, and its hard platform split

### 6.1 What already exists

`assets/brand/` (mirrored into `mobile/assets/brand/` for the static mark):

| File | What it is | Where it can run |
|---|---|---|
| `peraplano-logo-static.svg` | resting mark, the button face | both |
| `peraplano-logo-layered.svg` | stable ids `background` / `trail` / `airplane_body` | web only |
| `peraplano-logo-animated.svg` | hand-inlined in the web `brand_mark` component | web |
| `peraplano-idle-logo.svg` | logo idling in place, infinite | web natively; mobile re-authored |
| `peraplano-idle-loop.svg` | loading / busy spinner, infinite | web natively; mobile re-authored |
| `peraplano-launch.svg` | one-shot takeoff for a click action | web natively; mobile re-authored |
| `peraplano-bg-planes.svg` | 1600×900, seven planes on mixed routes, 43 KB | **web only, by decision** |
| `nav/nav-{n,ne,e,se,s,sw,w,nw}.svg` | 8-direction pagination set | **unused today** |

Brand greens: `#22C55E` light face, `#15803D` shadow face.

### 6.2 The constraint that shapes every new asset

**All of the above animate in SMIL. `react-native-svg` does not implement SMIL.** It parses the
file, draws the first frame, and reports no error — an imported animated SVG on the phone is a
frozen plane with nothing to explain it. `react-native-svg-transformer` also compiles a `.svg`
into one opaque component, so JS cannot reach a `<g id="trail">` inside it; the layered file's
only advantage does not survive the toolchain.

So the mobile app re-authors the motion on Reanimated 4, and the keyframes are **transcribed
verbatim** from the SMIL rather than re-felt: `components/ui/brand_mark_motion.ts` is pure data
(every constant carries the source file and the SMIL attribute it came from) and
`components/ui/brand_mark.tsx` plays it. A test asserts the literal values so a silent retune
fails CI. `peraplano-bg-planes.svg` and the `nav/*` set are deliberately **not** ported —
the former is a wide-web hero that is expensive on a phone, the latter drives nothing.

**Therefore every animated asset you deliver must come in two forms:**

- **(a) the SVG** — self-contained, SMIL, no CSS and no JS, runs in `<img>` or inlined, for web.
- **(b) a keyframe table** — plain numbers, per animated track: property, from → to, duration,
  begin/delay, repeat, easing, and the transform origin. That table is what gets transcribed
  into a `*_motion.ts` file and driven by Reanimated on the phone. Give it to me as data I can
  copy, not as prose. If a motion genuinely cannot survive the port, **say so and say why**, and
  give me the mobile substitute rather than leaving a frozen frame.

Available on mobile: `react-native-svg` 15.12, Reanimated 4, `react-native-worklets`,
`lucide-react-native` for iconography, Inter as the type face. **No Lottie, no Skia** — do not
design anything that needs them without saying so explicitly and justifying the dependency.

### 6.3 What Deliverable B should cover

- The four onboarding value panels (§3) as real motion, replacing the numbered grey boxes.
- Loading / busy / syncing: today the idle loop is the only candidate. Is one spinner enough?
- **A capture moment.** The product's whole premise is a notification arriving and becoming a
  transaction without being typed. Nothing animates that today. It is the thing to sell.
- Empty states — does each one get a mark, or is that noise at eight repetitions?
- The lock screen and the unlock transition, the first thing every user sees.
- Success / failure moments: erase confirmed, export written, drift resolved, a review item
  cleared. These carry emotional weight and currently have none.
- The AI surface: a "thinking" state that is honestly distinct from a computed spinner, and the
  model-download progress state.
- **The `nav/*` 8-direction set: use it or cut it.** Tell me which. Nothing has 8-way navigation.
- Anything new you think earns its place — moving icons beyond the paper plane are welcome, but
  every one has to pay for itself in a 60 fps budget on the device in §8.

---

## 7. Design tokens — how they actually work

They are **not** a shared package. They are two parallel definitions that must be kept aligned
by hand, so any token change has to name both sides:

- **Mobile** — `mobile/constants/colors.ts` exports `palette`; `mobile/tailwind.config.ts` maps
  it to NativeWind classes. Every colour ships a `dark:` counterpart; raw hex in a component is
  a review failure. The actual values, light / dark:

  | Token | Light | Dark |
  |---|---|---|
  | `brand` | `#15803D` | `#22C55E` |
  | `brand-soft` | `#DCFCE7` | `#14261C` |
  | `on-brand` | `#FFFFFF` | `#111A16` |
  | `bg` | `#F7FAF7` | `#0B1210` |
  | `surface` | `#FFFFFF` | `#111A16` |
  | `fg` | `#10201A` | `#E8F0EC` |
  | `fg-2` | `#5B6E64` | `#9BB0A6` |
  | `danger` | `#DC2626` | `#F87171` |
  | `warn` | `#D97706` | `#FBBF24` |
  | `ph-blue` | `#0038A8` | `#4D7CDB` |
  | `ph-red` | `#CE1126` | `#E4566A` |
  | `ph-yellow` | `#FCD116` | `#FCD116` |

  Plus an eight-step categorical `chart-1…8` ramp for Reports, also light/dark paired. Contrast
  ratios are recorded in comments beside the palette and every pair passes AA — **any token you
  change must keep that true and you must state the new ratio.**
- **Web** — CSS custom properties in `server/apps/web/app/globals.css`, defined on bare `:root`,
  redefined under `prefers-color-scheme: dark` guarded as `:root:not([data-theme="light"])`,
  and again under `:root[data-theme="dark"]`. Same names in spirit, plus `--mint`, `--line`,
  `--shadow`, `--measure`.

Propose token changes explicitly, in both dialects, with the reason. Never a one-off value.

---

## 8. Hard constraints

- Android-first, one-handed, real phone: **Samsung A54 5G**, dark mode. That is the only device
  this is tested on, and 60 fps on it is the budget.
- Every design must survive the **offline** case and the **"we captured nothing yet"** case.
- **No account, no email, no cloud.** Do not design anything that implies a login, a sync
  status, a profile, or a cross-device anything.
- Philippine context: peso amounts, local banks and e-wallets, prepaid data is a real cost, and
  cash still matters — a meaningful share of money never touches a notification at all.
- Free tier caps never delete data; a downgrade never breaks an existing record.
- Money is displayed through one formatter; never invent an amount style.

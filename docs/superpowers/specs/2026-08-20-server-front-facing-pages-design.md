# PeraPlano Public Compliance Site — Design Spec

**Status:** Design spec v1 · 2026-08-20 · **not an implementation plan.** The plan is
`docs/superpowers/plans/2026-08-20-server-front-facing-pages.md`.

**Context:** `server/` has been an empty directory since the repo was created. `mobile/` is
approaching a Play submission, and three separate obligations all terminate at the same missing
artefact — a public URL that a stranger can open:

1. **RA 10173 §16 (right to be informed)** requires a privacy notice that is actually reachable.
   `docs/07-privacy-and-compliance.md` §2.4 calls it "Layer 2 — full notice … accessible from
   onboarding and from More → Settings → Privacy at all times." Onboarding can deep-link to it only
   if it exists somewhere other than inside the APK.
2. **Google Play's listing requirements** demand a privacy-policy URL and a support contact before a
   package can be submitted at all, and `docs/07-privacy-and-compliance.md` §3.1 commits us to
   submitting a review evidence pack that references the notice.
3. **The `QUERY_ALL_PACKAGES` declaration** (`docs/superpowers/specs/2026-08-19-device-issues-triage-and-roadmap.md`
   §0.2) needs a public, honest explanation of what the scan reads. The declaration form asks for a
   justification; a reviewer who wants to check it against what users are told needs a page to check
   it against.

**Goal:** Six server-rendered public pages, deployed as a Node container behind the box's existing
nginx at `peraplano.filhmar.online`, whose legal content is *derived from documents already in this
repository* and *tested against them*, and whose unfillable legal identifiers (DPO, PIC, NPC
registration) cannot be published blank by accident.

**Architecture:** One Next.js App Router application (`server/apps/web`) with `output: 'standalone'`,
sitting on a two-package npm workspace whose second package (`server/libs/common`) owns env-schema
validation, structured logging, correlation IDs, and the health report. Page copy lives in a typed
message catalog (`messages/en.json`) under an `app/[locale]/` segment so a Filipino translation is a
file drop, not a re-architecture. Legal identifiers arrive from the environment at runtime and are
never baked into the image. A test parses `docs/07-privacy-and-compliance.md` §4 and asserts the
rendered retention table matches it row for row.

**Non-goals, hard fence (owner's explicit instruction, 2026-08-20):** no user accounts, no Firebase
auth, no multi-device sync, no API gateway, no gRPC, no message broker, no Postgres, no Redis, no
analytics, no third-party embeds. The server serves front-facing pages and nothing else. Items that
argue for crossing this fence are recorded in §13, not built.

---

## Global Constraints

Every section below inherits these. They are the values that, if changed, change the meaning of the
work rather than its shape.

1. **Nothing legal is invented.** Every sentence of legal or policy consequence on the six pages
   traces to a numbered section of a document already committed to this repo. §4 gives the mapping
   per page; §4.0 gives the rule for what happens when a page needs something no document says.
2. **Host port 3003**, container port 3000, published on `127.0.0.1` only. 3000/5000 are talyer prod,
   3001 is fill-main, 3002/5002 are genesys prod, 5003 is kognita prod, 5004 is kognita staging.
   **5005 is reserved in a comment** for a future PeraPlano backend so the next person allocating a
   port does not take it.
3. **Domain `peraplano.filhmar.online`** — subdomain only, never the apex, so this site cannot shadow
   `filhmar.online`. The hostname appears in exactly two places: the nginx `server_name`, and the
   `PUBLIC_BASE_URL` default in `libs/common`. **No hostname literal anywhere under `apps/web/app/`**
   — enforced by a test, not a review habit.
4. **TypeScript `strict: true` everywhere, including tests.** Blueprint §2: "Turning it on later
   never happens."
5. **Secrets are never baked into the image.** Runtime env arrives via compose `env_file`. The repo
   ships `server/.env.example` and nothing else. `.env`, `.env.*`, `*.enc` and key material are never
   created, copied, overwritten or deleted by this work.
6. **The public site makes zero third-party requests.** See §2.3 — this is a correctness requirement,
   not a preference.
7. **Comments explain WHY.** A comment restating the line below it is noise; a comment recording a
   decision that a future reader would otherwise reverse is the point.
8. **Conventional Commits, no AI attribution** in any commit message, PR body, tag or issue.

---

## 1. What is built, precisely

| # | Route | One-line purpose | Content derived from |
|---|---|---|---|
| 1 | `/en` | What PeraPlano is and why it exists | `docs/00-product-brief.md` §§1, 2, 4, 5, 6, 7 |
| 2 | `/en/support` | How to get help; every control the user has; how to exercise their rights | `docs/07-privacy-and-compliance.md` §7, §2.8, §2.3, §4 row 8 |
| 3 | `/en/privacy` | The Layer-2 full privacy notice | `docs/07-privacy-and-compliance.md` §2.4, §2.1, §2.3, §2.7, §2.8, §3.2, §4, §5, §6 |
| 4 | `/en/terms` | Commercial terms and the disclaimers the non-goals imply | `docs/00-product-brief.md` §8, §9 |
| 5 | `/en/installed-apps` | What the installed-app scan reads and what it does not | roadmap §0.2, `docs/07-privacy-and-compliance.md` §3.2 |
| 6 | `/en/data-deletion` | How to destroy your data, and why there is no server copy to destroy | owner's scope statement (§4.6), privacy §7, §4 rows 1 and 7 |

Plus three non-page routes:

| Route | Purpose |
|---|---|
| `/` | 308 redirect to `/en`. See §2.5. |
| `/robots.txt`, `/sitemap.xml` | Generated from `PUBLIC_BASE_URL`. Crawlable, since the whole point is that a Play reviewer and a search engine can read this. |
| `/api/health` | Liveness for the container and for a future uptime check. Blueprint §6 lists Health in `libs/common`; the route handler is a five-line adapter over it. |

---

## 2. Stack decisions, and what breaks if each is reversed

### 2.1 Next.js App Router, `output: 'standalone'`, run as a Node container

**Decision.** Next.js 16.x App Router, TypeScript strict, `output: 'standalone'`, running as
`node server.js` inside a container. Not a static export, not a SPA.

**Why server-rendered rather than a static export.** Two reasons, and only the second is
load-bearing.

The weak reason is crawlers and Play reviewers: they get real HTML either way from a static export.
Static export would be fine for that.

The load-bearing reason is §5's fail-loud config. `PIC_LEGAL_NAME`, `DPO_EMAIL` and the rest are
**not known yet**, and a static export bakes whatever was true at build time into HTML files. That
means either (a) the image cannot be built until a lawyer answers, blocking everything else, or (b)
the image is built with placeholders and then the *deployed artefact* is wrong until someone
remembers to rebuild. A server that reads the environment at request time makes supplying the DPO's
email a `docker compose up -d` away, with no rebuild and no chance of a stale bake. The privacy
notice is the one page in this repo where "the deployed bytes disagree with reality" is a regulatory
problem rather than a bug.

**Why `standalone`.** It emits `.next/standalone` with a self-contained `server.js` and only the
`node_modules` that output file tracing proved are reachable. `fill-main` on the same box already
runs exactly this shape (`D:\My Folder\fill-main\Dockerfile`), so the box's operator already knows
how it behaves, and the image stays small enough that a redeploy is not an event.

**If reversed to static export:** §5 stops working. You would need a build-time secret injection
step, and the "renders `[ REQUIRED: … ]` in dev, aborts in production" behaviour collapses into "the
build fails" — which is worse, because it means nobody can build the site to look at it until the
legal facts land.

### 2.2 Monorepo skeleton, one app, one library — and no second service

**Decision.** `server/` is an npm workspace root with exactly two packages: `apps/web` and
`libs/common`. There is no gateway, no second deployable, no database, no cache, no broker.

**Why the skeleton at all, if there is one app.** Blueprint §2 sets the layout; adopting it now costs
one `package.json` and one `tsconfig` path alias. Adopting it later costs a repo-wide import rewrite
at exactly the moment you are busy building the thing that justified it. The layout is the cheap
part.

**Why nothing else.** Blueprint §3.0 is explicit: split a service out when it scales on a different
axis, has a different availability profile, is owned by a different team, or needs compliance
isolation. Six static pages satisfy none of those. Blueprint §15 lists "Kubernetes before the
operational load justifies it" and "unused dependencies left in the manifest" as named anti-patterns
for the same underlying reason — infrastructure that exists before its load does is pure carrying
cost, and it lies to every future reader about what the system does.

**The specific trap this avoids.** A Postgres in the compose file with no table in it reads, to
someone joining in six months, as "there is a database, presumably something is stored" — which is
the exact opposite of the claim `/data-deletion` makes. Absent infrastructure is part of the
compliance story here, not merely an economy.

**If reversed:** adding a second service later is a new `apps/<name>` directory, a new Dockerfile
target (§9.1 already has per-service targets), and a compose entry. The reservation of port 5005 is
the only forward accommodation this design makes, and it costs one comment line.

### 2.3 The public site makes zero third-party requests — including fonts

**Decision.** No CDN, no Google Fonts stylesheet link, no analytics, no tag manager, no embedded
video, no external image host. Fonts are self-hosted via `next/font/google`, which downloads the
files **at build time** and serves them from our own origin. Brand SVGs are served from `public/`.

**Why this is correctness and not taste.** `/privacy` will say, because
`docs/07-privacy-and-compliance.md` §2.4 requires it to state recipients, that there are **no
recipients** of user data other than the backup PIP for opt-in Plus users, and §1 says there are "no
third-party analytics." A page that makes that claim while itself shipping the reader's IP address
and user-agent to `fonts.googleapis.com` on load is not a technicality — it is the notice claiming
more than the architecture delivers, which is the one rule §2.4 states as a rule. The compliance site
is the first thing a reviewer or a regulator will look at, and it is the cheapest possible place to
be caught being sloppy about exactly the thing you are claiming to be careful about.

**The cost.** `next/font/google` needs network access during `next build`, which the Docker builder
stage already has (it runs `npm ci`). If the build host is ever offline, the font fetch fails the
build. That is an acceptable and *loud* failure. The alternative — committing the woff2 files — is
strictly available if the build ever needs to be hermetic, and is a one-file change.

**If reversed:** you get a faster first build and a privacy notice that is false on its own page.

### 2.4 Plain CSS with custom-property tokens; no Tailwind

**Decision.** One `globals.css` defining the design tokens as CSS custom properties, plus CSS Modules
per component. No Tailwind, no PostCSS pipeline beyond what Next ships.

**Why.** The approved visual identity for this site already exists in this repo as CSS custom
properties: `docs/pera-plano-web/Landing.dc.html` carries the exact token block, and
`docs/10-web-design-prompt.md` states those hexes are the *mobile app's* design tokens, synced with
`constants/colors.ts`. Reproducing a `:root{--brand:#15803D; …}` block is a copy; re-expressing it as
a `tailwind.config.ts` theme extension is a translation, and translations drift. Six content pages do
not have the class-churn problem utility CSS exists to solve.

**The counter-argument, acknowledged.** `fill-main` (Tailwind 3) and `mobile/` (NativeWind 4) both
use Tailwind, so a reader moving between the three repos meets a third idiom here. That is a real
cost. It is outweighed by having one file that is literally the same token list the design canvas
and the mobile contract already agree on.

**If reversed:** swapping to Tailwind is a mechanical class rewrite of six pages with no architectural
consequence, because the tokens are already custom properties and Tailwind can consume them directly
(`colors: { brand: 'var(--brand)' }`).

### 2.5 i18n-ready routing with no i18n library

**Decision.** An `app/[locale]/` dynamic segment with `SUPPORTED_LOCALES = ['en'] as const`,
`generateStaticParams` returning that list, a `/` → `/en` redirect, and a hand-written typed catalog
loader. No `next-intl`, no `react-intl`, no ICU message format.

**Why the segment now.** Retrofitting a locale segment means moving every route file, rewriting every
internal link, and re-testing every page — at the moment you are also trying to get a Filipino
translation reviewed. Adding the segment while there is one locale costs one directory level.

**Why no library.** The catalog is a nested JSON object of prose. Accessing it as a typed object
(`m.privacy.rights.heading`) rather than by string key gives us something a message library cannot:
**a missing Filipino key is a TypeScript error**, because `fil.json` will be declared
`satisfies Messages` where `Messages = typeof enMessages`. That is a stronger guarantee than runtime
key-miss fallbacks, and it costs about thirty lines.

**When to revisit.** The moment the copy needs plural rules, gendered forms, or number/date
formatting that varies by locale. Peso amounts on these pages are literals in prose, not formatted
values, so that moment is not now. The `t`-free call sites (`m.section.field`) are exactly what a
codemod to `next-intl` would target, so the migration is mechanical.

**No language switcher renders until `fil.json` exists.** A switcher with one entry is a broken
promise in the header. The header component takes the locale list; when the list has one member it
renders nothing.

### 2.6 Vitest, `renderToStaticMarkup`, no jsdom, no React Testing Library

**Decision.** Vitest as the runner. Component-level tests render page *content* components with
`react-dom/server`'s `renderToStaticMarkup` and assert against the resulting HTML string. No jsdom,
no `@testing-library/react`.

**Why.** Every assertion this site actually needs is about **what the HTML says**: does the retention
table match the doc, is there an `<h1>` with text in it, does the string `[ REQUIRED:` appear
anywhere. Those are string questions. A DOM emulator plus a query library is machinery for testing
interaction, and there is essentially no interaction here (one theme toggle). Skipping jsdom removes
two heavy dependencies, makes the suite start in well under a second, and — importantly — means the
tests assert on *the same artefact the server sends*, not on a re-hydrated approximation of it.

**The seam this forces, which is a benefit.** Route files (`app/[locale]/privacy/page.tsx`) stay thin:
read locale, load catalog, load config, render `<PrivacyPage messages={…} contacts={…} />`. All copy
and structure lives in the content component, which is a plain synchronous function of its props and
therefore trivially renderable outside Next. This is the single most important structural decision in
the app tier: it is what makes every page testable without a framework runtime.

---

## 3. Repository layout

```
pera-plano/
  docker-compose.yml                    # REPO ROOT. Server-only. §9.2
  .env.example                          # -> points at server/.env.example; not created (see below)
  docs/nginx/peraplano-production.conf  # §9.3
  server/
    package.json                        # workspace root: scripts + devDeps only
    package-lock.json
    tsconfig.base.json                  # strict:true, the path aliases
    vitest.config.ts                    # unit project
    vitest.smoke.config.ts              # production-build smoke project (§10.4)
    eslint.config.mjs
    .env.example                        # every var, with why-it-exists comments
    .dockerignore
    Dockerfile                          # multi-stage, per-service targets. §9.1
    libs/common/
      package.json                      # name: @peraplano/common
      tsconfig.json
      src/
        index.ts                        # barrel
        config/env.ts                   # schema, parse, markers, MissingComplianceConfigError
        config/capabilities.ts          # SERVICE_CAPABILITIES. §4.6
        logging/logger.ts               # structured JSON, level, redaction
        correlation/request_id.ts       # header name, generate, read
        health/health.ts                # buildHealthReport
        __tests__/…
    apps/web/
      package.json                      # name: @peraplano/web
      tsconfig.json
      next.config.ts                    # output:'standalone', outputFileTracingRoot, transpilePackages
      middleware.ts                     # correlation id propagation
      instrumentation.ts                # PRODUCTION BOOT GATE. §5.3
      messages/en.json                  # every word of copy
      messages/index.ts                 # typed loader, SUPPORTED_LOCALES, Messages type
      app/
        layout.tsx                      # <html>, font, globals.css, theme bootstrap script
        globals.css                     # the token block
        page.tsx                        # redirect('/en')
        robots.ts  sitemap.ts
        api/health/route.ts
        [locale]/
          layout.tsx                    # force-dynamic, header + footer, locale guard
          page.tsx  support/page.tsx  privacy/page.tsx
          terms/page.tsx  installed-apps/page.tsx  data-deletion/page.tsx
      components/
        chrome/site_header.tsx   chrome/site_footer.tsx   chrome/theme_toggle.tsx
        content/prose.tsx        content/data_table.tsx   content/callout.tsx
        content/service_status_notice.tsx                 # §4.3 / §4.6 shared claim
        content/contact_block.tsx                         # renders the fail-loud fields
        pages/marketing_page.tsx        pages/support_page.tsx
        pages/privacy_page.tsx          pages/terms_page.tsx
        pages/installed_apps_page.tsx   pages/data_deletion_page.tsx
      public/
        brand/…                         # copied from assets/brand/, see §8.2
        favicon.ico  apple-touch-icon.png  android-chrome-{192,512}.png
        site.webmanifest
      test_support/
        markdown_table.ts               # the §4 parser. §6.3
        html.ts                         # stripTags / firstHeadingText
        env_fixtures.ts                 # a complete env, and a hollow one
      __tests__/                        # drift test, no-hostname test, route inventory
```

**On `.env.example` at the repo root:** not created. The compose file's `env_file` points at
`./server/.env.local`, so the example belongs beside it at `server/.env.example`. One example file,
next to the thing it configures.

**Path aliases** (blueprint §2 — "never `../../../..` across app boundaries"):

| Alias | Resolves to |
|---|---|
| `@peraplano/common` | `libs/common/src/index.ts` (also a real workspace dependency, so it resolves at runtime too) |
| `@/*` | `apps/web/*` — matches `mobile/tsconfig.json`'s existing convention |

---

## 4. The six pages

### 4.0 The derivation rule

Every page section carries, in a source comment on its content component, the document and section it
derives from. The rule for anything that no document covers:

1. If it is **factual** (a contact detail, a registration number), it becomes a fail-loud env field
   (§5) — never a plausible-looking literal.
2. If it is **legal prose** that requires professional judgement (governing law, liability limits,
   refund terms), it becomes a **visible on-page block** naming what is missing and that counsel must
   supply it. It is not written, not approximated, and not silently omitted.
3. If it is **descriptive of the product**, it is derived from `docs/00-product-brief.md` or the
   feature docs and cited. If those documents do not say it, it does not go on the page.

Rule 2 deserves defending, because "ship a terms page with a visible hole in it" sounds worse than
"write something reasonable." It is not. A plausible governing-law clause written by a non-lawyer
creates the *appearance* of a reviewed document, which means nobody ever reviews it. A block that
says "the following clauses are required before PeraPlano Plus can be offered for sale and have not
been drafted" cannot be mistaken for finished work, and it is a to-do list a lawyer can quote against.
This mirrors §5 exactly: make the gap visible and unmissable rather than filling it with something
that looks fine.

### 4.1 `/` — marketing

**Sources:** brief §1 (vision), §2 (core promise), §4 (three personas), §5 (how it works), §6
(competitive framing), §7 (brand and voice).

**Sections:**

1. **Hero.** The name, the tagline from brief §2 verbatim — *"You never log a transaction; you only
   set the rules."* — the inline animated brand mark (§8.1), and one sentence from brief §1 on what
   the app does. A Google Play badge is **not** rendered: there is no listing yet, and a badge
   linking to `#` on a page a reviewer might read is worse than no badge. The slot exists in the
   catalog (`marketing.hero.storeBadge: null`) so adding it later is a value change.
2. **What it does** — brief §5's five numbered steps, condensed to the five verbs: explain, listen,
   parse, dedupe and link transfers, enforce your rules. Includes the illustrative-notification
   example, carrying brief §5's own "illustrative only" disclaimer, because a fabricated bank message
   presented as real is exactly the sort of thing that reads badly at review.
3. **Who it is for** — brief §4's three personas, each as a card: the salaried kinsenas earner, the
   gig/informal-income worker, the e-wallet-heavy spender. Filipino terms (*kinsenas*, *utang*,
   *padala*) defined on first use, per brief §7's voice rule.
4. **Why the Philippines** — the six facts from brief §3. *(Added beyond the owner's listed sections:
   §3 is what makes §4's personas make sense to a non-PH reader such as a Play reviewer. Flagged here
   as a deliberate addition to the listed derivation set.)*
5. **What it is not** — a short, plain restatement of brief §9's permanent non-goals, with a link to
   `/terms` for the full list. Leading with the limits is brand voice (§7: "respectful of the
   reader's intelligence"), and it is the honest frame for a finance app.
6. **Privacy promise** — three sentences from privacy §1, linking to `/privacy`.
7. **Pricing is deliberately absent.** Brief §8 states pricing in ₱ is intentionally not decided. The
   tier matrix lives on `/terms` where the commercial terms are, and the marketing page links to it.
   A "free tier" claim on a marketing page is a commercial representation; it belongs with the other
   ones.

### 4.2 `/support`

**Sources:** privacy §7 (complete user-controls list), §2.8 (rights → product mapping), §2.3 (support
correspondence lawful basis and its warning), §4 row 8 (support retention).

**Sections:**

1. **How to reach us.** `SUPPORT_EMAIL`, `PIC_LEGAL_NAME`, `PIC_ADDRESS` — all fail-loud fields
   (§5).
2. **Before you write to us: do not paste raw notification text.** Privacy §2.3 states users are
   warned about this; §4 row 8 says support mail is retained ≤ 24 months. Both facts go on the page,
   because the warning without the retention period does not explain itself.
3. **Every control you have** — privacy §7's table reproduced in full: control, what it does, where it
   is. Thirteen rows. This is the single most useful thing on the site for an actual user and the
   fastest answer to a reviewer asking "can the user turn this off?"
4. **Your rights under RA 10173, and how to use them** — privacy §2.8's seven rows, each stating the
   right and the concrete in-app action that honours it.
5. **Data Protection Officer** — `DPO_NAME`, `DPO_EMAIL`, and `NPC_REGISTRATION` (§5).
6. **Complaining to the NPC** — privacy §2.8's last row and §2.4's requirement that the complaint
   route is stated. Names the National Privacy Commission as the route; does not paste an address or
   URL, which no repo document supplies and which would be invented under rule §4.0.1.

### 4.3 `/privacy` — the Layer-2 full notice

**Sources:** privacy §2.4 (the required-contents checklist), §2.1 (roles), §2.3 (lawful basis table),
§2.7 (breach), §2.8 (rights), §3.2 (not requested), §4 (lifecycle — drift-tested, §6), §5
(minimization), §6 (third-party data in notifications).

**§2.4's list, mapped to sections, so nothing required is missing:**

| RA 10173 / IRR requirement (privacy §2.4) | Section on the page |
|---|---|
| Identity and contact details of the PIC | 2. Who is responsible |
| Data Protection Officer contact | 2. Who is responsible |
| Description of data processed | 4. What data exists (the §4 lifecycle table) |
| Purposes | 3. Why we process it (the §2.3 table's purpose column) |
| Lawful basis | 3. Why we process it |
| Scope and method of processing | 5. How processing happens (on-device parse; §5 minimization) |
| Retention periods, matching §4 exactly | 4. What data exists — **drift-tested, §6** |
| Recipients | 6. Who receives it — nobody, plus the backup PIP for opt-in Plus |
| Existence of automated processing | 7. Automated decisions, and how to correct them |
| Data subject rights and how to exercise them | 8. Your rights |
| Complaint route to the NPC | 9. Complaints |

**Plus four sections §2.4 does not enumerate but the surrounding document requires:**

- **1. Status of the service today** — the `ServiceStatusNotice` (see below).
- **10. What we deliberately do not ask for** — privacy §3.2's table. The absence of `READ_SMS`,
  call log, accessibility, location and contacts is one of the strongest trust statements the product
  has, and it is invisible unless stated.
- **11. Other people's names in your notifications** — privacy §6, in full. A remittance sender's name
  is third-party personal data that arrived on the user's phone without that person's consent; §6's
  five-point stance is precisely the sort of thing an NPC reader looks for and almost no app
  addresses.
- **12. If something goes wrong** — privacy §2.7's 72-hour NPC and data-subject notification posture.

**The `ServiceStatusNotice` and why it exists.** Privacy §4 rows 5 and 6 describe aggregate telemetry
and opt-in cloud backup. Privacy §1 describes them as product facts. But the owner's scope statement
for `/data-deletion` is unambiguous: *"there is no multi-device sync, no accounts, and nothing is
stored on the server at all."* Publishing §4 verbatim without qualification would have the notice
describe a backup service that does not exist — which violates §2.4's rule in the *other* direction
("the notice must never claim more than the architecture delivers").

Resolution: the §4 table is rendered verbatim (the drift test requires that), and a distinct block
above it states what is live today. That block is a **single component rendered identically on
`/privacy` and `/data-deletion`**, sourced from one catalog entry and one constant
(`SERVICE_CAPABILITIES`, §4.6), with a test asserting both pages emit the same text. Two pages making
subtly different claims about whether a server holds your money data is the specific failure this
prevents, and it is the kind of failure that only shows up when someone reads both pages in the same
sitting — which is what a regulator does.

**Draft status is stated on the page.** `docs/07-privacy-and-compliance.md` is marked
`**Status:** Draft v1 · 2026-08-02`, and it has not been through Philippine privacy counsel (§2.5
defers "final legal confirmation" to counsel). The page parses that status line out of the markdown
using the same parser as the drift test and renders "Derived from an internal draft dated
2026-08-02; not yet reviewed by counsel." Deriving the date rather than typing it means the page
cannot claim a review freshness the document does not have.

### 4.4 `/terms` — the thinnest derivation, and the one to flag

**Sources:** brief §8 (monetization stance and the locked tier matrix), §9 (permanent non-goals and
deferred items), privacy §4 row 4 (Play handles purchases; no payment instrument data stored).

**This is the weakest page in the set and the spec says so plainly.** Brief §8 and §9 are a *product*
position, not a contract. They tell you what the tiers are and what the app refuses to be; they say
nothing about the things a terms-of-service document exists to say. Sections 1–5 below are solid
derivations. Section 6 is a hole with a label on it.

**Sections:**

1. **What PeraPlano is, in contractual terms.** Brief §9 non-goals 1 and 2, stated as disclaimers:
   PeraPlano never holds, moves, or touches funds; it is not a bank or e-money issuer; it is not a
   financial advisor and makes no recommendations about products, investments or credit.
2. **The ledger is derived, and you are responsible for checking it.** Derived from brief §5 step 4
   (low-confidence parses go to the Review Queue) and §10 ("the user trusts the number"). Parses can
   be wrong; the app is not a substitute for your bank's own records. *Flagged: this is a reasonable
   derivation, but "limitation of liability for an inaccurate parse" is a counsel question, not an
   engineering one — see section 6.*
3. **Free and Plus.** Brief §8's tier matrix reproduced verbatim (eleven rows), plus §8's gate-behavior
   principle stated as a commitment: hitting a cap blocks creation, never deletes or retroactively
   hides data. Privacy §8 restates the same matrix and adds that privacy controls are never Plus-gated
   — that sentence goes here too, because it is a commercial commitment as much as a privacy one.
4. **Pricing is not published yet.** Brief §8: pricing in ₱ is intentionally undecided. The page says
   so, and says prices and billing terms will appear here before any purchase is possible.
5. **Purchases, when they exist, run through Google Play.** Privacy §4 row 4: purchase state is
   managed by Google Play under its own policies, and PeraPlano stores no payment instrument data.
6. **`CounselRequiredNotice` — clauses not yet drafted.** A visible block, per rule §4.0.2, naming
   exactly what is missing:
   - governing law and venue
   - limitation of liability and warranty disclaimer (including for parse inaccuracy, §2 above)
   - subscription term, renewal, cancellation and refund terms
   - intellectual property and the licence granted to the user
   - termination and suspension
   - how changes to these terms are notified and when they take effect
   - the effective date of the document

   The block states that PeraPlano Plus cannot be offered for sale until these exist. It is not a
   placeholder to be forgotten: §10.2's route smoke test asserts the block is present, and the day it
   is removed the test is removed with it — deliberately, so removal is a conscious act in a diff.

### 4.5 `/installed-apps` — narrow on purpose

**Sources:** roadmap §0.2 (the decision and its recorded risk), privacy §3.2 (what is deliberately not
requested).

Roadmap §0.2 records, in the owner's own decision document, that Google's enumerated permitted uses
for `QUERY_ALL_PACKAGES` **do not obviously cover** "detect which bank apps the user has installed"
— the financial carve-out is worded for fraud and security checks — and that **a rejection is a live
possibility.** A page that reads as though the use is clearly permitted would be contradicted by our
own decision record. So the page is written narrow, and the narrowness is the point: at review, an
honest page that concedes the ambiguity and shows the fallback is worth more than a confident one
that overstates the carve-out.

**Sections:**

1. **What is read.** The **package names** of applications installed on the device — the identifier
   strings, e.g. `com.globe.gcash.android`. That is the whole of it.
2. **What is never read.** Anything inside another app. App contents, screens, usage statistics, how
   often anything is opened, any data belonging to any other app. PeraPlano has no accessibility
   service (privacy §3.2), no `READ_SMS` (§3.2), no `PACKAGE_USAGE_STATS`.
3. **Why.** Onboarding's provider picker needs to show the bank and e-wallet apps the user actually
   has. Before the scan, it was populated from thirteen guessed, unverified package names against an
   empty listener history (roadmap §0.3's account of why the old capture default existed) — which
   asks the user to recognise something they have no way to recognise. This is the only stated
   purpose.
4. **Which permission, and what that means at review.** `QUERY_ALL_PACKAGES` is a Play **restricted**
   permission requiring a declaration form on every release. The page states in plain words that the
   permitted-use list does not obviously cover this purpose, that the declaration is made on the
   basis that the scan exists solely to configure which notifications the user wants read, and that
   Google may disagree.
5. **The alternative, and why it already exists in the design.** Package discovery sits behind one
   interface with two implementations: the `QUERY_ALL_PACKAGES` scan, and a `<queries>` manifest
   allowlist of known PH bank and e-wallet packages (roadmap §0.2's mitigation, which is a design
   constraint on W3 rather than an alternative to the decision). If review bounces, the swap is **one
   implementation, not a redesign of onboarding**. The page states the user-visible consequence of
   that swap honestly: with the allowlist, only apps on the list can be detected, and a newly launched
   e-wallet needs an app update before it appears.
6. **Where the result goes.** It configures the picker. What persists afterwards is the user's
   provider selection, not a copy of their app inventory. Nothing about it is transmitted.

**A genuine gap found while writing this, flagged not patched.** `docs/07-privacy-and-compliance.md`
§4's lifecycle table has **no row for installed-package scan results.** §5.5 says "Adding a field to
any synced entity requires a lifecycle-table update," and §2.4's rule requires the notice and the
architecture to agree. Section 6 above is the honest description of the handling, but it is
*this spec's* description, not the compliance document's. §4 needs a row 9 covering installed-package
enumeration (originates: `PackageManager` query at onboarding; stored: not persisted beyond the
derived provider selection; retention: n/a; leaves device: never). **That edit is not made by this
work** — §4 is a legal source document whose changes require a notice revision and a PIA revisit in
the same release (§2.4, §2.6), and it feeds the drift test. It is recorded in §13 as an owner action.

### 4.6 `/data-deletion` — no accounts, no server copy

**Scope, per the owner verbatim (2026-08-20):** *"this is NOT an account-deletion endpoint. There is
no multi-device sync, no accounts, and nothing is stored on the server at all. The page gives
explicit instructions for clearing application data and states plainly that no server-side copy
exists to delete. … Do not imply an account exists. Write it so it stays true when Firebase auth
lands later and a real deletion flow gets added beside it."*

**Sections:**

1. **`ServiceStatusNotice`** — the same component and text as `/privacy` §1. "PeraPlano has no
   accounts and no sign-in. Your data is on your phone. There is no copy on our servers to delete."
2. **Delete one thing.** Privacy §7: any Transaction can be deleted from its detail screen; every
   parsed field is editable.
3. **Stop the capture without deleting.** Privacy §7: pause listening globally, pause per provider,
   telemetry opt-out. Included because "delete everything" is not the only thing a person who lands
   on a deletion page wants, and offering only the hammer pushes people to uninstall.
4. **Delete everything, three ways**, in order of how much they destroy:
   - **In-app:** More → Settings → Privacy → **Wipe everything.** Privacy §7 — the confirmation flow
     states exactly what will be destroyed. This is the route the page recommends, because it is the
     only one that is aware of what it is deleting.
   - **Android Settings → Apps → PeraPlano → Storage → Clear data.** Destroys the encrypted database
     and every setting; the app returns to first-run state.
   - **Uninstall.** Removes the app and its data together.
5. **Some things delete themselves.** Privacy §4 row 1: raw notification text carries a 30-day TTL and
   is purged automatically, with or without any action from the user. This is the invariant that most
   surprises people in a good way, and it belongs on the page that is about deletion.
6. **What we cannot delete for you.** Privacy §4 row 7: CSV exports you saved or shared are outside
   the app's protection and outside its reach — delete those yourself. §4 row 8: support
   correspondence you sent us is retained ≤ 24 months after case closure; ask us and we will delete
   it sooner.
7. **If accounts ever exist.** Written in the conditional, present-tense-negative: "PeraPlano does not
   offer accounts today." Then: if a sign-in identity is ever introduced for cloud backup, a web
   deletion route will appear on this page and will remove the identity and all server-side backup
   data within 30 days, per Google Play's account-deletion policy (privacy §3.7). The section never
   uses the words "your account."

**How this "stays true when Firebase auth lands" — mechanically, not by hoping.**
`libs/common/src/config/capabilities.ts` exports:

```ts
export const SERVICE_CAPABILITIES = {
  accounts: false,
  cloudBackup: false,
  serverSideStorage: false,
} as const;
```

Two tests bind the pages to it:

1. A **consistency test**: when `serverSideStorage` is `false`, `/privacy` and `/data-deletion` must
   both render the `ServiceStatusNotice` text, and it must be byte-identical between them.
2. A **tripwire test**: `expect(SERVICE_CAPABILITIES.accounts).toBe(false)` with a comment naming what
   must be written before the flag may flip — the account-deletion route on `/data-deletion`, the
   web deletion link in the Play listing, and the §3.7 30-day commitment.

The tripwire test failing is not an inconvenience; it is the design working. Whoever wires Firebase
auth cannot land it green without opening `/data-deletion` and dealing with it. Dead code written in
advance for a feature that does not exist would rot; a failing test at the exact moment of the change
does not.

---

## 5. Configuration — fail loud, in both directions

### 5.1 The fields

Six values are **not known** as of 2026-08-20 and must never be fabricated:

| Env var | What it is | Source of the requirement |
|---|---|---|
| `PIC_LEGAL_NAME` | The legal name of the entity acting as Personal Information Controller | privacy §2.1, §2.4 |
| `PIC_ADDRESS` | Its registered address | privacy §2.4 ("identity and contact details of the PIC") |
| `DPO_NAME` | The appointed Data Protection Officer | privacy §2.5 ("appointed before public launch regardless of registration thresholds") |
| `DPO_EMAIL` | Their contact address | privacy §2.4, §2.5, and the Play listing support details |
| `SUPPORT_EMAIL` | The support mailbox | privacy §2.3, §4 row 8; Play listing requirement |
| `NPC_REGISTRATION` | NPC registration status or number | privacy §2.5 — the planning position is "register"; the actual status is unknown |

Three more are **known** and carry defaults:

| Env var | Default | Notes |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://peraplano.filhmar.online` | Drives canonical tags, `og:url`, `sitemap.xml`, `robots.txt`. Validated as an absolute `http`/`https` URL; a trailing slash is stripped at parse time so downstream concatenation cannot produce `//`. |
| `NODE_ENV` | `development` | Selects which of §5.2's two behaviours applies. |
| `LOG_LEVEL` | `info` | `debug｜info｜warn｜error`. |

### 5.2 Two behaviours, and why both are needed

**In production: abort boot.** Any of the six unsupplied → the process throws
`MissingComplianceConfigError`, whose message names **every** missing field (not the first — an
operator who fixes one at a time and redeploys each time is a design failure), and exits non-zero.
The container never serves a request. Compose's `restart: unless-stopped` will retry it, and the
error is in `docker compose logs` on every attempt.

**In development: render a visible marker.** Any of the six unsupplied → the accessor returns the
literal string `[ REQUIRED: DPO_EMAIL ]` (exact spacing), which renders on the page in place of the
value, styled to be impossible to skim past.

**Why not just fail in dev too.** Because then nobody can run the site. The legal facts may take weeks
to land; design, copy review, the Play evidence video and the nginx wiring all need a running site
before then. Failing in dev means the whole downstream chain waits on a lawyer.

**Why not just use markers in production too.** Because `[ REQUIRED: DPO_EMAIL ]` on a live privacy
notice is worse than an outage. An outage gets noticed and fixed in minutes; a published notice with
a blank DPO is a live RA 10173 §16 defect that can sit there for months, and it is precisely the
thing an NPC reader would open with.

The two behaviours are the same decision seen from both ends: **the missing value must be impossible
to ignore.** In dev the loudest available channel is the screen; in production it is refusing to
start.

### 5.3 Where the check runs — and the `force-dynamic` consequence

This is the subtle part, and getting it wrong produces a container that builds fine and serves
placeholders.

`next build` runs with `NODE_ENV=production`. If the production check lived at module scope in the
config module, **the Docker build would fail**, because §5's whole point is that env arrives at
runtime via compose `env_file` and is not present in the builder stage. So:

- **`parseEnvironment()` never throws.** It is pure: `(raw) => { values, missing }`. Missing fields
  become markers in `values`.
- **`assertProductionConfig()` throws.** It is called from exactly one place:
  `apps/web/instrumentation.ts`'s `register()`, which Next runs **once when the server starts** and
  **not during `next build`**. That is the boot gate.
- **Consequence: pages that embed these values must not be statically prerendered**, or the build
  bakes dev markers into HTML that a correctly-configured production server would then serve.
  `app/[locale]/layout.tsx` therefore sets `export const dynamic = 'force-dynamic'`, which applies to
  every segment beneath it. The footer carries `SUPPORT_EMAIL` and the DPO contact on every page, so
  the whole locale subtree needs it anyway. `app/sitemap.ts` and `app/robots.ts` set it too, because
  both embed `PUBLIC_BASE_URL`.

Six pages of prose re-rendered per request costs nothing measurable, and nginx's `/_next/static/`
block still long-caches the assets that matter. The comment in `layout.tsx` must say *why* — a future
reader who sees `force-dynamic` on a static content site will assume it is cargo cult and delete it,
and the failure mode of deleting it is a build that silently bakes `[ REQUIRED: DPO_EMAIL ]` into
production HTML.

### 5.4 What the error looks like

```
MissingComplianceConfigError: Refusing to start: 3 required compliance values are not configured.

  PIC_LEGAL_NAME  — legal name of the Personal Information Controller (privacy §2.4)
  DPO_EMAIL       — Data Protection Officer contact (privacy §2.4, §2.5)
  NPC_REGISTRATION — NPC registration status (privacy §2.5)

These appear in the published privacy notice. Set them in server/.env.local
(see server/.env.example) and restart. They are never baked into the image.
```

Naming the document section in the error is deliberate: the operator reading it at 2am is not the
person who read §2.4.

---

## 6. The drift test

### 6.1 The rule it enforces

`docs/07-privacy-and-compliance.md` §2.4:

> Rule: the notice must never claim more than the architecture delivers, and the architecture must
> never do more than the notice says. **Any change to the lifecycle table (§4) requires a notice
> revision in the same release.**

That second sentence is a process commitment with no enforcement behind it. This test is the
enforcement. Editing §4's table without editing the published notice fails CI.

### 6.2 Why two copies and a test, not one copy read at build time

The DRY-est design would be for the page to parse §4 out of the markdown at build time — then drift
is structurally impossible. It is rejected for two reasons, and the second is decisive.

The weak reason: `docs/07-privacy-and-compliance.md` is an internal planning document with
cross-links to sibling docs, internal-voice asides, and a status header. Publishing it verbatim
publishes all of that.

The decisive reason: **`fil.json` cannot translate a table the page reads from an English markdown
file.** The moment the Filipino notice exists, the page must render translated rows while §4 stays
English — which means the page must own its own copy, which means the test is the only mechanism left
that can bind them.

Consequence, and it must be stated in the test file so nobody discovers it later: **the drift test is
scoped to the `en` catalog.** A translated `fil.json` cannot be checked against an English table by
string comparison. When `fil.json` lands, the guard for it is a human review gate — a note in the
translation checklist that §4's rows are legally load-bearing — plus a *structural* check that
`fil.json` has the same number of rows and columns as `en.json`. That structural check is worth
adding at the same time and is out of scope now.

### 6.3 The parser, and normalization

`test_support/markdown_table.ts` exports:

```ts
export interface MarkdownTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}
export function extractSection(markdown: string, heading: string): string;
export function parseFirstTable(section: string): MarkdownTable;
export function normalizeCell(raw: string): string;
export function extractStatusLine(markdown: string): string;
```

`normalizeCell` handles, and is unit-tested on, exactly the constructs §4's table actually contains:

| Construct | Example from §4 | Normalized to |
|---|---|---|
| Bold | `**30-day TTL, then purged**` | `30-day TTL, then purged` |
| Escaped pipe | `tier: free \| plus` | `tier: free \| plus` (the pipe survives; it is content, not a delimiter) |
| Markdown link | `[08-risks…](08-risks…md)` | `08-risks…` (link text only — the target is a repo-relative path meaningless to a reader) |
| Backticks | `` `rawNotificationRef` `` | `rawNotificationRef` |
| Collapsible whitespace | `a   b` | `a b` |

The escaped-pipe case is the one that will bite: `\|` inside a cell must not split the row. The
splitter walks the line tracking backslash escapes rather than calling `String.split('|')`, and there
is a named test for it (`row 4 contains an escaped pipe and stays one cell`) because §4 row 4 has one
today and a naive splitter passes every other row.

`extractSection` slices from a `## 4. Data lifecycle` heading to the next `## ` at the same level, so
the parser cannot accidentally pick up a table from §5 or §8 if §4 ever loses its table.

**Failure mode to design for:** if the heading text ever changes, `extractSection` must throw a
message that says which heading it looked for and what headings it found, not return empty and let a
zero-row comparison pass vacuously. The test also asserts `rows.length >= 8` independently, so a
parser that silently returns nothing cannot be mistaken for agreement.

### 6.4 What is compared

The test:

1. Reads `docs/07-privacy-and-compliance.md` from a path resolved relative to the test file
   (`../../../../docs/07-privacy-and-compliance.md` from `apps/web/__tests__/`). If the file is
   missing it fails with a message naming the expected path — this test is the one thing that breaks
   if `server/` is ever extracted into its own repository, and the message says so.
2. Parses §4's table.
3. Renders `<PrivacyPage>` with a complete env fixture, via `renderToStaticMarkup`.
4. Extracts the retention table's cells from the rendered HTML.
5. Asserts **deep equality of the full normalized row set** — every row, every column, in order.

Full-fidelity comparison, not a subset. Privacy §2.4 requires the published retention periods to match
§4 "exactly," and a test that checks only the retention column would pass while the page misdescribed
where data is stored. Comparing rendered output rather than the catalog is deliberate too: it proves
what a reader receives, and it catches a page that has the right data in `en.json` but renders only
four of the six columns.

---

## 7. `libs/common`

Blueprint §6's table, minus what a static site has no use for. What is **in**:

| Module | Responsibility | Why it is here and not in `apps/web` |
|---|---|---|
| `config/env.ts` | Schema, pure parse, markers, `MissingComplianceConfigError` | Blueprint §6: "validate with a schema at boot, fail fast … A service must never start half-configured." The moment a second service exists it needs the same six values on its own pages or emails. |
| `config/capabilities.ts` | `SERVICE_CAPABILITIES` | §4.6. The claim "nothing is on our servers" is a *platform* fact, not a web-page fact. |
| `logging/logger.ts` | Structured JSON lines, level from `LOG_LEVEL`, redaction of anything key-matching `/(password｜token｜secret｜key｜email)/i` in fields | Blueprint §6. Redaction matters more than usual here: the one thing that must never reach a log line on this platform is a user's email from a contact form — which is also why there is no contact form (§13). |
| `correlation/request_id.ts` | `REQUEST_ID_HEADER`, `newRequestId()`, `readOrCreateRequestId(headers)` | Blueprint §6. `middleware.ts` propagates it; the logger takes it as a field. |
| `health/health.ts` | `buildHealthReport({ startedAt, now, configComplete, version })` | Blueprint §6. `app/api/health/route.ts` is a five-line adapter. |

**Deliberately absent:** metrics registry, error taxonomy, storage/broker/cache clients. Blueprint §6
warns that "utils grab-bags" and speculative shared code are how a monorepo becomes a tangle; a
metrics registry with no scrape target is exactly that.

**The health payload deliberately does not name missing fields.** It reports
`configComplete: boolean`. The field *names* are not secret — they are meant to be published — but a
public endpoint that enumerates what the operator has not finished is free reconnaissance for no
benefit. The names go to the log, once, at boot.

**Validation library:** `zod`. Already in `fill-main`'s dependency set on the same box, so the
operator has seen it; and the schema doubles as the TypeScript type via `z.infer`, which is what
keeps the config type and the config validation from drifting apart.

---

## 8. Brand and visual system

### 8.1 The assets are real; nothing is invented

`assets/brand/` holds a complete delivered identity, documented in `assets/brand/README.md`. What the
web tier uses:

| File | Use | Note |
|---|---|---|
| `peraplano-logo-animated.svg` | Header mark, hero mark | **Contains no animation.** Its stable ids `#trail` and `#plane` are the animation *targets*; `README.md` says it "is animated in the browser via CSS on the web front end" — meaning the front end supplies the keyframes. It must therefore be **inlined into the DOM**, not referenced via `<img>`, or the CSS cannot reach the ids. |
| `peraplano-logo-static.svg` | Fallback, and `prefers-reduced-motion` | The resting mark. |
| `peraplano-bg-planes.svg` | Hero background | 43 KB, SMIL-animated. Plays natively in an `<img>` or as a CSS background. |
| `favicon/favicon.ico`, `favicon-{16,32}x32.png`, `apple-touch-icon.png`, `android-chrome-{192,512}.png` | Browser and PWA chrome | Copied into `public/`. |
| `favicon/peraplano-favicon.svg` | SVG favicon | Rounded green tile with the mark. |
| `favicon/site.webmanifest` | **Rewritten, not copied.** | The delivered file has empty `name`/`short_name` and `theme_color:#ffffff` against a green brand. Ours sets the real name and `#15803D`. |
| `nav/*.svg` | Not used | Eight-direction pagination glyphs with no pagination on this site. `README.md` already notes they have no consumer; leaving them unused is correct, and wiring them in for decoration would be the "unused dependency" anti-pattern in asset form. |

The animation CSS is two keyframe sets, already written in
`docs/pera-plano-web/Landing.dc.html`: `pp-float` (a `translateY`/`rotate` bob on `#plane`) and
`pp-flow` (a `stroke-dashoffset` crawl on `#trail`). Both are wrapped in
`@media (prefers-reduced-motion: no-preference)`, which the canvas does not do — a compliance site
for an audience that includes people with vestibular sensitivity should not bob by default.

### 8.2 Tokens

Copied verbatim from `docs/pera-plano-web/Landing.dc.html`, which `docs/10-web-design-prompt.md`
confirms are the mobile app's tokens from the interface contract §2:

```
light  brand #15803D · brand-2 #22C55E · on-brand #FFFFFF · mint #DCFCE7
       bg #F7FAF7 · surface #FFFFFF · text #10201A · muted #5B6E64
       danger #DC2626 · warn #D97706 · line rgba(16,32,26,.12)
dark   brand #22C55E · brand-2 #4ADE80 · on-brand #06130C · mint #14261C
       bg #0B1210 · surface #111A16 · text #E8F0EC · muted #9BB0A6
       danger #F87171 · warn #FBBF24 · line rgba(232,240,236,.14)
PH accents (sparingly, per the design prompt) blue #0038A8 · red #CE1126 · yellow #FCD116
```

Typeface: **Manrope**, per the design canvas, self-hosted through `next/font/google` (§2.3), with
`system-ui, sans-serif` as the fallback stack.

Dark mode is supported two ways, both of which must work: `prefers-color-scheme` with no JavaScript
at all, and an explicit `data-theme` attribute set by the toggle and persisted to `localStorage`
under the key `pp-theme` (the key the design canvas already uses). The blocking inline script in
`<head>` that applies the stored preference before first paint is the canvas's script verbatim —
without it the page flashes light before switching, which on a dark-mode device reads as broken.

### 8.3 Layout language

Sticky translucent header (`backdrop-filter: blur(12px)`) with the inline mark, the six page links,
and the theme toggle. `max-width: 1120px` content column, 24px gutters. Cards on `--surface` with a
1px `--line` border. Tables scroll horizontally inside their own container — privacy §4's table is six
columns of prose and will not fit a phone, and a page body that scrolls sideways is the most common
way a content site breaks on mobile. Footer: the six links, the PIC and DPO block, and the canvas's
own closing line — "Local-first · No ads · Your data is never sold."

---

## 9. Container, ports, nginx

### 9.1 `server/Dockerfile`

Multi-stage with **per-service targets**, per blueprint §7.1, even though there is one service today —
the stage names are what make adding `apps/api` later a copy of six lines rather than a restructure.

```
FROM node:22-alpine AS base        # pinned; OS patches land here and every stage inherits
FROM base AS deps                  # npm ci at the workspace root — installs both packages
FROM deps AS build                 # npm run build -w @peraplano/web (compiles libs/common with it)
FROM base AS runtime-base          # non-root user, tini, HEALTHCHECK against /api/health
FROM runtime-base AS web           # <- the target compose builds
```

**The workspace/standalone wrinkle, called out because it will cost an hour otherwise.** With npm
workspaces, `output: 'standalone'` emits `.next/standalone/apps/web/server.js` with hoisted
`node_modules` at `.next/standalone/node_modules` — not the flat `server.js` at the root that
`fill-main`'s single-package Dockerfile copies. `next.config.ts` must set
`outputFileTracingRoot: path.join(__dirname, '../../')` so tracing sees the whole workspace, and the
runtime `CMD` is `["node", "apps/web/server.js"]`. Static assets go to
`.next/standalone/apps/web/.next/static` and `public` to `.next/standalone/apps/web/public`.

Hygiene, from blueprint §7.1's checklist: non-root user, `HEALTHCHECK`, no package manager in the
runtime stage, `NEXT_TELEMETRY_DISABLED=1`, and a `.dockerignore` that excludes `.git`,
`node_modules`, `.next`, every `*.md`, and — explicitly, with the reason in a comment — `.env` and
`.env.*` while allowing `.env.example`. `fill-main`'s `.dockerignore` is the model.

`PORT=3000`, `HOSTNAME=0.0.0.0` in the runtime stage. Note that `HOSTNAME=0.0.0.0` binds inside the
container only; the loopback restriction happens at the compose port publish.

### 9.2 Root `docker-compose.yml`

At the **repo root**, per the owner's explicit instruction, and it builds `server/` only. `mobile/` is
not containerized and no service references it.

- service name **`peraplano-web`** — not `web`, so a future `peraplano-api` on 5005 reads as a sibling
  rather than a rename
- `build: { context: ./server, dockerfile: Dockerfile, target: web }`
- `ports: ["127.0.0.1:3003:3000"]` — with `fill-main`'s comment reproduced in spirit: the box already
  runs a host nginx serving other apps; binding to loopback keeps this off the public interface and
  makes nginx the only entry
- `env_file: [./server/.env.local]` — every runtime value, never baked into the image
- `environment: { NODE_ENV: production, PORT: "3000", HOSTNAME: 0.0.0.0 }`
- `restart: unless-stopped`
- a comment block recording the box's full port allocation and **reserving 5005** for a future
  PeraPlano backend

The port map is written down in the compose file rather than in a wiki because the compose file is
what the next person allocating a port will have open.

### 9.3 `docs/nginx/peraplano-production.conf`

Follows `D:\My Folder\fill-main\docs\nginx\filhmar-production.conf` structurally, because that file is
a working, deployed precedent on the same box and because its header comment records a fact that cost
real time to learn.

**HTTP-only, no 443 block, and the header says why:** nginx refuses to load a `listen … ssl` server
that has no certificate, and `certbot --nginx` cannot modify a config that will not load. They
deadlock before the first issuance. `certbot --nginx` rewrites this file in place — adding the 443
listener, the `ssl_certificate` lines, and turning port 80 into a redirect — reusing the location
blocks below, so routing survives the rewrite.

Contents:

- header comment: the deadlock explanation, the copy-paste usage block (`cp` → `ln -sf` → `nginx -t`
  → `systemctl reload nginx` → `certbot --nginx -d peraplano.filhmar.online`), and an explicit note
  that the box already runs other enabled sites and **this one is added, never replacing them**
- `upstream peraplano_web { server 127.0.0.1:3003; }`
- `server_name peraplano.filhmar.online;` — **subdomain only**, no apex, no `www`. `filhmar.online`
  already has its own server block for fill-main; a `server_name` here that included the apex would
  create two blocks competing for it, and nginx resolves that by first-loaded, which is alphabetical
  by symlink name — a coin flip nobody should be relying on.
- `location ^~ /.well-known/acme-challenge/ { root /var/www/html; }` — first issuance and every
  unattended renewal after the redirect is added
- `location /_next/static/ { proxy_pass …; proxy_cache_valid 200 60m; add_header Cache-Control "public, max-age=31536000, immutable"; }`
- `location / { proxy_pass http://peraplano_web; }` — **no URI part** on the `proxy_pass`, so the
  request path passes through unmodified
- the standard header set: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Upgrade`,
  `Connection`, with `proxy_http_version 1.1`
- `client_max_body_size` set small (1m) with a comment that this site accepts no uploads and no form
  posts, so the default 1m is already generous — deliberately *not* fill-main's 10m, which exists
  there for its assistant and contact JSON bodies

---

## 10. Testing

Blueprint §12's warning is the shape of this section: *"A test script that points at a config file
nobody committed … you have a claim, not a test."* Every level below is wired into CI in §11 or it is
not written.

### 10.1 Unit — `libs/common`

- `parseEnvironment` with a complete env: every value present, `missing` empty, trailing slash
  stripped from `PUBLIC_BASE_URL`.
- `parseEnvironment` with a hollow env: `missing` lists all six in declaration order; `values` carry
  `[ REQUIRED: PIC_LEGAL_NAME ]` etc. with exact spacing.
- `parseEnvironment` with a partially-filled env: only the absent ones are marked.
- Invalid `DPO_EMAIL` (`not-an-email`) is treated as missing, not passed through. A malformed contact
  is not better than an absent one.
- Invalid `PUBLIC_BASE_URL` (`peraplano.filhmar.online`, no scheme) throws — this one is a
  configuration error, not a missing legal fact, and it has a default, so silence is not an option.
- `assertProductionConfig` throws `MissingComplianceConfigError` naming **all** missing fields, and
  does **not** throw when `missing` is empty. Both directions, per the owner's "fail-loud proven both
  ways."
- Logger: emits one JSON line per call; respects `LOG_LEVEL`; redacts matching field names.
- `buildHealthReport`: shape, and that it reports `configComplete` without field names.

### 10.2 Content and drift

- **The §4 drift test** (§6.4) — the highest-value test in the suite.
- `markdown_table.ts` units: bold, links, backticks, whitespace, and the named escaped-pipe case;
  `extractSection` throwing usefully on a renamed heading.
- **`ServiceStatusNotice` consistency**: `/privacy` and `/data-deletion` render byte-identical text.
- **`SERVICE_CAPABILITIES` tripwire**: `accounts === false`, with the comment naming what must be
  written before it flips.
- **No hostname literal**: no file under `apps/web/app/` or `apps/web/components/` contains
  `filhmar.online`. A `readdir`-walk test, not a lint rule, so it is visible in the suite output.
- **Every page renders**: for each of the six content components, `renderToStaticMarkup` with a
  complete fixture produces an `<h1>` whose text is non-empty and contains no `[ REQUIRED:`.
- **`/terms` carries the counsel block**: asserts `CounselRequiredNotice`'s heading is present, so its
  removal is a deliberate act in a diff (§4.4).

### 10.3 Route inventory

One test asserts that the set of route files under `app/[locale]/` is exactly the six expected, and
that each of the six appears in the header nav and the footer nav. Adding a page without linking it is
the most common way a small site grows an orphan, and on a compliance site an unlinked page is one a
reviewer will not find.

### 10.4 Smoke, against a real production build

A separate Vitest project (`vitest.smoke.config.ts`, script `npm run test:smoke`) whose global setup:

1. runs `npm run build -w @peraplano/web`
2. boots `node .next/standalone/apps/web/server.js` on an ephemeral port with a **complete** env
3. waits for `/api/health` to answer 200

Then, for each of the nine routes: status is 200 (or 308 for `/`), the body contains a non-empty
`<h1>`, and the body contains no `[ REQUIRED:` anywhere. Plus `/robots.txt` and `/sitemap.xml` contain
the configured `PUBLIC_BASE_URL` and not a hardcoded host.

This is the level that proves the §5.3 reasoning — that a production build with runtime env serves
real values rather than baked markers. Nothing cheaper proves it, because the failure mode is
specifically about the build/runtime boundary.

It is slow (a full `next build`). It runs in CI as its own job, and it is **not** part of
`npm test` — the fast suite must stay fast enough that people run it.

---

## 11. CI

`.github/workflows/server-ci.yml`, the repo's first workflow. Path-filtered to `server/**`,
`docker-compose.yml`, `.github/workflows/server-ci.yml`, **and `docs/07-privacy-and-compliance.md`** —
that last one is not optional. The drift test's entire purpose is to fail when that document changes,
and a path filter that omits it makes the test unreachable from the change that should trigger it.

Jobs, per blueprint §14 Phase 1 ("CI gate — lint, typecheck, unit tests, secret scan"):

| Job | Command |
|---|---|
| lint | `npm run lint` (ESLint flat config, `eslint-config-next` + `typescript-eslint`) |
| typecheck | `npm run typecheck` (`tsc --noEmit` across both packages) |
| test | `npm test` (Vitest, §10.1–10.3) |
| build | `npm run build -w @peraplano/web` |
| smoke | `npm run test:smoke` (§10.4) |
| secret-scan | `gitleaks` over the diff |

`build` and `smoke` share a step in practice; they are listed separately because a build failure and a
smoke failure mean different things and should be distinguishable from the job list.

---

## 12. What this design does **not** do

Recorded so the fence is legible to the next reader, and so nobody re-derives these from scratch:

- **No contact form.** A form means accepting personal data, which makes the web tier a processing
  activity with its own lawful basis, retention period and §4 row. A `mailto:` link creates no such
  obligation. The privacy notice gets simpler by exactly one section.
- **No analytics of any kind**, including self-hosted. §2.3, and privacy §1's "no third-party
  analytics."
- **No cookies.** Theme preference uses `localStorage`, which is not a cookie and is not transmitted
  — so there is no cookie banner and nothing to disclose.
- **No database, cache, broker, gateway, or second service.** §2.2.
- **No Filipino translation.** The slot exists (`messages/fil.json` is absent, `SUPPORTED_LOCALES` has
  one entry, no switcher renders). Translating legal text is a job for someone qualified to translate
  legal text.
- **No edit to `docs/07-privacy-and-compliance.md`.** It is a legal source document, it is the drift
  test's input, and §2.4/§2.6 attach process to changing it. §13 lists what needs changing.

---

## 13. Open items — owner and counsel actions

These are outside the fence. None is built.

1. **The six env values.** `PIC_LEGAL_NAME`, `PIC_ADDRESS`, `DPO_NAME`, `DPO_EMAIL`, `SUPPORT_EMAIL`,
   `NPC_REGISTRATION`. Until they exist, production cannot boot — deliberately.
2. **`docs/07-privacy-and-compliance.md` §4 has no row for installed-package enumeration.** Found
   while writing §4.5. §5.5 requires a lifecycle-table entry for data the product handles, and §2.4
   requires the notice and the architecture to agree. A row 9 is needed (originates: `PackageManager`
   query at onboarding; stored: not persisted beyond the derived provider selection; retention: n/a;
   leaves device: never), with the notice revision §2.4 demands in the same release. **Owner + DPO
   action.** `/installed-apps` describes the handling correctly today, but it is describing it on this
   spec's authority, not the compliance document's.
3. **`/terms` §6's clause list.** Counsel must draft governing law, liability and warranty,
   subscription/refund terms, IP and licence, termination, change notification, and an effective date.
   PeraPlano Plus cannot be offered for sale before then.
4. **The privacy notice has not been reviewed by Philippine privacy counsel**, and §2.5 explicitly
   defers the registration question to them. The page says so; that is a stopgap, not a resolution.
5. **DNS.** `peraplano.filhmar.online` must resolve to the box before `certbot --nginx` can issue.
   Not an application concern, but it is the step that blocks the first deploy.
6. **`fil.json`.** Plus the structural parity check described in §6.2.
7. **A Play Store badge and listing URL** for `/`'s hero slot, once a listing exists.

---

## 14. Cross-references

- `docs/07-privacy-and-compliance.md` — the source of truth for pages 2, 3, 5 and 6, and the drift
  test's input
- `docs/00-product-brief.md` — the source for pages 1 and 4
- `docs/superpowers/specs/2026-08-19-device-issues-triage-and-roadmap.md` §0.2 — the
  `QUERY_ALL_PACKAGES` decision and its recorded risk
- `docs/10-web-design-prompt.md` and `docs/pera-plano-web/*.dc.html` — the approved visual identity
- `assets/brand/README.md` — asset inventory, and the SMIL fact
- `D:\My Folder\fill-main\docs\nginx\filhmar-production.conf`, `D:\My Folder\fill-main\docker-compose.yml`,
  `D:\My Folder\fill-main\Dockerfile` — the deployed structural precedent on the same box
- `C:\Users\olajo\Desktop\usapp\usapp_backend\docs\STACK_BLUEPRINT.md` §§2, 3.0, 6, 7, 12, 14, 15 —
  the owner's reference stack

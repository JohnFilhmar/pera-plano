# PeraPlano: Codebase Gap Analysis Prompt (for Claude Fable 5.1)

This document is a handoff artifact, not a spec. Copy everything below the horizontal rule into
a fresh Fable 5.1 session that has read access to this repository. Nothing needs replacing: the
placeholders are already filled from a verified inventory of the repo at the commit named in the
Input Context. If you hand this off from a much later commit, re-check the counts in the
`REPOSITORY MAP` section first and correct anything that has drifted.

The analyst session is **read only**. It produces a work queue. It fixes nothing.

---

## ROLE

You are a principal engineer performing a full gap audit of the PeraPlano codebase before
handing remediation work to a fleet of autonomous coding agents. Your output is not a report for
humans to admire. It is a work queue. Every entry you write will be picked up by an agent that
has repository access but no memory of this conversation, no product context, and no ability to
ask you follow-up questions.

Write accordingly. If an agent could misread an item, rewrite the item.

You do not change code in this session. No edits, no commits, no branches. If you find something
alarming, it becomes an `S1` entry at the top of the queue, not a patch.

## INPUT CONTEXT

- **Repository root:** `D:\My Folder\pera-plano` (git repo, default branch `master`)
- **Baseline commit:** `26cb148` (`feat(scripts): tell testers the build cleared review early`).
  Record the actual `git rev-parse HEAD` you see in the metadata block; if it differs from this,
  say so and note that this prompt was written against `26cb148`.
- **Product:** PeraPlano, a Philippines-first Android personal finance app. It captures bank and
  e-wallet push notifications through an Android `NotificationListenerService`, parses them on
  device, and builds a categorized ledger with no manual transaction entry. The planning layer on
  top is Wallets, Limits, Goals, Loans, Bills, Review Queue, Safe-to-Spend. Read
  `docs/00-product-brief.md` and `docs/01-mvp-scope.md` before anything else: they are the
  binding statements of intent.
- **Primary stack:**
  - `mobile/`: Expo SDK 54, React Native 0.81.5, React 19.1, TypeScript 5.9, Expo Router 6,
    NativeWind 4 over Tailwind 3, TanStack Query 5 with an AsyncStorage persister,
    `@op-engineering/op-sqlite` 17 built with SQLCipher, `@noble/ciphers` and `@noble/hashes` for
    app-layer crypto, `expo-secure-store`, `expo-local-authentication`, `expo-notifications`,
    `expo-updates`. Tests are Jest 29 with `jest-expo` and `@testing-library/react-native`.
  - `mobile/modules/notification_listener/`: a first-party Expo native module in Kotlin. This is
    the ingest boundary and the highest-consequence code in the repo. It has JVM unit tests under
    `android/src/test/` and instrumented tests under `android/src/androidTest/`.
  - `server/`: an npm workspaces monorepo on Node 22 ESM. `apps/web` is a Next.js App Router site
    with locale routing (`app/[locale]/`) and two API routes (`app/api/health`,
    `app/api/beta-signup`). `libs/common` holds config, content, correlation, health, logging.
    Tests are Vitest, with a separate smoke config under `server/smoke/`.
- **Deployment target:** Android APK/AAB via EAS for the app, with EAS Update channels per build
  profile. The web side is a Docker Compose deployment (`docker-compose.yml` plus `.override`,
  `.staging`, `.production`) fronted by nginx (`docs/nginx/`), described in `docs/DEPLOYMENT.md`.
  CI is GitHub Actions: `.github/workflows/server-ci.yml` and `.github/workflows/deploy.yml`.
- **Project stage:** pre-launch. The mobile MVP is the live workstream; the server and web front
  end trail it. Closed beta invitations are being sent (`scripts/beta_invites/`). Treat "ships to
  a real Filipino user's phone soon" as the deadline pressure behind every severity call.
- **Team size and agent fleet:** one human owner, plus a fleet of autonomous coding agents working
  concurrently in separate git worktrees under `.claude/worktrees/`. Assume 3 to 5 agents can run
  at once, which is why wave conflict-freedom in the execution order matters concretely.
- **Known constraints:**
  - **Local-first is architectural, not a preference.** Transaction data lives on the device in an
    encrypted SQLite database. Any proposal that moves ledger data to a server contradicts the
    product brief and must be raised as a `CONTRA` decision brief, never implemented as a fix.
  - **Android only.** No iOS work. `NotificationListenerService` is the entire premise.
  - **Play Store policy exposure.** Notification access is a sensitive permission with a Google
    Play declaration attached to it. Anything that widens what the listener reads, stores, or
    transmits is at minimum `S2` and probably `SEC`.
  - **PH Data Privacy Act.** Financial notification content is personal and sensitive data. There
    is no registered PIC entity or DPO yet, so any code path that ships user financial content off
    the device is `S1` until proven otherwise. See `docs/07-privacy-and-compliance.md`.
  - **Naming convention.** `snake_case` for variables, functions, files, directories, database
    columns and JSON fields. `PascalCase` only where the framework mandates it: components,
    classes, types, enums, Expo Router and Next.js special files. Existing files stay internally
    consistent, so a camelCase file is not automatically a gap. Report convention drift as `PROJ`,
    only where it is systemic, and never propose drive-by renames.
  - **No AI attribution** in any git artifact this repo produces. Do not write commit or PR text
    that adds one, and do not propose checklist steps that would.
- **Explicitly out of scope.** Do not read, count, or report gaps in:
  - any `node_modules/`, `.git/`, `.expo/`, `dist/`, `build/`, `.next/` directory
  - `mobile/android/`, which is generated by `expo prebuild` and is not hand-authored. The
    hand-written native code is `mobile/modules/notification_listener/`, which **is** in scope,
    minus its `android/build/` output
  - `mobile/.scratch_backup/`, `mobile/dist/`, `mobile/.eas/`
  - `.claude/`, `.superpowers/`, `pera-plano screenshots 09-01/`
  - lockfiles as prose. You may cite them for dependency facts, but do not audit their contents
  - generated Android artifacts of any kind (`.dex`, `.transforms`, `.bin`)

If anything above turns out to be wrong when you look, correct it in the Assumptions section and
carry on. Do not stall waiting for clarification.

## REPOSITORY MAP

Verified by inventory at `26cb148`, excluding `node_modules`, `mobile/android/`, `dist`, `.next`.
Use it to orient, then verify anything you intend to cite.

| Area | Path | Rough size | Notes |
|---|---|---|---|
| Mobile app | `mobile/` | ~671 `.ts`/`.tsx` files | Expo Router app under `mobile/app/`, domain logic under `mobile/lib/`, network and device seams under `mobile/services/` |
| Mobile domain modules | `mobile/lib/` | 30+ subdirectories | `ingest`, `review`, `transactions`, `transfers`, `wallets`, `limits`, `goals`, `loans`, `bills`, `income`, `recurring`, `reports`, `money`, `crypto`, `security`, `privacy`, `db`, `alerts`, `diagnostics`, `onboarding`, `events`, `ui`, `support`, plus `safe_to_spend*.ts`, `entitlements.ts`, `period.ts`, `dates.ts`, `clock.ts`, `ids.ts` |
| Native ingest module | `mobile/modules/notification_listener/` | 9 Kotlin sources under `android/src/main`, 12 under `android/src/test`, 2 under `android/src/androidTest` | `PeraPlanoNotificationListenerService.kt`, `NotificationListenerModule.kt`, `CaptureBuffer.kt`, `CaptureEnvelope.kt`, `CapturePrefs.kt`, `CaptureRecord.kt`, `KeyVault.kt`, `KeyStoreBridge.kt`, `AppLabels.kt`, plus `app.plugin.js` config plugin |
| Test support | `mobile/test_support/` | 6 helpers | `db.ts`, `jest_setup.ts`, `jest_setup_after_env.ts`, mocks |
| Server | `server/` | ~86 `.ts`/`.tsx` files | npm workspaces, `apps/web` and `libs/common` |
| Smoke tests | `server/smoke/` | 2 files | separate Vitest config |
| Tests overall | both trees | ~272 `*.test.*` / `*.spec.*` files | count includes colocated `__tests__` directories |
| Scripts | `scripts/` | includes `scripts/beta_invites/` | operational scripts, beta tester mailer |
| Infra | repo root | 4 compose files, `docs/nginx/` | plus `.github/workflows/{server-ci,deploy}.yml` |

**The documentation set is your intent baseline.** Read all of it before Pass 2:

`docs/00-product-brief.md`, `01-mvp-scope.md`, `02-domain-model.md`, `03-ingest-pipeline.md`,
`04-features/01-onboarding.md` through `04-features/11-settings-privacy.md`,
`05-monetization.md`, `06-information-architecture.md`, `07-privacy-and-compliance.md`,
`08-risks-and-open-questions.md`, `09-v2-backlog.md`, `10-web-design-prompt.md`,
`11-mobile-app-design-prompt.md`, `12-encryption-and-app-lock.md`,
`13-on-device-verification.md`, `14-design-revamp-prompt.md`, `DEPLOYMENT.md`,
`build-variants-adb-install.md`, plus `HANDOFF.md` at the repo root.

Most of these are marked `Draft v1 · 2026-08-02`. The code has moved since. That gap between a
dated spec and current code is exactly where `CONTRA` findings live, so read the dates.

## EXECUTION PROTOCOL

Work through these passes in order. Do not begin writing the deliverable until Pass 4.

**Pass 0: Inventory.**
Map the repository before reading it deeply. Record directory structure, entry points, build and
test configuration, CI definitions, dependency manifests, migration folders, environment variable
usage, and every documentation artifact you can find (the `docs/` set above, `HANDOFF.md`, inline
module docs, comments marked TODO/FIXME/HACK/XXX, changelogs, commit messages where history
helps). Note the total file count and approximately how much of it you actually read. That number
goes in the Coverage section. Check the schema and migration story specifically: find where the
SQLite schema is defined under `mobile/lib/db/` and whether migrations exist, are ordered, and are
reversible.

**Pass 1: Read for intent.**
Determine what the system is supposed to do, from `docs/`, tests, type signatures, API contracts,
and naming. Build a mental model of the intended architecture. For PeraPlano specifically, write
down for yourself the intended ingest pipeline stage order from `docs/03-ingest-pipeline.md`
before you read any ingest code, so Pass 2 is a real comparison rather than a rationalization.

**Pass 2: Read for reality.**
Determine what the system actually does. Trace at minimum these critical paths end to end, and say
in the Coverage section which of them you traced fully and which you sampled:

1. **Capture.** Android notification posted, through `PeraPlanoNotificationListenerService.kt`,
   into the encrypted `CaptureBuffer`, across the Expo module boundary, into JS.
2. **Ingest.** Buffer drain, provider matching, parse, dedupe, transfer detection, categorization,
   wallet attribution, ledger write. Compare against `docs/03-ingest-pipeline.md` stage by stage.
3. **Review Queue.** Low-confidence parse to queued item, to user confirm or correct, to UserRule
   creation, to rule replay. This path has already produced at least one duplicate-card defect in
   the past, so treat "one notification becomes several cards" as a known defect class and check
   whether the class is closed, not just the instance.
4. **Money arithmetic.** Every place an amount is represented, parsed, summed, rounded, or
   displayed. Establish whether the codebase uses integer minor units consistently. Any float peso
   arithmetic is a finding.
5. **Period and calendar math.** Kinsenas (15th and end of month) income cadence, period
   boundaries in `mobile/lib/period.ts` and `mobile/lib/dates.ts`, timezone handling for
   Asia/Manila, month-end and leap-day behavior, and the recurring decay rule.
6. **Safe-to-Spend.** `mobile/lib/safe_to_spend.ts`, `safe_to_spend_projection.ts`,
   `safe_to_spend_service.ts`. This is the single number the whole product promises. Trace every
   input into it and every assumption it makes about missing data.
7. **Crypto and app lock.** `mobile/lib/crypto/`, `mobile/lib/security/`, `KeyVault.kt`,
   `KeyStoreBridge.kt`, SQLCipher key handling, `expo-secure-store` usage, biometric gating, key
   invalidation on biometric enrollment change. Compare against
   `docs/12-encryption-and-app-lock.md` and the measured results in
   `docs/13-on-device-verification.md`.
8. **Entitlements.** `mobile/lib/entitlements.ts`. `docs/01-mvp-scope.md` says gating is built but
   hardcoded to `plus` during MVP. Verify that this is one flag and not a scatter of conditionals,
   and that flipping it later cannot silently break a built feature.
9. **Server surface.** `server/apps/web/app/api/beta-signup` and `app/api/health`: input
   validation, rate limiting, what is logged, what is stored, and whether anything there touches
   personal data.
10. **Sync and network seams.** `mobile/services/api.ts`, `parser_rules.ts`, `telemetry.ts`,
    `support_reports.ts`, `device_info.ts`. Establish exactly what leaves the device, when, and
    whether the user consented. This is the highest-risk area for both privacy and Play policy.

Note every place reality diverges from intent.

**Pass 3: Cross-check and triangulate.**
Compare documentation against code, code against tests, tests against configuration, configuration
against deployment, and every decision record against the decision actually implemented.
Contradictions live in these seams. Also compare modules against each other: two subsystems
solving the same problem in incompatible ways is a contradiction even when each one is internally
consistent.

For this repo, check these seams by name:

- `docs/` (dated 2026-08-02, mostly Draft v1) against the code as it stands now.
- `docs/13-on-device-verification.md` against itself. It contains superseded rows that later
  sessions corrected in place, and at least one stale row has previously misled a reader into
  rebuilding a gate that already had a number. If you cite that document, cite the most recent
  session block and say which one you used.
- `mobile/` tests against `mobile/` code: find tests that mock the seam they are meant to prove.
  Prior work in this repo flagged that some API tests seam out Google services entirely, to the
  point that a fake Play Integrity key still boots and passes health. Verify whether that is still
  true rather than assuming either way.
- The Kotlin unit tests against the instrumented tests. A `FakeKeyVault` passing in JVM tests
  proves nothing about real Android Keystore behavior.
- `app.config.js` and `app.json` build variants against `eas.json` profiles and channels.
- Compose files against `docs/DEPLOYMENT.md` and against `.github/workflows/deploy.yml`.
- `package.json` scripts against what CI actually runs. `mobile/package.json` has `test` and
  `typecheck` but no `lint` script, while `server/package.json` has `lint`. Decide whether that
  asymmetry is a real `PROJ` gap or a deliberate choice, and say which.

**Pass 4: Write the deliverable.**

**Pass 5: Self-audit.**
Before returning, re-read your own output against the Quality Bar below and fix violations. State
in the final section how many entries you revised or dropped during this pass. An audit that drops
nothing is usually an audit that did not happen.

## WHAT COUNTS AS A GAP

Classify every finding into exactly one category. Use the ID prefix shown.

| Prefix | Category | Covers |
|---|---|---|
| `CODE` | Code and implementation gaps | Dead code, duplicated logic, missing error handling, unhandled edge cases, race conditions, unbounded loops or buffers, missing input validation, leaked resources, silent failures, type escapes (`any`, non-null assertions, boundary `as` casts, Kotlin `!!`, bare `catch`), hardcoded values that should be configuration |
| `FEAT` | Feature gaps | Functionality implied by the UI, `docs/`, types, routes, schema, or tests but not actually built. Partially built features. Features built but not wired up. Stubs that return fixtures |
| `TEST` | Verification gaps | Untested critical paths, tests that assert nothing, tests that mock the thing under test, missing integration coverage, flaky or skipped tests, absent regression tests for past incidents |
| `SEC` | Security and data integrity gaps | Key handling and Keystore misuse, plaintext at rest, notification content leaving the device, secrets in the repo, missing rate limits on server routes, unsafe deserialization of the capture buffer or parser rules, permissive CORS, PII handled without controls, logging that captures financial content |
| `OPS` | Operational gaps | Missing observability, no health checks, absent or irreversible schema migrations, no rollback path for an OTA update, missing CI gates, unpinned dependencies, no alerting, build variants that can ship the wrong package id |
| `DOC` | Documentation gaps | Undocumented public interfaces, stale setup steps, missing onboarding path, absent decision records for load-bearing decisions, docs describing removed behavior, missing runbooks |
| `PROJ` | Project and process gaps | No dependency update path, no versioning policy, inconsistent tooling or formatting, missing contribution rules, orphaned branches or feature flags, abandoned experiments still in the build, scratch directories committed to the tree |
| `CONTRA` | Contradicting decisions | See the dedicated section below |

### PeraPlano-specific gap hunting list

These are domain invariants for this product. A violation of any of them is a real finding, and
each one should be actively checked rather than waited for:

- **No transaction may exist without a wallet.** `docs/04-features/02-wallets.md` states there are
  no orphan transactions. Verify the schema and the write path both enforce it.
- **Dedupe must be idempotent.** The same notification delivered twice, or a push and its SMS
  twin, must not produce two ledger rows and must not produce two Review Queue cards. Check the
  dedupe key, the time window, and what happens when the reference number is absent.
- **A correction must become a rule exactly once.** Confirming a Review Queue item creates a
  UserRule that replays. Check for double-creation, for rules that never replay, and for rule
  conflicts with no resolution order.
- **Money is never a float.** Check parsing, storage, summation, projection, and display.
- **Periods respect Asia/Manila and kinsenas.** Check the 15th, the 30th, the 31st, February, and
  the case where a payday falls on a weekend.
- **The listener survives reboot and process death.** Check the boot receiver, the buffer's
  durability, and what happens when the buffer fills while the app has never been launched.
- **Nothing readable leaves the capture buffer.** Verify the buffer holds ciphertext only and that
  no log statement, crash reporter, or support report can serialize plaintext notification text.
- **The app lock actually locks.** Check that the database key is not recoverable while locked and
  that biometric enrollment changes are handled rather than crashed on.
- **Entitlement gating is one flag.** Check that `tier` is read in one place.
- **Cash is the only manual path.** Any other feature that requires routine manual entry
  contradicts the core promise in `docs/00-product-brief.md` and is a `CONTRA`, not a `FEAT`.

## CONTRADICTING DECISIONS: SPECIAL HANDLING

A contradiction is any place where the system holds two incompatible positions at once. Hunt for
these specifically, since they are the findings most often missed:

- Documentation or a decision record states one approach; the code implements another.
- Two modules implement the same concern with different, incompatible conventions: two date
  handling strategies, two crypto approaches, two error formats, two ID schemes, two ways of
  representing an amount, two definitions of a period boundary.
- A schema constraint contradicts application-level validation.
- Configuration defaults contradict documented defaults or deployment values.
- A test asserts behavior that the code no longer produces, or the reverse.
- Comments contradict the code they sit above.
- A naming or layering rule is declared, then violated in the majority of cases.
- Type definitions contradict runtime behavior or API responses.
- Migration history contradicts the current schema definition.
- A document contradicts a later block inside the same document.

For every `CONTRA` entry you must additionally record:

1. **Position A** with its evidence and apparent date or origin.
2. **Position B** with its evidence and apparent date or origin.
3. **Which position appears authoritative and why**, or an explicit statement that you cannot
   determine it from the repository alone. For this repo the usual ordering of authority is:
   verified on-device measurement, then current code, then `docs/01-mvp-scope.md` as the binding
   scope contract, then the rest of `docs/`. Say when you depart from that ordering.
4. **Blast radius**: every file, behavior, and downstream consumer affected by picking one side
   over the other.
5. **Decision required**: whether an agent may resolve this autonomously, or whether it is a
   product or architecture call that requires the human owner. Never let an agent guess at a
   decision that changes product behavior, changes what data leaves the device, changes the
   monetization boundary, or changes a Play Store declaration. Mark these
   `RESOLUTION: HUMAN REQUIRED` and write the decision brief the human needs rather than a fix
   checklist.

## SCORING RUBRIC

Score every gap on all six axes. Use these exact scales, since the sort order depends on them
being comparable across entries.

**Severity (impact if left unfixed)**
- `S1 Critical`: ledger data loss or corruption, plaintext financial data exposed or transmitted,
  app lock bypass, Play policy violation, or a defect whose recovery would destroy user data.
  Fix now.
- `S2 Major`: broken or missing core functionality, silent incorrectness in the ledger or in
  Safe-to-Spend, ingest that drops or duplicates transactions, blocks other work.
- `S3 Moderate`: degraded quality, real maintenance drag, poor experience under edge cases.
- `S4 Minor`: cosmetic, stylistic, or theoretical. Safe to defer indefinitely.

Calibration for this repo: a wrong Safe-to-Spend number is `S2` at minimum, because the entire
product promise is that the number is trustworthy. A missing empty-state illustration is `S4`.

**Complexity (size of the change)**
- `XS`: single file, under 20 lines, no design thinking required.
- `S`: one module, under 200 lines, obvious approach.
- `M`: several modules, requires reading surrounding code, one design choice.
- `L`: cross-cutting, touches contracts or schema, needs a plan before code.
- `XL`: architectural. Must be split into sub-gaps before any agent starts.

Anything that changes the SQLite schema is `L` at minimum, because existing beta installs carry
real data and a migration must be written and be reversible.

**Difficulty (skill and judgment required, independent of size)**
- `D1 Mechanical`: deterministic, verifiable, no domain knowledge needed.
- `D2 Standard`: routine engineering, some codebase familiarity.
- `D3 Specialist`: needs concurrency, cryptography, Android platform, performance, or PH financial
  domain expertise. Everything in `mobile/lib/crypto/`, `mobile/lib/security/`, and the Kotlin
  keystore path is `D3` by default.
- `D4 Judgment`: correct answer depends on product or business intent, not on code.

**Risk of the fix itself**
- `R1` isolated, `R2` touches shared code, `R3` changes a public contract or data shape,
  `R4` irreversible or migration-bearing. Anything touching the encrypted database, the key
  hierarchy, or an already-shipped OTA channel is `R4`.

**Confidence in the finding**
- `C1 Verified`: you read the exact code and can cite it.
- `C2 Strong`: consistent evidence across several sources.
- `C3 Inferred`: pattern-based suspicion, needs confirmation before work begins.

Never present a `C3` finding with the confident phrasing of a `C1` finding. If you did not read
it, say you did not read it. On-device behavior that you cannot execute from this session is `C2`
at best, no matter how sure you are.

**Agent suitability**
- `AGENT-READY`: an autonomous agent can complete and self-verify this unsupervised.
- `AGENT-ASSISTED`: an agent can do the work but a human must review before merge.
- `HUMAN-FIRST`: a decision, a physical device, or access is required before any agent can start.

Anything whose acceptance criteria can only be proven on the physical Samsung A54 test device is
`HUMAN-FIRST`, since no agent in the fleet can run an instrumented test on hardware. Say so in the
entry rather than pretending a JVM test proves it.

## SORTING AND ORDERING RULES

The deliverable must be sorted, not merely grouped. Apply these rules:

1. The master index is sorted by **priority score**, descending. Compute it as:
   `Priority = (Severity weight x Confidence weight) / Complexity weight`
   using S1=8, S2=5, S3=2, S4=1; C1=1.0, C2=0.8, C3=0.5; XS=1, S=2, M=4, L=7, XL=12.
   Show the computed number to one decimal place so the ordering is auditable.
2. Ties break by lower risk first, then by lower difficulty first.
3. A gap may never be ordered above a gap it depends on. If the priority score would place it
   higher, override the score and record `ORDER OVERRIDE: blocked by GAP-XXX`.
4. Produce three additional views of the same set, each fully sorted:
   - **By category**, then by priority within the category.
   - **By complexity ascending**, so a fleet can clear quick wins in parallel.
   - **Recommended execution order**, a dependency-respecting sequence grouped into waves. Every
     gap in a wave must be safe to execute concurrently with every other gap in that same wave,
     with no file conflicts between them. State the conflict check you performed by listing the
     file set per gap in each wave and confirming those sets are disjoint. Agents here work in
     separate worktrees and merge into `master`, so two gaps touching the same file in one wave
     produce a real merge conflict, not a hypothetical one.

## OUTPUT

Write a single file at the repository root: `GAP_ANALYSIS.md`. Use exactly this structure.

```
1. Metadata block (YAML front matter: repo, commit SHA, date, analyzer, total gaps,
   counts by severity, counts by category, coverage percentage)
2. Executive Summary (max 300 words, plain language, leads with the three findings that
   matter most and the single biggest structural risk)
3. Assumptions and Unknowns
4. Coverage Report (what was read, what was skipped, why, and what that omission might hide,
   including which of the ten critical paths you traced fully and which you sampled)
5. Master Index (table, sorted by priority score)
6. Index by Category
7. Index by Complexity
8. Recommended Execution Order (waves, with the per-wave file-conflict check)
9. Contradiction Register (all CONTRA entries, with decision briefs)
10. Gap Detail Entries (full spec per gap, in master index order)
11. Deferred and Rejected (things you considered and consciously did not list, with reason)
12. Machine-Readable Appendix (a single fenced JSON array of every gap with all scoring fields,
    dependencies, and file paths, so an orchestrator can parse it without reading prose)
13. Self-Audit Note
```

### Gap detail entry template

Every entry in section 10 must follow this template exactly. No entry may omit a heading. If a
heading does not apply, write `N/A` and one clause explaining why. The example below shows the
shape and the expected level of specificity. It is not a real finding in this repo, and the paths
in it are illustrative placeholders that you must replace with paths you actually observed.

```markdown
### GAP-014 [CODE] Dedupe window drops the reference number when the SMS twin arrives first

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 2.5 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | GAP-031 |
| Est. agent turns | 3-6 |

**Location**
- `mobile/lib/ingest/<observed_file>.ts:<observed_lines>` (primary)
- `mobile/lib/review/<observed_file>.ts:<observed_line>` (caller)
- `mobile/lib/ingest/__tests__/<observed_file>.test.ts` (coverage absent)

**Evidence**
Quote or describe the exact code or document text that establishes the gap. Cite by `path:line`.
Do not paraphrase where the literal text is the point.

**What is wrong**
Two to four sentences. Mechanism, not adjectives. Describe what actually happens at runtime and
under which conditions.

**Why it matters**
Concrete consequence tied to a real scenario, in user terms. A PeraPlano user sees X on their
Transactions tab and their Safe-to-Spend is wrong by Y. If you cannot name the consequence, the
severity is lower than you assigned it.

**Intended behavior**
What correct looks like, stated precisely enough to be testable. Cite the doc that says so where
one exists.

**Proposed fix**
The approach, in two to five sentences. Name the specific pattern, module, or structure. If more
than one approach is reasonable, name the alternatives and state which you recommend and why, so
the agent does not re-litigate the choice.

**Implementation checklist**
- [ ] Ordered, atomic steps. Each one is a single verifiable action.
- [ ] Every step names the file it touches.
- [ ] Steps are small enough that a failure isolates cleanly to one step.
- [ ] Maximum 12 top-level steps. If you need more, split the gap.
- [ ] Include the test-writing steps, not just the code steps.
- [ ] Include the documentation update step when behavior changes.

**Acceptance criteria**
- [ ] Objectively checkable statements about the finished state.
- [ ] Written so a reviewer who has never seen the gap can verify it in under five minutes.

**Verification commands**
```bash
# Exact commands, from the stated working directory, with the expected signal
cd mobile && npm test -- lib/ingest
cd mobile && npm run typecheck
```

**Do not**
Explicit scope fence. Name the refactors, renames, and adjacent cleanups the agent must not
perform while fixing this, so the diff stays reviewable. Always include: do not rename files or
symbols to match the naming convention as part of this fix.

**Rollback**
How to revert safely, including any data or migration considerations. If the change touches the
encrypted database, state what happens to an existing beta install that has already migrated.

**Open questions**
Anything the human owner must answer, or `none`. If this list is non-empty, agent suitability
cannot be AGENT-READY.
```

### Verification commands you may rely on

These exist and are verified. Use them in entries. Do not invent others.

```bash
# Mobile
cd mobile && npm test          # jest --ci
cd mobile && npm run typecheck # tsc --noEmit

# Server
cd server && npm test          # vitest run
cd server && npm run test:smoke
cd server && npm run typecheck
cd server && npm run lint
```

Notes that matter when you write a Verification section:

- `mobile/package.json` has **no** `lint` script. Do not write `cd mobile && npm run lint`.
- Kotlin unit tests live in `mobile/modules/notification_listener/android/src/test/` and
  instrumented tests in `android/src/androidTest/`. They run through Gradle from `mobile/android/`,
  but the exact Gradle task name is generated by Expo autolinking and was not confirmed during
  this inventory. If a gap needs one, write
  `# confirm task name first: cd mobile/android && ./gradlew projects` rather than guessing a task
  path. Guessed Gradle tasks are invented paths and violate the Quality Bar.
- Instrumented tests need the physical Android device. Any acceptance criterion that depends on
  one makes the entry `HUMAN-FIRST`.

## QUALITY BAR

These rules are not stylistic preferences. Violating them makes the deliverable unusable.

**Evidence over impression.** Every gap cites at least one concrete location. A finding you cannot
cite is a hypothesis, and hypotheses go in Deferred with a note on how to confirm.

**No invented paths.** Never write a file path, function name, symbol, line number, npm script, or
Gradle task you did not observe. If you are reconstructing from memory, mark it and verify it.

**Root causes, not symptoms.** If eight files share one broken helper, that is one gap with eight
locations, not eight gaps. Deduplicate aggressively and say what you merged.

**Right-sized proposals.** Prefer the smallest change that closes the gap. Propose a rewrite only
when a patch would leave the defect class in place, and justify it explicitly.

**No speculative features.** A missing feature is only a `FEAT` gap when something in the
repository implies it should exist: a route, a schema field, a type, a doc line, a test, a disabled
control. `docs/09-v2-backlog.md` is explicitly deferred work, so nothing in it is a gap. Do not
invent a product roadmap.

**Calibrated severity.** Not everything is critical. If more than about 15 percent of your findings
are S1, re-score them. Inflated severity destroys the value of the sort order.

**Self-contained entries.** Assume the agent reads exactly one section and the repository. No entry
may depend on the reader having seen another entry, except through the explicit `Depends on` field.

**Honest coverage.** If you sampled rather than read exhaustively, say so, say which parts, and say
what a full read might change. With roughly 750 source files in scope, sampling is expected.
Understating coverage is safe. Overstating it means someone trusts a clean bill of health that was
never earned.

**On-device claims stay honest.** `NOT RUN` never becomes `PASS`. If a behavior can only be proven
on hardware, say that it is unproven and mark the entry accordingly. This repo has already been
bitten once by a stale verification row being read as current.

**Decisions stay with humans.** When a fix requires choosing between valid product behaviors, hand
up a decision brief. Do not let a checklist silently encode a guess. Monetization boundaries,
anything that changes what data leaves the device, and anything touching the Play Store
notification access declaration are always human decisions.

**Respect the conventions, do not enforce them opportunistically.** Report systemic convention
drift as a single `PROJ` gap. Never attach a rename to an unrelated fix.

**No padding.** Twenty real gaps beat sixty entries where forty are formatting nits. If an area is
genuinely healthy, write one line saying so and move on.

**Plain language.** Short sentences. No em dashes. No filler openers. A tired engineer at the end
of a long day should be able to follow every step on the first read.

## BEFORE YOU RETURN

Confirm each of the following in the Self-Audit Note:

- [ ] Every gap has a unique ID, a location, and all six scores.
- [ ] The master index is correctly sorted and the priority arithmetic is right.
- [ ] No dependency is ordered after its dependent.
- [ ] Every wave in the execution order is genuinely conflict-free, with the file sets shown.
- [ ] Every checklist item is atomic and names a file.
- [ ] Every AGENT-READY entry has zero open questions.
- [ ] Every CONTRA entry names both positions and states who decides.
- [ ] Every verification command is one that exists in this repo.
- [ ] No entry proposes moving ledger data off the device without a CONTRA decision brief.
- [ ] The JSON appendix parses and matches the prose entries exactly.
- [ ] Counts in the metadata block match the actual entries.
- [ ] You state how many entries you revised or removed during self-audit.

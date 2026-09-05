---
repo: D:\My Folder\pera-plano (github.com/JohnFilhmar/pera-plano)
commit: 12b2a3020b4d3353102a083f2adf5ba15f548bc3
prompt_baseline_commit: 26cb148
date: 2026-09-03 (pass 1), 2026-09-04 (pass 2, mobile screens and remaining modules)
analyzer: Claude Fable 5.1 (read-only audit session, no edits to code)
total_gaps: 98
by_severity:
  S1: 1
  S2: 16
  S3: 73
  S4: 8
by_category:
  CODE: 39
  FEAT: 14
  TEST: 5
  SEC: 9
  OPS: 4
  DOC: 4
  PROJ: 2
  CONTRA: 21
coverage_percent_read_fully: 55
coverage_percent_touched: 70
---

# PeraPlano gap analysis

Work queue for autonomous remediation agents. HEAD at analysis time is `12b2a30`, two documentation commits after the `26cb148` baseline this prompt was written against (`053f742` and `12b2a30` add the gap-analysis prompt itself). No source file differs between the two commits, so the repository map in the prompt still holds. The working tree carries uncommitted changes that this audit reports on separately (GAP-001).

## 0. Remediation log

Live status of remediation work, written as each entry lands. This section, not the
prose below it, is the current truth about what is fixed. An id with no row here has
not been started. Each gap's detail entry in section 9 carries the same marker inline.

| ID | Status | Commit | Branch | Verification | Date |
|---|---|---|---|---|---|
| GAP-007 | DONE | 669d00c | gap-wave-6 | docs only, no suite. Acceptance grep returns 0. Every claim the rewrite adds was re-verified: f985c7f is the 2026-08-28 merge, server/ is on master, no staging branch exists. `cd server && npm run lint` NOT RUN - server/node_modules does not exist in a worktree and installing is barred | 2026-09-05 |
| GAP-008 | DONE | 46412d1 | gap-wave-6 | jest lib/recurring 3 suites 53 tests PASS; reverting the source fails exactly "a fortnightly acknowledged pattern silent for 11 days is KEPT". The second new test passes with the fix removed too and is an over-correction guard, NOT a witness - do not credit it. Found an adjacent defect, see the monthlyLockedIn note in section 0 | 2026-09-05 |
| GAP-009 | DONE | 438ebff | gap-wave-6 | jest components/loans + lib/loans 8 suites 128 tests PASS; the new test fails with the source reverted. THE ENTRY BELOW WAS FACTUALLY WRONG and was not implemented as written - see its corrected What is wrong, and the Cross-cutting findings in section 0 | 2026-09-05 |
| GAP-015 | DONE | 3c6d278 | gap-wave-6 | docs only. Both acceptance greps PASS: "unit-tested in Kotlin" 0 hits, key_manager.test.ts named twice. Every doc claim was checked against code before being changed. Found a user-facing overclaim in onboarding COPY, see the Cross-cutting findings in section 0 | 2026-09-05 |
| GAP-016 | DONE | e65b6e8 | gap-wave-6 | docs only. Acceptance PASS: section 6 now says the first arrival wins, section 11.2 rule 2 says integrity and authenticity verification is intended, not yet built. Checked against the CURRENT code including what waves 3-5 changed here; the balance-after cross-check turned out to be built but downstream in Wallets, not in ingest | 2026-09-05 |
| GAP-094 | DONE | cbe7b5e | gap-wave-6 | jest modules 4 suites 64 tests PASS (JS consumers only; they mock the native module). KOTLIN NOT COMPILED AND NOT RUN - no Gradle project exists in a worktree. The 5 new Kotlin tests are verified by reading only. Narrower than the entry proposed: the skip is gated on isOngoing, because applying it to ordinary posts would collapse two genuine notifications seconds apart and break an existing 60s-interval test | 2026-09-05 |
| GAP-086 | DONE | 9d5b6f2 | gap-wave-5 | jest bills_screen + components/bills + lib/bills 7 suites 130 tests PASS; reverting the two source lines fails all three new tests. Also fixes the four-wave bills_screen header failure | 2026-09-05 |
| GAP-018 | DONE | 2de9b02 | gap-wave-5 | jest more_hub + more_tab + permissions_screen + components/onboarding 19 suites 215 tests PASS. ON-DEVICE VERIFICATION REQUIRED: battery intent resolution on One UI, truthful grant reads after a settings round trip, canAskAgain honesty, and whether the exemption survives at all | 2026-09-05 |
| GAP-038 | DONE | a0f90a1 | gap-wave-5 | same suites PASS; five new tests fail when neutered. No migration: goals has one retirement column, so a completed goal is indistinguishable from a deleted one without completed_at (GAP-055) | 2026-09-05 |
| GAP-032 | DONE | 2f67fdc | gap-wave-5 | jest 24 suites 574 tests PASS plus downstream 26 suites 700 tests; neutering the guard gives 300000 where 700000 is expected. Also closes the balanceAfter hazard GAP-012 flagged, with one residual noted | 2026-09-05 |
| GAP-044 | DONE | acd1204 | gap-wave-5 | jest lib/db/migrations 34 tests PASS; removing the guard fails exactly the 3 refusal tests while the fresh-install and equal-version guards pass either way. Reviewer points confirmed: fresh install not refused, recovery screen offers no futile retry | 2026-09-05 |
| GAP-017 | DONE | 83b1253 | gap-wave-5 | jest components/onboarding + components/lock + 3 layout suites, 21 suites 229 tests PASS; all 8 new assertions fail pre-fix. expo-screen-capture corrected to ~8.0.10 (57.x would have crashed onboarding and lock at module load). NATIVE REBUILD REQUIRED before the guard does anything on device | 2026-09-05 |
| GAP-079 | DONE | e97a640 + 8654b88 | gap-wave-4 | jest components/wallets+loans+review+wallet_routes 14 suites 335 tests PASS; reverting the 7 sources fails exactly the 23 new tests. Found that a useState guard does not stop a same-tick double tap | 2026-09-05 |
| GAP-010 | DONE | eee8028 | gap-wave-4 | jest lib/wallets + lib/db/repos + components/wallets 30 suites 697 tests PASS; each guard reverted individually fails only its own test. Weekly cadence taken from docs/02-wallets.md:70. Snooze, Home card and due chip deliberately not built | 2026-09-05 |
| GAP-095 | DONE | e046f84 | gap-wave-3 | same commit; test genuinely crosses midnight (23:58 mount, 00:02 save); GAP-060 submit guard untouched | 2026-09-04 |
| GAP-090 | DONE | e046f84 | gap-wave-3 | same commit; all three false statements fixed, scope table now shared with the step that asks the cadence | 2026-09-04 |
| GAP-076 | DONE | e046f84 | gap-wave-3 | jest 22 suites 342 tests PASS; all 20 useWallets call sites checked, no picker gained an archived wallet | 2026-09-04 |
| GAP-031 | DONE | 4f8774a | gap-wave-3 | same commit; repo guard and both service guards each proven separately load-bearing. No migration; the real constraint needs a junction table, see GAP-057 | 2026-09-04 |
| GAP-040 | DONE | 4f8774a + 7c0d255 | gap-wave-3 | jest lib/ingest+review+db 33 suites 925 tests PASS. Follow-up 7c0d255 fixes a pre-existing chain poisoning the atomic store made likelier | 2026-09-04 |
| GAP-013 | DONE | 1baa4e6 | gap-wave-3 | jest query_client + components/ui + hooks + contexts 33 suites 430 tests PASS; one MutationCache onError covers all 49 hooks. Plan-screen mutateAsync try/catch still open | 2026-09-04 |
| GAP-088 | DONE | 50223eb | gap-wave-2 | same commit; test fails if a wire field gains no disclosure phrase | 2026-09-04 |
| GAP-084 | DONE | 50223eb | gap-wave-2 | same commit; reseeds on a value-based proposal signature, proven to fail when reverted | 2026-09-04 |
| GAP-081 | DONE | 50223eb | gap-wave-2 | jest components/bills+goals+support 5 suites 66 tests PASS; fails with sources reverted | 2026-09-04 |
| GAP-012 | DONE | 8025365 + 718aff5 | gap-wave-2 | jest lib/ingest+review+db 38 suites 1221 tests PASS (baseline 1202, delta is exactly the 19 added); 8 tests fail with the mechanisms neutered | 2026-09-04 |
| GAP-002 | DONE | 320f4d3 + 1ebb8a5 | gap-wave-2 | jest lib/crypto + contexts + query_client 8 suites 145 tests PASS; regression reproduces the zero-key blob end to end. Diff reviewed line by line; 1ebb8a5 clears the cache key on the wipe path too | 2026-09-04 |
| GAP-099 | DONE | 3ed6f64 | worktree-gap-wave-1 | jest lib/privacy 2 suites 18 tests PASS plus privacy_screen 17; all three added tests fail with the implementation reverted. Rest of lib/privacy checked, no other occurrence | 2026-09-04 |
| GAP-071 | DONE | 0f6895d | worktree-gap-wave-1 | jest lib/alerts 5 suites 181 tests PASS; both new tests fail with their source change reverted. Second regression test ships with the loans commit (shared file) | 2026-09-04 |
| GAP-064 | DONE | fefece2 | worktree-gap-wave-1 | same commit; both halves proven to fail when reverted. outstandingBalance untouched so GAP-029 is not prejudged | 2026-09-04 |
| GAP-063 | DONE | fefece2 | worktree-gap-wave-1 | jest loan_routes + lib/loans 5 suites 107 tests PASS; new test fails with balanceAfter reverted to 0 | 2026-09-04 |
| GAP-074 | DONE | a45be16 | worktree-gap-wave-1 | same commit as GAP-073; seven columns neutralised (category_parent added beyond the entry's six) | 2026-09-04 |
| GAP-073 | DONE | a45be16 | worktree-gap-wave-1 | jest lib/reports 3 suites 54 tests PASS plus export_button/reports_screen 10; 10 of 12 added tests fail with both fixes reverted | 2026-09-04 |
| GAP-006 | DONE | 97640d9 | worktree-gap-wave-1 | jest lib/limits 11 suites 151 tests PASS; pinned pairs plus a BigInt oracle over 6400 assertions, both proven to fail on the float path | 2026-09-04 |
| GAP-004 | DONE | 62ef72a | worktree-gap-wave-1 | jest lib/income 6 suites 92 tests PASS; regression pins the defect (600000 vs expected 800000 when restored). NOTE: the entry's worked example does not reproduce; test uses a corrected fixture | 2026-09-04 |
| GAP-003 | DONE | 7fc19ce | worktree-gap-wave-1 | jest onboarding tree 22 suites 207 tests PASS plus more_hub/more_tab 32; 5 of 7 new tests fail when the OS request is stubbed. ON-DEVICE VERIFICATION STILL REQUIRED on the A54 (7 items listed in the commit) | 2026-09-04 |
| GAP-058 | DONE | 46edbd3 | worktree-gap-wave-1 | jest hooks 87 passed and home_screen 23 passed; three added tests fail with the source-root list emptied. DEVIATION: fixed by a cascade in query_client, so acceptance criterion 1 (12+ mutation hooks naming the key) is NOT met by design | 2026-09-04 |
| GAP-011 | DONE | b732372 + 9eede70 | worktree-gap-wave-1 | jest lib/ingest + lib/review + raw_notifications_repo 15 suites 466 tests PASS. Follow-up 9eede70 fixes a merged-away-duplicate resurrection the sweep introduced (was reproduced first) | 2026-09-04 |
| GAP-014 | DONE | 66d549a | gap-wave-4 | jest services + lib/ingest 18 suites 472 tests PASS; HEAD's validator accepted all 6 attack payloads and the accepted regex never terminated. ReDoS reduced not solved; authenticity still GAP-043 | 2026-09-05 |
| GAP-060 | DONE | 769d66b + bf32446 | gap-wave-1 + gap-wave-4 | CORRECTED: the original useState guard did not stop a same-tick double tap and wrote two rows; bf32446 makes it a ref. jest transaction_new 15 tests PASS | 2026-09-05 |
| GAP-005 | DONE | 9a605da | worktree-gap-wave-1 | jest safe_to_spend_service 22 passed (was 21); new test proven to fail without the fix | 2026-09-04 |
| GAP-062 | DONE | 8c1fccd | worktree-gap-wave-1 | key sets compared at nine across all four files; Gradle NOT RUN (no android/ in worktree) | 2026-09-04 |
| GAP-001 | DONE | 8db6f2c + a84b0ca | master + gap-wave-2 | app.json survived the merge; the iOS build job was restored by the merge conflict resolution and re-stripped in a84b0ca | 2026-09-04 |

### Cross-cutting findings from remediation

Facts established while fixing entries, that later entries must not rediscover the hard way.

- **A double-tap guard must be a REF. Neither `isPending` nor `useState` is enough.**
  (found fixing GAP-060 on 2026-09-04, CORRECTED while fixing GAP-079 on 2026-09-05.)
  React Query notifies observers on a microtask, so two presses inside one JS tick both read
  `isPending: false` and both submit. That much was right. The original note then said to use
  a synchronous `useState` set before the call, and that is WRONG: calling the setter does not
  change the value the running handler's closure already read, so the second press in that tick
  sees the same stale `false`. GAP-079 implemented the note literally and still wrote two
  `loan_payments` rows for one collector visit; the manual-entry path shipped in `769d66b` had
  the same hole and was corrected in `bf32446`. Use a `useRef` as the guard, keep a `useState`
  only to drive the button's spinner, and OR `isPending` in for the invalidation window.
  A test only catches this if BOTH presses fire inside one `act()` -- two bare presses are two
  ticks, which `isPending` already refuses, so a test written that way passes without the fix.
- **The GAP-011 sweep introduced a new invariant** (2026-09-04). A row in `raw_notifications`
  referenced by neither `transactions` nor `review_queue_items` is now a WORK ITEM that
  `startIngest` re-runs, not an inert row. Anything that stores a capture and deliberately
  produces neither will be re-processed on every launch. GAP-012, GAP-035, GAP-040 and
  GAP-048 build on this. The `processStored` and `runGuarded` catches now do work (attempt
  counting, plus a poison-pill card on the third failure) instead of being no-ops, and
  `pipeline.ts` gained module state plus a test-only `__resetIngestFailures()` that
  `beforeEach` must call.
- **RESOLVED, and it was real** (2026-09-04, commit 9eede70). The GAP-011 sweep DID
  resurrect a merged-away duplicate: `mergeDuplicate` hard-deletes one of two committed
  rows, and an auto-committed capture's only reference is its transaction row, because
  `raiseLoanMatchAfterCommit` and `learnWalletTrait` both enqueue with no
  `rawNotificationId`. The deleted row's capture therefore became sweep-visible again and
  was re-committed under a new id on the next launch. Reproduced in a test, then fixed by
  having the merge write an already-resolved `possible-duplicate` marker on the orphaned
  capture in the same unit of work. No migration; that kind is already in migration 001's
  CHECK constraint.
- **STANDING CONSTRAINT from the above**: `mergeDuplicate` is currently the only production
  caller of `deleteTransaction`. Any new code path that deletes a committed transaction
  MUST write the same marker, or the resurrection returns. This applies directly to
  GAP-061, which would add a delete affordance to transaction detail. GAP-061 is no longer
  gated on this work, but it must reuse the marker rather than calling `deleteTransaction`
  bare.
- **`query_client.ts` now carries a Safe-to-Spend cascade** (added by GAP-058, 2026-09-04).
  It is one contiguous inserted block plus two imports, sitting between the `queryClient`
  constructor call and the `cacheEncryptionKey` declaration. `staleTime`, `gcTime`, `retry`,
  `refetchOnWindowFocus`, the persister, the buster and the encryption setters were NOT
  touched, so GAP-002 (cache cipher) and GAP-013 (mutation error surface) can rebase around
  it. GAP-058 deliberately did NOT add the Safe-to-Spend key to each mutation hook, so that
  entry's acceptance criterion 1 (twelve or more hooks naming the key) is not met and should
  not be treated as a regression; the cascade covers hooks that never mention the key, which
  is verified by test.

- **This document's worked examples are not always reproducible** (found fixing GAP-004,
  2026-09-04). GAP-004's Evidence section walks a fixture of PHP 20,000 on Jun 6 / Jul 6 /
  Aug 6 plus PHP 5,000 on Aug 20. It does not exhibit the defect: same-calendar-date gaps
  make `tryMonthly` (`lib/income/cadence_detector.ts:220-255`) return CONFIRMED monthly,
  whose median average does not move as the 90-day window slides, and the odd PHP 5,000
  credit sits outside `primaryStream`'s 30 percent band (`lib/income/candidates.ts:168`) so
  it is dropped from the stream entirely. The defect is real, but only on a fixture that
  actually lands on `irregular`. Treat every Evidence walkthrough here as a sketch to be
  re-derived against the source, the same way the `path:line` cites already have to be
  re-read. Confirming an entry's CLAIM is not the same as confirming its EXAMPLE.

- **On-device and Gradle verification backlog** (opened 2026-09-04). Nothing in this
  remediation run touched hardware, and the worktree has no `android/` project, so two classes
  of check are outstanding and must not be read as passing:
  - **GAP-062** (commit `8c1fccd`): the Kotlin JVM suite was NOT run. Key sets were compared
    programmatically across all four files and agree at nine, but `gradlew test` for the
    notification_listener module still has to be run from the main checkout.
  - **GAP-003** (commit `7fc19ce`): Jest proves the OS permission is now REQUESTED; it cannot
    prove an alert reaches the shade. Still to check on the A54 (Android 16): the system
    dialog appears exactly once on the new alerts step; a granted permission actually displays
    a limit alert, bill or loan reminder, payday summary and tracking-interrupted notice;
    `getPermissionsAsync().canAskAgain` is truthful on One UI so the More row switches from
    "ask" to "open settings" at the right moment; `Linking.openSettings()` lands somewhere
    notifications can be enabled; the More row disappears after the grant via the AppState
    re-read; the step progress row still reads correctly with a tenth dot at A54 width; and
    skipping the step still completes onboarding.

- **Two loose ends for whoever picks up GAP-029** (found fixing GAP-063/GAP-064, 2026-09-04,
  neither acted on):
  - `mobile/components/loans/loan_card.tsx:104` still computes its progress bar as
    `Math.max(0, loan.principal - outstanding)`. That is exactly the subtraction GAP-064
    removed from the detail screen, so a fee or balance adjustment still shrinks the card's
    bar. `LoanStatus.paidTotal` now exists and is the correct source; this is a one-line
    follow-up that was outside GAP-064's stated locations.
  - The schedule table's balance column walks down the flat TOTAL REPAYABLE (matching
    `buildFlatSchedule`), while `outstandingBalance` walks down PRINCIPAL. On a flat loan the
    two therefore disagree by the built-in interest. This is pre-existing, sits between
    `loan_math.ts` and the repo formula, and is squarely GAP-029's question. GAP-063 and
    GAP-064 were both fixed without reading `outstandingBalance`, so nothing about that
    formula has been prejudged.

- **Full mobile suite result after this remediation run** (2026-09-04). Run in three chunks with
  `--runInBand`; the machine could not hold `--maxWorkers=2` or the default (two runs were killed
  for memory, which is a machine limit, not a test failure). Totals across the three chunks:
  **222 suites, 3,915 tests, 2 failures.** Both failures are pre-existing and both are already
  named in GAP-052's file list:
  - `app/__tests__/review_queue.test.tsx` "a kind chip narrows the list" - a `waitFor` timeout
    whose own comment at `:692-693` says the budget is "enough on an idle machine and not enough
    on one running the whole suite in parallel". Timing, not behaviour.
  - `app/__tests__/bills_screen.test.tsx` "THE HEADER TOTALS THE NEXT 30 DAYS, UNRESOLVED ONLY" -
    expected PHP 3,250.00, got PHP 5,600.00. **Root cause worth recording for GAP-052:** the
    fixture derives `TODAY` from the real clock (`:60`, `systemClock.now()`) with no fake timers,
    so its 30-day window slides with the calendar and the assertion is date-dependent. This is a
    fixable defect in the test, not irreducible flakiness. No commit in this run touched
    `lib/bills`, the bills routes, or that test.
  - The other five of GAP-052's seven did not reproduce under `--runInBand`, which supports the
    theory that most of that set is parallel-contention timing rather than real breakage.

- **Wave 2 suite result** (2026-09-04, branch `worktree-gap-wave-2` off master). Run in two
  chunks with `--runInBand`: `lib` gave **111 suites / 2,416 tests, zero failures**, and
  `hooks components app contexts services modules constants types` gave **139 of 140 suites /
  1,972 of 1,973 tests**. Total **251 suites, 4,389 tests, 1 failure**, and that one is
  `bills_screen`'s clock-dependent "next 30 days" total described above. It was confirmed
  pre-existing a second way this wave: the agent that changed `bill_form.tsx` and
  `due_rule_picker.tsx` reverted both to HEAD and reproduced the failure identically.
  `review_queue` passed this run, which confirms that one is purely parallel-contention timing.
- **A correct fix can open a hole elsewhere; check for it** (2026-09-04). This happened twice.
  GAP-011's recovery sweep made merged-away duplicates resurrect, fixed in `9eede70`. GAP-002's
  fix, which gives `query_client` its own copy of the DEK, meant `wipeKeys()` no longer scrubs
  that copy as a side effect, so a full wipe left a live DEK in memory; fixed in `1ebb8a5`. In
  both cases the defect was invisible until someone asked "what did this change stop being true".
  Ask it explicitly for any fix that changes ownership, lifetime, or what counts as reachable.

- **Concurrent jest runs race on the transform cache** (2026-09-05). With three agents running
  `npx jest` in the same worktree, a suite can fail to LOAD with
  `EPERM: operation not permitted, rename '...jest-transform-cache...'`, and unrelated suites can
  blow the 30s default timeout under the CPU contention. Neither is a real failure. Give each
  concurrent agent its own `--cacheDirectory` outside the repo, and re-run before believing a
  failure that looks like a load error or a timeout.
- **A latent chain-poisoning bug in `startIngest`, fixed 2026-09-05 in `7c0d255`.** The capture
  chain was an un-caught IIFE and live captures append with `chain.then(onFulfilled)`, which on a
  REJECTED promise skips the callback and passes the rejection on. One failed batch therefore
  meant `runGuarded` was never called again and every notification for the rest of the process
  was dropped silently, with tracking dead until app restart. This predates the remediation work;
  GAP-040's atomic batch store only made it likelier to fire. The lesson for anything else built
  on a promise chain here: a `.then` chain used as a QUEUE must never be allowed to reject, or it
  stops being a queue.

- **Wave 3 suite result** (2026-09-05, branch `worktree-gap-wave-3` off master). Two chunks,
  `--runInBand`: `lib` **111 suites / 2,439 tests, zero failures**; the UI layer **140 of 141
  suites / 1,992 of 1,993 tests**. Total **252 suites, 4,432 tests, 1 failure**, and it is the
  same `bills_screen` clock-dependent total that failed in waves 1 and 2.
- **The bills_screen header failure, diagnosed properly** (fixed 2026-09-05 in `9d5b6f2`).
  An earlier note here called it a plain wall-clock read and a one-line fix. That was
  incomplete. The mechanism is the INCLUSIVE far edge: `bills_panel.tsx` computes
  `windowEnd = addDaysIso(today, 30)` and filters `dueDate <= windowEnd`, while each
  fixture bill's next monthly cycle is one calendar month out. In any month of 30 days or
  fewer that next cycle lands exactly ON the edge and the header counts the same bill
  twice. It therefore passes in the seven 31-day months and fails in the other five, which
  is why four waves of agents read it as an unrelated regression rather than a calendar
  artefact. Pinning also had to spy on `Date.now`, not `systemClock.now`, because
  `createBill` stamps `createdAt` from `Date.now` and the service floors cycle enumeration
  at it; pinning only the clock the screen reads leaves the bills created in the future.
  Fake timers are wrong here too, since they stop the `setTimeout` React Query batches
  notifications through.
- **A regression test can be VACUOUS without looking it** (found fixing GAP-086, 2026-09-05).
  The double-tap test for the skip guard asserted the cycle table held one row. It passed
  with the ref swapped for state AND with the guard deleted outright, because
  `006_bill_cycles.sql` already carries `UNIQUE (bill_id, due_date)` -- the schema, not the
  guard, was preventing the second row. What the guard actually prevents is the LOSING
  write, whose rejection surfaces as a GAP-013 failure toast about a skip that in fact
  succeeded. Deleting the fix and re-running is the only way to learn this; a test that
  still passes with the fix removed is measuring something else, however plausible its
  assertion reads.
- **Wave 4 suite result** (2026-09-05, branch `worktree-gap-wave-4` off master). Two chunks,
  `--runInBand`: `lib` **114 suites / 2,487 tests, zero failures**; the UI layer **141 of 142
  suites / 2,025 of 2,026 tests**. Total **256 suites, 4,513 tests, 1 failure**, still the
  `bills_screen` clock-dependent total.
- **Wave 5 suite result** (2026-09-05, branch `worktree-gap-wave-5` stacked on wave 4). **259
  suites, 4,562 tests, ZERO failures** - the first fully green sweep of the campaign. `lib`
  **114 suites / 2,500 tests**; the UI layer **145 suites / 2,062 tests**. The four-wave
  `bills_screen` failure is gone, fixed in `9d5b6f2` under GAP-086. Typecheck still reports
  only the one pre-existing `components/gates/__tests__/gates.test.tsx(91,29)` TS2339.
- **The two-chunk sweep recipe is not reliable on this machine and was replaced by six.**
  The UI chunk was killed twice for low memory, once after 110 suites and once before its
  first suite, while an unrelated 6.5 GB process was resident. Two further facts, both learned
  the hard way: a killed background run LEAKS its jest processes (three survived, holding
  1.5 GB, and they must be killed by PID before retrying), and the low-memory supervisor
  applies to BACKGROUND commands - the same chunk run in the foreground completed untouched.
  Working split, each its own process: `lib`; `app`; `components/ui + __tests__ + gates`;
  `components/onboarding + wallets + transactions + review`; the thirteen remaining
  `components` subdirectories; then `hooks contexts services modules constants types`.
  Slowest chunks are `lib` (797 s) and `app` (439 s); the rest are all under three minutes.
- **The remaining work changed shape after wave 5.** Every S1 and twelve of seventeen S2s are
  closed, and **not one of the five remaining S2s is AGENT-READY** - all are AGENT-ASSISTED or
  HUMAN-FIRST (GAP-028, 029, 043, 059, 061). Autonomous agents have cleared what they can
  clear at high severity; the rest needs owner decisions, hardware, or close review.
- **GAP-044 was more urgent than its score said, and is now closed** (`acd1204`, wave 5).
  "Migrations are forward-only with no guard for an older build opening a newer database" was
  theoretical when the audit was written. It was not by wave 5: GAP-001 deliberately kept
  `runtimeVersion` and `updates.url`, so OTA is live, and an OTA rollback is exactly the event
  that puts an older build in front of a newer schema. It carried the highest risk rating in
  the file (R4).
- **GAP-017 was blocked on a dependency, like GAP-014 was, and is now closed** (`83b1253`,
  wave 5). `expo-screen-capture` is installed at `~8.0.10`. **That pin is load-bearing**: 57.0.2
  imports `createPermissionHook` from `expo`, which SDK 54 does not export - it lives in
  `expo-modules-core` - so the newer major would crash onboarding and the lock screen at module
  load, and the suite would NOT catch it because the tests mock the package. The guard also
  does nothing on device until the next NATIVE REBUILD, since the module is absent from the
  installed dev and preview builds.
- **Wave 6 suite result** (2026-09-05, branch `worktree-gap-wave-6` off the merged master).
  **259 suites, 4,565 tests, ZERO failures**; typecheck unchanged, still only the pre-existing
  `components/gates/__tests__/gates.test.tsx(91,29)` TS2339. The test delta over wave 5 is
  exactly +3, the three tests this wave added. One run of the `app` chunk showed a single
  failure in `app/__tests__/review_queue.test.tsx` that did NOT reproduce: the suite passes
  30/30 alone and 38/38 on a clean re-run, and no wave 6 commit is on its runtime path. It was
  load flakiness, on a machine that took 766 s for a chunk that took 439 s in wave 5.
- **AN ENTRY IN THIS FILE CAN BE FLATLY WRONG, and implementing one as written can CREATE the
  bug it describes.** GAP-009 claimed the loan rate field was unlabelled and silently monthly.
  Both halves were false - the code is explicitly per-annum and the field already said
  "Annual rate" - and the proposed fix would have labelled it "per month" while the maths kept
  dividing by 12. See GAP-009's corrected "What is wrong". The lesson generalises: a `C2`
  confidence flag means the audit did NOT execute or read the thing it is describing, so any
  C2 entry's central claim must be re-verified in the current code BEFORE it is implemented,
  and an agent that finds the claim false must report it rather than build to it.
- **Line cites in this file drift, and now demonstrably so.** Wave 6 found the duplicate branch
  at `pipeline.ts:463-465` where the entry said `:378-380`, `docs/03`'s section 11.2 rules at
  `:335-340` not `:325-331`, and GAP-007's stale paragraph spanning four lines not three.
  Re-read every cited location before acting on it.
- **`server/` cannot be verified from a worktree.** Several entries name `cd server && npm run
  lint` as their verification command. `server/node_modules` does not exist in a worktree -
  only `mobile/` is junctioned - so that command cannot run, and installing is barred. Any
  future entry whose proof lives under `server/` (GAP-019's security headers is the next one)
  needs a `server/node_modules` junction created first, or it cannot be verified at all.

**Three defects found by wave 6 that are NOT in the 99 and need entries of their own.**

- **Onboarding promises new-device recovery that cannot work. Data-loss grade, and the most
  serious thing found in six waves.** `mobile/components/onboarding/phrase_display.tsx:104`
  tells the user: "If you ever get a new phone, or turn off and reset your fingerprint or PIN,
  these 12 recovery words are the only way back to your data." The second half is TRUE - same
  device, SecureStore intact, the phrase unwraps the DEK. The first half is FALSE:
  `unwrapWithRecoveryPhrase` (`mobile/lib/crypto/key_manager.ts:171`) reads `recoveryWrap` and
  `recoverySalt` from THAT DEVICE's SecureStore, a new phone has neither, and it throws
  "recovery wrap not present" before deriving anything. Nothing exports those values and there
  is no cloud backup (GAP-054: described as built, no code exists). A user who trusts that
  sentence and switches phones loses everything, irreversibly, having been told they would not.
  GAP-015 correctly did not touch it - that entry is docs-only and this is code.
- **`monthlyLockedIn` counts a fortnightly subscription at double its cost.**
  `recurring_service.ts:287` scales by `MONTHLY_FACTOR[pattern.period]`, keyed on the same
  three-value bucket enum that caused GAP-008: a 14-day charge buckets as `weekly` and is
  counted 52 times a year instead of 26. That total is the headline "locked in" figure and
  feeds Safe-to-Spend, so overstating it makes Safe-to-Spend understate the money the user
  actually has. GAP-008 deliberately did not touch it; its test pins the doubling and is
  commented as pinning known-wrong behaviour, not the intended conversion.
- **Two sibling doc overclaims, each outside the entry that found it.**
  `docs/02-domain-model.md:453` still calls the loan `interestRate` "Optional, informational",
  which `438ebff` corrected in `types/domain.ts` but not here, and it now contradicts both the
  code and `docs/04-features/06-loans.md` rules 1 and 3.
  `docs/04-features/08-review-queue.md:58` repeats the unbuilt field-union promise GAP-016
  removed from `docs/03`, in different words ("default keep: the record with more parsed
  fields").

## 1. Executive summary

Three findings matter most.

First, on Android 13 and later the app never asks for the `POST_NOTIFICATIONS` permission. The only function that requests it has no caller, and every posting path checks the grant and drops the alert when it is missing. On the Samsung A54 test device (Android 16) no limit alert, bill reminder, loan reminder, payday summary or tracking-interrupted notice can ever appear. The M2 exit criteria in the scope doc assume they do (GAP-003).

Second, the ingest pipeline still has two ways for one money movement to become two ledger rows. A raw capture whose stages throw is stored, never reprocessed, and rejected as a replay forever (GAP-011). A push notification that lands in the Review Queue followed by its SMS twin produces two cards, and confirming both inserts two transactions with no dedupe check (GAP-012). PR #33 closed the redelivery instance of this class on 2026-09-01; the class is still open.

Third, the encrypted persisted query cache can be written under an all-zero key if a cache write is in flight when the app locks, because the cache codec captures the key buffer that `KeyManager.lock()` zeroes in place (GAP-002). It is the only S1 in this queue, and it is a small fix.

The single biggest structural risk is the remote parser ruleset channel. The app fetches rules from a host that does not exist yet, validates them only by checking that each regex compiles, and stores them verbatim. The design doc promises integrity verification and staged rollout. Whoever eventually stands up that host, or intercepts TLS to it, can lower the auto-commit threshold to zero or freeze the app with a pathological regex (GAP-014, GAP-043). Fixing validation is agent work; the signing scheme is an owner decision.

The rest of the queue is mostly medium and small. Money arithmetic is integer centavos end to end, the schema enforces the wallet invariant, dedupe and transfer windows match the spec, and the Kotlin listener never logs notification text. The docs are dated 2026-08-02 and describe a wallet `type` enum, a recovery phrase that travels to new phones, and a cloud backup that do not exist in code (GAP-045 and the Contradiction Register).

**Pass 2 (2026-09-04).** A second read-only pass covered the mobile areas the first coverage report listed as unread: every screen and component body under `mobile/app/` and `mobile/components/`, the Safe-to-Spend engine state table, `reports/aggregate.ts` and `csv_export.ts`, the alerts policy and subscribers, `lib/support/` and `lib/diagnostics/`, and the four Kotlin files the first pass read only by signature. It adds GAP-058 to GAP-097: four S2 (Safe-to-Spend never invalidated by mutations, capture keypair never regenerated after keystore invalidation, manual-entry double tap writes twice, transaction detail cannot edit or delete while docs/07 promises rectification) and thirty-six S3. Twenty-two S4 findings went to section 10. A residue sweep the same day (limit, goal and loan services, keypad context, plugin and manifest, instrumented tests, and a pattern scan of all 250 test files plus full reads of the money and calendar suites) added GAP-098 and two deferrals; a 20,000-case probe of `loan_math.ts` found no rounding or termination defect. Server, web and scripts were out of scope for pass 2 by the owner's instruction. Seven audit agents ran one or two at a time; two were cut off by the session limit and re-run.

## 2. Assumptions and unknowns

- The prompt's repository map was checked. Counts differ slightly: `git ls-files` shows 669 mobile TypeScript files (prompt says about 671), 250 mobile test files plus 22 server test files (prompt says about 272 combined), 86 server TypeScript files (matches). Kotlin: 9 main sources, 12 JVM tests, 2 instrumented tests (matches).
- `mobile/android/` is gitignored and was not read. `mobile/.scratch_backup` and `mobile/dist` are not tracked by git and were not read.
- No test suite was executed in this session. Every test count and the seven pre-existing failures come from the 2026-09-01 handoff and are marked C2.
- No Gradle task was run. Kotlin behaviour claims rest on reading the source; anything that depends on Android runtime behaviour is C2 at best.
- The behaviour of `expo-updates` with no `checkAutomatically` setting (contacts the update server on every launch and sends an EAS client id) is from the library's documented default, not from this repository, and is marked C2.
- The working tree is dirty. `mobile/app.json`, `mobile/package.json`, `mobile/package-lock.json`, `server/apps/web/next-env.d.ts` are modified and `mobile/.eas/` is untracked. Findings about those files describe the working tree, not HEAD, and say so.
- Three earlier attempts to run this audit with parallel subagents were cut off by API rate limits. The final pass ran agents one or two at a time and several areas were traced by the analyst directly with targeted reads. Coverage below states which.
- Session time zone is Asia/Manila (UTC+8), which is also the target market. Date probes were run under Node 22 in that zone and under `TZ=UTC`.

## 3. Coverage report

Roughly 755 hand-written source files are in scope. About 140 were read in full and about 150 more were touched by targeted grep and line-range reads. Sampling is therefore the norm; the areas below say which.

Critical paths:

| Path | Traced | How |
|---|---|---|
| 1 Capture (Kotlin) | Partial | `PeraPlanoNotificationListenerService.kt` read fully; `CaptureBuffer.kt` first 120 lines plus signatures; `KeyVault.kt` and `KeyStoreBridge.kt` read by the crypto trace; `CapturePrefs.kt`, `CaptureEnvelope.kt`, `AppLabels.kt`, `NotificationListenerModule.kt` bodies not read (signatures and error mapping only). Instrumented tests read by name only. |
| 2 Ingest | Full | `pipeline.ts` and every non-test file under `lib/ingest/` read; repos for raw captures, transactions, transfer links, rulesets read; stage order mapped line by line. |
| 3 Review Queue | Full | `lib/review/resolve_actions.ts`, review and user-rule repos, `use_review_action.ts`, `app/review/index.tsx` sections. |
| 4 Money arithmetic | Full sweep | `lib/money/` read; every non-test `parseFloat`, `Number(`, `toFixed`, `Math.round/floor/ceil`, `/100`, `*100`, `SUM(`, `AVG(` hit opened and classified; every amount column in 18 migrations checked. |
| 5 Period and calendar | Full | `period.ts`, `dates.ts`, `datetime.ts`, `clock.ts`, `lib/income/`, `lib/recurring/`, `lib/bills/due_rules.ts`, limit windows, report bucketing; Node probes for boundary dates. |
| 6 Safe-to-Spend | Partial | `safe_to_spend_service.ts` read fully; `safe_to_spend.ts` and projection grepped for the contribution, floor and division rules; home invalidation handler read. The engine's state-table logic (Healthy, Tight, Over, Committed) was not walked line by line. |
| 7 Crypto and app lock | Full | `lib/crypto/`, `lib/security/`, `lib/db/database.ts`, `lib/query_client.ts`, lock context, lock screen, onboarding lock and phrase screens, `KeyVault.kt`, `KeyStoreBridge.kt`, JVM and instrumented test names, docs/12 and docs/13 blocks. |
| 8 Entitlements | Full | `lib/entitlements.ts` read; every read site grepped and opened. |
| 9 Server surface | Full | Both API routes, env, logger, proxy, next config, Dockerfile, compose files, nginx, both workflows, `DEPLOYMENT.md`. Web page components and tests not read. |
| 10 Network seams | Full | All five files under `services/` read; `bootstrap.ts` read; egress grep across the mobile tree. |

Also covered: schema and the migration runner (all 18 SQL files grepped for constraints, `migrations.ts` read fully); tests-versus-code seams by grep (skip/only/todo, snapshots, global mocks, fix commits without tests); feature docs 02 to 07 and 10 versus their modules by targeted reads; the route tree versus the IA doc; onboarding step order; alerts wiring; type-escape and naming census.

Not covered, and what it might hide: the bodies of most screen and component files under `mobile/app/` and `mobile/components/` (a screen-level state bug, a wrong navigation target, or copy that overclaims would not be caught); `mobile/lib/reports/aggregate.ts` beyond the transfer-exclusion lines; `mobile/lib/alerts/notification_policy.ts` and quiet-hours logic; `lib/support/` and `lib/diagnostics/` bodies (a support report that serialises raw text would not be caught, though the wire whitelist in `services/support_reports.ts` was read); the web page components and their tests; `scripts/beta_invites/src/` (not read at all); the Kotlin `CapturePrefs.kt` migration and sealing code (covered by docs/13 session 2 on hardware, not by this audit); `docs/superpowers/` plans and specs beyond the four cited.

The 250 mobile test files were not read in pass 1; test coverage claims in pass-1 entries come from grepping test titles for the behaviour named.

**Pass 2 coverage (mobile only, 2026-09-04)**

| Area | Traced | How |
|---|---|---|
| Screens: `app/_layout`, `index`, `lock`, all 13 `(onboarding)` routes, all 33 `(tabs)` routes, `review`, `transaction`, `wallet` | Full | Every body read; all 26 navigation targets in `(tabs)` and every target in the other groups resolve to a file in `git ls-files mobile/app`. |
| Components: onboarding, lock, gates, privacy, home, plan, more, settings, review, transactions, wallets, bills, goals, limits, loans, income, recurring, ui, reports, support | Full | All bodies read except `onboarding/value_carousel.tsx` and `value_panels.ts` (unmounted) and `gates/plus_gate.tsx` (read in pass 1). |
| Safe-to-Spend engine and projection | Full | `safe_to_spend.ts`, `safe_to_spend_projection.ts`, `safe_to_spend_service.ts` read in full; state table walked; both engine tests read. |
| Reports and export | Full | `aggregate.ts`, `csv_export.ts`, `reports_service.ts` read; every chart number traced to `aggregate.ts`; no on-screen summing found. |
| Alerts | Full | `notification_policy.ts` (quiet-hours wrap, dedupe windows), `alert_routes.ts`, `alerts_service.ts`, both tracking files, `channels.ts`; every alert title and body grepped for raw text (none found). |
| Support and diagnostics | Full | All five `lib/support` files, `parse_stats_repo.ts`, `services/support_reports.ts`, `device_info.ts`; wire whitelist confirmed. |
| Kotlin: `CapturePrefs`, `CaptureEnvelope`, `CaptureRecord`, `AppLabels`, `NotificationListenerModule`, `index.ts` | Full | Bodies and all JVM and JS tests read; `CaptureRecordTest.kt` compiles against current `CaptureRecord.kt` by inspection. Instrumented tests by assertion grep only. |
| Hooks | Full | The 51 query and mutation hooks the tab screens use, read comment-stripped. |
| Tests | Partial | Titles of every test file in scope; bodies of about forty test files at the ranges cited in entries. |

Residue sweep (2026-09-04, after pass 2): read fully `limit_service.ts`, `goals_service.ts`, `goal_math.ts`, `loan_math.ts`, `keypad_context.tsx`, `app.plugin.js`, `AndroidManifest.xml` (an empty stub), both tracked instrumented tests (`KeyStoreBridgeInstrumentedTest.kt`, `DrainBenchmarkInstrumentedTest.kt`; the three other instrumented names cited in pass 1 are not tracked in git), the Jest setup files, and the assertion lines of the money, period, dates, limit engine, loan math, goal, due rules, bill reminders, amount estimator, cadence detector and income math suites. Pattern scan over all 250 test files: no `.skip`, `.only`, `.todo`, `xit` or `xdescribe`; no snapshots; no `expect(true)`; no lib test mocks its own module; of 169 `queryByTestId(...).toBeNull()` targets the only dead id is `trend-path` (GAP-097). Loan math probe: principal column sums to principal, final balance exactly zero, all rows integer, term 0 returns an empty schedule, zero rate divides evenly, last-row drift against the level payment peaks at 165 centavos on a 2.57 million peso loan at 59 percent over 60 months.

Still not read after pass 2 and the residue sweep: about 230 test bodies beyond the pattern scan and the suites named above, and `mobile/lib/limits/limit_engine.ts` beyond the ranges cited in pass 1. No test, build, lint or Gradle task was run in pass 2. Pass-2 line citations were spot-checked by the analyst for every S2 entry and for GAP-063, 064, 065, 067, 068, 071, 073, 074, 076, 079, 080, 081, 084, 086, 087, 088, 089, 090, 092, 094, 095; several agent line numbers were found to drift on comment-heavy files and were replaced by verified ones.

## 4. Master index

Priority = (severity weight x confidence weight) / complexity weight, with S1=8, S2=5, S3=2, S4=1; C1=1.0, C2=0.8, C3=0.5; XS=1, S=2, M=4, L=7, XL=12. Ties break by lower risk, then lower difficulty. One order override is recorded inline.

| ID | Cat | Title | Sev | Cx | Diff | Risk | Conf | Prio | Suitability |
|---|---|---|---|---|---|---|---|---|---|
| GAP-001 | OPS | Uncommitted app.json and EAS tooling changes duplicate permissions, add RECORD_AUDIO, and add an iOS build job | S2 | XS | D1 | R1 | C1 | 5.0 | AGENT-READY |
| GAP-002 | SEC | Persisted query cache can be encrypted under a zeroed key when a write is in flight at lock time | S1 | S | D3 | R2 | C2 | 3.2 | AGENT-ASSISTED |
| GAP-003 | FEAT | POST_NOTIFICATIONS is never requested, so no alert can display on Android 13+ | S2 | S | D2 | R1 | C1 | 2.5 | AGENT-READY |
| GAP-004 | CONTRA | Automatic income drift re-snapshots percent-of-income limit bases mid-period | S2 | S | D2 | R2 | C1 | 2.5 | AGENT-READY |
| GAP-005 | CODE | Safe-to-Spend goal-contribution term has no Plus gate | S3 | XS | D1 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-006 | CODE | Percent-of-income limit base is computed in float then floored, dropping one peso on some pairs | S3 | XS | D1 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-007 | DOC | docs/DEPLOYMENT.md still says master has no server directory | S3 | XS | D1 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-008 | CODE | Fortnightly recurring patterns are forgotten before their next charge is due | S3 | XS | D1 | R1 | C2 | 1.6 | AGENT-READY |
| GAP-009 | CODE | Loan interest rate field has no unit label and is silently monthly | S3 | XS | D2 | R1 | C2 | 1.6 | AGENT-READY |
| GAP-010 | FEAT | Cash reconciliation prompts are never scheduled | S2 | M | D2 | R1 | C1 | 1.25 | AGENT-READY |
| GAP-011 | CODE | A stored raw capture whose stages throw is never reprocessed and is rejected as a replay forever | S2 | M | D2 | R2 | C1 | 1.25 | AGENT-READY |
| GAP-012 | CODE | Push and SMS twin with the first leg still queued produces two cards and two commits | S2 | M | D2 | R2 | C1 | 1.25 | AGENT-READY |
| GAP-013 | CODE | Mutation failures are silent on about thirty screens | S2 | M | D2 | R2 | C1 | 1.25 | AGENT-READY |
| GAP-014 | SEC | Remote parser ruleset is accepted without schema, size, tunable-range or regex bounds | S2 | M | D2 | R3 | C1 | 1.25 | AGENT-READY |
| GAP-015 | DOC | docs/12 overclaims new-device recovery and Kotlin recovery tests | S3 | S | D1 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-016 | DOC | docs/03 promises a survivor field union and balance-after cross-check that are not built | S3 | S | D1 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-017 | SEC | Recovery words go to the OS share sheet and the phrase screens allow screenshots | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-018 | FEAT | Skipped onboarding grants cannot be completed later from Settings | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-019 | SEC | Web site sends no security headers | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-020 | FEAT | Percent-of-payday goal contribution rules cannot be created in the UI | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-021 | CONTRA | Telemetry defaults to on while the docs list the default as undecided | S3 | S | D4 | R1 | C1 | 1.0 | HUMAN-FIRST |
| GAP-022 | CONTRA | Wallet deletion is archive-only in code but the UI says Delete and the doc specifies delete-with-reassign | S3 | S | D4 | R1 | C1 | 1.0 | HUMAN-FIRST |
| GAP-023 | CONTRA | Limits are created at four cadences at once; the doc and the Free cap describe one | S3 | S | D4 | R1 | C1 | 1.0 | HUMAN-FIRST |
| GAP-024 | CONTRA | Free-tier reports show the current month only; the doc promises a 90-day window | S3 | S | D4 | R1 | C1 | 1.0 | HUMAN-FIRST |
| GAP-025 | CONTRA | Categorizer resolves rule conflicts by recency; the doc says specificity first | S4 | XS | D4 | R1 | C1 | 1.0 | HUMAN-FIRST |
| GAP-026 | CONTRA | Free caps are 1 in code and 3 on the design board | S4 | XS | D4 | R1 | C1 | 1.0 | HUMAN-FIRST |
| GAP-027 | PROJ | Function and field names are camelCase throughout while the stated convention is snake_case | S4 | XS | D4 | R1 | C1 | 1.0 | HUMAN-FIRST |
| GAP-028 | SEC | expo-updates adds an undocumented egress and an OTA channel with no rollback runbook or policy hook | S2 | M | D2 | R2 | C2 | 1.0 | AGENT-ASSISTED |
| GAP-029 | CONTRA | Loan outstanding balance ignores flat total repayable and amortized interest | S2 | M | D2 | R2 | C2 | 1.0 | AGENT-ASSISTED |
| GAP-030 | CONTRA | Locked state is incomplete: no background timer and the in-memory query cache is kept | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-ASSISTED |
| GAP-031 | CODE | linkTransfer overwrites an existing link on either leg | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-032 | FEAT | Out-of-order balance-after notifications re-anchor the wallet | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-033 | FEAT | Confirming a loan payment match creates no UserRule | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-034 | CODE | A key-state read failure leaves the user on an unlock screen with no wipe route | S3 | S | D3 | R2 | C1 | 1.0 | AGENT-ASSISTED |
| GAP-035 | CODE | A capture with no notification key falls back to id-only replay detection | S3 | S | D2 | R1 | C2 | 0.8 | AGENT-READY |
| GAP-036 | FEAT | Archiving a wallet does not list linked goals, loans or income sources | S3 | S | D2 | R1 | C2 | 0.8 | AGENT-READY |
| GAP-037 | FEAT | Manual income override never gets the 20 percent divergence suggestion | S3 | S | D2 | R1 | C2 | 0.8 | AGENT-READY |
| GAP-038 | FEAT | Goals have no Complete action; the card copy promises one | S3 | S | D2 | R1 | C2 | 0.8 | AGENT-READY |
| GAP-039 | TEST | Encryption ship gates in docs/13 Parts 4, 5 and 8 are still NOT RUN | S3 | S | D3 | R1 | C2 | 0.8 | HUMAN-FIRST |
| GAP-040 | CODE | The drain-to-store loop is not one transaction; a kill mid-loop loses the rest of the batch | S3 | S | D2 | R2 | C2 | 0.8 | AGENT-READY |
| GAP-041 | CODE | Rollover carryover is zero when the previous period wrote no alert state | S3 | S | D2 | R2 | C2 | 0.8 | AGENT-READY |
| GAP-042 | CODE | Group summary notifications are captured alongside their children | S3 | S | D3 | R2 | C2 | 0.8 | HUMAN-FIRST |
| GAP-043 | CONTRA | Ruleset integrity verification and staged rollout are promised and absent | S2 | L | D4 | R3 | C1 | 0.71 | HUMAN-FIRST |
| GAP-044 | OPS | Migrations are forward-only with no guard for an older build opening a newer database | S2 | L | D2 | R4 | C1 | 0.71 | AGENT-ASSISTED |
| GAP-045 | DOC | Feature docs still describe the wallet type enum and other retired shapes | S3 | M | D1 | R1 | C1 | 0.5 | AGENT-READY |
| GAP-046 | PROJ | Repository hygiene: merged branches, version mismatch, stale root handoff, duplicated docs, no dependency bot | S4 | S | D1 | R1 | C1 | 0.5 | AGENT-READY |
| GAP-047 | CODE | Income windows and the history floor are measured in milliseconds from now rather than local days | S4 | S | D2 | R1 | C1 | 0.5 | AGENT-READY |
| GAP-048 | CODE | The buffered ingest path skips the pause and dismissed-package checks the live path applies | S4 | S | D2 | R1 | C1 | 0.5 | AGENT-READY |
| GAP-049 | CODE | The persisted query cache dehydrates every query, including raw notification text | S4 | S | D2 | R1 | C1 | 0.5 | AGENT-READY |
| GAP-050 | CONTRA | No active-notification snapshot catch-up when the listener reconnects | S3 | M | D3 | R2 | C1 | 0.5 | HUMAN-FIRST |
| GAP-051 | OPS | The native capture buffer evicts the oldest capture at 500 with no signal to the user | S3 | M | D3 | R2 | C1 | 0.5 | HUMAN-FIRST |
| GAP-052 | TEST | Seven pre-existing flaky UI test failures and one typecheck error on clean master | S3 | M | D2 | R1 | C2 | 0.4 | AGENT-ASSISTED |
| GAP-053 | OPS | No mobile CI workflow exists (ORDER OVERRIDE: blocked by GAP-052) | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-054 | CONTRA | Cloud backup is described as built and Plus-gated; no code exists | S3 | L | D4 | R3 | C1 | 0.29 | HUMAN-FIRST |
| GAP-055 | FEAT | Goal milestone notifications do not exist | S3 | L | D2 | R4 | C1 | 0.29 | AGENT-ASSISTED |
| GAP-056 | FEAT | Planned payday contributions have no pending, completed, skipped or expired lifecycle | S3 | L | D2 | R4 | C1 | 0.29 | AGENT-ASSISTED |
| GAP-057 | CODE | Boundary casts stand in for validation and the review resolution is discarded | S4 | M | D2 | R3 | C1 | 0.25 | AGENT-ASSISTED |
| GAP-058 | CODE | Safe-to-Spend query is never invalidated by any mutation and the Plus projection input is never refreshed | S2 | S | D2 | R2 | C1 | 2.5 | AGENT-READY |
| GAP-060 | CODE | Manual entry Save has no in-flight guard, so a double tap writes two entries | S2 | S | D2 | R1 | C1 | 2.5 | AGENT-READY |
| GAP-062 | TEST | NotificationListenerModuleTest still pins the eight-key record contract; the record now emits nine keys and two JVM tests fail | S3 | XS | D1 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-063 | CODE | Loan schedule table prints a zero balance on every row | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-071 | CODE | The tracking-interrupted notice fires on a fresh install before access is granted, and its 24-hour cap is written even when nothing was posted | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-073 | SEC | The CSV export stays in the cache directory as a plaintext ledger copy and reports success when sharing is unavailable | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-074 | SEC | The CSV export does not neutralise spreadsheet formula injection in free-text columns | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-076 | CODE | Rows in an archived wallet show "Unknown wallet" on detail and in the transfer candidate list | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-081 | CODE | The due-rule picker shows an unclamped or empty value while the rule holds a clamped one, and an empty day saves as the first | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-084 | CODE | The payday allocation sheet keeps per-goal state across paydays | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-086 | CODE | "Skip this cycle" is one tap with no confirmation or undo, and it moves Safe-to-Spend | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-088 | CONTRA | The report-a-problem disclosure says nothing else is included, but the wire carries a report id, timestamps, an attempt count and four device headers | S3 | XS | D1 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-090 | CONTRA | The onboarding Done screen overclaims automatic pickup, labels every scope "Monthly limit", and contradicts itself when the limit is null | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-095 | CODE | Manual entry freezes the day at mount, so a save after midnight is stamped at the previous day's midnight | S3 | XS | D2 | R1 | C1 | 2.0 | AGENT-READY |
| GAP-093 | CONTRA | Android Auto Backup is left at its default, so the sealed buffer, the database and the prefs go to Google Drive while docs/07 says nothing leaves the phone | S3 | XS | D3 | R2 | C2 | 1.6 | HUMAN-FIRST |
| GAP-094 | CODE | The listener re-seals and syncs the prefs file on every re-post of an ongoing notification, on the main thread, and inflates the seen count | S3 | XS | D3 | R2 | C2 | 1.6 | AGENT-READY |
| GAP-061 | CONTRA | Transaction detail edits only note and category and has no delete, while docs/07 promises every parsed field is editable | S2 | M | D4 | R3 | C1 | 1.25 | HUMAN-FIRST |
| GAP-059 | SEC | Capture keypair is never regenerated after keystore invalidation, and a dead-key drain deletes the buffer and resolves empty | S2 | M | D3 | R4 | C2 | 1.0 | AGENT-ASSISTED |
| GAP-064 | CODE | Loan "Paid so far" and the next-installment pointer are derived by subtraction and go wrong after a balance adjustment | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-065 | CODE | Bill payment history prints the current estimate on every row instead of the matched transaction amount | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-069 | FEAT | Tapping any app notification never navigates; the alert route resolver has no caller | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-070 | CODE | Percent contribution rules reserve a share of the income profile average, not the pay that landed | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-077 | CODE | Category correction and rule creation are two independent writes; a failed recategorise still creates the rule | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-078 | CODE | Bare-promise writes outside mutation hooks swallow failures into dead or misleading screens | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-079 | CODE | Sheets keep stale state and stay open after a failed write, and their confirm buttons stay tappable while pending | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-082 | CODE | Flat loan "How much?" is required, previewed, then discarded on save | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-083 | CODE | Loan first-due and goal deadline pickers floor at today, so an in-progress loan cannot be entered and an edit re-dates the whole schedule | S3 | S | D2 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-087 | CONTRA | Free tier sees a permanent "Not enough periods yet to show a trend" card instead of the Plus-locked preview the doc specifies | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-089 | CONTRA | The Privacy centre says notifications are being read whenever the switch is on, with no access check and no fix prompt | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-092 | CODE | The native provider filter has no getter and no launch re-sync, so an unopenable sealed filter silently becomes allow-all | S3 | S | D3 | R2 | C1 | 1.0 | AGENT-READY |
| GAP-096 | TEST | Listener module tests do not discriminate the failure modes the code documents | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-097 | TEST | Screen tests use fixtures that cannot distinguish the defect from the fix | S3 | S | D2 | R1 | C1 | 1.0 | AGENT-READY |
| GAP-066 | CODE | Home refreshes only the hero on focus and on pull, with no resume or midnight trigger for the other cards | S3 | S | D2 | R2 | C2 | 0.8 | AGENT-READY |
| GAP-098 | CODE | Limit alert state is read-modify-write with no serialisation, so a mute or base refresh can be overwritten by a concurrent ledger pass | S3 | S | D2 | R2 | C2 | 0.8 | AGENT-READY |
| GAP-068 | SEC | No secure-window flag anywhere, so the ledger is visible in the Recents thumbnail and screenshots while unlocked | S3 | S | D2 | R2 | C2 | 0.8 | AGENT-ASSISTED |
| GAP-067 | CONTRA | Onboarding is not resumable, and a second pass re-runs the wallet and first-limit writes | S3 | M | D2 | R2 | C1 | 0.5 | AGENT-ASSISTED |
| GAP-072 | CONTRA | Support attachments are plaintext screenshot copies inside the app sandbox while docs/12 says everything at rest is ciphertext | S3 | M | D3 | R2 | C1 | 0.5 | AGENT-ASSISTED |
| GAP-075 | FEAT | Review triage has no undo; docs/08 rule 9 promises a ten-second undo affordance | S3 | M | D2 | R2 | C1 | 0.5 | AGENT-READY |
| GAP-085 | FEAT | Bill detail has no manual "mark paid" and omits the due rule, reminder schedule and auto-match summary the doc lists | S3 | M | D2 | R2 | C1 | 0.5 | AGENT-READY |
| GAP-080 | CODE | Archiving a wallet with "move transactions" relocates transfer legs and provider balance anchors into the destination wallet | S3 | M | D2 | R3 | C2 | 0.4 | AGENT-READY |
| GAP-091 | CONTRA | The provider picker and wallet proposals run before notification access exists, so "Apps we've seen" is empty on every fresh install | S3 | M | D2 | R2 | C2 | 0.4 | AGENT-ASSISTED |
| GAP-099 | SEC | The full-database export writes a plaintext JSON dump to the cache directory, never deletes it, and reports success when sharing is unavailable | S2 | XS | D1 | R1 | C1 | 5.0 | AGENT-READY |

Pass-2 rows (GAP-058 to GAP-097) are appended below the pass-1 rows in their own priority order rather than merged, so the pass-1 ordering stays stable for agents already assigned.

## 5. Index by category

CODE (17): 006, 008, 009, 011, 012, 013, 031, 034, 035, 040, 041, 042, 047, 048, 049, 057, 005.
Sorted by priority: 005 (2.0), 006 (2.0), 008 (1.6), 009 (1.6), 011 (1.25), 012 (1.25), 013 (1.25), 031 (1.0), 034 (1.0), 035 (0.8), 040 (0.8), 041 (0.8), 042 (0.8), 047 (0.5), 048 (0.5), 049 (0.5), 057 (0.25).

FEAT (11): 003 (2.5), 010 (1.25), 018 (1.0), 020 (1.0), 032 (1.0), 033 (1.0), 036 (0.8), 037 (0.8), 038 (0.8), 055 (0.29), 056 (0.29).

TEST (2): 039 (0.8), 052 (0.4).

SEC (5): 002 (3.2), 014 (1.25), 017 (1.0), 019 (1.0), 028 (1.0).

OPS (4): 001 (5.0), 053 (1.0, order override), 044 (0.71), 051 (0.5).

DOC (4): 007 (2.0), 015 (1.0), 016 (1.0), 045 (0.5).

PROJ (2): 027 (1.0), 046 (0.5).

CONTRA (12): 004 (2.5), 021 (1.0), 022 (1.0), 023 (1.0), 024 (1.0), 025 (1.0), 026 (1.0), 029 (1.0), 030 (1.0), 043 (0.71), 050 (0.5), 054 (0.29).

Pass 2 by category (sorted by priority):

CODE (21): 058 (2.5), 060 (2.5), 063 (2), 071 (2), 076 (2), 081 (2), 084 (2), 086 (2), 095 (2), 094 (1.6), 064 (1), 065 (1), 070 (1), 077 (1), 078 (1), 079 (1), 082 (1), 083 (1), 092 (1), 066 (0.8), 080 (0.4).

TEST (3): 062 (2), 096 (1), 097 (1).

SEC (4): 073 (2), 074 (2), 059 (1), 068 (0.8).

CONTRA (9): 088 (2), 090 (2), 093 (1.6), 061 (1.25), 087 (1), 089 (1), 067 (0.5), 072 (0.5), 091 (0.4).

FEAT (3): 069 (1), 075 (0.5), 085 (0.5).

Residue sweep: CODE 098 (0.8).

## 6. Index by complexity

XS (9): 001, 005, 006, 007, 008, 009, 025, 026, 027.
S (31): 002, 003, 004, 015, 016, 017, 018, 019, 020, 021, 022, 023, 024, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 046, 047, 048, 049, 053.
M (12): 010, 011, 012, 013, 014, 028, 029, 045, 050, 051, 052, 057.
L (5): 043, 044, 054, 055, 056.
XL (0).

Quick wins a fleet can clear first (XS or S, AGENT-READY, no open questions): 001, 005, 006, 007, 008, 009, 003, 004, 015, 016, 017, 018, 019, 020, 031, 032, 033, 035, 036, 037, 038, 040, 041, 047, 048, 049.

Pass 2 by complexity:

XS (14): 062, 063, 071, 073, 074, 076, 081, 084, 086, 088, 090, 093, 094, 095.
S (18): 058, 060, 064, 065, 066, 068, 069, 070, 077, 078, 079, 082, 083, 087, 089, 092, 096, 097.
M (8): 059, 061, 067, 072, 075, 080, 085, 091.
L (0): none.
XL (0): none.

Pass-2 quick wins (XS or S, AGENT-READY, no open questions): 058, 060, 062, 063, 071, 073, 074, 076, 081, 084, 086, 088, 090, 095, 094, 064, 065, 069, 070, 077, 078, 079, 082, 083, 087, 089, 092, 096, 097, 066.

Residue sweep: S: 098.

## 7. Recommended execution order

Agents work in separate worktrees and merge into master. Every wave below was checked for file conflicts by listing each gap's file set; sets within a wave are disjoint. Human-decision and device-only items sit in Wave 0 because they consume no agent and can run at any time.

Wave 0 (owner decisions and device work, any time): GAP-021, 022, 023, 024, 025, 026, 027, 043, 054 (decision briefs in section 8); GAP-039 (device session).

Wave 1 (5 agents)
- GAP-001: `mobile/app.json`, `mobile/.eas/workflows/create-production-builds.yml`
- GAP-003: `mobile/app/(onboarding)/done.tsx`, `mobile/app/(onboarding)/__tests__/` (new test), `docs/04-features/01-onboarding.md`
- GAP-005: `mobile/lib/safe_to_spend_service.ts`, `mobile/lib/__tests__/safe_to_spend_service.test.ts`
- GAP-006: `mobile/lib/limits/limit_engine.ts`, `mobile/lib/limits/__tests__/limit_engine_basis.test.ts`
- GAP-007: `docs/DEPLOYMENT.md`
Disjoint: yes.

Wave 2 (5 agents)
- GAP-002: `mobile/lib/crypto/cache_cipher.ts`, `mobile/lib/query_client.ts`, `mobile/lib/crypto/__tests__/cache_cipher.test.ts`
- GAP-004: `mobile/lib/income/income_service.ts`, `mobile/lib/income/__tests__/income_service.test.ts`
- GAP-008: `mobile/lib/recurring/recurring_service.ts`, `mobile/lib/recurring/__tests__/recurring_service.test.ts`
- GAP-009: `mobile/components/loans/loan_form.tsx`, `mobile/types/domain.ts`, `mobile/components/loans/__tests__/` (test)
- GAP-010: `mobile/lib/wallets/reconcile_scheduler.ts` (new), `mobile/lib/db/repos/app_settings_repo.ts`, `mobile/lib/db/repos/wallets_repo.ts`, `mobile/app/_layout.tsx`, `mobile/components/wallets/wallet_card.tsx`, tests under `mobile/lib/wallets/__tests__/`
Disjoint: yes.

Wave 3 (5 agents)
- GAP-011: `mobile/lib/ingest/pipeline.ts`, `mobile/lib/db/repos/raw_notifications_repo.ts`, `mobile/lib/ingest/__tests__/pipeline.test.ts`, `mobile/lib/db/repos/__tests__/raw_notifications_repo.test.ts`
- GAP-013: `mobile/lib/query_client.ts`, `mobile/components/ui/mutation_error_toast.tsx` (new), `mobile/app/_layout.tsx`, `mobile/lib/__tests__/query_client.test.ts`
- GAP-014: `mobile/services/parser_rules.ts`, `mobile/lib/ingest/ruleset_schema.ts` (new), `mobile/lib/ingest/parser.ts`, `mobile/services/__tests__/parser_rules.test.ts`, `mobile/package.json` (add zod)
- GAP-017: `mobile/app/(onboarding)/recovery_phrase.tsx`, `mobile/components/onboarding/phrase_display.tsx`, `mobile/components/onboarding/phrase_confirm.tsx`, `mobile/components/lock/recovery_unlock_form.tsx`, `mobile/components/onboarding/__tests__/recovery_phrase.test.tsx`, `mobile/package.json` (add expo-screen-capture)
- GAP-019: `server/apps/web/next.config.ts`, `server/apps/web/__tests__/security_headers.test.ts` (new), `docs/nginx/peraplano-production.conf`
Conflict note: GAP-014 and GAP-017 both add a dependency to `mobile/package.json`. Run GAP-014 first and let GAP-017 rebase, or have one agent do both package additions. Otherwise disjoint. GAP-002 (Wave 2) and GAP-013 both touch `mobile/lib/query_client.ts`; that is why GAP-013 is in Wave 3.

Wave 4 (5 agents)
- GAP-012: `mobile/lib/ingest/pipeline.ts`, `mobile/lib/review/resolve_actions.ts`, `mobile/lib/db/repos/review_queue_repo.ts`, `mobile/types/domain.ts`, tests for each
- GAP-015: `docs/12-encryption-and-app-lock.md`
- GAP-016: `docs/03-ingest-pipeline.md`
- GAP-018: `mobile/app/(tabs)/more/index.tsx`, `mobile/app/(tabs)/more/permissions.tsx` (new), `mobile/app/__tests__/permissions_screen.test.tsx` (new), `docs/04-features/11-settings-privacy.md`
- GAP-020: `mobile/components/goals/goal_form.tsx`, `mobile/components/goals/__tests__/goal_form.test.tsx`
Disjoint: yes (GAP-012 follows GAP-011 on `pipeline.ts`).

Wave 5 (5 agents)
- GAP-028: `docs/07-privacy-and-compliance.md`, `docs/OTA_RUNBOOK.md` (new), `mobile/app.json` (after Wave 1)
- GAP-029: `mobile/lib/db/repos/loans_repo.ts`, `mobile/lib/loans/loans_service.ts`, `mobile/components/loans/loan_card.tsx`, tests
- GAP-030: `mobile/contexts/lock_context.tsx`, `mobile/contexts/__tests__/lock_context.test.tsx`, `docs/12-encryption-and-app-lock.md` (after Wave 4)
- GAP-031: `mobile/lib/db/repos/transfer_links_repo.ts`, `mobile/lib/review/resolve_actions.ts` (after Wave 4), tests
- GAP-032: `mobile/lib/db/repos/transactions_repo.ts`, `mobile/lib/db/repos/wallets_repo.ts` (after Wave 2), tests
Disjoint: yes.

Wave 6 (6 agents)
- GAP-033: `mobile/lib/loans/loan_match_queue.ts`, `mobile/lib/loans/loans_service.ts` (after Wave 5), `mobile/lib/db/repos/user_rules_repo.ts`, tests
- GAP-034: `mobile/contexts/lock_context.tsx` (after Wave 5), `mobile/app/lock.tsx`, tests
- GAP-035: `mobile/lib/db/repos/raw_notifications_repo.ts` (after Wave 3), tests
- GAP-036: `mobile/components/wallets/archive_wallet_sheet.tsx`, `mobile/app/wallet/[id].tsx`, tests
- GAP-037: `mobile/lib/income/income_service.ts` (after Wave 2), tests
- GAP-038: `mobile/app/(tabs)/plan/goals/[id].tsx`, `mobile/lib/db/repos/goals_repo.ts`, `mobile/components/goals/goal_card.tsx`, `docs/04-features/05-goals-savings.md`, tests
Disjoint: yes.

Wave 7 (5 agents)
- GAP-040: `mobile/lib/ingest/pipeline.ts` (after Wave 4), tests
- GAP-041: `mobile/lib/limits/limit_service.ts`, tests
- GAP-045: `docs/04-features/02-wallets.md`, `03-limits.md`, `05-goals-savings.md`, `07-bills.md`, `10-reports.md`, `06-information-architecture.md`, `docs/02-domain-model.md`, `docs/09-v2-backlog.md`
- GAP-046: git branch deletion, `HANDOFF.md`, `mobile/package.json` version field, `docs/pera-plano-mobile/uploads/`, `docs/pera-plano-web/uploads/`, `.github/dependabot.yml` (new), `CLAUDE.md` (new, after GAP-027 decision)
- GAP-052: `mobile/app/__tests__/bills_screen.test.tsx`, `transactions_screen.test.tsx`, `home_screen.test.tsx`, `review_queue.test.tsx`, `mobile/components/gates/__tests__/gates.test.tsx`, onboarding e2e test files
Disjoint: yes.

Wave 8 (5 agents)
- GAP-044: `mobile/lib/db/migrations.ts`, `mobile/lib/db/database.ts`, `mobile/lib/db/__tests__/migrations.test.ts`
- GAP-047: `mobile/lib/income/income_math.ts`, `mobile/lib/income/cadence_detector.ts`, `mobile/lib/db/repos/transactions_repo.ts` (after Wave 5), tests
- GAP-048: `mobile/lib/ingest/pipeline.ts` (after Wave 7), tests
- GAP-049: `mobile/lib/query_client.ts` (after Wave 3), `mobile/constants/query_keys.ts`, selected hooks under `mobile/hooks/queries/`
- GAP-053: `.github/workflows/mobile-ci.yml` (new), after GAP-052
Disjoint: yes.

Wave 9 (device required; 2 agents prepare, owner verifies)
- GAP-050: `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/PeraPlanoNotificationListenerService.kt` (`onListenerConnected`), `NotificationListenerModule.kt`, JVM test
- GAP-051: `CaptureBuffer.kt`, `mobile/lib/alerts/tracking_health_subscriber.ts`, `mobile/modules/notification_listener/index.ts`, JVM test
Disjoint: yes (service versus buffer).

Wave 10 (device required)
- GAP-042: `PeraPlanoNotificationListenerService.kt` (`extractCapture`, after Wave 9), JVM test

Waves 11 to 13 (one at a time; each adds a numbered migration and migration numbers must not collide)
- GAP-055: new migration `019_goal_milestones.sql`, `mobile/lib/db/migrations.ts`, `mobile/lib/db/repos/goals_repo.ts`, `mobile/lib/goals/goal_milestone_subscriber.ts` (new), `mobile/app/_layout.tsx`
- GAP-056: new migration `020_planned_contributions.sql`, `mobile/lib/db/migrations.ts`, `mobile/lib/goals/goals_service.ts`, `mobile/lib/safe_to_spend_service.ts`, `mobile/components/goals/allocation_sheet.tsx`
- GAP-057: new migration `021_review_resolution.sql`, `mobile/lib/db/migrations.ts`, `mobile/lib/db/repos/review_queue_repo.ts`, `mobile/lib/db/repos/user_rules_repo.ts`, `mobile/lib/db/mappers.ts`, `mobile/types/`

Pass-2 waves (run after or interleaved with the pass-1 waves; file sets within each wave are disjoint, checked against every entry's location list)

Wave P0 (owner decisions): GAP-061 (build the transaction editor or scope docs/07), GAP-067 (onboarding cursor or doc), GAP-072 (encrypt attachments or document), GAP-093 (Auto Backup off or documented); GAP-068 (app-wide or background-only secure flag) can be answered in one line.

Wave P1 (5 agents, all XS or S, AGENT-READY)
- GAP-058: `mobile/hooks/mutations/*`, `mobile/app/(tabs)/index.tsx`, `mobile/hooks/queries/use_safe_to_spend_input.ts`
- GAP-060: `mobile/components/transactions/manual_entry_form.tsx`, `mobile/app/transaction/new.tsx`
- GAP-062: `NotificationListenerModuleTest.kt`, `CaptureRecordTest.kt`
- GAP-073 and GAP-074 together: `mobile/lib/reports/csv_export.ts` and its test
- GAP-063 and GAP-064 together: `mobile/app/(tabs)/plan/loans/[id].tsx`, `mobile/lib/loans/loans_service.ts`, `loan_routes.test.tsx`

Wave P2 (5 agents)
- GAP-065 and GAP-086 together: `mobile/app/(tabs)/plan/bills/[id].tsx`, `mobile/lib/bills/bills_service.ts`, `bills_screen.test.tsx`
- GAP-071: `mobile/lib/alerts/tracking_health_subscriber.ts`, `tracking_notifier.ts`
- GAP-076 and GAP-077 together: `mobile/app/transaction/[id].tsx`, `transfer_link_actions.tsx`, `mobile/app/(tabs)/transactions.tsx`
- GAP-081: `mobile/components/bills/due_rule_picker.tsx`, `bill_form.tsx`
- GAP-095: `mobile/components/transactions/manual_entry_form.tsx` (after GAP-060 merges), `transaction_row.tsx`

Wave P3 (5 agents)
- GAP-066: `mobile/lib/query_client.ts`, `mobile/app/(tabs)/index.tsx` (after GAP-058 merges)
- GAP-069: `mobile/app/_layout.tsx`
- GAP-098: `mobile/lib/limits/limit_service.ts`, `limit_ledger_subscriber.ts` and their tests
- GAP-070: `mobile/lib/safe_to_spend_service.ts` and its test
- GAP-084: `mobile/components/goals/allocation_sheet.tsx`
- GAP-088 and GAP-090 together: `report_problem_form.tsx`, `done.tsx` and their tests

Wave P4 (4 agents; GAP-013's toast must have merged first for GAP-079)
- GAP-078: `lock_context.tsx`, `done.tsx` (after Wave P3), `(onboarding)/index.tsx`, `_layout.tsx` (after GAP-069), `transaction/new.tsx` (after GAP-060)
- GAP-079: the five sheets, `review_card.tsx`, `wallet/new.tsx`, `wallet/[id]/edit.tsx`
- GAP-082 and GAP-083 together: `loan_form.tsx`, `goal_form.tsx`, `loan_form.test.tsx` (GAP-082 waits on GAP-029's decision for the stored figure)
- GAP-089: `capture_toggle.tsx`, `more/privacy.tsx`

Wave P5 (4 agents)
- GAP-080: `transactions_repo.ts`, `archive_wallet_sheet.tsx`
- GAP-085: `bills/[id].tsx` (after Wave P2), new mutation hook
- GAP-087: `more/reports.tsx`, `reports_screen.test.tsx`
- GAP-092: `mobile/lib/bootstrap.ts`, `CapturePrefs.kt` comment, `app_settings_repo.ts` comment

Wave P6 (specialist, one at a time)
- GAP-059: `KeyVault.kt`, `KeyStoreBridge.kt`, `NotificationListenerModule.kt`, `index.ts`, `CaptureBuffer.kt`, `key_manager.ts`
- GAP-094: `PeraPlanoNotificationListenerService.kt`, `CapturePrefs.kt`
- GAP-096: the JVM tests (after GAP-059 and GAP-062)
- GAP-097: the listed screen tests (after the entries they pin have merged)

Wave P7 (after the P0 decisions)
- GAP-061, GAP-067 then GAP-091, GAP-068, GAP-072, GAP-075 (needs GAP-013), GAP-093

## 8. Contradiction register

Authority order used unless stated: verified on-device measurement, then current code, then `docs/01-mvp-scope.md`, then the rest of `docs/`.

### GAP-004 Automatic income drift re-snapshots limit bases mid-period
- Position A (docs/04-features/03-limits.md:85, 2026-08-02; and the code's own contract at `mobile/lib/limits/limit_service.ts:335-338`): automatic `averageAmount` drift applies from the next period start so alerts never flap.
- Position B (`mobile/lib/income/income_service.ts:231-240`, `:285-287`, called on every ledger commit via `income_ledger_subscriber.ts:64`): confirmed re-detection writes the profile and immediately calls `recomputePercentLimits`, which overwrites the current period's base.
- Authoritative: Position A. The doc and the limit service's contract agree; only the income service violates it.
- Blast radius: `income_service.ts`, `limit_service.ts` alert state, every percent-of-income limit, Safe-to-Spend headroom, limit threshold alerts.
- Decision required: none. An agent may resolve it (GAP-004 checklist).

### GAP-021 Telemetry default
- Position A (`mobile/lib/db/repos/app_settings_repo.ts:246`): `telemetry_enabled: true`, sent from the second launch on with no onboarding disclosure (grep of `mobile/app/(onboarding)/` and `more/privacy.tsx` for "telemetry" returns nothing; the only copy is `settings.tsx:329`).
- Position B (docs/08-risks-and-open-questions.md:287, per-doc index, and docs/07 §2.3 line 35): the default is listed as "on vs opt-in, decide with the NPC compliance review"; docs/07 relies on legitimate interest with opt-out.
- Authoritative: cannot be determined from the repository. The docs explicitly leave it open; the code chose "on".
- Blast radius: `app_settings_repo.ts` default, `services/telemetry.ts`, settings copy, the privacy notice on the web site (`server/apps/web/components/pages/privacy_page.tsx`), the Play Data safety form, docs/07 §2.3 and §4 row 5.
- Decision required: RESOLUTION: HUMAN REQUIRED. Brief: the payload is seven count-only fields and the server does not exist yet, so the practical exposure today is nil. The question is legal posture: legitimate interest with opt-out (keep default on, add a one-line disclosure to the onboarding how-it-works screen and the privacy notice) versus consent (default off, add a toggle to onboarding). Counsel review is already an open item (docs/08 §3.1 #1). Recommended interim: keep on, add the disclosure, record the decision in docs/07.

### GAP-022 Wallet delete versus archive
- Position A (docs/04-features/02-wallets.md:92-97, :118, 2026-08-02): delete immediately when the wallet has no transactions; otherwise reassign transactions or archive.
- Position B (`mobile/lib/db/repos/wallets_repo.ts:119-122` "There is deliberately no deleteWallet export"; `mobile/components/wallets/archive_wallet_sheet.tsx:12` "DELETE IS NOT ON OFFER, ANYWHERE"; but `mobile/app/wallet/[id].tsx:515` renders "Delete wallet" and `:343` shows a "Deleted" chip on an archived wallet).
- Authoritative: current code for behaviour (archive only, reversible, history kept). The UI wording contradicts both the code and the doc.
- Blast radius: wallet detail and edit screens, archive sheet, wallets doc flow and rules 17-18, the Free-tier "archiving frees a slot" rule in docs/05 §3.2.
- Decision required: RESOLUTION: HUMAN REQUIRED. Brief: either (a) keep archive-only and rename the UI to "Archive" and "Archived", then rewrite the doc's delete flow; or (b) build delete-with-reassign per doc. Option (a) is one afternoon and matches the owner's recorded "no hard delete" stance for loans and limits (migration 010 header). Recommend (a).

### GAP-023 Derived limits at four cadences
- Position A (docs/04-features/03-limits.md:36-46, :139; docs/05 §2 "1 active"): creating a limit creates one limit at one scope; Free allows exactly one active limit.
- Position B (`mobile/lib/limits/limit_derivation.ts:1-14`, owner decision 2026-08-20; `mobile/app/(tabs)/plan/limits/new.tsx:44`, `mobile/app/(onboarding)/first_limit.tsx:32`): entering one limit writes the equivalent at the other three cadences, each with `isActive` copied from the source (`limit_derivation.ts:126`) and `derived_from` set (migration 010).
- Authoritative: current code, by dated owner decision. The doc is stale.
- Blast radius: limits doc, `entitlements.ts` `canCreateLimit(activeCount)` and its callers (`limits_panel.tsx:131`), the Free-tier flip, Safe-to-Spend candidate selection (rule 2 "ties break toward the shorter scope" now always has four candidates).
- Decision required: RESOLUTION: HUMAN REQUIRED for the Free cap only. Brief: when the tier flips to Free, do derived rows count toward "1 active"? Options: (a) count the source row only (derived rows follow it), (b) count all four (every Free user is instantly over cap). Recommend (a). The doc update itself is agent work (folded into GAP-045).

### GAP-024 Free reports window
- Position A (docs/04-features/10-reports.md:42, :50, :85; docs/04-features/02-wallets.md:158, 2026-08-02): Free users can step back through months within the 90-day history window.
- Position B (`mobile/lib/reports/reports_service.ts:125-142`): Free clamps every request to the current calendar month.
- Authoritative: cannot be determined; docs/01 §5 says "History 90 days" and "Reports basic monthly", which each side reads differently. Inert today because the tier is hardcoded to plus.
- Blast radius: `reports_service.ts` scope resolution, reports screen month picker, docs 10 and 02, the Plus gate sheet copy.
- Decision required: RESOLUTION: HUMAN REQUIRED. Brief: a Free user on the 1st of the month sees an almost empty report. Options: (a) allow any month whose start is within 90 days (three months back), (b) keep current-month-only and fix the docs. Recommend (a); it is a five-line change in `resolveScope` and matches the "basic monthly" wording better than a blank page.

### GAP-025 Categorizer rule conflict order
- Position A (docs/04-features/08-review-queue.md:130): specificity first (exact-merchant beats pattern), then recency.
- Position B (`mobile/lib/ingest/categorizer.ts:218-226`): priority, then recency; every rule is created with priority 0 (`user_rules_repo.ts:171`) and every merchant matcher is a substring (`rule_matcher.ts:56`), so there is no exact kind to be more specific.
- Authoritative: docs/02 §3.11 says "Later-created rules evaluate first; the first matching rule per action type wins", which matches the code. The feature doc adds specificity on its own.
- Blast radius: `categorizer.ts`, `rule_matcher.ts`, user rules doc.
- Decision required: RESOLUTION: HUMAN REQUIRED (product intent). Brief: a later broad "SM" rule overrides an earlier "SM Hypermarket" rule today. Options: (a) reword the feature doc to match docs/02 and the code, (b) sort by matcher specificity (fields set, then pattern length) before recency. Recommend (b) if the Review Queue shows users the rule that fired; otherwise (a).

### GAP-026 Free caps 1 versus 3
- Position A (`mobile/lib/entitlements.ts:16-19`; docs/05 §2; docs/01 §5): Limits 1 active, Goals 1.
- Position B (`docs/pera-plano-mobile/PeraPlano Mobile UI.dc.html` Free-vs-Plus board): "Limits and goals, 3 each".
- Authoritative: docs/01 (binding scope) and the code agree on 1. docs/08 §3.4 already records this and says "nobody has yet decided which side moves".
- Blast radius: the four cap constants, the gate sheet copy (currently number-free on purpose), the design board.
- Decision required: RESOLUTION: HUMAN REQUIRED, before pricing, as docs/08 says. Nothing behaves wrongly while the tier is plus.

### GAP-029 Loan outstanding balance
- Position A (docs/04-features/06-loans.md:82-83, :88-89): flat loans owe total repayable minus payments; amortized loans owe the schedule remainder; only free-form loans owe principal minus payments plus adjustments.
- Position B (`mobile/lib/db/repos/loans_repo.ts:635`): `Math.max(0, loan.principal - paid + adjusted)` for every schedule kind; `loans_service.ts:270` feeds the same figure to next-due.
- Authoritative: the doc. Its own 5-6 example (borrow ₱5,000, repay ₱6,000) shows the code marking the loan settled ₱1,000 early.
- Blast radius: loan detail and card, settled state, payment matching ceiling (`loans_service.ts:381-387`), loan reminders, the Plan tab utang total.
- Decision required: none on intent; AGENT-ASSISTED because the flat total is currently derived in the form (`loan_form.tsx:157-158`) and not stored, so the agent must decide where to persist it (recommend: sum of `schedule[].amountDue` at read time, no schema change).

### GAP-030 Locked state
- Position A (docs/12-encryption-and-app-lock.md:156, :168-170): re-lock after five minutes in the background; while locked the DEK is cleared and the database handle closed.
- Position B (`mobile/contexts/lock_context.tsx:239-261`): the five-minute check runs only on the return to foreground; nothing fires during the background stay; `queryClient` is never cleared (grep for `queryClient.clear|removeQueries|resetQueries` returns nothing).
- Authoritative: current code for what happens; the doc for what was intended. Within the docs/12 §4 threat model the exposure is memory-only and out of scope, so this is a wording gap plus a cheap hardening.
- Blast radius: `lock_context.tsx`, docs/12 §7.
- Decision required: none. AGENT-ASSISTED because a background timer on Android is best-effort and the doc must state that.

### GAP-043 Ruleset integrity and staged rollout
- Position A (docs/03-ingest-pipeline.md:328-330, 2026-08-02): updates are "verified for integrity and authenticity before activation", rolled out in stages, and rolled back on regression.
- Position B (`mobile/services/parser_rules.ts:58-83`, `:153`): a bundle is accepted if its version is higher, providers is non-empty, and each regex compiles; no signature, no rollout percentage, no rollback.
- Authoritative: the doc states the security intent; the code is an MVP stub written before any server existed (`services/api.ts:4-8`).
- Blast radius: `parser_rules.ts`, the future server route, key management, the Play declaration (a signed ruleset channel is part of the "no remotely delivered logic" story in docs/03 §4 rule 1).
- Decision required: RESOLUTION: HUMAN REQUIRED. Brief: the app trusts TLS to a host the owner controls. Options: (a) Ed25519 signature over the bundle with the public key in the app and the private key held offline by the owner; (b) pin the server certificate; (c) accept TLS-only and amend docs/03. (a) is the only one that also protects against a compromised server. Cost: a signing step in whatever publishes rulesets, plus about 60 lines in `parser_rules.ts`. Staged rollout needs a device-side percentage bucket and is a separate, smaller decision. GAP-014 (validation and bounds) should ship regardless.

### GAP-050 Snapshot catch-up on reconnect
- Position A (docs/03-ingest-pipeline.md:37 principle 5, :64, :379): on reconnection the listener reads the notifications still in the status bar and feeds them through the pipeline.
- Position B (`PeraPlanoNotificationListenerService.kt:80-84`): `onListenerConnected` only ensures the Keystore keys and records the connection state; `getActiveNotifications` is never called (grep returns nothing in the module).
- Authoritative: the doc; the code never implemented it. docs/13 session 1 "reboot survival PASS" proves rebinding, not catch-up.
- Blast radius: the listener service, `CaptureBuffer`, dedupe (snapshot notifications carry their original keys, so the replay guard handles repeats), the tracking-interrupted banner copy.
- Decision required: none on intent. HUMAN-FIRST because the acceptance test needs the physical device.

### GAP-054 Cloud backup
- Position A (docs/01-mvp-scope.md:145 tier matrix; docs/07 §4 row 6; docs/12 §8 and §9; docs/00 §5 "only committed transaction records sync"): backup is a built, Plus-gated feature.
- Position B (`mobile/services/api.ts:11-15` "This file gains an interceptor when cloud backup ships"; `hasBackup()` in `entitlements.ts` has no caller; no backup code, route or server exists).
- Authoritative: current code. docs/01 §2 lists L1 to L3 capabilities and backup is not among them; only the tier matrix and the privacy and encryption docs mention it. Memory: Plus is blocked on a PIC entity, DPO and NPC registration.
- Blast radius: docs 00, 01, 05, 07, 12; the recovery-phrase promise (GAP-015); the Play Data safety form draft.
- Decision required: RESOLUTION: HUMAN REQUIRED. Brief: either mark backup "planned, not in MVP" in every doc row that lists it (one agent, one wave) or keep the docs and accept that the privacy notice describes a feature that does not exist. Recommend the former now; it also fixes the recovery-phrase overclaim.

### Pass-2 contradictions (summary; positions and blast radius are in each entry)

- GAP-061 Transaction detail editability: docs/07 rectification versus note-and-category only. Decision required: RESOLUTION: HUMAN REQUIRED (build or scope).
- GAP-067 Onboarding resume: docs/01 rule 6 versus deliberate restart. Decision required: RESOLUTION: HUMAN REQUIRED on the cursor; idempotency is agent work.
- GAP-072 Support attachments at rest: docs/12 §4 "everything is ciphertext" versus plaintext copies. Decision required: RESOLUTION: HUMAN REQUIRED (encrypt or document).
- GAP-087 Free-tier trend card: docs/10 locked preview versus "not enough periods". Authoritative: docs/10. No decision.
- GAP-088 Support disclosure: copy versus wire whitelist. Authoritative: the whitelist; fix the copy. No decision.
- GAP-089 Privacy centre tracking row: docs/01 at-risk states versus switch-only copy. Authoritative: docs/01. No decision.
- GAP-090 Done screen copy: docs/01 step 10 versus unconditional auto-mode copy. Authoritative: docs/01. No decision.
- GAP-091 Provider picker position: docs/01 steps 6 and 7 versus pre-access picker. Authoritative: docs/01; confirm the order with the owner before moving.
- GAP-093 Auto Backup: docs/07:11 versus the platform default. Decision required: RESOLUTION: HUMAN REQUIRED (disable, or document as an encrypted restore path).

## 9. Gap detail entries

### GAP-001 [OPS] Uncommitted app.json and EAS tooling changes duplicate permissions, add RECORD_AUDIO, and add an iOS build job

> **REMEDIATION: DONE** (2026-09-04) - commit 8db6f2c, branch worktree-gap-wave-1. Verification: jest modules/notification_listener 4 suites 64 tests PASS

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | XS |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 5.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | GAP-028 |
| Est. agent turns | 1-2 |

**Location**
- `mobile/app.json:17-35` working tree (primary; `android.permissions` and `android.blockedPermissions`)
- `mobile/app.json:81` working tree (`"ios": {}`)
- `mobile/.eas/workflows/create-production-builds.yml:8-11` (untracked)
- `mobile/modules/notification_listener/__tests__/blocked_permissions.test.ts:73-76` (the blocked list the tests pin)

**Evidence**
`git diff mobile/app.json` shows `android.permissions` now listing `android.permission.USE_BIOMETRIC` and `USE_FINGERPRINT` twice each plus a new `android.permission.RECORD_AUDIO` (lines 19-23), and `blockedPermissions` listing all six entries twice. The untracked workflow declares `build_ios: type: build, params: platform: ios`. `RECORD_AUDIO` is not in `BLOCKED_PERMISSIONS` in the test file (which lists the two storage permissions and `SYSTEM_ALERT_WINDOW`).

**What is wrong**
An `expo install expo-updates` plus `eas update:configure` run outside any session appended array entries instead of merging them. The result is uncommitted, so HEAD is clean, but the next `git add -A` ships a finance app that declares a microphone permission it never uses and an iOS build job for an Android-only product. Duplicate entries are harmless to the build but noise to review.

**Why it matters**
A microphone permission on a notification-reading finance app is exactly the kind of widened footprint the Play declaration reviewer flags (docs/07 §3.1 rule 6). The iOS job would fail or bill for nothing.

**Intended behavior**
`permissions` lists `USE_BIOMETRIC` and `USE_FINGERPRINT` once each and nothing else; `blockedPermissions` lists its six entries once; no `RECORD_AUDIO`; no iOS job; `ios: {}` removed unless EAS requires it (it does not for Android-only builds).

**Proposed fix**
Edit the working-tree file by hand: dedupe both arrays, drop `RECORD_AUDIO`, drop the `ios` key. Delete the `build_ios` job from the workflow or delete the workflow file until EAS Workflows are actually adopted. Keep `runtimeVersion` and `updates.url` (GAP-028 covers their governance). Commit together with the `expo-updates` dependency so the tree is consistent.

**Implementation checklist**
- [ ] In `mobile/app.json`, remove the duplicate `USE_BIOMETRIC` and `USE_FINGERPRINT` entries and the `RECORD_AUDIO` entry from `android.permissions`.
- [ ] In `mobile/app.json`, remove the six duplicate entries from `android.blockedPermissions`.
- [ ] In `mobile/app.json`, remove the `"ios": {}` key.
- [ ] In `mobile/.eas/workflows/create-production-builds.yml`, remove the `build_ios` job (or delete the file if EAS Workflows are not in use).
- [ ] Run the notification-listener plugin tests to confirm the blocked list still applies.
- [ ] Commit `mobile/app.json`, `mobile/package.json`, `mobile/package-lock.json` and the workflow change in one commit that names expo-updates.

**Acceptance criteria**
- [ ] `grep -c USE_BIOMETRIC mobile/app.json` prints 1 and `grep -c RECORD_AUDIO mobile/app.json` prints 0.
- [ ] `grep -c READ_EXTERNAL_STORAGE mobile/app.json` prints 1.
- [ ] No file under `mobile/.eas/` mentions `ios`.
- [ ] `git status` shows no modified `mobile/app.json` after the commit.

**Verification commands**
```bash
cd mobile && npm test -- modules/notification_listener
cd mobile && npm run typecheck
```

**Do not**
Do not add `RECORD_AUDIO` to `blockedPermissions` as a workaround; removing it from `permissions` is the fix. Do not touch `runtimeVersion` or `updates.url`. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
`git checkout -- mobile/app.json` before commit; after commit, revert the commit. No data impact.

**Open questions**
none

### GAP-002 [SEC] Persisted query cache can be encrypted under a zeroed key when a write is in flight at lock time

> **REMEDIATION: DONE** (2026-09-04) - commit 320f4d3 + 1ebb8a5, branch gap-wave-2. Verification: jest lib/crypto + contexts + query_client 8 suites 145 tests PASS; regression reproduces the zero-key blob end to end. Diff reviewed line by line; 1ebb8a5 clears the cache key on the wipe path too

| Field | Value |
|---|---|
| Severity | S1 Critical |
| Complexity | S |
| Difficulty | D3 Specialist |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 3.2 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | none |
| Blocks | GAP-049 |
| Est. agent turns | 4-8 |

**Location**
- `mobile/lib/crypto/cache_cipher.ts:92-105` (primary, `encryptCacheValue`)
- `mobile/lib/query_client.ts:89-103` (serialize captures the key reference)
- `mobile/contexts/lock_context.tsx:207-213` (`lockNow` ordering) and `:323` (`setCacheEncryptionKey(dek)` shares the buffer)
- `mobile/lib/crypto/key_manager.ts:366-371` (`dek.fill(0)`)
- `mobile/lib/crypto/__tests__/cache_cipher.test.ts:158-240` (null and empty key cases only)

**Evidence**
```
cache_cipher.ts:96   const realKey = requireKey(key);
cache_cipher.ts:97   const nonce = await Crypto.getRandomBytesAsync(GCM_NONCE_BYTES);
cache_cipher.ts:99   const ciphertext = gcm(realKey, nonce).encrypt(plaintext);
lock_context.tsx:208 QueryCache.clearCacheEncryptionKey();
lock_context.tsx:209 await Database.closeDatabase();
lock_context.tsx:210 KeyManager.lock();
key_manager.ts:368   dek.fill(0);
```

**What is wrong**
`encryptCacheValue` resolves the key reference before an `await`, then encrypts after it. `lockNow` clears the module-level reference (which only stops writes that start later), awaits the database close, then zeroes the same `Uint8Array` in place. A serialize call parked on `getRandomBytesAsync` during that await resumes with a buffer of 32 zero bytes and writes the whole dehydrated cache to AsyncStorage under a public key. On the next unlock the blob fails authentication under the real key and is silently discarded, so nothing detects it, and it stays on disk until the next successful write.

**Why it matters**
The offline attacker docs/12 §4 puts in scope (stolen phone, unencrypted device backup) can read a full copy of transactions, wallet balances, merchant names and bills. The window is small (the persister throttles writes and the lock runs on the same foreground transition that wakes subscribers), which is why this is C2 rather than C1, but the outcome when it lands is plaintext financial data at rest.

**Intended behavior**
No cache write can complete under a key other than the live DEK. docs/12 §8: "The persisted React Query cache in AsyncStorage: AES-256-GCM with a key wrapped the same way as the DEK".

**Proposed fix**
Pass a key getter into the codec instead of a captured value, draw the nonce first, then read the key with no `await` between the read and the encrypt, and reject the write when the getter returns null. Give `setCacheEncryptionKey` its own copy of the DEK and zero that copy in `clearCacheEncryptionKey`, so `KeyManager.lock()` cannot mutate a buffer this module still holds. The alternative, holding a mutex across lock and serialize, is heavier and still leaves the shared-buffer problem.

**Implementation checklist**
- [ ] In `mobile/lib/crypto/cache_cipher.ts`, change `encryptCacheValue` to take `getKey: () => Uint8Array | null`, draw the nonce first, then call `requireKey(getKey())` immediately before `gcm(...)`.
- [ ] In `mobile/lib/crypto/cache_cipher.ts`, make `setCacheEncryptionKey` store `new Uint8Array(dek)` and make `clearCacheEncryptionKey` zero and drop that copy.
- [ ] In `mobile/lib/query_client.ts`, pass `() => cacheEncryptionKey` to `createCacheCodec` instead of the value.
- [ ] In `mobile/lib/crypto/__tests__/cache_cipher.test.ts`, add a test that zeroes the key while the nonce promise is pending and asserts the write rejects and nothing is stored.
- [ ] In `mobile/contexts/__tests__/lock_context.test.tsx`, add a test that a serialize started before `lockNow` never writes a blob decryptable with an all-zero key.
- [ ] Update the comment block at `cache_cipher.ts` header to state the ordering guarantee.

**Acceptance criteria**
- [ ] A write that started before lock and resumed after lock rejects; AsyncStorage holds either the pre-lock blob or nothing.
- [ ] Decrypting any stored blob with 32 zero bytes fails in the new test.
- [ ] Existing cache_cipher and lock_context suites pass.

**Verification commands**
```bash
cd mobile && npm test -- lib/crypto contexts
cd mobile && npm run typecheck
```

**Do not**
Do not change the Argon2id parameters, the wrap format, or `key_manager.ts` zeroing. Do not add a global mutex around the persister. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit. Existing encrypted cache blobs stay readable because the on-disk format (`nonce || ciphertext`) is unchanged. Encrypted database untouched.

**Open questions**
none (AGENT-ASSISTED because a crypto reviewer should confirm the ordering argument before merge)

### GAP-003 [FEAT] POST_NOTIFICATIONS is never requested, so no alert can display on Android 13+

> **REMEDIATION: DONE** (2026-09-04) - commit 7fc19ce, branch worktree-gap-wave-1. Verification: jest onboarding tree 22 suites 207 tests PASS plus more_hub/more_tab 32; 5 of 7 new tests fail when the OS request is stubbed. ON-DEVICE VERIFICATION STILL REQUIRED on the A54 (7 items listed in the commit)

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.5 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/lib/alerts/alerts_service.ts:126-131` (`requestAlertPermission`, the only requester; no caller outside this file)
- `mobile/lib/alerts/alerts_service.ts:142-144` (`hasPermission`, read-only check every posting path uses)
- `mobile/app/(onboarding)/done.tsx` (the natural place to ask; currently no permission code)
- `docs/04-features/01-onboarding.md:54` (Step 4, the value screen that should precede the dialog)

**Evidence**
`git grep -n "requestAlertPermission"` across `mobile/` returns only the definition and its own doc comment. `alerts_service.ts:136-143`: "Every posting path goes through here rather than `requestAlertPermission`, because posting happens from background recomputes". `expo-notifications` does not request the permission on its own.

**What is wrong**
On Android 13 and later `POST_NOTIFICATIONS` is a runtime permission that defaults to denied until the app asks. Nothing asks. Every notifier (`limit_notifier.ts`, `bill_reminders.ts`, `loan_reminders.ts`, `payday_notifier.ts`, `tracking_notifier.ts`) checks `hasPermission()` and silently returns when it is false.

**Why it matters**
A user with a monthly limit at 80 percent never gets the alert; a Meralco reminder set for three days before never fires; the tracking-interrupted notice never appears. The M2 exit criteria in docs/01 §4 ("fire alerts at 50/80/100 percent", "Bills remind at each configured offset") cannot pass on the test device (Android 16).

**Intended behavior**
docs/04-features/01-onboarding.md:54 Step 4: a value screen, then the system dialog, skippable; docs/07 §3.5: requested in context after its value is explained; denial degrades to in-app alerts only.

**Proposed fix**
Add the request at the end of onboarding: on `done.tsx` mount (or a new `alerts.tsx` step after `first_limit`) show one paragraph of value copy and a button that calls `requestAlertPermission()`; skipping proceeds. Also expose a "Turn on alerts" row in More that calls the same function when `getPermissionsAsync` reports not granted, so users who skipped can recover (GAP-018 builds the fuller checklist). Prefer a dedicated step over a cold dialog on the home screen, per the doc.

**Implementation checklist**
- [ ] Add `"alerts"` to `ONBOARDING_STEPS` in `mobile/lib/onboarding/onboarding_state.ts` between `first_limit` and `done`, and update `mobile/lib/onboarding/__tests__/onboarding_state.test.ts`.
- [ ] Create `mobile/app/(onboarding)/alerts.tsx` with value copy, a primary button calling `requestAlertPermission()` from `@/lib/alerts/alerts_service`, and a "Not now" link that advances.
- [ ] Register the route in `mobile/app/(onboarding)/_layout.tsx`.
- [ ] Add `mobile/app/(onboarding)/__tests__/alerts_step.test.tsx` asserting the button calls the request and both paths advance.
- [ ] Add a "Turn on alerts" row to `mobile/app/(tabs)/more/index.tsx` shown only when the permission is not granted, calling the same function.
- [ ] Update docs/04-features/01-onboarding.md Step 4 wording to name the screen and the More row.

**Acceptance criteria**
- [ ] A fresh onboarding on an Android 13+ emulator or device shows the system permission dialog exactly once, after a value screen.
- [ ] Skipping the step completes onboarding; the More row appears and requests on tap.
- [ ] `git grep -n "requestAlertPermission(" mobile/app` returns at least two call sites.

**Verification commands**
```bash
cd mobile && npm test -- onboarding lib/alerts
cd mobile && npm run typecheck
```

**Do not**
Do not call `requestPermissionsAsync` from a posting path or a subscriber. Do not request during the notification-access or battery steps. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit; no data written. Users who granted keep the grant.

**Open questions**
none

### GAP-004 [CONTRA] Automatic income drift re-snapshots percent-of-income limit bases mid-period

> **REMEDIATION: DONE** (2026-09-04) - commit 62ef72a, branch worktree-gap-wave-1. Verification: jest lib/income 6 suites 92 tests PASS; regression pins the defect (600000 vs expected 800000 when restored). NOTE: the entry's worked example does not reproduce; test uses a corrected fixture

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
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/lib/income/income_service.ts:231-240` (`applyDetectionToProfile` calls `recomputePercentLimits`)
- `mobile/lib/income/income_service.ts:249-253`, `:285-287` (automatic path)
- `mobile/lib/limits/limit_service.ts:335-338`, `:350-364` (`refreshLimitBase` contract and the overwrite)
- `mobile/lib/income/income_ledger_subscriber.ts:64`, `mobile/lib/bootstrap.ts:78` (triggers: every debounced ledger commit and every launch)
- `docs/04-features/03-limits.md:85`

**Evidence**
`limit_service.ts:337-338`: "Automatic income drift must NOT come through here; rule 11 applies it only from the next period start, so alerts never flap mid-period." `income_service.ts:239`: `await recomputePercentLimits(now, monthlyEquivalent(detection.cadence, detection.averageAmount));` reached at `:285-287` when `status === "confirmed" && profile?.isManualOverride !== true`.

**What is wrong**
Whenever detection stays confirmed with no manual override, a ledger commit rewrites the profile and immediately rewrites `state.base` for the current period. Irregular example: credits of ₱20,000 on Jun 6, Jul 6, Aug 6 and ₱5,000 on Aug 20; on Sep 3 the trailing 90 days give M = ₱21,667 and a 30 percent monthly limit has base ₱6,500; a ₱120 fare on Sep 4 at 10:01 pushes Jun 6 out of the window, M becomes ₱15,000 and the base is rewritten to ₱4,500 while the user has already spent ₱5,000. Kinsenas: a smaller late payday inside the tolerance window moves the median and the base the same afternoon.

**Why it matters**
Safe-to-Spend and the Plan tab drop (or rise) mid-period with no new spending and no explanation; a limit the user was inside becomes "over". This is the shrink the project memory flagged as unobserved.

**Intended behavior**
Automatic drift applies from the next period start (docs/04-features/03-limits.md:85). Manual edits and explicit confirmations re-snapshot immediately (`income_service.test.ts:270` pins that).

**Proposed fix**
Remove the `recomputePercentLimits` call from `applyDetectionToProfile` and keep it in `setManualIncome`, `clearManualIncome` and `confirmDetectedIncome`. `resolveState` already receives a fresh `baseFor(limit, monthlyIncome)` on every pass and only adopts it when the period changes, so nothing else is needed.

**Implementation checklist**
- [ ] In `mobile/lib/income/income_service.ts`, delete the `recomputePercentLimits` call inside `applyDetectionToProfile` (line 239) and leave the profile save.
- [ ] Confirm the three user-action paths in the same file still call `recomputePercentLimits`.
- [ ] In `mobile/lib/income/__tests__/income_service.test.ts`, add "a confirmed re-detection mid-period leaves the current limit base untouched" using the Sep 3 to Sep 4 example above.
- [ ] Add a second test that the new M is used once the next period starts.
- [ ] Update the comment on `applyDetectionToProfile` to cite limits rule 11.

**Acceptance criteria**
- [ ] With the fixture above, `getLimitAlertState` after the Sep 4 commit still reports base ₱6,500; after a commit dated Oct 1 it reports the base computed from the new M.
- [ ] `income_service.test.ts:270` (manual set re-snapshots immediately) still passes.

**Verification commands**
```bash
cd mobile && npm test -- lib/income lib/limits
cd mobile && npm run typecheck
```

**Do not**
Do not change how `monthlyEquivalent` or the 90-day window is computed (GAP-047). Do not touch `limit_service.ts`. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit. Alert-state rows already rewritten keep their last base until the next period boundary.

**Open questions**
none

### GAP-005 [CODE] Safe-to-Spend goal-contribution term has no Plus gate

> **REMEDIATION: DONE** (2026-09-04) - commit 9a605da, branch worktree-gap-wave-1. Verification: jest safe_to_spend_service 22 passed (was 21); new test proven to fail without the fix

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/lib/safe_to_spend_service.ts:183-229` (`forecastContributions`, no tier check)
- `mobile/lib/goals/goals_service.ts:111` (`if (!hasPaydayAutoAllocation()) return [];`, the gate the proposal path uses)
- `docs/04-features/09-safe-to-spend.md:141`

**Evidence**
`goals_service.ts:111` gates proposals; `forecastContributions` reads `listGoals` filtered on `contributionRule !== null` and reserves for every pay event with no call to `hasPaydayAutoAllocation()`. `git grep -n hasPaydayAutoAllocation mobile/lib` returns only `entitlements.ts` and `goals_service.ts:111`.

**What is wrong**
Payday auto-allocation is a Plus capability. When the tier flips to free, prompts stop (correct) but Safe-to-Spend keeps subtracting planned contributions the user will never be prompted to make.

**Why it matters**
docs/01 §4 M3 exit criterion: flipping a test build to free must produce correct gate behaviour. Today a Free user with a ₱2,500 contribution rule and one ₱20,000 payday sees Safe-to-Spend ₱2,500 lower than the spec says, every period.

**Intended behavior**
docs/04-features/09-safe-to-spend.md:141: "The Goal-contributions term is effectively ₱0 for free users (payday auto-allocate is Plus)".

**Proposed fix**
Return an empty array from `forecastContributions` when `hasPaydayAutoAllocation()` is false, reading the gate through `lib/entitlements.ts` (never a tier literal).

**Implementation checklist**
- [ ] In `mobile/lib/safe_to_spend_service.ts`, import `hasPaydayAutoAllocation` from `@/lib/entitlements` and return `[]` at the top of `forecastContributions` when it is false.
- [ ] In `mobile/lib/__tests__/safe_to_spend_service.test.ts`, add a test using `__setTierForTests("free")` asserting `plannedContributions` is empty and the headline number ignores the rule.
- [ ] Restore the tier to `null` in the test's `afterEach`.

**Acceptance criteria**
- [ ] With tier free and a goal carrying a contribution rule plus one pay event in window, `buildSafeToSpendInput` returns `plannedContributions: []`.
- [ ] With tier plus the existing tests are unchanged.

**Verification commands**
```bash
cd mobile && npm test -- safe_to_spend
cd mobile && npm run typecheck
```

**Do not**
Do not add the gate inside `computeSafeToSpend`. Do not change `contributionAmount`. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit; no stored data involved.

**Open questions**
none

### GAP-006 [CODE] Percent-of-income limit base is computed in float then floored, dropping one peso on some pairs

> **REMEDIATION: DONE** (2026-09-04) - commit 97640d9, branch worktree-gap-wave-1. Verification: jest lib/limits 11 suites 151 tests PASS; pinned pairs plus a BigInt oracle over 6400 assertions, both proven to fail on the float path

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/lib/limits/limit_engine.ts:140-141` (`floorToPeso`) and `:172-184` (`baseFor`)
- `mobile/lib/limits/limit_service.ts:190` (persists the result as `limit_alert_state.base`)
- `mobile/components/limits/limit_preview.tsx:54` (display)
- `mobile/lib/limits/__tests__/limit_engine_basis.test.ts` (uses ₱37,000 at 20 and 12.5 percent; misses the failing class)

**Evidence**
```
const fraction = args.value / 10_000;
...
case "monthly": return floorToPeso(monthlyIncome * fraction);
```
Reproduced in Node: M = 100000 centavos (₱1,000), value = 2900 (29 percent): `0.29 * 100000 = 28999.999999999996`, `/100 = 289.99999999999994`, floor gives ₱289 where the exact answer is ₱290. ₱15,000 at 14.5 percent gives ₱2,174 instead of ₱2,175. Across incomes ₱1,000 to ₱100,000 in ₱1,000 steps and every half-percent, 7 of 160,400 monthly pairs and 20 of 160,400 annual pairs are wrong.

**What is wrong**
`value / 10_000` is an inexact binary fraction; multiplying and then flooring turns an exact peso boundary into one peso less.

**Why it matters**
The floored base becomes the effective limit, so Safe-to-Spend headroom is ₱1 low and the 100 percent alert fires ₱1 early, always in the conservative direction and only on the pairs above. The rubric says a wrong Safe-to-Spend is S2 at minimum; this is scored S3 deliberately because the error is one peso, safe-side, on 0.004 percent of inputs.

**Intended behavior**
Exact integer arithmetic: base = floor(monthlyIncome x value / 1,000,000) x 100 centavos for monthly, with the 12, 52 and 365 factors applied before the single division.

**Proposed fix**
Multiply in integers and divide once inside `Math.floor`: monthly `Math.floor((monthlyIncome * value) / 1_000_000) * 100`, annual with `12 *`, weekly `Math.floor((12 * monthlyIncome * value) / (52 * 1_000_000)) * 100`, daily with 365. Products stay below 2^53 for any realistic income. Keep `floorToPeso` for callers that already hold an integer.

**Implementation checklist**
- [ ] In `mobile/lib/limits/limit_engine.ts`, rewrite the four `baseFor` branches as integer expressions with one division each.
- [ ] In `mobile/lib/limits/__tests__/limit_engine_basis.test.ts`, add the ₱1,000 at 29 percent and ₱15,000 at 14.5 percent cases expecting ₱290 and ₱2,175.
- [ ] Add a property-style loop over a few hundred pairs comparing against BigInt arithmetic.

**Acceptance criteria**
- [ ] The two new cases pass and existing basis tests pass unchanged.
- [ ] No `/ 10_000` remains in `baseFor`.

**Verification commands**
```bash
cd mobile && npm test -- lib/limits
cd mobile && npm run typecheck
```

**Do not**
Do not change `limit_derivation.ts` daily-rate math (it rounds, and round-trips exactly). Do not touch alert thresholds. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit. Persisted bases recompute at the next period boundary.

**Open questions**
none

### GAP-007 [DOC] docs/DEPLOYMENT.md still says master has no server directory

> **REMEDIATION: DONE** (2026-09-05) - commit 669d00c, branch gap-wave-6. Verification: docs only, no suite. Acceptance grep returns 0. Every claim the rewrite adds was re-verified: f985c7f is the 2026-08-28 merge, server/ is on master, no staging branch exists. `cd server && npm run lint` NOT RUN - server/node_modules does not exist in a worktree and installing is barred

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1 |

**Location**
- `docs/DEPLOYMENT.md:28-30`, `:146-147` (primary)
- `docs/DEPLOYMENT.md:109-118` (production Environment variables are the literal `TBA`)

**Evidence**
Line 28: "**This currently blocks every production dispatch**: `master` is 400+ commits behind `feat/mvp-implementation` and doesn't have `server/` at all yet." `git ls-files server | head` on master lists `server/apps/web/...`; `feat/mvp-implementation` is in `git branch --merged master`.

**What is wrong**
The MVP branch merged into master on 2026-08-28. The runbook's "What's still missing" list and the branch-guard paragraph describe a state that ended a week ago, and an operator following it will believe production deploys are impossible.

**Why it matters**
The one runbook for the only deploy pipeline is wrong about whether the pipeline can run. The `TBA` placeholder note (lines 109-118) is still true and must stay.

**Intended behavior**
The runbook states that master carries `server/` and that production dispatch is gated only by the `TBA` compliance values and the unregistered runner.

**Proposed fix**
Delete the two stale paragraphs and rewrite "What's still missing" to the current three items: TBA compliance values, no staging branch or env file, runner registration state (verify on the box). Add the date of the master merge.

**Implementation checklist**
- [ ] In `docs/DEPLOYMENT.md`, remove lines 28-30 and the matching bullet at 146-147.
- [ ] In `docs/DEPLOYMENT.md`, add one sentence under "How deploys are routed" stating master has carried `server/` since the 2026-08-28 merge.
- [ ] Re-read the remaining "What's still missing" bullets and keep only those still true.

**Acceptance criteria**
- [ ] `grep -n "doesn't have" docs/DEPLOYMENT.md` returns nothing.
- [ ] The document still names the `TBA` placeholder issue and the missing `staging` branch.

**Verification commands**
```bash
cd server && npm run lint
```

**Do not**
Do not change `deploy.yml` or the compose files. Do not remove the `TBA` warning. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit.

**Open questions**
none

### GAP-008 [CODE] Fortnightly recurring patterns are forgotten before their next charge is due

> **REMEDIATION: DONE** (2026-09-05) - commit 46412d1, branch gap-wave-6. Verification: jest lib/recurring 3 suites 53 tests PASS; reverting the source fails exactly "a fortnightly acknowledged pattern silent for 11 days is KEPT". The second new test passes with the fix removed too and is an over-correction guard, NOT a witness - do not credit it. Found an adjacent defect, see the monthlyLockedIn note in section 0

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C2 Strong |
| Priority score | 1.6 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/lib/recurring/recurring_service.ts:58-62` (`PERIOD_NOMINAL_DAYS`) and `:214-218` (decay threshold)
- `mobile/lib/db/repos/recurring_patterns_repo.ts:68-76` (weekly/monthly boundary at about 14.6 days)
- `mobile/lib/recurring/__tests__/recurring_service.test.ts:473-618` (no fortnightly case)

**Evidence**
```
const thresholdDays = multiplier * PERIOD_NOMINAL_DAYS[pattern.period];
const silentDays = (now - pattern.lastSeenAt) / DAY_MS;
if (silentDays > thresholdDays) { await deletePattern(pattern.id); }
```
with `weekly: 7` and a bucket boundary of `Math.sqrt(7 * 30.44)`.

**What is wrong**
A charge every 14 days lands in the weekly bucket, so its forget threshold is 1.5 x 7 = 10.5 days, shorter than its own cadence. Charges on Aug 1, 15, 29 detect and the user acknowledges; on Sep 9 (11 days silent) any ledger commit deletes the row; the Sep 12 charge re-detects it as a fresh, unacknowledged suggestion.

**Why it matters**
An acknowledged bi-weekly subscription flickers out of the "locked in" total every cycle and keeps re-appearing as a suggestion, losing the acknowledgement each time. C2 because the exact `periodDays` a detector assigns to real fortnightly data was not executed.

**Intended behavior**
The decay rule is "1.5 missed payments scaled to cadence" (recurring_service.ts:168-170 comment; project memory). The threshold must never be below the pattern's own cadence.

**Proposed fix**
Scale by the larger of the stored `periodDays` and the bucket nominal: `multiplier * Math.max(pattern.periodDays ?? 0, PERIOD_NOMINAL_DAYS[pattern.period])`.

**Implementation checklist**
- [ ] In `mobile/lib/recurring/recurring_service.ts`, change the threshold expression in `decayStalePatterns` as above.
- [ ] In `mobile/lib/recurring/__tests__/recurring_service.test.ts`, add "a 14-day acknowledged pattern silent for 11 days is kept" and "silent for 22 days is deleted".

**Acceptance criteria**
- [ ] Both new tests pass; existing weekly, monthly and annual decay tests pass unchanged.

**Verification commands**
```bash
cd mobile && npm test -- lib/recurring
cd mobile && npm run typecheck
```

**Do not**
Do not change the bucket boundary in the repo or the default multiplier. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit. Already-deleted patterns re-detect on the next charge.

**Open questions**
none

### GAP-009 [CODE] Loan interest rate field has no unit label and is silently monthly

> **REMEDIATION: DONE** (2026-09-05) - commit 438ebff, branch gap-wave-6. Verification: jest components/loans + lib/loans 8 suites 128 tests PASS; the new test fails with the source reverted. THE ENTRY BELOW WAS FACTUALLY WRONG and was not implemented as written - see its corrected What is wrong, and the Cross-cutting findings in section 0

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C2 Strong |
| Priority score | 1.6 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/components/loans/loan_form.tsx:214`, `:234-238` (single `rateText` field feeding `monthlyPayment`)
- `mobile/types/domain.ts:349-350` (comment says "informational only")
- `mobile/lib/loans/loan_math.ts:13-16`
- `docs/04-features/06-loans.md:90`

**Evidence**
`domain.ts:349`: `/** Percent 0..100, informational only (domain §3.8). */ interestRate: number | null;` while `loan_form.tsx:236-237` calls `monthlyPayment(principal, rate, term)`; a grep for "annum" or "per year" in the form finds only a comment at line 234 ("cost per month"). Doc rule 3: the rate is "entered with an explicit per-month or per-annum unit".

**What is wrong**
> **CORRECTED 2026-09-05 while fixing this entry. The paragraph below was WRONG on both
> counts and is kept only so nobody re-derives it.** ~~The field is unlabeled and treated as
> a monthly rate. A user typing an annual rate (the way a bank quotes it) gets an amortized
> installment about twelve times too high. C2 because the rendered label text was not read in
> full.~~
>
> What is actually true, verified in the code: the rate is ANNUAL, explicitly and correctly.
> `mobile/lib/loans/loan_math.ts:52,57` takes a parameter literally named
> `annualRatePercent` and computes `monthlyRate = annualRatePercent / 100 / 12`, and the
> pre-existing test pins PHP 50,000 at 12 over 12 months to PHP 4,442.44 a month, which is
> the per-annum figure (a monthly reading gives about PHP 8,072). The field was not unlabeled
> either: it already carried `label="Annual rate"` and `placeholder="Annual rate %, e.g. 12"`.
> The C2 flag was right to distrust the claim, but the entry's grep looked for "annum" and
> "per year" and missed the word "Annual".
>
> **Implementing this entry as written would have caused the bug it describes** - labelling an
> annual rate "per month" while `loan_math.ts` kept dividing by 12.
>
> The real defect is narrower and is what `438ebff` fixed. `NumericField` renders `label`
> only into `accessibilityLabel` and the keypad panel header, never as visible text
> (`mobile/components/ui/numeric_field.tsx:178,216,220`), and the visible string is the
> placeholder ONLY while the field is empty. So the unit was on screen right up until the
> user typed a digit, after which a sighted user read "12%" under a section headed "Rate and
> term" with nothing saying per what. PH lenders quote per month, so the failure mode is
> real, just reached a different way.

**Why it matters**
A GLoan or credit-card loan entered as "24" meaning per month produces a schedule twelvefold
too heavy and a wrong outstanding balance on the Plan tab. The direction of the error is the
opposite of what this entry originally claimed: the risk is a user entering a MONTHLY figure
into a field that means ANNUAL.

**Intended behavior**
docs/04-features/06-loans.md:90: an explicit unit. The code's choice of per-annum is
legitimate under that rule, which allows either; what it owes is that the unit stays visible.

**Proposed fix**
Label the field "Monthly interest rate (%)" and add helper text "Banks usually quote per year; divide by 12." Fix the type comment. A per-annum toggle is the fuller fix and is a product call; ship the label now.

**Implementation checklist**
- [ ] In `mobile/components/loans/loan_form.tsx`, set the rate field label and helper text as above.
- [ ] In `mobile/types/domain.ts`, replace the "informational only" comment with "monthly percent, drives amortized schedules".
- [ ] In `mobile/components/loans/__tests__/loan_form.test.tsx`, assert the label text renders.

**Acceptance criteria**
- [ ] The loan form shows "per month" on the rate field.
- [ ] Existing loan form and loan math tests pass.

**Verification commands**
```bash
cd mobile && npm test -- components/loans lib/loans
cd mobile && npm run typecheck
```

**Do not**
Do not change `loan_math.ts`. Do not add a unit column to the schema. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit.

**Open questions**
none for the label. Whether per-annum entry is required is an owner call and would be a follow-up gap.

### GAP-010 [FEAT] Cash reconciliation prompts are never scheduled

> **REMEDIATION: DONE** (2026-09-05) - commit eee8028, branch gap-wave-4. Verification: jest lib/wallets + lib/db/repos + components/wallets 30 suites 697 tests PASS; each guard reverted individually fails only its own test. Weekly cadence taken from docs/02-wallets.md:70. Snooze, Home card and due chip deliberately not built

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.25 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 6-10 |

**Location**
- `mobile/lib/db/repos/app_settings_repo.ts:48`, `:247` (`cash_reconcile_prompt_at` declared, defaulted to null, no other reader or writer in `mobile/lib`, `mobile/app`, `mobile/components`)
- `mobile/components/wallets/wallet_card.tsx:170` ("Manual · reconcile weekly", display copy only)
- `mobile/lib/wallets/reconcile.ts:79` (the manual reconcile math, which works)
- `mobile/app/wallet/[id].tsx:463` and `mobile/components/wallets/cash_reconcile_sheet.tsx` (manual action)
- `docs/04-features/02-wallets.md:70-71`, `:115`, `:172`; `docs/01-mvp-scope.md` L1-9

**Evidence**
`git grep -n cash_reconcile_prompt_at mobile/lib mobile/app mobile/components mobile/hooks` returns only the two settings-repo lines. `alerts_service.ts` has no reconcile branch. Doc line 70: "Triggers for a reconciliation prompt on a cash Wallet: (a) a recurring schedule, default weekly, adjustable per Wallet; (b) right after an ATM/cash-out Transfer Link; (c) after 14 days with no cash activity at all."

**What is wrong**
The reconcile sheet exists and its delta math matches rules 3 and 14, but nothing ever asks. The setting that was meant to hold the next prompt time is dead. The card says "reconcile weekly" and nothing enforces it.

**Why it matters**
docs/01 L1-9 lists cash reconciliation prompts as MVP scope and the M1 exit criterion says "cash reconciliation prompts adjust balances". Cash wallets drift silently; the "Attention, reconciliation due" state in the doc can never occur.

**Intended behavior**
A prompt (Home card or app notification, per docs/04-features/02-wallets.md:70-71) fires weekly per cash wallet by default, after a cash-out transfer link, and after 14 idle days; snooze and "don't ask for this wallet" exist.

**Proposed fix**
Add a scheduler module under `lib/wallets/` that, on launch and on `ledger:committed`, computes the next due prompt per cash wallet from the last reconcile time, cash-out links and idle days, stores it in `cash_reconcile_prompt_at` (or a per-wallet column if snooze is per wallet), and posts through `alerts_service.postAlert` plus a Home card. Reuse the existing `startSubscriber` pattern in `app/_layout.tsx`.

**Implementation checklist**
- [ ] Create `mobile/lib/wallets/reconcile_scheduler.ts` exporting `computeNextReconcilePrompt(wallets, links, lastReconcileAt, now)` (pure) and `startReconcilePromptSubscriber()`.
- [ ] In `mobile/lib/db/repos/wallets_repo.ts`, add a read of the last cash reconciliation transaction time per wallet (query on `source = 'manual'` and note "Cash reconciliation", the marker `reconcile.ts:47` already writes).
- [ ] In `mobile/lib/db/repos/app_settings_repo.ts`, keep `cash_reconcile_prompt_at` as the global next-due and add `cash_reconcile_snoozed_wallets: string[]` with default `[]`.
- [ ] In `mobile/app/_layout.tsx`, start the subscriber next to the tracking-health subscriber.
- [ ] In `mobile/components/wallets/wallet_card.tsx`, render the "reconciliation due" chip from the computed state instead of static copy.
- [ ] Add the prompt to the Home screen via `mobile/components/home/` following the existing drift card pattern.
- [ ] Write `mobile/lib/wallets/__tests__/reconcile_scheduler.test.ts` covering weekly, after-cash-out, 14 idle days, snooze and opt-out with a fixed clock.
- [ ] Update docs/04-features/02-wallets.md open question at line 185 to record the chosen default (weekly).

**Acceptance criteria**
- [ ] With a cash wallet last reconciled 8 days ago and a fixed clock, `computeNextReconcilePrompt` returns due; at 6 days it returns not due.
- [ ] A cash-out transfer link makes the wallet due immediately.
- [ ] Snoozing suppresses the prompt for the wallet until the next trigger.
- [ ] The Home card appears in the screen test when a wallet is due.

**Verification commands**
```bash
cd mobile && npm test -- lib/wallets components/wallets components/home
cd mobile && npm run typecheck
```

**Do not**
Do not change the delta math in `reconcile.ts`. Do not prompt for non-cash wallets. Do not add a schema migration for the snooze list (settings JSON is enough). Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit; the new settings keys are ignored by older code.

**Open questions**
none (the doc's open question on cadence keys off income; the default weekly is documented and used here)

### GAP-011 [CODE] A stored raw capture whose stages throw is never reprocessed and is rejected as a replay forever

> **REMEDIATION: DONE** (2026-09-04) - commit b732372 + 9eede70, branch worktree-gap-wave-1. Verification: jest lib/ingest + lib/review + raw_notifications_repo 15 suites 466 tests PASS. Follow-up 9eede70 fixes a merged-away-duplicate resurrection the sweep introduced (was reproduced first)

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.25 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | GAP-012, GAP-040, GAP-048 (same file, sequential) |
| Est. agent turns | 5-8 |

**Location**
- `mobile/lib/ingest/pipeline.ts:280-282` (id replay guard), `:294` (raw store before stages), `:902-905` and `:911-914` (empty catches)
- `mobile/lib/db/repos/raw_notifications_repo.ts:210-217` (no unprocessed query)
- `mobile/lib/ingest/__tests__/pipeline.test.ts:1101` ("a stage throwing leaves the capture readable and reprocessable", asserts survival only)

**Evidence**
```
pipeline.ts:280  if (await hasRawCapture(capture.id)) { return { kind: "ignored", reason: "duplicate" }; }
pipeline.ts:294  await storeRawCapture(capture, now);
pipeline.ts:902  } catch {
pipeline.ts:903    // One malformed capture must not take the rest of the batch with it. The
pipeline.ts:904    // raw row is already durable, so this one can be reprocessed later.
```
No function in `raw_notifications_repo.ts`, `bootstrap.ts` or `pipeline.ts` selects raw rows lacking a transaction or queue item.

**What is wrong**
The raw row is written before the stages run. If the process dies, or any stage throws (SQLite busy, a malformed payload, a throw inside normalize or categorize), the swallow ends processing and every later delivery of the same id is rejected as a replay. "Can be reprocessed later" describes a path that does not exist.

**Why it matters**
A transaction silently never appears (no card, no row, no error) while its raw text sits in the Privacy Centre. The balance is short with nothing to search for. This is exactly the silent-loss class docs/03 principle 2 forbids.

**Intended behavior**
Every stored raw capture ends as a transaction, a queue card, or a recorded discard. A failure is retried on the next drain and is visible in parser diagnostics.

**Proposed fix**
Add `listUnprocessedRawCaptures(since)` to the raw repo (raw rows with no `transactions.raw_notification_id` and no `review_queue_items.raw_notification_id`, limited to the 30-day window) and have `startIngest` run `processStored` over them before the drained batch. Replace the two empty catches with `console.error` carrying the capture id only. A `processed_at` column is cleaner but needs a migration; the join query is enough for MVP.

**Implementation checklist**
- [ ] In `mobile/lib/db/repos/raw_notifications_repo.ts`, add `listUnprocessedRawCaptures(now, limit)` using a `NOT EXISTS` on both referencing tables.
- [ ] In `mobile/lib/ingest/pipeline.ts`, call it at the start of `startIngest` and feed the rows through `processStored` before the native drain.
- [ ] In `mobile/lib/ingest/pipeline.ts`, replace the empty catches at 902 and 911 with `console.error("[ingest] capture <id> failed at stage; will retry")`.
- [ ] Guard against a permanent poison pill: after three failed attempts (count via a module-level map keyed by id for the session), queue it as `unknown-provider` so the user sees it.
- [ ] Add tests in `mobile/lib/ingest/__tests__/pipeline.test.ts`: stage throws once, next `startIngest` commits the row; stage throws every time, a queue card appears after the third attempt.
- [ ] Add a repo test for `listUnprocessedRawCaptures` in `mobile/lib/db/repos/__tests__/raw_notifications_repo.test.ts`.

**Acceptance criteria**
- [ ] A capture whose first processing throws is committed on the next `startIngest` without redelivery from native.
- [ ] Parser diagnostics count the failure (existing `parse_stats` path) rather than nothing.
- [ ] `pipeline.test.ts:1101` still passes.

**Verification commands**
```bash
cd mobile && npm test -- lib/ingest lib/db/repos
cd mobile && npm run typecheck
```

**Do not**
Do not change the dedupe or transfer stages. Do not delete the raw row on failure. Do not add a migration in this gap. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit. Existing unprocessed rows simply stay unprocessed as before.

**Open questions**
none

### GAP-012 [CODE] Push and SMS twin with the first leg still queued produces two cards and two commits

> **REMEDIATION: DONE** (2026-09-04) - commit 8025365 + 718aff5, branch gap-wave-2. Verification: jest lib/ingest+review+db 38 suites 1221 tests PASS (baseline 1202, delta is exactly the 19 added); 8 tests fail with the mechanisms neutered

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.25 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-011 (same file; run after) |
| Blocks | none |
| Est. agent turns | 6-10 |

**Location**
- `mobile/lib/ingest/pipeline.ts:367-368` (only committed rows joined), `:431-437` (queue payload has no reference number or timestamp)
- `mobile/lib/review/resolve_actions.ts:184-211` (`proposalFrom` carries no `referenceNo`), `:324-338` (`correctItem` inserts with no dedupe check)
- `mobile/lib/db/repos/review_queue_repo.ts` (no open-twin lookup)
- `mobile/lib/ingest/__tests__/pipeline.test.ts:729` ("a push and SMS twin commits once", committed-first only)

**Evidence**
```
pipeline.ts:368   const recentRows = await listTransactions({ from: since });
pipeline.ts:431   return queue(reviewKindFor(verdicts), capture.id, { amount, direction, merchant, walletId, categoryId, confidence,
resolve_actions.ts:334  const committed = await insertTransaction(proposal);
```

**What is wrong**
A push that hard-routes (unmapped wallet, low score) sits in the queue. Its SMS relay arrives seconds later, sees no committed twin, and is queued too. The user sees two identical cards; "Looks right" on each inserts a row. The second confirm never runs `checkDuplicate`, and because the confirmed row carries no reference number a later strong-key match cannot fire either.

**Why it matters**
One purchase recorded twice from the queue. This is the "one notification becomes several" class of the 2026-09-01 incident, reached through the queue instead of redelivery. The class is not closed.

**Intended behavior**
docs/03 §6 rule 2: twin window dedupe applies across channels; docs/02 §4.2: queue items are excluded from totals but must not be confirmable twice for one movement.

**Proposed fix**
In `runVerdicts`, also fold open review items for the same provider, amount and direction inside the twin window into the dedupe candidate set, so the second capture resolves to the existing card (or is attached to it) instead of raising a new one. Carry `referenceNo`, `balanceAfter` and `occurredAt` in the queue payload and through `proposalFrom`. Run `checkDuplicate` against committed rows inside `correctItem` before `insertTransaction` and route a hit to the existing merge action.

**Implementation checklist**
- [ ] In `mobile/types/domain.ts`, add optional `referenceNo`, `balanceAfter`, `occurredAt` and `channel` to `ReviewItemPayload`.
- [ ] In `mobile/lib/ingest/pipeline.ts`, populate those fields in the `queue(...)` call at 431.
- [ ] In `mobile/lib/db/repos/review_queue_repo.ts`, add `findOpenTwin(providerKey, amount, direction, occurredAt, windowMs)`.
- [ ] In `mobile/lib/ingest/pipeline.ts` `runVerdicts`, call `findOpenTwin` after the committed-row check; on a hit return `{ kind: "ignored", reason: "queued-twin" }` and record the twin's raw id on the open card.
- [ ] In `mobile/lib/review/resolve_actions.ts` `proposalFrom`, pass `referenceNo` and `balanceAfter` through to the proposal.
- [ ] In `mobile/lib/review/resolve_actions.ts` `correctItem` and `confirmItem`, run the dedupe check against committed rows before insert; on a strong-key hit resolve the card as a duplicate instead of inserting.
- [ ] Add tests: queued-first push then SMS raises one card; confirming it commits once; a later SMS after confirm is suppressed by the strong key.
- [ ] Update `docs/04-features/08-review-queue.md` rule on duplicates to describe queued twins.

**Acceptance criteria**
- [ ] Fixture: push (unmapped wallet) at T, SMS twin at T+30s. Exactly one open card; confirming yields exactly one transaction.
- [ ] Fixture: card confirmed at T, SMS twin at T+2h with the same reference number. Zero new rows, zero new cards.
- [ ] `pipeline.test.ts:708` (genuine identical purchases still reach the DedupeGate) still passes.

**Verification commands**
```bash
cd mobile && npm test -- lib/ingest lib/review lib/db/repos
cd mobile && npm run typecheck
```

**Do not**
Do not suppress on text equality (the project decided against it on 2026-09-01). Do not change the 180 s or 48 h tunables. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit. Payload fields are additive JSON; older readers ignore them.

**Open questions**
none

### GAP-013 [CODE] Mutation failures are silent on about thirty screens

> **REMEDIATION: DONE** (2026-09-04) - commit 1baa4e6, branch gap-wave-3. Verification: jest query_client + components/ui + hooks + contexts 33 suites 430 tests PASS; one MutationCache onError covers all 49 hooks. Plan-screen mutateAsync try/catch still open

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.25 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-002 (same file `query_client.ts`; run after) |
| Blocks | GAP-049 |
| Est. agent turns | 6-10 |

**Location**
- `mobile/hooks/mutations/*.ts` (49 hooks; none declares `onError`)
- `mobile/app/(tabs)/more/settings.tsx:187`, `:236`, `:256`, `:272`, `:341` (fire-and-forget `.mutate(`)
- `mobile/app/(tabs)/more/subscriptions.tsx:160-162`
- `mobile/app/(tabs)/plan/limits/[id]/edit.tsx:73`, `mobile/app/(tabs)/plan/goals/new.tsx:68` (`await x.mutateAsync(...)` with no try/catch)
- `mobile/app/review/index.tsx:511-547` (the one screen that surfaces errors, added by PR #33)
- `mobile/lib/query_client.ts:39-54` (client construction)

**Evidence**
`git grep -l ".mutate(\|.mutateAsync(" mobile/app mobile/components` lists 39 non-test files; only 8 of them read `.isError` or `.error`. Sampled screens show either `x.mutate({...})` with nothing attached (settings, subscriptions) or `await x.mutateAsync(values)` inside an async handler with no catch (limit edit, goal new), which surfaces as an unhandled promise rejection.

**What is wrong**
A failed write (SQLite busy, constraint violation, unit-of-work rollback) leaves the UI exactly as it was: the toggle appears flipped, the form appears saved, the pattern appears acknowledged. PR #33 fixed this for the review screen only; the rest of the app has the same defect.

**Why it matters**
The 2026-09-01 device report ("the card never dismissed") was this class. A user who toggles telemetry off and sees it stay off, while the write failed, has been misled about a privacy setting.

**Intended behavior**
Every failed mutation is visible: a transient banner or toast naming the action, and the screen state matches the store.

**Proposed fix**
Install a global `MutationCache` `onError` in `query_client.ts` that publishes to a small toast store (Zustand or the existing app-events bus), and mount one `MutationErrorToast` component in `app/_layout.tsx`. Screens that already handle errors keep their inline banner; the global handler covers the rest without touching 30 files. Add an ESLint rule later (GAP-046) to require `mutateAsync` calls to be awaited inside try/catch.

**Implementation checklist**
- [ ] In `mobile/lib/query_client.ts`, construct the `QueryClient` with `mutationCache: new MutationCache({ onError: (error, _v, _c, mutation) => publishMutationError(mutation.options.mutationKey, error) })`.
- [ ] Add `mutationKey` to every hook under `mobile/hooks/mutations/` (mechanical; the key doubles as the toast label).
- [ ] Create `mobile/components/ui/mutation_error_toast.tsx` reading the store and rendering a dismissible banner with the action name.
- [ ] Mount it in `mobile/app/_layout.tsx` inside the providers, above the navigator.
- [ ] Wrap the `await x.mutateAsync(...)` calls in `plan/*/new.tsx` and `plan/*/[id]/edit.tsx` in try/catch that returns early (so the form does not navigate away on failure).
- [ ] Add `mobile/lib/__tests__/query_client.test.ts` asserting a rejected mutation publishes an error with its key.
- [ ] Add a screen test for one plan form asserting it stays mounted when the mutation rejects.

**Acceptance criteria**
- [ ] Forcing `setSetting` to reject in a settings screen test shows the toast and the toggle reflects the stored value.
- [ ] A rejected `createGoal` leaves the form on screen.
- [ ] The review screen's own banner is unchanged.

**Verification commands**
```bash
cd mobile && npm test -- lib/__tests__/query_client app/__tests__ components/ui
cd mobile && npm run typecheck
```

**Do not**
Do not add `onError` to all 49 hooks by hand; the cache-level handler is the fix. Do not swallow errors in the handler. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit; no stored data.

**Open questions**
none

### GAP-014 [SEC] Remote parser ruleset is accepted without schema, size, tunable-range or regex bounds

> **REMEDIATION: DONE** (2026-09-05) - commit 66d549a, branch gap-wave-4. Verification: jest services + lib/ingest 18 suites 472 tests PASS; HEAD's validator accepted all 6 attack payloads and the accepted regex never terminated. ReDoS reduced not solved; authenticity still GAP-043

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R3 |
| Confidence | C1 Verified |
| Priority score | 1.25 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | GAP-043 (signing lands on top of this validation) |
| Est. agent turns | 6-10 |

**Location**
- `mobile/services/parser_rules.ts:58-83` (`isValidBundle`), `:109-115`, `:153` (`upsertRuleset(data)`)
- `mobile/lib/ingest/parser.ts:143` (`new RegExp(template.match)` per template, no cap)
- `mobile/lib/db/repos/parser_rulesets_repo.ts:162-170` (stores payload verbatim)
- `mobile/lib/ingest/ruleset_types.ts:27-65`, `:176-234` (the shape and tunables)
- `mobile/lib/ingest/confidence_gate.ts:164-172` (NaN tunable falls to needs-details)

**Evidence**
`isValidBundle` checks `typeof version === "number" && version > currentVersion`, `Array.isArray(providers) && providers.length > 0`, and for each template `typeof match === "string"` plus `new RegExp(match)` in a try. Nothing checks `tunables`, `packageNames`, `senderIds`, `channel`, or `traitSignals`. `git grep -n "from \"zod\"" mobile/lib mobile/services mobile/types mobile/hooks mobile/app` returns nothing.

**What is wrong**
Whoever answers `/v1/parser_rules` (the host does not exist yet; see `services/api.ts:4-8`) can ship `autoCommitThreshold: 0` so everything auto-commits, a non-numeric penalty that turns into NaN, a catastrophic-backtracking regex evaluated on every notification, or a multi-megabyte payload stored verbatim in SQLite. House style requires a schema at this boundary.

**Why it matters**
Remote-triggered wrong auto-commits or a frozen app on every notification, with no way to tell a bad bundle from a good one. The ingest pipeline is the product's moat and its rules are the one thing that changes without a store release.

**Intended behavior**
docs/03 §11.2 rule 2: updates are verified before activation; §4 rule 1: rules are declarative patterns only. A bundle outside the known shape or outside sane ranges is discarded.

**Proposed fix**
Write a Zod schema for `RulesetBundleInput` (providers, templates, tunables with numeric ranges and threshold ordering `reviewFloor < prefilled < autoCommit`), use `safeParse` in `checkForRulesetUpdate`, cap the response body (256 KB) and each pattern (512 chars), and reject patterns that take longer than a few milliseconds against a fixed pathological input. Signing is GAP-043.

**Implementation checklist**
- [ ] Add `zod` to `mobile/package.json` (v4, matching `server/libs/common`).
- [ ] Create `mobile/lib/ingest/ruleset_schema.ts` with `rulesetBundleSchema` derived from `ruleset_types.ts`; export `RulesetBundleInput` as `z.infer` and delete the hand-written duplicate if one exists.
- [ ] In `mobile/services/parser_rules.ts`, replace `isValidBundle` with `rulesetBundleSchema.safeParse` plus the version comparison, and add a byte-length check on the raw response before parsing.
- [ ] In `mobile/services/parser_rules.ts`, add a per-pattern timing check (`new RegExp(match).test(PATHOLOGICAL_INPUT)` under a 5 ms budget) and reject the bundle on any failure.
- [ ] In `mobile/lib/ingest/parser.ts`, keep compilation but assume validated input.
- [ ] In `mobile/services/__tests__/parser_rules.test.ts`, add cases: tunables out of range, thresholds out of order, oversized body, catastrophic regex, unknown top-level field (should pass through or be stripped, decide and pin).
- [ ] Run the seed through the schema in `mobile/lib/ingest/__tests__/seed_rules.test.ts` so the bundled ruleset is proven valid.

**Acceptance criteria**
- [ ] A bundle with `autoCommitThreshold: 0` is discarded and `getActiveVersion()` is unchanged.
- [ ] A bundle with a 1 MB payload is discarded before JSON parsing.
- [ ] The bundled seed parses.

**Verification commands**
```bash
cd mobile && npm test -- services lib/ingest
cd mobile && npm run typecheck
```

**Do not**
Do not add signature verification here (GAP-043 owns the key decision). Do not change the seed. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit. Already-installed rulesets are unaffected.

**Open questions**
none

### GAP-015 [DOC] docs/12 overclaims new-device recovery and Kotlin recovery tests

> **REMEDIATION: DONE** (2026-09-05) - commit 3c6d278, branch gap-wave-6. Verification: docs only. Both acceptance greps PASS: "unit-tested in Kotlin" 0 hits, key_manager.test.ts named twice. Every doc claim was checked against code before being changed. Found a user-facing overclaim in onboarding COPY, see the Cross-cutting findings in section 0

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | GAP-030 (same file; run first) |
| Est. agent turns | 1-2 |

**Location**
- `docs/12-encryption-and-app-lock.md:78` ("the only key material that can travel to a new device"), `:199` (cache row), `:207-213` (§9 server side), `:221-228` (§11 testing claims)
- `mobile/lib/crypto/key_manager.ts:171-191` (recovery needs `recoveryWrap` and `recoverySalt` from SecureStore on the same device)
- `mobile/lib/privacy/data_export.ts` (exports no key material)
- `mobile/lib/crypto/__tests__/key_manager.test.ts:278-316`, `:322-398` (the recovery tests, in JS against a mocked bridge and sql.js)

**Evidence**
docs/12 §11: "Key wrapping and unwrapping are unit-tested in Kotlin, including that a wrong recovery phrase fails cleanly" and "The recovery path is tested end to end: wrap the DEK both ways, destroy the Keystore key, unwrap from the phrase, open the database." The phrase never touches Kotlin; both tests are JS with the SQLite open mocked. docs/13 Part 5 "Remove the screen lock" is blank.

**What is wrong**
Today the phrase recovers only on the same device (screen-lock removed case). No backup exists (GAP-054), so nothing carries `recoveryWrap` and `recoverySalt` anywhere. The testing section points a reader at the wrong suite and implies the on-device recovery path is proven.

**Why it matters**
A user told the words are their recovery who loses the phone has nothing to recover with; an auditor reading §11 believes SQLCipher open and Keystore invalidation are covered when docs/13 says NOT RUN.

**Intended behavior**
The doc states what exists: same-device recovery, JS-tested with mocks, on-device proof pending.

**Proposed fix**
Amend §5 to say the phrase recovers on the same device today and will travel only once backup ships; mark the §8 cache row as implemented and the backup rows as planned; rewrite §11 bullets 1 and 3 to name `key_manager.test.ts` and state that SQLCipher open and Keystore invalidation are proven only by docs/13 Parts 4 and 5, both NOT RUN.

**Implementation checklist**
- [ ] Edit `docs/12-encryption-and-app-lock.md` §5 second mitigation paragraph to add the same-device limitation.
- [ ] Edit §8 table: mark "The cloud backup blob" and "Server-side storage" rows as "planned".
- [ ] Edit §9 opening line to say the server does not exist yet.
- [ ] Rewrite §11 bullets 1 and 3 as above, citing the JS test file and docs/13 parts.
- [ ] Add a one-line note in §5 that the onboarding copy already avoids the new-device claim.

**Acceptance criteria**
- [ ] `grep -n "unit-tested in Kotlin" docs/12-encryption-and-app-lock.md` returns nothing.
- [ ] §11 names `mobile/lib/crypto/__tests__/key_manager.test.ts`.

**Verification commands**
```bash
cd server && npm run lint
```

**Do not**
Do not change the key hierarchy description or any code. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit.

**Open questions**
none

### GAP-016 [DOC] docs/03 promises a survivor field union and balance-after cross-check that are not built

> **REMEDIATION: DONE** (2026-09-05) - commit e65b6e8, branch gap-wave-6. Verification: docs only. Acceptance PASS: section 6 now says the first arrival wins, section 11.2 rule 2 says integrity and authenticity verification is intended, not yet built. Checked against the CURRENT code including what waves 3-5 changed here; the balance-after cross-check turned out to be built but downstream in Wallets, not in ingest

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `docs/03-ingest-pipeline.md:160-165` (dedupe rule 5, field union), `:132` (balance-after cross-check), `:325-331` (§11.2 rollout and integrity)
- `mobile/lib/ingest/pipeline.ts:378-380` (duplicate branch returns `ignored`, merges nothing)
- `mobile/lib/ingest/dedupe_gate.ts:9-14` ("This one produces NO RECORD ... There is no merged row")
- `mobile/lib/db/repos/transactions_repo.ts:87` (balance-after used only to snap the wallet)

**Evidence**
Doc: "The richer parse survives ... Missing fields on the survivor are filled from the suppressed twin (field union)." Code: first arrival wins and the twin is dropped. Doc §5 rule 5 promises a "provider reports ₱4,310.25; PeraPlano computes ₱4,510.25, reconcile?" prompt from ingest; the only balance comparison lives in the wallets drift code.

**What is wrong**
Doc intent and code disagree in three places that a future implementer would otherwise "fix" in the wrong direction. Field union matters for SMS-first twins (the thinner parse survives and the push's reference number is dropped), which also feeds GAP-012.

**Why it matters**
Rows lack reference numbers or merchants on some SMS-first twins; the doc's reconciliation prompt never appears from ingest. Either the behaviour or the doc must move.

**Intended behavior**
docs/03 describes the MVP scope accurately. Field union is recommended as a follow-up code change; the balance cross-check belongs in wallets drift code and the doc should point there.

**Proposed fix**
Amend §6 rule 5 to state that the MVP keeps the first arrival and drops the twin, with field union listed as a follow-up; amend §5 rule 5 to point at the wallet drift explainer; amend §11.2 to mark integrity verification and staged rollout as not yet built (cross-reference GAP-043). Record each as dated amendments, matching the doc's existing style.

**Implementation checklist**
- [ ] Edit `docs/03-ingest-pipeline.md` §6 rule 5 with a dated "MVP amendment" paragraph.
- [ ] Edit §5 rule 5 to reference `mobile/lib/wallets/reconcile.ts` and the drift explainer.
- [ ] Edit §11.2 rules 2 and 4 with a dated note that they are planned, citing GAP-043.
- [ ] Add a follow-up entry to `docs/09-v2-backlog.md` §2b for field union with the SMS-first example.

**Acceptance criteria**
- [ ] A reader of §6 can tell that no merge happens today.
- [ ] §11.2 no longer states integrity verification as present tense.

**Verification commands**
```bash
cd server && npm run lint
```

**Do not**
Do not implement field union here. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit.

**Open questions**
none

### GAP-017 [SEC] Recovery words go to the OS share sheet and the phrase screens allow screenshots

> **REMEDIATION: DONE** (2026-09-05) - commit 83b1253, branch gap-wave-5. Verification: jest components/onboarding + components/lock + 3 layout suites, 21 suites 229 tests PASS; all 8 new assertions fail pre-fix. expo-screen-capture corrected to ~8.0.10 (57.x would have crashed onboarding and lock at module load). NATIVE REBUILD REQUIRED before the guard does anything on device

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/app/(onboarding)/recovery_phrase.tsx:192-195` (`Share.share({ message: words.join(" ") })`)
- `mobile/components/onboarding/phrase_display.tsx:105-117` ("Copy or share" control; a warning about screenshots but no prevention)
- `mobile/components/lock/recovery_unlock_form.tsx` (phrase entry, no capture guard)
- `mobile/components/onboarding/__tests__/recovery_phrase.test.tsx:358` (asserts the share works)
- `git grep -n "preventScreenCapture\|FLAG_SECURE" mobile` returns nothing

**Evidence**
```
const handleShare = useCallback(() => {
  if (!words) return;
  void Share.share({ message: words.join(" ") });
}, [words]);
```

**What is wrong**
The twelve words are the second unwrap path for the whole ledger (docs/12 §5). The share action hands them to any app the user picks, which on Android also lands them in share history and often the clipboard. Nothing sets the secure flag, so the phrase screen appears in screenshots and the Recents thumbnail, and docs/13 Rule 0 already records two accidental exposures during device sessions.

**Why it matters**
A user who shares to Messenger or Keep has moved the recovery key out of the app's control; a screenshot syncs to a cloud photo library. The docs/12 threat model does not cover a phrase that left the device by the user's own tap, but the UI should not invite it.

**Intended behavior**
The phrase is shown once, written down, confirmed by re-entry (docs/12 §5). No share sheet. Screens that render or accept the phrase are excluded from capture.

**Proposed fix**
Remove the share action (keep an explicit "Copy" with a 30-second clipboard clear if the owner wants a copy path at all) and call `usePreventScreenCapture()` from `expo-screen-capture` in `PhraseDisplay`, `PhraseConfirm` and `RecoveryUnlockForm`.

**Implementation checklist**
- [ ] Add `expo-screen-capture` to `mobile/package.json`.
- [ ] In `mobile/app/(onboarding)/recovery_phrase.tsx`, delete `handleShare` and the control that calls it.
- [ ] In `mobile/components/onboarding/phrase_display.tsx`, remove the "Copy or share" affordance or replace it with a copy that schedules `Clipboard.setStringAsync("")` after 30 seconds.
- [ ] Call `usePreventScreenCapture()` in `phrase_display.tsx`, `phrase_confirm.tsx` and `mobile/components/lock/recovery_unlock_form.tsx`.
- [ ] Invert `recovery_phrase.test.tsx:358` to assert no share button renders; add a test that the capture guard hook is called (mock the module).
- [ ] Update the on-screen warning copy to say screenshots are blocked on this screen.

**Acceptance criteria**
- [ ] `git grep -n "Share.share" mobile/app mobile/components` returns nothing under onboarding.
- [ ] The three phrase surfaces call the capture guard in tests.

**Verification commands**
```bash
cd mobile && npm test -- components/onboarding components/lock
cd mobile && npm run typecheck
```

**Do not**
Do not apply the capture guard app-wide (ledger screens are a separate decision). Do not change the phrase generation or confirmation logic. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit. Requires a native rebuild because a module is added.

**Open questions**
none

### GAP-018 [FEAT] Skipped onboarding grants cannot be completed later from Settings

> **REMEDIATION: DONE** (2026-09-05) - commit 2de9b02, branch gap-wave-5. Verification: jest more_hub + more_tab + permissions_screen + components/onboarding 19 suites 215 tests PASS. ON-DEVICE VERIFICATION REQUIRED: battery intent resolution on One UI, truthful grant reads after a settings round trip, canAskAgain honesty, and whether the exemption survives at all

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-003 (adds the alerts request the checklist reuses) |
| Blocks | none |
| Est. agent turns | 4-6 |

**Location**
- `mobile/app/(onboarding)/battery.tsx:63` (the only place the battery settings intent is opened)
- `mobile/app/(tabs)/more/index.tsx` (no battery, OEM or permissions row; grep for battery returns nothing)
- `mobile/app/(tabs)/more/listener_health.tsx:70` (notification access re-grant exists here)
- `docs/04-features/01-onboarding.md:95`, `:179`; `docs/04-features/11-settings-privacy.md:28`

**Evidence**
Doc line 95: "A dismissible Home card and a permissions checklist in Settings & Privacy allow every skipped grant to be completed later". Doc 11 line 28 lists "battery-exemption and OEM guidance shortcuts" under Tracking. Only notification access has a re-entry (listener health).

**What is wrong**
A user who skipped the battery step during onboarding, which the docs make skippable on purpose, has no way back to it. The OEM guidance the risk register (R3) relies on is reachable once.

**Why it matters**
Listener uptime on Xiaomi, Oppo, Vivo and Huawei depends on this exemption; the app's own health surface tells the user tracking was interrupted but cannot send them to the fix.

**Intended behavior**
A permissions checklist screen under More listing notification access, alerts permission, and battery exemption, each with its state and a button that reuses the onboarding value-screen plus system-screen pair.

**Proposed fix**
Add `mobile/app/(tabs)/more/permissions.tsx` that renders three rows using `isAccessGranted`, `Notifications.getPermissionsAsync` (via `alerts_service`) and a new `isIgnoringBatteryOptimizations` bridge call if available, otherwise a plain "Open battery settings" button reusing `BATTERY_SETTINGS_INTENT` from `battery.tsx` (move the constant to `lib/onboarding/`). Link it from the Tracking group in `more/index.tsx` and from the tracking-interrupted banner.

**Implementation checklist**
- [ ] Move `BATTERY_SETTINGS_INTENT` and the open helper from `mobile/app/(onboarding)/battery.tsx` to `mobile/lib/onboarding/battery_settings.ts` and import it back.
- [ ] Create `mobile/app/(tabs)/more/permissions.tsx` with the three rows and their actions.
- [ ] Add the row to the Tracking group in `mobile/app/(tabs)/more/index.tsx`.
- [ ] In `mobile/components/home/` tracking-interrupted banner, add a link to the new screen.
- [ ] Write `mobile/app/__tests__/permissions_screen.test.tsx` covering each row's granted and not-granted rendering.
- [ ] Update `docs/04-features/11-settings-privacy.md:28` to name the screen.

**Acceptance criteria**
- [ ] More shows a Permissions row; the screen lists three items with state.
- [ ] Tapping the battery row opens the same intent the onboarding step opens.

**Verification commands**
```bash
cd mobile && npm test -- app/__tests__/permissions_screen onboarding
cd mobile && npm run typecheck
```

**Do not**
Do not request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (the onboarding file explains why the settings list intent is used instead). Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit.

**Open questions**
none

### GAP-019 [SEC] Web site sends no security headers

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2-4 |

**Location**
- `server/apps/web/next.config.ts:4-15` (no `headers()`)
- `docs/nginx/peraplano-production.conf:69` (only `Cache-Control` is added)
- `server/apps/web/proxy.ts:17-22` (sets only the request id header)

**Evidence**
`grep -c headers server/apps/web/next.config.ts` prints 0; the nginx file has one `add_header` line and it is `Cache-Control`. `poweredByHeader: false` is set.

**What is wrong**
The privacy notice, terms and beta signup form ship with no `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy` or `X-Content-Type-Options`. The backend baseline calls for helmet-equivalent headers on every client-facing service.

**Why it matters**
The beta form accepts an email; a framed or script-injected copy of the page is the cheapest way to harvest it. HSTS is what stops a first visit over HTTP after certbot adds the redirect.

**Intended behavior**
A conservative header set on every response: CSP with `default-src 'self'` plus the `motion` and `ogl` needs (inline styles are already self-hosted fonts), HSTS one year, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`.

**Proposed fix**
Add `async headers()` to `next.config.ts` returning the set for `/(.*)`; keep nginx for HSTS only if certbot's rewrite does not add it. Add a Vitest test that renders the config and asserts the header names, and extend the smoke test to assert `strict-transport-security` and `content-security-policy` on `/`.

**Implementation checklist**
- [ ] In `server/apps/web/next.config.ts`, add `headers()` with the six headers above, with a CSP that allows the app's own scripts and styles; verify the marketing page (`ogl` WebGL, `motion`) still renders under it.
- [ ] Create `server/apps/web/__tests__/security_headers.test.ts` asserting the header set.
- [ ] In `server/smoke/routes.smoke.test.ts`, assert the two headers on a GET of `/`.
- [ ] In `docs/nginx/peraplano-production.conf`, add a comment that headers come from the app; do not duplicate them.

**Acceptance criteria**
- [ ] `curl -sI https://peraplano.filhmar.online/` after deploy shows the six headers (owner check).
- [ ] Smoke test passes locally with `SMOKE_SKIP_BUILD` unset.

**Verification commands**
```bash
cd server && npm test
cd server && npm run typecheck
cd server && npm run lint
cd server && npm run test:smoke
```

**Do not**
Do not add a CSP that breaks the WebGL hero without checking the page. Do not change the nginx proxy blocks. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit and redeploy; HSTS max-age should start at one day for the first deploy and rise after.

**Open questions**
none

### GAP-020 [FEAT] Percent-of-payday goal contribution rules cannot be created in the UI

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/components/goals/goal_form.tsx:88` (seeds only a fixed rule), `:227` (`contributionRule: ruleAmount > 0 ? { kind: "fixed", amount: ruleAmount } : null`)
- `mobile/lib/goals/goals_service.ts:92-96` (engine already handles `percent`)
- `mobile/lib/safe_to_spend_service.ts:231-236` (`contributionAmount` handles `percent`)
- `docs/04-features/05-goals-savings.md:51`, `:90`

**Evidence**
The type `ContributionRule` has a `percent` variant and two engines consume it; the form can only produce `fixed`. On edit, an existing percent rule is not seeded and would be overwritten with `null` or a fixed value.

**What is wrong**
Half the feature is missing and the form silently destroys the other half's data if it ever exists.

**Why it matters**
The kinsenas persona in docs/00 §4.1 is promised "payday auto-allocation to Goals" as a percent of pay; today it is fixed pesos only.

**Intended behavior**
docs/04-features/05 rule 13: fixed ₱ or percent of payday income, selectable on the form; edit preserves the stored kind.

**Proposed fix**
Add a two-option segmented control (₱ / %) and a percent field using the existing `NumericKeypad` `rate` mode; seed from `initial.contributionRule.kind`; keep the payload shape.

**Implementation checklist**
- [ ] In `mobile/components/goals/goal_form.tsx`, add `ruleKind` state seeded from `initial?.contributionRule?.kind ?? "fixed"` and a percent input in `rate` mode.
- [ ] In the submit handler, emit `{ kind: "percent", percent }` when the percent kind is selected and the value is between 1 and 100.
- [ ] In `mobile/components/goals/__tests__/goal_form.test.tsx`, add create-percent and edit-preserves-percent cases.

**Acceptance criteria**
- [ ] Creating a goal with "10 percent" stores `{ kind: "percent", percent: 10 }`.
- [ ] Editing that goal shows 10 percent selected and saving without changes keeps it.

**Verification commands**
```bash
cd mobile && npm test -- components/goals lib/goals
cd mobile && npm run typecheck
```

**Do not**
Do not change `goals_service.ts` math. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit; stored percent rules remain readable by the engines.

**Open questions**
none

### GAP-021 [CONTRA] Telemetry defaults to on while the docs list the default as undecided

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D4 Judgment |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 after the decision |

**Location**
- `mobile/lib/db/repos/app_settings_repo.ts:246` (`telemetry_enabled: true`)
- `mobile/services/telemetry.ts:92-147` (seven-field count-only payload, 24 h cadence)
- `mobile/app/(tabs)/more/settings.tsx:322-345` (the only disclosure)
- `docs/07-privacy-and-compliance.md:35`, `:155`; `docs/08-risks-and-open-questions.md:287`

**Evidence**
See the Contradiction Register entry for GAP-021.

**What is wrong**
Code picked "on by default" for a question the docs hand to counsel. Onboarding says nothing about it.

**Why it matters**
The payload is harmless (counts only, no server yet), but the privacy notice and Data safety form must describe the real default, and the decision is legal posture, not engineering.

**Intended behavior**
Whatever the owner decides, documented in docs/07 §2.3 and reflected in the default and in onboarding copy.

**Proposed fix**
Decision brief in section 8. After the decision: set the default, add one disclosure line to `how_it_works.tsx`, update docs/07 and the web privacy page.

**Implementation checklist**
- [ ] Owner records the decision in `docs/07-privacy-and-compliance.md` §2.3 (one sentence) and closes the docs/08 row.
- [ ] Set `telemetry_enabled` default in `mobile/lib/db/repos/app_settings_repo.ts` accordingly.
- [ ] Add a disclosure sentence to `mobile/app/(onboarding)/how_it_works.tsx` (or `more/privacy.tsx` if opt-in).
- [ ] Update `server/apps/web/components/pages/privacy_page.tsx` wording if it mentions diagnostics.
- [ ] Update the settings row subtitle if the default changed.

**Acceptance criteria**
- [ ] The default, the onboarding copy, docs/07 and the web notice all say the same thing.

**Verification commands**
```bash
cd mobile && npm test -- services app/__tests__
cd server && npm test
```

**Do not**
Do not change the payload whitelist. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert; the setting is a per-device row.

**Open questions**
1. Legitimate interest with opt-out (default on) or consent (default off)? RESOLUTION: HUMAN REQUIRED.

### GAP-022 [CONTRA] Wallet deletion is archive-only in code but the UI says Delete and the doc specifies delete-with-reassign

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D4 Judgment |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | GAP-045 (wallets doc rewrite must know the answer) |
| Est. agent turns | 2-3 after the decision |

**Location**
- `mobile/lib/db/repos/wallets_repo.ts:119-122`, `:189-193`
- `mobile/components/wallets/archive_wallet_sheet.tsx:12-15`, `:83`, `:169`
- `mobile/app/wallet/[id].tsx:343`, `:515`; `mobile/app/wallet/[id]/edit.tsx:13`
- `docs/04-features/02-wallets.md:92-97`, `:118`

**Evidence**
See the Contradiction Register entry for GAP-022.

**What is wrong**
Three sources disagree: the doc (delete with reassign), the code (archive only, by design), the screen ("Delete wallet", "Deleted" chip).

**Why it matters**
A user who taps "Delete" and later finds the wallet under archived has been told something false, in the direction that makes them think data was destroyed.

**Intended behavior**
One vocabulary. Recommended: archive everywhere.

**Proposed fix**
Decision brief in section 8. Recommended path (a): rename the UI to Archive and rewrite the doc's delete flow.

**Implementation checklist**
- [ ] Owner picks (a) archive-only or (b) build delete-with-reassign.
- [ ] For (a): in `mobile/app/wallet/[id].tsx` change the row title at 515 and the chip at 343; in `archive_wallet_sheet.tsx` change the title at 83 and the button at 169; update `mobile/app/wallet/[id]/edit.tsx:13` comment.
- [ ] For (a): rewrite `docs/04-features/02-wallets.md` lines 92-97 and rule 18 to archive semantics.
- [ ] Update the wallet screen tests for the new labels.

**Acceptance criteria**
- [ ] `git grep -n "Delete wallet\|\"Deleted\"" mobile/app/wallet mobile/components/wallets` returns nothing under option (a).

**Verification commands**
```bash
cd mobile && npm test -- app/__tests__ components/wallets
cd mobile && npm run typecheck
```

**Do not**
Do not add a hard delete without the reassign flow. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit.

**Open questions**
1. Archive-only, or build delete-with-reassign? RESOLUTION: HUMAN REQUIRED.

### GAP-023 [CONTRA] Limits are created at four cadences at once; the doc and the Free cap describe one

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D4 Judgment |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | GAP-045 |
| Est. agent turns | 2-3 after the decision |

**Location**
- `mobile/lib/limits/limit_derivation.ts:1-14`, `:125-127`, `:131-136`
- `mobile/app/(tabs)/plan/limits/new.tsx:44`; `mobile/app/(onboarding)/first_limit.tsx:32`
- `mobile/lib/entitlements.ts:17` (`FREE_ACTIVE_LIMIT_CAP = 1`); `mobile/components/plan/limits_panel.tsx:131`
- `docs/04-features/03-limits.md:36-46`, `:139`; migration `010_soft_delete_and_derived_limits.sql:63`

**Evidence**
See the Contradiction Register entry for GAP-023.

**What is wrong**
The owner decided on 2026-08-20 that one entered limit derives three siblings. The doc never learned, and the Free cap logic counts active rows without knowing about derivation.

**Why it matters**
Inert today (tier plus). At flip time every Free user would hold four active limits against a cap of one.

**Intended behavior**
Doc describes derivation; the Free cap counts source limits only (recommended).

**Proposed fix**
Decision brief in section 8. Then: doc subsection (GAP-045 carries it) and, if (a), make `canCreateLimit` count rows where `derivedFrom === null`.

**Implementation checklist**
- [ ] Owner decides how derived rows count toward the Free cap.
- [ ] If source-only: in `mobile/components/plan/limits_panel.tsx:131` and `mobile/app/(onboarding)/first_limit.tsx`, pass the count of limits with `derivedFrom === null` to `canCreateLimit`.
- [ ] Add a test in `mobile/lib/__tests__/entitlements.test.ts` (or the panel test) for the derived case under tier free.
- [ ] Doc update is done by GAP-045.

**Acceptance criteria**
- [ ] Under tier free with one source limit and three derived rows, `canCreateLimit` is false for a new source and the four rows stay active.

**Verification commands**
```bash
cd mobile && npm test -- lib/limits components/plan entitlements
cd mobile && npm run typecheck
```

**Do not**
Do not change derivation itself. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
1. Do derived rows count toward the Free "1 active" cap? RESOLUTION: HUMAN REQUIRED.

### GAP-024 [CONTRA] Free-tier reports show the current month only; the doc promises a 90-day window

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D4 Judgment |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-3 after the decision |

**Location**
- `mobile/lib/reports/reports_service.ts:125-142`
- `docs/04-features/10-reports.md:42`, `:50`, `:85`; `docs/04-features/02-wallets.md:158`

**Evidence**
```
if (tier === "free") {
  const isCurrentMonth = scope.kind === "month" && scope.month === monthKey(today);
  return { range: calendarMonthOf(today), truncatedByTier: !isCurrentMonth };
}
```
Doc line 50: "Back/forward arrows step through prior months within the 90-day history window."

**What is wrong**
Two readings of "History 90 days, Reports basic monthly". Inert today.

**Why it matters**
At flip time a Free user on the 1st sees an empty report.

**Intended behavior**
Per the decision. Recommended: any month whose first day is within 90 days of today.

**Proposed fix**
Decision brief in section 8. Then either a five-line change in `resolveScope` or a doc edit in two files.

**Implementation checklist**
- [ ] Owner decides (a) three months back or (b) current month only.
- [ ] For (a): in `mobile/lib/reports/reports_service.ts` `resolveScope`, allow a requested month whose start is within `historyWindowDays()` of today; keep `truncatedByTier` for older.
- [ ] For (b): edit `docs/04-features/10-reports.md` lines 42, 50, 85 and `docs/04-features/02-wallets.md:158`.
- [ ] Add or adjust the reports_service test for tier free.

**Acceptance criteria**
- [ ] Under tier free on Sep 1, requesting August returns August under (a) or is documented as clamped under (b).

**Verification commands**
```bash
cd mobile && npm test -- lib/reports
cd mobile && npm run typecheck
```

**Do not**
Do not touch `historyWindowDays`. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
1. Free reports: three months back or current month? RESOLUTION: HUMAN REQUIRED.

### GAP-025 [CONTRA] Categorizer resolves rule conflicts by recency; the doc says specificity first

| Field | Value |
|---|---|
| Severity | S4 Minor |
| Complexity | XS |
| Difficulty | D4 Judgment |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 after the decision |

**Location**
- `mobile/lib/ingest/categorizer.ts:218-226`; `mobile/lib/ingest/rule_matcher.ts:56`; `mobile/lib/db/repos/user_rules_repo.ts:171`
- `docs/04-features/08-review-queue.md:130`; `docs/02-domain-model.md` §3.11 priority field

**Evidence**
See the Contradiction Register entry for GAP-025.

**What is wrong**
A later broad rule beats an earlier narrow one.

**Why it matters**
An older precise correction stops sticking with no explanation. Minor because it needs two overlapping merchant rules.

**Intended behavior**
Per decision: doc matches code, or code sorts by specificity.

**Proposed fix**
Decision brief in section 8.

**Implementation checklist**
- [ ] Owner chooses (a) doc reword or (b) specificity sort.
- [ ] For (b): in `mobile/lib/ingest/categorizer.ts` `byEvaluationOrder`, compare number of matcher fields set, then merchant pattern length, before `createdAt`; add a test with "SM" and "SM Hypermarket".
- [ ] For (a): edit `docs/04-features/08-review-queue.md:130`.

**Acceptance criteria**
- [ ] Under (b), a transaction at "SM Hypermarket" takes the narrower rule regardless of creation order.

**Verification commands**
```bash
cd mobile && npm test -- lib/ingest
```

**Do not**
Do not change `user_rules_repo.ts` priority defaults. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
1. Specificity before recency? RESOLUTION: HUMAN REQUIRED.

### GAP-026 [CONTRA] Free caps are 1 in code and 3 on the design board

| Field | Value |
|---|---|
| Severity | S4 Minor |
| Complexity | XS |
| Difficulty | D4 Judgment |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1 after the decision |

**Location**
- `mobile/lib/entitlements.ts:16-19`; `docs/pera-plano-mobile/PeraPlano Mobile UI.dc.html` (Free-vs-Plus board); `docs/08-risks-and-open-questions.md:235-257`

**Evidence**
docs/08 already records the disagreement and states that nobody has decided which side moves.

**What is wrong**
Documented and open. Listed here so the queue is complete and so no agent "fixes" the constants.

**Why it matters**
Inert until pricing.

**Intended behavior**
One number in code, docs and design.

**Proposed fix**
Decision at pricing time; then a one-line constant or a design-board edit.

**Implementation checklist**
- [ ] Owner decides at pricing time.
- [ ] Apply to `mobile/lib/entitlements.ts` or the design board; update docs/05 §2 if the matrix changes.

**Acceptance criteria**
- [ ] docs/05 §2, `entitlements.ts` and the board agree.

**Verification commands**
```bash
cd mobile && npm test -- entitlements
```

**Do not**
Do not change the constants before the decision. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
1. 1 or 3? RESOLUTION: HUMAN REQUIRED (pricing).

### GAP-027 [PROJ] Function and field names are camelCase throughout while the stated convention is snake_case

| Field | Value |
|---|---|
| Severity | S4 Minor |
| Complexity | XS |
| Difficulty | D4 Judgment |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | GAP-046 (the repo CLAUDE.md should record the answer) |
| Est. agent turns | 1 after the decision |

**Location**
- Whole mobile and server trees. Counts: 584 exported camelCase functions versus 3 snake_case (`git grep -c -E "^export (async )?function [a-z]+[A-Z]"`); 0 camelCase file names out of 775; TypeScript fields camelCase (`notificationKey`) mapped to snake_case columns (`notification_key`) through `mobile/lib/db/mappers.ts`.
- No `CLAUDE.md`, `CONTRIBUTING.md` or lint config exists at the repo root or under `mobile/` to record the repo's own rule.

**Evidence**
File and directory names, database columns and JSON fields follow snake_case as the convention asks; every function, method and TypeScript field is camelCase, uniformly, with a deliberate mapping layer at the database boundary.

**What is wrong**
The repo has a consistent internal convention (camelCase identifiers, snake_case files and columns) that differs from the stated global rule for identifiers. Nothing records that this is intentional, so a new agent following the global rule would start introducing snake_case functions into camelCase files.

**Why it matters**
Drive-by renames are the failure mode. The prompt forbids them; the repo needs a written rule to point at.

**Intended behavior**
A repo-level `CLAUDE.md` stating: files, directories, columns and JSON fields snake_case; TypeScript identifiers camelCase; no renames.

**Proposed fix**
Owner confirms the repo convention as observed; GAP-046 writes it down. No code changes.

**Implementation checklist**
- [ ] Owner confirms camelCase identifiers as the repo rule.
- [ ] GAP-046 records it in a new root `CLAUDE.md`.

**Acceptance criteria**
- [ ] `CLAUDE.md` at the repo root states the identifier rule.

**Verification commands**
```bash
cd mobile && npm run typecheck
```

**Do not**
Do not rename anything. Do not add a lint rule that flags existing code.

**Rollback**
n/a

**Open questions**
1. Confirm camelCase identifiers as the repo convention? RESOLUTION: HUMAN REQUIRED.

### GAP-028 [SEC] expo-updates adds an undocumented egress and an OTA channel with no rollback runbook or policy hook

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 1.0 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | GAP-001 |
| Blocks | none |
| Est. agent turns | 4-6 |

**Location**
- `mobile/app.json:75-80` working tree (`runtimeVersion: { policy: "appVersion" }`, `updates.url`)
- `mobile/eas.json:10`, `:17`, `:25` (channels per profile)
- `mobile/package.json` working tree (`expo-updates ~29.0.20`); `git grep -n "Updates\." mobile` returns nothing
- `mobile/services/device_info.ts:4-12` (promise that requests carry no install id)
- `docs/07-privacy-and-compliance.md:149-159` (lifecycle table has no row for the update client); `docs/07:93` (re-declaration discipline)

**Evidence**
No `checkAutomatically` is set, so the library default applies: the update client contacts `u.expo.dev` on every launch with runtime version, platform, channel and an EAS client identifier (library default behaviour; C2 because it was not observed from this repository). All three build variants share `version: 0.1.0`, so an update published to a channel reaches every build on that channel with that runtime version. There is no rollback runbook and no step that re-runs the Play policy review when an OTA changes what the listener reads or sends.

**What is wrong**
A new network egress with a persistent identifier sits outside the privacy lifecycle table and outside the device-info promise. A JS-only change can now ship to testers without a store build and without the "re-declaration discipline" docs/07 §3.1 rule 6 describes. Nothing documents how to roll a bad update back (EAS supports republishing a previous update to the channel; someone has to write it down).

**Why it matters**
The privacy notice claims a complete list of what leaves the device; the Play declaration reviewer may read OTA as a way to change listener behaviour post-review. Both are process gaps, fixable with configuration and a runbook.

**Intended behavior**
docs/07 §4 lists the update check as a lifecycle row (what is sent, to whom, retention per Expo's policy); `checkAutomatically` is an explicit choice; an OTA runbook exists with publish, verify and rollback steps and a checklist item "does this change what the listener reads, stores or sends".

**Proposed fix**
Set `updates.checkAutomatically` to `ON_ERROR_RECOVERY` or `ON_LOAD` deliberately and record why; add the lifecycle row; add `docs/OTA_RUNBOOK.md` with `eas update --channel`, `eas update:republish`, and the policy checklist; amend `device_info.ts` header to note the update client's own request.

**Implementation checklist**
- [ ] In `mobile/app.json`, add `updates.checkAutomatically` with the chosen value and `updates.fallbackToCacheTimeout: 0`.
- [ ] Add row 10 to the docs/07 §4 lifecycle table for the update check (fields sent, recipient Expo, retention per their terms, opt-out: none while the app is installed).
- [ ] Create `docs/OTA_RUNBOOK.md`: publish per channel, verify on a preview device, rollback via republish, and the listener-scope checklist.
- [ ] Amend the `mobile/services/device_info.ts` header to reference the update client's request.
- [ ] Add a one-line note in `docs/07-privacy-and-compliance.md` §3.1 rule 6 that OTA publishes go through the same check.

**Acceptance criteria**
- [ ] `docs/07` names the update client; `docs/OTA_RUNBOOK.md` exists and names the rollback command.
- [ ] `mobile/app.json` sets `checkAutomatically` explicitly.

**Verification commands**
```bash
cd mobile && npm test -- modules/notification_listener
cd mobile && npm run typecheck
```

**Do not**
Do not remove `expo-updates`. Do not change channels. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the config line; docs stay.

**Open questions**
none (AGENT-ASSISTED because the `checkAutomatically` choice and the privacy row wording deserve owner review before the notice is published)

### GAP-029 [CONTRA] Loan outstanding balance ignores flat total repayable and amortized interest

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 1.0 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | none |
| Blocks | GAP-033 (same file `loans_service.ts`; run first) |
| Est. agent turns | 5-8 |

**Location**
- `mobile/lib/db/repos/loans_repo.ts:635` (`Math.max(0, loan.principal - paid + adjusted)`)
- `mobile/lib/loans/loans_service.ts:270` (feeds next-due), `:381-387` (match ceiling)
- `mobile/components/loans/loan_form.tsx:157-158`, `:236-238` (flat total derived, not stored); `mobile/components/loans/loan_card.tsx:189`
- `docs/04-features/06-loans.md:82-83`, `:88-89`

**Evidence**
See the Contradiction Register entry for GAP-029.

**What is wrong**
Every schedule kind uses principal minus payments. Flat 5-6 (borrow ₱5,000, repay ₱6,000) shows settled after ₱5,000; an amortized loan shows settled once principal is repaid while interest rows remain. C2 because the form's mapping of the flat total at save time and the full status path were not read line by line.

**Why it matters**
The Plan tab's utang figure and the settled state are wrong for exactly the loan types the product brief calls out (5-6, GLoan, credit cards).

**Intended behavior**
docs/04-features/06-loans.md rule 2: flat and amortized loans owe the schedule remainder; free-form loans owe principal minus payments plus adjustments.

**Proposed fix**
Compute outstanding per kind at read time: when a schedule exists, sum `schedule[].amountDue` minus payments (plus adjustments); otherwise the current formula. No schema change. Update the card's percent-paid base and the match ceiling to the same figure.

**Implementation checklist**
- [ ] In `mobile/lib/db/repos/loans_repo.ts`, add `scheduledTotal(loan)` and use it in the outstanding computation when `loan.schedule` is non-empty.
- [ ] In `mobile/lib/loans/loans_service.ts:270` and `:381-387`, read the new outstanding.
- [ ] In `mobile/components/loans/loan_card.tsx:189`, base percent paid on the same total.
- [ ] Add tests: 5-6 flat loan settles at ₱6,000, not ₱5,000; amortized loan is not settled while interest rows remain; free-form unchanged.
- [ ] Confirm `loan_form.tsx:157-158` still derives the schedule from installment x count and document that principal stays the borrowed amount.

**Acceptance criteria**
- [ ] The doc's own example (principal ₱5,000, flat, total ₱6,000) shows outstanding ₱6,000 before any payment and ₱1,000 after ₱5,000 paid.

**Verification commands**
```bash
cd mobile && npm test -- lib/loans lib/db/repos components/loans
cd mobile && npm run typecheck
```

**Do not**
Do not write the total into `principal`. Do not change schedule generation in `loan_math.ts`. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert; outstanding is derived, nothing stored.

**Open questions**
none (AGENT-ASSISTED for the reviewer to confirm settled-state and reminder behaviour on existing device loans)

### GAP-030 [CONTRA] Locked state is incomplete: no background timer and the in-memory query cache is kept

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | GAP-015 (docs/12 edits; run after) |
| Blocks | GAP-034 (same file; run first) |
| Est. agent turns | 3-5 |

**Location**
- `mobile/contexts/lock_context.tsx:239-261` (foreground-only check, `Date.now()` wall clock), `:207-213` (`lockNow`)
- `mobile/app/_layout.tsx:390-396`; `mobile/lib/query_client.ts:39-54` (`gcTime` 30 min)
- `docs/12-encryption-and-app-lock.md:156`, `:168-170`
- `mobile/contexts/__tests__/lock_context.test.tsx:903-1000`

**Evidence**
See the Contradiction Register entry for GAP-030. `git grep -n "queryClient.clear\|removeQueries\|resetQueries" mobile` returns nothing.

**What is wrong**
For the whole background stay the DEK, the open SQLCipher handle and every decrypted query result stay in memory; the lock is evaluated only when the user comes back. A clock set backwards skips it. `lockNow` never clears the query cache, so after unlock the old data renders before any refetch.

**Why it matters**
Within the docs/12 §4 threat model this is memory-only and out of scope. The gap is between what the doc says the locked state is and when the app enters it; a crash dump or debugging hook would find plaintext in a "locked" app.

**Intended behavior**
docs/12 §7 as written, with an honest note that a background timer on Android is best effort.

**Proposed fix**
Arm a `setTimeout` for five minutes on the `background` transition that calls `lockNow`, clear it on foreground, compare against a monotonic source where available, and call `queryClient.clear()` inside `lockNow` after `closeDatabase()`. Amend docs/12 §7 to say the timer is best effort and that the foreground check remains the guarantee.

**Implementation checklist**
- [ ] In `mobile/contexts/lock_context.tsx`, add the background timer and its cleanup.
- [ ] In `lockNow`, call `queryClient.clear()` after `Database.closeDatabase()`.
- [ ] In `mobile/contexts/__tests__/lock_context.test.tsx`, add: timer fires after five minutes in background; cache is empty after lock.
- [ ] Edit `docs/12-encryption-and-app-lock.md` §7 "What happens while locked" to list the cache and the timer caveat.

**Acceptance criteria**
- [ ] With fake timers, `lockNow` runs five minutes after `background` without a foreground event.
- [ ] After `lockNow`, `queryClient.getQueryCache().getAll()` is empty.

**Verification commands**
```bash
cd mobile && npm test -- contexts
cd mobile && npm run typecheck
```

**Do not**
Do not change the ten-second Keystore validity window or any Kotlin. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none (AGENT-ASSISTED: a reviewer should confirm the timer does not fire during the biometric prompt itself, which puts the app in background on some OEMs)

### GAP-031 [CODE] linkTransfer overwrites an existing link on either leg

> **REMEDIATION: DONE** (2026-09-04) - commit 4f8774a, branch gap-wave-3. Verification: same commit; repo guard and both service guards each proven separately load-bearing. No migration; the real constraint needs a junction table, see GAP-057

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-012 (same file `resolve_actions.ts`; run after) |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/lib/db/repos/transfer_links_repo.ts:125-128` (`UPDATE transactions SET transfer_link_id = ? ... WHERE id IN (?, ?)` with no `transfer_link_id IS NULL`)
- `mobile/lib/review/resolve_actions.ts:425-435` (checks the out leg only), `:479-494` (`confirmAsTransfer` ignores `counterpart.transferLinkId`)
- `mobile/lib/ingest/transfer_detector.ts:257` (the only place double-linking is prevented, for auto-links)

**Evidence**
```
"UPDATE transactions SET transfer_link_id = ?, updated_at = ? WHERE id IN (?, ?)"
```

**What is wrong**
A stale ambiguous-transfer card confirmed after its counterpart was linked elsewhere re-points the counterpart to a new link; the old `transfer_links` row stays `active` with one leg orphaned. Domain invariant I7 (one link per transaction) is enforced only on the detector's path.

**Why it matters**
The orphaned partner re-enters spend and income totals with no explanation; the user sees a transfer become a purchase.

**Intended behavior**
docs/02 §3.3 invariant 3: a transaction belongs to at most one transfer link. Linking a leg that already has one fails loudly or resolves the card as already handled.

**Proposed fix**
In `linkTransfer`, read both legs first and throw `AlreadyLinkedError` if either carries a link. In `confirmAsTransfer` and the ambiguous-transfer confirm path, treat a linked counterpart as "already handled": resolve the card without inserting. A partial unique index is the belt-and-braces version and would need a migration; leave it to GAP-057's migration.

**Implementation checklist**
- [ ] In `mobile/lib/db/repos/transfer_links_repo.ts`, guard `linkTransfer` with a select on both legs and throw when `transfer_link_id` is non-null on either.
- [ ] In `mobile/lib/review/resolve_actions.ts`, check `counterpart.transferLinkId` in `confirmAsTransfer` and the in-leg in the ambiguous path; resolve the card as handled on a hit.
- [ ] Add repo test "linking an already-linked leg throws and writes nothing" and a resolve_actions test for the stale-card case.

**Acceptance criteria**
- [ ] After the stale-card scenario, `transfer_links` has exactly one active row and both legs point at it.

**Verification commands**
```bash
cd mobile && npm test -- lib/db/repos lib/review
cd mobile && npm run typecheck
```

**Do not**
Do not add a migration here. Do not change the detector. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert; existing links untouched.

**Open questions**
none

### GAP-032 [FEAT] Out-of-order balance-after notifications re-anchor the wallet

> **REMEDIATION: DONE** (2026-09-05) - commit 2f67fdc, branch gap-wave-5. Verification: jest 24 suites 574 tests PASS plus downstream 26 suites 700 tests; neutering the guard gives 300000 where 700000 is expected. Also closes the balanceAfter hazard GAP-012 flagged, with one residual noted

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-010 (same file `wallets_repo.ts`; run after) |
| Blocks | GAP-047 (same file `transactions_repo.ts`) |
| Est. agent turns | 3-5 |

**Location**
- `mobile/lib/db/repos/transactions_repo.ts:103` ("NOT IMPLEMENTED HERE: spec rule 9's second half")
- `mobile/lib/db/repos/wallets_repo.ts:268-271` (comment admitting a late older notification re-anchors)
- `docs/04-features/02-wallets.md:109`

**Evidence**
`wallets_repo.ts:269-270`: "rule 9's out-of-order suppression is not implemented (see `insertTransaction`), so a late-arriving older notification does re-anchor the Wallet".

**What is wrong**
A delayed SMS carrying an older balance-after overwrites a newer snapshot. The drift explainer then describes a stale figure.

**Why it matters**
Bank wallets show a wrong balance until the next notification; the drift card may fire against a stale anchor.

**Intended behavior**
docs/04-features/02-wallets.md rule 9: out-of-order arrivals snap only if the notification timestamp is newer than the current snapshot's.

**Proposed fix**
Keep the snapshot's `posted_at` on the wallet (a column exists for the reporting transaction via migration 003; reuse `drift_dismissed_transaction_id`'s neighbour or read the reporting transaction's `occurred_at`) and skip the snap in `insertTransaction` when the incoming `occurredAt` is older.

**Implementation checklist**
- [ ] In `mobile/lib/db/repos/transactions_repo.ts` `insertTransaction`, before snapping, read the wallet's current reporting transaction's `occurred_at` and skip when the incoming is older.
- [ ] In `mobile/lib/db/repos/wallets_repo.ts:268-271`, update the comment.
- [ ] Add a test: newer snap, then older notification with balance-after, wallet keeps the newer balance.

**Acceptance criteria**
- [ ] The test above passes; existing snap tests pass.

**Verification commands**
```bash
cd mobile && npm test -- lib/db/repos lib/wallets
cd mobile && npm run typecheck
```

**Do not**
Do not add a migration; read the existing reporting transaction. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none

### GAP-033 [FEAT] Confirming a loan payment match creates no UserRule

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-029 (same file `loans_service.ts`; run after) |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/lib/loans/loans_service.ts:96-112` (`SIGNAL_WEIGHT` has counterparty, amount, timing, wallet only)
- `mobile/lib/loans/loan_match_queue.ts:45` (`loan-match` kind, confirm path)
- `docs/04-features/06-loans.md:64-66`, `:95-97`

**Evidence**
`git grep -n -i "userrule\|auto-\?match\|stop suggesting" mobile/lib/loans` returns nothing outside comments. Doc flow line 66: "A confirmed match creates a UserRule."

**What is wrong**
Every payment is a suggestion forever; repeat payments to the same counterparty never gain confidence, and the doc's "stop suggesting this merchant" prompt does not exist.

**Why it matters**
The Review Queue fills with the same monthly GLoan payment card the user already confirmed last month.

**Intended behavior**
docs/04-features/06 rule 8 signal (b): an existing UserRule from a prior confirmation raises the score to auto-match; rule 10: a rejection can suppress the merchant.

**Proposed fix**
On confirm in `loan_match_queue`, write a user rule `{ matcher: { merchantPattern }, action: { kind: "mark-loan-payment", loanId } }` (new action kind in `types/domain.ts`) and give it top weight in `scoreCandidate`. Follow the `mark-transfer` precedent (docs/09 §2b.4).

**Implementation checklist**
- [ ] In `mobile/types/domain.ts`, add the `mark-loan-payment` action variant.
- [ ] In `mobile/lib/db/repos/user_rules_repo.ts`, decode the new kind strictly.
- [ ] In `mobile/lib/loans/loan_match_queue.ts` confirm path, insert the rule inside the same unit of work.
- [ ] In `mobile/lib/loans/loans_service.ts` `scoreCandidate`, load matching rules and add a `rule` signal weighted to reach the auto-match floor.
- [ ] Tests: confirm creates one rule; the next payment from the same merchant auto-matches; a second confirm does not create a second rule.

**Acceptance criteria**
- [ ] Second month's payment for the same counterparty links without a card.

**Verification commands**
```bash
cd mobile && npm test -- lib/loans lib/db/repos
cd mobile && npm run typecheck
```

**Do not**
Do not add provider loan-event templates (ingest concern). Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert; rules of the new kind are ignored by older decoders if decoding is strict (decode failure must skip, not throw; confirm in `user_rules_repo.ts:84`).

**Open questions**
none

### GAP-034 [CODE] A key-state read failure leaves the user on an unlock screen with no wipe route

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D3 Specialist |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | GAP-030 (same file; run after) |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/contexts/lock_context.tsx:188` (`.catch(() => ...)` maps any `getKeyState()` failure to "locked" with a generic message)
- `mobile/app/lock.tsx`; `mobile/components/lock/recovery_unlock_form.tsx` (the wipe branch lives here)
- `docs/12-encryption-and-app-lock.md` §11a
- `mobile/contexts/__tests__/lock_context.test.tsx:173` (cold-start happy path only)

**Evidence**
A persistent SecureStore failure (seen on some OEM Keystore states) shows an Unlock button whose unwrap then fails with "Something went wrong" forever; the wipe affordance exists only in the `needs_recovery` status.

**What is wrong**
docs/12 §11a rejects exactly this outcome: a bricked app whose only escape is uninstalling.

**Why it matters**
Rare, but the user cannot even start over without losing the notification-access grant.

**Intended behavior**
Any unrecoverable key-state error routes to the §11a screen: explanation plus wipe-and-start-over.

**Proposed fix**
Map a rejected `getKeyState()` to a new `storage_error` status that renders `RecoveryUnlockForm`'s wipe branch with a storage-specific message.

**Implementation checklist**
- [ ] In `mobile/contexts/lock_context.tsx:188`, distinguish rejection from a `locked` result and set status `storage_error`.
- [ ] In `mobile/app/lock.tsx`, render the recovery form's wipe branch for `storage_error`.
- [ ] Add a lock_context test for the rejection branch and a lock screen test for the new status.

**Acceptance criteria**
- [ ] With `getKeyState` rejecting, the screen offers wipe-and-start-over.

**Verification commands**
```bash
cd mobile && npm test -- contexts app/__tests__/lock components/lock
cd mobile && npm run typecheck
```

**Do not**
Do not auto-wipe. Do not change key_manager. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none (AGENT-ASSISTED: crypto reviewer confirms the wipe is offered only when the store is genuinely unreadable)

### GAP-035 [CODE] A capture with no notification key falls back to id-only replay detection

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-011 (same repo file; run after) |
| Blocks | none |
| Est. agent turns | 2-4 |

**Location**
- `mobile/lib/db/repos/raw_notifications_repo.ts:271-272` (`if (notificationKey === null) return null;`)
- `mobile/lib/ingest/pipeline.ts:290`, `:859`
- `mobile/lib/db/repos/__tests__/raw_notifications_repo.test.ts:284` ("findReplayCapture ignores a capture with no slot key")

**Evidence**
The replay guard added by PR #33 keys on `sbn.key`. Records buffered before migration 018, or any capture the native side delivers without a key, fall back to id-only matching, and an edited notification redelivered under a new id raises a fresh card again.

**What is wrong**
The 2026-09-01 fix has a hole for exactly the captures that predate it. C2 because the native side always sets the key today; the hole is the buffered backlog and defensive coverage.

**Why it matters**
Duplicate cards return for old buffered captures after the update installs.

**Intended behavior**
"Cannot tell" behaves as before (the handoff's rule), but a same-package, same-text capture inside the twin window with a null key is a strong enough signal to treat as a redelivery, while genuine identical purchases are still protected by the `posted_at` window and dedupe rule 4.

**Proposed fix**
When `notificationKey` is null, match on `package_name`, the four text fields and `posted_at` within `dedupeTwinWindowMs`.

**Implementation checklist**
- [ ] In `mobile/lib/db/repos/raw_notifications_repo.ts` `findReplayCapture`, add the null-key fallback query.
- [ ] Update the test at `:284` to assert the fallback, and add a case where identical text with a different `posted_at` outside the window is not a replay.

**Acceptance criteria**
- [ ] Null-key redelivery inside 180 s with identical text is a replay; identical text 10 minutes later is not.

**Verification commands**
```bash
cd mobile && npm test -- lib/db/repos lib/ingest
cd mobile && npm run typecheck
```

**Do not**
Do not match on text when a key is present. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none

### GAP-036 [FEAT] Archiving a wallet does not list linked goals, loans or income sources

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-022 decision (label wording) |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/components/wallets/archive_wallet_sheet.tsx:8-30` (states only two consequences)
- `docs/04-features/02-wallets.md:89`, `:121`; `docs/04-features/05-goals-savings.md:95`

**Evidence**
Grep for `linkedWallet|linked_wallet|sourceWallet` across `mobile/app/wallet` and `mobile/components/wallets` returns nothing. C2 because the sheet body was not read in full.

**What is wrong**
A goal linked to an archived wallet keeps reading a frozen balance with no "paused" explanation; loan matching loses its wallet signal silently.

**Why it matters**
Goal progress stops moving and the user does not know why.

**Intended behavior**
Doc line 89: the confirmation lists linked goals, loans and income sources and asks the user to relink or accept pausing.

**Proposed fix**
Query `goals_repo`, `loans_repo` and the income profile sources for the wallet id and render an impact list in the sheet before confirm.

**Implementation checklist**
- [ ] Add `listGoalsForWallet`, `listLoansForWallet` reads if absent in the repos.
- [ ] In `mobile/components/wallets/archive_wallet_sheet.tsx`, render the impact list.
- [ ] Test: a wallet backing a goal shows the goal name in the sheet.

**Acceptance criteria**
- [ ] The sheet names every linked goal, loan and income source.

**Verification commands**
```bash
cd mobile && npm test -- components/wallets
cd mobile && npm run typecheck
```

**Do not**
Do not block archiving. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none

### GAP-037 [FEAT] Manual income override never gets the 20 percent divergence suggestion

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-004 (same file; run after) |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/lib/income/income_service.ts:325-327` (`hasPendingSuggestion` only for provisional)
- `mobile/lib/income/cadence_detector.ts:45` (the only `0.2` is a confidence constant)
- `docs/04-features/04-income.md:49`, `:107`, `:161`

**Evidence**
Doc rule 14: a suggestion card is raised when detected `averageAmount` diverges from the declared amount by more than 20 percent, or a different cadence reaches confirmed. No divergence logic exists.

**What is wrong**
A user who declared income manually never sees "your pay seems to have changed".

**Why it matters**
Percent-of-income limits stay anchored to a stale declaration.

**Intended behavior**
Doc rule 14 and AC line 161.

**Proposed fix**
In the summary builder, when `isManualOverride`, compare the latest confirmed detection's `averageAmount` with the declared amount and set `hasPendingSuggestion` at more than 20 percent divergence or on a confirmed cadence change; reuse the existing suggestion sheet.

**Implementation checklist**
- [ ] In `mobile/lib/income/income_service.ts`, add the divergence check to the summary path.
- [ ] Add tests for 19 percent (no suggestion), 21 percent (suggestion), cadence change (suggestion).

**Acceptance criteria**
- [ ] The three tests pass; the existing suggestion sheet renders for the override case in the income screen test.

**Verification commands**
```bash
cd mobile && npm test -- lib/income
cd mobile && npm run typecheck
```

**Do not**
Do not overwrite the manual values. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none

### GAP-038 [FEAT] Goals have no Complete action; the card copy promises one

> **REMEDIATION: DONE** (2026-09-05) - commit a0f90a1, branch gap-wave-5. Verification: same suites PASS; five new tests fail when neutered. No migration: goals has one retirement column, so a completed goal is indistinguishable from a deleted one without completed_at (GAP-055)

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | GAP-055 (same repo file) |
| Est. agent turns | 3-5 |

**Location**
- `mobile/app/(tabs)/plan/goals/[id].tsx:86`, `:95`, `:39` (Edit and Delete only; delete is a restorable archive)
- `mobile/components/goals/goal_card.tsx:233` ("Move the date, lower the target, or complete it anyway.")
- `mobile/lib/db/repos/goals_repo.ts:276`, `:299`
- `docs/04-features/05-goals-savings.md:19`, `:73-74`; rule 19

**Evidence**
The card offers "complete it anyway"; the detail screen has no complete handler. The doc's "delete" is now a restorable archive (migration 016) and the doc does not say so.

**What is wrong**
A reached goal stays in the live list until deleted.

**Why it matters**
The goals list fills with achieved goals and the card's own copy is a dead promise.

**Intended behavior**
Doc line 73: Complete moves the goal to a completed list with history retained.

**Proposed fix**
Add a "Mark complete" action that sets `archived_at` with a `completed` reason (a small JSON note if no column) and show completed goals in the existing archived section; update rule 19 to describe soft delete with restore.

**Implementation checklist**
- [ ] In `mobile/lib/db/repos/goals_repo.ts`, add `completeGoal(id, now)` reusing `archived_at` and a `completed_at` setting in the goal's JSON if present, else archive with a note.
- [ ] In `mobile/app/(tabs)/plan/goals/[id].tsx`, add the action when progress is at or past target.
- [ ] In `mobile/components/plan/archived_section.tsx`, label completed goals distinctly.
- [ ] Update `docs/04-features/05-goals-savings.md` rule 19.
- [ ] Tests for the action and the label.

**Acceptance criteria**
- [ ] A goal at 100 percent shows Mark complete; after tapping, it appears under Completed.

**Verification commands**
```bash
cd mobile && npm test -- app/__tests__/goal components/goals lib/db/repos
cd mobile && npm run typecheck
```

**Do not**
Do not add a migration here (GAP-055 will add goal columns; coordinate). Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none

### GAP-039 [TEST] Encryption ship gates in docs/13 Parts 4, 5 and 8 are still NOT RUN

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D3 Specialist |
| Risk | R1 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 0 (device session; an agent can prepare the build) |

**Location**
- `docs/13-on-device-verification.md:47-51` (Session 1 rows), `:672-684` (Part 4, all six boxes blank), `:686-693` (Part 5: remove screen lock, enroll fingerprint), `:839` (Part 8)
- `mobile/lib/db/database.ts:286-292`, `:313-333` (raw key literal, no cipher PRAGMAs)

**Evidence**
Latest block is Session 2 (2026-08-15): Gate A 3,351 ms, Gate B 4,920 ms, Keystore suite 10 of 10. Never run: the database file rejected by a plain sqlite3 client, re-lock after six minutes, screen-lock removal recovery, fingerprint enrollment survival. The instrumented suite proves `isInvalidatedByBiometricEnrollment == false` is set; only a real enrollment proves Android honours it.

**What is wrong**
The two claims the encryption story rests on ("the file on disk is ciphertext", "adding a fingerprint does not destroy the ledger") have no measured result.

**Why it matters**
docs/13 says one of them "disproportionately" blocks release: if enrollment invalidates the key, every user loses their history on a routine settings change.

**Intended behavior**
Each box in Parts 4, 5 and 8 holds an observed value.

**Proposed fix**
One device session following docs/13's order with the existing scripts under `mobile/scripts/device/`. Record results in place; supersede stale rows with a dated note as Session 2 did.

**Implementation checklist**
- [ ] Owner builds `APP_VARIANT=preview` and installs on the A54 per `docs/build-variants-adb-install.md`.
- [ ] Run Part 4 lines 1 to 6 and record values in `docs/13-on-device-verification.md`.
- [ ] Run Part 5 (remove screen lock, recover with phrase; enroll a second fingerprint, confirm unlock) and record.
- [ ] Run Part 8 and record.
- [ ] Add a Session 3 block at the top of docs/13 summarising results.

**Acceptance criteria**
- [ ] No blank box remains in Parts 4, 5 and 8.

**Verification commands**
```bash
# device session; see docs/13 runbook. Kotlin unit tests:
# confirm task name first: cd mobile/android && ./gradlew projects
```

**Do not**
Do not change Argon2id parameters or key flags based on a single reading. Do not screenshot the phrase screen (docs/13 Rule 0).

**Rollback**
n/a

**Open questions**
1. Device time from the owner. HUMAN-FIRST.

### GAP-040 [CODE] The drain-to-store loop is not one transaction; a kill mid-loop loses the rest of the batch

> **REMEDIATION: DONE** (2026-09-04) - commit 4f8774a + 7c0d255, branch gap-wave-3. Verification: jest lib/ingest+review+db 33 suites 925 tests PASS. Follow-up 7c0d255 fixes a pre-existing chain poisoning the atomic store made likelier

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-012 (same file; run after) |
| Blocks | GAP-048 |
| Est. agent turns | 2-4 |

**Location**
- `mobile/lib/ingest/pipeline.ts:810` (drain), `:853-864` (per-capture stores with three awaits each, no `withUnitOfWork`), `:13-15`, `:769-773` (comments)
- `mobile/lib/ingest/__tests__/pipeline.test.ts:1071` (crash after the loop only)

**Evidence**
`drainPendingCaptures()` empties the native buffer; the JS array is then the only copy of up to 500 captures while the loop performs separate autocommit inserts.

**What is wrong**
An OEM kill during the loop loses every capture not yet stored. The native ack happens before the JS write, so the window is at-most-once.

**Why it matters**
After a long offline period, some buffered notifications vanish with no trace. C2 because the loop is short and the kill has to land inside it.

**Intended behavior**
The stored batch is atomic; a kill loses nothing or everything, and "everything" is recoverable only with a native peek-then-ack (GAP-051's territory).

**Proposed fix**
Wrap the store loop in `withUnitOfWork` so it is one SQL transaction. Peek-then-ack on the native side is a follow-up under GAP-051.

**Implementation checklist**
- [ ] In `mobile/lib/ingest/pipeline.ts`, wrap the store loop (853-864) in `withUnitOfWork`.
- [ ] Update the comment at 769-773 to be true.
- [ ] Add a test that a throw mid-loop leaves zero stored rows from that batch.

**Acceptance criteria**
- [ ] Test passes; `pipeline.test.ts:1071` passes.

**Verification commands**
```bash
cd mobile && npm test -- lib/ingest
cd mobile && npm run typecheck
```

**Do not**
Do not change the native drain. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none

### GAP-041 [CODE] Rollover carryover is zero when the previous period wrote no alert state

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/lib/limits/limit_service.ts:130-154` (`carriesForward = limit.rollover && existing !== null && existing.periodStart === previous.start`)
- `mobile/lib/limits/limit_ledger_subscriber.ts:68` (recompute on ledger commit); `limit_service.ts:190` (state also persisted when statuses are read)
- `docs/04-features/03-limits.md:91`, `:153`

**Evidence**
The alert-state row for period N-1 exists only if a recompute or a status read happened during N-1. A daily limit on a day the app was not opened and no transaction landed, or a weekly limit over a quiet week with the app closed, yields no row and carryover 0, the opposite of the AC's zero-spend example.

**What is wrong**
Untouched headroom that rule 14 says carries in full is dropped when nothing ran during the previous period. C2 because status reads also persist state, so the app must be unopened for the whole period.

**Why it matters**
A user who spent nothing in a quiet week loses the rollover the feature exists for.

**Intended behavior**
Rule 14: carryover(N) = clamp(base(N-1) - spend(N-1), 0, base(N)) regardless of whether state was stored.

**Proposed fix**
When `existing` is null or older than `previous.start` and rollover is on, compute `prevSpend` for the previous window and use `baseFor(previous)` as the previous base instead of requiring a stored row.

**Implementation checklist**
- [ ] In `mobile/lib/limits/limit_service.ts` `resolveState`, replace the `existing.periodStart === previous.start` requirement with a computed previous base when the row is missing.
- [ ] Add a test: no state row for N-1, zero spend in N-1, rollover on, effective limit in N equals base plus base (clamped).

**Acceptance criteria**
- [ ] The doc's June zero-spend to July ₱16,000 example passes with no June state row.

**Verification commands**
```bash
cd mobile && npm test -- lib/limits
cd mobile && npm run typecheck
```

**Do not**
Do not change rollover clamping in `limit_engine.ts`. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none

### GAP-042 [CODE] Group summary notifications are captured alongside their children

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D3 Specialist |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | HUMAN-FIRST |
| Depends on | GAP-050 (same Kotlin file; run after) |
| Blocks | none |
| Est. agent turns | 2-4 plus device verification |

**Location**
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/PeraPlanoNotificationListenerService.kt:209-236` (`extractCapture`), `:249` (only `isOngoing` is dropped)
- `git grep -n -i "GROUP_SUMMARY\|isGroup" mobile/modules` returns nothing
- `docs/03-ingest-pipeline.md:66` (grouped/summary failure mode)

**Evidence**
`extractCapture` reads title, text, sub-text and big-text and drops only blank captures; `handlePosted` drops only ongoing notifications.

**What is wrong**
Apps that post a group summary plus children deliver two or more notifications for one event with different keys, so the replay guard does not match them and each becomes its own capture. Whether PH bank apps do this was not verified (C2).

**Why it matters**
A possible-duplicate card per grouped transaction, or two rows if the summary text parses.

**Intended behavior**
Summary notifications (`FLAG_GROUP_SUMMARY`) are skipped when the app also posts children; the doc's own failure-mode row expects "parser templates for group summaries where feasible; otherwise low confidence".

**Proposed fix**
In `handlePosted`, drop notifications with `Notification.FLAG_GROUP_SUMMARY` set, record the package in observed packages as today, and log a count. Verify on device against GCash and BPI.

**Implementation checklist**
- [ ] In `PeraPlanoNotificationListenerService.kt` `handlePosted`, add `if (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return` after the ongoing check.
- [ ] Add a JVM test in `PeraPlanoNotificationListenerServiceTest.kt` with a summary-flagged notification asserting no append.
- [ ] Owner verifies on the A54 that a grouped bank notification yields one capture.

**Acceptance criteria**
- [ ] JVM test passes; device check recorded in docs/13.

**Verification commands**
```bash
# confirm task name first: cd mobile/android && ./gradlew projects
```

**Do not**
Do not filter on group key alone (children carry it too). Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert; native rebuild required.

**Open questions**
1. Which PH provider apps post summaries? Needs the device. HUMAN-FIRST.

### GAP-043 [CONTRA] Ruleset integrity verification and staged rollout are promised and absent

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | L |
| Difficulty | D4 Judgment |
| Risk | R3 |
| Confidence | C1 Verified |
| Priority score | 0.71 |
| Agent suitability | HUMAN-FIRST |
| Depends on | GAP-014 |
| Blocks | none |
| Est. agent turns | 8-12 after the decision |

**Location**
- `mobile/services/parser_rules.ts:58-83`, `:153`; `docs/03-ingest-pipeline.md:325-331`

**Evidence**
See the Contradiction Register entry for GAP-043.

**What is wrong**
The app trusts TLS to a host the owner controls and nothing else. No signature, no staged rollout, no rollback.

**Why it matters**
The ruleset channel is the one thing that changes parsing without a store release; a compromised server rewrites every user's ledger rules at once.

**Intended behavior**
docs/03 §11.2 rules 2 and 4.

**Proposed fix**
Decision brief in section 8; recommended Ed25519 signature with the public key in the app.

**Implementation checklist**
- [ ] Owner chooses the integrity mechanism and where the signing key lives.
- [ ] Add the public key constant and a verify step before `safeParse` in `mobile/services/parser_rules.ts`.
- [ ] Add a device-side rollout bucket (hash of a random per-install salt, never sent) and a `rollout_percent` field in the bundle schema (GAP-014 schema).
- [ ] Add a `previous_version` keep in `parser_rulesets_repo.ts` so a rollback is a local switch.
- [ ] Tests for bad signature, wrong key, bucket outside percent.
- [ ] Update docs/03 §11.2 to describe the shipped mechanism.

**Acceptance criteria**
- [ ] An unsigned or mis-signed bundle is discarded before parsing.

**Verification commands**
```bash
cd mobile && npm test -- services
cd mobile && npm run typecheck
```

**Do not**
Do not ship a private key in the app. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert; older clients ignore the signature field.

**Open questions**
1. Signature scheme and key custody. RESOLUTION: HUMAN REQUIRED.

### GAP-044 [OPS] Migrations are forward-only with no guard for an older build opening a newer database

> **REMEDIATION: DONE** (2026-09-05) - commit acd1204, branch gap-wave-5. Verification: jest lib/db/migrations 34 tests PASS; removing the guard fails exactly the 3 refusal tests while the fresh-install and equal-version guards pass either way. Reviewer points confirmed: fresh install not refused, recovery screen offers no futile retry

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | L |
| Difficulty | D2 Standard |
| Risk | R4 |
| Confidence | C1 Verified |
| Priority score | 0.71 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | none |
| Blocks | GAP-056, GAP-057 (migration-bearing gaps should land after the guard) |
| Est. agent turns | 5-8 |

**Location**
- `mobile/lib/db/migrations.ts:139-165` (`runMigrations`: applies pending only; never compares the stored max version with `MIGRATIONS` max)
- `mobile/lib/db/migrations/014_drop_wallet_type.sql` (a rebuild an older build cannot survive)
- `mobile/lib/db/database.ts` open path

**Evidence**
`runMigrations` reads `schema_migrations`, sorts the registry, filters out applied versions and runs the rest. A database at version 18 opened by a build whose registry ends at 13 applies nothing and proceeds; that build's `wallets_repo` then selects `type`, which migration 014 dropped.

**What is wrong**
There are no down migrations (acceptable for SQLite) and no forward guard. With EAS Update channels now configured (PR #32), an OTA rollback to an older JS bundle on a device whose database is newer is a realistic path, and the result is a crash on the first wallet query or silent misreads on additive columns.

**Why it matters**
Beta installs carry real ledgers. A rollback that bricks the app on open is the recovery-destroys-data case the rubric rates S1; scored S2 because the ledger file itself is untouched and a re-upgrade recovers it.

**Intended behavior**
Opening a database whose max applied version exceeds the build's registry refuses with a clear "update the app" screen instead of running.

**Proposed fix**
In `runMigrations`, compute `maxApplied` and throw `SchemaTooNewError(maxApplied, registryMax)` when it exceeds the registry; catch it in bootstrap and render the existing recovery screen with a "this build is older than your data" message. Document the rule "never roll an OTA back across a migration" in the OTA runbook (GAP-028).

**Implementation checklist**
- [ ] In `mobile/lib/db/migrations.ts`, add the `SchemaTooNewError` class and the check before applying pending migrations.
- [ ] In `mobile/lib/bootstrap.ts`, let the error propagate to the root layout's recovery state with a specific message.
- [ ] In `mobile/app/_layout.tsx` recovery branch, render the message and a "Check for updates" action.
- [ ] Add tests in `mobile/lib/db/__tests__/migrations.test.ts`: stored version 19 with registry max 18 throws and applies nothing.
- [ ] Add the rule to `docs/OTA_RUNBOOK.md` (created by GAP-028) and to the migrations registry header comment.

**Acceptance criteria**
- [ ] Opening a newer database on an older build shows the message and does not run any SQL beyond the version read.

**Verification commands**
```bash
cd mobile && npm test -- lib/db
cd mobile && npm run typecheck
```

**Do not**
Do not write down migrations. Do not change any existing migration file. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert the commit. An existing beta install that has already migrated is unaffected; the guard only adds a refusal path.

**Open questions**
none (AGENT-ASSISTED because a reviewer must confirm the recovery screen wording and that the guard cannot trigger on a fresh install)

### GAP-045 [DOC] Feature docs still describe the wallet type enum and other retired shapes

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-022, GAP-023 decisions |
| Blocks | none |
| Est. agent turns | 4-8 |

**Location**
- `docs/04-features/02-wallets.md:1`, `:38`, `:46`, `:101`, `:131`, `:164` (five-value `type` enum; migration 014 dropped it; `mobile/lib/db/repos/wallets_repo.ts:78` INSERT has no type column)
- `docs/04-features/05-goals-savings.md:79`, `:131` and `02-wallets.md:19`, `:122` (savings-type requirement; `goals_repo.ts:103-115` checks existence only)
- `docs/04-features/03-limits.md:36-46` (no derived limits section; `limit_derivation.ts`)
- `docs/04-features/02-wallets.md:183` (drift tolerance listed as open; it is `tunables.balanceDriftToleranceCentavos`, `wallets_repo.ts:254-257`)
- `docs/04-features/07-bills.md:44`, `:50`, `:110` (keyword set; code is one substring, `bills_service.ts:279-283`)
- `docs/04-features/10-reports.md:86-89`, `:100-118` (CSV columns and file name; `csv_export.ts:29-45`, `:156`, `:313`)
- `docs/06-information-architecture.md:74-75`, `:127` and `10-reports.md:70-71` (Recurring lives at `/more/subscriptions`)
- `docs/02-domain-model.md:20` (money glossary), `:378`, `:384`, `:491` (15th and 30th; code uses the last calendar day, `due_rules.ts:93-96`)
- `docs/04-features/01-onboarding.md:67` (says steps 3 to 5 are not built; `ONBOARDING_STEPS` has all nine)
- `docs/09-v2-backlog.md:277` (says the three notifiers are unwired; fixed the same day in `d20f004`)

**Evidence**
Each pair above was opened; the doc line and the code line disagree.

**What is wrong**
Ten places where a Draft v1 doc describes a shape the code retired, most of them the wallet `type` enum and its consequences. A reader implementing from the docs would re-add `type`, the savings-only goal wallet, and a `timestamp` CSV column.

**Why it matters**
docs are the intent baseline for every agent in this queue.

**Intended behavior**
The docs describe inferred wallet traits (`docs/superpowers/specs/2026-08-27-wallet-trait-inference-design.md`), derived limits, the shipped CSV header, the subscriptions route, integer centavos, katapusan as the last calendar day, and the current onboarding and alert state.

**Proposed fix**
One doc pass with dated amendment notes, after GAP-022 and GAP-023 decide the wallet wording and the Free cap rule.

**Implementation checklist**
- [ ] Rewrite `docs/04-features/02-wallets.md` purpose, create and edit flows, rule 1, data touched and AC to traits; fix line 183 to name the tunable.
- [ ] Rewrite `docs/04-features/05-goals-savings.md` rule 2 and AC line 131 to "any active wallet, one live goal per wallet".
- [ ] Add a "Derived limits" subsection to `docs/04-features/03-limits.md` citing `limit_derivation.ts:131-136` constants.
- [ ] Update `docs/04-features/07-bills.md` rule 13 to one merchant pattern.
- [ ] Update `docs/04-features/10-reports.md` CSV table and rules 12 to 13 to the shipped header, or restore the range in the filename at `csv_export.ts:313` (recommend the one-line code change plus doc update).
- [ ] Move Recurring to "More, Subscriptions" in `docs/06-information-architecture.md` and `10-reports.md` Flow E.
- [ ] In `docs/02-domain-model.md`, define `money` as integer centavos and reword the two "15th and 30th" lines.
- [ ] In `docs/04-features/01-onboarding.md:67`, replace the "not built" paragraph with the shipped nine-step order.
- [ ] In `docs/09-v2-backlog.md:277`, add "(wired on 2026-08-30 in d20f004)".

**Acceptance criteria**
- [ ] `grep -n "bank · e-wallet · cash · credit · savings" docs/04-features/02-wallets.md` returns nothing.
- [ ] Each edited section carries a dated amendment note.

**Verification commands**
```bash
cd mobile && npm test -- lib/reports
cd server && npm run lint
```

**Do not**
Do not change code other than the optional CSV filename line. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none once GAP-022 and GAP-023 are decided

### GAP-046 [PROJ] Repository hygiene: merged branches, version mismatch, stale root handoff, duplicated docs, no dependency bot

| Field | Value |
|---|---|
| Severity | S4 Minor |
| Complexity | S |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-027 decision (for the CLAUDE.md rule) |
| Blocks | none |
| Est. agent turns | 2-4 |

**Location**
- `git branch --merged master`: 20 local branches already merged (feat/mvp-implementation, feat/mobile-ui-revamp, worktree-* and others); 24 remote branches merged into origin/master
- `mobile/package.json:3` (`"version": "1.0.0"`) versus `mobile/app.json:5` (`"version": "0.1.0"`) and `server/package.json:4` (`0.1.0`)
- `HANDOFF.md` (root, dated 2026-08-18, describes branch `feat/mvp-implementation` and a 3,313-test suite)
- `docs/pera-plano-mobile/uploads/11-mobile-app-design-prompt.md` and `docs/pera-plano-web/uploads/10-web-design-prompt.md` (copies of `docs/11` and `docs/10`)
- No `.github/dependabot.yml`; no root `CLAUDE.md`; `mobile/package.json` has no `lint` script and no ESLint config (server has both)

**Evidence**
Listed by `git branch`, `git ls-files docs`, and the package files. The prompt asked whether the lint asymmetry is deliberate: the 2026-09-01 handoff records "The repo has NO eslint config and NO prettier config. Lint is not a gate here", so it is a known choice, but nothing in the repo says so.

**What is wrong**
None of these breaks a build. Together they cost every new agent a few wrong turns: a stale handoff at the root, a version field nobody reads, branches that look live, and no written convention to point at.

**Why it matters**
GAP-027 and this queue both need a place to record repo rules.

**Intended behavior**
Merged branches deleted; one version source; the root handoff removed or marked historical; the upload copies removed; Dependabot configured for `mobile`, `server` and `scripts/beta_invites`; a root `CLAUDE.md` recording the naming rule, the no-lint choice, the worktree flow and the "never edit a shipped migration" rule.

**Proposed fix**
One housekeeping PR.

**Implementation checklist**
- [ ] Delete every local and remote branch listed by `git branch --merged master` and `git branch -r --merged origin/master` except `master` and the two locked worktree branches.
- [ ] Set `mobile/package.json` `version` to `0.1.0` to match `app.json`, or document that only `app.json` is read.
- [ ] Move `HANDOFF.md` to `docs/superpowers/notes/2026-08-18-handoff.md` with a "historical" header.
- [ ] Delete the two `uploads/` copies and point any link at the canonical docs.
- [ ] Add `.github/dependabot.yml` for npm in `/mobile`, `/server`, `/scripts/beta_invites` and GitHub Actions, weekly.
- [ ] Add root `CLAUDE.md` with: identifier convention (from GAP-027), no ESLint in mobile by choice, worktree flow, migration rule, no AI attribution.

**Acceptance criteria**
- [ ] `git branch --merged master | grep -v master | wc -l` prints 2 or fewer.
- [ ] `CLAUDE.md` exists at the root and names the four rules.

**Verification commands**
```bash
cd mobile && npm run typecheck
cd server && npm run lint
```

**Do not**
Do not delete `worktree-ai-hosting-decision` or `worktree-limits-wiring-device-harness-0830` (unmerged, locked worktrees). Do not add ESLint to mobile in this gap. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Branches can be restored from the reflog within the retention window; everything else is a revert.

**Open questions**
none once GAP-027 is decided

### GAP-047 [CODE] Income windows and the history floor are measured in milliseconds from now rather than local days

| Field | Value |
|---|---|
| Severity | S4 Minor |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-032 (same file `transactions_repo.ts`) |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/lib/income/income_math.ts:95-97` (`now - IRREGULAR_WINDOW_DAYS * DAY_MS`)
- `mobile/lib/income/cadence_detector.ts:133`, `:277-279`, `:292-293` (120-day window the same way; open kinsenas window counted as unmatched at `:161-168`)
- `mobile/lib/income/income_service.ts:108-111`, `:206-209` (lapse = floor(elapsedDays / 15) rather than closed windows)
- `mobile/lib/db/repos/transactions_repo.ts:60-63` (`historyFloor` calls `Date.now()` inside a repository, against the rule in `mobile/lib/clock.ts:12-14`)

**Evidence**
Node probe: with now = Sep 4 09:00, the 90-day cutoff is Jun 6 09:00, so a Jun 6 08:00 credit is excluded and a Jun 6 10:00 credit included. Every other window in the app is a local-day boundary. Lapse: last credit Aug 12, spec lapses Sep 19, code lapses Sep 11.

**What is wrong**
Four small seams with one root cause: instants where the rest of the app uses days. Minor on their own; GAP-004 removes the mid-period consequence.

**Why it matters**
"Why did my income figure change at 10:01" is unanswerable; the "we haven't seen your usual pay" prompt fires eight days early; a Free-tier fixture in tests goes invisible after 90 real days.

**Intended behavior**
Windows anchored to local midnight via `startOfLocalDay`; lapse counted in closed expected windows; `listTransactions` takes `now` from its caller.

**Proposed fix**
Anchor the two windows with `startOfLocalDay(now) - N * DAY_MS`; count kinsenas lapses via `kinsenasAnchorsBetween` with the tolerance; score only closed windows in `tryKinsenas`; add an optional `now` to `listTransactions` and compute the floor from it.

**Implementation checklist**
- [ ] In `mobile/lib/income/income_math.ts` and `cadence_detector.ts`, anchor the windows to local midnight; add a boundary-hour test each.
- [ ] In `cadence_detector.ts` `tryKinsenas`, exclude anchors whose window has not closed.
- [ ] In `mobile/lib/income/income_service.ts`, count lapses from closed anchors; add an early-payday fixture test.
- [ ] In `mobile/lib/db/repos/transactions_repo.ts`, add `now` to the options and compute the floor from `startOfLocalDay(now)`; update the three callers (`income_service.ts:137`, `recurring_service.ts:115`, `reports_service.ts:171`).

**Acceptance criteria**
- [ ] A credit at 08:00 and one at 10:00 on the boundary day are treated the same.
- [ ] The lapse test with last credit Aug 12 does not lapse before Sep 19.

**Verification commands**
```bash
cd mobile && npm test -- lib/income lib/db/repos
cd mobile && npm run typecheck
```

**Do not**
Do not change the detection thresholds. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none

### GAP-048 [CODE] The buffered ingest path skips the pause and dismissed-package checks the live path applies

| Field | Value |
|---|---|
| Severity | S4 Minor |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-040 (same file; run after) |
| Blocks | none |
| Est. agent turns | 2-3 |

**Location**
- `mobile/lib/ingest/pipeline.ts:255-257`, `:271-274` (live path checks), `:885-901` (`processStored` has neither), `:785` (pause checked once before the drain)
- `mobile/lib/ingest/__tests__/pipeline.test.ts:548` (live path only)

**Evidence**
Two entry points to the same stages with different pre-checks.

**What is wrong**
A package the user marked "not money" re-queues a card every time the app drains from cold.

**Why it matters**
Exactly the "queue teaches the user to ignore it" failure the file's own comment at 193-195 names.

**Intended behavior**
Both paths apply the same guards.

**Proposed fix**
Extract `preflight(capture, bundle, rules)` and call it from `processCapture` and `processStored`.

**Implementation checklist**
- [ ] In `mobile/lib/ingest/pipeline.ts`, extract the guards into one function used by both paths.
- [ ] Add a test: a dismissed package in the buffered batch raises no card.

**Acceptance criteria**
- [ ] The new test passes; `pipeline.test.ts:548` passes.

**Verification commands**
```bash
cd mobile && npm test -- lib/ingest
cd mobile && npm run typecheck
```

**Do not**
Do not change the stage order. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none

### GAP-049 [CODE] The persisted query cache dehydrates every query, including raw notification text

| Field | Value |
|---|---|
| Severity | S4 Minor |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-013 (same file; run after) |
| Blocks | none |
| Est. agent turns | 2-4 |

**Location**
- `mobile/lib/query_client.ts:116-120` (`persistOptions = { persister, maxAge: Infinity, buster }`, no `dehydrateOptions`)
- `mobile/hooks/queries/use_raw_capture.ts`, `use_raw_captures.ts` (full notification text)

**Evidence**
`git grep -n "dehydrateOptions\|shouldDehydrateQuery" mobile` returns nothing.

**What is wrong**
The AsyncStorage blob is a second full copy of the ledger plus raw text, never expiring. It is encrypted, but GAP-002 shows the codec is the only thing standing between it and plaintext, and a second copy doubles the surface that must stay correct.

**Why it matters**
Blast radius of any cache defect becomes "everything"; the 30-day raw-text purge does not reach this copy.

**Intended behavior**
Only the queries that benefit from an instant cold-start paint are persisted; raw captures never are.

**Proposed fix**
Add `dehydrateOptions.shouldDehydrateQuery` keyed on `meta.persist === true`, set that meta on the home summary and wallets queries, and set a finite `maxAge` (24 h).

**Implementation checklist**
- [ ] In `mobile/lib/query_client.ts`, add `dehydrateOptions` and a 24 h `maxAge`.
- [ ] In `mobile/constants/query_keys.ts` or the chosen hooks (`use_safe_to_spend.ts`, `use_wallets.ts`, `use_limit_statuses.ts`), set `meta: { persist: true }`.
- [ ] Add a test asserting a raw-capture query is not in the dehydrated client.

**Acceptance criteria**
- [ ] The persisted blob contains no `raw_captures` key.

**Verification commands**
```bash
cd mobile && npm test -- lib/__tests__/query_client hooks
cd mobile && npm run typecheck
```

**Do not**
Do not disable persistence entirely (cold-start paint is a stated goal). Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert; bump `CACHE_BUSTER` so old blobs are discarded.

**Open questions**
none

### GAP-050 [CONTRA] No active-notification snapshot catch-up when the listener reconnects

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D3 Specialist |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | GAP-042 |
| Est. agent turns | 4-6 plus device verification |

**Location**
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/PeraPlanoNotificationListenerService.kt:80-84` (`onListenerConnected`)
- `docs/03-ingest-pipeline.md:37`, `:64`, `:379`

**Evidence**
See the Contradiction Register entry for GAP-050.

**What is wrong**
After a reboot or a rebind, notifications still sitting in the shade are never read; docs/13 "reboot survival PASS" proves rebinding only.

**Why it matters**
The one partial recovery the doc offers for OEM kills is missing; everything posted during the gap is lost even when it is still visible on screen.

**Intended behavior**
docs/03 principle 5: on reconnection, read `getActiveNotifications()` and feed each through `handlePosted`; the replay guard handles the ones already captured.

**Proposed fix**
In `onListenerConnected`, after keys are ensured, iterate `activeNotifications` and call `handlePosted` for each, guarded by the same never-throw wrapper. Verify on device that a notification posted while the service was dead is captured after reboot.

**Implementation checklist**
- [ ] In `PeraPlanoNotificationListenerService.kt` `onListenerConnected`, add the snapshot loop with a try around the array read.
- [ ] Add a JVM test with a fake active list asserting captures append.
- [ ] Owner verifies on the A54: post a test notification, force-stop, reboot, confirm capture.
- [ ] Record the result in docs/13 Session 3.

**Acceptance criteria**
- [ ] JVM test passes; device result recorded.

**Verification commands**
```bash
# confirm task name first: cd mobile/android && ./gradlew projects
```

**Do not**
Do not read notifications outside the provider filter (shouldCapture still applies). Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert; native rebuild.

**Open questions**
1. Device verification. HUMAN-FIRST.

### GAP-051 [OPS] The native capture buffer evicts the oldest capture at 500 with no signal to the user

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D3 Specialist |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 4-6 plus device verification |

**Location**
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureBuffer.kt:69` (`MAX_CAPTURES = 500`), `:120` (evict oldest)
- `mobile/lib/alerts/tracking_health_subscriber.ts:78` (comment: no read-only count exists)
- `docs/09-v2-backlog.md` §2b.6; `docs/03-ingest-pipeline.md:34` (principle 2)

**Evidence**
The buffer is bounded and drops the oldest sealed line silently; `drainPendingCaptures` is destructive and there is no `countPendingCaptures`.

**What is wrong**
A phone that goes a long time without opening the app (docs/13 Gate B sized this at 500 records for a busy user) loses money-like signal with nothing recorded, contrary to principle 2. The backlog already deferred the count API for lack of a device.

**Why it matters**
Silent loss, and the tracking-interrupted notice cannot say how much.

**Intended behavior**
A read-only count and an eviction counter exposed to JS; the health screen shows "N captures dropped since last open".

**Proposed fix**
Add `countPendingCaptures()` and `evictedSinceLastDrain()` (a sealed counter in CapturePrefs) to the module; surface both on the listener-health screen.

**Implementation checklist**
- [ ] In `CaptureBuffer.kt`, count evictions in `append` and expose `size`.
- [ ] In `NotificationListenerModule.kt`, add the two async functions; in `index.ts`, the bindings.
- [ ] In `mobile/app/(tabs)/more/listener_health.tsx`, show the figures.
- [ ] JVM test for the eviction counter; device check that the count survives process death.

**Acceptance criteria**
- [ ] After 501 appends, JVM test reports one eviction; device shows the figure.

**Verification commands**
```bash
# confirm task name first: cd mobile/android && ./gradlew projects
cd mobile && npm test -- modules/notification_listener
```

**Do not**
Do not raise the cap without re-running Gate B. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert; native rebuild.

**Open questions**
1. Device verification. HUMAN-FIRST.

### GAP-052 [TEST] Seven pre-existing flaky UI test failures and one typecheck error on clean master

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C2 Strong |
| Priority score | 0.4 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | none |
| Blocks | GAP-053 |
| Est. agent turns | 6-10 |

**Location**
- `mobile/app/__tests__/bills_screen.test.tsx` (2), `transactions_screen.test.tsx` (2), `home_screen.test.tsx` (1), `review_queue.test.tsx` (the two "filterable by kind" tests), one varying onboarding e2e flake
- `mobile/components/gates/__tests__/gates.test.tsx:91` (`TS2339: Property 'type' does not exist on type 'ReactTestRendererJSON | ReactTestRendererJSON[]'`)
- `mobile/package.json:86-89` (no `TZ` pinned)

**Evidence**
From the 2026-09-01 handoff, which ran the full suite twice against `ef4c578` and the fix branch: all seven are load-sensitive `waitFor` tests that pass in isolation. Not re-run in this session (C2).

**What is wrong**
A suite that is red on clean master trains everyone to re-run, which is how a real failure gets waved through (the root `HANDOFF.md` said the same on 2026-08-18). The typecheck error makes `npm run typecheck` a non-gate.

**Why it matters**
GAP-053 cannot make CI a gate until the suite is green.

**Intended behavior**
Full suite green on master; typecheck clean; tests deterministic under `TZ=Asia/Manila`.

**Proposed fix**
Fix the seven with condition-based waits and longer per-test timeouts where the screen genuinely renders slowly; fix the type at `gates.test.tsx:91`; pin `TZ` in `jest_setup.ts` so the day-shift class of bug is observable on a UTC runner.

**Implementation checklist**
- [ ] Run `npx jest --ci --json --outputFile=<scratch>` once to get the current failing names.
- [ ] Fix each `waitFor` to wait on a specific element and raise its timeout where the screen is heavy.
- [ ] Fix `gates.test.tsx:91` by narrowing the renderer JSON union.
- [ ] In `mobile/test_support/jest_setup.ts`, set `process.env.TZ = "Asia/Manila"` before any Date use.
- [ ] Re-run the full suite twice and record the counts in the PR.

**Acceptance criteria**
- [ ] Two consecutive full runs report 0 failures; `npm run typecheck` exits 0.

**Verification commands**
```bash
cd mobile && npm test
cd mobile && npm run typecheck
```

**Do not**
Do not weaken assertions or skip tests. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
none (AGENT-ASSISTED because the flake root cause may be machine load and needs a second machine's run to confirm)

### GAP-053 [OPS] No mobile CI workflow exists

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-052 |
| Blocks | none |
| Est. agent turns | 2-4 |

**Location**
- `.github/workflows/` contains `deploy.yml` and `server-ci.yml` only
- `server-ci.yml:1-35` (the pattern to copy)

**Evidence**
No workflow runs `cd mobile && npm test` or `npm run typecheck`; both run only on a developer machine. The suite takes about 25 minutes.

**What is wrong**
Every mobile PR merges unverified by a machine. ORDER OVERRIDE: this entry scores 1.0 but sits after GAP-052 because a red suite makes the gate meaningless.

**Why it matters**
The ledger code has 250 test files and none of them gate a merge.

**Intended behavior**
A `mobile-ci.yml` running typecheck and the Jest suite on pull requests touching `mobile/**`, with a sharded matrix to keep wall time under ten minutes.

**Proposed fix**
Copy the server workflow shape; use `--shard=i/n` with three shards and `--ci`; cache `~/.npm`; upload the JSON report as an artifact.

**Implementation checklist**
- [ ] Create `.github/workflows/mobile-ci.yml` with paths filter `mobile/**` and a three-shard Jest matrix.
- [ ] Add the typecheck job.
- [ ] Add the workflow file itself to the paths filter.

**Acceptance criteria**
- [ ] A PR touching `mobile/` shows the two checks and they pass on master.

**Verification commands**
```bash
cd mobile && npm test
cd mobile && npm run typecheck
```

**Do not**
Do not run Gradle or EAS in CI here. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Delete the workflow.

**Open questions**
none

### GAP-054 [CONTRA] Cloud backup is described as built and Plus-gated; no code exists

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | L |
| Difficulty | D4 Judgment |
| Risk | R3 |
| Confidence | C1 Verified |
| Priority score | 0.29 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2-3 for the doc pass after the decision |

**Location**
- `docs/01-mvp-scope.md:145`; `docs/07-privacy-and-compliance.md:156`; `docs/12-encryption-and-app-lock.md:199-213`; `docs/00-product-brief.md` §5
- `mobile/services/api.ts:11-15`; `mobile/lib/entitlements.ts` `hasBackup()` with no caller

**Evidence**
See the Contradiction Register entry for GAP-054.

**What is wrong**
Four docs describe a feature with zero code, and the privacy notice's lifecycle table carries a row for data that never leaves the device today.

**Why it matters**
The notice must not claim more than the architecture delivers (docs/07 §2.4 rule). Plus is blocked on real-world facts anyway.

**Intended behavior**
Every backup mention marked planned, with the recovery-phrase limitation stated (GAP-015).

**Proposed fix**
Decision brief in section 8.

**Implementation checklist**
- [ ] Owner decides: mark planned now (recommended) or leave.
- [ ] Add "planned, not in MVP" to the tier matrix row in docs/01, 05, 07 and to docs/07 §4 row 6, docs/12 §8 and §9, docs/00 §5.
- [ ] Update the web privacy page if it mentions backup (`server/apps/web/components/pages/privacy_page.tsx`).

**Acceptance criteria**
- [ ] No doc states backup in the present tense.

**Verification commands**
```bash
cd server && npm test
```

**Do not**
Do not build backup. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Revert.

**Open questions**
1. Mark backup as planned across the docs now? RESOLUTION: HUMAN REQUIRED.

### GAP-055 [FEAT] Goal milestone notifications do not exist

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | L |
| Difficulty | D2 Standard |
| Risk | R4 |
| Confidence | C1 Verified |
| Priority score | 0.29 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | GAP-003, GAP-038, GAP-044 |
| Blocks | GAP-056 (migration numbering) |
| Est. agent turns | 8-12 |

**Location**
- `docs/04-features/05-goals-savings.md:59`, `:89`, `:97`
- `git grep -i milestone mobile/lib mobile/components mobile/app` matches only `components/onboarding/value_carousel.tsx` (marketing copy)
- `mobile/lib/alerts/alerts_service.ts` (no goal channel)

**Evidence**
Doc rule 12: milestones fire when progress first crosses 25, 50, 75 and 100 percent, at most once per goal lifetime. Nothing implements it and nothing stores fired milestones.

**What is wrong**
The "Goal updates" channel the privacy doc lists (docs/07 §3.5) has no producer.

**Why it matters**
docs/01 L2-3 lists goals with progress; the celebration moments are absent, and docs/07's channel list overclaims.

**Intended behavior**
Rule 12 with rules 20 and 21 (no re-fire).

**Proposed fix**
Add `fired_milestones_json` to goals via a new migration, evaluate in a goal ledger subscriber on wallet balance change, post through `alerts_service` on a `goals` channel with amount-free locked copy.

**Implementation checklist**
- [ ] Create `mobile/lib/db/migrations/019_goal_milestones.sql` adding `fired_milestones_json TEXT NOT NULL DEFAULT '[]'` and register it in `migrations.ts`.
- [ ] Extend `goals_repo.ts` mapper and update path.
- [ ] Create `mobile/lib/goals/goal_milestone_subscriber.ts` on `ledger:committed`, computing progress and firing once per threshold.
- [ ] Add the `goals` channel in `mobile/lib/alerts/channels.ts` and both copy variants in `alert_copy.ts`.
- [ ] Start the subscriber in `mobile/app/_layout.tsx`.
- [ ] Tests for first-cross-only and for locked copy.
- [ ] Update docs/04-features/05 to reference the implementation.

**Acceptance criteria**
- [ ] Crossing 50 percent twice (dip and re-cross) posts one notification.

**Verification commands**
```bash
cd mobile && npm test -- lib/goals lib/alerts lib/db
cd mobile && npm run typecheck
```

**Do not**
Do not fire on manual balance corrections. Do not renumber existing migrations. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
The column is additive; an older build ignores it. Removing the column needs a rebuild migration; prefer leaving it.

**Open questions**
none (AGENT-ASSISTED: migration review)

### GAP-056 [FEAT] Planned payday contributions have no pending, completed, skipped or expired lifecycle

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | L |
| Difficulty | D2 Standard |
| Risk | R4 |
| Confidence | C1 Verified |
| Priority score | 0.29 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | GAP-044, GAP-055 (migration numbering) |
| Blocks | none |
| Est. agent turns | 10-14 |

**Location**
- `mobile/lib/safe_to_spend_service.ts:183-229` (reserves for every pay event, no state)
- `mobile/components/goals/allocation_sheet.tsx:126-161` ("Not now" is a dismiss with no record)
- `mobile/lib/goals/goals_service.ts:139`
- `docs/04-features/05-goals-savings.md:63-67`, `:91-93`; `docs/04-features/09-safe-to-spend.md:91`

**Evidence**
`git grep -n -i "fulfilled\|planned_contribution\|contribution_status" mobile/lib mobile/types mobile/lib/db/migrations` returns nothing.

**What is wrong**
A skipped contribution stays reserved in Safe-to-Spend for the rest of the period; a fulfilled one cannot be told from a pending one; nothing expires.

**Why it matters**
Rule 6 of the Safe-to-Spend spec ("skipped and expired contributions leave the term") cannot hold.

**Intended behavior**
docs/04-features/05 rule 14: pending until matched within 3 days, recorded, skipped, or the period ends.

**Proposed fix**
A `planned_contributions` table written on payday, matched against inflows to the goal wallet, skipped from the sheet, expired at period end; Safe-to-Spend reads only pending rows.

**Implementation checklist**
- [ ] Create `mobile/lib/db/migrations/020_planned_contributions.sql` (goal_id, pay_event_transaction_id, amount, status, created_at, expires_at) and register it.
- [ ] Add a repo `mobile/lib/db/repos/planned_contributions_repo.ts`.
- [ ] In `mobile/lib/goals/goals_service.ts`, write rows on payday and match inflows; add skip.
- [ ] In `mobile/lib/safe_to_spend_service.ts` `forecastContributions`, read pending rows instead of recomputing from pay events.
- [ ] In `mobile/components/goals/allocation_sheet.tsx`, wire "Not now" to skip.
- [ ] Tests for each transition and for the Safe-to-Spend term.

**Acceptance criteria**
- [ ] Skipping a contribution raises Safe-to-Spend by its amount the same day.

**Verification commands**
```bash
cd mobile && npm test -- lib/goals safe_to_spend lib/db
cd mobile && npm run typecheck
```

**Do not**
Do not move real money. Do not renumber migrations. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Additive table; older builds ignore it.

**Open questions**
none (AGENT-ASSISTED: migration review)

### GAP-057 [CODE] Boundary casts stand in for validation and the review resolution is discarded

| Field | Value |
|---|---|
| Severity | S4 Minor |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R3 |
| Confidence | C1 Verified |
| Priority score | 0.25 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | GAP-014 (introduces Zod), GAP-044, GAP-056 (migration numbering) |
| Blocks | none |
| Est. agent turns | 6-10 |

**Location**
- `mobile/lib/db/repos/review_queue_repo.ts:302` (`void resolution;` the confirmed/dismissed value is accepted and dropped), `:252`
- `mobile/lib/db/repos/user_rules_repo.ts:84` (`catch { return undefined; }`), `:145-146` (`as UserRuleMatcher`, `as unknown as UserRuleAction`)
- `mobile/lib/db/mappers.ts:209` (`JSON.parse(...) as ReviewItemPayload`); `mobile/lib/ingest/seed_rules.ts:58`; `mobile/lib/ingest/pipeline.ts:505`, `:665`; `mobile/lib/db/repos/transfer_links_repo.ts:42-43`; `mobile/lib/db/unit_of_work.ts:43`
- Whole-tree census: 2 `: any`, 4 `as any`, 6 `as unknown as`, 1 `@ts-expect-error`, 1 empty catch (non-test mobile)

**Evidence**
The census is low; this is a targeted list, not a sweep. The one behavioural item is `void resolution`: "dismissed" and "confirmed" are indistinguishable in the table, which blocks any history view and the deferred second-dismissal counter (docs/09 §2b.3).

**What is wrong**
JSON columns are trusted on read; a row written by an older build with a shape the newer mapper does not expect fails at use time rather than at read time.

**Why it matters**
Latent. Worth doing once Zod is in the tree (GAP-014).

**Intended behavior**
Zod schemas for `UserRuleMatcher`, `UserRuleAction` and `ReviewItemPayload` in `mobile/types/`; `resolution` persisted.

**Proposed fix**
Add the schemas, decode with `safeParse` in the two repos and the mapper, skip (and count) rows that fail; add a `resolution TEXT` column via migration 021 and write it in `resolve()`.

**Implementation checklist**
- [ ] Add `mobile/types/db_json_schemas.ts` with the three schemas.
- [ ] Use them in `user_rules_repo.ts:145-146` and `mappers.ts:209`.
- [ ] Create `021_review_resolution.sql` adding `resolution TEXT` and register it.
- [ ] In `review_queue_repo.ts:302`, persist the value.
- [ ] Replace the casts at `pipeline.ts:505` (type guard) and `:665` (narrowing already guaranteed by the gate; assert with a thrown error).
- [ ] Tests for a malformed rule row being skipped and for `resolution` being stored.

**Acceptance criteria**
- [ ] A malformed `user_rules.action_json` row does not crash ingest.
- [ ] `resolve(id, "dismissed")` writes `dismissed`.

**Verification commands**
```bash
cd mobile && npm test -- lib/db lib/ingest
cd mobile && npm run typecheck
```

**Do not**
Do not touch `database.ts` row casts (house style at the SQLite adapter). Do not renumber migrations. Do not rename files or symbols to match the naming convention as part of this fix.

**Rollback**
Additive column; older builds ignore it.

**Open questions**
none (AGENT-ASSISTED: migration review)

### GAP-058 [CODE] Safe-to-Spend query is never invalidated by any mutation and the Plus projection input is never refreshed

> **REMEDIATION: DONE** (2026-09-04) - commit 46edbd3, branch worktree-gap-wave-1. Verification: jest hooks 87 passed and home_screen 23 passed; three added tests fail with the source-root list emptied. DEVIATION: fixed by a cascade in query_client, so acceptance criterion 1 (12+ mutation hooks naming the key) is NOT met by design

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
| Blocks | GAP-066 |
| Est. agent turns | 3-5 |

**Location**
- `mobile/app/(tabs)/index.tsx:127` (the only `safeToSpend.all` invalidation, inside the `ledger:committed` handler)
- `mobile/app/(tabs)/index.tsx:157-158` (focus effect refetches `today()` only)
- `mobile/hooks/queries/use_safe_to_spend_input.ts:14-20` (comment claims nine triggers; key `["safe_to_spend","input"]`)
- `mobile/hooks/mutations/use_update_limit.ts:43`, `use_link_transfer.ts:40`, `use_create_transaction.ts:78-81` (representative mutation hooks; none names the Safe-to-Spend key)
- `mobile/lib/query_client.ts:42,47` (five-minute staleTime, `refetchOnWindowFocus: false`)
- `docs/04-features/09-safe-to-spend.md:101` (rule 13)

**Evidence**
`git grep "safeToSpend\.\(all\|today\|input\)" -- mobile ':!*test*'` returns exactly three sites: the two query hooks and the `ledger:committed` handler. No file under `mobile/hooks/mutations/` references the key. The Home focus effect calls `refetch` on the `today()` query, which does not touch the `input` query the Plus projection reads. `use_safe_to_spend_input.ts:14-16` states both queries are "invalidated by the same nine triggers".

**What is wrong**
A limit edit, bill skip, goal rule change, income profile change, transfer link or manual transaction updates its own query family and leaves the Safe-to-Spend queries stale. The hero survives on most paths only because leaving and re-entering the Home tab refetches it; a sheet opened on Home (payday allocation, reconcile) does not blur the tab. The projection curve sits behind a five-minute staleTime with focus refetch off, so it can show a curve computed from limits that no longer exist.

**Why it matters**
The product promise is that the number is trustworthy. Rule 13 lists nine recompute triggers; the code implements one plus a focus side effect.

**Intended behavior**
Every mutation named in rule 13 invalidates the Safe-to-Spend root key, so both the hero and the projection input refetch on next render.

**Proposed fix**
Add `queryKeys.safeToSpend.all` to the invalidation list of every mutation hook that touches limits, bills, goals, income, transfers, review actions or transactions. Change the focus effect to `invalidateQueries({ queryKey: queryKeys.safeToSpend.all })` so both queries refresh. Correct the comment in `use_safe_to_spend_input.ts`.

**Implementation checklist**
- [ ] In `mobile/hooks/mutations/`, list every hook whose service call touches limits, bills, goals, income, transfer links, review resolution or transactions, and add `queryKeys.safeToSpend.all` to its `invalidateKeys` call.
- [ ] In `mobile/app/(tabs)/index.tsx`, replace the focus `refetch` with a root invalidation.
- [ ] In `mobile/hooks/queries/use_safe_to_spend_input.ts`, rewrite the header comment to describe the actual trigger set.
- [ ] Add a hook test in `mobile/hooks/__tests__/hooks.test.tsx` asserting that a limit update invalidates the Safe-to-Spend key.

**Acceptance criteria**
- [ ] `git grep -l "safeToSpend.all" mobile/hooks/mutations | wc -l` is at least 12.
- [ ] Editing a limit on the Plan tab and returning to Home shows the new hero value without a ledger commit.
- [ ] The projection sparkline changes after a bill is skipped.

**Verification commands**
```bash
cd mobile && npm test -- hooks
cd mobile && npm run typecheck
```

**Do not**
Do not add a global "invalidate everything" on every mutation; keep the key lists explicit. Do not change staleTime. Midnight rollover and AppState resume are GAP-066.

**Rollback**
Revert the commit. No data impact.

**Open questions**
none

### GAP-059 [SEC] Capture keypair is never regenerated after keystore invalidation, and a dead-key drain deletes the buffer and resolves empty

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | M |
| Difficulty | D3 Specialist |
| Risk | R4 |
| Confidence | C2 Strong |
| Priority score | 1.0 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 8-12 |

**Location**
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/KeyVault.kt:226-236` (`recreateAesKey`, AES only) and `:303-306` (`getOrCreateRsaKeyPair` guarded by `containsAlias`)
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureBuffer.kt:228-236` (`openAll` catches `Exception` per line and counts it as skipped) and `:145-152` (`drain` deletes the file afterwards)
- `mobile/lib/crypto/key_manager.ts:327-334` (`rewrapAfterInvalidation` calls only `recreateDeviceKek`)
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/NotificationListenerModule.kt:41-44` (documents a `DeviceKeyInvalidated` drain outcome)
- `docs/12-encryption-and-app-lock.md` §5, §5a, §6

**Evidence**
The capture RSA key is created with `setUserAuthenticationRequired(true)`, so removing the device screen lock invalidates it (docs/12 §5). The only recreate path in the vault is for AES aliases. The JS recovery path recreates the device KEK and nothing else. `openAll` catches `Exception` around each line; `KeyPermanentlyInvalidatedException` extends `InvalidKeyException`, so it lands in that branch, the line is counted as skipped, and `drain` then deletes the file.

**What is wrong**
After a mid-life screen-lock removal followed by phrase recovery, the app reports itself recovered but `capturePublicKeySpki()` still returns the dead pair's public half. Every notification the listener seals from then on is unopenable. Each drain silently discards the batch and resolves `[]`, `lastCaptureAt` keeps advancing, and the health card reports a working listener. The documented `DeviceKeyInvalidated` outcome is unreachable.

**Why it matters**
Silent, permanent loss of every captured transaction after a supported recovery path. C2 because the invalidation itself was not exercised on a device in this session (docs/13 Part 5 is NOT RUN, GAP-039).

**Intended behavior**
Recovery and wipe leave the device with a usable capture keypair. A drain that meets a dead key surfaces a coded error so JS can explain and clear explicitly.

**Proposed fix**
Add `recreateRsaKeyPair(alias)` to `KeyVault` and a `recreateCaptureKeyPair()` bridge function; call it from `rewrapAfterInvalidation` and from the wipe path. In `openAll`, rethrow `KeyPermanentlyInvalidatedException` the same way `UserNotAuthenticatedException` is rethrown so `mapKeyErrors` reports it and the file is left in place.

**Implementation checklist**
- [ ] In `KeyVault.kt`, add `recreateRsaKeyPair(alias)` under the existing lock, mirroring `recreateAesKey`.
- [ ] In `KeyStoreBridge.kt`, expose `recreateCaptureKeyPair()`.
- [ ] In `NotificationListenerModule.kt` and `mobile/modules/notification_listener/index.ts`, export it as an AsyncFunction.
- [ ] In `mobile/lib/crypto/key_manager.ts`, call it inside `rewrapAfterInvalidation` after `recreateDeviceKek`, and from the wipe path.
- [ ] In `CaptureBuffer.kt`, rethrow `KeyPermanentlyInvalidatedException` from `openAll`.
- [ ] Add a JVM test with a `FakeKeyVault` whose private key throws `KeyPermanentlyInvalidatedException`, asserting the drain throws and the file survives.
- [ ] Add a docs/13 Part 5 step that removes the screen lock, recovers, and confirms a fresh capture drains.

**Acceptance criteria**
- [ ] JVM test proves a dead key aborts the drain without deleting the file.
- [ ] After recovery on a device that had its lock removed, a new notification appears in the review queue.
- [ ] `git grep -n "recreateCaptureKeyPair" mobile/lib/crypto/key_manager.ts` returns a hit.

**Verification commands**
```bash
cd mobile && npm test -- lib/crypto
# Gradle: run the notification_listener JVM unit tests (task name per docs/13)
```

**Do not**
Do not regenerate the pair on every launch. Do not delete the buffer on a dead key; only JS should decide to clear it. Do not touch the AES KEK path.

**Rollback**
Revert the commit. Devices that already lost captures cannot recover them.

**Open questions**
- Should a dead-key drain offer the user a "discard N unreadable captures" prompt, or clear silently with a log line? Product call; default to a one-time notice.

### GAP-060 [CODE] Manual entry Save has no in-flight guard, so a double tap writes two entries

> **REMEDIATION: DONE** (2026-09-05) - commit 769d66b + bf32446, branch gap-wave-1 + gap-wave-4. Verification: CORRECTED: the original useState guard did not stop a same-tick double tap and wrote two rows; bf32446 makes it a ref. jest transaction_new 15 tests PASS

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.5 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2-3 |

**Location**
- `mobile/components/transactions/manual_entry_form.tsx:205` (`canSave = amountCentavos > 0`), `:247-250` (`handleSave` has no submitting flag), `:318-324` (Save disabled only by `canSave`)
- `mobile/app/transaction/new.tsx:128-159` (bare `recordTransfer` promise), `:166-184` (`createTransaction.mutate` with `router.back()` in `onSuccess`)

**Evidence**
The Save button's `disabled` prop reads only `!canSave`. Neither the form nor the route reads `createTransaction.isPending` or holds a local in-flight flag. Navigation back happens only after the write commits, so Save stays live for the whole write. `insertTransaction` and `recordTransfer` carry no idempotency key.

**What is wrong**
Two taps inside the write window produce two independent inserts (six rows on the transfer path: two legs and a link, twice). The review-queue path guards this at the store by re-reading the item inside the serialised unit of work; the manual path has no equivalent.

**Why it matters**
Duplicate ledger rows that move wallet balances and Safe-to-Spend. Rubric: ingest that duplicates transactions is S2.

**Intended behavior**
One tap, one write. Save is disabled and shows progress until the mutation settles.

**Proposed fix**
Pass a `submitting` boolean (`createTransaction.isPending || transferInFlight`) into `ManualEntryForm`, fold it into the Save `disabled` prop and an early return in `handleSave`. Set the transfer flag before `recordTransfer` and clear it in `.finally`.

**Implementation checklist**
- [ ] In `mobile/components/transactions/manual_entry_form.tsx`, add a `submitting?: boolean` prop and use it in `handleSave` and the Save button.
- [ ] In `mobile/app/transaction/new.tsx`, derive `submitting` from the mutation and a local transfer flag and pass it down.
- [ ] In `mobile/components/transactions/__tests__/manual_entry_form.test.tsx`, add a case that presses Save twice while the handler is pending and asserts one call.

**Acceptance criteria**
- [ ] Test: two rapid Save presses invoke `onSave` once.
- [ ] Manual QA: double-tapping Save on a transfer creates one pair of rows.

**Verification commands**
```bash
cd mobile && npm test -- manual_entry_form transaction_new
cd mobile && npm run typecheck
```

**Do not**
Do not add a repo-level dedupe by amount and time; the route header explains why two deliberate entries seconds apart are legitimate.

**Rollback**
Revert the commit. No data impact.

**Open questions**
none

### GAP-061 [CONTRA] Transaction detail edits only note and category and has no delete, while docs/07 promises every parsed field is editable

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | M |
| Difficulty | D4 Judgment |
| Risk | R3 |
| Confidence | C1 Verified |
| Priority score | 1.25 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 8-12 after the decision |

**Location**
- `mobile/app/transaction/[id].tsx:229` and `:236` (the only two `updateTransaction.mutate` calls: note and category)
- `docs/07-privacy-and-compliance.md:75` (rectification row), `:190` (rule 4), `:205` ("Edit anything" table row)

**Evidence**
The detail screen mutates `{ note }` and `{ categoryId }` only. Amount, direction, wallet, merchant, date and reference render as static rows with no press handler. No delete action exists on the screen; `git grep -n "deleteTransaction\|useDeleteTransaction" mobile/app` returns nothing. docs/07:205 says every parsed field is user-editable on Transaction detail; :75 lists that as the DPA right-to-rectification mechanism.

**What is wrong**
A misparsed amount from a low-confidence commit, or a row landed in the wrong wallet, cannot be corrected or removed on the row. The user's only tool is the review queue before commit.

**Why it matters**
The privacy doc turns this into a compliance claim (right to rectification). Either the feature ships or the claim is withdrawn.

**Position A (docs/07)**
Every parsed field editable, merchant removable.

**Position B (code)**
Note and category only; no delete.

**Authority**
Owner. The rectification row is a compliance statement and should not be weakened silently.

**Blast radius**
Editing amount, direction or wallet must re-apply balance deltas in the repository and respect transfer links; delete must unlink a transfer first.

**Proposed fix**
Decision, then either: build an edit sheet for amount, direction, wallet, merchant and date reusing the manual-entry field components and backed by `updateTransaction` with balance re-application in `transactions_repo`, plus a delete action that unlinks transfers; or amend docs/07:205 and :190 to the shipped subset while keeping :75 truthful.

**Implementation checklist**
- [ ] Owner records the decision in `docs/07-privacy-and-compliance.md` §7.
- [ ] If building: extend `updateTransaction` in `mobile/lib/db/repos/transactions_repo.ts` to re-apply wallet balance deltas when amount, direction or wallet changes, inside the unit of work.
- [ ] If building: add the edit sheet and a confirmed delete to `mobile/app/transaction/[id].tsx`.
- [ ] If building: add tests in `mobile/app/__tests__/transaction_detail.test.tsx` for amount edit balance delta and for delete of a transfer leg.
- [ ] If not building: rewrite docs/07:190 and :205 to name note, category and review-queue correction as the mechanisms.

**Acceptance criteria**
- [ ] docs/07 and the detail screen agree on which fields are editable.

**Verification commands**
```bash
cd mobile && npm test -- transaction_detail
```

**Do not**
Do not weaken the rectification row without the owner's sign-off.

**Rollback**
Revert.

**Open questions**
- Build the editor or scope the doc? (Wave 0 decision.)

### GAP-062 [TEST] NotificationListenerModuleTest still pins the eight-key record contract; the record now emits nine keys and two JVM tests fail

> **REMEDIATION: DONE** (2026-09-04) - commit 8c1fccd, branch worktree-gap-wave-1. Verification: key sets compared at nine across all four files; Gradle NOT RUN (no android/ in worktree)

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | GAP-096 |
| Est. agent turns | 1 |

**Location**
- `mobile/modules/notification_listener/android/src/test/java/expo/modules/notificationlistener/NotificationListenerModuleTest.kt:71-73` (`contractKeys`, eight names), `:328`, `:487` (`assertEquals(contractKeys, ...keys)`)
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureRecord.kt:50-58` (`toJson` puts nine keys including `notificationKey`)
- `CaptureRecordTest.kt:103` (test name says eight, set holds nine)

**Evidence**
`contractKeys` lists id, packageName, title, text, subText, bigText, postedAt, capturedAt. `CaptureRecord` also emits `notificationKey` (added by PR #33). Both assertions use exact set equality.

**What is wrong**
The JVM suite has not been run since PR #33 (2026-09-01 handoff). On the first run, two tests fail on the ninth key.

**Why it matters**
A red suite hides the next real regression. The exact-set assertion was written to catch a leaked key, so it must be updated, not loosened.

**Intended behavior**
Green JVM suite pinning nine keys.

**Proposed fix**
Add `"notificationKey"` to `contractKeys` in the module test and fix the stale test name and header remark in `CaptureRecordTest.kt`.

**Implementation checklist**
- [ ] In `NotificationListenerModuleTest.kt`, add `"notificationKey"` to `contractKeys`.
- [ ] In `CaptureRecordTest.kt`, rename the test at line 103 to say nine keys and remove the `toBundle()` remark.
- [ ] Run the module's JVM unit tests and paste the summary into the PR.

**Acceptance criteria**
- [ ] JVM unit test run reports zero failures.

**Verification commands**
```bash
# Gradle: run the notification_listener JVM unit tests (task name per docs/13)
```

**Do not**
Do not change the assertion to a subset check.

**Rollback**
Revert.

**Open questions**
none

### GAP-063 [CODE] Loan schedule table prints a zero balance on every row

> **REMEDIATION: DONE** (2026-09-04) - commit fefece2, branch worktree-gap-wave-1. Verification: jest loan_routes + lib/loans 5 suites 107 tests PASS; new test fails with balanceAfter reverted to 0

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/app/(tabs)/plan/loans/[id].tsx:92-99` (`balanceAfter: 0` literal in the row map)
- `mobile/components/loans/schedule_table.tsx:108-115` (renders `row.balanceAfter` under a Balance header)
- `mobile/lib/loans/loan_math.ts:23-31` (`ScheduleRow.balanceAfter` is computed for a freshly built schedule)

**Evidence**
The detail screen maps stored installments to `ScheduleRow` with `balanceAfter: 0` and passes them to `ScheduleTable`, which formats that value in its rightmost column.

**What is wrong**
Every row of a saved loan shows a balance of zero after each payment, false for all rows but the last. The column is Plus-gated (`amortization`), so paying users see it.

**Why it matters**
A wrong money figure on a paid surface docs/06-loans.md:138 calls "the Plus depth".

**Intended behavior**
Running balance after each installment: remaining principal portions folded over the list.

**Proposed fix**
Compute `balanceAfter` in the map by folding remaining `principalPortion` (or `amountDue` for flat loans) from the end of the list, or hide the column when it cannot be computed.

**Implementation checklist**
- [ ] In `mobile/app/(tabs)/plan/loans/[id].tsx`, replace the literal with a running-balance fold.
- [ ] In `mobile/app/__tests__/loan_routes.test.tsx`, add an assertion that reads a middle row's balance cell.

**Acceptance criteria**
- [ ] A three-installment amortized loan shows three distinct decreasing balances ending at zero.

**Verification commands**
```bash
cd mobile && npm test -- loan_routes
```

**Do not**
Do not add a column to the `Installment` schema for this; derive it.

**Rollback**
Revert.

**Open questions**
none

### GAP-064 [CODE] Loan "Paid so far" and the next-installment pointer are derived by subtraction and go wrong after a balance adjustment

> **REMEDIATION: DONE** (2026-09-04) - commit fefece2, branch worktree-gap-wave-1. Verification: same commit; both halves proven to fail when reverted. outstandingBalance untouched so GAP-029 is not prejudged

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-4 |

**Location**
- `mobile/app/(tabs)/plan/loans/[id].tsx:101` (`paid = principal - outstanding`), `:114`, `:243`
- `mobile/lib/db/repos/loans_repo.ts:628-636` (`outstandingBalance = max(0, principal - payments + adjustments)`)
- `mobile/lib/loans/loans_service.ts:264` (same subtraction feeds the next-due pointer)
- `docs/04-features/06-loans.md:107` (rule 20: adjustments reopen settled loans)

**Evidence**
Outstanding includes adjustments and is floored at zero. "Paid so far" is principal minus that figure, so a positive fee adjustment lowers it; a fee before any payment prints a negative "Paid so far"; an overpayment caps it at principal.

**What is wrong**
A supported path (rule 20) produces a wrong and sometimes negative money figure, and the schedule pointer moves backwards after a fee.

**Why it matters**
Wrong number on a plan surface; contradicts rule 20's intent.

**Intended behavior**
"Paid so far" is the sum of recorded payments; adjustments live only in the balance.

**Proposed fix**
Add `paidTotal` to `LoanStatus` from the payments sum already read for `paidCount`, render it on the detail screen, pass it as `totalPaid`, and use it for the next-due computation.

**Implementation checklist**
- [ ] In `mobile/lib/loans/loans_service.ts`, add `paidTotal` to the status from `listPayments`.
- [ ] In `mobile/app/(tabs)/plan/loans/[id].tsx`, render `status.paidTotal` instead of the subtraction.
- [ ] In `mobile/app/__tests__/loan_routes.test.tsx`, extend the adjustment test to read `loan-detail-paid`.

**Acceptance criteria**
- [ ] After a +500 adjustment and no payments, "Paid so far" reads zero, not minus 500.

**Verification commands**
```bash
cd mobile && npm test -- loan_routes loans_service
```

**Do not**
Do not change `outstandingBalance`; GAP-029 owns that formula.

**Rollback**
Revert.

**Open questions**
none

### GAP-065 [CODE] Bill payment history prints the current estimate on every row instead of the matched transaction amount

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-4 |

**Location**
- `mobile/app/(tabs)/plan/bills/[id].tsx:74` (history filter), `:182` (unreachable "Settled" branch), `:187` (`row.estimate.amount`)
- `mobile/lib/bills/bills_service.ts:173` (one estimate per bill copied onto every cycle)
- `mobile/types/domain.ts` (`BillPayment` carries `transactionId` only)
- `docs/04-features/07-bills.md:31` ("payment history (matched transactions)")

**Evidence**
Each history row renders the bill-level estimate. The row's `payment` has no amount field.

**What is wrong**
A bill paid 2,100, 2,350 and 2,600 shows three rows of the same averaged figure.

**Why it matters**
Wrong money figure; the doc defines the row as the matched transaction.

**Intended behavior**
Each row shows the matched transaction's amount and date.

**Proposed fix**
Join `bill_payments` to `transactions` in the status query (the estimator already reads those amounts via `paymentAmounts`), carry `amount` and `occurredAt` on `BillStatus.payment`, render them, and delete the dead branch.

**Implementation checklist**
- [ ] In `mobile/lib/bills/bills_service.ts`, populate `payment.amount` and `payment.occurredAt`.
- [ ] In `mobile/types/domain.ts`, extend `BillPayment`.
- [ ] In `mobile/app/(tabs)/plan/bills/[id].tsx`, render the payment amount and remove the unreachable branch.
- [ ] In `mobile/app/__tests__/bills_screen.test.tsx`, change the match fixture so the payment differs from the estimate and assert the rendered row.

**Acceptance criteria**
- [ ] History rows show distinct amounts when payments differ.

**Verification commands**
```bash
cd mobile && npm test -- bills_screen bills_service
```

**Do not**
Do not add a column to `bill_payments`; read through the transaction.

**Rollback**
Revert.

**Open questions**
none

### GAP-066 [CODE] Home refreshes only the hero on focus and on pull, with no resume or midnight trigger for the other cards

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-058 |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/app/(tabs)/index.tsx:157-158` (focus effect), `:212` (`RefreshControl refreshing={false}` refetching one query)
- `mobile/lib/query_client.ts:42,47` (staleTime, `refetchOnWindowFocus: false`; no `focusManager` binding anywhere in mobile)
- `mobile/hooks/queries/use_bills.ts`, `use_limit_statuses.ts`, `use_daily_spend.ts`, `use_loans.ts` (each resolves "today" inside its queryFn, none keyed on the day)

**Evidence**
The comment near the focus effect says it exists because a day can roll over in the background, but `useFocusEffect` is a navigation hook and does not fire on AppState resume, and TanStack's focus refetch is off with no AppState binding. Only the hero query is refetched on focus or pull. `refreshing` is hard-wired false.

**What is wrong**
After a day rollover in the background, limit windows, bill due states, the seven-day bars, utang flags and the balance tile keep yesterday's values until an unrelated mutation invalidates them. Pull-to-refresh dismisses its spinner immediately and refreshes one query.

**Why it matters**
Rule 13 names local-midnight rollover as a trigger; the strips under the hero are its explanation and must move with it.

**Intended behavior**
Resume and pull refresh everything on Home; the spinner reflects fetching state.

**Proposed fix**
Bind TanStack's `focusManager` to AppState in `query_client.ts`, have the focus callback and the RefreshControl invalidate the five families, and drive `refreshing` from `isFetching`.

**Implementation checklist**
- [ ] In `mobile/lib/query_client.ts`, subscribe `focusManager.setEventListener` to AppState "active".
- [ ] In `mobile/app/(tabs)/index.tsx`, invalidate `safeToSpend`, `limits`, `bills`, `loans`, `wallets` and `transactions.dailySpend` from both the focus effect and `onRefresh`, and set `refreshing` from the queries' `isFetching`.
- [ ] Add a Home test for the pull path.

**Acceptance criteria**
- [ ] With a mocked clock advanced past midnight, resuming the app updates the daily bars without a ledger commit.

**Verification commands**
```bash
cd mobile && npm test -- home_screen
```

**Do not**
Do not enable `refetchOnWindowFocus` globally; per-screen invalidation is cheaper on the encrypted DB.

**Rollback**
Revert.

**Open questions**
none

### GAP-067 [CONTRA] Onboarding is not resumable, and a second pass re-runs the wallet and first-limit writes

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | none |
| Blocks | GAP-091 |
| Est. agent turns | 6-8 |

**Location**
- `mobile/lib/onboarding/onboarding_state.ts:29-35` ("PROGRESS IS NOT PERSISTED"; re-entry restarts at welcome)
- `mobile/contexts/lock_context.tsx:252-258` (five-minute relock on return from Settings) with `mobile/app/_layout.tsx:390-391` (Stack replaced by LockScreen)
- `mobile/app/(onboarding)/wallets.tsx:198` (`included: true` seed), `:457` ("Some wallets couldn't be saved")
- `mobile/lib/db/repos/wallets_repo.ts:39-51` (`DuplicateNameError` on name collision)
- `mobile/app/(onboarding)/first_limit.tsx:64` (chosen scope inserted unconditionally), `:89` (only derived scopes consult `occupied`)
- `docs/04-features/01-onboarding.md:29` ("Flow resumes at the first incomplete step"), `:176` (acceptance line)

**Evidence**
The state module says progress is deliberately not persisted. The access and battery steps send the user to system Settings; staying more than five minutes triggers relock, and after unlock the app redirects to onboarding at welcome. The wallets step re-proposes the same providers with `included: true` and the repo throws on the first duplicate name. The first-limit step inserts the chosen scope without checking existing statuses.

**What is wrong**
Position A (docs/01): per-step persistence and resume on kill. Position B (code): restart at welcome by design. On the repeat pass the user sees an error about wallets that already exist and ends up with two active limits at the same scope.

**Why it matters**
Duplicate limits change Safe-to-Spend. Acceptance line 176 has no test and the code contradicts it.

**Authority**
Owner on the cursor; the idempotency half is a defect either way.

**Blast radius**
Onboarding routes and the two repos.

**Proposed fix**
Either persist an `onboarding_step` setting written by each step's advance, or amend docs/01 rule 6 and line 176. In both cases make wallets and first-limit idempotent: mark proposals that already match a non-archived wallet as not included, and skip or update when the chosen scope already has an active limit.

**Implementation checklist**
- [ ] Owner decides cursor or doc.
- [ ] In `mobile/app/(onboarding)/wallets.tsx`, seed `included: false` for proposals whose name or package matches an existing wallet.
- [ ] In `mobile/app/(onboarding)/first_limit.tsx`, check `statuses` for the chosen scope before inserting.
- [ ] If cursor: add the setting to `mobile/lib/db/repos/app_settings_repo.ts` and read it in `mobile/app/(onboarding)/index.tsx`.
- [ ] In `mobile/app/(onboarding)/__tests__/setup_flow_e2e.test.tsx`, add a pass that runs wallets and first-limit twice over the same DB.

**Acceptance criteria**
- [ ] Running onboarding twice leaves one limit per scope and no duplicate-name error.

**Verification commands**
```bash
cd mobile && npm test -- setup_flow_e2e
```

**Do not**
Do not persist the recovery phrase step state; that step must always rerun from the key state.

**Rollback**
Revert.

**Open questions**
- Cursor or doc amendment? (Wave 0.)

### GAP-068 [SEC] No secure-window flag anywhere, so the ledger is visible in the Recents thumbnail and screenshots while unlocked

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2-4 |

**Location**
- `git grep -n -i "FLAG_SECURE\|expo-screen-capture\|preventScreenCapture" -- mobile` returns nothing at HEAD
- `mobile/contexts/lock_context.tsx:127` (five-minute grace), `mobile/app/_layout.tsx:390-391`
- `docs/12-encryption-and-app-lock.md` §4 ("someone handed the unlocked phone" in scope), §7

**Evidence**
The lock swaps the React tree on status change and nothing sets the window's secure flag. Android captures the task thumbnail at the moment the app goes to background, which falls inside the grace window while status is still unlocked.

**What is wrong**
Safe-to-Spend, balances and the transaction list sit in the app switcher for anyone holding the phone. GAP-017 adds screen-capture prevention only to the three phrase screens.

**Why it matters**
docs/12 puts the handed-over phone in scope and never addresses the switcher.

**Intended behavior**
Financial screens hidden from Recents and screenshots at least while the app is backgrounded; docs/12 §7 states the rule.

**Proposed fix**
Call `expo-screen-capture`'s `preventScreenCaptureAsync()` from the app shell while status is unlocked (or set FLAG_SECURE in the activity via a config plugin), and add the rule to docs/12 §7.

**Implementation checklist**
- [ ] Decide app-wide versus background-only with the owner (GAP-017 already brings the dependency).
- [ ] In `mobile/app/_layout.tsx`, prevent capture while unlocked and allow it while locked or during onboarding explainers.
- [ ] In `docs/12-encryption-and-app-lock.md` §7, add the sentence.
- [ ] Manual QA on the A54: background the app, open Recents, confirm a blank thumbnail.

**Acceptance criteria**
- [ ] Recents shows no ledger content after backgrounding while unlocked.

**Verification commands**
```bash
cd mobile && npm run typecheck
```

**Do not**
Do not block screenshots on the support report screen where the user attaches one.

**Rollback**
Revert.

**Open questions**
- App-wide or background-only? Default app-wide except the support attachment flow.

### GAP-069 [FEAT] Tapping any app notification never navigates; the alert route resolver has no caller

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2-3 |

**Location**
- `mobile/lib/alerts/alert_routes.ts:67` (`resolveAlertRoute`), header lines 5-16 (says the listener belongs in `_layout.tsx`)
- `mobile/app/_layout.tsx:240-378` (every subscriber; no `addNotificationResponseReceivedListener`)
- `docs/06-information-architecture.md` §6.1 deep-link table

**Evidence**
`git grep -n "resolveAlertRoute\|addNotificationResponseReceivedListener\|getLastNotificationResponse" -- mobile ':!*test*'` returns only `alert_routes.ts` itself.

**What is wrong**
Every alert carries routing data that nothing reads. The tracking-interrupted notice says "Tap to fix tracking" and opens the app wherever it last was.

**Why it matters**
Docs/06 defines the deep-link table; the copy promises it.

**Intended behavior**
A tap routes per the table once the app is unlocked. Because the Stack is unmounted while locked, wiring the listener cannot bypass the lock.

**Proposed fix**
In the app shell, once bootstrap is ready, register the response listener and consume `getLastNotificationResponseAsync()` for cold starts, pushing `resolveAlertRoute(data)`; defer the push until status is unlocked and onboarding is complete.

**Implementation checklist**
- [ ] In `mobile/app/_layout.tsx`, add the listener and the cold-start read, queued behind unlock.
- [ ] In `mobile/app/__tests__/lock_gate.test.tsx` or a new test, assert a response received while locked navigates only after unlock.

**Acceptance criteria**
- [ ] Tapping a bill reminder opens that bill's detail.

**Verification commands**
```bash
cd mobile && npm test -- alert_routes lock_gate
```

**Do not**
Do not navigate while status is not unlocked.

**Rollback**
Revert.

**Open questions**
none

### GAP-070 [CODE] Percent contribution rules reserve a share of the income profile average, not the pay that landed

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2-3 |

**Location**
- `mobile/lib/safe_to_spend_service.ts:221-225` (same `amount` pushed for every pay event), `:231-238` (`contributionAmount` uses `averageAmount`)
- `mobile/lib/__tests__/safe_to_spend_service.test.ts:320-337` (fixture where average equals the payday amount)
- `docs/04-features/05-goals-savings.md:90` (rule 13), `docs/04-features/09-safe-to-spend.md:93` (rule 6b)

**Evidence**
The comment says the rule "takes its cut of what arrived, which is what `averageAmount` is"; `averageAmount` is the profile average, and the loop ignores `event.amount`. The test seeds both at the same value, so it passes under either reading.

**What is wrong**
A thirteenth-month pay or a short payday reserves the wrong figure.

**Why it matters**
Feeds the Safe-to-Spend contributions term. Bounded today because percent rules cannot be created in the UI (GAP-020), so the wrong path is reachable only through seeded data.

**Intended behavior**
Percent of the credited pay event(s) on that date; the average only as the rule-16 fallback when no pay was detected.

**Proposed fix**
Use `event.amount` summed per payday date in the loop; keep the average for the no-pay fallback. Change the test so the payday differs from the average.

**Implementation checklist**
- [ ] In `mobile/lib/safe_to_spend_service.ts`, compute per event from `event.amount`.
- [ ] In `mobile/lib/__tests__/safe_to_spend_service.test.ts`, change the fixture and expected value.

**Acceptance criteria**
- [ ] Test with average 1,000,000 and payday 1,300,000 at 10 percent expects 130,000.

**Verification commands**
```bash
cd mobile && npm test -- safe_to_spend_service
```

**Do not**
Do not touch fixed-amount rules.

**Rollback**
Revert.

**Open questions**
none

### GAP-071 [CODE] The tracking-interrupted notice fires on a fresh install before access is granted, and its 24-hour cap is written even when nothing was posted

> **REMEDIATION: DONE** (2026-09-04) - commit 0f6895d, branch worktree-gap-wave-1. Verification: jest lib/alerts 5 suites 181 tests PASS; both new tests fail with their source change reverted. Second regression test ships with the loans commit (shared file)

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/lib/alerts/tracking_health_subscriber.ts:44-50` (`isInterrupted` is true whenever `!granted`), `:73`
- `mobile/lib/db/repos/app_settings_repo.ts:245` (`capture_enabled` defaults true)
- `mobile/lib/alerts/tracking_notifier.ts:96` (`setSetting("tracking_interrupted_last_notified_at", now)` after the post, unconditionally)
- `mobile/app/_layout.tsx:300-303` (subscriber starts on bootstrap ready with no onboarding gate)

**Evidence**
The subscriber runs its check immediately on start. On a device that has never granted access, `capture_enabled` is true and `granted` is false, so the notice posts during onboarding on Android 12 and below. On Android 13+ the post returns null (GAP-003) but the cap timestamp is still written.

**What is wrong**
A never-granted install is treated as an interruption; the first real outage after the grant is silenced for 24 hours.

**Why it matters**
docs/06 §6.2 rule 4: at most one notice per distinct interruption.

**Intended behavior**
No notice before onboarding completes; the cap is written only after a non-null post.

**Proposed fix**
Gate the subscriber on `onboarding_complete`, and move the `setSetting` call under `if (id !== null)`.

**Implementation checklist**
- [ ] In `mobile/lib/alerts/tracking_health_subscriber.ts`, return false from `isInterrupted` when onboarding is incomplete.
- [ ] In `mobile/lib/alerts/tracking_notifier.ts`, write the cap only on a non-null post id.
- [ ] In `mobile/lib/alerts/__tests__/tracking_health_subscriber.test.ts`, add the never-granted case and the null-post case.

**Acceptance criteria**
- [ ] Tests pass; no notice is posted with onboarding incomplete.

**Verification commands**
```bash
cd mobile && npm test -- tracking_health_subscriber tracking_notifier
```

**Do not**
Do not change the 24-hour cap length.

**Rollback**
Revert.

**Open questions**
none

### GAP-072 [CONTRA] Support attachments are plaintext screenshot copies inside the app sandbox while docs/12 says everything at rest is ciphertext

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D3 Specialist |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 4-6 |

**Location**
- `mobile/lib/support/attachments.ts:138-145` (verbatim copy into `documentDirectory/support_attachments/`)
- `mobile/lib/support/outbox_runner.ts:159` (deleted only after a successful send)
- `mobile/app/(tabs)/more/report_problem.tsx:59-66` (unmount cleanup discards the draft) with `mobile/hooks/use_support_attachment_draft.ts:113-122` (release runs only after the insert resolves)
- `docs/12-encryption-and-app-lock.md` §4 threat table rows for rooted device and unencrypted backup

**Evidence**
The picked screenshot is copied verbatim. A queued report on a phone without data keeps it indefinitely. A process kill on the form orphans the file with no sweep. Leaving the screen during the pending insert unlinks files the queued row now references, after which every send attempt fails at the FormData layer and is mapped to "No connection".

**What is wrong**
Position A (docs/12): a rooted device or unencrypted backup sees only ciphertext. Position B (code): screenshots of bank notifications sit as plaintext files. The draft race also produces a report that retries forever with a wrong reason.

**Why it matters**
The at-rest promise is the product's security stance.

**Authority**
Owner: scope the claim or encrypt the copy.

**Blast radius**
Support outbox only.

**Proposed fix**
Amend docs/12 §4 to name support attachments and CSV exports as the plaintext exceptions, add a launch sweep that unlinks files not referenced by any row, and call `releaseDraft()` synchronously before `mutateAsync` (re-adopting on failure). Encrypting the copy with the cache cipher and decrypting to a temp file at send time is the follow-up if the owner wants the claim kept.

**Implementation checklist**
- [ ] Owner picks: scope the doc or encrypt.
- [ ] In `docs/12-encryption-and-app-lock.md` §4, name the exception (either way, until encryption lands).
- [ ] In `mobile/lib/support/attachments.ts`, add `sweepOrphanedAttachments(referencedUris)` and call it from bootstrap.
- [ ] In `mobile/app/(tabs)/more/report_problem.tsx`, release the draft before the insert.
- [ ] Add tests for the sweep and for unmount-during-submit.

**Acceptance criteria**
- [ ] No file in `support_attachments/` lacks a referencing row after launch.
- [ ] Leaving the screen mid-submit leaves a sendable report.

**Verification commands**
```bash
cd mobile && npm test -- support
```

**Do not**
Do not delete attachments referenced by an unsent row.

**Rollback**
Revert.

**Open questions**
- Encrypt at rest or document the exception? (Wave 0.)

### GAP-073 [SEC] The CSV export stays in the cache directory as a plaintext ledger copy and reports success when sharing is unavailable

> **REMEDIATION: DONE** (2026-09-04) - commit a45be16, branch worktree-gap-wave-1. Verification: jest lib/reports 3 suites 54 tests PASS plus export_button/reports_screen 10; 10 of 12 added tests fail with both fixes reverted

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/lib/reports/csv_export.ts:313-324` (write to `cacheDirectory`, share, no delete; share skipped silently when unavailable)

**Evidence**
The file is written, handed to `shareAsync`, and returned. Nothing deletes it. The name is keyed on the date, so repeated exports on different days accumulate. When `isAvailableAsync()` is false the function resolves normally with no share and no error.

**What is wrong**
Full-ledger CSVs (amounts, merchants, notes, references) sit unencrypted next to the encrypted database for as long as Android does not evict cache. The button reports success on a device with no share target.

**Why it matters**
Plaintext at rest that the user did not ask to keep; a silent no-op on the only export path.

**Intended behavior**
The file is transient: deleted after the share resolves or fails. Unavailable sharing surfaces an error.

**Proposed fix**
Wrap the share in try/finally with `deleteAsync(fileUri, { idempotent: true })`, and throw when sharing is unavailable so the export button shows its error state.

**Implementation checklist**
- [ ] In `mobile/lib/reports/csv_export.ts`, delete in `finally` and throw on unavailable sharing.
- [ ] In `mobile/lib/reports/__tests__/csv_export.test.ts`, assert deletion after share and the thrown error.
- [ ] In `mobile/components/reports/export_button.tsx`, confirm the error path renders.

**Acceptance criteria**
- [ ] After an export, `cacheDirectory` holds no `peraplano-transactions-*.csv`.

**Verification commands**
```bash
cd mobile && npm test -- csv_export export_button
```

**Do not**
Do not move the file to `documentDirectory`.

**Rollback**
Revert.

**Open questions**
none

### GAP-074 [SEC] The CSV export does not neutralise spreadsheet formula injection in free-text columns

> **REMEDIATION: DONE** (2026-09-04) - commit a45be16, branch worktree-gap-wave-1. Verification: same commit as GAP-073; seven columns neutralised (category_parent added beyond the entry's six)

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1 |

**Location**
- `mobile/lib/reports/csv_export.ts:164-171` (`needsQuoting` and `escapeField`: RFC 4180 only)
- `docs/04-features/10-reports.md:19` (the export exists to share numbers with a spouse, i.e. opened in a spreadsheet)

**Evidence**
`escapeField` quotes on comma, quote, CR and LF. Merchant, counterparty, reference, note, wallet and category are emitted otherwise verbatim. Merchant strings originate from third-party notification text.

**What is wrong**
A cell starting with `=`, `+`, `-`, `@`, tab or CR executes as a formula in Excel, LibreOffice or Sheets. A crafted SMS or app notification can plant one.

**Why it matters**
OWASP CSV-injection class; the attacker controls the input channel.

**Intended behavior**
Free-text cells beginning with a trigger character are prefixed with an apostrophe and quoted.

**Proposed fix**
In `escapeField`, when the value matches `/^[=+\-@\t\r]/`, prepend `'` and force quoting. Apply to free-text columns only.

**Implementation checklist**
- [ ] In `mobile/lib/reports/csv_export.ts`, add the prefix rule for the six text columns.
- [ ] In `mobile/lib/reports/__tests__/csv_export.test.ts`, add a merchant of `=HYPERLINK("x")` and assert the cell starts with `"'=`.

**Acceptance criteria**
- [ ] Test passes; amount column unchanged.

**Verification commands**
```bash
cd mobile && npm test -- csv_export
```

**Do not**
Do not prefix the amount or date columns.

**Rollback**
Revert.

**Open questions**
none

### GAP-075 [FEAT] Review triage has no undo; docs/08 rule 9 promises a ten-second undo affordance

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-013 |
| Blocks | none |
| Est. agent turns | 6-8 |

**Location**
- `mobile/components/review/review_card.tsx:791-868` (no undo prop), `:1142-1192`
- `mobile/hooks/mutations/use_review_action.ts` (no reverse action)
- `mobile/lib/db/repos/review_queue_repo.ts:301-312` (`resolve` stamps `resolved_at`; no reopen)
- `docs/04-features/08-review-queue.md:99` (rule 9)

**Evidence**
No component, hook or repo function reverses a triage. A "Not money" tap on a low-confidence card discards a real capture with no way back except the 30-day raw text on the Privacy screen.

**What is wrong**
A promised affordance is absent and a one-tap action is irreversible.

**Why it matters**
Rule 9 is explicit; mis-taps on a scrolling list are common.

**Intended behavior**
After each triage a ten-second undo appears; undo reopens the item and reverses any committed transaction or rule.

**Proposed fix**
Add `reopen(id)` to the repo, an `undo` action in the hook that reopens and, for confirm or correct, deletes the committed transaction and any rule created by `teachFrom`, and a snackbar using the GAP-013 toast primitive. Dismiss-only actions are the cheap first slice.

**Implementation checklist**
- [ ] In `mobile/lib/db/repos/review_queue_repo.ts`, add `reopen`.
- [ ] In `mobile/lib/review/resolve_actions.ts`, add `undoResolution` covering dismiss, confirm and correct inside the unit of work.
- [ ] In `mobile/hooks/mutations/use_review_action.ts`, add the undo variant with invalidation.
- [ ] In `mobile/app/review/index.tsx`, render the snackbar after success.
- [ ] Tests in `mobile/app/__tests__/review_queue.test.tsx` for undo of each kind.

**Acceptance criteria**
- [ ] Undo within ten seconds restores the item and removes the committed row.

**Verification commands**
```bash
cd mobile && npm test -- review_queue resolve_actions
```

**Do not**
Do not undo by re-running ingest; reverse the specific writes.

**Rollback**
Revert.

**Open questions**
none

### GAP-076 [CODE] Rows in an archived wallet show "Unknown wallet" on detail and in the transfer candidate list

> **REMEDIATION: DONE** (2026-09-04) - commit e046f84, branch gap-wave-3. Verification: jest 22 suites 342 tests PASS; all 20 useWallets call sites checked, no picker gained an archived wallet

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1 |

**Location**
- `mobile/app/transaction/[id].tsx:140` (`useWallets()` with no options), `:186`, `:366` (fallback string)
- `mobile/hooks/queries/use_wallets.ts:35` (`includeArchived` defaults false)
- `mobile/components/transactions/transfer_link_actions.tsx:160` (same fallback)
- `mobile/app/(tabs)/transactions.tsx:48` (same call shape)

**Evidence**
The lookup misses archived wallets, so the row prints the literal fallback. Archiving is the only removal path and rows stay in the ledger.

**What is wrong**
Every row of an archived wallet reads as belonging to a wallet the app cannot identify.

**Why it matters**
Confusing on a core screen; trivial fix.

**Intended behavior**
The archived wallet's name, optionally with an "Archived" chip.

**Proposed fix**
Call `useWallets({ includeArchived: true })` where names are resolved; keep the archived filter only in pickers.

**Implementation checklist**
- [ ] In the three files above, pass `includeArchived: true` for name resolution.
- [ ] In `mobile/app/__tests__/transaction_detail.test.tsx`, add an archived-wallet fixture.

**Acceptance criteria**
- [ ] Detail of a row in an archived wallet shows the wallet name.

**Verification commands**
```bash
cd mobile && npm test -- transaction_detail
```

**Do not**
Do not offer archived wallets in the manual-entry picker.

**Rollback**
Revert.

**Open questions**
none

### GAP-077 [CODE] Category correction and rule creation are two independent writes; a failed recategorise still creates the rule

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2-3 |

**Location**
- `mobile/app/transaction/[id].tsx:236` (`updateTransaction.mutate`), `:248` (`createUserRule.mutate`), fired back to back with no ordering

**Evidence**
Two fire-and-forget mutations with no shared unit of work. If the row update fails (silently, GAP-013), the rule is still written and the picker has already closed.

**What is wrong**
Every future row from that merchant is recategorised while the row the user was looking at is not.

**Why it matters**
docs/07:75 ties rules to a correction that happened.

**Intended behavior**
Row and rule land together or not at all.

**Proposed fix**
Chain the rule creation in the update's `onSuccess`, or add a repo-level `recategorizeWithRule` inside `withUnitOfWork` and one mutation hook.

**Implementation checklist**
- [ ] In `mobile/app/transaction/[id].tsx`, move `createUserRule.mutate` into `updateTransaction`'s `onSuccess`.
- [ ] In `mobile/app/__tests__/transaction_detail.test.tsx`, add a failing-update case asserting no rule.

**Acceptance criteria**
- [ ] With the update rejected, `user_rules` gains no row.

**Verification commands**
```bash
cd mobile && npm test -- transaction_detail
```

**Do not**
Do not remove the "also create a rule" checkbox.

**Rollback**
Revert.

**Open questions**
none

### GAP-078 [CODE] Bare-promise writes outside mutation hooks swallow failures into dead or misleading screens

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-4 |

**Location**
- `mobile/contexts/lock_context.tsx:421-435` (`wipeAndStartOver` awaits the wipe with `finally` but no `catch`) via `mobile/components/lock/recovery_unlock_form.tsx:179` (`void onWipe()`); `mobile/lib/security/wipe.ts:40-52` (key and buffer wipes run after the database file is deleted)
- `mobile/app/(onboarding)/done.tsx:91` (`completeOnboarding()` in try/finally with no catch)
- `mobile/app/(onboarding)/index.tsx:93` (`getKeyState().then(...)` with no catch; a rejection leaves the sequencer at "checking")
- `mobile/app/_layout.tsx:185` (`applyAllocations.mutateAsync` with no catch)
- `mobile/app/(onboarding)/access.tsx:130-155` (return recheck chain; verify the catch covers the recheck)
- `mobile/app/transaction/new.tsx:128-159` (the `.catch` sits after `.then(invalidateKeys).then(router.back)`, so a post-commit rejection prints "Nothing was recorded" after three rows committed)

**Evidence**
GAP-013's cache-level handler covers `useMutation` failures only. These paths call repos or `mutateAsync` directly. The recovery-screen wipe is the worst: `wipeDatabase` has already deleted the file when `wipeKeys` or `clearCaptureBuffer` can throw, status stays "needs_recovery", and the next Unlock runs re-wrap over a database that no longer exists. `privacy.tsx:174-187` handles the identical call correctly.

**What is wrong**
Failures become unhandled rejections; the user sees a stuck spinner, a dead screen, or a false "nothing recorded".

**Why it matters**
The wipe is the escape hatch from the unrecoverable state (docs/12 §11a); its own failure must be reported.

**Intended behavior**
Each path catches, shows inline copy, and moves status forward when the irreversible part already succeeded.

**Proposed fix**
Add catches: in `wipeAndStartOver` set an error message and still move to "needs_onboarding" when the database wipe succeeded; in done and the sequencer show retry copy; wrap the allocation confirm; attach the transfer catch to `recordTransfer` alone and choose the message on a `committed` flag.

**Implementation checklist**
- [ ] `mobile/contexts/lock_context.tsx`: catch and surface, mirroring `privacy.tsx`.
- [ ] `mobile/app/(onboarding)/done.tsx` and `index.tsx`: catch with inline retry.
- [ ] `mobile/app/_layout.tsx`: try/catch around the allocation confirm, surfacing `isError` in the sheet.
- [ ] `mobile/app/transaction/new.tsx`: reorder the chain.
- [ ] Tests: rejecting wipe in `lock_context.test.tsx`; post-commit rejection in `transaction_new.test.tsx`.

**Acceptance criteria**
- [ ] A rejecting `wipeKeys` after a successful database wipe lands the user on onboarding with a message.

**Verification commands**
```bash
cd mobile && npm test -- lock_context transaction_new done_step
```

**Do not**
Do not route these through the GAP-013 toast; they need in-place state.

**Rollback**
Revert.

**Open questions**
none

### GAP-079 [CODE] Sheets keep stale state and stay open after a failed write, and their confirm buttons stay tappable while pending

> **REMEDIATION: DONE** (2026-09-05) - commit e97a640 + 8654b88, branch gap-wave-4. Verification: jest components/wallets+loans+review+wallet_routes 14 suites 335 tests PASS; reverting the 7 sources fails exactly the 23 new tests. Found that a useState guard does not stop a same-tick double tap

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-013 |
| Blocks | none |
| Est. agent turns | 3-4 |

**Location**
- `mobile/components/wallets/cash_reconcile_sheet.tsx:89` and `balance_correction_sheet.tsx` (`onSuccess` only; `text` and `result` survive `visible` toggling)
- `mobile/components/wallets/archive_wallet_sheet.tsx` (confirm has no `loading` prop) with `mobile/app/wallet/[id].tsx:593` (`archiveWallet.mutate` with `onSuccess` only)
- `mobile/components/loans/record_payment_sheet.tsx:129` and `balance_adjustment_sheet.tsx` (`onSuccess` only; `isError` never rendered); `mobile/app/wallet/[id].tsx:499` (`dismissDrift`)
- `mobile/app/wallet/new.tsx:85-90` and `mobile/app/wallet/[id]/edit.tsx` (matcher save chained inside the wallet save's `onSuccess` with no `onError`)
- `mobile/components/review/review_card.tsx:1002` (`primaryDisabled` ignores pending; no `busy` prop) with `mobile/hooks/mutations/use_review_action.ts:4-9` (header claims the screen disables the pair)

**Evidence**
None of these sheets reads `isError`. Reopening the reconcile sheet after a save shows the previous amount and a stale "Recorded." line. A slow archive accepts a second confirm tap, re-running `reassignWalletTransactions`. On wallet create, a failed matcher save leaves the wallet created and a retry hits `DuplicateNameError`.

**What is wrong**
Failures are invisible in place (GAP-013's toast will say something failed but not which field), state leaks across opens, and double taps re-run writes.

**Why it matters**
Silent partial saves on money-moving sheets.

**Intended behavior**
Failure text under the buttons, state reset on open, confirm disabled while pending, and the wallet form navigating to the created wallet's edit screen when the matcher half fails.

**Proposed fix**
Render `mutation.isError` in each sheet; reset local state in an effect keyed on `visible`; pass `loading={mutation.isPending}` to confirm buttons; add `busy` to `ReviewCard`; add `onError` to the inner matcher mutate.

**Implementation checklist**
- [ ] The five sheets: error line, reset effect, loading prop.
- [ ] `mobile/components/review/review_card.tsx`: `busy?: boolean` folded into the three `disabled` props; pass `triage.isPending && triage.variables?.itemId === entry.id` from the screen.
- [ ] `mobile/app/wallet/new.tsx` and `edit.tsx`: `onError` on the matcher mutate.
- [ ] Tests: one error-path case per sheet.

**Acceptance criteria**
- [ ] A rejecting reconcile shows text in the sheet; reopening shows an empty field.

**Verification commands**
```bash
cd mobile && npm test -- cash_reconcile_sheet balance_correction_sheet archive_wallet_sheet record_payment_sheet review_card wallet_routes
```

**Do not**
Do not add `dismissable` to the primitives here; that is deferred.

**Rollback**
Revert.

**Open questions**
none

### GAP-080 [CODE] Archiving a wallet with "move transactions" relocates transfer legs and provider balance anchors into the destination wallet

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R3 |
| Confidence | C2 Strong |
| Priority score | 0.4 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 4-6 |

**Location**
- `mobile/lib/db/repos/transactions_repo.ts:531-569` (`reassignWalletTransactions`: blanket `UPDATE ... WHERE wallet_id = ?` plus a signed-sum balance shift)
- `mobile/lib/db/repos/wallets_repo.ts:299-306` (`getBalanceDrift` joins the newest `balance_after` row to the wallet it now belongs to)
- `mobile/components/wallets/archive_wallet_sheet.tsx:121` ("Their amounts and details are unchanged; only the wallet moves.")
- `docs/04-features/02-wallets.md` archive rule 2

**Evidence**
The move updates every row with the source wallet id and shifts the sum between the two balances. It does not look at transfer links or at `balance_after`.

**What is wrong**
A transfer whose other leg already sits in the destination ends up with both legs in one wallet, a self-transfer that moves no money. Rows carrying the source provider's `balance_after` now belong to the destination, so it can show a "Balance mismatch" badge comparing its ledger to another bank's reported figure until its own provider reports again. The sheet copy carries neither caveat. C2 because the drift path was traced by reading, not run.

**Why it matters**
A ledger-shape change with a false reassurance on the sheet.

**Intended behavior**
Legs paired with the destination are skipped or unlinked; moved rows drop their provider balance anchors; the sheet states the limitation.

**Proposed fix**
In `reassignWalletTransactions`, exclude or unlink legs whose counterpart wallet is the destination, and set `balance_after = NULL, computed_balance = NULL` on moved rows. Update the sheet subtitle.

**Implementation checklist**
- [ ] In `mobile/lib/db/repos/transactions_repo.ts`, handle transfer links and null the anchors inside the same transaction.
- [ ] In `mobile/components/wallets/archive_wallet_sheet.tsx`, amend the subtitle.
- [ ] In `mobile/lib/db/repos/__tests__/transactions_repo.test.ts`, add a transfer-leg case and a balance-anchor case.

**Acceptance criteria**
- [ ] After a move, no transfer link has both legs in one wallet and the destination shows no drift badge from the source's anchors.

**Verification commands**
```bash
cd mobile && npm test -- transactions_repo archive_wallet_sheet
```

**Do not**
Do not delete the transfer link rows; unlink through the existing service so both legs stay in the ledger.

**Rollback**
Revert; rows already moved need a manual fix.

**Open questions**
none

### GAP-081 [CODE] The due-rule picker shows an unclamped or empty value while the rule holds a clamped one, and an empty day saves as the first

> **REMEDIATION: DONE** (2026-09-04) - commit 50223eb, branch gap-wave-2. Verification: jest components/bills+goals+support 5 suites 66 tests PASS; fails with sources reverted

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/components/bills/due_rule_picker.tsx:124-126` (`onChange({ ...value, day: clampDay(text) })` while the field keeps its own text state)
- `mobile/components/bills/bill_form.tsx:139` (`canSave` ignores the due rule)

**Evidence**
`LabelledNumber` keeps local text and emits the raw string; the parent stores the clamped integer. "45" or "" stays on screen while the rule holds 31 or 1. `canSave` checks name and amount only.

**What is wrong**
Nothing tells the user their number was replaced; an emptied day saves as "every month on the 1st".

**Why it matters**
Wrong due dates feed reminders and the Safe-to-Spend bills term.

**Intended behavior**
The field refuses digits past the range or re-renders the clamped value, and an empty day blocks save.

**Proposed fix**
Make `LabelledNumber` controlled from `value`, and add a due-rule validity check to `canSave`.

**Implementation checklist**
- [ ] In `mobile/components/bills/due_rule_picker.tsx`, drop the local text state or write the clamped string back.
- [ ] In `mobile/components/bills/bill_form.tsx`, extend `canSave`.
- [ ] In `mobile/components/bills/__tests__/bill_form.test.tsx`, type "45" and "" and assert the field and the save state.

**Acceptance criteria**
- [ ] Typing 45 shows 31; clearing the field disables Save.

**Verification commands**
```bash
cd mobile && npm test -- bill_form due_rule_picker
```

**Do not**
Do not remove the February clamp.

**Rollback**
Revert.

**Open questions**
none

### GAP-082 [CODE] Flat loan "How much?" is required, previewed, then discarded on save

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-029 |
| Blocks | none |
| Est. agent turns | 2-3 |

**Location**
- `mobile/components/loans/loan_form.tsx:482` (`principal: kind === "flat" ? installment * count : principal`), `:240-246` (`canSave` insists on `principal > 0`), `:132` (`loanFormInitialFrom` seeds the field with the stored total on edit)
- `mobile/components/loans/__tests__/loan_form.test.tsx:252-283` (pins the discard as intended)

**Evidence**
For flat loans the principal field stays visible with a peso preview and gates Save, but the submitted principal is installment times count. On edit the field shows the total repayable, not the amount borrowed.

**What is wrong**
The typed cash-borrowed figure is thrown away; the edit form disagrees with what the user borrowed.

**Why it matters**
docs/06-loans.md rule 2 wants total repayable tracked for flat loans; the UI half of GAP-029.

**Intended behavior**
Either hide or relabel the field for flat loans, or persist the borrowed amount separately.

**Proposed fix**
For flat, hide the principal field and drop it from `canSave`; if the owner wants the borrowed figure kept, add it as a separate optional field once GAP-029 settles the balance formula.

**Implementation checklist**
- [ ] In `mobile/components/loans/loan_form.tsx`, hide the field for flat and adjust `canSave`.
- [ ] In `mobile/components/loans/__tests__/loan_form.test.tsx`, replace the discard assertion.

**Acceptance criteria**
- [ ] A flat loan can be saved without typing a principal; edit shows no misleading "How much?".

**Verification commands**
```bash
cd mobile && npm test -- loan_form
```

**Do not**
Do not change how `principal` is stored until GAP-029 lands.

**Rollback**
Revert.

**Open questions**
none

### GAP-083 [CODE] Loan first-due and goal deadline pickers floor at today, so an in-progress loan cannot be entered and an edit re-dates the whole schedule

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2-3 |

**Location**
- `mobile/components/loans/loan_form.tsx:399` (`minimumDate={new Date()}` on first due), `:132` (edit seeds `firstDue` from `schedule[0].dueDate`), `:460-473` (save rebuilds the schedule from `firstDue`)
- `mobile/components/goals/goal_form.tsx:146` (same floor on the deadline)
- `mobile/components/loans/__tests__/loan_form.test.tsx:306-327` (pins the floor on create only)

**Evidence**
A bank loan that started months ago cannot be recorded with its real schedule. On edit the stored first-due is in the past; opening the picker only allows today or later, and saving rebuilds every installment from the new date.

**What is wrong**
Existing loans cannot be entered; editing a live loan silently re-dates it. Past-due goals cannot keep their date.

**Why it matters**
Utang tracking is a headline feature; the doc has no rule forbidding a past first-due.

**Intended behavior**
Edit round-trips without rewriting the schedule; create allows a past first-due with an "N installments already due" hint.

**Proposed fix**
Drop `minimumDate` on edit (or floor at the stored date); on create allow past dates and show the already-due count; same for the goal deadline on edit.

**Implementation checklist**
- [ ] In `mobile/components/loans/loan_form.tsx`, condition `minimumDate` on mode and add the hint.
- [ ] In `mobile/components/goals/goal_form.tsx`, condition the floor on mode.
- [ ] In `loan_form.test.tsx`, add an edit round-trip asserting the schedule dates are unchanged.

**Acceptance criteria**
- [ ] Editing a loan's name leaves every installment date as stored.

**Verification commands**
```bash
cd mobile && npm test -- loan_form goal_form
```

**Do not**
Do not rebuild the schedule on edit unless first-due, count or amount changed.

**Rollback**
Revert.

**Open questions**
none

### GAP-084 [CODE] The payday allocation sheet keeps per-goal state across paydays

> **REMEDIATION: DONE** (2026-09-04) - commit 50223eb, branch gap-wave-2. Verification: same commit; reseeds on a value-based proposal signature, proven to fail when reverted

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/components/goals/allocation_sheet.tsx:47-49` (`rows` state seeded once from `proposals`), `:61-62` (`rowFor` falls back only for unknown ids)
- `mobile/app/_layout.tsx:178-189` (sheet mounted once for the app lifetime; only `visible` toggles)

**Evidence**
The state is keyed by goal id and never reset when `proposals` changes.

**What is wrong**
A goal unchecked or edited on one payday stays that way on the next payday's sheet even though the new proposal differs.

**Why it matters**
Wrong contribution amounts applied to the ledger from stale input.

**Intended behavior**
Each payday's sheet starts from that payday's proposals.

**Proposed fix**
Key the sheet on the payday event id, or reset `rows` in an effect when `proposals` changes. The missing catch on confirm is GAP-078.

**Implementation checklist**
- [ ] In `mobile/components/goals/allocation_sheet.tsx`, reset `rows` when `proposals` changes.
- [ ] In `mobile/components/goals/__tests__/allocation_sheet.test.tsx`, re-render with new proposals and assert the rows follow.

**Acceptance criteria**
- [ ] Test passes.

**Verification commands**
```bash
cd mobile && npm test -- allocation_sheet
```

**Do not**
Do not remount the sheet on every render.

**Rollback**
Revert.

**Open questions**
none

### GAP-085 [FEAT] Bill detail has no manual "mark paid" and omits the due rule, reminder schedule and auto-match summary the doc lists

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 0.5 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 5-7 |

**Location**
- `mobile/app/(tabs)/plan/bills/[id].tsx:107-152` (actions: candidate match, skip, edit, delete)
- `mobile/lib/db/repos/bills_repo.ts:432` (`resolved_external` state exists; `git grep -i "mark paid\|markPaid" mobile` returns nothing)
- `docs/04-features/07-bills.md:31` (detail row contents and actions)
- `mobile/lib/bills/amount_estimator.ts:34-35` (skipped cycles excluded from the estimate)

**Evidence**
A bill paid outside the ledger can only be matched to a scored candidate or skipped. Skip removes the cycle from the estimator. The screen renders none of the due rule, reminder schedule or auto-match summary.

**What is wrong**
A user who pays cash every month either leaves cycles overdue (depressing Safe-to-Spend per rule 5) or skips and corrupts the estimate.

**Why it matters**
Cash bill payment is the common case in the target market.

**Intended behavior**
A "Paid another way" action writing `resolved_external` that clears the cycle without feeding a fake amount, plus the doc-listed rows.

**Proposed fix**
Add the action on unresolved cycles using the existing `resolved_external` path behind the same `cancelCycleReminders` step `useSkipBillCycle` uses; render `dueRule`, `reminderOffsets` and `autoMatchRule` from `status.bill`.

**Implementation checklist**
- [ ] In `mobile/hooks/mutations/`, add `use_mark_bill_paid_externally.ts` invalidating bills and Safe-to-Spend.
- [ ] In `mobile/app/(tabs)/plan/bills/[id].tsx`, add the button and the three rows.
- [ ] In `mobile/app/__tests__/bills_screen.test.tsx`, add the externally-paid case.

**Acceptance criteria**
- [ ] An externally paid cycle leaves the bills term and the estimator unchanged.

**Verification commands**
```bash
cd mobile && npm test -- bills_screen
```

**Do not**
Do not create a synthetic transaction for the external payment.

**Rollback**
Revert.

**Open questions**
none

### GAP-086 [CODE] "Skip this cycle" is one tap with no confirmation or undo, and it moves Safe-to-Spend

> **REMEDIATION: DONE** (2026-09-05) - commit 9d5b6f2, branch gap-wave-5. Verification: jest bills_screen + components/bills + lib/bills 7 suites 130 tests PASS; reverting the two source lines fails all three new tests. Also fixes the four-wave bills_screen header failure

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1 |

**Location**
- `mobile/app/(tabs)/plan/bills/[id].tsx:116-124` (`skip.mutate` straight from `onPress`); `:145-166` (Delete on the same screen uses `ConfirmDialog`)
- `mobile/hooks/mutations/use_skip_bill_cycle.ts:29` (invalidates bills only; no reopen path exists in `bills_repo.ts`)

**Evidence**
Delete is confirmed; Skip, which has no way back, is not. A skipped cycle drops out of the bills term and its reminders are cancelled.

**What is wrong**
A mis-tap silently raises the headline number with no recovery from any screen.

**Why it matters**
Irreversible write on the Safe-to-Spend input.

**Intended behavior**
Confirmation before the write, or an unskip path.

**Proposed fix**
Wrap the skip in the same `ConfirmDialog` pattern as delete. Add `queryKeys.safeToSpend.all` to the hook's invalidation (GAP-058 covers the family; do it here if landing first).

**Implementation checklist**
- [ ] In `mobile/app/(tabs)/plan/bills/[id].tsx`, add the confirm state and dialog.
- [ ] In `mobile/app/__tests__/bills_screen.test.tsx`, assert the dialog appears and the skip runs only on confirm.

**Acceptance criteria**
- [ ] Skip requires a confirm tap.

**Verification commands**
```bash
cd mobile && npm test -- bills_screen
```

**Do not**
Do not add unskip here; GAP-075's undo pattern can be reused later.

**Rollback**
Revert.

**Open questions**
none

### GAP-087 [CONTRA] Free tier sees a permanent "Not enough periods yet to show a trend" card instead of the Plus-locked preview the doc specifies

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2 |

**Location**
- `mobile/lib/reports/reports_service.ts:186-188` (Free receives a single-point trend)
- `mobile/components/reports/trend_line.tsx:64` ("Not enough periods yet to show a trend.")
- `mobile/app/(tabs)/more/reports.tsx:130` (`<TrendLine>` rendered with no `PlusGate`)
- `docs/04-features/10-reports.md:155-156` (trends are Plus; gated views show a locked preview and a Plus prompt)
- `mobile/lib/entitlements.ts:13` (`MVP_TIER` pinned to plus, so the branch is inert today)

**Evidence**
Position A (docs/10): a locked preview with an upsell. Position B (code): a card stating data is insufficient, with no lock badge, unlike the custom-range row and the export button.

**What is wrong**
Every Free user would see a false statement about their data.

**Why it matters**
Inert while the tier is pinned; wrong the day Free ships.

**Authority**
docs/10.

**Blast radius**
Reports screen only.

**Proposed fix**
Wrap `TrendLine` in `PlusGate capability="reports"` on Free, and keep the single-point copy for Plus windows that genuinely have one point.

**Implementation checklist**
- [ ] In `mobile/app/(tabs)/more/reports.tsx`, gate the card.
- [ ] In `mobile/app/__tests__/reports_screen.test.tsx`, add a Free-tier case asserting the lock.

**Acceptance criteria**
- [ ] With the tier override set to free, the trend card shows the locked preview.

**Verification commands**
```bash
cd mobile && npm test -- reports_screen
```

**Do not**
Do not change `MVP_TIER`.

**Rollback**
Revert.

**Open questions**
none

### GAP-088 [CONTRA] The report-a-problem disclosure says nothing else is included, but the wire carries a report id, timestamps, an attempt count and four device headers

> **REMEDIATION: DONE** (2026-09-04) - commit 50223eb, branch gap-wave-2. Verification: same commit; test fails if a wire field gains no disclosure phrase

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1 |

**Location**
- `mobile/components/support/report_problem_form.tsx:165-169` ("Nothing else from the app is included")
- `mobile/services/support_reports.ts:99-114` (`reportId`, `createdAt`, `attemptCount` in the parts)
- `mobile/services/device_info.ts:24-27` (`X-App-Version`, `X-Device-OS`, `X-Device-OS-Version`, `X-Client-Type`)

**Evidence**
The disclosure enumerates title, description, topic and attachments and then makes an absolute claim the wire does not meet.

**What is wrong**
Copy overclaims on the one screen where the user consents to sending data.

**Why it matters**
docs/07 stands on precise disclosure; the extra fields are harmless but the sentence is false.

**Intended behavior**
The sentence lists the extra items.

**Proposed fix**
Rewrite the string to add "plus a report id, when you wrote it, how many send attempts it took, and your app and Android version".

**Implementation checklist**
- [ ] In `mobile/components/support/report_problem_form.tsx`, edit the string.
- [ ] In `mobile/components/support/__tests__/report_problem_form.test.tsx`, assert the disclosure names every key in `supportReportParts` plus the header names.

**Acceptance criteria**
- [ ] Test passes.

**Verification commands**
```bash
cd mobile && npm test -- report_problem_form
```

**Do not**
Do not remove the headers; GAP-021 governs telemetry.

**Rollback**
Revert.

**Open questions**
none

### GAP-089 [CONTRA] The Privacy centre says notifications are being read whenever the switch is on, with no access check and no fix prompt

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 2 |

**Location**
- `mobile/components/privacy/capture_toggle.tsx:43` (`subtitle={enabled === false ? PAUSED_BODY : ACTIVE_BODY}`)
- `mobile/app/(tabs)/more/privacy.tsx:58-61` (reads capture settings, never `useListenerHealth`)
- `mobile/components/privacy/health_card.tsx` (the revoked banner lives only here, behind a separate More row)
- `docs/04-features/01-onboarding.md:31-32` (manual mode and at-risk states)

**Evidence**
The subtitle depends only on `capture_enabled`. A user who declined or lost access sees "Tracking" on with copy stating notifications are being read. Loading (`undefined`) also shows the active copy.

**What is wrong**
The exact "on in the UI, not bound, no prompt" state.

**Why it matters**
The privacy screen is where the user checks what the app does.

**Intended behavior**
The subtitle reflects the live grant; when access is missing the row offers "Open settings".

**Proposed fix**
Pass `health` from `useListenerHealth` into `CaptureToggle`; render a needs-access subtitle and action when `!granted || !serviceConnected`.

**Implementation checklist**
- [ ] In `mobile/app/(tabs)/more/privacy.tsx`, read listener health.
- [ ] In `mobile/components/privacy/capture_toggle.tsx`, add the branch and action.
- [ ] In `mobile/app/__tests__/privacy_screen.test.tsx`, assert the subtitle for granted false.

**Acceptance criteria**
- [ ] With access revoked, the row says access is needed and offers settings.

**Verification commands**
```bash
cd mobile && npm test -- privacy_screen capture_toggle
```

**Do not**
Do not move the health card.

**Rollback**
Revert.

**Open questions**
none

### GAP-090 [CONTRA] The onboarding Done screen overclaims automatic pickup, labels every scope "Monthly limit", and contradicts itself when the limit is null

> **REMEDIATION: DONE** (2026-09-04) - commit e046f84, branch gap-wave-3. Verification: same commit; all three false statements fixed, scope table now shared with the step that asks the cadence

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/app/(onboarding)/done.tsx:149` ("PeraPlano will pick up transactions from these automatically." for any wallet count, regardless of access), `:171` ("Monthly limit:" hardcoded)
- `mobile/components/onboarding/first_limit_form.tsx` (scope picker offers daily, weekly, monthly, annual)
- `docs/04-features/01-onboarding.md:90-91` (step 10: auto-mode copy only in auto mode)

**Evidence**
Nothing on the screen reads `isAccessGranted()`. The first status is labelled monthly whatever its scope. With a null effective limit the header says the limit is active and the body says to add one.

**What is wrong**
Three false statements on the last onboarding screen.

**Why it matters**
Sets the user's expectation of automatic tracking that may not exist.

**Intended behavior**
Access-dependent copy per step 10; scope from the limit; a "waiting on income" line for a null limit.

**Proposed fix**
Read `isAccessGranted()` and branch; label with the scope chip helper; add the null-limit branch.

**Implementation checklist**
- [ ] In `mobile/app/(onboarding)/done.tsx`, implement the three branches.
- [ ] In `mobile/components/onboarding/__tests__/done_step.test.tsx`, add a weekly-limit fixture and a declined-access case.

**Acceptance criteria**
- [ ] A weekly limit is labelled weekly; declined access shows the manual-mode copy.

**Verification commands**
```bash
cd mobile && npm test -- done_step
```

**Do not**
Do not change the completion write.

**Rollback**
Revert.

**Open questions**
none

### GAP-091 [CONTRA] The provider picker and wallet proposals run before notification access exists, so "Apps we've seen" is empty on every fresh install

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | M |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 0.4 |
| Agent suitability | AGENT-ASSISTED |
| Depends on | GAP-067 |
| Blocks | none |
| Est. agent turns | 6-8 |

**Location**
- `mobile/app/(onboarding)/index.tsx` (fresh-install sequence: device lock, phrase, providers, then welcome, how it works, access)
- `mobile/app/(onboarding)/providers.tsx:56` (`listObservedPackages()` before the grant), `:146`
- `mobile/app/(onboarding)/wallets.tsx` (proposals re-derived from the same observed list moments after the grant)
- `docs/04-features/01-onboarding.md:60-67` (steps 6 and 7 after access), `:106` (rule 8: skip the picker when access was declined)

**Evidence**
Observed packages exist only after the listener is bound, which happens several screens later. The picker always shows seed guesses; the wallets step proposes Cash alone and pushes real providers into "Add another" chips. The doc's own "as shipped" note justified the early position by steps not yet built; they are built.

**What is wrong**
Position A (docs): picker after access, one wallet per selected provider. Position B (code): picker before access, always empty observed list. C2 on the wallet outcome (traced by reading).

**Why it matters**
First-run wallet setup is the product's first impression.

**Authority**
docs/01 step order.

**Blast radius**
Onboarding step order and its tests, which pin the current order.

**Proposed fix**
Move the provider step into the numbered flow after access (the reserved slot in `ONBOARDING_STEPS`) and hand its selection to the wallets step; keep the allow-all default for the declined path.

**Implementation checklist**
- [ ] Land GAP-067's idempotency first.
- [ ] In `mobile/lib/onboarding/onboarding_state.ts` and `mobile/app/(onboarding)/_layout.tsx`, reorder the step.
- [ ] In `mobile/app/(onboarding)/wallets.tsx`, derive proposals from the picker's selection.
- [ ] Update `first_run_handoff.test.tsx` and `index.test.tsx` for the new order and add a case where observed packages are non-empty.

**Acceptance criteria**
- [ ] On a fresh install with GCash notifications present, the picker lists GCash under "Apps we've seen".

**Verification commands**
```bash
cd mobile && npm test -- onboarding
```

**Do not**
Do not remove the seed guesses; they cover the declined path.

**Rollback**
Revert.

**Open questions**
- Confirm the target order with the owner before moving the step.

### GAP-092 [CODE] The native provider filter has no getter and no launch re-sync, so an unopenable sealed filter silently becomes allow-all

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D3 Specialist |
| Risk | R2 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-4 |

**Location**
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CapturePrefs.kt:125-126` (`getProviderFilter` returns `emptySet()` when the blob cannot be opened), `:468-474` (`openSealed` swallows every exception)
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/NotificationListenerModule.kt` (setter exported; no getter)
- `mobile/lib/db/repos/app_settings_repo.ts:146` (`paused_provider_packages`, the only JS-readable copy; its comment claims a launch re-sync)
- `mobile/app/(onboarding)/providers.tsx:146` and `mobile/hooks/mutations/use_set_provider_pause.ts` (the only `setProviderFilter` callers; none at launch)

**Evidence**
`git grep setProviderFilter` finds no call in bootstrap, the layout or ingest. A keystore reset, restore onto another device or foreign build makes the sealed blob unopenable and the filter allow-all, while the Privacy switches still show providers paused.

**What is wrong**
The listener captures a provider the UI says is paused, until the user toggles a switch.

**Why it matters**
A privacy setting that silently stops applying.

**Intended behavior**
The per-provider switch state is what the listener honours (docs/11 Flow B).

**Proposed fix**
Push `setProviderFilter(allowedFromSettings)` on app start after unlock, or expose `getProviderFilter()` as an AsyncFunction and reconcile in the capture-settings hook. Fix the two doc comments.

**Implementation checklist**
- [ ] In `mobile/lib/bootstrap.ts`, after unlock, derive the allowed set from `paused_provider_packages` and call `setProviderFilter`.
- [ ] In `CapturePrefs.kt:56-58` and `app_settings_repo.ts:133-134`, correct the comments.
- [ ] Add a JS bootstrap test asserting the call.

**Acceptance criteria**
- [ ] After clearing the sealed prefs on a test device, launching the app restores the paused set.

**Verification commands**
```bash
cd mobile && npm test -- bootstrap
```

**Do not**
Do not change the allow-all fallback itself; it is the safe default when nothing is known.

**Rollback**
Revert.

**Open questions**
none

### GAP-093 [CONTRA] Android Auto Backup is left at its default, so the sealed buffer, the database and the prefs go to Google Drive while docs/07 says nothing leaves the phone

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D3 Specialist |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 1.6 |
| Agent suitability | HUMAN-FIRST |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1 after the decision |

**Location**
- `mobile/app.json` (`android` block has no `allowBackup`; Expo prebuild defaults it to true)
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureBuffer.kt:84-85` (`filesDir/pending_captures.ndjson`), `CapturePrefs.kt:82-83` (`shared_prefs/`)
- `docs/07-privacy-and-compliance.md:11` ("never leaves the phone under any configuration")
- `docs/superpowers/plans/2026-08-20-on-device-ai-assistant.md:1046` (notes `allowBackup` is unset)

**Evidence**
With the default, Auto Backup uploads `files/`, `shared_prefs/` and `databases/`. Contents are ciphertext and Keystore keys do not travel. C2: library default, not observed in a built manifest.

**What is wrong**
Position A (docs/07): nothing leaves the phone. Position B (code): encrypted blobs may be uploaded. A restored install lands in GAP-092's allow-all filter with a database only the phrase can open.

**Why it matters**
A privacy claim in absolute terms; also a possible restore path the owner may want.

**Authority**
Owner: disable backup, or keep it and document that encrypted blobs may be included and that the phrase restores them.

**Blast radius**
One manifest attribute; the docs/07 sentence.

**Proposed fix**
Either set `"allowBackup": false` in `mobile/app.json` with a plugin test asserting it, or add a `dataExtractionRules` file excluding the three directories, or amend docs/07 §4.

**Implementation checklist**
- [ ] Owner decides.
- [ ] Apply the app.json change or the doc sentence.
- [ ] If disabling: extend `mobile/modules/notification_listener/__tests__/app_plugin.test.ts` to assert the attribute.

**Acceptance criteria**
- [ ] docs/07:11 and the built manifest agree.

**Verification commands**
```bash
cd mobile && npm test -- app_plugin
```

**Do not**
Do not add `fullBackupContent` and `dataExtractionRules` both; pick one per target SDK.

**Rollback**
Revert.

**Open questions**
- Disable backup or document it as an encrypted restore path? (Wave 0.)

### GAP-094 [CODE] The listener re-seals and syncs the prefs file on every re-post of an ongoing notification, on the main thread, and inflates the seen count

> **REMEDIATION: DONE** (2026-09-05) - commit cbe7b5e, branch gap-wave-6. Verification: jest modules 4 suites 64 tests PASS (JS consumers only; they mock the native module). KOTLIN NOT COMPILED AND NOT RUN - no Gradle project exists in a worktree. The 5 new Kotlin tests are verified by reading only. Narrower than the entry proposed: the skip is gated on isOngoing, because applying it to ordinary posts would collapse two genuine notifications seconds apart and break an existing 60s-interval test

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D3 Specialist |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 1.6 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/PeraPlanoNotificationListenerService.kt:269` (`recordObservedPackage` runs before the `isOngoing` return at `:275`)
- `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CapturePrefs.kt:263-286` (`recordObservedPackage` decodes, re-seals and commits the whole file; `count` increments per delivery at `:273`)

**Evidence**
Media players, downloads and navigation re-post an ongoing notification about once a second; each re-post costs a full re-seal plus fsync on the main thread (the class doc measured 3.8 ms plus sync). The count the picker uses to separate a bank from a one-off is dominated by whichever app re-posts most. C2 because re-post frequency depends on the apps installed.

**What is wrong**
Unbounded main-thread I/O in a listener that must stay responsive, and a picker signal that means the wrong thing.

**Why it matters**
Listener responsiveness is the capture path; the picker feeds onboarding.

**Intended behavior**
One write per new fact; `count` means distinct posts.

**Proposed fix**
Skip the write when the package is already first in the list and `lastSeenAt` is within a short window, and do not increment on `isOngoing` re-posts.

**Implementation checklist**
- [ ] In `PeraPlanoNotificationListenerService.kt`, record once on first sight and skip on `isOngoing` re-posts.
- [ ] In `CapturePrefs.kt`, add the recency short-circuit.
- [ ] In `CapturePrefsTest.kt` and the service test, pin write frequency.

**Acceptance criteria**
- [ ] Ten re-posts of one ongoing notification produce one prefs write and a count of one.

**Verification commands**
```bash
# Gradle: run the notification_listener JVM unit tests (task name per docs/13)
```

**Do not**
Do not move the recording after the ongoing check entirely; first sight of a package still matters for the picker.

**Rollback**
Revert.

**Open questions**
none

### GAP-095 [CODE] Manual entry freezes the day at mount, so a save after midnight is stamped at the previous day's midnight

> **REMEDIATION: DONE** (2026-09-04) - commit e046f84, branch gap-wave-3. Verification: same commit; test genuinely crosses midnight (23:58 mount, 00:02 save); GAP-060 submit guard untouched

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | XS |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 2.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Location**
- `mobile/components/transactions/manual_entry_form.tsx:162` (`useState(() => localDayOf(now))`)
- `mobile/lib/transactions/manual_entry.ts:141-161` (`occurredAtFor` returns the start of the chosen local day)
- `mobile/components/transactions/transaction_row.tsx:230` (prints the time, so a midnight stamp shows as 12:00 AM)

**Evidence**
A form opened at 23:58 and saved at 00:02 keeps yesterday's day, and the row is stamped 00:00 of that day rather than the save instant. Every deliberately backdated entry also carries a fabricated 12:00 AM.

**What is wrong**
Ledger rows dated on the wrong day, with a time that looks real.

**Why it matters**
Day boundaries drive period bucketing and the seven-day bars.

**Intended behavior**
Untouched date follows the clock until the user picks one; today's entries carry the save instant; backdated rows do not display a fabricated time.

**Proposed fix**
Track whether the user touched the date; derive the default from `now` on each render; in the row, hide the time for rows stamped exactly at local midnight.

**Implementation checklist**
- [ ] In `mobile/components/transactions/manual_entry_form.tsx`, add a `dateTouched` flag.
- [ ] In `mobile/components/transactions/transaction_row.tsx`, suppress the time at local midnight.
- [ ] In `manual_entry_form.test.tsx`, add a cross-midnight case with a mocked clock.

**Acceptance criteria**
- [ ] With the clock advanced across midnight after mount, the saved row carries the new day.

**Verification commands**
```bash
cd mobile && npm test -- manual_entry_form transaction_row
```

**Do not**
Do not change `occurredAtFor` for explicitly backdated entries.

**Rollback**
Revert.

**Open questions**
none

### GAP-096 [TEST] Listener module tests do not discriminate the failure modes the code documents

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | GAP-062 |
| Blocks | none |
| Est. agent turns | 4-6 |

**Location**
- `CapturePrefsTest.kt:349-438` (migration seal-success path only; `CapturePrefs.kt:387-391` claims a failing seal writes nothing)
- `CaptureBufferTest.kt:228-283` (corrupt-line skip; no dead-private-key case, the seam that hides GAP-059)
- `CaptureEnvelopeTest.kt:190-195` (`assertThrows(Exception::class.java)`; short-line and overrun guards at `CaptureEnvelope.kt:126,133` untested)
- `NotificationListenerModuleTest.kt:556-557` (`drainAsTheBridgeDoes` bypasses the `mapKeyErrors` wrapping)
- `__tests__/index.test.ts:444-449,700-706` (sync `openAccessSettings` and `openSecuritySettings`; Kotlin bodies call `startActivity` with no try)
- `AppLabelsTest.kt` (the `RuntimeException` branch at `AppLabels.kt:125-129` never exercised)
- `KeyStoreBridgeInstrumentedTest.kt` (no invalidation case; GAP-039)

All paths under `mobile/modules/notification_listener/android/src/test/java/expo/modules/notificationlistener/` unless stated.

**Evidence**
Each listed claim in a class doc has no discriminating assertion.

**What is wrong**
The suite passes with the GAP-059 defect present and would pass with several documented guarantees broken.

**Why it matters**
This module is the capture path and the keystore boundary.

**Intended behavior**
One discriminating test per documented never-throw or preserve-on-failure claim.

**Proposed fix**
Add a `FakeKeyVault` variant whose key getters throw specific exception types; add short-line and overrun tests for `CaptureEnvelope.open`; narrow the `assertThrows` type; wrap the two `startActivity` bodies in try/catch mapping `ActivityNotFoundException` and test both sides.

**Implementation checklist**
- [ ] `FakeKeyVault.kt`: throwing variants.
- [ ] `CaptureBufferTest.kt`: dead-key drain case (lands with GAP-059).
- [ ] `CaptureEnvelopeTest.kt`: guard cases and a specific exception type.
- [ ] `CapturePrefsTest.kt`: seal-failure migration case.
- [ ] `NotificationListenerModule.kt`: try/catch around `startActivity`; tests on both sides.
- [ ] `AppLabelsTest.kt`: exception branch.

**Acceptance criteria**
- [ ] JVM suite green with the new cases; a fake dead key fails the drain test before GAP-059 and passes after.

**Verification commands**
```bash
# Gradle: run the notification_listener JVM unit tests (task name per docs/13)
cd mobile && npm test -- modules/notification_listener
```

**Do not**
Do not loosen existing assertions.

**Rollback**
Revert.

**Open questions**
none

### GAP-097 [TEST] Screen tests use fixtures that cannot distinguish the defect from the fix

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 1.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-5 |

**Location**
- `mobile/app/__tests__/bills_screen.test.tsx:242-268` (match fixture equals the estimate; asserts the DB, not the rendered history) and `:304-318` (skip passes with or without a confirmation)
- `mobile/app/__tests__/loan_routes.test.tsx:511-545` (adjustment test never reads `loan-detail-paid`; no row reads a schedule balance)
- `mobile/app/__tests__/limit_routes.test.tsx:489-500` (`getAllByText` with base equal to effective)
- `mobile/components/transactions/__tests__/ledger_list.test.tsx:164-171` (09:00 local is the same UTC day in Manila; no `TZ` pinned in the Jest config)
- `mobile/components/review/__tests__/review_card.test.tsx:1053-1082` (fee asserted as 0 without typing one)
- `mobile/components/reports/__tests__/charts.test.tsx:202` (`queryByTestId("trend-path")` targets an id that no component emits)
- `mobile/lib/__tests__/safe_to_spend_service.test.ts:320-337` (average equals payday; GAP-070)
- `mobile/lib/__tests__/safe_to_spend.test.ts:267-279` (asserts `perDay` 0 but not the state)
- `mobile/components/onboarding/__tests__/access_step.test.tsx:163` and `done_step.test.tsx:55-62` (pin behaviour that contradicts docs/01)
- `mobile/components/loans/__tests__/loan_form.test.tsx:252-283,306-327` (pin GAP-082 and GAP-083 as intended)
- `mobile/app/(onboarding)/__tests__/setup_flow_e2e.test.tsx` (single uninterrupted pass; no relaunch)

**Evidence**
Each assertion passes under both the current and the corrected behaviour, or targets nothing.

**What is wrong**
The suite would not catch regressions in the numbers users read.

**Why it matters**
Twenty-five minutes of Jest that cannot fail on a wrong "Paid so far".

**Intended behavior**
Fixtures whose values differ; assertions on rendered testIDs; a pinned time zone; negative assertions that target live ids.

**Proposed fix**
Change fixtures and assertions as listed; set `process.env.TZ = "Asia/Manila"` in the Jest setup; replace the dead testID with `queryAllByTestId(/^trend-point-/)`.

**Implementation checklist**
- [ ] Jest setup: pin TZ.
- [ ] Each file above: the listed change, landing together with the gap it pins where one exists.

**Acceptance criteria**
- [ ] Reverting GAP-063, 064 or 065 fails at least one test.

**Verification commands**
```bash
cd mobile && npm test -- bills_screen loan_routes limit_routes ledger_list review_card charts
```

**Do not**
Do not delete tests to make the suite green.

**Rollback**
Revert.

**Open questions**
none

### GAP-098 [CODE] Limit alert state is read-modify-write with no serialisation, so a mute or base refresh can be overwritten by a concurrent ledger pass

| Field | Value |
|---|---|
| Severity | S3 Moderate |
| Complexity | S |
| Difficulty | D2 Standard |
| Risk | R2 |
| Confidence | C2 Strong |
| Priority score | 0.8 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 3-4 |

**Location**
- `mobile/lib/limits/limit_service.ts:183-227` (`recomputeLimits` reads the alert state, awaits `sumSpend` and `filtersFor`, then persists the whole object), `:318-332` (`muteLimitForPeriod`), `:350-364` (`refreshLimitBase`)
- `mobile/lib/limits/limit_ledger_subscriber.ts:82-95` (trailing-edge debounce; no in-flight guard, and the two UI entry points do not go through it)
- `docs/04-features/03-limits.md` rules 11 and 25

**Evidence**
`git grep -n "withUnitOfWork\|withTransaction\|inFlight" mobile/lib/limits/limit_service.ts` returns nothing. The subscriber restarts a timer per commit and calls `runLimitPass` without awaiting a running pass. The mute and base-refresh paths load the state object, change one field, and write the whole object back.

**What is wrong**
A mute tapped while a pass sits between its read and its write is persisted as muted and then overwritten with the pass's unmuted copy. The same window loses an income-edit base re-snapshot until the next period boundary. C2: the interleaving was traced by reading; the pass takes two awaited SQL reads, so the window is real but short.

**Why it matters**
Rule 11 says a mute lasts until the period boundary; rule 25 says a manual edit re-snapshots immediately. Last-writer-wins can discard either, and the user sees the alert they just muted.

**Intended behavior**
State writes for one limit are serialised, or the UI writes are partial updates of the row.

**Proposed fix**
Route every alert-state write through one promise-chained queue per limit (a module-level chain in `limit_ledger_subscriber.ts` that `muteLimitForPeriod` and `refreshLimitBase` also enqueue), or change the two UI paths to `UPDATE` the single column instead of replacing the object.

**Implementation checklist**
- [ ] In `mobile/lib/limits/limit_service.ts`, add a per-limit promise chain and wrap `recomputeLimits`, `muteLimitForPeriod` and `refreshLimitBase` in it.
- [ ] In `mobile/lib/limits/__tests__/limit_service.test.ts`, add a case that starts a recompute with a slow `sumSpend`, calls `muteLimitForPeriod` mid-flight, and asserts `muted` survives.

**Acceptance criteria**
- [ ] The interleaved test passes; sequential tests unchanged.

**Verification commands**
```bash
cd mobile && npm test -- limit_service limit_ledger_subscriber
```

**Do not**
Do not hold a SQLite transaction open across the `sumSpend` awaits; serialise in JS.

**Rollback**
Revert.

**Open questions**
none

### GAP-099 [SEC] The full-database export writes a plaintext JSON dump to the cache directory, never deletes it, and reports success when sharing is unavailable

> **REMEDIATION: DONE** (2026-09-04) - commit 3ed6f64, branch worktree-gap-wave-1. Verification: jest lib/privacy 2 suites 18 tests PASS plus privacy_screen 17; all three added tests fail with the implementation reverted. Rest of lib/privacy checked, no other occurrence

| Field | Value |
|---|---|
| Severity | S2 Major |
| Complexity | XS |
| Difficulty | D1 Mechanical |
| Risk | R1 |
| Confidence | C1 Verified |
| Priority score | 5.0 |
| Agent suitability | AGENT-READY |
| Depends on | none |
| Blocks | none |
| Est. agent turns | 1-2 |

**Provenance**
Not from the original audit. Found on 2026-09-04 by the agent fixing GAP-073/GAP-074, which
share this defect's shape, and confirmed by direct read before being written up here.

**Location**
- `mobile/lib/privacy/data_export.ts` `exportAllData` (the write, the unguarded share and the
  missing delete are all in that one function; re-read it rather than trusting a line number)

**Evidence**
`exportAllData` builds a bundle of every exportable table, `JSON.stringify`s it, writes it to
`${cacheDirectory}peraplano-export-<date>.json`, then shares it only `if (await
Sharing.isAvailableAsync())` and returns the uri. There is no `deleteAsync`, and the
`isAvailableAsync` false branch falls through to `return fileUri` with no error, so the caller
reports success. The function's own header says it copies `exportTransactionsCsv`'s
cache-directory-then-share approach.

**What is wrong**
The same two defects GAP-073 fixed in the CSV path, against a strictly larger payload. The CSV
export covers one date range of transactions; this covers every exportable table.

**Why it matters**
docs/12-encryption-and-app-lock.md states that everything at rest is ciphertext. This leaves a
complete plaintext copy of the user's finances in the app sandbox indefinitely, defeating the
database encryption for anyone with device-level access (root, ADB, forensic extraction, or a
future backup rule change). The silent-success branch additionally tells a user their data was
exported when nothing left the app.

Scoring note: rated S2 rather than GAP-073's S3 because the payload is the whole database and
because it contradicts a stated encryption guarantee. The file lands in the app's private cache
directory, which Android excludes from Auto Backup by default, so this is not a cloud exposure.
Rescore if that reasoning does not match the owner's threat model.

**Intended behavior**
Availability checked before the write, so nothing is written on a device that cannot share; the
file deleted in a `finally` so a failed or cancelled share does not strand it; an unavailable
share sheet raises rather than resolving.

**Proposed fix**
Apply the GAP-073 shape verbatim. See commit `a45be16` for the pattern already accepted in
`csv_export.ts`.

**Implementation checklist**
- [ ] Move `Sharing.isAvailableAsync()` ahead of the write and throw when it is false.
- [ ] Wrap `shareAsync` in `try/finally` and `deleteAsync(fileUri, { idempotent: true })`.
- [ ] Correct the JSDoc claim that the returned uri names a readable file.
- [ ] Check whether the wipe path in the same module has the same shape.
- [ ] Add tests mirroring the three GAP-073 lifecycle tests.

**Acceptance criteria**
- [ ] No code path leaves a file in `cacheDirectory` after `exportAllData` resolves or rejects.
- [ ] An unavailable share sheet raises instead of returning a uri.
- [ ] `jest lib/privacy` passes and the new tests fail with the fix reverted.

**Verification commands**
```bash
cd mobile && npx jest --ci lib/privacy
```

**Do not**
Do not encrypt the export file as a substitute; the user is deliberately exporting plaintext to
another app. The fix is that it must not OUTLIVE the share.

**Rollback**
Revert. No data impact.

**Open questions**
none


## 10. Deferred and rejected

Considered and not listed, with the reason.

- Raw-capture purge runs only at app launch (`bootstrap.ts:93-118`) while docs/02 §4.1 says a scheduled job. Rejected: rows exist only after a launch and the native buffer is capped at 500, so a device that never launches holds no unpurged rows; the next launch purges. A one-line doc note belongs in GAP-045's pass if wanted.
- Beta-signup limiter keyed on `x-forwarded-for` (`route.ts:59-63`) is client-controlled on staging's bare port. Deferred: documented in the file header, no staging deployment exists, and nginx sets the header in production.
- Support form has no "do not paste notification text" warning (docs/07 §2.3 row). Deferred as S4 copy; the wire whitelist is tested.
- Tier literal comparisons at `plus_gate.tsx:63`, `reports_service.ts:140-214`, `more/index.tsx:347` instead of named capabilities. Deferred: `plus_gate` is the gate component and reports use it for a real branch; cosmetic.
- Money formatters accept a non-integer silently (`amount_text.tsx:51-66`, `peso_input.ts:101-106`, `csv_export.ts:176-181`) and recurring monthly factors are float before one round (`recurring_service.ts:66-68`, `:268-272`). Deferred: no caller passes a float today and a numeric sweep found no wrong result; add integer guards when either file is next touched.
- Share and donut percent labels can sum to 99 or 101 (`share_bar.tsx:20-23`, `donut_chart.tsx:163`). Rejected: display-only.
- Three whole-peso formatters diverge (`alert_copy.ts:47`, `limit_consistency.ts:92`, `csv_export.ts:176`). Deferred: each is documented; consolidation is a refactor, not a defect.
- Dev harness (`app/dev_harness.tsx`) in the tree. Rejected: gated by `EXPO_PUBLIC_DEV_HARNESS` at Metro time and proven absent from production by `verify_harness_absent.ps1` (docs/13).
- `more/shared_budgets.tsx` "Soon" screen. Rejected: deliberate design board with a written rationale.
- GitHub Actions versions in `deploy.yml` (`checkout@v7`, `setup-node@v7`, `build-push-action@v7`) differ from `server-ci.yml` (`@v4`). Deferred: could not verify which tags exist without network; Dependabot (GAP-046) will surface it.
- `node:22-alpine` base image by tag, not digest. Deferred into GAP-046's Dependabot scope.
- Plan screens render no query-error state (all four panels and detail screens; grep for `isError` returns nothing). Deferred: a failed read falls to the empty state; GAP-013's toast covers writes, and a read-error banner is a small follow-up once the pattern exists.
- Cash legs can auto-link as transfers (`transfer_detector.ts:36-40` admits it; docs/03 §7 rule 6). Deferred as S4 C2: needs a wallet-kind signal the detector no longer has; revisit with GAP-045's wallet-traits doc pass.
- Bills: cross-bill conflict prompt (doc rule 18) and auto-acknowledge of a matching recurring pattern on manual bill creation (rule 29) are absent. Deferred as S4 C2.
- Reports: trend 6/12 toggle, net toggle, tap-to-period, category drill-down (docs/10 lines 51-56). Deferred: interaction polish on a Plus surface; no data risk.
- `Date.parse(`${iso}T00:00:00`)` used in five places instead of `parseDateIso` (`bills_service.ts:325-326`, `loans_service.ts:287`, `:397`, `safe_to_spend_service.ts:212-213`, `bill_form.tsx:131`). Deferred: correct on Node and on current Hermes; replace opportunistically when those files are next edited.
- Dead `mobile/lib/privacy/data_wipe.ts` (header says it is no longer the wipe; only its test calls it). Deferred: delete or rename when `lib/privacy` is next touched.
- The `expo-updates` `checkAutomatically` default and the alerts-unwired note in docs/09 §2b.2 are folded into GAP-028 and GAP-045.
- `mobile/lib/ingest/amount.ts` refuses amounts with three or more fraction digits and has no sign handling. Rejected: matches the PHP-only, two-centavo spec; a provider that formats otherwise is a ruleset matter.
- Docs/13 has a stale "Measured: ____" in the Gate B body (line about 383-395) although both session tables carry values. Folded into GAP-039's Session 3 write-up.

Pass-2 deferrals (S4; each has a citation in the analyst's pass-2 notes and can be promoted later):

- Safe-to-Spend engine: a positive numerator smaller than the day count yields a zero hero in Healthy or Tight styling (`safe_to_spend.ts:215,280-290`); a wallet-only filtered limit deducts every bill and no contribution (`safe_to_spend_service.ts:131-143`, bills carry no wallet); projection bill markers ignore the driving limit's category scope and the caption prints a raw ISO date (`safe_to_spend_projection.ts:94-96`, `projection_sparkline.tsx:55-57`).
- Alerts: burst state is read before and written after several awaits in `alerts_service.ts:303-330`, so two concurrent posts can leave two summaries; quiet-hours steppers can reach start equal to end, which the policy treats as no window while the switch says on (`more/settings.tsx`, `notification_policy.ts:88-97`).
- Support outbox: retry timestamps use flush-start time, so a timed-out upload retries after one second instead of one minute (`outbox_runner.ts:118-121,247`).
- Reports: top merchants keyed on the raw merchant string split case variants (`aggregate.ts:294-311`, C3); the empty state disagrees with docs/06:236 and its own catalogue entry (`empty_states.tsx:523-529`); the custom range end date is unbounded above (`range_picker.tsx:565-575`).
- Kotlin: `drain` ignores the result of `file.delete()`, redelivering the batch on a failed delete (`CaptureBuffer.kt:145-152`; absorbed by the JS replay guard).
- Onboarding and lock: recovery-word inputs lack `importantForAutofill="no"` and the display words are `selectable` (adjacent to GAP-017); the access step offers no in-flow "Try again" after a decline (docs/01 rule 5; `access.tsx`).
- Tabs: goal delete has no confirmation unlike the other three entities (`plan/goals/[id].tsx:94-103`); Free caps count settled loans and reached goals (`utang_panel.tsx:45-48`, `goals_panel.tsx:49-52`; inert while the tier is pinned); the Free subscriptions preview prints "0 recurring payments spotted" while loading (`more/subscriptions.tsx:118-120`).
- Review and transactions: the correct sheet's reset effect re-fires when a late capture query resolves, wiping in-progress edits (`correct_sheet.tsx:313-334`); raw notification text is rendered expanded on every unknown-provider card for up to 30 days while the detail panel keeps it collapsed (`review_card.tsx:648-704`, docs/07:171); the expired-capture notice says the text "was automatically deleted" while the row stays until the next launch purge (`why_recorded_panel.tsx:77-78`, `bootstrap.ts:116`).
- Wallets and forms: wallet detail "See all N" links to the unfiltered Transactions tab (`wallet/[id].tsx:675-691`); the wallet edit form remounts when matchers arrive, discarding first-frame keystrokes (`wallet/[id]/edit.tsx:136-140`); percent-of-income limits and loan rate and term accept any magnitude (`limit_input.ts:2-10`, `loan_form.tsx:227-246`).
- UI primitives: `BottomSheet` and `ConfirmDialog` have no `dismissable` or busy guard (observation; pair with GAP-079 if a caller needs it); no toast primitive exists yet, so GAP-013 should design queueing from the start.
- Residue sweep: `KeyStoreBridgeInstrumentedTest.kt` cannot be green in one connected run (one test needs no recent authentication at `:126-133`, two need the ten-second window at `:163-177` and `:215-232`), and its KDoc at `:150-152` disagrees with the ten-second figure in `DrainBenchmarkInstrumentedTest.kt:26-29`; fold into GAP-039's session write-up. Goal pace drops a kinsenas payday that falls on today (`goal_math.ts:93` filters `anchor > now` on local-midnight anchors from `cadence_detector.ts:80-85`) while a deadline of today counts as open (`:179-182`); `goal_math.test.ts:129-141` never puts `now` on an anchor day.
- Checked in pass 2 and found consistent with the docs (no finding): `peso_input.ts` parsing and caps, `formatCentavos`, `date_field` local round trip, month picker bounds, CSV BOM, CRLF, RFC 4180 quoting, half-open range and local time, transfers exported once per leg, no raw notification text in the CSV, quiet-hours midnight wrap, alert dedupe windows, lock-screen copy variants, the support wire whitelist, the parse-stats schema, and the Kotlin prefs migration (single commit, seal failure returns before any edit).

## 11. Machine-readable appendix

```json
[
{"id":"GAP-001","category":"OPS","title":"Uncommitted app.json and EAS tooling changes duplicate permissions, add RECORD_AUDIO, and add an iOS build job","severity":"S2","complexity":"XS","difficulty":"D1","risk":"R1","confidence":"C1","priority":5.0,"suitability":"AGENT-READY","depends_on":[],"blocks":["GAP-028"],"files":["mobile/app.json","mobile/.eas/workflows/create-production-builds.yml"]},
{"id":"GAP-002","category":"SEC","title":"Persisted query cache can be encrypted under a zeroed key when a write is in flight at lock time","severity":"S1","complexity":"S","difficulty":"D3","risk":"R2","confidence":"C2","priority":3.2,"suitability":"AGENT-ASSISTED","depends_on":[],"blocks":["GAP-049"],"files":["mobile/lib/crypto/cache_cipher.ts","mobile/lib/query_client.ts","mobile/lib/crypto/__tests__/cache_cipher.test.ts","mobile/contexts/__tests__/lock_context.test.tsx"]},
{"id":"GAP-003","category":"FEAT","title":"POST_NOTIFICATIONS is never requested, so no alert can display on Android 13+","severity":"S2","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":2.5,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/onboarding/onboarding_state.ts","mobile/app/(onboarding)/alerts.tsx","mobile/app/(onboarding)/_layout.tsx","mobile/app/(tabs)/more/index.tsx","docs/04-features/01-onboarding.md"]},
{"id":"GAP-004","category":"CONTRA","title":"Automatic income drift re-snapshots percent-of-income limit bases mid-period","severity":"S2","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":2.5,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/income/income_service.ts","mobile/lib/income/__tests__/income_service.test.ts"]},
{"id":"GAP-005","category":"CODE","title":"Safe-to-Spend goal-contribution term has no Plus gate","severity":"S3","complexity":"XS","difficulty":"D1","risk":"R1","confidence":"C1","priority":2.0,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/safe_to_spend_service.ts","mobile/lib/__tests__/safe_to_spend_service.test.ts"]},
{"id":"GAP-006","category":"CODE","title":"Percent-of-income limit base is computed in float then floored, dropping one peso on some pairs","severity":"S3","complexity":"XS","difficulty":"D1","risk":"R1","confidence":"C1","priority":2.0,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/limits/limit_engine.ts","mobile/lib/limits/__tests__/limit_engine_basis.test.ts"]},
{"id":"GAP-007","category":"DOC","title":"docs/DEPLOYMENT.md still says master has no server directory","severity":"S3","complexity":"XS","difficulty":"D1","risk":"R1","confidence":"C1","priority":2.0,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["docs/DEPLOYMENT.md"]},
{"id":"GAP-008","category":"CODE","title":"Fortnightly recurring patterns are forgotten before their next charge is due","severity":"S3","complexity":"XS","difficulty":"D1","risk":"R1","confidence":"C2","priority":1.6,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/recurring/recurring_service.ts","mobile/lib/recurring/__tests__/recurring_service.test.ts"]},
{"id":"GAP-009","category":"CODE","title":"Loan interest rate field has no unit label and is silently monthly","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C2","priority":1.6,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/components/loans/loan_form.tsx","mobile/types/domain.ts","mobile/components/loans/__tests__/loan_form.test.tsx"]},
{"id":"GAP-010","category":"FEAT","title":"Cash reconciliation prompts are never scheduled","severity":"S2","complexity":"M","difficulty":"D2","risk":"R1","confidence":"C1","priority":1.25,"suitability":"AGENT-READY","depends_on":[],"blocks":["GAP-032"],"files":["mobile/lib/wallets/reconcile_scheduler.ts","mobile/lib/db/repos/app_settings_repo.ts","mobile/lib/db/repos/wallets_repo.ts","mobile/app/_layout.tsx","mobile/components/wallets/wallet_card.tsx","docs/04-features/02-wallets.md"]},
{"id":"GAP-011","category":"CODE","title":"A stored raw capture whose stages throw is never reprocessed and is rejected as a replay forever","severity":"S2","complexity":"M","difficulty":"D2","risk":"R2","confidence":"C1","priority":1.25,"suitability":"AGENT-READY","depends_on":[],"blocks":["GAP-012","GAP-035","GAP-040","GAP-048"],"files":["mobile/lib/ingest/pipeline.ts","mobile/lib/db/repos/raw_notifications_repo.ts","mobile/lib/ingest/__tests__/pipeline.test.ts","mobile/lib/db/repos/__tests__/raw_notifications_repo.test.ts"]},
{"id":"GAP-012","category":"CODE","title":"Push and SMS twin with the first leg still queued produces two cards and two commits","severity":"S2","complexity":"M","difficulty":"D2","risk":"R2","confidence":"C1","priority":1.25,"suitability":"AGENT-READY","depends_on":["GAP-011"],"blocks":["GAP-031","GAP-040"],"files":["mobile/lib/ingest/pipeline.ts","mobile/lib/review/resolve_actions.ts","mobile/lib/db/repos/review_queue_repo.ts","mobile/types/domain.ts","docs/04-features/08-review-queue.md"]},
{"id":"GAP-013","category":"CODE","title":"Mutation failures are silent on about thirty screens","severity":"S2","complexity":"M","difficulty":"D2","risk":"R2","confidence":"C1","priority":1.25,"suitability":"AGENT-READY","depends_on":["GAP-002"],"blocks":["GAP-049"],"files":["mobile/lib/query_client.ts","mobile/components/ui/mutation_error_toast.tsx","mobile/app/_layout.tsx","mobile/hooks/mutations/","mobile/lib/__tests__/query_client.test.ts"]},
{"id":"GAP-014","category":"SEC","title":"Remote parser ruleset is accepted without schema, size, tunable-range or regex bounds","severity":"S2","complexity":"M","difficulty":"D2","risk":"R3","confidence":"C1","priority":1.25,"suitability":"AGENT-READY","depends_on":[],"blocks":["GAP-043","GAP-057"],"files":["mobile/services/parser_rules.ts","mobile/lib/ingest/ruleset_schema.ts","mobile/lib/ingest/parser.ts","mobile/services/__tests__/parser_rules.test.ts","mobile/package.json"]},
{"id":"GAP-015","category":"DOC","title":"docs/12 overclaims new-device recovery and Kotlin recovery tests","severity":"S3","complexity":"S","difficulty":"D1","risk":"R1","confidence":"C1","priority":1.0,"suitability":"AGENT-READY","depends_on":[],"blocks":["GAP-030"],"files":["docs/12-encryption-and-app-lock.md"]},
{"id":"GAP-016","category":"DOC","title":"docs/03 promises a survivor field union and balance-after cross-check that are not built","severity":"S3","complexity":"S","difficulty":"D1","risk":"R1","confidence":"C1","priority":1.0,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["docs/03-ingest-pipeline.md","docs/09-v2-backlog.md"]},
{"id":"GAP-017","category":"SEC","title":"Recovery words go to the OS share sheet and the phrase screens allow screenshots","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1.0,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/(onboarding)/recovery_phrase.tsx","mobile/components/onboarding/phrase_display.tsx","mobile/components/onboarding/phrase_confirm.tsx","mobile/components/lock/recovery_unlock_form.tsx","mobile/components/onboarding/__tests__/recovery_phrase.test.tsx","mobile/package.json"]},
{"id":"GAP-018","category":"FEAT","title":"Skipped onboarding grants cannot be completed later from Settings","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1.0,"suitability":"AGENT-READY","depends_on":["GAP-003"],"blocks":[],"files":["mobile/lib/onboarding/battery_settings.ts","mobile/app/(onboarding)/battery.tsx","mobile/app/(tabs)/more/permissions.tsx","mobile/app/(tabs)/more/index.tsx","mobile/app/__tests__/permissions_screen.test.tsx","docs/04-features/11-settings-privacy.md"]},
{"id":"GAP-019","category":"SEC","title":"Web site sends no security headers","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1.0,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["server/apps/web/next.config.ts","server/apps/web/__tests__/security_headers.test.ts","server/smoke/routes.smoke.test.ts","docs/nginx/peraplano-production.conf"]},
{"id":"GAP-020","category":"FEAT","title":"Percent-of-payday goal contribution rules cannot be created in the UI","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1.0,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/components/goals/goal_form.tsx","mobile/components/goals/__tests__/goal_form.test.tsx"]},
{"id":"GAP-021","category":"CONTRA","title":"Telemetry defaults to on while the docs list the default as undecided","severity":"S3","complexity":"S","difficulty":"D4","risk":"R1","confidence":"C1","priority":1.0,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":[],"files":["mobile/lib/db/repos/app_settings_repo.ts","mobile/app/(onboarding)/how_it_works.tsx","docs/07-privacy-and-compliance.md","server/apps/web/components/pages/privacy_page.tsx"]},
{"id":"GAP-022","category":"CONTRA","title":"Wallet deletion is archive-only in code but the UI says Delete and the doc specifies delete-with-reassign","severity":"S3","complexity":"S","difficulty":"D4","risk":"R1","confidence":"C1","priority":1.0,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":["GAP-036","GAP-045"],"files":["mobile/app/wallet/[id].tsx","mobile/components/wallets/archive_wallet_sheet.tsx","mobile/app/wallet/[id]/edit.tsx","docs/04-features/02-wallets.md"]},
{"id":"GAP-023","category":"CONTRA","title":"Limits are created at four cadences at once; the doc and the Free cap describe one","severity":"S3","complexity":"S","difficulty":"D4","risk":"R1","confidence":"C1","priority":1.0,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":["GAP-045"],"files":["mobile/components/plan/limits_panel.tsx","mobile/app/(onboarding)/first_limit.tsx","docs/04-features/03-limits.md"]},
{"id":"GAP-024","category":"CONTRA","title":"Free-tier reports show the current month only; the doc promises a 90-day window","severity":"S3","complexity":"S","difficulty":"D4","risk":"R1","confidence":"C1","priority":1.0,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":[],"files":["mobile/lib/reports/reports_service.ts","docs/04-features/10-reports.md","docs/04-features/02-wallets.md"]},
{"id":"GAP-025","category":"CONTRA","title":"Categorizer resolves rule conflicts by recency; the doc says specificity first","severity":"S4","complexity":"XS","difficulty":"D4","risk":"R1","confidence":"C1","priority":1.0,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":[],"files":["mobile/lib/ingest/categorizer.ts","docs/04-features/08-review-queue.md"]},
{"id":"GAP-026","category":"CONTRA","title":"Free caps are 1 in code and 3 on the design board","severity":"S4","complexity":"XS","difficulty":"D4","risk":"R1","confidence":"C1","priority":1.0,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":[],"files":["mobile/lib/entitlements.ts","docs/pera-plano-mobile/PeraPlano Mobile UI.dc.html","docs/05-monetization.md"]},
{"id":"GAP-027","category":"PROJ","title":"Function and field names are camelCase throughout while the stated convention is snake_case","severity":"S4","complexity":"XS","difficulty":"D4","risk":"R1","confidence":"C1","priority":1.0,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":["GAP-046"],"files":["CLAUDE.md"]},
{"id":"GAP-028","category":"SEC","title":"expo-updates adds an undocumented egress and an OTA channel with no rollback runbook or policy hook","severity":"S2","complexity":"M","difficulty":"D2","risk":"R2","confidence":"C2","priority":1.0,"suitability":"AGENT-ASSISTED","depends_on":["GAP-001"],"blocks":[],"files":["mobile/app.json","docs/07-privacy-and-compliance.md","docs/OTA_RUNBOOK.md","mobile/services/device_info.ts"]},
{"id":"GAP-029","category":"CONTRA","title":"Loan outstanding balance ignores flat total repayable and amortized interest","severity":"S2","complexity":"M","difficulty":"D2","risk":"R2","confidence":"C2","priority":1.0,"suitability":"AGENT-ASSISTED","depends_on":[],"blocks":["GAP-033"],"files":["mobile/lib/db/repos/loans_repo.ts","mobile/lib/loans/loans_service.ts","mobile/components/loans/loan_card.tsx"]},
{"id":"GAP-030","category":"CONTRA","title":"Locked state is incomplete: no background timer and the in-memory query cache is kept","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1.0,"suitability":"AGENT-ASSISTED","depends_on":["GAP-015"],"blocks":["GAP-034"],"files":["mobile/contexts/lock_context.tsx","mobile/contexts/__tests__/lock_context.test.tsx","docs/12-encryption-and-app-lock.md"]},
{"id":"GAP-031","category":"CODE","title":"linkTransfer overwrites an existing link on either leg","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1.0,"suitability":"AGENT-READY","depends_on":["GAP-012"],"blocks":[],"files":["mobile/lib/db/repos/transfer_links_repo.ts","mobile/lib/review/resolve_actions.ts"]},
{"id":"GAP-032","category":"FEAT","title":"Out-of-order balance-after notifications re-anchor the wallet","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1.0,"suitability":"AGENT-READY","depends_on":["GAP-010"],"blocks":["GAP-047"],"files":["mobile/lib/db/repos/transactions_repo.ts","mobile/lib/db/repos/wallets_repo.ts"]},
{"id":"GAP-033","category":"FEAT","title":"Confirming a loan payment match creates no UserRule","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1.0,"suitability":"AGENT-READY","depends_on":["GAP-029"],"blocks":[],"files":["mobile/types/domain.ts","mobile/lib/db/repos/user_rules_repo.ts","mobile/lib/loans/loan_match_queue.ts","mobile/lib/loans/loans_service.ts"]},
{"id":"GAP-034","category":"CODE","title":"A key-state read failure leaves the user on an unlock screen with no wipe route","severity":"S3","complexity":"S","difficulty":"D3","risk":"R2","confidence":"C1","priority":1.0,"suitability":"AGENT-ASSISTED","depends_on":["GAP-030"],"blocks":[],"files":["mobile/contexts/lock_context.tsx","mobile/app/lock.tsx"]},
{"id":"GAP-035","category":"CODE","title":"A capture with no notification key falls back to id-only replay detection","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C2","priority":0.8,"suitability":"AGENT-READY","depends_on":["GAP-011"],"blocks":[],"files":["mobile/lib/db/repos/raw_notifications_repo.ts","mobile/lib/db/repos/__tests__/raw_notifications_repo.test.ts"]},
{"id":"GAP-036","category":"FEAT","title":"Archiving a wallet does not list linked goals, loans or income sources","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C2","priority":0.8,"suitability":"AGENT-READY","depends_on":["GAP-022"],"blocks":[],"files":["mobile/components/wallets/archive_wallet_sheet.tsx","mobile/app/wallet/[id].tsx"]},
{"id":"GAP-037","category":"FEAT","title":"Manual income override never gets the 20 percent divergence suggestion","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C2","priority":0.8,"suitability":"AGENT-READY","depends_on":["GAP-004"],"blocks":[],"files":["mobile/lib/income/income_service.ts"]},
{"id":"GAP-038","category":"FEAT","title":"Goals have no Complete action; the card copy promises one","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C2","priority":0.8,"suitability":"AGENT-READY","depends_on":[],"blocks":["GAP-055"],"files":["mobile/app/(tabs)/plan/goals/[id].tsx","mobile/lib/db/repos/goals_repo.ts","mobile/components/goals/goal_card.tsx","mobile/components/plan/archived_section.tsx","docs/04-features/05-goals-savings.md"]},
{"id":"GAP-039","category":"TEST","title":"Encryption ship gates in docs/13 Parts 4, 5 and 8 are still NOT RUN","severity":"S3","complexity":"S","difficulty":"D3","risk":"R1","confidence":"C2","priority":0.8,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":[],"files":["docs/13-on-device-verification.md"]},
{"id":"GAP-040","category":"CODE","title":"The drain-to-store loop is not one transaction; a kill mid-loop loses the rest of the batch","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C2","priority":0.8,"suitability":"AGENT-READY","depends_on":["GAP-012"],"blocks":["GAP-048"],"files":["mobile/lib/ingest/pipeline.ts"]},
{"id":"GAP-041","category":"CODE","title":"Rollover carryover is zero when the previous period wrote no alert state","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C2","priority":0.8,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/limits/limit_service.ts"]},
{"id":"GAP-042","category":"CODE","title":"Group summary notifications are captured alongside their children","severity":"S3","complexity":"S","difficulty":"D3","risk":"R2","confidence":"C2","priority":0.8,"suitability":"HUMAN-FIRST","depends_on":["GAP-050"],"blocks":[],"files":["mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/PeraPlanoNotificationListenerService.kt","mobile/modules/notification_listener/android/src/test/java/expo/modules/notificationlistener/PeraPlanoNotificationListenerServiceTest.kt"]},
{"id":"GAP-043","category":"CONTRA","title":"Ruleset integrity verification and staged rollout are promised and absent","severity":"S2","complexity":"L","difficulty":"D4","risk":"R3","confidence":"C1","priority":0.71,"suitability":"HUMAN-FIRST","depends_on":["GAP-014"],"blocks":[],"files":["mobile/services/parser_rules.ts","mobile/lib/db/repos/parser_rulesets_repo.ts","docs/03-ingest-pipeline.md"]},
{"id":"GAP-044","category":"OPS","title":"Migrations are forward-only with no guard for an older build opening a newer database","severity":"S2","complexity":"L","difficulty":"D2","risk":"R4","confidence":"C1","priority":0.71,"suitability":"AGENT-ASSISTED","depends_on":[],"blocks":["GAP-055","GAP-056","GAP-057"],"files":["mobile/lib/db/migrations.ts","mobile/lib/bootstrap.ts","mobile/app/_layout.tsx","mobile/lib/db/__tests__/migrations.test.ts","docs/OTA_RUNBOOK.md"]},
{"id":"GAP-045","category":"DOC","title":"Feature docs still describe the wallet type enum and other retired shapes","severity":"S3","complexity":"M","difficulty":"D1","risk":"R1","confidence":"C1","priority":0.5,"suitability":"AGENT-READY","depends_on":["GAP-022","GAP-023"],"blocks":[],"files":["docs/04-features/02-wallets.md","docs/04-features/03-limits.md","docs/04-features/05-goals-savings.md","docs/04-features/07-bills.md","docs/04-features/10-reports.md","docs/06-information-architecture.md","docs/02-domain-model.md","docs/04-features/01-onboarding.md","docs/09-v2-backlog.md","mobile/lib/reports/csv_export.ts"]},
{"id":"GAP-046","category":"PROJ","title":"Repository hygiene: merged branches, version mismatch, stale root handoff, duplicated docs, no dependency bot","severity":"S4","complexity":"S","difficulty":"D1","risk":"R1","confidence":"C1","priority":0.5,"suitability":"AGENT-READY","depends_on":["GAP-027"],"blocks":[],"files":["HANDOFF.md","mobile/package.json","docs/pera-plano-mobile/uploads/","docs/pera-plano-web/uploads/",".github/dependabot.yml","CLAUDE.md"]},
{"id":"GAP-047","category":"CODE","title":"Income windows and the history floor are measured in milliseconds from now rather than local days","severity":"S4","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":0.5,"suitability":"AGENT-READY","depends_on":["GAP-032"],"blocks":[],"files":["mobile/lib/income/income_math.ts","mobile/lib/income/cadence_detector.ts","mobile/lib/income/income_service.ts","mobile/lib/db/repos/transactions_repo.ts"]},
{"id":"GAP-048","category":"CODE","title":"The buffered ingest path skips the pause and dismissed-package checks the live path applies","severity":"S4","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":0.5,"suitability":"AGENT-READY","depends_on":["GAP-040"],"blocks":[],"files":["mobile/lib/ingest/pipeline.ts"]},
{"id":"GAP-049","category":"CODE","title":"The persisted query cache dehydrates every query, including raw notification text","severity":"S4","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":0.5,"suitability":"AGENT-READY","depends_on":["GAP-013"],"blocks":[],"files":["mobile/lib/query_client.ts","mobile/constants/query_keys.ts","mobile/hooks/queries/"]},
{"id":"GAP-050","category":"CONTRA","title":"No active-notification snapshot catch-up when the listener reconnects","severity":"S3","complexity":"M","difficulty":"D3","risk":"R2","confidence":"C1","priority":0.5,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":["GAP-042"],"files":["mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/PeraPlanoNotificationListenerService.kt","docs/13-on-device-verification.md"]},
{"id":"GAP-051","category":"OPS","title":"The native capture buffer evicts the oldest capture at 500 with no signal to the user","severity":"S3","complexity":"M","difficulty":"D3","risk":"R2","confidence":"C1","priority":0.5,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":[],"files":["mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureBuffer.kt","mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/NotificationListenerModule.kt","mobile/modules/notification_listener/index.ts","mobile/app/(tabs)/more/listener_health.tsx"]},
{"id":"GAP-052","category":"TEST","title":"Seven pre-existing flaky UI test failures and one typecheck error on clean master","severity":"S3","complexity":"M","difficulty":"D2","risk":"R1","confidence":"C2","priority":0.4,"suitability":"AGENT-ASSISTED","depends_on":[],"blocks":["GAP-053"],"files":["mobile/app/__tests__/bills_screen.test.tsx","mobile/app/__tests__/transactions_screen.test.tsx","mobile/app/__tests__/home_screen.test.tsx","mobile/app/__tests__/review_queue.test.tsx","mobile/components/gates/__tests__/gates.test.tsx","mobile/test_support/jest_setup.ts"]},
{"id":"GAP-053","category":"OPS","title":"No mobile CI workflow exists","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1.0,"order_override":"blocked by GAP-052","suitability":"AGENT-READY","depends_on":["GAP-052"],"blocks":[],"files":[".github/workflows/mobile-ci.yml"]},
{"id":"GAP-054","category":"CONTRA","title":"Cloud backup is described as built and Plus-gated; no code exists","severity":"S3","complexity":"L","difficulty":"D4","risk":"R3","confidence":"C1","priority":0.29,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":[],"files":["docs/01-mvp-scope.md","docs/05-monetization.md","docs/07-privacy-and-compliance.md","docs/12-encryption-and-app-lock.md","docs/00-product-brief.md"]},
{"id":"GAP-055","category":"FEAT","title":"Goal milestone notifications do not exist","severity":"S3","complexity":"L","difficulty":"D2","risk":"R4","confidence":"C1","priority":0.29,"suitability":"AGENT-ASSISTED","depends_on":["GAP-003","GAP-038","GAP-044"],"blocks":["GAP-056"],"files":["mobile/lib/db/migrations/019_goal_milestones.sql","mobile/lib/db/migrations.ts","mobile/lib/db/repos/goals_repo.ts","mobile/lib/goals/goal_milestone_subscriber.ts","mobile/lib/alerts/channels.ts","mobile/lib/alerts/alert_copy.ts","mobile/app/_layout.tsx"]},
{"id":"GAP-056","category":"FEAT","title":"Planned payday contributions have no pending, completed, skipped or expired lifecycle","severity":"S3","complexity":"L","difficulty":"D2","risk":"R4","confidence":"C1","priority":0.29,"suitability":"AGENT-ASSISTED","depends_on":["GAP-044","GAP-055"],"blocks":["GAP-057"],"files":["mobile/lib/db/migrations/020_planned_contributions.sql","mobile/lib/db/migrations.ts","mobile/lib/db/repos/planned_contributions_repo.ts","mobile/lib/goals/goals_service.ts","mobile/lib/safe_to_spend_service.ts","mobile/components/goals/allocation_sheet.tsx"]},
{"id":"GAP-057","category":"CODE","title":"Boundary casts stand in for validation and the review resolution is discarded","severity":"S4","complexity":"M","difficulty":"D2","risk":"R3","confidence":"C1","priority":0.25,"suitability":"AGENT-ASSISTED","depends_on":["GAP-014","GAP-044","GAP-056"],"blocks":[],"files":["mobile/types/db_json_schemas.ts","mobile/lib/db/repos/user_rules_repo.ts","mobile/lib/db/mappers.ts","mobile/lib/db/migrations/021_review_resolution.sql","mobile/lib/db/migrations.ts","mobile/lib/db/repos/review_queue_repo.ts","mobile/lib/ingest/pipeline.ts"]},
{"id":"GAP-058","category":"CODE","title":"Safe-to-Spend query is never invalidated by any mutation and the Plus projection input is never refreshed","severity":"S2","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":2.5,"suitability":"AGENT-READY","depends_on":[],"blocks":["GAP-066"],"files":["mobile/app/(tabs)/index.tsx","mobile/hooks/queries/use_safe_to_spend_input.ts","mobile/hooks/mutations/use_update_limit.ts","mobile/lib/query_client.ts","docs/04-features/09-safe-to-spend.md","mobile/hooks/__tests__/hooks.test.tsx"]},
{"id":"GAP-059","category":"SEC","title":"Capture keypair is never regenerated after keystore invalidation, and a dead-key drain deletes the buffer and resolves empty","severity":"S2","complexity":"M","difficulty":"D3","risk":"R4","confidence":"C2","priority":1,"suitability":"AGENT-ASSISTED","depends_on":[],"blocks":[],"files":["mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/KeyVault.kt","mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureBuffer.kt","mobile/lib/crypto/key_manager.ts","mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/NotificationListenerModule.kt","docs/12-encryption-and-app-lock.md","mobile/modules/notification_listener/index.ts"]},
{"id":"GAP-060","category":"CODE","title":"Manual entry Save has no in-flight guard, so a double tap writes two entries","severity":"S2","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":2.5,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/components/transactions/manual_entry_form.tsx","mobile/app/transaction/new.tsx","mobile/components/transactions/__tests__/manual_entry_form.test.tsx"]},
{"id":"GAP-061","category":"CONTRA","title":"Transaction detail edits only note and category and has no delete, while docs/07 promises every parsed field is editable","severity":"S2","complexity":"M","difficulty":"D4","risk":"R3","confidence":"C1","priority":1.25,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":[],"files":["mobile/app/transaction/[id].tsx","docs/07-privacy-and-compliance.md","mobile/lib/db/repos/transactions_repo.ts","mobile/app/__tests__/transaction_detail.test.tsx"]},
{"id":"GAP-062","category":"TEST","title":"NotificationListenerModuleTest still pins the eight-key record contract; the record now emits nine keys and two JVM tests fail","severity":"S3","complexity":"XS","difficulty":"D1","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":["GAP-096"],"files":["mobile/modules/notification_listener/android/src/test/java/expo/modules/notificationlistener/NotificationListenerModuleTest.kt","mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureRecord.kt"]},
{"id":"GAP-063","category":"CODE","title":"Loan schedule table prints a zero balance on every row","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/(tabs)/plan/loans/[id].tsx","mobile/components/loans/schedule_table.tsx","mobile/lib/loans/loan_math.ts","mobile/app/__tests__/loan_routes.test.tsx"]},
{"id":"GAP-064","category":"CODE","title":"Loan \"Paid so far\" and the next-installment pointer are derived by subtraction and go wrong after a balance adjustment","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/(tabs)/plan/loans/[id].tsx","mobile/lib/db/repos/loans_repo.ts","mobile/lib/loans/loans_service.ts","docs/04-features/06-loans.md","mobile/app/__tests__/loan_routes.test.tsx"]},
{"id":"GAP-065","category":"CODE","title":"Bill payment history prints the current estimate on every row instead of the matched transaction amount","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/(tabs)/plan/bills/[id].tsx","mobile/lib/bills/bills_service.ts","mobile/types/domain.ts","docs/04-features/07-bills.md","mobile/app/__tests__/bills_screen.test.tsx"]},
{"id":"GAP-066","category":"CODE","title":"Home refreshes only the hero on focus and on pull, with no resume or midnight trigger for the other cards","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C2","priority":0.8,"suitability":"AGENT-READY","depends_on":["GAP-058"],"blocks":[],"files":["mobile/app/(tabs)/index.tsx","mobile/lib/query_client.ts","mobile/hooks/queries/use_bills.ts"]},
{"id":"GAP-067","category":"CONTRA","title":"Onboarding is not resumable, and a second pass re-runs the wallet and first-limit writes","severity":"S3","complexity":"M","difficulty":"D2","risk":"R2","confidence":"C1","priority":0.5,"suitability":"AGENT-ASSISTED","depends_on":[],"blocks":["GAP-091"],"files":["mobile/lib/onboarding/onboarding_state.ts","mobile/contexts/lock_context.tsx","mobile/app/_layout.tsx","mobile/app/(onboarding)/wallets.tsx","mobile/lib/db/repos/wallets_repo.ts","mobile/app/(onboarding)/first_limit.tsx","docs/04-features/01-onboarding.md","mobile/lib/db/repos/app_settings_repo.ts","mobile/app/(onboarding)/index.tsx","mobile/app/(onboarding)/__tests__/setup_flow_e2e.test.tsx"]},
{"id":"GAP-068","category":"SEC","title":"No secure-window flag anywhere, so the ledger is visible in the Recents thumbnail and screenshots while unlocked","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C2","priority":0.8,"suitability":"AGENT-ASSISTED","depends_on":[],"blocks":[],"files":["mobile/contexts/lock_context.tsx","mobile/app/_layout.tsx","docs/12-encryption-and-app-lock.md"]},
{"id":"GAP-069","category":"FEAT","title":"Tapping any app notification never navigates; the alert route resolver has no caller","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/alerts/alert_routes.ts","mobile/app/_layout.tsx","docs/06-information-architecture.md","mobile/app/__tests__/lock_gate.test.tsx"]},
{"id":"GAP-070","category":"CODE","title":"Percent contribution rules reserve a share of the income profile average, not the pay that landed","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/safe_to_spend_service.ts","mobile/lib/__tests__/safe_to_spend_service.test.ts","docs/04-features/05-goals-savings.md","docs/04-features/09-safe-to-spend.md"]},
{"id":"GAP-071","category":"CODE","title":"The tracking-interrupted notice fires on a fresh install before access is granted, and its 24-hour cap is written even when nothing was posted","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/alerts/tracking_health_subscriber.ts","mobile/lib/db/repos/app_settings_repo.ts","mobile/lib/alerts/tracking_notifier.ts","mobile/app/_layout.tsx","mobile/lib/alerts/__tests__/tracking_health_subscriber.test.ts"]},
{"id":"GAP-072","category":"CONTRA","title":"Support attachments are plaintext screenshot copies inside the app sandbox while docs/12 says everything at rest is ciphertext","severity":"S3","complexity":"M","difficulty":"D3","risk":"R2","confidence":"C1","priority":0.5,"suitability":"AGENT-ASSISTED","depends_on":[],"blocks":[],"files":["mobile/lib/support/attachments.ts","mobile/lib/support/outbox_runner.ts","mobile/app/(tabs)/more/report_problem.tsx","mobile/hooks/use_support_attachment_draft.ts","docs/12-encryption-and-app-lock.md"]},
{"id":"GAP-073","category":"SEC","title":"The CSV export stays in the cache directory as a plaintext ledger copy and reports success when sharing is unavailable","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/reports/csv_export.ts","mobile/lib/reports/__tests__/csv_export.test.ts","mobile/components/reports/export_button.tsx"]},
{"id":"GAP-074","category":"SEC","title":"The CSV export does not neutralise spreadsheet formula injection in free-text columns","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/reports/csv_export.ts","docs/04-features/10-reports.md","mobile/lib/reports/__tests__/csv_export.test.ts"]},
{"id":"GAP-075","category":"FEAT","title":"Review triage has no undo; docs/08 rule 9 promises a ten-second undo affordance","severity":"S3","complexity":"M","difficulty":"D2","risk":"R2","confidence":"C1","priority":0.5,"suitability":"AGENT-READY","depends_on":["GAP-013"],"blocks":[],"files":["mobile/components/review/review_card.tsx","mobile/hooks/mutations/use_review_action.ts","mobile/lib/db/repos/review_queue_repo.ts","docs/04-features/08-review-queue.md","mobile/lib/review/resolve_actions.ts","mobile/app/review/index.tsx","mobile/app/__tests__/review_queue.test.tsx"]},
{"id":"GAP-076","category":"CODE","title":"Rows in an archived wallet show \"Unknown wallet\" on detail and in the transfer candidate list","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/transaction/[id].tsx","mobile/hooks/queries/use_wallets.ts","mobile/components/transactions/transfer_link_actions.tsx","mobile/app/(tabs)/transactions.tsx","mobile/app/__tests__/transaction_detail.test.tsx"]},
{"id":"GAP-077","category":"CODE","title":"Category correction and rule creation are two independent writes; a failed recategorise still creates the rule","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/transaction/[id].tsx","mobile/app/__tests__/transaction_detail.test.tsx"]},
{"id":"GAP-078","category":"CODE","title":"Bare-promise writes outside mutation hooks swallow failures into dead or misleading screens","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/contexts/lock_context.tsx","mobile/components/lock/recovery_unlock_form.tsx","mobile/lib/security/wipe.ts","mobile/app/(onboarding)/done.tsx","mobile/app/(onboarding)/index.tsx","mobile/app/_layout.tsx","mobile/app/(onboarding)/access.tsx","mobile/app/transaction/new.tsx"]},
{"id":"GAP-079","category":"CODE","title":"Sheets keep stale state and stay open after a failed write, and their confirm buttons stay tappable while pending","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":["GAP-013"],"blocks":[],"files":["mobile/components/wallets/cash_reconcile_sheet.tsx","mobile/components/wallets/archive_wallet_sheet.tsx","mobile/app/wallet/[id].tsx","mobile/components/loans/record_payment_sheet.tsx","mobile/app/wallet/new.tsx","mobile/app/wallet/[id]/edit.tsx","mobile/components/review/review_card.tsx","mobile/hooks/mutations/use_review_action.ts"]},
{"id":"GAP-080","category":"CODE","title":"Archiving a wallet with \"move transactions\" relocates transfer legs and provider balance anchors into the destination wallet","severity":"S3","complexity":"M","difficulty":"D2","risk":"R3","confidence":"C2","priority":0.4,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/db/repos/transactions_repo.ts","mobile/lib/db/repos/wallets_repo.ts","mobile/components/wallets/archive_wallet_sheet.tsx","docs/04-features/02-wallets.md","mobile/lib/db/repos/__tests__/transactions_repo.test.ts"]},
{"id":"GAP-081","category":"CODE","title":"The due-rule picker shows an unclamped or empty value while the rule holds a clamped one, and an empty day saves as the first","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/components/bills/due_rule_picker.tsx","mobile/components/bills/bill_form.tsx","mobile/components/bills/__tests__/bill_form.test.tsx"]},
{"id":"GAP-082","category":"CODE","title":"Flat loan \"How much?\" is required, previewed, then discarded on save","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":["GAP-029"],"blocks":[],"files":["mobile/components/loans/loan_form.tsx","mobile/components/loans/__tests__/loan_form.test.tsx"]},
{"id":"GAP-083","category":"CODE","title":"Loan first-due and goal deadline pickers floor at today, so an in-progress loan cannot be entered and an edit re-dates the whole schedule","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/components/loans/loan_form.tsx","mobile/components/goals/goal_form.tsx","mobile/components/loans/__tests__/loan_form.test.tsx"]},
{"id":"GAP-084","category":"CODE","title":"The payday allocation sheet keeps per-goal state across paydays","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/components/goals/allocation_sheet.tsx","mobile/app/_layout.tsx","mobile/components/goals/__tests__/allocation_sheet.test.tsx"]},
{"id":"GAP-085","category":"FEAT","title":"Bill detail has no manual \"mark paid\" and omits the due rule, reminder schedule and auto-match summary the doc lists","severity":"S3","complexity":"M","difficulty":"D2","risk":"R2","confidence":"C1","priority":0.5,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/(tabs)/plan/bills/[id].tsx","mobile/lib/db/repos/bills_repo.ts","docs/04-features/07-bills.md","mobile/lib/bills/amount_estimator.ts","mobile/app/__tests__/bills_screen.test.tsx"]},
{"id":"GAP-086","category":"CODE","title":"\"Skip this cycle\" is one tap with no confirmation or undo, and it moves Safe-to-Spend","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/(tabs)/plan/bills/[id].tsx","mobile/hooks/mutations/use_skip_bill_cycle.ts","mobile/app/__tests__/bills_screen.test.tsx"]},
{"id":"GAP-087","category":"CONTRA","title":"Free tier sees a permanent \"Not enough periods yet to show a trend\" card instead of the Plus-locked preview the doc specifies","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/reports/reports_service.ts","mobile/components/reports/trend_line.tsx","mobile/app/(tabs)/more/reports.tsx","docs/04-features/10-reports.md","mobile/lib/entitlements.ts","mobile/app/__tests__/reports_screen.test.tsx"]},
{"id":"GAP-088","category":"CONTRA","title":"The report-a-problem disclosure says nothing else is included, but the wire carries a report id, timestamps, an attempt count and four device headers","severity":"S3","complexity":"XS","difficulty":"D1","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/components/support/report_problem_form.tsx","mobile/services/support_reports.ts","mobile/services/device_info.ts","mobile/components/support/__tests__/report_problem_form.test.tsx"]},
{"id":"GAP-089","category":"CONTRA","title":"The Privacy centre says notifications are being read whenever the switch is on, with no access check and no fix prompt","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/components/privacy/capture_toggle.tsx","mobile/app/(tabs)/more/privacy.tsx","mobile/components/privacy/health_card.tsx","docs/04-features/01-onboarding.md","mobile/app/__tests__/privacy_screen.test.tsx"]},
{"id":"GAP-090","category":"CONTRA","title":"The onboarding Done screen overclaims automatic pickup, labels every scope \"Monthly limit\", and contradicts itself when the limit is null","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/(onboarding)/done.tsx","mobile/components/onboarding/first_limit_form.tsx","docs/04-features/01-onboarding.md","mobile/components/onboarding/__tests__/done_step.test.tsx"]},
{"id":"GAP-091","category":"CONTRA","title":"The provider picker and wallet proposals run before notification access exists, so \"Apps we've seen\" is empty on every fresh install","severity":"S3","complexity":"M","difficulty":"D2","risk":"R2","confidence":"C2","priority":0.4,"suitability":"AGENT-ASSISTED","depends_on":["GAP-067"],"blocks":[],"files":["mobile/app/(onboarding)/index.tsx","mobile/app/(onboarding)/providers.tsx","mobile/app/(onboarding)/wallets.tsx","docs/04-features/01-onboarding.md","mobile/lib/onboarding/onboarding_state.ts","mobile/app/(onboarding)/_layout.tsx"]},
{"id":"GAP-092","category":"CODE","title":"The native provider filter has no getter and no launch re-sync, so an unopenable sealed filter silently becomes allow-all","severity":"S3","complexity":"S","difficulty":"D3","risk":"R2","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CapturePrefs.kt","mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/NotificationListenerModule.kt","mobile/lib/db/repos/app_settings_repo.ts","mobile/app/(onboarding)/providers.tsx","mobile/hooks/mutations/use_set_provider_pause.ts","mobile/lib/bootstrap.ts"]},
{"id":"GAP-093","category":"CONTRA","title":"Android Auto Backup is left at its default, so the sealed buffer, the database and the prefs go to Google Drive while docs/07 says nothing leaves the phone","severity":"S3","complexity":"XS","difficulty":"D3","risk":"R2","confidence":"C2","priority":1.6,"suitability":"HUMAN-FIRST","depends_on":[],"blocks":[],"files":["mobile/app.json","mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureBuffer.kt","docs/07-privacy-and-compliance.md","docs/superpowers/plans/2026-08-20-on-device-ai-assistant.md","mobile/modules/notification_listener/__tests__/app_plugin.test.ts"]},
{"id":"GAP-094","category":"CODE","title":"The listener re-seals and syncs the prefs file on every re-post of an ongoing notification, on the main thread, and inflates the seen count","severity":"S3","complexity":"XS","difficulty":"D3","risk":"R2","confidence":"C2","priority":1.6,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/PeraPlanoNotificationListenerService.kt","mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CapturePrefs.kt"]},
{"id":"GAP-095","category":"CODE","title":"Manual entry freezes the day at mount, so a save after midnight is stamped at the previous day's midnight","severity":"S3","complexity":"XS","difficulty":"D2","risk":"R1","confidence":"C1","priority":2,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/components/transactions/manual_entry_form.tsx","mobile/lib/transactions/manual_entry.ts","mobile/components/transactions/transaction_row.tsx"]},
{"id":"GAP-096","category":"TEST","title":"Listener module tests do not discriminate the failure modes the code documents","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":["GAP-062"],"blocks":[],"files":[]},
{"id":"GAP-097","category":"TEST","title":"Screen tests use fixtures that cannot distinguish the defect from the fix","severity":"S3","complexity":"S","difficulty":"D2","risk":"R1","confidence":"C1","priority":1,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/app/__tests__/bills_screen.test.tsx","mobile/app/__tests__/loan_routes.test.tsx","mobile/app/__tests__/limit_routes.test.tsx","mobile/components/transactions/__tests__/ledger_list.test.tsx","mobile/components/review/__tests__/review_card.test.tsx","mobile/components/reports/__tests__/charts.test.tsx","mobile/lib/__tests__/safe_to_spend_service.test.ts","mobile/lib/__tests__/safe_to_spend.test.ts","mobile/components/onboarding/__tests__/access_step.test.tsx","mobile/components/loans/__tests__/loan_form.test.tsx","mobile/app/(onboarding)/__tests__/setup_flow_e2e.test.tsx"]},
{"id":"GAP-098","category":"CODE","title":"Limit alert state is read-modify-write with no serialisation, so a mute or base refresh can be overwritten by a concurrent ledger pass","severity":"S3","complexity":"S","difficulty":"D2","risk":"R2","confidence":"C2","priority":0.8,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/limits/limit_service.ts","mobile/lib/limits/limit_ledger_subscriber.ts","docs/04-features/03-limits.md","mobile/lib/limits/__tests__/limit_service.test.ts"]}
,
{"id":"GAP-099","category":"SEC","title":"The full-database export writes a plaintext JSON dump to the cache directory, never deletes it, and reports success when sharing is unavailable","severity":"S2","complexity":"XS","difficulty":"D1","risk":"R1","confidence":"C1","priority":5.0,"suitability":"AGENT-READY","depends_on":[],"blocks":[],"files":["mobile/lib/privacy/data_export.ts","mobile/lib/privacy/__tests__/data_export.test.ts"]}
]
```

## 12. Self-audit note

Checked against the quality bar before returning:

- Every gap has a unique ID, at least one location, and all six scores. Verified by counting the 57 entries against the master index and the JSON appendix (57 objects).
- Priority arithmetic was recomputed for every row from the stated weights; ties were broken by risk then difficulty. One order override is recorded (GAP-053 after GAP-052).
- No dependency is ordered after its dependent except the recorded override; every `depends_on` points at a lower or equal wave.
- Every wave lists its file set; the one shared file in Wave 3 (`mobile/package.json` for GAP-014 and GAP-017) is called out with a rebase instruction rather than hidden.
- Every checklist item names a file. Verification commands are limited to the six the prompt vouches for plus the Gradle placeholder comment; no Gradle task name was invented.
- Every AGENT-READY entry has zero open questions. Entries with an owner question are HUMAN-FIRST or AGENT-ASSISTED and say so.
- Every CONTRA entry has both positions, an authority call, a blast radius, and a decision line in section 8.
- No entry proposes moving ledger data off the device; the two entries that touch egress (GAP-021 telemetry, GAP-028 updates) are decision briefs.
- The JSON appendix was written to match the prose entries one to one; each object's `files` list matches the entry's checklist.
- Counts in the front matter (57; S1 1, S2 12, S3 36, S4 8; CODE 17, FEAT 11, TEST 2, SEC 5, OPS 4, DOC 4, PROJ 2, CONTRA 12) were recounted from the master index.

Revisions during self-audit: 9 entries revised, 6 dropped or merged.

- Dropped to Deferred: the plan-screen query-error state (folded into the GAP-013 follow-up), the cash-leg auto-link contradiction (C2, S4), the bills conflict and auto-acknowledge pair (C2, S4), the reports interaction set, the `Date.parse` template seam, and the dead `data_wipe.ts` module. Each had a real citation but would have been a formatting-grade row above real defects because of how the formula treats XS work.
- Merged: five wall-clock window seams into GAP-047 (one root cause); ten doc-drift pairs into GAP-045; the money glossary, katapusan wording and stale backlog note into the same entry; the docs/12 recovery overclaim and the testing-section overclaim into GAP-015.
- Re-scored: GAP-006 from S2 to S3 with the reason stated in the entry (one peso, safe direction, 0.004 percent of pairs); GAP-044 from S1 to S2 because the ledger file survives and a re-upgrade recovers it; GAP-041 from C1 to C2 after confirming that status reads also persist alert state, which narrows the failing case to a period with no app open at all; GAP-002 kept at S1 after re-reading the rubric's plaintext-at-rest line.
- Reworded: GAP-013's fix from "add onError to 49 hooks" to a single cache-level handler after checking that `MutationCache` exists in the installed TanStack version; GAP-003's fix from "request on home mount" to a dedicated onboarding step after re-reading the doc's Step 4.
- Confidence honesty: everything that rests on library defaults (expo-updates) or on a test run this session did not perform (the seven flaky tests) is C2; on-device claims are C2 or lower throughout.

**Pass-2 self-audit (2026-09-04).** The forty new entries were checked the same way: unique IDs 058 to 097, every priority recomputed from the stated weights by the splice script (a mismatch aborts the splice), no `depends_on` or `blocks` pointing outside 001 to 097, every heading matching its JSON object, and every file in a JSON `files` list appearing in the entry's location or checklist. Revisions during the pass-2 self-audit: two agents reported the dead notification-tap listener independently and were merged into GAP-069; six sheet and route error-handling findings were merged into GAP-078 (bare promises) and GAP-079 (mutation hooks); the manual-entry midnight finding was raised from S4 to S3 because it stamps a ledger row on the wrong day; twenty-two S4 findings were deferred rather than listed so XS rows would not outrank defects in the formula, the same rule pass 1 applied. Agent line numbers drifted on several comment-heavy files (`onboarding_state.ts`, `done.tsx`, `tracking_health_subscriber.ts`, `entitlements.ts`); every such citation carried into an entry was re-read and replaced. Confidence stays C2 wherever the claim rests on a platform default (`allowBackup`), on re-post frequency of third-party apps (GAP-094), or on a keystore invalidation not exercised on a device (GAP-059).

**Residue sweep self-audit (2026-09-04).** GAP-098 added; its citation to `limit_service.ts` was re-verified by grep for any serialisation primitive (none) and by reading the subscriber's debounce. Two S4 findings deferred. Counts recomputed: 98 total; S3 73; CODE 39.

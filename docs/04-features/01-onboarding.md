# Onboarding

First-run experience that takes a new user from install to a working, auto-tracked ledger in under five minutes — explaining value before every permission, and degrading gracefully to manual mode when any permission is declined.

**Status:** Draft v1 · 2026-08-02

## Purpose

Onboarding is where PeraPlano earns the two grants that make the whole product work — Notification Access and a battery-optimization exemption — and where the user does the only manual setup the app ever asks for: pick providers, create Wallets, declare income, and set a first Limit. Because Notification Access is a deliberately intimidating system screen and Google Play treats it as a sensitive permission, the flow is built on one principle from [§9 of the master context](../06-information-architecture.md): **explain value before each scary permission screen, and make every permission skippable.** A user who declines everything still gets a fully working app in manual mode; nothing in onboarding is a hard gate. The target from [MVP success criteria](../01-mvp-scope.md): install → first auto-tracked transaction in under 5 minutes on a supported provider.

## User stories

- As a new user, I want to understand what PeraPlano does for me *before* it asks for any permission, so that the system's "allow this app to read all notifications" screen doesn't scare me off.
- As a privacy-conscious user, I want to see clearly that raw notification text stays on my phone and is deleted after 30 days, so that I trust a finance app with notification access.
- As a GCash/Maya user, I want to pick my providers from a list and have Wallets created for me with the right mappings, so that setup is a few taps, not data entry.
- As a kinsenas earner, I want to declare that I'm paid on the 15th and 30th, so that percent-of-income Limits and payday features work from day one.
- As a cautious user, I want to skip any step (permissions, income, first Limit) and still use the app, so that I'm never blocked into granting something I'm not ready for.
- As a user on a Xiaomi/Huawei/Oppo/Vivo phone, I want device-specific guidance for keeping tracking alive, so that the listener isn't silently killed overnight.
- As a returning user who abandoned setup halfway, I want onboarding to resume where I left off, so that I don't repeat steps.
- As a user who declined Notification Access at first, I want a way to turn on auto-tracking later, so that my initial "no" isn't permanent.

## UX states & flows

### States

| State | Description | What the user sees |
|---|---|---|
| Fresh install | No onboarding step completed | Welcome sequence from step 1 |
| Resumed | Onboarding started but not finished | Flow resumes at the first incomplete step |
| Completed — auto mode | Notification Access granted, ≥1 provider mapped | Home with Safe-to-Spend; "waiting for your first transaction" card until first Ingest commit |
| Completed — manual mode | Notification Access declined or no supported provider | Home with Safe-to-Spend fed by manual entries; dismissible "Turn on auto-tracking" card |
| Completed — at-risk | Access granted but battery exemption declined or OEM restrictions detected | Home plus a listener-health warning ("tracking may be interrupted") linking to fix-it guidance |
| Error — grant not detected | User went to system settings but returned without granting | Non-judgmental retry screen: try again, see help, or skip |

### Flow (canonical step order)

Value-before-permission sequencing is enforced structurally: each permission step is a pair — *value screen first, system screen second*. The system screen is never the first thing shown for any grant.

**Step 1 — Welcome & value pitch (2 screens).**
Brand mark (Lucide `Send`), the core promise — *"You never log a transaction; you only set the rules."* — and the trust framing: no bank passwords, no account linking, everything stays on this phone. Screen 2 shows a mocked Home with Safe-to-Spend so the payoff is concrete before any ask.

**Step 2 — How it works + prominent disclosure.**
Explains the mechanism in plain language: PeraPlano listens to the notifications your bank and e-wallet apps already send, turns them into a ledger on-device, and never uploads raw notification text (purged after 30 days). This screen doubles as the Google Play **prominent disclosure** for notification access: it states what is accessed, why, and what is stored, and requires an explicit "Continue" tap (affirmative consent) before any system screen appears. An illustrative parsed notification is shown (e.g., a GCash-style "You sent ₱250.00…" message — **sample text is illustrative only**; real formats are captured during implementation per the [ingest pipeline doc](../03-ingest-pipeline.md)). Links to the full privacy explainer ([privacy & compliance](../07-privacy-and-compliance.md)).

**Step 3 — Notification Access grant walkthrough.**
1. Value recap in one line ("This is what makes tracking automatic").
2. A preview of the *system* screen the user is about to see, including the exact scary wording Android uses, so nothing is a surprise.
3. Button opens the system Notification Access settings screen (the app cannot grant this itself; the user must toggle it there).
4. On return, the app checks the grant:
   - **Granted** → success confirmation, listener starts, continue to step 4.
   - **Not granted** → retry screen with three options: "Try again," "Why is this safe?" (back to disclosure), "Skip for now" → manual mode is noted and the flow continues.
5. Skipping never dead-ends: the flow proceeds to step 5 (provider picker is skipped too if access was declined, since matchers would have nothing to match — the user goes straight to Wallet setup with a cash Wallet emphasized).

**Step 4 — The app's own alerts (Android 13+ POST_NOTIFICATIONS).**
Value screen: limit alerts at 50/80/100%, bill reminders, the daily Review Queue digest. Then the standard runtime permission dialog. If declined, alerts still appear inside the app (Home alert area); only system notifications are lost. Skippable, no retry pressure.

#### As shipped — 2026-09-04 (`app/(onboarding)/alerts.tsx`, `app/(tabs)/more/index.tsx`)

This step did not exist. `lib/onboarding/onboarding_state.ts` folded it into `"access"`, and what shipped was a screen that asks for Notification Access and nothing at all for POST_NOTIFICATIONS: `requestAlertPermission` (`lib/alerts/alerts_service.ts`) had no caller anywhere in the app. On Android 13+ that permission defaults to denied until something asks, and every notifier — limit alerts, bill and loan reminders, the payday summary, the tracking-interrupted warning — reads the grant and returns silently when it is false. So no alert of any kind could be displayed on the test device (a Samsung A54 on Android 16). Fixed as GAP-003.

**It is its own screen, and it is last.** `"alerts"` is now the tenth entry in `ONBOARDING_STEPS`, between `first_limit` and `done`, rather than a second dialog behind the Notification Access value screen. Two system dialogs behind one value screen is the cold ask this doc's own "value screen first, system screen second" pairing forbids, and the POST_NOTIFICATIONS dialog is one-shot per install — it is worth spending on a user who has just set a Limit and can be told what the alert will say.

**A refusal routes to settings, never to a second request.** Android shows the dialog once; afterwards `requestPermissionsAsync` resolves from what the OS remembers, with no dialog and nothing to answer. So a refusal switches the step's primary action to the phone's own settings page and advances either way — there is no state the step can be left stuck in, matching "skippable, no retry pressure" above.

**"Turn on alerts" in More is the recovery route.** A user who skipped or refused gets a row at the top of More's Tracking group, shown only while the app cannot post a notification. It raises the dialog while Android will still show one and opens this app's settings page once it will not, and disappears the moment the grant lands. The fuller setup checklist is still owed; this is the one row that closes the dead end.

**Still unverified on hardware.** Everything above is covered by Jest only. That the system dialog actually appears once on a real Android 13+ device, and that an alert is displayed afterwards, is a device check — [`docs/13`](../13-on-device-verification.md).

**Step 5 — Battery exemption & OEM guidance.**
Value screen: "Android may put PeraPlano to sleep overnight; one switch keeps tracking alive." Then the battery-optimization exemption prompt. On devices from manufacturers with aggressive battery managers (Xiaomi/MIUI, Huawei, Oppo, Vivo — very common in the Philippines), an extra device-specific guidance screen shows the additional steps that manufacturer requires (e.g., autostart or "no restrictions" settings), with screenshots-style illustrations. Introduces the **listener health** indicator the user will later find in [Settings & Privacy](./11-settings-privacy.md). Skippable; skipping sets the at-risk state, not an error.

**Step 6 — Provider picker.**
A checklist of supported PH providers from the [catalogue](../03-ingest-pipeline.md): GCash, Maya, BPI, BDO, UnionBank, Metrobank, SeaBank, GoTyme, CIMB, Landbank, ShopeePay, GrabPay, and the default SMS app relay (for bank SMS that surface as Messages notifications — no SMS permission is ever requested; see the ingest doc). Providers whose apps are detected on the device are pre-checked. An "I use something else" option explains the unknown-bin: unrecognized money notifications can be flagged in the [Review Queue](./08-review-queue.md) to grow coverage.

#### As shipped — 2026-08-14 (`app/(onboarding)/providers.tsx`, `components/onboarding/provider_picker.tsx`)

The screen exists. Five things about it differ from the design above — each a deliberate call rather than an oversight — plus one thing it deliberately does not do yet.

**It runs after the recovery phrase, not at position 6.** The shipped fresh-install sequence is *device lock → recovery phrase → provider picker*, because steps 3–5 above are not built yet (M3c owns them). It is placed after the phrase and never before: it is the first step that writes anything the listener acts on, and a user who abandoned onboarding earlier would otherwise be left with a configured listener collecting data they have no recovery words for.

**Two groups, learned names first.** "Apps we've seen" lists packages the listener has actually observed posting a notification on this phone — real names read off `sbn.packageName`. "Common in the Philippines" lists the seed catalogue's names, seven of which were invented from app names and none of which has been verified against a device. The learned group leads because the rows most likely to be *correct* should be the ones the user reads first, and an app the seed named wrongly is still reachable under whatever Android actually calls it. Confirming those names against real installed apps is a device check — [`docs/13`, Part 3a](../13-on-device-verification.md).

**Nothing is pre-checked, and detection means observation.** See rules 7 and 19 below. This is what settles open question 2: no package-visibility declaration is needed, because nothing queries the package manager.

**Picking nothing means PeraPlano watches every app, not none** — and the screen says so on its own face. See rule 20.

**There is no "I use something else" option yet.** The unknown-bin explanation from the design above is not on this screen. The need it was answering is partly met another way: an observed app the catalogue has never heard of still renders, under whatever Android calls it, so the user can tick their bank even when the seed named it wrongly. The Review Queue copy that explains the unknown-bin is still owed.

**What this step does *not* do yet.** A user who already has keys but has not finished onboarding still lands on `/(tabs)` rather than in the picker. Nothing in the app writes `onboarding_complete` yet (M3c owns that setting), so routing that user into the picker would re-ask them on every single launch with no way to ever stop being asked — a worse bug than the temporary landing spot it would be fixing. When M3c lands the setting write, this is the branch the rest of its steps hang off.

*Updated 2026-08-16 (m3c-onboarding-client Task 2, `app/(onboarding)/welcome.tsx`).* The `/(tabs)` fall-through above is gone: `app/(onboarding)/index.tsx` now redirects both the already-keyed branch and the post-provider-picker branch to `/(onboarding)/welcome`, the numbered flow's first screen (steps 1-2 and 5 below, `lib/onboarding/onboarding_state.ts`'s `ONBOARDING_STEPS`). `onboarding_complete` is still unwritten by anything — that remains the "done" step's job (Task 3) — so a user who reaches `welcome` today still has no way to ever mark onboarding finished; this only fixes where they land, not the setting write itself.

**Step 7 — Wallet setup.**
For each selected provider, a Wallet is proposed with sensible defaults: name (e.g., "GCash"), `type` (bank / e-wallet / cash / credit / savings), and `matchers[]` pre-attached to that provider. The user can rename, change type, set an optional starting `balance`, or remove any proposal. A **Cash** Wallet is proposed by default for everyone (it is how jeepney fares and palengke runs get tracked — via manual entry and reconciliation, see [Wallets](./02-wallets.md)). Users who know they hold sub-accounts (e.g., GCash main vs GSave) can add a second Wallet on the same provider here; matcher details live in the Wallets doc. Free-tier note: the Wallet cap is 3 (see Free vs Plus below); onboarding surfaces the count as wallets are added.

**Step 8 — Income declaration.**
One screen: "When does money usually come in?" Options mirror `IncomeProfile.cadence`: **kinsenas (15th/30th)** — presented first and explained ("kinsenas/katapusan," the PH payroll norm of the 15th and 30th) — weekly, monthly, or irregular. Optional `averageAmount` and which Wallets pay lands in (`sourceWalletIds[]`). Declaring here sets `isManualOverride: true`; skipping is fine — [income cadence detection](./04-income.md) will propose a profile from the ledger later. If skipped, percent-of-income Limits are unavailable until an IncomeProfile exists (fixed-₱ Limits still work).

**Step 9 — First Limit.**
One screen proposing a monthly spending Limit: `basis` fixed ₱ (with a suggested starter amount left blank for the user to fill) or percent-of-income (only offered when an IncomeProfile exists). Alert thresholds default to **50% / 80% / 100%**. No `categoryFilter`/`walletFilter` at this stage — keep the first Limit simple; refinement lives in [Limits](./03-limits.md). Skippable; without a Limit, Safe-to-Spend shows an "add a Limit to unlock this number" empty state.

**Step 10 — Finish.**
Lands on Home. In auto mode, a "listening — waiting for your first transaction" card appears until the first Ingest commit, with a gentle suggestion: make any small transaction on a mapped provider, or just wait for the next one. In manual mode, the card instead offers "Add your first transaction" and "Turn on auto-tracking."

#### As shipped — 2026-09-05 (`app/(onboarding)/done.tsx`)

The summary screen before Home stated three things it had never checked. Fixed as GAP-090.

**Automatic pickup was promised to everyone.** "PeraPlano will pick up transactions from these automatically" rendered for any non-zero wallet count, and nothing on the screen read the notification-access grant — so the users in manual mode, the outcome the auto/manual split above exists to support, were told on their way out of setup that tracking they had declined was running. The screen now reads `isAccessGranted()` and shows the manual-mode line instead: nothing is being picked up yet, notification access can be turned on from Settings any time, everything keeps working until then. While the native answer is still pending it says neither.

**Every Limit was labelled "Monthly limit".** The first-Limit step has offered daily, weekly, monthly and annual since 2026-08-20 (step 9's own note); the confirmation line kept the word "Monthly" hardcoded, so a user who deliberately chose weekly was shown their figure under the wrong cadence on the screen that exists to confirm it. It now uses the scope on the Limit itself, from the same table the picker's chips are drawn from.

**An unresolvable Limit was called "active" while the body asked for one.** `getLimitStatuses` returns `effectiveLimit: null` for a Limit it cannot resolve — a percent-of-income Limit with no income declared, which is reachable directly from step 8 being skippable — and the card headlined it "Your first Limit is active" over a body reading "Add one any time from the Plan tab". The headline now says what is actually true of that Limit ("waiting on your income", or "switched off"), and the body names the one missing thing.

### Degrade-to-manual mode (canonical behavior)

Manual mode is a first-class outcome, not an error: manual transaction entry, cash Wallets, Limits, Goals, Loans, Bills, reports, and Safe-to-Spend all work on manually entered data. The only things dormant are the Ingest pipeline and its dependents (auto-capture, dedupe, transfer detection on notification pairs, balance-after snapshots). A dismissible Home card and a permissions checklist in [Settings & Privacy](./11-settings-privacy.md) allow every skipped grant to be completed later, reusing the same value-screen → system-screen pairs.

## Rules & edge cases

1. No system permission screen is ever shown before its value screen in the same session (value-before-permission is structural, not advisory).
2. The prominent-disclosure screen (step 2) must be shown and affirmatively accepted before the app ever deep-links to the system Notification Access screen — required for Google Play compliance.
3. Every permission step (Notification Access, POST_NOTIFICATIONS, battery exemption) is skippable; skipping any or all of them still completes onboarding into a working app.
4. Declining Notification Access sets manual mode; the app never blocks, nags on a timer, or repeats the request unprompted. Re-invitation surfaces are limited to the dismissible Home card and the Settings permissions checklist.
5. Returning from the system Notification Access screen without the grant shows the retry screen at most once per attempt; "Skip for now" is always present.
6. Onboarding progress is persisted per step; killing the app mid-flow resumes at the first incomplete step, never from the beginning.
7. The provider picker pre-checks providers whose apps are detected on the device; detection failure (nothing detected) is not an error — the full list is still shown unchecked. *(Pre-checking was dropped as shipped — see rule 19. The second clause holds exactly as written: when nothing has been observed, the "Apps we've seen" group is omitted entirely rather than rendered empty, which would read as a failed detection, and the full seed list still renders.)*
8. Step 6 (provider picker) is skipped entirely when Notification Access was declined; the flow goes straight to Wallet setup with the cash Wallet emphasized.
9. Wallet proposals in step 7 always include exactly one cash Wallet suggestion; the user may remove it.
10. Setting a starting `balance` during Wallet setup writes the Wallet's balance directly; it does not create a Transaction.
11. Onboarding respects the Entitlements Wallet cap (3 on Free): the flow blocks creating a 4th Wallet with an upgrade explanation, and never removes already-created Wallets. (During MVP, `tier` is hardcoded `plus`, so the gate is defined but not felt.)
12. Income declaration in step 8 sets `IncomeProfile.isManualOverride: true`; skipping leaves no IncomeProfile until detection proposes one.
13. Percent-of-income basis is hidden (not disabled-with-error) in step 9 when no IncomeProfile exists.
14. The first Limit defaults to `scope: monthly`, `rollover: false`, thresholds 50/80/100%; all editable later in Limits.
15. All notification text shown anywhere in onboarding is marked and treated as illustrative; no invented string is presented as a real provider format.
16. POST_NOTIFICATIONS denial degrades only the delivery channel: threshold alerts, reminders, and Review Queue information (the tab badge in place of the daily digest) still render inside the app.
17. Battery-exemption skip (or an OEM known for background kills without completed guidance) sets the at-risk state and enables the listener-health warning; it never blocks completion.
18. If onboarding completes in auto mode but no mapped provider posts a notification within 48 hours, Home shows a "no transactions heard yet" helper linking to listener-health checks and manual entry — not an error state.

*Rules 19–22 added 2026-08-14 with the shipped provider picker (provider-selection plan Task 4).*

19. **Nothing in the provider picker is pre-checked, and "detected" means observed, not queried.** The listener already receives `sbn.packageName` for every notification the device delivers, so the app learns real package names by watching — with **no new Android permission**, and deliberately never `QUERY_ALL_PACKAGES`, a restricted Play permission this build would have to justify in writing. The consequence is worth stating plainly: an app that is installed but has never posted a notification cannot appear in "Apps we've seen". That is the price of not asking for package visibility, and it is worth paying.
20. **Picking nothing means PeraPlano watches every app, not none.** An empty provider filter is *allow-all* in `CapturePrefs.shouldCapture` — that is the fresh-install default the entire product depends on — so a picker that wrote an empty explicit selection as "capture nothing" would silently disable auto-tracking on an app that had just onboarded cleanly. "Skip for now" and "Continue with nothing ticked" therefore go through the same single write and mean the same thing. **The screen states this on its face** (`provider-picker-allow-all-note`: *"Pick nothing and PeraPlano keeps watching every app for money notifications instead"*), because the privacy line directly above it (`provider-picker-privacy`: *"PeraPlano reads notifications only from the apps you pick here"*) is **false for exactly that user** — who is also the user most likely to have chosen nothing out of concern about precisely that.
21. The provider step never pauses capture. It writes `setProviderFilter` and nothing else; `setCaptureEnabled` is not imported by the screen at all, so no path through it can turn tracking off. The global pause switch belongs to Settings. A failed write is not a dead end either: allow-all is already the on-disk default, so the step completes and the user can narrow the filter later.
22. Every row shows its package name beneath its label, suppressed only when the two are the same string (an observed app the catalogue has never heard of). Three seed packages share the `sms_relay` provider key and `ProviderChoice.displayName` *is* the provider key, so the picker currently renders three identically labelled `sms_relay` rows, told apart only by that subtitle. **Open** — fixing it means a display name that is not the provider key, which is a change to the `ProviderChoice` type, not a copy tweak.

## Data touched

| Entity | Access | Notes |
|---|---|---|
| **Wallet** | Create | Name, `type`, optional starting `balance`, `matchers[]` pre-attached per selected provider |
| **IncomeProfile** | Create (optional) | `cadence`, `averageAmount`, `sourceWalletIds[]`, `isManualOverride: true` when declared here |
| **Limit** | Create (optional) | First Limit: `scope: monthly`, `basis: fixed | percent-of-income`, thresholds 50/80/100% |
| **Entitlements** | Read | Wallet cap and Limit cap evaluated at creation call-sites |
| **Transaction** | None directly | Manual entry is offered post-onboarding (manual mode), not inside the flow |
| **Category** | Read | Default PH category tree exists before onboarding; not edited here |

Onboarding also records permission/grant state (Notification Access, POST_NOTIFICATIONS, battery exemption, per-OEM guidance completion) as app-level state — this is settings data, not a §3 domain entity.

## Free vs Plus

Tier matrix (canonical, from [monetization](../05-monetization.md)):

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

Rows onboarding touches: **Auto-tracking** (unlimited on both tiers — the permission flow is identical for Free and Plus, and onboarding never uses tier as leverage for a grant), **Wallets** (step 7 can hit the Free cap of 3), **Limits** (step 9 creates the 1 active Limit Free allows), and **Safe-to-Spend** (the finish screen shows today's number, which Free includes).

Behavior at the gate: when a Free user tries to create a 4th Wallet in step 7, creation of the new Wallet is blocked with a short Plus explanation — existing Wallets and their data are kept, nothing is ever deleted. The same principle applies if a second Limit were attempted (not possible in the linear flow, which creates at most one). Onboarding contains no paywall screens beyond these inline gate messages; upgrade moments are covered in [monetization](../05-monetization.md).

## Acceptance criteria

- [ ] A user can complete onboarding granting all permissions and reach Home in auto mode with ≥1 Wallet, matchers attached, and the listener running.
- [ ] A user can decline every permission and still complete onboarding into manual mode with a working Home, manual entry, and Safe-to-Spend.
- [ ] The prominent-disclosure screen appears and requires an affirmative tap before the system Notification Access screen can be opened, in every path including retries.
- [ ] Every permission step shows its value screen before its system screen, in the same session.
- [ ] Returning from system settings without granting Notification Access shows the retry screen with a working "Skip for now."
- [ ] On Android 13+, the POST_NOTIFICATIONS dialog is preceded by its value screen; denial leaves in-app alerts functional.
- [ ] On Xiaomi/MIUI, Huawei, Oppo, and Vivo devices, the OEM-specific guidance screen appears in step 5 with manufacturer-appropriate steps.
- [ ] The provider picker lists the full MVP catalogue, ~~pre-checks detected apps,~~ shows every package the listener has observed on this device in a group ahead of the catalogue, and offers the "not listed" unknown-bin explanation. *(Pre-checking dropped — rule 19. The unknown-bin explanation is still owed; the shipped screen renders unknown observed apps but does not explain the bin.)*
- [ ] Completing the provider step with nothing ticked, or skipping it, leaves capture **enabled and unfiltered** — not paused, not empty-allowlisted — and the screen said so before the user chose.
- [ ] Every package name the picker offers as "seen" is a real installed app, confirmed on a device ([`docs/13`, Part 3a](../13-on-device-verification.md)).
- [ ] Wallet setup proposes one Wallet per selected provider plus a cash Wallet, all editable/removable, with starting balances optional.
- [ ] Creating a 4th Wallet under a `free` Entitlements tier is blocked with the gate message and no data loss (verifiable by toggling the flag in a test build).
- [ ] Income declaration offers kinsenas (15th/30th), weekly, monthly, and irregular; declaring sets `isManualOverride: true`; skipping creates no IncomeProfile.
- [ ] First-Limit screen hides percent-of-income when no IncomeProfile exists and defaults thresholds to 50/80/100%.
- [ ] Killing the app at any onboarding step resumes at that step on next launch.
- [ ] All notification samples in onboarding are visibly marked as illustrative.
- [ ] Median time from install to first auto-tracked transaction is under 5 minutes on a device with a supported, active provider (measured per MVP success criteria).
- [ ] Skipped permissions can each be completed later from the Settings permissions checklist using the same value-screen → system-screen sequence.

## Open questions

1. **Pre-permission demo data.** Should step 1 offer an interactive sample ledger ("explore with fake data") before any permission ask? It could raise grant rates but lengthens time-to-value and risks confusing the real ledger with sample data. Needs a decision before M3 onboarding polish.
2. ~~**Installed-app detection scope.**~~ **RESOLVED 2026-08-14 — no package query, and therefore no declaration.** The concern was real: pre-checking by asking the package manager which provider apps are installed needs a package-visibility justification at Play review, on a build already carrying the notification-access declaration plus three permissions that draw scrutiny (see [risks](../08-risks-and-open-questions.md)). The shipped answer avoids the question entirely. The listener is already handed `sbn.packageName` for every notification the device delivers, so the app learns which provider apps the user really has by **observing** them, with no new permission and no `QUERY_ALL_PACKAGES`. Pre-checking is gone with it (rule 19): the picker groups observed apps ahead of the catalogue instead of ticking them, which is a weaker affordance and a much better trade. The residual cost is that an installed-but-silent app never appears.
3. **OEM guidance depth.** Whether OEM steps are maintained as in-app illustrated guides (higher maintenance, works offline) or a lightweight linked page (updatable, but requires connectivity) needs a call before M1 exit; MIUI settings paths in particular change between versions.

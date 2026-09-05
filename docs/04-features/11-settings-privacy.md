# Settings & Privacy

This document specifies the Settings & Privacy surface: the controls that let the user govern the listener (pause globally or per provider), see exactly why anything was recorded (transparency via `rawNotificationRef`), take their data out (export everything), erase it all (wipe with a deliberate confirm flow), monitor tracking health (listener health indicator, parser diagnostics), and manage the Plus cloud backup toggle. These controls are the operational half of the trust story: a finance app that reads notifications earns its permission by being radically inspectable and instantly revocable.

**Status:** Draft v1 · 2026-08-02

## Purpose

PeraPlano asks for the scariest permission on Android — Notification Access — and answers with radical transparency and user control. Settings & Privacy is where that answer lives: every capture is explainable, listening can be paused at any granularity, all data can leave with the user, and everything can be erased. It also hosts the operational surfaces that keep passive tracking honest on aggressive PH-market devices: the listener health indicator and the parser diagnostics screen. These controls directly implement the commitments in [../07-privacy-and-compliance.md](../07-privacy-and-compliance.md) (RA 10173 / NPC posture, Google Play notification-access declaration) and the local-first data model: raw notification text is parsed on-device, stored encrypted with a 30-day TTL, and never leaves the phone.

## User stories

- As a user lending my phone to a family member, I want to pause listening with one switch, so that nothing gets captured until I turn it back on.
- As a user whose bank sends promotional notifications, I want to pause listening for just that provider, so that tracking continues for everything else.
- As a user surprised by a recorded transaction, I want to see the exact notification that produced it, so that I can verify the app rather than trust it blindly.
- As a privacy-conscious user, I want to export every piece of data the app holds about me, so that my data is portable and inspectable.
- As a user leaving the app, I want to wipe everything with confidence that it is really gone, so that no financial trace remains on the device or in any backup.
- As a user on a MIUI device, I want a clear indicator when tracking has been interrupted, so that I find out from the app — not from missing transactions at the end of the month.
- As a user whose bank changed its notification wording, I want a diagnostics view showing what is and isn't parsing, so that I understand gaps instead of blaming the app silently.
- As a Plus subscriber with a new phone coming, I want a cloud backup toggle, so that committed transactions survive a device change — without raw notification text ever leaving the device.

## UX states & flows

### Settings structure (under the More tab)

| Section | Contents |
|---|---|
| Tracking | Master listening switch · per-provider switches · listener health indicator · parser diagnostics · **Permissions** (the checklist screen, `app/(tabs)/more/permissions.tsx`), which carries the battery-exemption and OEM guidance shortcuts |
| Alerts | The app's own notifications — per-type toggles mirroring the canonical channel list in [../06-information-architecture.md](../06-information-architecture.md) §6.1: Limit threshold alerts (50/80/100%), Bill reminders, Loan reminders, Goal updates, the daily Review Queue digest, Listener health, Payday summary (requires the POST_NOTIFICATIONS runtime permission on Android 13+) |
| Data & privacy | "What PeraPlano can see" explainer · transparency access ("why was this recorded" lives on each transaction; this section explains and links) · Export everything · Wipe everything · anonymous parse-success sharing toggle |
| Backup (Plus) | Cloud backup toggle · last-backup time · delete-cloud-copy action |
| About | Privacy policy · terms · version · licenses |

### Permissions checklist

Every grant PeraPlano needs is offered exactly once, during onboarding, and every one of them is skippable on purpose ([01-onboarding.md](01-onboarding.md)). **Permissions** (More → Permissions) is where a skipped grant is completed afterwards; without it the only way back is a reinstall.

| Row | State shown | Action |
|---|---|---|
| Notification access | On / Off, read live via `isAccessGranted()` | Opens the system Notification Access list; hidden once the grant is held |
| Alerts (POST_NOTIFICATIONS) | On / Off, read live via `getPermissionsAsync()` | Raises the one-shot Android 13+ dialog while `canAskAgain` is true, and opens the phone's app settings afterwards; hidden once the grant is held |
| Battery exemption | "Can't tell" — Android reports nothing back | Fires `BATTERY_SETTINGS_INTENT`, the same intent the onboarding step fires, and the screen shows the matching OEM guidance beneath it. Always offered, because there is no state to hide it on |

Two rules this screen holds to:

- **A failed read is never rendered as "Off".** A read that threw says nothing about the grant, so it shows "Can't tell" and keeps its action. Turning an unknown into a claim teaches the user to distrust the rows that are accurate.
- **A refused permission is never silently re-requested.** Android spends the POST_NOTIFICATIONS dialog on the first ask and answers later requests from memory with nothing shown, so once it is spent the screen routes to system settings instead of offering a button that does nothing.

### Listener health indicator

One status surface, shown as a row in Tracking and mirrored as a Home banner whenever unhealthy:

| State | Trigger | Surface |
|---|---|---|
| Active | Listener connected and receiving | Green dot in Settings only; no banner |
| Paused | User turned the master switch off | Neutral badge + persistent quiet reminder chip on Home ("Tracking is paused") |
| Interrupted | Listener was disconnected/killed (common on aggressive OEM battery managers) and has not reconnected | Home banner: "Tracking was interrupted" → recovery flow (Flow D) |
| Access revoked | Notification Access is off in system settings | Home banner with a direct link to the system Notification Access screen |
| Battery-restricted | Battery-optimization exemption not granted | Warning badge + prompt to the exemption flow and OEM-specific guidance screens |

Priority when multiple apply: Access revoked > Interrupted > Battery-restricted > Paused > Active.

### Key flows

**Flow A — Pause listening (global)**
1. User toggles the master switch off in Tracking (or long-presses the health row for a quick action).
2. Confirmation sheet states plainly: "While paused, PeraPlano captures nothing — not even for the Review Queue. Missed transactions will not be backfilled; you can add them manually or reconcile balances later."
3. While paused: no notification content is read or stored, including the unknown-bin. Health shows Paused; a quiet chip stays on Home.
4. On resume, tracking restarts from that moment. If paused longer than 24 hours, a one-time prompt offers cash reconciliation ([02-wallets.md](02-wallets.md)) to true-up balances.

**Flow B — Pause listening (per provider)**
1. Tracking lists every provider from the catalogue in [../03-ingest-pipeline.md](../03-ingest-pipeline.md) that has ever produced a capture, each with its own switch, plus a switch for "Unrecognized sources" (the unknown-bin).
2. Turning a provider off stops capture from that source only; everything else continues. The provider row shows "Paused" and the date it was paused.
3. Wallets whose `matchers[]` point only at paused providers show a subtle "source paused" hint on the Wallet screen.

**Flow C — "Why was this recorded?" (transparency screen)**
1. Every auto-committed Transaction detail view has a "Why was this recorded?" action (available while `rawNotificationRef` is retained — invariant 5).
2. The screen shows: source app and provider; capture timestamp; the raw notification text; the parser version that matched; each extracted field (amount, direction, merchant, reference number, balance-after when present); the confidence score; any UserRule that was applied; and dedupe/Transfer-Link decisions that touched it.
3. Illustrative example (sample text is **illustrative only** — real formats are captured during implementation): raw text "You have sent PHP 500.00 to JUAN D. Ref. 1234567" → extracted: amount ₱500.00, direction out, merchant "JUAN D", reference 1234567.
4. After the 30-day TTL purges the raw text, the screen degrades gracefully: extracted fields, provider, parser version, and confidence remain, with the notice "The original notification text was automatically deleted after 30 days, as designed."
5. From this screen the user can jump to correction actions (recategorize, reassign Wallet, unlink transfer), which create UserRules exactly as Review Queue actions do ([08-review-queue.md](08-review-queue.md)).

**Flow D — Listener recovery ("tracking was interrupted")**
1. Home banner appears in the Interrupted, Access revoked, or Battery-restricted states.
2. Tapping opens a stepper tailored to the state: re-grant Notification Access (deep link to the system screen, with the same "why" explainer used in onboarding — [01-onboarding.md](01-onboarding.md)); grant the battery-optimization exemption; or follow the OEM-specific guide (Xiaomi/MIUI, Huawei, Oppo, Vivo screens are pre-built — these OEMs dominate the PH market).
3. After recovery, the app shows the interruption window ("no tracking from Aug 3, 9:14 PM to Aug 4, 7:02 AM"), runs the partial catch-up from the active-notification snapshot (rule 3), and offers manual entry and cash reconciliation to close the remaining gap. Notifications dismissed or removed while the listener was down cannot be recovered.

**Flow E — Export everything**
1. Data & privacy → Export everything.
2. Summary screen lists exactly what will be included: all Wallets, Transactions, Transfer Links, Categories, Limits, IncomeProfile, Goals, Loans, Bills, RecurringPatterns, and UserRules — in a machine-readable structured file plus a companion transactions CSV (same column spec as [10-reports.md](10-reports.md)). It also states what is excluded: raw notification text (never leaves the device, by design).
3. The archive is generated entirely on-device and handed to the Android share sheet; the user chooses the destination.
4. Export everything is available to **all tiers** — it is a data-portability right, not a feature. (The Reports CSV convenience export remains Plus per the tier matrix; see Free vs Plus below.)

**Flow F — Wipe everything (confirm flow)**
1. Data & privacy → Wipe everything.
2. **Step 1 — Understand.** Screen lists what will be permanently erased: every entity, all raw notification text, all settings and UserRules. It offers "Export first" as the primary button and "Continue to wipe" as the destructive secondary. If cloud backup is on, it states that the cloud copy will also be handled in Step 2.
3. **Step 2 — Confirm.** The user must type the word **DELETE** to enable the final button. If cloud backup is enabled (Plus), a required choice appears: "Also delete my cloud backup" (default: checked). The final button reads "Erase everything."
4. **Step 3 — Execute.** Local data is erased; if selected, the cloud copy deletion is requested and the screen waits for confirmation of it, showing per-part progress. If cloud deletion cannot be confirmed (offline), the app completes the local wipe, clearly states the cloud copy is still pending deletion, and retries until confirmed.
5. **Step 4 — Done.** The app returns to a fresh first-run state and reminds the user that Notification Access is still granted at the system level, with a direct link to revoke it (the app cannot revoke system-level access itself).

**Flow G — Parser diagnostics**
1. Tracking → Parser diagnostics.
2. Per provider: notifications captured, parsed successfully, sent to the Review Queue, and ignored as non-financial — over a rolling 30-day window — plus last-capture timestamp and the active parser version.
3. An "Unrecognized sources" section shows unknown-bin activity: source apps and captured samples (subject to the same 30-day TTL). The user can flag "this is a money notification," which routes it to the Review Queue and feeds future parser coverage.
4. A footer discloses telemetry honestly: "PeraPlano may share anonymous parse-success counts (numbers only, never content) to detect broken parsers," with the toggle controlling it adjacent.

**Flow H — Cloud backup toggle (Plus)**
1. Backup section shows the toggle, last successful backup time, and a "Delete cloud copy" action.
2. Enabling requires an explicit opt-in sheet: what syncs (committed transaction records and settings entities, encrypted), what never syncs (raw notification text — invariant 3), and that backup enables multi-device restore.
3. Disabling stops sync immediately and asks whether to keep or delete the existing cloud copy.
4. Free users see the row locked with a Plus prompt; no data is affected by the gate.

## Rules & edge cases

1. **Global pause stops capture entirely.** While the master switch is off, no notification content is read, parsed, or stored — including unknown-bin capture. Pause is capture-level, not display-level.
2. **Per-provider pause is scoped capture-off.** Content from a paused provider is not read or stored; all other providers continue. The unknown-bin has its own switch and obeys the global switch.
3. **No true backfill.** Resuming capture restarts from that moment. After an *interruption* (listener killed or disconnected), notifications still present in the status bar at reconnection are read from the active-notification snapshot and fed through the normal pipeline as a partial catch-up; anything dismissed or removed during the gap is unrecoverable ([../03-ingest-pipeline.md](../03-ingest-pipeline.md) §1, principle 5). After a user-initiated *pause*, no catch-up runs — the pause promise is that nothing from the paused window is captured (rule 1). The app compensates for what is truly missed with manual entry and cash reconciliation, never by requesting broader permissions.
4. **Pause is not revocation.** The health indicator distinguishes Paused (user choice, in-app) from Access revoked (system-level). The app never represents itself as "off" when system access remains granted — Step 4 of the wipe flow and the Paused state both make this distinction explicit.
5. **30-day TTL on raw text.** Raw notification text is stored encrypted on-device and purged automatically 30 days after capture (invariant 3). Purge requires no user action and no network. Transparency screens degrade per Flow C step 4; `rawNotificationRef` on a Transaction outlives the raw text only as a record that a capture existed.
6. **Transparency completeness.** Every Transaction with `source: notification` must resolve "Why was this recorded?" to either the full raw-text view (within TTL) or the degraded structured view (after TTL). No auto-committed Transaction may be unexplainable (invariant 5).
7. **Export contains everything except raw text.** The export includes every user-data entity listed in Flow E and excludes raw notification text. Rationale: raw text can contain third parties' personal data (sender names in padala/remittance notifications); keeping it view-only in-app and purging on TTL is the data-minimization stance. The export summary states this exclusion explicitly.
8. **Export and wipe are not tier-gated.** Both are privacy rights available on Free and Plus alike. The §7 matrix "Export" row refers to the Reports CSV convenience export ([10-reports.md](10-reports.md)), not to this control.
9. **Export is local-only.** Generation happens on-device; delivery is solely via the Android share sheet. The app makes no network request in the export flow.
10. **Wipe is irreversible and complete.** After Step 3, no user data, raw text, UserRules, or settings survive locally. If backup was enabled and cloud deletion was selected, wipe is not reported as fully complete until the cloud deletion is confirmed; until then the app displays the pending status truthfully.
11. **Wipe requires typed confirmation.** The final action is enabled only after the user types DELETE. There is no single-tap path to data destruction.
12. **Backup syncs committed records only.** Cloud backup (Plus, opt-in) carries committed transaction records and settings entities, encrypted; raw notification text and unknown-bin contents never sync under any configuration.
13. **Health states are honest and prioritized.** Exactly one health state displays at a time, per the priority order above. The Interrupted state must be detectable by the app itself (listener disconnect awareness), not only inferable by the user from missing data.
14. **Interruption windows are disclosed.** After any Interrupted period, the app states the gap's start and end on the recovery screen and keeps a note accessible from parser diagnostics for 30 days.
15. **Diagnostics counts are content-free.** The diagnostics screen shows counts, timestamps, and parser versions. Any content shown (unknown-bin samples, raw text views) stays on-device and under TTL. Shared telemetry, when the toggle is on, is aggregate counts only — never notification content, amounts, merchants, or identifiers.
16. **All notification text samples in this document and in-app explainer screens are illustrative**, not verified provider formats. Real formats are captured from devices during implementation and maintained as a versioned parser corpus ([../03-ingest-pipeline.md](../03-ingest-pipeline.md)).
17. **The app's own alerts respect system permission.** On Android 13+ the app requests POST_NOTIFICATIONS before sending its own alerts; if denied, in-app surfaces (badges, banners) carry the information and the Alerts section explains the degradation. Denial never affects capture — listening and the app's own alerting are independent.
18. **Alert toggles are per-type.** Each channel in the canonical list ([../06-information-architecture.md](../06-information-architecture.md) §6.1) — Limit threshold alerts (50/80/100%), Bill reminders, Loan reminders, Goal updates, the daily Review Queue digest, Listener health, and the Payday summary — can be disabled independently without affecting the underlying features.

## Data touched

| Entity | Read | Write |
|---|---|---|
| Transaction | `rawNotificationRef`, `source`, `confidence`, extracted fields — transparency screens; all fields — export and wipe | Wipe deletes; transparency-screen corrections update `categoryId` / `walletId` via the standard correction path |
| Wallet | `matchers[]` — per-provider pause hints; all fields — export and wipe | Wipe deletes |
| TransferLink, Category, Limit, IncomeProfile, Goal, Loan, Bill, RecurringPattern | All fields — export and wipe | Wipe deletes |
| UserRule | Listed in export; applied-rule display on transparency screens | Corrections from transparency screens create UserRules; wipe deletes |
| Entitlements | `tier` — gates the Backup section | — |

Settings state itself (pause switches, alert toggles, telemetry toggle, backup toggle) is app configuration governed by the same export/wipe guarantees.

## Free vs Plus

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

Behavior at the gate:

- **Cloud backup / multi-device sync is the only Plus-gated control on this surface.** Free users see the Backup row locked with a Plus prompt. Enabling on upgrade backs up from that point; nothing retroactive is required of the user. On downgrade, sync stops but the standard principle holds — keep data, block creation of new (no new backups), never delete: the cloud copy is retained for a stated grace period and the user is told how to delete it immediately if they wish.
- **Everything else in Settings & Privacy is ungated for all tiers**: pause controls, transparency screens, listener health, parser diagnostics, export everything, and wipe everything. Privacy rights and safety surfaces are never upsell levers. (The matrix "Export" row is the Reports CSV export, gated in [10-reports.md](10-reports.md).)

## Acceptance criteria

- [ ] With the master switch off, no notification content from any source (including unknown-bin) is read or stored; the health state shows Paused and the Home chip appears.
- [ ] With one provider paused, that provider's notifications are not captured while all other providers continue to ingest normally.
- [ ] Resuming after a user pause captures nothing retroactively; recovery from an interruption reads only the active-notification snapshot (never anything dismissed); a >24-hour pause triggers the one-time reconciliation offer.
- [ ] Every auto-committed Transaction within the raw-text TTL opens "Why was this recorded?" showing raw text, provider, parser version, extracted fields, confidence, and any applied UserRules.
- [ ] Raw text older than 30 days is purged automatically, and the transparency screen shows the degraded structured view with the purge notice.
- [ ] Export everything produces a structured archive plus transactions CSV covering all listed entities, contains zero raw notification text, and completes with no network activity by the app.
- [ ] Export everything and Wipe everything are fully available on the Free tier.
- [ ] The wipe flow requires typing DELETE; completing it erases all local data and settings and returns the app to first-run state.
- [ ] With cloud backup enabled and "also delete my cloud backup" selected, wipe reports completion only after cloud deletion is confirmed, and truthfully reports pending status when offline.
- [ ] After wipe, the app displays the reminder that system-level Notification Access is still granted, with a working deep link to the system screen.
- [ ] Each of the five health states is reachable and displays per the priority order; Interrupted produces the Home banner and the recovery stepper appropriate to the cause.
- [ ] After an interruption, the app states the gap window (start and end) on the recovery screen.
- [ ] Parser diagnostics shows per-provider captured / parsed / Review-Queued / ignored counts over a rolling 30 days, last-capture time, and parser version; unknown-bin flagging routes to the Review Queue.
- [ ] The telemetry toggle controls sharing of aggregate parse-success counts; with it off, nothing is shared; with it on, no notification content, amounts, merchants, or identifiers are ever included.
- [ ] The cloud backup toggle (Plus) shows opt-in disclosure before enabling, shows last-backup time, and offers keep-or-delete on disable; the free tier shows the locked row and the gate affects no data.
- [ ] Denying POST_NOTIFICATIONS blocks only the app's own alerts; capture, badges, and in-app banners continue to function.

## Open questions

1. **Telemetry default.** Should the anonymous parse-success sharing toggle default to on (better parser-rot detection, weaker privacy optics) or to off (opt-in)? The decision should be made together with the NPC compliance review in [../07-privacy-and-compliance.md](../07-privacy-and-compliance.md), since the default materially affects the privacy narrative.
2. **Export of in-flight items.** Should Export everything include unconfirmed Review Queue items (as clearly marked provisional records), or committed data only? Including them is more complete; excluding them keeps the export unambiguous.
3. **Cloud-copy grace period on downgrade.** How long is the retained-backup grace period after a Plus downgrade before the copy is deleted — and does the user get a reminder before deletion? Interacts with the monetization win-back flow in [../05-monetization.md](../05-monetization.md).

# Privacy & Compliance

This document defines PeraPlano's privacy posture and regulatory compliance plan: obligations under the Philippine Data Privacy Act of 2012 (RA 10173) and the National Privacy Commission (NPC), the Google Play policy obligations attached to notification access and finance-adjacent apps, the full data lifecycle (what data exists, where it lives, how long it is kept, and whether it ever leaves the device), the data-minimization stance, the treatment of third-party personal data that appears inside notifications, and the complete list of user-facing privacy controls. It expands §10 of the master planning context and is the source of truth for the privacy notice, the Play Data safety form, and store-review submissions. Genuinely undecided items are tracked in [08-risks-and-open-questions.md](08-risks-and-open-questions.md).

**Status:** Draft v1 · 2026-08-02

---

## 1. Privacy posture in one paragraph

PeraPlano is local-first by architecture, not by policy promise. Raw notification text is parsed on-device, stored encrypted on-device with a 30-day time-to-live, and never leaves the phone under any configuration. Only committed Transaction records — structured fields, never raw text — sync off-device, and only if the user explicitly enables cloud backup, which is a Plus feature. A Free-tier user's financial data therefore never touches a server at all. There are no ads, no data selling, and no third-party analytics that receive notification content. This is the strongest honest position a notification-reading finance app can take, and every compliance argument below builds on it.

---

## 2. Republic Act 10173 — Data Privacy Act of 2012 (NPC)

### 2.1 Roles under the law

- The company operating PeraPlano acts as a **Personal Information Controller (PIC)** for any personal data it actually receives and controls: cloud backup contents (Plus, opt-in), the sign-in identity used for backup (not to be confused with a Wallet, which is a money location), support correspondence, and aggregate telemetry.
- Any infrastructure vendor that hosts encrypted backups on the company's behalf acts as a **Personal Information Processor (PIP)**; a written outsourcing agreement covering confidentiality, security measures, sub-processing, and breach assistance is required before cloud backup ships.
- Data that is processed entirely on the user's own device for the user's own household finances arguably falls under the personal/household exemption of RA 10173 as far as the *user's* processing is concerned. PeraPlano does not rely on that argument: the app is designed, documented, and reviewed as if all data it touches were fully in scope. This conservative stance is deliberate — it keeps the compliance story simple and truthful.

### 2.2 What data is in scope, and its sensitivity

- Ledger data (Transaction records: `amount`, `direction`, `timestamp`, `walletId`, `categoryId`, `merchant`, `source`, `confidence`, `note`) is **personal information** when linkable to an identified user (which it is, on their own device, and in their backup).
- RA 10173's enumerated categories of **sensitive personal information** do not explicitly include financial transaction data, but notification text can incidentally contain items that do qualify (for example, fragments of government-issued ID numbers in verification messages) and loan data (Loan entities: `counterparty`, `principal`, `paymentHistory[]`) reveals indebtedness. Policy decision: **PeraPlano treats the entire ledger and everything derived from notifications at the protection bar of sensitive personal information** — encrypted at rest on-device, encrypted in transit and at rest when backed up, strict minimization, 72-hour breach posture (§2.7).
- Bank-secrecy adjacency: the app never accesses bank systems; it reads what banks and e-wallets already pushed to the user's own device. This distinction matters for positioning but does not reduce data-protection obligations.

### 2.3 Lawful basis, per processing activity

| Processing activity | Lawful basis | Notes |
|---|---|---|
| Notification ingest and on-device ledger | Consent, evidenced in-app before the Notification Access grant | Consent is specific to the purpose ("automatically record money movements from your notifications"), freely given (every permission is skippable; the app degrades to manual mode), and withdrawable (pause listening, revoke access, wipe). |
| Cloud backup / multi-device sync (Plus) | Consent plus necessity for a service the user requested | Strictly opt-in; disabled by default; disabling it deletes server-side copies (§4). |
| Aggregate telemetry (parse success/failure counts, crash rates, listener uptime) | Legitimate interest | Content-free counters only: no notification text, no amounts, no merchants, no counterparties. User can opt out in settings without losing any feature. |
| Support correspondence | Consent / contract necessity | Only what the user sends us; users are warned not to paste raw notification text into support messages. |
| App's own alerts (limit thresholds, bill reminders, loan reminders, goal updates, the daily Review Queue digest, listener health, payday summary) | Necessity for the service the user configured | Delivered on-device; requires the POST_NOTIFICATIONS runtime permission on Android 13+ (§3.5). |

### 2.4 Privacy notice

One canonical privacy notice, layered:

1. **Layer 1 — in-flow explainers.** Short, plain-language screens shown at the exact moment of each permission ask during onboarding (see [04-features/01-onboarding.md](04-features/01-onboarding.md)): what will be read, what is extracted, what is discarded, what never leaves the phone. Available in English; Filipino-language version is a fast-follow.
2. **Layer 2 — full notice.** Accessible from onboarding and from More → Settings → Privacy at all times, containing everything RA 10173 and its IRR require: identity and contact details of the PIC, Data Protection Officer contact, description of data processed, purposes, lawful basis, scope and method of processing, retention periods (matching the lifecycle table in §4 exactly), recipients (none, except the backup infrastructure PIP for Plus users who opt in), existence of automated processing (parsing, categorization, recurring detection — with the note that every automated decision is user-correctable via the Review Queue), data subject rights and how to exercise them, and complaint route to the NPC.
3. The in-app transparency screens (§7) are the notice made operational: the user can always see exactly what was captured and why.

Rule: the notice must never claim more than the architecture delivers, and the architecture must never do more than the notice says. Any change to the lifecycle table (§4) requires a notice revision in the same release.

### 2.5 NPC registration and DPO — assessment

- A **Data Protection Officer is appointed before public launch** regardless of registration thresholds; the DPO's contact appears in the privacy notice and in Play listing support details.
- NPC registration rules (per the NPC's registration circular in force) require registration when processing sensitive personal information of a large number of individuals, when headcount thresholds are met, or when processing is likely to pose risks to data subjects. Assessment against PeraPlano's actual server-side footprint:
  - Free tier: no personal data reaches company systems beyond content-free telemetry and any support email the user initiates. Server-side processing is minimal.
  - Plus with cloud backup: the company processes financial records (treated at the sensitive bar per §2.2) for what is intended to be well over one thousand users.
- **Conclusion (planning position): register.** Appoint and register the DPO with the NPC and register the backup data processing system before cloud backup enforcement goes live, and no later than public launch. Final legal confirmation of which registration obligations attach, given the on-device-only Free tier, is with Philippine privacy counsel — tracked as an open question in [08-risks-and-open-questions.md](08-risks-and-open-questions.md).

### 2.6 Privacy Impact Assessment

A Privacy Impact Assessment (PIA), following NPC guidance, is completed before public launch and revisited whenever the lifecycle table (§4) changes. The PIA covers: the ingest pipeline end-to-end (see [03-ingest-pipeline.md](03-ingest-pipeline.md)), third-party data in notifications (§6), the unknown-bin capture path, telemetry, cloud backup, and the wipe/export controls. The PIA is also review evidence for Google Play (§3.1).

### 2.7 Breach notification

- **What counts as a company breach:** compromise of systems the company controls — backup storage, telemetry pipeline, sign-in identity store. Loss or theft of the user's own phone is not a company breach (mitigated by on-device encryption and the user's device lock), but the wipe control (§7) and remote guidance are documented in support materials.
- **Obligation:** where a breach involves data treated at the sensitive bar (which PeraPlano's backup contents are, per §2.2) and there is a real risk of serious harm, notify the **NPC and affected data subjects within 72 hours** of knowledge or reasonable belief that a breach occurred.
- **Preparation shipped with the product, not after:** an internal breach response runbook (detection → containment → assessment → notification → remediation), pre-drafted user and NPC notification templates, a breach log (required even for non-notifiable incidents), and an annual tabletop exercise.
- Mitigating architecture: backups are encrypted; raw notification text is never on any server, so the worst-case server-side breach exposes structured records, not notification content.

### 2.8 Data subject rights → product mapping

| RA 10173 right | How PeraPlano honors it |
|---|---|
| Right to be informed | Layered privacy notice (§2.4); in-flow explainers before every permission. |
| Right to object | Every permission is skippable; ingest can be paused globally or per provider; telemetry opt-out; consent withdrawal at any time. |
| Right to access | Transparency screens: each auto-committed Transaction retains `rawNotificationRef` while raw text is retained, so the user can see exactly why the app recorded it; full data export. |
| Right to rectification | Every parsed field is user-editable; Review Queue corrections; corrections become UserRules that replay going forward. |
| Right to erasure/blocking | Delete any Transaction; wipe everything (device and, if backup was enabled, server copies); disable backup deletes server copies. |
| Right to data portability | Export everything (CSV export of the ledger plus full structured export of Wallets, Limits, Goals, Loans, Bills, RecurringPatterns, UserRules, IncomeProfile). |
| Right to damages / complaint | DPO contact and NPC complaint route stated in the notice. |

---

## 3. Google Play compliance

### 3.1 Notification access: declaration strategy and core-functionality framing

Google Play treats notification access (`NotificationListenerService`) as sensitive. It requires a declaration and justification, and finance apps receive extra review scrutiny. Rejection is a launch risk (Risk 1 in [08-risks-and-open-questions.md](08-risks-and-open-questions.md)). The strategy:

1. **Core-functionality framing.** The justification states plainly that reading transaction notifications *is* the product, not a convenience feature: PeraPlano's core promise is "you never log a transaction; you only set the rules," and its single differentiated function — automatic recording of money movements from bank and e-wallet notifications — is impossible without notification access. The declaration enumerates exactly what is done with the data: on-device parsing into structured fields, encrypted on-device storage of raw text with a 30-day purge, no off-device transmission of raw text ever, structured records synced only under user-enabled Plus backup.
2. **Prominent disclosure inside the app, before the system screen.** Play policy requires in-app disclosure and consent for sensitive data access — a privacy-policy link alone is not enough. Onboarding shows a dedicated screen, before deep-linking to the system Notification Access settings, that states: what will be read (notifications from banks, e-wallets, and the default SMS app), why (to record transactions automatically), what happens to the data (parsed on-device; raw text purged after 30 days; never sold; never used for ads), and that the user can pause or revoke at any time.
3. **Review evidence pack.** Submission includes: a screen-recorded video of the full flow (disclosure → grant → first auto-tracked transaction → transparency screen showing the captured text → pause → wipe), annotated screenshots, the privacy notice, and the PIA summary (§2.6).
4. **Voluntary, not coerced.** The permission is skippable; the app degrades to manual entry rather than blocking. This is visible in the review video and materially strengthens the "user choice" dimension of review.
5. **Staged rollout.** The declaration is exercised first on internal and closed testing tracks to surface policy objections before any public launch date is committed.
6. **Re-declaration discipline.** Any release that changes what the listener touches re-triggers an internal policy review before submission.

### 3.2 What PeraPlano deliberately does not request

| Not requested | Why |
|---|---|
| `READ_SMS` / SMS permissions | Google Play's SMS and Call Log policy effectively prohibits SMS reading for expense tracking (not an approved exception). Bank SMS still reach the app as *notifications posted by the default SMS app*, which the listener parses — for example a notification whose text begins with a known bank sender ID such as "BPI" or "BDO" (illustrative; real formats are captured at implementation). |
| Call log permissions | No product use. |
| Accessibility services as an ingest workaround | Explicitly ruled out; using accessibility APIs for data collection violates Play policy and would poison the trust story. |
| Location | No product use. |
| Contacts | No product use; counterparty names come only from notification text the user's providers already sent (§6). |

### 3.3 Data safety form contents

The Data safety form describes data **collected** (transmitted off-device) and **shared**. Play's definitions matter here: data processed only on-device is not "collected." Declared contents:

| Form area | Declaration |
|---|---|
| Financial info → purchase history / other financial info | Collected **only when the user enables cloud backup (Plus)**: structured Transaction records and the user's configuration entities (Wallets, Limits, Goals, Loans, Bills, IncomeProfile, UserRules, RecurringPatterns). Optional (off by default). Purpose: app functionality (backup/sync). Encrypted in transit. User can request deletion (in-app wipe and backup disable). **Not shared** with third parties. |
| Personal info → user IDs | The backup sign-in identity, only if backup is enabled. Optional. Purpose: app functionality. Deletable in-app and via web (§3.7). |
| Messages → other in-app messages / notifications | Raw notification content is processed **on-device only** and never transmitted; therefore not declared as collected. The prominent-disclosure and declaration flow (§3.1) — not the Data safety form — is where notification access is justified. |
| App activity / App info and performance | Content-free diagnostics: crash data, parse success/failure counts, listener uptime. Purpose: analytics/app functionality. No content, amounts, merchants, or counterparties. Opt-out available. |
| Data deletion | In-app: wipe everything; disable backup (deletes server copies); web deletion path for the sign-in identity. |
| Sharing / selling | None. No ads. No data sold. No third-party advertising or marketing data recipients of any kind. |

The form is regenerated from the lifecycle table (§4) at every release; a mismatch between the two is treated as a release blocker.

### 3.4 Play financial-app declarations

PeraPlano tracks the user's own money, including Loans in both directions (`i-owe` and `owed-to-me`), but it does not offer, broker, or facilitate loans, payments, investments, or any regulated financial service. Play's finance-category declarations are answered accordingly: not a personal loan app, not a banking app, no payment handling. The listing copy avoids any wording that implies the app moves money.

### 3.5 Android 13+: POST_NOTIFICATIONS

The app's *own* alerts — the canonical channel list in [06-information-architecture.md](06-information-architecture.md) §6.1: Limit thresholds at 50% / 80% / 100%, Bill reminders, Loan reminders, Goal updates (milestones and payday-allocation prompts), the daily Review Queue digest, listener-health warnings, and the opt-in payday summary — require the `POST_NOTIFICATIONS` runtime permission on Android 13 and later.

1. Requested in context during onboarding, after its value is explained ("we alert you when a Limit is at risk — before you overspend"), never as a cold system dialog.
2. Denial degrades gracefully: all alerts remain visible in-app (Home surfaces active alerts); nothing is blocked.
3. Notification channels are split by type (limits, bills, loans, goals, review digest, listener health, payday summary — mirroring the canonical channel list in [06-information-architecture.md](06-information-architecture.md) §6.1) so the user can silence categories individually in system settings, and the same toggles are mirrored in-app (§7).

### 3.6 Android 14+: foreground service type declaration

`NotificationListenerService` itself is a bound system service, not a foreground service. However, the app may run a short-lived foreground service for catch-up work (for example, processing a backlog after the listener was restored, or a user-initiated reconciliation pass). On Android 14 and later, every foreground service must declare a specific type in the manifest and at start time:

1. No enumerated foreground service type cleanly matches passive finance tracking; the applicable declaration is **`specialUse`**, which additionally requires a use-case explanation filed in the Play Console and is itself subject to review.
2. The `specialUse` justification mirrors the §3.1 core-functionality framing and is kept consistent with it word-for-word where they overlap.
3. Design pressure: keep foreground service usage minimal and short-lived. If catch-up work can complete within background execution limits without a foreground service, the declaration is dropped entirely — the smallest possible policy surface is the goal.
4. The boot receiver that re-attaches the listener after reboot, and the battery-optimization exemption prompt, are documented in the review evidence pack because reviewers frequently probe background behavior of finance apps.

### 3.7 Account deletion policy

If cloud backup ships with a sign-in identity, Play's account-deletion policy applies: the app must offer identity deletion **in-app and via a web link** shown in the store listing. Deletion removes the sign-in identity and all server-side backup data within 30 days; the on-device ledger survives unless the user also wipes it (their choice, stated clearly at deletion time).

---

## 4. Data lifecycle

| # | Data | Where it originates | Where it is stored | Retention | Ever leaves the device? |
|---|---|---|---|---|---|
| 1 | Raw notification text (target of `rawNotificationRef`), including unknown-bin captures | Posted by other apps; captured by the listener | Encrypted on-device only | **30-day TTL, then purged** (domain invariant) | **Never.** Not in backups, not in telemetry, not in support flows. |
| 2 | Committed Transaction records (structured fields only) | Ingest pipeline auto-commit, Review Queue confirmation, manual entry, recurring rules, import | Encrypted on-device | Kept until the user deletes or wipes. Free-tier History gating limits the *visible* window to 90 days; **data is never deleted at the gate** (see §8). | Only if the user enables cloud backup (Plus); encrypted in transit and at rest. |
| 3 | Configuration entities: Wallet, Limit, Goal, Loan, Bill, Category, RecurringPattern, UserRule, IncomeProfile | User setup and pipeline learning | Encrypted on-device | Until user deletes or wipes | Same as row 2 — only with opt-in Plus backup. |
| 4 | Entitlements state (`tier: free \| plus`) | Purchase state managed by Google Play; evaluated locally | On-device flag | While the app is installed | Purchase processing is handled by Google Play per its own policies; PeraPlano stores no payment instrument data. |
| 5 | Aggregate telemetry: parse success/failure counts per provider, dedupe rates, listener uptime, crash data | Generated on-device | Company analytics store (aggregate, content-free) | Raw event records ≤ 90 days; aggregated statistics ≤ 24 months | Yes, but contains no notification content, amounts, merchants, or counterparties. Opt-out available. |
| 6 | Cloud backup snapshots (Plus, opt-in) | Encrypted sync of rows 2–3 | Company backup infrastructure (via PIP under contract) | Until the user disables backup, wipes, or deletes the sign-in identity; server copies removed within 30 days of any of those | Yes — this is the only path user financial data ever takes off the device, and it is opt-in. |
| 7 | Export files (CSV) | Generated on demand by the user | Wherever the user saves or shares them | User-controlled | Only by the user's own action; the app warns that exports are unencrypted and outside its protection. |
| 8 | Support correspondence | User-initiated | Company support mailbox | ≤ 24 months after case closure | Yes, by the user's own action; users are advised not to paste raw notification text. |

Lifecycle invariants (restating the domain invariants that bind this table):

1. Raw notification text never syncs and is purged after 30 days.
2. Every auto-committed Transaction keeps `rawNotificationRef` while raw text is retained, so the user can always see "why did the app record this?" After the 30-day purge, the structured record remains but the raw text view shows "original notification no longer retained."
3. Wipe means wipe: on-device stores and, where backup was enabled, server copies.

---

## 5. Data minimization stance

1. **Extract, then discard.** The Normalizer keeps only structured fields (`amount`, `direction`, `merchant`, reference number, balance-after when present, `timestamp`); raw text exists solely to power the transparency screen and re-parsing during its 30-day window.
2. **Unknown-bin is not a dragnet.** Notifications from unrecognized packages are captured only so the user can flag "this is a money notification" in the Review Queue; they follow the same on-device-only, 30-day-purge rules as row 1 of the lifecycle table.
3. **Telemetry counts, never content.** Parse-success telemetry is aggregate counters only. A parser failure report contains the provider identity and a failure class — never the text that failed to parse.
4. **No enrichment.** PeraPlano does not look up, buy, or infer additional data about users or their counterparties from any external source.
5. **Collection follows function.** Every field in the domain model exists because a shipped feature reads it; fields are not collected speculatively. Adding a field to any synced entity requires a lifecycle-table update, a Data safety form review, and a privacy-notice check in the same release.

---

## 6. Third-party personal data inside notifications

Notifications can contain personal data of people who are not PeraPlano users and never consented — most commonly the name of someone who sent the user money (for example, a padala — remittance — sender), or a Loan counterparty.

*Illustrative sample only (not a verified provider format):* "You have received ₱500.00 from JUAN D." Real notification formats are captured from devices during implementation and maintained as a versioned parser corpus.

Stance:

1. **Context of origin.** These names were already delivered to the user's own device by the provider; PeraPlano introduces no new disclosure. The user's own record-keeping of who paid them is classic personal/household processing.
2. **Minimize anyway.** Only the short counterparty label needed for the `merchant` field, Categorizer matching, and Loan `paymentHistory[]` matching is retained in structured form. Everything else in the raw text disappears with the 30-day purge.
3. **On-device by default.** Third-party names sit on the user's device; they reach company infrastructure only inside an encrypted Plus backup of the user's own ledger, where the company acts as PIC for the user's data, not as a collector of the third party's.
4. **User-editable.** Counterparty and `merchant` labels can be edited or removed by the user at any time; UserRules can rename them permanently.
5. **Never used beyond the user's ledger.** Third-party names are never aggregated across users, never used for matching between users, never in telemetry.

---

## 7. User controls — the complete list

| Control | What it does | Where |
|---|---|---|
| Pause listening (global) | Ingest stops entirely until resumed; status visibly changes on Home and in settings | More → Settings → Privacy |
| Pause per provider | Stop parsing a specific provider (e.g., pause GCash but keep BPI) | More → Settings → Privacy |
| Listener health | Shows whether the listener is alive, last event time, and OEM-specific fix guidance; "tracking was interrupted" recovery banner | More → Settings; Home banner when degraded |
| Transparency screen ("why was this recorded?") | For any auto-committed Transaction, shows the parsed fields side-by-side with the captured raw text via `rawNotificationRef` while retained | Transaction detail |
| Parser diagnostics | Per-provider parse activity and success view; shows what the pipeline is doing without exposing other users' anything (it is all local) | More → Settings |
| Review Queue | Confirm/correct every low-confidence parse; corrections become UserRules | Transactions tab (badge) |
| Edit anything | Every parsed field — `amount`, `direction`, `walletId`, `categoryId`, `merchant`, `note` — is user-editable | Transaction detail |
| Export everything | CSV export of the ledger plus full structured export of all configuration entities | More → Settings → Privacy (available on all tiers as a data-portability right; the §8 matrix Export row refers only to the Plus-gated Reports CSV convenience export — see [04-features/10-reports.md](04-features/10-reports.md)) |
| Wipe everything | Deletes all on-device data and, if backup was enabled, server copies; confirmation flow states exactly what will be destroyed | More → Settings → Privacy |
| Cloud backup toggle (Plus) | Off by default; enabling states what syncs; disabling deletes server copies within 30 days | More → Settings → Privacy |
| Telemetry opt-out | Stops aggregate diagnostics; no feature loss | More → Settings → Privacy |
| App-alert controls | Per-type toggles for the app's own notifications (limits, bills, loans, goals, review digest, listener health, payday summary — the canonical channel list in [06-information-architecture.md](06-information-architecture.md) §6.1), mirrored with system channels | More → Settings → Notifications |
| Sign-in identity deletion | In-app and via web link, per Play policy; removes identity and server data within 30 days | More → Settings → Privacy (only exists if backup identity exists) |
| Consent review | Re-read the disclosure and notice; withdraw consent (equivalent to pause + optional wipe) | More → Settings → Privacy |

Design rule for all of the above: controls are honest verbs ("pause," "wipe," "delete"), never euphemisms; each control screen states what the control does *and does not* do.

---

## 8. Tier context for privacy-relevant gating

Cloud backup / multi-device sync (and the Reports CSV convenience export) are Plus capabilities, which has a privacy consequence worth stating plainly: **the app never transmits a Free-tier user's financial data off the device** — and the user can always take their own data out via the ungated Export everything control (§7). For reference, the locked tier matrix:

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

Gate behavior never deletes data: when a Free user is over a cap (for example, History beyond 90 days), the data is retained and hidden, not destroyed — restoring Plus restores visibility. The wipe control (§7) is available to every tier; privacy controls are never Plus-gated.

---

## 9. Cross-references

- Ingest pipeline, provider catalogue, unknown-bin behavior: [03-ingest-pipeline.md](03-ingest-pipeline.md)
- Onboarding permission explainers and degrade-to-manual: [04-features/01-onboarding.md](04-features/01-onboarding.md)
- Settings and privacy surfaces: [04-features/11-settings-privacy.md](04-features/11-settings-privacy.md)
- Risks (Play rejection, trust) and open compliance questions: [08-risks-and-open-questions.md](08-risks-and-open-questions.md)
- Tier matrix ownership and gate principles: [05-monetization.md](05-monetization.md)

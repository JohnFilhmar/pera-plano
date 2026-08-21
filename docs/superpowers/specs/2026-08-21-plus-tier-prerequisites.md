# PeraPlano Plus — Prerequisites for Sale

**Status:** Prerequisite register v1 · 2026-08-21 · derived from documents already in this
repository. Every requirement below cites the section that imposes it. Where this file states a
position no repo document supports, it says so in the same sentence.

**Why this file exists.** `/terms` publishes the sentence *"PeraPlano Plus cannot be offered for
sale until these exist"* about the two clauses still in its counsel-required block. That is true and
also incomplete: those clauses are two items on a much longer list, and the rest of the list was
scattered across five documents and one spec's §13. A commitment published on a public page needs a
single place that says what actually satisfies it.

**Why two gates, not one list.** The owner's release plan is not a public launch. What ships in the
near term is a **Google Play testing track** — internal, closed, or open testing — and the owner will
not release to the public store without the PIC entity, the DPO and NPC registration in place. That
splits every item below into two different questions:

- **Gate A** — what must exist before a build can go onto a testing track at all.
- **Gate B** — what must exist before PeraPlano Plus can be *sold*.

Collapsing them produces the wrong behaviour in both directions. Treated as one list, Gate A looks
unreachable and the testing track never happens. Treated as no list at all, a tester build is
uploaded without a privacy-policy URL or a notification-access declaration and is rejected for
reasons that were written down months earlier.

**A testing track is not a compliance-free zone.** This is the most expensive assumption available
here, so it is stated first. Play requires a privacy-policy URL, the Data safety form, and
declarations for every sensitive permission *at submission*, on every track including internal
testing. Closed and open testing additionally put the app in front of real people with real bank
notifications — so RA 10173 applies to that processing from the first tester, not from the public
launch date. `docs/07-privacy-and-compliance.md` §3.1.5 already sequences it this way on purpose:
*"The declaration is exercised first on internal and closed testing tracks to surface policy
objections before any public launch date is committed."* A testing track is where the declarations
get tested, not where they get skipped.

---

## 0. How to read this

- **Gate** — A (testing track) or B (public sale). A few items span both and say so.
- **Source** — the document and section that requires the item. A line with no source is reasoning
  added here, and is flagged as such.
- **What breaks if skipped** — the actual failure, not a vague risk. This is the line that decides
  sequencing when time is short.
- Nothing here is built. It is a register, in the same sense as
  `docs/08-risks-and-open-questions.md` §3.

**One correction to the brief that produced this file.** It cited "`docs/09-v2-backlog.md` §8 tier
context". `09-v2-backlog.md` has five sections; the tier-context section is
`docs/07-privacy-and-compliance.md` §8, and the backlog's tier material is its §1, "Tier matrix
baseline (locked for MVP)". Both are cited correctly below. The backlog section that *is*
load-bearing here is §2.11, whose prerequisite 1 governs off-device processing.

---

## 1. Gate A — before a testing-track release

Shorter than Gate B, and none of it is optional.

### 1.1 Notification-access declaration and in-app prominent disclosure

**Source:** `docs/07-privacy-and-compliance.md` §3.1.1 and §3.1.2.

Play treats `NotificationListenerService` as sensitive and requires a declaration with a
justification. §3.1.1 fixes the framing — reading transaction notifications *is* the product, not a
convenience — and enumerates what the declaration must say happens to the data: on-device parsing
into structured fields, encrypted on-device storage of raw text with a 30-day purge, no off-device
transmission of raw text ever, structured records synced only under user-enabled Plus backup.

§3.1.2 is the part that is easy to under-build: a privacy-policy link **is not sufficient**. Play
requires prominent disclosure and consent *inside the app*, on a dedicated screen, before the
deep-link to the system Notification Access settings. §3.1.4 adds that the permission must be
genuinely skippable with a working degrade-to-manual path — and notes this is visible in review and
materially strengthens the submission.

**What breaks if skipped:** rejection, of the kind that is expensive to unwind. This is Risk 1 (R1)
in `docs/08-risks-and-open-questions.md`.

### 1.2 The review evidence pack

**Source:** `docs/07-privacy-and-compliance.md` §3.1.3.

Submission includes a screen-recorded video of the full flow — disclosure, grant, first auto-tracked
transaction, transparency screen showing the captured text, pause, wipe — plus annotated screenshots,
the privacy notice, and the PIA summary.

**One real dependency on Gate B.** §3.1.3 names "the PIA summary (§2.6)" as part of the pack, and no
PIA exists (§2.5 below). A testing-track pack goes without it; the video, the screenshots and the
published notice are the load-bearing parts. Recorded here as a known incompleteness rather than
quietly treated as satisfied.

§3.6.4 adds two items reviewers of finance apps probe specifically, so they belong in the pack: the
boot receiver that re-attaches the listener after reboot, and the battery-optimization exemption
prompt.

### 1.3 The `QUERY_ALL_PACKAGES` declaration, and its recorded rejection risk

**Source:** `docs/superpowers/specs/2026-08-19-device-issues-triage-and-roadmap.md` §0.2.

`QUERY_ALL_PACKAGES` is a Play *restricted* permission. Every release requires a declaration form,
and — §0.2's own words — "Google's enumerated permitted uses do not obviously cover 'detect which
bank apps the user has installed'; the financial carve-out is worded for fraud and security checks.
**A rejection is a live possibility.**"

The mitigation is already a design constraint rather than a fallback plan: package discovery sits
behind one interface with two implementations — the `QUERY_ALL_PACKAGES` scan, and a `<queries>`
manifest allowlist of known PH bank and e-wallet packages. If a review bounces, the swap is one
implementation, not a redesign of onboarding.

**What breaks if skipped:** the declaration is per-release, so an omitted form blocks the upload
itself. The reason this sits in Gate A rather than Gate B is that a rejection here is *worth
discovering on a testing track* — which is exactly what §3.1.5 says testing tracks are for.

The public justification page for this permission already exists and is deployed: `/installed-apps`.
See §4.1 for the documentation gap underneath it.

### 1.4 The Data safety form

**Source:** `docs/07-privacy-and-compliance.md` §3.3.

Required at submission on every track. §3.3 specifies the declared contents in full, and two of its
rows are the ones most likely to be filled in wrongly by someone working from the app rather than
from the document:

- **Messages → notifications:** raw notification content is processed on-device only and never
  transmitted, *therefore not declared as collected*. Play's definition matters — on-device
  processing is not "collection". The notification-access justification (§3.1) is where that access
  is explained, not this form.
- **Financial info:** collected **only when the user enables cloud backup (Plus)**. Cloud backup has
  not shipped and `SERVICE_CAPABILITIES.cloudBackup` is `false`, so a Gate A form declares *less*
  than §3.3's table, not more.

§3.3 closes with the rule that binds this to everything else: *"The form is regenerated from the
lifecycle table (§4) at every release; a mismatch between the two is treated as a release blocker."*

**What breaks if skipped:** the submission cannot proceed. A form that over-declares is its own
problem — declaring financial data as collected while the app transmits nothing invites questions
about a data flow that does not exist.

### 1.5 The public URLs the Console demands at submission

**Source:** `docs/07-privacy-and-compliance.md` §2.4 (Layer 2 notice) and §2.5 (the DPO contact
appears in Play listing support details);
`docs/superpowers/specs/2026-08-20-server-front-facing-pages-design.md` context items 2 and 3.

Play requires a privacy-policy URL and a support contact before a package can be submitted at all.
Both exist as deployed pages — `/privacy`, `/support`, `/terms`, `/installed-apps`, `/data-deletion`
— which is what the front-facing site was built for.

**The blocking sub-item is not the pages, it is the six environment values.** `PIC_LEGAL_NAME`,
`PIC_ADDRESS`, `DPO_NAME`, `DPO_EMAIL`, `SUPPORT_EMAIL` and `NPC_REGISTRATION` are unset, and
`instrumentation_node.ts` refuses to boot production without them
(`libs/common/src/config/env.ts`; front-facing design spec §5.3). **The site cannot be deployed at
all until they are set**, which makes this a hard Gate A item rather than a polish item.

Two of the six are reachable today with no legal work: `SUPPORT_EMAIL` is a mailbox, and
`NPC_REGISTRATION` is a status string — "registration pending" is an honest value, and the test
fixtures already use exactly that. The other four wait on the entity and the officer (§2.2, §2.3).
So **a testing-track deployment needs the PIC and DPO fields populated even though the roles behind
them belong to Gate B.** That is the sharpest edge in this document and it is restated in §3.

### 1.6 The foreground-service type decision

**Source:** `docs/07-privacy-and-compliance.md` §3.6; open question 3 in
`docs/08-risks-and-open-questions.md` §3.1 (decide by M1 exit).

If catch-up processing needs a foreground service on Android 14+, it must declare a type, and no
enumerated type fits passive finance tracking — the applicable declaration is `specialUse`, which
requires its own Console justification and is itself reviewed. §3.6.3 states the preferred outcome
plainly: if catch-up work fits inside background execution limits, **drop the declaration entirely**
and shrink the policy surface.

**What breaks if skipped:** an undeclared foreground service type is a runtime crash on Android 14+,
not merely a policy finding.

### 1.7 What Gate A does *not* require

Stated explicitly, because a list of obligations with no boundary is how a testing track slips a
quarter:

- No price, no billing integration, no entitlement enforcement. Nothing is sold on a testing track.
- No cloud backup, and therefore no processor agreement and no server-side data at all.
- No account-deletion route — Play's policy binds once a sign-in identity exists, and none does
  (§2.8).
- Not the two undrafted terms clauses. Governing law and refund terms are not submission blockers;
  they are sale blockers.

---

## 2. Gate B — before PeraPlano Plus is offered for sale

### 2.1 The two remaining terms clauses

**Source:** `/terms` `counselRequired` block; front-facing design spec §4.0.2 and §13.3.

Five of the original seven were drafted in-house on 2026-08-21 and are published stamped DRAFT:
intellectual property and the install licence, termination and suspension, limitation of liability
and warranty disclaimer, change notification, and the effective date. All five still need counsel
review, and the liability clause needs it most — Civil Code arts. 1170–1174 and the Consumer Act
constrain what may be disclaimed to a Philippine consumer, and a US-shaped cap can be void here. The
published draft deliberately states the shape and no number.

Two remain undrafted, and neither is a drafting problem:

| Clause | Blocked on | Unblocked when |
|---|---|---|
| Governing law and venue | The PIC entity's domicile, which does not exist (§2.2) | The company is registered and has a registered address |
| Subscription term, renewal, cancellation, refund | Google Play's subscription policies plus a pricing decision (§2.10) | Billing is integrated (§2.9) and a price is chosen |

**What breaks if skipped:** selling a subscription with no refund terms and no governing law is not
a paperwork gap; it is a consumer-protection exposure in a jurisdiction whose Consumer Act is
specifically protective. The page already says so in public.

### 2.2 A PIC legal entity

**Source:** `docs/07-privacy-and-compliance.md` §2.1.

§2.1: the company operating PeraPlano acts as **Personal Information Controller** for any personal
data it actually receives and controls — cloud backup contents, the backup sign-in identity, support
correspondence, and aggregate telemetry. Three of those four exist the moment cloud backup ships, and
support correspondence exists as soon as anyone writes to `SUPPORT_EMAIL`.

There is no registered entity. `/support` and `/` now say so in words, and every page that would
print the identifiers prints a fail-loud marker instead.

**What breaks if skipped:** the notice cannot state the identity and contact details of the PIC,
which §2.4 requires it to contain, and the governing-law clause has no domicile to name (§2.1 above).

### 2.3 A Data Protection Officer

**Source:** `docs/07-privacy-and-compliance.md` §2.5.

§2.5 is unambiguous and does not wait for a threshold: *"A Data Protection Officer is appointed
before public launch regardless of registration thresholds; the DPO's contact appears in the privacy
notice and in Play listing support details."*

**What breaks if skipped:** `DPO_NAME` and `DPO_EMAIL` have no value, the notice cannot carry the
contact §2.4 requires, and the Play listing support details are incomplete.

### 2.4 NPC registration

**Source:** `docs/07-privacy-and-compliance.md` §2.5; open question 1 in
`docs/08-risks-and-open-questions.md` §3.1 (decide by Pre-launch).

§2.5 assesses PeraPlano against the registration circular and records a **planning position:
register.** Appoint and register the DPO with the NPC and register the backup data processing system
before cloud backup enforcement goes live, and no later than public launch. The reasoning is the Plus
footprint: with cloud backup the company processes financial records treated at the sensitive bar
(§2.2) for an intended population well over one thousand users.

§2.5 then defers the final question — which obligations actually attach, given a Free tier that is
on-device only — to Philippine privacy counsel. **This document does not resolve that and must not
be read as resolving it.**

**What breaks if skipped:** processing sensitive personal information at scale without registration
where registration is required is a regulatory exposure in its own right, independent of any breach.

### 2.5 The Privacy Impact Assessment

**Source:** `docs/07-privacy-and-compliance.md` §2.6.

§2.6 requires a PIA following NPC guidance **before public launch**, revisited whenever the lifecycle
table (§4) changes. Scope is fixed: the ingest pipeline end-to-end, third-party data in notifications
(§6), the unknown-bin capture path, telemetry, cloud backup, and the wipe/export controls.

The site currently states that no PIA exists. §3.1.3 also names the PIA summary as part of the Play
review evidence pack, so this is the one Gate B item with a foot in Gate A (§1.2).

**What breaks if skipped:** the evidence pack is incomplete, and §2.6's own trigger condition means
every future §4 change compounds the debt rather than resetting it.

### 2.6 The processor agreement

**Source:** `docs/07-privacy-and-compliance.md` §2.1.

§2.1: any infrastructure vendor hosting encrypted backups acts as a **Personal Information Processor**,
and *"a written outsourcing agreement covering confidentiality, security measures, sub-processing, and
breach assistance is required before cloud backup ships."*

Note the sequencing that follows from §2.7: the 72-hour NPC-and-data-subject breach notification
obligation attaches to systems the company controls, and backup storage is named first among them. A
processor with no contractual breach-assistance duty is a 72-hour clock with no way to start it.

**What breaks if skipped:** the company cannot lawfully outsource the processing, and cannot meet its
own breach posture.

### 2.7 Cloud backup itself — the substance of Plus

**Source:** `docs/07-privacy-and-compliance.md` §4 rows 2, 3 and 6; §3.3; §2.3; `docs/09-v2-backlog.md`
§2.11 prerequisite 1.

Cloud backup is not one feature among eleven in the tier matrix. It is the only row that changes
where a user's data physically is, and every server-side obligation in this document exists because
of it. Shipping it requires, in the same release:

1. **New lifecycle rows and edits in §4.** Row 6 (cloud backup snapshots) is already drafted in §4,
   as are the "only with opt-in Plus backup" clauses on rows 2 and 3. What changes on shipping is
   that they stop describing an intention and start describing a system — and §2.4's rule binds both
   ways: *"the notice must never claim more than the architecture delivers, and the architecture must
   never do more than the notice says."*
2. **A Data safety form update, per §3.3.** Financial info and user IDs move from not-collected to
   collected-when-enabled. §3.3's release-blocker rule applies.
3. **Its own opt-in consent.** §2.3's lawful-basis table gives cloud backup "consent plus necessity
   for a service the user requested", strictly opt-in and disabled by default. Backlog §2.11
   prerequisite 1 states the general principle that governs it: off-device processing *"requires its
   own opt-in consent, lifecycle-table row, and Data safety declaration — **never bundled silently
   into backup consent**."* Written about AI insights, it is the rule for any new egress, including
   backup itself.
4. **Disabling it must actually delete.** §4 row 6 and §2.8's erasure row: server copies removed
   within 30 days of disabling backup, wiping, or deleting the sign-in identity.
5. **The processor agreement (§2.6) signed first**, not in parallel.

**What breaks if skipped:** Plus without cloud backup is a thinner product than the published matrix
promises (§2.11 below), and cloud backup shipped without the five items above is the exact failure
this repository's privacy architecture was designed to make impossible.

### 2.8 Play's account-deletion policy

**Source:** `docs/07-privacy-and-compliance.md` §3.7; open question 4 in
`docs/08-risks-and-open-questions.md` §3.1 (decide by Pre-launch).

§3.7: *"If cloud backup ships with a sign-in identity, Play's account-deletion policy applies: the app
must offer identity deletion **in-app and via a web link** shown in the store listing."* Deletion
removes the sign-in identity and all server-side backup data within 30 days; the on-device ledger
survives unless the user also wipes it, and that choice is stated at deletion time.

**Both halves are required.** The in-app route alone does not satisfy the policy — the web link is
what lets someone who has uninstalled the app still delete their data, and it must appear in the
store listing.

**The trigger is the identity, not the launch.** The policy activates the moment a sign-in identity
exists, which is why `SERVICE_CAPABILITIES.accounts` is a tripwire rather than a comment: flipping it
fails `libs/common/src/__tests__/capabilities.test.ts`, and the failing test names the work. The
`/data-deletion` page is already written in the conditional so it stays true when that day comes.

Open question 4 is the live one: stand the web deletion endpoint up at MVP launch, or gate it to
backup enforcement. This document does not decide it.

**What breaks if skipped:** a policy violation that reaches the whole listing, not just the feature.

### 2.9 Google Play Billing and in-app tier enforcement

**Source:** `docs/05-monetization.md` §4 and §6.2.3; `docs/00-product-brief.md` §8;
`docs/07-privacy-and-compliance.md` §4 row 4.

Two distinct pieces of work that are easy to treat as one:

- **Billing integration.** §6.2.3: Play policy requires in-app digital subscriptions to go through
  Play's billing system. Privacy §4 row 4 fixes the boundary that keeps the privacy story intact —
  purchase state is managed by Google Play under its own policies, and **PeraPlano stores no payment
  instrument data**; what the app keeps is a local `tier` flag. `/terms` publishes both facts.
- **Entitlement enforcement.** Brief §8: gating "is defined now and enforced later through a single
  Entitlements layer (`tier: free | plus`, hardcoded to `plus` during MVP)". Monetization §4 gives
  the design: one thin layer, evaluated at call-sites, one check per gate, a call-site inventory with
  one row per matrix row, local-first evaluation, and a grace window on billing lapse aligned to the
  store's retry semantics. §4 also names where checks must **not** exist — the ingest pipeline, alert
  delivery, Wallet balance computation, the privacy controls, and Review Queue triage.

Enforcement flip criteria are open question 17 in `docs/08-risks-and-open-questions.md` §3.4.

**What breaks if skipped:** without billing there is no way to buy Plus; without enforcement there is
no difference between the tiers, and the published matrix (§2.11) describes a product that does not
behave that way. **Right now neither exists, which is why `/terms` was changed on 2026-08-21 to say
that nobody is on a limited tier today.**

### 2.10 The pricing decision

**Source:** `docs/05-monetization.md` §6; `docs/00-product-brief.md` §8; open question 16 in
`docs/08-risks-and-open-questions.md` §3.4 (decide by Pre-launch).

Pricing in pesos is deliberately undecided, and §6 frames the option space rather than fixing a
number: monthly, annual at a discount, and a possible lifetime one-time, with a free trial or a
launch-window "everyone is Plus" period interacting with all three.

§6.2 lists the five decision inputs that must be gathered first — willingness-to-pay signals from PH
beta users, comparable PH subscription pricing, Play billing mechanics available in the Philippines,
whether kinsenas-anchored billing improves renewal, and the cost floor set by backup infrastructure
plus ongoing parser-corpus maintenance.

§6.3 locks four constraints whatever the number is: PHP only; one paid tier; no ads or data
monetization at any price; and the free tier stays genuinely useful indefinitely — *"the §2 matrix is
the promise; it is not tightened to force conversion."*

**What breaks if skipped:** the subscription clause cannot be drafted (§2.1), and `/terms` currently
promises that "prices, the billing period, and the renewal, cancellation and refund terms will appear
on this page before any purchase is possible."

### 2.11 The tier matrix is a commitment already made in public

**Source:** `/terms` `terms.sections.tiers`; `docs/00-product-brief.md` §8;
`docs/07-privacy-and-compliance.md` §8; `docs/09-v2-backlog.md` §1.

The eleven-row matrix is published on `/terms` and reproduced identically in three repo documents.
It is not a plan any more — it is a representation a stranger can read, and `/terms` is a page a Play
reviewer may read alongside the listing.

**Treat any divergence as a change requiring a page revision, not a build detail.** Three concrete
cases:

1. **A capability moves between columns.** Backlog §1: *"Additions extend the tier matrix; they never
   silently modify existing locked rows."* Moving an existing row is the case that document forbids.
2. **A cap changes value.** Monetization §6.3.4 locks the direction: the matrix is the promise and is
   not tightened to force conversion. Loosening it is still a page edit.
3. **Plus ships without a matrix row.** Cloud backup is the live risk here — if Plus becomes
   purchasable before backup ships, the reader is buying a matrix with one of its two headline rows
   missing. Either the row ships or the page says which rows are not yet available.

Three facts already render beneath the matrix and must survive any edit, because without them the
matrix misrepresents the product: caps are not enforced in the current build and nobody is on a
limited tier today; a cap blocks creation and never deletes or retroactively hides; and privacy
controls are never Plus-gated, with the Export row referring only to the Plus convenience export in
Reports rather than to the ungated data-portability export (privacy §7 and §8).

---

## 3. Commonly assumed deferrable, and not

The point of this section is that the list of things a testing track *can* skip is shorter than it
feels.

| Assumed deferrable | Actually |
|---|---|
| "The privacy policy can wait for public launch" | **No.** A privacy-policy URL is required at submission on every track (§1.5), and RA 10173 applies to real testers' real notification data from the first closed-testing install. |
| "Data safety can be filled in later" | **No.** Required at submission (§1.4), and §3.3 makes a form/§4 mismatch a release blocker. |
| "Sensitive-permission declarations are a launch thing" | **No.** Notification access (§1.1) and `QUERY_ALL_PACKAGES` (§1.3) are per-release declarations. §3.1.5 puts them on testing tracks deliberately, to surface objections early. |
| "We can deploy the site with the compliance fields blank for now" | **No.** The boot gate exits the process (§1.5). The values are unset today, so the site cannot be deployed at all — and four of the six depend on Gate B roles. This is the one place where Gate B reaches backwards into Gate A. |
| "The terms page can stay incomplete" | **For a testing track, yes** — nothing is sold. For sale, no (§2.1). |
| "The DPO can wait until we have users" | **No, per our own document.** §2.5 appoints before public launch *regardless of registration thresholds*. Whether that binds a closed testing track is a counsel question this file does not answer. |
| "The PIA is a launch-week task" | **No.** §3.1.3 puts the PIA summary in the Play review evidence pack, so it is wanted earlier than §2.6's "before public launch" deadline implies. |
| "Account deletion matters once we have accounts" | **True, and the trigger is earlier than launch.** §3.7 binds the moment a sign-in identity exists, including on a testing track, and requires an in-app route *and* a web link in the listing (§2.8). |

Genuinely deferrable to Gate B: billing integration, entitlement enforcement, the pricing decision,
cloud backup and everything downstream of it (processor agreement, backup lifecycle rows, the Data
safety update for collected financial data), the account-deletion route, and the two undrafted
clauses.

---

## 4. Open problems, recorded rather than resolved

### 4.1 `docs/07-privacy-and-compliance.md` §4 has no row for installed-package enumeration

**Status: open. Owner and DPO action. Deliberately not closed here.**

Found while writing `/installed-apps` (front-facing design spec §13.2, and the SDD ledger's Task 10
ruling). §5.5 requires a lifecycle-table entry for data the product handles, and §2.4 requires the
notice and the architecture to agree. A row 9 is needed — originates: `PackageManager` query at
onboarding; stored: not persisted beyond the derived provider selection; retention: n/a; leaves
device: never.

**Why this file does not write it.** §2.4 attaches a notice revision to any §4 change, and §2.6
attaches a PIA review. That makes editing §4 an owner-and-counsel decision, not an engineering one.
Until the row exists, `/privacy` and `/installed-apps` describe overlapping processing from two
different authorities — the compliance document and a spec — and a regulator reading both notices
the notice is silent about a data class the site elsewhere describes.

This gate list is a place to record the gap, not to close it.

### 4.2 "Early installers and beta testers keep Plus permanently" has no mechanism

**Status: open design problem. Not designed, not implemented, and deliberately not published.**

The owner intends early installers and beta testers to keep Plus permanently. Nothing in the product
can currently deliver that, and the reason is structural rather than a missing feature.

**The constraint.** Entitlements is local-first by design: `docs/05-monetization.md` §4 stores `tier`
on-device and evaluates it offline, and there are no accounts and no server-side identity at all
(the front-facing design spec's hard-fence non-goals — 'no user accounts, no Firebase auth' —
and `SERVICE_CAPABILITIES.accounts`, which is `false`). **A
device-local flag cannot survive a reinstall, a factory reset, or a new phone.** A grant that
evaporates when a tester changes handset is worse than no grant, because it was promised.

**What would make it durable is exactly what has been deferred.** Persisting an entitlement across
devices requires an identity to attach it to — the Firebase email auth named as future work, arriving
with cloud backup. That is the identity layer whose absence is the reason `/data-deletion` and
`/privacy` can say what they say, and whose arrival triggers §2.8's Play account-deletion obligations.
So the tension is real and not a matter of effort: **the promise needs the identity layer, and the
privacy story currently depends on there being no identity layer.**

Partial routes exist and each has a cost, none of which is assessed here: Play's own purchase history
tied to the Google account (works only for something actually purchased, which a free grant is not);
a launch-window "everyone is Plus" period, which `docs/05-monetization.md` §6.1 already names as
inside the option space and which the MVP's hardcoded `plus` makes trivially available (but it is a
period, not a permanent per-user grant); or a signed, device-independent voucher the user can
re-enter, which is an identity mechanism in all but name.

**Explicitly not done here:** no design, no implementation, and **nothing added to the terms**. An
entitlement commitment with no mechanism behind it is precisely the kind of clause that should not be
published — it would be a promise the architecture cannot keep, which is the defect class this whole
site exists to prevent.

### 4.3 "TestFlight" is iOS, and there is no iOS app

The near-term target was described as including TestFlight. TestFlight is Apple's testing
distribution and does not apply to this product: PeraPlano is Android-only, and iOS is deferred in
`docs/00-product-brief.md` §9 item 6 and `docs/09-v2-backlog.md` §2.1 for a hard reason — the
platform has no public API for reading other apps' notifications, so an iOS version is *"a designed,
degraded manual-ingest path, not a port."*

This document therefore reads the near-term target as **Play internal / closed / open testing** only.
If an iOS build is genuinely intended, that is a v2 backlog item with its own prerequisites and an
entirely separate App Store review surface, and none of Gate A above covers it.

---

## 5. Cross-references

- `docs/07-privacy-and-compliance.md` — RA 10173 roles (§2.1), DPO and NPC (§2.5), PIA (§2.6), breach
  posture (§2.7), Play declarations (§3.1–§3.7), the lifecycle table (§4), user controls (§7), tier
  context for privacy-relevant gating (§8). **Not edited by this document**; see §4.1.
- `docs/00-product-brief.md` §8 — monetization stance and the locked tier matrix; §9 — non-goals.
- `docs/05-monetization.md` — tier rationale (§2), gate behaviour (§3), the Entitlements layer and
  call-site inventory (§4), pricing framing and locked constraints (§6).
- `docs/08-risks-and-open-questions.md` §3.1 and §3.4 — the compliance and monetization open
  questions this file defers to, with their decide-by gates.
- `docs/09-v2-backlog.md` §1 — tier matrix baseline and the "additions never silently modify locked
  rows" rule; §2.11 prerequisite 1 — off-device processing is never bundled silently.
- `docs/superpowers/specs/2026-08-19-device-issues-triage-and-roadmap.md` §0.2 —
  `QUERY_ALL_PACKAGES` and its recorded rejection risk.
- `docs/superpowers/specs/2026-08-20-server-front-facing-pages-design.md` — the public pages, the
  fail-loud config (§5), the derivation rule (§4.0), and the owner/counsel action list (§13).

# On-Device AI — Required Doc Amendments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land spec §9's four required doc amendments so that the on-device assistant design and the shipped planning documents stop contradicting each other — and land the one that is a promise to users **after** the hardware has shown it can be kept, not before.

**Architecture:** Four edits across three documents, plus one recorded no-op. Three of the four are safe to land the moment the design spec is accepted; **one is not**, and this plan sequences it behind the spike's tier-1 tool-pick number rather than treating "the spec says so" as sufficient evidence.

**Tech Stack:** Markdown. No code, no tests, no dependencies. The verification here is reading, and the discipline is that a documented promise is a promise.

**Spec:** `docs/superpowers/specs/2026-08-18-on-device-ai-assistant-design.md` §9, with §0.3, §8.2, §6 risks 1 and 7, and §2.4 as the supporting argument.
**Companion plans:** `docs/superpowers/plans/2026-08-20-on-device-ai-spike.md` (Task 8 produces the number Task 3 below waits on) · `docs/superpowers/plans/2026-08-20-on-device-ai-assistant.md`

---

## Why a small plan gets a real one

Spec §9 opens: *"These are not optional and they are not implicit. This spec deliberately diverges from a shipped planning document, and a silent divergence is how two documents start contradicting each other."*

That is the whole justification. `docs/09-v2-backlog.md` is not a scratch file — it is the document that records what the product deferred and why, and it is the document a future reader consults to find out whether a decision was made or merely drifted into. An undocumented divergence between it and a design spec means the next person to read either one is reading something false, and has no way to know which.

---

## Verification: all four targets resolve exactly

Checked against the repository on 2026-08-20. **None of the four amendments has been applied.**

| Target | Line | Current text (verbatim, abridged where marked) |
|---|---|---|
| `docs/09-v2-backlog.md` §2.11 heading | 197 | `### 2.11 AI insights — Band: Far` |
| Prerequisite 4 — **must not change** | 207 | `4. Tone and scope rules: descriptive and forward-warning insights first; prescriptive financial advice is a regulatory and ethical line requiring separate review before ever crossing.` |
| Tier placement | 209 | `**Tier placement when shipped.** Plus. Adds an "AI insights" row: Free —, Plus ✓. Deterministic MVP insights (Safe-to-Spend today, basic monthly reports) remain Free per the existing matrix.` |
| Horizon row | 227 | `\| AI insights \| Far \| Plus \| Privacy-cleared processing + history depth \|` |
| `docs/07-privacy-and-compliance.md` §3.3 Data safety | 105–118 | Six-row table; no model-download row |
| `docs/07-privacy-and-compliance.md` §4 Data lifecycle | 147–166 | Eight numbered rows, 1–8; no model rows |
| `docs/07-privacy-and-compliance.md` §7 User controls | 194–215 | Fourteen control rows; no "Delete downloaded model" |
| `docs/00-product-brief.md` non-goal 2 | 121 | `2. **Not a financial advisor.** It reports facts against user-set rules; it does not recommend products, investments, or credit.` |

Two facts the amendments must respect, found while verifying:

- **`docs/07-privacy-and-compliance.md` §4's closing note is binding on this plan:** *"The form is regenerated from the lifecycle table (§4) at every release; a mismatch between the two is treated as a release blocker."* So the §4 rows and the §3.3 entry are **one edit in two places**, not two independent edits, and landing one without the other creates the exact mismatch that sentence calls a blocker.
- **§2.4's rule applies to every word added here:** *"the notice must never claim more than the architecture delivers, and the architecture must never do more than the notice says. Any change to the lifecycle table (§4) requires a notice revision in the same release."* Task 4 therefore names the notice revision as part of its own deliverable rather than leaving it for someone else to notice.

---

## Global Constraints

- **Match each document's existing voice and table shape exactly.** `09-v2-backlog.md` uses `**Bolded lead.** Prose.` paragraphs and a pipe-table horizon summary; `07-privacy-and-compliance.md` uses numbered lifecycle rows with a fixed six-column header and a control table with a `Control | What it does | Where` header. A row that does not match its table's column count silently renders wrong.
- **Never edit `docs/09-v2-backlog.md:207`.** Prerequisite 4 is *"the line this design is built to avoid crossing, not a line this design crosses"* (spec §9 amendment 2). Any diff that touches it is wrong, and it is the single easiest thing to break while rewriting the paragraph two lines below it.
- **Do not renumber `docs/07-privacy-and-compliance.md` §4's existing rows 1–8.** The new rows are 9 and 10. Rows are referenced by number from §3.3, §5 and §8; renumbering silently breaks every one of those references.
- **Line numbers in this plan are pre-edit.** After Task 2 lands, the numbers in Tasks 3 and 4 shift. Locate by the quoted text, not by the line number.
- **Commits:** Conventional Commits, `docs:` prefix. **No AI-attribution trailer or footer of any kind.**
- **No `.env*`, no `*.enc`, no key material.**

---

## Task 1: Decide the sequencing, and record the decision

**Files:**
- Create: `docs/superpowers/specs/2026-08-2X-ai-tier-placement-decision.md`

**This task exists because amendment 1 is being made ahead of its own evidence.**

Spec §0.3 and §8.2 argue the Plus → Free move on a zero-marginal-cost basis, and that argument is sound as far as it goes: *"On-device inference has zero marginal cost: the user supplies the silicon and the electricity. Gating it protects no margin; it only shrinks the free tier's differentiator and turns 'your money never leaves your phone' — the single strongest thing about this product — into a paid feature."*

But the same spec, twenty pages later, says something the amendment does not account for. **§6 risk 7:**

> Only tier 1 (~0.4 GB) is casually downloadable on a Philippine prepaid plan. That raises the stakes on tier 1's tool-pick score enormously — it is the tier most users will actually try — and **tier 1 is the model least likely to clear the bar.** Risks 1 and 7 are the same risk seen from two sides.

And **§6 risk 1:**

> If only tier 4–5 clear the bar, "free for everyone" quietly becomes **"free for everyone with 8 GB of RAM and 2.5 GB of storage to spare"**, which is a materially different product claim.

The zero-marginal-cost argument establishes that gating *protects no margin*. It does **not** establish that the free tier can actually run the feature. Those are different claims, and only the second one is a promise to a user.

**So the risk this task manages is specific and asymmetric.** A tier-placement row in `09-v2-backlog.md` saying `Free ✓` is a commitment the product will be held to. If the spike then shows tier 1 at 45% strict tool-pick and only the 2.5 GB tier clears 70%, the doc says "free" while the feature is reachable only by users with 8 GB of RAM and the data allowance to fetch 2.5 GB — and walking that back is a visible retreat from a published free-tier promise, which costs far more than never having made it.

**Landing it late costs almost nothing.** §0.4 already defers all building until after the MVP ships. There is no window in which the backlog needs to say `Free` before the spike returns.

- [ ] **Step 1: Choose one of the two acceptable sequencings**

Both are defensible. Pick one, in writing, with a name attached.

**Option A — sequence it (recommended).** Land amendment 2 (the banding split) now, because it is a statement about *which subset of the feature moved bands* and rests on prerequisites §2.11 itself already lists as met. Hold amendments 1 and 3 until the spike's tier-1 and 4B tool-pick numbers exist. Then land amendment 1 with the tier placement the numbers support.

**Option B — write it conditional.** Land amendment 1 now, but as a conditional statement rather than a flat one: *"Free, subject to the on-device evaluation in the design spec §5.5 demonstrating that at least one RAM-gated-for-all tier clears the tool-pick bar; if only the larger tiers clear it, the row is re-decided before ship."* This is honest and it keeps the doc synchronised with the spec today.

**Option C — land it flat now — is rejected.** It publishes a promise on evidence that does not exist, in the one document whose purpose is to record what was decided and on what basis.

- [ ] **Step 2: Write the decision doc**

```markdown
# AI Insights Tier Placement — Sequencing Decision

**Decided:** 2026-__-__   **By:** ____   **Option chosen:** A / B

## The question

Design spec §0.3 and §8.2 move AI insights from Plus to Free on a zero-marginal-cost
argument. §6 risks 1 and 7 say the tier most users can actually download (tier 1, ~0.4 GB
— the only one casually fetchable on a Philippine prepaid plan) is the tier least likely
to clear the 70% strict tool-pick bar. The cost argument and the capability argument are
different claims, and only the second one is a promise to a user.

## Decision

____

## What the decision is conditioned on

The spike's Task 8 table (`docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md`
§5): strict tool-pick at 0.6B, 1.7B-Q4 and 4B-Q4.

| Outcome | Tier placement |
|---|---|
| Tier 1 clears ~70% | Free, unconditionally. §0.3's argument stands as written. |
| Tier 1 fails but 1.7B-Q4 clears, and 1.7B-Q4 stays resident on 6 GB | Free, with the download size stated plainly wherever the row appears. 1.1 GB is a real ask on prepaid data and the row should not pretend otherwise. |
| Only tier 4–5 clear | **Re-decide.** §6 risk 1's "free for everyone with 8 GB of RAM and 2.5 GB of storage to spare" is a materially different product claim and needs its own decision, not an inherited one. |

## What does NOT change under any outcome

- `docs/09-v2-backlog.md:207` — prescriptive advice stays a Far-band, separate-review line.
- `docs/00-product-brief.md:121` — non-goal 2 is untouched. The assistant is explanatory only.
- The §9 amendment 2 banding split, which is about scope rather than price and lands regardless.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-2X-ai-tier-placement-decision.md
git commit -m "docs: sequence the AI insights tier move behind its own evidence"
```

---

## Task 2: `docs/09-v2-backlog.md` §2.11 — split the banding (spec §9 amendment 2)

**Files:**
- Modify: `docs/09-v2-backlog.md` §2.11 (:197-209)

**Gate: none.** This lands now, under either sequencing option. It is a statement about *what moved*, not about *what it costs*.

**What the amendment says, and why it is safe ahead of the spike.** Spec §9 amendment 2:

> The **"Far" band still holds for prescriptive and proactive insights**: anomaly flags, forward warnings, plain-language monthly summaries. Only the **explanatory question-answering subset** moves, and it moves because it clears §2.11's own prerequisites: prerequisite 1 (processing location) is answered — fully on-device, no ledger content leaves the phone, so no new consent, no lifecycle row for ledger data, no Data safety change; prerequisite 3 (evaluation protocol) is answered by §2.5 and §5.5; prerequisite 4 (tone and scope) is answered by §4 being structural rather than a tone guideline.

Every one of those three is a claim about the **design**, which exists and is approved. None is a claim about **hardware**, which is what the spike measures. That is why this half is safe now and Task 3's half is not.

**Prerequisite 2 is conspicuously absent from that list, and correctly so.** §2.11's prerequisite 2 is *"sufficient per-user history depth and category hygiene"* — and it is still unmet, which is precisely what spec §0.4 says: *"An explanatory assistant has nothing to explain until there is ledger history. On day one it can only say 'you have no transactions', which is worse than not shipping it."* Say so in the amendment. A split that quietly claimed all four prerequisites were met would be overclaiming in the document whose job is to record what is not yet true.

- [ ] **Step 1: Read §2.11 in full before editing**

Lines 197–209. The paragraph at :199 ("What it is") already enumerates the feature as *"plain-language monthly summaries, anomaly flags..., forward warnings..., and question-answering over the user's own data"* — **four things, of which exactly one moves.** That sentence is the natural seam for the split and the edit should use it rather than inventing a new taxonomy.

- [ ] **Step 2: Split the entry**

Rewrite §2.11's heading and "What it is" paragraph so the two halves are named and banded separately. Keep the section number `2.11` — it is cross-referenced from `docs/09-v2-backlog.md:227`, from the design spec §10, and from `docs/07-privacy-and-compliance.md`'s cross-reference block; renumbering it to 2.11a/2.11b would break all three. Structure it as one section with two clearly banded sub-parts.

The banding statement to land, in the document's own voice:

```markdown
### 2.11 AI insights — Band: Far (prescriptive and proactive) · Near-after-MVP (explanatory Q&A)

**What it is.** A layer that turns the ledger into guidance. It splits into two halves with
different bands, and the split is the point:

- **Explanatory question-answering over the user's own data** — "saan napunta ang pera ko?",
  "why is my safe-to-spend so low?" — answered from the same repositories the screens read,
  by a model the user chose and downloaded, running entirely on their phone. **Band: after
  the MVP ships.** Design: `docs/superpowers/specs/2026-08-18-on-device-ai-assistant-design.md`.
- **Prescriptive and proactive insights** — anomaly flags ("Fees & Charges doubled this
  month"), forward warnings ("at this pace you'll cross your Groceries/Palengke Limit by the
  22nd"), plain-language monthly summaries. **Band: Far, unchanged.**

Both remain distinct from the MVP's deterministic insight features (recurring detection,
Safe-to-Spend, reports), which stay rule-based and explainable.

**Why the explanatory half moves, and the other does not.** Three of this section's four
prerequisites are answered for the explanatory half specifically:

- **Prerequisite 1 (processing location)** — answered. Fully on-device; no ledger content
  leaves the phone. No new consent, no lifecycle row for ledger data, no Data safety change.
  (The model *download* is a separate matter and does get a lifecycle row —
  see [07-privacy-and-compliance.md](07-privacy-and-compliance.md) §4 rows 9–10.)
- **Prerequisite 3 (evaluation protocol)** — answered by an on-device eval measuring strict
  tool-pick accuracy, grounding-rejection rate, decode speed and time-to-first-token on the
  user's own hardware, with a stated cut criterion per tier.
- **Prerequisite 4 (tone and scope)** — answered by the guardrail being **structural**:
  deterministic input triage and a deterministic output guard on both sides of the model,
  rather than a tone guideline in a system prompt.
- **Prerequisite 2 (history depth) is NOT yet answered, and it is why this ships after the
  MVP rather than in it.** An explanatory assistant has nothing to explain until there is
  ledger history; on day one it can only say "you have no transactions".

None of the above is answered for the prescriptive and proactive half, which additionally
runs straight into prerequisite 4's own line — see below, unchanged.
```

- [ ] **Step 3: Confirm :207 is byte-identical after the edit**

```bash
git diff docs/09-v2-backlog.md | grep -n "prescriptive financial advice is a regulatory"
```

Expected: **no output**, or only a context line with a leading space — never a `-` or `+`. Prerequisite 4 must survive verbatim. Spec §9: *":207 stays exactly as written — it is the line this design is built to avoid crossing, not a line this design crosses."*

- [ ] **Step 4: Confirm the cross-references still resolve**

```bash
grep -rn "2\.11" docs/ | grep -v superpowers/plans
```

Every hit must still point at a section that exists under that number.

- [ ] **Step 5: Commit**

```bash
git add docs/09-v2-backlog.md
git commit -m "docs: split AI insights banding, explanatory Q&A apart from prescriptive"
```

---

## Task 3: `docs/09-v2-backlog.md` :209 and :227 — Plus → Free (spec §9 amendment 1)

**Files:**
- Modify: `docs/09-v2-backlog.md` tier placement (currently :209)
- Modify: `docs/09-v2-backlog.md` horizon row (currently :227)

**Gate: Task 1's decision, and — under Option A — the spike's Task 8 tier-1 and 4B strict tool-pick numbers.**

**Do not execute this task on the strength of the spec alone.** That is the finding this plan exists to act on. Re-read Task 1 before starting.

**The reason to record in the doc**, per spec §9 amendment 1: *"the Plus placement assumed server-side inference with a per-query marginal cost; on-device inference has none, so gating protects no margin and only shrinks the free tier's differentiator."*

**The :227 row splits into two** — an explanatory row that moves, and a prescriptive row that does not.

- [ ] **Step 1: Confirm the gate is open**

Under **Option A**: open `docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md` §5 and read the strict tool-pick table. Apply Task 1's outcome table. If the row says **Re-decide**, stop and go back to Task 1 — do not land a placement the numbers do not support.

Under **Option B**: proceed, and use the conditional wording in step 2's variant.

- [ ] **Step 2: Rewrite the tier placement paragraph**

Unconditional form (Option A, gate open):

```markdown
**Tier placement when shipped.** **Free — the explanatory assistant is free for every user.**
Prescriptive and proactive insights remain **Plus** when they ship, per their unchanged Far band.

Amended from "Plus" on 2026-__-__. The original placement was correct for the feature it
described: server-side inference with a per-query marginal cost, where a free tier is an
unbounded bill. On-device inference has **zero** marginal cost — the user supplies the silicon
and the electricity — so gating protects no margin. It would only shrink the free tier's
differentiator, and it would turn "your money never leaves your phone" into a paid feature,
which is the one sentence this product cannot afford to put behind a paywall.

Adds an "AI assistant (explanatory)" row: Free ✓, Plus ✓. Deterministic MVP insights
(Safe-to-Spend today, basic monthly reports) remain Free per the existing matrix; the §8 tier
matrix in [07-privacy-and-compliance.md](07-privacy-and-compliance.md) is unchanged by this.

**Reopens if:** any part of the inference path ever moves off-device. Then the original
per-query-cost reasoning returns intact and the row goes back to Plus.

**Hardware caveat, recorded rather than hidden:** the assistant requires a downloaded model,
and the tiers a device is offered are gated on its total RAM. Measured tool-pick accuracy per
tier is in `docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md`. "Free" here means
"not price-gated"; it does not mean every device runs every tier, and no surface should imply
that it does.
```

Conditional form (Option B, gate not yet open) — replace the first paragraph with:

```markdown
**Tier placement when shipped.** **Free**, conditional on the on-device evaluation
(design spec §5.5) showing that at least one tier available to a typical 6 GB device clears
the strict tool-pick bar. If only the larger tiers clear it, this row is re-decided before
ship rather than inherited — "free for everyone with 8 GB of RAM and 2.5 GB of storage to
spare" is a materially different product claim from "free for everyone".
```

- [ ] **Step 3: Split the horizon row at :227**

Current single row:

```markdown
| AI insights | Far | Plus | Privacy-cleared processing + history depth |
```

Becomes two, keeping the table's four-column shape and its existing ordering by band:

```markdown
| AI assistant (explanatory, on-device) | After MVP | Free | Ledger history depth + on-device eval clears the tool-pick bar |
| AI insights (prescriptive / proactive) | Far | Plus | Privacy-cleared processing + history depth + the separate review §2.11 prerequisite 4 requires |
```

**Both rows are needed.** Deleting the original and adding one would lose the record that the prescriptive half is still deferred and still Plus — which is the half a reader is most likely to assume moved along with the other.

- [ ] **Step 4: Verify the table still parses and the columns still align**

```bash
sed -n '215,230p' docs/09-v2-backlog.md
```

Every row must have exactly four `|`-delimited cells matching the header at :215-216.

- [ ] **Step 5: Commit**

```bash
git add docs/09-v2-backlog.md
git commit -m "docs: move the explanatory AI assistant from Plus to Free"
```

---

## Task 4: `docs/07-privacy-and-compliance.md` — three additions (spec §9 amendment 3)

**Files:**
- Modify: `docs/07-privacy-and-compliance.md` §4 Data lifecycle (currently :147-166)
- Modify: `docs/07-privacy-and-compliance.md` §7 User controls (currently :194-215)
- Modify: `docs/07-privacy-and-compliance.md` §3.3 Data safety (currently :105-118)

**Gate: the feature existing, or at minimum Phase 0 Task 1 of the implementation plan having chosen a host.** §4's row 9 must name what the request reveals and to whom, and "to whom" is the hosting decision. A lifecycle row that says "a third-party host, TBD" is not a lifecycle row.

**One edit in three places, not three edits.** §4's own closing note: *"The form is regenerated from the lifecycle table (§4) at every release; a mismatch between the two is treated as a release blocker."* Land all three in one commit.

**What is being disclosed, and why it is disclosed rather than glossed.** Spec §2.4:

> The weights are fetched from a third-party host. **No user data leaves the phone** — but the request does reveal the device's IP address and which model was chosen to whoever hosts the file. That is a new recipient in a product whose entire pitch is that there aren't any, so it is disclosed rather than glossed... It is not "collection" for the Data safety form — nothing about the user is transmitted — but it is honest to say it out loud.

That last distinction is the whole craft of this task. **The Data safety form describes data *collected*, and nothing about the user is transmitted, so this is not a collection declaration.** But §2.4's rule — *"the notice never claims more than the architecture delivers"* — runs in both directions, and a product whose §5 minimization stance and §8 tier note both say the app never transmits a Free user's financial data must not quietly acquire an undisclosed outbound request.

- [ ] **Step 1: Add lifecycle rows 9 and 10 (§4)**

Append after existing row 8, **without renumbering rows 1–8** — they are referenced by number from §3.3, §5 and §8.

```markdown
| 9 | Model download requests (on-device assistant) | Generated on-device when the user explicitly chooses to download a model | Not stored; the request is transient | n/a — no record is kept on-device beyond the downloaded file (row 10) | **Yes, the request itself.** No user data and no ledger content is transmitted. The request reveals the device's IP address and which model was chosen to the file's host. Occurs **only on explicit user action**; never automatic, never on a schedule, never at install. |
| 10 | Downloaded model weights (`files/models/`) | Public model weights fetched from a third-party host | On-device, **unencrypted by design** — they are public files anyone can download, not user data; storing them inside SQLCipher would cost heavily in write amplification and protect nothing | Until the user deletes the model (§7) or uninstalls the app | **Never.** Excluded from Android backup by an explicit rule, so multi-gigabyte public weights never enter a user's backup quota. |
```

Then add a fourth lifecycle invariant beneath the existing three:

```markdown
4. The assistant's conversations are **never persisted** — not in the encrypted database, not
   in the cache, not in a file. They are dropped when the app re-locks and when it exits.
   There is therefore no chat-log row in this table, and that absence is the design, not an
   omission.
```

**That invariant earns its place.** Spec §4.6: not persisting removes an encrypted-chat-log problem entirely — *"nothing to encrypt, nothing to purge, nothing to add to the lifecycle table"* — and *"'your conversations are never saved anywhere' is a real privacy line that matches what the rest of the product already does, rather than a claim that needs an asterisk."* A reader auditing this table will look for the chat row; tell them why there isn't one.

- [ ] **Step 2: Add the §7 control row**

Insert into the §7 table, in the document's `Control | What it does | Where` shape, near the other storage-reclaiming controls:

```markdown
| Delete downloaded model | Removes a downloaded model's weights from the device and reclaims the space; states the size before confirming. The assistant returns to its "choose a model" state; no ledger data is affected | More → Settings → Privacy, and More → Assistant → Models |
```

**Listed in both places deliberately.** Spec §2.3: deleting a model is a first-class control in `app/(tabs)/more/ai/models.tsx` **and mirrored** in More → Settings → Privacy, because *"downloading gigabytes with no visible way to reclaim them is the kind of thing that gets a finance app uninstalled."* And §7's own design rule applies: controls are honest verbs, and each control screen states what it does *and does not* do — hence "no ledger data is affected", which is the thing a user deleting something from a finance app will worry about.

- [ ] **Step 3: Add the §3.3 Data safety entry**

Add a row to the §3.3 table:

```markdown
| Model downloads (on-device assistant) | **Not collected.** Downloading a model transmits nothing about the user: no ledger content, no identifiers, no telemetry. The request reveals the device's IP address and the chosen model to the file's host, as any file download does; that is described in the privacy notice (§2.4) under the rule that the notice never claims more than the architecture delivers. Assistant conversations are processed **on-device only** and are never stored anywhere, so there is nothing to declare for them either. |
```

- [ ] **Step 4: Schedule the notice revision in the same release — do not defer it**

§2.4's rule: *"Any change to the lifecycle table (§4) requires a notice revision in the same release."* Step 1 changes §4. So the Layer 2 full notice gains, in its recipients and processing sections:

- the model host as a recipient of **the request only**, explicitly not of any user data;
- the fact that assistant conversations are never stored;
- the on-device-only nature of the inference.

Record this as a named deliverable in the release checklist. Do not let it become "and someone should update the notice" — that is precisely the drift §9's opening sentence warns about, one document further downstream.

- [ ] **Step 5: Verify all three edits are consistent with each other**

```bash
grep -n "models/\|model download\|Delete downloaded model" docs/07-privacy-and-compliance.md
```

§3.3's "not collected" claim, §4 row 9's "the request itself" and §7's control must tell the same story. A §3.3 that says nothing leaves the device while §4 row 9 says the request does is the mismatch §4's closing note calls a release blocker.

- [ ] **Step 6: Commit all three in one commit**

```bash
git add docs/07-privacy-and-compliance.md
git commit -m "docs: disclose model downloads and add the delete-model control"
```

---

## Task 5: `docs/00-product-brief.md` — record the no-op (spec §9 amendment 4)

**Files:**
- Modify: `docs/superpowers/specs/2026-08-2X-ai-tier-placement-decision.md` (append), **or** the design spec's §9 if a decision doc was not created

**No edit is made to `docs/00-product-brief.md`. That is the entire point of this task**, and it is why the spec listed it as amendment 4 rather than leaving it out. Spec §9 amendment 4:

> **`docs/00-product-brief.md` — no amendment needed, and that is the point.** Recorded here so a future reader does not go looking for one. The assistant is explanatory only; non-goal 2 (:121) is untouched. If a future change makes an amendment necessary, that change is out of this spec's scope by definition.

**Verify it before recording it.** A recorded no-op that turns out to be wrong is worse than no record: it is a document asserting that a boundary was checked when it was not.

- [ ] **Step 1: Read `docs/00-product-brief.md:118-124` and confirm non-goal 2 is untouched by the assistant**

Line 121, verbatim:

> `2. **Not a financial advisor.** It reports facts against user-set rules; it does not recommend products, investments, or credit.`

Confirm each clause against the design:

| Clause | The assistant |
|---|---|
| "reports facts against user-set rules" | Yes — the seven tools are reads over the user's own limits, wallets, transactions and income; the assistant explains *what happened* and *where you stand*. |
| "does not recommend products" | No product surface exists. There is no write path and no extension point for one. |
| "does not recommend investments" | Nothing in the tool set touches investments; investments are a separate Far-band backlog item. |
| "does not recommend credit" | Credit wallets are read-only and excluded from the balance total; nothing recommends borrowing. |
| The one that matters: does it ever answer *"what should I do"* | **No, and it is enforced by deterministic code on both sides of the model** — input triage refuses before generation, the output guard suppresses after it. Not by a system-prompt line. |

- [ ] **Step 2: Record the finding, with its own reversal trigger**

Append:

```markdown
## Product brief — checked, and deliberately unamended

**Checked:** 2026-__-__   **By:** ____

`docs/00-product-brief.md:121` (permanent non-goal 2, "Not a financial advisor") is
**untouched by the on-device assistant**, and no amendment to the brief is made or needed.
Recorded here so a future reader does not go looking for one.

The assistant sits entirely inside that sentence: it answers *what happened* and *where you
stand*, and never *what should I do*. That is what makes it buildable with no brief amendment
and no regulatory review.

**This record expires the moment §4's guardrails weaken.** The design spec §0.1 is explicit:
"Any change that weakens §4's input triage or output guard is a change to what this product
legally is, and must go back to the brief." A softened refusal, a removed triage row, an
output guard relaxed to reduce false positives — any of those makes this entry false, and the
brief becomes the document to amend rather than the document to cite.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-2X-ai-tier-placement-decision.md
git commit -m "docs: record that the product brief needs no amendment for the assistant"
```

---

## Self-review against spec §9

| §9 requirement | Task | Gated? |
|---|---|---|
| Amendment 1 — `09-v2-backlog.md` :209 and :227, Plus → Free | Task 3 | **Yes** — Task 1's decision, and the spike's tier-1 and 4B tool-pick numbers |
| Amendment 1 — the :227 row splits into two | Task 3 step 3 | Same gate |
| Amendment 2 — §2.11 banding split; explanatory moves, prescriptive does not | Task 2 | No |
| Amendment 2 — `:207` stays exactly as written | Task 2 step 3, verified by diff | No |
| Amendment 3 — §4 lifecycle rows for downloads and the models directory | Task 4 step 1 | Hosting decision |
| Amendment 3 — §7 "Delete downloaded model" | Task 4 step 2 | Hosting decision |
| Amendment 3 — §3.3 Data safety: not collection, but described | Task 4 step 3 | Hosting decision |
| Amendment 3 — the §2.4 notice revision in the same release | Task 4 step 4 | Hosting decision |
| Amendment 4 — the recorded no-op on `00-product-brief.md` | Task 5 | No |

**Added beyond §9, and why:** Task 1 exists because the spec argues amendment 1 from cost while §6 risks 1 and 7 constrain it on capability, and the spec never reconciles the two. Task 4 step 4 exists because §4's own closing note and §2.4's rule make the notice revision part of this edit rather than a follow-up. Task 2's prerequisite-2 paragraph exists because §9 amendment 2 lists prerequisites 1, 3 and 4 as answered and is silent on 2 — which is still unmet, is the reason for §0.4's whole sequencing decision, and would be an overclaim to omit.

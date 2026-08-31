# Model Weight Hosting Decision

**Decides:** design spec §6 risk 9, which stated the problem and explicitly chose nothing.
**Answers:** implementation plan `2026-08-20-on-device-ai-assistant.md` Task 1, steps 1 and 3, and
Task 2. Step 2 (the digests) is blocked and says so below.
**Spec:** `docs/superpowers/specs/2026-08-18-on-device-ai-assistant-design.md` §2.1, §2.3, §2.4, §6 risk 9.
**Decided:** 2026-08-31.
**Owner:** repo owner (John Filhmar). Recorded per Task 1's requirement that a name appear here.

---

## 0. Licence re-verification (spec §2.1, §8.4)

**Checked:** 2026-08-31, by reading the licence tag on each Hugging Face model card as it stands
today, not a summary and not a blog post.

| Model | Licence as read today | Read at | Repo revision | Commercial use permitted? |
|---|---|---|---|---|
| Qwen3-0.6B | `apache-2.0` | `huggingface.co/Qwen/Qwen3-0.6B` | card as of 2026-08-31 | **Yes** |
| Qwen3-1.7B | `apache-2.0` | `huggingface.co/Qwen/Qwen3-1.7B` | card as of 2026-08-31 | **Yes** |
| Qwen3-4B-Instruct-2507 | `apache-2.0` | `huggingface.co/Qwen/Qwen3-4B-Instruct-2507` | card as of 2026-08-31 | **Yes** |
| `unsloth/Qwen3-1.7B-GGUF` (third-party conversion) | `apache-2.0` | `huggingface.co/unsloth/Qwen3-1.7B-GGUF` | `d7f544eead698dbd1f15126ef60b45a1e1933222` | **Yes** |
| `unsloth/Qwen3-4B-Instruct-2507-GGUF` (third-party conversion) | `apache-2.0` | `huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF` | `a06e946bb6b655725eafa393f4a9745d460374c9` | **Yes** |

**Verdict:** all five clear. No tier is removed on licence grounds. The spec's repeated warning about
**Qwen2.5-3B and Qwen2.5-72B under the non-commercial Qwen Research License** is unaffected and still
binds: those models stay out, and the §2.1 instruction not to drift back to Qwen2.5 for the small
sizes stands.

**Re-check trigger:** this check expires. Re-read before the catalogue ships and before any tier is
added. If more than 60 days have passed, redo it from scratch rather than carrying this table forward
with a new date. A licence read in August is not evidence in November.

---

## 1. The finding that changes the shape of this decision

**Qwen's own GGUF repositories ship `Q8_0` only.**

| Repo | GGUF files it actually contains | Revision read |
|---|---|---|
| `Qwen/Qwen3-0.6B-GGUF` | `Qwen3-0.6B-Q8_0.gguf`, and nothing else | `23749fefcc72300e3a2ad315e1317431b06b590a` |
| `Qwen/Qwen3-1.7B-GGUF` | `Qwen3-1.7B-Q8_0.gguf`, and nothing else | `90862c4b9d2787eaed51d12237eafdfe7c5f6077` |
| `Qwen/Qwen3-4B-Instruct-2507-GGUF` | no such repo resolves | n/a |

The tier table in spec §2.1 asks for `Q4_K_M` at tiers 1, 2 and 4, and `Q6_K` at tier 5. **Four of
the five tiers have no upstream-published GGUF.** Only tier 3 (`qwen3-1.7b-q8`, Q8_0) can be sourced
directly from Qwen.

The spec never claimed otherwise, but it also never checked, and impl Task 1 step 3 ("who converts to
GGUF?") is the question this finding forces into the open rather than leaving as a default.

Two ways to get the missing quants, and they differ on exactly the axis that matters here:

| | Third-party conversion (`unsloth`) | Self-conversion |
|---|---|---|
| Licence | `apache-2.0`, verified above, no added terms | upstream `apache-2.0` binds directly, no third party in the chain |
| Availability | a repo we do not control can be renamed, relicensed, or deleted | we control the artifact for as long as we keep it |
| Tampering | defeated by the pinned digest either way | defeated by the pinned digest either way |
| Cost to us | zero | roughly 13 GB of downloads, plus conversion and quantisation time |
| Ongoing burden | none | we own a conversion pipeline and must redo it per model refresh |

Note what is **not** in the tampering row. Because the expected digest is compiled into the APK
(§3 below), neither option can be made to serve modified weights. The difference between them is
**availability**, not integrity. Risk 9's actual words are *"a Hugging Face URL can move, and a dead
URL is a dead menu entry with no recovery path"*, and that is a deletion risk, not an attacker.

**Decided 2026-08-31 in favour of the third-party conversion (`unsloth`). See §6.**

---

## 2. Question 1 and 2: where the GGUFs live, and how the URL is pinned

**Bytes are served by the model provider, not by us.** The catalogue names an `https:` URL per tier
and the phone fetches from it directly. We do not proxy the bytes.

**Every URL is pinned to an immutable revision.** Hugging Face's `resolve/<commit-sha>/` form, never
`resolve/main/`. A bare `main` URL is rejected outright: the file behind it can change without the
digest in our catalogue changing, and then every verification on every device fails simultaneously,
with a symptom that looks exactly like a network fault and is not one.

**The pinned sources, per §6's decision.** Sizes are the real blob sizes read from the Hugging Face
API on 2026-08-31, not the spec's estimates. They are recorded here because `ModelSpec.bytes` is an
exact integer and because a `Content-Length` mismatch is the cheapest possible early reject (§4).

| id | repo | file | revision | bytes |
|---|---|---|---|---|
| `qwen3-0.6b-q4` | `unsloth/Qwen3-0.6B-GGUF` | `Qwen3-0.6B-Q4_K_M.gguf` | `50968a4468ef4233ed78cd7c3de230dd1d61a56b` | 396,705,472 |
| `qwen3-1.7b-q4` | `unsloth/Qwen3-1.7B-GGUF` | `Qwen3-1.7B-Q4_K_M.gguf` | `d7f544eead698dbd1f15126ef60b45a1e1933222` | 1,107,409,472 |
| `qwen3-1.7b-q8` | `unsloth/Qwen3-1.7B-GGUF` | `Qwen3-1.7B-Q8_0.gguf` | `d7f544eead698dbd1f15126ef60b45a1e1933222` | 1,834,426,944 |
| `qwen3-4b-2507-q4` | `unsloth/Qwen3-4B-Instruct-2507-GGUF` | `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` | `a06e946bb6b655725eafa393f4a9745d460374c9` | 2,497,281,120 |
| `qwen3-4b-2507-q6` | `unsloth/Qwen3-4B-Instruct-2507-GGUF` | `Qwen3-4B-Instruct-2507-Q6_K.gguf` | `a06e946bb6b655725eafa393f4a9745d460374c9` | 3,306,261,600 |

URL form, with no `main` anywhere in it:

```
https://huggingface.co/<repo>/resolve/<revision>/<file>
```

**The spec's size estimates were accurate** (~0.4, ~1.1, ~1.8, ~2.5, ~3.3 GB against the measured
figures above), which is worth stating only because its tok/s estimates were not, and the two are
sometimes cited together as if equally reliable.

Documented fallback, unused unless `unsloth` disappears: `Qwen/Qwen3-0.6B-GGUF` at
`23749fefcc72300e3a2ad315e1317431b06b590a` and `Qwen/Qwen3-1.7B-GGUF` at
`90862c4b9d2787eaed51d12237eafdfe7c5f6077`, both `Q8_0` only.

**Rejected: proxying the bytes through our own server.** It buys one real thing, that Hugging Face
never learns a user's IP. It costs a single point of failure on the download path, `Range` and resume
proxying that has to be correct on a 1.1 GB transfer over Philippine prepaid data, and egress
measured in terabytes. It buys **no integrity** that the digest does not already provide. If that
privacy property is ever wanted for one tier, it is one `url` field pointing at our own mirror, with
no redesign.

---

## 3. Question 4: the catalogue is served, and the digests are not

This is the security core of the decision, so it is stated as rules the code must make unrepresentable
rather than as intentions.

1. **`lib/ai/catalogue.ts` ships compiled into the APK and is the floor.** For any model id present
   in the binary, the binary's `sha256` wins. Always. The server has no path to override it.
2. **The server may repoint a `url` and retire an id. Nothing else.** It may not add a model and it
   may not supply a digest.
3. **Adding a tier requires an app release.** Deliberate. A server-added tier needs a server-supplied
   digest, which reintroduces the whole attack; defending that properly means Ed25519 over the
   catalogue payload with an offline signing key, and `mobile/package.json` ships `@noble/hashes` and
   `@noble/ciphers` but not `@noble/curves`. That is a new dependency plus key custody, taken on by a
   solo maintainer, to make a rare event slightly faster. Repoint and retire cover the operational
   needs that actually recur: a dead URL, and cutting a tier after the §2.5 eval.
4. **Fail closed to the binary.** Server unreachable means use the compiled catalogue. The feature
   works when our infrastructure does not.
5. **`GET /v1/ai_models` is unauthenticated and cacheable.** It is a public list of public files.
   Attaching a user identity is the only way this design would leak something the all-static design
   does not, so no identity is attached.

**What rule 2 buys.** A fully compromised PeraPlano server can redirect the phone to any URL an
attacker likes, and the download still fails, because the bytes are checked against the digest baked
into the app. Server compromise costs availability, never integrity. That is the property worth
paying for, and it is free.

**Transport.** HTTPS for the catalogue call and for every `url`, which `ModelSpec` already requires.
No certificate pinning against Hugging Face: their certificates rotate, pinning them turns a routine
rotation into a fleet-wide outage, and it defends a property the digest already defends better.

---

## 4. Download hardening, beyond the digest

Additions to spec §2.3's four rules, all cheap:

- **Check `Content-Length` against the catalogue's `bytes` before hashing.** Rejects the common
  failure early instead of after streaming gigabytes.
- **Hash the file as written to disk, never the stream in flight.** A partial-write or
  truncated-flush bug must not be able to pass verification. The thing verified has to be the thing
  that will later be mmap'd.
- **Cap redirect depth, and refuse any redirect that leaves `https:`.** The rule is *https-only*, and
  deliberately **not** *same-host*. Verified 2026-08-31: a `resolve/<sha>/` URL answers **`302` to a
  Hugging Face CDN host**, and only that second hop returns `200` with the real `Content-Length`. An
  implementation that refuses cross-host redirects will fail every download on the happy path.
- **Both pinned URLs were exercised end to end on 2026-08-31.** `qwen3-1.7b-q4` returned
  `content-length: 1107409472` and `qwen3-0.6b-q4` returned `content-length: 396705472`, each exactly
  matching the §2 table. The pinning form works and the byte counts are not transcription errors.
- Unchanged from §2.3 and restated because they are load-bearing: download to `<id>.gguf.part`;
  rename to `<id>.gguf` only after the digest matches; `ready` is unreachable except through
  `verifying`.

---

## 5. Question 5: what happens when a URL dies anyway

The download fails into a **stated state**, never a spinner.

Copy, to be used verbatim: **"This model is temporarily unavailable. Your other models still work,
and nothing on your phone was affected."** Followed by a retry control.

A dead URL is then repaired server-side by rule 2 of §3, with no app release, which is the entire
reason the catalogue is served at all.

---

## 6. Conversion source: DECIDED 2026-08-31

**Option A. All quants come from `unsloth`.** Owner's decision, on the reasoning that the third-party
dependency costs nothing today and there is no installed base yet whose availability it puts at risk.
That is the correct read of the trade: the exposure here is availability, and availability matters in
proportion to how many people are relying on it, which right now is nobody.

The alternative, converting from upstream safetensors and self-hosting, was considered and deferred
rather than dismissed. It buys stronger provenance and immunity from a third party deleting a repo,
and it costs roughly 13 GB of downloads plus permanent ownership of a conversion pipeline that must
be rerun on every model refresh. It is an availability hedge, and it should be bought when there is
availability worth hedging.

**Revisit trigger, so this decision is not merely inherited later:** convert and self-host if any
source repo is pulled or relicensed, or at the point the tier list is final and short enough that
converting it is one afternoon's work. Whichever comes first.

**Single converter for all tiers, and this is not a stylistic preference.** Tier 2
(`qwen3-1.7b-q4`) and tier 3 (`qwen3-1.7b-q8`) are **the same base model at two quants**, and spec
§5.5 cuts one of them by comparing their eval scores directly. `Qwen/Qwen3-1.7B-GGUF` does publish an
official `Q8_0`, so tier 3 could have come from upstream, but taking tiers 2 and 3 from two different
converters would put different chat-template and thinking-flag metadata inside the two files and make
quant no longer the only variable between them. The §5.5 comparison would then be measuring the
converter as much as the quantisation. One converter across the whole catalogue keeps that comparison
honest.

Upstream `Qwen/Qwen3-1.7B-GGUF` at `90862c4b9d2787eaed51d12237eafdfe7c5f6077` is recorded as the
documented fallback for tier 3 if `unsloth` ever disappears.

---

## 7. Blocked: the digests (Task 1 step 2)

**The source is now settled (§6) and the URLs and byte counts are pinned (§2). What is still missing
is the digest itself, which requires downloading each file.** Left empty rather than guessed:
recording a digest against a URL other than the one that ships is worse than recording none, because
it fails on every device at once and presents as a network problem.

Deliberately **not** downloading all five now. The spike cuts tiers on hardware grounds before this
matters (spec §5.5), and on the 2026-08-31 device reading tier 5 cannot load on the only test phone
at all. Fetching 9.1 GB to digest files that may never ship is work done in the wrong order. Digest
each tier as it survives.

| id | sha256 | status |
|---|---|---|
| `qwen3-0.6b-q4` | `ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a` | **computed 2026-08-31** |
| `qwen3-1.7b-q4` | `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897` | **computed 2026-08-31** |
| `qwen3-1.7b-q8` | | pending |
| `qwen3-4b-2507-q4` | | pending |
| `qwen3-4b-2507-q6` | | pending, may never ship (will not load on the A54) |

**Tier 2 is done and checks out.** Downloaded from the §2 URL on 2026-08-31, `stat -c %s` returned
`1107409472`, matching both the API blob size and the `Content-Length` from the HEAD request. Three
independent readings of the same number, so `ModelSpec.bytes` for this tier is not a transcription.
Local copy kept outside the repo at `D:\My Folder\peraplano_spike_models\qwen3-1.7b-q4.gguf` for the
spike's use; it is 1.1 GB and does not belong in git.

Filled by, per tier, against the exact URL from §2:

```bash
curl -L -o <id>.gguf "https://huggingface.co/<repo>/resolve/<revision>/<file>"
sha256sum <id>.gguf
stat -c %s <id>.gguf   # must equal the bytes column in §2
```

The digest, the byte count, and the URL they were computed from are recorded **together**, in one row.

## 8. Blocked: `minRamBytes` (Task 1 step 3)

Depends on the spike's Task 7 PSS table, which has not run. `minRamBytes = measured_peak_pss +
headroom`, with the headroom named and justified in this file when the numbers exist, because §5.2
asserts `minRamBytes > bytes` for every entry and an invariant over two guesses is not an invariant.

**A device reading taken 2026-08-31 that bears on this:** the A54 reported `MemAvailable` of 2.66 GiB
with **3.4 GB already in zram at idle**, against the 1.6 GB recorded on 2026-08-21 for the same phone.
One sample is not a baseline. Task 7 needs repeated sampling across sessions, and `minRamBytes` must
be derived from available memory on a device under real pressure, never from total RAM minus an
allowance.

---

## 9. Consequences for other documents

- **`docs/07-privacy-and-compliance.md` §4** needs the lifecycle row spec §2.4 already required: the
  weight download reveals device IP and model choice to the file's host. Unchanged by this decision,
  because we are not proxying bytes.
- **One new recipient, and it is ours:** the catalogue call reveals an IP to the PeraPlano server.
  Unauthenticated and carrying no user data, but it is honest to list it.
- **Spec §6 risk 9** is closed by this file, except for §6 above.
- **Spec §2.1** should note that the tier table's quants are not all available upstream, so the
  conversion source is a catalogue fact rather than an implementation detail.

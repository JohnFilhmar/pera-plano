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

This is the one open decision. See §6.

---

## 2. Question 1 and 2: where the GGUFs live, and how the URL is pinned

**Bytes are served by the model provider, not by us.** The catalogue names an `https:` URL per tier
and the phone fetches from it directly. We do not proxy the bytes.

**Every URL is pinned to an immutable revision.** Hugging Face's `resolve/<commit-sha>/` form, never
`resolve/main/`. A bare `main` URL is rejected outright: the file behind it can change without the
digest in our catalogue changing, and then every verification on every device fails simultaneously,
with a symptom that looks exactly like a network fault and is not one.

Recorded revisions, for whichever source §6 settles on:

- `unsloth/Qwen3-1.7B-GGUF` at `d7f544eead698dbd1f15126ef60b45a1e1933222`
- `unsloth/Qwen3-4B-Instruct-2507-GGUF` at `a06e946bb6b655725eafa393f4a9745d460374c9`
- `Qwen/Qwen3-0.6B-GGUF` at `23749fefcc72300e3a2ad315e1317431b06b590a`
- `Qwen/Qwen3-1.7B-GGUF` at `90862c4b9d2787eaed51d12237eafdfe7c5f6077`

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
- **Cap redirect depth, and refuse any redirect that leaves `https:`.**
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

## 6. THE OPEN DECISION: conversion source

Everything above is settled. This is not, and it is owner-only because it commits either a
dependency on a third party or roughly 13 GB of the owner's bandwidth plus an ongoing pipeline.

**Option A: source the missing quants from `unsloth`.** Free, immediate, licence verified as
`apache-2.0` today, revisions pinned above. The risk carried is that a repo we do not control is
deleted or rewritten, which costs availability until we repoint, and repointing is exactly what §3
rule 2 exists to make cheap.

**Option B: convert from upstream safetensors ourselves and host the result** in a project-controlled
repo at a pinned revision. Strongest provenance: the only licence in the chain is upstream
Apache-2.0, read above, and no third party can delete our artifact. Costs roughly 13 GB of downloads,
`convert_hf_to_gguf.py` plus `llama-quantize` runs, and ownership of a conversion step that must be
repeated on every model refresh.

**Recommendation: A now, B later if it earns itself.** The digest pin means A cannot be made to
serve bad weights, only to disappear, and §3 rule 2 already makes disappearance a server-side
one-liner. B's advantage is real but it is an availability hedge bought with a permanent maintenance
burden, taken on before a single tier has been proven to run on the target hardware. Revisit B if a
source is ever actually pulled, or once the tier list is final and small enough that converting three
files is a one-afternoon job rather than an open-ended commitment.

---

## 7. Blocked: the digests (Task 1 step 2)

**Not computable yet, and deliberately left empty rather than guessed.** They depend on §6, and the
final tier list may be shorter than five because the spike cuts tiers on hardware grounds first
(spec §5.5). Recording a digest against a URL other than the one that ships is worse than recording
none: it fails on every device and presents as a network problem.

| id | source repo + revision | sha256 | exact bytes |
|---|---|---|---|
| `qwen3-0.6b-q4` | | | |
| `qwen3-1.7b-q4` | | | |
| `qwen3-1.7b-q8` | | | |
| `qwen3-4b-2507-q4` | | | |
| `qwen3-4b-2507-q6` | | | |

Filled by, per tier:

```bash
curl -L -o <id>.gguf "<the pinned resolve/<sha>/ url>"
sha256sum <id>.gguf
stat -c %s <id>.gguf
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
